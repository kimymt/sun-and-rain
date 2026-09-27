import { LOCATION, SOURCES, windowData } from './weather.mjs';

export const METRICS = Object.freeze({
  prob: { source: 'uvpop', label: '降水確率', unit: '%' },
  amount: { source: 'weather', label: '降水量', unit: 'mm' },
  sun: { source: 'weather', label: '日照見込み', unit: '分' },
  uv: { source: 'uvpop', label: 'UV（1時間平均）', unit: '' },
  temp: { source: 'weather', label: '気温', unit: '℃' }
});
const finite = value => typeof value === 'number' && Number.isFinite(value);
const crosses = (a, b, bounds) => bounds.some(t => (a < t && b >= t) || (b < t && a >= t));
export function meaningful(key, before, after) {
  if (!finite(before) || !finite(after)) return false;
  if (key !== 'temp' && (before < 0 || after < 0)) return false;
  if (key === 'prob' && Math.max(before, after) > 100) return false;
  if (key === 'sun' && Math.max(before, after) > 60) return false;
  const diff = Math.abs(after - before);
  switch (key) {
    case 'prob': return (diff >= 20 && Math.max(before, after) >= 40) || (diff >= 10 && crosses(before, after, [40, 60]));
    case 'uv': return diff >= 2 || (diff >= 1 && crosses(before, after, [3, 6, 8, 11]));
    case 'amount': return diff >= .5 || (diff >= .2 && crosses(before, after, [.2]));
    case 'sun': return diff >= 20;
    case 'temp': return diff >= 2;
    default: return false;
  }
}

export function snapshot(sources, view, displayedAt = view.now, location = LOCATION) {
  return structuredClone({ location, displayedAt, windowStart: view.now, windowEnd: view.end, sources });
}

export function compare(previous, current, now) {
  const result = { changes: [], groups: [], onset: null, compared: 0, unavailable: 0, reason: null };
  if (!previous) { result.reason = 'first'; return result; }
  if (previous.location.id !== current.location.id || previous.location.revision !== current.location.revision ||
    previous.location.latitude !== current.location.latitude || previous.location.longitude !== current.location.longitude) {
    result.reason = 'location'; return result;
  }
  const beforeRows = windowData(previous.sources, previous.windowStart, previous.location).rows;
  const afterRows = windowData(current.sources, current.windowStart, current.location).rows;
  const old = new Map(beforeRows.map(row => [row.start, row]));
  const usable = {};
  for (const [id, spec] of Object.entries(SOURCES)) {
    usable[id] = previous.sources[id]?.data?.sourcePolicyId === spec.policy &&
      current.sources[id]?.data?.sourcePolicyId === spec.policy && !current.sources[id]?.error;
  }
  for (const row of afterRows) {
    if (row.start < now || row.start >= previous.windowEnd || row.end <= previous.windowStart) continue;
    const prior = old.get(row.start);
    if (!prior) continue;
    for (const [key, meta] of Object.entries(METRICS)) {
      if (!usable[meta.source] || !finite(prior[key]) || !finite(row[key])) { result.unavailable++; continue; }
      result.compared++;
      if (meaningful(key, prior[key], row[key])) result.changes.push({ key, start: row.start, end: row.end, before: prior[key], after: row[key], direction: row[key] > prior[key] ? 'up' : 'down' });
    }
  }
  // Group adjacent changes for the same metric and direction, retaining exact values.
  for (const key of Object.keys(METRICS)) {
    let group;
    for (const change of result.changes.filter(item => item.key === key)) {
      if (group && group.end === change.start && group.direction === change.direction) {
        group.end = change.end; group.items.push(change);
      } else {
        group = { key, start: change.start, end: change.end, direction: change.direction, items: [change] };
        result.groups.push(group);
      }
    }
  }
  // Start shift only from amount, within a fully comparable common window, with a
  // preceding dry hour on both sides. An ongoing event or data gap is not an onset.
  if (usable.weather) {
    const common = afterRows.filter(row => row.start >= now && row.start >= previous.windowStart && row.end <= previous.windowEnd && row.end <= current.windowEnd && old.has(row.start));
    if (common.length > 1 && common.every(row => finite(row.amount) && finite(old.get(row.start).amount))) {
      const onset = rows => {
        if (rows[0].amount >= .2) return null;
        const wet = rows.find(row => row.amount >= .2);
        return wet?.start ?? null;
      };
      const before = onset(common.map(row => old.get(row.start)));
      const after = onset(common);
      if (before !== null && after !== null && before !== after) result.onset = { before, after };
    }
  }
  if (!result.compared) result.reason = 'no-overlap';
  return result;
}
