# System Architecture

This document describes the current architecture of the Delineate Hackathon Challenge application, based on the codebase and Docker configuration.

## Architecture Diagram

```mermaid
graph TD
    %% User and Client
    User[User] -->|Interacts with| Browser[Web Browser]

    %% Frontend
    subgraph "Frontend Layer"
        Frontend[delineate-frontend]
        Browser -->|HTTP/80| Frontend
    end

    %% Backend
    subgraph "Backend Layer"
        Backend[delineate-app]
        Browser -->|HTTP/3000 API Requests| Backend
    end

    %% Storage
    subgraph "Storage Layer"
        RustFS[delineate-storage]
        Backend -->|S3 Protocol/9000| RustFS
        StorageInit[delineate-storage-init] -.->|Init Bucket| RustFS
    end

    %% Observability
    subgraph "Observability Layer"
        Jaeger[delineate-jaeger]
        Prometheus[delineate-prometheus]

        Backend -->|OTLP Traces/4318| Jaeger
        Prometheus -->|Scrape Metrics/3000| Backend
    end

    %% Styles
    style User fill:#f9f,stroke:#333,stroke-width:2px
    style Backend fill:#d4e1f5,stroke:#333,stroke-width:2px
    style Frontend fill:#d4e1f5,stroke:#333,stroke-width:2px
    style RustFS fill:#ffe6cc,stroke:#333,stroke-width:2px
```

## Component Overview

| Service                  | Type       | Tech Stack    | Description                                                                                             |
| ------------------------ | ---------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| **delineate-frontend**   | Frontend   | React, Vite   | Serves the user interface. Accessible on port `80` (Prod) or `5173` (Dev).                              |
| **delineate-app**        | Backend    | Node.js, Hono | Main API server. Handles download requests and simulates long-running tasks. Accessible on port `3000`. |
| **delineate-storage**    | Storage    | RustFS        | S3-compatible object storage for saving files.                                                          |
| **delineate-jaeger**     | Tracing    | Jaeger        | Collects and visualizes distributed traces via OTLP.                                                    |
| **delineate-prometheus** | Monitoring | Prometheus    | Scrapes metrics from the backend for monitoring.                                                        |

> [!NOTE]
> This architecture reflects the current implementation found in `docker/compose.*.yml` and `src/`. It differs from the design in `ARCHITECTURE.md` (which mentions Redis, BullMQ, and Postgres) as those components are not currently present in the Docker configuration or project dependencies.
