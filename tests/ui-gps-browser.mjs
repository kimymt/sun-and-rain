import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from '../scripts/serve.mjs';
import { responseFixture, NOW } from './fixtures.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const out = 'docs/verification/ui-gps-20260927';
await mkdir(out, { recursive: true });
const server = createServer(); let browser;
const results = [], errors = [];
const settled = page => page.waitForFunction(() => document.querySelector('#request-status').textContent === '予報を取得しました。');
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 35.6812, longitude: 139.7671, accuracy: 30 } });
    let count = 0;
    await context.route('https://api.open-meteo.com/**', route => {
      count++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseFixture(route.request().url().includes('gfs_global') ? 'uvpop' : 'weather', NOW)) });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: NOW * 1000 });
    await page.goto(url); await settled(page);
    assert.equal(await page.locator('h1').textContent(), '雨と日差しの予報');
    assert.equal(await page.locator('#page-title, #period, #location-coordinates').count(), 0);
    assert.equal(await page.locator('.rain-explanation span, .rain-explanation br').count(), 0);
    assert((await page.locator('.rain-explanation').textContent()).includes('1㎡あたり1リットル'));
    assert((await page.locator('.masthead').boundingBox()).height <= 48);
    assert(await page.locator('#location-name').isVisible());
    assert(await page.evaluate(() => !!(document.querySelector('#install-guide').compareDocumentPosition(document.querySelector('#fetch-details')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    const before = count;
    await page.locator('#refresh').click(); await settled(page);
    assert.equal(count, before + 2);
    assert(await page.locator('#refresh').isDisabled());
    assert.equal(await page.locator('#refresh-notice').count(), 0);
    assert.equal(await page.locator('#refresh').textContent(), '更新は1回/h');
    await page.reload(); await settled(page);
    assert(await page.locator('#refresh').isDisabled());
    const tab = await context.newPage(); await tab.clock.install({ time: NOW * 1000 });
    await tab.goto(url); await settled(tab); assert(await tab.locator('#refresh').isDisabled());
    await tab.close();
    // Wall-clock boundary, without executing an hour of interval timers.
    await page.clock.setFixedTime((NOW + 3599) * 1000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await settled(page);
    assert(await page.locator('#refresh').isDisabled());
    await page.clock.setFixedTime((NOW + 3601) * 1000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert(await page.locator('#refresh').isEnabled());
    const afterHour = count;
    await page.locator('#refresh').click(); await settled(page); assert.equal(count, afterHour + 2);
    await page.getByRole('button', { name: '地点を変更', exact: true }).click();
    await page.getByRole('button', { name: '現在地周辺の候補を表示' }).click();
    await page.locator('.location-candidate').first().waitFor();
    assert.equal(await page.locator('.location-candidate').count(), 5);
    assert((await page.locator('#search-status').textContent()).includes('代表地点'));
    await page.screenshot({ path: `${out}/nearby-${width}.png`, fullPage: true });
    const name = (await page.locator('.location-candidate').first().textContent()).split(' / ')[0];
    await page.locator('.location-candidate').first().click();
    await page.getByRole('button', { name: 'この地点に変更', exact: true }).click();
    await page.waitForFunction(name => document.querySelector('#location-name').textContent === name, name);
    await settled(page);
    assert.equal(await page.locator('#location-name').textContent(), name);
    await page.waitForFunction(() => document.querySelector('#storage-status').textContent === '端末に保存済み');
    await page.reload(); await settled(page); assert.equal(await page.locator('#location-name').textContent(), name);
    assert(await page.locator('#refresh').isDisabled());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${out}/main-${width}.png`, fullPage: true });
    // A delayed GPS callback must not repopulate a closed/reopened dialog.
    await page.evaluate(() => navigator.geolocation.getCurrentPosition = success => { window.gpsCallback = success; });
    await page.locator('#edit-location').click(); await page.locator('#nearby-location').click();
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    assert(await page.locator('#edit-location').evaluate(el => el === document.activeElement));
    await page.locator('#edit-location').click();
    await page.evaluate(() => window.gpsCallback({ coords: { latitude: 35.68, longitude: 139.76, accuracy: 20 } }));
    assert.equal(await page.locator('.location-candidate').count(), 0);
    await page.evaluate(() => navigator.geolocation.getCurrentPosition = (_, fail) => fail({ code: 1 }));
    await page.locator('#nearby-location').click();
    await page.waitForFunction(() => document.querySelector('#search-status').textContent.includes('許可されていません'));
    assert(await page.locator('#nearby-location').isEnabled());
    await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [{ name: '札幌市', latitude: 43.06, longitude: 141.35, country_code: 'JP', admin1: '北海道' }] } }));
    await page.getByLabel('地名', { exact: true }).fill('札幌市');
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await page.locator('.location-candidate').first().waitFor();
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await page.addStyleTag({ content: ':root{font-size:32px!important}' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const race = await page.evaluate(async () => {
      const { openStore } = await import('/storage.mjs');
      const a = await openStore(), b = await openStore();
      const now = Date.now() + 7200000;
      const claims = await Promise.all([a.claimManualRefresh(now), b.claimManualRefresh(now)]);
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = () => { throw new DOMException('Test quota', 'QuotaExceededError'); };
      let failed = false;
      try { await a.claimManualRefresh(now + 7200000); } catch { failed = true; }
      finally { IDBObjectStore.prototype.put = original; a.close(); b.close(); }
      return { allowed: claims.filter(c => c.allowed).length, failed };
    });
    assert.deepEqual(race, { allowed: 1, failed: true });
    results.push({ width, pass: true, checks: ['compact header', 'footer status', 'manual refresh 60 minutes across reload/tab', '3599/3601 second boundary', 'five nearby candidates', 'selection and restore', 'GPS denial/search recovery', 'cancel discards late GPS', '200% CSS text'] });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: compact UI, hourly manual refresh, GPS candidates and recovery at 320/390px');
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify({ results, errors, weatherAPI: 'mock', GPS: 'simulated Tokyo station' }, null, 2));
  await browser?.close(); await new Promise(r => server.close(r));
}
