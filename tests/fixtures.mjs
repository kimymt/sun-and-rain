import { SOURCES } from '../app/weather.mjs';
export const NOW = Date.parse('2026-09-27T10:35:00+09:00') / 1000;
export function responseFixture(source, now = NOW) {
  const start = Math.floor(now / 3600) * 3600;
  const values = { temp: 23, amount: .6, sun: 1800, radiation: 200, humidity: 64, wind: 2.5, day: 1, code: 3, uv: 4, prob: 60 };
  const hourly = { time: Array.from({ length: 24 }, (_, i) => start + i * 3600) };
  const hourly_units = { time: 'unixtime' };
  for (const [field, [unit, key]] of Object.entries(SOURCES[source].fields)) {
    hourly_units[field] = unit;
    hourly[field] = hourly.time.map((_, i) => key === 'temp' ? 23 + i / 10 : values[key]);
  }
  return { latitude: 35.7, longitude: 139.7, utc_offset_seconds: 32400, timezone: 'Asia/Tokyo', hourly, hourly_units };
}
