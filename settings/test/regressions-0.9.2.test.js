'use strict';
const assert = require('node:assert/strict');
const { evaluate, DEFAULTS } = require('../lib/ems-engine');
const { boot } = require('./startup-harness');
const now = new Date('2026-09-27T04:00:00Z');
const settings = {
  ...DEFAULTS, timezone: 'Europe/Brussels', batteryCount: 1, totalCapacityKwh: 20,
  minSoc: 10, safetySoc: 18, maxTotalChargeW: 6000, maxChargePerBatteryW: 6000,
  maxDischargePerBatteryW: 6000, maxTotalDischargeW: 6000, controlProfile: 'exact',
  peakShaveEnabled: false, contractType: 'fixed', fixedChargeWindowStart: '00:00', fixedChargeWindowEnd: '23:59',
};
const input = {
  batterySoc: [23.2], targetSocOverride: 23.2, gridPowerW: 400, pvPowerW: 0,
  lastTotalCommandW: 0, forecastRemainingKwh: 0, forecastTomorrowKwh: 0,
  nightPlanningActive: true, planningForecastDay: 'today',
};
let memory;
function tick(soc, changes = {}, config = settings, time = now) {
  const result = evaluate({ ...input, chargeRestartState: memory, batterySoc: [soc], ...changes }, config, time);
  memory = result.chargeRestartState;
  return result;
}
assert.equal(tick(22.5).baseMode, 'charge', 'Initial charge must still reach the plan');
tick(23.2);
for (const soc of [23, 22.94, 22.5, 21.21]) {
  const r = tick(soc);
  assert.notEqual(r.baseMode, 'charge', `Reached goal must not restart at ${soc}%`);
  assert(r.totalCommandW >= 0, 'No net charging while restart hold is active');
}
assert.equal(tick(21.2).baseMode, 'charge', 'Exactly two percentage points triggers restart');
assert.equal(tick(22.5).baseMode, 'charge', 'Restarted cycle keeps charging through the band');
assert.notEqual(tick(23).baseMode, 'charge', 'Original 0.25 point stop tolerance remains');
assert.notEqual(tick(22.5).baseMode, 'charge');
// Forecast changes smaller than the restart band and midnight must not erase it.
assert.notEqual(tick(22.5, { targetSocOverride: 23.3 }).baseMode, 'charge');
tick(23.2, { planningForecastDay: 'tomorrow' }, settings, new Date('2026-09-26T21:59:00Z'));
assert.notEqual(tick(22.5, { planningForecastDay: 'today' }, settings, new Date('2026-09-26T22:01:00Z')).baseMode, 'charge', 'Local midnight retains the nighttime hold');
assert.equal(tick(22.5, { nightPlanningActive: false }).chargeRestartState.planned.reached, false, 'New daytime plan releases restart hold');
tick(23.2);
assert.equal(tick(22.5, { targetSocOverride: 28 }).baseMode, 'charge', 'Materially higher plan is not blocked');
memory = undefined;
tick(23.2);
const held = structuredClone(memory);
const solar = tick(22.5, { gridPowerW: -2500 });
assert.equal(solar.totalCommandW, -2510, 'P1 PV capture bypasses restart hold');
assert.equal(solar.gridChargeAssistW, 10, 'Only zero-band bias, not planned grid charging');
// Safety recovery bypasses both hysteresis and tariff eligibility, not hard limits.
const outside = { ...settings, fixedChargeWindowStart: '12:00', fixedChargeWindowEnd: '13:00', safetySoc: 23 };
memory = held;
const recovery = tick(22.5, { plannedBatteryGridLimitW: 0 }, outside);
assert.equal(recovery.safetySocRecoveryActive, true);
assert(recovery.totalCommandW < 0);
assert.match(recovery.modeLabel, /Safety SoC/);
assert.equal(tick(23, {}, outside).safetySocRecoveryActive, false);
assert.notEqual(tick(23, {}, outside).baseMode, 'charge');
assert(tick(22.99, {}, outside).totalCommandW < 0, 'Small safety shortfall still produces a usable command');
const peak = tick(22.5, { gridPowerW: 2500 }, { ...outside, peakShaveEnabled: true, peakLimitW: 2500, peakSoftMarginW: 100 });
assert(peak.totalCommandW >= 0, 'Safety charging cannot exceed Peak Guard');
assert(tick(22.5, {}, { ...outside, maxChargePerBatteryW: 50, maxTotalChargeW: 50 }).totalCommandW >= -50);
assert.equal(tick(22.5, {}, { ...outside, forcedMode: 'standby' }).totalCommandW, 0);
const missingPrices = tick(22.5, {}, { ...outside, contractType: 'dynamic_hour', dynamicPriceDataReady: false });
assert.equal(missingPrices.safetySocRecoveryActive, true, 'Safety recovery does not wait for price availability');
// Normal-price ceiling gets its own reached-target memory.
const dynamic = { ...settings, contractType: 'dynamic_hour', dynamicNormalChargeEnabled: true, dynamicNormalChargeMaxSoc: 50, cheapHours: 1, expensiveHours: 1,
  dynamicSlots: Array.from({ length: 24 }, (_, h) => ({ time: `${String(h).padStart(2, '0')}:00`, price: h === 12 ? .05 : h === 18 ? .5 : .2 })) };
memory = undefined;
tick(50, { targetSocOverride: 80 }, dynamic);
assert.notEqual(tick(49.3, { targetSocOverride: 80 }, dynamic).baseMode, 'charge');
assert.equal(tick(48, { targetSocOverride: 80 }, dynamic).baseMode, 'charge');
assert.equal(tick(49.3, { targetSocOverride: 80 }, dynamic).baseMode, 'charge');
(async () => {
  const { app, store } = await boot();
  app.rememberBatteryChargeRestartState({ chargeRestartState: held, avgSoc: 23.2 });
  assert.deepEqual(store.get('_batteryChargeRestartState'), held);
  const original = JSON.stringify([...store]);
  app.rememberBatteryChargeRestartState({ chargeRestartState: held, avgSoc: 23.2 });
  assert.equal(JSON.stringify([...store]), original);
  const restarted = await boot(store);
  assert.deepEqual(restarted.app.state.chargeRestartState, held, 'Reached-target memory survives app restart');
  const result = evaluate({ ...input, batterySoc: [22.5], chargeRestartState: restarted.app.state.chargeRestartState }, settings, now);
  assert.notEqual(result.baseMode, 'charge');
  console.log('0.9.2: restart band, full recharge cycle, phase/target changes, PV, Safety recovery, limits, normal-price ceiling and persistence passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
