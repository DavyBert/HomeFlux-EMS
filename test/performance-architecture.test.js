'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class App {} };
  if (request === 'homey-api') return { HomeyAPI: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const HomeFluxEmsApp = require('../app');
Module._load = originalLoad;
const { DEFAULTS, evaluate, prepareControlContext } = require('../lib/ems-engine');

// A meter-driven request must call only the fast battery evaluator.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.getSettings = () => ({ ...DEFAULTS, commandIntervalSeconds: 10 });
  app.getBatteryCommandPauseInfo = () => ({ active: false });
  app.controlContext = {};
  app.controlRuntimeSettings = {};
  app.latestResult = { baseMode: 'self_consumption', override: '' };
  app.lastControlEvalAt = 0;
  app.controlTimer = null;
  app.fastEvaluationSkipped = 0;
  app.homey = { setTimeout };
  let fast = 0;
  let slow = 0;
  app.evaluateFastNow = () => { fast += 1; };
  app.evaluateContextNow = () => { slow += 1; };
  assert.equal(app.requestEvaluate(true), true);
  assert.equal(fast, 1);
  assert.equal(slow, 0);
}

// Identical P1 snapshots are ignored before a timer or EMS calculation is made.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  const snapshot = { rawGridW: 15, controlGridW: 15, pvW: 2000, zone: 'inside', peak: false };
  app.getSettings = () => ({ ...DEFAULTS, commandIntervalSeconds: 10 });
  app.getBatteryCommandPauseInfo = () => ({ active: false });
  app.controlContext = {};
  app.controlRuntimeSettings = {};
  app.latestResult = { baseMode: 'self_consumption', override: '' };
  app.lastFastControlSnapshot = snapshot;
  app.getFastControlSnapshot = () => ({ ...snapshot });
  app.fastEvaluationSkipped = 0;
  app.controlTimer = null;
  let fast = 0;
  app.evaluateFastNow = () => { fast += 1; };
  assert.equal(app.requestEvaluate(false), false);
  assert.equal(fast, 0);
  assert.equal(app.fastEvaluationSkipped, 1);
}

// Many slow-context requests collapse into one shared timer.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.getSettings = () => ({ ...DEFAULTS, slowControlIntervalSeconds: 60 });
  app.contextDirty = false;
  app.contextDirtyReasons = new Set();
  app.contextEvaluationRunning = false;
  app.contextEvaluationPending = false;
  app.contextTimer = null;
  app.contextTimerAt = 0;
  app.lastContextEvalAt = Date.now();
  app.flexibleLoadsDirty = false;
  let timers = 0;
  app.homey = { setTimeout: (_fn, _ms) => { timers += 1; return { id: timers }; } };
  app.runContextEvaluation = async () => {};
  app.requestContextEvaluate(false, 'soc');
  const first = app.contextTimer;
  app.requestContextEvaluate(false, 'forecast');
  assert.equal(timers, 1);
  assert.equal(app.contextTimer, first);
  assert.equal(app.contextDirtyReasons.has('soc'), true);
  assert.equal(app.contextDirtyReasons.has('forecast'), true);
}

// Planning invalidation preserves the last valid plan during the five-minute block.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  const oldPlan = { marker: 'last-valid-plan' };
  const now = Date.now();
  app.planningCache = {
    generation: 1,
    value: { at: now, plan: oldPlan },
    dirty: false,
    lastCalculatedAt: now,
    nextAllowedAt: now + 300000,
    timer: null,
    timerAt: 0,
  };
  app.contextDirty = false;
  app.contextDirtyReasons = new Set();
  app.flexibleLoadsDirty = false;
  app.controlContextDirty = false;
  app.getSettings = () => ({ ...DEFAULTS, planningMinIntervalMinutes: 5 });
  app.isNightPlanningPhase = () => true;
  app.checkNightPlanningFallback = () => false;
  app.homey = { setTimeout: () => ({ id: 1 }) };
  app.invalidatePlanningCache();
  assert.equal(app.planningCache.dirty, true);
  assert.equal(app.planningCache.value.plan, oldPlan);
  assert.equal(app.getPlanningStatus(), oldPlan);
}

// A prepared slow context must produce the same control result for the same inputs.
{
  const now = new Date('2026-08-27T12:00:00.000Z');
  const settings = { ...DEFAULTS, batteryCount: 1, totalCapacityKwh: 5, minSoc: 10, maxSoc: 100 };
  const state = {
    gridPowerW: 1200,
    controlGridPowerW: 1200,
    gridAverage5sW: 1200,
    pvPowerW: 2500,
    forecastRemainingKwh: 8,
    batterySoc: [55],
    lastTotalCommandW: 0,
  };
  const direct = evaluate(state, settings, now);
  const prepared = evaluate(state, settings, now, prepareControlContext(state, settings, now));
  assert.equal(prepared.totalCommandW, direct.totalCommandW);
  assert.equal(prepared.baseMode, direct.baseMode);
  assert.equal(prepared.targetSoc, direct.targetSoc);
}

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const fastStart = appSource.indexOf('  evaluateFastNow(');
const slowStart = appSource.indexOf('  evaluateContextNow(');
const triggerStart = appSource.indexOf('  async triggerCalculatedSetpoint(', slowStart);
assert(fastStart > 0 && slowStart > fastStart && triggerStart > slowStart);
const fastSource = appSource.slice(fastStart, slowStart);
const slowSource = appSource.slice(slowStart, triggerStart);
assert(!fastSource.includes('publishFlexibleLoads('), 'fast loop must not publish flexible loads');
assert(!fastSource.includes('refreshControlContext('), 'fast loop must not rebuild slow context');
assert(slowSource.includes('publishFlexibleLoads('), 'slow loop must own flexible-load output');
assert(appSource.includes("this.contextHeartbeatTimer = this.homey.setInterval(() => this.runContextHeartbeat(), 60000)"));
assert(appSource.includes('this.evaluateFastNow(immediate)'));
assert(appSource.includes('this.evaluateContextNow(forceStatus)'));

console.log('performance architecture tests passed');
