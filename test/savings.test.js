'use strict';

const assert = require('assert');
const { emptyDay, emptyInventory, integrateInterval, totalSavings } = require('../lib/savings');

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
}

{
  const day = emptyDay('2026-09-02');
  const inventory = emptyInventory();
  integrateInterval({ day, inventory, seconds:fiveMinutes, gridW:oneKwhAtFiveMinutesW, pvW:0, batteryW:-oneKwhAtFiveMinutesW, importPrice:0.10, tariff:{id:'cheap',label:'Cheap'}, capacityKwh:20 });
  close(day.gridChargeKwh, 1);
  close(day.gridChargeCost, 0.10);
  close(day.chargeCostsByTariff.cheap.cost, 0.10);
  integrateInterval({ day, inventory, seconds:fiveMinutes, gridW:0, pvW:0, batteryW:oneKwhAtFiveMinutesW, importPrice:0.35, tariff:{id:'peak',label:'Peak'}, capacityKwh:20 });
  close(day.shiftKwh, 1);
  close(day.shiftValue, 0.25);
}

{
  const day = emptyDay('2026-09-02');
  const inventory = emptyInventory();
  integrateInterval({ day, inventory, seconds:fiveMinutes, gridW:0, pvW:0, batteryW:oneKwhAtFiveMinutesW, importPrice:0.35, tariff:{id:'peak',label:'Peak'}, capacityKwh:20 });
  close(totalSavings(day), 0);
}

console.log('savings tests passed');
