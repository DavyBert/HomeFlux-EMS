'use strict';
const assert = require('node:assert/strict');
const { setup, installVirtualClearTimeout } = require('./context-refresh-harness');
const realNow = Date.now, restore = installVirtualClearTimeout();
async function stable(overrides = {}) {
  const h = await setup(undefined, overrides);
  await h.start(); h.setNow(h.now() + 10000);
  await h.grid(623 - 1495 - h.app.state.lastTotalCommandW);
  h.app.requestEvaluate(true); await h.drain();
  assert.equal(h.app.canSkipBatteryFeedback(h.settings, h.now()), true);
  return h;
}
async function run() {
  // Real Flow inputs retain both the original slow deadline and battery proof.
  {
    const h = await stable(), a = h.app, memo = a.batteryFeedbackMemo;
    const timer = a.contextTimer, deadline = a.contextTimerAt;
    const before = a.diagnostics.counters.fastEvaluations, contexts = h.contexts.length;
    for (let i = 0; i < 15; i++) {
      h.setNow(h.now() + 1000);
      await h.grid(623 - 1495 - a.state.lastTotalCommandW + (i%3-1)*3);
    }
    assert(a.contextDirty && a.flexibleLoadsDirty);
    assert.equal(a.controlContextDirty, false);
    assert.equal(a.contextTimer, timer); assert.equal(a.contextTimerAt, deadline);
    assert.equal(a.batteryFeedbackMemo, memo);
    assert.equal(a.diagnostics.counters.fastEvaluations, before);
    assert.equal(h.contexts.length, contexts);
    // A new PV observation still takes its normal live-control path, but its
    // module-refresh request must not invalidate the newly established proof.
    await h.pv(1645);
    assert.equal(a.controlContextDirty, false);
    assert.equal(a.contextTimer, timer); assert.equal(a.contextTimerAt, deadline);
    assert.equal(a.canSkipBatteryFeedback(h.settings, h.now()), true);
    h.setNow(deadline); a.inputUpdatedAt.grid = deadline;
    await h.flush();
    assert.equal(h.contexts.length, contexts + 1);
    assert.equal(h.contexts.at(-1).at, deadline);
    assert.notEqual(a.controlContext, memo.context);
    assert.equal(h.errors.length, 0, h.errors.join('\n'));
  }
  // A subsequent meter-only request can never clear/promote a structural
  // invalidation. Unknown/default callers remain conservatively structural.
  for (const reason of ['setting:forcedMode','planning','unknown_module_change']) {
    const h = await stable(), a = h.app, deadline = a.contextTimerAt;
    a.requestContextEvaluate(false, reason);
    assert.equal(a.controlContextDirty, true);
    a.requestContextEvaluate(false, 'grid_context', 0, false, false);
    assert.equal(a.controlContextDirty, true);
    assert.equal(a.contextTimerAt, deadline);
    assert.equal(a.canSkipBatteryFeedback(h.settings, h.now()), false);
  }
  // Live battery-relevant inputs still defeat a proof while a harmless slow
  // refresh is pending, including budgets that do not yet alter total watts.
  const changes = [
    h => { h.app.state.batterySoc[0] += .1; },
    h => { h.app.state.batterySoc[1] = 100; },
    h => { h.app.inputSeen.batterySoc[1] = false; },
    h => { h.app.state.forecastRemainingKwh = 4; },
    h => { h.app.state.forecastTomorrowKwh = 4; },
    h => { h.app.state.nightPlanningActive = true; h.app.state.nightPlanningStartedDate = '2026-10-13'; },
    h => { h.app.state.targetSocOverride = 90; },
    h => { h.app.state.lastTotalCommandW -= 1; },
    h => { h.app.lastEmittedCommands[0] -= 1; },
    h => { h.app.efficiencyChargeStickyIndex = 2; },
    h => { h.app.getPlannedBatteryGridLimitW = () => 100; },
    h => { h.app.getBoilerPeakGuardReserveW = () => 1800; },
    h => { h.app.getEvGridImportControlStatus = () => ({ activeTargetW: 1100, requestedTargetW: 1100, state: 'active' }); },
    h => { h.app.commandPublishing = true; },
    h => { h.app.pendingResult = h.app.latestResult; },
    h => { h.app.pendingCommandBypassInterval = true; },
    h => { h.settings.hybridEmsEnabled = true; },
    h => { h.app.inputUpdatedAt.grid = h.now() - 600000; },
    h => { h.app.splitModeChangeNeeded = () => true; },
    h => { h.settings.maxTotalChargeW = 500; h.app.markContextDirty('setting:maxTotalChargeW'); },
    h => { h.settings.forcedMode = 'standby'; h.app.markContextDirty('setting:forcedMode'); },
    h => { h.app.invalidatePlanningCache(); },
  ];
  for (const change of changes) {
    const h = await stable(); change(h);
    assert.equal(h.app.canSkipBatteryFeedback(h.settings, h.now()), false, `invalidation: ${change}`);
  }
  // A minute boundary still expires the proof even though the context request
  // itself is harmless. New raw peak/export inputs retain normal evaluation.
  {
    const h = await stable(); h.setNow(Math.ceil((h.now()+1)/60000)*60000);
    h.app.inputUpdatedAt.grid = h.now();
    assert.equal(h.app.canSkipBatteryFeedback(h.settings, h.now()), false);
  }
  for (const grid of [-1500, 3200]) {
    const h = await stable(); const before = h.app.diagnostics.counters.fastEvaluations;
    h.setNow(h.now()+1000); await h.grid(grid); await h.flush();
    assert.equal(h.app.diagnostics.counters.fastEvaluations, before+1);
    if (grid === 3200) assert.equal(h.app.latestResult.override, 'peak_shave');
    else assert(h.app.latestResult.candidateTotalCommandW < -h.app.latestResult.plannedChargeW);
  }
  // API meter-only and mixed structural payloads must be distinguished. No
  // broad whitelist of API/flexible-load requests may suppress invalidation.
  {
    const h = await stable(); h.app.lastContextGridInputW = null;
    h.app.setInput({ gridPowerW: h.app.state.gridPowerW }); await h.drain();
    assert.equal(h.app.controlContextDirty, false);
    assert.equal(h.app.canSkipBatteryFeedback(h.settings, h.now()), true);
    h.app.setInput({ gridPowerW: h.app.state.gridPowerW, batterySoc: [58,58,58,58] }); await h.drain();
    assert.equal(h.app.controlContextDirty, true);
  }
  {
    const h = await stable();
    h.app.setInput({ gridPowerW: h.app.state.gridPowerW, hvac: { roomTemperatureC: 18 } }); await h.drain();
    assert.equal(h.app.controlContextDirty, true);
  }
  // Reentrant meter requests in a running context pass keep their pending
  // execution without being upgraded to a structural invalidation afterward.
  for (const structural of [false,true]) {
    const h = await stable(), a = h.app;
    const original = a.evaluateContextNow.bind(a);
    let once = false;
    a.evaluateContextNow = force => {
      const result = original(force);
      if (!once) { once = true; a.requestContextEvaluate(false, structural ? 'setting:test' : 'grid_context', 0, false, structural); }
      return result;
    };
    await a.runContextEvaluation(); await h.drain();
    assert(a.contextTimer && a.contextDirty);
    assert.equal(a.controlContextDirty, structural);
    assert.equal(a.contextTimerAt, h.now()+60000);
  }
  // The heartbeat must carry forward the existing kind of invalidation. The
  // ordinary boiler reset remains structural; periodic module work is not.
  {
    const h = await stable(), a = h.app;
    a.clearContextTimer(); a.markContextDirty('active_flexible_load', false);
    a.runContextHeartbeat(); await h.drain();
    assert(a.contextTimer); assert.equal(a.controlContextDirty, false);
    a.markContextDirty('boiler_reset_boundary'); a.runContextHeartbeat(); await h.drain();
    assert.equal(a.controlContextDirty, true);
  }
  console.log('1.0.10 context refresh regression passed: real Flow/API scheduler, unchanged deadlines, structural invalidation, live budgets/SoC/forecast/limits, minute expiry, export/Peak Guard, pending/Split/Hybrid, reentrant scheduling and heartbeat propagation.');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Date.now = realNow; restore(); });
