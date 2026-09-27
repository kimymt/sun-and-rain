import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from '../scripts/serve.mjs';
import { responseFixture } from './fixtures.mjs';
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const out = 'docs/verification/location-20260927';
await mkdir(out, { recursive: true });
const server = createServer(); let browser;
const errors = [], results = [];
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    let held = [], holdTokyo = false, failSearch = false;
    await page.route('https://api.open-meteo.com/**', async route => {
      const url = new URL(route.request().url());
      const isTokyo = Number(url.searchParams.get('latitude')) < 40;
      const body = responseFixture(url.searchParams.get('models') === 'gfs_global' ? 'uvpop' : 'weather', Date.now() / 1000);
      if (body.hourly.temperature_2m) body.hourly.temperature_2m.fill(isTokyo ? 23 : 12);
      const fulfill = () => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (holdTokyo && isTokyo) { held.push(fulfill); return; }
      await fulfill();
    });
    await page.route('https://geocoding-api.open-meteo.com/**', route => failSearch ? route.abort() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ name: '札幌市', latitude: 43.06, longitude: 141.35, country_code: 'JP', admin1: '北海道' }] }) }));
    const settle = () => page.waitForFunction(() => !['取得を開始します。', '予報を取得しています。', '保存予報を表示しています。最新予報を確認します。'].includes(document.querySelector('#request-status').textContent));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await settle();
    await page.waitForFunction(() => document.querySelector('#storage-status').textContent === '端末に保存済み');
    await page.getByRole('button', { name: '地点を変更', exact: true }).click();
    await page.getByLabel('地名', { exact: true }).fill('札幌');
    failSearch = true; await page.getByRole('button', { name: '検索', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#search-status').textContent.includes('検索できません'));
    await page.getByRole('button', { name: 'キャンセル' }).click();
    assert((await page.locator('#location-name').textContent()).includes('東京'));
    holdTokyo = true; await page.locator('#refresh').click();
    await page.waitForFunction(() => document.querySelector('#refresh').disabled);
    failSearch = false;
    await page.getByRole('button', { name: '地点を変更', exact: true }).click();
    await page.getByLabel('地名', { exact: true }).fill('札幌');
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await page.locator('.location-candidate').click();
    await page.screenshot({ path: `${out}/dialog-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'この地点に変更', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#location-name').textContent.includes('札幌市'));
    await settle();
    assert((await page.locator('.weather-description').textContent()).includes('12℃'));
    assert.equal(held.length, 2);
    await Promise.all(held.map(fn => fn()));
    await page.waitForFunction(() => document.querySelector('#storage-status').textContent === '端末に保存済み');
    assert((await page.locator('.weather-description').textContent()).includes('12℃'));
    assert.equal(await page.locator('[data-changed]').count(), 0);
    await page.reload(); await settle();
    assert((await page.locator('#location-name').textContent()).includes('札幌市'));
    assert((await page.locator('.weather-description').textContent()).includes('12℃'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${out}/forecast-${width}.png`, fullPage: true });
    results.push({ width, status: 'PASS', checks: ['search failure', 'cancel', 'selection', 'late old response ignored', 'comparison reset', 'saved location restored', 'no overflow'] });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ results, errors, mockedAPI: true }, null, 2));
  console.log('PASS: location selection, persistence and request race in two viewports');
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
