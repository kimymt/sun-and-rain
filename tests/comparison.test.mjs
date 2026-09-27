import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, windowData, LOCATION } from '../app/weather.mjs';
import { compare, meaningful, snapshot } from '../app/comparison.mjs';
import { restoreRecord, validSnapshot } from '../app/storage.mjs';
import { NOW, responseFixture } from './fixtures.mjs';

function make(now = NOW) {
  const sources = Object.fromEntries(['weather', 'uvpop'].map(id => [id, { data: normalize(responseFixture(id, now), id, now), error: null }]));
  return snapshot(sources, windowData(sources, now));
}
function set(s, key, value, i = 6) {
  const source = ['uv', 'prob'].includes(key) ? 'uvpop' : 'weather';
  s.sources[source].data.series[key][i].value = value;
}
const cases = [
  ['UV-01', 'uv', 2, 4, true], ['UV-02', 'uv', null, 4, false], ['UV-03', 'uv', 3.1, 3.4, false],
  ['POP-01', 'prob', 20, 60, true], ['POP-02', 'prob', 20, 25, false],
  ['UV boundary below', 'uv', 2.1, 3, false], ['UV boundary exact', 'uv', 2, 3, true],
  ['UV falling', 'uv', 6, 5, true], ['UV above eleven', 'uv', 11, 14, true],
  ['probability low range', 'prob', 0, 30, false], ['probability boundary', 'prob', 30, 40, true],
  ['probability falling', 'prob', 60, 50, true], ['probability just below', 'prob', 29, 39, false],
  ['amount exact', 'amount', 0, .2, true], ['amount below', 'amount', 0, .19, false],
  ['amount large', 'amount', 1, 1.5, true], ['temperature exact', 'temp', 20, 18, true],
  ['temperature below', 'temp', 20, 18.01, false], ['sunshine exact minutes', 'sun', 45, 25, true],
  ['sunshine below minutes', 'sun', 45, 25.1, false], ['missing loss', 'uv', 4, null, false],
  ['RANGE-01 probability', 'prob', 20, 101, false], ['RANGE-01 UV', 'uv', -1, 4, false],
  ['RANGE-01 nonfinite', 'uv', 2, Infinity, false]
];
for (const [id, key, before, after, expected] of cases) test(id, () => assert.equal(meaningful(key, before, after), expected));

test('UV-01 / POP-01 output describes preceding hour using exact target time', () => {
  const a = make(), b = make(); set(a, 'uv', 2); set(b, 'uv', 4); set(a, 'prob', 20); set(b, 'prob', 60);
  const result = compare(a, b, NOW);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[0].start, Date.parse('2026-09-27T15:00:00+09:00') / 1000);
  assert.equal(result.changes[0].end, Date.parse('2026-09-27T16:00:00+09:00') / 1000);
});
test('TIME-01 shifted arrays join by epoch; TIME-03 acquired but unseen future excluded', () => {
  const a = make(), b = make(NOW + 3600);
  set(a, 'uv', 2, 6); set(b, 'uv', 4, 5); set(b, 'uv', 10, 13);
  const changes = compare(a, b, NOW + 3600).changes.filter(c => c.key === 'uv');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].start, a.sources.uvpop.data.series.uv[6].start);
});
test('TIME-02 same wall-clock hour on different days is not a match', () => assert.equal(compare(make(), make(NOW + 86400), NOW + 86400).compared, 0));
test('SOURCE-01 only matching source policies compare', () => {
  const a = make(), b = make(); a.sources.uvpop.data.sourcePolicyId = 'best-match-old';
  set(a, 'uv', 0); set(b, 'uv', 5); set(a, 'temp', 20); set(b, 'temp', 25);
  assert.deepEqual(compare(a, b, NOW).changes.map(c => c.key), ['temp']);
});
test('LOCATION-01 revision and coordinate changes reset comparison', () => {
  const a = make(), b = make(); b.location.revision++;
  assert.equal(compare(a, b, NOW).reason, 'location');
  b.location.revision--; b.location.latitude += .01;
  assert.equal(compare(a, b, NOW).reason, 'location');
});
test('PARTIAL-01 ongoing intervals do not highlight', () => {
  const a = make(), b = make(); set(a, 'uv', 0, 1); set(b, 'uv', 5, 1);
  assert.equal(compare(a, b, NOW).changes.length, 0);
  const onHour = Math.floor(NOW / 3600) * 3600;
  assert.equal(compare(a, b, onHour).changes.length, 1);
});
test('null arrival is availability, not forecast change; failed source does not compare', () => {
  const a = make(), b = make(); set(a, 'uv', null); set(b, 'uv', 6);
  assert.equal(compare(a, b, NOW).changes.length, 0);
  set(a, 'uv', 2); b.sources.uvpop.error = 'offline';
  assert.equal(compare(a, b, NOW).changes.length, 0);
});
test('adjacent changes group by metric and direction without losing values', () => {
  const a = make(), b = make();
  for (const i of [5, 6, 7]) { set(a, 'uv', 1, i); set(b, 'uv', 4, i); }
  set(a, 'uv', 6, 8); set(b, 'uv', 3, 8);
  const result = compare(a, b, NOW);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].items.length, 3);
  assert.equal(result.groups[1].direction, 'down');
});
test('rain start shift uses amounts and a prior dry hour, never probability alone', () => {
  const a = make(), b = make();
  a.sources.weather.data.series.amount.forEach((p, i) => { p.value = i >= 9 ? .5 : 0; });
  b.sources.weather.data.series.amount.forEach((p, i) => { p.value = i >= 7 ? .5 : 0; });
  const result = compare(a, b, NOW);
  assert.equal(result.onset.before - result.onset.after, 7200);
  b.sources.weather.data.series.amount[3].value = null;
  assert.equal(compare(a, b, NOW).onset, null);
  assert.equal(compare(make(), make(), NOW).onset, null); // rain already underway
});
test('snapshot is immutable after sources change and never rounds values', () => {
  const a = make(); const value = a.sources.weather.data.series.temp[6].value;
  const b = snapshot(a.sources, windowData(a.sources, NOW)); set(a, 'temp', 99);
  assert.equal(b.sources.weather.data.series.temp[6].value, value);
});

const record = () => ({ schemaVersion: 1, location: LOCATION, last: make(), previous: null });
test('valid storage record restores; expiration drops forecasts but retains location', () => {
  const r = record(); assert(validSnapshot(r.last, LOCATION));
  assert.deepEqual(restoreRecord(r, NOW).record, r);
  const expired = restoreRecord(r, NOW + 48 * 3600 + 1);
  assert.equal(expired.record.last, null); assert.equal(expired.record.location.id, LOCATION.id);
});
test('corrupt or incompatible persisted records are not used', () => {
  const future = record(); future.schemaVersion = 99;
  assert.equal(restoreRecord(future, NOW).unsupported, true);
  const corrupt = record(); corrupt.last.sources.uvpop.data.series.uv[1].targetTime = 'bad';
  assert.equal(restoreRecord(corrupt, NOW).record, null);
  const wrongSource = record(); wrongSource.last.sources.uvpop.data.sourcePolicyId = 'old';
  assert.equal(restoreRecord(wrongSource, NOW).record, null);
});
test('recent display does not renew 48-hour-old data; future clock record is rejected', () => {
  const r = record(); r.last.displayedAt = NOW + 47 * 3600;
  assert.equal(restoreRecord(r, NOW + 49 * 3600).record.last, null);
  assert.equal(restoreRecord(record(), NOW - 301).record.last, null);
});
