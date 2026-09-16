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


// The setting exists in cached defaults for every EV instance, so upgrades do
// not lose EV2-EV4 values merely because those keys were added after EV1.
{
  const { DEFAULTS } = require('../lib/ems-engine');
  assert.equal(DEFAULTS.evNightSurplusChargeEnabled, false);
  assert.equal(DEFAULTS.ev2NightSurplusChargeEnabled, false);
  assert.equal(DEFAULTS.ev3NightSurplusChargeEnabled, false);
  assert.equal(DEFAULTS.ev4NightSurplusChargeEnabled, false);
}

function baseNightDecision(overrides = {}) {
  return {
    connected: true,
    allowed: false,
    selectedTariff: false,
    guaranteeActive: false,
    requestedCurrentA: 0,
    requestedPowerW: 0,
    desiredCurrentA: 0,
    desiredPowerW: 0,
    gridRequestPowerW: 0,
    pvRequestPowerW: 0,
    source: 'off',
    reason: 'Wachten op laadvenster',
    ...overrides,
  };
}

// The >1.0 kWh rule is a START gate based on transferable ENERGY, not simply
// on instantaneous charger power. Once armed, the latch may continue until the
// night target is reached; losing the night source resets it.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.evNightSurplusActive = Array(4).fill(false);
  const settings = {
    evNightSurplusChargeEnabled: true,
    evMode: 'smart', evControlType: 'current', evPhases: 1,
    evMinCurrentA: 6, evMaxCurrentA: 32, evStandardCurrentA: 16,
  };
  const rich = {
    active: true, targetSoc: 60, energyAboveTargetKwh: 5,
    remainingHours: 1, supportAvailableW: 3680, targetAt: Date.now() + 3600000,
  };
  let decision = app.applyEvNightSurplusEligibility(0, baseNightDecision(), settings, rich);
  assert.equal(decision.nightSurplusActive, true);
  assert.equal(decision.source, 'night_surplus');
  assert.equal(decision.selectedTariff, false);
  assert.equal(decision.gridRequestPowerW, 0);
  assert.equal(decision.requestedCurrentA, 16);
  assert.equal(decision.nightSurplusStartPotentialKwh, 3.68);

  // After start, less than 1 kWh remaining does not chatter the EV off.
  decision = app.applyEvNightSurplusEligibility(0, baseNightDecision(), settings, {
    ...rich, energyAboveTargetKwh: 0.5, remainingHours: 0.1,
  });
  assert.equal(decision.nightSurplusActive, true);

  // The same small opportunity cannot start a fresh session.
  app.evNightSurplusActive[1] = false;
  decision = app.applyEvNightSurplusEligibility(1, baseNightDecision(), settings, {
    ...rich, energyAboveTargetKwh: 5, remainingHours: 0.2,
  });
  assert.equal(decision.nightSurplusActive, false);
  assert.ok(decision.nightSurplusStartPotentialKwh < 1);

  // Reaching/leaving the night target resets the start latch.
  decision = app.applyEvNightSurplusEligibility(0, baseNightDecision(), settings, { active: false });
  assert.equal(decision.nightSurplusActive, false);
  assert.equal(app.evNightSurplusActive[0], false);
}

// The night source itself is derived from the calculated battery target and the
// remaining time until the night target time. It uses the target SoC as the
// discharge floor, never the ordinary minimum SoC.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.homey = { clock: { getTimezone: () => 'UTC' } };
  app.isNightPlanningPhase = () => true;
  app.isHybridExternalControlActive = () => false;
  let requestedFloor = null;
  app.getEvBatterySupportAvailableW = (settings, nextBatteryW, floor) => {
    requestedFloor = floor;
    return 5000;
  };
  const settings = { batteryCount: 1, timezone: 'UTC', nightTargetTime: '07:00' };
  const now = Date.parse('2026-09-15T22:00:00Z');
  const status = app.getEvNightSurplusStatus({
    avgSoc: 80, targetSoc: 60, effectiveCapacityKwh: 10, forecastPlanningDay: 'tomorrow',
  }, settings, 0, now);
  assert.equal(status.active, true);
  assert.equal(status.energyAboveTargetKwh, 2);
  assert.equal(status.remainingHours, 9);
  assert.equal(requestedFloor, 60);

  const atTarget = app.getEvNightSurplusStatus({
    avgSoc: 60, targetSoc: 60, effectiveCapacityKwh: 10, forecastPlanningDay: 'tomorrow',
  }, settings, 0, now);
  assert.equal(atTarget.active, false);
  assert.equal(atTarget.reason, 'target_reached');
}

function nightPortfolio(count, { controlType = 'current', mode = 'smart', selectedTariff = false, nightEnergyKwh = 20, nightSupportW = 20000 } = {}) {
  const app = Object.create(HomeFluxEmsApp.prototype);
  const now = Date.now();
  app.evNightSurplusActive = Array(4).fill(false);
  app.evSessionOverride = { mode: null };
  app.state = {
    gridPowerW: 0, pvPowerW: 0, lastTotalCommandW: 0,
    batterySoc: [80, 80, 80, 80, null, null, null, null],
    evConnected: true, evChargeCurrentA: 0, evSoc: null,
  };
  app.inputSeen = {
    grid: true, pv: true, forecast: true, forecastTomorrow: true,
    batterySoc: [true, true, true, true, false, false, false, false],
    ev: { soc: false, connected: true, chargeCurrent: true },
  };
  app.inputUpdatedAt = {
    grid: now, pv: now, forecast: now, forecastTomorrow: now,
    batterySoc: [now, now, now, now, 0, 0, 0, 0],
    ev: { soc: 0, connected: now, chargeCurrent: now },
  };
  app.extraEvInstances = Array.from({ length: 3 }, (_, extraIndex) => extraIndex < count - 1 ? {
    state: { soc: null, connected: true, chargeCurrentA: 0 },
    seen: { soc: false, connected: true, chargeCurrent: true },
    updatedAt: { soc: 0, connected: now, chargeCurrent: now },
    lastPublishedCurrentA: 0, lastPublishedAllowed: false, lastPublishedChargeMode: 'stop',
    lastPublishedAt: 0, stopHoldUntil: 0, sessionOverride: { mode: null },
    pvSession: { active: false, rateId: '', overImportSince: 0, belowPvSince: 0 },
    latestDecision: null,
  } : null);
  app.lastPublishedEvAllowed = false;
  app.lastPublishedEvCurrentA = 0;
  app.lastPublishedEvChargeMode = 'stop';
  app.lastPublishedEvAt = 0;
  app.evPvSession = { active: false, rateId: '', overImportSince: 0, belowPvSince: 0 };
  app.evEnergyPlans = Array(4).fill(null);
  app.evSocPlans = Array(4).fill(null);

  app.getRuntimeSettings = settings => settings;
  app.getPvCurtailmentHeadroomW = () => 0;
  app.isHybridExternalControlActive = () => false;
  app.getEvBatterySupportAvailableW = () => nightSupportW;
  app.getEvNightSurplusStatus = () => ({
    active: true, targetSoc: 60, avgSoc: 80, energyAboveTargetKwh: nightEnergyKwh,
    remainingHours: 4, targetAt: now + 4 * 3600000, supportAvailableW: nightSupportW,
  });
  app.applyEvPvSessionHysteresisFor = (index, decision) => decision;
  app.applyEvSessionEndLatch = (index, decision) => decision;
  app.getEvSocFreshness = () => ({ enabled: false, seen: false, fresh: false, ageMinutes: null });
  app.getEvControlCurrentA = () => 0;
  app.getEvCommandedPowerW = () => 0;
  app.isEvOutputPermittedFor = () => false;
  app.isEvOutputActiveFor = () => false;

  const rate = { id: 'night', name: 'Night', avoidGridImport: false, evMaxGridImportW: 10000 };
  const settings = {
    timezone: 'Europe/Brussels', contractType: 'tou', batteryCount: 4, evCount: count,
    evPvSharePercent: 50,
    touRates: [rate],
    touSchedule: [{ rateId: 'night', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    peakShaveEnabled: false, exportLimitEnabled: false, minimumExportW: 0,
  };
  for (let index = 0; index < count; index += 1) {
    const stem = index === 0 ? 'ev' : `ev${index + 1}`;
    Object.assign(settings, {
      [`${stem}Enabled`]: true,
      [`${stem}SocEnabled`]: false,
      [`${stem}Mode`]: mode,
      [`${stem}ControlType`]: controlType,
      [`${stem}NightSurplusChargeEnabled`]: true,
      [`${stem}PeakGuardBatteryAssistNormal`]: false,
      [`${stem}SmartGridPriority`]: 'battery_first',
      [`${stem}Weight`]: 1,
      [`${stem}Phases`]: 1,
      [`${stem}MinCurrentA`]: 6,
      [`${stem}MaxCurrentA`]: 32,
      [`${stem}StandardCurrentA`]: 16,
      [`${stem}ModeSmartCurrentA`]: 6,
      [`${stem}ModeStandardCurrentA`]: 16,
      [`${stem}PvGridTopUpMode`]: 'off',
      [`${stem}PvStartSurplusW`]: 500,
      [`${stem}PvStopSurplusW`]: 0,
      [`${stem}PvStopDelaySeconds`]: 60,
    });
    rate[`${stem}ChargeAllowed`] = selectedTariff;
    rate[`${stem}PvChargeAllowed`] = false;
    rate[`${stem}PvGridTopUpAllowed`] = false;
    rate[`${stem}PvMinSurplusW`] = 500;
    rate[`${stem}PvStopGridImportW`] = 1000;
  }
  app.getSettings = () => settings;
  const result = {
    tariff: { kind: 'tou', rateId: 'night', className: 'normal', label: 'Night' },
    candidateCommands: [0,0,0,0], candidateTotalCommandW: 0,
    calculatedCommands: [0,0,0,0], calculatedTotalCommandW: 0,
    commands: [0,0,0,0], totalCommandW: 0,
    gridChargeAssistW: 0, pvChargeW: 0,
    avgSoc: 80, targetSoc: 60, effectiveCapacityKwh: 40,
  };
  const decisions = app.calculateEvPortfolioDecisions(result, 0, 0, settings);
  return { app, settings, decisions };
}

// The feature is a per-EV battery source for all supported EV counts. It never
// grants net import, even when the active tariff would otherwise allow standard
// grid charging; stored energy above the night target gets priority instead.
for (const count of [1, 2, 3, 4]) {
  for (const selectedTariff of [false, true]) {
    const { decisions } = nightPortfolio(count, { selectedTariff });
    assert.equal(decisions.length, count);
    for (const decision of decisions) {
      assert.equal(decision.nightSurplusActive, true, `count=${count} did not arm night surplus`);
      assert.ok(decision.desiredCurrentA > 0, `count=${count} did not allocate night battery energy`);
      assert.ok(decision.nightSurplusAllocatedW > 0, `count=${count} did not classify night battery allocation`);
      assert.equal(decision.gridAllocatedW, 0, `count=${count} leaked night charging to grid`);
      assert.equal(decision.intentionalGridImport, false, `count=${count} marked night charging as intentional grid import`);
      assert.equal(decision.portfolioGridImportTargetW, 0, `count=${count} granted portfolio grid permission`);
      assert.match(decision.reason, /nachtoverschot thuisbatterij/i);
    }
  }
}


// Shared surplus energy is not counted four times. With 2.5 kWh available and
// four equal EVs, only two EVs are admitted: each can actually receive 1.25 kWh
// before the battery target. EV 3 and 4 stay stopped instead of each claiming
// the same 2.5 kWh as their own start opportunity.
{
  const { decisions } = nightPortfolio(4, { nightEnergyKwh: 2.5 });
  const active = decisions.filter(decision => decision.nightSurplusActive);
  const waiting = decisions.filter(decision => !decision.nightSurplusActive);
  assert.equal(active.length, 2);
  assert.equal(waiting.length, 2);
  for (const decision of active) {
    assert.ok(decision.nightSurplusStartPotentialKwh > 1.0);
    assert.equal(decision.gridAllocatedW, 0);
    assert.equal(decision.portfolioGridImportTargetW, 0);
  }
  for (const decision of waiting) assert.equal(decision.desiredCurrentA, 0);
}

// Mode-only control publishes Standard for the night source when it fits.
{
  const { app, settings, decisions } = nightPortfolio(1, { controlType: 'mode' });
  assert.equal(decisions[0].source, 'night_surplus');
  assert.equal(app.getEvChargeMode(decisions[0], app.getEvInstanceSettings(0, settings)), 'standard');
  assert.equal(decisions[0].portfolioGridImportTargetW, 0);
}

// A real disconnect/reconnect must require the >1 kWh start gate again rather
// than reusing the previous night-surplus latch.
{
  const app = Object.create(HomeFluxEmsApp.prototype);
  app.evNightSurplusActive = [true, true, false, false];
  app.evSessionDetection = { sessions: Array.from({ length: 4 }, () => ({ endedLatched: false })) };
  app.getConnectedEvIndexes = () => [];
  app.getLearnedEvHouseBaselineW = () => 1000;
  app.handleEvDetectionConnectionTransition(1, true, false, Date.now(), { evCount: 2 });
  assert.equal(app.evNightSurplusActive[1], false);
}

console.log('v0.7.11 night target-SoC EV charging regression tests passed');
