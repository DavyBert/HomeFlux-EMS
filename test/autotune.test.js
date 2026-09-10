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
    totalCapacityKwh: 20,
    minSoc: 10,
    safetySoc: 15,
    maxSoc: 100,
    batterySaveDischargeAboveSoc: 100,
    commandDeadbandW: 25,
    gridZeroMinW: -5,
    gridZeroMaxW: 25,
    gridControlWindowSeconds: 0,
    commandIntervalSeconds: 10,
    adaptiveLiveControlEnabled: true,
    adaptiveSetpointDeltaW: 1000,
    adaptiveSetpointWindowSeconds: 15,
    pvDeltaThresholdW: 100,
    pvCommandIntervalSeconds: 10,
    expectedEnergyNeedKwh: 20,
    lowForecastSelfConsumptionMinKwh: 5,
    lowForecastFixedEnabled: true,
    lowForecastAutoSunnyEnabled: true,
    lowForecastAutoSunnySoc: 90,
    lowForecastAutoSunnyMinutes: 10,
    balanceEnabled: false,
    balanceDeadbandPct: 1,
    balanceStrength: 0.2,
    solarTargetTime: '17:00',
    nightTargetTime: '07:00',
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
  app.state = {
    gridPowerW: 0,
    pvPowerW: 0,
    forecastDailyMaxKwh: null,
    forecastDailyMaxDate: '',
    batterySoc: [50, null, null, null, null, null, null, null],
    lastTotalCommandW: 0,
    evSoc: null,
    evConnected: false,
    evChargeCurrentA: 0,
  };
  app.inputSeen = {
    grid: false,
    pv: false,
    batterySoc: [true, false, false, false, false, false, false, false],
    ev: { soc: false, connected: false, chargeCurrent: false },
  };
  app.inputUpdatedAt = {
    grid: 0,
    pv: 0,
    batterySoc: Array(8).fill(0),
    ev: { soc: 0, connected: 0, chargeCurrent: 0 },
  };
  app.lowForecastSunnyOverrideDate = '';
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


// v0.6.4 planning learning: the low-PV threshold is learned from the
// relationship between forecast and whether the battery reached the 90% zone.
{
  const { app } = appWithSettings({ lowForecastSelfConsumptionMinKwh: 5, maxSoc: 100 });
  app.autoTuneRuntime.planning.days = [
    { dateKey:'2026-09-01', sampleHours:24, estimatedDemandKwh:13, forecastKwh:5, solarTargetSoc:72, peakSoc:80, nightTargetSoc:16, maxSocLimit:100 },
    { dateKey:'2026-09-02', sampleHours:24, estimatedDemandKwh:13, forecastKwh:6, solarTargetSoc:82, peakSoc:86, nightTargetSoc:17, maxSocLimit:100 },
    { dateKey:'2026-09-03', sampleHours:24, estimatedDemandKwh:13, forecastKwh:11, solarTargetSoc:94, peakSoc:96, nightTargetSoc:16, maxSocLimit:100 },
    { dateKey:'2026-09-04', sampleHours:24, estimatedDemandKwh:13, forecastKwh:12, solarTargetSoc:97, peakSoc:99, nightTargetSoc:15, maxSocLimit:100 },
  ];
  const rec = app.getAutoTuneRecommendations().find(item => item.settingKey === 'lowForecastSelfConsumptionMinKwh');
  assert.ok(rec, 'forecast/outcome history should recommend a low-PV threshold');
  assert.ok(rec.recommended >= 8 && rec.recommended <= 9.5, `unexpected learned low-PV threshold ${rec.recommended}`);
}


// Low-PV recommendations are only useful when at least one Battery Save policy
// actually uses the low-forecast classification.
{
  const { app } = appWithSettings({
    lowForecastFixedEnabled: false,
    lowForecastDynamicCheapEnabled: false,
    lowForecastDynamicNormalEnabled: false,
    lowForecastDynamicExpensiveEnabled: false,
    touRates: [],
  });
  app.autoTuneRuntime.planning.days = [
    { dateKey:'2026-09-01', sampleHours:24, estimatedDemandKwh:13, forecastKwh:5, solarTargetSoc:70, peakSoc:80, nightTargetSoc:16, maxSocLimit:100 },
    { dateKey:'2026-09-02', sampleHours:24, estimatedDemandKwh:13, forecastKwh:12, solarTargetSoc:96, peakSoc:98, nightTargetSoc:16, maxSocLimit:100 },
  ];
  const keys = new Set(app.getAutoTuneRecommendations().map(item => item.settingKey));
  assert.equal(keys.has('lowForecastSelfConsumptionMinKwh'), false, 'unused low-PV policy must not create a recommendation');
}

// v0.6.4 planning learning: expected energy need follows learned non-EV daily
// demand instead of keeping an arbitrary generic value.
{
  const { app } = appWithSettings({ expectedEnergyNeedKwh: 20, totalCapacityKwh: 20 });
  app.autoTuneRuntime.planning.days = [
    { dateKey:'2026-09-01', sampleHours:24, estimatedDemandKwh:12, forecastKwh:8, peakSoc:95, solarTargetSoc:93, nightTargetSoc:16, maxSocLimit:100 },
    { dateKey:'2026-09-02', sampleHours:24, estimatedDemandKwh:13, forecastKwh:9, peakSoc:97, solarTargetSoc:96, nightTargetSoc:17, maxSocLimit:100 },
    { dateKey:'2026-09-03', sampleHours:24, estimatedDemandKwh:14, forecastKwh:10, peakSoc:98, solarTargetSoc:97, nightTargetSoc:16, maxSocLimit:100 },
  ];
  const rec = app.getAutoTuneRecommendations().find(item => item.settingKey === 'expectedEnergyNeedKwh');
  assert.ok(rec, 'daily demand should recommend expected energy need');
  assert.ok(rec.recommended >= 12 && rec.recommended <= 14, `unexpected learned demand ${rec.recommended}`);
}

// A consistently high morning residual trims the learned energy need slightly,
// nudging night planning toward a lower morning SoC without touching Min/Safety.
{
  const { app } = appWithSettings({ expectedEnergyNeedKwh: 20, totalCapacityKwh: 20, minSoc: 10, safetySoc: 15 });
  app.autoTuneRuntime.planning.days = [
    { dateKey:'2026-09-01', sampleHours:24, estimatedDemandKwh:14, forecastKwh:7, peakSoc:98, solarTargetSoc:97, nightTargetSoc:35, maxSocLimit:100 },
    { dateKey:'2026-09-02', sampleHours:24, estimatedDemandKwh:14, forecastKwh:8, peakSoc:98, solarTargetSoc:96, nightTargetSoc:36, maxSocLimit:100 },
    { dateKey:'2026-09-03', sampleHours:24, estimatedDemandKwh:14, forecastKwh:9, peakSoc:99, solarTargetSoc:98, nightTargetSoc:34, maxSocLimit:100 },
  ];
  const recs = app.getAutoTuneRecommendations();
  const rec = recs.find(item => item.settingKey === 'expectedEnergyNeedKwh');
  assert.ok(rec);
  assert.ok(rec.recommended < 14, `high morning residual should trim need below raw 14 kWh, got ${rec.recommended}`);
  const saveFloor = recs.find(item => item.settingKey === 'batterySaveDischargeAboveSoc');
  assert.ok(saveFloor, 'high morning residual should recommend a lower Battery Save discharge floor');
  assert.ok(saveFloor.recommended < 100 && saveFloor.recommended >= 15);
  assert.equal(app.getAutoTuneSettingDescriptor('minSoc'), null, 'hard minimum SoC must not be auto-tunable');
  assert.equal(app.getAutoTuneSettingDescriptor('safetySoc'), null, 'hard safety SoC must not be auto-tunable');
  assert.equal(app.getAutoTuneSettingDescriptor('maxSoc'), null, 'hard maximum SoC must not be auto-tunable');
  assert.equal(app.getAutoTuneSettingDescriptor('peakLimitW'), null, 'Peak Guard must not be auto-tunable');
}


// Persisted history from an older setup must not produce battery-planning
// recommendations when the current configuration has no home battery.
{
  const { app } = appWithSettings({ batteryCount: 0, expectedEnergyNeedKwh: 20 });
  app.autoTuneRuntime.planning.days = [
    { dateKey:'2026-09-01', sampleHours:24, estimatedDemandKwh:12, forecastKwh:5, solarTargetSoc:70, peakSoc:80, nightTargetSoc:16, maxSocLimit:100 },
    { dateKey:'2026-09-02', sampleHours:24, estimatedDemandKwh:14, forecastKwh:12, solarTargetSoc:96, peakSoc:98, nightTargetSoc:16, maxSocLimit:100 },
  ];
  const keys = new Set(app.getAutoTuneRecommendations().map(item => item.settingKey));
  assert.equal(keys.has('expectedEnergyNeedKwh'), false);
  assert.equal(keys.has('lowForecastSelfConsumptionMinKwh'), false);
  assert.equal(keys.has('batterySaveDischargeAboveSoc'), false);
}

// Compact planning persistence is bounded. Null optional values must stay null
// instead of silently becoming zero, otherwise low-PV learning would be biased.
{
  const { app, store } = appWithSettings();
  for (let i = 0; i < 18; i += 1) {
    app.finalizeAutoTunePlanningDay({
      dateKey: `2026-08-${String(i + 1).padStart(2,'0')}`,
      sampleMillis: 24 * 3600000,
      estimatedDemandKwh: 12 + (i % 3),
      forecastKwh: i === 17 ? null : 8 + i / 10,
      peakSoc: i === 17 ? null : 95,
      solarTargetSoc: null,
      nightTargetSoc: null,
      maxSocLimit: 100,
    });
  }
  assert.equal(app.autoTuneRuntime.planning.days.length, 14, 'planning history must stay capped at 14 compact days');
  const last = app.autoTuneRuntime.planning.days.at(-1);
  assert.equal(last.forecastKwh, null);
  assert.equal(last.peakSoc, null);
  assert.equal(last.solarTargetSoc, null);
  assert.ok(Array.isArray(store._autoTuneLearning.days));
  assert.equal(store._autoTuneLearning.days.length, 14);
}


// Morning residual learning must not be inflated by PV that starts before or
// just after the configured morning target. Keep the latest quiet pre-target SoC.
{
  const { app } = appWithSettings({ nightTargetTime: '07:00' });
  app.inputSeen.pv = true;
  app.state.pvPowerW = 0;
  app.state.batterySoc[0] = 18;
  app.recordAutoTunePlanningSample(Date.parse('2026-09-10T06:30:00+02:00'), app.getSettings());
  app.state.batterySoc[0] = 17;
  app.recordAutoTunePlanningSample(Date.parse('2026-09-10T06:55:00+02:00'), app.getSettings());
  assert.equal(app.autoTuneRuntime.planning.currentDay.nightTargetSoc, 17);
  app.state.pvPowerW = 600;
  app.state.batterySoc[0] = 21;
  app.recordAutoTunePlanningSample(Date.parse('2026-09-10T07:05:00+02:00'), app.getSettings());
  assert.equal(app.autoTuneRuntime.planning.currentDay.nightTargetSoc, 17, 'PV-started SoC must not bias morning residual learning');
}

// Meter/PV cadence and multi-battery spread are tunable behaviour, not hard
// limits. They should create recommendations when observations justify it.
{
  const { app } = appWithSettings({
    commandIntervalSeconds: 10,
    pvCommandIntervalSeconds: 10,
    balanceEnabled: true,
    batteryCount: 2,
    balanceDeadbandPct: 2,
    balanceStrength: 0.05,
  });
  app.autoTuneRuntime.grid.samples = 100;
  app.autoTuneRuntime.grid.ewmaAbsDelta = 120;
  app.autoTuneRuntime.grid.gapSamples = 100;
  app.autoTuneRuntime.grid.ewmaGapMs = 8000;
  app.autoTuneRuntime.pv.samples = 100;
  app.autoTuneRuntime.pv.ewmaAbsDelta = 600;
  app.autoTuneRuntime.pv.gapSamples = 100;
  app.autoTuneRuntime.pv.ewmaGapMs = 7000;
  app.autoTuneRuntime.balance.samples = 100;
  app.autoTuneRuntime.balance.ewmaSpreadPct = 5;
  const recs = app.getAutoTuneRecommendations();
  const keys = new Set(recs.map(item => item.settingKey));
  assert.ok(keys.has('commandIntervalSeconds'));
  assert.ok(keys.has('pvCommandIntervalSeconds'));
  assert.ok(keys.has('balanceDeadbandPct'));
  assert.ok(keys.has('balanceStrength'));
  assert.ok(keys.has('gridZeroMinW'));
  assert.ok(keys.has('gridZeroMaxW'));
  const zeroMin = recs.find(item => item.settingKey === 'gridZeroMinW');
  const zeroMax = recs.find(item => item.settingKey === 'gridZeroMaxW');
  assert.equal((zeroMin.recommended + zeroMax.recommended) / 2, 10, 'zero-band midpoint must preserve the configured grid bias');
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
