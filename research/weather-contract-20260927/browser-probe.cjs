// Research harness only. No application UI or production code.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2]);
const urls = [
  'https://api.open-meteo.com/v1/forecast?latitude=35.68&longitude=139.76&hourly=uv_index,precipitation_probability&models=gfs_global&forecast_hours=24&timeformat=unixtime&timezone=Asia%2FTokyo',
  'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=35.68&longitude=139.76&hourly=uv_index&domains=cams_global&forecast_hours=24&timeformat=unixtime&timezone=Asia%2FTokyo'
];
(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Weather API contract probe</title><p>Research transport test only</p>');
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    const results = await page.evaluate(async urls => Promise.all(urls.map(async url => {
      try {
        const response = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000) });
        const body = await response.json();
        return { url, status: response.status, type: response.type, body };
      } catch (error) { return { url, error: String(error) }; }
    })), urls);
    const record = { fetchedAt: new Date().toISOString(), origin, browser: browser.version(), results };
    fs.writeFileSync(path.join(__dirname, 'browser-results.json'), JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify({ origin, browser: record.browser, results: results.map(({body,...r}) => ({...r, rows:body?.hourly?.time?.length})) }, null, 2));
    if (results.some(r => r.status !== 200 || r.type !== 'cors' || r.body?.hourly?.time?.length !== 24)) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
