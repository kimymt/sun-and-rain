// Fetch attempt records. Issue #8: without per-attempt measurements the
// timeout causes cannot be separated, so every attempt is recorded with its
// source, start time, duration, outcome, HTTP status and rate-limit headers.
// Records stay on the device; nothing here sends them anywhere.
export const FETCH_LOG_ID = '__fetch-log';
export const FETCH_LOG_LIMIT = 50;
export const FETCH_OUTCOMES = Object.freeze(['success', 'timeout', 'http', 'network', 'parse', 'invalid', 'error']);

const finiteOrNull = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const shortStringOrNull = (value, max = 100) => typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;

export function rateLimitFromHeaders(headers) {
  const read = name => {
    try { return headers?.get?.(name) ?? null; } catch { return null; }
  };
  const number = name => {
    const raw = read(name);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return {
    limit: number('x-ratelimit-limit'), remaining: number('x-ratelimit-remaining'),
    cost: number('x-ratelimit-cost'), window: number('x-ratelimit-window'),
    reset: number('x-ratelimit-reset'), retryAfter: number('retry-after')
  };
}
export const NO_RATE_LIMIT = Object.freeze(rateLimitFromHeaders(null));

// Persisted records are input, not trusted application state.
export function validFetchLogEntry(value) {
  if (!value || typeof value !== 'object') return false;
  const rate = value.rateLimit;
  return shortStringOrNull(value.source, 20) !== null &&
    Number.isFinite(value.startedAt) && value.startedAt > 0 && value.startedAt <= 8.64e12 &&
    Number.isFinite(value.durationMs) && value.durationMs >= 0 &&
    FETCH_OUTCOMES.includes(value.outcome) &&
    (value.httpStatus === null || (Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599)) &&
    !!rate && typeof rate === 'object' &&
    ['limit', 'remaining', 'cost', 'window', 'reset', 'retryAfter'].every(key => rate[key] === null || Number.isFinite(rate[key])) &&
    (value.error === null || shortStringOrNull(value.error, 200) !== null) &&
    (value.effectiveType === undefined || value.effectiveType === null || shortStringOrNull(value.effectiveType, 20) !== null) &&
    (value.visibility === undefined || value.visibility === null || ['visible', 'hidden', 'prerender'].includes(value.visibility));
}

export function sanitizeFetchLogEntry(value) {
  if (!validFetchLogEntry(value)) return null;
  return {
    source: value.source.slice(0, 20), startedAt: value.startedAt, durationMs: value.durationMs,
    outcome: value.outcome, httpStatus: value.httpStatus,
    rateLimit: Object.fromEntries(['limit', 'remaining', 'cost', 'window', 'reset', 'retryAfter'].map(key => [key, finiteOrNull(value.rateLimit[key])])),
    error: value.error === null ? null : value.error.slice(0, 200),
    effectiveType: shortStringOrNull(value.effectiveType, 20), visibility: value.visibility ?? null
  };
}

export function sanitizeFetchLog(entries, limit = FETCH_LOG_LIMIT) {
  if (!Array.isArray(entries)) return [];
  return entries.map(sanitizeFetchLogEntry).filter(entry => entry !== null).slice(-limit);
}

export function appendFetchLog(entries, entry, limit = FETCH_LOG_LIMIT) {
  const clean = sanitizeFetchLogEntry(entry);
  const base = sanitizeFetchLog(entries, limit);
  return clean ? [...base, clean].slice(-limit) : base;
}

export function fetchLogRecord(entries) {
  return { schemaVersion: 1, location: { id: FETCH_LOG_ID }, entries: sanitizeFetchLog(entries) };
}

export function entriesFromRecord(record) {
  if (!record || record.schemaVersion !== 1 || record.location?.id !== FETCH_LOG_ID) return [];
  return sanitizeFetchLog(record.entries);
}
