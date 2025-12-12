import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import * as Sentry from "@sentry/react";

// Initialize Sentry only when a DSN is provided and we're not in dev mode.
// This avoids blocked network requests (eg. adblockers) cluttering the browser
// console during local development. Set VITE_SENTRY_DSN in production if you
// want Sentry enabled.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || "";
const ENABLE_IN_DEV =
  String(import.meta.env.VITE_SENTRY_ENABLE_IN_DEV || "").toLowerCase() ===
  "true";

if (SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      sendDefaultPii: true,
      // beforeSend lets us drop events in dev unless explicitly enabled
      beforeSend(event) {
        // If running Vite dev and the flag isn't set, drop events
        if (import.meta.env.DEV && !ENABLE_IN_DEV) return null;
        // Runtime override: set window.__SENTRY_DONT_SEND = true in the console
        if (window.__SENTRY_DONT_SEND) return null;
        return event;
      },
    });
  } catch (e) {
    // If initialization fails, don't block app startup.
    // eslint-disable-next-line no-console
    console.info("Sentry init skipped or failed:", e);
  }
} else {
  // eslint-disable-next-line no-console
  console.info("Sentry disabled - no DSN provided");
}

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={"An unexpected error occurred"}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);

// Global error handlers to capture uncaught exceptions and unhandled promise rejections
if (SENTRY_DSN) {
  window.addEventListener("error", (event) => {
    try {
      // event.error may be undefined for some errors; capture message then
      Sentry.captureException(
        event.error || new Error(String(event.message || "Unknown error")),
      );
    } catch (e) {
      // ignore
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason || new Error("Unhandled promise rejection");
      Sentry.captureException(reason);
    } catch (e) {
      // ignore
    }
  });
}
