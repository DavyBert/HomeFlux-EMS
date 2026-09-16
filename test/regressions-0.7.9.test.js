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

function result(pvChargeW = 0) {
  return {
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    candidateCommands: [0], candidateTotalCommandW: 0,
    calculatedCommands: [0], calculatedTotalCommandW: 0,
    commands: [0], totalCommandW: 0,
    gridChargeAssistW: 0,
    pvChargeW,
    baseMode: 'self_consumption', inputReady: true, controlEnabled: true,
    liveGridPowerW: 0, avgSoc: 50,
    lowForecastBatterySaveActive: false,
    lowForecastDischargeToTargetActive: false,
    peakReserveProtected: false,
    batteryPauseCode: '', override: null,
  };
}

function configure({
  count,
  mode,
  controlType,
  hybridDelegated = false,
  outputAllowed = false,
  oldCurrentA = 0,
  batteryCount = 1,
  batteryChargeW = 0,
  gridPowerW = 0,
  evPvSharePercent = 20,
}) {
  const app = Object.create(HomeFluxEmsApp.prototype);
  const now = Date.now();
  app.state = {
    gridPowerW,
    pvPowerW: 17000,
    forecastRemainingKwh: 0,
    batterySoc: [50, null, null, null, null, null, null, null],
    lastTotalCommandW: -Math.max(0, batteryChargeW),
    evSoc: 20,
    evConnected: true,
    evChargeCurrentA: oldCurrentA,
  };
  app.inputSeen = {
    grid: true, pv: true, forecast: true, forecastTomorrow: false,
    batterySoc: [batteryCount > 0, false, false, false, false, false, false, false],
    ev: { soc: true, connected: true, chargeCurrent: true },
  };
  app.inputUpdatedAt = {
    grid: now, pv: now, forecast: now, forecastTomorrow: 0,
    batterySoc: [now, 0, 0, 0, 0, 0, 0, 0],
    ev: { soc: now, connected: now, chargeCurrent: now },
  };
  app.extraEvInstances = Array.from({ length: 3 }, (_, extraIndex) => extraIndex < count - 1 ? {
    state: { soc: 20, connected: true, chargeCurrentA: oldCurrentA },
    seen: { soc: true, connected: true, chargeCurrent: true },
    updatedAt: { soc: now, connected: now, chargeCurrent: now },
    lastPublishedCurrentA: oldCurrentA,
    lastPublishedAllowed: outputAllowed,
    lastPublishedChargeMode: oldCurrentA > 0 ? 'smart' : 'stop',
    lastPublishedAt: now,
    stopHoldUntil: 0,
    sessionOverride: { mode: null },
    pvSession: { active: false, rateId: '', overImportSince: 0, belowPvSince: 0 },
    latestDecision: null,
  } : null);
  app.evSessionOverride = { mode: null };
  app.evSocPlans = Array.from({ length: 4 }, () => ({ active: false, targetSoc: 0, targetTime: '07:00', deadlineAt: 0, guarantee: false }));
  app.evEnergyPlans = Array.from({ length: 4 }, () => ({ active: false, targetKwh: 0, remainingKwh: 0, targetTime: '07:00', deadlineAt: 0, lastTickAt: 0, guarantee: false, sessionStarted: false }));
  app.evPvSession = { active: false, rateId: '', overImportSince: 0, belowPvSince: 0 };
  app.evPeakGuardStopHoldUntil = 0;
  app.lastPublishedEvCurrentA = oldCurrentA;
  app.lastPublishedEvAllowed = outputAllowed;
  app.lastPublishedEvChargeMode = oldCurrentA > 0 ? 'smart' : 'stop';
  app.lastEvPublishedAt = now;
  app.getPvCurtailmentHeadroomW = () => 0;
  app.getRuntimeSettings = settings => settings;
  app.homey = { setTimeout, clock: { getTimezone: () => 'Europe/Brussels' } };
  app.hybridEmsRuntime = {
    delegated: hybridDelegated,
    takeover: false,
    externalSetpointW: 0,
    externalSetpointAt: now,
    externalSetpointChangedAt: now,
    staleOutsideSince: 0,
    retrySentAt: 0,
    retryReferenceSetpointW: null,
    modeRequestedAt: now,
    peakGuardWasActive: false,
    peakGuardCooldownUntil: 0,
    status: hybridDelegated ? 'external_control' : 'inactive',
  };

  const rate = { id: 'normal', name: 'Normal' };
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', batteryCount, evCount: count,
    hybridEmsEnabled: hybridDelegated,
    touRates: [rate],
    touSchedule: [{ rateId: 'normal', start: '00:00', end: '00:00', days: [1, 2, 3, 4, 5, 6, 7] }],
    evPvSharePercent,
    peakShaveEnabled: false,
    maxTotalDischargeW: 10000,
    minSoc: 10,
    maxSoc: 100,
    exportLimitEnabled: false,
    minimumExportW: 0,
  };
  for (let index = 0; index < count; index += 1) {
    const stem = index === 0 ? 'ev' : `ev${index + 1}`;
    settings[`${stem}Enabled`] = true;
    settings[`${stem}SocEnabled`] = mode === 'soc_target';
    settings[`${stem}SocFreshnessMinutes`] = 15;
    settings[`${stem}Mode`] = mode;
    settings[`${stem}ControlType`] = controlType;
    settings[`${stem}ModeSmartCurrentA`] = 6;
    settings[`${stem}ModeStandardCurrentA`] = 19;
    settings[`${stem}Weight`] = 1;
    settings[`${stem}Phases`] = 3;
    settings[`${stem}MinCurrentA`] = 6;
    settings[`${stem}MaxCurrentA`] = 32;
    settings[`${stem}StandardCurrentA`] = 19;
    settings[`${stem}BatteryCapacityKwh`] = 60;
    settings[`${stem}TargetSoc`] = 80;
    settings[`${stem}TargetTime`] = '07:00';
    settings[`${stem}GuaranteeTarget`] = false;
    settings[`${stem}AllowUnselectedTariffForDeadline`] = false;
    settings[`${stem}PeakGuardBatteryAssistNormal`] = false;
    settings[`${stem}PeakGuardBatteryAssistEmergency`] = false;
    settings[`${stem}PvGridTopUpMode`] = 'off';
    rate[`${stem}ChargeAllowed`] = false;
    rate[`${stem}PvChargeAllowed`] = true;
    rate[`${stem}PvGridTopUpAllowed`] = false;
    rate[`${stem}MaxGridImportW`] = 0;
  }
  app.getSettings = () => settings;
  return { app, settings };
}

// A published permission=No is a stop latch, even while charger/cloud feedback
// still reports the previous non-zero current. That old value remains visible,
// but may not be added back to the PV pool to finance an immediate restart.
for (const count of [1, 2, 3, 4]) {
  for (const mode of ['smart', 'soc_target']) {
    for (const controlType of ['current', 'mode', 'hybrid']) {
      for (const hybridDelegated of [false, true]) {
        const { app, settings } = configure({
          count, mode, controlType, hybridDelegated,
          outputAllowed: false, oldCurrentA: 19,
        });
        const decisions = app.calculateEvPortfolioDecisions(result(0), 0, 0, settings);
        assert.equal(decisions.length, count);
        assert.equal(decisions.every(decision => !decision.allowed && decision.desiredCurrentA === 0), true,
          `${mode}/${controlType}/hybrid=${hybridDelegated}/count=${count} restarted from stopped feedback`);
        assert.equal(decisions[0].pvPoolBudgetW, 0);
        assert.equal(decisions[0].pvReleasedBatteryBudgetW, 0);
      }
    }
  }
}

// An external Hybrid EMS has no HomeFlux pvChargeW candidate. Its physical
// 10 kW battery charge must still reserve the battery's 80% share instead of
// being advertised as unused EV budget.
for (const count of [1, 2, 3, 4]) {
  for (const mode of ['smart', 'soc_target']) {
    for (const controlType of ['current', 'mode', 'hybrid']) {
      const { app, settings } = configure({
        count, mode, controlType, hybridDelegated: true,
        outputAllowed: false, oldCurrentA: 0, batteryChargeW: 10000,
      });
      const decisions = app.calculateEvPortfolioDecisions(result(0), 0, -10000, settings);
      assert.equal(decisions.every(decision => !decision.allowed && decision.desiredCurrentA === 0), true,
        `${mode}/${controlType}/count=${count} stole externally controlled battery PV`);
      assert.equal(decisions[0].pvPoolBudgetW, 2000);
      assert.equal(decisions[0].pvReleasedBatteryBudgetW, 0);
    }
  }
}

// Exact reported 60% battery / 40% EV case: 17 kW PV minus 7 kW house load
// leaves 10 kW. The EV pool is therefore capped at 4 kW. A three-phase charger
// with a 6 A minimum needs 4.14 kW, so Current, Mode and Hybrid all choose STOP.
for (const count of [1, 2, 3, 4]) {
  for (const mode of ['smart', 'soc_target']) {
    for (const controlType of ['current', 'mode', 'hybrid']) {
      const { app, settings } = configure({
        count, mode, controlType, hybridDelegated: true,
        outputAllowed: false, oldCurrentA: 0, batteryChargeW: 10000,
        evPvSharePercent: 40,
      });
      const decisions = app.calculateEvPortfolioDecisions(result(0), 0, -10000, settings);
      assert.equal(decisions[0].pvPoolBudgetW, 4000);
      assert.equal(decisions.every(decision => !decision.allowed && decision.desiredCurrentA === 0), true,
        `${mode}/${controlType}/count=${count} exceeded the 4 kW EV share`);
    }
  }
}

// With a real 10 kW residual PV pool and no battery, all EV modes and control
// types must share that one pool. Mode-only SoC charging may fall back to Smart,
// but may not silently create Standard/grid power when top-up is disabled.
for (const count of [1, 2, 3, 4]) {
  for (const mode of ['smart', 'soc_target']) {
    for (const controlType of ['current', 'mode', 'hybrid']) {
      const { app, settings } = configure({
        count, mode, controlType, batteryCount: 0,
        outputAllowed: false, oldCurrentA: 0,
        gridPowerW: -10000, evPvSharePercent: 100,
      });
      const decisions = app.calculateEvPortfolioDecisions(result(0), 0, 0, settings);
      const totalPowerW = decisions.reduce((sum, decision) => sum + Math.max(0, Number(decision.desiredPowerW) || 0), 0);
      const totalGridW = decisions.reduce((sum, decision) => sum + Math.max(0, Number(decision.gridAllocatedW) || 0), 0);
      assert.ok(totalPowerW <= 10000, `${mode}/${controlType}/count=${count} exceeded shared PV pool`);
      assert.equal(totalGridW, 0, `${mode}/${controlType}/count=${count} created forbidden grid allocation`);
      if (controlType === 'mode' && mode === 'soc_target') {
        assert.equal(decisions.filter(decision => decision.allowed).every(decision => decision.effectiveChargeMode === 'smart'), true);
      }
    }
  }
}

// Once the decision really is STOP, all control types bypass the regular output
// interval. The fix is therefore in decision budgeting, not in delaying safety.
for (const controlType of ['current', 'mode', 'hybrid']) {
  const { app, settings } = configure({
    count: 1, mode: 'smart', controlType,
    outputAllowed: true, oldCurrentA: 19,
  });
  const now = Date.now();
  app.lastPublishedEvChargeMode = 'standard';
  app.lastEvPublishedAt = now;
  settings.evCommandIntervalSeconds = 3600;
  const timing = app.getEvOutputTimingStatus(0, {
    connected: true, allowed: false, desiredCurrentA: 0,
    desiredPowerW: 0, source: 'off', peakLimited: false,
  }, settings, now + 1000);
  assert.equal(timing.nextAllowed, false);
  assert.equal(timing.waitingForInterval, false, `${controlType} delayed STOP`);
}

console.log('v0.7.9 EV coordination regression tests passed');
