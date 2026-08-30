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
Module._load = originalLoad;

function triggerSpy() {
  const calls = [];
  return { calls, trigger: async (...args) => { calls.push(args); return true; } };
}

(async () => {
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.getSettings = () => ({ evPhases: 3, evTargetSoc: 80 });
  app.evCurrentTrigger = triggerSpy();
  app.evAllowedTrigger = triggerSpy();
  app.evModeTrigger = triggerSpy();
  app.hvacPowerTrigger = triggerSpy();
  app.hvacModeTrigger = triggerSpy();
  app.hvacSetpointTrigger = triggerSpy();
  app.hvacFanTrigger = triggerSpy();

  app.lastPublishedEvCurrentA = 11;
  app.lastPublishedEvAllowed = true;
  app.lastPublishedEvChargeMode = 'smart';
  app.lastPublishedHvacPower = true;
  app.lastPublishedHvacMode = 'cool';
  app.lastPublishedHvacSetpoint = 22;
  app.lastPublishedHvacFanSpeed = 300;

  await app.testEvOutput({ output: 'current', currentA: 6 });
  assert.equal(app.evCurrentTrigger.calls.length, 1);
  assert.equal(app.evCurrentTrigger.calls[0][0].charge_current, 6);
  assert.equal(app.evCurrentTrigger.calls[0][0].charge_power, 4140);
  await app.testEvOutput({ output: 'allowed', allowed: false });
  assert.equal(app.evAllowedTrigger.calls[0][0].allowed_value, 0);
  await app.testEvOutput({ output: 'mode', mode: 'standard' });
  assert.equal(app.evModeTrigger.calls[0][0].charge_mode, 'standard');

  await app.testHvacOutput({ output: 'power', on: false });
  assert.equal(app.hvacPowerTrigger.calls[0][0].state_value, 0);
  await app.testHvacOutput({ output: 'mode', mode: 'heat' });
  assert.equal(app.hvacModeTrigger.calls[0][0].mode, 'heat');
  await app.testHvacOutput({ output: 'setpoint', setpoint: 21.6 });
  assert.equal(app.hvacSetpointTrigger.calls[0][0].setpoint, 21.5);
  await app.testHvacOutput({ output: 'fan', currentSpeed: 200, targetSpeed: 300 });
  assert.equal(app.hvacFanTrigger.calls[0][0].action, 'higher');
  assert.equal(app.hvacFanTrigger.calls[0][0].target_speed, 300);

  // Manual tests must never alter the normal deduplication/control state.
  assert.equal(app.lastPublishedEvCurrentA, 11);
  assert.equal(app.lastPublishedEvAllowed, true);
  assert.equal(app.lastPublishedEvChargeMode, 'smart');
  assert.equal(app.lastPublishedHvacPower, true);
  assert.equal(app.lastPublishedHvacMode, 'cool');
  assert.equal(app.lastPublishedHvacSetpoint, 22);
  assert.equal(app.lastPublishedHvacFanSpeed, 300);

  console.log('output tests passed');
})().catch(err => { console.error(err); process.exit(1); });
