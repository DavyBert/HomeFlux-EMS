'use strict';

const assert = require('node:assert/strict');
const { evaluate, distributeCommand, buildSocPlan } = require('../lib/ems-engine');

function baseSettings(overrides = {}) {
  return {
    batteryCount: 4,
    totalCapacityKwh: 20,
    minSoc: 10,
    maxSoc: 100,
    maxTotalChargeW: 8000,
    maxTotalDischargeW: 8000,
    maxChargePerBatteryW: 2400,
    maxDischargePerBatteryW: 2400,
    balanceEnabled: true,
    balanceDeadbandPct: 1,
    balanceStrength: 0.2,
    peakShaveEnabled: true,
    peakLimitW: 2500,
    peakSoftMarginW: 100,
    contractType: 'fixed',
    fixedChargeWindowStart: '01:00',
    fixedChargeWindowEnd: '07:00',
    expectedEnergyNeedKwh: 20,
    forcedMode: 'solar_capture',
    // Keep generic regression cases mathematically exact; profile-specific tests
    // below verify the v0.2.27 0.65 / 0.85 / 1.00 gains separately.
    controlProfile: 'exact',
    gridZeroMinW: -5,
    gridZeroMaxW: 5,
    timezone: 'Europe/Brussels',
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    gridPowerW: 0,
    pvPowerW: 0,
    forecastRemainingKwh: 20,
    batterySoc: [50, 50, 50, 50],
    lastTotalCommandW: 0,
    ...overrides,
  };
}

// Solar capture absorbs export and does not discharge for ordinary import.
{
  const result = evaluate(state({ gridPowerW: -800 }), baseSettings(), new Date('2026-08-22T12:00:00+02:00'));
  assert.equal(result.baseMode, 'solar_capture');
  assert.equal(result.totalCommandW, -800);
}

// Tiny meter noise remains raw telemetry but is not presented as an active charge action.
{
  const result = evaluate(state({ gridPowerW: -4 }), baseSettings(), new Date('2026-08-22T02:27:00+02:00'));
  assert.equal(result.totalCommandW, 0);
  assert.equal(result.pvChargeW, 0);
  assert.equal(result.action, 'idle');
  assert.equal(result.actionLabel, 'Rust');
}

{
  const result = evaluate(state({ gridPowerW: 1200 }), baseSettings(), new Date('2026-08-22T12:00:00+02:00'));
  assert.equal(result.totalCommandW, 0);
}


// Asymmetric grid zero band: inside the band hold the last setpoint; when a
// correction is needed, aim for the midpoint. -5..+25 W => target +10 W.
{
  const settings = baseSettings({
    forcedMode: 'self_consumption',
    peakShaveEnabled: false,
    controlProfile: 'exact',
    gridZeroMinW: -5,
    gridZeroMaxW: 25,
  });
  assert.equal(evaluate(state({ gridPowerW: -5, lastTotalCommandW: 1000 }), settings, new Date('2026-08-22T12:00:00+02:00')).totalCommandW, 1000);
  assert.equal(evaluate(state({ gridPowerW: 25, lastTotalCommandW: 1000 }), settings, new Date('2026-08-22T12:00:00+02:00')).totalCommandW, 1000);
  assert.ok(Math.abs(evaluate(state({ gridPowerW: 50, lastTotalCommandW: 1000 }), settings, new Date('2026-08-22T12:00:00+02:00')).totalCommandW - 1040) <= 4);
  assert.ok(Math.abs(evaluate(state({ gridPowerW: -20, lastTotalCommandW: 1000 }), settings, new Date('2026-08-22T12:00:00+02:00')).totalCommandW - 970) <= 4);
}

// Typical positive hold band: 5..25 W => target +15 W when regulation resumes.
{
  const settings = baseSettings({
    forcedMode: 'self_consumption',
    peakShaveEnabled: false,
    controlProfile: 'exact',
    gridZeroMinW: 5,
    gridZeroMaxW: 25,
  });
  assert.equal(evaluate(state({ gridPowerW: 24, lastTotalCommandW: 1000 }), settings, new Date('2026-08-22T12:00:00+02:00')).totalCommandW, 1000);
  assert.ok(Math.abs(evaluate(state({ gridPowerW: 35, lastTotalCommandW: 1000 }), settings, new Date('2026-08-22T12:00:00+02:00')).totalCommandW - 1020) <= 4);
  assert.ok(Math.abs(evaluate(state({ gridPowerW: -5, lastTotalCommandW: 1000 }), settings, new Date('2026-08-22T12:00:00+02:00')).totalCommandW - 980) <= 4);
}

// Peak guard overrides solar capture when import approaches/exceeds the configured limit.
{
  const result = evaluate(state({ gridPowerW: 3100 }), baseSettings(), new Date('2026-08-22T12:00:00+02:00'));
  assert.equal(result.override, 'peak_shave');
  assert.equal(result.totalCommandW, 700); // target is 2400 W because of 100 W soft margin.
}

// v0.3.80: a forced charge override requests the full configured EMS charge
// capacity, ignores the legacy manualChargeW value, and is then safely reduced
// by Peak Guard when necessary.
{
  const result = evaluate(
    state({ gridPowerW: 2900, lastTotalCommandW: -1000 }),
    baseSettings({ forcedMode: 'manual_charge', manualChargeW: 100 }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(result.plannedChargeW, 8000);
  assert.equal(result.override, 'peak_shave');
  assert.equal(result.predictedGridW, 2400);
  assert.ok(result.totalCommandW > -1000, 'Peak Guard should reduce charging before asking for discharge');
}


// v0.3.80: forced charging ignores the old manual watt limit but still obeys total and per-battery EMS limits.
{
  const result = evaluate(
    state(),
    baseSettings({ forcedMode: 'manual_charge', manualChargeW: 100, maxTotalChargeW: 7500, peakShaveEnabled: false }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(result.totalCommandW, -7500);
  assert.ok(result.commands.every(value => Math.abs(value) <= 2400));
}

// Battery balance keeps the same total command but favors low SoC while charging.
{
  const commands = distributeCommand(-4000, state({ batterySoc: [40, 50, 60, 50] }), baseSettings());
  assert.ok(Math.abs(commands.reduce((a, b) => a + b, 0) + 4000) <= 4);
  assert.ok(Math.abs(commands[0]) > Math.abs(commands[2]));
}

// Automatic TOU: cheapest tariff + low forecast creates a charging plan.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    expectedEnergyNeedKwh: 20,
    touRates: [
      { id: 'superdal', name: 'Superdal', importPrice: 0.15, feedInPrice: 0.03 },
      { id: 'dal', name: 'Dal', importPrice: 0.25, feedInPrice: 0.03 },
      { id: 'piek', name: 'Piek', importPrice: 0.40, feedInPrice: 0.03 },
    ],
    touSchedule: [
      { rateId: 'superdal', start: '01:00', end: '07:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'dal', start: '07:00', end: '17:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '17:00', end: '01:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const result = evaluate(
    state({ gridPowerW: 500, forecastRemainingKwh: 2, batterySoc: [25, 25, 25, 25], nightPlanningActive: true }),
    settings,
    new Date('2026-08-22T02:00:00+02:00'),
  );
  assert.equal(result.baseMode, 'charge');
  assert.ok(result.plannedChargeW > 0);
  assert.ok(result.totalCommandW < 0);
  assert.equal(result.tariff.label, 'Superdal');
}

// Dynamic quarter-hour planning marks the cheapest slots as charge periods.
{
  const dynamicSlots = [];
  for (let i = 0; i < 96; i += 1) {
    const h = String(Math.floor(i / 4)).padStart(2, '0');
    const m = String((i % 4) * 15).padStart(2, '0');
    dynamicSlots.push({ time: `${h}:${m}`, price: i >= 4 && i < 16 ? 0.05 : 0.30 + (i / 1000) });
  }
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'dynamic',
    cheapHours: 3,
    expensiveHours: 3,
    dynamicSlots,
    expectedEnergyNeedKwh: 20,
  });
  const result = evaluate(
    state({ forecastRemainingKwh: 0, batterySoc: [20, 20, 20, 20] }),
    settings,
    new Date('2026-08-22T02:00:00+02:00'),
  );
  assert.equal(result.tariff.className, 'cheap');
  assert.equal(result.baseMode, 'charge');
}


// TOU day markers: weekdays can use peak while the exact same hours are off-peak in the weekend.
{
  const touRates = [
    { id: 'superdal', name: 'Superdal', importPrice: 0.10, feedInPrice: 0.03 },
    { id: 'dal', name: 'Dal', importPrice: 0.20, feedInPrice: 0.03 },
    { id: 'piek', name: 'Piek', importPrice: 0.40, feedInPrice: 0.03 },
  ];
  const touSchedule = [
    { rateId: 'superdal', start: '01:00', end: '07:00', days: [1,2,3,4,5,6,7] },
    { rateId: 'piek', start: '07:00', end: '11:00', days: [1,2,3,4,5] },
    { rateId: 'dal', start: '07:00', end: '11:00', days: [6,7] },
    { rateId: 'dal', start: '11:00', end: '17:00', days: [1,2,3,4,5,6,7] },
    { rateId: 'piek', start: '17:00', end: '22:00', days: [1,2,3,4,5] },
    { rateId: 'dal', start: '17:00', end: '22:00', days: [6,7] },
    { rateId: 'dal', start: '22:00', end: '01:00', days: [1,2,3,4,5,6,7] },
  ];
  const settings = baseSettings({ forcedMode: 'auto', contractType: 'tou', touRates, touSchedule });

  const mondayMorning = evaluate(state(), settings, new Date('2026-08-24T08:00:00+02:00'));
  assert.equal(mondayMorning.tariff.label, 'Piek');
  assert.equal(mondayMorning.tariff.className, 'expensive');

  const saturdayMorning = evaluate(state(), settings, new Date('2026-08-22T08:00:00+02:00'));
  assert.equal(saturdayMorning.tariff.label, 'Dal');
  assert.equal(saturdayMorning.tariff.className, 'normal');

  const sundayEvening = evaluate(state(), settings, new Date('2026-08-23T18:00:00+02:00'));
  assert.equal(sundayEvening.tariff.label, 'Dal');

  const fridayLate = evaluate(state(), settings, new Date('2026-08-28T23:30:00+02:00'));
  assert.equal(fridayLate.tariff.label, 'Dal');

  const mondayAtTen = evaluate(state(), settings, new Date('2026-08-24T10:00:00+02:00'));
  assert.equal(mondayAtTen.nextEventLabel, 'Dal');
  assert.ok(mondayAtTen.nextEventText.includes('1u'));
}


// Dynamic hourly planning also respects the configured number of cheapest hours.
{
  const dynamicSlots = Array.from({ length: 24 }, (_, hour) => ({
    time: `${String(hour).padStart(2, '0')}:00`,
    price: hour >= 1 && hour < 4 ? 0.08 : 0.30 + (hour / 1000),
  }));
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'dynamic',
    dynamicPriceSource: 'manual',
    cheapHours: 3,
    expensiveHours: 3,
    dynamicSlots,
    expectedEnergyNeedKwh: 20,
  });
  const result = evaluate(
    state({ forecastRemainingKwh: 0, batterySoc: [20, 20, 20, 20] }),
    settings,
    new Date('2026-08-22T02:10:00+02:00'),
  );
  assert.equal(result.tariff.intervalMinutes, 60);
  assert.equal(result.tariff.className, 'cheap');
  assert.ok(result.tariff.selectedChargeMinutes >= 60);
  assert.equal(result.baseMode, 'charge');
}


// Dynamic normal-price behavior can optionally use a larger battery for self-consumption.
{
  const dynamicSlots = Array.from({ length: 24 }, (_, hour) => ({
    time: `${String(hour).padStart(2, '0')}:00`,
    price: hour < 3 ? 0.10 : hour >= 18 && hour < 21 ? 0.50 : 0.30,
  }));
  const common = baseSettings({
    forcedMode: 'auto',
    contractType: 'dynamic_hour',
    cheapHours: 3,
    expensiveHours: 3,
    dynamicSlots,
    expectedEnergyNeedKwh: 0,
  });
  const saved = evaluate(state({ gridPowerW: 1200, batterySoc: [70,70,70,70] }), {
    ...common,
    dynamicUseBatteryNormalHours: false,
  }, new Date('2026-08-22T12:00:00+02:00'));
  assert.equal(saved.tariff.className, 'normal');
  assert.equal(saved.baseMode, 'solar_capture');
  assert.equal(saved.totalCommandW, 0);

  const used = evaluate(state({ gridPowerW: 1200, batterySoc: [70,70,70,70] }), {
    ...common,
    dynamicUseBatteryNormalHours: true,
  }, new Date('2026-08-22T12:00:00+02:00'));
  assert.equal(used.baseMode, 'self_consumption');
  assert.equal(used.totalCommandW, 1200);
}

// Dynamic next-event status changes only when the price class changes, not every price tick.
{
  const slots = Array.from({ length: 96 }, (_, i) => ({
    time: `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
    price: i >= 4 && i < 16 ? 0.05 + (i / 100000) : i >= 72 && i < 84 ? 0.60 + (i / 100000) : 0.30 + (i / 100000),
  }));
  const result = evaluate(state({ batterySoc: [80,80,80,80], forecastRemainingKwh: 20 }), baseSettings({
    forcedMode: 'auto', contractType: 'dynamic_quarter', cheapHours: 3, expensiveHours: 3, dynamicSlots: slots,
  }), new Date('2026-08-22T02:10:00+02:00'));
  assert.equal(result.tariff.className, 'cheap');
  assert.ok(result.nextEventText.startsWith('Normaal '), result.nextEventText);
  assert.ok(result.nextEventText.includes('1u') || result.nextEventText.includes('2u'), result.nextEventText);
}


// Battery-save may discharge down to the user-selected save floor.
{
  const above = evaluate(
    state({ gridPowerW: 900, batterySoc: [80,80,80,80] }),
    baseSettings({ forcedMode: 'solar_capture', batterySaveDischargeAboveSoc: 70 }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(above.baseMode, 'solar_capture');
  assert.equal(above.totalCommandW, 900);
  assert.equal(above.batterySaveFloorSoc, 70);

  const atFloor = evaluate(
    state({ gridPowerW: 900, batterySoc: [70,70,70,70] }),
    baseSettings({ forcedMode: 'solar_capture', batterySaveDischargeAboveSoc: 70 }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(atFloor.totalCommandW, 0);
}

// TOU falls back to real self-consumption when no charge/expensive strategy is active.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    expectedEnergyNeedKwh: 0,
    touRates: [
      { id: 'superdal', name: 'Superdal', importPrice: 0.15, feedInPrice: 0.03 },
      { id: 'dal', name: 'Dal', importPrice: 0.25, feedInPrice: 0.03 },
      { id: 'piek', name: 'Piek', importPrice: 0.40, feedInPrice: 0.03 },
    ],
    touSchedule: [
      { rateId: 'superdal', start: '01:00', end: '07:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'dal', start: '07:00', end: '17:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '17:00', end: '01:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const result = evaluate(
    state({ gridPowerW: 553, batterySoc: [70,70,70,70], forecastRemainingKwh: 20 }),
    settings,
    new Date('2026-08-22T02:00:00+02:00'),
  );
  assert.equal(result.baseMode, 'self_consumption');
  assert.ok(Math.abs(result.totalCommandW - 553) <= 2);
}

// Runtime estimates use configured capacity, save floor and current residual demand.
{
  const result = evaluate(
    state({ gridPowerW: 1000, batterySoc: [80,80,80,80], forecastRemainingKwh: 0 }),
    baseSettings({ forcedMode: 'solar_capture', totalCapacityKwh: 20, batterySaveDischargeAboveSoc: 60 }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(result.energyToSaveFloorKwh, 4);
  assert.equal(result.residualDemandW, 1000);
  assert.equal(result.dischargeHoursToSaveFloor, 4);
  assert.ok(result.chargeHoursToTarget >= 0);
}

// Missing dynamic price data always falls back to solar capture, even if normal-hour battery use is enabled.
{
  const result = evaluate(
    state({ gridPowerW: 1200, batterySoc: [70,70,70,70] }),
    baseSettings({
      forcedMode: 'auto',
      contractType: 'dynamic_quarter',
      dynamicSlots: [],
      dynamicPriceDataReady: false,
      dynamicUseBatteryNormalHours: true,
    }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(result.baseMode, 'solar_capture');
  assert.equal(result.totalCommandW, 0);
}

// v0.2.27: all control profiles avoid deliberate overshoot. PV delta must never boost the correction gain.
{
  const commonState = state({ gridPowerW: -1000, pvDeltaW: 500 });
  const quiet = evaluate(commonState, baseSettings({ controlProfile: 'quiet' }), new Date('2026-08-22T12:00:00+02:00'));
  const normal = evaluate(commonState, baseSettings({ controlProfile: 'normal' }), new Date('2026-08-22T12:00:00+02:00'));
  const exact = evaluate(commonState, baseSettings({ controlProfile: 'exact' }), new Date('2026-08-22T12:00:00+02:00'));
  const legacyAggressive = evaluate(commonState, baseSettings({ controlProfile: 'aggressive' }), new Date('2026-08-22T12:00:00+02:00'));
  assert.ok(Math.abs(quiet.totalCommandW) < Math.abs(normal.totalCommandW));
  assert.ok(Math.abs(normal.totalCommandW) < Math.abs(exact.totalCommandW));
  assert.equal(quiet.responseGain, 0.65);
  assert.equal(normal.responseGain, 0.85);
  assert.equal(exact.responseGain, 1.00);
  assert.equal(legacyAggressive.responseGain, 1.00);
}

// v0.2.5: measured grid export must be captured in every ACTIVE mode.
{
  const now = new Date('2026-08-22T12:00:00+02:00');
  const modes = ['solar_capture', 'self_consumption', 'avoid_import', 'charge', 'manual_charge'];
  for (const forcedMode of modes) {
    const settings = baseSettings({
      forcedMode,
      peakShaveEnabled: false,
      manualChargeW: forcedMode === 'manual_charge' ? 300 : 1500,
      expectedEnergyNeedKwh: 20,
    });
    const result = evaluate(
      state({ gridPowerW: -1000, forecastRemainingKwh: 0, batterySoc: [50,50,50,50] }),
      settings,
      now,
    );
    assert.ok(result.totalCommandW <= -1000,
      `${forcedMode} must capture at least the measured 1000 W export, got ${result.totalCommandW} W`);
  }

  const standby = evaluate(
    state({ gridPowerW: -1000, batterySoc: [50,50,50,50] }),
    baseSettings({ forcedMode: 'standby', peakShaveEnabled: false }),
    now,
  );
  assert.equal(standby.totalCommandW, 0, 'Stand-by must remain a true 0 W output mode');
}


// Missing forecast must never trigger forecast-driven grid charging.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    forecastDataReady: false,
    expectedEnergyNeedKwh: 20,
    touRates: [
      { id: 'superdal', name: 'Superdal', importPrice: 0.15, feedInPrice: 0.03 },
      { id: 'dal', name: 'Dal', importPrice: 0.25, feedInPrice: 0.03 },
    ],
    touSchedule: [
      { rateId: 'superdal', start: '01:00', end: '07:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'dal', start: '07:00', end: '01:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const result = evaluate(
    state({ gridPowerW: 600, forecastRemainingKwh: 0, batterySoc: [50,50,50,50] }),
    settings,
    new Date('2026-08-22T02:00:00+02:00'),
  );
  assert.notEqual(result.baseMode, 'charge');
  assert.ok(result.totalCommandW >= 0, 'missing forecast must not create a grid-charge command');
}

// Missing SoC excludes only that battery from steering.
{
  const result = evaluate(
    state({ gridPowerW: 1200, batterySoc: [50, null, 50, 50] }),
    baseSettings({ forcedMode: 'self_consumption', peakShaveEnabled: false }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(result.commands[1], 0);
  assert.ok(result.commands[0] > 0 && result.commands[2] > 0 && result.commands[3] > 0);
  assert.equal(result.totalCommandW, 1200);
}


// v0.2.20: low full-day PV forecast can enable Battery Save per TOU price category.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    forecastDataReady: true,
    lowForecastSelfConsumptionMinKwh: 5,
    batterySaveDischargeAboveSoc: 100,
    expectedEnergyNeedKwh: 0,
    touRates: [
      { id: 'dal', name: 'Dal', importPrice: 0.25, feedInPrice: 0.03, lowForecastBatterySave: true },
      { id: 'piek', name: 'Piek', importPrice: 0.40, feedInPrice: 0.03, lowForecastBatterySave: false },
    ],
    touSchedule: [
      { rateId: 'dal', start: '00:00', end: '17:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '17:00', end: '00:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const low = evaluate(
    state({ gridPowerW: 900, forecastRemainingKwh: 1.0, forecastDailyMaxKwh: 4.9, batterySoc: [80,80,80,80] }),
    settings,
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(low.tariff.className, 'cheap');
  assert.equal(low.tariff.rateId, 'dal');
  assert.equal(low.tariff.lowForecastBatterySave, true);
  assert.equal(low.baseMode, 'solar_capture');
  assert.equal(low.lowForecastBatterySaveActive, true);
  assert.equal(low.totalCommandW, 0);

  const enough = evaluate(
    state({ gridPowerW: 900, forecastRemainingKwh: 1.0, forecastDailyMaxKwh: 5.0, batterySoc: [80,80,80,80] }),
    settings,
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(enough.baseMode, 'self_consumption');
  assert.equal(enough.lowForecastBatterySaveActive, false);
  assert.ok(Math.abs(enough.totalCommandW - 900) <= 4);
}

// v0.4.0: once the app promotes the current low-PV solar day to a sunny
// day, Battery Save is released without altering the forecast. The same latch
// may never suppress tomorrow's night-plan classification.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    forecastDataReady: true,
    forecastDailyDataReady: true,
    forecastTomorrowDataReady: true,
    lowForecastSelfConsumptionMinKwh: 5,
    batterySaveDischargeAboveSoc: 100,
    expectedEnergyNeedKwh: 0,
    touRates: [{ id: 'dal', name: 'Dal', importPrice: 0.25, feedInPrice: 0.03, lowForecastBatterySave: true }],
    touSchedule: [{ rateId: 'dal', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
  });
  const promoted = evaluate(
    state({ gridPowerW: 900, forecastDailyMaxKwh: 4, forecastTomorrowKwh: 3, batterySoc: [95,95,95,95], lowForecastSunnyOverrideActive: true }),
    settings,
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(promoted.lowForecastReferenceKwh, 4);
  assert.equal(promoted.lowForecastSunnyOverrideActive, true);
  assert.equal(promoted.lowForecastBatterySaveActive, false);
  assert.equal(promoted.baseMode, 'self_consumption');

  const tomorrow = evaluate(
    state({ gridPowerW: 900, planningForecastDay: 'tomorrow', nightPlanningActive: true, forecastDailyMaxKwh: 4, forecastTomorrowKwh: 3, batterySoc: [95,95,95,95], lowForecastSunnyOverrideActive: true }),
    settings,
    new Date('2026-08-22T21:00:00+02:00'),
  );
  assert.equal(tomorrow.lowForecastReferenceDay, 'tomorrow');
  assert.equal(tomorrow.lowForecastBatterySaveActive, true);
  assert.equal(tomorrow.lowForecastSunnyOverrideActive, false);
}

// v0.2.20: a single TOU category can independently enable low-forecast Battery Save.
{
  const result = evaluate(
    state({ gridPowerW: 450, forecastDailyMaxKwh: 2, batterySoc: [80,80,80,80] }),
    baseSettings({
      forcedMode: 'auto',
      contractType: 'tou',
      forecastDataReady: true,
      lowForecastSelfConsumptionMinKwh: 5,
      expectedEnergyNeedKwh: 0,
      touRates: [
        { id: 'enkel', name: 'Enkel tarief', importPrice: 0.30, feedInPrice: 0.03, lowForecastBatterySave: true },
      ],
      touSchedule: [
        { rateId: 'enkel', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] },
      ],
    }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(result.tariff.className, 'normal');
  assert.equal(result.tariff.rateId, 'enkel');
  assert.equal(result.baseMode, 'solar_capture');
  assert.equal(result.lowForecastBatterySaveActive, true);
}

// v0.2.20: every user-defined TOU category independently controls low-forecast Battery Save.
{
  const common = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    forecastDataReady: true,
    lowForecastSelfConsumptionMinKwh: 5,
    expectedEnergyNeedKwh: 0,
    touRates: [
      { id: 'laag', name: 'Laag', importPrice: 0.20, feedInPrice: 0.03, lowForecastBatterySave: false },
      { id: 'midden', name: 'Midden', importPrice: 0.30, feedInPrice: 0.03, lowForecastBatterySave: true },
      { id: 'hoog', name: 'Hoog', importPrice: 0.40, feedInPrice: 0.03, lowForecastBatterySave: false },
    ],
    touSchedule: [
      { rateId: 'laag', start: '00:00', end: '08:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'midden', start: '08:00', end: '16:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'hoog', start: '16:00', end: '00:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const lowCategory = evaluate(
    state({ gridPowerW: 600, forecastDailyMaxKwh: 2, batterySoc: [80,80,80,80] }),
    common,
    new Date('2026-08-22T06:00:00+02:00'),
  );
  assert.equal(lowCategory.tariff.rateId, 'laag');
  assert.equal(lowCategory.baseMode, 'self_consumption');

  const middleCategory = evaluate(
    state({ gridPowerW: 600, forecastDailyMaxKwh: 2, batterySoc: [80,80,80,80] }),
    common,
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(middleCategory.tariff.rateId, 'midden');
  assert.equal(middleCategory.tariff.className, 'normal');
  assert.equal(middleCategory.baseMode, 'solar_capture');
  assert.equal(middleCategory.lowForecastBatterySaveActive, true);

  const highCategory = evaluate(
    state({ gridPowerW: 600, forecastDailyMaxKwh: 2, batterySoc: [80,80,80,80] }),
    common,
    new Date('2026-08-22T18:00:00+02:00'),
  );
  assert.equal(highCategory.tariff.rateId, 'hoog');
  assert.equal(highCategory.baseMode, 'avoid_import');
  assert.equal(highCategory.lowForecastBatterySaveActive, false);
}

// v0.2.20: a high/expensive category can explicitly choose Battery Save too.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    forecastDataReady: true,
    lowForecastSelfConsumptionMinKwh: 5,
    expectedEnergyNeedKwh: 0,
    touRates: [
      { id: 'dal', name: 'Dal', importPrice: 0.25, feedInPrice: 0.03, lowForecastBatterySave: false },
      { id: 'piek', name: 'Piek', importPrice: 0.40, feedInPrice: 0.03, lowForecastBatterySave: true },
    ],
    touSchedule: [
      { rateId: 'dal', start: '00:00', end: '17:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '17:00', end: '00:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const result = evaluate(
    state({ gridPowerW: 900, forecastDailyMaxKwh: 1, batterySoc: [80,80,80,80] }),
    settings,
    new Date('2026-08-22T18:00:00+02:00'),
  );
  assert.equal(result.tariff.className, 'expensive');
  assert.equal(result.baseMode, 'solar_capture');
  assert.equal(result.lowForecastBatterySaveActive, true);
}

// v0.2.20: low-forecast Battery Save never blocks planned cheap-window charging.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'dynamic_hour',
    dynamicPriceDataReady: true,
    cheapHours: 1,
    expensiveHours: 1,
    forecastDataReady: true,
    lowForecastSelfConsumptionMinKwh: 10,
    lowForecastDynamicCheapEnabled: true,
    expectedEnergyNeedKwh: 20,
    dynamicSlots: [
      { time: '00:00', price: 0.10 },
      { time: '01:00', price: 0.20 },
      { time: '02:00', price: 0.30 },
      { time: '03:00', price: 0.50 },
    ],
  });
  const result = evaluate(
    state({ gridPowerW: 300, forecastRemainingKwh: 0, forecastDailyMaxKwh: 2, batterySoc: [20,20,20,20] }),
    settings,
    new Date('2026-08-22T00:15:00+02:00'),
  );
  assert.equal(result.tariff.className, 'cheap');
  assert.equal(result.tariff.lowForecastBatterySave, true);
  assert.equal(result.baseMode, 'charge');
  assert.equal(result.lowForecastBatterySaveActive, false);
  assert.ok(result.plannedChargeW > 0);
}

// v0.2.20: dynamic hourly/quarter-hour uses Low / Normal / High category flags.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'dynamic_hour',
    dynamicPriceDataReady: true,
    dynamicUseBatteryNormalHours: true,
    cheapHours: 1,
    expensiveHours: 1,
    forecastDataReady: true,
    lowForecastSelfConsumptionMinKwh: 5,
    lowForecastDynamicCheapEnabled: false,
    lowForecastDynamicNormalEnabled: true,
    lowForecastDynamicExpensiveEnabled: true,
    expectedEnergyNeedKwh: 0,
    dynamicSlots: [
      { time: '00:00', price: 0.10 },
      { time: '01:00', price: 0.20 },
      { time: '02:00', price: 0.30 },
      { time: '03:00', price: 0.50 },
    ],
  });
  const normal = evaluate(
    state({ gridPowerW: 500, forecastDailyMaxKwh: 2, batterySoc: [80,80,80,80] }),
    settings,
    new Date('2026-08-22T01:15:00+02:00'),
  );
  assert.equal(normal.tariff.className, 'normal');
  assert.equal(normal.baseMode, 'solar_capture');
  assert.equal(normal.lowForecastBatterySaveActive, true);

  const high = evaluate(
    state({ gridPowerW: 500, forecastDailyMaxKwh: 2, batterySoc: [80,80,80,80] }),
    settings,
    new Date('2026-08-22T03:15:00+02:00'),
  );
  assert.equal(high.tariff.className, 'expensive');
  assert.equal(high.baseMode, 'solar_capture');
  assert.equal(high.lowForecastBatterySaveActive, true);
}

// v0.2.20: quarter-hour dynamic prices use the same Low / Normal / High category policy.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'dynamic_quarter',
    dynamicPriceDataReady: true,
    dynamicUseBatteryNormalHours: true,
    cheapHours: 0.25,
    expensiveHours: 0.25,
    forecastDataReady: true,
    lowForecastSelfConsumptionMinKwh: 5,
    lowForecastDynamicCheapEnabled: false,
    lowForecastDynamicNormalEnabled: false,
    lowForecastDynamicExpensiveEnabled: true,
    expectedEnergyNeedKwh: 0,
    dynamicSlots: [
      { time: '12:00', price: 0.10 },
      { time: '12:15', price: 0.20 },
      { time: '12:30', price: 0.30 },
      { time: '12:45', price: 0.60 },
    ],
  });
  const result = evaluate(
    state({ gridPowerW: 500, forecastDailyMaxKwh: 2, batterySoc: [80,80,80,80] }),
    settings,
    new Date('2026-08-22T12:50:00+02:00'),
  );
  assert.equal(result.tariff.intervalMinutes, 15);
  assert.equal(result.tariff.className, 'expensive');
  assert.equal(result.baseMode, 'solar_capture');
  assert.equal(result.lowForecastBatterySaveActive, true);
}

// v0.2.18: a high forecast earlier in the day must not become 'low forecast' at sunset.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'fixed',
    forecastDataReady: true,
    lowForecastFixedEnabled: true,
    lowForecastSelfConsumptionMinKwh: 5,
    expectedEnergyNeedKwh: 0,
  });
  const result = evaluate(
    state({ gridPowerW: 900, forecastRemainingKwh: 0.4, forecastDailyMaxKwh: 40, batterySoc: [80,80,80,80] }),
    settings,
    new Date('2026-08-22T20:30:00+02:00'),
  );
  assert.equal(result.baseMode, 'self_consumption');
  assert.equal(result.lowForecastBatterySaveActive, false);
  assert.equal(result.forecastDailyMaxKwh, 40);
}

// v0.2.20: missing forecast never activates category-specific low-forecast Battery Save.
{
  const result = evaluate(
    state({ gridPowerW: 700, forecastRemainingKwh: 0, batterySoc: [80,80,80,80] }),
    baseSettings({
      forcedMode: 'auto',
      contractType: 'fixed',
      forecastDataReady: false,
      lowForecastFixedEnabled: true,
      lowForecastSelfConsumptionMinKwh: 5,
      expectedEnergyNeedKwh: 0,
    }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(result.baseMode, 'self_consumption');
  assert.equal(result.lowForecastBatterySaveActive, false);
}


// v0.3.11: a TOU tariff may keep Battery Save active while allowing only the
// reserve above the forecast target SoC to support normal self-consumption.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    safetySoc: 18,
    batterySaveDischargeAboveSoc: 100,
    lowForecastSelfConsumptionMinKwh: 10,
    expectedEnergyNeedKwh: 20,
    peakShaveEnabled: false,
    touRates: [
      { id: 'dal', name: 'Dal', importPrice: 0.20, feedInPrice: 0.03, lowForecastBatterySave: true, lowForecastDischargeToTarget: true },
      { id: 'piek', name: 'Piek', importPrice: 0.40, feedInPrice: 0.03, lowForecastBatterySave: true, lowForecastDischargeToTarget: false },
    ],
    touSchedule: [
      { rateId: 'piek', start: '17:00', end: '22:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'dal', start: '22:00', end: '01:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'dal', start: '01:00', end: '17:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const aboveTarget = evaluate(
    state({ gridPowerW: 1000, forecastRemainingKwh: 7.8, forecastDailyMaxKwh: 7.8, batterySoc: [84,84,84,84] }),
    settings,
    new Date('2026-08-24T22:30:00+02:00'),
  );
  assert.equal(aboveTarget.tariff.label, 'Dal');
  assert.equal(aboveTarget.baseMode, 'solar_capture');
  assert.equal(aboveTarget.lowForecastBatterySaveActive, true);
  assert.equal(aboveTarget.lowForecastDischargeToTargetActive, true);
  assert.ok(aboveTarget.targetSoc > 18 && aboveTarget.targetSoc < 84);
  assert.ok(aboveTarget.totalCommandW > 0, 'reserve above forecast target should be usable');
  assert.ok(Math.abs(aboveTarget.batterySaveFloorSoc - aboveTarget.targetSoc) <= 0.1);

  const atTarget = evaluate(
    state({ gridPowerW: 1000, forecastRemainingKwh: 7.8, forecastDailyMaxKwh: 7.8, batterySoc: [aboveTarget.targetSoc, aboveTarget.targetSoc, aboveTarget.targetSoc, aboveTarget.targetSoc] }),
    settings,
    new Date('2026-08-24T22:35:00+02:00'),
  );
  assert.equal(atTarget.lowForecastDischargeToTargetActive, false);
  assert.equal(atTarget.totalCommandW, 0, 'normal discharge must stop at the forecast target');
}

// v0.3.11: the same Battery Save tariff keeps the old full-save behaviour when
// its per-tariff forecast-target option is disabled.
{
  const settings = baseSettings({
    forcedMode: 'auto', contractType: 'tou', safetySoc: 18,
    batterySaveDischargeAboveSoc: 100, lowForecastSelfConsumptionMinKwh: 10,
    expectedEnergyNeedKwh: 20, peakShaveEnabled: false,
    touRates: [{ id: 'dal', name: 'Dal', importPrice: 0.20, feedInPrice: 0.03, lowForecastBatterySave: true, lowForecastDischargeToTarget: false }],
    touSchedule: [{ rateId: 'dal', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
  });
  const result = evaluate(
    state({ gridPowerW: 1000, forecastDailyMaxKwh: 7.8, batterySoc: [84,84,84,84] }),
    settings,
    new Date('2026-08-24T22:30:00+02:00'),
  );
  assert.equal(result.lowForecastBatterySaveActive, true);
  assert.equal(result.lowForecastDischargeToTargetActive, false);
  assert.equal(result.totalCommandW, 0);
}



// v0.3.88: selected months accept one absolute 0-100% minimum SoC instead of
// a coupled usable-reserve percentage. Minimum SoC no longer reduces what the
// user may enter: 100% remains a valid target even with Minimum SoC at 12%.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 0, forecastDailyMaxKwh: 0, batterySoc: [30,30,30,30] }),
    baseSettings({
      expectedEnergyNeedKwh: 0,
      peakReserveTargetSoc: 100,
      peakReserveMonth8: true,
      totalCapacityKwh: 21.6,
      minSoc: 12,
      safetySoc: 18,
      maxSoc: 100,
    }),
    new Date('2026-08-30T14:00:00+02:00'),
  );
  assert.equal(plan.peakReserveStrategy, 'selected_month_min_soc');
  assert.equal(plan.selectedMonthsMinSoc, 100);
  assert.equal(plan.peakReserveKwh, 19.01);
  assert.equal(plan.peakReservePercent, 88);
  assert.equal(plan.targetSoc, 100);
}

// v0.3.88 remains PV-first: an absolute 100% day minimum does not blindly
// force grid charging when remaining PV can still provide part of that target.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 10, forecastDailyMaxKwh: 10, batterySoc: [30,30,30,30] }),
    baseSettings({
      expectedEnergyNeedKwh: 0,
      peakReserveTargetSoc: 100,
      peakReserveMonth8: true,
      totalCapacityKwh: 20,
      minSoc: 10,
      safetySoc: 15,
      maxSoc: 100,
    }),
    new Date('2026-08-30T14:00:00+02:00'),
  );
  assert.equal(plan.selectedMonthsMinSoc, 100);
  assert.equal(plan.peakReservePvCreditKwh, 10);
  assert.equal(plan.peakReserveShortfallAfterPvKwh, 8);
  assert.equal(plan.peakReserveTargetSoc, 50);
}

console.log('HomeFlux EMS engine tests: OK');


// v0.2.15: normal control may use a 5 s grid value supplied by app.js; live grid remains available for Peak Guard.
{
  const result = evaluate(
    state({ gridPowerW: 1200, controlGridPowerW: 300, gridAverage5sW: 300 }),
    baseSettings({ forcedMode: 'self_consumption', peakShaveEnabled: false, controlProfile: 'normal' }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.ok(Math.abs(result.totalCommandW - 255) <= 4);
  assert.equal(result.gridControlErrorW, 300);
  assert.equal(result.liveGridPowerW, 1200);
}

// v0.2.15: PV delta itself never increases the gain or adds power to the correction.
{
  const noDelta = evaluate(
    state({ gridPowerW: -1000, controlGridPowerW: -1000, pvDeltaW: 0 }),
    baseSettings({ forcedMode: 'self_consumption', peakShaveEnabled: false, controlProfile: 'normal' }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  const largeDelta = evaluate(
    state({ gridPowerW: -1000, controlGridPowerW: -1000, pvDeltaW: 1500 }),
    baseSettings({ forcedMode: 'self_consumption', peakShaveEnabled: false, controlProfile: 'normal' }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(noDelta.totalCommandW, largeDelta.totalCommandW);
  assert.equal(largeDelta.responseGain, 0.85);
}

// v0.2.15: minimum and maximum SoC are hard per-battery limits.
{
  const discharge = distributeCommand(3600, state({ batterySoc: [10, 50, 50, 50] }), baseSettings({ minSoc: 10 }));
  assert.equal(discharge[0], 0);
  assert.ok(Math.abs(discharge.reduce((a, b) => a + b, 0) - 3600) <= 4);

  const charge = distributeCommand(-3600, state({ batterySoc: [100, 50, 50, 50] }), baseSettings({ maxSoc: 100 }));
  assert.equal(Math.abs(charge[0]), 0);
  assert.ok(Math.abs(charge.reduce((a, b) => a + b, 0) + 3600) <= 4);
}

// v0.2.15: Battery Save floor is per battery; Peak Guard may cross save floor but never min SoC.
{
  const saved = evaluate(
    state({ gridPowerW: 1200, controlGridPowerW: 1200, batterySoc: [60, 80, 80, 80] }),
    baseSettings({ forcedMode: 'solar_capture', batterySaveDischargeAboveSoc: 70, peakShaveEnabled: false }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(saved.commands[0], 0);
  assert.ok(saved.commands.slice(1).every(value => value > 0));

  const peak = evaluate(
    state({ gridPowerW: 3100, controlGridPowerW: 3100, batterySoc: [60, 60, 60, 60] }),
    baseSettings({ forcedMode: 'solar_capture', batterySaveDischargeAboveSoc: 70, peakShaveEnabled: true }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(peak.override, 'peak_shave');
  assert.equal(peak.totalCommandW, 700);

  const atMinimum = evaluate(
    state({ gridPowerW: 3100, controlGridPowerW: 3100, batterySoc: [10, 10, 10, 10] }),
    baseSettings({ forcedMode: 'solar_capture', batterySaveDischargeAboveSoc: 70, peakShaveEnabled: true, minSoc: 10 }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(atMinimum.totalCommandW, 0);
}

// Missing SoC (represented as null by app.js) removes that battery and its capacity from planning. Received SoC values never expire by age.
{
  const full = evaluate(
    state({ batterySoc: [20, 20, 20, 20], forecastRemainingKwh: 0 }),
    baseSettings({ forcedMode: 'auto', contractType: 'fixed', fixedChargeWindowStart: '01:00', fixedChargeWindowEnd: '07:00', expectedEnergyNeedKwh: 10 }),
    new Date('2026-08-22T02:00:00+02:00'),
  );
  const degraded = evaluate(
    state({ batterySoc: [20, 20, 20, null], forecastRemainingKwh: 0 }),
    baseSettings({ forcedMode: 'auto', contractType: 'fixed', fixedChargeWindowStart: '01:00', fixedChargeWindowEnd: '07:00', expectedEnergyNeedKwh: 10 }),
    new Date('2026-08-22T02:00:00+02:00'),
  );
  assert.equal(full.effectiveCapacityKwh, 20);
  assert.equal(degraded.effectiveCapacityKwh, 15);
  assert.equal(degraded.validBatteryCount, 3);
  assert.equal(Math.abs(degraded.commands[3]), 0);
}


// v0.2.21: ordinary battery charging from measured export is explicitly labelled as solar charging.
{
  const result = evaluate(
    state({ gridPowerW: -800, controlGridPowerW: -800, gridAverage5sW: -800, pvPowerW: 1500 }),
    baseSettings({ forcedMode: 'self_consumption', peakShaveEnabled: false }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(result.action, 'pv_charge');
  assert.equal(result.actionLabel, 'Laden uit zon 800 W');
}

// v0.2.21: planning exposes the SoC target at the end of the next configured cheap window.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 2, forecastDailyMaxKwh: 5, forecastTomorrowKwh: 2, planningForecastDay: 'tomorrow', nightPlanningActive: true, batterySoc: [25,25,25,25] }),
    baseSettings({
      forcedMode: 'auto',
      contractType: 'tou',
      forecastDataReady: true,
      forecastTomorrowDataReady: true,
      expectedEnergyNeedKwh: 20,
      touRates: [
        { id: 'cheap', name: 'Superdal', importPrice: 0.15, feedInPrice: 0.03 },
        { id: 'normal', name: 'Dal', importPrice: 0.25, feedInPrice: 0.03 },
        { id: 'high', name: 'Piek', importPrice: 0.40, feedInPrice: 0.03 },
      ],
      touSchedule: [
        { rateId: 'cheap', start: '01:00', end: '07:00', days: [1,2,3,4,5,6,7] },
        { rateId: 'normal', start: '07:00', end: '17:00', days: [1,2,3,4,5,6,7] },
        { rateId: 'high', start: '17:00', end: '01:00', days: [1,2,3,4,5,6,7] },
      ],
    }),
    new Date('2026-08-22T16:19:00+02:00'),
  );
  assert.equal(plan.currentSoc, 25);
  assert.equal(plan.targetSoc, 100);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].tariffLabel, 'Superdal');
  assert.equal(plan.rows[0].plannedNetCharge, true);
  assert.equal(plan.rows[0].socTarget, 100);
  assert.ok(plan.rows[0].plannedChargeW > 0);
}

// v0.2.21: dynamic planning never repeats today's prices into tomorrow.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 0, batterySoc: [20,20,20,20] }),
    baseSettings({
      forcedMode: 'auto',
      contractType: 'dynamic_hour',
      dynamicPriceDataReady: true,
      forecastDataReady: true,
      expectedEnergyNeedKwh: 20,
      cheapHours: 1,
      expensiveHours: 1,
      dynamicSlots: [
        { time: '00:00', price: 0.10 },
        { time: '01:00', price: 0.20 },
        { time: '02:00', price: 0.30 },
        { time: '03:00', price: 0.50 },
      ],
    }),
    new Date('2026-08-22T20:00:00+02:00'),
  );
  assert.equal(plan.scopeLabel, 'Dagplanning tot ingesteld dagdoel');
  assert.equal(plan.rows.length, 0);
  assert.equal(plan.nextNetChargeAt, null);
}


// v0.2.26: after the PV-end decision, tomorrow forecast determines the overnight reserve target.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 8, forecastDailyMaxKwh: 30, forecastTomorrowKwh: 18, planningForecastDay: 'tomorrow', batterySoc: [12,12,12,12] }),
    baseSettings({
      forcedMode: 'auto',
      forecastDataReady: true,
      forecastDailyDataReady: true,
      forecastTomorrowDataReady: true,
      expectedEnergyNeedKwh: 20,
      safetySoc: 15,
      chargeDeadline: '07:00',
    }),
    new Date('2026-08-22T17:00:00+02:00'),
  );
  assert.equal(plan.forecastDay, 'tomorrow');
  assert.equal(plan.forecastKwh, 18);
  assert.equal(plan.targetSoc, 20);
  assert.equal(plan.safetySoc, 15);
}

// v0.3.16: before PV ends, forward energy planning uses only today's remaining forecast.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 1, forecastDailyMaxKwh: 30, forecastTomorrowKwh: 2, batterySoc: [20,20,20,20] }),
    baseSettings({
      forcedMode: 'auto',
      forecastDataReady: true,
      forecastDailyDataReady: true,
      forecastTomorrowDataReady: true,
      expectedEnergyNeedKwh: 20,
      safetySoc: 15,
      chargeDeadline: '07:00',
    }),
    new Date('2026-08-22T17:00:00+02:00'),
  );
  assert.equal(plan.forecastDay, 'today');
  assert.equal(plan.forecastKwh, 1);
  assert.equal(plan.forecastUsedSource, 'today_remaining');
  assert.equal(plan.strategyForecastSource, 'today_full');
  assert.equal(plan.strategyForecastKwh, 30);
  assert.equal(plan.targetSoc, 100);
}


// v0.2.26: after midnight the same upcoming solar day is addressed as today.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 18, forecastDailyMaxKwh: 18, forecastTomorrowKwh: 5, planningForecastDay: 'today', batterySoc: [12,12,12,12] }),
    baseSettings({
      forcedMode: 'auto',
      forecastDataReady: true,
      forecastDailyDataReady: true,
      forecastTomorrowDataReady: true,
      expectedEnergyNeedKwh: 20,
      safetySoc: 15,
    }),
    new Date('2026-08-23T02:00:00+02:00'),
  );
  assert.equal(plan.forecastDay, 'today');
  assert.equal(plan.forecastKwh, 18);
  assert.equal(plan.targetSoc, 20);
}


// v0.3.14: planning exposes all forecast inputs and explicitly identifies the value used for decisions.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 4.2, forecastDailyMaxKwh: 12.5, forecastTomorrowKwh: 7.8, planningForecastDay: 'tomorrow', batterySoc: [84,84,84,84] }),
    baseSettings({ forecastDataReady: true, forecastDailyDataReady: true, forecastTomorrowDataReady: true, expectedEnergyNeedKwh: 20 }),
    new Date('2026-08-24T22:00:00+02:00'),
  );
  assert.equal(plan.forecastTodayFullKwh, 12.5);
  assert.equal(plan.forecastRemainingTodayKwh, 4.2);
  assert.equal(plan.forecastTomorrowKwh, 7.8);
  assert.equal(plan.forecastUsedSource, 'tomorrow');
  assert.equal(plan.forecastUsedKwh, 7.8);
}

// v0.3.16: during the solar day energy planning uses remaining-today while strategy uses the full-day forecast.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 1.1, forecastDailyMaxKwh: 16.4, forecastTomorrowKwh: 6.0, planningForecastDay: 'today', batterySoc: [50,50,50,50] }),
    baseSettings({ forecastDataReady: true, forecastDailyDataReady: true, forecastTomorrowDataReady: true, expectedEnergyNeedKwh: 20 }),
    new Date('2026-08-24T16:00:00+02:00'),
  );
  assert.equal(plan.forecastUsedSource, 'today_remaining');
  assert.equal(plan.forecastUsedKwh, 1.1);
  assert.equal(plan.strategyForecastSource, 'today_full');
  assert.equal(plan.strategyForecastKwh, 16.4);
}

// v0.2.22: Safety SoC is the normal discharge floor, while Peak Guard may still use reserve down to Minimum SoC.
{
  const normal = evaluate(
    state({ gridPowerW: 1200, controlGridPowerW: 1200, batterySoc: [20,20,20,20] }),
    baseSettings({ forcedMode: 'self_consumption', minSoc: 10, safetySoc: 20, peakShaveEnabled: false }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(normal.totalCommandW, 0);

  const peak = evaluate(
    state({ gridPowerW: 3100, controlGridPowerW: 3100, batterySoc: [20,20,20,20] }),
    baseSettings({ forcedMode: 'self_consumption', minSoc: 10, safetySoc: 20, peakShaveEnabled: true }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(peak.override, 'peak_shave');
  assert.ok(peak.totalCommandW > 0);
}


// v0.3.10: while real PV export exists, the battery leaves the configured
// export buffer only once the battery reached the PV-curtailment SoC threshold.
{
  const result = evaluate(
    state({ gridPowerW: -800, controlGridPowerW: -800, batterySoc: [96,96,96,96] }),
    baseSettings({
      forcedMode: 'self_consumption',
      peakShaveEnabled: false,
      exportLimitEnabled: true,
      minimumExportW: 50,
      pvCurtailMinBatterySoc: 95,
    }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.ok(result.totalCommandW >= -750 && result.totalCommandW <= -746);

  // Below the threshold HomeFlux must NOT deliberately hold the export buffer;
  // it returns to the normal zero-band target so the battery can absorb PV.
  const belowThreshold = evaluate(
    state({ gridPowerW: -800, controlGridPowerW: -800, batterySoc: [94,94,94,94] }),
    baseSettings({
      forcedMode: 'self_consumption',
      peakShaveEnabled: false,
      exportLimitEnabled: true,
      minimumExportW: 1000,
      pvCurtailMinBatterySoc: 95,
    }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.ok(belowThreshold.totalCommandW < -790 && belowThreshold.totalCommandW > -820);

  // It never creates export when the home is importing.
  const importing = evaluate(
    state({ gridPowerW: 500, controlGridPowerW: 500, batterySoc: [50,50,50,50] }),
    baseSettings({
      forcedMode: 'self_consumption',
      peakShaveEnabled: false,
      exportLimitEnabled: true,
      minimumExportW: 50,
    }),
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.ok(importing.totalCommandW >= 499 && importing.totalCommandW <= 501);
}

// v0.2.24: battery commands can be quantized for APIs such as LUNA.
{
  const settings = baseSettings({
    batteryCount: 1,
    totalCapacityKwh: 5,
    forcedMode: 'self_consumption',
    peakShaveEnabled: false,
    balanceEnabled: false,
    batteryCommandStepW: 100,
    maxChargePerBatteryW: 2300,
    maxDischargePerBatteryW: 2400,
  });
  const discharge = evaluate(
    state({ gridPowerW: 155, controlGridPowerW: 155, batterySoc: [50] }),
    settings,
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(discharge.totalCommandW, 100);
  assert.deepEqual(discharge.commands, [100]);

  const charge = evaluate(
    state({ gridPowerW: -155, controlGridPowerW: -155, batterySoc: [50] }),
    settings,
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(charge.totalCommandW, -100);
  assert.deepEqual(charge.commands, [-100]);

  const exactTen = evaluate(
    state({ gridPowerW: 154, controlGridPowerW: 154, batterySoc: [50] }),
    { ...settings, batteryCommandStepW: 10 },
    new Date('2026-08-22T12:00:00+02:00'),
  );
  assert.equal(exactTen.totalCommandW, 150);
}


// v0.2.28: after PV-end/night planning, low-forecast Battery Save must use tomorrow too.
{
  const common = baseSettings({
    forcedMode: 'auto',
    contractType: 'fixed',
    forecastDataReady: true,
    forecastDailyDataReady: true,
    forecastTomorrowDataReady: true,
    lowForecastFixedEnabled: true,
    lowForecastSelfConsumptionMinKwh: 10,
    expectedEnergyNeedKwh: 20,
    safetySoc: 18,
    peakShaveEnabled: false,
  });

  const tomorrowGood = evaluate(
    state({
      gridPowerW: 1000,
      controlGridPowerW: 1000,
      forecastDailyMaxKwh: 3,
      forecastTomorrowKwh: 20.3,
      planningForecastDay: 'tomorrow',
      nightPlanningActive: true,
      batterySoc: [86,86,86,86],
    }),
    common,
    new Date('2026-08-23T21:00:00+02:00'),
  );
  assert.equal(tomorrowGood.forecastPlanningDay, 'tomorrow');
  assert.equal(tomorrowGood.lowForecastReferenceDay, 'tomorrow');
  assert.equal(tomorrowGood.lowForecastReferenceKwh, 20.3);
  assert.equal(tomorrowGood.lowForecastBatterySaveActive, false);
  assert.equal(tomorrowGood.baseMode, 'self_consumption');

  const tomorrowPoor = evaluate(
    state({
      gridPowerW: 1000,
      controlGridPowerW: 1000,
      forecastDailyMaxKwh: 30,
      forecastTomorrowKwh: 4,
      planningForecastDay: 'tomorrow',
      batterySoc: [86,86,86,86],
    }),
    common,
    new Date('2026-08-23T21:00:00+02:00'),
  );
  assert.equal(tomorrowPoor.lowForecastReferenceKwh, 4);
  assert.equal(tomorrowPoor.lowForecastBatterySaveActive, true);
  assert.equal(tomorrowPoor.baseMode, 'solar_capture');

  const tomorrowMissing = evaluate(
    state({
      gridPowerW: 1000,
      controlGridPowerW: 1000,
      forecastDailyMaxKwh: 3,
      forecastTomorrowKwh: null,
      planningForecastDay: 'tomorrow',
      batterySoc: [86,86,86,86],
    }),
    { ...common, forecastTomorrowDataReady: false },
    new Date('2026-08-23T21:00:00+02:00'),
  );
  assert.equal(tomorrowMissing.lowForecastReferenceKwh, null);
  assert.equal(tomorrowMissing.lowForecastBatterySaveActive, false);
  assert.equal(tomorrowMissing.baseMode, 'self_consumption');
}



// v0.3.88: the same TOU rate can have a different planner role on weekdays
// and weekends. Weekday/weekend is based on the actual local day, including a
// tariff block that crosses midnight.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    peakShaveEnabled: false,
    expectedEnergyNeedKwh: 0,
    touRates: [
      { id: 'superdal', name: 'Superdal', importPrice: 0.10, weekdayChargeMode: 'night', weekendChargeMode: 'always', avoidGridImport: false },
      { id: 'dal', name: 'Dal', importPrice: 0.20, weekdayChargeMode: 'day', weekendChargeMode: 'night', avoidGridImport: false },
      { id: 'piek', name: 'Piek', importPrice: 0.40, weekdayChargeMode: 'never', weekendChargeMode: 'never', avoidGridImport: true },
    ],
    touSchedule: [
      { rateId: 'superdal', start: '01:00', end: '07:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'dal', start: '07:00', end: '17:00', days: [1,2,3,4,5] },
      { rateId: 'superdal', start: '07:00', end: '17:00', days: [6,7] },
      { rateId: 'piek', start: '17:00', end: '22:00', days: [1,2,3,4,5] },
      { rateId: 'dal', start: '17:00', end: '01:00', days: [1,2,3,4,5,6,7] },
    ],
  });

  const weekdayDay = evaluate(
    state({ batterySoc: [20,20,20,20], targetSocOverride: 80, nightPlanningActive: false }),
    settings,
    new Date('2026-08-28T14:00:00+02:00'), // Friday
  );
  assert.equal(weekdayDay.tariff.rateId, 'dal');
  assert.equal(weekdayDay.tariff.activeChargeMode, 'day');
  assert.equal(weekdayDay.tariff.dayChargeAllowed, true);
  assert.equal(weekdayDay.tariff.nightChargeAllowed, false);

  const weekendDay = evaluate(
    state({ batterySoc: [20,20,20,20], targetSocOverride: 80, nightPlanningActive: false }),
    settings,
    new Date('2026-08-29T14:00:00+02:00'), // Saturday
  );
  assert.equal(weekendDay.tariff.rateId, 'superdal');
  assert.equal(weekendDay.tariff.activeChargeMode, 'always');
  assert.equal(weekendDay.tariff.dayChargeAllowed, true);
  assert.equal(weekendDay.tariff.nightChargeAllowed, true);

  const saturdayAfterMidnightDayPlan = evaluate(
    state({ batterySoc: [20,20,20,20], targetSocOverride: 80, nightPlanningActive: false }),
    settings,
    new Date('2026-08-29T00:30:00+02:00'),
  );
  assert.equal(saturdayAfterMidnightDayPlan.tariff.rateId, 'dal');
  assert.equal(saturdayAfterMidnightDayPlan.tariff.activeChargeMode, 'night');
  assert.equal(saturdayAfterMidnightDayPlan.tariff.dayChargeAllowed, false);
  assert.equal(saturdayAfterMidnightDayPlan.tariff.nightChargeAllowed, true);

  const saturdayPlan = buildSocPlan(
    state({ batterySoc: [20,20,20,20], targetSocOverride: 80, nightPlanningActive: false }),
    settings,
    new Date('2026-08-29T14:00:00+02:00'),
  );
  const activeSaturdayWindows = saturdayPlan.rows.filter(row => row.windowState !== 'past');
  assert.ok(activeSaturdayWindows.some(row => row.tariffLabel === 'Superdal'), 'weekend day planner must use Superdal when configured always');
  assert.ok(!activeSaturdayWindows.some(row => row.tariffLabel === 'Dal'), 'weekend day planner must not use Dal when configured night-only');

  const fridayLate = evaluate(state(), settings, new Date('2026-08-28T23:30:00+02:00'));
  assert.equal(fridayLate.tariff.rateId, 'dal');
  assert.equal(fridayLate.tariff.activeChargeMode, 'day');
  assert.ok(fridayLate.tariff.nextAt instanceof Date);
  assert.equal(fridayLate.tariff.nextAt.getTime(), new Date('2026-08-29T00:00:00+02:00').getTime(), 'weekday/weekend policy change must become a tariff-context transition at midnight');
}

// v0.3.88: existing v0.3.85 booleans remain a supported fallback for old
// settings and test fixtures until migration has stored both new selectors.
{
  const settings = baseSettings({
    forcedMode: 'auto', contractType: 'tou', peakShaveEnabled: false,
    touRates: [
      { id: 'dal', name: 'Dal', importPrice: 0.10, nightChargeAllowed: false, dayChargeAllowed: true, avoidGridImport: false },
      { id: 'piek', name: 'Piek', importPrice: 0.40, nightChargeAllowed: false, dayChargeAllowed: false, avoidGridImport: true },
    ],
    touSchedule: [
      { rateId: 'dal', start: '00:00', end: '17:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '17:00', end: '00:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const result = evaluate(state({ targetSocOverride: 80, batterySoc: [20,20,20,20], nightPlanningActive: false }), settings, new Date('2026-08-29T12:00:00+02:00'));
  assert.equal(result.tariff.dayChargeAllowed, true);
  assert.equal(result.tariff.activeChargeMode, 'day');
}
console.log('HomeFlux EMS v0.2.28 planning tests: OK');

// v0.3.15: dynamic planning allocates forecast charging only to the configured cheapest known price slots.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 0, forecastDailyMaxKwh: 0, batterySoc: [20,20,20,20] }),
    baseSettings({
      forcedMode: 'auto',
      contractType: 'dynamic_hour',
      dynamicPriceDataReady: true,
      forecastDataReady: true,
      forecastDailyDataReady: true,
      expectedEnergyNeedKwh: 20,
      cheapHours: 1,
      expensiveHours: 1,
      dynamicSlots: [
        { time: '00:00', price: 0.30 },
        { time: '01:00', price: 0.10 },
        { time: '02:00', price: 0.50 },
        { time: '03:00', price: 0.20 },
      ],
    }),
    new Date('2026-08-22T00:30:00+02:00'),
  );
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].plannedNetCharge, true);
  assert.equal(plan.rows[0].price, 0.10);
  assert.ok(plan.rows[0].plannedChargeW > 0);
}


// v0.3.16: at 14:00, already-produced PV is represented by current SoC; only remaining PV reduces the forward energy need.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 4, forecastDailyMaxKwh: 15, batterySoc: [50,50,50,50] }),
    baseSettings({
      forcedMode: 'auto',
      forecastDataReady: true,
      forecastDailyDataReady: true,
      expectedEnergyNeedKwh: 20,
      safetySoc: 10,
      peakReserveKwh: 0,
    }),
    new Date('2026-08-25T14:00:00+02:00'),
  );
  assert.equal(plan.forecastUsedSource, 'today_remaining');
  assert.equal(plan.forecastUsedKwh, 4);
  assert.equal(plan.strategyForecastSource, 'today_full');
  assert.equal(plan.strategyForecastKwh, 15);
  assert.equal(plan.forecastEnergyGapKwh, 16);
  assert.equal(plan.targetSoc, 90);
  assert.equal(plan.energyNeedKwh, 8);
}

// v0.3.17: peak reserve is PV-first. If remaining PV can fully provide the
// configured reserve, it must not create a higher SoC target or grid charge.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 25, forecastDailyMaxKwh: 25, batterySoc: [30,30,30,30] }),
    baseSettings({
      forcedMode: 'auto',
      forecastDataReady: true,
      forecastDailyDataReady: true,
      expectedEnergyNeedKwh: 20,
      minSoc: 10,
      safetySoc: 15,
      totalCapacityKwh: 20,
      peakReserveKwh: 8,
      peakReservePercent: 40,
      peakReserveMonth8: true,
    }),
    new Date('2026-08-25T12:00:00+02:00'),
  );
  assert.equal(plan.forecastEnergyTargetSoc, 15);
  assert.equal(plan.peakReserveKwh, 8);
  assert.equal(plan.peakReservePercent, 40);
  assert.equal(plan.peakReservePvCreditKwh, 8);
  assert.equal(plan.peakReserveShortfallAfterPvKwh, 0);
  assert.equal(plan.peakReserveTargetSoc, 15);
  assert.equal(plan.targetSoc, 15);
  assert.equal(plan.energyNeedKwh, 0);
}

// v0.3.80: in a non-selected sunny month, the optional minimum SoC is
// PV-first. With a 20 kWh battery, min SoC 10%, sunny minimum 50% and 2 kWh
// remaining PV, only 6 of the 8 kWh reserve remains protected: target 40%.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 2, forecastDailyMaxKwh: 12, batterySoc: [20,20,20,20] }),
    baseSettings({
      forcedMode: 'auto',
      forecastDataReady: true,
      forecastDailyDataReady: true,
      expectedEnergyNeedKwh: 0,
      minSoc: 10,
      safetySoc: 15,
      totalCapacityKwh: 20,
      peakReserveKwh: 8,
      peakReservePercent: 40,
      peakReserveMonth8: false,
      sunnyMonthsMinSocEnabled: true,
      sunnyMonthsMinSoc: 50,
    }),
    new Date('2026-08-25T12:00:00+02:00'),
  );
  assert.equal(plan.peakReserveStrategy, 'sunny_month_min_soc');
  assert.equal(plan.sunnyMonthsMinSocActive, true);
  assert.equal(plan.peakReserveStrategyKwh, 8);
  assert.equal(plan.peakReservePvCreditKwh, 2);
  assert.equal(plan.peakReserveShortfallAfterPvKwh, 6);
  assert.equal(plan.peakReserveTargetSoc, 40);
  assert.equal(plan.targetSoc, 40);
}

// v0.3.80: a selected month always keeps the original kWh strategy, even when
// the sunny-month minimum is also enabled globally.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 2, forecastDailyMaxKwh: 12, batterySoc: [20,20,20,20] }),
    baseSettings({
      forcedMode: 'auto', forecastDataReady: true, forecastDailyDataReady: true,
      expectedEnergyNeedKwh: 0, minSoc: 10, safetySoc: 15, totalCapacityKwh: 20,
      peakReserveKwh: 8, peakReservePercent: 40, peakReserveMonth8: true,
      sunnyMonthsMinSocEnabled: true, sunnyMonthsMinSoc: 60,
    }),
    new Date('2026-08-25T12:00:00+02:00'),
  );
  assert.equal(plan.peakReserveStrategy, 'selected_month_min_soc');
  assert.equal(plan.sunnyMonthsMinSocActive, false);
  assert.equal(plan.peakReserveTargetSoc, 40);
}

// v0.3.80: upgrades preserve prior behavior because the new sunny-month option
// defaults off. A non-selected month then has no extra daytime reserve.
{
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 2, forecastDailyMaxKwh: 12, batterySoc: [20,20,20,20] }),
    baseSettings({
      forcedMode: 'auto', forecastDataReady: true, forecastDailyDataReady: true,
      expectedEnergyNeedKwh: 0, minSoc: 10, safetySoc: 15, totalCapacityKwh: 20,
      peakReserveMonth8: false, sunnyMonthsMinSocEnabled: false, sunnyMonthsMinSoc: 50,
    }),
    new Date('2026-08-25T12:00:00+02:00'),
  );
  assert.equal(plan.peakReserveStrategy, 'none');
  assert.equal(plan.peakReserveActive, false);
  assert.equal(plan.peakReserveInactiveReason, 'month_disabled');
  assert.equal(plan.targetSoc, 15);
}

// v0.3.80: the sunny-month minimum is a daytime layer only and can never run
// alongside night planning.
{
  const plan = buildSocPlan(
    state({
      nightPlanningActive: true,
      planningForecastDay: 'today',
      forecastRemainingKwh: 2,
      forecastDailyMaxKwh: 12,
      batterySoc: [20,20,20,20],
    }),
    baseSettings({
      forcedMode: 'auto', forecastDataReady: true, forecastDailyDataReady: true,
      expectedEnergyNeedKwh: 0, minSoc: 10, safetySoc: 15, totalCapacityKwh: 20,
      peakReserveMonth8: false, sunnyMonthsMinSocEnabled: true, sunnyMonthsMinSoc: 50,
    }),
    new Date('2026-08-25T05:00:00+02:00'),
  );
  assert.equal(plan.peakReserveStrategy, 'sunny_month_min_soc');
  assert.equal(plan.peakReserveActive, false);
  assert.equal(plan.sunnyMonthsMinSocActive, false);
  assert.equal(plan.peakReserveInactiveReason, 'night_planning');
  assert.equal(plan.targetSoc, 15);
}

// v0.3.17: exactly the intended PV-first case. At 16:00 a 70% battery with
// 8 kWh still expected from PV must not grid-charge merely because the desired
// peak reserve is 17 kWh. Remaining PV is subtracted from BOTH forward energy
// need and the peak-reserve fallback before a charge target is formed.
{
  const dynamicSlots = [];
  for (let m = 16 * 60; m < 18 * 60; m += 15) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    dynamicSlots.push({ time: `${hh}:${mm}`, price: 0.05 });
  }
  dynamicSlots.push({ time: '18:00', price: 0.60 });
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 8, forecastDailyMaxKwh: 15, batterySoc: [70,70,70,70] }),
    baseSettings({
      forcedMode: 'auto',
      contractType: 'dynamic_quarter',
      dynamicPriceDataReady: true,
      dynamicSlots,
      cheapHours: 2,
      forecastDataReady: true,
      forecastDailyDataReady: true,
      expectedEnergyNeedKwh: 20,
      totalCapacityKwh: 21.6,
      minSoc: 5,
      safetySoc: 10,
      peakReserveKwh: 17,
      peakReservePercent: 78.7,
      peakReserveMonth8: true,
    }),
    new Date('2026-08-25T16:00:00+02:00'),
  );
  assert.equal(plan.forecastUsedSource, 'today_remaining');
  assert.equal(plan.peakReservePvCreditKwh, 8);
  assert.equal(plan.peakReserveShortfallAfterPvKwh, 9);
  assert.ok(plan.targetSoc < 70, `target ${plan.targetSoc}% should remain below current 70% SoC`);
  assert.equal(plan.energyNeedKwh, 0);
  assert.equal(plan.nextNetChargeAt, null);
  assert.ok(plan.rows.every(row => row.plannedNetCharge === false));
}

// v0.3.17: at night there is no active sun, but tomorrow's PV is still future
// energy and therefore reduces the reserve that must be bought overnight. This
// prevents charging all the way to the peak target before sunrise when PV is
// expected to fill the remaining part during the next solar day.
{
  const plan = buildSocPlan(
    state({
      planningForecastDay: 'tomorrow',
      forecastRemainingKwh: 0,
      forecastDailyMaxKwh: 12,
      forecastTomorrowKwh: 8,
      batterySoc: [25,25,25,25],
    }),
    baseSettings({
      forcedMode: 'auto',
      contractType: 'fixed',
      forecastDataReady: true,
      forecastDailyDataReady: true,
      forecastTomorrowDataReady: true,
      expectedEnergyNeedKwh: 0,
      totalCapacityKwh: 20,
      minSoc: 10,
      safetySoc: 15,
      peakReserveKwh: 14,
      peakReservePercent: 70,
      fixedChargeWindowStart: '01:00',
      fixedChargeWindowEnd: '07:00',
    }),
    new Date('2026-08-26T02:00:00+02:00'),
  );
  assert.equal(plan.forecastUsedSource, 'tomorrow');
  assert.equal(plan.peakReserveActive, false);
  assert.equal(plan.peakReserveInactiveReason, 'night_planning');
  assert.equal(plan.peakReservePvCreditKwh, 0);
  assert.equal(plan.peakReserveShortfallAfterPvKwh, 0);
  assert.equal(plan.peakReserveTargetSoc, 15);
  assert.equal(plan.targetSoc, 15);
  assert.equal(plan.energyNeedKwh, 0);
}

// v0.3.17: after midnight the previous evening's tomorrow forecast is allowed
// as a full-day fallback until a fresh remaining-today value arrives. This keeps
// the PV credit stable before sunrise instead of suddenly demanding the full
// peak reserve simply because there is no active solar production yet.
{
  const plan = buildSocPlan(
    state({
      planningForecastDay: 'today',
      nightPlanningActive: true,
      forecastRemainingKwh: null,
      forecastDailyMaxKwh: 8,
      forecastTomorrowKwh: null,
      batterySoc: [25,25,25,25],
    }),
    baseSettings({
      forcedMode: 'auto',
      forecastDataReady: false,
      forecastDailyDataReady: true,
      forecastTomorrowDataReady: false,
      expectedEnergyNeedKwh: 0,
      totalCapacityKwh: 20,
      minSoc: 10,
      safetySoc: 15,
      peakReserveKwh: 14,
      peakReservePercent: 70,
    }),
    new Date('2026-08-26T05:30:00+02:00'),
  );
  assert.equal(plan.forecastUsedSource, 'today_full_fallback');
  assert.equal(plan.forecastUsedKwh, 8);
  assert.equal(plan.peakReserveActive, false);
  assert.equal(plan.peakReserveInactiveReason, 'night_planning');
  assert.equal(plan.peakReservePvCreditKwh, 0);
  assert.equal(plan.peakReserveShortfallAfterPvKwh, 0);
  assert.equal(plan.peakReserveTargetSoc, 15);
}

// v0.3.17: only the reserve shortfall AFTER remaining PV is protected outside
// expensive periods. Once the expensive period starts, that protected reserve
// becomes available for normal discharge.
{
  const common = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    forecastDataReady: true,
    forecastDailyDataReady: true,
    expectedEnergyNeedKwh: 0,
    peakReserveKwh: 8,
    peakReservePercent: 40,
    peakReserveMonth8: true,
    totalCapacityKwh: 20,
    minSoc: 10,
    safetySoc: 15,
    peakShaveEnabled: false,
    dynamicUseBatteryNormalHours: true,
    touRates: [
      { id: 'dal', name: 'Dal', importPrice: 0.20, feedInPrice: 0.03, lowForecastBatterySave: false },
      { id: 'piek', name: 'Piek', importPrice: 0.40, feedInPrice: 0.03, lowForecastBatterySave: false },
    ],
    touSchedule: [
      { rateId: 'dal', start: '00:00', end: '17:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '17:00', end: '00:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const beforePeak = evaluate(
    state({ gridPowerW: 1000, controlGridPowerW: 1000, forecastRemainingKwh: 3, forecastDailyMaxKwh: 20, batterySoc: [35,35,35,35] }),
    common,
    new Date('2026-08-25T15:00:00+02:00'),
  );
  assert.equal(beforePeak.peakReservePvCreditKwh, 3);
  assert.equal(beforePeak.peakReserveShortfallAfterPvKwh, 5);
  assert.equal(beforePeak.peakReserveTargetSoc, 35);
  assert.equal(beforePeak.peakReserveProtected, true);
  assert.equal(beforePeak.totalCommandW, 0);

  const inPeak = evaluate(
    state({ gridPowerW: 1000, controlGridPowerW: 1000, forecastRemainingKwh: 3, forecastDailyMaxKwh: 20, batterySoc: [35,35,35,35] }),
    common,
    new Date('2026-08-25T18:00:00+02:00'),
  );
  assert.equal(inPeak.peakReserveProtected, false);
  assert.ok(inPeak.totalCommandW > 0);
}

// v0.3.42: the daytime reserve is selectable per calendar month. August is
// off by default, while January is active by default.
{
  const summerPlan = buildSocPlan(
    state({ forecastRemainingKwh: 2, forecastDailyMaxKwh: 8, batterySoc: [30,30,30,30] }),
    baseSettings({ expectedEnergyNeedKwh: 0, peakReserveKwh: 8, totalCapacityKwh: 20, minSoc: 10, safetySoc: 15 }),
    new Date('2026-08-25T14:00:00+02:00'),
  );
  assert.equal(summerPlan.peakReserveActive, false);
  assert.equal(summerPlan.peakReserveInactiveReason, 'month_disabled');
  assert.equal(summerPlan.targetSoc, 15);

  const winterPlan = buildSocPlan(
    state({ forecastRemainingKwh: 2, forecastDailyMaxKwh: 8, batterySoc: [30,30,30,30] }),
    baseSettings({ expectedEnergyNeedKwh: 0, peakReserveKwh: 8, totalCapacityKwh: 20, minSoc: 10, safetySoc: 15 }),
    new Date('2026-01-25T14:00:00+01:00'),
  );
  assert.equal(winterPlan.peakReserveActive, true);
  assert.equal(winterPlan.peakReserveMonth, 1);
  assert.equal(winterPlan.peakReserveSeason, 'winter');
  assert.equal(winterPlan.peakReservePvCreditKwh, 2);
  assert.equal(winterPlan.peakReserveShortfallAfterPvKwh, 6);
  assert.equal(winterPlan.peakReserveTargetSoc, 40);

  const augustEnabled = buildSocPlan(
    state({ forecastRemainingKwh: 2, forecastDailyMaxKwh: 8, batterySoc: [30,30,30,30] }),
    baseSettings({ expectedEnergyNeedKwh: 0, peakReserveKwh: 8, totalCapacityKwh: 20, minSoc: 10, safetySoc: 15, peakReserveMonth8: true }),
    new Date('2026-08-25T14:00:00+02:00'),
  );
  assert.equal(augustEnabled.peakReserveActive, true);
  assert.equal(augustEnabled.peakReserveMonth, 8);
}

// v0.3.18: night planning remains authoritative. Expected energy can still
// trigger an overnight target, but the separate daytime peak reserve stays off.
{
  const plan = buildSocPlan(
    state({ planningForecastDay: 'tomorrow', nightPlanningActive: true, forecastTomorrowKwh: 5, batterySoc: [20,20,20,20] }),
    baseSettings({
      contractType: 'fixed',
      forecastTomorrowDataReady: true,
      expectedEnergyNeedKwh: 12,
      peakReserveKwh: 14,
      totalCapacityKwh: 20,
      minSoc: 10,
      safetySoc: 15,
      fixedChargeWindowStart: '01:00',
      fixedChargeWindowEnd: '07:00',
    }),
    new Date('2026-01-25T02:00:00+01:00'),
  );
  assert.equal(plan.peakReserveActive, false);
  assert.equal(plan.peakReserveInactiveReason, 'night_planning');
  assert.equal(plan.forecastEnergyGapKwh, 7);
  assert.equal(plan.forecastEnergyTargetSoc, 45);
  assert.equal(plan.targetSoc, 45);
  assert.ok(plan.energyNeedKwh > 0);
}

// v0.3.84: when explicitly enabled, the selected-month minimum also applies
// to night planning. Demand and reserve are added before tomorrow's PV is
// credited, so the forecast cannot be counted twice. This mirrors the reported
// 18% SoC / 13.43 kWh forecast case where a 100% peak minimum must drive the
// overnight target to 100% when forecast energy is insufficient.
{
  const plan = buildSocPlan(
    state({
      planningForecastDay: 'tomorrow',
      nightPlanningActive: true,
      forecastTomorrowKwh: 13.43,
      batterySoc: [18,18,18,18],
    }),
    baseSettings({
      contractType: 'fixed',
      forecastTomorrowDataReady: true,
      expectedEnergyNeedKwh: 18.71,
      peakReserveNightEnabled: true,
      peakReserveMonth8: true,
      peakReserveKwh: 19.44,
      totalCapacityKwh: 21.6,
      minSoc: 10,
      safetySoc: 18,
      maxSoc: 100,
      fixedChargeWindowStart: '01:00',
      fixedChargeWindowEnd: '07:00',
    }),
    new Date('2026-08-28T20:56:00+02:00'),
  );
  assert.equal(plan.peakReserveActive, true);
  assert.equal(plan.peakReserveNightEnabled, true);
  assert.equal(plan.peakReserveNightActive, true);
  assert.equal(plan.peakReserveStrategy, 'selected_month_min_soc');
  assert.equal(plan.peakReserveTargetSoc, 100);
  assert.equal(plan.peakReserveNightTargetSoc, 100);
  assert.equal(plan.targetSoc, 100);
  assert.ok(plan.peakReserveNightCombinedGapKwh > 19.44);
}

// v0.3.84: sufficient PV remains PV-first in night planning. Forecast energy
// first covers expected demand and only the surplus is credited to the reserve.
{
  const plan = buildSocPlan(
    state({
      planningForecastDay: 'tomorrow',
      nightPlanningActive: true,
      forecastTomorrowKwh: 20,
      batterySoc: [30,30,30,30],
    }),
    baseSettings({
      contractType: 'fixed',
      forecastTomorrowDataReady: true,
      expectedEnergyNeedKwh: 5,
      peakReserveNightEnabled: true,
      peakReserveMonth8: true,
      peakReserveKwh: 8,
      totalCapacityKwh: 20,
      minSoc: 10,
      safetySoc: 15,
      maxSoc: 100,
    }),
    new Date('2026-08-28T21:00:00+02:00'),
  );
  assert.equal(plan.peakReserveNightActive, true);
  assert.equal(plan.peakReservePvCreditKwh, 8);
  assert.equal(plan.peakReserveShortfallAfterPvKwh, 0);
  assert.equal(plan.peakReserveNightCombinedGapKwh, 0);
  assert.equal(plan.targetSoc, 15);
}

// v0.3.84: the non-selected sunny-month minimum uses the same optional night
// rule. A 100% sunny minimum can therefore become the overnight target too.
{
  const plan = buildSocPlan(
    state({
      planningForecastDay: 'tomorrow',
      nightPlanningActive: true,
      forecastTomorrowKwh: 6,
      batterySoc: [25,25,25,25],
    }),
    baseSettings({
      contractType: 'fixed',
      forecastTomorrowDataReady: true,
      expectedEnergyNeedKwh: 10,
      peakReserveNightEnabled: true,
      peakReserveMonth8: false,
      sunnyMonthsMinSocEnabled: true,
      sunnyMonthsMinSoc: 100,
      totalCapacityKwh: 20,
      minSoc: 10,
      safetySoc: 15,
      maxSoc: 100,
    }),
    new Date('2026-08-28T21:00:00+02:00'),
  );
  assert.equal(plan.peakReserveStrategy, 'sunny_month_min_soc');
  assert.equal(plan.sunnyMonthsMinSocActive, true);
  assert.equal(plan.peakReserveNightActive, true);
  assert.equal(plan.targetSoc, 100);
}

// v0.3.84: after PV end on the last day of a month, the night reserve uses
// the month of the target solar day rather than the calendar month of 'now'.
{
  const plan = buildSocPlan(
    state({
      planningForecastDay: 'tomorrow',
      nightPlanningActive: true,
      forecastTomorrowKwh: 0,
      batterySoc: [30,30,30,30],
    }),
    baseSettings({
      forecastTomorrowDataReady: true,
      expectedEnergyNeedKwh: 0,
      peakReserveNightEnabled: true,
      peakReserveMonth8: false,
      peakReserveMonth9: true,
      peakReserveKwh: 8,
      totalCapacityKwh: 20,
      minSoc: 10,
      safetySoc: 15,
    }),
    new Date('2026-08-31T21:00:00+02:00'),
  );
  assert.equal(plan.peakReserveMonth, 9);
  assert.equal(plan.peakReserveStrategy, 'selected_month_min_soc');
  assert.equal(plan.peakReserveNightActive, true);
}

// v0.3.17: low SoC before a two-hour cheap quarter-price block charges as much as safely possible in that block.
{
  const cheapSlots = [];
  for (let m = 15 * 60; m < 17 * 60; m += 15) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    cheapSlots.push({ time: `${hh}:${mm}`, price: 0.10 });
  }
  const plan = buildSocPlan(
    state({ forecastRemainingKwh: 0, forecastDailyMaxKwh: 12, batterySoc: [15,15,15,15] }),
    baseSettings({
      forcedMode: 'auto',
      contractType: 'dynamic_quarter',
      dynamicPriceDataReady: true,
      forecastDataReady: true,
      forecastDailyDataReady: true,
      expectedEnergyNeedKwh: 20,
      cheapHours: 2,
      maxTotalChargeW: 8000,
      dynamicSlots: [
        ...cheapSlots,
        { time: '17:00', price: 0.50 },
        { time: '17:15', price: 0.55 },
        { time: '17:30', price: 0.60 },
      ],
    }),
    new Date('2026-08-25T15:00:00+02:00'),
  );
  assert.equal(plan.targetSoc, 100);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].plannedNetCharge, true);
  assert.equal(plan.rows[0].plannedChargeW, 8000);
  assert.equal(plan.rows[0].plannedEnergyKwh, 16);
  assert.equal(plan.remainingUnplannedKwh, 1);
}

// v0.3.16: a low remaining forecast raises the energy target but does not by itself classify a good full solar day as low-PV Battery Save.
{
  const result = evaluate(
    state({ gridPowerW: 700, controlGridPowerW: 700, forecastRemainingKwh: 1, forecastDailyMaxKwh: 15, batterySoc: [80,80,80,80] }),
    baseSettings({
      forcedMode: 'auto',
      contractType: 'fixed',
      forecastDataReady: true,
      forecastDailyDataReady: true,
      lowForecastFixedEnabled: true,
      lowForecastSelfConsumptionMinKwh: 10,
      expectedEnergyNeedKwh: 20,
      safetySoc: 15,
      peakShaveEnabled: false,
    }),
    new Date('2026-08-25T15:00:00+02:00'),
  );
  assert.equal(result.forecastPlanningKwh, 1);
  assert.equal(result.lowForecastReferenceKwh, 15);
  assert.equal(result.lowForecastBatterySaveActive, false);
  assert.ok(result.targetSoc > 80);
}

// v0.4.2: night and day planning use separate configured target times. The
// night plan only bridges to the morning target; it must never include a cheap
// block from the following daytime period merely because the day target is 17:00.
{
  const cycleSettings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    forecastDataReady: true,
    forecastDailyDataReady: true,
    forecastTomorrowDataReady: true,
    nightTargetTime: '07:00',
    solarTargetTime: '17:00',
    touRates: [
      { id: 'superdal', name: 'Superdal', importPrice: 0.10, feedInPrice: 0.03, weekdayChargeMode: 'always', weekendChargeMode: 'always' },
      { id: 'dal', name: 'Dal', importPrice: 0.20, feedInPrice: 0.03, weekdayChargeMode: 'never', weekendChargeMode: 'never' },
      { id: 'piek', name: 'Piek', importPrice: 0.40, feedInPrice: 0.03, weekdayChargeMode: 'never', weekendChargeMode: 'never', avoidGridImport: true },
    ],
    touSchedule: [
      { rateId: 'superdal', start: '01:00', end: '07:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '07:00', end: '11:00', days: [1,2,3,4,5] },
      { rateId: 'dal', start: '07:00', end: '11:00', days: [6,7] },
      { rateId: 'superdal', start: '11:00', end: '17:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '17:00', end: '22:00', days: [1,2,3,4,5] },
      { rateId: 'dal', start: '17:00', end: '22:00', days: [6,7] },
      { rateId: 'dal', start: '22:00', end: '01:00', days: [1,2,3,4,5,6,7] },
    ],
  });

  // Friday afternoon, simulating the already selected night plan for Saturday:
  // only Saturday 01:00-07:00 belongs to that night phase. Saturday 11:00-17:00
  // must not be pulled into the overnight calculation.
  const now = new Date('2026-08-28T14:50:00+02:00');
  const nightPlan = buildSocPlan(
    state({
      planningForecastDay: 'tomorrow',
      nightPlanningActive: true,
      forecastTomorrowKwh: 10,
      targetSocOverride: 60,
      batterySoc: [20,20,20,20],
    }),
    cycleSettings,
    now,
  );
  assert.equal(nightPlan.planningPhase, 'night');
  assert.equal(nightPlan.rows.length, 1);
  assert.equal(nightPlan.rows[0].windowState, 'future');
  assert.equal(nightPlan.rows[0].endAt - nightPlan.rows[0].startAt, 6 * 60 * 60 * 1000);
  assert.equal(nightPlan.planningPeakEndAt, nightPlan.planningPeakStartAt);
  assert.equal(new Date(nightPlan.planningChargeDeadlineAt).toLocaleString('sv-SE', { timeZone: 'Europe/Brussels', hour12: false }).slice(0,16), '2026-08-29 07:00');

  // During the solar day, only the daytime phase (07:00 -> 17:00) is relevant.
  // At 14:50 the 11:00-17:00 Superdal block is active and has 130 minutes left.
  const dayState = state({
    planningForecastDay: 'today',
    nightPlanningActive: false,
    forecastRemainingKwh: 0,
    forecastDailyMaxKwh: 0,
    targetSocOverride: 100,
    batterySoc: [20,20,20,20],
    gridPowerW: 0,
    controlGridPowerW: 0,
  });
  const dayPlan = buildSocPlan(dayState, cycleSettings, now);
  assert.equal(dayPlan.planningPhase, 'day');
  assert.equal(dayPlan.rows.length, 1);
  assert.equal(dayPlan.rows[0].windowState, 'active');
  assert.equal(dayPlan.rows[0].availableMinutes, 130);
  assert.ok(dayPlan.rows[0].plannedChargeW > 7000);

  const production = evaluate(dayState, cycleSettings, now);
  assert.equal(production.baseMode, 'charge');
  assert.equal(production.tariff.selectedChargeMinutes, 130);
  assert.equal(production.plannedChargeW, dayPlan.rows[0].plannedChargeW);

  // Before the night phase begins, a cheap daytime tariff cannot accidentally
  // start charging for tomorrow's night plan.
  const beforeTomorrowCycle = evaluate(
    { ...dayState, planningForecastDay: 'tomorrow', nightPlanningActive: true },
    cycleSettings,
    now,
  );
  assert.equal(beforeTomorrowCycle.tariff.planningWindowEligibleNow, false);
  assert.equal(beforeTomorrowCycle.tariff.selectedChargeMinutes, 0);
  assert.notEqual(beforeTomorrowCycle.baseMode, 'charge');
}

// Regression for the exact Sunday-evening TOU case that motivated v0.4.2:
// Superdal 01:00-07:00 must be found even though Monday also has morning and
// evening peak blocks. The separate 17:00 day target is irrelevant at night.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    peakShaveEnabled: false,
    nightTargetTime: '07:00',
    solarTargetTime: '17:00',
    forecastTomorrowDataReady: true,
    touRates: [
      { id: 'superdal', name: 'SUPERDAL', importPrice: 0.10, feedInPrice: 0.03, weekdayChargeMode: 'always', weekendChargeMode: 'always' },
      { id: 'dal', name: 'DAL', importPrice: 0.20, feedInPrice: 0.03, weekdayChargeMode: 'never', weekendChargeMode: 'never' },
      { id: 'piek', name: 'PIEK', importPrice: 0.40, feedInPrice: 0.03, weekdayChargeMode: 'never', weekendChargeMode: 'never', avoidGridImport: true },
    ],
    touSchedule: [
      { rateId: 'superdal', start: '01:00', end: '07:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '07:00', end: '11:00', days: [1,2,3,4,5] },
      { rateId: 'dal', start: '11:00', end: '17:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '17:00', end: '22:00', days: [1,2,3,4,5] },
      { rateId: 'dal', start: '22:00', end: '01:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const plan = buildSocPlan(
    state({
      planningForecastDay: 'tomorrow',
      nightPlanningActive: true,
      forecastTomorrowKwh: 0,
      targetSocOverride: 80,
      batterySoc: [20,20,20,20],
    }),
    settings,
    new Date('2026-08-30T21:30:00+02:00'),
  );
  assert.equal(plan.planningPhase, 'night');
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].tariffLabel, 'SUPERDAL');
  assert.equal(plan.rows[0].availableMinutes, 360);
  assert.equal(new Date(plan.rows[0].startAt).toLocaleString('sv-SE', { timeZone: 'Europe/Brussels', hour12: false }).slice(0,16), '2026-08-31 01:00');
  assert.equal(new Date(plan.rows[0].endAt).toLocaleString('sv-SE', { timeZone: 'Europe/Brussels', hour12: false }).slice(0,16), '2026-08-31 07:00');
  assert.equal(new Date(plan.planningChargeDeadlineAt).toLocaleString('sv-SE', { timeZone: 'Europe/Brussels', hour12: false }).slice(0,16), '2026-08-31 07:00');
}

// v0.3.85: TOU day and night charging policies are independent. A normal-price
// Dal block may be selected by the day planner while Superdal is reserved for
// the night planner.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    peakShaveEnabled: false,
    expectedEnergyNeedKwh: 0,
    touRates: [
      { id: 'superdal', name: 'Superdal', importPrice: 0.10, feedInPrice: 0.03, nightChargeAllowed: true, dayChargeAllowed: false, avoidGridImport: false },
      { id: 'dal', name: 'Dal', importPrice: 0.20, feedInPrice: 0.03, nightChargeAllowed: false, dayChargeAllowed: true, avoidGridImport: false },
      { id: 'piek', name: 'Piek', importPrice: 0.40, feedInPrice: 0.03, nightChargeAllowed: false, dayChargeAllowed: false, avoidGridImport: true },
    ],
    touSchedule: [
      { rateId: 'superdal', start: '01:00', end: '07:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'dal', start: '07:00', end: '17:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '17:00', end: '22:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'dal', start: '22:00', end: '01:00', days: [1,2,3,4,5,6,7] },
    ],
  });

  const day = evaluate(
    state({ batterySoc: [20,20,20,20], targetSocOverride: 80, nightPlanningActive: false }),
    settings,
    new Date('2026-08-24T14:00:00+02:00'),
  );
  assert.equal(day.tariff.rateId, 'dal');
  assert.equal(day.tariff.dayChargeAllowed, true);
  assert.equal(day.baseMode, 'charge');
  assert.ok(day.plannedChargeW > 0);

  const sameHourNightPlan = evaluate(
    state({ batterySoc: [20,20,20,20], targetSocOverride: 80, nightPlanningActive: true, planningForecastDay: 'today' }),
    settings,
    new Date('2026-08-24T14:00:00+02:00'),
  );
  assert.equal(sameHourNightPlan.tariff.rateId, 'dal');
  assert.equal(sameHourNightPlan.tariff.nightChargeAllowed, false);
  assert.notEqual(sameHourNightPlan.baseMode, 'charge');

  const night = evaluate(
    state({ batterySoc: [20,20,20,20], targetSocOverride: 80, nightPlanningActive: true }),
    settings,
    new Date('2026-08-24T02:00:00+02:00'),
  );
  assert.equal(night.tariff.rateId, 'superdal');
  assert.equal(night.tariff.nightChargeAllowed, true);
  assert.equal(night.baseMode, 'charge');
}

// v0.3.85: explicit import avoidance is authoritative for any TOU rate, even a
// middle-price rate, and it wins over conflicting Battery Save flags.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    peakShaveEnabled: false,
    lowForecastSelfConsumptionMinKwh: 10,
    touRates: [
      { id: 'laag', name: 'Laag', importPrice: 0.10, nightChargeAllowed: true, dayChargeAllowed: true, avoidGridImport: false },
      { id: 'midden', name: 'Midden', importPrice: 0.20, nightChargeAllowed: false, dayChargeAllowed: false, avoidGridImport: true, lowForecastBatterySave: true, lowForecastDischargeToTarget: true },
      { id: 'hoog', name: 'Hoog', importPrice: 0.40, nightChargeAllowed: false, dayChargeAllowed: false, avoidGridImport: false },
    ],
    touSchedule: [
      { rateId: 'laag', start: '00:00', end: '08:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'midden', start: '08:00', end: '16:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'hoog', start: '16:00', end: '00:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const result = evaluate(
    state({ gridPowerW: 900, forecastDailyMaxKwh: 1, batterySoc: [80,80,80,80] }),
    settings,
    new Date('2026-08-24T12:00:00+02:00'),
  );
  assert.equal(result.tariff.rateId, 'midden');
  assert.equal(result.tariff.avoidGridImport, true);
  assert.equal(result.tariff.lowForecastBatterySave, false);
  assert.equal(result.tariff.lowForecastDischargeToTarget, false);
  assert.equal(result.baseMode, 'avoid_import');
  assert.ok(result.totalCommandW > 0);
}

// v0.3.85: explicit false on an expensive TOU rate disables the old implicit
// price-class import-avoidance rule.
{
  const settings = baseSettings({
    forcedMode: 'auto',
    contractType: 'tou',
    peakShaveEnabled: false,
    expectedEnergyNeedKwh: 0,
    touRates: [
      { id: 'laag', name: 'Laag', importPrice: 0.10, nightChargeAllowed: false, dayChargeAllowed: false, avoidGridImport: false },
      { id: 'hoog', name: 'Hoog', importPrice: 0.40, nightChargeAllowed: false, dayChargeAllowed: false, avoidGridImport: false },
    ],
    touSchedule: [
      { rateId: 'laag', start: '00:00', end: '12:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'hoog', start: '12:00', end: '00:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const result = evaluate(state({ gridPowerW: 500, batterySoc: [80,80,80,80] }), settings, new Date('2026-08-24T18:00:00+02:00'));
  assert.equal(result.tariff.className, 'expensive');
  assert.equal(result.tariff.avoidGridImport, false);
  assert.equal(result.baseMode, 'self_consumption');
}

// v0.3.85: TOU context changes at a rate boundary even when both rates have the
// same price, because their explicit EMS policies may differ.
{
  const settings = baseSettings({
    forcedMode: 'auto', contractType: 'tou', expectedEnergyNeedKwh: 0,
    touRates: [
      { id: 'a', name: 'A', importPrice: 0.20, nightChargeAllowed: false, dayChargeAllowed: false, avoidGridImport: false },
      { id: 'b', name: 'B', importPrice: 0.20, nightChargeAllowed: false, dayChargeAllowed: true, avoidGridImport: false },
    ],
    touSchedule: [
      { rateId: 'a', start: '00:00', end: '11:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'b', start: '11:00', end: '00:00', days: [1,2,3,4,5,6,7] },
    ],
  });
  const result = evaluate(state(), settings, new Date('2026-08-24T10:00:00+02:00'));
  assert.equal(result.tariff.rateId, 'a');
  assert.equal(result.nextEventLabel, 'B');
}
