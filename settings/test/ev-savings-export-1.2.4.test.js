'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const history = require('../lib/savings-history'), savings = require('../lib/savings');
const baseline = process.env.HEMS_SAVINGS_CSV_BASELINE ? require(path.resolve(process.env.HEMS_SAVINGS_CSV_BASELINE)) : null;
const cases = [];
const check = (name, fn) => { fn(); cases.push(name); };
const near = (a, b) => assert(Math.abs(Number(a) - b) < 1e-9, `${a} != ${b}`);
function decode(csv) {
  const lines = csv.split('\r\n').map(row => row.split(',')), keys = lines.shift();
  assert.equal(new Set(keys).size, keys.length);
  for (const row of lines) assert.equal(row.length, keys.length);
  return { keys, rows: lines.map(row => Object.fromEntries(keys.map((key, i) => [key, row[i]]))) };
}
function day({ date = '2026-10-27', pv = 5000, grid = 2000, battery = 0, price = .3, feed = .03,
  priceKnown = true, readings = [{ id: '1', powerW: 3000 }, { id: '2', powerW: 4000 }] } = {}) {
  const result = savings.emptyDay(date);
  const inventory = savings.emptyInventory();
  for (let i = 0; i < 12; i++) savings.integrateInterval({ day: result, inventory, seconds: 300,
    pvW: pv, gridW: grid, batteryW: battery, importPrice: price, feedInPrice: feed, evPriceKnown: priceKnown,
    evs: readings.map(r => ({ coveredSeconds: 300, scope: 'individual', ...r })) });
  return result;
}
const exportDay = (d, currency = '€') => decode(history.toCsv({ [d.date]: history.compactDay(d, d.date) }, d.date, currency));

check('Original 14 columns stay first; legacy days have blank EV values, not fictitious zero readings', () => {
  const stored = { '2026-10-26': { date: '2026-10-26', directPvKwh: 15, directPvValue: 4.5 } };
  const { keys, rows } = decode(history.toCsv(stored, '2026-10-27'));
  assert.equal(keys.length, 77);
  assert.deepEqual(keys.slice(0, 14), ['date','savings_€','direct_pv_kwh','direct_pv_€','pv_battery_home_kwh','pv_battery_home_€','pv_export_kwh','pv_export_€','load_shift_kwh','load_shift_€','direct_grid_kwh','direct_grid_cost_€','grid_charge_kwh','grid_charge_cost_€']);
  assert.equal(rows[0].ev_data_available, '0');
  for (const key of keys.slice(15)) assert.equal(rows[0][key], '');
});
check('Two EVs export central group and stable-slot subdivisions without adding energy or Savings', () => {
  const d = day(), before = JSON.stringify(d), { rows } = exportDay(d), row = rows[0];
  near(row.ev_kwh, 7); near(row.ev_pv_kwh, 5); near(row.ev_grid_kwh, 2);
  near(row.ev1_kwh, 3); near(row.ev2_kwh, 4); near(Number(row.ev1_pv_kwh) + Number(row.ev2_pv_kwh), 5);
  near(row.ev_coverage_seconds, 3600); assert.equal(row.ev_data_available, '1');
  near(row.ev_estimated_kwh, 7); near(row['ev_known_charging_cost_€'], .75); near(row['ev_estimated_savings_€'], 1.35);
  near(row['savings_€'], savings.totalSavings(d)); near(row.direct_pv_kwh, 5);
  assert.equal(row.ev3_kwh, ''); assert.equal(row.ev4_kwh, ''); assert.equal(JSON.stringify(d), before);
});
check('Shared energy appears once at group level and is never copied to individual EV columns', () => {
  const d = day({ readings: [{ id: '1', powerW: 7000, scope: 'shared' }, { id: '2', powerW: 4000 }] });
  const row = exportDay(d).rows[0]; near(row.ev_kwh, 7); near(row.ev_shared_kwh, 7);
  near(row.ev1_kwh, 0); near(row.ev2_kwh, 0); near(row.ev1_missing_feedback_seconds, 3600);
});
check('Only the unassigned battery share stays unknown; available direct PV is exported and missing differs from zero', () => {
  const row = exportDay(day({ pv: 3000, grid: 0, battery: 4000 })).rows[0];
  near(row.ev_unknown_kwh, 4); near(row.ev_pv_kwh, 3); near(row.ev_battery_kwh, 0);
  const missing = exportDay(day({ readings: [{ id: '1', powerW: 0, coveredSeconds: 0 }] })).rows[0];
  near(missing.ev_kwh, 0); near(missing.ev_missing_feedback_seconds, 3600);
  const stopped = exportDay(day({ readings: [{ id: '1', powerW: 0 }] })).rows[0];
  near(stopped.ev1_kwh, 0); near(stopped.ev1_missing_feedback_seconds, 0);
});
check('CSV contains the household-first solar/grid split during battery charging, without changing general columns', () => {
  const d = day({pv:6000,grid:3000,battery:-2000,readings:[{id:'1',powerW:5000}]});
  const row=exportDay(d).rows[0];near(row.ev_kwh,5);near(row.ev_pv_kwh,4);near(row.ev_grid_kwh,1);near(row.ev_unknown_kwh,0);
  near(row.direct_pv_kwh,6);near(row.direct_grid_kwh,1);near(row.grid_charge_kwh,2);
  if(baseline)assert.equal(history.toCsv({[d.date]:d},d.date).split('\r\n').map(line=>line.split(',').slice(0,14).join(',')).join('\r\n'),baseline.toCsv({[d.date]:d},d.date));
});
check('Interval financial amounts retain negative prices and expose missing-price coverage', () => {
  const row = exportDay(day({ price: -.15, feed: -.02 })).rows[0];
  near(row['ev_grid_cost_€'], -.3); near(row['ev_solar_value_€'], -.1); near(row['ev_known_charging_cost_€'], -.4);
  near(row['ev_estimated_savings_€'], -.65);
  const unpriced = exportDay(day({ priceKnown: false })).rows[0];
  near(unpriced.ev_unpriced_kwh, 7); near(unpriced['ev_grid_cost_€'], 0); near(unpriced['ev_solar_value_€'], .15);
});
check('Compacted JSON history preserves retired EV slots; export does not depend on current EV settings', () => {
  const d = day({ readings: [{ id: '4', powerW: 7000 }] });
  const persisted = JSON.parse(JSON.stringify({ [d.date]: history.compactDay(d, d.date) }));
  assert.deepEqual(decode(history.toCsv(persisted, d.date)), exportDay(d));
  near(exportDay(d).rows[0].ev4_kwh, 7); assert.equal(exportDay(d).rows[0].ev1_kwh, '');
});
check('Mixed legacy/current days stay sorted and rectangular; currency suffixes apply to every money column', () => {
  const d = day(), stored = { [d.date]: d, '2026-10-26': { directPvValue: 1 }, invalid: { directPvValue: 999 } };
  for (const currency of ['€', '$', 'USD', 'USD,\n"']) {
    const csv = history.toCsv(stored, d.date, currency), { keys, rows } = decode(csv);
    assert.deepEqual(rows.map(row => row.date), ['2026-10-26', '2026-10-27']);
    const suffix = keys[1].slice('savings_'.length);
    assert(keys.includes('ev_known_charging_cost_' + suffix)); assert(keys.includes('ev4_grid_cost_' + suffix));
    if (baseline) assert.equal(csv.split('\r\n').map(line => line.split(',').slice(0, 14).join(',')).join('\r\n'), baseline.toCsv(stored, d.date, currency));
  }
});
check('The production app CSV entry point exports current and historical EV daydata without changing stored totals', () => {
  const load = Module._load;
  Module._load = function(request, ...args) {
    if (request === 'homey') return { App: class {} };
    if (request === 'homey-api') return { HomeyAPI: {} };
    return load.call(this, request, ...args);
  };
  let App; try { App = require('../app'); } finally { Module._load = load; }
  const app = Object.create(App.prototype), today = day(), old = day({ date: '2026-10-26' });
  let samples = 0; app.recordSavingsSample = () => { samples++; };
  app.settingsCache = { currencySymbol: '€' }; app.savings = { today, history: { [old.date]: history.compactDay(old, old.date) } };
  const before = JSON.stringify(app.savings), result = decode(app.getSavingsCsv());
  assert.equal(samples, 1); assert.equal(result.rows.length, 2);
  for (const row of result.rows) near(row.ev_kwh, 7);
  assert.equal(JSON.stringify(app.savings), before);
});
fs.writeFileSync(path.join(__dirname, '../validation/ev-savings-export-1.2.4.json'), JSON.stringify({
  passed: cases.length, cases, productionFunctionsUsed: true, simulatedInputs: true,
  originalCsvBaselineCompared: Boolean(baseline), nativeHomeyTested: false,
}, null, 2) + '\n');
console.log('EV Savings CSV export:', cases.length, 'cases passed');
