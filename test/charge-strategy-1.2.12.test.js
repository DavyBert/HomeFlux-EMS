'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const engine = require('../lib/ems-engine');
const strategy = require('../lib/charge-strategy');
const { prepareEvPriceCurve } = require('../lib/ev-deadline-planner');
const { localDateTimeUtcMs } = require('../lib/homey-energy');
const H = 3600000, Q = 900000;
const at = (time, day = '2026-10-20', zone = 'UTC') => localDateTimeUtcMs(day, time, zone);
const base = { ...engine.DEFAULTS, contractType: 'fixed', timezone: 'UTC', batteryCount: 2, totalCapacityKwh: 10,
  minSoc: 10, safetySoc: 10, maxSoc: 100, maxChargePerBatteryW: 2000, maxTotalChargeW: 4000,
  maxTotalDischargeW: 4000, maxDischargePerBatteryW: 2000, peakShaveEnabled: true,
  peakLimitW: 2600, peakSoftMarginW: 0, fixedChargeWindowStart: '11:00', fixedChargeWindowEnd: '17:00',
  solarTargetTime: '17:00', nightTargetTime: '07:00', controlProfile: 'exact', gridZeroMinW: 0,
  gridZeroMaxW: 0, commandDeadbandW: 0, batteryCommandStepW: 1, balanceEnabled: false,
  peakReserveTargetSoc: 0, sunnyMonthsMinSocEnabled: false, sunChanceReserveEnabled: false };
const state = { gridPowerW: 600, controlGridPowerW: 600, lastTotalCommandW: 0,
  lastBatteryCommands: [0, 0], batterySoc: [50, 50], targetSocOverride: 80, forecastRemainingKwh: 0,
  planningForecastDay: 'today', nightPlanningActive: false };
function config(phase = 'day', mode = 'maximum', position = undefined, extraPercent = 0) {
  const c = strategy.normalize(); c.year[phase] = { ...c.year[phase], mode, extraPercent,
    ...(position ? { position } : {}) }; return c;
}
function prepare(settings = {}, input = {}, now = at('11:00'), curve = null, previous = null) {
  const s = { ...base, chargeStrategy: config(), ...settings }, st = { ...state, ...input };
  if (engine.isDynamicContract(s) && st.nightPlanningActive && curve) {
    const inputs = engine.getBatteryNightPlanningInputs(st, s, new Date(now));
    s.batteryNightPlan = new (require('../lib/battery-night-planner').BatteryNightPlanner)().evaluate({ ...inputs, curve });
  }
  const plan = engine.prepareChargeStrategy(st, s, new Date(now), curve, null, previous);
  const runtime = { ...s, batteryChargeStrategyPlan: plan };
  return { plan, settings: runtime, state: st, result: engine.evaluate(st, runtime, new Date(now)) };
}
let groups = 0;
function check(name, run) { run(); groups++; }
check('legacy default equivalence', () => {
  const oldRoot = path.resolve(process.env.HEMS_BASELINE_ROOT || '../HomeFlux-EMS-1.2.11');
  const old = fs.existsSync(path.join(oldRoot, 'lib/ems-engine.js')) ? require(path.join(oldRoot, 'lib/ems-engine.js')) : null;
  const digest = require('node:crypto').createHash('sha256');
  for (const contractType of ['fixed', 'tou', 'dynamic_quarter']) for (const forcedMode of ['auto', 'standby', 'manual_charge', 'self_consumption', 'avoid_import', 'solar_capture'])
    for (const soc of [null, 10, 50, 80, 100]) for (const grid of [-600, 600, 3600]) {
      const s = { ...base, contractType, forcedMode, chargeStrategy: strategy.normalize() };
      const st = { ...state, batterySoc: [soc, soc], gridPowerW: grid, controlGridPowerW: grid };
      assert.equal(engine.prepareChargeStrategy(st, s, new Date(at('11:00'))), null);
      const result = engine.evaluate(st, s, new Date(at('11:00'))), plan = engine.buildSocPlan(st, s, new Date(at('11:00')));
      // The 1.2.11 golden result predates these two presentation fields.
      // Assert their disabled values, then compare every original field.
      assert.equal(result.injectionActive, false);
      assert.equal(result.injectionTargetW, 0);
      const { injectionActive, injectionTargetW, ...legacyResult } = result;
      if (old) {
        assert.deepEqual(legacyResult, old.evaluate(st, s, new Date(at('11:00'))));
        assert.deepEqual(plan, old.buildSocPlan(st, s, new Date(at('11:00'))));
      }
      digest.update(JSON.stringify([legacyResult, plan]));
    }
  // Golden result from the complete 1.2.11 engine; also usable without a sibling checkout.
  assert.equal(digest.digest('hex'), '5afb3a102286762b028bb637796a8d24eeb97b6b492ae0247bdada79acbd89a2');
});
check('standard independent percentage and limits', () => {
  for (const percent of [0, 10, 50, 100]) {
    const h = prepare({ chargeStrategy: config('day', 'standard', undefined, percent) });
    assert.equal(h.result.plannedChargeW, 500 * (1 + percent / 100));
    assert.equal(h.result.planningChargeTargetSoc, 80);
    assert.equal(h.result.energyToTargetKwh, 3);
  }
  assert.equal(prepare({ chargeStrategy: config('day', 'standard', undefined, 100), maxTotalChargeW: 700 }).result.plannedChargeW, 700);
  assert.equal(prepare({ chargeStrategy: config('day', 'standard', undefined, 50) }, { batterySoc: [80, 80] }).result.plannedChargeW, 0);
});
check('default positions and separate seasonal selections', () => {
  const c = strategy.normalize();
  for (const profile of ['year', 'summer', 'winter']) {
    assert.equal(c[profile].night.position, 'center'); assert.equal(c[profile].day.position, 'latest');
    assert.equal(c[profile].day.mode, 'standard'); assert.equal(c[profile].night.extraPercent, 0);
  }
  c.seasonal = true; c.winter.day.position = 'early'; c.summer.day.extraPercent = 10;
  assert.equal(strategy.select({ ...base, chargeStrategy: c, peakReserveMonth10: true, peakReserveTargetSoc: 0 }, at('11:00'), false).profile, 'winter');
  assert.equal(strategy.select({ ...base, chargeStrategy: c, peakReserveMonth10: false, sunnyMonthsMinSocEnabled: false }, at('11:00'), false).extraPercent, 10);
  assert.deepEqual(strategy.normalize(JSON.parse(JSON.stringify(c))), c);
});
check('latest realistic capacity 2600 minus 600', () => {
  const h = prepare(); assert.equal(h.plan.gridPowerW, 2000); assert.equal(h.plan.requiredHours, 1.5);
  assert.equal(h.plan.blocks[0].startAt, at('15:15')); assert.equal(h.plan.blocks[0].endAt, at('16:45'));
  assert.equal(h.result.plannedChargeW, 0); assert.equal(h.result.totalCommandW, 0);
  const go = engine.evaluate(h.state, h.settings, new Date(at('15:15')));
  assert.equal(go.totalCommandW, -2000); assert.equal(go.plannedChargeW, 2000);
});
check('P1 removes signed battery command once', () => {
  for (const last of [-2000, 0, 500]) {
    const h = prepare({}, { gridPowerW: 600 - last, lastTotalCommandW: last });
    assert.equal(h.plan.baselineW, 600); assert.equal(h.plan.gridPowerW, 2000);
  }
});
check('early, load/EV changes, existing grid restriction', () => {
  const h = prepare({ chargeStrategy: config('day', 'maximum', 'early') });
  assert.equal(h.plan.blocks[0].startAt, at('11:00')); assert.equal(h.result.totalCommandW, -2000);
  const ev = prepare({}, { gridPowerW: 1600 }); assert.equal(ev.plan.gridPowerW, 1000);
  assert.equal(ev.plan.blocks[0].startAt, at('13:45'));
  const less = prepare({}, { gridPowerW: 100 }); assert.equal(less.plan.gridPowerW, 2500);
  assert(less.plan.blocks[0].startAt >= at('15:30'));
  assert.equal(prepare({}, { plannedBatteryGridLimitW: 900 }).plan.gridPowerW, 900);
});
check('heterogeneous full and missing batteries cannot inflate capacity', () => {
  const s = { individualBatteryPowerLimitsEnabled: true, battery1CapacityKwh: 6, battery2CapacityKwh: 4,
    battery1MaxChargeW: 700, battery2MaxChargeW: 1300, peakLimitW: 10000,
    chargeStrategy: config('day', 'maximum', 'early') };
  const h = prepare(s); assert.equal(h.plan.batteryPowerW, 2000);
  assert(Math.abs(h.result.commands[0]) <= 700); assert(Math.abs(h.result.commands[1]) <= 1300);
  assert.equal(prepare(s, { batterySoc: [100, 50] }).plan.batteryPowerW, 1300);
  assert.equal(prepare(s, { batterySoc: [null, 50] }).plan.batteryPowerW, 1300);
  assert.equal(prepare(s, { batterySoc: [null, null] }).result.totalCommandW, 0);
  const taper = prepare({ peakLimitW: 10000 }, { batterySoc: [99, 50] });
  assert(taper.plan.requiredHours > taper.plan.needKwh * 1000 / taper.plan.gridPowerW, 'an almost-full battery cannot sustain its maximum for the entire block');
});
check('Peak Guard still intervenes between contexts in all modes', () => {
  const h = prepare({ chargeStrategy: config('day', 'maximum', 'early') });
  for (const forcedMode of ['auto', 'standby', 'manual_charge', 'self_consumption', 'avoid_import', 'solar_capture']) {
    const result = engine.evaluate({ ...h.state, gridPowerW: 5000, controlGridPowerW: 5000 }, { ...h.settings, forcedMode }, new Date(at('11:01')));
    if (['auto', 'standby', 'manual_charge'].includes(forcedMode)) assert.equal(result.override, 'peak_shave');
    assert(result.predictedGridW <= 2600, forcedMode);
  }
});
check('PV remains available while waiting and cancels grid need', () => {
  const h = prepare({}, { gridPowerW: -1000, controlGridPowerW: -1000, pvPowerW: 9000 });
  assert.equal(h.result.totalCommandW, -1000); assert.equal(h.result.gridChargeAssistW, 0);
  assert.equal(h.plan.gridPowerW, 2600); // 4000 hardware minus actual 1000 PV, capped by PG
  const partial = prepare({}, { batterySoc: [70, 70] }); assert.equal(partial.plan.needKwh, 1);
  const full = prepare({}, { batterySoc: [80, 80] }); assert.equal(full.plan.blocks.length, 0); assert.equal(full.result.plannedChargeW, 0);
  // Unknown/delayed inverter production cannot be promised as future power.
  const missing = prepare({}, { pvPowerW: null }); assert.equal(missing.plan.gridPowerW, 2000);
});
check('insufficient capacity, reserve failure and zero capacity', () => {
  const late = prepare({}, {}, at('16:00')); assert(late.plan.missingKwh > 0); assert(late.plan.reserveMissed);
  assert.match(late.result.statusText, /onvoldoende laadcapaciteit/);
  const reserve = prepare({}, {}, at('15:20')); assert.equal(reserve.plan.missingKwh, 0); assert(reserve.plan.reserveMissed);
  const zero = prepare({}, { gridPowerW: 3000 }); assert.equal(zero.plan.gridPowerW, 0); assert.equal(zero.plan.blocks.length, 0);
});
check('flat centre and active centre does not flap', () => {
  const s = { chargeStrategy: config('day', 'maximum', 'center') };
  const h = prepare(s); assert.equal(h.plan.blocks[0].startAt, at('13:15'));
  for (const time of ['11:05', '12:00', '13:10']) {
    const waiting = prepare(s, {}, at(time), null, h.plan);
    assert.equal(waiting.plan.blocks[0].startAt, at('13:15'), 'a flat-price midpoint must not roll forward');
  }
  const active = prepare(s, { batterySoc: [60, 60] }, at('13:45'), null, h.plan);
  assert.equal(active.plan.blocks[0].startAt, at('13:45')); assert.equal(active.result.totalCommandW, -2000);
});
check('dynamic real quarters, gaps, ties, negative prices', () => {
  const now = at('00:00'), rows = [];
  for (let t = now; t < now + 7 * H; t += Q) rows.push({ startMs: t, price: t === now + 3 * H ? -0.2 : 0.3 });
  const curve = prepareEvPriceCurve(rows, 'UTC', 15);
  const s = { contractType: 'dynamic_quarter', dynamicPriceDataReady: true,
    chargeStrategy: config('night'), dynamicPriceSlots: rows };
  const st = { nightPlanningActive: true };
  const h = prepare(s, st, now, curve);
  assert(h.plan.blocks[0].startAt <= now + 3 * H); assert(h.plan.blocks[0].endAt > now + 3 * H);
  assert.equal(h.plan.gridPowerW, 2000);
  assert(!Object.keys(h.plan).includes('priceKey'));
  assert(!('key' in h.result.chargeStrategy));
  assert(JSON.stringify(h.result.chargeStrategy).length < 2000, 'fast status must not contain a copied price fingerprint');
  const gap = { ...curve, fingerprint: 'gap', intervals: curve.intervals.filter(r => r.startAt < now + 2 * H || r.startAt >= now + 4 * H) };
  const g = prepare({ ...s, chargeStrategy: config('night', 'maximum', 'early') }, st, now, gap);
  assert(g.plan.blocks.length > 0);
  for (const b of g.plan.blocks) assert(b.endAt <= now + 2 * H || b.startAt >= now + 4 * H);
  assert.equal(prepare(s, st, now, null).plan.blocks.length, 0);
  assert.equal(prepare({ ...s, dynamicPriceDataReady: false }, st, now, curve).result.plannedChargeW, 0);
});
check('centering variable prices only with a full-block price advantage', () => {
  const now = at('00:00');
  function test(prices) {
    const rows = prices.map((price, i) => ({ startMs: now + i * Q, price }));
    return prepare({ contractType: 'dynamic_quarter', dynamicPriceDataReady: true, cheapHours: 3,
      chargeStrategy: config('night'), dynamicPriceSlots: rows }, { nightPlanningActive: true }, now,
      prepareEvPriceCurve(rows, 'UTC', 15));
  }
  const expensiveNeighbours = test(Array.from({ length: 28 }, (_, i) => i === 0 ? .01 : i < 6 ? .36 : .22));
  assert.equal(expensiveNeighbours.plan.mode, 'standard');
  assert.equal(expensiveNeighbours.plan.reason, 'standard_no_price_advantage');
  assert(expensiveNeighbours.plan.costComparison.centeredCost > expensiveNeighbours.plan.costComparison.standardCost);
  const spread = engine.evaluate(expensiveNeighbours.state, { ...expensiveNeighbours.settings, batteryChargeStrategyPlan: null }, new Date(now));
  assert.equal(expensiveNeighbours.result.plannedChargeW, spread.plannedChargeW);
  assert.equal(expensiveNeighbours.result.totalCommandW, spread.totalCommandW);
  const equal = test(Array(28).fill(.2)); assert.equal(equal.plan.mode, 'standard');
  assert.equal(equal.plan.costComparison.advantage, false);
  const good = test(Array.from({ length: 28 }, (_, i) => i === 14 ? -.2 : i >= 11 && i <= 17 ? .05 : .3));
  assert.equal(good.plan.mode, 'maximum'); assert(good.plan.costComparison.advantage);
  assert(good.plan.costComparison.centeredCost < good.plan.costComparison.standardCost);
});
check('TOU cheapest period without synthetic quarters', () => {
  const s = { contractType: 'tou', chargeStrategy: config('night'), touRates: [
    { id: 'low', name: 'Laag', importPrice: .1, nightChargeAllowed: true, dayChargeAllowed: false },
    { id: 'high', name: 'Hoog', importPrice: .3, nightChargeAllowed: true, dayChargeAllowed: false }],
    touSchedule: [{ rateId: 'high', start: '00:00', end: '02:00', days: 'all' },
      { rateId: 'low', start: '02:00', end: '06:00', days: 'all' },
      { rateId: 'high', start: '06:00', end: '00:00', days: 'all' }] };
  const h = prepare(s, { nightPlanningActive: true }, at('00:00'));
  assert.equal(h.plan.blocks[0].startAt, at('03:15'));
  assert.equal(h.plan.blocks[0].endAt, at('04:45')); assert(Math.abs(h.plan.blocks[0].price - .1) < 1e-9);
});
check('local midnight and both DST transitions', () => {
  for (const day of ['2026-03-29', '2026-10-25']) {
    const now = at('00:00', day, 'Europe/Brussels');
    const h = prepare({ timezone: 'Europe/Brussels', chargeStrategy: config('night'),
      fixedChargeWindowStart: '23:00', fixedChargeWindowEnd: '07:00' }, { nightPlanningActive: true }, now);
    assert(h.plan.blocks.length); assert(h.plan.blocks[0].startAt >= now);
    assert(h.plan.blocks[0].endAt <= h.plan.deadlineAt);
    assert.equal(h.plan.blocks[0].endAt - h.plan.blocks[0].startAt, 1.5 * H);
  }
});
check('fixed latest end and active setting changes preserve PV and limits', () => {
  const h = prepare({}, { batterySoc: [50.7, 50.7] });
  assert.equal(h.plan.blocks[0].endAt,at('16:45'));
  assert(Math.abs(h.plan.blocks[0].endAt-h.plan.blocks[0].startAt-h.plan.requiredHours*H)<2);
  assert(h.plan.blocks[0].endAt <= at('16:45'));
  const active = prepare({ chargeStrategy: config('day', 'maximum', 'early') });
  const switched = prepare({}, { lastTotalCommandW: -2000, gridPowerW: 2600, controlGridPowerW: 2600 }, at('11:05'), null, active.plan);
  assert.equal(switched.result.totalCommandW, 0); assert.equal(switched.plan.gridPowerW, 2000);
  const reset = prepare({ chargeStrategy: strategy.normalize() }, {}, at('11:05'), null, active.plan);
  assert.equal(reset.plan, null); assert(reset.result.plannedChargeW > 0);
});
check('night correction remains independent of the day and maximum position', () => {
  const now = at('00:00'), rows = Array.from({ length: 28 }, (_, i) => ({ startMs: now + i * Q, price: .2 }));
  const curve = prepareEvPriceCurve(rows, 'UTC', 15);
  const values = [];
  for (const extra of [0, 10, 100]) {
    const h = prepare({ contractType: 'dynamic_quarter', dynamicPriceDataReady: true, cheapHours: 3,
      chargeStrategy: config('night', 'standard', undefined, extra) }, { nightPlanningActive: true }, now, curve);
    values.push(h.result.plannedChargeW); assert.equal(h.result.planningChargeTargetSoc, 80);
  }
  assert.deepEqual(values, [1000, 1100, 2000]);
});
check('plan display agrees with runtime strategy', () => {
  const h = prepare(); const plan = engine.buildSocPlan(h.state, h.settings, new Date(at('11:00')));
  const row = plan.rows.find(r => r.plannedNetCharge);
  assert.equal(row.plannedChargeW, 2000); assert.equal(row.plannedStartAt, at('15:15'));
  assert.equal(row.plannedEndAt, at('16:45'));
});
console.log(`PASS charge strategy: ${groups} groups; 270 baseline engine/plan comparisons`);
