import React from "react";
import * as Sentry from "@sentry/react";

export default function ErrorButton() {
  return (
    <button
      onClick={() => {
        Sentry.captureException(new Error("This is your first error!"));
      }}
    >
      Break the world
    </button>
  );
}
