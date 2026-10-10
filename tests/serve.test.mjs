import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createServer } from '../scripts/serve.mjs';

function request(port, target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let response = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2000, () => socket.destroy(new Error('HTTP response timed out')));
    socket.on('connect', () => socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
    socket.on('data', chunk => { response += chunk; });
    socket.on('end', () => resolve(response));
    socket.on('error', reject);
  });
}

test('malformed request URLs return 400 without stopping the allowlisted local server', async t => {
  const server = createServer();
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  for (const target of ['//[', 'http://[']) {
    assert.match(await request(port, target), /^HTTP\/1\.1 400 /, target);
    const healthy = await request(port, '/');
    assert.match(healthy, /^HTTP\/1\.1 200 /);
    assert(healthy.includes('<html lang="ja">'));
  }
  for (const target of ['/.env', '/scripts/serve.mjs', '/../README.md', '/%2e%2e/README.md']) {
    assert.match(await request(port, target), /^HTTP\/1\.1 404 /, target);
  }
  const asset = await request(port, '/weather.mjs?cache=ignored');
  assert.match(asset, /^HTTP\/1\.1 200 /);
  assert.match(asset, /Content-Type: text\/javascript; charset=utf-8/i);
});
