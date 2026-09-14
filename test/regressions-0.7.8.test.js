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
const { emptyDay, emptyInventory, integrateInterval, avoidedEnergyValue } = require('../lib/savings');
Module._load = originalLoad;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function baseApp(now = Date.now()) {
  const app = Object.create(HomeFluxEmsApp.prototype);
  const settingsStore = new Map();
  app.state = {
    gridPowerW: 0,
    pvPowerW: 0,
    lastTotalCommandW: 0,
    batterySoc: Array(8).fill(null),
    hvacRoomTemperatureC: 25,
    hvacOutdoorTemperatureC: 30,
    hvacMode: 'off',
    hvacSetpointC: 24,
    hvacFanSpeed: 40,
  };
  app.inputSeen = {
    grid: true,
    pv: true,
    forecast: false,
    forecastTomorrow: false,
    batterySoc: Array(8).fill(false),
    ev: { soc: false, connected: false, chargeCurrent: false },
    hvac: { roomTemperature: true, outdoorTemperature: true, mode: true, setpoint: true, fanSpeed: true },
  };
  app.inputUpdatedAt = {
    grid: now,
    pv: now,
    forecast: 0,
    forecastTomorrow: 0,
    batterySoc: Array(8).fill(0),
    ev: { soc: 0, connected: 0, chargeCurrent: 0 },
    hvac: { roomTemperature: now, outdoorTemperature: now, mode: now, setpoint: now, fanSpeed: now },
  };
  app.tokens = new Map();
  app.error = () => {};
  app.log = () => {};
  app.emsDevices = new Set();
  app.homey = {
    clock: { getTimezone: () => 'Europe/Brussels' },
    settings: {
      get: key => settingsStore.has(key) ? settingsStore.get(key) : null,
      set: (key, value) => settingsStore.set(key, value),
    },
    setTimeout,
  };
  app.getSettings = () => ({ commandIntervalSeconds: 10, batteryCount: 0, totalCapacityKwh: 0 });
  app.lastPublishedPvLimitPercent = 100;
  app.lastPublishedHvacPower = null;
  app.lastPublishedHvacMode = '';
  app.lastPublishedHvacSetpoint = null;
  app.lastPublishedHvacFanAction = '';
  app.lastPublishedHvacFanSpeed = null;
  app.hvacBaselineSetpoint = null;
  app.hvacBaselineMode = null;
  app.hvacBoostMode = null;
  app.hvacManagedPowerOn = false;
  app.lastHvacControlAt = 0;
  app.latestHvacDecision = null;
  app.hvacPublishSlots = Array.from({ length: 4 }, () => ({ publishing: false, pending: null }));
  app.boilerState = {
    outputOn: false,
    cycleAccumulatedMs: 0,
    lastTickAt: now,
    lastCompletedAt: 0,
    lastCompletedDate: '',
    lastCompletedSource: '',
    activeSource: '',
    trackingStartedAt: now - (24 * 60 * 60 * 1000),
    lastPublishedOutput: null,
    lastPublishedWarmed: null,
    lastPersistAt: now,
    peakSupportRequestedAt: 0,
    latestDecision: null,
  };
  return app;
}

function hvacSettings() {
  return {
    commandIntervalSeconds: 10,
    batteryCount: 0,
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
    hvacAllowPowerControl: true,
    hvacAllowModeControl: true,
    hvacAllowSetpointControl: true,
    hvacAllowFanControl: false,
    evEnabled: false,
  };
}

(async () => {

// 1. A stale P1 value can no longer start HVAC, and an active HomeFlux HVAC
// session fails safe to its baseline/Off state. A fresh P1 value still starts.
{
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);
  const app = baseApp(now);
  const settings = hvacSettings();
  app.getSettings = () => settings;
  app.state.gridPowerW = -3000;
  app.state.pvPowerW = 5000;
  app.inputUpdatedAt.grid = now - 120000;

  const stale = app.calculateHvacControl({ override: null }, null, 0, 0, { settings, now });
  assert.equal(stale.gridFresh, false);
  assert.equal(stale.startEligible, false);
  assert.equal(stale.powerCommand, null);
  assert.equal(stale.modeCommand, null);
  assert.equal(stale.setpointCommand, null);
  assert.match(stale.reason, /verse netmeting/i);

  app.inputUpdatedAt.grid = now;
  const fresh = app.calculateHvacControl({ override: null }, null, 0, 0, { settings, now });
  assert.equal(fresh.gridFresh, true);
  assert.equal(fresh.startEligible, true);
  assert.equal(fresh.powerCommand, true);
  assert.equal(fresh.modeCommand, 'cool');
  assert.equal(fresh.setpointCommand, 23.5);
}

// 2. Boiler may not start from stale P1/PV headroom. If a managed cycle is
// already running, stale P1 stops it but preserves accumulated cycle time.
{
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);
  const app = baseApp(now);
  const settings = {
    commandIntervalSeconds: 10,
    batteryCount: 0,
    boilerCount: 1,
    boilerEnabled: true,
    boilerPowerW: 1800,
    boilerCycleMinutes: 180,
    boilerFallbackDays: 0,
    boilerStartSoc: 90,
    boilerStopSoc: 70,
    boilerDayStartTime: '07:00',
    boilerDayEndTime: '23:00',
    boilerColdResetTime: '07:00',
    peakShaveEnabled: false,
  };
  app.getSettings = () => settings;
  app.state.gridPowerW = -3000;
  app.state.pvPowerW = 5000;
  app.inputUpdatedAt.pv = now;
  app.inputUpdatedAt.grid = now - 120000;

  const stale = app.calculateBoilerDecision({ tariff: null }, settings, { now });
  assert.equal(stale.gridFresh, false);
  assert.equal(stale.startEligible, false);
  assert.equal(stale.outputCommand, null);
  assert.match(stale.reason, /verse netmeting/i);

  app.inputUpdatedAt.grid = now;
  const fresh = app.calculateBoilerDecision({ tariff: null }, settings, { now });
  assert.equal(fresh.gridFresh, true);
  assert.equal(fresh.startEligible, true);
  assert.equal(fresh.outputCommand, true);
  assert.equal(app.boilerState.outputOn, true);

  const accumulatedBefore = app.boilerState.cycleAccumulatedMs;
  const later = now + 120000;
  app.inputUpdatedAt.grid = now;
  const stopped = app.calculateBoilerDecision({ tariff: null }, settings, { now: later });
  assert.equal(stopped.outputCommand, false);
  assert.equal(app.boilerState.outputOn, false);
  assert.ok(app.boilerState.cycleAccumulatedMs >= accumulatedBefore + 120000);
  assert.match(stopped.reason, /boiler gestopt/i);
}

// 3 + memory bound. HVAC output is single-flight/latest-wins. A delayed Flow
// cannot let an old ON finish after a newer OFF, and 1000 recalculations retain
// only one pending decision instead of 1000 waiting promise chains.
{
  const app = baseApp();
  app.getSettings = () => ({
    hvacAllowPowerControl: true,
    hvacAllowModeControl: false,
    hvacAllowSetpointControl: false,
    hvacAllowFanControl: false,
  });
  const gate = deferred();
  const order = [];
  let calls = 0;
  app.hvacPowerTrigger = {
    trigger: async ({ state }) => {
      order.push(state);
      calls += 1;
      if (calls === 1) await gate.promise;
    },
  };

  const worker = app.publishHvacDecision({ powerCommand: true, modeCommand: null, setpointCommand: null, fanAction: null, fanTarget: null, reason: 'start' });
  await Promise.resolve();
  await app.publishHvacDecision({ powerCommand: false, modeCommand: null, setpointCommand: null, fanAction: null, fanTarget: null, reason: 'stop' });
  assert.deepEqual(order, ['Aan']);
  assert.equal(app.getHvacPublishSlot(0).publishing, true);
  assert.equal(app.getHvacPublishSlot(0).pending.powerCommand, false);

  gate.resolve();
  await worker;
  assert.deepEqual(order, ['Aan', 'Uit']);
  assert.equal(app.lastPublishedHvacPower, false);
  assert.equal(app.hvacManagedPowerOn, false);
  assert.equal(app.getHvacPublishSlot(0).publishing, false);
  assert.equal(app.getHvacPublishSlot(0).pending, null);
}

{
  const app = baseApp();
  app.getSettings = () => ({
    hvacAllowPowerControl: false,
    hvacAllowModeControl: false,
    hvacAllowSetpointControl: true,
    hvacAllowFanControl: false,
  });
  const gate = deferred();
  const setpoints = [];
  let calls = 0;
  app.hvacSetpointTrigger = {
    trigger: async ({ setpoint }) => {
      setpoints.push(setpoint);
      calls += 1;
      if (calls === 1) await gate.promise;
    },
  };

  const worker = app.publishHvacDecision({ powerCommand: null, modeCommand: null, setpointCommand: 20, fanAction: null, fanTarget: null, reason: 'first' });
  await Promise.resolve();
  for (let i = 0; i < 1000; i += 1) {
    const setpoint = 21 + ((i % 5) * 0.5);
    void app.publishHvacDecision({ powerCommand: null, modeCommand: null, setpointCommand: setpoint, fanAction: null, fanTarget: null, reason: `queued-${i}` });
  }

  const slot = app.getHvacPublishSlot(0);
  assert.equal(calls, 1);
  assert.equal(slot.publishing, true);
  assert.ok(slot.pending && !Array.isArray(slot.pending));
  assert.equal(slot.pending.setpointCommand, 23);

  gate.resolve();
  await worker;
  assert.equal(calls, 2);
  assert.deepEqual(setpoints, [20, 23]);
  assert.equal(slot.pending, null);
  assert.equal(slot.publishing, false);
  assert.equal(app.lastPublishedHvacSetpoint, 23);
}

// 4. "Tomorrow" is a local-calendar shift, not Date.now()+30h. At 20:00 in
// Brussels this must remain the next day rather than jumping to day +2.
{
  const app = baseApp();
  const eveningUtc = Date.parse('2026-09-14T18:00:00Z'); // 20:00 Europe/Brussels
  assert.equal(app.getLocalDateKey(new Date(eveningUtc)), '2026-09-14');
  assert.equal(app.getNextLocalDateKey(eveningUtc), '2026-09-15');
}

// 5. A status arriving while an older status is awaiting token I/O remains
// pending and is published after the active one finishes.
{
  const app = baseApp();
  const firstGate = deferred();
  const published = [];
  let tokenCalls = 0;
  let timerCallback = null;
  app.homey.setTimeout = fn => { timerCallback = fn; return { fake: true }; };
  app.getSettings = () => ({});
  app.toPublishedCommand = value => Number(value) || 0;
  app.syncEmsDevices = async () => {};
  app.lastStatusTokenValues = new Map();
  app.statusPublishing = false;
  app.statusTimer = null;
  app.lastStatusPublishAt = 0;
  app.pendingStatusResult = null;
  app.pendingStatusSignature = '';
  app.lastPublishedStatusSignature = '';
  app.lastQueuedStatusSignature = '';
  app.lastTriggeredStatusText = null;
  app.tokens.set('emsstatus', {
    setValue: async value => {
      published.push(value);
      tokenCalls += 1;
      if (tokenCalls === 1) await firstGate.promise;
    },
  });

  const statusA = { statusText: 'A' };
  const statusB = { statusText: 'B' };
  app.pendingStatusResult = statusA;
  app.pendingStatusSignature = app.getStatusResultSignature(statusA);
  const publishingA = app.publishPendingStatus();
  await Promise.resolve();
  assert.equal(app.statusPublishing, true);

  app.queueStatusUpdate(statusB);
  assert.equal(app.pendingStatusResult.statusText, 'B');
  firstGate.resolve();
  await publishingA;
  assert.equal(app.statusPublishing, false);
  assert.equal(app.pendingStatusResult.statusText, 'B');
  assert.equal(typeof timerCallback, 'function');

  timerCallback();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(published, ['A', 'B']);
  assert.equal(app.pendingStatusResult, null);
  assert.equal(app.lastPublishedStatusSignature, app.getStatusResultSignature(statusB));
}

// 6. Negative purchase prices stay signed all the way through cost accounting.
{
  const day = emptyDay('2026-09-14');
  const inventory = emptyInventory();
  integrateInterval({
    day,
    inventory,
    seconds: 300,
    gridW: 12000,
    pvW: 0,
    batteryW: 0,
    importPrice: -0.10,
    tariff: { id: 'negative', label: 'Negative' },
    capacityKwh: 20,
  });
  assert.ok(Math.abs(day.directGridKwh - 1) < 1e-9);
  assert.ok(Math.abs(day.directGridCost - (-0.10)) < 1e-9);

  const pvDay = emptyDay('2026-09-14');
  integrateInterval({
    day: pvDay,
    inventory: emptyInventory(),
    seconds: 300,
    gridW: 0,
    pvW: 12000,
    batteryW: 0,
    importPrice: -0.10,
    tariff: { id: 'negative', label: 'Negative' },
    capacityKwh: 20,
  });
  assert.ok(Math.abs(pvDay.directPvValue - (-0.10)) < 1e-9);
  assert.ok(Math.abs(avoidedEnergyValue(pvDay) - (-0.10)) < 1e-9);

  const shifted = emptyDay('2026-09-14');
  const shiftedInventory = emptyInventory();
  integrateInterval({ day: shifted, inventory: shiftedInventory, seconds: 300, gridW: 12000, pvW: 0, batteryW: -12000, importPrice: -0.10, tariff: { id: 'negative', label: 'Negative' }, capacityKwh: 20 });
  assert.ok(Math.abs(shifted.gridChargeCost - (-0.10)) < 1e-9);
  integrateInterval({ day: shifted, inventory: shiftedInventory, seconds: 300, gridW: 0, pvW: 0, batteryW: 12000, importPrice: 0.35, tariff: { id: 'peak', label: 'Peak' }, capacityKwh: 20 });
  assert.ok(Math.abs(shifted.shiftValue - 0.45) < 1e-9);

  const app = baseApp();
  app.latestResult = { tariff: { rateId: 'dynamic' }, homeyEnergy: { currentPrice: -0.12, priceClass: 'cheap' } };
  app.externalEnergy = { exportPrice: null };
  app.getSettings = () => ({ contractType: 'dynamic_hour' });
  assert.equal(app.getSavingsTariffSnapshot().importPrice, -0.12);
}

// 7. Savings never extrapolates an old grid value through a sensor outage.
// lastSampleAt still advances so recovery does not back-fill the stale gap.
{
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);
  const app = baseApp(now);
  app.getSettings = () => ({ commandIntervalSeconds: 10, batteryCount: 0, totalCapacityKwh: 0, contractType: 'fixed', fixedImportPrice: 0.30, fixedFeedInPrice: 0 });
  app.state.gridPowerW = 1000;
  app.state.pvPowerW = 0;
  app.inputSeen.grid = true;
  app.inputSeen.pv = true;
  app.inputUpdatedAt.grid = now - 120000;
  app.inputUpdatedAt.pv = now - 3600000; // a stable 0 W PV value may age overnight
  app.savings = {
    today: emptyDay(app.getSavingsDateKey(now)),
    history: {},
    inventory: emptyInventory(),
    total: 0,
    lastSampleAt: now - 60000,
    lastPersistAt: now - 60000,
  };

  app.recordSavingsSample(now);
  assert.equal(app.savings.today.directGridKwh, 0);
  assert.equal(app.savings.today.directGridCost, 0);
  assert.equal(app.savings.lastSampleAt, now);

  const later = now + 60000;
  app.inputUpdatedAt.grid = later;
  app.recordSavingsSample(later);
  assert.ok(Math.abs(app.savings.today.directGridKwh - (1 / 60)) < 1e-9);
  assert.ok(Math.abs(app.savings.today.directGridCost - 0.005) < 1e-9);
}

// 8. null/blank/boolean grid inputs cannot refresh the P1 timestamp as 0 W.
// A real numeric 0 remains valid.
{
  const now = Date.now();
  const app = baseApp(now);
  app.state.gridPowerW = 1234;
  app.inputUpdatedAt.grid = now - 120000;
  app.getInputReadiness = () => ({ ready: true });
  app.recordSavingsSample = () => {};
  app.recordGridSample = () => {};
  app.checkFlexibleSafetyFromGrid = () => {};
  app.needsSlowMeterContext = () => false;
  app.hasActiveFlexibleOutput = () => false;
  app.requestEvaluate = () => {};
  app.requestContextEvaluate = () => {};
  app.latestResult = { ok: true };
  app.lastContextGridInputW = null;

  const oldTimestamp = app.inputUpdatedAt.grid;
  app.setInput({ gridPowerW: null });
  assert.equal(app.state.gridPowerW, 1234);
  assert.equal(app.inputUpdatedAt.grid, oldTimestamp);
  app.setInput({ gridPowerW: '' });
  assert.equal(app.state.gridPowerW, 1234);
  assert.equal(app.inputUpdatedAt.grid, oldTimestamp);
  app.setInput({ gridPowerW: false });
  assert.equal(app.state.gridPowerW, 1234);
  assert.equal(app.inputUpdatedAt.grid, oldTimestamp);

  app.setInput({ gridPowerW: 0 });
  assert.equal(app.state.gridPowerW, 0);
  assert.ok(app.inputUpdatedAt.grid >= oldTimestamp);

  // The public Flow action uses the same strict parser and must reject null
  // before it can refresh any meter timestamp or trigger an evaluation.
  const flowApp = baseApp(now);
  const listeners = {};
  const card = id => ({
    trigger: async () => true,
    registerRunListener(fn) { listeners[id] = fn; return this; },
  });
  flowApp.homey.flow = {
    getTriggerCard: card,
    getActionCard: card,
    getConditionCard: card,
  };
  flowApp.registerFlowCards();
  flowApp.state.gridPowerW = 4321;
  flowApp.inputUpdatedAt.grid = oldTimestamp;
  assert.equal(await listeners.set_grid_power({ power: null }), false);
  assert.equal(flowApp.state.gridPowerW, 4321);
  assert.equal(flowApp.inputUpdatedAt.grid, oldTimestamp);
}

console.log('v0.7.8 regression tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
