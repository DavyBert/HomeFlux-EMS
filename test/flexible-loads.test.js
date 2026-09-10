'use strict';

const assert = require('node:assert/strict');
const { calculateEvDecision, evPowerPerAmp } = require('../lib/flexible-loads');

function baseSettings(overrides = {}) {
  return {
    timezone: 'Europe/Brussels',
    contractType: 'tou',
    touRates: [
      { id: 'cheap', name: 'Cheap', importPrice: 0.1, evChargeAllowed: true, evPvChargeAllowed: true, evPvMinSurplusW: 0 },
      { id: 'normal', name: 'Normal', importPrice: 0.3, evChargeAllowed: false, evPvChargeAllowed: true, evPvMinSurplusW: 0 },
    ],
    touSchedule: [
      { rateId: 'cheap', start: '00:00', end: '07:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'normal', start: '07:00', end: '00:00', days: [1,2,3,4,5,6,7] },
    ],
    evEnabled: true,
    evBatteryCapacityKwh: 60,
    evTargetSoc: 80,
    evTargetTime: '07:00',
    evGuaranteeTarget: true,
    evPhases: 1,
    evMinCurrentA: 6,
    evMaxCurrentA: 32,
    evStandardCurrentA: 16,
    peakShaveEnabled: true,
    peakLimitW: 5000,
    peakSoftMarginW: 100,
    exportLimitEnabled: false,
    ...overrides,
  };
}

// Disabled module never commands a charger.
{
  const d = calculateEvDecision({ settings: baseSettings({ evEnabled: false }), connected: true, soc: 20, actualCurrentA: 0, gridPowerW: -5000, now: new Date('2026-08-23T12:00:00Z') });
  assert.equal(d.desiredCurrentA, 0);
  assert.equal(d.allowed, false);
}

// Residual PV after the battery candidate is converted to current, not the raw export before battery action.
{
  const settings = baseSettings({ peakShaveEnabled: false, evGuaranteeTarget: false });
  const d = calculateEvDecision({
    settings,
    connected: true,
    soc: 50,
    actualCurrentA: 0,
    gridPowerW: -3000,
    currentBatteryCommandW: 0,
    nextBatteryCommandW: -1500,
    now: new Date('2026-08-23T12:00:00Z'),
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
  });
  // 1500 W residual on one phase -> floor(1500/230)=6 A.
  assert.equal(d.desiredCurrentA, 6);
  assert.equal(d.source, 'pv');
}

// Selected tariff guarantees at least the configured standard charge current.
{
  const settings = baseSettings({ peakShaveEnabled: false, evGuaranteeTarget: false });
  const d = calculateEvDecision({
    settings,
    connected: true,
    soc: 50,
    actualCurrentA: 0,
    gridPowerW: 0,
    currentBatteryCommandW: 0,
    nextBatteryCommandW: 0,
    now: new Date('2026-08-24T00:30:00+02:00'),
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
  });
  assert.equal(d.desiredCurrentA, 16);
  assert.equal(d.allowed, true);
}

// Peak Guard can reduce an otherwise valid EV request all the way to zero.
{
  const settings = baseSettings({ evGuaranteeTarget: false, peakLimitW: 2500, peakSoftMarginW: 100 });
  const d = calculateEvDecision({
    settings,
    connected: true,
    soc: 50,
    actualCurrentA: 0,
    gridPowerW: 2300,
    currentBatteryCommandW: 0,
    nextBatteryCommandW: 0,
    now: new Date('2026-08-24T00:30:00+02:00'),
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
  });
  assert.equal(d.desiredCurrentA, 0);
  assert.equal(d.peakLimited, true);
}

assert.equal(evPowerPerAmp(baseSettings({ evPhases: 1 })), 230);
assert.equal(evPowerPerAmp(baseSettings({ evPhases: 3 })), 690);

// v0.6.1: a Flow SoC deadline overrides the saved target/deadline for the
// current runtime plan and feeds the same feasibility calculation.
{
  const now = new Date('2026-09-09T01:00:00+02:00');
  const deadlineAt = now.getTime() + (3 * 3600000);
  const settings = baseSettings({
    peakShaveEnabled: false,
    evTargetSoc: 90,
    evTargetTime: '07:00',
    evSocPlanActive: true,
    evSocDeadlineAt: deadlineAt,
    evGuaranteeTarget: true,
  });
  // getEvInstanceSettings applies the temporary target before calling the helper.
  settings.evTargetSoc = 80;
  const d = calculateEvDecision({
    settings, connected: true, soc: 20, actualCurrentA: 0, gridPowerW: 0,
    currentBatteryCommandW: 0, nextBatteryCommandW: 0, now,
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
  });
  assert.equal(d.planningType, 'soc_flow');
  assert.equal(d.targetSoc, 80);
  assert.equal(d.deadlineAt, deadlineAt);
  assert.equal(d.energyNeedKwh, 36);
}

console.log('HomeFlux EMS flexible-load tests: OK');

// v0.3.8: Smart mode remains usable for chargers without EV SoC.
{
  const settings = baseSettings({ evSocEnabled: false, evMode: 'smart', evGuaranteeTarget: true, peakShaveEnabled: false });
  const d = calculateEvDecision({
    settings,
    connected: true,
    soc: NaN,
    actualCurrentA: 0,
    gridPowerW: -2000,
    currentBatteryCommandW: 0,
    nextBatteryCommandW: 0,
    now: new Date('2026-08-23T12:00:00Z'),
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
  });
  assert.equal(d.socEnabled, false);
  assert.equal(d.energyNeedKwh, null);
  assert.ok(d.desiredCurrentA >= 6);
  assert.equal(d.source, 'pv');
}

// v0.6.1: when SoC support is disabled, SoC is completely outside EV planning.
// Even a stale soc_target mode is treated as Smart: no freshness check or
// missing-SoC recommendation is emitted, while tariff/PV charging still works.
{
  const settings = baseSettings({ evSocEnabled: false, evMode: 'soc_target', evSocPlanActive: true, peakShaveEnabled: false });
  const d = calculateEvDecision({
    settings, connected: true, soc: NaN, actualCurrentA: 0, gridPowerW: 0,
    now: new Date('2026-08-24T00:30:00+02:00'),
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
  });
  assert.equal(d.socEnabled, false);
  assert.equal(d.mode, 'smart');
  assert.equal(d.socFallbackActive, false);
  assert.equal(d.energyNeedKwh, null);
  assert.equal(d.planningType, 'soc');
  assert.equal(d.allowed, true);
  assert.equal(d.desiredCurrentA, 16);
  assert.doesNotMatch(d.reason, /kWh nodig tegen tijd|SoC ontbreekt|SoC niet beschikbaar/);
}

// v0.6.1: a stale SoC uses the same fallback, while a fresh SoC keeps SoC planning.
{
  const settings = baseSettings({ evSocEnabled: true, evSocFreshnessMinutes: 15, evMode: 'soc_target', peakShaveEnabled: false });
  const stale = calculateEvDecision({
    settings, connected: true, soc: NaN, socSeen: true, socFresh: false, socAgeMinutes: 16,
    actualCurrentA: 0, gridPowerW: 0, now: new Date('2026-08-24T00:30:00+02:00'),
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
  });
  assert.equal(stale.socFallbackActive, true);
  assert.equal(stale.energyNeedKwh, null);
  assert.equal(stale.desiredCurrentA, 16);
  assert.match(stale.reason, /ouder dan 15 min/);

  const fresh = calculateEvDecision({
    settings, connected: true, soc: 20, socSeen: true, socFresh: true, socAgeMinutes: 1,
    actualCurrentA: 0, gridPowerW: 0, now: new Date('2026-08-24T00:30:00+02:00'),
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
  });
  assert.equal(fresh.socFallbackActive, false);
  assert.equal(fresh.energyNeedKwh, 36);
}

// v0.3.8: Emergency charge ignores tariff and SoC but still obeys Peak Guard.
{
  const settings = baseSettings({ evSocEnabled: false, evMode: 'emergency', evMaxCurrentA: 32, peakLimitW: 2500, peakSoftMarginW: 100 });
  const d = calculateEvDecision({
    settings,
    connected: true,
    soc: NaN,
    actualCurrentA: 0,
    gridPowerW: 1000,
    currentBatteryCommandW: 0,
    nextBatteryCommandW: 0,
    now: new Date('2026-08-23T12:00:00Z'),
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
  });
  assert.equal(d.mode, 'emergency');
  assert.equal(d.desiredCurrentA, 6); // floor((2400 - 1000) / 230) = 6 A
  assert.equal(d.peakLimited, true);
}


// v0.3.36: TOU tariffs can disable PV-triggered Smart charging without
// changing the separate standard/grid-charging permission.
{
  const settings = baseSettings({
    peakShaveEnabled: false,
    evGuaranteeTarget: false,
    touRates: [
      { id: 'normal', name: 'Normal', importPrice: 0.3, evChargeAllowed: false, evPvChargeAllowed: false, evPvMinSurplusW: 0 },
    ],
  });
  const d = calculateEvDecision({
    settings,
    connected: true,
    soc: 50,
    actualCurrentA: 0,
    gridPowerW: -3000,
    currentBatteryCommandW: 0,
    nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    now: new Date('2026-08-23T12:00:00Z'),
  });
  assert.equal(d.desiredCurrentA, 0);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /PV-laden uit/);
}

// v0.3.36: the tariff PV threshold prevents PV from starting the EV until the
// configured surplus is available.
{
  const settings = baseSettings({
    peakShaveEnabled: false,
    evGuaranteeTarget: false,
    touRates: [
      { id: 'normal', name: 'Normal', importPrice: 0.3, evChargeAllowed: false, evPvChargeAllowed: true, evPvMinSurplusW: 2000 },
    ],
  });
  const below = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: -1500, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    now: new Date('2026-08-23T12:00:00Z'),
  });
  assert.equal(below.desiredCurrentA, 0);
  assert.match(below.reason, /tariefdrempel 2000 W/);

  const above = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: -2500, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    now: new Date('2026-08-23T12:00:00Z'),
  });
  assert.ok(above.desiredCurrentA >= 6);
  assert.equal(above.source, 'pv');
}

// v0.3.36: when standard charging is selected, PV still offsets grid demand
// even if PV itself is disabled as a reason to start charging in that tariff.
{
  const settings = baseSettings({
    peakShaveEnabled: false,
    evGuaranteeTarget: false,
    touRates: [
      { id: 'cheap', name: 'Cheap', importPrice: 0.1, evChargeAllowed: true, evPvChargeAllowed: false, evPvMinSurplusW: 5000 },
    ],
  });
  const d = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: -1500, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
    now: new Date('2026-08-24T00:30:00+02:00'),
  });
  assert.equal(d.desiredCurrentA, 16);
  assert.equal(d.source, 'tariff');
  assert.ok(d.pvRequestPowerW > 0);
  assert.ok(d.gridRequestPowerW > 0);
}

// v0.3.37: the PV threshold is a START threshold. Once a TOU PV session is
// active, lower PV may continue to modulate the EV instead of stopping it.
{
  const settings = baseSettings({
    peakShaveEnabled: false,
    evGuaranteeTarget: false,
    touRates: [
      { id: 'normal', name: 'Normal', importPrice: 0.3, evChargeAllowed: false, evPvChargeAllowed: true, evPvMinSurplusW: 5000, evPvStopGridImportW: 1000, evPvStopDelaySeconds: 60 },
    ],
  });
  const stopped = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: -3000, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    pvAvailableWOverride: 3000,
    now: new Date('2026-08-23T12:00:00Z'),
  });
  assert.equal(stopped.allowed, false);

  const continuing = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: -3000, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    pvAvailableWOverride: 3000,
    pvSessionActive: true,
    now: new Date('2026-08-23T12:00:00Z'),
  });
  assert.equal(continuing.allowed, true);
  assert.equal(continuing.source, 'pv');
  assert.equal(continuing.pvTariffStopGridImportW, 1000);
  assert.equal(continuing.pvTariffStopDelaySeconds, 60);
}

// v0.3.85: avoid-grid-import disables standard EV grid charging for that TOU
// rate, while PV-only charging remains independently available.
{
  const settings = baseSettings({
    peakShaveEnabled: false,
    evGuaranteeTarget: true,
    touRates: [
      { id: 'piek', name: 'Piek', importPrice: 0.40, avoidGridImport: true, evChargeAllowed: true, evPvChargeAllowed: true, evPvMinSurplusW: 0 },
    ],
    touSchedule: [
      { rateId: 'piek', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const tariff = { kind: 'tou', rateId: 'piek', className: 'normal', label: 'Piek' };
  const noPv = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0, gridPowerW: 0,
    currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    now: new Date('2026-08-24T12:00:00+02:00'), tariff,
  });
  assert.equal(noPv.allowed, false);
  assert.equal(noPv.avoidGridImportTariff, true);
  assert.notEqual(noPv.source, 'tariff');
  assert.notEqual(noPv.source, 'guarantee');

  const pv = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0, gridPowerW: -2000,
    currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    now: new Date('2026-08-24T12:00:00+02:00'), tariff,
  });
  assert.equal(pv.allowed, true);
  assert.equal(pv.source, 'pv');
}

// v0.6.1: an energy deadline works without vehicle SoC and accelerates within
// selected tariffs even when expensive/unselected tariff override is disabled.
{
  const now = new Date('2026-09-09T01:00:00+02:00');
  const settings = baseSettings({
    peakShaveEnabled: false,
    evSocEnabled: false,
    evEnergyPlanActive: true,
    evEnergyNeedKwh: 12,
    evEnergyDeadlineAt: now.getTime() + (2 * 3600000),
    evAllowUnselectedTariffForDeadline: false,
  });
  const d = calculateEvDecision({
    settings, connected: true, actualCurrentA: 0, gridPowerW: 0,
    currentBatteryCommandW: 0, nextBatteryCommandW: 0, now,
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
  });
  assert.equal(d.planningType, 'energy');
  assert.equal(d.energyNeedKwh, 12);
  assert.ok(d.desiredCurrentA > 16, 'deadline should raise current above standard current inside selected tariff');
  assert.equal(d.targetReachable, true);
}

// v0.6.1: outside selected tariffs the default is warning-only; the explicit
// opt-in may use the more expensive tariff when the deadline is otherwise lost.
{
  const now = new Date('2026-09-09T12:00:00+02:00');
  const common = {
    peakShaveEnabled: false,
    evSocEnabled: false,
    evEnergyPlanActive: true,
    evEnergyNeedKwh: 7,
    evEnergyDeadlineAt: now.getTime() + 3600000,
  };
  const tariff = { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' };
  const warningOnly = calculateEvDecision({ settings: baseSettings({ ...common, evAllowUnselectedTariffForDeadline: false }), connected: true, actualCurrentA: 0, gridPowerW: 0, currentBatteryCommandW: 0, nextBatteryCommandW: 0, now, tariff });
  assert.equal(warningOnly.allowed, false);
  assert.equal(warningOnly.targetReachableOnSelectedTariffs, false);
  assert.match(warningOnly.targetWarning, /niet haalbaar binnen geselecteerde tarieven/);

  const override = calculateEvDecision({ settings: baseSettings({ ...common, evAllowUnselectedTariffForDeadline: true }), connected: true, actualCurrentA: 0, gridPowerW: 0, currentBatteryCommandW: 0, nextBatteryCommandW: 0, now, tariff });
  assert.equal(override.allowed, true);
  assert.equal(override.source, 'guarantee');
  assert.equal(override.desiredCurrentA, 32);
}

// v0.6.1: PV charging uses per-EV start/stop hysteresis and selectable grid top-up.
{
  const tariff = { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' };
  const common = {
    peakShaveEnabled: false,
    evGuaranteeTarget: false,
    evPvStartSurplusW: 1500,
    evPvStopSurplusW: 800,
    evPvStopDelaySeconds: 60,
    touRates: [{ id: 'normal', name: 'Normal', importPrice: 0.3, evChargeAllowed: false, evPvChargeAllowed: true, evPvGridTopUpAllowed: true, evPvMinSurplusW: 0 }],
  };
  const off = calculateEvDecision({ settings: baseSettings({ ...common, evPvGridTopUpMode: 'off' }), connected: true, soc: 50, actualCurrentA: 0, gridPowerW: -1500, currentBatteryCommandW: 0, nextBatteryCommandW: 0, tariff, pvAvailableWOverride: 1500, now: new Date('2026-09-09T12:00:00+02:00') });
  assert.equal(off.desiredCurrentA, 6);
  assert.equal(off.source, 'pv');
  assert.equal(off.pvTariffStopSurplusW, 800);
  assert.equal(off.pvTariffStopDelaySeconds, 60);

  const full = calculateEvDecision({ settings: baseSettings({ ...common, evPvGridTopUpMode: 'full' }), connected: true, soc: 50, actualCurrentA: 0, gridPowerW: -1500, currentBatteryCommandW: 0, nextBatteryCommandW: 0, tariff, pvAvailableWOverride: 1500, now: new Date('2026-09-09T12:00:00+02:00') });
  assert.equal(full.desiredCurrentA, 16);
  assert.equal(full.source, 'pv+topup');
  assert.ok(full.gridRequestPowerW > 0);
}

// v0.6.1: SoC-target mode obeys the same per-EV tariff policy as Smart mode.
// Outside a selected tariff it waits unless PV or an explicit guaranteed
// deadline provides a valid charging reason.
{
  const now = new Date('2026-09-09T12:00:00+02:00');
  const tariff = { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' };
  const common = {
    evMode: 'soc_target',
    peakShaveEnabled: false,
    evTargetSoc: 80,
    evTargetTime: '13:00',
    evGuaranteeTarget: true,
  };

  const tariffOnly = calculateEvDecision({
    settings: baseSettings({ ...common, evAllowUnselectedTariffForDeadline: false }),
    connected: true, soc: 20, actualCurrentA: 0, gridPowerW: 0,
    currentBatteryCommandW: 0, nextBatteryCommandW: 0, now, tariff,
  });
  assert.equal(tariffOnly.allowed, false);
  assert.equal(tariffOnly.source, 'off');
  assert.match(tariffOnly.reason, /SoC-doel wacht/);

  const guaranteed = calculateEvDecision({
    settings: baseSettings({ ...common, evAllowUnselectedTariffForDeadline: true }),
    connected: true, soc: 20, actualCurrentA: 0, gridPowerW: 0,
    currentBatteryCommandW: 0, nextBatteryCommandW: 0, now, tariff,
  });
  assert.equal(guaranteed.allowed, true);
  assert.equal(guaranteed.source, 'guarantee');
}

// v0.6.1: SoC-target mode still uses PV outside selected grid tariffs when the
// current tariff explicitly permits PV charging.
{
  const settings = baseSettings({
    evMode: 'soc_target', evGuaranteeTarget: false, peakShaveEnabled: false,
    touRates: [{ id: 'normal', name: 'Normal', importPrice: 0.3, evChargeAllowed: false, evPvChargeAllowed: true, evPvMinSurplusW: 1000 }],
  });
  const d = calculateEvDecision({
    settings, connected: true, soc: 20, actualCurrentA: 0, gridPowerW: -1800,
    currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    pvAvailableWOverride: 1800,
    now: new Date('2026-09-09T12:00:00+02:00'),
  });
  assert.equal(d.allowed, true);
  assert.equal(d.source, 'pv');
  assert.ok(d.desiredCurrentA >= 6);
}

// v0.6.1: mode-only chargers use explicit Smart/Standard current estimates.
{
  const settings = baseSettings({
    evControlType: 'mode',
    evModeSmartCurrentA: 7,
    evModeStandardCurrentA: 16,
    peakShaveEnabled: false,
    evGuaranteeTarget: false,
  });
  const pv = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: -4000, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    now: new Date('2026-08-23T12:00:00Z'),
  });
  assert.equal(pv.source, 'pv');
  assert.equal(pv.desiredCurrentA, 7);
  assert.equal(pv.requestedCurrentA, 7);

  const tariff = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: 0, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
    now: new Date('2026-08-24T00:30:00+02:00'),
  });
  assert.equal(tariff.source, 'tariff');
  assert.equal(tariff.desiredCurrentA, 16);
  assert.equal(tariff.requestedCurrentA, 16);
}

// v0.6.1: mode-only Peak Guard falls back Standard -> Smart -> Stop.
// HomeFlux cannot continuously clamp a mode-only charger, but it can select
// the lower configured Smart mode whenever that discrete step still fits.
{
  const settings = baseSettings({
    evControlType: 'mode',
    evModeSmartCurrentA: 6,
    evModeStandardCurrentA: 16,
    evGuaranteeTarget: false,
    peakShaveEnabled: true,
    peakLimitW: 3200,
    peakSoftMarginW: 100,
  });
  const d = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: 0, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
    now: new Date('2026-08-24T00:30:00+02:00'),
  });
  assert.equal(d.requestedCurrentA, 16);
  assert.equal(d.desiredCurrentA, 6);
  assert.equal(d.allowed, true);
  assert.equal(d.peakLimited, true);
  assert.equal(d.requestedChargeMode, 'standard');
  assert.equal(d.effectiveChargeMode, 'smart');
  assert.equal(d.modeFallback, 'smart');
  assert.match(d.reason, /Standaard \(16 A\).*Slim \(6 A\)/);
}

// If even Smart no longer fits, mode-only still stops.
{
  const settings = baseSettings({
    evControlType: 'mode',
    evModeSmartCurrentA: 7,
    evModeStandardCurrentA: 32,
    evGuaranteeTarget: false,
    peakShaveEnabled: true,
    peakLimitW: 1500,
    peakSoftMarginW: 100,
  });
  const d = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: 0, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
    now: new Date('2026-08-24T00:30:00+02:00'),
  });
  assert.equal(d.requestedCurrentA, 32);
  assert.equal(d.desiredCurrentA, 0);
  assert.equal(d.allowed, false);
  assert.equal(d.peakLimited, true);
  assert.equal(d.effectiveChargeMode, 'stop');
}

// v0.6.1: mode-only Emergency uses the estimated Standard mode current instead
// of pretending the hidden ampere-control maximum can be commanded.
{
  const settings = baseSettings({
    evControlType: 'mode',
    evMode: 'emergency',
    evModeSmartCurrentA: 5,
    evModeStandardCurrentA: 11,
    evMaxCurrentA: 32,
    peakShaveEnabled: false,
  });
  const d = calculateEvDecision({
    settings, connected: true, soc: NaN, actualCurrentA: 0, gridPowerW: 0,
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    now: new Date('2026-08-23T12:00:00Z'),
  });
  assert.equal(d.desiredCurrentA, 11);
  assert.equal(d.requestedCurrentA, 11);
}

// v0.6.2 audit: a configured zero-second PV stop delay means immediate stop;
// it must not silently fall back to the historical 60-second default.
{
  const settings = baseSettings({
    evGuaranteeTarget: false,
    peakShaveEnabled: false,
    evPvStartSurplusW: 1500,
    evPvStopSurplusW: 800,
    evPvStopDelaySeconds: 0,
  });
  const d = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: -2000, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    now: new Date('2026-08-23T12:00:00Z'),
  });
  assert.equal(d.pvTariffStopDelaySeconds, 0);
}

// v0.6.2 audit: imported/inverted PV hysteresis may not create a stop threshold
// above the start threshold. Runtime normalisation must remain stable.
{
  const settings = baseSettings({
    evGuaranteeTarget: false,
    peakShaveEnabled: false,
    evPvStartSurplusW: 1000,
    evPvStopSurplusW: 2000,
  });
  const d = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: -2500, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'normal', className: 'normal', label: 'Normal' },
    now: new Date('2026-08-23T12:00:00Z'),
  });
  assert.ok(d.pvTariffStopSurplusW <= d.pvTariffMinSurplusW);
}

// v0.6.2 audit: Smart is the lower-power mode-only fallback. If imported
// settings invert Smart and Standard, HomeFlux must never underestimate Smart;
// Standard is conservatively treated as at least the Smart estimate.
{
  const settings = baseSettings({
    evControlType: 'mode',
    evModeSmartCurrentA: 20,
    evModeStandardCurrentA: 7,
    evGuaranteeTarget: false,
    peakShaveEnabled: false,
  });
  const d = calculateEvDecision({
    settings, connected: true, soc: 50, actualCurrentA: 0,
    gridPowerW: 0, currentBatteryCommandW: 0, nextBatteryCommandW: 0,
    tariff: { kind: 'tou', rateId: 'cheap', className: 'cheap', label: 'Cheap' },
    now: new Date('2026-08-24T00:30:00+02:00'),
  });
  assert.equal(d.requestedCurrentA, 20);
}
