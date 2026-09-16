'use strict';

const MINUTE_MS = 60 * 1000;
const DEFAULT_HISTORY_MINUTES = 40;

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function recordMinuteSample(history = [], valueW = 0, now = Date.now(), historyMinutes = DEFAULT_HISTORY_MINUTES) {
  const target = Array.isArray(history) ? history : [];
  const timestamp = Math.max(0, finiteNumber(now, Date.now()));
  const minuteAt = Math.floor(timestamp / MINUTE_MS) * MINUTE_MS;
  const value = Math.max(0, Math.min(100000, finiteNumber(valueW, 0)));
  const last = target[target.length - 1];
  if (last && Number(last.minuteAt) === minuteAt) {
    last.sumW = finiteNumber(last.sumW, 0) + value;
    last.samples = Math.max(0, Math.round(finiteNumber(last.samples, 0))) + 1;
  } else {
    target.push({ minuteAt, sumW: value, samples: 1 });
  }

  const keepMinutes = Math.max(5, Math.min(120, Math.round(finiteNumber(historyMinutes, DEFAULT_HISTORY_MINUTES))));
  const cutoff = minuteAt - ((keepMinutes - 1) * MINUTE_MS);
  while (target.length && Number(target[0]?.minuteAt) < cutoff) target.shift();
  while (target.length > keepMinutes) target.shift();
  return target;
}

function getRobustAverageW(history = [], now = Date.now(), historyMinutes = DEFAULT_HISTORY_MINUTES) {
  if (!Array.isArray(history) || !history.length) return null;
  const timestamp = Math.max(0, finiteNumber(now, Date.now()));
  const keepMinutes = Math.max(5, Math.min(120, Math.round(finiteNumber(historyMinutes, DEFAULT_HISTORY_MINUTES))));
  const cutoff = timestamp - (keepMinutes * MINUTE_MS);
  const values = history
    .filter(bucket => Number(bucket?.minuteAt) >= cutoff && Number(bucket?.samples) > 0)
    .map(bucket => Math.max(0, finiteNumber(bucket.sumW, 0) / Math.max(1, finiteNumber(bucket.samples, 1))))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!values.length) return null;

  // A trimmed mean still represents the user's requested average, while a
  // kettle/oven spike cannot dominate the complete pre-connection reference.
  const trim = values.length >= 10 ? Math.max(1, Math.floor(values.length * 0.1)) : 0;
  const selected = trim > 0 ? values.slice(trim, values.length - trim) : values;
  if (!selected.length) return null;
  return selected.reduce((sum, value) => sum + value, 0) / selected.length;
}

function getHouseLoadToleranceW(baselineW = 0) {
  const baseline = Math.max(0, finiteNumber(baselineW, 0));
  return Math.max(500, Math.min(1500, baseline * 0.2));
}

function calculatePhysicalSiteLoadW({ gridPowerW = 0, pvPowerW = 0, batteryPowerW = 0 } = {}) {
  // HomeFlux' internal battery sign is positive discharge / negative charge.
  // Grid + PV + battery therefore reconstructs physical consumption without
  // letting battery action or changing PV distort the house reference.
  return Math.max(0, finiteNumber(gridPowerW, 0) + Math.max(0, finiteNumber(pvPowerW, 0)) + finiteNumber(batteryPowerW, 0));
}

function calculateDetectedEvLoadW(siteLoadW = 0, baselineW = null, toleranceW = null) {
  if (baselineW === null || baselineW === undefined || baselineW === '') return null;
  const baseline = Number(baselineW);
  if (!Number.isFinite(baseline) || baseline < 0) return null;
  const siteLoad = Math.max(0, finiteNumber(siteLoadW, 0));
  const hasTolerance = toleranceW !== null && toleranceW !== undefined && toleranceW !== '';
  const tolerance = hasTolerance && Number.isFinite(Number(toleranceW))
    ? Math.max(0, Number(toleranceW))
    : getHouseLoadToleranceW(baseline);
  if (siteLoad <= baseline + tolerance) return 0;
  return Math.max(0, siteLoad - baseline);
}

module.exports = {
  DEFAULT_HISTORY_MINUTES,
  recordMinuteSample,
  getRobustAverageW,
  getHouseLoadToleranceW,
  calculatePhysicalSiteLoadW,
  calculateDetectedEvLoadW,
};
