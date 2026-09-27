// Contract boundary: API epoch seconds are UTC; timezone conversion is UI-only.
export const LOCATION = Object.freeze({ id: 'tokyo', revision: 1, name: '東京', latitude: 35.6812, longitude: 139.7671 });
export const SOURCES = Object.freeze({
  weather: {
    model: 'best_match', policy: 'open-meteo-best-match-weather-v1', label: '気温・天気・日照など',
    fields: {
      temperature_2m: ['°C', 'temp', 'instant'],
      precipitation: ['mm', 'amount', 'sum'],
      sunshine_duration: ['s', 'sun', 'sum'],
      shortwave_radiation: ['W/m²', 'radiation', 'mean'],
      relative_humidity_2m: ['%', 'humidity', 'instant'],
      wind_speed_10m: ['m/s', 'wind', 'instant'],
      is_day: ['', 'day', 'instant'],
      weather_code: ['wmo code', 'code', 'instant']
    }
  },
  uvpop: {
    model: 'gfs_global', policy: 'open-meteo-gfs-global-uv-pop-v1', label: 'UV・降水確率',
    fields: { uv_index: ['', 'uv', 'mean'], precipitation_probability: ['%', 'prob', 'interpolated-probability'] }
  }
});
const WMO = new Map([
  [0, '快晴'], [1, '晴れ'], [2, '晴れ時々曇り'], [3, '曇り'], [45, '霧'], [48, '着氷性の霧'],
  [51, '弱い霧雨'], [53, '霧雨'], [55, '強い霧雨'], [56, '弱い着氷性の霧雨'], [57, '着氷性の霧雨'],
  [61, '弱い雨'], [63, '雨'], [65, '強い雨'], [66, '弱い着氷性の雨'], [67, '着氷性の雨'],
  [71, '弱い雪'], [73, '雪'], [75, '強い雪'], [77, '霧雪'], [80, '弱いにわか雨'],
  [81, 'にわか雨'], [82, '激しいにわか雨'], [85, '弱いにわか雪'], [86, '強いにわか雪'],
  [95, '雷雨'], [96, 'ひょうを伴う雷雨'], [99, '強いひょうを伴う雷雨']
]);
export const weatherLabel = code => WMO.get(code) ?? '天気データなし';

export function requestURL(source, location = LOCATION) {
  const spec = SOURCES[source];
  if (!spec) throw new Error('Unknown source');
  if (![location.latitude, location.longitude].every(Number.isFinite)) throw new Error('Invalid location');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: location.latitude, longitude: location.longitude,
    models: spec.model, hourly: Object.keys(spec.fields).join(','), forecast_hours: 24,
    timeformat: 'unixtime', timezone: 'Asia/Tokyo', temperature_unit: 'celsius',
    wind_speed_unit: 'ms', precipitation_unit: 'mm' }).toString();
  return url.toString();
}

function validValue(key, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (['prob', 'humidity'].includes(key)) return value >= 0 && value <= 100;
  if (key === 'sun') return value >= 0 && value <= 3600;
  if (key === 'day') return value === 0 || value === 1;
  if (key === 'code') return WMO.has(value);
  return key === 'temp' || value >= 0;
}

export function normalize(body, source, fetchedAt, location = LOCATION) {
  const spec = SOURCES[source];
  if (!spec || body?.error || !Number.isFinite(fetchedAt)) throw new Error('応答形式が不正です');
  const times = body?.hourly?.time;
  if (!Array.isArray(times) || times.length < 1 || body.hourly_units?.time !== 'unixtime') throw new Error('時刻の形式が不正です');
  times.forEach((t, i) => {
    if (!Number.isSafeInteger(t) || t <= 0 || t % 3600 !== 0 || (i && t - times[i - 1] !== 3600)) throw new Error('時刻の順序・間隔が不正です');
  });
  const series = {};
  let missingCount = 0;
  for (const [field, [unit, key, aggregation]] of Object.entries(spec.fields)) {
    const values = body.hourly[field];
    if (body.hourly_units[field] !== unit || !Array.isArray(values) || values.length !== times.length) throw new Error(`${field}の単位・配列長が不正です`);
    series[key] = times.map((time, i) => {
      const value = validValue(key, values[i]) ? values[i] : null;
      if (value === null) missingCount++;
      return { targetTime: time, start: aggregation === 'instant' ? time : time - 3600,
        end: aggregation === 'instant' ? null : time, aggregation, value };
    });
  }
  // An HTTP 200 response with an unrelated time range must not appear fresh.
  if (times[0] > fetchedAt || times.at(-1) < Math.ceil((fetchedAt + 12 * 3600) / 3600) * 3600) throw new Error('必要な予報時間がありません');
  return { source, sourcePolicyId: spec.policy, locationId: location.id, locationRevision: location.revision,
    fetchedAt, modelRunAt: null, requestedModel: spec.model,
    grid: { latitude: body.latitude ?? null, longitude: body.longitude ?? null }, series, missingCount };
}

export async function fetchSource(source, { fetchImpl = fetch, now = () => Date.now() / 1000,
  timeoutMs = 15000, location = LOCATION } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(requestURL(source, location), { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(response.status === 429 ? 'アクセス上限です。時間をおいて再試行してください' : `取得エラー（HTTP ${response.status}）`);
    return normalize(await response.json(), source, Math.floor(now()), location);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('15秒以内に応答がありませんでした');
    if (error instanceof TypeError) throw new Error('通信できませんでした');
    if (error instanceof SyntaxError) throw new Error('応答を読み取れませんでした');
    throw error;
  } finally { clearTimeout(timer); }
}

// A failed source retains only its own earlier data, with its original age.
export async function refreshSources(previous = {}, options = {}) {
  const ids = Object.keys(SOURCES);
  const outcomes = await Promise.allSettled(ids.map(id => fetchSource(id, options)));
  return Object.fromEntries(ids.map((id, i) => [id, outcomes[i].status === 'fulfilled'
    ? { data: outcomes[i].value, error: null }
    : { data: previous[id]?.data ?? null, error: outcomes[i].reason.message }]));
}

export function windowData(sources, now, location = LOCATION) {
  const start = Math.floor(now / 3600) * 3600;
  const end = now + 12 * 3600;
  const rows = [];
  const maps = {};
  for (const [id, spec] of Object.entries(SOURCES)) {
    const data = sources[id]?.data;
    const compatible = data?.locationId === location.id && data?.locationRevision === location.revision && data?.sourcePolicyId === spec.policy;
    for (const [, [, key, aggregation]] of Object.entries(spec.fields)) maps[key] = {
      aggregation, values: new Map((compatible ? data.series[key] : []).map(p => [p.targetTime, p.value]))
    };
  }
  for (let t = start; t < end; t += 3600) {
    const row = { start: t, end: t + 3600 };
    for (const [key, { aggregation, values }] of Object.entries(maps)) row[key] = values.get(aggregation === 'instant' ? t : t + 3600) ?? null;
    // Minutes are a presentation unit. The source retains seconds, unrounded.
    row.sun = row.sun === null ? null : row.sun / 60;
    rows.push(row);
  }
  return { now, start, end, offset: (now - start) / 3600, rows };
}

const timeFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
export const formatTime = epoch => timeFormatter.format(new Date(epoch * 1000));
export const formatDate = epoch => dateFormatter.format(new Date(epoch * 1000));
export const intervalLabel = row => `${formatDate(row.start)} ${formatTime(row.start)}–${formatTime(row.end)}`;
