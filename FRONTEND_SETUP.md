# Observability Dashboard Setup Guide

This guide will help you set up the React-based observability dashboard that integrates with Sentry and OpenTelemetry.

## 🚀 Quick Start

### Option 1: Automated Setup
```bash
# Install backend dependencies
npm install

# Setup and install frontend
npm run frontend:setup

# Start both backend and frontend
npm run dev:full
```

### Option 2: Manual Setup
```bash
# 1. Install backend dependencies
npm install

# 2. Setup frontend
cd frontend
npm install
cp .env.example .env

# 3. Start backend (in one terminal)
npm run dev

# 4. Start frontend (in another terminal)
cd frontend
npm run dev
```

## 📋 Prerequisites

- **Node.js 18+** - Required for both backend and frontend
- **Backend API** - Must be running on `http://localhost:3000`
- **Sentry Account** (Optional) - For error tracking
- **Jaeger** (Optional) - For trace visualization

## 🔧 Configuration

### Environment Variables

Edit `frontend/.env` with your configuration:

```env
# Sentry Configuration (optional)
VITE_SENTRY_DSN=your_sentry_dsn_here

# OpenTelemetry Configuration
VITE_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

# API Configuration
VITE_API_BASE_URL=http://localhost:3000
```

### Sentry Setup (Optional)

1. **Create Sentry Project**:
   - Go to [sentry.io](https://sentry.io)
   - Create a new React project
   - Copy the DSN

2. **Configure Frontend**:
   ```bash
   # Edit frontend/.env
   VITE_SENTRY_DSN=https://your-dsn@sentry.io/project-id
   ```

3. **Test Integration**:
   - Click "Test Sentry" button in dashboard
   - Check Sentry dashboard for captured error

### OpenTelemetry Setup (Optional)

1. **Start Jaeger** (for trace visualization):
   ```bash
   docker run -d \
     -p 16686:16686 \
     -p 14268:14268 \
     -p 4317:4317 \
     -p 4318:4318 \
     jaegertracing/all-in-one:latest
   ```

2. **Access Jaeger UI**:
   - Open `http://localhost:16686`
   - View traces from the dashboard

## 🎯 Features Overview

### Dashboard Tabs

1. **Health Status** 📊
   - Real-time API health monitoring
   - Uptime tracking
   - System information

2. **Download Jobs** 📥
   - Initiate new downloads
   - Monitor job status
   - Real-time updates

3. **Error Log** 🚨
   - Recent errors and warnings
   - Sentry integration
   - Error statistics

4. **Performance Metrics** 📈
   - Response time trends
   - Success/error rates
   - Throughput analysis

5. **Trace Viewer** 🔍
   - Distributed trace visualization
   - Jaeger integration
   - End-to-end correlation

### Key Integrations

#### Sentry Error Tracking
- ✅ Error boundary for React crashes
- ✅ Automatic API error capture
- ✅ User feedback dialogs
- ✅ Performance monitoring
- ✅ Custom error context

#### OpenTelemetry Tracing
- ✅ Frontend-to-backend trace propagation
- ✅ Custom spans for user interactions
- ✅ Trace ID correlation
- ✅ Automatic HTTP instrumentation

## 🧪 Testing

### Test Sentry Integration
```bash
# Method 1: Use dashboard button
# Click "Test Sentry" in the dashboard header

# Method 2: Direct API call
curl -X POST "http://localhost:3000/v1/download/check?sentry_test=true" \
  -H "Content-Type: application/json" \
  -d '{"file_id": 70000}'
```

### Test Download Flow
1. Go to "Download Jobs" tab
2. Enter a file ID (e.g., `12345`)
3. Click "Start Download"
4. Monitor job status updates
5. Check traces in Jaeger UI

### Test Error Handling
1. Enter invalid file ID (`abc`)
2. Observe error capture in Sentry
3. Check error correlation with trace ID

## 🔍 End-to-End Traceability

The dashboard provides complete request traceability:

```
User Action → Frontend Span → API Request → Backend Span → Database/S3
     ↓              ↓             ↓            ↓           ↓
Trace ID: abc123 → Headers → Logs → Sentry → Jaeger
```

### Correlation Flow
1. **User clicks "Download"** → Creates frontend span
2. **API request sent** → Includes `traceparent` header
3. **Backend processes** → Logs with trace ID
4. **Error occurs** → Sentry tagged with trace ID
5. **Trace complete** → Visible in Jaeger with full context

## 🐛 Troubleshooting

### Common Issues

**Frontend won't start**
```bash
# Check Node.js version
node -v  # Should be 18+

# Clear npm cache
npm cache clean --force
cd frontend && npm install
```

**API connection errors**
```bash
# Verify backend is running
curl http://localhost:3000/health

# Check CORS configuration in backend
# Ensure CORS_ORIGINS=* in backend .env
```

**Traces not appearing**
```bash
# Check OpenTelemetry endpoint
curl http://localhost:4318/v1/traces

# Verify Jaeger is running
curl http://localhost:16686
```

**Sentry errors not captured**
```bash
# Verify DSN configuration
echo $VITE_SENTRY_DSN

# Check browser console for Sentry errors
# Open DevTools → Console
```

### Debug Mode

Enable debug logging in browser console:
```javascript
localStorage.setItem('debug', 'sentry:*,otel:*');
// Reload page to see debug logs
```

## 📁 Project Structure

```
frontend/
├── src/
│   ├── components/          # React components
│   │   ├── Dashboard.tsx    # Main dashboard layout
│   │   ├── ErrorBoundary.tsx# Sentry error boundary
│   │   ├── HealthStatus.tsx # API health monitoring
│   │   ├── DownloadJobs.tsx # Job management
│   │   ├── ErrorLog.tsx     # Error visualization
│   │   ├── PerformanceMetrics.tsx # Charts & metrics
│   │   └── TraceViewer.tsx  # Trace visualization
│   ├── services/
│   │   └── api.ts          # API client with telemetry
│   ├── telemetry/
│   │   ├── sentry.ts       # Sentry configuration
│   │   └── opentelemetry.ts# OpenTelemetry setup
│   └── ...
├── package.json
├── vite.config.ts          # Vite configuration
├── tailwind.config.js      # Tailwind CSS config
└── README.md
```

## 🚀 Production Deployment

### Docker Build
```bash
cd frontend
docker build -t observability-dashboard .
docker run -p 80:80 observability-dashboard
```

### Environment Variables for Production
```env
VITE_SENTRY_DSN=https://your-production-dsn@sentry.io/project
VITE_OTEL_EXPORTER_OTLP_ENDPOINT=https://your-otel-collector/v1/traces
VITE_API_BASE_URL=https://your-api-domain.com
```

## 📚 Additional Resources

- [Sentry React Documentation](https://docs.sentry.io/platforms/javascript/guides/react/)
- [OpenTelemetry JavaScript Documentation](https://opentelemetry.io/docs/instrumentation/js/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [Vite Documentation](https://vitejs.dev/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

## 🤝 Support

If you encounter issues:

1. Check this troubleshooting guide
2. Review browser console for errors
3. Verify all services are running
4. Check environment configuration
5. Test with minimal configuration first

Happy monitoring! 🎉