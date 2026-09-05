'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class App {} };
  if (request === 'homey-api') return { HomeyAPI: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const HomeFluxEmsApp = require('../app');
const { emptyDay, emptyInventory } = require('../lib/savings');
Module._load = originalLoad;

function bareApp() {
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.state = {
    gridPowerW: 0,
    pvPowerW: 0,
    forecastRemainingKwh: 0,
    batterySoc: [50, 50, 50, 50, null, null, null, null],
    lastTotalCommandW: 0,
    nightPlanningActive: false,
    nightPlanningStartedDate: '',
    nightPlanningDecisionSource: '',
    pvProducingDate: '',
    pvSeenProducingToday: false,
  };
  app.inputSeen = {
    grid: true,
    pv: true,
    forecast: true,
    forecastTomorrow: false,
    batterySoc: [true, true, true, true, false, false, false, false],
  };
  app.inputUpdatedAt = {
    grid: 0,
    pv: 0,
    forecast: 0,
    forecastTomorrow: 0,
    batterySoc: Array(8).fill(0),
  };
  app.gridInputHistory = [];
  app.lastEmittedCommands = [];
  app.lastEmittedMode = '';
  app.lastEmittedOverride = '';
  app.lastEmitAt = 0;
  app.nextCommandAllowedAt = 0;
  app.commandPublishing = false;
  app.pendingCommandBypassInterval = false;
  app.pendingResult = null;
  app.tokens = new Map();
  app.latestResult = null;
  app.commandTrigger = { trigger: async () => true };
  app.getSettings = () => ({ batteryCount: 4, commandIntervalSeconds: 10, minSoc: 10, maxSoc: 100 });
  app.homey = {
    setTimeout,
    clock: { getTimezone: () => 'Europe/Brussels' },
    settings: { get: () => 10 },
  };
  app.error = () => {};
  app.queueStatusUpdate = () => {};
  app.publishFlexibleLoads = async () => ({});
  return app;
}

// Time-weighted 5 s grid history, without any extra polling.
{
  const app = bareApp();
  const now = 1_000_000;
  app.state.gridPowerW = 500;
  for (let i = 5; i >= 0; i -= 1) app.recordGridSample((5 - i) * 100, now - (i * 1000));
  assert.equal(Math.round(app.getGridAverage(5000, now)), 200);
}

// Configurable PV delta: reaching the 100 W default switches to live grid; below it keeps the 5 s average.
{
  const app = bareApp();
  const now = 2_000_000;
  app.state.gridPowerW = 500;
  app.state.pvPowerW = 1000;
  for (let i = 5; i >= 0; i -= 1) app.recordGridSample((5 - i) * 100, now - (i * 1000));
  app.inputUpdatedAt.batterySoc = [now, now, now, now, 0, 0, 0, 0];

  const averaged = app.getEvaluationState({ batteryCount: 4 }, now, 99);
  assert.equal(averaged.controlGridSource, 'average_5s');
  assert.equal(Math.round(averaged.controlGridPowerW), 200);

  const live = app.getEvaluationState({ batteryCount: 4 }, now, 100);
  assert.equal(live.controlGridSource, 'live_pv_delta');
  assert.equal(live.controlGridPowerW, 500);

  const disabled = app.getEvaluationState({ batteryCount: 4, pvDeltaThresholdW: 0 }, now, 500);
  assert.equal(disabled.controlGridSource, 'average_5s');
}

// v0.4.18: grid control supports direct, 5 s, 7 s and 10 s baselines.
{
  const app = bareApp();
  const now = 2_500_000;
  app.state.gridPowerW = 1000;
  for (let i = 10; i >= 0; i -= 1) app.recordGridSample((10 - i) * 100, now - (i * 1000));
  app.inputUpdatedAt.batterySoc = [now, now, now, now, 0, 0, 0, 0];

  assert.equal(app.getEvaluationState({ batteryCount: 4, gridControlWindowSeconds: 0, pvDeltaThresholdW: 0 }, now, 0).controlGridSource, 'direct');
  assert.equal(app.getEvaluationState({ batteryCount: 4, gridControlWindowSeconds: 5, pvDeltaThresholdW: 0 }, now, 0).controlGridSource, 'average_5s');
  assert.equal(app.getEvaluationState({ batteryCount: 4, gridControlWindowSeconds: 7, pvDeltaThresholdW: 0 }, now, 0).controlGridSource, 'average_7s');
  assert.equal(app.getEvaluationState({ batteryCount: 4, gridControlWindowSeconds: 10, pvDeltaThresholdW: 0 }, now, 0).controlGridSource, 'average_10s');
}

// v0.4.18: one isolated large load step keeps the selected averaged regulator,
// while a second opposite step inside the configured repeat window switches
// temporarily to the live meter. This catches cycling loads such as an
// airfryer thermostat without making every normal 2 kW load start go live.
{
  const app = bareApp();
  const settings = {
    batteryCount: 4,
    gridControlWindowSeconds: 5,
    pvDeltaThresholdW: 0,
    adaptiveLiveControlEnabled: true,
    adaptiveSetpointDeltaW: 1000,
    adaptiveSetpointWindowSeconds: 15,
  };
  const start = 2_700_000;
  app.inputUpdatedAt.batterySoc = [start, start, start, start, 0, 0, 0, 0];
  app.recordGridSample(0, start);
  app.state.gridPowerW = 0;
  assert.equal(app.updateAdaptiveSetpointDetection(0, settings, start), false);

  app.recordGridSample(2000, start + 1000);
  app.state.gridPowerW = 2000;
  assert.equal(app.updateAdaptiveSetpointDetection(2000, settings, start + 1000), false);
  assert.equal(app.getEvaluationState(settings, start + 1000, 0).controlGridSource, 'average_5s');

  app.recordGridSample(0, start + 8000);
  app.state.gridPowerW = 0;
  assert.equal(app.updateAdaptiveSetpointDetection(0, settings, start + 8000), true);
  const live = app.getEvaluationState(settings, start + 8000, 0);
  assert.equal(live.controlGridSource, 'live_adaptive_setpoint');
  assert.equal(live.controlGridPowerW, 0);

  const afterHold = app.getEvaluationState(settings, start + 23_001, 0);
  assert.equal(afterHold.controlGridSource, 'average_5s');
}

// A received SoC value never expires by age. Only batteries without any value are unavailable.
{
  const app = bareApp();
  const now = 3_000_000;
  app.inputUpdatedAt.batterySoc = [now, now, now - (24 * 60 * 60 * 1000), now, 0, 0, 0, 0];
  const controlState = app.getEvaluationState({ batteryCount: 4 }, now, 0);
  assert.equal(controlState.batterySoc[2], 50);
  assert.equal(controlState.batterySoc[0], 50);

  app.inputSeen.batterySoc[2] = false;
  const missingState = app.getEvaluationState({ batteryCount: 4 }, now, 0);
  assert.equal(missingState.batterySoc[2], null);
}

// Forecast Battery Save uses the maximum forecast observed for the local day, persisted across restarts.
{
  const app = bareApp();
  let dateKey = '2026-08-23';
  const stored = {};
  app.getForecastDateKey = () => dateKey;
  app.homey.settings = {
    get: key => Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null,
    set: (key, value) => { stored[key] = value; },
  };

  app.updateForecastInput(40, 1000);
  app.updateForecastInput(3, 2000);
  assert.equal(app.state.forecastRemainingKwh, 3);
  assert.equal(app.state.forecastDailyMaxKwh, 40);
  assert.equal(stored._forecastDailyMaxKwh, 40);

  // A new local day starts clean; yesterday's high value is never reused.
  dateKey = '2026-08-24';
  app.ensureForecastDayCurrent(3000);
  assert.equal(app.state.forecastDailyMaxKwh, null);
  assert.equal(app.inputSeen.forecast, false);
  app.updateForecastInput(4, 4000);
  assert.equal(app.state.forecastDailyMaxKwh, 4);
  assert.equal(app.state.forecastRemainingKwh, 4);
}

// Tomorrow forecast is promoted to today's full-day forecast at the local day change.
{
  const app = bareApp();
  let dateKey = '2026-08-23';
  const stored = {};
  app.getForecastDateKey = () => dateKey;
  app.homey.settings = {
    get: key => Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null,
    set: (key, value) => { stored[key] = value; },
  };
  app.state.forecastDailyMaxDate = '2026-08-23';
  app.state.forecastTomorrowDate = '2026-08-24';
  app.state.forecastTomorrowKwh = 18;
  app.inputSeen.forecastTomorrow = true;
  dateKey = '2026-08-24';
  app.ensureForecastDayCurrent(5000);
  assert.equal(app.state.forecastDailyMaxKwh, 18);
  assert.equal(app.state.forecastTomorrowKwh, null);
  assert.equal(app.inputSeen.forecastTomorrow, false);
}

// Normal commands can never pass before nextCommandAllowedAt.
{
  const app = bareApp();
  let emitted = false;
  let reevaluateRequested = false;
  app.commandChangedEnough = () => true;
  app.emitPending = async () => { emitted = true; };
  app.requestEvaluate = () => { reevaluateRequested = true; };
  app.lastEmitAt = Date.now();
  app.nextCommandAllowedAt = app.lastEmitAt + 10_000;
  app.queueCommandEmit({ canPublishCommands: true, candidateCommands: [100, 0, 0, 0], candidateTotalCommandW: 100 });
  assert.equal(emitted, false);
  assert.equal(reevaluateRequested, true);
}

// v0.2.26: PV below 5 W for 10 minutes activates the evening plan with tomorrow's forecast.
{
  const app = bareApp();
  const callbacks = [];
  app.homey.setTimeout = callback => { callbacks.push(callback); return callbacks.length; };
  app.requestEvaluate = () => {};
  app.publishChargePlanIfChanged = async () => {};
  app.getSettings = () => ({ chargeDeadline: '07:00' });
  app.getLocalDateKey = () => '2026-08-23';
  app.getLocalMinuteOfDay = () => 18 * 60;
  app.inputSeen.pv = true;
  app.state.pvSeenProducingToday = true;
  app.state.pvProducingDate = '2026-08-23';
  app.state.pvPowerW = 4;
  app.updatePvPlanningState(4, 1000);
  assert.equal(callbacks.length, 1);
  callbacks[0]();
  assert.equal(app.state.nightPlanningActive, true);
  assert.equal(app.state.nightPlanningStartedDate, '2026-08-23');
  assert.equal(app.state.nightPlanningDecisionSource, 'pv_below_5w_10m');
  assert.equal(app.getPlanningForecastDay(1000), 'tomorrow');
}

// v0.4.13: at 20:00, fresh low PV after a real solar day must still
// complete the normal 10-minute stop delay. If the timer disappeared, the
// fallback re-arms it instead of switching day/night immediately.
{
  const app = bareApp();
  const callbacks = [];
  app.homey.setTimeout = callback => { callbacks.push(callback); return callbacks.length; };
  app.requestContextEvaluate = () => {};
  app.publishChargePlanIfChanged = async () => {};
  app.getSettings = () => ({ chargeDeadline: '07:00' });
  app.getLocalDateKey = () => '2026-09-04';
  app.getLocalMinuteOfDay = () => 20 * 60;
  const now = 1_000_000;
  app.inputSeen.pv = true;
  app.inputUpdatedAt.pv = now;
  app.state.pvProducingDate = '2026-09-04';
  app.state.pvSeenProducingToday = true;
  app.state.pvPowerW = 4;
  app.pvStopTimer = null;

  assert.equal(app.checkNightPlanningFallback(now), false);
  assert.equal(app.state.nightPlanningActive, false);
  assert.equal(callbacks.length, 1, 'lost PV-stop timer must be re-armed');
  app.inputUpdatedAt.pv = now - (6 * 60 * 1000);
  assert.equal(app.checkNightPlanningFallback(now), false, '20:00 fallback may not bypass an armed PV-stop timer');
  assert.equal(app.state.nightPlanningActive, false);
  callbacks[0]();
  assert.equal(app.state.nightPlanningActive, true);
  assert.equal(app.state.nightPlanningDecisionSource, 'pv_below_5w_10m');
}

// v0.2.26: without PV input, the fallback plan is made at 20:00.
{
  const app = bareApp();
  app.inputSeen.pv = false;
  app.requestEvaluate = () => {};
  app.publishChargePlanIfChanged = async () => {};
  app.getLocalMinuteOfDay = () => 20 * 60;
  app.getLocalDateKey = () => '2026-08-23';
  const activated = app.checkNightPlanningFallback(1000);
  assert.equal(activated, true);
  assert.equal(app.state.nightPlanningActive, true);
  assert.equal(app.state.nightPlanningDecisionSource, '20h_no_pv_data');
}

// v0.3.80: a previous night's plan survives the morning clock boundary until
// actual PV production starts. A clock deadline may never silently activate a
// second daytime planner underneath the still-active night plan.
{
  const app = bareApp();
  app.state.nightPlanningActive = true;
  app.state.nightPlanningStartedDate = '2026-08-22';
  app.state.nightPlanningDecisionSource = 'pv_below_5w_10m';
  app.getLocalDateKey = () => '2026-08-23';
  app.getLocalMinuteOfDay = () => 8 * 60;
  app.getSettings = () => ({ chargeDeadline: '07:00' });
  assert.equal(app.resetExpiredNightPlanning(1000), false);
  assert.equal(app.state.nightPlanningActive, true);
  assert.equal(app.isNightPlanningPhase(1000), true);
  assert.equal(app.getPlanningForecastDay(1000), 'today');
}

// v0.3.80: on a fully dark day the night phase stays exclusive, but the 20:00
// fallback rolls it forward to tomorrow once without activating day planning.
{
  const app = bareApp();
  app.state.nightPlanningActive = true;
  app.state.nightPlanningStartedDate = '2026-08-22';
  app.state.nightPlanningDecisionSource = 'pv_below_5w_10m';
  app.inputSeen.pv = false;
  app.getLocalDateKey = () => '2026-08-23';
  app.getLocalMinuteOfDay = () => 20 * 60;
  app.requestContextEvaluate = () => {};
  app.publishChargePlanIfChanged = async () => {};
  assert.equal(app.checkNightPlanningFallback(1000), true);
  assert.equal(app.state.nightPlanningActive, true);
  assert.equal(app.state.nightPlanningStartedDate, '2026-08-23');
  assert.equal(app.state.nightPlanningDecisionSource, '20h_no_pv_data');
  assert.equal(app.getPlanningForecastDay(1000), 'tomorrow');
  assert.equal(app.checkNightPlanningFallback(1000), false, 'rollover may happen only once per local day');
}

// v0.3.80: the first observed PV production is the single authoritative switch
// from night to day planning, including when the night marker was created on the
// previous local date.
{
  const app = bareApp();
  app.state.nightPlanningActive = true;
  app.state.nightPlanningStartedDate = '2026-08-22';
  app.state.nightPlanningDecisionSource = 'pv_below_5w_10m';
  app.state.pvProducingDate = '2026-08-22';
  app.state.pvSeenProducingToday = true;
  app.getLocalDateKey = () => '2026-08-23';
  let invalidatedForce = null;
  let evaluateRequest = null;
  app.invalidatePlanningCache = force => { invalidatedForce = force; };
  app.requestContextEvaluate = (immediate, reason) => { evaluateRequest = { immediate, reason }; };

  assert.equal(app.isNightPlanningPhase(1000), true);
  app.updatePvPlanningState(125, 1000);
  assert.equal(app.state.nightPlanningActive, false);
  assert.equal(app.state.nightPlanningStartedDate, '');
  assert.equal(app.state.nightPlanningDecisionSource, '');
  assert.equal(app.state.pvProducingDate, '2026-08-23');
  assert.equal(app.state.pvSeenProducingToday, true);
  assert.equal(app.isNightPlanningPhase(1000), false);
  assert.equal(invalidatedForce, true);
  assert.deepEqual(evaluateRequest, { immediate: true, reason: 'pv_started_day_planning' });
}

// The charge-plan text is concise enough to write directly to a Logic text variable.
{
  const app = bareApp();
  app.formatPlanningTime = at => at === 1 ? '01:00' : '07:00';
  const noCharge = app.buildChargePlanText({ currentSoc: 86.5, targetSoc: 19, energyNeedKwh: 0, rows: [] });
  assert.equal(noCharge, 'SoC-doel 19% · genoeg batterijreserve, er wordt niet geladen.');
  const charging = app.buildChargePlanText({
    currentSoc: 10,
    targetSoc: 45,
    energyNeedKwh: 5.4,
    rows: [{ startAt: 1, endAt: 2, plannedNetCharge: true, plannedChargeW: 900, plannedEnergyKwh: 5.4 }],
  });
  assert.ok(charging.includes('SoC-doel 45%'));
  assert.ok(charging.includes('01:00–07:00'));
  assert.ok(charging.includes('900 W'));
  const missingPrice = app.buildChargePlanText({ currentSoc: 10, targetSoc: 45, energyNeedKwh: 5.4, dynamicPriceReady: false, rows: [] });
  assert.ok(missingPrice.includes('prijsdata ontbreekt'));
}


// v0.3.25: EMS device card summaries stay compact and human-readable.
{
  const app = bareApp();
  app.state.lastTotalCommandW = -10000;
  assert.equal(app.getBatteryCommandDeviceStatus(), 'Laden 10000 W');
  app.state.lastTotalCommandW = 2500;
  assert.equal(app.getBatteryCommandDeviceStatus(), 'Ontladen 2500 W');
  app.state.lastTotalCommandW = 0;
  assert.equal(app.getBatteryCommandDeviceStatus(), 'Rust · 0 W');

  app.formatPlanningTime = at => at === 1 ? '01:00' : '07:00';
  app.getPlanningStatus = () => ({
    currentSoc: 20,
    targetSoc: 70,
    energyNeedKwh: 8,
    rows: [{ startAt: 1, endAt: 2, plannedNetCharge: true, plannedChargeW: 10000 }],
  });
  assert.equal(app.getCompactChargePlanDeviceStatus(), '01:00–07:00 · 10000 W · doel 70%');

  app.inputSeen.ev = { connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 11;
  app.latestEvDecision = { allowed: true, desiredCurrentA: 11 };
  assert.equal(app.getEvDeviceStatus({ evCount: 1, evEnabled: true, evMode: 'smart' }), 'Slim · 11 A');

  app.state.hvacMode = 'cool';
  app.state.hvacSetpointC = 22;
  app.latestHvacDecision = { boostActive: false };
  app.hvacBaselineSetpoint = null;
  app.lastPublishedHvacMode = '';
  app.lastPublishedHvacSetpoint = null;
  assert.equal(app.getHvacDeviceStatus({ hvacCount: 1, hvacEnabled: true }), 'Koelen · 22 °C');
}

// emitPending reserves the interval synchronously, before the first async Homey write.
(async () => {
  const app = bareApp();
  let releaseFirstWrite;
  const firstWrite = new Promise(resolve => { releaseFirstWrite = resolve; });
  app.tokens.set('battery1command', { setValue: () => firstWrite });
  app.pendingResult = {
    canPublishCommands: true,
    candidateCommands: [100, 0, 0, 0],
    candidateTotalCommandW: 100,
    modeLabel: 'Test',
    overrideLabel: '',
    statusText: 'Test',
    nextEventText: '',
    baseMode: 'self_consumption',
    override: '',
  };

  const startedAt = Date.now();
  const publish = app.emitPending();
  assert.equal(app.commandPublishing, true);
  assert.ok(app.lastEmitAt >= startedAt);
  assert.ok(app.nextCommandAllowedAt >= app.lastEmitAt + 10_000);
  releaseFirstWrite();
  await publish;
  assert.equal(app.commandPublishing, false);

  // Published battery sign can be inverted without changing the controller's
  // internal convention (positive discharge, negative charge).
  assert.equal(app.toPublishedCommand(-100, { invertBatteryCommand: false }), -100);
  assert.equal(app.toPublishedCommand(-100, { invertBatteryCommand: true }), 100);
  assert.equal(app.toPublishedCommand(250, { invertBatteryCommand: true }), -250);

  // A charge-test approval is valid only for the exact battery count/sign
  // configuration that was tested.
  {
    const stored = {};
    const gated = bareApp();
    gated.homey.settings = {
      get: key => Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null,
      set: (key, value) => { stored[key] = value; },
    };
    const settings = { batteryCount: 4, chargeTestPassed: true, invertBatteryCommand: false };
    stored._chargeTestSignature = gated.getChargeTestSignature(settings);
    assert.equal(gated.isChargeTestValid(settings), true);
    assert.equal(gated.isChargeTestValid({ ...settings, invertBatteryCommand: true }), false);
    assert.equal(gated.isChargeTestValid({ ...settings, batteryCount: 3 }), false);
  }

  // Real EMS output remains blocked unless the saved charge-test signature
  // matches the current battery count and sign convention.
  {
    const stored = {};
    const gated = bareApp();
    gated.homey.settings = {
      get: key => Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null,
      set: (key, value) => { stored[key] = value; },
    };
    const settings = { batteryCount: 2, controlEnabled: true, chargeTestPassed: true, invertBatteryCommand: false };
    const calculated = { commands: [100, 100], totalCommandW: 200, statusText: 'Test' };
    const readiness = { ready: true, missing: [], degraded: [], priceDataReady: true, received: {} };
    let safe = gated.createSafetyResult(calculated, settings, readiness);
    assert.equal(safe.controlEnabled, false);
    assert.equal(safe.canPublishCommands, false);

    stored._chargeTestSignature = gated.getChargeTestSignature(settings);
    safe = gated.createSafetyResult(calculated, settings, readiness);
    assert.equal(safe.controlEnabled, true);
    assert.equal(safe.canPublishCommands, true);
  }

  // v0.3.29: an upgrade may invalidate an older charge-test signature while
  // leaving controlEnabled=true in persistent settings. Effective output is already
  // blocked, so Start charge test must self-heal that stale switch and proceed.
  {
    const stored = {
      batteryCount: 1,
      invertBatteryCommand: false,
      chargeTestPassed: true,
      controlEnabled: true,
      _chargeTestSignature: 'old-signature',
    };
    const tested = bareApp();
    tested.homey.settings = {
      get: key => Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null,
      set: (key, value) => { stored[key] = value; },
    };
    tested.getSettings = () => ({ ...stored, commandIntervalSeconds: 10 });
    tested.syncTokens = async () => {};
    tested.publishChargeTestCommands = async commands => ({ commands, total: commands.reduce((a, b) => a + b, 0) });
    tested.homey.setTimeout = () => 123;
    const started = await tested.startChargeTest();
    assert.equal(stored.controlEnabled, false);
    assert.equal(tested.chargeTestRunning, true);
    assert.equal(started.batteryCount, 1);
  }

  // Full charge-test lifecycle: run, automatic 0 W, then explicit user
  // confirmation unlocks output for the exact tested configuration.
  {
    const stored = {
      batteryCount: 2,
      invertBatteryCommand: true,
      chargeTestPassed: false,
      controlEnabled: false,
    };
    const tested = bareApp();
    tested.homey.settings = {
      get: key => Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null,
      set: (key, value) => { stored[key] = value; },
    };
    tested.getSettings = () => ({ ...stored, commandIntervalSeconds: 10 });
    tested.syncTokens = async () => {};
    let timerCallback = null;
    tested.homey.setTimeout = callback => { timerCallback = callback; return 123; };
    const writes = [];
    tested.tokens.set('battery1command', { setValue: async value => { writes.push(['b1', value]); } });
    tested.tokens.set('battery2command', { setValue: async value => { writes.push(['b2', value]); } });
    tested.tokens.set('emstotalcommand', { setValue: async value => { writes.push(['total', value]); } });
    tested.commandTrigger = { trigger: async tokens => { writes.push(['flow', tokens.total_command]); } };

    const started = await tested.startChargeTest();
    assert.equal(started.commandPerBatteryW, 100);
    assert.equal(tested.chargeTestRunning, true);
    assert.ok(typeof timerCallback === 'function');
    await timerCallback();
    assert.equal(tested.chargeTestRunning, false);
    assert.equal(tested.chargeTestAwaitingConfirmation, true);
    assert.ok(writes.some(item => item[0] === 'b1' && item[1] === 0));
    assert.ok(writes.some(item => item[0] === 'b2' && item[1] === 0));

    await tested.confirmChargeTest();
    assert.equal(stored.chargeTestPassed, true);
    assert.equal(stored._chargeTestSignature, tested.getChargeTestSignature(tested.getSettings()));
    assert.equal(tested.isChargeTestValid(tested.getSettings()), true);
  }

  // The manual charge test itself publishes 100 W charge in the configured
  // external sign convention to every battery and the total token/Flow.
  {
    const tested = bareApp();
    const writes = [];
    tested.getSettings = () => ({ batteryCount: 2, invertBatteryCommand: true });
    tested.tokens.set('battery1command', { setValue: async value => { writes.push(['b1', value]); } });
    tested.tokens.set('battery2command', { setValue: async value => { writes.push(['b2', value]); } });
    tested.tokens.set('emstotalcommand', { setValue: async value => { writes.push(['total', value]); } });
    tested.commandTrigger = { trigger: async tokens => { writes.push(['flow', tokens.total_command, tokens.battery1command, tokens.battery2command]); } };
    const result = await tested.publishChargeTestCommands([-100, -100], 'Laadtest');
    assert.deepEqual(result.commands, [100, 100]);
    assert.equal(result.total, 200);
    assert.ok(writes.some(item => item[0] === 'b1' && item[1] === 100));
    assert.ok(writes.some(item => item[0] === 'b2' && item[1] === 100));
    assert.ok(writes.some(item => item[0] === 'total' && item[1] === 200));
    assert.ok(writes.some(item => item[0] === 'flow' && item[1] === 200));
  }


  // v0.2.24: PV export limiting first accounts for the battery command and
  // intentionally keeps the configured small export buffer.
  {
    const limited = bareApp();
    limited.inputSeen.pv = true;
    limited.inputSeen.batterySoc[0] = true;
    limited.state.batterySoc[0] = 100;
    limited.state.pvPowerW = 5000;
    limited.state.gridPowerW = -1000;
    limited.state.lastTotalCommandW = 0;
    limited.lastPublishedPvLimitPercent = 100;

    const settings = { exportLimitEnabled: true, minimumExportW: 50, pvCurtailMinBatterySoc: 95, batteryCount: 1 };
    const afterPartialBatteryCharge = limited.calculatePvPowerLimit(settings, -500, 0);
    assert.equal(afterPartialBatteryCharge.limitPercent, 91);
    assert.equal(afterPartialBatteryCharge.targetPowerW, 4550);
    assert.equal(afterPartialBatteryCharge.predictedGridAfterPvW, -50);

    // If the battery itself can absorb the export down to the desired buffer,
    // PV stays completely unrestricted.
    const batteryHandlesIt = limited.calculatePvPowerLimit(settings, -950, 0);
    assert.equal(batteryHandlesIt.limitPercent, 100);

    // A previously applied limit remains stable when the meter is already at
    // the requested export buffer; it must not jump back to 100% every cycle.
    limited.lastPublishedPvLimitPercent = 50;
    limited.state.pvPowerW = 2500;
    limited.state.gridPowerW = -50;
    const stable = limited.calculatePvPowerLimit(settings, 0, 0);
    assert.equal(stable.limitPercent, 50);
    assert.equal(stable.predictedGridAfterPvW, -50);

    // The Flow scale has a hard 10% lower bound.
    limited.lastPublishedPvLimitPercent = 100;
    limited.state.pvPowerW = 5000;
    limited.state.gridPowerW = -10000;
    const floor = limited.calculatePvPowerLimit(settings, 0, 0);
    assert.equal(floor.limitPercent, 10);

    const disabled = limited.calculatePvPowerLimit({ exportLimitEnabled: false, minimumExportW: 50, pvCurtailMinBatterySoc: 95, batteryCount: 1 }, 0, 0);
    assert.equal(disabled.limitPercent, 100);

    // v0.3.7: curtailment is blocked below the configured average battery SoC.
    limited.lastPublishedPvLimitPercent = 50;
    limited.state.pvPowerW = 2500;
    limited.state.gridPowerW = -1000;
    limited.state.batterySoc[0] = 94;
    const belowSoc = limited.calculatePvPowerLimit(settings, 0, 0);
    assert.equal(belowSoc.limitPercent, 100);
    assert.equal(belowSoc.batterySocAllowsCurtailment, false);
    assert.equal(belowSoc.targetGridW, 0);
    limited.state.batterySoc[0] = 95;
    const atSoc = limited.calculatePvPowerLimit(settings, 0, 0);
    assert.equal(atSoc.batterySocAllowsCurtailment, true);
    assert.ok(atSoc.limitPercent < 100);

    // No valid battery SoC is fail-open for PV: never curtail solar blindly.
    limited.inputSeen.batterySoc[0] = false;
    const noSoc = limited.calculatePvPowerLimit(settings, 0, 0);
    assert.equal(noSoc.limitPercent, 100);
    assert.equal(noSoc.batterySocAllowsCurtailment, false);
  }

  // v0.2.25: PV Flow output has its own minimum send interval and does not
  // inherit a fast battery command interval. A change inside that interval is
  // delayed; the timer will recalculate from fresh state instead of queueing a
  // stale percentage.
  {
    const limited = bareApp();
    limited.inputSeen.pv = true;
    limited.inputSeen.batterySoc[0] = true;
    limited.state.batterySoc[0] = 100;
    limited.state.pvPowerW = 5000;
    limited.state.gridPowerW = -1000;
    limited.state.lastTotalCommandW = 0;
    limited.lastPublishedPvLimitPercent = 100;
    limited.lastPvLimitPublishedAt = Date.now();
    limited.pvLimitTimer = null;
    limited.pvLimitPublishing = false;
    limited.latestResult = { controlEnabled: true, inputReady: true };
    limited.getSettings = () => ({ exportLimitEnabled: true, minimumExportW: 50, pvCurtailMinBatterySoc: 95, batteryCount: 1, pvCommandIntervalSeconds: 30 });
    let scheduledMs = 0;
    limited.homey.setTimeout = (_fn, ms) => { scheduledMs = ms; return { fake: true }; };
    let flowCalls = 0;
    limited.pvLimitTrigger = { trigger: async () => { flowCalls += 1; } };
    limited.tokens.set('emspvlimit', { setValue: async () => {} });

    await limited.publishPvPowerLimit(limited.latestResult, 0, 0);
    assert.equal(flowCalls, 0);
    assert.ok(scheduledMs > 29000 && scheduledMs <= 30000);

    limited.lastPvLimitPublishedAt = 0;
    limited.pvLimitTimer = null;
    await limited.publishPvPowerLimit(limited.latestResult, 0, 0);
    assert.equal(flowCalls, 1);
    assert.equal(limited.lastPublishedPvLimitPercent, 81);
  }

  // v0.3.48: HVAC mode is selected from room temperature. The comfort-first
  // strategy starts cooling above the activation band and targets its nearest
  // comfort boundary while preserving the existing PV start/stop margins.
  {
    const hvac = bareApp();
    hvac.inputSeen.hvac = { roomTemperature: true, outdoorTemperature: true, mode: true, setpoint: true, fanSpeed: true };
    hvac.inputSeen.ev = { soc: false, connected: false, chargeCurrent: false };
    hvac.state.hvacRoomTemperatureC = 25;
    hvac.state.hvacOutdoorTemperatureC = 30;
    hvac.state.hvacMode = 'cool';
    hvac.state.hvacSetpointC = 24;
    hvac.state.hvacFanSpeed = 40;
    hvac.state.pvPowerW = 5000;
    hvac.state.gridPowerW = -1000;
    hvac.state.batterySoc = [95, 95, 95, 95, null, null, null, null];
    hvac.lastPublishedPvLimitPercent = 100;
    hvac.lastPublishedHvacSetpoint = null;
    hvac.hvacBaselineSetpoint = null;
    hvac.hvacManagedPowerOn = false;
    hvac.lastHvacControlAt = 0;
    hvac.getSettings = () => ({
      batteryCount: 4,
      hvacEnabled: true,
      hvacAutomaticControlEnabled: true,
      hvacAllowOnBattery: false,
      hvacUsePvSurplus: true,
      hvacComfortMinC: 21,
      hvacComfortMaxC: 23,
      hvacHeatingActivationBelowC: 20,
      hvacCoolingActivationAboveC: 24,
      hvacPriority: 'comfort',
      hvacCoolingFanProfile: 'normal',
      hvacHeatingFanProfile: 'normal',
      hvacControlIntervalMinutes: 5,
      hvacSurplusStartW: 800,
      hvacSurplusStopW: 200,
      hvacMinBatterySoc: 90,
      hvacFastResetImportW: 1000,
      hvacAllowPowerControl: false,
      hvacAllowModeControl: false,
      hvacAllowSetpointControl: true,
      hvacAllowFanControl: false,
      evEnabled: false,
    });
    const boost = hvac.calculateHvacControl({ override: null }, null, 0, 0);
    assert.equal(boost.setpointCommand, 23.5);
    assert.equal(hvac.hvacBaselineSetpoint, 24);

    hvac.lastPublishedHvacSetpoint = 23.5;
    hvac.lastHvacControlAt = 0;
    hvac.state.gridPowerW = -100;
    const back = hvac.calculateHvacControl({ override: null }, null, 0, 0);
    assert.equal(back.setpointCommand, 24);
  }


  // v0.3.58: battery continuation may extend an already-active PV HVAC
  // session, but it may never start HVAC without PV by itself. The configured
  // battery stop SoC must remain enforceable for the entire continued session.
  {
    const hvac = bareApp();
    hvac.inputSeen.hvac = { roomTemperature: true, outdoorTemperature: true, mode: true, setpoint: true, fanSpeed: true };
    hvac.inputSeen.ev = { soc: false, connected: false, chargeCurrent: false };
    hvac.state.hvacRoomTemperatureC = 25;
    hvac.state.hvacOutdoorTemperatureC = 30;
    hvac.state.hvacMode = 'cool';
    hvac.state.hvacSetpointC = 24;
    hvac.state.hvacFanSpeed = 40;
    hvac.state.gridPowerW = 0;
    hvac.state.batterySoc = [95, 95, 95, 95, null, null, null, null];
    hvac.lastPublishedPvLimitPercent = 100;
    hvac.lastPublishedHvacSetpoint = null;
    hvac.hvacBaselineSetpoint = null;
    hvac.hvacBaselineMode = null;
    hvac.hvacBoostMode = null;
    hvac.hvacManagedPowerOn = false;
    hvac.lastHvacControlAt = 0;
    hvac.getSettings = () => ({
      batteryCount: 4,
      hvacEnabled: true,
      hvacAutomaticControlEnabled: true,
      hvacAllowOnBattery: true,
      hvacUsePvSurplus: true,
      hvacComfortMinC: 21,
      hvacComfortMaxC: 23,
      hvacHeatingActivationBelowC: 20,
      hvacCoolingActivationAboveC: 24,
      hvacPriority: 'comfort',
      hvacCoolingFanProfile: 'normal',
      hvacHeatingFanProfile: 'normal',
      hvacControlIntervalMinutes: 5,
      hvacSurplusStartW: 800,
      hvacSurplusStopW: 200,
      hvacMinBatterySoc: 90,
      hvacStopBatterySoc: 50,
      hvacFastResetImportW: 1000,
      hvacAllowPowerControl: false,
      hvacAllowModeControl: false,
      hvacAllowSetpointControl: true,
      hvacAllowFanControl: false,
      evEnabled: false,
    });

    const noPvStart = hvac.calculateHvacControl({ override: null }, null, 0, 0);
    assert.equal(noPvStart.setpointCommand, null);
    assert.equal(hvac.hvacBoostMode, null);

    hvac.state.gridPowerW = -1000;
    const pvStart = hvac.calculateHvacControl({ override: null }, null, 0, 0);
    assert.equal(pvStart.setpointCommand, 23.5);
    assert.equal(hvac.hvacBoostMode, 'cool');

    hvac.lastPublishedHvacSetpoint = 23.5;
    hvac.lastHvacControlAt = 0;
    hvac.state.gridPowerW = 0;
    hvac.state.batterySoc = [80, 80, 80, 80, null, null, null, null];
    const onBattery = hvac.calculateHvacControl({ override: null }, null, 0, 0);
    assert.equal(onBattery.setpointCommand, 23);
    assert.match(onBattery.reason, /thuisbatterij/);
    assert.equal(onBattery.energySource, 'battery');
    assert.equal(hvac.hvacBoostMode, 'cool');

    hvac.lastPublishedHvacSetpoint = 23;
    hvac.state.batterySoc = [49, 49, 49, 49, null, null, null, null];
    const lowSoc = hvac.calculateHvacControl({ override: null }, null, 0, 0);
    assert.equal(lowSoc.setpointCommand, 24);
    assert.match(lowSoc.reason, /HVAC uit onder 50%/);
    assert.equal(hvac.hvacBoostMode, null);
  }

  // v0.3.3: HVAC fan output supports device-specific numeric scales.
  {
    const hvac = bareApp();
    hvac.getSettings = () => ({ hvacFanMinValue: 100, hvacFanMaxValue: 500, hvacFanStepValue: 100 });
    assert.deepEqual(hvac.getHvacFanScale(), { min: 100, max: 500, step: 100 });
    assert.equal(hvac.getHvacFanTarget('higher', 200), 300);
    assert.equal(hvac.getHvacFanTarget('higher', 500), 500);
    assert.equal(hvac.getHvacFanTarget('lower', 300), 200);
    assert.equal(hvac.getHvacFanTarget('lower', 100), 100);
    hvac.getSettings = () => ({ hvacFanMinValue: 100, hvacFanMaxValue: 500, hvacFanStepValue: 100, hvacCoolingFanProfile: 'normal', hvacHeatingFanProfile: 'normal' });
    assert.equal(hvac.getHvacFanTargetFromClimate('cool', 25, 30), 500);
    assert.equal(hvac.getHvacFanTargetFromClimate('heat', 20, 15), 500);
  }

  // v0.3.48: inside the activation margin PV surplus must not start HVAC.
  {
    const hvac = bareApp();
    hvac.inputSeen.hvac = { roomTemperature: true, outdoorTemperature: true, mode: true, setpoint: true, fanSpeed: false };
    hvac.inputSeen.ev = { soc: false, connected: false, chargeCurrent: false };
    hvac.state.hvacRoomTemperatureC = 22;
    hvac.state.hvacOutdoorTemperatureC = 30;
    hvac.state.hvacMode = 'off';
    hvac.state.hvacSetpointC = 22;
    hvac.state.gridPowerW = -3000;
    hvac.state.batterySoc = [100, null, null, null, null, null, null, null];
    hvac.lastPublishedPvLimitPercent = 100;
    hvac.getSettings = () => ({ batteryCount:1, hvacEnabled:true, hvacAutomaticControlEnabled:true, hvacUsePvSurplus:true, hvacComfortMinC:21, hvacComfortMaxC:23, hvacHeatingActivationBelowC:20, hvacCoolingActivationAboveC:24, hvacPriority:'comfort', hvacControlIntervalMinutes:5, hvacSurplusStartW:800, hvacSurplusStopW:200, hvacMinBatterySoc:90, hvacFastResetImportW:1000, hvacAllowPowerControl:true, hvacAllowModeControl:true, hvacAllowSetpointControl:true, hvacAllowFanControl:false, evEnabled:false });
    const decision = hvac.calculateHvacControl({ override:null }, null, 0, 0);
    assert.equal(decision.modeCommand, null);
    assert.equal(decision.powerCommand, null);
    assert.match(decision.reason, /activatiemarge/);
  }

  // v0.3.59: heating/cooling targets are independent. Comfort first follows
  // the selected mode target; PV strategy may extend it only by the configured
  // energy deviation. Equal heating and cooling targets are explicitly valid.
  {
    const hvac = bareApp();
    assert.equal(hvac.getHvacTargetSetpoint('heat', { hvacComfortMinC:21, hvacComfortMaxC:23, hvacEnergyDeviationC:2, hvacPriority:'comfort' }), 21);
    assert.equal(hvac.getHvacTargetSetpoint('heat', { hvacComfortMinC:21, hvacComfortMaxC:23, hvacEnergyDeviationC:2, hvacPriority:'pv' }), 23);
    assert.equal(hvac.getHvacTargetSetpoint('cool', { hvacComfortMinC:21, hvacComfortMaxC:23, hvacEnergyDeviationC:2, hvacPriority:'comfort' }), 23);
    assert.equal(hvac.getHvacTargetSetpoint('cool', { hvacComfortMinC:21, hvacComfortMaxC:23, hvacEnergyDeviationC:2, hvacPriority:'pv' }), 21);
    assert.equal(hvac.getHvacTargetSetpoint('heat', { hvacComfortMinC:21, hvacComfortMaxC:21, hvacEnergyDeviationC:2, hvacPriority:'comfort' }), 21);
    assert.equal(hvac.getHvacTargetSetpoint('cool', { hvacComfortMinC:21, hvacComfortMaxC:21, hvacEnergyDeviationC:2, hvacPriority:'comfort' }), 21);
    assert.equal(hvac.getHvacTargetSetpoint('heat', { hvacComfortMinC:21, hvacComfortMaxC:21, hvacEnergyDeviationC:2, hvacPriority:'pv' }), 23);
    assert.equal(hvac.getHvacTargetSetpoint('cool', { hvacComfortMinC:21, hvacComfortMaxC:21, hvacEnergyDeviationC:2, hvacPriority:'pv' }), 19);
    const band = hvac.getHvacComfortBand({ hvacComfortMinC:23, hvacComfortMaxC:21, hvacEnergyDeviationC:1, hvacHeatingActivationBelowC:20, hvacCoolingActivationAboveC:24 });
    assert.equal(band.heatingTarget, 23);
    assert.equal(band.coolingTarget, 21);
    assert.equal(band.heatBelow, 20);
    assert.equal(band.coolAbove, 24);
  }

  console.log('HomeFlux EMS app control tests: OK');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});


// v0.3.6: daily battery-command pause correctly spans midnight and has zero length when start=end.
{
  const app = bareApp();
  app.getLocalMinuteOfDay = () => (23 * 60) + 59;
  const during = app.getBatteryCommandPauseInfo(Date.UTC(2026, 7, 23, 21, 59, 30), {
    batteryCommandPauseEnabled: true,
    batteryCommandPauseStart: '23:59',
    batteryCommandPauseEnd: '00:00',
  });
  assert.equal(during.active, true);
  assert.ok(during.remainingMs >= 29_000 && during.remainingMs <= 31_000);

  app.getLocalMinuteOfDay = () => 0;
  const after = app.getBatteryCommandPauseInfo(Date.UTC(2026, 7, 23, 22, 0, 0), {
    batteryCommandPauseEnabled: true,
    batteryCommandPauseStart: '23:59',
    batteryCommandPauseEnd: '00:00',
  });
  assert.equal(after.active, false);

  const zeroLength = app.getBatteryCommandPauseInfo(Date.UTC(2026, 7, 23, 22, 0, 0), {
    batteryCommandPauseEnabled: true,
    batteryCommandPauseStart: '00:00',
    batteryCommandPauseEnd: '00:00',
  });
  assert.equal(zeroLength.active, false);
}

// v0.3.6: a pending battery command is discarded during the pause; a fresh evaluation is scheduled after it.
{
  const app = bareApp();
  let scheduled = false;
  let triggerCalls = 0;
  app.pendingResult = { candidateCommands: [5000, 0, 0, 0], candidateTotalCommandW: 5000 };
  app.getBatteryCommandPauseInfo = () => ({ active: true, remainingMs: 1000, start: '23:59', end: '00:00' });
  app.scheduleBatteryCommandPauseResume = () => { scheduled = true; };
  app.commandTrigger = { trigger: async () => { triggerCalls += 1; } };
  app.emitPending();
  assert.equal(app.pendingResult, null);
  assert.equal(scheduled, true);
  assert.equal(triggerCalls, 0);
}

// v0.4.18: the battery regulator always receives the real meter value. EV
// current is never subtracted from its control input.
{
  const app = bareApp();
  const now = 4_000_000;
  app.state.gridPowerW = 11263;
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 16;
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.recordGridSample(11263, now);
  const control = app.getEvaluationState({ batteryCount: 1, gridControlWindowSeconds: 0 }, now, 0);
  assert.equal(control.controlGridPowerW, 11263);
  assert.equal(control.controlGridSource, 'direct');
}

// v0.4.18: EV-first may take PV that the normal battery calculation planned to
// store, but the battery candidate itself is never rewritten by EV logic.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 0;
  app.state.gridPowerW = -3000;
  app.state.lastTotalCommandW = 0;
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', evCount: 1,
    touRates: [{ id: 'normal', name: 'Normal', evChargeAllowed: false, evPvChargeAllowed: true }],
    touSchedule: [{ rateId: 'normal', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    evEnabled: true, evSocEnabled: false, evMode: 'smart', evSmartPvPriority: 'ev_first', evSmartGridPriority: 'battery_first', evWeight: 1,
    evPhases: 1, evMinCurrentA: 6, evMaxCurrentA: 32, evStandardCurrentA: 16,
    peakShaveEnabled: false, exportLimitEnabled: false, minimumExportW: 0,
  };
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    candidateCommands: [-3000], candidateTotalCommandW: -3000,
    calculatedCommands: [-3000], calculatedTotalCommandW: -3000,
    commands: [-3000], totalCommandW: -3000,
    gridChargeAssistW: 0, pvChargeW: 3000,
  };
  const ev = app.coordinateEvBatteryPriority(result, settings);
  assert.equal(ev.desiredCurrentA, 13);
  assert.equal(result.candidateTotalCommandW, -3000);
}

// Battery-first keeps the already calculated PV battery charge. With no real
// residual export left, a stopped EV remains stopped.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 0;
  app.state.gridPowerW = -3000;
  app.state.lastTotalCommandW = 0;
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', evCount: 1,
    touRates: [{ id: 'normal', name: 'Normal', evChargeAllowed: false, evPvChargeAllowed: true }],
    touSchedule: [{ rateId: 'normal', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    evEnabled: true, evSocEnabled: false, evMode: 'smart', evSmartPvPriority: 'battery_first', evSmartGridPriority: 'battery_first', evWeight: 1,
    evPhases: 1, evMinCurrentA: 6, evMaxCurrentA: 32, evStandardCurrentA: 16,
    peakShaveEnabled: false, exportLimitEnabled: false, minimumExportW: 0,
  };
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    candidateCommands: [-3000], candidateTotalCommandW: -3000,
    calculatedCommands: [-3000], calculatedTotalCommandW: -3000,
    commands: [-3000], totalCommandW: -3000,
    gridChargeAssistW: 0, pvChargeW: 3000,
  };
  const ev = app.coordinateEvBatteryPriority(result, settings);
  assert.equal(ev.desiredCurrentA, 0);
  assert.equal(result.candidateTotalCommandW, -3000);
}

// Standard charging on a selected tariff first targets zero grid and may then
// use only the configured TOTAL EV grid-import allowance.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 0;
  app.state.gridPowerW = 0;
  app.state.lastTotalCommandW = 0;
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', evCount: 1,
    touRates: [{ id: 'cheap', name: 'Dal', evChargeAllowed: true, evPvChargeAllowed: true, evMaxGridImportW: 2000 }],
    touSchedule: [{ rateId: 'cheap', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    evEnabled: true, evSocEnabled: false, evMode: 'smart', evSmartPvPriority: 'battery_first', evSmartGridPriority: 'battery_first', evWeight: 1,
    evPhases: 1, evMinCurrentA: 6, evMaxCurrentA: 32, evStandardCurrentA: 16,
    peakShaveEnabled: false, exportLimitEnabled: false, minimumExportW: 0,
  };
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Dal' },
    candidateCommands: [0], candidateTotalCommandW: 0,
    calculatedCommands: [0], calculatedTotalCommandW: 0,
    commands: [0], totalCommandW: 0,
    gridChargeAssistW: 0, pvChargeW: 0,
  };
  const ev = app.coordinateEvBatteryPriority(result, settings);
  assert.equal(ev.desiredCurrentA, 8); // 1840 W is the highest whole ampere step <= 2000 W.
  assert.equal(ev.gridImportLimitW, 2000);
  assert.equal(result.candidateTotalCommandW, 0);
}

// The tariff value is an absolute P1 import ceiling, not extra EV power on
// top of unrelated household import. With 1000 W already imported and a
// 2000 W ceiling, less than the 6 A single-phase minimum remains, so the EV
// stays stopped rather than pushing the meter beyond the configured ceiling.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 0;
  app.state.gridPowerW = 1000;
  app.state.lastTotalCommandW = 0;
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', evCount: 1,
    touRates: [{ id: 'cheap', name: 'Dal', evChargeAllowed: true, evPvChargeAllowed: true, evMaxGridImportW: 2000 }],
    touSchedule: [{ rateId: 'cheap', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    evEnabled: true, evSocEnabled: false, evMode: 'smart', evSmartPvPriority: 'battery_first', evSmartGridPriority: 'battery_first', evWeight: 1,
    evPhases: 1, evMinCurrentA: 6, evMaxCurrentA: 32, evStandardCurrentA: 16,
    peakShaveEnabled: false, exportLimitEnabled: false, minimumExportW: 0,
  };
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Dal' },
    candidateCommands: [0], candidateTotalCommandW: 0,
    calculatedCommands: [0], calculatedTotalCommandW: 0,
    commands: [0], totalCommandW: 0,
    gridChargeAssistW: 0, pvChargeW: 0,
  };
  const ev = app.coordinateEvBatteryPriority(result, settings);
  assert.equal(ev.desiredCurrentA, 0);
  assert.equal(ev.gridImportLimitW, 2000);
  assert.equal(result.candidateTotalCommandW, 0);
}

// Peak Guard remains absolute even when the tariff EV grid allowance is higher.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 0;
  app.state.gridPowerW = 2000;
  app.state.lastTotalCommandW = 0;
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', evCount: 1,
    touRates: [{ id: 'cheap', name: 'Dal', evChargeAllowed: true, evPvChargeAllowed: true, evMaxGridImportW: 5000 }],
    touSchedule: [{ rateId: 'cheap', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    evEnabled: true, evSocEnabled: false, evMode: 'smart', evSmartPvPriority: 'battery_first', evSmartGridPriority: 'battery_first', evWeight: 1,
    evPhases: 1, evMinCurrentA: 6, evMaxCurrentA: 32, evStandardCurrentA: 16,
    peakShaveEnabled: true, peakLimitW: 2500, peakSoftMarginW: 100,
    exportLimitEnabled: false, minimumExportW: 0,
  };
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Dal' },
    candidateCommands: [0], candidateTotalCommandW: 0,
    calculatedCommands: [0], calculatedTotalCommandW: 0,
    commands: [0], totalCommandW: 0,
    gridChargeAssistW: 0, pvChargeW: 0,
  };
  const ev = app.coordinateEvBatteryPriority(result, settings);
  assert.equal(ev.desiredCurrentA, 0);
  assert.equal(result.candidateTotalCommandW, 0);
}

// Multiple connected EVs share one common power budget according to their
// configured weights. The battery command is not part of that distribution.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 0;
  app.extraEvInstances = [{
    state: { soc: null, connected: true, chargeCurrentA: 0 },
    seen: { soc: false, connected: true, chargeCurrent: true },
    updatedAt: { soc: 0, connected: 1, chargeCurrent: 1 },
    lastPublishedCurrentA: 0, lastPublishedAllowed: false, lastPublishedChargeMode: '',
    stopHoldUntil: 0, sessionOverride: { mode: null },
    pvSession: { active: false, rateId: '', overImportSince: 0 },
  }, null, null];
  app.state.gridPowerW = -10000;
  app.state.lastTotalCommandW = 0;
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', evCount: 2,
    touRates: [{ id: 'normal', name: 'Normal', evChargeAllowed: false, evPvChargeAllowed: true, ev2ChargeAllowed: false, ev2PvChargeAllowed: true }],
    touSchedule: [{ rateId: 'normal', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    evEnabled: true, evSocEnabled: false, evMode: 'smart', evSmartPvPriority: 'battery_first', evSmartGridPriority: 'battery_first', evWeight: 3,
    evPhases: 1, evMinCurrentA: 6, evMaxCurrentA: 32, evStandardCurrentA: 16,
    ev2Enabled: true, ev2SocEnabled: false, ev2Mode: 'smart', ev2SmartPvPriority: 'battery_first', ev2SmartGridPriority: 'battery_first', ev2Weight: 1,
    ev2Phases: 1, ev2MinCurrentA: 6, ev2MaxCurrentA: 32, ev2StandardCurrentA: 16,
    peakShaveEnabled: false, exportLimitEnabled: false, minimumExportW: 0,
  };
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    candidateCommands: [0], candidateTotalCommandW: 0,
    calculatedCommands: [0], calculatedTotalCommandW: 0,
    commands: [0], totalCommandW: 0,
    gridChargeAssistW: 0, pvChargeW: 0,
  };
  app.coordinateEvBatteryPriority(result, settings);
  assert.equal(result.evDecisions.length, 2);
  assert.ok(result.evDecisions[0].desiredPowerW > result.evDecisions[1].desiredPowerW);
  assert.ok(result.evDecisions[0].desiredPowerW + result.evDecisions[1].desiredPowerW <= 10000);
  assert.equal(result.candidateTotalCommandW, 0);
}

// v0.3.9: mode-controlled chargers map HomeFlux EV modes to generic charger
// modes, while Peak Guard fails safe to stop when a reduced current is needed.
{
  const app = bareApp();
  const settings = { evEnabled: true, evControlType: 'mode', evMode: 'smart' };
  assert.equal(app.getEvChargeMode({ connected: true, allowed: true, mode: 'smart', source: 'pv', peakLimited: false }, settings), 'smart');
  assert.equal(app.getEvChargeMode({ connected: true, allowed: true, mode: 'smart', source: 'tariff', peakLimited: false }, settings), 'standard');
  assert.equal(app.getEvChargeMode({ connected: true, allowed: true, mode: 'smart', source: 'pv+tariff', peakLimited: false }, settings), 'standard');
  assert.equal(app.getEvChargeMode({ connected: true, allowed: true, mode: 'smart', source: 'guarantee', peakLimited: false }, settings), 'standard');
  assert.equal(app.getEvChargeMode({ connected: true, allowed: true, mode: 'emergency', peakLimited: false }, settings), 'standard');
  assert.equal(app.getEvChargeMode({ connected: true, allowed: true, mode: 'soc_target', peakLimited: false }, settings), 'standard');
  assert.equal(app.getEvChargeMode({ connected: true, allowed: true, mode: 'emergency', peakLimited: true }, settings), 'stop');
  assert.equal(app.getEvChargeMode({ connected: true, allowed: false, mode: 'smart', peakLimited: false }, settings), 'stop');
  assert.equal(app.getEvChargeMode({ connected: false, allowed: true, mode: 'smart', peakLimited: false }, settings), 'stop');
}

// v0.3.20: split-command power formatting supports LUNA-style positive charge
// values, a configurable minimum, and an explicit mode for a 0 W EMS command.
{
  const app = bareApp();
  assert.equal(app.getSplitPowerDelayMs(), 1000);
  const config = {
    zeroMode: 'charge',
    minimumPowerW: 100,
    keepMinimumPower: true,
    chargePowerPositive: true,
  };
  assert.equal(app.getSplitDesiredMode(-750, config), 'charge');
  assert.equal(app.getSplitDesiredMode(750, config), 'discharge');
  assert.equal(app.getSplitDesiredMode(0, config), 'charge');
  assert.equal(app.getSplitPowerValue('charge', -750, config), 750);
  assert.equal(app.getSplitPowerValue('charge', -40, config), 100);
  assert.equal(app.getSplitPowerValue('discharge', 40, config), 100);
  assert.equal(app.getSplitPowerValue('charge', 0, config), 100);
  assert.equal(app.getSplitPowerValue('discharge', 0, config), 100);
  assert.equal(app.getSplitPowerValue('charge', -750, { ...config, chargePowerPositive: false }), -750);
}

// v0.3.20: an allowed split mode switch always fires mode first and power after
// the fixed 1 s handover delay. Tests override only the delay duration, not the
// production ordering.
(async () => {
  const app = bareApp();
  const events = [];
  app.getSplitPowerDelayMs = () => 0;
  app.splitCommandTriggers = Array.from({ length: 8 }, () => ({ chargeMode: null, dischargeMode: null, chargePower: null, dischargePower: null }));
  app.splitCommandState = Array.from({ length: 8 }, () => ({ currentMode: null, chargeHoldUntil: 0, dischargeHoldUntil: 0, lastModeSwitchAt: 0, recheckTimer: null, lastPower: null }));
  app.splitCommandTriggers[0] = {
    chargeMode: { trigger: async () => { events.push('charge-mode'); } },
    dischargeMode: { trigger: async () => { events.push('discharge-mode'); } },
    chargePower: { trigger: async tokens => { events.push(`charge-power:${tokens.power}`); } },
    dischargePower: { trigger: async tokens => { events.push(`discharge-power:${tokens.power}`); } },
  };
  app.tokens.set('splitbattery1chargepower', { setValue: async value => { events.push(`charge-tag:${value}`); } });
  app.tokens.set('splitbattery1dischargepower', { setValue: async value => { events.push(`discharge-tag:${value}`); } });
  const settings = {
    batteryCount: 1,
    splitCommandBattery1Enabled: true,
    splitCommandBattery1ChargePowerPositive: true,
    splitCommandBattery1KeepMinimumPower: true,
    splitCommandBattery1MinimumPowerW: 100,
    splitCommandBattery1ZeroMode: 'discharge',
    splitCommandBattery1ChargeMinSwitchSeconds: 60,
    splitCommandBattery1DischargeMinSwitchSeconds: 60,
    splitCommandBattery1MinBetweenSwitchSeconds: 60,
    splitCommandBattery1DirectionConfirmSeconds: 0,
  };
  const effective = await app.publishSplitBatteryCommands([-500], settings);
  assert.deepEqual(events, ['charge-mode', 'charge-tag:500', 'discharge-tag:0', 'charge-power:500']);
  assert.deepEqual(effective, [-500]);
  assert.equal(app.splitCommandState[0].currentMode, 'charge');

  // A request for the opposite mode inside the 60 s hold does not switch. The
  // active mode receives only its configured minimum and a fresh evaluation is
  // scheduled for the first allowed switch moment.
  events.length = 0;
  let recheckScheduled = false;
  app.scheduleSplitCommandRecheck = () => { recheckScheduled = true; };
  const blocked = await app.publishSplitBatteryCommands([900], settings);
  assert.deepEqual(events, ['charge-tag:100', 'discharge-tag:0', 'charge-power:100']);
  assert.deepEqual(blocked, [-100]);
  assert.equal(app.splitCommandState[0].currentMode, 'charge');
  assert.equal(recheckScheduled, true);

  // The separate minimum-between-switches timer is an additional lock. Even
  // when the active mode minimum has already elapsed, a second mode switch is
  // held until this battery-wide interval has elapsed.
  const state = app.splitCommandState[0];
  state.chargeHoldUntil = Date.now() - 1;
  state.lastModeSwitchAt = Date.now();
  events.length = 0;
  recheckScheduled = false;
  const betweenLocked = await app.publishSplitBatteryCommands([900], {
    ...settings,
    splitCommandBattery1ChargeMinSwitchSeconds: 0,
    splitCommandBattery1MinBetweenSwitchSeconds: 60,
    splitCommandBattery1DirectionConfirmSeconds: 0,
  });
  assert.deepEqual(events, ['charge-tag:100', 'discharge-tag:0', 'charge-power:100']);
  assert.deepEqual(betweenLocked, [-100]);
  assert.equal(app.splitCommandState[0].currentMode, 'charge');
  assert.equal(recheckScheduled, true);

  // Once both switch locks have elapsed, the discharge Logic tag is populated
  // before its Flow trigger and the inactive charge tag is cleared to 0 W.
  state.chargeHoldUntil = Date.now() - 1;
  state.lastModeSwitchAt = Date.now() - 61000;
  events.length = 0;
  const switched = await app.publishSplitBatteryCommands([900], {
    ...settings,
    splitCommandBattery1ChargeMinSwitchSeconds: 0,
    splitCommandBattery1MinBetweenSwitchSeconds: 60,
    splitCommandBattery1DirectionConfirmSeconds: 0,
  });
  assert.deepEqual(events, ['discharge-mode', 'charge-tag:0', 'discharge-tag:900', 'discharge-power:900']);
  assert.deepEqual(switched, [900]);
  assert.equal(app.splitCommandState[0].currentMode, 'discharge');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

// v0.4.10: Split Command feedback must report the physical minimum power, not
// the smaller pre-Split request. Hardware charge sign does not change HomeFlux'
// internal negative=charge convention.
(async () => {
  const app = bareApp();
  app.getSplitPowerDelayMs = () => 0;
  app.splitCommandTriggers = Array.from({ length: 8 }, () => ({ chargeMode: null, dischargeMode: null, chargePower: null, dischargePower: null }));
  app.splitCommandState = Array.from({ length: 8 }, () => ({ currentMode: 'charge', chargeHoldUntil: 0, dischargeHoldUntil: 0, lastModeSwitchAt: 0, pendingMode: null, pendingModeSince: 0, recheckTimer: null, recheckAt: 0, safetyTimer: null, lastPower: null }));
  app.tokens.set('splitbattery1chargepower', { setValue: async () => {} });
  app.tokens.set('splitbattery1dischargepower', { setValue: async () => {} });
  const base = { batteryCount:1, splitCommandBattery1Enabled:true, splitCommandBattery1KeepMinimumPower:true, splitCommandBattery1MinimumPowerW:500, splitCommandBattery1ZeroMode:'charge', splitCommandBattery1ChargeMinSwitchSeconds:0, splitCommandBattery1DischargeMinSwitchSeconds:0, splitCommandBattery1MinBetweenSwitchSeconds:0, splitCommandBattery1DirectionConfirmSeconds:0 };
  assert.deepEqual(await app.publishSplitBatteryCommands([-40], { ...base, splitCommandBattery1ChargePowerPositive:true }), [-500]);
  assert.deepEqual(await app.publishSplitBatteryCommands([-40], { ...base, splitCommandBattery1ChargePowerPositive:false }), [-500]);
})().catch(err => { console.error(err); process.exitCode = 1; });

// v0.4.10: live charging source is derived from the measured grid balance. A
// Split Command remainder while importing cannot be presented as PV charging.
{
  const app = bareApp();
  app.state.gridPowerW = 8637;
  app.inputSeen.grid = true;
  const result = { candidateTotalCommandW:-500, baseMode:'self_consumption', modeLabel:'Zelfconsumptie', workingModeLabel:'Laden uit zon 500 W', statusText:'Piek · Laden uit zon 500 W' };
  app.refreshBatteryPresentationAfterCoordination(result, { commandDeadbandW:25 }, -500);
  assert.equal(result.gridChargeAssistW, 500);
  assert.equal(result.pvChargeW, 0);
  assert.equal(result.action, 'grid_charge');
  assert.equal(result.workingModeLabel, 'Netladen 500 W');
  assert.equal(result.statusText, 'Piek · Netladen 500 W');
}
{
  const app = bareApp();
  app.state.gridPowerW = 200;
  app.inputSeen.grid = true;
  const result = { candidateTotalCommandW:-500, baseMode:'self_consumption', modeLabel:'Zelfconsumptie', workingModeLabel:'Laden uit zon 500 W', statusText:'Dal · Laden uit zon 500 W' };
  app.refreshBatteryPresentationAfterCoordination(result, { commandDeadbandW:25 }, -500);
  assert.equal(result.gridChargeAssistW, 200);
  assert.equal(result.pvChargeW, 300);
  assert.equal(result.action, 'grid_and_pv_charge');
}

// v0.3.40: a split battery must request the opposite direction continuously for
// the configured confirmation period. A short cloud-induced reversal is ignored.
(async () => {
  const app = bareApp();
  app.getSplitPowerDelayMs = () => 0;
  app.splitCommandTriggers = Array.from({ length: 8 }, () => ({ chargeMode: null, dischargeMode: null, chargePower: null, dischargePower: null }));
  app.splitCommandState = Array.from({ length: 8 }, () => ({ currentMode: null, chargeHoldUntil: 0, dischargeHoldUntil: 0, lastModeSwitchAt: 0, pendingMode: null, pendingModeSince: 0, recheckTimer: null, recheckAt: 0, safetyTimer: null, lastPower: null }));
  app.splitCommandState[0].currentMode = 'charge';
  app.splitCommandState[0].chargeHoldUntil = 0;
  app.splitCommandState[0].lastModeSwitchAt = 0;
  const events = [];
  app.splitCommandTriggers[0] = {
    chargeMode: { trigger: async () => { events.push('charge-mode'); } },
    dischargeMode: { trigger: async () => { events.push('discharge-mode'); } },
    chargePower: { trigger: async tokens => { events.push(`charge-power:${tokens.power}`); } },
    dischargePower: { trigger: async tokens => { events.push(`discharge-power:${tokens.power}`); } },
  };
  app.tokens.set('splitbattery1chargepower', { setValue: async () => {} });
  app.tokens.set('splitbattery1dischargepower', { setValue: async () => {} });
  let recheckAt = 0;
  app.scheduleSplitCommandRecheck = (_index, at) => { recheckAt = at; };
  const settings = {
    batteryCount: 1,
    splitCommandBattery1Enabled: true,
    splitCommandBattery1ChargePowerPositive: true,
    splitCommandBattery1KeepMinimumPower: true,
    splitCommandBattery1MinimumPowerW: 100,
    splitCommandBattery1ZeroMode: 'charge',
    splitCommandBattery1ChargeMinSwitchSeconds: 0,
    splitCommandBattery1DischargeMinSwitchSeconds: 0,
    splitCommandBattery1MinBetweenSwitchSeconds: 0,
    splitCommandBattery1DirectionConfirmSeconds: 15,
  };

  const first = await app.publishSplitBatteryCommands([900], settings);
  assert.deepEqual(first, [-100]);
  assert.equal(app.splitCommandState[0].currentMode, 'charge');
  assert.equal(app.splitCommandState[0].pendingMode, 'discharge');
  assert.ok(recheckAt >= app.splitCommandState[0].pendingModeSince + 15_000);

  // Direction returns before 15 s: confirmation is cancelled.
  await app.publishSplitBatteryCommands([-500], settings);
  assert.equal(app.splitCommandState[0].pendingMode, null);

  // A new opposite request starts a fresh window. Simulate a still-young request.
  await app.publishSplitBatteryCommands([900], settings);
  app.splitCommandState[0].pendingModeSince = Date.now() - 10_000;
  await app.publishSplitBatteryCommands([900], settings);
  assert.equal(app.splitCommandState[0].currentMode, 'charge');

  // Once the same opposite direction has persisted longer than 15 s, switch.
  app.splitCommandState[0].pendingModeSince = Date.now() - 16_000;
  events.length = 0;
  const switched = await app.publishSplitBatteryCommands([900], settings);
  assert.deepEqual(switched, [900]);
  assert.equal(app.splitCommandState[0].currentMode, 'discharge');
  assert.equal(app.splitCommandState[0].pendingMode, null);
  assert.ok(events.includes('discharge-mode'));
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

// v0.3.28: the frequently-polled /status endpoint is read-only. It must reuse
// the last real EMS calculation instead of performing a second preview control
// calculation every two seconds.
{
  const app = bareApp();
  const settings = {
    batteryCount: 2,
    commandIntervalSeconds: 10,
    minSoc: 10,
    maxSoc: 100,
    controlEnabled: true,
    chargeTestPassed: true,
    invertBatteryCommand: false,
    evEnabled: false,
    hvacEnabled: false,
    contractType: 'fixed',
  };
  app.getSettings = () => ({ ...settings });
  app.getRuntimeSettings = value => ({ ...value });
  app.getInputReadiness = () => ({ ready: true, missing: [], degraded: [], priceDataReady: true, received: { grid: true, pv: true } });
  app.isChargeTestValid = () => true;
  app.getBatteryCommandPauseInfo = () => ({ active: false });
  app.getHomeyEnergyStatus = () => ({ ready: true });
  app.lastEmittedCommands = [400, -100];
  app.lastPublishedPvLimitPercent = 100;
  app.lastControlEvalAt = 123456;
  app.latestResult = {
    statusText: 'Laatste echte berekening',
    calculatedCommands: [500, -200],
    calculatedTotalCommandW: 300,
    totalCommandW: 300,
    pvLimitPercent: 100,
  };

  app.getEvaluationState = () => { throw new Error('/status must not build a new evaluation state'); };
  app.calculatePvPowerLimit = () => { throw new Error('/status must not recalculate PV limiting'); };
  app.calculateEvControl = () => { throw new Error('/status must not recalculate EV control'); };

  const status = app.getPublicStatus();
  assert.equal(status.statusText, 'Laatste echte berekening');
  assert.deepEqual(status.calculatedCommands, [500, -200]);
  assert.equal(status.calculatedTotalCommandW, 300);
  assert.deepEqual(status.outputCommands, [400, -100]);
  assert.equal(status.outputTotalCommandW, 300);
  assert.equal(status.lastControlEvaluationAt, 123456);
  assert.equal(status.nextCharge.state, 'waiting');
  assert.equal(status.priceData.required, false);
  assert.equal(status.priceData.ready, true);
  assert.equal(status.priceData.fresh, true);
}

// v0.4.13: the status widget reads the cached charge plan without triggering a
// fresh planning calculation. It distinguishes active/planned/no-charge states.
{
  const app = bareApp();
  const now = Date.now();
  app.planningCache = {
    value: {
      plan: {
        currentSoc: 50,
        targetSoc: 80,
        energyNeedKwh: 4,
        rows: [{ plannedNetCharge: true, startAt: now - 60000, endAt: now + 60000, plannedChargeW: 2500 }],
      },
    },
  };
  let nextCharge = app.getWidgetNextChargeStatus(now);
  assert.equal(nextCharge.state, 'active');
  assert.equal(nextCharge.powerW, 2500);
  assert.equal(nextCharge.targetSoc, 80);

  app.planningCache.value.plan.rows = [{ plannedNetCharge: true, startAt: now + 60000, endAt: now + 120000, plannedChargeW: 1800 }];
  nextCharge = app.getWidgetNextChargeStatus(now);
  assert.equal(nextCharge.state, 'planned');

  app.planningCache.value.plan.energyNeedKwh = 0;
  app.planningCache.value.plan.rows = [];
  nextCharge = app.getWidgetNextChargeStatus(now);
  assert.equal(nextCharge.state, 'not_needed');

  app.planningCache.value.plan = {
    currentSoc: 64.8,
    targetSoc: 80,
    planningPhase: 'night',
    forecastUsedSource: 'tomorrow',
    forecastUsedKwh: 7.5,
    energyNeedKwh: 3.2,
    planningPeakStartAt: now + (8 * 60 * 60 * 1000),
    rows: [
      { plannedNetCharge: true, endAt: now + 3600000, plannedEnergyKwh: 1.25 },
      { plannedNetCharge: true, endAt: now + 7200000, plannedEnergyKwh: 0.75 },
      { plannedNetCharge: false, endAt: now + 7200000, plannedEnergyKwh: 5 },
    ],
  };
  const planningSummary = app.getWidgetPlanningSummary(now);
  assert.equal(planningSummary.ready, true);
  assert.equal(planningSummary.phase, 'night');
  assert.equal(planningSummary.forecastSource, 'tomorrow');
  assert.equal(planningSummary.forecastKwh, 7.5);
  assert.equal(planningSummary.energyNeedKwh, 3.2);
  assert.equal(planningSummary.gridPlannedKwh, 2);
  assert.equal(planningSummary.targetAt, now + (8 * 60 * 60 * 1000));
}

// v0.3.30: a split-mode change that is blocked by the anti-chatter timers must
// still schedule a fresh evaluation, even when the wattage delta itself is
// inside the normal command deadband. Once the timer expires, the mode change
// becomes publish-worthy in its own right.
{
  const app = bareApp();
  const now = Date.now();
  const settings = {
    batteryCount: 1,
    commandDeadbandW: 1000,
    gridZeroMinW: -5,
    gridZeroMaxW: 25,
    splitCommandBattery1Enabled: true,
    splitCommandBattery1ChargePowerPositive: true,
    splitCommandBattery1KeepMinimumPower: true,
    splitCommandBattery1MinimumPowerW: 100,
    splitCommandBattery1ZeroMode: 'discharge',
    splitCommandBattery1ChargeMinSwitchSeconds: 60,
    splitCommandBattery1DischargeMinSwitchSeconds: 60,
    splitCommandBattery1MinBetweenSwitchSeconds: 60,
    splitCommandBattery1DirectionConfirmSeconds: 0,
  };
  app.getSettings = () => ({ ...settings });
  app.lastEmittedCommands = [0];
  app.lastEmittedMode = 'self_consumption';
  app.lastEmittedOverride = '';
  app.state.gridPowerW = 0;
  app.splitCommandState = Array.from({ length: 8 }, () => ({ currentMode: null, chargeHoldUntil: 0, dischargeHoldUntil: 0, lastModeSwitchAt: 0, recheckTimer: null, lastPower: null }));
  app.splitCommandTriggers = Array.from({ length: 8 }, () => ({ chargeMode: null, dischargeMode: null, chargePower: null, dischargePower: null }));
  app.splitCommandState[0] = {
    currentMode: 'charge',
    chargeHoldUntil: now + 60000,
    dischargeHoldUntil: 0,
    lastModeSwitchAt: now,
    recheckTimer: null,
    lastPower: 100,
  };

  let recheckAt = 0;
  app.scheduleSplitCommandRecheck = (index, at) => {
    assert.equal(index, 0);
    recheckAt = at;
  };

  const result = {
    candidateCommands: [0],
    candidateTotalCommandW: 0,
    baseMode: 'self_consumption',
    override: '',
  };

  // 0 W maps to discharge for this split battery, but the switch is still
  // locked. Deadband must not make HomeFlux forget this pending transition.
  assert.equal(app.commandChangedEnough(result), false);
  assert.ok(recheckAt > now);

  // Once both locks have elapsed, the exact same 0 W request must force the
  // discharge mode switch even though total wattage still did not change.
  app.splitCommandState[0].chargeHoldUntil = now - 1;
  app.splitCommandState[0].lastModeSwitchAt = now - 61000;
  recheckAt = 0;
  assert.equal(app.commandChangedEnough(result), true);
  assert.equal(recheckAt, 0);
}

// v0.3.30: Live status always exposes semantic charge/discharge/idle direction.
// For split batteries it reports the actually active mode and last split power,
// not merely the signed aggregate command remembered by the normal path.
{
  const app = bareApp();
  const settings = {
    batteryCount: 2,
    commandIntervalSeconds: 10,
    minSoc: 10,
    maxSoc: 100,
    controlEnabled: true,
    chargeTestPassed: true,
    invertBatteryCommand: false,
    evEnabled: false,
    hvacEnabled: false,
    contractType: 'fixed',
    splitCommandBattery1Enabled: false,
    splitCommandBattery2Enabled: true,
    splitCommandBattery2ChargePowerPositive: true,
    splitCommandBattery2KeepMinimumPower: true,
    splitCommandBattery2MinimumPowerW: 100,
    splitCommandBattery2ZeroMode: 'discharge',
    splitCommandBattery2ChargeMinSwitchSeconds: 60,
    splitCommandBattery2DischargeMinSwitchSeconds: 60,
    splitCommandBattery2MinBetweenSwitchSeconds: 60,
  };
  app.getSettings = () => ({ ...settings });
  app.getRuntimeSettings = value => ({ ...value });
  app.getInputReadiness = () => ({ ready: true, missing: [], degraded: [], priceDataReady: true, received: { grid: true, pv: true } });
  app.isChargeTestValid = () => true;
  app.getBatteryCommandPauseInfo = () => ({ active: false });
  app.getHomeyEnergyStatus = () => ({ ready: true });
  app.lastEmittedCommands = [400, 0];
  app.splitCommandState = Array.from({ length: 8 }, () => ({ currentMode: null, chargeHoldUntil: 0, dischargeHoldUntil: 0, lastModeSwitchAt: 0, recheckTimer: null, lastPower: null }));
  app.splitCommandTriggers = Array.from({ length: 8 }, () => ({ chargeMode: null, dischargeMode: null, chargePower: null, dischargePower: null }));
  app.splitCommandState[1] = {
    currentMode: 'charge',
    chargeHoldUntil: Date.now() + 30000,
    dischargeHoldUntil: 0,
    lastModeSwitchAt: Date.now(),
    recheckTimer: null,
    lastPower: 100,
  };
  app.latestResult = {
    statusText: 'Test',
    calculatedCommands: [500, 0],
    calculatedTotalCommandW: 500,
    totalCommandW: 500,
  };

  const status = app.getPublicStatus();
  assert.deepEqual(status.outputCommandModes, ['discharge', 'charge']);
  assert.deepEqual(status.outputCommandPowerW, [400, 100]);
  assert.deepEqual(status.calculatedCommandModes, ['discharge', 'discharge']);
  assert.deepEqual(status.calculatedCommandPowerW, [500, 0]);
  assert.ok(status.splitModeSwitchPendingSeconds[1] > 0);
}

// v0.3.31: optional split safety resend republishes only the current mode. It
// never changes mode, never resets anti-chatter timestamps and never replays power.
(async () => {
  const app = bareApp();
  const timers = [];
  app.homey.setTimeout = (callback, delay) => {
    const handle = { callback, delay };
    timers.push(handle);
    return handle;
  };
  app.error = () => {};
  const settings = {
    batteryCount: 1,
    controlEnabled: true,
    splitCommandBattery1Enabled: true,
    splitCommandBattery1SafetyModeResendEnabled: true,
    splitCommandBattery1SafetyModeResendMinutes: 10,
  };
  app.getSettings = () => ({ ...settings });
  app.isChargeTestValid = () => true;
  app.getBatteryCommandPauseInfo = () => ({ active: false });
  app.splitCommandState = Array.from({ length: 8 }, () => ({ currentMode: null, chargeHoldUntil: 0, dischargeHoldUntil: 0, lastModeSwitchAt: 0, recheckTimer: null, safetyTimer: null, lastPower: null, lastSafetyModeResendAt: 0 }));
  app.splitCommandTriggers = Array.from({ length: 8 }, () => ({ chargeMode: null, dischargeMode: null, chargePower: null, dischargePower: null }));
  let chargeModeCount = 0;
  let dischargeModeCount = 0;
  app.splitCommandTriggers[0].chargeMode = { trigger: async () => { chargeModeCount += 1; } };
  app.splitCommandTriggers[0].dischargeMode = { trigger: async () => { dischargeModeCount += 1; } };
  app.splitCommandState[0].currentMode = 'charge';
  app.splitCommandState[0].lastModeSwitchAt = 12345;
  app.splitCommandState[0].chargeHoldUntil = 98765;

  app.scheduleSplitSafetyModeResend(0);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 10 * 60 * 1000);
  await timers[0].callback();
  assert.equal(chargeModeCount, 1);
  assert.equal(dischargeModeCount, 0);
  assert.equal(app.splitCommandState[0].currentMode, 'charge');
  assert.equal(app.splitCommandState[0].lastModeSwitchAt, 12345);
  assert.equal(app.splitCommandState[0].chargeHoldUntil, 98765);
  assert.equal(app.splitCommandState[0].lastPower, null);
  assert.equal(timers.length, 2); // periodic re-arm
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

// v0.3.33: settings are loaded once into RAM; repeated getSettings() calls must
// not reread the complete Homey settings store.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  let reads = 0;
  app.homey = {
    clock: { getTimezone: () => 'Europe/Brussels' },
    settings: { get: () => { reads += 1; return null; }, set: () => {} },
  };
  app.settingsCache = null;
  app.refreshSettingsCache();
  const afterWarmup = reads;
  app.getSettings();
  app.getSettings();
  assert.equal(reads, afterWarmup);
}

// v0.3.33: concurrent identical planning updates may only fire one Flow event.
// The signature is reserved before the first async token/trigger write.
(async () => {
  const app = bareApp();
  let triggerCount = 0;
  let tokenCount = 0;
  app.lastChargePlanSignature = '';
  app.lastChargePlanText = '';
  app.planningCache = { generation: 0, value: null };
  app.getPlanningStatus = () => ({
    currentSoc: 50,
    targetSoc: 18,
    energyNeedKwh: 0,
    forecastKwh: 22.9,
    rows: [],
  });
  app.tokens = new Map([['emschargeplan', { setValue: async () => { tokenCount += 1; await new Promise(resolve => setTimeout(resolve, 5)); } }]]);
  app.chargePlanTrigger = { trigger: async () => { triggerCount += 1; await new Promise(resolve => setTimeout(resolve, 5)); } };

  await Promise.all([
    app.publishChargePlanIfChanged(false),
    app.publishChargePlanIfChanged(false),
    app.publishChargePlanIfChanged(false),
  ]);
  assert.equal(tokenCount, 1);
  assert.equal(triggerCount, 1);
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

// v0.4.18: EV-first mode control no longer creates a synthetic export target
// by rewriting the battery command. The real meter remains authoritative.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 10;
  app.state.gridPowerW = -2514;
  app.state.lastTotalCommandW = -7300;
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', evCount: 1,
    touRates: [{ id: 'normal', name: 'Normal', evChargeAllowed: false, evPvChargeAllowed: true }],
    touSchedule: [{ rateId: 'normal', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    evEnabled: true, evSocEnabled: false, evMode: 'smart', evControlType: 'mode',
    evSmartPvPriority: 'ev_first', evSmartPvExportTargetW: 500, evSmartGridPriority: 'battery_first', evWeight: 1,
    evPhases: 3, evMinCurrentA: 6, evMaxCurrentA: 32, evStandardCurrentA: 16,
    peakShaveEnabled: false, exportLimitEnabled: false, minimumExportW: 0,
  };
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    candidateCommands: [-9900], candidateTotalCommandW: -9900,
    calculatedCommands: [-9900], calculatedTotalCommandW: -9900,
    commands: [-9900], totalCommandW: -9900,
    gridChargeAssistW: 0, pvChargeW: 9900,
  };
  app.coordinateEvBatteryPriority(result, settings);
  assert.equal(result.candidateTotalCommandW, -9900);
}

// v0.3.35: a mode-controlled EV that Peak Guard stops is held in STOP until
// the configured minimum stop time has elapsed.
{
  const app = bareApp();
  const settings = {
    evEnabled: true, evControlType: 'mode', evMode: 'smart',
    evPeakGuardStopHoldSeconds: 60, evCommandIntervalSeconds: 10,
  };
  app.getSettings = () => settings;
  app.evPeakGuardStopHoldUntil = 0;
  app.evPeakGuardStopHoldTimer = null;
  const canCharge = { connected: true, allowed: true, peakLimited: false, mode: 'smart', source: 'tariff' };
  assert.equal(app.getEvChargeMode(canCharge, settings), 'standard');
  app.evPeakGuardStopHoldUntil = Date.now() + 60_000;
  assert.equal(app.getEvChargeMode(canCharge, settings), 'stop');
  assert.equal(app.getEvChargeMode({ ...canCharge, peakLimited: true }, settings), 'stop');
}

// v0.3.40: any actually published HomeFlux STOP for a connected mode-controlled
// EV arms the configurable restart hold. The hold is timestamp-only and creates
// no extra wake-up timer/evaluation.
(async () => {
  const app = bareApp();
  let armed = false;
  let timerCalls = 0;
  const settings = {
    evEnabled: true, evControlType: 'mode', evMode: 'smart',
    evPeakGuardStopHoldSeconds: 60, evCommandIntervalSeconds: 10,
  };
  app.getSettings = () => settings;
  app.homey.setTimeout = () => { timerCalls += 1; return timerCalls; };
  app.evPeakGuardStopHoldUntil = 0;
  app.evPeakGuardStopHoldTimer = null;
  app.lastPublishedEvChargeMode = 'standard';
  app.lastPublishedEvAllowed = true;
  app.lastEvPublishedAt = 0;
  app.evPublishing = false;
  app.forceEvOutput = false;
  app.evModeTrigger = { trigger: async () => true };
  app.evAllowedTrigger = { trigger: async () => true };
  app.tokens = new Map();
  const originalArm = app.armEvPeakGuardStopHold.bind(app);
  app.armEvPeakGuardStopHold = (...args) => { armed = true; return originalArm(...args); };

  // A normal PV/hysteresis STOP gets the same restart protection as Peak Guard.
  await app.publishEvDecision({
    connected: true, allowed: false, peakLimited: false, mode: 'smart', source: 'off',
    desiredCurrentA: 0, desiredPowerW: 0, reason: 'PV stop',
  });
  assert.equal(app.lastPublishedEvChargeMode, 'stop');
  assert.equal(armed, true);
  assert.ok(app.evPeakGuardStopHoldUntil > 0);
  assert.equal(timerCalls, 0);

  // While the hold is active, a fresh charge request remains STOP.
  const canCharge = { connected: true, allowed: true, peakLimited: false, mode: 'smart', source: 'pv' };
  assert.equal(app.getEvChargeMode(canCharge, settings), 'stop');
  app.evPeakGuardStopHoldUntil = Date.now() - 1;
  assert.equal(app.getEvChargeMode(canCharge, settings), 'smart');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

// v0.3.37: a TOU PV-only EV session does not chatter off when the start
// threshold disappears. It stops only after sustained measured grid import.
{
  const app = bareApp();
  app.evPvSession = { active: true, rateId: 'piek', overImportSince: 0 };
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: false };
  app.state.evConnected = true;
  app.state.gridPowerW = 1200;
  const settings = {
    contractType: 'tou', evEnabled: true, evMode: 'smart', evControlType: 'mode',
    evMinCurrentA: 6, evPhases: 3, peakShaveEnabled: false,
  };
  const request = {
    connected: true, allowed: false, source: 'off', tariffRateId: 'piek',
    pvTariffStopGridImportW: 1000, pvTariffStopDelaySeconds: 60,
    pvTariffHysteresisEnabled: true, pvAvailableW: 0,
  };
  const first = app.applyEvPvSessionHysteresis(request, { action: 'idle' }, settings, 1000);
  assert.equal(first.allowed, true);
  assert.equal(first.source, 'pv_hold');
  assert.equal(app.evPvSession.overImportSince, 1000);

  const beforeTimeout = app.applyEvPvSessionHysteresis(request, { action: 'idle' }, settings, 60_999);
  assert.equal(beforeTimeout.allowed, true);
  assert.equal(app.evPvSession.active, true);

  const afterTimeout = app.applyEvPvSessionHysteresis(request, { action: 'idle' }, settings, 61_000);
  assert.equal(afterTimeout.allowed, false);
  assert.equal(app.evPvSession.active, false);
}

// v0.3.37: dropping below the configured import threshold resets the stop
// timer, and Peak Guard still stops immediately without waiting for hysteresis.
{
  const app = bareApp();
  app.evPvSession = { active: true, rateId: 'piek', overImportSince: 1000 };
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: false };
  app.state.evConnected = true;
  const settings = {
    contractType: 'tou', evEnabled: true, evMode: 'smart', evControlType: 'mode',
    evMinCurrentA: 6, evPhases: 3, peakShaveEnabled: true,
  };
  const request = {
    connected: true, allowed: false, source: 'off', tariffRateId: 'piek',
    pvTariffStopGridImportW: 1000, pvTariffStopDelaySeconds: 60,
    pvTariffHysteresisEnabled: true, pvAvailableW: 0,
  };
  app.state.gridPowerW = 500;
  const recovered = app.applyEvPvSessionHysteresis(request, { action: 'idle' }, settings, 30_000);
  assert.equal(recovered.allowed, true);
  assert.equal(app.evPvSession.overImportSince, 0);

  app.state.gridPowerW = 2500;
  const peak = app.applyEvPvSessionHysteresis(request, { action: 'peak_shave' }, settings, 31_000);
  assert.equal(peak.allowed, false);
  assert.equal(peak.peakLimited, true);
  assert.equal(app.evPvSession.active, false);
}

// v0.3.37: only pure PV charging owns the hysteresis latch. Once tariff or
// guarantee charging takes over, the PV-only stop timer is cleared.
{
  const app = bareApp();
  app.evPvSession = { active: false, rateId: '', overImportSince: 0 };
  const settings = { contractType: 'tou', evControlType: 'mode', evEnabled: true, evMode: 'smart' };
  app.syncEvPvSessionFromDecision({
    allowed: true, source: 'pv', tariffRateId: 'piek', pvTariffHysteresisEnabled: true,
  }, 'smart', settings);
  assert.equal(app.evPvSession.active, true);
  assert.equal(app.evPvSession.rateId, 'piek');

  app.syncEvPvSessionFromDecision({
    allowed: true, source: 'pv+tariff', tariffRateId: 'piek', pvTariffHysteresisEnabled: true,
  }, 'standard', settings);
  assert.equal(app.evPvSession.active, false);
}

// v0.3.44: EV Flow override lasts exactly one connection session and never
// rewrites the configured mode. Disconnected requests wait for connect -> disconnect.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = false;
  app.state.evChargeCurrentA = 0;
  app.evSessionOverride = { mode: null, sessionStarted: false, requestedAt: 0, source: '' };
  app.evPvSession = { active: false, rateId: '', overImportSince: 0 };
  app.requestEvaluate = () => {};
  app.forceEvOutput = false;
  app.getSettings = () => ({ evCount: 1, evMode: 'smart' });

  assert.equal(app.getEffectiveEvMode(app.getSettings()), 'smart');
  app.setEvSessionOverride('emergency', 'flow');
  assert.equal(app.getSettings().evMode, 'smart');
  assert.equal(app.getEffectiveEvMode(app.getSettings()), 'emergency');
  assert.equal(app.evSessionOverride.sessionStarted, false);

  // Repeated disconnected status before a real session starts must not consume it.
  assert.equal(app.handleEvSessionConnectionTransition(false, false), false);
  assert.equal(app.evSessionOverride.mode, 'emergency');

  // Next connection starts the one-session lifetime.
  assert.equal(app.handleEvSessionConnectionTransition(false, true), false);
  assert.equal(app.evSessionOverride.sessionStarted, true);

  // The following disconnect completes the session and restores configured Smart.
  assert.equal(app.handleEvSessionConnectionTransition(true, false), true);
  assert.equal(app.evSessionOverride.mode, null);
  assert.equal(app.getEffectiveEvMode(app.getSettings()), 'smart');
}

// v0.3.44: when the EV is already connected, the Flow override belongs to the
// current session and is cleared on its first disconnect.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 6;
  app.evSessionOverride = { mode: null, sessionStarted: false, requestedAt: 0, source: '' };
  app.evPvSession = { active: false, rateId: '', overImportSince: 0 };
  app.requestEvaluate = () => {};
  app.forceEvOutput = false;
  app.getSettings = () => ({ evCount: 1, evMode: 'smart' });

  app.setEvSessionOverride('soc_target', 'flow');
  assert.equal(app.evSessionOverride.sessionStarted, true);
  assert.equal(app.getEffectiveEvMode(app.getSettings()), 'soc_target');
  assert.equal(app.handleEvSessionConnectionTransition(true, false), true);
  assert.equal(app.getEffectiveEvMode(app.getSettings()), 'smart');
}

// v0.3.45: EV session override has a dedicated device status that distinguishes
// an armed next session from an override active on the currently connected EV.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = false;
  app.evSessionOverride = { mode: null, sessionStarted: false, requestedAt: 0, source: '' };
  app.evPvSession = { active: false, rateId: '', overImportSince: 0 };
  app.requestEvaluate = () => {};
  app.forceEvOutput = false;
  app.getSettings = () => ({ evCount: 1, evMode: 'smart' });

  assert.equal(app.getEvOverrideDeviceStatus(app.getSettings()), 'Geen');
  app.setEvSessionOverride('emergency', 'flow');
  assert.equal(app.getEvOverrideDeviceStatus(app.getSettings()), 'Emergency · wacht op EV');
  app.handleEvSessionConnectionTransition(false, true);
  assert.equal(app.getEvOverrideDeviceStatus(app.getSettings()), 'Emergency · actief');
  app.handleEvSessionConnectionTransition(true, false);
  assert.equal(app.getEvOverrideDeviceStatus(app.getSettings()), 'Geen');
}


// v0.3.88 migration converts the old usable reserve into an absolute selected-
// month SoC. 19.01 kWh on 21.6 kWh above a 12% Minimum SoC becomes 100%.
{
  const app = bareApp();
  const stored = {
    settingsSchemaVersion: 44,
    totalCapacityKwh: 21.6,
    minSoc: 12,
    maxSoc: 100,
    peakReserveKwh: 19.01,
    peakReservePercent: 88,
  };
  app.homey.settings = {
    get: key => Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null,
    set: (key, value) => { stored[key] = value; },
  };
  app.settingsCache = null;
  app.migrateSettings();
  assert.equal(stored.peakReserveTargetSoc, 100);
  assert.equal(stored.settingsSchemaVersion, 50);
  assert.equal(stored.lowForecastAutoSunnyEnabled, false);
  assert.equal(stored.lowForecastAutoSunnySoc, 90);
  assert.equal(stored.lowForecastAutoSunnyMinutes, 10);
  assert.equal(stored.evPeakGuardBatteryAssistNormal, false);
  assert.equal(stored.evPeakGuardBatteryAssistEmergency, false);
  assert.equal(stored.ev2PeakGuardBatteryAssistNormal, false);
  assert.equal(stored.ev4PeakGuardBatteryAssistEmergency, false);
  assert.equal(stored.gridControlWindowSeconds, 5);
  assert.equal(stored.adaptiveLiveControlEnabled, true);
  assert.equal(stored.adaptiveSetpointDeltaW, 1000);
  assert.equal(stored.adaptiveSetpointWindowSeconds, 15);
  assert.equal(stored.evWeight, 1);
  assert.equal(stored.evFixedMaxGridImportW, 0);
}

// v0.3.80: planning simulation is a pure calculation. It uses the entered SoC,
// target, PV and time without mutating app state, settings, output or planning
// phase state.
{
  const app = bareApp();
  app.getSettings = () => ({
    batteryCount: 4,
    totalCapacityKwh: 20,
    minSoc: 10,
    safetySoc: 15,
    maxSoc: 100,
    maxTotalChargeW: 8000,
    maxChargePerBatteryW: 2400,
    contractType: 'fixed',
    fixedChargeWindowStart: '01:00',
    fixedChargeWindowEnd: '07:00',
    peakShaveEnabled: true,
    peakLimitW: 2500,
    peakSoftMarginW: 100,
  });
  app.getHomeyEngineSlots = () => [];
  const stateBefore = JSON.stringify(app.state);
  const outputBefore = JSON.stringify(app.lastEmittedCommands);
  const simulation = app.simulatePlanning({
    batterySoc: 40,
    targetSoc: 70,
    pvTodayKwh: 5,
    pvLiveW: 250,
    time: '10:00',
  });
  assert.equal(simulation.version, '0.4.5');
  assert.equal(simulation.phase, 'day');
  assert.equal(simulation.planningForecastDay, 'today');
  assert.equal(simulation.plan.targetSoc, 70);
  assert.equal(simulation.plan.targetOverridden, true);
  assert.equal(simulation.decision.targetOverridden, true);
  assert.equal(JSON.stringify(app.state), stateBefore);
  assert.equal(JSON.stringify(app.lastEmittedCommands), outputBefore);
}

// Dynamic-price simulation reads raw cached Homey Energy slots without
// refreshing or mutating the runtime resampling cache.
{
  const app = bareApp();
  const today = app.getLocalDateKey(new Date());
  app.homeyEnergy = {
    slots: [
      { dateKey: today, minute: 60, price: 0.10, startMs: null },
      { dateKey: today, minute: 120, price: 0.20, startMs: null },
    ],
  };
  app.homeyEnergyResampleCache = { key: 'keep-this-cache', value: [{ sentinel: true }] };
  app.getSettings = () => ({
    batteryCount: 4,
    totalCapacityKwh: 20,
    minSoc: 10,
    safetySoc: 15,
    maxSoc: 100,
    maxTotalChargeW: 8000,
    maxChargePerBatteryW: 2400,
    contractType: 'dynamic_hour',
    cheapHours: 1,
    expensiveHours: 1,
    peakShaveEnabled: true,
    peakLimitW: 2500,
    peakSoftMarginW: 100,
  });
  const cacheBefore = JSON.stringify(app.homeyEnergyResampleCache);
  const simulation = app.simulatePlanning({ batterySoc: 40, targetSoc: 70, pvTodayKwh: 5, pvLiveW: 250, time: '10:00' });
  assert.equal(simulation.phase, 'day');
  assert.equal(JSON.stringify(app.homeyEnergyResampleCache), cacheBefore);
}



// v0.4.0: an unexpectedly strong low-PV day can be released after the
// average configured battery SoC stays continuously above the chosen limit.
// A dip resets the timer and the completed promotion is persisted once/day.
{
  const app = bareApp();
  const stored = {};
  app.homey.settings = {
    get: key => Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null,
    set: (key, value) => { stored[key] = value; },
  };
  app.getForecastDateKey = () => '2026-08-30';
  app.isNightPlanningPhase = () => false;
  app.state.forecastDailyMaxKwh = 4;
  app.state.batterySoc = [91, 91, 91, 91, null, null, null, null];
  app.inputSeen.batterySoc = [true, true, true, true, false, false, false, false];
  app.lowForecastSunnyRuntime = { date: '', aboveSince: 0 };
  app.lowForecastSunnyOverrideDate = '';
  const settings = {
    batteryCount: 4,
    forcedMode: 'auto',
    lowForecastAutoSunnyEnabled: true,
    lowForecastAutoSunnySoc: 90,
    lowForecastAutoSunnyMinutes: 10,
    lowForecastSelfConsumptionMinKwh: 5,
  };

  assert.equal(app.updateLowForecastSunnyPromotion(1_000_000, settings), false);
  assert.equal(app.lowForecastSunnyRuntime.aboveSince, 1_000_000);
  assert.equal(app.updateLowForecastSunnyPromotion(1_540_000, settings), false);

  app.state.batterySoc = [80, 91, 91, 91, null, null, null, null];
  assert.equal(app.updateLowForecastSunnyPromotion(1_550_000, settings), false);
  assert.equal(app.lowForecastSunnyRuntime.aboveSince, 0);

  app.state.batterySoc = [91, 91, 91, 91, null, null, null, null];
  assert.equal(app.updateLowForecastSunnyPromotion(2_000_000, settings), false);
  assert.equal(app.updateLowForecastSunnyPromotion(2_599_999, settings), false);
  assert.equal(app.updateLowForecastSunnyPromotion(2_600_000, settings), true);
  assert.equal(app.lowForecastSunnyOverrideDate, '2026-08-30');
  assert.equal(stored._lowForecastSunnyOverrideDate, '2026-08-30');
  assert.equal(app.isLowForecastSunnyOverrideActive(settings, 2_600_000), true);
  assert.equal(app.updateLowForecastSunnyPromotion(3_300_000, settings), false);
}

// The promotion timer must never run while the night plan is authoritative,
// even if SoC and forecast would otherwise satisfy the promotion conditions.
{
  const app = bareApp();
  app.getForecastDateKey = () => '2026-08-30';
  app.isNightPlanningPhase = () => true;
  app.state.forecastDailyMaxKwh = 4;
  app.state.batterySoc = [95, 95, 95, 95, null, null, null, null];
  app.lowForecastSunnyRuntime = { date: '', aboveSince: 0 };
  app.lowForecastSunnyOverrideDate = '';
  const settings = {
    batteryCount: 4,
    forcedMode: 'auto',
    lowForecastAutoSunnyEnabled: true,
    lowForecastAutoSunnySoc: 90,
    lowForecastAutoSunnyMinutes: 5,
    lowForecastSelfConsumptionMinKwh: 5,
  };
  assert.equal(app.updateLowForecastSunnyPromotion(1_000_000, settings), false);
  assert.equal(app.lowForecastSunnyRuntime.aboveSince, 0);
}

// v0.4.18: EV coordination no longer has a helper that can rewrite the
// battery candidate. The battery EMS remains the sole owner of battery setpoints.
{
  const app = bareApp();
  assert.equal(typeof app.reduceBatteryChargeResult, 'undefined');
}


// v0.4.11: the profit chart's avoided-cost bar is net profit relative to
// the hypothetical total energy cost for the selected period. Example: EUR 0.99 / (EUR 7.77 + EUR 0.99) = 11.30%.
{
  const app = bareApp();
  const day = emptyDay('2026-09-04');
  day.directGridCost = 2.00;
  day.gridChargeCost = 5.77;
  day.directPvValue = 0.40;
  day.pvBatteryValue = 0.30;
  day.pvBatteryHomeValue = 0.30;
  day.shiftValue = 0.29;
  app.savings = {
    history: {},
    today: day,
    total: 0.99,
    inventory: emptyInventory(),
  };
  app.recordSavingsSample = () => {};
  app.getSavingsPeriodRange = () => ({ startKey: '2026-09-04', endKey: '2026-09-05' });
  const status = app.getSavingsStatus({ period: 'day' });
  assert.ok(Math.abs(status.periodSavings - 0.99) < 1e-9);
  assert.ok(Math.abs(status.actualCost - 7.77) < 1e-9);
  const expected = (0.99 / (7.77 + 0.99)) * 100;
  assert.ok(Math.abs(status.avoidedCostsPercentage - expected) < 1e-9);
  assert.ok(Math.abs(status.avoidedEnergyCostPercentage - expected) < 1e-9);
}

// v0.4.18: optional home-battery support adds EV charging budget without ever
// rewriting the battery candidate. With a 0 W tariff import allowance, the EV
// may use only battery support above the normal zero-grid budget.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 0;
  app.state.gridPowerW = 0;
  app.state.lastTotalCommandW = 0;
  app.state.batterySoc = [80];
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', evCount: 1,
    touRates: [{ id: 'cheap', name: 'Dal', evChargeAllowed: true, evPvChargeAllowed: true, evMaxGridImportW: 0 }],
    touSchedule: [{ rateId: 'cheap', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    evEnabled: true, evSocEnabled: false, evMode: 'smart', evSmartPvPriority: 'battery_first', evSmartGridPriority: 'battery_first', evWeight: 1,
    evPeakGuardBatteryAssistNormal: true,
    evPhases: 1, evMinCurrentA: 6, evMaxCurrentA: 32, evStandardCurrentA: 16,
    batteryCount: 1, batterySoc: [80], minSoc: 10, maxSoc: 100,
    maxTotalDischargeW: 2300, maxDischargePerBatteryW: 2300, balanceEnabled: false,
    peakShaveEnabled: false, exportLimitEnabled: false, minimumExportW: 0,
  };
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Dal' },
    candidateCommands: [0], candidateTotalCommandW: 0,
    calculatedCommands: [0], calculatedTotalCommandW: 0,
    commands: [0], totalCommandW: 0,
    gridChargeAssistW: 0, pvChargeW: 0,
  };
  const ev = app.coordinateEvBatteryPriority(result, settings);
  assert.equal(ev.desiredCurrentA, 10); // 2300 W battery-support budget on one phase.
  assert.equal(ev.batterySupportAllocatedW, 2300);
  assert.equal(result.candidateTotalCommandW, 0);
  assert.deepStrictEqual(result.candidateCommands, [0]);
}

// The same tariff cannot consume home-battery energy when the support option is off.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 0;
  app.state.gridPowerW = 0;
  app.state.lastTotalCommandW = 0;
  app.state.batterySoc = [80];
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', evCount: 1,
    touRates: [{ id: 'cheap', name: 'Dal', evChargeAllowed: true, evPvChargeAllowed: true, evMaxGridImportW: 0 }],
    touSchedule: [{ rateId: 'cheap', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    evEnabled: true, evSocEnabled: false, evMode: 'smart', evSmartPvPriority: 'battery_first', evSmartGridPriority: 'battery_first', evWeight: 1,
    evPeakGuardBatteryAssistNormal: false,
    evPhases: 1, evMinCurrentA: 6, evMaxCurrentA: 32, evStandardCurrentA: 16,
    batteryCount: 1, minSoc: 10, maxSoc: 100,
    maxTotalDischargeW: 2300, maxDischargePerBatteryW: 2300, balanceEnabled: false,
    peakShaveEnabled: false, exportLimitEnabled: false, minimumExportW: 0,
  };
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Dal' },
    candidateCommands: [0], candidateTotalCommandW: 0,
    calculatedCommands: [0], calculatedTotalCommandW: 0,
    commands: [0], totalCommandW: 0,
    gridChargeAssistW: 0, pvChargeW: 0,
  };
  const ev = app.coordinateEvBatteryPriority(result, settings);
  assert.equal(ev.desiredCurrentA, 0);
  assert.equal(result.candidateTotalCommandW, 0);
}

// Battery-first remains authoritative while the battery is actively taking PV:
// even with battery support enabled, HomeFlux does not discharge/redirect it to
// the EV. EV-first is the explicit choice that may take that charging power.
{
  const app = bareApp();
  app.inputSeen.ev = { soc: false, connected: true, chargeCurrent: true };
  app.state.evConnected = true;
  app.state.evChargeCurrentA = 0;
  app.state.gridPowerW = -3000;
  app.state.lastTotalCommandW = 0;
  app.state.batterySoc = [80];
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', evCount: 1,
    touRates: [{ id: 'cheap', name: 'Dal', evChargeAllowed: true, evPvChargeAllowed: true, evMaxGridImportW: 0 }],
    touSchedule: [{ rateId: 'cheap', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    evEnabled: true, evSocEnabled: false, evMode: 'smart', evSmartPvPriority: 'battery_first', evSmartGridPriority: 'battery_first', evWeight: 1,
    evPeakGuardBatteryAssistNormal: true,
    evPhases: 1, evMinCurrentA: 6, evMaxCurrentA: 32, evStandardCurrentA: 16,
    batteryCount: 1, minSoc: 10, maxSoc: 100,
    maxTotalDischargeW: 2300, maxDischargePerBatteryW: 2300, balanceEnabled: false,
    peakShaveEnabled: false, exportLimitEnabled: false, minimumExportW: 0,
  };
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Dal' },
    candidateCommands: [-3000], candidateTotalCommandW: -3000,
    calculatedCommands: [-3000], calculatedTotalCommandW: -3000,
    commands: [-3000], totalCommandW: -3000,
    gridChargeAssistW: 0, pvChargeW: 3000,
  };
  const ev = app.coordinateEvBatteryPriority(result, settings);
  assert.equal(ev.desiredCurrentA, 0);
  assert.equal(result.candidateTotalCommandW, -3000);
}
