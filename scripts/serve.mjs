import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const app = fileURLToPath(new URL('../app/', import.meta.url));
const allowed = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/app.mjs', 'app.mjs'], ['/weather.mjs', 'weather.mjs'], ['/comparison.mjs', 'comparison.mjs'], ['/storage.mjs', 'storage.mjs'], ['/location.mjs', 'location.mjs'], ['/style.css', 'style.css'], ...['cities.json', 'pwa.mjs', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].map(file => ['/' + file, file])]);
export function createServer() {
  return http.createServer(async (req, res) => {
    const file = allowed.get(new URL(req.url, 'http://localhost').pathname);
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const content = await readFile(path.join(app, file));
      res.writeHead(200, { 'Content-Type': file.endsWith('.json') ? 'application/json' : file.endsWith('.png') ? 'image/png' : file.endsWith('.webmanifest') ? 'application/manifest+json' : (file.endsWith('.mjs') || file.endsWith('.js')) ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(content);
    } catch { res.writeHead(500); res.end('Unable to read file'); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('./build-sw.mjs');
  const port = Number(process.env.PORT ?? 4173);
  createServer().listen(port, '127.0.0.1', () => console.log(`Sun & Rain: http://127.0.0.1:${port}`));
}
