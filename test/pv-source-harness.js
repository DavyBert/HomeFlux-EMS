'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const drain = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };

// Real startup, settings/cache, planning, control and publications.
// Only Homey I/O and virtual time are mocked. The context scheduler, timers,
// fast evaluator, output gates and context execution are the application code.
async function setup(root = path.join(__dirname, '..'), overrides = {}, start = Date.parse('2026-10-13T10:46:00Z'), initialPv = 1495) {
  const req = createRequire(path.join(root, 'package.json'));
  const { boot, DEFAULTS } = req('./test/startup-harness');
  let now = start;
  Date.now = () => now;
  const settings = { ...DEFAULTS, timezone: 'Europe/Brussels', controlEnabled: true, chargeTestPassed: true,
    batteryCount: 4, totalCapacityKwh: 21.6, maxTotalChargeW: 6000, maxTotalDischargeW: 6000,
    maxChargePerBatteryW: 2400, maxDischargePerBatteryW: 2000, optimizeMultiBatteryEfficiency: true,
    contractType: 'fixed', fixedChargeWindowStart: '11:00', fixedChargeWindowEnd: '17:00',
    controlProfile: 'exact', commandIntervalSeconds: 7, slowControlIntervalSeconds: 60,
    batteryCommandPauseEnabled: false, gridZeroMinW: -35, gridZeroMaxW: 20,
    gridControlWindowSeconds: 0, pvDeltaThresholdW: 25, peakLimitW: 2650,
    exportLimitEnabled: true, minimumExportW: 4200, pvCurtailMinBatterySoc: 95,
    evCount: 0, hvacCount: 0, boilerCount: 0, ...overrides };
  const store = new Map(Object.entries({ ...settings, settingsSchemaVersion: 70,
    _chargeTestSignature: '4:normal:single|single|single|single' }));
  const h = await boot(store);
  const app = h.app;
  assert.equal(Boolean(app.getSettings().controlEnabled),
    Boolean(settings.controlEnabled) && app.isChargeTestValid(), 'genuine startup output eligibility');
  Object.assign(app.state, { gridPowerW: 623 - initialPv, pvPowerW: initialPv,
    batterySoc: [57.8,57.8,57.8,57.8], lastTotalCommandW: 0, targetSocOverride: 80,
    forecastRemainingKwh: 0, forecastDailyMaxKwh: 0, forecastTomorrowKwh: 0,
    nightPlanningActive: false, nightPlanningStartedDate: '', nightPlanningDecisionSource: '',
    pvSeenProducingToday: true, pvProducingDate: '2026-10-13' });
  app.inputSeen.grid = true; app.inputSeen.pv = true; app.inputSeen.batterySoc = [true,true,true,true];
  app.inputUpdatedAt.grid = now; app.inputUpdatedAt.pv = now;
  app.inputUpdatedAt.batterySoc = [now,now,now,now];
  app.gridInputHistory = []; app.lastEmittedCommands = []; app.batteryIdleKnownOutput = null;
  app.lastEmittedMode = ''; app.lastEmittedOverride = ''; app.lastEmitAt = 0;
  app.nextCommandAllowedAt = 0; app.commandPublishing = false; app.pendingResult = null;
  app.controlTimer = null; app.controlTimerForce = false; app.contextTimer = null; app.contextTimerAt = 0;
  app.contextEvaluationRunning = false; app.contextEvaluationPending = false; app.contextDirty = false;
  app.contextDirtyReasons = new Set(); app.lastContextEvalAt = 0; app.lastSlowHeartbeatAt = now;
  const timers = [], traces = [], contexts = [], flexible = [];
  app.homey.setTimeout = (fn, ms) => { const t = { fn, due: now + ms, ms, done: false }; timers.push(t); return t; };
  app.commandTrigger.trigger = async tokens => { traces.push({ at: now, total: tokens.total_command,
    commands: [1,2,3,4].map(i => tokens[`battery${i}command`]),
    mode: app.latestResult.baseMode, override: app.latestResult.override || '' }); };
  for (const id of ['ev1_charge_current_updated','ev1_charging_allowed_updated','ev1_charge_mode_updated',
    'hvac1_power_updated','hvac1_mode_updated','hvac1_setpoint_updated','hvac1_fan_updated','boiler_power_updated','pv_power_limit_updated']) {
    const card = h.cards.get(id);
    if (card) card.trigger = async tokens => { flexible.push({ at: now, id, tokens }); };
  }
  const run = app.runContextEvaluation.bind(app);
  app.runContextEvaluation = async force => {
    if (!app.contextEvaluationRunning) contexts.push({ at: now, force: Boolean(force) });
    return run(force);
  };
  app.diagnostics = app.createDiagnosticsRuntime({ startedAt: now, expiresAt: now + 24*3600000,
    options: { cpu: true, planning: true, errors: true } });
  async function flush() {
    for (let pass = 0; pass < 100; pass++) {
      const ready = timers.filter(t => !t.done && t.due <= now);
      if (!ready.length) { await drain(); return; }
      for (const t of ready) { if (!t.done) { t.done = true; t.fn(); await drain(); } }
    }
    assert.fail('virtual scheduler failed to settle');
  }
  return { ...h, app, settings, timers, traces, contexts, flexible, drain, flush,
    now: () => now, setNow: value => { now = value; },
    grid: async value => { await h.cards.get('set_grid_power').listener({ power: value }); await drain(); },
    pv: async value => { await h.cards.get('set_pv_power').listener({ power: value }); await drain(); },
    start: async () => { await app.runContextEvaluation(true); await drain(); } };
}
function installVirtualClearTimeout() {
  const original = global.clearTimeout;
  global.clearTimeout = timer => {
    if (timer && typeof timer === 'object' && 'due' in timer) timer.done = true;
    else original(timer);
  };
  return () => { global.clearTimeout = original; };
}
module.exports = { setup, drain, installVirtualClearTimeout };
