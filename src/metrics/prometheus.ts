import client from "prom-client";

// ===== PROMETHEUS METRICS SETUP =====
// Collect default Node.js metrics (memory, CPU, event loop)
client.collectDefaultMetrics({
  prefix: "nodejs_",
});

// HTTP Request Metrics
export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "path", "status"],
  // Buckets from prometheus_guide.md - covers fast endpoints to long-running downloads
  buckets: [
    0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 120, 180, 240, 300,
  ],
});

export const httpRequestsInFlight = new client.Gauge({
  name: "http_requests_in_flight",
  help: "Number of HTTP requests currently being processed",
  labelNames: ["method", "path"],
});

// Download-Specific Metrics
export const downloadRequestsTotal = new client.Counter({
  name: "download_requests_total",
  help: "Total number of download requests",
  labelNames: ["endpoint", "status", "file_available"],
});

export const downloadProcessingDurationSeconds = new client.Histogram({
  name: "download_processing_duration_seconds",
  help: "Download processing duration in seconds (includes simulated delay)",
  labelNames: ["file_available"],
  // Buckets from prometheus_guide.md - captures 10-200s delay range
  buckets: [
    0.1, 0.5, 1, 2, 5, 10, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 300,
  ],
});

export const downloadActiveCount = new client.Gauge({
  name: "download_active_count",
  help: "Number of active download requests",
});

export const downloadSimulatedDelaySeconds = new client.Histogram({
  name: "download_simulated_delay_seconds",
  help: "Simulated delay applied to downloads in seconds",
  buckets: [10, 30, 60, 90, 120, 150, 180, 200],
});

export const downloadFileSizeBytes = new client.Histogram({
  name: "download_file_size_bytes",
  help: "File size distribution in bytes",
  labelNames: ["status"],
  buckets: [1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000],
});

// S3 Operation Metrics
export const s3OperationsTotal = new client.Counter({
  name: "s3_operations_total",
  help: "Total number of S3 operations",
  labelNames: ["operation", "result"],
});

export const s3OperationDurationSeconds = new client.Histogram({
  name: "s3_operation_duration_seconds",
  help: "S3 operation duration in seconds",
  labelNames: ["operation"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Rate Limiting Metrics
export const rateLimitRejectionsTotal = new client.Counter({
  name: "rate_limit_rejections_total",
  help: "Total number of rate limit rejections",
});

// Timeout Metrics
export const timeoutErrorsTotal = new client.Counter({
  name: "timeout_errors_total",
  help: "Total number of timeout errors",
  labelNames: ["endpoint"],
});

export { client };
