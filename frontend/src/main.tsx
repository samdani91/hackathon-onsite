import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Initialize telemetry
import { initSentry } from './telemetry/sentry';
import { initOpenTelemetry } from './telemetry/opentelemetry';

// Initialize Sentry first
initSentry();

// Initialize OpenTelemetry
initOpenTelemetry();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);