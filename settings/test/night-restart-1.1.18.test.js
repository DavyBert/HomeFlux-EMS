'use strict';
const assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const { localParts, localDateTimeUtcMs } = require('../lib/homey-energy');
const NativeDate = Date;
let now = localDateTimeUtcMs('2026-10-24', '18:12', 'Europe/Brussels');
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
const at = (day, time) => localDateTimeUtcMs(day, time, 'Europe/Brussels');
function curve() {
  const rows = [];
  for (let t = at('2026-10-24', '00:00'); t < at('2026-10-26', '00:00'); t += 900000) {
    const p = localParts(new Date(t), 'Europe/Brussels');
    rows.push({ startMs: t, dateKey: p.dateKey, minute: p.minuteOfDay, price: p.minuteOfDay < 420 ? .03 : .09 });
  }
  return rows;
}
async function cold({ time = '18:12', soc = 84.5, tomorrow = 12.3, root = ROOT, extra = {} } = {}) {
  now = at('2026-10-24', time);
  const req = createRequire(path.join(root, 'package.json'));
  const { boot, DEFAULTS } = req('./test/startup-harness');
  const settings = { ...DEFAULTS, timezone: 'Europe/Brussels', settingsSchemaVersion: 70,
    batteryCount: 4, totalCapacityKwh: 21.6, maxTotalChargeW: 6000, maxChargePerBatteryW: 2400,
    minSoc: 12, safetySoc: 14, maxSoc: 100, controlEnabled: true,
    contractType: 'dynamic_quarter', dynamicPriceSources: ['homey'], cheapHours: 4, expensiveHours: 3,
    expectedEnergyNeedKwh: 22, dayPlanningMaxSoc: 80, nightPlanningMaxSoc: 90,
    nightTargetTime: '07:00', solarTargetTime: '17:00', peakReserveNightEnabled: false,
    peakShaveEnabled: true, peakLimitW: 2650, forcedMode: 'auto', sunChanceReserveEnabled: false,
    evCount: 0, hvacCount: 0, boilerCount: 0, ...extra };
  const h = await boot(new Map(Object.entries(settings))), a = h.app;
  Object.assign(a.homeyEnergy, { available: true, slots: curve(), interval: 15, lastUpdatedAt: now });
  h.store.set('_chargeTestSignature', a.getChargeTestSignature(a.getSettings()));
  await h.setExternalSetting('controlEnabled', true);
  // These are the production API paths. No observed PV start, sunset marker,
  // planning phase, chosen forecast day or deadline is injected by the test.
  a.setInput({ gridPowerW: 500, pvPowerW: 0, batterySoc: [soc,soc,soc,soc],
    forecastRemainingKwh: .2, forecastTomorrowKwh: tomorrow });
  a.invalidatePlanningCache(true); await a.runContextEvaluation(true);
  assert.deepEqual(h.errors, []);
  return h;
}
const cases = [];
async function check(name, run) { const result = await run(); cases.push({ name, ...result }); console.log('PASS', name); }
async function main() {
  try {
    await check('Screenshot reproduction: inferred night targets tomorrow and correct PV after evening restart', async () => {
      const h = await cold(), a = h.app, p = a.getPlanningStatus();
      assert(a.isNightPlanningPhase()); assert(!a.state.nightPlanningActive, 'no fabricated sunset event');
      assert.equal(a.getPlanningForecastDay(), 'tomorrow'); assert.equal(p.forecastUsedKwh, 12.3);
      assert.equal(p.planningChargeDeadlineAt, at('2026-10-25', '07:00'));
      assert.equal(a.getWidgetNextChargeStatus().state, 'not_needed');
      assert(p.targetSoc < 84.5);
      let before = null;
      if (process.env.HEMS_PREVIOUS_118_ROOT) {
        const old = await cold({ root: process.env.HEMS_PREVIOUS_118_ROOT }), prior = old.app.getPlanningStatus();
        assert.equal(prior.planningChargeDeadlineAt, at('2026-10-24', '07:00'));
        assert.equal(old.app.getWidgetNextChargeStatus().state, 'no_window');
        before = { forecastKwh: prior.forecastUsedKwh, targetSoc: prior.targetSoc,
          deadlineAt: prior.planningChargeDeadlineAt, widget: old.app.getWidgetNextChargeStatus().state };
      }
      return { syntheticPrices: true, reportedSettingsAndInputs: true, before,
        after: { forecastKwh: p.forecastUsedKwh, targetSoc: p.targetSoc, deadlineAt: p.planningChargeDeadlineAt,
          widget: a.getWidgetNextChargeStatus().state } };
    });
    await check('Low SoC still gets future windows with available overnight prices', async () => {
      const h = await cold({ soc: 40 }), a = h.app, p = a.getPlanningStatus();
      assert(p.energyNeedKwh > 0); assert(p.rows.some(r => r.plannedNetCharge));
      assert.equal(a.getWidgetNextChargeStatus().state, 'planned');
      assert(p.rows.every(r => r.endAt <= at('2026-10-25', '07:00')));
      return { targetSoc: p.targetSoc, nextCharge: a.getWidgetNextChargeStatus() };
    });
    await check('Morning restart and explicit dark-night continuation stay on today', async () => {
      const h = await cold({ time: '05:30' }), a = h.app;
      assert.equal(a.getPlanningForecastDay(), 'today');
      assert.equal(a.getPlanningStatus().planningChargeDeadlineAt, at('2026-10-24', '07:00'));
      now = at('2026-10-24', '18:12');
      Object.assign(a.state, { nightPlanningActive: true, nightPlanningStartedDate: '2026-10-23' });
      assert.equal(a.getPlanningForecastDay(), 'today', 'an observed ongoing dark night is not rolled by this restart fallback');
      return { morningTargetDay: 'today', observedDarkNightTargetDay: 'today' };
    });
    await check('Actual PV start returns to existing day forecast and sunset debounce', async () => {
      const h = await cold(), a = h.app;
      a.setInput({ pvPowerW: 50 }); await a.runContextEvaluation(true);
      assert(!a.isNightPlanningPhase()); assert.equal(a.getPlanningForecastDay(), 'today');
      assert.equal(a.getPlanningStatus().forecastUsedKwh, .2); assert.equal(a.nightForecastMedian, null);
      a.setInput({ pvPowerW: 0 }); assert(a.pvStopTimer);
      assert(!a.state.nightPlanningActive, 'observed production still uses the existing ten-minute timer');
      return { pvOwnsDayPhase: true, originalSunsetTimerRetained: true };
    });
    await check('20:00 fallback and midnight preserve the corrected target and median', async () => {
      const h = await cold(), a = h.app;
      const median = a.nightForecastMedian;
      now = at('2026-10-24', '20:00'); a.checkNightPlanningFallback(now);
      assert(a.state.nightPlanningActive); assert.equal(a.nightForecastMedian, median);
      now = at('2026-10-25', '00:01'); a.ensureForecastDayCurrent(now);
      assert.equal(a.getPlanningForecastDay(), 'today'); assert.equal(a.getNightForecastRuntime(), median);
      assert.equal(median.targetDate, '2026-10-25'); assert.equal(median.value, 12.3);
      return { sameMedian: true, targetDate: median.targetDate };
    });
    await check('Custom target times, fixed/TOU and cache avoid per-P1 calendar rebuilding', async () => {
      const h = await cold({ time: '16:30', extra: { solarTargetTime: '16:00', nightTargetTime: '06:00' } }), a = h.app;
      assert.equal(a.getPlanningForecastDay(), 'tomorrow');
      assert.equal(a.getPlanningStatus().planningChargeDeadlineAt, at('2026-10-25', '06:00'));
      const read = a.getLocalMinuteOfDay; let calls = 0;
      a.getLocalMinuteOfDay = function (...args) { calls++; return read.apply(this,args); };
      for (let second = 0; second < 60; second++) a.getPlanningForecastDay(now + second * 1000);
      assert(calls <= 1, 'local-minute conversion cached over one-second input');
      for (const contractType of ['fixed','tou']) {
        const f = await cold({ extra: { contractType } });
        assert.equal(f.app.getPlanningStatus().planningChargeDeadlineAt, at('2026-10-25', '07:00'));
      }
      return { customDeadline: '06:00', minuteConversions: calls, contracts: ['fixed','tou'] };
    });
    fs.writeFileSync(path.join(ROOT, 'validation/night-restart-1.1.18.json'), JSON.stringify(cases,null,2)+'\n');
    console.log(`1.1.18 evening restart: ${cases.length} production-path scenarios passed.`);
  } finally { global.Date = NativeDate; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
