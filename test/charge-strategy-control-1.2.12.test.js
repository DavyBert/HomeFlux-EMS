'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const engine = require('../lib/ems-engine');
const strategy = require('../lib/charge-strategy');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const NativeDate = Date, originalNow = Date.now;
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
const restore = installVirtualClearTimeout();
const originalPrepare = engine.prepareChargeStrategy;
let calls = 0;
engine.prepareChargeStrategy = (...args) => { calls++; return originalPrepare(...args); };
const { boot } = require('./startup-harness');
async function main() {
  try {
    const c = strategy.normalize(); c.year.day.mode = 'maximum'; c.year.day.position = 'latest';
    c.summer.night = { mode: 'maximum', extraPercent: 0, position: 'early' };
    const now = NativeDate.parse('2026-10-20T09:00:00Z'); // 11:00 Brussels
    const h = await setup(undefined, { chargeStrategy: c, batteryCount: 4, totalCapacityKwh: 10,
      maxTotalChargeW: 4000, maxChargePerBatteryW: 1000, maxTotalDischargeW: 4000,
      maxDischargePerBatteryW: 2000, peakShaveEnabled: true, peakLimitW: 2600, peakSoftMarginW: 0,
      slowControlIntervalSeconds: 300, minSoc: 10, safetySoc: 10,
      commandDeadbandW: 0, batteryCommandStepW: 1, gridZeroMinW: 0, gridZeroMaxW: 0 }, now, 0);
    const a = h.app;
    Object.assign(a.state, { batterySoc: [50, 50, 50, 50], targetSocOverride: 80, lastTotalCommandW: 0,
      lastBatteryCommands: [0, 0, 0, 0], nightPlanningActive: false, pvSeenProducingToday: true,
      pvProducingDate: '2026-10-20', forecastRemainingKwh: 0 });
    a.inputSeen.batterySoc[0] = true; a.inputSeen.batterySoc[1] = true;
    await h.grid(600); await h.start(); await h.flush();
    assert.deepEqual(h.errors, []);
    assert.equal(a.getSettings().controlEnabled, true);
    assert.equal(a.controlRuntimeSettings.batteryChargeStrategyPlan.gridPowerW, 2000);
    assert.equal(a.latestResult.plannedChargeW, 0);
    const first = a.controlRuntimeSettings.batteryChargeStrategyPlan;
    a.clearContextTimer(); a.contextDirty = false;
    a.contextDirtyReasons.clear();
    const before = calls;
    for (let i = 1; i <= 40; i++) {
      h.setNow(now + i * 1000);
      a.evaluateFastNow(false);
    }
    a.runContextHeartbeat();
    assert.equal(calls, before, 'fast evaluation and heartbeat must not construct a strategy');
    assert.equal(a.controlRuntimeSettings.batteryChargeStrategyPlan, first);
    // The existing context pass, not a new timer, changes the actual budget.
    h.setNow(now + 300000);
    a.state.gridPowerW = 1600; a.gridSamples = [];
    await h.start(); await h.flush();
    assert(calls > before);
    assert.equal(a.controlRuntimeSettings.batteryChargeStrategyPlan.gridPowerW, 1000);
    // Exact latest boundaries reuse the existing single context timer. There
    // is no battery-strategy polling in the fast loop or heartbeat.
    const boundaryHarness = await setup(undefined, { chargeStrategy: c,
      totalCapacityKwh: 10, maxTotalChargeW: 4000, maxChargePerBatteryW: 1000,
      peakLimitW: 2600, peakSoftMarginW: 0, minSoc: 10, safetySoc: 10,
      slowControlIntervalSeconds: 300, commandDeadbandW: 0, batteryCommandStepW: 1,
      gridZeroMinW: 0, gridZeroMaxW: 0 }, NativeDate.parse('2026-11-02T11:00:00Z'), 0);
    const ba = boundaryHarness.app;
    const boundaryTrigger=ba.commandTrigger.trigger;
    ba.commandTrigger.trigger=async tokens=>{
      await boundaryTrigger(tokens);
      // P1 includes the newly commanded battery power. Without feedback an
      // unchanged meter would falsely look like a lower household demand.
      ba.state.gridPowerW=1600-Number(tokens.total_command);ba.gridSamples=[];
    };
    Object.assign(ba.state, { batterySoc: [67,67,67,67], targetSocOverride: 80,
      lastTotalCommandW: 0, lastBatteryCommands: [0,0,0,0], nightPlanningActive: false,
      forecastRemainingKwh: 0, pvProducingDate: '2026-11-02' });
    await boundaryHarness.grid(1600); await boundaryHarness.start(); await boundaryHarness.flush();
    const boundaryPlan = ba.controlRuntimeSettings.batteryChargeStrategyPlan;
    assert.equal(boundaryPlan.blocks[0].startAt, NativeDate.parse('2026-11-02T14:27:00Z'));
    assert.equal(boundaryPlan.blocks.at(-1).endAt, NativeDate.parse('2026-11-02T15:45:00Z'));
    assert(ba.contextTimerAt > boundaryHarness.now() && ba.contextTimerAt <= boundaryPlan.blocks[0].startAt);
    assert.equal(boundaryHarness.timers.filter(t=>!t.done && t===ba.contextTimer).length, 1);
    boundaryHarness.setNow(boundaryPlan.blocks[0].startAt);
    ba.inputUpdatedAt.grid=boundaryHarness.now(); ba.inputUpdatedAt.pv=boundaryHarness.now();
    ba.inputUpdatedAt.batterySoc.fill(boundaryHarness.now());
    await boundaryHarness.flush();
    assert(boundaryHarness.contexts.some(x=>x.at===boundaryPlan.blocks[0].startAt));
    assert(ba.latestResult.plannedChargeW>0, 'scheduled boundary activates charging');
    assert(ba.contextTimerAt>boundaryHarness.now() && ba.contextTimerAt<=boundaryPlan.blocks.at(-1).endAt);
    boundaryHarness.setNow(boundaryPlan.blocks.at(-1).endAt);
    ba.state.batterySoc.fill(80); ba.state.lastTotalCommandW=-1000;
    ba.state.gridPowerW=2600; ba.gridSamples=[];
    ba.inputUpdatedAt.grid=boundaryHarness.now(); ba.inputUpdatedAt.pv=boundaryHarness.now();
    ba.inputUpdatedAt.batterySoc.fill(boundaryHarness.now());
    await boundaryHarness.flush();
    assert.equal(ba.latestResult.plannedChargeW,0, 'the completed latest window stops charging');
    assert.deepEqual(boundaryHarness.errors, []);
    h.setNow(now + 300000);
    Date.now=()=>h.now();
    // Production dynamic source selection also reaches the new day planner.
    await h.setExternalSetting('dynamicPriceSources', ['external']);
    await h.setExternalSetting('dynamicPriceSource', 'external');
    await h.setExternalSetting('contractType', 'dynamic_quarter');
    const { localParts } = require('../lib/homey-energy');
    const rows = [];
    for (let t = now - 12 * 3600000; t < now + 36 * 3600000; t += 900000) {
      const p = localParts(new Date(t), 'Europe/Brussels');
      rows.push({ startMs: t, dateKey: p.dateKey, minute: p.minuteOfDay,
        price: p.minuteOfDay >= 13 * 60 && p.minuteOfDay < 14 * 60 ? .05 : .3 });
    }
    a.externalEnergy = { ...a.externalEnergy, slots: rows, currentPrice: .3,
      curveUpdatedAt: h.now(), currentUpdatedAt: h.now() };
    a.invalidatePlanningCache(true); await h.start(); await h.flush();
    assert(a.batteryNightCurve?.curve.intervals.length > 0);
    assert(a.controlRuntimeSettings.batteryChargeStrategyPlan.blocks.length > 0);
    assert.equal(a.controlRuntimeSettings.batteryChargeStrategyPlan.mode, 'maximum');
    assert.equal(a.batteryNightPlanner, null, 'latest daytime charging needs no second night plan');
    const centered = structuredClone(c); centered.year.day.position = 'center';
    await h.setExternalSetting('chargeStrategy', centered); await h.start(); await h.flush();
    assert(a.controlRuntimeSettings.batteryChargeStrategyPlan.costComparison);
    assert.deepEqual(h.errors, []);
    await h.setExternalSetting('chargeStrategy', c);
    // The real night source + reference planner + price gate must publish max power.
    const nightConfig = strategy.normalize(); nightConfig.year.night.mode = 'maximum';
    const nightAt = NativeDate.parse('2026-10-20T22:00:00Z');
    const nh = await setup(undefined, { chargeStrategy: nightConfig, batteryCount: 4, totalCapacityKwh: 10,
      maxTotalChargeW: 4000, maxChargePerBatteryW: 1000, peakLimitW: 2600, peakSoftMarginW: 0,
      minSoc: 10, safetySoc: 10, slowControlIntervalSeconds: 300, cheapHours: 3,
      contractType: 'dynamic_quarter', dynamicPriceSource: 'external', dynamicPriceSources: ['external'],
      gridZeroMinW: 0, gridZeroMaxW: 0, commandDeadbandW: 0, batteryCommandStepW: 1 }, nightAt, 0);
    const na = nh.app, nightRows = [];
    for (let t = nightAt - 12 * 3600000; t < nightAt + 36 * 3600000; t += 900000) {
      const p = localParts(new Date(t), 'Europe/Brussels');
      nightRows.push({ startMs: t, dateKey: p.dateKey, minute: p.minuteOfDay,
        price: p.minuteOfDay >= 3 * 60 && p.minuteOfDay < 4 * 60 ? .05 : .3 });
    }
    Object.assign(na.state, { batterySoc: [50, 50, 50, 50], targetSocOverride: 80,
      lastTotalCommandW: 0, lastBatteryCommands: [0, 0, 0, 0], nightPlanningActive: true,
      nightPlanningStartedDate: '2026-10-20', pvSeenProducingToday: false, forecastRemainingKwh: 0 });
    na.inputSeen.batterySoc.fill(true);
    na.externalEnergy = { ...na.externalEnergy, slots: nightRows, currentPrice: .3,
      curveUpdatedAt: nightAt, currentUpdatedAt: nightAt };
    await nh.grid(600); await nh.start(); await nh.flush();
    const nightPlan = na.controlRuntimeSettings.batteryChargeStrategyPlan;
    assert.equal(nightPlan.mode, 'maximum'); assert(nightPlan.costComparison.advantage);
    assert(na.batteryNightPlanner, 'existing night planner supplies the cost reference');
    nh.setNow(nightPlan.blocks[0].startAt);
    // Feed physical P1 back after each committed command, before forcing a
    // further context. A frozen pre-command meter is not a steady-state load.
    for (let tick = 0; tick < 12; tick++) {
      nh.setNow(nightPlan.blocks[0].startAt + tick * 1000);
      await nh.grid(600 - na.state.lastTotalCommandW); await nh.flush();
    }
    await nh.grid(600 - na.state.lastTotalCommandW); await nh.start(); await nh.flush();
    assert.equal(na.controlRuntimeSettings.batteryChargeStrategyPlan.gridPowerW, 2000);
    assert.equal(na.latestResult.totalCommandW, -2000);
    assert.deepEqual(nh.errors, []);
    // Settings survive reboot, with each inactive profile intact.
    const saved = structuredClone(h.store.get('chargeStrategy'));
    assert.deepEqual(saved, c);
    const reboot = await boot(new Map(h.store));
    assert.deepEqual(reboot.app.getSettings().chargeStrategy, c);
    assert.deepEqual(reboot.errors, []);
    // Migration defaults are one compact object; no extra HVAC/settings fanout.
    const upgraded = await boot(new Map([['version', '1.2.11']]));
    assert.deepEqual(upgraded.app.getSettings().chargeStrategy, strategy.normalize());
    assert.deepEqual(upgraded.errors, []);
    const app = fs.readFileSync(require.resolve('../app'), 'utf8');
    const occurrences = [...app.matchAll(/prepareChargeStrategy\(/g)];
    assert.equal(occurrences.length, 2, 'only context and explicit UI simulation may build the strategy');
    const html = fs.readFileSync(require.resolve('../settings/index.html'), 'utf8');
    assert(html.includes('id="panel-charge-strategy"')); assert(html.includes("'chargeStrategy'"));
    assert.equal((html.match(/id="peakReserveMonth1"/g) || []).length, 1);
    console.log('PASS charge strategy control: slow-only planning, fast/heartbeat reuse, changing load, restart, migration and single month selector');
  } finally {
    engine.prepareChargeStrategy = originalPrepare;
    Date.now = originalNow; global.Date = NativeDate; restore();
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
