import { LOCATION, SOURCES } from './weather.mjs';
export const DB_NAME = 'sun-and-rain';
export const STORE_NAME = 'locations';
export const RETENTION_SECONDS = 48 * 3600;
const finite = v => typeof v === 'number' && Number.isFinite(v);

// Persisted records are input, not trusted application state.
export function validSnapshot(value, location) {
  if (!value || value.location?.id !== location.id || value.location?.revision !== location.revision ||
    value.location.latitude !== location.latitude || value.location.longitude !== location.longitude ||
    !finite(value.displayedAt) || !finite(value.windowStart) || value.windowEnd !== value.windowStart + 43200 ||
    value.displayedAt < value.windowStart || !value.sources || typeof value.sources !== 'object') return false;
  for (const [id, spec] of Object.entries(SOURCES)) {
    const state = value.sources[id];
    if (!state) continue;
    if (state.error !== null && typeof state.error !== 'string') return false;
    const data = state.data;
    if (data === null) continue;
    if (!data || data.source !== id || data.locationId !== location.id || data.locationRevision !== location.revision ||
      data.sourcePolicyId !== spec.policy || !finite(data.fetchedAt) || data.fetchedAt > value.displayedAt + 1 || !data.series) return false;
    for (const [, [, key, aggregation]] of Object.entries(spec.fields)) {
      const points = data.series[key];
      if (!Array.isArray(points) || points.length < 1 || points.length > 48) return false;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (!p || !Number.isSafeInteger(p.targetTime) || p.targetTime <= 0 || p.targetTime % 3600 !== 0 ||
          (i && p.targetTime - points[i - 1].targetTime !== 3600) || p.aggregation !== aggregation ||
          p.start !== (aggregation === 'instant' ? p.targetTime : p.targetTime - 3600) ||
          p.end !== (aggregation === 'instant' ? null : p.targetTime) ||
          (p.value !== null && !finite(p.value))) return false;
        if (p.value !== null && ((key !== 'temp' && p.value < 0) ||
          (['prob', 'humidity'].includes(key) && p.value > 100) || (key === 'sun' && p.value > 3600) ||
          (key === 'day' && ![0, 1].includes(p.value)))) return false;
      }
    }
  }
  return true;
}

export function restoreRecord(record, now, location = LOCATION) {
  if (!record) return { record: null, notice: null };
  if (record.schemaVersion !== 1) return { record: null, notice: '保存形式が対応外のため、この画面では端末保存を停止します。', unsupported: true };
  if (record.location?.id !== location.id || record.location?.revision !== location.revision ||
    record.location?.latitude !== location.latitude || record.location?.longitude !== location.longitude ||
    !validSnapshot(record.last, location) || (record.previous && !validSnapshot(record.previous, location))) {
    return { record: null, notice: '保存予報を読み取れませんでした。最新予報から保存をやり直します。' };
  }
  const expired = s => !s || s.displayedAt > now + 300 || now - s.displayedAt > RETENTION_SECONDS ||
    Object.values(s.sources).some(state => state.data && (now - state.data.fetchedAt > RETENTION_SECONDS || state.data.fetchedAt > now + 300));
  if (expired(record.last)) return { record: { schemaVersion: 1, location, last: null, previous: null }, notice: '保存予報の期限が切れたため、新しい予報を取得します。' };
  return { record: { ...record, previous: expired(record.previous) ? null : record.previous }, notice: null };
}

export function openStore(factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('このブラウザでは端末保存を利用できません。')); return; }
    let done = false;
    const fail = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error('端末保存を利用できません。この画面内でのみ予報を保持します。')); } };
    const timer = setTimeout(fail, 2500);
    let request;
    try { request = factory.open(DB_NAME, 1); } catch { fail(); return; }
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'location.id' }); };
    request.onerror = fail;
    request.onblocked = fail;
    request.onsuccess = () => {
      const db = request.result;
      if (done) { db.close(); return; }
      done = true; clearTimeout(timer);
      db.onversionchange = () => db.close();
      const transact = (mode, action) => new Promise((yes, no) => {
        let tx, result;
        const timer = setTimeout(() => { try { tx?.abort(); } catch {} no(new Error('保存処理が完了しませんでした。')); }, 2500);
        try {
          tx = db.transaction(STORE_NAME, mode);
          tx.oncomplete = () => { clearTimeout(timer); yes(result); };
          tx.onabort = tx.onerror = () => { clearTimeout(timer); no(new Error('端末への保存・読み込みに失敗しました。')); };
          action(tx.objectStore(STORE_NAME), value => { result = value; });
        } catch { clearTimeout(timer); no(new Error('端末保存を利用できません。')); }
      });
      resolve({
        read: id => transact('readonly', (store, set) => { const req = store.get(id); req.onsuccess = () => set(req.result ?? null); }),
        claimManualRefresh: now => transact('readwrite', (store, set) => {
          const req = store.get('__manual-refresh');
          req.onsuccess = () => {
            const old = req.result;
            if (old && old.schemaVersion !== 1) { store.transaction.abort(); return; }
            const until = Number.isFinite(old?.until) ? old.until : 0;
            if (until > now) { set({ allowed: false, until }); return; }
            const next = now + 3600000;
            try {
              store.put({ schemaVersion: 1, location: { id: '__manual-refresh' }, until: next });
              set({ allowed: true, until: next });
            } catch { store.transaction.abort(); }
          };
        }),
        write: record => transact('readwrite', (store, set) => {
          const req = store.get(record.location.id);
          req.onsuccess = () => {
            const old = req.result;
            // Read/check/write is atomic across tabs. Do not overwrite a future schema.
            if (old && old.schemaVersion !== 1) { set('unsupported'); return; }
            if (old?.last && validSnapshot(old.last, record.location) && record.last &&
              (old.last.displayedAt > record.last.displayedAt || Object.keys(SOURCES).some(id =>
                (old.last.sources[id]?.data?.fetchedAt ?? 0) > (record.last.sources[id]?.data?.fetchedAt ?? 0)))) { set('newer'); return; }
            try { store.put(record); set('saved'); }
            catch { store.transaction.abort(); }
          };
        }),
        close: () => db.close()
      });
    };
  });
}
