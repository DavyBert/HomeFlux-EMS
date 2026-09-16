'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const {
  recordMinuteSample,
  getRobustAverageW,
  getHouseLoadToleranceW,
  calculatePhysicalSiteLoadW,
  calculateDetectedEvLoadW,
} = require('../lib/ev-session');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class App {} };
  if (request === 'homey-api') return { HomeyAPI: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const HomeFluxEmsApp = require('../app');
Module._load = originalLoad;

// The rolling reference is minute-bucketed and remains strictly bounded.
{
  const history = [];
  const start = Date.parse('2026-09-15T10:00:00Z');
  for (let minute = 0; minute < 55; minute += 1) {
    recordMinuteSample(history, minute === 30 ? 20000 : 1000, start + (minute * 60000), 40);
  }
  assert.equal(history.length, 40);
  assert.equal(Math.round(getRobustAverageW(history, start + (55 * 60000), 40)), 1000);
  assert.equal(getHouseLoadToleranceW(1000), 500);
  assert.equal(getHouseLoadToleranceW(10000), 1500);
}

// PV and battery action are removed from the reference consistently.
{
  assert.equal(calculatePhysicalSiteLoadW({ gridPowerW: 2000, pvPowerW: 5000, batteryPowerW: 1000 }), 8000);
  assert.equal(calculatePhysicalSiteLoadW({ gridPowerW: 6000, pvPowerW: 5000, batteryPowerW: -3000 }), 8000);
  assert.equal(calculateDetectedEvLoadW(10000, 1000, 500), 9000);
  assert.equal(calculateDetectedEvLoadW(1400, 1000, 500), 0);
  assert.equal(calculateDetectedEvLoadW(1400, null, null), null);
}

function modePortfolio(count) {
  const app = Object.create(HomeFluxEmsApp.prototype);
  const now = Date.now();
  app.state = {
    gridPowerW: 10000, pvPowerW: 0, lastTotalCommandW: 0,
    evConnected: true, evChargeCurrentA: 0,
  };
  app.inputSeen = { grid: true, pv: true, ev: { connected: true, chargeCurrent: true } };
  app.inputUpdatedAt = { grid: now, pv: now, ev: { connected: now, chargeCurrent: now } };
  app.lastPublishedEvAllowed = true;
  app.lastPublishedEvChargeMode = 'standard';
  app.latestEvDecision = {
    connected: true, intentionalGridImport: true, portfolioGridImportTargetW: 10000,
    desiredCurrentA: 19, desiredPowerW: 13110, allowed: true,
  };
  app.extraEvInstances = Array.from({ length: 3 }, (_, extraIndex) => extraIndex < count - 1 ? {
    state: { connected: true, chargeCurrentA: 0 },
    seen: { connected: true, chargeCurrent: true },
    updatedAt: { connected: now, chargeCurrent: now },
    lastPublishedAllowed: true,
    lastPublishedChargeMode: 'standard',
    lastPublishedCurrentA: 0,
    latestDecision: {
      connected: true, intentionalGridImport: true, portfolioGridImportTargetW: 10000,
      desiredCurrentA: 19, desiredPowerW: 13110, allowed: true,
    },
  } : null);
  app.evSessionDetection = {
    houseHistory: [], portfolioBaselineW: 1000, baselineCapturedAt: now - 60000,
    detectedEvLoadW: 9000, physicalSiteLoadW: 10000, noLoadSince: 0,
    gridReleaseBlocked: false, gridReleaseBlockedAt: 0,
    sessions: Array.from({ length: 4 }, () => ({ state: 'charging', endedLatched: false })),
  };
  const settings = { evCount: count };
  for (let index = 0; index < count; index += 1) {
    const stem = index === 0 ? 'ev' : `ev${index + 1}`;
    settings[`${stem}Enabled`] = true;
    settings[`${stem}ControlType`] = 'mode';
    settings[`${stem}Phases`] = 3;
    settings[`${stem}ModeSmartCurrentA`] = 6;
    settings[`${stem}ModeStandardCurrentA`] = 19;
  }
  app.getSettings = () => settings;
  return { app, settings, now };
}

// For every supported EV count, only the load above the learned house
// reference is released to the grid. The normal 1 kW house share remains for
// battery control, without needing to identify which EV owns the other watts.
for (const count of [1, 2, 3, 4]) {
  const { app, settings, now } = modePortfolio(count);
  const active = app.getEvGridImportControlStatus(settings, now);
  assert.equal(active.activeTargetW, 9000, `count=${count} did not reserve average house load`);
  assert.equal(active.houseBaselineW, 1000);
  assert.equal(active.detectedEvLoadW, 9000);

  app.state.gridPowerW = 1200;
  assert.equal(app.updateEvPortfolioLoadDetection(1200, now, settings), false);
  const waiting = app.getEvGridImportControlStatus(settings, now);
  assert.equal(waiting.activeTargetW, 0, `count=${count} released ordinary house load`);
  assert.equal(app.evSessionDetection.gridReleaseBlocked, false);

  if (count === 1) {
    app.markEvSessionEnded = (index, source, at) => {
      const session = app.evSessionDetection.sessions[index];
      session.state = 'ended';
      session.endedAt = at;
      session.endedReason = source;
      session.endedLatched = true;
      session.detectionSource = 'house_load';
      return true;
    };
    assert.equal(app.updateEvPortfolioLoadDetection(1200, now + 60001, settings), true);
    assert.equal(app.evSessionDetection.sessions[0].endedLatched, true);
    assert.equal(app.evSessionDetection.sessions[0].endedReason, 'house_load');
  } else {
    assert.equal(app.updateEvPortfolioLoadDetection(1200, now + 60001, settings), false);
    assert.equal(app.evSessionDetection.noLoadSince, 0, `count=${count} guessed an individual session end`);
  }

  const stopped = app.getEvGridImportControlStatus(settings, now + 60001);
  assert.equal(stopped.activeTargetW, 0, `count=${count} kept grid permission after no-load confirmation`);
  assert.equal(stopped.state, count === 1 ? 'inactive' : 'waiting_load');
}

// Fresh charger current is the reliable per-EV start signal. A later 0 A
// sample is shown as paused until Flow or a disconnect confirms session end.
{
  const { app, now } = modePortfolio(1);
  app.evSessionDetection.sessions[0] = {
    state: 'waiting', connectedAt: now - 1000, startedAt: 0, endedAt: 0,
    endedReason: '', endedLatched: false, detectionSource: '',
  };
  assert.equal(app.updateEvSessionFromCurrent(0, true, 16, now), true);
  assert.equal(app.evSessionDetection.sessions[0].state, 'charging');
  assert.equal(app.evSessionDetection.sessions[0].detectionSource, 'current');
  assert.equal(app.updateEvSessionFromCurrent(0, true, 0, now + 1000), false);
  assert.equal(app.evSessionDetection.sessions[0].state, 'paused');
}

// A reliable Flow end signal is a per-EV latch. It blocks the next decision
// without clearing the persistent target, and a real reconnect arms a new
// session again.
{
  const { app, settings, now } = modePortfolio(2);
  app.evSessionDetection.sessions[1].endedLatched = true;
  app.evSessionDetection.sessions[1].state = 'ended';
  const stopped = app.applyEvSessionEndLatch(1, app.extraEvInstances[0].latestDecision);
  assert.equal(stopped.allowed, false);
  assert.equal(stopped.intentionalGridImport, false);
  assert.equal(stopped.portfolioGridImportTargetW, 0);

  app.handleEvDetectionConnectionTransition(1, false, true, now + 1000, settings);
  assert.equal(app.evSessionDetection.sessions[1].endedLatched, false);
  assert.equal(app.evSessionDetection.sessions[1].state, 'waiting');
}


function pvTopUpPortfolio(count, pvW = 1500, topUpMode = 'full') {
  const app = Object.create(HomeFluxEmsApp.prototype);
  const now = Date.now();
  app.state = {
    gridPowerW: -pvW, pvPowerW: pvW, lastTotalCommandW: 0,
    batterySoc: Array(8).fill(null),
    evConnected: true, evChargeCurrentA: 0, evSoc: null,
  };
  app.inputSeen = {
    grid: true, pv: true, forecast: true, forecastTomorrow: false,
    batterySoc: Array(8).fill(false),
    ev: { soc: false, connected: true, chargeCurrent: true },
  };
  app.inputUpdatedAt = {
    grid: now, pv: now, forecast: 0, forecastTomorrow: 0,
    batterySoc: Array(8).fill(0),
    ev: { soc: 0, connected: now, chargeCurrent: now },
  };
  app.lastPublishedEvAllowed = false;
  app.lastPublishedEvCurrentA = 0;
  app.lastPublishedEvChargeMode = '';
  app.evPvSession = { active: false, rateId: '', overImportSince: 0, belowPvSince: 0 };
  app.extraEvInstances = Array.from({ length: 3 }, (_, extraIndex) => extraIndex < count - 1 ? {
    state: { soc: null, connected: true, chargeCurrentA: 0 },
    seen: { soc: false, connected: true, chargeCurrent: true },
    updatedAt: { soc: 0, connected: now, chargeCurrent: now },
    lastPublishedCurrentA: 0,
    lastPublishedAllowed: false,
    lastPublishedChargeMode: '',
    stopHoldUntil: 0,
    sessionOverride: { mode: null },
    pvSession: { active: false, rateId: '', overImportSince: 0, belowPvSince: 0 },
  } : null);
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  app.isHybridExternalControlActive = () => false;
  app.getEvBatterySupportAvailableW = () => 0;

  const rate = { id: 'normal', name: 'Normal', avoidGridImport: false, evMaxGridImportW: 2000 };
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', batteryCount: 0, evCount: count,
    touRates: [rate],
    touSchedule: [{ rateId: 'normal', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    peakShaveEnabled: false, exportLimitEnabled: false, minimumExportW: 0,
  };
  for (let index = 0; index < count; index += 1) {
    const stem = index === 0 ? 'ev' : `ev${index + 1}`;
    Object.assign(settings, {
      [`${stem}Enabled`]: true,
      [`${stem}SocEnabled`]: false,
      [`${stem}Mode`]: 'smart',
      [`${stem}ControlType`]: 'current',
      [`${stem}PvGridTopUpMode`]: topUpMode,
      [`${stem}PvStartSurplusW`]: 0,
      [`${stem}PvStopSurplusW`]: 0,
      [`${stem}PvStopDelaySeconds`]: 60,
      [`${stem}SmartPvPriority`]: 'battery_first',
      [`${stem}SmartGridPriority`]: 'battery_first',
      [`${stem}Weight`]: 1,
      [`${stem}Phases`]: 1,
      [`${stem}MinCurrentA`]: 6,
      [`${stem}MaxCurrentA`]: 32,
      [`${stem}StandardCurrentA`]: 16,
    });
    rate[`${stem}ChargeAllowed`] = false;
    rate[`${stem}PvChargeAllowed`] = true;
    rate[`${stem}PvGridTopUpAllowed`] = true;
    rate[`${stem}PvMinSurplusW`] = 0;
    rate[`${stem}PvStopGridImportW`] = 1000;
  }
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    candidateCommands: [0], candidateTotalCommandW: 0,
    calculatedCommands: [0], calculatedTotalCommandW: 0,
    commands: [0], totalCommandW: 0,
    gridChargeAssistW: 0, pvChargeW: 0,
  };
  app.coordinateEvBatteryPriority(result, settings);
  return result.evDecisions;
}

// PV grid top-up outside a normal standard-charging tariff must survive the
// portfolio allocator for every supported EV count. The shared P1 permission is
// non-zero, but never exceeds the configured 2 kW tariff ceiling.
for (const count of [1, 2, 3, 4]) {
  const decisions = pvTopUpPortfolio(count, 1500, 'full');
  assert.equal(decisions.length, count);
  assert.ok(decisions.some(decision => decision.desiredCurrentA > 0), `count=${count} lost the PV top-up request`);
  assert.ok(decisions.some(decision => decision.intentionalGridImport), `count=${count} did not mark top-up as intentional grid import`);
  assert.ok(decisions[0].portfolioGridImportTargetW > 0, `count=${count} published 0 W grid permission`);
  assert.ok(decisions[0].portfolioGridImportTargetW <= 2000, `count=${count} exceeded the 2 kW tariff grid ceiling`);
}

// Below minimum PV must still be able to start the minimum-current top-up path.
{
  const decisions = pvTopUpPortfolio(1, 900, 'minimum');
  assert.equal(decisions[0].desiredCurrentA, 6);
  assert.equal(decisions[0].source, 'pv+topup');
  assert.equal(decisions[0].portfolioGridImportTargetW, 480);
}

console.log('v0.7.10 EV session, house-load and PV top-up regression tests passed');
