# Observability Dashboard

A React-based observability dashboard that integrates with Sentry for error tracking and OpenTelemetry for distributed tracing, providing visibility into the download service's health and performance.

## Features

### 🔍 **Sentry Integration**
- Error boundary wrapping the entire app
- Automatic error capture for failed API calls
- User feedback dialog on errors
- Performance monitoring for page loads
- Custom error logging for business logic errors

### 📊 **OpenTelemetry Integration**
- Trace propagation from frontend to backend
- Custom spans for user interactions
- Correlation of frontend and backend traces
- Display trace IDs in the UI for debugging

### 📈 **Dashboard Features**
- **Health Status**: Real-time API health from `/health` endpoint
- **Download Jobs**: List of initiated downloads with status
- **Error Log**: Recent errors captured by Sentry
- **Trace Viewer**: Link to Jaeger UI or embedded trace view
- **Performance Metrics**: API response times, success/failure rates

## Getting Started

### Prerequisites
- Node.js 18+ 
- Backend API running on `http://localhost:3000`
- (Optional) Sentry project for error tracking
- (Optional) Jaeger for trace visualization

### Installation

1. **Install dependencies**:
   ```bash
   cd frontend
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your Sentry DSN and other configurations
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```

4. **Open browser**:
   Navigate to `http://localhost:5173`

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_SENTRY_DSN` | Sentry project DSN for error tracking | (empty) |
| `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector endpoint | `http://localhost:4318/v1/traces` |
| `VITE_API_BASE_URL` | Backend API base URL | `http://localhost:3000` |

### Sentry Setup

1. Create a Sentry project at [sentry.io](https://sentry.io)
2. Copy your DSN to `VITE_SENTRY_DSN` in `.env`
3. Errors will automatically be captured and sent to Sentry

### OpenTelemetry Setup

The dashboard automatically instruments:
- Fetch requests to the backend API
- User interactions (button clicks, navigation)
- Custom spans for business logic

Traces are exported to the configured OTLP endpoint (Jaeger by default).

## Usage

### Testing Sentry Integration

Use the "Test Sentry" button in the dashboard header to trigger an intentional error:

```bash
curl -X POST "http://localhost:3000/v1/download/check?sentry_test=true" \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'
```

### End-to-End Traceability

The dashboard ensures complete traceability:

1. User clicks "Download" button
2. Frontend creates span with trace-id: `abc123`
3. API request includes header: `traceparent: 00-abc123-...`
4. Backend logs include: `trace_id=abc123`
5. Errors in Sentry tagged with: `trace_id=abc123`

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React App     │───▶│   Backend API   │───▶│   Sentry        │
│                 │    │                 │    │                 │
│ • Error Boundary│    │ • Download Jobs │    │ • Error Tracking│
│ • Trace Context │    │ • Health Check  │    │ • Performance   │
│ • Performance   │    │ • Error Testing │    │ • User Feedback │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│  OpenTelemetry  │    │     Jaeger      │
│                 │    │                 │
│ • Trace Export  │    │ • Trace Storage │
│ • Span Creation │    │ • Visualization │
│ • Context Prop. │    │ • Query Interface│
└─────────────────┘    └─────────────────┘
```

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

### Project Structure

```
frontend/
├── src/
│   ├── components/          # React components
│   │   ├── Dashboard.tsx    # Main dashboard
│   │   ├── ErrorBoundary.tsx# Error boundary wrapper
│   │   ├── HealthStatus.tsx # API health monitoring
│   │   ├── DownloadJobs.tsx # Download job management
│   │   ├── ErrorLog.tsx     # Error log viewer
│   │   ├── PerformanceMetrics.tsx # Performance charts
│   │   └── TraceViewer.tsx  # Trace visualization
│   ├── services/
│   │   └── api.ts          # API client with telemetry
│   ├── telemetry/
│   │   ├── sentry.ts       # Sentry configuration
│   │   └── opentelemetry.ts# OpenTelemetry setup
│   ├── App.tsx             # Root component
│   ├── main.tsx            # Entry point
│   └── index.css           # Global styles
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## Troubleshooting

### Common Issues

1. **CORS errors**: Ensure backend has proper CORS configuration
2. **Traces not appearing**: Check OTLP endpoint configuration
3. **Sentry errors not captured**: Verify DSN configuration
4. **Performance issues**: Check network tab for failed requests

### Debug Mode

Enable debug logging by setting:
```javascript
// In browser console
localStorage.setItem('debug', 'sentry:*,otel:*');
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.