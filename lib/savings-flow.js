'use strict';
const { shiftKey, isDateKey } = require('./savings-history');
const { totalSavings, pvExportKwh, pvExportValue } = require('./savings');
const evEnergy = require('./ev-energy-breakdown');
const DAY = 86400000;
function rollingRange(today, count, unit) {
  const n = Number(count);
  if (!isDateKey(today) || !Number.isInteger(n) || n < 1 || !['days','weeks','months','years'].includes(unit))
    throw new Error('Choose a positive whole number and days, weeks, months or years.');
  const limit = { days:1827, weeks:260, months:60, years:5 }[unit];
  if (n > limit) throw new Error('Savings history supports at most five years.');
  const endKey = shiftKey(today, 1);
  let startKey;
  if (unit === 'days' || unit === 'weeks') startKey = shiftKey(endKey, -n * (unit === 'weeks' ? 7 : 1));
  else {
    const end = new Date(`${endKey}T00:00:00Z`);
    const month = end.getUTCMonth() - n * (unit === 'years' ? 12 : 1);
    const last = new Date(Date.UTC(end.getUTCFullYear(), month + 1, 0)).getUTCDate();
    startKey = new Date(Date.UTC(end.getUTCFullYear(), month, Math.min(end.getUTCDate(), last))).toISOString().slice(0,10);
  }
  return { startKey, endKey, days: Math.round((Date.parse(endKey) - Date.parse(startKey)) / DAY) };
}
// Financial values are realized ledger values. Storing PV has no booked saving
// yet; that category deliberately reports value_available=false, not a guess.
const categories = {
  total: d => [d.directPvKwh + d.directPvExportKwh + d.pvBatteryKwh + d.shiftKwh, totalSavings(d)],
  direct_pv: d => [d.directPvKwh, d.directPvValue],
  pv_to_battery: d => [d.pvChargeKwh, 0, false],
  pv_battery: d => [d.pvBatteryKwh, d.pvBatteryValue],
  pv_battery_home: d => [d.pvBatteryHomeKwh, d.pvBatteryHomeValue],
  pv_battery_export: d => [d.pvBatteryExportKwh, d.pvBatteryExportValue],
  direct_pv_export: d => [d.directPvExportKwh, d.directPvExportValue],
  pv_export: d => [pvExportKwh(d), pvExportValue(d)],
  load_shift: d => [d.shiftKwh, d.shiftValue],
  load_shift_home: d => [d.shiftHomeKwh, d.shiftHomeValue],
  load_shift_export: d => [d.shiftExportKwh, d.shiftExportValue],
  direct_grid: d => [d.directGridKwh, d.directGridCost],
  grid_to_battery: d => [d.gridChargeKwh, d.gridChargeCost],
  battery_charging: d => [d.batteryChargeKwh, d.gridChargeCost],
};
const evCategories = {
  ev_total: m => [m.kwh, m.gridCost + m.solarValue],
  ev_pv: m => [m.pvKwh, m.solarValue],
  ev_grid: m => [m.gridKwh, m.gridCost],
  ev_battery: m => [m.batteryKwh, 0, false],
  ev_unknown: m => [m.unknownKwh, 0, false],
  ev_savings: m => [m.pvKwh, m.solarSavings],
};
const isEvCategory = category => Object.hasOwn(evCategories, category);
function evMetric(day, selected = 'all') {
  if (!['all','1','2','3','4'].includes(selected)) throw new Error('Choose all EVs or EV 1–4.');
  const ev = evEnergy.normalize(day?.ev);
  const metric = selected === 'all' ? ev?.total : ev?.byId[selected];
  // Match Insights: missing feedback without any delivered energy is unknown,
  // while an explicitly recorded stopped/zero interval is a valid zero.
  return metric && (metric.kwh > 0 || metric.missingSeconds === 0) ? metric : null;
}
function hasEvData(day, selected = 'all') { return Boolean(evMetric(day, selected)); }
function evSolarKm(day, selected, settings) {
  const metric = evMetric(day, selected);
  if (!metric) return { solar_km: 0, solar_km_available: false };
  const ev = evEnergy.normalize(day.ev), ids = selected === 'all' ? Object.keys(ev.byId) : [selected];
  let km = 0, attributedPv = 0, valid = ids.length > 0;
  for (const id of ids) {
    const m = evMetric(day, id);
    if (!m) continue;
    const consumption = Number(settings[`ev${id === '1' ? '' : id}ConsumptionKwhPer100Km`]);
    if (!(consumption > 0)) { if (selected !== 'all' || m.pvKwh > 0) valid = false; continue; }
    attributedPv += m.pvKwh;
    km += m.pvKwh / consumption * 100;
  }
  // Shared solar cannot be allocated to cars with different consumption values.
  valid = valid && attributedPv + 1e-9 >= metric.pvKwh;
  return { solar_km: valid ? km : 0, solar_km_available: valid };
}
function readCategory(day, category, { ev = 'all', settings = {} } = {}) {
  if (isEvCategory(category)) {
    const metric = evMetric(day, ev);
    if (!metric) return { kwh: 0, value: 0, value_available: false,
      ev_data_available: false, solar_km: 0, solar_km_available: false, solar_share_percent: 0 };
    const [kwh, value, available = true] = evCategories[category](metric);
    return { kwh, value, value_available: available, ev_data_available: true,
      ...evSolarKm(day, ev, settings), solar_share_percent: metric.kwh > 0 ? metric.pvKwh / metric.kwh * 100 : 0 };
  }
  if (!Object.hasOwn(categories, category)) throw new Error('Unknown savings category.');
  const [kwh, value, available = true] = categories[category](day);
  return { kwh, value, value_available: available };
}
function formatResult(result, format = 'kwh', currencySymbol = '€', language = 'nl') {
  if (!['kwh', 'kwh_price', 'price'].includes(format)) throw new Error('Choose kWh, kWh with price or price.');
  const locale = String(language).startsWith('nl') ? 'nl-BE' : 'en-GB';
  if (result.ev_data_available === false) return locale === 'nl-BE' ? 'Geen EV-gegevens' : 'No EV data';
  const energy = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(result.kwh) + ' kWh';
  const symbol = String(currencySymbol ?? '€').trim() || '€';
  const price = result.value_available
    ? `${symbol} ${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(result.value)}`
    : (locale === 'nl-BE' ? 'Bedrag niet beschikbaar' : 'Amount unavailable');
  return format === 'kwh' ? energy : format === 'price' ? price : `${energy} · ${price}`;
}
module.exports = { rollingRange, readCategory, formatResult, isEvCategory, hasEvData, evMetric };
