import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from '../scripts/serve.mjs';
import { NOW, responseFixture } from './fixtures.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const out = path.resolve(process.env.VERIFICATION_OUT ?? 'docs/verification/persistence-comparison-20260927');
await mkdir(out, { recursive: true });
const server = createServer();
let browser;
const errors = [], checks = [];
const read = page => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('sun-and-rain', 1);
  req.onerror = reject;
  req.onsuccess = () => {
    const db = req.result, tx = db.transaction('locations'), get = tx.objectStore('locations').get('tokyo');
    get.onsuccess = () => resolve(get.result); tx.oncomplete = () => db.close();
  };
}));
const settle = page => page.waitForFunction(() => !['取得を開始します。', '予報を取得しています。', '保存予報を表示しています。最新予報を確認します。'].includes(document.querySelector('#request-status').textContent));
const saved = page => page.waitForFunction(() => document.querySelector('#storage-status').textContent === '端末に保存済み');
const update = async page => { await page.locator('#refresh').click(); await settle(page); };
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: NOW * 1000 });
  let version = 0, offline = false;
  await context.route('https://api.open-meteo.com/**', async route => {
    if (offline) return route.abort('failed');
    const source = route.request().url().includes('gfs_global') ? 'uvpop' : 'weather';
    const body = responseFixture(source, await page.evaluate(() => Date.now() / 1000));
    if (source === 'uvpop') {
      body.hourly.uv_index.fill(2);
      body.hourly.precipitation_probability.fill(20);
      if (version > 0) for (const i of [6, 7]) { body.hourly.uv_index[i] = version === 1 ? 4 : 6; body.hourly.precipitation_probability[i] = 60; }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(url); await settle(page); await saved(page);
  assert((await page.locator('#change-summary').textContent()).includes('次回から、今回の予報との変化を表示します'));
  const first = await read(page);
  assert.equal(first.location.id, 'tokyo'); assert.equal(first.previous, null);
  assert(first.last.displayedAt >= NOW);
  checks.push('first visible render persisted with location and source timestamps');
  version = 1;
  await page.reload(); await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('[data-changed]').length === 4);
  await saved(page);
  const second = await read(page);
  assert.equal(second.previous.sources.uvpop.data.series.uv[6].value, 2);
  assert.equal(second.last.sources.uvpop.data.series.uv[6].value, 4);
  await page.screenshot({ path: path.join(out, 'overview-390.png'), fullPage: true });
  await page.getByText('変更の内訳', { exact: true }).click();
  assert((await page.locator('#change-list').innerText()).includes('UV（1時間平均） 2 → 4'));
  assert((await page.locator('#change-list').innerText()).includes('降水確率 20% → 60%'));
  await page.getByRole('slider').focus(); await page.keyboard.press('Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  assert((await page.locator('.selected-changes').innerText()).includes('2 → 4'));
  await page.screenshot({ path: path.join(out, 'changes-390.png'), fullPage: true });
  checks.push('reload compares against prior displayed window, grouped markers and selected values');
  offline = true;
  await page.reload(); await settle(page);
  assert.equal(await page.locator('.metric .no-data').count(), 0);
  assert((await page.locator('#source-status').textContent()).includes('以前の取得値'));
  assert.equal((await read(page)).last.sources.uvpop.data.series.uv[6].value, 4);
  assert.equal(await page.locator('[data-changed]').count(), 0);
  checks.push('API-offline reload restores prior values and does not overwrite history');
  offline = false; version = 2;
  // Simulate visibility boundary, not evidence of iOS background lifecycle.
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }));
  await update(page);
  assert.equal((await read(page)).last.sources.uvpop.data.series.uv[6].value, 4);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await saved(page);
  assert.equal((await read(page)).last.sources.uvpop.data.series.uv[6].value, 6);
  checks.push('hidden completion is not marked displayed; visible render commits later');
  // Inject a write failure at the actual IDB write boundary.
  await page.evaluate(() => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('Test quota', 'QuotaExceededError'); };
  });
  const beforeFailure = await read(page);
  version = 0; await page.clock.fastForward(31 * 60 * 1000); await settle(page);
  await page.waitForFunction(() => document.querySelector('#storage-status').textContent.includes('保存できませんでした'));
  assert.deepEqual(await read(page), beforeFailure);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
  checks.push('injected quota failure aborts transaction, keeps prior record, and reports failure');
  // Atomic stale-writer protection across independent DB connections.
  const outcomes = await page.evaluate(async () => {
    const { openStore } = await import('/storage.mjs');
    const a = await openStore(), b = await openStore();
    const old = await a.read('tokyo'), newer = structuredClone(old);
    newer.last.displayedAt += 1;
    const first = await a.write(newer), second = await b.write(old);
    a.close(); b.close(); return [first, second];
  });
  assert.deepEqual(outcomes, ['saved', 'newer']);
  checks.push('atomic transaction rejects an older writer from another connection');
  // A corrupt record is treated as absent and replaced only after a valid render.
  await page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('sun-and-rain', 1); req.onsuccess = () => {
      const db = req.result, tx = db.transaction('locations', 'readwrite');
      tx.objectStore('locations').put({ location: { id: 'tokyo' }, schemaVersion: 1, last: { broken: true } });
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));
  await page.reload(); await settle(page); await saved(page);
  assert.equal((await read(page)).last.sources.uvpop.data.series.uv[6].value, 2);
  assert((await page.locator('#change-summary').textContent()).includes('次回から、今回の予報との変化を表示します'));
  checks.push('corrupt record rejected and replaced after valid forecast is displayed');
  // Unknown newer record schema is preserved, rather than silently migrated down.
  await page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('sun-and-rain', 1); req.onsuccess = () => {
      const db = req.result, tx = db.transaction('locations', 'readwrite');
      tx.objectStore('locations').put({ location: { id: 'tokyo' }, schemaVersion: 99, marker: 'preserve' });
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));
  await page.reload(); await settle(page);
  assert((await page.locator('#storage-status').textContent()).includes('対応外'));
  assert.equal((await read(page)).marker, 'preserve');
  checks.push('unknown schema preserved and storage disabled, forecast still works');
  await context.close();

  const unavailable = await browser.newContext({ viewport: { width: 320, height: 844 } });
  await unavailable.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Disabled', 'SecurityError'); } }));
  await unavailable.route('https://api.open-meteo.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseFixture(route.request().url().includes('gfs_global') ? 'uvpop' : 'weather', Date.now() / 1000)) }));
  const fallback = await unavailable.newPage();
  fallback.on('pageerror', error => errors.push(error.message));
  await fallback.goto(url); await settle(fallback);
  assert.equal(await fallback.locator('.metric .no-data').count(), 0);
  assert.notEqual(await fallback.locator('#storage-status').textContent(), '端末に保存済み');
  assert.equal(await fallback.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await fallback.screenshot({ path: path.join(out, 'storage-unavailable-320.png'), fullPage: true });
  checks.push('unavailable storage falls back to memory and forecast remains usable');
  await unavailable.close();
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'persistence-browser-results.json'), JSON.stringify({ time: new Date().toISOString(), browser: browser.version(), mockedAPI: true, checks, errors, limitations: ['visibility state simulated', 'quota failure injected', 'no real iPhone', 'no offline app-shell reload'] }, null, 2));
  console.log(`PASS: ${checks.length} persistence/comparison scenarios`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
