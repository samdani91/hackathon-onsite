import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { sentry } from "@hono/sentry";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { rateLimiter } from "hono-rate-limiter";
import client from "prom-client";
//deploy test
// Helper for optional URL that treats empty string as undefined
const optionalUrl = z
  .string()
  .optional()
  .transform((val) => (val === "" ? undefined : val))
  .pipe(z.url().optional());

// Environment schema
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: optionalUrl,
  S3_BUCKET_NAME: z.string().default(""),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),
  SENTRY_DSN: optionalUrl,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(100),
  CORS_ORIGINS: z
    .string()
    .default("*")
    .transform((val) => (val === "*" ? "*" : val.split(","))),
  // Download delay simulation (in milliseconds)
  DOWNLOAD_DELAY_MIN_MS: z.coerce.number().int().min(0).default(10000), // 10 seconds
  DOWNLOAD_DELAY_MAX_MS: z.coerce.number().int().min(0).default(200000), // 200 seconds
  DOWNLOAD_DELAY_ENABLED: z.coerce.boolean().default(true),
});

// Parse and validate environment
const env = EnvSchema.parse(process.env);

// S3 Client
const s3Client = new S3Client({
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
  ...(env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY && {
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

// Initialize OpenTelemetry SDK
const otelSDK = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "delineate-hackathon-challenge",
  }),
  traceExporter: new OTLPTraceExporter(),
});
otelSDK.start();

// ===== PROMETHEUS METRICS SETUP =====
// Collect default Node.js metrics (memory, CPU, event loop)
client.collectDefaultMetrics({
  prefix: "nodejs_",
});

// HTTP Request Metrics
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "path", "status"],
  // Buckets from prometheus_guide.md - covers fast endpoints to long-running downloads
  buckets: [
    0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 120, 180, 240, 300,
  ],
});

const httpRequestsInFlight = new client.Gauge({
  name: "http_requests_in_flight",
  help: "Number of HTTP requests currently being processed",
  labelNames: ["method", "path"],
});

// Download-Specific Metrics
const downloadRequestsTotal = new client.Counter({
  name: "download_requests_total",
  help: "Total number of download requests",
  labelNames: ["endpoint", "status", "file_available"],
});

const downloadProcessingDurationSeconds = new client.Histogram({
  name: "download_processing_duration_seconds",
  help: "Download processing duration in seconds (includes simulated delay)",
  labelNames: ["file_available"],
  // Buckets from prometheus_guide.md - captures 10-200s delay range
  buckets: [
    0.1, 0.5, 1, 2, 5, 10, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 300,
  ],
});

const downloadActiveCount = new client.Gauge({
  name: "download_active_count",
  help: "Number of active download requests",
});

const downloadSimulatedDelaySeconds = new client.Histogram({
  name: "download_simulated_delay_seconds",
  help: "Simulated delay applied to downloads in seconds",
  buckets: [10, 30, 60, 90, 120, 150, 180, 200],
});

const downloadFileSizeBytes = new client.Histogram({
  name: "download_file_size_bytes",
  help: "File size distribution in bytes",
  labelNames: ["status"],
  buckets: [1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000],
});

// S3 Operation Metrics
const s3OperationsTotal = new client.Counter({
  name: "s3_operations_total",
  help: "Total number of S3 operations",
  labelNames: ["operation", "result"],
});

const s3OperationDurationSeconds = new client.Histogram({
  name: "s3_operation_duration_seconds",
  help: "S3 operation duration in seconds",
  labelNames: ["operation"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Rate Limiting Metrics
const rateLimitRejectionsTotal = new client.Counter({
  name: "rate_limit_rejections_total",
  help: "Total number of rate limit rejections",
});

// Timeout Metrics
const timeoutErrorsTotal = new client.Counter({
  name: "timeout_errors_total",
  help: "Total number of timeout errors",
  labelNames: ["endpoint"],
});

const app = new OpenAPIHono();

// Request ID middleware - adds unique ID to each request
app.use(async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  await next();
});

// Security headers middleware (helmet-like)
app.use(secureHeaders());

// CORS middleware
app.use(
  cors({
    origin: env.CORS_ORIGINS,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    exposeHeaders: [
      "X-Request-ID",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
    ],
    maxAge: 86400,
  }),
);

// Request timeout middleware
app.use(timeout(env.REQUEST_TIMEOUT_MS));

// Rate limiting middleware
app.use(
  rateLimiter({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: "draft-6",
    keyGenerator: (c) =>
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "anonymous",
  }),
);

// OpenTelemetry middleware
app.use(
  httpInstrumentationMiddleware({
    serviceName: "delineate-hackathon-challenge",
  }),
);

// Sentry middleware
app.use(
  sentry({
    dsn: env.SENTRY_DSN,
  }),
);

// Prometheus HTTP metrics middleware
app.use(async (c, next) => {
  // Skip metrics endpoint to avoid recursion
  if (c.req.path === "/metrics") {
    await next();
    return;
  }

  const method = c.req.method;
  // Normalize path to prevent high cardinality
  const path = c.req.path.startsWith("/v1/download/")
    ? `/v1/download/${c.req.path.split("/")[3] ?? "unknown"}`
    : c.req.path;

  // Track in-flight requests
  httpRequestsInFlight.labels(method, path).inc();
  const startTime = Date.now();

  try {
    await next();
  } finally {
    const status = String(c.res.status);
    const duration = (Date.now() - startTime) / 1000;

    httpRequestsInFlight.labels(method, path).dec();
    httpRequestsTotal.labels(method, path, status).inc();
    httpRequestDurationSeconds.labels(method, path, status).observe(duration);
  }
});

// Error response schema for OpenAPI
const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  })
  .openapi("ErrorResponse");

// Error handler with Sentry
app.onError((err, c) => {
  c.get("sentry").captureException(err);
  const requestId = c.get("requestId") as string | undefined;
  return c.json(
    {
      error: "Internal Server Error",
      message:
        env.NODE_ENV === "development"
          ? err.message
          : "An unexpected error occurred",
      requestId,
    },
    500,
  );
});

// Schemas
const MessageResponseSchema = z
  .object({
    message: z.string(),
  })
  .openapi("MessageResponse");

const HealthResponseSchema = z
  .object({
    status: z.enum(["healthy", "unhealthy"]),
    checks: z.object({
      storage: z.enum(["ok", "error"]),
    }),
  })
  .openapi("HealthResponse");

// Download API Schemas
const DownloadInitiateRequestSchema = z
  .object({
    file_ids: z
      .array(z.number().int().min(10000).max(100000000))
      .min(1)
      .max(1000)
      .openapi({ description: "Array of file IDs (10K to 100M)" }),
  })
  .openapi("DownloadInitiateRequest");

const DownloadInitiateResponseSchema = z
  .object({
    jobId: z.string().openapi({ description: "Unique job identifier" }),
    status: z.enum(["queued", "processing"]),
    totalFileIds: z.number().int(),
  })
  .openapi("DownloadInitiateResponse");

const DownloadCheckRequestSchema = z
  .object({
    file_id: z
      .number()
      .int()
      .min(10000)
      .max(100000000)
      .openapi({ description: "Single file ID to check (10K to 100M)" }),
  })
  .openapi("DownloadCheckRequest");

const DownloadCheckResponseSchema = z
  .object({
    file_id: z.number().int(),
    available: z.boolean(),
    s3Key: z
      .string()
      .nullable()
      .openapi({ description: "S3 object key if available" }),
    size: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "File size in bytes" }),
  })
  .openapi("DownloadCheckResponse");

const DownloadStartRequestSchema = z
  .object({
    file_id: z
      .number()
      .int()
      .min(10000)
      .max(100000000)
      .openapi({ description: "File ID to download (10K to 100M)" }),
  })
  .openapi("DownloadStartRequest");

const DownloadStartResponseSchema = z
  .object({
    file_id: z.number().int(),
    status: z.enum(["completed", "failed"]),
    downloadUrl: z
      .string()
      .nullable()
      .openapi({ description: "Presigned download URL if successful" }),
    size: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "File size in bytes" }),
    processingTimeMs: z
      .number()
      .int()
      .openapi({ description: "Time taken to process the download in ms" }),
    message: z.string().openapi({ description: "Status message" }),
  })
  .openapi("DownloadStartResponse");

// Input sanitization for S3 keys - prevent path traversal
const sanitizeS3Key = (fileId: number): string => {
  // Ensure fileId is a valid integer within bounds (already validated by Zod)
  const sanitizedId = Math.floor(Math.abs(fileId));
  // Construct safe S3 key without user-controlled path components
  return `downloads/${String(sanitizedId)}.zip`;
};

// S3 health check
const checkS3Health = async (): Promise<boolean> => {
  if (!env.S3_BUCKET_NAME) return true; // Mock mode
  const startTime = Date.now();
  try {
    // Use a lightweight HEAD request on a known path
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: "__health_check_marker__",
    });
    await s3Client.send(command);
    const duration = (Date.now() - startTime) / 1000;
    s3OperationDurationSeconds.labels("HeadObject").observe(duration);
    s3OperationsTotal.labels("HeadObject", "success").inc();
    return true;
  } catch (err) {
    const duration = (Date.now() - startTime) / 1000;
    s3OperationDurationSeconds.labels("HeadObject").observe(duration);
    // NotFound is fine - bucket is accessible
    if (err instanceof Error && err.name === "NotFound") {
      s3OperationsTotal.labels("HeadObject", "not_found").inc();
      return true;
    }
    // AccessDenied or other errors indicate connection issues
    s3OperationsTotal.labels("HeadObject", "error").inc();
    return false;
  }
};

// S3 availability check
const checkS3Availability = async (
  fileId: number,
): Promise<{
  available: boolean;
  s3Key: string | null;
  size: number | null;
}> => {
  const s3Key = sanitizeS3Key(fileId);

  // If no bucket configured, use mock mode
  if (!env.S3_BUCKET_NAME) {
    const available = fileId % 7 === 0;
    return {
      available,
      s3Key: available ? s3Key : null,
      size: available ? Math.floor(Math.random() * 10000000) + 1000 : null,
    };
  }

  const startTime = Date.now();
  try {
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: s3Key,
    });
    const response = await s3Client.send(command);
    const duration = (Date.now() - startTime) / 1000;
    s3OperationDurationSeconds.labels("HeadObject").observe(duration);
    s3OperationsTotal.labels("HeadObject", "success").inc();
    return {
      available: true,
      s3Key,
      size: response.ContentLength ?? null,
    };
  } catch {
    const duration = (Date.now() - startTime) / 1000;
    s3OperationDurationSeconds.labels("HeadObject").observe(duration);
    s3OperationsTotal.labels("HeadObject", "not_found").inc();
    return {
      available: false,
      s3Key: null,
      size: null,
    };
  }
};

// Random delay helper for simulating long-running downloads
const getRandomDelay = (): number => {
  if (!env.DOWNLOAD_DELAY_ENABLED) return 0;
  const min = env.DOWNLOAD_DELAY_MIN_MS;
  const max = env.DOWNLOAD_DELAY_MAX_MS;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Routes
const rootRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["General"],
  summary: "Root endpoint",
  description: "Returns a welcome message",
  responses: {
    200: {
      description: "Successful response",
      content: {
        "application/json": {
          schema: MessageResponseSchema,
        },
      },
    },
  },
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check endpoint",
  description: "Returns the health status of the service and its dependencies",
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
    503: {
      description: "Service is unhealthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

app.openapi(rootRoute, (c) => {
  return c.json({ message: "Hello Hono!" }, 200);
});

app.openapi(healthRoute, async (c) => {
  const storageHealthy = await checkS3Health();
  const status = storageHealthy ? "healthy" : "unhealthy";
  const httpStatus = storageHealthy ? 200 : 503;
  return c.json(
    {
      status,
      checks: {
        storage: storageHealthy ? "ok" : "error",
      },
    },
    httpStatus,
  );
});

// Prometheus metrics endpoint
app.get("/metrics", async (c) => {
  c.header("Content-Type", client.register.contentType);
  const metrics = await client.register.metrics();
  return c.text(metrics);
});

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

// OpenAPI spec endpoint (disabled in production)
if (env.NODE_ENV !== "production") {
  app.doc("/openapi", {
    openapi: "3.0.0",
    info: {
      title: "Delineate Hackathon Challenge API",
      version: "1.0.0",
      description: "API for Delineate Hackathon Challenge",
    },
    servers: [{ url: "http://localhost:3000", description: "Local server" }],
  });

  // Scalar API docs
  app.get("/docs", Scalar({ url: "/openapi" }));
}

// Graceful shutdown handler
const gracefulShutdown = (server: ServerType) => (signal: string) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    console.log("HTTP server closed");

    // Shutdown OpenTelemetry to flush traces
    otelSDK
      .shutdown()
      .then(() => {
        console.log("OpenTelemetry SDK shut down");
      })
      .catch((err: unknown) => {
        console.error("Error shutting down OpenTelemetry:", err);
      })
      .finally(() => {
        // Destroy S3 client
        s3Client.destroy();
        console.log("S3 client destroyed");
        console.log("Graceful shutdown completed");
      });
  });
};

// Start server
const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${String(info.port)}`);
    console.log(`Environment: ${env.NODE_ENV}`);
    if (env.NODE_ENV !== "production") {
      console.log(`API docs: http://localhost:${String(info.port)}/docs`);
    }
  },
);

// Register shutdown handlers
const shutdown = gracefulShutdown(server);
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
// final check dockerhub
