import { httpInstrumentationMiddleware } from "@hono/otel";
import { sentry } from "@hono/sentry";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { rateLimiter } from "hono-rate-limiter";
import { env } from "../config/env.ts";
import {
  client,
  httpRequestsInFlight,
  httpRequestsTotal,
  httpRequestDurationSeconds,
} from "../metrics/prometheus.ts";

export const setupMiddleware = (app: OpenAPIHono) => {
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

  // Error handler with Sentry
  app.onError((err, c) => {
    console.error(err);
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
};
