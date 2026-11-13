'use strict';
const assert = require('node:assert/strict');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const { boot, DEFAULTS } = require('./startup-harness');
const { localParts, analyzePriceSlots, preparePriceAnalysis, readPriceAnalysis } = require('../lib/homey-energy');
const RealDate = Date, originalNow = Date.now, restore = installVirtualClearTimeout();
let now = RealDate.parse('2026-11-13T11:02:05Z');
global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
function rows(interval = 15, offset = 0) {
  const start = RealDate.parse('2026-11-13T00:00:00Z');
  return Array.from({ length: 3 * 1440 / interval }, (_, i) => {
    const startMs = start + i * interval * 60000, p = localParts(new Date(startMs), 'Europe/Brussels');
    return { startMs, dateKey: p.dateKey, minute: p.minuteOfDay, price: (i % 19) * .025 - .05 + offset };
  });
}
const payload = offset => JSON.stringify(rows(15, offset).map(r => ({ periodStart: new Date(r.startMs).toISOString(), value: r.price })));
(async () => {
  let comparisons = 0;
  for (const interval of [15, 60]) {
    const slots = rows(interval), prepared = preparePriceAnalysis(slots, new Date(now), 'Europe/Brussels', 3, 4);
    for (let at = RealDate.parse('2026-11-12T23:00:00Z'); at < RealDate.parse('2026-11-17T00:00:00Z'); at += 7 * 60000) {
      const date = new Date(at);
      assert.deepEqual(readPriceAnalysis(prepared, slots, date, 'Europe/Brussels'), analyzePriceSlots(slots, date, 'Europe/Brussels', 3, 4));
      comparisons++;
    }
  }
  const h = await setup(undefined, { contractType: 'dynamic_quarter', dynamicPriceSources: ['external'], dynamicPriceSource: 'external',
    expectedEnergyNeedKwh: 0, evCount: 0, forecastRemainingKwh: 20 }, now, 0), a = h.app;
  a.readExternalPrices('external', payload(0));
  await h.start(); await h.flush();
  const snapshot = a.evDeadlinePriceSelection, prepared = snapshot.selection.prepared;
  let selections = 0, analyses = 0;
  const originalSelection = a.getDynamicPriceSelection;
  a.getDynamicPriceSelection = function(...args) { selections++; const before = this.evDeadlinePriceSelection?.selection.prepared;
    const result = originalSelection.apply(this, args); if (before !== this.evDeadlinePriceSelection?.selection.prepared) analyses++; return result; };
  const settings = a.getSettings();
  a.emsDevices = new Set([{ syncFromApp: async () => {} }]);
  for (let i = 0; i < 300; i++) {
    h.setNow(h.now() + 1000); a.inputUpdatedAt.grid = h.now();
    if (i === 20) a.markContextDirty('battery_soc_changed');
    if (i % 2 === 0) a.getPublicStatus();
    if (i % 60 === 0) { a.priceSourceHeartbeatSignature = 'external|disabled'; a.runContextHeartbeat(); await a.syncEmsDevices(); }
  }
  assert.equal(analyses, 0, 'status/device/heartbeat never rebuild a price curve');
  assert.equal(analyses, 0);
  assert.equal(a.evDeadlinePriceSelection.selection.prepared, prepared, 'reuse existing results without copying curves');
  assert.equal(a.getInputReadiness(settings, { preparedPrices: true }).priceDataReady, true, 'P1 dirtiness cannot invalidate prices');
  // New curve is prepared by its existing input event before a status request.
  a.readExternalPrices('external', payload(.07));
  const beforeStatus = selections;
  assert.equal(a.getHomeyEnergyStatus().currentPrice, a.getExternalEnergyStatus().curveCurrentPrice);
  assert.equal(selections, beforeStatus);
  const valid = a.getHomeyEnergyStatus().currentPrice;
  assert.throws(() => a.readExternalPrices('external', 'bad JSON'));
  assert.equal(a.getHomeyEnergyStatus().currentPrice, valid, 'atomic invalid-input rejection preserves valid data');
  // A price publication during a real synchronous planning calculation must
  // survive its pending context request and cannot be overwritten by old work.
  const originalPlan = a.refreshPlanningInContext; let injected = false;
  a.refreshPlanningInContext = function(...args) { const plan = originalPlan.apply(this, args);
    if (!injected) { injected = true; this.readExternalPrices('external', payload(.11)); } return plan; };
  await h.start(); a.refreshPlanningInContext = originalPlan; await h.flush();
  assert(injected); assert(a.evDeadlinePriceSelection.selection.prepared.raw.external.slots.some(r => r.price > .5));
  assert.equal(a.contextEvaluationRunning, false);
  assert.equal(a.controlRuntimeSettings.dynamicPriceDataReady, true);
  // Midnight reads use the next day's already prepared daily classification.
  h.setNow(RealDate.parse('2026-11-14T00:00:00Z'));
  const midnight = a.getHomeyEnergyStatus();
  const complete = a.getDynamicPriceSelection(settings, new Date(h.now()), { readOnly: true });
  assert.equal(midnight.currentPrice, complete.analysis.currentPrice);
  assert.equal(midnight.currentRank, complete.analysis.currentRank);
  // Startup restores persisted curves and prepares before the first status.
  now = h.now(); Date.now = () => now;
  const restarted = await boot(new Map(h.store));
  assert(restarted.app.evDeadlinePriceSelection?.selection.prepared);
  assert.equal(restarted.app.getHomeyEnergyStatus().currentPrice, midnight.currentPrice);
  await h.setExternalSetting('cheapHours', 4);
  assert.equal(a.getHomeyEnergyStatus().cheapHours, 4);
  // A fixed-to-dynamic switch transfers the same result reference and drops
  // the former planner reference, so old curves cannot be retained twice.
  const fixed = await setup(undefined, { contractType: 'fixed', dynamicPriceSources: ['external'], dynamicPriceSource: 'external' }, now, 0);
  fixed.app.readExternalPrices('external', payload(0));
  assert(fixed.app.planningCache.priceSelection);
  const fixedRows = fixed.app.getPriceSelectionSnapshot().selection.slots;
  await fixed.setExternalSetting('contractType', 'dynamic_quarter');
  assert(fixed.app.evDeadlinePriceSelection);
  assert.equal(fixed.app.planningCache.priceSelection, null);
  assert.equal(fixed.app.getHomeyEnergyStatus().available, true);
  console.log(`1.3.3 reuse: ${comparisons} daily/segment comparisons; 300 status/P1/heartbeat samples; changed/invalid input, planning interleave, midnight, restart and settings passed`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(() => { restore(); global.Date = RealDate; Date.now = originalNow; });
