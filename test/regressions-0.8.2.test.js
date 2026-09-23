'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'homey') return { App: class {} };
  if (name === 'homey-api') return { HomeyAPI: {} };
  return load.call(this, name, parent, main);
};
const App = require('../app');
Module._load = load;
const { DEFAULTS, evaluate } = require('../lib/ems-engine');
const realNow = Date.now;
let now = 100000;
Date.now = () => now;
function setup(overrides = {}, gridW = 35, commandW = 1000, soc = 50) {
  const app = Object.create(App.prototype);
  const settings = { ...DEFAULTS, batteryCount: 1, totalCapacityKwh: 5, controlEnabled: true,
    chargeTestPassed: true, commandIntervalSeconds: 7, commandDeadbandW: 20,
    batteryCommandStepW: 1, gridControlWindowSeconds: 0, gridZeroMinW: -5, gridZeroMaxW: 25,
    forcedMode: 'self_consumption', contractType: 'fixed', safetySoc: 10, minSoc: 10, ...overrides };
  app.getSettings = () => settings;
  app.state = { gridPowerW: gridW, pvPowerW: 0, batterySoc: [soc], lastTotalCommandW: commandW, forecastRemainingKwh: 0 };
  app.controlContext = {};
  app.controlRuntimeSettings = settings;
  app.latestResult = { baseMode: 'self_consumption', override: '' };
  app.lastEmittedMode = 'self_consumption';
  app.lastEmittedOverride = '';
  app.lastEmittedCommands = [commandW];
  app.lastEmitAt = 100000;
  app.nextCommandAllowedAt = 107000;
  app.lastControlEvalAt = 100000;
  app.controlTimer = null;
  app.fastEvaluationSkipped = 0;
  app.pvAtLastControlW = 0;
  app.splitModeChangeNeeded = () => false;
  app.isHybridEmsConfigured = () => false;
  app.isHybridExternalControlActive = () => false;
  app.getBatteryCommandPauseInfo = () => ({ active: false });
  app.lastFastControlSnapshot = app.getFastControlSnapshot(settings, now);
  const timers = [], evaluations = [], outputs = [];
  app.homey = { setTimeout: (callback, delay) => {
    const timer = { callback, delay }; timers.push(timer); return timer;
  } };
  // Keep the actual scheduler, input filter, battery engine and publication gate.
  // Replace only the Homey Flow transport and unrelated status/context work.
  app.emitPending = async () => {
    const result = app.pendingResult;
    app.pendingResult = null;
    app.lastEmitAt = now;
    app.nextCommandAllowedAt = now + settings.commandIntervalSeconds * 1000;
    app.lastEmittedCommands = result.candidateCommands;
    app.lastEmittedMode = result.baseMode;
    app.lastEmittedOverride = result.override || '';
    app.state.lastTotalCommandW = result.candidateTotalCommandW;
    outputs.push({ at: now, watts: result.candidateTotalCommandW });
  };
  app.error = error => { throw error; };
  app.evaluateFastNow = () => {
    const result = evaluate(app.state, settings, new Date(now));
    app.lastControlEvalAt = now;
    app.rememberFastControlSnapshot(settings, now);
    app.latestResult = result;
    evaluations.push(result);
    app.queueCommandEmit({ ...result, candidateCommands: result.commands,
      candidateTotalCommandW: result.totalCommandW, canPublishCommands: true });
  };
  return { app, settings, timers, evaluations, outputs };
}
try {
  // Stable residual import AND export below the 50 W delta filter trigger control.
  for (const grid of [35, -15]) {
    now = 107000;
    const { app, outputs, evaluations } = setup({}, grid);
    assert.equal(app.getFastSignalThresholdW(), 50);
    assert.equal(app.shouldRunFastEvaluation(), true);
    app.requestEvaluate();
    assert.equal(evaluations.length, 1);
    assert.equal(outputs.length, 1);
    assert(Math.abs(outputs[0].watts - 1000) > 0);
    if (grid > 0) assert(outputs[0].watts > 1000);
    else assert(outputs[0].watts < 1000);
  }
  // A correction smaller than the configured 20 W deadband still passes outside.
  {
    now = 107000;
    const { app, outputs } = setup({}, 26);
    app.requestEvaluate();
    assert.equal(outputs.length, 1);
    assert(Math.abs(outputs[0].watts - 1000) < 20);
  }
  // Repeated unchanged P1 inputs wait for the previous actual command, then use
  // the freshest value. A small residual no longer needs a >=50 W meter change.
  {
    now = 107000;
    const { app, timers, outputs } = setup({}, 40);
    app.requestEvaluate();
    assert.equal(outputs.length, 1);
    now = 108000;
    app.state.gridPowerW = 35;
    app.requestEvaluate();
    assert.equal(outputs.length, 1);
    assert.equal(timers[0].delay, 6000);
    now = 109000;
    app.requestEvaluate();
    assert.equal(timers.length, 1);
    now = 114000;
    timers[0].callback();
    assert.equal(outputs.length, 2);
    assert.equal(outputs[1].at - outputs[0].at, 7000);
  }
  // Same-zone inside-band noise remains filtered, including the band edges.
  for (const grid of [-5, 0, 15, 25]) {
    now = 107000;
    const { app, outputs, evaluations, timers } = setup({}, grid);
    app.requestEvaluate();
    assert.equal(evaluations.length, 0);
    assert.equal(outputs.length, 0);
    assert.equal(timers.length, 0);
  }
  // The scheduler can reassess, but the engine still cannot exceed power limits,
  // discharge an empty battery, charge a full one, or invent a sub-step output.
  for (const [overrides, grid, command, soc] of [
    [{ maxDischargePerBatteryW: 1000, maxTotalDischargeW: 1000 }, 35, 1000, 50],
    [{}, 35, 0, 10],
    [{}, -15, 0, 100],
    [{ batteryCommandStepW: 100 }, 35, 1000, 50],
  ]) {
    now = 107000;
    const { app, outputs, evaluations } = setup(overrides, grid, command, soc);
    app.requestEvaluate();
    assert.equal(evaluations.length, 1);
    assert.equal(outputs.length, 0);
  }
  // Planned grid charging and standby do not mistake intentional stable import
  // for a self-consumption error. Peak Guard can still request a reassessment.
  for (const mode of ['charge', 'manual_charge', 'standby']) {
    now = 107000;
    const { app } = setup({}, 500);
    app.latestResult = { baseMode: mode, override: '' };
    assert.equal(app.shouldRunFastEvaluation(), false);
  }
  {
    now = 107000;
    const { app } = setup({}, 2600);
    app.latestResult = { baseMode: 'charge', override: '' };
    assert.equal(app.shouldRunFastEvaluation(), true);
  }
  console.log('0.8.2 residual-error regressions passed: import/export, <20 W correction, 7 s command interval, noise and battery limits');
} finally { Date.now = realNow; }
