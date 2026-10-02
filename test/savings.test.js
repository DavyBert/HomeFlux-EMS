'use strict';

const assert = require('assert');
const {
  emptyDay,
  emptyInventory,
  integrateInterval,
  totalSavings,
  avoidedEnergyValue,
  calibrateImportedEnergy,
  calibrateExportedEnergy,
  pvExportValue,
  pvExportKwh,
} = require('../lib/savings');

const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const fiveMinutes = 300;
const oneKwhAtFiveMinutesW = 12000;

// Day, week and month must use distinct local calendar boundaries, including
// a week that crosses a month or year and a daylight-saving change.
{
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'homey') return { App: class App {} };
    if (request === 'homey-api') return { HomeyAPI: {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  let HomeFluxEmsApp;
  try { HomeFluxEmsApp = require('../app'); } finally { Module._load = originalLoad; }
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.homey = { clock: { getTimezone: () => 'Europe/Brussels' } };
  const oct1 = Date.UTC(2026, 9, 1, 12);
  assert.deepStrictEqual(app.getSavingsPeriodRange('day', oct1), { startKey: '2026-10-01', endKey: '2026-10-02' });
  assert.deepStrictEqual(app.getSavingsPeriodRange('week', oct1), { startKey: '2026-09-28', endKey: '2026-10-05' });
  assert.deepStrictEqual(app.getSavingsPeriodRange('month', oct1), { startKey: '2026-10-01', endKey: '2026-11-01' });
  assert.deepStrictEqual(app.getSavingsPeriodRange('week', Date.UTC(2027, 0, 3, 12)), { startKey: '2026-12-28', endKey: '2027-01-04' });
  assert.deepStrictEqual(app.getSavingsPeriodRange('week', Date.UTC(2026, 2, 29, 12)), { startKey: '2026-03-23', endKey: '2026-03-30' });

  app.recordSavingsSample = () => {};
  app.getSavingsDateKey = () => '2026-10-01';
  app.getSavingsPeriodRange = period => HomeFluxEmsApp.prototype.getSavingsPeriodRange.call(app, period, oct1);
  app.getSavingsTariffSnapshot = () => ({ feedInPrice: 0, feedInSource: 'none' });
  app.savings = {
    history: {
      '2026-09-28': { date: '2026-09-28', directPvValue: 2 },
      '2026-09-30': { date: '2026-09-30', directPvValue: 3 },
    },
    today: { ...emptyDay('2026-10-01'), directPvValue: 1 },
    total: 6,
    inventory: emptyInventory(),
  };
  close(app.getSavingsStatus({ period: 'day' }).periodSavings, 1);
  close(app.getSavingsStatus({ period: 'week' }).periodSavings, 6);
  close(app.getSavingsStatus({ period: 'month' }).periodSavings, 1);
}

{
  const day = emptyDay('2026-09-02');
  const inventory = emptyInventory();
  integrateInterval({ day, inventory, seconds:fiveMinutes, gridW:0, pvW:oneKwhAtFiveMinutesW, batteryW:0, importPrice:0.35, tariff:{id:'peak',label:'Peak'}, capacityKwh:20 });
  close(day.directPvKwh, 1);
  close(day.directPvValue, 0.35);
  close(totalSavings(day), 0.35);
  close(avoidedEnergyValue(day), 0.35);
}

{
  const day = emptyDay('2026-09-02');
  const inventory = emptyInventory();
  integrateInterval({ day, inventory, seconds:fiveMinutes, gridW:0, pvW:oneKwhAtFiveMinutesW, batteryW:-oneKwhAtFiveMinutesW, importPrice:0.10, tariff:{id:'cheap',label:'Cheap'}, capacityKwh:20 });
  close(day.pvChargeKwh, 1);
  close(inventory.pvKwh, 1);
  integrateInterval({ day, inventory, seconds:fiveMinutes, gridW:0, pvW:0, batteryW:oneKwhAtFiveMinutesW, importPrice:0.35, tariff:{id:'peak',label:'Peak'}, capacityKwh:20 });
  close(day.pvBatteryKwh, 1);
  close(day.pvBatteryValue, 0.35);
  close(day.pvBatteryHomeKwh, 1);
  close(day.pvBatteryHomeValue, 0.35);
  close(avoidedEnergyValue(day), 0.35);
}

{
  const day = emptyDay('2026-09-02');
  const inventory = emptyInventory();
  integrateInterval({ day, inventory, seconds:fiveMinutes, gridW:oneKwhAtFiveMinutesW, pvW:0, batteryW:-oneKwhAtFiveMinutesW, importPrice:0.10, tariff:{id:'cheap',label:'Cheap'}, capacityKwh:20 });
  close(day.gridChargeKwh, 1);
  close(day.directGridKwh, 0);
  close(day.gridChargeCost, 0.10);
  close(day.chargeCostsByTariff.cheap.cost, 0.10);
  integrateInterval({ day, inventory, seconds:fiveMinutes, gridW:0, pvW:0, batteryW:oneKwhAtFiveMinutesW, importPrice:0.35, tariff:{id:'peak',label:'Peak'}, capacityKwh:20 });
  close(day.shiftKwh, 1);
  close(day.shiftValue, 0.25);
  close(avoidedEnergyValue(day), 0, 1e-9);
}

// Meter import contains direct use + grid charging. HomeFlux must subtract only
// the grid-fed charging part from the meter to obtain live direct consumption.
{
  const day = emptyDay('2026-09-02');
  const inventory = emptyInventory();
  integrateInterval({
    day,
    inventory,
    seconds:fiveMinutes,
    gridW:oneKwhAtFiveMinutesW,
    pvW:0,
    batteryW:-4800,
    importPrice:0.30,
    tariff:{id:'peak',label:'Peak'},
    capacityKwh:20,
  });
  close(day.gridChargeKwh, 0.4);
  close(day.directGridKwh, 0.6);
  close(day.directGridCost, 0.18);
  close(day.gridChargeCost, 0.12);
}

// The external cumulative "imported energy today" input is the calibration
// reference. All live-calculated grid buckets and their costs keep their
// proportions while the total imported kWh becomes exact.
{
  const day = emptyDay('2026-09-02');
  day.directGridKwh = 2;
  day.directGridCost = 0.60;
  day.gridChargeKwh = 3;
  day.gridChargeCost = 0.75;
  day.pvChargeKwh = 4;
  day.batteryChargeKwh = 7;
  day.chargeCostsByTariff.cheap = { label:'Cheap', kwh:3, cost:0.75 };
  day.importedEnergyKwh = 10;
  day.importedEnergyKnown = true;
  const calibrated = calibrateImportedEnergy(day);
  close(calibrated.directGridKwh, 4);
  close(calibrated.gridChargeKwh, 6);
  close(calibrated.directGridCost, 1.20);
  close(calibrated.gridChargeCost, 1.50);
  close(calibrated.chargeCostsByTariff.cheap.kwh, 6);
  close(calibrated.chargeCostsByTariff.cheap.cost, 1.50);
  close(calibrated.pvChargeKwh, 4);
  close(calibrated.batteryChargeKwh, 10);
  close(day.directGridKwh, 2, 1e-9); // source record is never mutated
}

{
  const day = emptyDay('2026-09-02');
  day.directGridKwh = 0.2;
  day.directGridCost = 0.06;
  day.importedEnergyKwh = 0;
  day.importedEnergyKnown = true;
  const calibrated = calibrateImportedEnergy(day);
  close(calibrated.directGridKwh, 0);
  close(calibrated.directGridCost, 0);
}

{
  const day = emptyDay('2026-09-02');
  const inventory = emptyInventory();
  integrateInterval({ day, inventory, seconds:fiveMinutes, gridW:0, pvW:0, batteryW:oneKwhAtFiveMinutesW, importPrice:0.35, tariff:{id:'peak',label:'Peak'}, capacityKwh:20 });
  close(totalSavings(day), 0);
}

// v0.7.3: direct PV export is part of Savings. Positive export price is
// compensation received; a negative price is a real injection cost.
{
  const day = emptyDay('2026-09-02');
  const inventory = emptyInventory();
  integrateInterval({ day, inventory, seconds:fiveMinutes, gridW:-oneKwhAtFiveMinutesW, pvW:oneKwhAtFiveMinutesW, batteryW:0, importPrice:0.30, feedInPrice:0.08, tariff:{id:'sun',label:'Sun'}, capacityKwh:20 });
  close(day.directPvExportKwh, 1);
  close(day.directPvExportValue, 0.08);
  close(pvExportKwh(day), 1);
  close(pvExportValue(day), 0.08);
  close(totalSavings(day), 0.08);
}

{
  const day = emptyDay('2026-09-02');
  const inventory = emptyInventory();
  integrateInterval({ day, inventory, seconds:fiveMinutes, gridW:-oneKwhAtFiveMinutesW, pvW:oneKwhAtFiveMinutesW, batteryW:0, importPrice:0.30, feedInPrice:-0.05, tariff:{id:'negative',label:'Negative export'}, capacityKwh:20 });
  close(day.directPvExportValue, -0.05);
  close(totalSavings(day), -0.05);
}

// Export calibration scales every measured export bucket proportionally to the
// cumulative meter export without mutating the raw day record.
{
  const day = emptyDay('2026-09-02');
  day.directPvExportKwh = 2;
  day.directPvExportValue = 0.16;
  day.pvBatteryExportKwh = 1;
  day.pvBatteryExportValue = 0.08;
  day.shiftExportKwh = 1;
  day.shiftExportValue = 0.05;
  day.shiftHomeKwh = 1;
  day.shiftHomeValue = 0.10;
  day.shiftKwh = 2;
  day.shiftValue = 0.15;
  day.pvBatteryKwh = 1;
  day.pvBatteryValue = 0.08;
  day.exportedEnergyKwh = 8;
  day.exportedEnergyKnown = true;
  const calibrated = calibrateExportedEnergy(day);
  close(calibrated.directPvExportKwh, 4);
  close(calibrated.directPvExportValue, 0.32);
  close(calibrated.pvBatteryExportKwh, 2);
  close(calibrated.pvBatteryExportValue, 0.16);
  close(calibrated.shiftExportKwh, 2);
  close(calibrated.shiftExportValue, 0.10);
  close(day.directPvExportKwh, 2);
}


console.log('savings tests passed');

// Closed days share a cached aggregate; the current local day is added separately.
{
  const history = require('../lib/savings-history');
  const stored = {
    '2026-09-30': history.compactDay({ date: '2026-09-30', directPvValue: 2, directPvKwh: 3 }, '2026-09-30'),
    '2026-10-01': history.compactDay({ date: '2026-10-01', directPvValue: 4 }, '2026-10-01'),
  };
  const cache = history.createHistoryCache();
  const range = history.rangeFor('rolling', '2026-10-02', 3);
  assert.deepStrictEqual(range, { startKey: '2026-09-30', endKey: '2026-10-03' });
  close(totalSavings(cache.sum(stored, range, '2026-10-02')), 6);
  stored['2026-09-30'].directPvValue = 200;
  close(totalSavings(cache.sum(stored, range, '2026-10-02')), 6);
  cache.clear();
  close(totalSavings(cache.sum(stored, range, '2026-10-02')), 204);
  assert.deepStrictEqual(history.rangeFor('previous_month', '2027-01-01'), { startKey: '2026-12-01', endKey: '2027-01-01' });
  assert.deepStrictEqual(history.rangeFor('rolling', '2026-03-29', 2), { startKey: '2026-03-28', endKey: '2026-03-30' });
  assert.deepStrictEqual(history.rangeFor('calendar_month', '2026-10-02', 1, '2026-09'), { startKey: '2026-09-01', endKey: '2026-10-01' });
  assert.deepStrictEqual(history.rangeFor('calendar_year', '2026-10-02', 1, '2025'), { startKey: '2025-01-01', endKey: '2026-01-01' });
  assert.equal(history.pruneHistory({ '2021-09-30': {}, '2021-10-01': {}, '2026-10-01': {} }, '2026-10-01'), true);
  assert.match(history.toCsv(stored, '2026-10-02'), /2026-10-01,4,/);
  assert.match(history.toCsv(stored, '2026-10-02', '$'), /^date,savings_\$/);
  assert.match(history.toCsv(stored, '2026-10-02', 'USD'), /^date,savings_USD/);
}
