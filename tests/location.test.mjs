import test from 'node:test';
import assert from 'node:assert/strict';
import { validLocation, chooseLocation, searchLocations } from '../app/location.mjs';
import { LOCATION } from '../app/weather.mjs';
test('coordinate changes advance revision; identical coordinates preserve identity', () => {
  assert.equal(chooseLocation({ ...LOCATION, name: '自宅' }, LOCATION).revision, 1);
  const next = chooseLocation({ name: '札幌', latitude: 43.06, longitude: 141.35 }, LOCATION);
  assert.equal(next.id, 'primary'); assert.equal(next.revision, 2);
  assert(!validLocation({ ...next, latitude: NaN }));
  assert(!validLocation({ ...next, longitude: 10 }));
});
test('search fixes Japan filter and excludes invalid/foreign results', async () => {
  let url;
  const results = await searchLocations('札幌', { fetchImpl: async value => {
    url = new URL(value); return { ok: true, json: async () => ({ results: [
      { name: '札幌', latitude: 43.06, longitude: 141.35, country_code: 'JP', admin1: '北海道' },
      { name: 'Foreign', latitude: 35, longitude: 139, country_code: 'US' },
      { name: 'Broken', latitude: null, longitude: 139, country_code: 'JP' }
    ] }) };
  } });
  assert.equal(url.searchParams.get('countryCode'), 'JP'); assert.equal(results.length, 1);
});
test('empty search does not fetch, empty results are allowed, HTTP error rejects', async () => {
  await assert.rejects(searchLocations('a', { fetchImpl: () => { throw Error('should not fetch'); } }), /2〜80/);
  assert.deepEqual(await searchLocations('不存在', { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), []);
  await assert.rejects(searchLocations('東京', { fetchImpl: async () => ({ ok: false, status: 429 }) }), /上限/);
});

test('nearby municipalities are sorted by distance, bounded and not inferred from foreign GPS', async () => {
  const { nearbyLocations } = await import('../app/location.mjs');
  const rows = [['東京都', '遠い', 35.7, 139.8], ['東京都', '近い', 35.681, 139.767], ['北海道', '範囲外', 43.06, 141.35], ['不正', '不正', null, 139]];
  const found = nearbyLocations(rows, { latitude: 35.6812, longitude: 139.7671 });
  assert.deepEqual(found.map(x => x.name), ['近い', '遠い']);
  assert(found[0].distance < found[1].distance);
  assert.throws(() => nearbyLocations(rows, { latitude: 51.5, longitude: -.1 }));
  assert.deepEqual(nearbyLocations(rows, { latitude: 26, longitude: 127 }), []);
});

test('GPS permission denial, timeout, unavailable and cancellation keep manual search possible', async () => {
  const { currentPosition, nearbyCandidates } = await import('../app/location.mjs');
  for (const code of [1, 2, 3]) {
    await assert.rejects(currentPosition({ getCurrentPosition: (_, fail) => fail({ code }) }), /地名で検索/);
  }
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(nearbyCandidates({ signal: controller.signal, geolocation: { getCurrentPosition: success => success({ coords: { latitude: 35, longitude: 139 } }) }, fetchImpl: () => calls++ }));
  assert.equal(calls, 0);
});
