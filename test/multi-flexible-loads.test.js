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
const { DEFAULTS } = require('../lib/ems-engine');
Module._load = originalLoad;

function triggerSpy() {
  const calls = [];
  return { calls, trigger: async (...args) => { calls.push(args); return true; } };
}

function makeApp() {
  const app = Object.create(HomeFluxEmsApp.prototype);
  const stored = new Map();
  app.homey = {
    clock: { getTimezone: () => 'UTC' },
    settings: {
      get: key => stored.has(key) ? stored.get(key) : null,
      set: (key, value) => stored.set(key, value),
    },
  };
  app.settingsCache = { ...DEFAULTS, timezone: 'UTC' };
  app.state = { batterySoc: [95], gridPowerW: -2500, pvPowerW: 0 };
  app.inputSeen = { batterySoc: [true], pv: false };
  app.lastPublishedPvLimitPercent = 100;
  app.boilerState = {
    outputOn: false, cycleAccumulatedMs: 0, lastTickAt: 0, lastCompletedAt: 0,
    lastCompletedDate: '', lastCompletedSource: '', activeSource: '', trackingStartedAt: 0,
    lastPersistAt: 0, lastPublishedOutput: null,
  };
  app.flexiblePriorityState = { lastEvaluationAt: 0, nextEvaluationAt: 0, lastStartedId: '' };
  return app;
}

(async () => {
  const app = makeApp();
  const settings = {
    ...DEFAULTS,
    timezone: 'UTC', batteryCount: 1,
    boilerCount: 1, boilerEnabled: true, boilerStartSoc: 90, boilerStopSoc: 70,
    boilerPowerW: 1800, boilerCycleMinutes: 90, boilerColdResetTime: '07:00',
    boilerFallbackDays: 0, boilerTariffMinBatterySoc: 40, boilerTariffStopBatterySoc: 30, contractType: 'fixed',
    hvacCount: 3, hvacEnabled: true, hvac2Enabled: false, hvac3Enabled: true,
    flexibleLoadPriorityOrder: ['hvac3', 'boiler', 'hvac1', 'hvac2'],
    priorityEvaluationMinutes: 5,
  };
  app.settingsCache = { ...settings };

  // v0.3.50: optional flexible-load modules can be configured as zero.
  assert.equal(app.getEvCount({ evCount: 0 }), 0);
  assert.equal(app.getHvacCount({ hvacCount: 0 }), 0);
  assert.equal(app.getBoilerCount({ boilerCount: 0 }), 0);
  assert.deepEqual(app.getFlexibleLoadPriorityOrder({ ...settings, boilerCount: 0, hvacCount: 0 }), []);

  // Outdoor temperature is one shared HVAC climate input for every instance.
  app.state.hvacOutdoorTemperatureC = 12.5;
  app.inputSeen.hvac = { outdoorTemperature: true };
  app.inputUpdatedAt = { hvac: { outdoorTemperature: 123456 } };
  app.extraHvacInstances = [
    { state: { roomTemperatureC: 20, outdoorTemperatureC: 99, mode: 'heat', setpointC: 21, fanSpeed: 100 }, seen: { roomTemperature: true, outdoorTemperature: false, mode: true, setpoint: true, fanSpeed: true }, updatedAt: { roomTemperature: 1, outdoorTemperature: 0, mode: 1, setpoint: 1, fanSpeed: 1 } },
    { state: {}, seen: {}, updatedAt: {} },
    { state: {}, seen: {}, updatedAt: {} },
  ];
  const hvac2Input = app.getHvacInputSnapshot(1);
  assert.equal(hvac2Input.outdoorTemperatureC, 12.5);
  assert.equal(hvac2Input.seen.outdoorTemperature, true);
  assert.equal(hvac2Input.updatedAt.outdoorTemperature, 123456);

  // EVs never enter the thermal priority list; disabled HVAC entries are removed.
  assert.deepEqual(app.getFlexibleLoadPriorityOrder(settings), ['hvac3', 'boiler', 'hvac1']);
  assert.equal(app.getPriorityEvaluationIntervalMs(settings), 5 * 60 * 1000);
  app.finishFlexiblePriorityEvaluation(1000, settings, 'boiler');
  assert.equal(app.flexiblePriorityState.nextEvaluationAt, 301000);
  assert.equal(app.flexiblePriorityState.lastStartedId, 'boiler');

  // Boiler waits for the priority manager although PV/SoC are sufficient.
  const start = Date.UTC(2026, 7, 26, 20, 0, 0);
  app.boilerState.lastTickAt = start;
  app.boilerState.trackingStartedAt = start - (4 * 86400000);
  let decision = app.calculateBoilerDecision({}, settings, { now: start, allowStart: false, gridPowerW: -2500 });
  assert.equal(decision.startEligible, true);
  assert.equal(decision.on, false);

  // Granted start; 30 minutes later a low-SoC stop keeps cumulative progress.
  decision = app.calculateBoilerDecision({}, settings, { now: start, allowStart: true, gridPowerW: -2500 });
  assert.equal(decision.on, true);
  app.state.batterySoc[0] = 60;
  decision = app.calculateBoilerDecision({}, settings, { now: start + (30 * 60000), allowStart: true, gridPowerW: 0 });
  assert.equal(decision.on, false);
  assert(Math.abs(app.boilerState.cycleAccumulatedMs - (30 * 60000)) < 2);

  // Resume later and complete the remaining 60 minutes.
  app.state.batterySoc[0] = 95;
  const resumeAt = start + (40 * 60000);
  decision = app.calculateBoilerDecision({}, settings, { now: resumeAt, allowStart: true, gridPowerW: -2500 });
  assert.equal(decision.on, true);
  decision = app.calculateBoilerDecision({}, settings, { now: resumeAt + (60 * 60000), allowStart: true, gridPowerW: -2500 });
  assert.equal(decision.on, false);
  assert.equal(decision.completedToday, true);
  assert.equal(app.boilerState.cycleAccumulatedMs, 0);
  assert.equal(app.getBoilerWarmUntil(settings), Date.UTC(2026, 7, 27, 7, 0, 0));

  // After midnight the completed PV cycle remains warm until the fixed 07:00 reset.
  const afterMidnight = Date.UTC(2026, 7, 27, 0, 30, 0);
  decision = app.calculateBoilerDecision({}, settings, { now: afterMidnight, allowStart: true, gridPowerW: -2500 });
  assert.equal(decision.on, false);
  assert.equal(decision.warm, true);

  // At the daily reset boundary the previous cycle becomes cold and a new
  // boiler day starts, so later PV heating is eligible again.
  const afterReset = Date.UTC(2026, 7, 27, 7, 1, 0);
  decision = app.calculateBoilerDecision({}, settings, { now: afterReset, allowStart: false, gridPowerW: -2500 });
  assert.equal(decision.warm, false);
  assert.equal(decision.completedToday, false);
  assert.equal(decision.startEligible, true);

  // A cycle completed before the reset only stays warm until that same day's 07:00.
  app.boilerState.lastCompletedAt = Date.UTC(2026, 7, 28, 5, 0, 0);
  app.boilerState.warmUntilCache = null;
  assert.equal(app.getBoilerWarmUntil(settings), Date.UTC(2026, 7, 28, 7, 0, 0));


  // Tariff fallback waits until the battery reserve is reached and pauses
  // again below that reserve without losing cumulative cycle progress.
  const tariffSettings = {
    ...settings,
    boilerFallbackDays: 1,
    boilerTariffMinBatterySoc: 40,
    boilerTariffStopBatterySoc: 30,
    boilerFixedChargeWindowEnabled: true,
  };
  app.boilerState.lastCompletedAt = 0;
  app.boilerState.warmUntilCache = null;
  app.boilerState.trackingStartedAt = start - (4 * 86400000);
  app.boilerState.cycleAccumulatedMs = 10 * 60000;
  app.boilerState.outputOn = false;
  app.boilerState.activeSource = '';
  app.state.batterySoc[0] = 35;
  const cheapTariff = { className: 'cheap' };
  decision = app.calculateBoilerDecision({ tariff: cheapTariff }, tariffSettings, { now: start, allowStart: true, gridPowerW: 0 });
  assert.equal(decision.tariffSelected, true);
  assert.equal(decision.tariffAllowed, false);
  assert.equal(decision.on, false);
  assert.match(decision.reason, /40%/);

  app.state.batterySoc[0] = 45;
  decision = app.calculateBoilerDecision({ tariff: cheapTariff }, tariffSettings, { now: start + 60000, allowStart: true, gridPowerW: 0 });
  assert.equal(decision.tariffAllowed, true);
  assert.equal(decision.on, true);
  assert.equal(app.boilerState.activeSource, 'tariff');

  // Hysteresis: after starting at 40%, the boiler stays on below 40% and
  // only stops at the separate 30% threshold.
  app.state.batterySoc[0] = 35;
  decision = app.calculateBoilerDecision({ tariff: cheapTariff }, tariffSettings, { now: start + (6 * 60000), allowStart: true, gridPowerW: 0 });
  assert.equal(decision.on, true);
  assert.equal(decision.tariffStopBatterySoc, 30);

  app.state.batterySoc[0] = 30;
  decision = app.calculateBoilerDecision({ tariff: cheapTariff }, tariffSettings, { now: start + (11 * 60000), allowStart: true, gridPowerW: 0 });
  assert.equal(decision.on, false);
  assert(app.boilerState.cycleAccumulatedMs >= 20 * 60000);

  // It may not restart until the higher 40% start threshold is reached again.
  app.state.batterySoc[0] = 35;
  decision = app.calculateBoilerDecision({ tariff: cheapTariff }, tariffSettings, { now: start + (12 * 60000), allowStart: true, gridPowerW: 0 });
  assert.equal(decision.on, false);
  app.state.batterySoc[0] = 40;
  decision = app.calculateBoilerDecision({ tariff: cheapTariff }, tariffSettings, { now: start + (13 * 60000), allowStart: true, gridPowerW: 0 });
  assert.equal(decision.on, true);

  // Boiler warmed status is a separate boolean output and also changes
  // independently when the configured warm-hold expires.
  app.boilerWarmedTrigger = triggerSpy();
  app.boilerState.lastPublishedWarmed = null;
  await app.publishBoilerDecision({ enabled: true, warm: true, on: false, outputCommand: null });
  assert.deepEqual(app.boilerWarmedTrigger.calls[0][0], { warmed: true });
  await app.publishBoilerDecision({ enabled: true, warm: false, on: false, outputCommand: null });
  assert.deepEqual(app.boilerWarmedTrigger.calls[1][0], { warmed: false });

  // Boiler output is one boolean token only.
  app.boilerTrigger = triggerSpy();
  app.boilerState.lastPublishedOutput = null;
  await app.publishBoilerDecision({ on: true, outputCommand: true });
  assert.deepEqual(app.boilerTrigger.calls[0][0], { on: true });

  // Output tests route to the selected extra instance.
  app.extraEvInstances = [{ sessionOverride:{}, state:{}, seen:{}, updatedAt:{} }, { sessionOverride:{}, state:{}, seen:{}, updatedAt:{} }, { sessionOverride:{}, state:{}, seen:{}, updatedAt:{} }];
  app.extraEvTriggers = [{ current: triggerSpy(), allowed: triggerSpy(), mode: triggerSpy() }, {}, {}];
  app.extraHvacTriggers = [{ power: triggerSpy(), mode: triggerSpy(), setpoint: triggerSpy(), fan: triggerSpy() }, {}, {}];
  await app.testEvOutput({ instance: 2, output: 'current', currentA: 8 });
  assert.equal(app.extraEvTriggers[0].current.calls[0][0].charge_current, 8);
  await app.testHvacOutput({ instance: 2, output: 'power', on: true });
  assert.equal(app.extraHvacTriggers[0].power.calls[0][0].state_value, 1);

  console.log('multi flexible-load tests passed');
})().catch(err => { console.error(err); process.exit(1); });
