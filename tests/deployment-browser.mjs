import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const url = new URL(process.argv[3]);
const out = process.env.VERIFICATION_OUT ?? 'docs/verification/deployment-20260927';
await mkdir(out, { recursive: true });
const label = url.protocol === 'https:' ? 'production' : 'local';
const browser = await chromium.launch({ headless: true });
const evidence = { url: url.href, checkedAt: new Date().toISOString(), assets: [], errors: [], violations: [], network: [] };
const hash = data => createHash('sha256').update(data).digest('hex');
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 35.6812, longitude: 139.7671, accuracy: 30 } });
  for (const file of await readdir('app')) {
    if (file.startsWith('_') || file === '404.html') continue;
    const response = await context.request.get(new URL(file === 'index.html' ? './' : file, url).href, { maxRedirects: 0 });
    assert.equal(response.status(), 200, file);
    assert.equal(hash(await response.body()), hash(await readFile(`app/${file}`)), file);
    assert.equal(response.headers()['x-content-type-options'], 'nosniff');
    evidence.assets.push({ file, status: response.status(), sha256: hash(await response.body()) });
  }
  for (const path of ['README.md', 'wrangler.jsonc', '.env', '_headers', 'research/']) {
    const response = await context.request.get(new URL(path, url).href, { maxRedirects: 0 });
    assert.equal(response.status(), 404, path);
  }
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', e => window.cspViolations.push({ directive: e.violatedDirective, uri: e.blockedURI }));
  });
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('api.open-meteo.com')) evidence.network.push({ url: response.url(), status: response.status() });
  });
  const response = await page.goto(url.href);
  evidence.headers = response.headers();
  assert(evidence.headers['content-security-policy'].includes("script-src 'self'"));
  assert.equal(await page.locator('footer a', { hasText: 'GitHub' }).getAttribute('href'), 'https://github.com/kimymt/sun-and-rain');
  await page.waitForFunction(() => document.querySelector('#request-status').textContent === '予報を取得しました。');
  await page.waitForFunction(() => document.querySelector('#storage-status').textContent === '端末に保存済み');
  await page.waitForFunction(() => document.querySelector('#pwa-status').textContent === 'オフライン起動の準備ができました。');
  assert.equal(await page.locator('#refresh-notice, .rain-explanation span, .rain-explanation br').count(), 0);
  assert((await page.locator('.rain-explanation').textContent()).includes('1㎡あたり1リットル'));
  await page.getByRole('button', { name: '地点を変更', exact: true }).click();
  await page.getByLabel('地名', { exact: true }).fill('札幌市');
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await page.locator('.location-candidate').first().waitFor();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  assert(evidence.headers['permissions-policy'].includes('geolocation=(self)'));
  await page.getByRole('button', { name: '地点を変更', exact: true }).click();
  await page.locator('#nearby-location').click();
  await page.locator('.location-candidate').first().waitFor();
  assert.equal(await page.locator('.location-candidate').count(), 5);
  evidence.gps = 'simulated Tokyo coordinates: five nearby municipality candidates';
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  assert(await page.locator('.metric dd').first().textContent() !== 'データなし');
  evidence.online = await page.locator('#request-status').textContent();
  evidence.violations.push(...await page.evaluate(() => window.cspViolations));
  assert.deepEqual(evidence.violations, []);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${out}/${label}-online.png`, fullPage: true });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#request-status').textContent.includes('保存した予報'));
  assert(!(await page.locator('.metric dd').first().textContent()).includes('データなし'));
  assert(await page.locator('#connection-status').isVisible());
  evidence.offline = await page.locator('#request-status').textContent();
  evidence.caches = await page.evaluate(() => caches.keys());
  evidence.violations.push(...await page.evaluate(() => window.cspViolations));
  assert.deepEqual(evidence.errors, []);
  assert.deepEqual(evidence.violations, []);
  assert(evidence.network.filter(r => r.status === 200).length >= 3);
  await page.screenshot({ path: `${out}/${label}-offline.png`, fullPage: true });
  evidence.pass = true;
  console.log(`PASS ${label}: asset hashes, headers, private paths, live API/search, storage and offline reload`);
} finally {
  await writeFile(`${out}/${label}-results.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
}
