import './pwa.mjs';
import { LOCATION, SOURCES, refreshSources, windowData, weatherLabel, formatTime, formatDate, intervalLabel } from './weather.mjs';
import { METRICS, compare, snapshot } from './comparison.mjs';
import { openStore, restoreRecord } from './storage.mjs';
import { SETTINGS_ID, validLocation, chooseLocation, searchLocations, nearbyCandidates } from './location.mjs';
let location = LOCATION, locationGeneration = 0;

const $ = id => document.getElementById(id);
const colors = { prob: 'var(--rain)', amount: 'var(--rain)', sun: 'var(--sun)', uv: 'var(--uv)', temp: 'var(--temp)' };
const tracks = [['prob', '雨', '確率 %'], ['amount', '降水量', 'mm / 時'], ['sun', '日照', '分 / 時'], ['uv', 'UV', '1時間平均'], ['temp', '気温', '℃・正時']];
const round = (value, digits = 1) => value == null ? 'データなし' : String(Number(value.toFixed(digits)));
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let sources = {}, selected = 0, busy = false, lastAttempt = 0;
let manualUntil = 0, claimingRefresh = false;
const refreshChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('sun-and-rain-refresh') : null;
if (refreshChannel) refreshChannel.onmessage = event => {
  if (Number.isFinite(event.data?.until)) { manualUntil = Math.max(manualUntil, event.data.until); renderStatus(); }
};
let store = null, lastDisplayed = null, comparisonBase = null, canRecord = false, ready = false;
let comparison = { changes: [], groups: [], onset: null, reason: 'first' };
let displayGeneration = 0, saveQueue = Promise.resolve();
let view = windowData(sources, Date.now() / 1000, location);
const x = hour => (hour - view.offset) / 12 * 100;
const changeFor = (key, start) => comparison.changes.find(item => item.key === key && item.start === start);
const changeText = change => `${METRICS[change.key].label} ${round(change.before)}${METRICS[change.key].unit} → ${round(change.after)}${METRICS[change.key].unit}`;

function recordAfterPaint() {
  const generation = ++displayGeneration;
  if (!canRecord || document.visibilityState !== 'visible') return;
  // Two animation frames separate DOM construction from accepting it as displayed.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (generation !== displayGeneration || document.visibilityState !== 'visible') return;
    const current = snapshot(sources, view, Date.now() / 1000, location);
    lastDisplayed = current;
    if (!store) return;
    const record = { schemaVersion: 1, location: current.location, last: current, previous: comparisonBase };
    saveQueue = saveQueue.then(async () => {
      try {
        const outcome = await store.write(record);
        if (record.location.id !== location.id || record.location.revision !== location.revision) return;
        $('storage-status').textContent = outcome === 'saved' ? '端末に保存済み' : outcome === 'newer'
          ? '別の画面の新しい保存予報を保持しています。' : '保存形式が対応外のため、端末保存を停止しました。';
        if (outcome === 'unsupported') { store.close(); store = null; }
      } catch { $('storage-status').textContent = '端末に保存できませんでした。この画面内でのみ予報を保持します。'; $('fetch-details').open = true; }
    });
  }));
}

function renderChanges() {
  comparison = compare(comparisonBase, snapshot(sources, view, view.now, location), view.now);
  $('comparison-time').textContent = comparisonBase ? `前回 ${formatDate(comparisonBase.displayedAt)} ${formatTime(comparisonBase.displayedAt)}表示` : '';
  let text = comparison.reason === 'first' ? '次回から、今回の予報との変化を表示します。' : comparison.reason
    ? '前回の予報と比較できるデータがありません。' : comparison.groups.length
      ? comparison.groups.slice(0, 3).map(group => `${formatTime(group.start)}–${formatTime(group.end)} ${METRICS[group.key].label}が${['sun', 'amount'].includes(group.key) ? (group.direction === 'up' ? '増加' : '減少') : (group.direction === 'up' ? '上昇' : '低下')}`).join(' / ')
      : '前回見た予報から、大きな変化はありません。';
  if (comparison.onset) text = `降水量から見た降り始めの見込み：${formatTime(comparison.onset.before)}台 → ${formatTime(comparison.onset.after)}台。 ${text}`;
  if (comparison.unavailable) text += ' 欠損・取得失敗などで比較できない項目があります。';
  $('change-summary').textContent = text;
  $('all-changes').hidden = !comparison.changes.length;
  $('change-list').innerHTML = comparison.changes.map(change => `<p>${intervalLabel(change)}：${changeText(change)}</p>`).join('');
}

function plot(key) {
  const values = view.rows.map(row => row[key]);
  const finite = values.filter(v => v !== null);
  const min = key === 'temp' ? Math.floor(Math.min(...finite, 15) / 5) * 5 : 0;
  const max = key === 'temp' ? Math.ceil(Math.max(...finite, min + 10) / 5) * 5
    : key === 'prob' ? 100 : key === 'sun' ? 60 : Math.max(key === 'uv' ? 11 : 3, ...finite);
  const y = value => 49 - (value - min) / (max - min) * 40;
  let content = `<defs><pattern id="missing-${key}" width="3" height="7" patternUnits="userSpaceOnUse"><path d="M0 7L3 0" stroke="var(--missing)" stroke-width=".45"/></pattern></defs>`;
  view.rows.forEach((row, i) => {
    const left = x(i);
    if (row.day === 0) content += `<rect x="${left}" y="0" width="${100 / 12}" height="56" fill="var(--night)"/>`;
    if (row[key] === null) content += `<rect data-missing="true" x="${left}" y="5" width="${100 / 12}" height="47" fill="url(#missing-${key})"/>`;
    if (changeFor(key, row.start)) content += `<path data-changed="true" d="M${left + 1} 3H${left + 100 / 12 - 1}" stroke="var(--changed)" stroke-width="1.6" stroke-dasharray="2 1"/>`;
    content += `<path d="M${left} 0V56" stroke="var(--grid)" stroke-width=".25"/>`;
  });
  content += `<path class="mid-guide" d="M0 ${y((min + max) / 2)}H100" fill="none" stroke="var(--muted)" stroke-opacity=".35" stroke-width="1" stroke-dasharray="1 3" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  content += `<rect x="${x(selected)}" y="0" width="${100 / 12}" height="56" fill="var(--ink)" opacity=".07"/><path d="M${x(selected + .5)} 0V56" stroke="var(--ink)" stroke-width=".4" stroke-dasharray="1 1"/>`;
  if (['prob', 'temp'].includes(key)) {
    let path = '', drawing = false;
    values.forEach((v, i) => {
      if (v === null) { drawing = false; return; }
      path += `${drawing ? 'L' : 'M'}${x(i + (key === 'temp' ? 0 : .5))},${y(v)} `;
      drawing = true;
    });
    content += `<path d="${path}" fill="none" stroke="${colors[key]}" stroke-width="1.4" stroke-linejoin="round"/>`;
    values.forEach((v, i) => { if (v !== null) content += `<circle cx="${x(i + (key === 'temp' ? 0 : .5))}" cy="${y(v)}" r=".65" fill="${colors[key]}"/>`; });
  } else {
    values.forEach((v, i) => { if (v > 0) content += `<rect x="${x(i) + 1.2}" y="${y(v)}" width="${100 / 12 - 2.4}" height="${v / max * 40}" rx=".6" fill="${colors[key]}" opacity=".85"/>`; });
  }
  const ticks = [max, (min + max) / 2, min];
  const suffix = key === 'temp' ? '°' : key === 'prob' ? '%' : '';
  return `<svg viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true" style="overflow:hidden">${content}</svg>${ticks.map((value, index) => `<span class="scale" data-tick="${index}" style="top:${y(value) / 56 * 100}%">${round(value, 2)}${suffix}</span>`).join('')}`;
}

function renderTracks() {
  $('tracks').innerHTML = tracks.map(([key, label, unit]) => `<div class="track"><div class="track-label">${label}<small>${unit}</small></div><div class="plot" data-metric="${key}">${plot(key)}</div></div>`).join('');
  $('tracks').querySelectorAll('.plot').forEach(el => el.addEventListener('click', event => {
    const rect = el.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / (rect.width - 22)));
    select(Math.min(view.rows.length - 1, Math.floor(view.offset + fraction * 12)));
  }));
}

function select(index) {
  selected = Math.max(0, Math.min(view.rows.length - 1, index));
  const row = view.rows[selected];
  $('selected-heading').textContent = intervalLabel(row);
  $('hour-selector').max = view.rows.length - 1;
  $('hour-selector').value = selected;
  $('hour-selector').setAttribute('aria-valuetext', intervalLabel(row));
  $('previous').disabled = selected === 0;
  $('next').disabled = selected === view.rows.length - 1;
  const metrics = [['降水確率', 'prob', '%'], ['降水量 / 1時間', 'amount', 'mm'], ['日照見込み / 1時間', 'sun', '分'], ['UV / 1時間平均', 'uv', '']];
  $('selection-content').innerHTML = `<p class="weather-description">${formatTime(row.start)}の予報：${weatherLabel(row.code)} <strong>${round(row.temp)}${row.temp === null ? '' : '℃'}</strong></p><dl class="metric-grid">${metrics.map(([label, key, unit]) => `<div class="metric"><dt>${label}</dt><dd${row[key] === null ? ' class="no-data"' : ''}>${round(row[key], key === 'sun' ? 0 : 1)}<small>${row[key] === null ? '' : unit}</small></dd></div>`).join('')}</dl><p class="supplement">${formatTime(row.start)}の湿度 ${round(row.humidity)}${row.humidity === null ? '' : '%'} · 風速 ${round(row.wind)}${row.wind === null ? '' : ' m/s'}</p><p class="interval-note">降水・日照・UVは${intervalLabel(row)}全体の値です。${row.start < view.now || row.end > view.end ? '表示範囲外の時間も含むため、残り時間だけの値ではありません。' : ''}</p>`;
  const selectedChanges = comparison.changes.filter(item => item.start === row.start);
  if (selectedChanges.length) $('selection-content').insertAdjacentHTML('beforeend', `<div class="selected-changes"><p>前回の表示から</p>${selectedChanges.map(item => `<p>${changeText(item)}</p>`).join('')}</div>`);
  // Preserve nodes (and keyboard focus on controls) when selecting a time.
  $('tracks').querySelectorAll('.plot').forEach(el => { el.innerHTML = plot(el.dataset.metric); });
}

function renderStatus() {
  const available = Object.values(sources).filter(item => item.data).length;
  const errors = Object.values(sources).filter(item => item.error).length;
  if (errors) $('fetch-details').open = true;
  $('request-status').textContent = busy || claimingRefresh ? '予報を取得しています。' : !lastAttempt ? (available ? '保存予報を表示しています。最新予報を確認します。' : '取得を開始します。') : available === 0 ? '予報を取得できませんでした。通信を確認して再試行してください。'
    : errors === Object.keys(SOURCES).length ? '最新予報を取得できませんでした。保存した予報を表示しています。'
    : errors ? '一部の取得に失敗しました。取得元ごとの時刻を確認してください。' : '予報を取得しました。';
  $('source-status').innerHTML = Object.entries(SOURCES).map(([id, spec]) => {
    const state = sources[id];
    const stamp = state?.data ? `${formatDate(state.data.fetchedAt)} ${formatTime(state.data.fetchedAt)}取得` : '未取得';
    return `<p data-source="${id}">${spec.label}：${stamp}${state?.error ? ` · ${escape(state.error)}${state.data ? '（以前の取得値を表示）' : ''}` : ''}</p>`;
  }).join('');
  const dates = Object.values(sources).flatMap(item => item.data ? [item.data.fetchedAt] : []);
  $('freshness').textContent = dates.length ? `${formatTime(Math.min(...dates))}〜取得` : 'データなし';
  const stale = dates.some(time => view.now - time >= 3600);
  $('stale-notice').hidden = !stale;
  $('stale-notice').textContent = '1時間以上前に取得した項目があります。最新の予報を反映していない可能性があります。';
  $('refresh').disabled = busy || !ready || claimingRefresh || Date.now() < manualUntil;
  $('refresh').textContent = busy || claimingRefresh ? '取得中…' : Date.now() < manualUntil ? '更新は1回/h' : available === 0 || errors ? '再試行' : '予報を更新';
}

function render() {
  $('location-name').textContent = location.name;
  const previousTime = view.rows[selected]?.start;
  view = windowData(sources, Date.now() / 1000, location);
  selected = Math.max(0, view.rows.findIndex(row => row.start === previousTime));
  $('ticks').innerHTML = [view.offset, 2, 4, 6, 8, 10, 12 + view.offset].map((hour, i) => {
    const time = formatTime(view.start + hour * 3600);
    return `<span class="tick" style="left:${x(hour)}%">${i === 0 ? '今' : i === 6 ? time : `${Number(time.split(':')[0])}時`}</span>`;
  }).join('');
  renderChanges();
  renderTracks();
  select(selected);
  renderStatus();
  recordAfterPaint();
}

async function refresh() {
  if (busy || !ready) return;
  const generation = locationGeneration;
  const requestedLocation = location;
  busy = true;
  lastAttempt = Date.now();
  renderStatus();
  try {
    const next = await refreshSources(sources, { location: requestedLocation });
    if (generation !== locationGeneration) return;
    comparisonBase = lastDisplayed;
    sources = next;
    canRecord = Object.values(next).some(state => state.data && !state.error);
  }
  finally { if (generation === locationGeneration) { busy = false; render(); } }
}

let searchController = null, draftLocation = null, searchGeneration = 0;
function stopSearch() { searchGeneration++; searchController?.abort(); $('nearby-location').disabled = false; }
$('edit-location').addEventListener('click', () => {
  stopSearch(); draftLocation = null;
  $('location-query').value = ''; $('location-results').replaceChildren();
  $('search-status').textContent = ''; $('location-preview').textContent = '';
  $('confirm-location').disabled = true;
  $('location-dialog').showModal(); $('location-query').focus();
});
$('cancel-location').addEventListener('click', () => $('location-dialog').close());
$('location-dialog').addEventListener('close', stopSearch);
$('location-query').addEventListener('input', () => {
  stopSearch(); draftLocation = null; $('confirm-location').disabled = true;
  $('location-results').replaceChildren(); $('location-preview').textContent = ''; $('search-status').textContent = '';
});
function showCandidates(candidates) {
  for (const candidate of candidates) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'location-candidate';
    button.textContent = `${candidate.name} / ${candidate.area}${Number.isFinite(candidate.distance) ? ` · 代表地点まで約${candidate.distance.toFixed(1)}km` : ''}`;
    button.addEventListener('click', () => {
      draftLocation = candidate;
      $('location-preview').textContent = `選択: ${button.textContent}`;
      $('confirm-location').disabled = false;
    });
    $('location-results').append(button);
  }
}
$('nearby-location').addEventListener('click', async () => {
  stopSearch();
  const generation = searchGeneration;
  searchController = new AbortController();
  const controller = searchController;
  const timer = setTimeout(() => controller.abort(), 20000);
  draftLocation = null; $('confirm-location').disabled = true;
  $('nearby-location').disabled = true;
  $('location-results').replaceChildren(); $('location-preview').textContent = '';
  $('search-status').textContent = '現在地から周辺の地名を探しています。';
  try {
    const { candidates, accuracy } = await nearbyCandidates({ signal: controller.signal });
    if (generation !== searchGeneration) return;
    $('search-status').textContent = candidates.length ? `近い順に${candidates.length}件。${accuracy === null ? '' : `現在地の推定誤差は約${accuracy}m。`}予報に使うのは選んだ地域の代表地点です。` : '50km以内の地名候補がありません。地名で検索してください。';
    showCandidates(candidates);
  } catch (error) {
    if (generation === searchGeneration) $('search-status').textContent = controller.signal.aborted ? '周辺地名の取得がタイムアウトしました。地名で検索してください。' : error.message;
  } finally { clearTimeout(timer); if (generation === searchGeneration) $('nearby-location').disabled = false; }
});
$('location-search').addEventListener('submit', async event => {
  event.preventDefault(); stopSearch();
  const generation = searchGeneration;
  searchController = new AbortController();
  const controller = searchController;
  const timer = setTimeout(() => controller.abort(), 10000);
  draftLocation = null; $('confirm-location').disabled = true;
  $('location-results').replaceChildren(); $('location-preview').textContent = '';
  $('search-status').textContent = '検索しています。';
  try {
    const candidates = await searchLocations($('location-query').value, { signal: controller.signal });
    if (generation !== searchGeneration) return;
    $('search-status').textContent = candidates.length ? `${candidates.length}件。地域名を確認して選択してください。` : '候補がありません。市区町村名を省略せず入力するか、ローマ字で検索してください。';
    showCandidates(candidates);
  } catch {
    if (generation === searchGeneration) $('search-status').textContent = controller.signal.aborted ? '検索がタイムアウトしました。再試行してください。' : '検索できませんでした。通信と地名を確認して再試行してください。';
  } finally { clearTimeout(timer); }
});
$('confirm-location').addEventListener('click', async () => {
  if (!draftLocation) return;
  const next = chooseLocation(draftLocation, location);
  $('confirm-location').disabled = true;
  draftLocation = null; stopSearch(); $('location-dialog').close();
  locationGeneration++; displayGeneration++; ready = false; canRecord = false; busy = false;
  await saveQueue;
  let notice = '';
  if (store) {
    try {
      const outcome = await store.write({ schemaVersion: 1, location: { id: SETTINGS_ID }, active: next });
      if (outcome !== 'saved') notice = '地点を保存できません。この画面内でのみ変更します。';
    } catch { notice = '地点を保存できません。この画面内でのみ変更します。'; }
  } else notice = '地点を保存できません。この画面内でのみ変更します。';
  const same = next.id === location.id && next.revision === location.revision;
  location = next;
  if (!same) { sources = {}; lastDisplayed = null; comparisonBase = null; selected = 0; }
  lastAttempt = 0;
  $('location-notice').textContent = notice;
  $('storage-status').textContent = notice || '地点を保存しました。予報を取得します。';
  ready = true; render(); refresh();
});

$('refresh').addEventListener('click', async () => {
  if (busy || !ready || claimingRefresh || Date.now() < manualUntil) return;
  claimingRefresh = true; renderStatus();
  let allowed = true;
  try {
    if (store) {
      const claim = await store.claimManualRefresh(Date.now());
      manualUntil = claim.until; allowed = claim.allowed;
    } else manualUntil = Date.now() + 3600000;
  } catch {
    manualUntil = Date.now() + 3600000;
    $('location-notice').textContent = '更新時刻を保存できませんでした。この画面で1時間の制限を適用します。';
  }
  claimingRefresh = false;
  refreshChannel?.postMessage({ until: manualUntil });
  renderStatus();
  if (allowed) refresh();
});
$('previous').addEventListener('click', () => select(selected - 1));
$('next').addEventListener('click', () => select(selected + 1));
$('hour-selector').addEventListener('input', event => select(Number(event.target.value)));
function foregroundTick() {
  if (!ready || document.visibilityState !== 'visible') return;
  render();
  if (Date.now() - lastAttempt >= 30 * 60 * 1000) refresh();
}
document.addEventListener('visibilitychange', foregroundTick);
setInterval(foregroundTick, 60 * 1000);
render();
try {
  store = await openStore();
  const refreshRecord = await store.read('__manual-refresh');
  if (refreshRecord?.schemaVersion === 1 && Number.isFinite(refreshRecord.until)) manualUntil = refreshRecord.until;
  const settings = await store.read(SETTINGS_ID);
  if (settings && settings.schemaVersion !== 1) throw new Error('Unsupported settings');
  if (validLocation(settings?.active)) location = settings.active;
  else if (settings) $('location-notice').textContent = '保存地点を読み取れないため東京を表示します。地点を設定し直してください。';
  const restored = restoreRecord(await store.read(location.id), Date.now() / 1000, location);
  if (restored.record?.last) {
    lastDisplayed = restored.record.last;
    comparisonBase = restored.record.previous;
    sources = lastDisplayed.sources;
  }
  $('storage-status').textContent = restored.notice ?? (lastDisplayed ? '端末の保存予報を読み込みました。' : '予報を表示した後に端末へ保存します。');
  if (restored.notice) $('fetch-details').open = true;
  if (restored.unsupported) { store.close(); store = null; }
} catch { store?.close(); store = null; $('storage-status').textContent = '端末保存を利用できません。この画面内でのみ予報を保持します。'; $('fetch-details').open = true; }
ready = true;
render();
refresh();
