// Thin fetch wrapper for the Voter Survey backend.
// JSON in, JSON out, ApiError on non-2xx. Auth comes from a provider the
// auth layer registers later (FE-1) — until then, requests go anonymous.

const DEFAULT_BASE_URL = '/api/v1';
const TIMEOUT_MS = 10_000;

export const BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
  DEFAULT_BASE_URL;

let _getIdToken = null;

// Register a callback that returns the current Firebase ID token (or null).
// Pass null to clear. Called once per request; may be sync or async.
export function setAuthProvider(fn) {
  _getIdToken = typeof fn === 'function' ? fn : null;
}

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Format an ApiError for display in a Toast. Backend validation errors come
// through with `details.fieldErrors` (zod flatten() output) — surface the
// specific field + reason rather than the generic envelope message so the
// surveyor knows what to retry. Truncates to fit a single-line toast.
export function describeApiError(err, fallback = 'Submit failed') {
  if (!err) return fallback;
  const fieldErrors = err.details?.fieldErrors;
  if (fieldErrors && typeof fieldErrors === 'object') {
    const parts = Object.entries(fieldErrors)
      .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
      .map(([field, msgs]) => `${field} (${msgs.join(', ')})`);
    if (parts.length > 0) {
      return truncateForToast(`Could not save — ${parts.join('; ')}`);
    }
  }
  return truncateForToast(err.message || fallback);
}

function truncateForToast(s, max = 80) {
  if (typeof s !== 'string') return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Internal: read content-type and decode the body the right way.
async function decodeBody(response) {
  if (response.status === 204) return null;
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('application/json')) return response.json();
  if (ct.startsWith('text/'))          return response.text();
  return response.blob();
}

export async function request(path, { method = 'GET', body, signal } = {}) {
  const url = path.startsWith('http') ? path : BASE_URL + path;

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (_getIdToken) {
    const token = await _getIdToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  // Combine the caller's AbortSignal (if any) with our own timeout signal.
  // Track which side won the race so we can report a useful error.
  const ctrl = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => { timedOut = true; ctrl.abort('timeout'); }, TIMEOUT_MS);

  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError' || ctrl.signal.aborted) {
      if (timedOut) {
        throw new ApiError('Request timed out', { status: 0, code: 'timeout' });
      }
      throw new ApiError('Request aborted', { status: 0, code: 'aborted' });
    }
    throw new ApiError(err?.message || 'Network error', { status: 0, code: 'network_error' });
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    let parsed = null;
    try { parsed = await decodeBody(response); } catch { /* swallow */ }
    const err = (parsed && typeof parsed === 'object' && parsed.error) || {};
    // Backend uses `message_en`; fall back through `message` for older shapes.
    throw new ApiError(
      err.message_en || err.message || response.statusText || 'Request failed',
      {
        status: response.status,
        code: err.code || `http_${response.status}`,
        details: err.details,
      },
    );
  }

  return decodeBody(response);
}
