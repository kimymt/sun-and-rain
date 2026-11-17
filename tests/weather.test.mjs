import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { requestURL, normalize, windowData, refreshSources, fetchSource, formatTime, weatherLabel, LOCATION } from '../app/weather.mjs';
import { NOW, responseFixture } from './fixtures.mjs';
const states = now => Object.fromEntries(['weather', 'uvpop'].map(source => [source, { data: normalize(responseFixture(source, now), source, now), error: null }]));

test('API requests explicitly fix models, units and UTC epoch output', () => {
  const gfs = new URL(requestURL('uvpop'));
  assert.equal(gfs.searchParams.get('models'), 'gfs_global');
  assert.equal(gfs.searchParams.get('hourly'), 'uv_index,precipitation_probability');
  assert.equal(gfs.searchParams.get('forecast_hours'), '24');
  assert.equal(gfs.searchParams.get('timeformat'), 'unixtime');
  const best = new URL(requestURL('weather'));
  assert.equal(best.searchParams.get('models'), 'best_match');
  assert.equal(best.searchParams.get('wind_speed_unit'), 'ms');
});
test('interval-ending API time maps to preceding hour, without timezone offset addition', () => {
  const source = normalize(responseFixture('uvpop'), 'uvpop', NOW);
  const time = responseFixture('uvpop').hourly.time[1];
  assert.deepEqual(source.series.uv[1], { targetTime: time, start: time - 3600, end: time, aggregation: 'mean', value: 4 });
  assert.equal(formatTime(time), '11:00');
  assert.equal(source.modelRunAt, null);
});
test('12-hour window joins instant and interval values by absolute timestamp', () => {
  const input = states(NOW);
  input.uvpop.data.series.uv[0].value = 99;
  input.uvpop.data.series.uv[1].value = 7;
  // Shift source's first available timestamp: indexes must not be used for joins.
  input.uvpop.data.series.prob.shift();
  const view = windowData(input, NOW);
  assert.equal(view.rows.length, 13);
  assert.equal(view.rows[0].temp, 23);
  assert.equal(view.rows[0].uv, 7);
  assert.equal(view.rows[0].prob, 60);
  assert.equal(view.rows[0].sun, 30);
  assert.equal(view.rows[12].end - view.rows[0].start, 13 * 3600);
  assert.equal(windowData(input, Math.floor(NOW / 3600) * 3600).rows.length, 12);
});
test('fractional seconds keep the first and last partial hourly intervals', () => {
  const now = Math.floor(NOW / 3600) * 3600 + .125;
  const view = windowData(states(now), now);
  assert.equal(view.rows.length, 13);
  assert.equal(view.now, now);
  assert.equal(view.end, now + 43200);
  assert.equal(view.offset, .125 / 3600);
  assert.equal(view.rows[12].start - view.rows[0].start, 12 * 3600);
});
test('corrupt epoch cannot make hourly window construction loop indefinitely', () => {
  const moduleURL = new URL('../app/weather.mjs', import.meta.url).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { windowData } from ${JSON.stringify(moduleURL)}; console.log(windowData({}, -1e20).rows.length);`
  ], { timeout: 5000, encoding: 'utf8' });
  assert.equal(Number(output.trim()), 13);
});
test('JST midnight does not reset joins or duplicate timestamps', () => {
  const now = Date.parse('2026-09-27T23:35:00+09:00') / 1000;
  const view = windowData(states(now), now);
  assert.equal(formatTime(view.rows[1].start), '00:00');
  assert.equal(view.rows[1].start - view.rows[0].start, 3600);
  assert.equal(view.rows[1].uv, 4);
});
test('missing and invalid values remain null, legitimate zeros remain zero', () => {
  const raw = responseFixture('uvpop');
  raw.hourly.uv_index.splice(0, 6, null, -1, Infinity, '2', 0, 17);
  raw.hourly.precipitation_probability.splice(0, 4, -1, 101, NaN, 0);
  const result = normalize(raw, 'uvpop', NOW);
  assert.deepEqual(result.series.uv.slice(0, 6).map(p => p.value), [null, null, null, null, 0, 17]);
  assert.deepEqual(result.series.prob.slice(0, 4).map(p => p.value), [null, null, null, 0]);
  const weather = responseFixture('weather');
  weather.hourly.sunshine_duration[1] = 3601;
  weather.hourly.is_day[1] = 2;
  assert.equal(normalize(weather, 'weather', NOW).series.sun[1].value, null);
  assert.equal(normalize(weather, 'weather', NOW).series.day[1].value, null);
});
for (const [name, mutate] of [
  ['wrong units', b => { b.hourly_units.uv_index = 'W/m²'; }],
  ['short array', b => b.hourly.uv_index.pop()],
  ['missing field', b => { delete b.hourly.uv_index; }],
  ['duplicate timestamp', b => { b.hourly.time[1] = b.hourly.time[0]; }],
  ['gap', b => { b.hourly.time[1] += 3600; }],
  ['wrong time unit', b => { b.hourly_units.time = 'iso8601'; }],
  ['no coverage', b => { b.hourly.time = b.hourly.time.map(t => t - 86400); }]
]) test(`reject malformed source: ${name}`, () => {
  const raw = responseFixture('uvpop'); mutate(raw);
  assert.throws(() => normalize(raw, 'uvpop', NOW));
});
test('different location revision or source policy cannot be mixed into window', () => {
  const input = states(NOW);
  input.uvpop.data.sourcePolicyId = 'different';
  assert.equal(windowData(input, NOW).rows[0].uv, null);
  assert.equal(windowData(input, NOW, { ...LOCATION, revision: 2 }).rows[0].temp, null);
});
test('partial failure preserves original source age and never substitutes other model', async () => {
  const previous = states(NOW);
  const urls = [];
  const result = await refreshSources(previous, { now: () => NOW + 60, fetchImpl: async url => {
    urls.push(url);
    if (url.includes('gfs_global')) return { ok: false, status: 429 };
    return { ok: true, json: async () => responseFixture('weather') };
  } });
  assert.equal(urls.length, 2);
  assert.equal(result.weather.data.fetchedAt, NOW + 60);
  assert.equal(result.uvpop.data.fetchedAt, NOW);
  assert.match(result.uvpop.error, /アクセス上限/);
});
test('first total failure has no fabricated forecast; later retry recovers', async () => {
  const failed = await refreshSources({}, { fetchImpl: async () => { throw new TypeError('offline'); } });
  assert.equal(failed.weather.data, null);
  assert.equal(windowData(failed, NOW).rows[0].uv, null);
  const recovered = await refreshSources(failed, { now: () => NOW, fetchImpl: async url => ({ ok: true, json: async () => responseFixture(url.includes('gfs_global') ? 'uvpop' : 'weather') }) });
  assert.equal(recovered.uvpop.error, null);
  assert.equal(windowData(recovered, NOW).rows[0].uv, 4);
});
test('deadline aborts hung fetch and produces recoverable error', async () => {
  await assert.rejects(fetchSource('uvpop', { timeoutMs: 10, fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }) }), /応答がありません/);
});
test('attempts are reported once, classified, with status and rate-limit headers', async () => {
  const attempts = [];
  const onAttempt = entry => attempts.push(entry);
  const headers = new Headers({ 'x-ratelimit-limit': '600', 'x-ratelimit-remaining': '599', 'x-ratelimit-cost': '1' });
  await fetchSource('weather', { now: () => NOW, onAttempt,
    fetchImpl: async () => ({ ok: true, status: 200, headers, json: async () => responseFixture('weather') }) });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].source, 'weather');
  assert.equal(attempts[0].startedAt, NOW);
  assert.equal(attempts[0].outcome, 'success');
  assert.equal(attempts[0].httpStatus, 200);
  assert.equal(attempts[0].rateLimit.remaining, 599);
  assert.equal(attempts[0].error, null);

  attempts.length = 0;
  await assert.rejects(fetchSource('uvpop', { now: () => NOW, onAttempt,
    fetchImpl: async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '42' }) }) }), /アクセス上限/);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].outcome, 'http');
  assert.equal(attempts[0].httpStatus, 429);
  assert.equal(attempts[0].rateLimit.retryAfter, 42);

  attempts.length = 0;
  await assert.rejects(fetchSource('uvpop', { now: () => NOW, onAttempt,
    fetchImpl: async () => { throw new TypeError('offline'); } }), /通信できませんでした/);
  assert.equal(attempts[0].outcome, 'network');
  assert.equal(attempts[0].httpStatus, null);

  attempts.length = 0;
  const invalid = responseFixture('uvpop');
  invalid.hourly_units.uv_index = 'W/m²';
  await assert.rejects(fetchSource('uvpop', { now: () => NOW, onAttempt,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => invalid }) }));
  assert.equal(attempts[0].outcome, 'invalid');

  attempts.length = 0;
  await assert.rejects(fetchSource('uvpop', { now: () => NOW, onAttempt,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }) }), /読み取れませんでした/);
  assert.equal(attempts[0].outcome, 'parse');
});
test('a timed-out attempt is reported as timeout, not as a network failure', async () => {
  const attempts = [];
  await assert.rejects(fetchSource('uvpop', { timeoutMs: 10, onAttempt: entry => attempts.push(entry),
    fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }) }), /応答がありません/);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].outcome, 'timeout');
  assert.match(attempts[0].error, /応答がありません/);
});
test('a throwing attempt callback never changes the fetch outcome', async () => {
  const onAttempt = () => { throw new Error('log failed'); };
  const data = await fetchSource('weather', { now: () => NOW, onAttempt,
    fetchImpl: async () => ({ ok: true, json: async () => responseFixture('weather') }) });
  assert.equal(data.source, 'weather');
  await assert.rejects(fetchSource('uvpop', { now: () => NOW, onAttempt,
    fetchImpl: async () => { throw new TypeError('offline'); } }), /通信できませんでした/);
});
test('unknown weather code is not guessed from sunshine or rain', () => {
  assert.equal(weatherLabel(null), '天気データなし');
  assert.equal(weatherLabel(65), '強い雨');
});
