'use strict';

function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function emptyDay(date = '') {
  return {
    date,
    directPvKwh: 0,
    directPvValue: 0,
    pvBatteryKwh: 0,
    pvBatteryValue: 0,
    shiftKwh: 0,
    shiftValue: 0,
    batteryChargeKwh: 0,
    pvChargeKwh: 0,
    gridChargeKwh: 0,
    gridChargeCost: 0,
    chargeCostsByTariff: {},
  };
}

function normalizeDay(raw, date = '') {
  const out = emptyDay(String(raw?.date || date || ''));
  for (const key of Object.keys(out)) {
    if (key === 'date' || key === 'chargeCostsByTariff') continue;
    out[key] = Math.max(key.endsWith('Value') ? -Infinity : 0, n(raw?.[key], 0));
  }
  const source = raw?.chargeCostsByTariff && typeof raw.chargeCostsByTariff === 'object' ? raw.chargeCostsByTariff : {};
  for (const [id, item] of Object.entries(source)) {
    out.chargeCostsByTariff[id] = {
      label: String(item?.label || id),
      kwh: Math.max(0, n(item?.kwh, 0)),
      cost: Math.max(0, n(item?.cost, 0)),
    };
  }
  return out;
}

function totalSavings(day) {
  return n(day?.directPvValue) + n(day?.pvBatteryValue) + n(day?.shiftValue);
}

function emptyInventory() {
  return { pvKwh: 0, unknownKwh: 0, grid: {} };
}

function normalizeInventory(raw) {
  const inventory = emptyInventory();
  inventory.pvKwh = Math.max(0, n(raw?.pvKwh));
  inventory.unknownKwh = Math.max(0, n(raw?.unknownKwh));
  const grid = raw?.grid && typeof raw.grid === 'object' ? raw.grid : {};
  for (const [id, item] of Object.entries(grid)) {
    const kwh = Math.max(0, n(item?.kwh));
    if (kwh <= 0) continue;
    inventory.grid[id] = {
      label: String(item?.label || id),
      kwh,
      cost: Math.max(0, n(item?.cost)),
    };
  }
  return inventory;
}

function inventoryKwh(inventory) {
  return n(inventory?.pvKwh) + n(inventory?.unknownKwh)
    + Object.values(inventory?.grid || {}).reduce((sum, item) => sum + Math.max(0, n(item?.kwh)), 0);
}

function addGridCharge(inventory, tariff, kwh, cost) {
  if (kwh <= 0) return;
  const id = String(tariff?.id || tariff?.label || 'grid');
  const label = String(tariff?.label || tariff?.id || 'Grid');
  const item = inventory.grid[id] || { label, kwh: 0, cost: 0 };
  item.label = label;
  item.kwh += kwh;
  item.cost += Math.max(0, cost);
  inventory.grid[id] = item;
}

function trimInventory(inventory, maxKwh) {
  const total = inventoryKwh(inventory);
  const cap = Math.max(0, n(maxKwh));
  if (cap <= 0 || total <= cap || total <= 0) return;
  const factor = cap / total;
  inventory.pvKwh *= factor;
  inventory.unknownKwh *= factor;
  for (const item of Object.values(inventory.grid)) {
    item.kwh *= factor;
    item.cost *= factor;
  }
}

function consumeInventory(inventory, kwh) {
  const available = inventoryKwh(inventory);
  const wanted = Math.min(Math.max(0, n(kwh)), available);
  const result = { pvKwh: 0, unknownKwh: 0, grid: {} };
  if (wanted <= 0 || available <= 0) return result;
  const fraction = wanted / available;

  result.pvKwh = inventory.pvKwh * fraction;
  result.unknownKwh = inventory.unknownKwh * fraction;
  inventory.pvKwh -= result.pvKwh;
  inventory.unknownKwh -= result.unknownKwh;

  for (const [id, item] of Object.entries(inventory.grid)) {
    const usedKwh = item.kwh * fraction;
    const usedCost = item.cost * fraction;
    result.grid[id] = { label: item.label, kwh: usedKwh, cost: usedCost };
    item.kwh -= usedKwh;
    item.cost -= usedCost;
    if (item.kwh < 0.000001) delete inventory.grid[id];
  }
  return result;
}

function addChargeCost(day, tariff, kwh, cost) {
  if (kwh <= 0) return;
  const id = String(tariff?.id || tariff?.label || 'grid');
  const label = String(tariff?.label || tariff?.id || 'Grid');
  const item = day.chargeCostsByTariff[id] || { label, kwh: 0, cost: 0 };
  item.label = label;
  item.kwh += kwh;
  item.cost += Math.max(0, cost);
  day.chargeCostsByTariff[id] = item;
}

function integrateInterval({ day, inventory, seconds, gridW, pvW, batteryW, importPrice, feedInPrice = 0, tariff, capacityKwh }) {
  const dtHours = Math.max(0, Math.min(300, n(seconds))) / 3600;
  if (dtHours <= 0) return;

  const grid = n(gridW);
  const pv = Math.max(0, n(pvW));
  const battery = n(batteryW); // positive discharge, negative charge
  const chargeW = Math.max(0, -battery);
  const dischargeW = Math.max(0, battery);
  const loadW = Math.max(0, pv + dischargeW + grid - chargeW);

  const pvToLoadW = Math.min(pv, loadW);
  const remainingPvW = Math.max(0, pv - pvToLoadW);
  const pvToBatteryW = Math.min(chargeW, remainingPvW);
  const gridToBatteryW = Math.min(Math.max(0, grid), Math.max(0, chargeW - pvToBatteryW));
  const remainingLoadW = Math.max(0, loadW - pvToLoadW);
  const batteryToLoadW = Math.min(dischargeW, remainingLoadW);
  const batteryToGridW = Math.min(Math.max(0, -grid), Math.max(0, dischargeW - batteryToLoadW));

  const directPvKwh = (pvToLoadW / 1000) * dtHours;
  day.directPvKwh += directPvKwh;
  day.directPvValue += directPvKwh * Math.max(0, n(importPrice));

  const pvChargeKwh = (pvToBatteryW / 1000) * dtHours;
  const gridChargeKwh = (gridToBatteryW / 1000) * dtHours;
  day.pvChargeKwh += pvChargeKwh;
  day.gridChargeKwh += gridChargeKwh;
  day.batteryChargeKwh += pvChargeKwh + gridChargeKwh;
  inventory.pvKwh += pvChargeKwh;

  if (gridChargeKwh > 0) {
    const chargeCost = gridChargeKwh * Math.max(0, n(importPrice));
    day.gridChargeCost += chargeCost;
    addChargeCost(day, tariff, gridChargeKwh, chargeCost);
    addGridCharge(inventory, tariff, gridChargeKwh, chargeCost);
  }
  trimInventory(inventory, capacityKwh);

  const dischargedKwh = ((batteryToLoadW + batteryToGridW) / 1000) * dtHours;
  if (dischargedKwh <= 0) return;
  const consumed = consumeInventory(inventory, dischargedKwh);
  const homeShare = (batteryToLoadW + batteryToGridW) > 0 ? batteryToLoadW / (batteryToLoadW + batteryToGridW) : 0;
  const exportShare = 1 - homeShare;

  const pvHomeKwh = consumed.pvKwh * homeShare;
  const pvExportKwh = consumed.pvKwh * exportShare;
  day.pvBatteryKwh += consumed.pvKwh;
  day.pvBatteryValue += (pvHomeKwh * Math.max(0, n(importPrice))) + (pvExportKwh * Math.max(0, n(feedInPrice)));

  for (const item of Object.values(consumed.grid)) {
    const sourceCostPerKwh = item.kwh > 0 ? item.cost / item.kwh : 0;
    const gridHomeKwh = item.kwh * homeShare;
    const gridExportKwh = item.kwh * exportShare;
    day.shiftKwh += item.kwh;
    day.shiftValue += gridHomeKwh * (n(importPrice) - sourceCostPerKwh);
    day.shiftValue += gridExportKwh * (n(feedInPrice) - sourceCostPerKwh);
  }
}

function addDays(target, source) {
  target.directPvKwh += n(source?.directPvKwh);
  target.directPvValue += n(source?.directPvValue);
  target.pvBatteryKwh += n(source?.pvBatteryKwh);
  target.pvBatteryValue += n(source?.pvBatteryValue);
  target.shiftKwh += n(source?.shiftKwh);
  target.shiftValue += n(source?.shiftValue);
  target.batteryChargeKwh += n(source?.batteryChargeKwh);
  target.pvChargeKwh += n(source?.pvChargeKwh);
  target.gridChargeKwh += n(source?.gridChargeKwh);
  target.gridChargeCost += n(source?.gridChargeCost);
  for (const [id, item] of Object.entries(source?.chargeCostsByTariff || {})) {
    const existing = target.chargeCostsByTariff[id] || { label: String(item?.label || id), kwh: 0, cost: 0 };
    existing.kwh += n(item?.kwh);
    existing.cost += n(item?.cost);
    target.chargeCostsByTariff[id] = existing;
  }
  return target;
}

module.exports = {
  emptyDay,
  normalizeDay,
  totalSavings,
  emptyInventory,
  normalizeInventory,
  inventoryKwh,
  integrateInterval,
  addDays,
};
