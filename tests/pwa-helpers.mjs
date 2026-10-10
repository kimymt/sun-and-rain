import assert from 'node:assert/strict';

export async function waitForShell(page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
  const status = await page.evaluate(() => new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = value => { clearTimeout(timer); channel.port1.close(); resolve(value); };
    const timer = setTimeout(() => finish(null), 4000);
    channel.port1.onmessage = event => finish(event.data);
    navigator.serviceWorker.controller.postMessage({ type: 'STATUS' }, [channel.port2]);
  }));
  assert.equal(status?.ready, true, 'The controlling worker must have every shell asset cached');
}
