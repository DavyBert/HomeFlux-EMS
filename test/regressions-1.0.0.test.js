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
const { calculateEvDecision, evPowerPerAmp } = require('../lib/flexible-loads');
const { translate } = require('../lib/display-language');
const start = Date.parse('2026-09-28T10:00:00Z');

function setup(mode = 'standard', count = 1) {
  const app = Object.create(App.prototype);
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', evCount: count, batteryCount: 0,
    peakShaveEnabled: true, peakLimitW: 16000, peakSoftMarginW: 1000,
    exportLimitEnabled: false, minimumExportW: 0, evPvSharePercent: 100,
    evIdleHouseLoadW: 1000,
    touRates: [{ id: 'normal', name: 'Normal', evMaxGridImportW: 15000 }],
    touSchedule: [{ rateId: 'normal', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
  };
  for (let i = 0; i < count; i++) {
    const prefix = i ? `ev${i+1}` : 'ev';
    const fields = { Enabled: true, SocEnabled: true, SocFreshnessMinutes: 15, ControlType: 'mode',
      Mode: 'smart', ModeSmartCurrentA: 6, ModeStandardCurrentA: 16, StandardCurrentA: 16,
      Phases: 3, Voltage: 400, VoltageReference: 'line', TargetSoc: 80, TargetTime: '23:59',
      MinCurrentA: 6, MaxCurrentA: 16, BatteryCapacityKwh: 60, FeedbackTolerancePercent: 15,
      PvGridTopUpMode: 'off', Weight: 1, SmartGridPriority: 'ev_first', SkipFeedbackValidation: false };
    for (const [key, value] of Object.entries(fields)) settings[`${prefix}${key}`] = value;
    Object.assign(settings.touRates[0], { [`${prefix}ChargeAllowed`]: true, [`${prefix}PvChargeAllowed`]: true });
  }
  const evState = () => ({ connected: true, chargeCurrentA: 0, soc: 42 });
  const seen = () => ({ connected: true, chargeCurrent: false, soc: true });
  const updated = () => ({ connected: start, chargeCurrent: 0, soc: start });
  app.state = { gridPowerW: 1000, pvPowerW: 0, lastTotalCommandW: 0,
    batterySoc: Array(8).fill(null), evConnected: true, evChargeCurrentA: 0, evSoc: 42 };
  app.inputSeen = { grid: true, pv: true, forecast: true, ev: seen(), batterySoc: Array(8).fill(false) };
  app.inputUpdatedAt = { grid: start, pv: start, ev: updated(), batterySoc: Array(8).fill(0) };
  app.evSessionOverride = { mode: null, sessionStarted: true };
  app.evPvSession = { active: false };
  app.lastPublishedEvChargeMode = mode;
  app.lastPublishedEvAllowed = true;
  app.lastPublishedEvCurrentA = 0;
  app.lastEvPublishedAt = start - 10000;
  app.evPeakGuardStopHoldUntil = 0;
  const decision = () => ({ connected: true, allowed: true, desiredCurrentA: mode === 'smart' ? 6 : 16,
    intentionalGridImport: true, portfolioGridImportTargetW: 15000, effectiveChargeMode: mode });
  app.latestEvDecision = decision();
  app.extraEvInstances = Array.from({ length: 3 }, (_, i) => i < count-1 ? {
    state: evState(), seen: seen(), updatedAt: updated(), lastPublishedChargeMode: mode,
    lastPublishedAllowed: true, lastPublishedAt: start - 10000,
    latestDecision: decision(), sessionOverride: { mode: null }, pvSession: { active: false },
  } : null);
  app.evSessionDetection = { houseHistory: [], portfolioBaselineW: 1000, noLoadSince: 0,
    gridReleaseBlocked: false, sessions: Array.from({ length: 4 }, () => ({ state: 'waiting', connectedAt: start,
      startedAt: 0, endedAt: 0, endedReason: '', endedLatched: false, loadAbsent: false })) };
  app.evEnergyPlans = Array.from({ length: 4 }, () => ({ active: false, sessionStarted: false }));
  app.evSocPlans = Array.from({ length: 4 }, () => ({ active: false }));
  app.getSettings = () => settings;
  app.getRuntimeSettings = s => s;
  app.getPvCurtailmentHeadroomW = () => 0;
  app.isHybridExternalControlActive = () => false;
  app.requestContextEvaluate = () => {};
  app.requestEvaluate = () => {};
  app.syncEmsDevices = async () => {};
  app.persistEvEnergyPlanOverrides = () => {};
  app.persistEvSocPlanOverrides = () => {};
  app.homey = { clock: { getTimezone: () => 'Europe/Brussels' }, i18n: { getLanguage: () => 'nl' } };
  const expectedW = evPowerPerAmp(settings) * (mode === 'smart' ? 6 : 16);
  function sample(seconds, evW, applianceW = 0, pvW = 0, batteryW = 0) {
    const now = start + seconds * 1000;
    app.state.pvPowerW = pvW;
    app.state.lastTotalCommandW = batteryW;
    app.state.gridPowerW = 1000 + evW + applianceW - pvW - batteryW;
    app.inputUpdatedAt.grid = now;
    app.inputUpdatedAt.pv = now;
    app.updateEvPortfolioLoadDetection(app.state.gridPowerW, now, settings);
    return app.getEvGridImportControlStatus(settings, now);
  }
  return { app, settings, sample, expectedW, session: app.evSessionDetection.sessions[0] };
}

// Normal and Smart: on/off airfryer before pause, throughout pause and after
// automatic resumption. Mode commands stay permitted, accounting stays physical.
for (const mode of ['standard', 'smart']) {
  const { app, settings, sample, expectedW, session } = setup(mode);
  assert.equal(sample(0, expectedW).activeTargetW, 0, 'one sample cannot confirm start');
  let status = sample(5, expectedW);
  assert.equal(session.state, 'charging');
  assert.ok(Math.abs(status.activeTargetW - expectedW) <= 1, JSON.stringify({ status, expectedW, session }));
  for (let t = 6; t < 20; t++) {
    status = sample(t, expectedW, t % 2 ? 2000 : 0);
    assert.ok(Math.abs(status.activeTargetW - expectedW) <= 1, 'airfryer inflated charging budget');
  }
  app.evSessionOverride = { mode: 'smart', sessionStarted: true };
  app.evEnergyPlans[0] = { active: true, targetKwh: 20, remainingKwh: 12, sessionStarted: true, lastTickAt: start };
  for (let t = 20; t <= 85; t++) {
    status = sample(t, 0, t % 2 ? 2000 : 0);
    assert.equal(status.activeTargetW, 0, 'airfryer was attributed to paused EV');
    assert.equal(app.getEvCommandedPowerW(0, settings), 0, 'phantom Peak Guard reservation');
  }
  assert.equal(session.state, 'paused');
  assert.equal(session.endedLatched, false);
  assert.equal(app.evSessionOverride.mode, 'smart');
  assert.equal(app.evEnergyPlans[0].remainingKwh, 12);
  const permitted = app.applyEvSessionEndLatch(0, app.latestEvDecision);
  assert.equal(permitted.allowed, true);
  assert.equal(app.getEvChargeMode(permitted, settings), mode);
  assert.match(app.getEvInstanceDeviceStatus(0, settings), /gepauzeerd/);
  sample(86, expectedW, 2000);
  assert.equal(session.state, 'paused', 'one household spike must not resume');
  status = sample(87, 0);
  assert.equal(status.activeTargetW, 0);
  sample(90, expectedW, 2000);
  status = sample(95, expectedW, 2000);
  assert.equal(session.state, 'charging');
  assert.equal(session.endedLatched, false);
  assert.ok(Math.abs(status.activeTargetW - expectedW) <= 1);
  for (let t = 96; t < 105; t++) {
    status = sample(t, expectedW, t % 2 ? 2000 : 0);
    assert.ok(Math.abs(status.activeTargetW - expectedW) <= 1);
  }
  // A fast vehicle swap with no connection/completion Flow never latches STOP.
  sample(106, 0);
  sample(108, expectedW);
  sample(113, expectedW);
  assert.equal(session.state, 'charging');
  assert.equal(session.endedLatched, false);
  console.log(`${mode}: active / airfryer / pause / resume / fast swap passed`);
}

// Physical PV and battery power cannot create fake EV consumption.
{
  const { app, sample, expectedW, session } = setup();
  sample(0, expectedW, 2000, 5000, -3000);
  const active = sample(5, expectedW, 2000, 5000, -3000);
  assert.ok(active.activeTargetW <= expectedW + 1);
  for (let t = 6; t <= 70; t++) assert.equal(sample(t, 0, 2000, 5000, -3000).activeTargetW, 0);
  assert.equal(session.state, 'paused');
  assert.equal(app.evSessionDetection.physicalSiteLoadW, 3000);
}

// Replayed or missing P1 readings do not advance either debounce window.
{
  const { app, settings, sample, expectedW, session } = setup();
  sample(0, expectedW);
  app.updateEvPortfolioLoadDetection(app.state.gridPowerW, start + 60000, settings);
  assert.notEqual(session.state, 'charging');
  sample(120, expectedW);
  assert.notEqual(session.state, 'charging');
  sample(125, expectedW);
  assert.equal(session.state, 'charging');
  sample(126, 0);
  app.updateEvPortfolioLoadDetection(1000, start + 190000, settings);
  assert.equal(session.state, 'charging');
  sample(200, 0);
  assert.equal(session.state, 'charging');
}

// Shared P1 never guesses which of 2..4 cars stopped; explicit completion is per-EV.
for (const count of [2, 3, 4]) {
  const { app, sample } = setup('standard', count);
  for (let t = 0; t <= 90; t += 5) sample(t, 0);
  assert.ok(app.evSessionDetection.sessions.every(s => !s.endedLatched && s.state !== 'paused'));
  app.markEvSessionEnded(count-1, 'flow', start+100000);
  assert.equal(app.evSessionDetection.sessions[count-1].endedLatched, true);
  assert.equal(app.evSessionDetection.sessions[0].endedLatched, false);
}

function goal(settings, options = {}) {
  return calculateEvDecision({ settings, now: new Date(start), connected: true,
    soc: 42, socSeen: true, socFresh: true, actualCurrentA: 0, gridPowerW: 1000,
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' }, ...options });
}
// Fresh SoC or delivered kWh, never stale SoC/zero watts/time alone, completes.
{
  const { app, settings, session } = setup();
  assert.equal(goal(settings).targetCompleted, undefined);
  assert.equal(goal(settings, { soc: 80, socFresh: false }).targetCompleted, undefined);
  assert.equal(goal({ ...settings, evSocEnabled: false }, { soc: 100 }).targetCompleted, undefined);
  assert.equal(goal({ ...settings, evMode: 'emergency' }, { soc: 80 }).targetCompleted, undefined);
  assert.equal(goal({ ...settings, evMode: 'emergency' }, { soc: 100 }).targetCompleted, 'soc_target');
  const completed = app.applyEvSessionEndLatch(0, goal(settings, { soc: 80 }));
  assert.equal(session.endedReason, 'soc_target');
  assert.equal(completed.allowed, false);
  assert.equal(app.getEvChargeMode(completed, settings), 'stop');
  assert.equal(app.applyEvSessionEndLatch(0, goal(settings, { soc: 79 })).allowed, false);
  app.rearmEvCompletedTarget(0);
  assert.equal(session.endedLatched, false);
  const energy = goal({ ...settings, evEnergyPlanActive: true, evEnergyNeedKwh: 0 });
  assert.equal(energy.targetCompleted, 'energy_target');
  app.applyEvSessionEndLatch(0, energy);
  assert.equal(session.endedReason, 'energy_target');
  app.handleEvDetectionConnectionTransition(0, false, true, start + 1000, settings);
  assert.equal(session.endedLatched, false);
  app.markEvSessionEnded(0, 'flow', start + 2000);
  assert.equal(app.applyEvSessionEndLatch(0, goal(settings)).allowed, false);
  assert.match(translate('Laadsessie voltooid · SoC-doel bereikt'), /SoC target reached/);
}

// kWh are integrated from measured current only; no commands, paused power,
// stale telemetry or retrospective energy from the first current report.
{
  const { app, settings, session } = setup();
  const plan = app.evEnergyPlans[0] = { active: true, targetKwh: 1, remainingKwh: 1, lastTickAt: start, sessionStarted: true };
  app.tickEvEnergyPlan(0, start+10000);
  assert.equal(plan.remainingKwh, 1, 'mode command is not measured energy');
  app.inputSeen.ev.chargeCurrent = true;
  app.inputUpdatedAt.ev.chargeCurrent = start+10000;
  app.state.evChargeCurrentA = 16;
  app.tickEvEnergyPlan(0, start+10000);
  assert.equal(plan.remainingKwh, 1);
  app.tickEvEnergyPlan(0, start+40000);
  assert.ok(Math.abs(plan.remainingKwh - (1 - 16*evPowerPerAmp(settings)/120000)) < 1e-8);
  session.loadAbsent = true;
  const remaining = plan.remainingKwh;
  app.tickEvEnergyPlan(0, start+50000);
  assert.equal(plan.remainingKwh, remaining);
  session.loadAbsent = false;
  app.tickEvEnergyPlan(0, start+1000000);
  const afterFreshWindow = plan.remainingKwh;
  app.tickEvEnergyPlan(0, start+2000000);
  assert.equal(plan.remainingKwh, afterFreshWindow, 'stale current cannot finish the target');
}

// Exercise the actual portfolio allocator: paused car keeps the normal command
// when permitted, while Peak Guard and disallowed tariffs still stop it.
{
  const { app, settings, sample, session } = setup();
  const result = { tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    pvChargeW: 0, candidateTotalCommandW: 0, candidateCommands: [0], gridChargeAssistW: 0,
    avgSoc: 50, inputReady: true, controlEnabled: true };
  for (let t = 0; t <= 65; t++) sample(t, 0, 2000);
  assert.equal(session.state, 'paused');
  let decisions = app.calculateEvPortfolioDecisions(result, 0, 0, settings);
  assert.equal(decisions[0].allowed, true);
  assert.equal(decisions[0].effectiveChargeMode, 'standard');
  sample(70, evPowerPerAmp(settings) * 16);
  decisions = app.calculateEvPortfolioDecisions(result, 0, 0, settings);
  assert.equal(decisions[0].allowed, true, 'debounced resume cannot block its own existing load');
  assert.equal(decisions[0].effectiveChargeMode, 'standard');
  sample(75, evPowerPerAmp(settings) * 16);
  for (let t = 80; t <= 145; t++) sample(t, 0, 2000);
  app.state.gridPowerW = 15500;
  decisions = app.calculateEvPortfolioDecisions(result, 0, 0, settings);
  assert.equal(decisions[0].allowed, false, 'pause must not bypass Peak Guard');
  assert.equal(decisions[0].effectiveChargeMode, 'stop');
  app.state.gridPowerW = 3000;
  settings.touRates[0].evChargeAllowed = false;
  settings.touRates[0].evPvChargeAllowed = false;
  decisions = app.calculateEvPortfolioDecisions(result, 0, 0, settings);
  assert.equal(decisions[0].allowed, false, 'pause must not bypass tariff rules');
}
// Goal completion must survive portfolio allocation on every configured EV.
{
  const { app, settings } = setup('standard', 4);
  app.state.evSoc = 80;
  app.inputUpdatedAt.ev.soc = Date.now();
  for (const extra of app.extraEvInstances) {
    extra.state.soc = 80;
    extra.updatedAt.soc = Date.now();
  }
  const result = { tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    pvChargeW: 0, candidateTotalCommandW: 0, gridChargeAssistW: 0, avgSoc: 50 };
  const decisions = app.calculateEvPortfolioDecisions(result, 0, 0, settings);
  assert.equal(decisions.length, 4);
  for (const d of decisions) {
    assert.equal(d.allowed, false);
    assert.equal(d.desiredCurrentA, 0);
    assert.equal(d.intentionalGridImport, false);
    assert.equal(d.sessionEnded, true);
  }
  assert.ok(app.evSessionDetection.sessions.every(s => s.endedReason === 'soc_target'));
}

// The last measured fraction of a kWh completes the session exactly once.
{
  const { app, session } = setup();
  app.evEnergyPlans[0] = { active: true, targetKwh: 0.01, remainingKwh: 0.01,
    lastTickAt: start, sessionStarted: true };
  app.inputSeen.ev.chargeCurrent = true;
  app.inputUpdatedAt.ev.chargeCurrent = start;
  app.state.evChargeCurrentA = 16;
  app.tickEvEnergyPlan(0, start + 10000);
  assert.equal(app.evEnergyPlans[0].remainingKwh, 0);
  assert.equal(session.endedReason, 'energy_target');
  assert.equal(session.endedLatched, true);
}
console.log('v1.0.0 EV pause, resume, completion and physical budget scenarios passed');
