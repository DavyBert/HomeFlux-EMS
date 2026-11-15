'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { boot, DEFAULTS } = require('./startup-harness');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const { localParts, localDateTimeUtcMs } = require('../lib/homey-energy');
const { findCurrentTariff } = require('../lib/ems-engine');
const NativeDate = Date, originalNow = Date.now;
let clock;
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
Date.now = () => clock;
const restore = installVirtualClearTimeout();
const ZONE = 'Europe/Brussels', H = 3600000;
const at = (day, time) => localDateTimeUtcMs(day, time, ZONE);
let groups = 0;

async function phaseBoundary(contractType, receivedPv, explicit, day = '2026-11-15') {
  const morning = at(day, '06:30');
  clock = morning - 1000; Date.now = () => clock;
  const settings = { ...DEFAULTS, contractType, timezone: ZONE, controlEnabled: false,
    nightTargetTime: '06:30', solarTargetTime: '17:00', sunChanceReserveEnabled: false };
  const { app, timers, errors } = await boot(new Map(Object.entries(settings)));
  Object.assign(app.state, { nightPlanningActive: explicit, nightPlanningStartedDate: explicit ? '2026-01-01' : '',
    pvSeenProducingToday: false, pvProducingDate: day, pvPowerW: 0 });
  app.inputSeen.pv = receivedPv;
  assert.equal(app.isNightPlanningPhase(clock), true);
  const context = app.getEvaluationState(settings, clock);
  assert.equal(context.nightPlanningActive, true);
  clock = morning;
  // This is the ordinary one-minute heartbeat: no PV or P1 input is required.
  app.runContextHeartbeat();
  const daytime = app.getEvaluationState(settings, clock);
  assert.equal(daytime.nightPlanningActive, false);
  assert.equal(daytime.planningForecastDay, 'today');
  assert.equal(app.state.nightPlanningActive, false);
  assert.equal(app.state.pvSeenProducingToday, false, 'clock fallback must not fabricate PV');
  assert.equal(app.nightForecastMedian, null);
  app.refreshControlContext(settings, daytime, clock);
  assert(!app.controlRuntimeSettings.batteryNightPlan, 'expired night window is removed');
  assert.equal(app.batteryNightPlanner, null);
  const timerCount = timers.length;
  for (let second = 0; second < 60; second++) app.getEvaluationState(settings, morning + second * 1000);
  assert.equal(timers.length, timerCount, 'day reads must not repeatedly schedule the transition');
  clock = at(day, '18:00');
  app.activateNightPlanning('observed_sunset', clock);
  assert.equal(app.isNightPlanningPhase(clock), true, 'today’s sunset still starts tomorrow’s night');
  assert.equal(app.getPlanningForecastDay(clock), 'tomorrow');
  assert.equal(app.resetExpiredNightPlanning(clock), false);
  assert.deepEqual(errors, []);
  groups++;
  console.log('PASS morning boundary', contractType, receivedPv ? '0 W PV' : 'no PV received', explicit ? 'observed night' : 'restart', day);
}

async function deferredChargeReplay(contractType, evening = false) {
  const start = at('2026-11-15', '00:00');
  const h = await setup(path.join(__dirname, '..'), {
    contractType, dynamicPriceSource: 'external', dynamicPriceSources: ['external'], controlEnabled: false,
    batteryCount: 1, totalCapacityKwh: 20, minSoc: 10, safetySoc: 14, maxSoc: 100,
    maxTotalChargeW: 2500, maxChargePerBatteryW: 2500, maxTotalDischargeW: 2000, maxDischargePerBatteryW: 2000,
    peakShaveEnabled: false, exportLimitEnabled: false, forcedMode: 'auto', expectedEnergyNeedKwh: 20,
    cheapHours: 6, expensiveHours: 8, peakReserveNightEnabled: false, sunChanceReserveEnabled: false,
  }, start + (evening ? 15 : 1) * H, 0);
  const a = h.app;
  h.store.set('_chargeTestSignature', a.getChargeTestSignature(a.getSettings()));
  await h.setExternalSetting('controlEnabled', true);
  Object.assign(a.state, { nightPlanningActive: !evening, nightPlanningStartedDate: evening ? '' : '2026-11-14',
    pvSeenProducingToday: evening, pvProducingDate: '2026-11-15', batterySoc: [20],
    forecastDailyMaxDate: '2026-11-15', forecastTomorrowDate: '2026-11-16' });
  a.inputSeen.forecast = true; a.inputSeen.forecastTomorrow = true;
  const step = contractType === 'dynamic_hour' ? H : H / 4;
  a.externalEnergy = { ...a.externalEnergy, slots: Array.from({ length: 48 * H / step }, (_, i) => {
    const t = start + i * step, l = localParts(new Date(t), ZONE), hr = (t - start) / H;
    const price = evening ? (hr >= 19 && hr < 25 ? .09 : hr >= 17 && hr < 19 ? .75 : hr < 17 ? .33 : .49)
      : hr >= 9 && hr < 15 ? .09 : hr >= 7 && hr < 9 ? .75 : hr < 7 ? .33 : .49;
    return { startMs: t, dateKey: l.dateKey, minute: l.minuteOfDay, price };
  }), curveUpdatedAt: h.now(), currentUpdatedAt: h.now(), currentPrice: .33 };
  a.externalEnergyResampleCache = null; a.invalidatePlanningCache(true);
  let started = false;
  async function tick(hour, soc, pv = 0) {
    h.setNow(start + hour * H); a.externalEnergy.currentUpdatedAt = h.now();
    await h.cards.get('set_battery_soc').listener({ battery: '1', soc });
    await h.pv(pv); await h.grid(300 - pv - a.state.lastTotalCommandW);
    a.runContextHeartbeat();
    if (!started) { await h.start(); started = true; }
    await h.flush();
    return a.latestResult;
  }
  await tick(evening ? 15 : 1, 20, evening ? 10 : 0);
  assert(a.controlRuntimeSettings.dynamicChargeDeferral?.active);
  assert(a.latestResult.planningChargeTargetSoc < 80);
  assert(a.latestResult.planningChargeTargetSoc >= a.controlRuntimeSettings.dynamicChargeDeferral.peakReserveSoc);
  if (!evening) {
    // Close the energy loop: feed the actual emitted command back into SoC
    // each minute through the expensive period and the later cheap block.
    // In the final cheap hour use five-second P1 updates, so publication latency
    // is represented at the controller's actual cadence rather than a minute.
    let soc = 20, highestSoc = 20, deliveredKwh = 0, cheapStarts = 0;
    let previousSecond = 3600;
    for (let second = 3660; second <= 15 * 3600; second += second >= 14 * 3600 ? 5 : 60) {
      const power = a.state.lastTotalCommandW;
      const hours = (second - previousSecond) / 3600;
      previousSecond = second;
      soc = Math.max(0, Math.min(100, soc - power / 1000 * hours / 20 * 100));
      highestSoc = Math.max(highestSoc, soc);
      if (second > 9 * 3600) deliveredKwh += Math.max(0, -power) / 1000 * hours;
      const r = await tick(second / 3600, soc);
      if (second >= 9 * 3600 && second < 15 * 3600 && a.state.lastTotalCommandW < 0) cheapStarts++;
      if (second === 7 * 3600) assert(!a.isNightPlanningPhase(h.now()));
      assert(r.inputReady && r.controlEnabled);
    }
    assert(cheapStarts > 0);
    // This replay models command delays and meter feedback, not a physical BMS.
    // Check delivery to within one percentage point; retain the exact result
    // in the output rather than claiming the hardware target is guaranteed.
    assert(soc >= 79, `deferred energy must be delivered to within one point of 80%, got ${soc.toFixed(2)}%`);
    assert(deliveredKwh > 10, 'the cheap period must deliver the postponed energy');
    assert.deepEqual(h.errors, []);
    groups++;
    console.log('PASS complete overnight/deferred energy replay', contractType, 'highest SOC', highestSoc.toFixed(2), 'final SOC', soc.toFixed(2));
    return;
  }
  if (evening) {
    await tick(17, 26, 10);
    await tick(18, 16, 0);
    // Let the existing sunset debounce complete before the later cheap period.
    await tick(18.2, 16, 0);
    assert(a.isNightPlanningPhase(h.now()));
  } else {
    await tick(7, 26);
    assert(!a.isNightPlanningPhase(h.now()));
    assert.equal(a.nightForecastMedian, null);
  }
  await tick(evening ? 19 : 9, 16);
  const r = await tick(evening ? 19.02 : 9.02, 16);
  assert.equal(r.tariff.className, 'cheap');
  assert(r.controlEnabled && r.inputReady);
  assert(r.plannedChargeW > 0);
  assert(a.state.lastTotalCommandW < 0, 'real battery output must start charging in the deferred cheap block');
  const recovery = await tick(evening ? 19.04 : 9.04, 12);
  assert(recovery.safetySocRecoveryActive);
  assert(recovery.plannedChargeW > 0);
  assert.deepEqual(h.errors, []);
  groups++;
  console.log('PASS deferred charge actually published', contractType, evening ? 'after evening target' : 'after morning target without PV');
}

(async () => {
  for (const contractType of ['dynamic_hour', 'dynamic_quarter']) {
    const step = contractType === 'dynamic_hour' ? 60 : 15;
    const dynamicSlots = Array.from({ length: 1440 / step }, (_, i) => {
      const minute = i * step;
      return { time: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
        price: minute >= 9 * 60 && minute < 15 * 60 ? .09 : .33 };
    });
    const settings = { ...DEFAULTS, contractType, timezone: ZONE, cheapHours: 6, expensiveHours: 8, dynamicSlots };
    for (const time of ['14:30', '14:59']) {
      const tariff = findCurrentTariff(new Date(at('2026-11-15', time)), settings);
      assert.equal(tariff.className, 'cheap');
      assert.equal(tariff.selectedChargeMinutes, time === '14:30' ? 30 : 1);
    }
    groups++;
    console.log('PASS current cheap slot remaining minutes', contractType);
  }
  for (const contract of ['fixed', 'tou', 'dynamic_hour', 'dynamic_quarter']) {
    for (const receivedPv of [false, true]) for (const explicit of [false, true]) await phaseBoundary(contract, receivedPv, explicit);
  }
  for (const day of ['2026-03-29', '2026-10-25']) await phaseBoundary('dynamic_quarter', false, true, day);
  for (const contract of ['dynamic_hour', 'dynamic_quarter']) {
    await deferredChargeReplay(contract);
    await deferredChargeReplay(contract, true);
  }
  console.log(`Morning/day planning 1.5.5: ${groups} groups passed`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; })
  .finally(() => { global.Date = NativeDate; Date.now = originalNow; restore(); });
