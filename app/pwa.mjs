const connection = document.getElementById('connection-status');
function connectivity() {
  connection.hidden = navigator.onLine;
  connection.textContent = 'オフラインです。保存済みの予報を表示します。最新予報の取得と地名検索には通信が必要です。';
}
addEventListener('online', connectivity);
addEventListener('offline', connectivity);
connectivity();

async function register() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (navigator.onLine && Date.now() - lastCheck > 3600000) { lastCheck = Date.now(); registration.update().catch(() => {}); }
    });
  } catch { /* Forecasts remain usable when offline setup is unavailable. */ }
}
register();
