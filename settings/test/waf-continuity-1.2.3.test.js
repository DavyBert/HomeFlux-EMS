'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const { localDateTimeUtcMs, shiftDateKey } = require('../lib/homey-energy');
const root = path.resolve(process.env.HEMS_WAF_ROOT || path.join(__dirname, '..'));
const req = createRequire(path.join(root, 'package.json'));
const engine = req('./lib/ems-engine');
const budgets = req('./lib/widget-energy-budget');
const originalBuild = engine.buildSocPlan, originalBudget = budgets.calculateBudget, originalEvaluate = engine.evaluate;
const originalNow = Date.now, restoreClear = installVirtualClearTimeout();
const events = [], results = [];
engine.buildSocPlan = (...args) => { events.push('plan'); return originalBuild(...args); };
budgets.calculateBudget = (...args) => { events.push('waf'); return originalBudget(...args); };
engine.evaluate = (...args) => { events.push('evaluate'); return originalEvaluate(...args); };
const HOUR = 3600000, FIVE = 300000, zone = 'Europe/Brussels';
const at = (time, date = '2026-10-26') => localDateTimeUtcMs(date, time, zone);
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const count = name => events.filter(event => event === name).length;
const widgetSource = fs.readFileSync(path.join(root, 'widgets/status/public/index.html'), 'utf8')
  .match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
const ui = vm.createContext({ Date, document: { getElementById: () => null } });
vm.runInContext(widgetSource, ui);
async function check(name, fn) {
  try { const evidence = await fn(); results.push({ name, passed: true, ...evidence }); console.log('PASS', name); }
  catch (error) { results.push({ name, passed: false, failure: error.stack }); console.error('FAIL', name, error.message); }
}
async function make(time, options = {}) {
  const { date = '2026-10-26', day = true, explicitNight = !day, ...settings } = options;
  const h = await setup(root, { expectedEnergyNeedKwh: 16.8, planningMinIntervalMinutes: 60,
    peakReserveEnabled: false, sunChanceReserveEnabled: false, lowForecastFixedEnabled: false,
    lowForecastTouEnabled: false, lowForecastDynamicEnabled: false, ...settings }, at(time, date), day ? 1500 : 0);
  const a = h.app;
  Object.assign(a.state, { pvProducingDate: date, pvSeenProducingToday: day,
    nightPlanningActive: explicitNight, nightPlanningStartedDate: explicitNight ? shiftDateKey(date, -1) : '',
    nightPlanningDecisionSource: explicitNight ? 'test_observed_previous_sunset' : '', targetSocOverride: 80 });
  a.setInput({ gridPowerW: 0, pvPowerW: day ? 1500 : 0, forecastRemainingKwh: 12,
    forecastTomorrowKwh: 40, batterySoc: [100, 100, 100, 100] });
  await h.start(); await h.flush();
  a.invalidatePlanningCache(true); await h.start(); await h.flush();
  assert.deepEqual(h.errors, []);
  return h;
}
async function advance(h, when) {
  h.setNow(when);
  // Mock healthy device timestamps without creating an input-triggered refresh.
  h.app.inputUpdatedAt.grid = when; h.app.inputUpdatedAt.pv = when;
  await h.flush();
  assert.deepEqual(h.errors, []);
}
function budget(h) {
  const b = h.app.getPublicStatus().energyBudget;
  assert(b?.ready, JSON.stringify(h.app.planningCache?.energyBudget || h.app.getPlanningStatus().energyBudget));
  assert(b.targetAt > h.now());
  ui.budget = b; ui.at = h.now();
  assert.notEqual(vm.runInContext('budgetView(budget, true, at).text', ui), '--', 'real widget renderer must show the WAF');
  return b;
}

(async () => {
  for (const contractType of ['fixed', 'tou', 'dynamic']) {
    await check(`${contractType}: five-minute WAF refresh with reached goal and a clean 60-minute battery-plan cache`, async () => {
      const h = await make('10:00', { contractType });
      const a = h.app, first = budget(h), plan = a.getPlanningStatus();
      assert.equal(plan.energyNeedKwh, 0);
      assert(!plan.rows.some(row => row.plannedNetCharge));
      const beforePlans = count('plan'), beforeWaf = count('waf'), beforeEval = count('evaluate');
      await advance(h, first.calculatedAt + FIVE - 1);
      assert.equal(budget(h).calculatedAt, first.calculatedAt);
      await advance(h, first.calculatedAt + FIVE);
      const second = budget(h);
      assert.equal(second.calculatedAt, first.calculatedAt + FIVE);
      assert.equal(count('waf') - beforeWaf, 1);
      assert.equal(count('plan'), beforePlans, 'WAF must not build a second battery plan');
      assert.equal(a.getPlanningStatus(), plan, 'existing battery rows/cache retained');
      assert.equal(second.targetAt, at('17:00'));
      near(second.valueKwh - first.valueKwh, 16.8 / 24 * FIVE / HOUR);
      assert.equal(a.contextTimerAt, second.calculatedAt + FIVE, 'one shared context timer re-arms');
      assert.equal(a.contextDirty, false, 'future WAF deadline must not mark current context dirty');
      const afterReads = count('waf');
      for (let i = 0; i < 200; i++) { a.getPublicStatus(); a.getPlanningStatus(); }
      assert.equal(count('waf'), afterReads, 'read-only status never calculates');
      return { firstAt: first.calculatedAt, refreshedAt: second.calculatedAt,
        extraBatteryPlans: count('plan') - beforePlans, extraContextEvaluations: count('evaluate') - beforeEval };
    });
  }
  await check('WAF is calculated once BEFORE an actual battery plan, using the existing control evaluation', async () => {
    const h = await make('10:00'); events.length = 0;
    h.app.invalidatePlanningCache(true); await h.start();
    assert.deepEqual(events, ['evaluate', 'waf', 'plan']);
    return { calculationOrder: [...events] };
  });
  await check('07:00 before PV start: day WAF uses raw remaining-today, not the continuing night median', async () => {
    const h = await make('06:59', { day: false, slowControlIntervalSeconds: 300 });
    const a = h.app;
    a.nightForecastMedian = { targetDate: '2026-10-26', samples: [60], value: 60 };
    a.invalidatePlanningCache(true); await h.start();
    assert.equal(budget(h).targetAt, at('07:00')); assert.equal(budget(h).solarKwh, 0);
    const beforePlans = count('plan');
    await advance(h, at('07:00'));
    const b = budget(h);
    assert.equal(b.targetAt, at('17:00')); assert.equal(b.phase, 'day');
    assert.equal(b.solarKwh, 12); near(b.householdKwh, 7);
    assert.equal(a.isNightPlanningPhase(h.now()), true, 'actual battery phase is preserved');
    assert.equal(a.nightForecastMedian.value, 60);
    assert.equal(a.getEvaluationState(a.getSettings(), h.now()).forecastRemainingKwh, 60);
    assert.equal(count('plan'), beforePlans, 'morning WAF boundary does not require a new battery plan');
    await advance(h, at('07:05')); assert.equal(budget(h).solarKwh, 12);
    return { targetAt: b.targetAt, solarKwh: b.solarKwh, householdKwh: b.householdKwh };
  });
  await check('17:00 with PV still active: remaining today and household demand extend to next morning', async () => {
    const h = await make('16:59');
    assert.equal(budget(h).targetAt, at('17:00'));
    const beforePlans = count('plan');
    await advance(h, at('17:00'));
    const b = budget(h);
    assert.equal(b.phase, 'day'); assert.equal(b.horizon, 'remaining_today_to_morning');
    assert.equal(b.targetAt, at('07:00', '2026-10-27'));
    assert.equal(b.solarKwh, 12); near(b.householdKwh, 9.8);
    assert.equal(h.app.isNightPlanningPhase(h.now()), false);
    assert.equal(count('plan'), beforePlans);
    return { horizon: b.horizon, householdKwh: b.householdKwh, targetAt: b.targetAt };
  });
  await check('Real <5 W / 10-minute PV-stop debounce starts night WAF; remaining PV is kept until then', async () => {
    const h = await make('18:00');
    const a = h.app; a.setInput({ forecastRemainingKwh: 2 });
    await h.pv(0); await h.flush();
    assert(a.pvStopTimer, 'real production PV-stop timer armed');
    await advance(h, at('18:05'));
    assert.equal(budget(h).phase, 'day'); assert.equal(budget(h).solarKwh, 2);
    await advance(h, at('18:09') + 59000);
    assert.equal(a.state.nightPlanningActive, false);
    const before = count('waf');
    await advance(h, at('18:10'));
    const b = budget(h);
    assert.equal(a.state.nightPlanningDecisionSource, 'pv_below_5w_10m');
    assert.equal(b.phase, 'night'); assert.equal(b.solarKwh, 0);
    assert.equal(b.targetAt, at('07:00', '2026-10-27'));
    assert.equal(count('waf') - before, 1, 'PV stop and periodic deadline coalesce');
    return { phase: b.phase, solarKwh: b.solarKwh, actualNightSource: a.state.nightPlanningDecisionSource };
  });
  await check('A real winter PV end before 17:00 starts night immediately', async () => {
    const h = await make('16:00');
    await h.pv(0);
    await advance(h, at('16:10'));
    assert.equal(budget(h).phase, 'night');
    assert.equal(budget(h).targetAt, at('07:00', '2026-10-27'));
  });
  await check('A completely dark day stays day-WAF after 07:00 and rolls to night via the existing 20:00 fallback', async () => {
    const h = await make('08:00', { day: false });
    assert.equal(budget(h).phase, 'day'); assert.equal(budget(h).targetAt, at('17:00'));
    await advance(h, at('19:55')); assert.equal(budget(h).phase, 'day');
    h.setNow(at('20:00')); h.app.runContextHeartbeat(); await h.flush();
    assert.equal(budget(h).phase, 'night'); assert.equal(budget(h).targetAt, at('07:00', '2026-10-27'));
    assert.match(h.app.state.nightPlanningDecisionSource, /^20h_/);
  });
  for (const item of [{ date: '2026-10-24', next: '2026-10-25', hours: 9 },
    { date: '2026-03-28', next: '2026-03-29', hours: 7 }]) {
    await check(`Brussels DST ${item.date}: actual night-to-morning elapsed duration is ${item.hours}h`, async () => {
      const h = await make('23:00', { date: item.date, day: false });
      h.app.state.nightPlanningStartedDate = item.date;
      h.app.invalidatePlanningCache(true); await h.start();
      const b = budget(h);
      assert.equal(b.targetAt, at('07:00', item.next)); near(b.remainingHours, item.hours);
      near(b.householdKwh, 0.7 * item.hours);
      return { elapsedHours: b.remainingHours, householdKwh: b.householdKwh };
    });
  }
  await check('Configured 06:30 / 18:15 targets replace hardcoded 07:00 / 17:00, including midnight', async () => {
    const h = await make('06:29', { day: false, nightTargetTime: '06:30', solarTargetTime: '18:15' });
    assert.equal(budget(h).targetAt, at('06:30'));
    await advance(h, at('06:30')); assert.equal(budget(h).targetAt, at('18:15'));
    await advance(h, at('18:15')); assert.equal(budget(h).targetAt, at('06:30', '2026-10-27'));
    h.app.state.nightPlanningActive = true; h.app.state.nightPlanningStartedDate = '2026-10-26';
    h.app.invalidatePlanningCache(true); await h.start();
    await advance(h, at('00:00', '2026-10-27'));
    assert.equal(budget(h).targetAt, at('06:30', '2026-10-27'));
  });
  await check('Missing data stays unknown; five-minute refresh recovers new data even while the battery-plan cache is blocked', async () => {
    const h = await make('10:00');
    h.app.inputSeen.forecast = false; h.app.state.forecastRemainingKwh = null;
    h.app.state.forecastDailyMaxKwh = 100;
    h.app.invalidatePlanningCache(true); await h.start();
    assert.equal(h.app.getPublicStatus().energyBudget, null);
    assert.equal(h.app.planningCache.energyBudget.reason, 'remaining_forecast_missing');
    assert.equal(h.app.contextTimerAt, h.now() + FIVE);
    const beforePlans = count('plan');
    h.app.setInput({ forecastRemainingKwh: 12 });
    await advance(h, h.now() + FIVE);
    assert.equal(budget(h).solarKwh, 12);
    assert.equal(count('plan'), beforePlans, 'data recovery needs no new battery plan');
    h.app.inputSeen.forecast = true; h.app.state.forecastRemainingKwh = 12;
    h.app.state.batterySoc[0] = null; h.app.inputSeen.batterySoc[0] = false;
    h.app.invalidatePlanningCache(true); await h.start();
    assert.equal(h.app.getPublicStatus().energyBudget, null);
    assert.equal(h.app.planningCache.energyBudget.reason, 'battery_data_missing');
  });
  await check('300 real P1 updates and 200 widget/status reads never calculate WAF or a battery plan', async () => {
    const h = await make('10:00'), beforeWaf = count('waf'), beforePlans = count('plan');
    for (let i = 0; i < 300; i++) {
      h.setNow(at('10:00') + i * 10); await h.grid(i % 2); await h.flush();
    }
    for (let i = 0; i < 200; i++) h.app.getPublicStatus();
    assert.equal(count('waf'), beforeWaf); assert.equal(count('plan'), beforePlans);
    assert(!h.app.planningCache.timer, 'no independent WAF/planning timer');
  });
  const report = { version: req('./app.json').version, simulatedHomey: true, hardwareTested: false,
    total: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
  fs.writeFileSync(process.env.HEMS_WAF_REPORT || path.join(__dirname, '../validation/waf-continuity-1.2.3.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`WAF continuity: ${report.passed}/${report.total} scenarios passed`);
  if (report.failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Date.now = originalNow; restoreClear(); engine.buildSocPlan = originalBuild;
  budgets.calculateBudget = originalBudget; engine.evaluate = originalEvaluate;
});
