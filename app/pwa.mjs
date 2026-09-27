const status = document.getElementById('pwa-status');
const update = document.getElementById('pwa-update');
const connection = document.getElementById('connection-status');
function connectivity() {
  connection.hidden = navigator.onLine;
  connection.textContent = 'オフラインです。保存済みの予報を表示します。最新予報の取得と地名検索には通信が必要です。';
}
addEventListener('online', connectivity);
addEventListener('offline', connectivity);
connectivity();

async function checkReady() {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  const channel = new MessageChannel();
  const timer = setTimeout(() => { channel.port1.close(); status.textContent = 'オフライン起動の準備状況を確認できませんでした。'; }, 4000);
  channel.port1.onmessage = event => {
    clearTimeout(timer); channel.port1.close();
    status.textContent = event.data?.ready ? 'オフライン起動の準備ができました。' : 'オフライン用データが不足しています。通信できる状態で開き直してください。';
  };
  controller.postMessage({ type: 'STATUS' }, [channel.port2]);
}
async function register() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    status.textContent = 'この環境ではオフライン起動を準備できません。HTTPSで開いてください。'; return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', checkReady);
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    const waiting = () => { update.hidden = !registration.waiting; };
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        waiting();
        if (worker.state === 'installed' && navigator.serviceWorker.controller) update.hidden = false;
        if (worker.state === 'redundant') status.textContent = '更新の準備に失敗しました。現在の版を引き続き使えます。';
      });
    });
    waiting(); checkReady();
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      checkReady();
      if (navigator.onLine && Date.now() - lastCheck > 3600000) { lastCheck = Date.now(); registration.update().catch(() => {}); }
    });
  } catch { status.textContent = 'オフライン起動の準備に失敗しました。通信できる状態で開き直してください。'; }
}
register();
