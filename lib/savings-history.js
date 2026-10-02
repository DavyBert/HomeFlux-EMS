'use strict';

const { emptyDay, addDays, normalizeDay, totalSavings, pvExportValue } = require('./savings');
const DAY = 86400000;
const isDateKey = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const shiftKey = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const maxDays = 1827;
const clampDays = value => Math.max(1, Math.min(maxDays, Math.trunc(Number(value) || 30)));

// All fields consumed by addDays are retained; calibration-only inputs and
// redundant calculated battery totals are excluded from closed day records.
const fields = [
  'directGridKwh','directGridCost','directPvKwh','directPvValue',
  'directPvExportKwh','directPvExportValue','pvBatteryHomeKwh',
  'pvBatteryHomeValue','pvBatteryExportKwh','pvBatteryExportValue',
  'shiftKwh','shiftValue','shiftHomeKwh','shiftHomeValue',
  'shiftExportKwh','shiftExportValue','unknownBatteryExportKwh',
  'pvChargeKwh','gridChargeKwh','gridChargeCost',
];
function compactDay(raw, date) {
  const day = normalizeDay(raw, date);
  const result = { date };
  for (const key of fields) if (day[key]) result[key] = day[key];
  if (Object.keys(day.chargeCostsByTariff).length) result.chargeCostsByTariff = day.chargeCostsByTariff;
  return result;
}
function expandDay(raw, date) {
  const day = normalizeDay(raw, date);
  if (raw?.pvBatteryKwh === undefined) day.pvBatteryKwh = day.pvBatteryHomeKwh + day.pvBatteryExportKwh;
  if (raw?.batteryChargeKwh === undefined) day.batteryChargeKwh = day.pvChargeKwh + day.gridChargeKwh;
  return day;
}
function pruneHistory(history, todayKey) {
  const oldest = new Date(Date.UTC(Number(todayKey.slice(0, 4)) - 5, Number(todayKey.slice(5, 7)) - 1, Number(todayKey.slice(8, 10)) + 1)).toISOString().slice(0, 10);
  let changed = false;
  for (const key of Object.keys(history)) {
    if (!isDateKey(key) || key < oldest || key >= todayKey) { delete history[key]; changed = true; }
  }
  return changed;
}
function rangeFor(period, today, days = 30, selected = '') {
  if (period === 'rolling') return { startKey: shiftKey(today, -clampDays(days) + 1), endKey: shiftKey(today, 1) };
  if (period === 'previous_month') {
    const start = shiftKey(`${today.slice(0, 7)}-01`, -1).slice(0, 7) + '-01';
    return { startKey: start, endKey: `${today.slice(0, 7)}-01` };
  }
  if (period === 'calendar_month' && /^\d{4}-(0[1-9]|1[0-2])$/.test(selected)) {
    const start = `${selected}-01`;
    return { startKey: start, endKey: new Date(Date.UTC(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)), 1)).toISOString().slice(0, 10) };
  }
  if (period === 'calendar_year' && /^\d{4}$/.test(selected)) return { startKey: `${selected}-01-01`, endKey: `${Number(selected) + 1}-01-01` };
  return null;
}
function historicalOptions(history, today) {
  const dates = Object.keys(history).filter(isDateKey);
  if (isDateKey(today)) dates.push(today);
  dates.sort();
  return { months: [...new Set(dates.map(date => date.slice(0, 7)))].reverse(), years: [...new Set(dates.map(date => date.slice(0, 4)))].reverse() };
}
function createHistoryCache() {
  const cache = new Map();
  return {
    clear: () => cache.clear(),
    sum(history, range, today) {
      const key = `${range.startKey}/${range.endKey}/${today}`;
      if (!cache.has(key)) {
        const aggregate = emptyDay('');
        for (const [date, raw] of Object.entries(history)) {
          if (date >= range.startKey && date < range.endKey && date !== today) addDays(aggregate, expandDay(raw, date));
        }
        cache.set(key, aggregate);
        if (cache.size > 64) cache.delete(cache.keys().next().value);
      }
      const result = emptyDay('');
      addDays(result, cache.get(key));
      return result;
    },
  };
}
function csvCurrencySuffix(value) {
  const raw = String(value ?? '€').trim() || '€';
  const safe = raw
    .replace(/[\s,;"'\r\n]+/g, '_')
    .replace(/[^\p{L}\p{N}\p{Sc}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return safe || 'currency';
}
function toCsv(history, today, currencySymbol = '€') {
  const suffix = csvCurrencySuffix(currencySymbol);
  const header = ['date',`savings_${suffix}`,'direct_pv_kwh',`direct_pv_${suffix}`,'pv_battery_home_kwh',`pv_battery_home_${suffix}`,'pv_export_kwh',`pv_export_${suffix}`,'load_shift_kwh',`load_shift_${suffix}`,'direct_grid_kwh',`direct_grid_cost_${suffix}`,'grid_charge_kwh',`grid_charge_cost_${suffix}`];
  const rows = [header.join(',')];
  for (const date of Object.keys(history).sort()) {
    if (!isDateKey(date)) continue;
    const d = expandDay(history[date], date);
    rows.push([date,totalSavings(d),d.directPvKwh,d.directPvValue,d.pvBatteryHomeKwh,d.pvBatteryHomeValue,d.directPvExportKwh+d.pvBatteryExportKwh,pvExportValue(d),d.shiftKwh,d.shiftValue,d.directGridKwh,d.directGridCost,d.gridChargeKwh,d.gridChargeCost].join(','));
  }
  return rows.join('\r\n');
}
module.exports = { compactDay, expandDay, pruneHistory, rangeFor, historicalOptions, createHistoryCache, toCsv, clampDays, shiftKey, maxDays };
