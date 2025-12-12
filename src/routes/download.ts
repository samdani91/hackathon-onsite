import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { env } from "../config/env.ts";
import {
  downloadActiveCount,
  downloadFileSizeBytes,
  downloadProcessingDurationSeconds,
  downloadRequestsTotal,
  downloadSimulatedDelaySeconds,
} from "../metrics/prometheus.ts";
import {
  DownloadCheckRequestSchema,
  DownloadCheckResponseSchema,
  DownloadInitiateRequestSchema,
  DownloadInitiateResponseSchema,
  DownloadStartRequestSchema,
  DownloadStartResponseSchema,
  ErrorResponseSchema,
} from "../schemas/api.ts";
import { checkS3Availability } from "../services/s3.ts";
import { getRandomDelay, sleep } from "../utils/helpers.ts";

// Download API Routes
const downloadInitiateRoute = createRoute({
  method: "post",
  path: "/v1/download/initiate",
  tags: ["Download"],
  summary: "Initiate download job",
  description: "Initiates a download job for multiple IDs",
  request: {
    body: {
      content: {
        "application/json": {
          schema: DownloadInitiateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Download job initiated",
      content: {
        "application/json": {
          schema: DownloadInitiateResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const downloadCheckRoute = createRoute({
  method: "post",
  path: "/v1/download/check",
  tags: ["Download"],
  summary: "Check download availability",
  description:
    "Checks if a single ID is available for download in S3. Add ?sentry_test=true to trigger an error for Sentry testing.",
  request: {
    query: z.object({
      sentry_test: z.string().optional().openapi({
        description:
          "Set to 'true' to trigger an intentional error for Sentry testing",
      }),
    }),
    body: {
      content: {
        "application/json": {
          schema: DownloadCheckRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Availability check result",
      content: {
        "application/json": {
          schema: DownloadCheckResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Download Start Route - simulates long-running download with random delay
const downloadStartRoute = createRoute({
  method: "post",
  path: "/v1/download/start",
  tags: ["Download"],
  summary: "Start file download (long-running)",
  description: `Starts a file download with simulated processing delay.
    Processing time varies randomly between ${String(env.DOWNLOAD_DELAY_MIN_MS / 1000)}s and ${String(env.DOWNLOAD_DELAY_MAX_MS / 1000)}s.
    This endpoint demonstrates long-running operations that may timeout behind proxies.`,
  request: {
    body: {
      content: {
        "application/json": {
          schema: DownloadStartRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Download completed successfully",
      content: {
        "application/json": {
          schema: DownloadStartResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

export const requestHandler = (app: OpenAPIHono) => {
  app.openapi(downloadInitiateRoute, (c) => {
    const { file_ids } = c.req.valid("json");
    const jobId = crypto.randomUUID();
    return c.json(
      {
        jobId,
        status: "queued" as const,
        totalFileIds: file_ids.length,
      },
      200,
    );
  });

  app.openapi(downloadCheckRoute, async (c) => {
    const { sentry_test } = c.req.valid("query");
    const { file_id } = c.req.valid("json");

    // Intentional error for Sentry testing (hackathon challenge)
    if (sentry_test === "true") {
      throw new Error(
        `Sentry test error triggered for file_id=${String(file_id)} - This should appear in Sentry!`,
      );
    }

    const s3Result = await checkS3Availability(file_id);
    return c.json(
      {
        file_id,
        ...s3Result,
      },
      200,
    );
  });

  app.openapi(downloadStartRoute, async (c) => {
    const { file_id } = c.req.valid("json");
    const startTime = Date.now();

    // Track active downloads
    downloadActiveCount.inc();

    try {
      // Get random delay and log it
      const delayMs = getRandomDelay();
      const delaySec = (delayMs / 1000).toFixed(1);
      const minDelaySec = (env.DOWNLOAD_DELAY_MIN_MS / 1000).toFixed(0);
      const maxDelaySec = (env.DOWNLOAD_DELAY_MAX_MS / 1000).toFixed(0);
      console.log(
        `[Download] Starting file_id=${String(file_id)} | delay=${delaySec}s (range: ${minDelaySec}s-${maxDelaySec}s) | enabled=${String(env.DOWNLOAD_DELAY_ENABLED)}`,
      );

      // Record simulated delay metric
      downloadSimulatedDelaySeconds.observe(delayMs / 1000);

      // Simulate long-running download process
      await sleep(delayMs);

      // Check if file is available in S3
      const s3Result = await checkS3Availability(file_id);
      const processingTimeMs = Date.now() - startTime;
      const processingTimeSec = processingTimeMs / 1000;

      console.log(
        `[Download] Completed file_id=${String(file_id)}, actual_time=${String(processingTimeMs)}ms, available=${String(s3Result.available)}`,
      );

      // Record download metrics
      downloadProcessingDurationSeconds
        .labels(String(s3Result.available))
        .observe(processingTimeSec);

      if (s3Result.available) {
        downloadRequestsTotal.labels("start", "completed", "true").inc();
        if (s3Result.size) {
          downloadFileSizeBytes.labels("completed").observe(s3Result.size);
        }
        return c.json(
          {
            file_id,
            status: "completed" as const,
            downloadUrl: `https://storage.example.com/${s3Result.s3Key ?? ""}?token=${crypto.randomUUID()}`,
            size: s3Result.size,
            processingTimeMs,
            message: `Download ready after ${(processingTimeMs / 1000).toFixed(1)} seconds`,
          },
          200,
        );
      } else {
        downloadRequestsTotal.labels("start", "failed", "false").inc();
        return c.json(
          {
            file_id,
            status: "failed" as const,
            downloadUrl: null,
            size: null,
            processingTimeMs,
            message: `File not found after ${(processingTimeMs / 1000).toFixed(1)} seconds of processing`,
          },
          200,
        );
      }
    } finally {
      downloadActiveCount.dec();
    }
  });
};
