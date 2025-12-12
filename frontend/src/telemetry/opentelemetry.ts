import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

let provider: WebTracerProvider;

export const initOpenTelemetry = () => {
  try {
    // Create a tracer provider
    provider = new WebTracerProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'observability-dashboard',
        [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
      }),
    });

    // Create and configure the OTLP exporter
    const exporter = new OTLPTraceExporter({
      url: import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
    });

    // Add the batch span processor
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));

    // Register the provider
    provider.register();

    // Register auto-instrumentations
    registerInstrumentations({
      instrumentations: [
        getWebAutoInstrumentations({
          '@opentelemetry/instrumentation-fetch': {
            propagateTraceHeaderCorsUrls: [
              /^http:\/\/localhost:3000\/.*/,
              /^https:\/\/yourserver\.io\/.*/,
            ],
          },
        }),
      ],
    });

    console.log('OpenTelemetry initialized successfully');
  } catch (error) {
    console.warn('Failed to initialize OpenTelemetry:', error);
  }
};

export const tracer = trace.getTracer('observability-dashboard');

export const createSpan = (name: string, fn: () => Promise<any> | any) => {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
};

export const getCurrentTraceId = (): string | undefined => {
  const activeSpan = trace.getActiveSpan();
  return activeSpan?.spanContext().traceId;
};

export const addSpanEvent = (name: string, attributes?: Record<string, any>) => {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.addEvent(name, attributes);
  }
};

export const setSpanAttribute = (key: string, value: string | number | boolean) => {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttribute(key, value);
  }
};