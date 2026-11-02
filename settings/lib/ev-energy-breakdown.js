'use strict';
// Subdivision of the EXISTING Savings interval, not an independent recorder.
const FIELDS = ['kwh','pvKwh','gridKwh','batteryKwh','unknownKwh','estimatedKwh',
  'gridCost','solarValue','solarSavings','unpricedKwh','missingSeconds'];
const number = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const empty = () => ({ kwh: 0, pvKwh: 0, gridKwh: 0, batteryKwh: 0, unknownKwh: 0,
  estimatedKwh: 0, gridCost: 0, solarValue: 0, solarSavings: 0, unpricedKwh: 0, missingSeconds: 0 });
function normalize(raw) {
  if (!raw || raw.version !== 1) return null;
  const metric = src => Object.fromEntries(FIELDS.map(k => [k, ['gridCost','solarValue','solarSavings'].includes(k)
    ? number(src?.[k]) : Math.max(0, number(src?.[k]))]));
  return { version: 1, seconds: Math.max(0, number(raw.seconds)), sharedKwh: Math.max(0, number(raw.sharedKwh)),
    total: metric(raw.total), byId: Object.fromEntries(Object.entries(raw.byId || {})
      .filter(([id]) => /^[1-4]$/.test(id)).map(([id, m]) => [id, metric(m)])) };
}
function add(target, source) {
  const s = normalize(source); if (!s) return target;
  target ||= { version: 1, seconds: 0, sharedKwh: 0, total: empty(), byId: {} };
  target.seconds += s.seconds; target.sharedKwh += s.sharedKwh;
  for (const k of FIELDS) target.total[k] += s.total[k];
  for (const [id, m] of Object.entries(s.byId)) {
    target.byId[id] ||= empty(); for (const k of FIELDS) target.byId[id][k] += m[k];
  }
  return target;
}
function integrate(day, hours, sources, readings, importPrice, feedInPrice) {
  if (!Array.isArray(readings) || !readings.length || hours <= 0) return;
  day.ev ||= { version: 1, seconds: 0, sharedKwh: 0, total: empty(), byId: {} };
  const data = day.ev; data.seconds += hours * 3600;
  // A declared shared EV meter is counted ONCE and never assigned to one car.
  // Multiple declared shared meters are ambiguous: do not invent their sum.
  const shared = readings.filter(r => r.scope === 'shared');
  const selected = shared.length ? shared.length === 1 ? [{ ...shared[0], id: null }] : [] : readings;
  const evW = selected.reduce((s, r) => s + Math.max(0, number(r.powerW)), 0);
  const safe = sources.loadW > 0 && evW <= sources.loadW + Math.max(50, sources.loadW * .05);
  // Subdivide the EXISTING site source pools, which already exclude export
  // and battery charging. Reserve direct solar for other household loads first.
  // This is an estimated attribution policy, not an independently metered path.
  const otherLoadW = Math.max(0, number(sources.loadW) - evW);
  const solarToEvsW = safe ? Math.min(evW, Math.max(0, number(sources.pvW) - otherLoadW)) : 0;
  const gridToEvsW = safe ? Math.min(Math.max(0, number(sources.gridW)), Math.max(0, evW - solarToEvsW)) : 0;
  for (const r of selected) {
    if (!(number(r.powerW) > 0) && number(r.coveredSeconds) >= hours * 3600) {
      if (r.id) data.byId[r.id] ||= empty();
      continue;
    }
    const m = empty(), power = Math.max(0, number(r.powerW));
    const kwh = power / 1000 * hours;
    m.kwh = kwh; m.estimatedKwh = kwh;
    m.missingSeconds = Math.max(0, hours * 3600 - Math.max(0, number(r.coveredSeconds)));
    // Allocate the ONE EV source pool across simultaneous EV readings. Battery
    // contribution is not proven by a command and remains in the unknown rest;
    // it must not prevent the available solar/grid shares from being recorded.
    if (safe && r.sourceUsable !== false) {
      const share = evW > 0 ? power / evW : 0;
      m.pvKwh = solarToEvsW * share / 1000 * hours;
      m.gridKwh = gridToEvsW * share / 1000 * hours;
    }
    m.unknownKwh = Math.max(0, kwh - m.pvKwh - m.gridKwh);
    m.solarValue = m.pvKwh * number(feedInPrice);
    if (sources.priceKnown !== false) {
      m.gridCost = m.gridKwh * number(importPrice);
      m.solarSavings = m.pvKwh * (number(importPrice) - number(feedInPrice));
    } else m.unpricedKwh = kwh;
    for (const k of FIELDS) data.total[k] += m[k];
    if (r.id) {
      data.byId[r.id] ||= empty(); for (const k of FIELDS) data.byId[r.id][k] += m[k];
    } else data.sharedKwh += kwh;
  }
  if (shared.length) for (const r of readings) {
    data.byId[r.id] ||= empty(); data.byId[r.id].missingSeconds += hours * 3600;
  }
}
function calibrateGrid(raw, factor) {
  const result = normalize(raw); if (!result) return raw;
  const scale = Math.max(0, Math.min(1, factor));
  for (const m of [result.total, ...Object.values(result.byId)]) {
    const before = m.gridKwh;
    m.gridKwh *= scale; m.gridCost *= scale;
    m.unknownKwh += before - m.gridKwh;
  }
  return result;
}
module.exports = { FIELDS, empty, normalize, add, integrate, calibrateGrid };
