'use strict';

const assert = require('assert');
const {
  emptyDay,
  emptyInventory,
  integrateInterval,
  totalSavings,
  avoidedEnergyValue,
  calibrateImportedEnergy,
} = require('../lib/savings');

const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const fiveMinutes = 300;
const oneKwhAtFiveMinutesW = 12000;

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

console.log('savings tests passed');
