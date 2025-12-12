import React, { useState, useEffect, useRef } from "react";
import * as Sentry from "@sentry/react";
import { initiateDownloads, startDownload, checkDownload } from "./api";
import ErrorButton from "./components/ErrorButton.jsx";

function useInterval(callback, delay) {
  const savedRef = useRef();
  useEffect(() => {
    savedRef.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delay == null) return;
    const id = setInterval(() => savedRef.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

const DEFAULT_POLL_INTERVAL = 5000;

export default function App() {
  const [input, setInput] = useState("10000");
  const [inputError, setInputError] = useState(null);
  const [items, setItems] = useState([]); // { fileId, status, jobId?, message, progress, attempts }
  const [job, setJob] = useState(null);
  const [isInitiating, setIsInitiating] = useState(false);

  const addItem = (fileId) => {
    setItems((s) => {
      if (s.find((x) => x.fileId === fileId)) return s;
      return [
        ...s,
        {
          fileId,
          status: "idle",
          message: null,
          progress: 0,
          attempts: 0,
          lastResponse: null,
        },
      ];
    });
  };

  const handleAdd = () => {
    const tokens = input
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      const msg = "Please enter at least one file id";
      setInputError(msg);
      try {
        Sentry.withScope((scope) => {
          scope.setExtra("input", input);
          scope.setTag("validation", "empty_input");
          Sentry.captureException(new Error(msg));
        });
      } catch (e) {
        // ignore capture failures in dev
      }
      return;
    }

    // Validate tokens are strictly numeric integers
    const invalid = tokens.filter((t) => !/^\d+$/.test(t));
    if (invalid.length > 0) {
      const msg = `Invalid file id(s): ${invalid.join(", ")}`;
      setInputError(msg);
      try {
        Sentry.withScope((scope) => {
          scope.setExtra("input_tokens", tokens);
          scope.setExtra("invalid_tokens", invalid);
          scope.setTag("validation", "non_numeric");
          Sentry.captureException(new Error(msg));
        });
      } catch (e) {
        // ignore capture failures in dev
      }
      return;
    }

    const ids = tokens.map((s) => Number(s));
    ids.forEach(addItem);
    setInput("");
    setInputError(null);
  };

  const handleInitiate = async () => {
    if (items.length === 0) return;
    setIsInitiating(true);
    try {
      const res = await initiateDownloads(items.map((i) => i.fileId));
      setJob(res.jobId);
      setItems((s) =>
        s.map((it) => ({
          ...it,
          status: "queued",
          lastResponse: JSON.stringify(res, null, 2),
        })),
      );
    } catch (err) {
      console.error(err);
      alert("Initiate failed: " + String(err.message));
    } finally {
      setIsInitiating(false);
    }
  };

  // Start download for a given fileId with retry & fallback polling
  const handleStart = async (fileId) => {
    setItems((s) =>
      s.map((it) =>
        it.fileId === fileId
          ? {
              ...it,
              status: "starting",
              message: null,
              attempts: it.attempts + 1,
            }
          : it,
      ),
    );

    // prepare abort controller for fetch timeout
    const controller = new AbortController();
    const timeoutMs = 60_000; // 60s client-side timeout
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await startDownload(fileId, { signal: controller.signal });
      clearTimeout(timer);
      if (res.status === "completed") {
        setItems((s) =>
          s.map((it) =>
            it.fileId === fileId
              ? {
                  ...it,
                  status: "completed",
                  message: res.message ?? "Completed",
                  downloadUrl: res.downloadUrl,
                  size: res.size,
                  lastResponse: JSON.stringify(res, null, 2),
                }
              : it,
          ),
        );
        return;
      }
      // If server returned a failed status, show that
      setItems((s) =>
        s.map((it) =>
          it.fileId === fileId
            ? {
                ...it,
                status: "failed",
                message: res.message ?? "Failed on server",
                lastResponse: JSON.stringify(res, null, 2),
              }
            : it,
        ),
      );
    } catch (err) {
      clearTimeout(timer);
      console.warn("startDownload error, falling back to polling:", err);
      // fallback: poll /v1/download/check until available or max attempts
      pollUntilAvailable(fileId);
    }
  };

  // Polling with exponential backoff retries for initiating start again
  const pollUntilAvailable = (fileId) => {
    const maxPolls = 36; // 36 * 5s = 180s
    let polls = 0;

    setItems((s) =>
      s.map((it) =>
        it.fileId === fileId
          ? {
              ...it,
              status: "polling",
              message: "Waiting for availability (polling)...",
            }
          : it,
      ),
    );

    const intervalId = setInterval(async () => {
      polls += 1;
      try {
        const res = await checkDownload(fileId);
        if (res.available) {
          clearInterval(intervalId);
          setItems((s) =>
            s.map((it) =>
              it.fileId === fileId
                ? {
                    ...it,
                    status: "available",
                    message: "File available",
                    s3Key: res.s3Key,
                    size: res.size,
                  }
                : it,
            ),
          );
        } else if (polls >= maxPolls) {
          clearInterval(intervalId);
          setItems((s) =>
            s.map((it) =>
              it.fileId === fileId
                ? {
                    ...it,
                    status: "failed",
                    message: "Timed out waiting for availability",
                  }
                : it,
            ),
          );
        } else {
          // update a simple progress indicator
          setItems((s) =>
            s.map((it) =>
              it.fileId === fileId
                ? { ...it, progress: Math.min(95, it.progress + 5) }
                : it,
            ),
          );
        }
      } catch (err) {
        console.error("Polling error", err);
        // keep polling; optionally track attempts
        if (polls >= maxPolls) {
          clearInterval(intervalId);
          setItems((s) =>
            s.map((it) =>
              it.fileId === fileId
                ? { ...it, status: "failed", message: "Polling failed" }
                : it,
            ),
          );
        }
      }
    }, DEFAULT_POLL_INTERVAL);
  };

  const handleCheck = async (fileId) => {
    setItems((s) =>
      s.map((it) =>
        it.fileId === fileId
          ? { ...it, status: "checking", message: null }
          : it,
      ),
    );
    try {
      const res = await checkDownload(fileId);
      setItems((s) =>
        s.map((it) =>
          it.fileId === fileId
            ? {
                ...it,
                status: res.available ? "available" : "not_found",
                message: res.available ? "Available" : "Not available",
                s3Key: res.s3Key,
                size: res.size,
                lastResponse: JSON.stringify(res, null, 2),
              }
            : it,
        ),
      );
    } catch (err) {
      setItems((s) =>
        s.map((it) =>
          it.fileId === fileId
            ? {
                ...it,
                status: "error",
                message: String(err.message),
                lastResponse: String(err.message),
              }
            : it,
        ),
      );
    }
  };

  const handleRetry = (fileId) => {
    // allow retrying start
    handleStart(fileId);
  };

  return (
    <div className="container">
      <h1>Delineate — Downloads</h1>
      <div className="controls">
        <input
          className={inputError ? "input-invalid" : ""}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (inputError) setInputError(null);
          }}
          placeholder="Enter file IDs (comma or space separated)"
        />
        <button onClick={handleAdd}>Add</button>
        <button
          onClick={handleInitiate}
          disabled={isInitiating || items.length === 0}
        >
          Initiate downloads
        </button>
        {inputError ? <div className="input-error">{inputError}</div> : null}
      </div>

      <div className="job">
        <strong>Job:</strong> {job ?? "—"}
      </div>

      <div className="list">
        {items.map((it) => (
          <div key={it.fileId} className="item">
            <div className="meta">
              <div className="id">ID: {it.fileId}</div>
              <div className={`status status-${it.status}`}>{it.status}</div>
              <div className="message">{it.message}</div>
            </div>
            <div className="actions">
              <button
                onClick={() => handleStart(it.fileId)}
                disabled={
                  it.status === "starting" ||
                  it.status === "polling" ||
                  it.status === "completed"
                }
              >
                Start
              </button>
              <button onClick={() => handleCheck(it.fileId)}>Check</button>
              <button
                onClick={() => handleRetry(it.fileId)}
                disabled={it.attempts >= 3}
              >
                Retry
              </button>
              {it.downloadUrl ? (
                <a
                  className="download-link"
                  href={it.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </a>
              ) : null}
            </div>
            <div className="progress">
              <div className="bar" style={{ width: `${it.progress}%` }} />
            </div>
            {it.lastResponse ? (
              <details className="raw-response">
                <summary>Backend response</summary>
                <pre>{it.lastResponse}</pre>
              </details>
            ) : null}
          </div>
        ))}
      </div>

      <section className="tutorial">
        <h2>Getting started</h2>
        <div className="tutorial-grid">
          <div className="tutorial-card">
            <h3>1. Add file IDs</h3>
            <p>
              Type one or more numeric file IDs (comma or space separated) and
              click <strong>Add</strong>.
            </p>
          </div>
          <div className="tutorial-card">
            <h3>2. Initiate job</h3>
            <p>
              Click <strong>Initiate downloads</strong> to create a server-side
              job (returns a jobId).
            </p>
          </div>
          <div className="tutorial-card">
            <h3>3. Start & Monitor</h3>
            <p>
              Use <strong>Start</strong> to begin processing a file. Long runs
              fallback to polling and show progress here.
            </p>
          </div>
          <div className="tutorial-card">
            <h3>4. Get the file</h3>
            <p>
              When ready you'll see a <strong>Download</strong> link. Click it
              to get the file.
            </p>
          </div>
        </div>
        <details className="tutorial-more">
          <summary>More tips</summary>
          <ul>
            <li>
              Invalid input (non-numeric) will show an inline error and is
              reported to Sentry.
            </li>
            <li>
              Backend endpoints: <code>/v1/download/initiate</code>,{" "}
              <code>/v1/download/check</code>, <code>/v1/download/start</code>.
            </li>
            <li>
              If you run into blocked Sentry requests, try disabling adblock or
              preview the production build.
            </li>
          </ul>
        </details>
      </section>
      <footer>
        <small>
          Note: This frontend talks to backend endpoints at the same origin. Run
          backend on http://localhost:3000
        </small>
      </footer>
    </div>
  );
}
