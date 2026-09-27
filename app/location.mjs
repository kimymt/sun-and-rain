export const SETTINGS_ID = '__settings';

export function nearbyLocations(rows, coords) {
  const { latitude, longitude } = coords;
  if (!validLocation({ id: 'primary', revision: 1, name: '現在地', latitude, longitude })) throw new Error('日本国内の地点を取得できませんでした。地名で検索してください。');
  const rad = n => n * Math.PI / 180;
  return rows.flatMap(row => {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string') return [];
    const candidate = { name: row[1], area: row[0], latitude: row[2], longitude: row[3] };
    if (!validLocation({ ...candidate, id: 'primary', revision: 1 })) return [];
    const a = Math.sin(rad(candidate.latitude - latitude) / 2) ** 2 + Math.cos(rad(latitude)) * Math.cos(rad(candidate.latitude)) * Math.sin(rad(candidate.longitude - longitude) / 2) ** 2;
    const distance = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
    return distance <= 50 ? [{ ...candidate, distance }] : [];
  }).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'ja')).slice(0, 5);
}

export function currentPosition(geolocation = globalThis.navigator?.geolocation) {
  return new Promise((resolve, reject) => {
    if (!geolocation) { reject(new Error('位置情報を利用できません。地名で検索してください。')); return; }
    const timer = setTimeout(() => reject(new Error('現在地の取得がタイムアウトしました。再試行するか、地名で検索してください。')), 15000);
    geolocation.getCurrentPosition(position => { clearTimeout(timer); resolve(position.coords); }, error => {
      clearTimeout(timer);
      reject(new Error(error.code === 1 ? '位置情報が許可されていません。ブラウザの設定を確認するか、地名で検索してください。' : error.code === 3 ? '現在地の取得がタイムアウトしました。再試行するか、地名で検索してください。' : '現在地を取得できませんでした。再試行するか、地名で検索してください。'));
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}
export async function nearbyCandidates({ signal, geolocation, fetchImpl = fetch } = {}) {
  const coords = await currentPosition(geolocation);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const response = await fetchImpl('./cities.json', { signal });
  if (!response.ok) throw new Error('周辺地名を読み込めませんでした。地名で検索してください。');
  const data = await response.json();
  if (!Array.isArray(data.cities)) throw new Error('周辺地名を読み込めませんでした。');
  const candidates = nearbyLocations(data.cities, coords);
  return { candidates, accuracy: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null };
}
export function validLocation(value) {
  return value && ['tokyo', 'primary'].includes(value.id) && Number.isSafeInteger(value.revision) && value.revision > 0 &&
    typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 100 &&
    Number.isFinite(value.latitude) && value.latitude >= 20 && value.latitude <= 46 &&
    Number.isFinite(value.longitude) && value.longitude >= 122 && value.longitude <= 154;
}
export function chooseLocation(candidate, previous) {
  const same = previous.latitude === candidate.latitude && previous.longitude === candidate.longitude;
  const result = { id: same ? previous.id : 'primary', revision: same ? previous.revision : previous.revision + 1,
    name: candidate.name, latitude: candidate.latitude, longitude: candidate.longitude };
  if (!validLocation(result)) throw new Error('地点の座標または名前を確認してください。');
  return result;
}
export async function searchLocations(query, { signal, fetchImpl = fetch } = {}) {
  const name = query.trim();
  if (name.length < 2 || name.length > 80) throw new Error('地名を2〜80文字で入力してください。');
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name, count: '10', language: 'ja', countryCode: 'JP', format: 'json' });
  const response = await fetchImpl(url, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(response.status === 429 ? '検索の上限です。時間をおいて再試行してください。' : '地名を検索できませんでした。再試行してください。');
  const body = await response.json();
  if (body.error || (body.results !== undefined && !Array.isArray(body.results))) throw new Error('検索応答を読み取れませんでした。');
  return (body.results ?? []).filter(item => item.country_code === 'JP' && validLocation({ ...item, id: 'primary', revision: 1 }))
    .slice(0, 10).map(item => ({ name: item.name, latitude: item.latitude, longitude: item.longitude,
      area: [item.admin1, item.admin2].filter(v => typeof v === 'string').join(' / ') }));
}
