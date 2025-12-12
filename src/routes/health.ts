import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { client } from "../metrics/prometheus.ts";
import { HealthResponseSchema, MessageResponseSchema } from "../schemas/api.ts";
import { checkS3Health } from "../services/s3.ts";

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

export const requestHandler = (app: OpenAPIHono) => {
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
};
