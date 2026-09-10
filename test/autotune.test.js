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

function appWithSettings(overrides = {}) {
  const app = Object.create(HomeFluxEmsApp.prototype);
  const store = {
    batteryCount: 1,
    commandDeadbandW: 25,
    gridControlWindowSeconds: 0,
    pvDeltaThresholdW: 100,
    evCount: 1,
    evEnabled: true,
    evName: 'Test EV',
    evControlType: 'current',
    evCommandIntervalSeconds: 10,
    evFeedbackTolerancePercent: 10,
    evSkipFeedbackValidation: false,
    evModeSmartCurrentA: 6,
    evModeStandardCurrentA: 16,
    evMinCurrentA: 6,
    evMaxCurrentA: 32,
    evPhases: 1,
    ...overrides,
  };
  app.settingsCache = { ...store, timezone: 'Europe/Brussels' };
  app.homey = {
    clock: { getTimezone: () => 'Europe/Brussels' },
    settings: {
      get: key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
      set: (key, value) => { store[key] = value; app.settingsCache[key] = value; },
    },
  };
  app.setSetting = (key, value) => { store[key] = value; app.settingsCache[key] = value; };
  app.getSettings = () => ({ ...app.settingsCache, timezone: 'Europe/Brussels' });
  app.autoTuneRuntime = app.createAutoTuneRuntime();
  app.extraEvInstances = Array.from({ length: 3 }, () => ({ state:{}, seen:{}, updatedAt:{}, lastPublishedChargeMode:'' }));
  app.lastPublishedEvChargeMode = '';
  app.state = { gridPowerW: 0 };
  app.error = () => {};
  return { app, store };
}

// No extra polling structure: recommendations are derived from compact aggregates.
{
  const { app } = appWithSettings();
  assert.equal(app.autoTuneRuntime.grid.samples, 0);
  for (let i = 0; i < 40; i += 1) app.noteAutoTuneGridSample(i % 2 ? 320 : 0, 1_000_000 + i * 1000);
  const recs = app.getAutoTuneRecommendations();
  assert.ok(recs.some(item => item.settingKey === 'commandDeadbandW'), 'noisy P1 should recommend a larger deadband');
  assert.ok(recs.some(item => item.settingKey === 'gridControlWindowSeconds'), 'noisy P1 should recommend smoothing');
}

// Slow EV feedback can recommend a longer non-safety command interval.
{
  const { app } = appWithSettings();
  const ev = app.autoTuneRuntime.ev[0];
  ev.responseSamples = 12;
  ev.responseEwmaMs = 42_000;
  ev.errorSamples = 12;
  ev.errorEwmaPercent = 2;
  const rec = app.getAutoTuneRecommendations().find(item => item.settingKey === 'evCommandIntervalSeconds');
  assert.ok(rec, 'slow EV confirmation should produce a command interval recommendation');
  assert.ok(rec.recommended >= 40);
}

// Mode-only feedback learns the actual Smart mode current estimate.
{
  const { app } = appWithSettings({ evControlType: 'mode', evModeSmartCurrentA: 6, evModeStandardCurrentA: 16 });
  const ev = app.autoTuneRuntime.ev[0];
  ev.smartSamples = 20;
  ev.smartEwmaA = 8.2;
  const rec = app.getAutoTuneRecommendations().find(item => item.settingKey === 'evModeSmartCurrentA');
  assert.ok(rec);
  assert.equal(rec.recommended, 8);
}


// Mode-only learned estimates must never create Smart > Standard, even when
// telemetry from the two modes is noisy or sampled under different loads.
{
  const { app } = appWithSettings({ evControlType: 'mode', evModeSmartCurrentA: 6, evModeStandardCurrentA: 16 });
  const ev = app.autoTuneRuntime.ev[0];
  ev.smartSamples = 20;
  ev.smartEwmaA = 18.4;
  ev.standardSamples = 20;
  ev.standardEwmaA = 8.1;
  const recs = app.getAutoTuneRecommendations();
  const smart = recs.find(item => item.settingKey === 'evModeSmartCurrentA');
  const standard = recs.find(item => item.settingKey === 'evModeStandardCurrentA');
  const nextSmart = smart ? smart.recommended : 6;
  const nextStandard = standard ? standard.recommended : 16;
  assert.ok(nextSmart <= nextStandard, `invalid learned mode pair: Smart ${nextSmart}A > Standard ${nextStandard}A`);
}

// Permission is opt-in and applying a recommendation records the change.
(async () => {
  const { app, store } = appWithSettings();
  for (let i = 0; i < 40; i += 1) app.noteAutoTuneGridSample(i % 2 ? 320 : 0, 1_000_000 + i * 1000);
  const rec = app.getAutoTuneRecommendations().find(item => item.settingKey === 'commandDeadbandW');
  assert.ok(rec);
  const result = await app.setAutoTunePermission({ settingKey: 'commandDeadbandW', allowed: true });
  assert.equal(store._autoTunePermissions.commandDeadbandW, true);
  assert.notEqual(store.commandDeadbandW, 25);
  assert.ok(Array.isArray(store._autoTuneHistory) && store._autoTuneHistory.length >= 1);
  assert.ok(result.managed.some(item => item.settingKey === 'commandDeadbandW'));
  const disabled = await app.setAutoTunePermission({ settingKey: 'commandDeadbandW', allowed: false });
  assert.equal(Boolean(store._autoTunePermissions.commandDeadbandW), false);
  assert.equal(disabled.managed.some(item => item.settingKey === 'commandDeadbandW'), false);
  console.log('automatic finetuning tests passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
