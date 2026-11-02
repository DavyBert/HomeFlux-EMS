'use strict';
const assert = require('node:assert/strict');
const { EvDeadlinePlanner, prepareEvPriceCurve } = require('../lib/ev-deadline-planner');
const { localParts, localDateTimeUtcMs } = require('../lib/homey-energy');
const { calculateEvDecision } = require('../lib/flexible-loads');
const ZONE = 'Europe/Brussels', Q = 900000, HOUR = 3600000;
const at = (day, time) => localDateTimeUtcMs(day, time, ZONE);
function rows(begin, end, price) {
  const result = [];
  for (let startMs = begin; startMs < end; startMs += Q) {
    const p = localParts(new Date(startMs), ZONE);
    result.push({ startMs, dateKey: p.dateKey, minute: p.minuteOfDay,
      price: typeof price === 'function' ? price(startMs, p) : price });
  }
  return result;
}
const begin = at('2026-10-23', '18:00'), end = at('2026-10-24', '07:00');
const gerrit = rows(at('2026-10-23', '00:00'), at('2026-10-25', '00:00'), (t, p) =>
  p.dateKey === '2026-10-23' ? p.minuteOfDay >= 1365 ? .30 : .45
    : p.minuteOfDay < 420 ? .20 : p.minuteOfDay >= 720 && p.minuteOfDay < 795 ? .10 : .40);
const curve = prepareEvPriceCurve(gerrit, ZONE, 15);
function args(extra = {}) {
  return { index: 0, now: begin, deadlineAt: end, needKwh: 11.5, powerW: 4600, maxPowerW: 4600,
    limitsW: { cheap: 4600, normal: 4600, expensive: 4600 }, cheap: true, normal: false, expensive: false,
    cheapHours: 1.25, expensiveHours: 3, curve, guarantee: true, signature: 'goal-1', ...extra };
}
let passed = 0;
function check(name, run) { run(); passed++; }
check('Gerrit: cheapest energy before deadline across midnight', () => {
  const p = new EvDeadlinePlanner(), first = p.evaluate(args());
  assert(!first.selectedNow); assert.equal(first.slots[0].startAt, at('2026-10-24', '00:00'));
  assert.equal(first.slots.length, 10); assert(Math.abs(first.costEUR - 2.3) < 1e-9);
  const night = p.evaluate(args({ now: at('2026-10-24', '00:00') }));
  assert(night.selectedNow); assert.equal(night.className, 'cheap'); assert.equal(p.builds, 1);
  assert.equal(night.nextAt, at('2026-10-24', '02:30'), 'no wakeups at unchanged quarter or date boundaries');
  assert(night.slots.every(s => s.endAt <= end));
});
check('same-day deadline', () => {
  const p = new EvDeadlinePlanner().evaluate(args({ deadlineAt: at('2026-10-23', '23:45'), needKwh: 4.6 }));
  assert.equal(p.slots[0].startAt, at('2026-10-23', '22:45')); assert(p.targetReachable);
});
check('unknown quarters never have free capacity', () => {
  const c = prepareEvPriceCurve(gerrit.filter(r => r.dateKey === '2026-10-23'), ZONE);
  const p = new EvDeadlinePlanner().evaluate(args({ curve: c, needKwh: 32.2 }));
  assert(p.missingKwh > 0); assert(p.slots.every(s => s.startAt < at('2026-10-24', '00:00')));
  assert(p.costEUR > 0); assert(!p.guaranteeNow);
  const urgent = new EvDeadlinePlanner().evaluate(args({ curve: c, now: end - HOUR, needKwh: 9.2 }));
  assert(urgent.guaranteeNow); assert(!urgent.targetReachable);
  const noPermission = new EvDeadlinePlanner().evaluate(args({ curve: c, now: end - HOUR, needKwh: 9.2, guarantee: false }));
  assert(!noPermission.guaranteeNow);
});
check('two calendar boundaries and late publication', () => {
  const far = at('2026-10-25', '07:00'), p = new EvDeadlinePlanner();
  const old = p.evaluate(args({ deadlineAt: far, needKwh: 36.8 })); assert(old.targetReachable);
  const updated = prepareEvPriceCurve([...gerrit, ...rows(at('2026-10-25', '00:00'), far, .05)], ZONE);
  const fresh = p.evaluate(args({ deadlineAt: far, needKwh: 36.8, curve: updated }));
  assert.equal(p.builds, 2); assert(fresh.slots.some(s => s.price === .05));
  assert(fresh.slots.every(s => s.endAt <= far));
});
check('unchanged feedback and day do not sort again', () => {
  const p = new EvDeadlinePlanner(); for (let s = 0; s < 180; s++) p.evaluate(args({ now: at('2026-10-23', '23:58') + s * 1000 }));
  // This loop crosses the selected start; unchanged energy feedback eventually
  // needs a real correction, but never one rebuild per P1/status sample.
  assert(p.builds <= 2); assert(p.reuses >= 178);
});
check('SoC/kWh goal revisions and completion', () => {
  const p = new EvDeadlinePlanner(); p.evaluate(args());
  const more = p.evaluate(args({ needKwh: 23, signature: 'goal-2' }));
  assert.equal(p.builds, 2); assert(more.slots.reduce((n, s) => n + s.kwh, 0) >= 22.9999);
  const less = p.evaluate(args({ needKwh: 4.6, signature: 'goal-3' })); assert.equal(p.builds, 3);
  assert(Math.abs(less.slots.reduce((n, s) => n + s.kwh, 0) - 4.6) < 1e-8);
  assert.equal(p.evaluate(args({ needKwh: 0 })), null); assert(!p.plans.has(0));
});
check('price hysteresis and substantial savings', () => {
  const p = new EvDeadlinePlanner(); const old = p.evaluate(args({ needKwh: 4.6 }));
  const change = delta => prepareEvPriceCurve(gerrit.map(r => ({ ...r, price: r.startMs >= at('2026-10-24', '04:00') && r.startMs < at('2026-10-24', '05:00') ? .20 - delta : r.price })), ZONE);
  const small = p.evaluate(args({ needKwh: 4.6, curve: change(.001) }));
  assert.equal(small.slots[0].startAt, old.slots[0].startAt);
  const big = p.evaluate(args({ needKwh: 4.6, curve: change(.10) }));
  assert.equal(big.slots[0].startAt, at('2026-10-24', '04:00'));
});
check('near-equal scattered prices prefer one session', () => {
  const c = prepareEvPriceCurve(rows(begin, begin + 3 * HOUR, t => (t - begin) / Q % 2 ? .101 : .10), ZONE);
  const p = new EvDeadlinePlanner().evaluate(args({ curve: c, deadlineAt: begin + 3 * HOUR, needKwh: 6.9 }));
  let starts = 0, prev = null; for (const s of p.slots) { if (!prev || prev.endAt < s.startAt - 1) starts++; prev = s; }
  assert.equal(starts, 1);
});
check('DST: 100 and 92 absolute quarters; repeated hour prices distinct', () => {
  for (const [date, next, count] of [['2026-10-25', '2026-10-26', 100], ['2026-03-29', '2026-03-30', 92]]) {
    const rs = rows(at(date, '00:00'), at(next, '00:00'), .4), c = prepareEvPriceCurve(rs, ZONE);
    assert.equal(c.intervals.length, count); assert.equal(new Set(c.intervals.map(s => s.startAt)).size, count);
  }
  const rs = rows(at('2026-10-25', '00:00'), at('2026-10-25', '07:00'), t => t >= Date.parse('2026-10-25T01:00:00Z') && t < Date.parse('2026-10-25T02:00:00Z') ? .01 : .9);
  const c = prepareEvPriceCurve(rs, ZONE), p = new EvDeadlinePlanner();
  const first = p.evaluate(args({ curve: c, now: Date.parse('2026-10-25T00:00:00Z'), deadlineAt: at('2026-10-25', '07:00'), needKwh: 4.6 }));
  assert(!first.selectedNow); assert.equal(first.slots[0].startAt, Date.parse('2026-10-25T01:00:00Z'));
});
check('missing prices and invalid data do not fabricate zero prices', () => {
  const c = prepareEvPriceCurve([{startMs:begin,price:null},{startMs:begin+Q,price:''},{startMs:begin+2*Q,price:0}], ZONE);
  assert.equal(c.intervals.length, 1); assert.equal(c.intervals[0].price, 0);
  assert.equal(new EvDeadlinePlanner().evaluate(args({ curve: prepareEvPriceCurve([], ZONE) })), null);
});
check('configured permission and zero import ceiling respected', () => {
  const p = new EvDeadlinePlanner().evaluate(args({ cheap: false, normal: false, expensive: false, guarantee: false }));
  assert.equal(p.slots.length, 0); assert(!p.selectedNow); assert(!p.guaranteeNow);
  const zero = new EvDeadlinePlanner().evaluate(args({ limitsW: { cheap: 0, normal: 0, expensive: 0 }, guarantee: false }));
  assert.equal(zero.slots.length, 0);
});
check('mixed permissions retain normal capacity with a zero cheap budget', () => {
  const p = new EvDeadlinePlanner().evaluate(args({ normal: true, limitsW: { cheap: 0, normal: 4600, expensive: 0 }, guarantee: false }));
  assert(p.slots.length > 0); assert(p.slots.every(s => s.className === 'normal')); assert(p.missingKwh <= 0.001);
});
check('hysteresis revalidates forbidden categories after price changes', () => {
  const planner = new EvDeadlinePlanner();
  const old = planner.evaluate(args({cheap:false,normal:true,guarantee:false}));
  const changedAt = old.slots[0].startAt;
  const revised = prepareEvPriceCurve(gerrit.map(r=>({...r,price:r.startMs===changedAt?.199:r.price})),ZONE);
  const fresh = planner.evaluate(args({cheap:false,normal:true,guarantee:false,curve:revised}));
  assert(!fresh.slots.some(s=>s.startAt<=changedAt&&s.endAt>changedAt),'a retained normal slot cannot become a forbidden cheap slot');
});
check('helper uses plan without legacy tariff scans, retains PV and Peak Guard', () => {
  let scans = 0;
  const settings = { contractType:'dynamic_quarter', timezone:ZONE, evEnabled:true, evSocEnabled:false,
    evEnergyPlanActive:true, evEnergyNeedKwh:11.5, evEnergyDeadlineAt:end, evGuaranteeTarget:true,
    evAllowUnselectedTariffForDeadline:true, evPhases:1, evVoltage:230, evVoltageReference:'phase',
    evMinCurrentA:6, evMaxCurrentA:20, evStandardCurrentA:20, evDynamicCheapEnabled:true,
    evPvStartSurplusW:1000, evPvGridTopUpMode:'off' };
  const decision = (extra = {}) => calculateEvDecision({ settings, connected:true, now:new Date(begin),
    tariff:{className:'cheap'}, gridPowerW:500, observeTariffScan:f=>{scans++;return f();},
    planDeadline:()=>({ selectedNow:false, selectedCapacityKwh:11.5, targetReachable:true, guaranteeNow:false, nextAt:end }), ...extra });
  assert(!decision().allowed); assert(decision({gridPowerW:-3000}).allowed); assert.equal(scans, 0);
  const limited = decision({settings:{...settings,peakShaveEnabled:true,peakLimitW:2500,peakSoftMarginW:0},
    planDeadline:()=>({selectedNow:true,powerW:4600,selectedCapacityKwh:11.5,targetReachable:true,nextAt:end})});
  assert(limited.desiredPowerW<=2000); assert(limited.peakLimited);
});
console.log(`1.1.17 deadline planner: ${passed} scenario groups passed.`);
module.exports = { gerrit, begin, end, rows, at, ZONE };
