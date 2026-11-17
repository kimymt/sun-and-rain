import test from 'node:test';
import assert from 'node:assert/strict';
import { FETCH_LOG_LIMIT, appendFetchLog, entriesFromRecord, fetchLogRecord, rateLimitFromHeaders, sanitizeFetchLogEntry } from '../app/fetch-log.mjs';

const entry = (overrides = {}) => ({
  source: 'uvpop', startedAt: 1794800000, durationMs: 1234, outcome: 'success', httpStatus: 200,
  rateLimit: { limit: 600, remaining: 599, cost: 1, window: 60, reset: 1794800060, retryAfter: null },
  error: null, effectiveType: '4g', visibility: 'visible', ...overrides
});

test('rate limit headers are read as numbers, missing or invalid values become null', () => {
  const headers = new Headers({ 'x-ratelimit-limit': '600', 'x-ratelimit-remaining': '598.5', 'retry-after': '42' });
  assert.deepEqual(rateLimitFromHeaders(headers),
    { limit: 600, remaining: 598.5, cost: null, window: null, reset: null, retryAfter: 42 });
  assert.deepEqual(rateLimitFromHeaders(undefined),
    { limit: null, remaining: null, cost: null, window: null, reset: null, retryAfter: null });
  assert.equal(rateLimitFromHeaders({ get: () => 'not-a-number' }).limit, null);
  assert.equal(rateLimitFromHeaders({ get: () => { throw new Error('blocked'); } }).limit, null);
});

test('append keeps only valid entries and trims to the limit, newest last', () => {
  let log = [];
  for (let i = 0; i < FETCH_LOG_LIMIT + 5; i++) log = appendFetchLog(log, entry({ startedAt: 1794800000 + i }));
  assert.equal(log.length, FETCH_LOG_LIMIT);
  assert.equal(log[0].startedAt, 1794800005);
  assert.equal(log.at(-1).startedAt, 1794800000 + FETCH_LOG_LIMIT + 4);
  assert.deepEqual(appendFetchLog(log, entry({ outcome: 'unknown' })), log);
  assert.deepEqual(appendFetchLog(log, { source: 'uvpop' }), log);
  assert.deepEqual(appendFetchLog(log, entry({ httpStatus: 99 })), log);
  assert.deepEqual(appendFetchLog(log, entry({ durationMs: -1 })), log);
});

test('record round-trip sanitizes entries and rejects foreign records', () => {
  const record = fetchLogRecord([entry(), entry({ outcome: 'timeout', httpStatus: null, error: '15秒以内に応答がありませんでした' })]);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.location.id, '__fetch-log');
  assert.deepEqual(entriesFromRecord(record), record.entries);
  assert.deepEqual(entriesFromRecord(null), []);
  assert.deepEqual(entriesFromRecord({ schemaVersion: 2, location: { id: '__fetch-log' }, entries: [entry()] }), []);
  assert.deepEqual(entriesFromRecord({ schemaVersion: 1, location: { id: 'tokyo' }, entries: [entry()] }), []);
  assert.deepEqual(entriesFromRecord({ schemaVersion: 1, location: { id: '__fetch-log' }, entries: [entry(), { bad: true }] }), [sanitizeFetchLogEntry(entry())]);
});

test('long strings are truncated instead of stored verbatim', () => {
  const clean = sanitizeFetchLogEntry(entry({ error: 'x'.repeat(500) }));
  assert.equal(clean.error.length, 200);
});
