import http from 'node:http';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { responseFixture } from './fixtures.mjs';
import { waitForShell } from './pwa-helpers.mjs';

const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const out = process.env.VERIFICATION_OUT ?? 'docs/verification/security-20261010';
await mkdir(out, { recursive: true });
const originalWorker = await readFile('app/sw.js', 'utf8');
const hashes = worker => JSON.parse(worker.match(/const HASHES = ([\s\S]*?);/)[1]);
const cacheName = worker => worker.match(/const CACHE = '([^']+)'/)[1];
const bodies = Object.fromEntries(await Promise.all([...Object.keys(hashes(originalWorker)), 'sw.js'].map(async file => [file, await readFile(`app/${file}`)])));
const originalHeaders = await readFile('app/_headers', 'utf8');
const originalCsp = originalHeaders.match(/Content-Security-Policy: (.+)/)[1];
const updatedCsp = `${originalCsp}; frame-src 'none'`;
let updatedWorker;
const build = await mkdtemp(path.join(tmpdir(), 'sun-and-rain-security-'));
try {
  await cp('app', path.join(build, 'app'), { recursive: true });
  await mkdir(path.join(build, 'scripts'));
  await cp('scripts/build-sw.mjs', path.join(build, 'scripts/build-sw.mjs'));
  await writeFile(path.join(build, 'app/_headers'), originalHeaders.replace(originalCsp, updatedCsp));
  execFileSync(process.execPath, [path.join(build, 'scripts/build-sw.mjs')]);
  updatedWorker = await readFile(path.join(build, 'app/sw.js'), 'utf8');
} finally { await rm(build, { recursive: true, force: true }); }
assert.notEqual(cacheName(updatedWorker), cacheName(originalWorker));
assert.deepEqual(hashes(updatedWorker), hashes(originalWorker));
assert.equal(Object.hasOwn(hashes(updatedWorker), '_headers'), false);

let updated = false;
const server = http.createServer((req, res) => {
  let file;
  try { file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html'; }
  catch { res.writeHead(400); res.end(); return; }
  if (!Object.hasOwn(bodies, file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': file.endsWith('.png') ? 'image/png' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : file.endsWith('.webmanifest') ? 'application/manifest+json' : /\.m?js$/.test(file) ? 'text/javascript' : 'text/html',
    'Content-Security-Policy': updated ? updatedCsp : originalCsp,
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(updated && file === 'sw.js' ? updatedWorker : bodies[file]);
});
let browser;
const checks = [], errors = [];
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  let offline = false;
  const setOffline = async value => { offline = value; await context.setOffline(value); };
  await context.route('https://**/*', route => {
    if (offline || new URL(route.request().url()).hostname !== 'api.open-meteo.com') return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseFixture(route.request().url().includes('gfs_global') ? 'uvpop' : 'weather', Date.now() / 1000)) });
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  let page = await context.newPage();
  await page.goto(url);
  await waitForShell(page);
  await page.waitForFunction(() => document.querySelector('#storage-status').textContent === '端末に保存済み');
  const values = await page.locator('.metric-grid').innerText();
  const second = await context.newPage();
  await second.goto(url);
  await second.waitForFunction(() => document.querySelector('#storage-status').textContent === '端末に保存済み');
  updated = true;
  assert.equal((await context.request.get(url)).headers()['content-security-policy'], updatedCsp);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
  assert.equal((await page.reload()).headers()['content-security-policy'], originalCsp);
  await page.close();
  assert.equal((await second.reload()).headers()['content-security-policy'], originalCsp);
  assert.equal(await second.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), true);
  await second.close();
  page = await context.newPage();
  const response = await page.goto(url);
  assert.equal(response.fromServiceWorker(), true);
  assert.equal(response.headers()['content-security-policy'], updatedCsp);
  await page.waitForFunction(() => document.querySelector('#storage-status').textContent === '端末に保存済み');
  assert.deepEqual(await page.evaluate(() => caches.keys()), [cacheName(updatedWorker)]);
  checks.push('header-only build changes worker; policy waits for all tabs to close, then cached HTML uses new CSP');

  await setOffline(true);
  assert.equal((await page.reload()).headers()['content-security-policy'], updatedCsp);
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('.metric-grid').innerText(), values);
  await page.getByRole('button', { name: '次の時間', exact: true }).click();
  assert.equal(await page.locator('.metric .no-data').count(), 0);
  checks.push('updated policy and saved forecast survive offline reload and time selection');

  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('sun-and-rain', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction('locations', 'readwrite'), store = tx.objectStore('locations');
      const get = store.get('tokyo');
      get.onsuccess = () => {
        const record = get.result;
        record.previous = structuredClone(record.last);
        record.previous.windowStart = -1e20;
        record.previous.windowEnd = -1e20 + 43200;
        store.put(record);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert((await page.locator('#storage-status').textContent()).includes('保存予報を読み取れませんでした'));
  assert.equal(await page.locator('.metric .no-data').count(), 4);
  await setOffline(false);
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#storage-status').textContent === '端末に保存済み');
  assert.equal(await page.locator('.metric .no-data').count(), 0);
  assert((await page.locator('#change-summary').textContent()).includes('次回から'));
  checks.push('malformed saved comparison is rejected without freezing; retry fetches and saves a valid forecast');
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'security-browser-results.json'), JSON.stringify({ browser: browser.version(), viewport: '390x844', forecastAPI: 'mocked', networkOffline: 'BrowserContext.setOffline', checks, errors }, null, 2));
  console.log(`PASS: ${checks.length} security browser scenarios`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
