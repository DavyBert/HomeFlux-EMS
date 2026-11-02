"use strict";
// Read-only projection of the existing Savings inventory. No energy is added,
// consumed or reclassified here. Missing initial inventory is unknown, not PV.
function origin(inventory, storedKwh = null) {
  const positive = n => Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0;
  const gridKwh = Object.values(inventory?.grid || {}).reduce((sum, item) => sum + positive(item?.kwh), 0);
  const trackedKwh = gridKwh + positive(inventory?.pvKwh) + positive(inventory?.unknownKwh);
  const totalKwh = Math.max(trackedKwh, positive(storedKwh));
  return { gridKwh, totalKwh, gridShare: totalKwh > 0 ? gridKwh / totalKwh : null };
}
module.exports = { origin };
