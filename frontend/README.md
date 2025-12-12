# Delineate Frontend (minimal)

This is a simple React + Vite frontend for interacting with the Delineate backend API.

Features implemented:
- Initiate download jobs (POST /v1/download/initiate)
- Start a download for a single file (POST /v1/download/start)
- Check availability (POST /v1/download/check)
- Progress and polling fallback when start times out
- Retry logic (limited attempts)

Run locally:

```bash
cd frontend
npm install
npm run dev
```

By default the frontend assumes the backend is available on the same origin (http://localhost:3000). Use a proxy or run backend on that host/port.

Notes:
- This is intentionally minimal and meant for local development and demos.
- You can extend it to support websockets, SSE, or direct presigned URLs for production.
