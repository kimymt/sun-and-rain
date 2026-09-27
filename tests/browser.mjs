import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from '../scripts/serve.mjs';
import { NOW, responseFixture } from './fixtures.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2]);
const live = process.argv.includes('--live');
const out = path.resolve(process.env.VERIFICATION_OUT ?? 'docs/verification/data-integration-20260927');
await mkdir(out, { recursive: true });
const server = createServer();
let browser;
const results = [], errors = [];
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  if (live) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    page.on('pageerror', error => errors.push(error.message));
    const network = [];
    page.on('response', response => {
      if (response.url().startsWith('https://api.open-meteo.com/')) network.push({ url: response.url(), status: response.status() });
    });
    await page.goto(url);
    await page.waitForFunction(() => !['取得を開始します。', '予報を取得しています。', '保存予報を表示しています。最新予報を確認します。'].includes(document.querySelector('#request-status').textContent));
    const status = await page.locator('#request-status').textContent();
    await page.screenshot({ path: path.join(out, 'live-390.png'), fullPage: true });
    await writeFile(path.join(out, 'live-results.json'), JSON.stringify({ time: new Date().toISOString(), browser: browser.version(), network, status, sources: await page.locator('#source-status').innerText(), errors }, null, 2));
    assert.equal(status, '予報を取得しました。');
    assert.equal(network.length, 2);
    assert(network.every(item => item.status === 200));
    assert(!(await page.locator('#selection-content').textContent()).includes('データなし'));
    console.log('PASS: live browser requests and rendering');
  } else {
    for (const width of [320, 390, 768, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 500 });
      const page = await context.newPage();
      await page.clock.install({ time: NOW * 1000 });
      let mode = 'normal', requests = 0;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://api.open-meteo.com/**', async route => {
        requests++;
        const source = route.request().url().includes('gfs_global') ? 'uvpop' : 'weather';
        if (mode === 'offline' || (mode === 'partial' && source === 'uvpop')) return route.abort('failed');
        if (mode === 'rate') return route.fulfill({ status: 429, body: '{}' });
        const body = responseFixture(source, await page.evaluate(() => Date.now() / 1000));
        if (mode === 'missing' && source === 'uvpop') {
          body.hourly.uv_index[1] = null;
          body.hourly.precipitation_probability[1] = null;
        }
        if (mode === 'invalid' && source === 'uvpop') body.hourly_units.uv_index = 'wrong';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      const settled = () => page.waitForFunction(() => !['取得を開始します。', '予報を取得しています。', '保存予報を表示しています。最新予報を確認します。'].includes(document.querySelector('#request-status').textContent));
      await page.goto(url); await settled();
      assert.equal(requests, 2);
      assert.equal(await page.locator('#request-status').textContent(), '予報を取得しました。');
      assert((await page.locator('#selected-heading').textContent()).includes('10:00–11:00'));
      await page.getByRole('button', { name: '次の時間' }).click();
      assert((await page.locator('#selected-heading').textContent()).includes('11:00–12:00'));
      await page.getByRole('slider').focus(); await page.keyboard.press('End');
      assert(await page.getByRole('button', { name: '次の時間' }).isDisabled());
      await page.keyboard.press('Home');
      const rect = await page.locator('.plot[data-metric="sun"]').boundingBox();
      const point = { x: rect.x + (2.5 - 35 / 60) / 12 * (rect.width - 22), y: rect.y + 20 };
      if (width < 500) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
      assert((await page.locator('#selected-heading').textContent()).includes('12:00–13:00'));
      mode = 'partial'; await page.locator('#refresh').click(); await settled();
      assert((await page.locator('[data-source="uvpop"]').textContent()).includes('以前の取得値'));
      assert(!(await page.locator('#selection-content').textContent()).includes('データなし'));
      mode = 'normal'; await page.reload(); await settled();
      assert.equal(await page.locator('#request-status').textContent(), '予報を取得しました。');
      mode = 'missing'; await page.reload(); await settled();
      assert.equal(await page.locator('.metric .no-data').count(), 2);
      assert(await page.locator('[data-missing]').count() > 0);
      await page.waitForFunction(() => document.querySelector('#storage-status').textContent === '端末に保存済み');
      mode = 'invalid'; await page.reload(); await settled();
      assert((await page.locator('[data-source="uvpop"]').textContent()).includes('単位・配列長'));
      assert.equal(await page.locator('.metric .no-data').count(), 2);
      await page.waitForFunction(() => document.querySelector('#storage-status').textContent === '端末に保存済み');
      // Explicit cold start in this isolated test profile; persistence recovery
      // is exercised separately without clearing records in persistence-browser.mjs.
      await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('sun-and-rain', 1);
        request.onsuccess = () => { const db = request.result; const tx = db.transaction('locations', 'readwrite'); tx.objectStore('locations').clear(); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject; };
      }));
      mode = 'offline'; await page.reload(); await settled();
      assert.equal(await page.locator('.metric .no-data').count(), 4);
      assert((await page.locator('#request-status').textContent()).includes('取得できませんでした'));
      await page.screenshot({ path: path.join(out, `offline-${width}.png`), fullPage: true });
      mode = 'rate'; await page.getByRole('button', { name: '再試行', exact: true }).click(); await settled();
      assert((await page.locator('#source-status').textContent()).includes('アクセス上限'));
      mode = 'normal'; await page.reload(); await settled();
      assert.equal(await page.locator('.metric .no-data').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(out, `normal-${width}.png`), fullPage: true });
      const prior = requests;
      await page.clock.fastForward(31 * 60 * 1000);
      await settled();
      assert.equal(requests, prior + 2, 'one foreground refresh after 30 minutes');
      mode = 'offline';
      await page.clock.fastForward(61 * 60 * 1000); await settled();
      assert(await page.locator('#stale-notice').isVisible());
      assert.equal(await page.locator('.hourly-list, #accessible-list').count(), 0);
      await page.addStyleTag({ content: ':root{font-size:32px!important}' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      results.push({ width, status: 'PASS', checks: ['normal', 'controls', 'chart tap', 'partial failure with old values', 'missing', 'invalid units', 'total failure', '429', 'retry', '30 minute refresh', 'stale', '200% CSS font size'] });
      await context.close();
    }
    await writeFile(path.join(out, 'browser-results.json'), JSON.stringify({ time: new Date().toISOString(), browser: browser.version(), mockedAPI: true, results, errors }, null, 2));
    console.log('PASS: four viewports, API fault and recovery scenarios');
  }
  assert.deepEqual(errors, []);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
