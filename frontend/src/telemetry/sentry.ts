import * as Sentry from '@sentry/react';

export const initSentry = () => {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN || '',
    environment: import.meta.env.MODE,
    integrations: [
      new Sentry.BrowserTracing({
        // Set tracing origins to connect frontend and backend traces
        tracePropagationTargets: ['localhost', /^https:\/\/yourserver\.io\/api/],
      }),
      new Sentry.Replay(),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0,
    // Session Replay
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      // Add trace ID to Sentry events for correlation
      const traceId = Sentry.getCurrentHub().getScope()?.getSpan()?.spanContext().traceId;
      if (traceId) {
        event.tags = { ...event.tags, trace_id: traceId };
      }
      return event;
    },
  });
};

export const captureError = (error: Error, context?: Record<string, any>) => {
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }
    Sentry.captureException(error);
  });
};

export const addBreadcrumb = (message: string, category: string, data?: Record<string, any>) => {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: 'info',
  });
};