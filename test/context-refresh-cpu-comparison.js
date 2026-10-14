'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { setup, installVirtualClearTimeout } = require('./context-refresh-harness');
if (!process.argv[2]) {
  console.error('Usage: node test/context-refresh-cpu-comparison.js /path/to/original-1.0.9');
  process.exit(1);
}
const roots = [path.resolve(process.argv[2]), path.join(__dirname, '..')];
const realNow = Date.now, restore = installVirtualClearTimeout();
async function replay(root, scenario) {
  const overrides = {};
  let start = Date.parse('2026-10-13T10:46:00Z');
  const initialPv = scenario === 'gridCharge' ? 0 : scenario === 'curtailment' ? 6500 : 1495;
  if (scenario === 'activeHvac') Object.assign(overrides, { hvacCount: 1, hvacEnabled: true,
    hvacAllowPowerControl: true, hvacAllowSetpointControl: true, hvacAllowOnBattery: true,
    hvacMinBatterySoc: 40, hvacStopBatterySoc: 20, hvacFastResetImportW: 2000 });
  if (scenario === 'splitCommands') Object.assign(overrides, { splitCommandBattery1Enabled: true,
    splitCommandBattery2Enabled: true });
  if (scenario === 'tariffBoundary') {
    start = Date.parse('2026-10-13T14:58:17Z');
    Object.assign(overrides, { contractType: 'tou', touRates: [
      { id: 'low', name: 'Dal', importPrice: .2, feedInPrice: .03, weekdayChargeMode: 'always', weekendChargeMode: 'always' },
      { id: 'peak', name: 'Piek', importPrice: .3, feedInPrice: .03, weekdayChargeMode: 'never', weekendChargeMode: 'never' }],
      touSchedule: [
        { rateId: 'low', start: '11:00', end: '17:00', days: [1,2,3,4,5,6,7] },
        { rateId: 'peak', start: '17:00', end: '23:59', days: [1,2,3,4,5,6,7] }] });
  }
  const h = await setup(root, overrides, start, initialPv), a = h.app;
  if (scenario === 'curtailment') a.state.batterySoc = [100,100,100,100];
  if (scenario === 'planningMax') { h.settings.dayPlanningMaxSoc = 80; a.state.targetSocOverride = 100; }
  if (scenario === 'activeHvac') {
    Object.assign(a.state, { hvacRoomTemperatureC: 18, hvacMode: 'heat', hvacSetpointC: 21 });
    Object.assign(a.inputSeen.hvac, { roomTemperature: true, mode: true, setpoint: true });
    a.hvacBaselineSetpoint = 21; a.hvacBaselineMode = 'heat'; a.hvacBoostMode = 'heat';
    a.hvacManagedPowerOn = true; a.lastPublishedHvacPower = true;
  }
  await h.start();
  const counters = a.diagnostics.counters, cpuStart = process.cpuUsage();
  let release = null, heldAt = 0, failedOutput = false, activeHvacInputs = 0, curtailmentInputs = 0, abovePlanningMaxPv = 0;
  const publish = a.commandTrigger.trigger;
  if (scenario === 'pendingOutput') a.commandTrigger.trigger = async tokens => {
    await publish(tokens);
    if (h.now() >= start+90000 && !heldAt) {
      heldAt = h.now(); await new Promise(resolve => { release = resolve; });
    }
  };
  if (scenario === 'failedOutput') a.commandTrigger.trigger = async tokens => {
    await publish(tokens);
    if (h.now() >= start+90000 && !failedOutput) { failedOutput = true; throw Error('intentional output failure'); }
  };
  const contextRequests = [];
  const requestContext = a.requestContextEvaluate.bind(a);
  a.requestContextEvaluate = (...args) => {
    requestContext(...args);
    if (a.contextTimer) contextRequests.push({ at: h.now(), reason: args[1], deadline: a.contextTimerAt });
  };
  for (let i = 1; i <= 600; i++) {
    h.setNow(start + i*1000);
    let pv = initialPv, house = 623;
    if (['variablePV','activeHvac','curtailment'].includes(scenario)) pv += Math.floor(i/10)%2 ? 50 : -50;
    if (['cloudsAndPeak','splitCommands','pendingOutput','failedOutput'].includes(scenario)) {
      pv = [1495,4500,0,800,2500,1495][Math.floor(i/50)%6];
      house = [623,3600,900,200,623][Math.floor(i/75)%5];
    }
    if (scenario === 'efficiencyHandover' && i === 90) {
      a.state.batterySoc = [80,55,56,54];
      a.markContextDirty('battery_soc'); a.requestEvaluate(true); await h.drain();
    }
    if (scenario === 'batteryChanges' && [90,180,270,360].includes(i)) {
      if (i === 90) a.state.batterySoc = [58,60,62,100];
      if (i === 180) a.inputSeen.batterySoc[1] = false;
      if (i === 270) a.inputSeen.batterySoc[1] = true;
      if (i === 360) { h.settings.maxTotalChargeW = 800; a.markContextDirty('setting:maxTotalChargeW'); }
      a.requestContextEvaluate(false, 'battery_change'); a.requestEvaluate(true); await h.drain();
    }
    if (scenario === 'planningAndMode' && [90,180,270,360,450].includes(i)) {
      if (i === 90) a.state.forecastRemainingKwh = 4;
      if (i === 180) a.state.targetSocOverride = 85;
      if (i === 270) h.settings.forcedMode = 'self_consumption';
      if (i === 360) h.settings.forcedMode = 'standby';
      if (i === 450) h.settings.forcedMode = 'auto';
      a.invalidatePlanningCache(); a.requestContextEvaluate(true, 'operator_or_planning'); await h.drain();
    }
    if (scenario === 'budgets' && [90,180,270,360].includes(i)) {
      if (i === 90) a.getPlannedBatteryGridLimitW = () => 100;
      if (i === 180) a.getBoilerPeakGuardReserveW = () => 1800;
      if (i === 270) a.getBoilerPeakGuardReserveW = () => 0;
      if (i === 360) a.getEvGridImportControlStatus = () => ({ activeTargetW: 500, requestedTargetW: 500, state: 'active' });
      a.requestContextEvaluate(false, 'module_budget_change'); await h.drain();
    }
    if (scenario === 'planningMax' && i === 90) {
      a.state.batterySoc = [85,85,85,85]; a.requestContextEvaluate(false, 'battery_soc');
      a.requestEvaluate(true); await h.drain();
    }
    if (release && h.now() >= heldAt+20000) { const done = release; release = null; done(); await h.drain(); }
    // The idle/PV-off fixture validates the existing Idle Guard independently
    // of the charging proof while meter refreshes are pending.
    if (scenario === 'idle') {
      pv = 0;
      if (i === 1) {
        h.settings.fixedChargeWindowStart = '01:00'; h.settings.fixedChargeWindowEnd = '07:00';
        h.settings.minSoc = 12; h.settings.safetySoc = 12; a.state.batterySoc = [12,12,12,12];
        a.state.pvPowerW = 0; a.state.gridPowerW = house-a.state.lastTotalCommandW;
        a.inputUpdatedAt.grid = h.now(); a.inputUpdatedAt.pv = h.now();
        a.markContextDirty('setting:charge_window'); a.requestContextEvaluate(true, 'idle_start'); await h.drain();
      }
    }
    if (i%5 === 0) await h.pv(pv);
    const grid = house - pv - a.state.lastTotalCommandW + (i%3-1)*3;
    if (!(scenario === 'staleGrid' && i >= 90 && i < 300)) {
      if (scenario === 'activeHvac' && a.isHvacManagedActiveFor(0)) activeHvacInputs++;
      await h.grid(grid);
    }
    if (i%60 === 0) { a.runContextHeartbeat(); await h.drain(); }
    await h.flush();
    if (scenario === 'curtailment' && Number(a.lastPublishedPvLimitPercent) < 100) curtailmentInputs++;
    if (scenario === 'planningMax' && i >= 90 && a.state.lastTotalCommandW < 0) abovePlanningMaxPv++;
  }
  if (release) { release(); await h.drain(); }
  if (scenario === 'failedOutput') {
    assert(failedOutput, 'failure fixture did not reject a publication');
    assert.equal(h.errors.length, 1, h.errors.join('\n'));
    assert(h.errors[0].includes('intentional output failure'));
  } else assert.equal(h.errors.length, 0, h.errors.join('\n'));
  if (scenario === 'pendingOutput') assert(heldAt > 0, 'pending fixture did not hold a publication');
  const cpu = process.cpuUsage(cpuStart);
  return { p1Updates: counters.gridInputs || 0, counters, sections: a.diagnostics.cpuSections,
    processCpuMs: (cpu.user+cpu.system)/1000, activeHvacInputs, curtailmentInputs, abovePlanningMaxPv, heldAt, failedOutput,
    traces: h.traces, contexts: h.contexts, flexible: h.flexible, contextRequests };
}
(async () => {
  const scenarios = {};
  for (const name of ['gridCharge','mixedCharge','variablePV','activeHvac','cloudsAndPeak','batteryChanges',
    'planningAndMode','budgets','tariffBoundary','pendingOutput','failedOutput','staleGrid','splitCommands','efficiencyHandover','idle','curtailment','planningMax']) {
    const before = await replay(roots[0], name), after = await replay(roots[1], name);
    assert.deepEqual(after.traces, before.traces, `${name}: battery commands, modes, overrides and publication times changed`);
    assert.deepEqual(after.contexts, before.contexts, `${name}: context execution times/force flags changed`);
    assert.deepEqual(after.contextRequests, before.contextRequests, `${name}: pending slow deadlines changed`);
    assert.deepEqual(after.flexible, before.flexible, `${name}: flexible output changed`);
    if (name === 'activeHvac') assert(after.activeHvacInputs > 400, 'HVAC fixture did not maintain an active load');
    if (name === 'idle') assert(after.counters.fastIdleGuardSkipped > 400, 'idle fixture did not exercise the Idle Guard');
    if (name === 'curtailment') assert(after.curtailmentInputs > 400, 'PV limiting never became active');
    if (name === 'planningMax') assert(after.abovePlanningMaxPv > 400, 'PV capture was blocked above the planning maximum');
    if (name === 'variablePV') assert(after.counters.fastEvaluations < before.counters.fastEvaluations/2, 'pending refresh optimization did not reduce work');
    scenarios[name] = { before, after };
  }
  console.log(JSON.stringify({ identicalTimedBatteryTraces: true, identicalContextExecution: true,
    identicalPendingContextDeadlines: true, identicalFlexibleOutputs: true, scenarios }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Date.now = realNow; restore(); });
