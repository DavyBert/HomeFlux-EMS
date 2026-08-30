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

// v0.3.8: SoC-target mode is unavailable when SoC support is disabled.
{
  const settings = baseSettings({ evSocEnabled: false, evMode: 'soc_target', peakShaveEnabled: false });
  const d = calculateEvDecision({ settings, connected: true, soc: NaN, actualCurrentA: 0, gridPowerW: 0, now: new Date('2026-08-23T12:00:00Z') });
  assert.equal(d.allowed, false);
  assert.match(d.reason, /SoC-doelmodus niet beschikbaar/);
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
