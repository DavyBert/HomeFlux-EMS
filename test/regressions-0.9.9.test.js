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

// Live measurements still update learning aggregates without asking for a slow pass.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.autoTuneRuntime = app.createAutoTuneRuntime();
  let contextRequests = 0;
  app.requestContextEvaluate = () => { contextRequests += 1; };
  app.noteAutoTuneGridSample(100, 1_000);
  app.noteAutoTuneGridSample(130, 2_000);
  app.noteAutoTunePvSample(1000, 1_000);
  app.noteAutoTunePvSample(1400, 2_000);
  assert.equal(app.autoTuneRuntime.grid.lastValue, 130);
  assert.equal(app.autoTuneRuntime.pv.lastValue, 1400);
  assert.equal(contextRequests, 0, 'measurement intake must not schedule Autotune decisions');
}

// When due, the heartbeat-side helper only queues the shared slow context.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.autoTuneRuntime = app.createAutoTuneRuntime();
  app.autoTuneRuntime.permissions = { commandDeadbandW: true };
  let requested = null;
  app.getAutoTunePermissions = () => ({ commandDeadbandW: true });
  app.requestContextEvaluate = (immediate, reason) => { requested = { immediate, reason }; };
  const now = 31 * 60 * 1000;
  assert.equal(app.scheduleAutoTuneContextIfDue(now), true);
  assert.deepEqual(requested, { immediate: false, reason: 'autotune_due' });
  assert.equal(app.autoTuneRuntime.lastAutoManageCheckAt, 0, 'scheduling must not count as an Autotune evaluation');
}

// The existing 30-minute lower bound remains intact.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.autoTuneRuntime = app.createAutoTuneRuntime();
  app.getAutoTunePermissions = () => ({ commandDeadbandW: true });
  app.autoTuneRuntime.lastAutoManageCheckAt = 10 * 60 * 1000;
  let contextRequests = 0;
  app.requestContextEvaluate = () => { contextRequests += 1; };
  assert.equal(app.scheduleAutoTuneContextIfDue(39 * 60 * 1000), false);
  assert.equal(contextRequests, 0);
  assert.equal(app.scheduleAutoTuneContextIfDue(40 * 60 * 1000), true);
  assert.equal(contextRequests, 1);
}

console.log('0.9.9 Autotune scheduling regression tests passed');

// Low-priority heartbeat work follows the configured slow cadence instead of
// running every 60 seconds. Live measurement intake remains independent.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.lastSlowHeartbeatAt = 0;
  app.savings = { lastPersistAt: 0 };
  app.getSettings = () => ({ slowControlIntervalSeconds: 300 });
  app.getSlowControlIntervalMs = () => 300_000;
  const calls = { planning: 0, autotune: 0, savings: 0, persist: 0, sync: 0 };
  app.recordAutoTunePlanningSample = () => { calls.planning += 1; };
  app.scheduleAutoTuneContextIfDue = () => { calls.autotune += 1; return false; };
  app.recordSavingsSample = () => { calls.savings += 1; };
  app.persistSavingsState = () => { calls.persist += 1; };
  app.syncEmsDevices = () => { calls.sync += 1; return Promise.resolve(); };
  app.error = () => {};

  assert.equal(app.runSlowHeartbeatHousekeeping(100_000, app.getSettings()), true);
  assert.deepEqual(calls, { planning: 1, autotune: 1, savings: 1, persist: 0, sync: 1 });
  assert.equal(app.runSlowHeartbeatHousekeeping(160_000, app.getSettings()), false);
  assert.deepEqual(calls, { planning: 1, autotune: 1, savings: 1, persist: 0, sync: 1 }, '60-second heartbeat must not repeat slow housekeeping');
  assert.equal(app.runSlowHeartbeatHousekeeping(400_000, app.getSettings()), true);
  assert.deepEqual(calls, { planning: 2, autotune: 2, savings: 2, persist: 1, sync: 1 });
}

// A five-minute slow cadence must still contribute Autotune planning/demand
// learning; moving this sample from 60 seconds must not create a silent gap.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.autoTuneRuntime = app.createAutoTuneRuntime();
  app.homey = { clock: { getTimezone: () => 'UTC' } };
  app.state = { gridPowerW: 1000, pvPowerW: 0, lastTotalCommandW: 0 };
  app.inputSeen = { grid: true, pv: true, batterySoc: [] };
  app.inputUpdatedAt = { grid: 0, pv: 0 };
  app.lowForecastSunnyOverrideDate = '';
  app.getAverageBatterySoc = () => null;
  app.getBatteryCount = () => 0;
  app.getAutoTuneMeasuredEvPowerW = () => 0;
  app.getSlowControlIntervalMs = () => 300_000;
  const settings = { timezone: 'UTC', slowControlIntervalSeconds: 300, minSoc: 10, maxSoc: 100 };
  const first = Date.UTC(2026, 8, 28, 12, 0, 0);
  app.inputUpdatedAt.grid = first;
  app.inputUpdatedAt.pv = first;
  app.recordAutoTunePlanningSample(first, settings);
  const second = first + 300_000;
  app.inputUpdatedAt.grid = second;
  app.inputUpdatedAt.pv = second;
  app.recordAutoTunePlanningSample(second, settings);
  const day = app.autoTuneRuntime.planning.currentDay;
  assert(day.sampleMillis >= 300_000, 'five-minute slow sample must be accepted');
  assert(Math.abs(day.estimatedDemandKwh - (1 / 12)) < 0.001, 'five-minute 1 kW demand should learn about 0.083 kWh');
}

// Time-critical planning phase/day boundaries stay on the 60-second watchdog
// and still request an immediate context pass even when slow housekeeping is not due.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.getSettings = () => ({});
  app.runSlowHeartbeatHousekeeping = () => false;
  app.checkNightPlanningFallback = () => false;
  app.updateLowForecastSunnyPromotion = () => false;
  app.getInputReadiness = () => ({ gridFresh: true });
  app.getEvCount = () => 0;
  app.getPlanningPhaseKey = () => 'new-phase';
  app.planningCache = { value: { plan: {} }, phaseKey: 'old-phase' };
  app.latestResult = { inputReady: true };
  let invalidatedForce = null;
  let requested = null;
  app.invalidatePlanningCache = force => { invalidatedForce = force; };
  app.requestContextEvaluate = (immediate, reason) => { requested = { immediate, reason }; };
  app.runContextHeartbeat();
  assert.equal(invalidatedForce, true, 'planning phase change must force cache invalidation');
  assert.deepEqual(requested, { immediate: true, reason: 'planning_date_changed' });
}

// Fast status publication no longer performs EMS-device capability writes;
// device refreshes are handled by slow housekeeping or explicit actions.
{
  const source = HomeFluxEmsApp.prototype.publishPendingStatus.toString();
  assert.equal(source.includes('syncEmsDevices('), false);
}


// Diagnostics are opt-in, start one bounded 48-hour session and disable only
// their own settings when the deadline is reached. They must not request an EMS
// context/planning pass as a side effect.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  const stored = {
    diagnosticsPlanningEnabled: false,
    diagnosticsCpuEnabled: false,
    diagnosticsErrorsEnabled: false,
    diagnosticsMemoryEnabled: false,
  };
  const hidden = {};
  app.homey = {
    clock: { getTimezone: () => 'UTC' },
    settings: { get: key => hidden[key] ?? null },
    setTimeout: () => null,
  };
  app.getSettings = () => ({ ...stored, timezone: 'UTC', batteryCount: 1, planningMinIntervalMinutes: 5 });
  app.setSetting = (key, value) => {
    if (Object.prototype.hasOwnProperty.call(stored, key)) stored[key] = value;
    else hidden[key] = value;
  };
  app.diagnostics = app.createDiagnosticsRuntime();
  let contextRequests = 0;
  app.requestContextEvaluate = () => { contextRequests += 1; };

  stored.diagnosticsPlanningEnabled = true;
  stored.diagnosticsCpuEnabled = true;
  app.handleDiagnosticsSettingsChanged();
  assert.equal(app.diagnostics.sessionActive, true);
  assert.equal(app.diagnostics.expiresAt - app.diagnostics.startedAt, 48 * 60 * 60 * 1000);
  assert.equal(contextRequests, 0, 'enabling diagnostics must not recalculate EMS/planning');

  const expiresAt = app.diagnostics.expiresAt;
  assert.equal(app.expireDiagnostics('48h_expired', expiresAt), true);
  assert.equal(stored.diagnosticsPlanningEnabled, false);
  assert.equal(stored.diagnosticsCpuEnabled, false);
  assert.equal(stored.diagnosticsErrorsEnabled, false);
  assert.equal(stored.diagnosticsMemoryEnabled, false);
  assert.equal(app.diagnostics.endReason, '48h_expired');
  assert.equal(contextRequests, 0, 'automatic diagnostics shutdown must not recalculate EMS/planning');
}

// Planning diagnostics attach the exact control configuration to a config id.
// Unchanged settings are deduplicated so 48-hour reports remain bounded.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.homey = { clock: { getTimezone: () => 'UTC' } };
  app.diagnostics = app.createDiagnosticsRuntime({
    startedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    options: { planning: true },
  });
  app.activeContextDiagnosticReasons = ['planning_date_changed'];
  const settings = {
    timezone: 'UTC', batteryCount: 1, totalCapacityKwh: 10,
    minSoc: 10, safetySoc: 20, maxSoc: 100, planningMinIntervalMinutes: 5,
    diagnosticsPlanningEnabled: true,
  };
  app.getSettings = () => ({ ...settings });
  const state = {
    gridPowerW: 120, pvPowerW: 1800, forecastRemainingKwh: 6,
    forecastDailyMaxKwh: 9, forecastTomorrowKwh: 4, batterySoc: [55],
    nightPlanningActive: false, planningForecastDay: 'today',
  };
  const plan = { version: '0.9.9', ready: true, currentSoc: 55, targetSoc: 80, rows: [] };
  app.recordDiagnosticPlanning(plan, Date.now(), settings, state);
  app.recordDiagnosticPlanning(plan, Date.now() + 1000, settings, state);
  assert.equal(app.diagnostics.planningEvents.length, 2);
  assert.equal(app.diagnostics.planningConfigurations.length, 1, 'unchanged settings should use one configuration snapshot');
  assert.equal(app.diagnostics.planningEvents[0].configId, app.diagnostics.planningEvents[1].configId);
  assert.equal(app.diagnostics.planningConfigurations[0].settings.safetySoc, 20);
  assert.deepEqual(app.diagnostics.planningEvents[0].contextReasons, ['planning_date_changed']);

  settings.safetySoc = 30;
  app.recordDiagnosticPlanning(plan, Date.now() + 2000, settings, state);
  assert.equal(app.diagnostics.planningConfigurations.length, 2, 'changed settings must create a new planning configuration snapshot');
  assert.equal(app.diagnostics.planningConfigurations[1].settings.safetySoc, 30);
}

// Error logging is bounded and remains completely passive while disabled.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.diagnostics = app.createDiagnosticsRuntime();
  app.recordDiagnosticError(['disabled']);
  assert.equal(app.diagnostics.errors.length, 0);
  app.diagnostics = app.createDiagnosticsRuntime({
    startedAt: Date.now(), expiresAt: Date.now() + 60_000, options: { errors: true },
  });
  app.recordDiagnosticError(['test error', new Error('boom')]);
  assert.equal(app.diagnostics.errors.length, 1);
  assert(app.diagnostics.errors[0].message.includes('boom'));
}

// Enabling another diagnostics channel joins the existing session and must not
// extend the fixed 48-hour deadline. CPU-only reports must not expose planning
// settings; Planning reports do.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  const settings = {
    diagnosticsPlanningEnabled: false,
    diagnosticsCpuEnabled: true,
    diagnosticsErrorsEnabled: false,
    diagnosticsMemoryEnabled: false,
    timezone: 'UTC',
    safetySoc: 25,
  };
  const hidden = {};
  app.homey = {
    clock: { getTimezone: () => 'UTC' },
    settings: { get: key => hidden[key] ?? null },
    setTimeout: () => null,
  };
  app.getSettings = () => ({ ...settings });
  app.setSetting = (key, value) => {
    if (Object.prototype.hasOwnProperty.call(settings, key)) settings[key] = value;
    else hidden[key] = value;
  };
  app.diagnostics = app.createDiagnosticsRuntime();
  const firstAt = Date.now();
  app.startDiagnosticsSession(app.getDiagnosticsOptions(), firstAt);
  const fixedExpiry = app.diagnostics.expiresAt;
  assert.equal(app.getDiagnosticsReport().planning.currentSettings, null, 'CPU-only diagnostics must not include planning configuration');

  settings.diagnosticsPlanningEnabled = true;
  app.handleDiagnosticsSettingsChanged();
  assert.equal(app.diagnostics.expiresAt, fixedExpiry, 'adding Planning must not extend the 48-hour session');
  const report = app.getDiagnosticsReport();
  assert(report.planning.currentSettings, 'Planning diagnostics should include the current HomeFlux configuration');
  assert.equal(report.planning.currentSettings.safetySoc, 25);
}

// An expired session must stay disabled after an app restart and may not be
// revived by saved diagnostic switches.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  const now = Date.now();
  const stored = {
    diagnosticsPlanningEnabled: true,
    diagnosticsCpuEnabled: true,
    diagnosticsErrorsEnabled: true,
    diagnosticsMemoryEnabled: true,
  };
  const hidden = {
    _diagnosticsStartedAt: now - (49 * 60 * 60 * 1000),
    _diagnosticsExpiresAt: now - (60 * 60 * 1000),
  };
  app.homey = {
    settings: { get: key => hidden[key] ?? null },
    setTimeout: () => null,
  };
  app.getSettings = () => ({ ...stored });
  app.setSetting = (key, value) => {
    if (Object.prototype.hasOwnProperty.call(stored, key)) stored[key] = value;
    else hidden[key] = value;
  };
  app.diagnostics = app.createDiagnosticsRuntime();
  app.restoreDiagnosticsSession();
  assert.equal(app.diagnostics.sessionActive, false);
  assert.deepEqual(
    [stored.diagnosticsPlanningEnabled, stored.diagnosticsCpuEnabled, stored.diagnosticsErrorsEnabled, stored.diagnosticsMemoryEnabled],
    [false, false, false, false],
    'expired diagnostics must be switched off after restart',
  );
  assert.equal(hidden._diagnosticsStartedAt, 0);
  assert.equal(hidden._diagnosticsExpiresAt, 0);
}

// CPU diagnostics must stay lightweight in the fast path: section timing uses
// wall time only, while process CPU is sampled separately on the slow heartbeat.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  const now = Date.now();
  app.diagnostics = app.createDiagnosticsRuntime({
    startedAt: now,
    expiresAt: now + 60_000,
    options: { cpu: true },
  });
  const startSource = HomeFluxEmsApp.prototype.startDiagnosticCpuSection.toString();
  const endSource = HomeFluxEmsApp.prototype.endDiagnosticCpuSection.toString();
  assert.equal(startSource.includes('process.cpuUsage'), false, 'fast-path section start must not poll process CPU');
  assert.equal(endSource.includes('process.cpuUsage'), false, 'fast-path section end must not poll process CPU');
  assert.equal(startSource.includes('hrtime.bigint'), false, 'CPU diagnostics must not depend on BigInt timing');
  assert.equal(endSource.includes('hrtime.bigint'), false, 'CPU diagnostics must not depend on BigInt timing');

  const token = app.startDiagnosticCpuSection('fast_evaluation');
  assert(token, 'enabled CPU diagnostics should return a lightweight timing token');
  app.endDiagnosticCpuSection(token);
  assert.equal(app.diagnostics.cpuSections.fast_evaluation.calls, 1);
  const report = app.getDiagnosticsReport();
  assert.equal(report.cpu.perSectionCpuSampling, false);
  assert.equal(report.cpu.measurementMode, 'process_cpu_60s_plus_section_wall_time');
  assert.equal(Object.prototype.hasOwnProperty.call(report.cpu.sections.fast_evaluation, 'cpuMs'), false, 'per-section CPU polling must not be reported as if it were measured');
}


// Memory diagnostics must recover when process.memoryUsage throws on a Homey
// runtime (for example uv_resident_set_memory) by using the procfs/V8 fallback.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  const now = Date.now();
  app.diagnostics = app.createDiagnosticsRuntime({
    startedAt: now,
    expiresAt: now + 60_000,
    options: { memory: true },
  });
  const originalMemoryUsage = process.memoryUsage;
  const originalFallback = app.readDiagnosticMemoryFallback;
  try {
    process.memoryUsage = () => { throw new Error('ENOENT: uv_resident_set_memory'); };
    app.readDiagnosticMemoryFallback = () => ({
      sample: {
        rssMb: 101.25,
        heapUsedMb: 42.5,
        heapTotalMb: 64,
        externalMb: 3.25,
        arrayBuffersMb: null,
        source: 'procfs_v8_fallback',
      },
      error: '',
    });
    assert.doesNotThrow(() => app.sampleDiagnostics(now + 1000));
    assert.equal(app.diagnostics.memorySamples.length, 1);
    assert.equal(app.diagnostics.memorySamples[0].rssMb, 101.25);
    assert.equal(app.diagnostics.memorySamples[0].heapUsedMb, 42.5);
    assert.equal(app.diagnostics.memorySamples[0].source, 'procfs_v8_fallback');
    assert.equal(app.diagnostics.diagnosticStatus.memory.available, true);
    assert.equal(app.diagnostics.diagnosticStatus.memory.failures, 0);
    assert.equal(app.diagnostics.diagnosticStatus.memory.lastError, '');
  } finally {
    process.memoryUsage = originalMemoryUsage;
    app.readDiagnosticMemoryFallback = originalFallback;
  }
}

// If both the normal API and the fallback are unavailable, diagnostics must
// still fail open without affecting the EMS heartbeat/control loop.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  const now = Date.now();
  app.diagnostics = app.createDiagnosticsRuntime({
    startedAt: now,
    expiresAt: now + 60_000,
    options: { memory: true },
  });
  const originalMemoryUsage = process.memoryUsage;
  const originalFallback = app.readDiagnosticMemoryFallback;
  try {
    process.memoryUsage = () => { throw new Error('blocked by runtime'); };
    app.readDiagnosticMemoryFallback = () => ({ sample: null, error: 'fallback blocked' });
    assert.doesNotThrow(() => app.sampleDiagnostics(now + 1000));
    assert.equal(app.diagnostics.memorySamples.length, 0);
    assert.equal(app.diagnostics.diagnosticStatus.memory.available, false);
    assert.equal(app.diagnostics.diagnosticStatus.memory.failures, 1);
    assert.match(app.diagnostics.diagnosticStatus.memory.lastError, /blocked by runtime/);
    assert.match(app.diagnostics.diagnosticStatus.memory.lastError, /fallback blocked/);
  } finally {
    process.memoryUsage = originalMemoryUsage;
    app.readDiagnosticMemoryFallback = originalFallback;
  }
}

// The Homey settings iframe must not call restricted Clipboard/download APIs.
{
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'settings', 'index.html'), 'utf8');
  assert.equal(html.includes('navigator.clipboard'), false);
  assert.equal(html.includes('writeText'), false);
  assert.equal(html.includes('URL.createObjectURL'), false);
  assert.equal(html.includes('anchor.download'), false);
  assert.equal(html.includes('copyDiagnosticsReport'), false);
  assert.equal(html.includes('downloadDiagnosticsReport'), false);
  assert.equal(html.includes('selectDiagnosticsReport'), true);
}
