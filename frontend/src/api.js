// Use Vite environment variable VITE_API_BASE if set, otherwise:
// - in dev (vite) talk directly to the backend on localhost:3000
// - in production builds use relative URLs so the browser hits the same origin
//   (nginx will proxy /v1 to the backend container in docker-compose)
import * as Sentry from '@sentry/react'

const BASE_URL = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:3000' : '')

const jsonHeaders = { 'Content-Type': 'application/json' }

async function captureApiError(name, url, status, body) {
  try {
    Sentry.withScope((scope) => {
      scope.setTag('api', name)
      scope.setExtra('url', url)
      scope.setExtra('status', status)
      if (body) scope.setExtra('body', body)
      Sentry.captureException(new Error(`${name} failed with status ${status}`))
    })
  } catch (e) {
    // swallow
  }
}

export async function initiateDownloads(fileIds) {
  const url = `${BASE_URL}/v1/download/initiate`.replace(/([^:]\/\/)\/+/, '$1')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ file_ids: fileIds }),
    })
    if (!res.ok) {
      let text = null
      try {
        text = await res.text()
      } catch {}
      await captureApiError('initiateDownloads', url, res.status, text)
      throw new Error(`Initiate failed: ${res.status}`)
    }
    return res.json()
  } catch (err) {
    // network or other errors
    try {
      Sentry.captureException(err)
    } catch {}
    throw err
  }
}

export async function startDownload(fileId, { signal } = {}) {
  const url = `${BASE_URL}/v1/download/start`.replace(/([^:]\/\/)\/+/, '$1')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ file_id: fileId }),
      signal,
    })
    if (!res.ok) {
      let text = null
      try {
        text = await res.text()
      } catch {}
      await captureApiError('startDownload', url, res.status, text)
      throw new Error(`Start failed: ${res.status}`)
    }
    return res.json()
  } catch (err) {
    try { Sentry.captureException(err) } catch {}
    throw err
  }
}

export async function checkDownload(fileId) {
  const url = `${BASE_URL}/v1/download/check`.replace(/([^:]\/\/)\/+/, '$1')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ file_id: fileId }),
    })
    if (!res.ok) {
      let text = null
      try { text = await res.text() } catch {}
      await captureApiError('checkDownload', url, res.status, text)
      throw new Error(`Check failed: ${res.status}`)
    }
    return res.json()
  } catch (err) {
    try { Sentry.captureException(err) } catch {}
    throw err
  }
}
