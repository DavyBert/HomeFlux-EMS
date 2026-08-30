'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DEFAULTS, evaluate, prepareControlContext } = require('../lib/ems-engine');

// A prepared slow context must produce the same battery decision as a complete
// evaluation while the tariff/forecast context has not changed.
{
  const settings = {
    ...DEFAULTS,
    batteryCount: 2,
    totalCapacityKwh: 10,
    contractType: 'fixed',
    fixedChargeWindowStart: '01:00',
    fixedChargeWindowEnd: '07:00',
    maxTotalChargeW: 4000,
    maxTotalDischargeW: 4000,
    maxChargePerBatteryW: 2000,
    maxDischargePerBatteryW: 2000,
    controlEnabled: true,
  };
  const state = {
    gridPowerW: 650,
    controlGridPowerW: 650,
    gridAverage5sW: 620,
    controlGridSource: 'average_5s',
    pvPowerW: 3500,
    forecastRemainingKwh: 9,
    forecastDailyMaxKwh: 18,
    forecastTomorrowKwh: 12,
    batterySoc: [62, 60],
    lastTotalCommandW: 0,
    pvDeltaW: 0,
    planningForecastDay: 'today',
    nightPlanningActive: false,
  };
  const contextAt = new Date('2026-08-27T12:00:00+02:00');
  const evalAt = new Date(contextAt.getTime() + 10_000);
  const prepared = prepareControlContext(state, settings, contextAt);
  const direct = evaluate(state, settings, evalAt);
  const fast = evaluate(state, settings, evalAt, prepared);
  for (const key of ['baseMode', 'action', 'targetSoc', 'totalCommandW', 'candidateTotalCommandW', 'plannedChargeW']) {
    assert.deepStrictEqual(fast[key], direct[key], `prepared context changed ${key}`);
  }
  assert.deepStrictEqual(fast.commands, direct.commands);
}

// Load the app class without the Homey runtime.
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class App {} };
  if (request === 'homey-api') return { HomeyAPI: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const HomeFluxEmsApp = require('../app');
Module._load = originalLoad;

// Many meter updates must collapse into one shared slow-context timer.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.contextTimer = null;
  app.contextTimerAt = 0;
  app.contextDirty = false;
  app.contextDirtyReasons = new Set();
  app.contextEvaluationRunning = false;
  app.contextEvaluationPending = false;
  app.lastContextEvalAt = 1_000;
  app.controlContextDirty = false;
  app.flexibleLoadsDirty = false;
  app.getSettings = () => ({ slowControlIntervalSeconds: 60 });
  let scheduled = 0;
  app.homey = {
    setTimeout(callback, delay) {
      scheduled += 1;
      return { callback, delay };
    },
  };
  app.error = () => {};
  app.runContextEvaluation = async () => null;
  const realNow = Date.now;
  Date.now = () => 2_000;
  try {
    for (let index = 0; index < 100; index += 1) app.requestContextEvaluate(false, 'meter');
    assert.equal(scheduled, 1, 'meter updates created more than one slow timer');
    assert.equal(app.contextTimerAt, 61_000);
    assert.equal(app.contextDirty, true);
  } finally {
    Date.now = realNow;
  }
}

// Charge planning is throttled, not debounced: the old valid plan remains
// available inside the block, while an explicit refresh may bypass it.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.state = {
    gridPowerW: 0,
    pvPowerW: 0,
    forecastRemainingKwh: 4,
    forecastDailyMaxKwh: 10,
    forecastTomorrowKwh: 8,
    batterySoc: [50],
    lastTotalCommandW: 0,
    pvDeltaW: 0,
    nightPlanningActive: false,
    nightPlanningDecisionSource: '',
  };
  app.planningCache = { generation: 0, value: null, dirty: true, lastCalculatedAt: 0, nextAllowedAt: 0, timer: null, timerAt: 0 };
  app.getSettings = () => ({ ...DEFAULTS, batteryCount: 1, totalCapacityKwh: 5, planningMinIntervalMinutes: 5, timezone: 'Europe/Brussels' });
  app.getRuntimeSettings = settings => settings;
  app.getEvaluationState = () => ({ ...app.state });
  app.checkNightPlanningFallback = () => false;
  app.isNightPlanningPhase = () => false;
  app.homey = { clock: { getTimezone: () => 'Europe/Brussels' }, setTimeout: () => 1 };
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const first = app.getPlanningStatus();
    assert.equal(app.planningCache.lastCalculatedAt, now);
    app.planningCache.dirty = true;
    now += 60_000;
    const blocked = app.getPlanningStatus();
    assert.strictEqual(blocked, first, 'valid plan was rebuilt inside the five-minute block');
    assert.equal(app.planningCache.lastCalculatedAt, 1_000_000);
    const forced = app.getPlanningStatus({ force: true });
    assert.notStrictEqual(forced, first, 'manual refresh did not bypass planning block');
    assert.equal(app.planningCache.lastCalculatedAt, now);
  } finally {
    Date.now = realNow;
  }
}

// Guard the architectural boundary directly: the fast method must never grow
// slow subsystem calls again.
{
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const start = appSource.indexOf('  evaluateFastNow(');
  const end = appSource.indexOf('  evaluateContextNow(', start);
  assert(start > 0 && end > start, 'fast/slow loop methods missing');
  const fastSource = appSource.slice(start, end);
  for (const forbidden of ['coordinateEvBatteryPriority(', 'publishFlexibleLoads(', 'calculatePvPowerLimit(', 'getRuntimeSettings(', 'buildSocPlan(', 'syncEmsDevices(']) {
    assert(!fastSource.includes(forbidden), `fast battery loop contains slow call ${forbidden}`);
  }
  assert(fastSource.includes('evaluate(evaluationState, settings, new Date(now), this.controlContext)'));
  assert(appSource.includes("this.requestContextEvaluate(false, 'grid_context')"));
  assert(appSource.includes("this.requestContextEvaluate(false, 'pv_context')"));
  assert(appSource.includes('this.controlRuntimeSettings || this.cachedRuntimeSettings'));
}

console.log('split-loop performance tests passed');
