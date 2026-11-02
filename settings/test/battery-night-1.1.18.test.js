'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { fixture, ROOT } = require('./ev-work-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const { BatteryNightPlanner, nightPolicy } = require('../lib/battery-night-planner');
const { prepareEvPriceCurve } = require('../lib/ev-deadline-planner');
const { localParts, localDateTimeUtcMs } = require('../lib/homey-energy');
const { evaluate, buildSocPlan, DEFAULTS } = require('../lib/ems-engine');
const NativeDate = Date, originalNow = Date.now;
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
const restore = installVirtualClearTimeout(), ZONE = 'Europe/Brussels', Q = 900000, HOUR = 3600000;
const at = (day, time) => localDateTimeUtcMs(day, time, ZONE);
const counter = (a, k) => a.diagnostics?.counters?.[k] || 0;
function prices(kind = 'gerrit', interval = Q) {
  const rows = [];
  for (let t = at('2026-10-23', '00:00'); t < at('2026-10-26', '00:00'); t += interval) {
    const p = localParts(new Date(t), ZONE), m = p.minuteOfDay;
    const price = kind === 'continuous'
      ? (p.dateKey === '2026-10-23' && m >= 1380 || p.dateKey === '2026-10-24' && m < 180 ? .20 : .40)
      : p.dateKey === '2026-10-23' ? (m >= 1365 ? .30 : .45)
        : m < 420 ? .20 : m >= 720 && m < 795 ? .10 : .40;
    rows.push({ startMs: t, dateKey: p.dateKey, minute: m, price });
  }
  return rows;
}
async function setup({ root = ROOT, begin = at('2026-10-23', '18:00'), kind = 'gerrit', rows = prices(kind), evs = 0, extra = {} } = {}) {
  const h = await fixture({ root, type: 'current', evs, batteries: 1, extra: {
    contractType: 'dynamic_quarter', dynamicPriceSource: 'external', dynamicPriceSources: ['external'],
    totalCapacityKwh: 20, minSoc: 10, safetySoc: 14, maxSoc: 100,
    maxTotalChargeW: 2000, maxChargePerBatteryW: 2000, maxTotalDischargeW: 0, maxDischargePerBatteryW: 0,
    forcedMode: 'auto', peakShaveEnabled: false, expectedEnergyNeedKwh: 20,
    peakReserveNightEnabled: false, sunChanceReserveEnabled: false, sunnyMonthsMinSocEnabled: false,
    cheapHours: 1.25, expensiveHours: 3, dynamicNormalChargeEnabled: false, dynamicUseBatteryNormalHours: false,
    nightTargetTime: '07:00', solarTargetTime: '17:00', batteryCommandPauseEnabled: false,
    planningMinIntervalMinutes: 1, commandDeadbandW: 0, batteryCommandStepW: 1, ...extra,
  } });
  const a = h.app; h.setNow(begin);
  const day = a.getLocalDateKey(new Date(begin));
  Object.assign(a.state, { batterySoc: [40], targetSocOverride: null, lastTotalCommandW: 0,
    forecastRemainingKwh: null, forecastDailyMaxKwh: null, forecastDailyMaxDate: day,
    forecastTomorrowKwh: null, forecastTomorrowDate: '', nightPlanningActive: true,
    nightPlanningStartedDate: day === '2026-10-23' ? day : '2026-10-23',
    pvProducingDate: day, pvSeenProducingToday: false });
  a.inputSeen.forecast = false; a.inputSeen.forecastTomorrow = false; a.nightForecastMedian = null;
  a.externalEnergy = { ...a.externalEnergy, slots: rows, curveUpdatedAt: begin, currentUpdatedAt: begin, currentPrice: .3 };
  const forecastId = day === '2026-10-23' ? 'set_forecast_tomorrow' : 'set_forecast_remaining';
  await h.cards.get(forecastId).listener({ energy: 8 });
  a.invalidatePlanningCache(true);
  await h.pv(0); await h.grid(500); await h.start(); await h.flush();
  assert.deepEqual(h.errors, []);
  return h;
}
async function tick(h, t, { soc = null, evA = null } = {}) {
  h.setNow(t);
  if (soc !== null) await h.cards.get('set_battery_soc').listener({ battery: '1', soc });
  if (evA !== null) await h.cards.get('set_ev1_status').listener({ connected: 'yes', charge_current: evA });
  await h.pv(0);
  await h.grid(500 + (evA || 0) * 230 - h.app.state.lastTotalCommandW);
  h.app.runContextHeartbeat(); await h.flush();
}
async function economic(root = ROOT, extra = {}, kind = 'gerrit') {
  const h = await setup({ root, kind, extra }), a = h.app, end = at('2026-10-24', '07:00');
  let energy = 0, cost = 0, starts = 0, stops = 0, previous = false;
  const curve = prices(kind), events = [], cpu = process.cpuUsage(), started = performance.now();
  for (let t = h.now() + 60000; t <= end; t += 60000) {
    const w = Math.max(0, -a.state.lastTotalCommandW), on = w > 0;
    if (on !== previous) { if (on) starts++; else stops++; events.push({ at: t - 60000, on }); } previous = on;
    const kwh = w / 1000 / 60; energy += kwh;
    cost += kwh * curve.find(r => r.startMs <= t - 60000 && r.startMs + Q > t - 60000).price;
    await tick(h, t, { soc: Math.min(100, 40 + energy / 20 * 100) });
  }
  assert.deepEqual(h.errors, []);
  const used = process.cpuUsage(cpu);
  return { energyKwh: energy, costEUR: cost, finalSoc: a.state.batterySoc[0], deadlineMet: a.state.batterySoc[0] >= 69.7,
    starts, stops, interruptions: Math.max(0, starts - 1), events,
    contexts: counter(a, 'contextEvaluations'), priceWindows: counter(a, 'batteryNightPriceWindowBuilds'),
    selections: counter(a, 'batteryNightPlanBuilds'), cpuMs: (used.user + used.system) / 1000, wallMs: performance.now() - started };
}
const results = [];
async function check(name, run) {
  if (process.env.HEMS_TEST_FILTER && !name.includes(process.env.HEMS_TEST_FILTER)) return;
  const detail = await run(); results.push({ name, ...detail }); console.log('PASS', name);
  fs.mkdirSync(path.join(ROOT, 'validation'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'validation/battery-night-1.1.18.json'), JSON.stringify(results, null, 2) + '\n');
}
async function main() {
  try {
    await check('Production replay: overnight goal met outside daily cheap hours', async () => {
      const current = await economic();
      assert(current.deadlineMet); assert.equal(current.starts, 1); assert(current.costEUR < 1.21);
      assert(current.priceWindows <= 2, JSON.stringify(current));
      assert.equal(current.events[0].at, at('2026-10-24', '00:00'));
      if (process.env.HEMS_BASELINE_ROOT) {
        const old = await economic(process.env.HEMS_BASELINE_ROOT);
        assert(!old.deadlineMet); assert(Math.abs(old.energyKwh - 2.5) < .02);
        return { syntheticPrices: true, current, baseline: old };
      }
      return { syntheticPrices: true, current };
    });
    await check('Cost per delivered kWh and normalized equal-energy comparison', async () => {
      const extra = { maxTotalChargeW: 6000, maxChargePerBatteryW: 6000 };
      const current = await economic(ROOT, extra);
      assert(current.deadlineMet);
      if (process.env.HEMS_BASELINE_ROOT) {
        const baseline = await economic(process.env.HEMS_BASELINE_ROOT, extra);
        const currentUnit = current.costEUR / current.energyKwh, baselineUnit = baseline.costEUR / baseline.energyKwh;
        assert(Math.abs(currentUnit - .2) < .001); assert(Math.abs(baselineUnit - .3) < .001);
        return { syntheticPrices: true, current, baseline, normalizedSixKwh: {
          currentEUR: currentUnit * 6, baselineEUR: baselineUnit * 6,
          note: 'Normalization to equal energy; actual delivered amounts and deadline outcomes are reported separately.' } };
      }
      return { current };
    });
    await check('Already charging across midnight keeps window and chosen intervals', async () => {
      const h = await setup({ begin: at('2026-10-23', '23:58'), kind: 'continuous' }), a = h.app;
      assert(a.latestResult.plannedChargeW > 0);
      const window = a.batteryNightPlanner.window, builds = a.batteryNightPlanner.builds;
      let fastBuilds = 0; const fast = a.evaluateFastNow;
      a.evaluateFastNow = function (...args) { const before = this.batteryNightPlanner?.builds || 0; const r = fast.apply(this, args); fastBuilds += (this.batteryNightPlanner?.builds || 0) - before; return r; };
      for (let s = 1; s <= 180; s++) await tick(h, at('2026-10-23', '23:58') + s * 1000);
      assert.equal(a.batteryNightPlanner.window, window); assert.equal(a.batteryNightPlanner.builds, builds);
      assert.equal(fastBuilds, 0); assert(a.latestResult.plannedChargeW > 0);
      assert.equal(a.getPlanningStatus().planningChargeDeadlineAt, at('2026-10-24', '07:00'));
      assert.deepEqual(h.errors, []); return { fastBuilds, selections: builds, windowBuilds: a.batteryNightPlanner.windowBuilds };
    });
    await check('CPU and calculation counts: 180 unchanged one-second meter inputs', async () => {
      async function trial(root) {
        const h = await setup({ root, begin: at('2026-10-23', '23:58'), kind: 'continuous', extra: { commandDeadbandW: 25 } }), a = h.app;
        const before = { ...a.diagnostics.counters }, sections = structuredClone(a.diagnostics.cpuSections);
        const cpu = process.cpuUsage(), wall = performance.now();
        for (let second = 1; second <= 180; second++) await tick(h, at('2026-10-23', '23:58') + second * 1000);
        const used = process.cpuUsage(cpu), delta = key => counter(a, key) - (before[key] || 0);
        const time = key => (a.diagnostics.cpuSections[key]?.cpuMs || 0) - (sections[key]?.cpuMs || 0);
        assert.deepEqual(h.errors, []);
        return { cpuMs: (used.user + used.system) / 1000, wallMs: performance.now() - wall,
          contexts: delta('contextEvaluations'), fast: delta('fastEvaluations'),
          priceSorts: delta('batteryNightPriceWindowBuilds'), selections: delta('batteryNightPlanBuilds'),
          fastCpuMs: time('fast_evaluation'), contextCpuMs: time('context_evaluation') };
      }
      const current = [], baseline = [];
      for (let run = 0; run < 3; run++) {
        if (process.env.HEMS_BASELINE_ROOT) baseline.push(await trial(process.env.HEMS_BASELINE_ROOT));
        current.push(await trial(ROOT));
      }
      assert(current.every(r => r.priceSorts === 0 && r.selections === 0));
      return { current, baseline, note: 'Process CPU on this host, inclusive sections; not physical Homey CPU percentages.' };
    });
    await check('Forecast promotion, live correction in both directions and plan/display agreement', async () => {
      const h = await setup({ begin: at('2026-10-23', '23:58') }), a = h.app;
      const window = a.batteryNightPlanner.window;
      await tick(h, at('2026-10-24', '00:01'));
      assert.equal(a.state.forecastDailyMaxKwh, 8); assert.equal(a.getEvaluationState().planningForecastDay, 'today');
      for (const value of [0, 0, 0]) await h.cards.get('set_forecast_remaining').listener({ energy: value });
      await tick(h, at('2026-10-24', '00:03')); await h.start();
      assert.equal(a.controlRuntimeSettings.batteryNightPlan.targetSoc, 100);
      assert.equal(a.getPlanningStatus().targetSoc, 100); assert.equal(a.batteryNightPlanner.window, window);
      const high = a.controlRuntimeSettings.batteryNightPlan;
      for (let i = 0; i < 7; i++) await h.cards.get('set_forecast_remaining').listener({ energy: 16 });
      await tick(h, at('2026-10-24', '00:05')); await h.start();
      assert.equal(a.controlRuntimeSettings.batteryNightPlan.targetSoc, 30);
      assert.equal(a.getPlanningStatus().targetSoc, 30); assert.equal(a.latestResult.plannedChargeW, 0);
      assert.equal(a.batteryNightPlanner.window, window); assert(high.needKwh > a.controlRuntimeSettings.batteryNightPlan.needKwh);
      assert.deepEqual(h.errors, []); return { promotionKwh: 8, increasedTarget: 100, decreasedTarget: 30, priceSorts: a.batteryNightPlanner.windowBuilds };
    });
    await check('Late forecast correction exposes infeasible target', async () => {
      const h = await setup({ begin: at('2026-10-24', '06:30') }), a = h.app;
      for (let i = 0; i < 3; i++) await h.cards.get('set_forecast_remaining').listener({ energy: 0 });
      await tick(h, h.now() + 61000); await h.start();
      const plan = a.controlRuntimeSettings.batteryNightPlan;
      assert(!plan.targetReachable); assert(plan.missingKwh > 10);
      assert(/tekort/.test(a.getPlanningStatus().message)); assert(a.latestResult.plannedChargeW <= 2000);
      await tick(h, at('2026-10-24', '07:01')); await h.start(); assert.equal(a.latestResult.plannedChargeW, 0);
      assert.deepEqual(h.errors, []); return { missingKwh: plan.missingKwh, message: a.getPlanningStatus().message };
    });
    await check('Partial, missing and newly published prices', async () => {
      const h = await setup({ rows: prices().filter(r => r.dateKey === '2026-10-23') }), a = h.app;
      assert(a.controlRuntimeSettings.batteryNightPlan.rows.every(r => r.endAt <= at('2026-10-24', '00:00')));
      const count = a.batteryNightPlanner.windowBuilds;
      a.externalEnergy.slots = prices(); a.externalEnergy.curveUpdatedAt = h.now() + 1;
      await tick(h, h.now() + 61000); await h.start();
      assert(a.batteryNightPlanner.windowBuilds > count); assert(a.controlRuntimeSettings.batteryNightPlan.rows.some(r => r.startAt >= at('2026-10-24', '00:00')));
      const builds = a.batteryNightPlanner.windowBuilds;
      a.externalEnergy.slots = prices(); a.externalEnergy.curveUpdatedAt++;
      await tick(h, h.now() + 61000); await h.start(); assert.equal(a.batteryNightPlanner.windowBuilds, builds);
      a.externalEnergy.slots = prices().map(r => ({ ...r, price: r.startMs >= at('2026-10-24', '07:00') ? .001 : r.price }));
      a.externalEnergy.curveUpdatedAt++;
      await tick(h, h.now() + 61000); await h.start(); assert.equal(a.batteryNightPlanner.windowBuilds, builds,
        'prices after the deadline cannot trigger a battery price sort');
      a.externalEnergy.slots = []; a.externalEnergy.curveUpdatedAt++;
      await tick(h, h.now() + 61000); await h.start();
      assert.equal(a.controlRuntimeSettings.batteryNightPlan, null); assert.equal(a.latestResult.plannedChargeW, 0);
      assert.deepEqual(h.errors, []); return { unknownNotFree: true, identicalPublicationReused: true, missingPriceFallback: true };
    });
    await check('PV capture above planning cap and authoritative day transition', async () => {
      const h = await setup({ begin: at('2026-10-24', '06:00'), extra: { nightPlanningMaxSoc: 50, dayPlanningMaxSoc: 60 } }), a = h.app;
      await h.cards.get('set_battery_soc').listener({ battery: '1', soc: 80 });
      await h.grid(-1500); await h.start(); await h.flush();
      assert(a.latestResult.totalCommandW < 0); assert.equal(a.latestResult.plannedChargeW, 0);
      const cached = a.controlContext, runtime = a.controlRuntimeSettings;
      await h.pv(5); await h.start(); await h.flush();
      assert(!a.isNightPlanningPhase()); assert.equal(a.nightForecastMedian, null);
      assert(!a.controlRuntimeSettings.batteryNightPlan); assert.equal(a.batteryNightPlanner, null);
      assert.equal(a.getPlanningStatus().planningPhase, 'day'); assert.equal(a.getPlanningStatus().planningChargeDeadlineAt, at('2026-10-24', '17:00'));
      const fastTransition = evaluate(a.getEvaluationState(), runtime, new Date(h.now()), cached);
      assert(!fastTransition.tariff.batteryNight, 'cached night tariff cannot survive the real PV transition');
      assert.deepEqual(h.errors, []); return { pvCaptureAboveNightCap: true, dayTarget: '17:00' };
    });
    await check('Hourly prices use the same deadline and do not change public classes', async () => {
      const h = await setup({ rows: prices('gerrit', HOUR), extra: { contractType: 'dynamic_hour' } }), a = h.app;
      await tick(h, at('2026-10-24', '00:00')); await h.start();
      assert.equal(a.latestResult.tariff.className, 'normal'); assert.equal(a.latestResult.tariff.batteryNight.className, 'cheap');
      assert(a.latestResult.plannedChargeW > 0); assert.equal(a.controlRuntimeSettings.batteryNightPlan.deadlineAt, at('2026-10-24', '07:00'));
      assert.deepEqual(h.errors, []); return { publicClass: 'normal', batteryClass: 'cheap' };
    });
    await check('Normal-price permission keeps its own SoC cap', async () => {
      const h = await setup({ begin: at('2026-10-23', '18:00'), extra: { dynamicNormalChargeEnabled: true, dynamicNormalChargeMaxSoc: 45 } }), a = h.app;
      assert.equal(a.latestResult.tariff.batteryNight.className, 'normal'); assert(a.latestResult.plannedChargeW > 0);
      await h.cards.get('set_battery_soc').listener({ battery: '1', soc: 45 }); await h.start();
      assert.equal(a.latestResult.plannedChargeW, 0); assert.deepEqual(h.errors, []); return { normalCapSoc: 45 };
    });
    await check('Restart reconstructs the same remaining window from persisted dated forecasts', async () => {
      const h = await setup({ begin: at('2026-10-24', '01:00') }), a = h.app;
      a.state.forecastDailyMaxDate = ''; a.restoreForecastState(h.now());
      assert.equal(a.state.forecastDailyMaxDate, '2026-10-24');
      a.batteryNightPlanner = null; a.batteryNightCurve = null;
      await h.start();
      assert.equal(a.controlRuntimeSettings.batteryNightPlan.deadlineAt, at('2026-10-24', '07:00'));
      assert(a.controlRuntimeSettings.batteryNightPlan.rows.every(r => r.endAt > h.now()));
      a.readExternalPrices('external', JSON.stringify({ pricesPerInterval: prices().map(r => ({
        periodStart: new Date(r.startMs).toISOString(), periodEnd: new Date(r.startMs + Q).toISOString(), value: r.price,
      })) }), { period: 'next_hours' });
      const fresh = await require('./startup-harness').boot(new Map(h.store));
      assert.equal(fresh.app.state.forecastDailyMaxKwh, 8, 'fresh app restores the dated forecast without a new forecast input');
      assert(fresh.app.externalEnergy.slots.length > 0, 'fresh app restores the persisted price curve');
      fresh.app.setInput({ gridPowerW: 500, pvPowerW: 0, batterySoc: [40] });
      await fresh.app.runContextEvaluation(true);
      assert.equal(fresh.app.controlRuntimeSettings.batteryNightPlan.deadlineAt, at('2026-10-24', '07:00'));
      assert(fresh.app.latestResult.plannedChargeW > 0);
      assert.deepEqual(fresh.errors, []); assert.deepEqual(h.errors, []); return { reconstructed: true, freshAppBoot: true };
    });
    await check('DST absolute hours and local forecast tomorrow dates', async () => {
      for (const [day, next, quarters] of [['2026-10-25', '2026-10-26', 100], ['2026-03-29', '2026-03-30', 92]]) {
        const rows = [];
        for (let startMs = at(day, '00:00'); startMs < at(next, '00:00'); startMs += Q) {
          const p = localParts(new Date(startMs), ZONE); rows.push({ startMs, dateKey: p.dateKey, minute: p.minuteOfDay, price: .2 });
        }
        const curve = prepareEvPriceCurve(rows, ZONE); assert.equal(curve.intervals.length, quarters);
        const p = new BatteryNightPlanner().evaluate({ curve, now: at(day, '00:00'), startAt: at(day, '00:00'), deadlineAt: at(day, '07:00'),
          needKwh: 100, targetSoc: 100, powerW: 2000, cheapHours: 1.25, expensiveHours: 3, normalEnabled: false, normalMaxSoc: 50 });
        assert(p.rows.every(r => r.endAt <= at(day, '07:00')));
        assert.equal(p.cheapIndex.suffixMs[0] / HOUR, quarters === 100 ? 8 : 6);
        const h = await setup({ begin: at(day, '00:30'), rows });
        h.app.updateForecastTomorrowInput(9, h.now()); assert.equal(h.app.state.forecastTomorrowDate, next);
        h.app.restoreForecastState(h.now()); assert(h.app.inputSeen.forecastTomorrow);
        assert.deepEqual(h.errors, []);
      }
      return { autumnQuarters: 100, springQuarters: 92 };
    });
    await check('Price hysteresis retains feasible sessions; material savings replan', async () => {
      const rows = prices(), p = new BatteryNightPlanner(), now = at('2026-10-23', '18:00');
      const args = { now, startAt: now, deadlineAt: at('2026-10-24', '07:00'), needKwh: 2, targetSoc: 50, powerW: 2000,
        cheapHours: 1.25, expensiveHours: 3, normalEnabled: false, normalMaxSoc: 50 };
      const first = p.evaluate({ ...args, curve: prepareEvPriceCurve(rows, ZONE) });
      const edit = price => prepareEvPriceCurve(rows.map(r => ({ ...r, price: r.startMs >= at('2026-10-24', '04:00') && r.startMs < at('2026-10-24', '06:00') ? price : r.price })), ZONE);
      const small = p.evaluate({ ...args, curve: edit(.199) }); assert.equal(small.cheapRows[0].startAt, first.cheapRows[0].startAt);
      const big = p.evaluate({ ...args, curve: edit(.05) }); assert.equal(big.cheapRows[0].startAt, at('2026-10-24', '04:00'));
      return { tinyChangeRetained: true, significantChangeApplied: true };
    });
    await check('Near-equal scattered quarters prefer one session; early PV end starts now', async () => {
      const now = at('2026-10-23', '16:00'), rows = [];
      for (let i = 0; i < 12; i++) rows.push({ startMs: now + i * Q, price: i % 2 ? .201 : .20 });
      const planner = new BatteryNightPlanner();
      const plan = planner.evaluate({ curve: prepareEvPriceCurve(rows, ZONE), now, startAt: at('2026-10-23', '17:00'),
        deadlineAt: at('2026-10-24', '07:00'), needKwh: 2, targetSoc: 50, powerW: 2000,
        cheapHours: 1.25, expensiveHours: 3, normalEnabled: false, normalMaxSoc: 50 });
      assert.equal(plan.cheapIndex.rows.length, 1); assert.equal(plan.cheapRows[0].startAt, now);
      assert(nightPolicy(plan, now).eligibleNow);
      return { chargingSessions: 1, earlyNightStart: '16:00' };
    });
    await check('Shared Peak Guard and EV deadline plan remain independent', async () => {
      const h = await setup({ begin: at('2026-10-24', '00:00'), evs: 1, extra: { peakShaveEnabled: true, peakLimitW: 5000,
        peakSoftMarginW: 0, maxTotalChargeW: 2000, evPhases: 1, evVoltage: 230, evVoltageReference: 'phase',
        evDynamicCheapEnabled: true, evDynamicNormalEnabled: false, evDynamicExpensiveEnabled: false,
        evDynamicCheapMaxGridImportW: 4000, evStandardCurrentA: 10, evMaxCurrentA: 10 } }), a = h.app;
      await h.cards.get('set_ev1_energy_deadline').listener({ energy: 4.6, time: '07:00', guarantee: 'yes' }); await h.start();
      const evDeadline = a.evEnergyPlans[0].deadlineAt;
      for (let s = 1; s <= 120; s++) await tick(h, at('2026-10-24', '00:00') + s * 1000, { evA: 10 });
      assert.equal(a.evEnergyPlans[0].deadlineAt, evDeadline); assert(a.latestEvDecision.deadlinePlanning);
      assert(a.latestResult.totalCommandW >= -2000); assert(a.state.gridPowerW <= 5000 + 50);
      await h.grid(10000); await h.start(); await h.flush(); assert.equal(a.latestResult.override, 'peak_shave');
      assert.deepEqual(h.errors, []); return { evDeadlineRetained: true, peakGuardApplied: true };
    });
    fs.mkdirSync(path.join(ROOT, 'validation'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'validation/battery-night-1.1.18.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(`1.1.18 battery night: ${results.length} production/planner scenarios passed.`);
  } finally { Date.now = originalNow; global.Date = NativeDate; restore(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
