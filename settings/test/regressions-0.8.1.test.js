'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (name, parent, main) {
  if (name === 'homey') return { App: class {} };
  if (name === 'homey-api') return { HomeyAPI: {} };
  return originalLoad.call(this, name, parent, main);
};
const App = require('../app');
Module._load = originalLoad;
const realNow = Date.now;
let now = 100000;
Date.now = () => now;
function harness() {
  const app = Object.create(App.prototype);
  const timers = [];
  const evaluations = [];
  app.lastControlEvalAt = 100000;
  app.lastEmitAt = 100000;
  app.nextCommandAllowedAt = 107000;
  app.controlTimer = null;
  app.fastEvaluationSkipped = 0;
  app.state = { gridPowerW: 0 };
  app.getSettings = () => ({ commandIntervalSeconds: 7 });
  app.getBatteryCommandPauseInfo = () => ({ active: false });
  app.shouldRunFastEvaluation = () => true;
  app.homey = { setTimeout: (callback, delay) => {
    const timer = { callback, delay, due: now + delay };
    timers.push(timer);
    return timer;
  } };
  // A calculation that produces no output still records its evaluation time.
  // The real queue/emit safety gates are also covered by app-control.test.js.
  app.evaluateFastNow = () => {
    app.lastControlEvalAt = now;
    evaluations.push({ at: now, gridW: app.state.gridPowerW });
  };
  return { app, timers, evaluations };
}
try {
  // User's exact scenario: last command t=0, no output at t=7, P1 change t=8.
  {
    const { app, timers, evaluations } = harness();
    now = 107000;
    app.requestEvaluate(false);
    assert.equal(evaluations.length, 1);
    assert.equal(app.lastEmitAt, 100000);
    now = 108000;
    app.state.gridPowerW = 800;
    app.requestEvaluate(false);
    assert.equal(timers.length, 0);
    assert.deepEqual(evaluations[1], { at: 108000, gridW: 800 });
  }
  // An actual command at t=7 still blocks the next command/evaluation until t=14.
  // Forced requests must not bypass the publication interval either.
  for (const force of [false, true]) {
    const { app, timers, evaluations } = harness();
    app.lastEmitAt = 107000;
    app.nextCommandAllowedAt = 114000;
    now = 108000;
    app.requestEvaluate(force);
    assert.equal(evaluations.length, 0);
    assert.equal(timers[0].delay, 6000);
    now = 109000;
    app.state.gridPowerW = 900;
    app.requestEvaluate(force);
    assert.equal(timers.length, 1); // Meter events coalesce rather than queue.
    now = 114000;
    timers[0].callback();
    assert.deepEqual(evaluations, [{ at: 114000, gridW: 900 }]);
  }
  // A slow-context calculation without output must not create a new wait.
  {
    const { app, timers, evaluations } = harness();
    now = 108000;
    app.lastControlEvalAt = now - 10;
    app.requestEvaluate(false);
    assert.equal(evaluations.length, 1);
    assert.equal(timers.length, 0);
  }
  // An in-flight output may reserve a slot beyond lastEmitAt: respect both.
  // Recheck a pending timer if another publication moves the boundary later.
  {
    const { app, timers, evaluations } = harness();
    now = 108000;
    app.nextCommandAllowedAt = 114000;
    app.requestEvaluate(false);
    assert.equal(timers[0].delay, 6000);
    app.lastEmitAt = 110000;
    app.nextCommandAllowedAt = 117000;
    now = 114000;
    timers[0].callback();
    assert.equal(evaluations.length, 0);
    assert.equal(timers[1].delay, 3000);
    now = 117000;
    timers[1].callback();
    assert.equal(evaluations.length, 1);
  }
  // Startup has no command cooldown; a stable meter still creates no timer/work.
  {
    const { app, timers, evaluations } = harness();
    now = 108000;
    app.lastEmitAt = 0;
    app.nextCommandAllowedAt = 0;
    app.lastControlEvalAt = now;
    app.requestEvaluate(false);
    assert.equal(evaluations.length, 1);
    app.shouldRunFastEvaluation = () => false;
    app.requestEvaluate(false);
    assert.equal(evaluations.length, 1);
    assert.equal(timers.length, 0);
    assert.equal(app.fastEvaluationSkipped, 1);
  }
  console.log('0.8.1 command cooldown tests passed: t=7 no output -> t=8 immediate; actual writes remain rate-limited');
} finally {
  Date.now = realNow;
}
