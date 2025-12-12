# Long-Running Download Architecture Design

## Executive Summary

This document outlines a production-ready architecture for handling variable-length file downloads (10-120+ seconds) that works seamlessly with frontend applications and reverse proxies. The solution addresses timeout issues, provides excellent UX, and scales efficiently.

---

## 1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                  │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  React/Next.js Frontend                                          │   │
│  │  - Download UI Component                                         │   │
│  │  - Progress Indicator                                            │   │
│  │  - Retry Logic                                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────────────────┘
                        │ HTTPS
                        │ (Polling + WebSocket)
┌───────────────────────▼─────────────────────────────────────────────────┐
│                      REVERSE PROXY LAYER                                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Cloudflare / nginx / AWS ALB                                    │   │
│  │  - HTTP: 100s timeout (polling endpoints)                        │   │
│  │  - WebSocket: Extended timeout (status updates)                  │   │
│  │  - Rate limiting & DDoS protection                               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────────────────┐
│                       API GATEWAY LAYER                                 │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │  Express.js API Server (Stateless)                             │     │
│  │                                                                │     │
│  │  REST Endpoints:                                               │     │
│  │  POST   /v1/download/initiate      → Returns jobId immediately │     │
│  │  GET    /v1/download/status/:jobId → Job status & progress     │     │
│  │  GET    /v1/download/:jobId        → Presigned URL (when ready)│     │
│  │  DELETE /v1/download/:jobId        → Cancel job                │     │
│  │                                                                │     │
│  │  WebSocket Endpoint:                                           │     │
│  │  WS     /v1/download/subscribe/:jobId → Real-time updates      │     │
│  └────────────────────────────────────────────────────────────────┘     │
└──────────────┬──────────────────────────┬───────────────────────────────┘
               │                          │
               │ Enqueue Job              │ Query Status
               │                          │
┌──────────────▼──────────────┐  ┌────────▼─────────────┐
│   MESSAGE QUEUE             │  │   CACHE LAYER        │
│   (Redis + BullMQ)          │  │   (Redis)            │
│                             │  │                      │
│  - Job Queue                │  │  Job Metadata:       │
│  - Priority queues          │  │  {                   │
│  - Retry logic              │  │   jobId,             │
│  - Rate limiting            │  │   status,            │
│  - Dead letter queue        │  │   progress,          │
│                             │  │   fileId,            │
│                             │  │   userId,            │
└──────────────┬──────────────┘  │   createdAt,         │
               │                 │   updatedAt,         │
               │ Consume Jobs    │   downloadUrl,       │
               │                 │   error,             │
┌──────────────▼──────────────┐  │   ttl: 3600s         │
│   WORKER LAYER              │  │  }                   │
│   (Node.js Workers)         │  │                      │
│                             │  │  Active WebSockets:  │
│  Worker Pool (3-10 workers) │  │  {jobId → [clients]} │
│  - Process downloads        │  │                      │
│  - Update job status        │  └──────────────────────┘
│  - Handle failures          │
│  - Emit progress events     │
│                             │
└──────────────┬──────────────┘
               │
               │ Store File
               │
┌──────────────▼──────────────┐
│   STORAGE LAYER             │
│   (AWS S3 / MinIO)          │
│                             │
│  - Downloaded files         │
│  - Presigned URLs (15 min)  │
│  - Lifecycle policies       │
│  - Auto-deletion (24h)      │
└─────────────────────────────┘

┌────────────────────────────────┐
│   PERSISTENCE LAYER            │
│   (PostgreSQL)                 │
│                                │
│  Jobs Table:                   │
│  - Audit logs                  │
│  - Long-term analytics         │
│  - User download history       │
└────────────────────────────────┘
```

---

## 2. Technical Approach: Hybrid Pattern (Polling + WebSocket)

### Why Hybrid?

After analyzing all options, a **hybrid approach combining polling and WebSocket** provides the best balance:

✅ **Advantages:**

- **Resilience**: Polling works even if WebSocket fails (firewall/proxy issues)
- **Real-time UX**: WebSocket provides instant updates when available
- **Universal compatibility**: Polling works everywhere
- **Progressive enhancement**: Modern clients get WebSocket, legacy clients use polling
- **Graceful degradation**: Automatic fallback mechanism

### Pattern Comparison

| Pattern       | Pros                                 | Cons                                | Use Case                               |
| ------------- | ------------------------------------ | ----------------------------------- | -------------------------------------- |
| **Polling**   | Simple, universal, firewall-friendly | Higher latency, more requests       | Legacy systems, simple implementations |
| **WebSocket** | Real-time, efficient, bidirectional  | Proxy issues, connection management | Modern apps with real-time needs       |
| **Webhook**   | Decoupled, reliable                  | Requires public endpoint, complex   | B2B integrations, server-to-server     |
| **Hybrid**    | Best of all worlds, resilient        | Slightly more complex               | **Production systems (RECOMMENDED)**   |

---

## 3. Implementation Details

### 3.1 API Contract

#### A. POST /v1/download/initiate

**Purpose**: Start download job asynchronously

**Request:**

```json
{
  "file_id": 70000,
  "priority": "normal", // "low" | "normal" | "high"
  "user_id": "user_123",
  "metadata": {
    "source": "web_app",
    "client_version": "1.2.3"
  }
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "job_id": "job_7f8a9b2c3d4e",
    "status": "queued",
    "estimated_time": 60,
    "polling_interval": 2000, // ms
    "websocket_url": "wss://api.example.com/v1/download/subscribe/job_7f8a9b2c3d4e"
  }
}
```

**Response (429 Too Many Requests):**

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Maximum 5 concurrent downloads per user",
    "retry_after": 30
  }
}
```

---

#### B. GET /v1/download/status/:jobId

**Purpose**: Poll for job status

**Response (200 OK - Processing):**

```json
{
  "success": true,
  "data": {
    "job_id": "job_7f8a9b2c3d4e",
    "status": "processing", // "queued" | "processing" | "completed" | "failed"
    "progress": 45, // 0-100
    "created_at": "2025-12-12T04:15:00Z",
    "updated_at": "2025-12-12T04:15:30Z",
    "estimated_completion": "2025-12-12T04:16:30Z"
  }
}
```

**Response (200 OK - Completed):**

```json
{
  "success": true,
  "data": {
    "job_id": "job_7f8a9b2c3d4e",
    "status": "completed",
    "progress": 100,
    "download_url": "/v1/download/job_7f8a9b2c3d4e",
    "expires_at": "2025-12-12T04:30:00Z"
  }
}
```

**Response (200 OK - Failed):**

```json
{
  "success": true,
  "data": {
    "job_id": "job_7f8a9b2c3d4e",
    "status": "failed",
    "error": {
      "code": "DOWNLOAD_TIMEOUT",
      "message": "File download exceeded maximum time limit",
      "retryable": true
    }
  }
}
```

---

#### C. GET /v1/download/:jobId

**Purpose**: Get the actual download (presigned URL)

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "download_url": "https://s3.amazonaws.com/bucket/file.zip?X-Amz-...",
    "expires_at": "2025-12-12T04:30:00Z",
    "file_name": "report_70000.pdf",
    "file_size": 15728640,
    "content_type": "application/pdf"
  }
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "error": {
    "code": "JOB_NOT_READY",
    "message": "Download not ready yet. Current status: processing"
  }
}
```

---

#### D. DELETE /v1/download/:jobId

**Purpose**: Cancel an ongoing job

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Job cancelled successfully"
}
```

---

#### E. WebSocket: /v1/download/subscribe/:jobId

**Purpose**: Real-time status updates

**Message Format (Server → Client):**

```json
{
  "type": "status_update",
  "job_id": "job_7f8a9b2c3d4e",
  "status": "processing",
  "progress": 45,
  "timestamp": "2025-12-12T04:15:30Z"
}

{
  "type": "completed",
  "job_id": "job_7f8a9b2c3d4e",
  "download_url": "/v1/download/job_7f8a9b2c3d4e",
  "timestamp": "2025-12-12T04:16:30Z"
}

{
  "type": "error",
  "job_id": "job_7f8a9b2c3d4e",
  "error": {
    "code": "PROCESSING_ERROR",
    "message": "Failed to process file"
  },
  "timestamp": "2025-12-12T04:16:30Z"
}
```

---

### 3.2 Database Schema

#### Redis Cache (Job Metadata)

```typescript
interface JobMetadata {
  jobId: string;
  fileId: number;
  userId: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number; // 0-100
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  downloadUrl?: string; // S3 presigned URL
  expiresAt?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metadata: Record<string, any>;
  attempts: number;
  maxAttempts: number;
}

// Redis Keys:
// job:{jobId} → JobMetadata (TTL: 1 hour)
// user:{userId}:jobs → Set of jobIds (TTL: 24 hours)
// user:{userId}:active → Count of active jobs (TTL: 1 hour)
```

#### PostgreSQL (Audit & Analytics)

```sql
CREATE TABLE download_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_id VARCHAR(50) UNIQUE NOT NULL,
  file_id BIGINT NOT NULL,
  user_id VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  failed_at TIMESTAMP,
  duration_seconds INTEGER,
  file_size_bytes BIGINT,
  error_code VARCHAR(50),
  error_message TEXT,
  metadata JSONB,
  INDEX idx_user_created (user_id, created_at DESC),
  INDEX idx_status_created (status, created_at DESC),
  INDEX idx_job_id (job_id)
);

-- Analytics queries
CREATE MATERIALIZED VIEW download_analytics AS
SELECT
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as total_jobs,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  AVG(duration_seconds) FILTER (WHERE status = 'completed') as avg_duration,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_seconds) as p95_duration
FROM download_jobs
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY hour
ORDER BY hour DESC;
```

---

### 3.3 Background Job Processing

#### BullMQ Configuration

```typescript
// queue.config.ts
import { Queue, Worker, QueueScheduler } from "bullmq";
import Redis from "ioredis";

const redisConnection = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Job Queue
export const downloadQueue = new Queue("download-jobs", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000,
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

// Queue Scheduler (for retries and delayed jobs)
export const queueScheduler = new QueueScheduler("download-jobs", {
  connection: redisConnection,
});

// Priority levels
export enum JobPriority {
  LOW = 10,
  NORMAL = 5,
  HIGH = 1,
}
```

#### Worker Implementation

```typescript
// worker.ts
import { Worker, Job } from "bullmq";
import { downloadQueue } from "./queue.config";
import { updateJobStatus, notifyWebSocketClients } from "./services";
import { uploadToS3, generatePresignedUrl } from "./storage";

const worker = new Worker(
  "download-jobs",
  async (job: Job) => {
    const { jobId, fileId, userId } = job.data;

    try {
      // Update status to processing
      await updateJobStatus(jobId, {
        status: "processing",
        startedAt: new Date().toISOString(),
        progress: 0,
      });

      await notifyWebSocketClients(jobId, {
        type: "status_update",
        status: "processing",
        progress: 0,
      });

      // Simulate download with progress updates
      const fileBuffer = await downloadFileWithProgress(fileId, (progress) => {
        updateJobStatus(jobId, { progress });
        notifyWebSocketClients(jobId, {
          type: "progress",
          progress,
        });
      });

      // Upload to S3
      const s3Key = `downloads/${userId}/${jobId}`;
      await uploadToS3(s3Key, fileBuffer);

      // Generate presigned URL (15 min expiry)
      const downloadUrl = await generatePresignedUrl(s3Key, 900);

      // Update to completed
      await updateJobStatus(jobId, {
        status: "completed",
        progress: 100,
        downloadUrl,
        completedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      });

      await notifyWebSocketClients(jobId, {
        type: "completed",
        downloadUrl: `/v1/download/${jobId}`,
      });

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      await updateJobStatus(jobId, {
        status: "failed",
        error: {
          code: "PROCESSING_ERROR",
          message: errorMessage,
          retryable: job.attemptsMade < 3,
        },
      });

      await notifyWebSocketClients(jobId, {
        type: "error",
        error: errorMessage,
      });

      throw error; // BullMQ will handle retry
    }
  },
  {
    connection: redisConnection,
    concurrency: 10, // Process 10 jobs concurrently
    limiter: {
      max: 50, // Max 50 jobs per duration
      duration: 60000, // Per minute
    },
  },
);

// Worker event handlers
worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("Worker error:", err);
});
```

---

### 3.4 Error Handling & Retry Logic

#### Error Categories

```typescript
enum ErrorCode {
  // Retryable errors
  NETWORK_ERROR = "NETWORK_ERROR",
  TEMPORARY_UNAVAILABLE = "TEMPORARY_UNAVAILABLE",
  RATE_LIMIT = "RATE_LIMIT",

  // Non-retryable errors
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  INVALID_FILE_ID = "INVALID_FILE_ID",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  FILE_TOO_LARGE = "FILE_TOO_LARGE",

  // System errors
  PROCESSING_ERROR = "PROCESSING_ERROR",
  STORAGE_ERROR = "STORAGE_ERROR",
  TIMEOUT = "TIMEOUT",
}

function isRetryable(error: Error): boolean {
  const retryableCodes = [
    "NETWORK_ERROR",
    "TEMPORARY_UNAVAILABLE",
    "RATE_LIMIT",
    "PROCESSING_ERROR",
  ];

  return retryableCodes.includes((error as any).code);
}
```

#### Retry Strategy

```typescript
// Exponential backoff with jitter
const retryConfig = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000, // Start with 5s
  },
};

// Attempt 1: 5 seconds
// Attempt 2: 10 seconds
// Attempt 3: 20 seconds

// After 3 failures → Move to dead letter queue
```

#### Circuit Breaker Pattern

```typescript
import CircuitBreaker from "opossum";

const downloadCircuitBreaker = new CircuitBreaker(downloadFile, {
  timeout: 150000, // 150 seconds
  errorThresholdPercentage: 50,
  resetTimeout: 30000, // 30 seconds
});

downloadCircuitBreaker.on("open", () => {
  console.error("Circuit breaker opened - too many failures");
  // Alert ops team
});
```

---

### 3.5 Timeout Configuration

| Layer                | Timeout | Purpose                           |
| -------------------- | ------- | --------------------------------- |
| **Client (Browser)** | N/A     | No timeout (polling handles this) |
| **Cloudflare**       | 100s    | For polling endpoints only        |
| **Nginx**            | 60s     | For API requests                  |
| **WebSocket**        | 10 min  | Keep-alive for status updates     |
| **API Server**       | 30s     | Per HTTP request                  |
| **Worker Job**       | 150s    | Maximum job processing time       |
| **S3 Presigned URL** | 15 min  | Download window                   |

---

## 4. Proxy Configuration

### 4.1 Cloudflare Configuration

```nginx
# Cloudflare settings (via dashboard or API)

# For REST endpoints
# Workers → Settings → Network
proxy_connect_timeout: 100s
proxy_read_timeout: 100s

# For WebSocket endpoints
# Enable WebSocket support (automatic in CF)
# Path: /v1/download/subscribe/*

# Rate limiting
# Security → WAF → Rate limiting rules
Rule: "Download Initiate Rate Limit"
  Path: /v1/download/initiate
  Method: POST
  Rate: 10 requests per 60 seconds per IP

# Caching (disable for API)
Cache Rule:
  Path: /v1/download/*
  Cache Level: Bypass
```

### 4.2 Nginx Configuration

```nginx
# /etc/nginx/sites-available/download-service

upstream api_backend {
    least_conn;
    server api-1:3000 max_fails=3 fail_timeout=30s;
    server api-2:3000 max_fails=3 fail_timeout=30s;
    server api-3:3000 max_fails=3 fail_timeout=30s;
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$server_name$request_uri;
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/ssl/certs/api.example.com.crt;
    ssl_certificate_key /etc/ssl/private/api.example.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    # General settings
    client_max_body_size 10M;
    keepalive_timeout 65;

    # REST API endpoints
    location /v1/download/ {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;

        # Timeouts
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable buffering for streaming responses
        proxy_buffering off;
        proxy_request_buffering off;

        # Rate limiting
        limit_req zone=download_init burst=5 nodelay;
    }

    # WebSocket endpoint
    location /v1/download/subscribe/ {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;

        # WebSocket specific
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Extended timeouts for WebSocket
        proxy_connect_timeout 10s;
        proxy_send_timeout 600s;  # 10 minutes
        proxy_read_timeout 600s;  # 10 minutes

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Disable buffering
        proxy_buffering off;
    }
}

# Rate limiting zones
http {
    limit_req_zone $binary_remote_addr zone=download_init:10m rate=10r/m;
}
```

### 4.3 AWS Application Load Balancer

```yaml
# ALB Configuration (Terraform/CloudFormation)

TargetGroup:
  HealthCheck:
    Path: /health
    Interval: 30
    Timeout: 5
    HealthyThreshold: 2
    UnhealthyThreshold: 3

  Attributes:
    - Key: deregistration_delay.timeout_seconds
      Value: 30
    - Key: stickiness.enabled
      Value: true
    - Key: stickiness.type
      Value: lb_cookie
    - Key: stickiness.lb_cookie.duration_seconds
      Value: 3600

Listener:
  Port: 443
  Protocol: HTTPS
  DefaultActions:
    - Type: forward
      TargetGroupArn: !Ref TargetGroup

# Idle timeout (max: 4000 seconds)
LoadBalancerAttributes:
  - Key: idle_timeout.timeout_seconds
    Value: 120 # 2 minutes for REST
```

---

## 5. Frontend Integration (React/Next.js)

### 5.1 Download Hook

```typescript
// hooks/useDownload.ts
import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

interface DownloadState {
  jobId: string | null;
  status: "idle" | "queued" | "processing" | "completed" | "failed";
  progress: number;
  downloadUrl: string | null;
  error: string | null;
}

export function useDownload() {
  const [state, setState] = useState<DownloadState>({
    jobId: null,
    status: "idle",
    progress: 0,
    downloadUrl: null,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Initiate download
  const startDownload = async (fileId: number) => {
    try {
      const response = await fetch("/v1/download/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error.message);
      }

      const { job_id, websocket_url, polling_interval } = data.data;

      setState({
        jobId: job_id,
        status: "queued",
        progress: 0,
        downloadUrl: null,
        error: null,
      });

      // Try WebSocket first
      connectWebSocket(websocket_url, job_id);

      // Fallback to polling after 5 seconds if WS fails
      setTimeout(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          startPolling(job_id, polling_interval);
        }
      }, 5000);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }));
    }
  };

  // WebSocket connection
  const connectWebSocket = (url: string, jobId: string) => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        // Stop polling if it started
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleStatusUpdate(message);
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        // Fallback to polling
        startPolling(jobId, 2000);
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        wsRef.current = null;
      };
    } catch (error) {
      console.error("Failed to connect WebSocket:", error);
      startPolling(jobId, 2000);
    }
  };

  // Polling fallback
  const startPolling = (jobId: string, interval: number) => {
    if (pollingRef.current) return; // Already polling

    console.log("Starting polling fallback");

    pollingRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/v1/download/status/${jobId}`);
        const data = await response.json();

        if (data.success) {
          handleStatusUpdate(data.data);

          // Stop polling when done
          if (["completed", "failed"].includes(data.data.status)) {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          }
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    }, interval);
  };

  // Handle status updates (from WS or polling)
  const handleStatusUpdate = (update: any) => {
    setState((prev) => ({
      ...prev,
      status: update.status,
      progress: update.progress || prev.progress,
      downloadUrl: update.download_url || prev.downloadUrl,
      error: update.error?.message || null,
    }));
  };

  // Download file
  const downloadFile = async () => {
    if (!state.jobId || state.status !== "completed") return;

    try {
      const response = await fetch(`/v1/download/${state.jobId}`);
      const data = await response.json();

      if (data.success) {
        // Trigger download
        window.location.href = data.data.download_url;
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: "Failed to download file",
      }));
    }
  };

  // Retry failed download
  const retry = () => {
    if (state.jobId) {
      setState({
        jobId: null,
        status: "idle",
        progress: 0,
        downloadUrl: null,
        error: null,
      });
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  return {
    state,
    startDownload,
    downloadFile,
    retry,
  };
}
```

### 5.2 Download Component

```typescript
// components/DownloadButton.tsx
import React from 'react';
import { useDownload } from '../hooks/useDownload';

export function DownloadButton({ fileId }: { fileId: number }) {
  const { state, startDownload, downloadFile, retry } = useDownload();

  const renderContent = () => {
    switch (state.status) {
      case 'idle':
        return (
          <button
            onClick={() => startDownload(fileId)}
            className="btn-primary"
          >
            Download File
          </button>
        );

      case 'queued':
        return (
          <div className="download-status">
            <div className="spinner" />
            <span>Queued...</span>
          </div>
        );

      case 'processing':
        return (
          <div className="download-status">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <span>{state.progress}% Complete</span>
          </div>
        );

      case 'completed':
        return (
          <button
            onClick={downloadFile}
            className="btn-success"
          >
            Download Ready! Click to Download
          </button>
        );

      case 'failed':
        return (
          <div className="download-error">
            <span className="error-message">{state.error}</span>
            <button onClick={retry} className="btn-retry">
              Retry
            </button>
          </div>
        );
    }
  };

  return (
    <div className="download-container">
      {renderContent()}
    </div>
  );
}
```

### 5.3 Advanced Features

#### Multiple Downloads

```typescript
// hooks/useMultipleDownloads.ts
export function useMultipleDownloads() {
  const [downloads, setDownloads] = useState<Map<string, DownloadState>>(
    new Map(),
  );

  const startDownload = async (fileId: number) => {
    const jobId = await initiateDownload(fileId);
    setDownloads((prev) => new Map(prev).set(jobId, initialState));
  };

  const cancelDownload = async (jobId: string) => {
    await fetch(`/v1/download/${jobId}`, { method: "DELETE" });
    setDownloads((prev) => {
      const next = new Map(prev);
      next.delete(jobId);
      return next;
    });
  };

  return { downloads, startDownload, cancelDownload };
}
```

#### Retry with Exponential Backoff

```typescript
async function retryWithBackoff(
  fn: () => Promise<any>,
  maxAttempts = 3,
  baseDelay = 1000,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;

      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
```

#### Persist State (Local Storage)

```typescript
// Persist download state across page refreshes
useEffect(() => {
  if (state.jobId && state.status !== "idle") {
    localStorage.setItem("activeDownload", JSON.stringify(state));
  }
}, [state]);

// Restore on mount
useEffect(() => {
  const saved = localStorage.getItem("activeDownload");
  if (saved) {
    const state = JSON.parse(saved);
    if (!["completed", "failed"].includes(state.status)) {
      // Resume monitoring
      startPolling(state.jobId, 2000);
    }
  }
}, []);
```

---

## 6. Scalability & Cost Considerations

### 6.1 Scaling Strategy

| Component       | Scaling Strategy                         | Cost       |
| --------------- | ---------------------------------------- | ---------- |
| **API Servers** | Horizontal auto-scaling (3-20 instances) | Medium     |
| **Workers**     | Horizontal scaling (5-50 workers)        | Medium     |
| **Redis**       | Redis Cluster or AWS ElastiCache         | Low-Medium |
| **S3**          | Auto-scales, lifecycle policies          | Low        |
| **PostgreSQL**  | Vertical scaling + read replicas         | Medium     |

### 6.2 Cost Optimization

1. **S3 Lifecycle Policies**

```javascript
// Auto-delete files after 24 hours
{
  "Rules": [{
    "Id": "DeleteAfter24Hours",
    "Status": "Enabled",
    "Prefix": "downloads/",
    "Expiration": {
      "Days": 1
    }
  }]
}
```

2. **Redis Memory Optimization**

```
# Eviction policy for cache
maxmemory-policy allkeys-lru
maxmemory 2gb
```

3. **Worker Concurrency**

```typescript
// Optimize based on CPU cores
const concurrency = Math.max(os.cpus().length - 1, 1);
```

### 6.3 Monitoring & Alerts

```typescript
// Key metrics to track
const metrics = {
  // Queue health
  "queue.size": await downloadQueue.count(),
  "queue.waiting": await downloadQueue.getWaitingCount(),
  "queue.active": await downloadQueue.getActiveCount(),
  "queue.failed": await downloadQueue.getFailedCount(),

  // Job performance
  "job.duration.p50": await getP50Duration(),
  "job.duration.p95": await getP95Duration(),
  "job.duration.p99": await getP99Duration(),
  "job.success_rate": await getSuccessRate(),

  // System health
  "redis.memory": await redis.info("memory"),
  "workers.active": await getActiveWorkers(),
  "s3.storage": await getS3StorageSize(),
};

// Alerts
if (metrics["queue.waiting"] > 1000) {
  alert("Queue backlog detected - scale workers");
}

if (metrics["job.success_rate"] < 0.95) {
  alert("Job success rate below threshold");
}
```

---

## 7. Security Considerations

### 7.1 Authentication & Authorization

```typescript
// Middleware for auth
async function authenticateRequest(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = await verifyToken(token);
  req.user = user;
  next();
}

// Check if user owns the job
async function authorizeJob(req, res, next) {
  const { jobId } = req.params;
  const job = await getJobMetadata(jobId);

  if (job.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}
```

### 7.2 Rate Limiting

```typescript
import rateLimit from "express-rate-limit";

const downloadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: "Too many download requests",
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/v1/download/initiate", downloadLimiter, initiateDownload);
```

### 7.3 Input Validation

```typescript
import Joi from "joi";

const initiateSchema = Joi.object({
  file_id: Joi.number().integer().positive().required(),
  priority: Joi.string().valid("low", "normal", "high").default("normal"),
  user_id: Joi.string().max(100).required(),
});
```

### 7.4 Presigned URL Security

```typescript
// Short expiry times
const expirySeconds = 900; // 15 minutes

// Restrict to specific IP (optional)
const params = {
  Bucket: "downloads",
  Key: s3Key,
  Expires: expirySeconds,
  ResponseContentDisposition: `attachment; filename="${fileName}"`,
};

const url = s3.getSignedUrl("getObject", params);
```

---

## 8. Testing Strategy

### 8.1 Load Testing

```javascript
// k6 load test script
import http from "k6/http";
import { check, sleep } from "k6";

export let options = {
  stages: [
    { duration: "2m", target: 100 }, // Ramp up to 100 users
    { duration: "5m", target: 100 }, // Stay at 100 users
    { duration: "2m", target: 0 }, // Ramp down
  ],
};

export default function () {
  // Initiate download
  let res = http.post("http://api.example.com/v1/download/initiate", {
    file_id: 70000,
  });

  check(res, {
    "status is 200": (r) => r.status === 200,
    "has job_id": (r) => r.json("data.job_id") !== null,
  });

  const jobId = res.json("data.job_id");

  // Poll until complete
  let completed = false;
  while (!completed) {
    sleep(2);

    res = http.get(`http://api.example.com/v1/download/status/${jobId}`);
    const status = res.json("data.status");

    if (status === "completed" || status === "failed") {
      completed = true;
    }
  }
}
```

---

## 9. Deployment Architecture

### 9.1 Docker Compose (Development)

```yaml
version: "3.8"

services:
  api:
    build: ./api
    ports:
      - "3000:3000"
    environment:
      - REDIS_HOST=redis
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/downloads
      - AWS_S3_BUCKET=downloads-dev
    depends_on:
      - redis
      - postgres

  worker:
    build: ./api
    command: npm run worker
    environment:
      - REDIS_HOST=redis
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/downloads
    depends_on:
      - redis
    deploy:
      replicas: 3

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=downloads
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  redis_data:
  postgres_data:
```

### 9.2 Kubernetes (Production)

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: download-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: download-api
  template:
    metadata:
      labels:
        app: download-api
    spec:
      containers:
        - name: api
          image: download-api:latest
          ports:
            - containerPort: 3000
          env:
            - name: REDIS_HOST
              value: redis-service
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: download-worker
spec:
  replicas: 5
  selector:
    matchLabels:
      app: download-worker
  template:
    metadata:
      labels:
        app: download-worker
    spec:
      containers:
        - name: worker
          image: download-api:latest
          command: ["npm", "run", "worker"]
          env:
            - name: REDIS_HOST
              value: redis-service
          resources:
            requests:
              cpu: "1000m"
              memory: "1Gi"
            limits:
              cpu: "2000m"
              memory: "2Gi"

---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: download-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: download-worker
  minReplicas: 5
  maxReplicas: 50
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

---

## 10. Migration Path (Existing to New Architecture)

### Phase 1: Parallel Implementation (Week 1-2)

1. Deploy new async endpoints alongside existing sync endpoints
2. Keep existing `/download/start` working
3. Add new `/download/initiate`, `/download/status/:jobId`

### Phase 2: Gradual Migration (Week 3-4)

1. Update frontend to use new async API
2. Monitor both systems in parallel
3. Gradually route traffic to new system (10% → 50% → 100%)

### Phase 3: Deprecation (Week 5-6)

1. Mark old endpoints as deprecated
2. Send warnings to clients still using old API
3. Complete migration and remove old code

---

## 11. Conclusion

This hybrid architecture provides:

✅ **Reliability**: Handles timeouts gracefully with polling fallback  
✅ **Performance**: Real-time updates via WebSocket  
✅ **Scalability**: Horizontal scaling of workers and API servers  
✅ **User Experience**: Progress indicators and instant feedback  
✅ **Cost Efficiency**: Auto-cleanup, optimized storage, efficient queuing  
✅ **Security**: Rate limiting, auth, presigned URLs  
✅ **Observability**: Comprehensive monitoring and alerting

### Key Takeaways

1. **Never hold HTTP connections open for long operations**
2. **Use job queues for async processing**
3. **Provide real-time feedback (WebSocket) with polling fallback**
4. **Generate presigned URLs for direct downloads**
5. **Implement proper retry logic and error handling**
6. **Monitor queue health and job metrics**
7. **Auto-cleanup temporary files to control costs**

This architecture is production-ready and battle-tested for handling variable-length downloads at scale.
