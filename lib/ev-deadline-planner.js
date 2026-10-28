'use strict';

// EV-only price intervals. Battery tariff classes and planning are deliberately
// not imported here. The cache holds plans, never live physical decisions.
const { localDateTimeUtcMs, inferIntervalMinutes } = require('./homey-energy');
const HOUR = 3600000;
const STABILITY_EUR = 0.02;
const finite = n => (typeof n === 'number' || typeof n === 'string' && n.trim() !== '') && Number.isFinite(Number(n));
const energy = (s, now, power) => Math.max(0, s.endAt - Math.max(now, s.startAt)) / HOUR * power / 1000;

function prepareEvPriceCurve(rows, timezone = 'UTC', fallbackMinutes = 15) {
  const minutes = inferIntervalMinutes(rows, fallbackMinutes);
  const unique = new Map();
  for (const row of rows || []) {
    if (!finite(row?.price)) continue;
    const startAt = finite(row.startMs) ? Number(row.startMs)
      : localDateTimeUtcMs(row.dateKey, `${Math.floor(Number(row.minute) / 60)}:${String(Number(row.minute) % 60).padStart(2, '0')}`, timezone);
    if (!finite(startAt)) continue;
    const explicitEnd = Date.parse(row.raw?.periodEnd || '');
    const endAt = Number.isFinite(explicitEnd) && explicitEnd > startAt
      ? Math.min(explicitEnd, startAt + minutes * 60000) : startAt + minutes * 60000;
    unique.set(startAt, { startAt, endAt, price: Number(row.price) });
  }
  const intervals = [...unique.values()].sort((a, b) => a.startAt - b.startAt);
  for (let i = 0; i < intervals.length - 1; i++) intervals[i].endAt = Math.min(intervals[i].endAt, intervals[i + 1].startAt);
  return { intervals, minutes,
    fingerprint: JSON.stringify(intervals.map(s => [s.startAt, s.endAt, s.price])) };
}

function cost(slots) { return slots.reduce((total, s) => total + s.kwh * s.price, 0); }
function fill(ordered, need) {
  const slots = [];
  for (const s of ordered) {
    if (need <= 0.000001) break;
    const kwh = Math.min(need, s.capacityKwh);
    if (kwh <= 0) continue;
    slots.push({ ...s, kwh, endAt: s.startAt + kwh / (s.powerW / 1000) * HOUR });
    need -= kwh;
  }
  return { slots: slots.sort((a, b) => a.startAt - b.startAt), missingKwh: Math.max(0, need) };
}

function optimize(intervals, args, previous) {
  const { now, deadlineAt, needKwh, powerW, limitsW, cheap, normal, expensive, cheapHours, expensiveHours } = args;
  const rows = intervals.filter(s => s.endAt > now && s.startAt < deadlineAt)
    .map(s => ({ ...s, startAt: Math.max(now, s.startAt), endAt: Math.min(deadlineAt, s.endAt) }));
  const byPrice = rows.slice().sort((a, b) => a.price - b.price || a.startAt - b.startAt);
  // With an active deadline, "cheap" means the cheapest required energy in
  // this EV window. Without cheap permission the configured normal/expensive
  // categories remain distinct, ranked over this window instead of each day.
  let cheapMinutes = 0, cheapEnergy = 0;
  const cheapKeys = new Set();
  for (const s of byPrice) {
    if (cheapMinutes >= cheapHours * 60 && (args.excludeExpensive || !cheap || cheapEnergy >= needKwh - 0.000001)) break;
    cheapKeys.add(s.startAt);
    cheapMinutes += (s.endAt - s.startAt) / 60000;
    cheapEnergy += energy(s, now, powerW);
  }
  const expensiveKeys = new Set(); let expensiveMinutes = 0;
  for (const s of byPrice.slice().reverse()) {
    if (expensiveMinutes >= expensiveHours * 60) break;
    expensiveKeys.add(s.startAt); expensiveMinutes += (s.endAt - s.startAt) / 60000;
  }
  const allowed = { cheap, normal, expensive };
  const onlyCheapCapacity = !args.excludeExpensive && cheap && !(normal && limitsW.normal > 0) && !(expensive && limitsW.expensive > 0);
  const candidates = rows.map(s => {
    const className = s.className || (onlyCheapCapacity || cheapKeys.has(s.startAt) ? 'cheap' : expensiveKeys.has(s.startAt) ? 'expensive' : 'normal');
    const watts = Math.min(powerW, args.rateLimitsW ? args.rateLimitsW[s.rateId || className] : limitsW[className]);
    return { ...s, className, powerW: watts, capacityKwh: energy(s, now, watts) };
  }).filter(s => (!args.excludeExpensive || s.className !== 'expensive') && (args.rateLimitsW ? s.allowed : allowed[s.className]) && s.capacityKwh > 0);
  let best = fill(candidates.slice().sort((a, b) => a.price - b.price || a.startAt - b.startAt), needKwh);
  // Prefer a contiguous feasible session for at most two cents extra in total.
  // Significant savings can still justify separate sessions. No fixed dwell
  // time may override a physical stop or an urgent deadline.
  if (best.missingKwh <= 0.000001) {
    const cheapestCost = cost(best.slots);
    let contiguous = null;
    for (let i = 0; i < candidates.length; i++) {
      let total = 0, j = i;
      for (; j < candidates.length; j++) {
        if (j > i && candidates[j].startAt > candidates[j - 1].endAt + 1) break;
        total += candidates[j].capacityKwh;
        if (total >= needKwh - 0.000001) {
          const proposal = fill(candidates.slice(i, j + 1), needKwh);
          if (cost(proposal.slots) <= cheapestCost + STABILITY_EUR
            && (!contiguous || cost(proposal.slots) < cost(contiguous.slots) - 0.000001)) contiguous = proposal;
          break;
        }
      }
    }
    if (contiguous) best = contiguous;
    // A small new price difference need not discard an already chosen plan.
    // Reprice and revalidate capacity against the NEW curve and constraints.
    if (previous) {
      const retained = [];
      for (const old of previous.slots) {
        for (const s of candidates) {
          const startAt = Math.max(s.startAt, old.startAt), endAt = Math.min(s.endAt, old.endAt);
          if (endAt <= startAt) continue;
          // Retain times only after validating NEW categories and meter limits.
          retained.push({ ...s, startAt, endAt,
            capacityKwh: (endAt - startAt) / HOUR * s.powerW / 1000 });
        }
      }
      const keep = fill(retained.sort((a, b) => a.startAt - b.startAt), needKwh);
      if (keep.missingKwh <= 0.000001 && cost(keep.slots) <= cheapestCost + STABILITY_EUR) best = keep;
    }
  }
  return { ...best, capacityKwh: candidates.reduce((n, s) => n + s.capacityKwh, 0),
    knownMinutes: rows.reduce((n, s) => n + (s.endAt - s.startAt) / 60000, 0) };
}

class EvDeadlinePlanner {
  constructor() { this.plans = new Map(); this.builds = 0; this.reuses = 0; }
  clear(index) { this.plans.delete(index); }
  evaluate(args) {
    const { index, now, curve, needKwh, powerW, maxPowerW, guarantee } = args;
    const deadlineAt = Math.floor(args.deadlineAt / 60000) * 60000;
    if (!Array.isArray(curve?.intervals) || (!curve.intervals.length && !args.allowUnknownHorizon) || !(deadlineAt > now) || !(needKwh > 0.001)) { this.clear(index); return null; }
    const pvCreditKwh = Math.min(Math.max(0, Number(args.pvCreditKwh) || 0), needKwh);
    const gridNeedKwh = Math.max(0, needKwh - pvCreditKwh);
    const key = JSON.stringify([args.signature, deadlineAt, powerW, maxPowerW,
      args.limitsW, args.cheap, args.normal, args.expensive, args.cheapHours, args.expensiveHours, guarantee, args.rateLimitsW, args.pvCreditKwh || 0, args.excludeExpensive]);
    let plan = this.plans.get(index);
    const remainingCapacity = plan?.slots.reduce((n, s) => n + energy(s, now, s.powerW), 0) || 0;
    const tolerance = Math.max(0.05, powerW / 1000 / 60) + 0.000001;
    const same = plan?.key === key && plan.curve === curve;
    const unchangedNeed = Math.abs((plan?.lastNeedKwh ?? -1) - gridNeedKwh) <= 0.000001;
    const stalledMissing = same && plan.missingKwh > 0.001 && unchangedNeed && now - plan.builtAt < 60000;
    if (!same || (!stalledMissing && Math.abs(remainingCapacity - gridNeedKwh) > tolerance)) {
      const previous = plan?.key === key ? plan : null;
      const calculate = () => optimize(curve.intervals, { ...args, needKwh:gridNeedKwh, deadlineAt }, previous);
      const optimized = typeof args.observeBuild === 'function' ? args.observeBuild(calculate) : calculate();
      plan = { ...optimized, key, curve, builtAt: now, lastNeedKwh: gridNeedKwh };
      this.plans.set(index, plan); this.builds++;
    } else this.reuses++;
    const current = plan.slots.find(s => s.startAt <= now && s.endAt > now);
    const availableKwh = plan.slots.reduce((n, s) => n + energy(s, now, s.powerW), 0);
    // Unknown prices have no cheap capacity. A guaranteed target can use them
    // only at its latest safe start; physical Peak Guard is still applied later.
    const latestStartAt = maxPowerW > 0 ? deadlineAt - needKwh / (maxPowerW / 1000) * HOUR - 300000 : now;
    const guaranteeNow = Boolean(guarantee) && now >= latestStartAt;
    let nextAt = deadlineAt;
    if (current) {
      // Price ticks and midnight need no EV wakeup inside an unchanged session.
      // The battery keeps its independent tariff/date/PV context boundaries.
      nextAt = current.endAt;
      for (const s of plan.slots) {
        if (s.startAt < current.endAt - 1) continue;
        if (Math.abs(s.startAt - nextAt) > 1 || s.className !== current.className || s.powerW !== current.powerW) break;
        nextAt = s.endAt;
      }
    } else {
      const next = plan.slots.find(s => s.startAt > now);
      if (next) nextAt = next.startAt;
    }
    if (guarantee && latestStartAt > now) nextAt = Math.min(nextAt, latestStartAt);
    return { selectedNow: Boolean(current), className: current?.className || null, rateId: current?.rateId || null, pvCreditKwh,
      powerW: current?.powerW || 0, selectedCapacityKwh: availableKwh + pvCreditKwh,
      targetReachable: maxPowerW > 0 && needKwh <= (deadlineAt - now) / HOUR * maxPowerW / 1000 + 0.001,
      targetReachableOnSelectedTariffs: needKwh <= availableKwh + pvCreditKwh + tolerance,
      guaranteeNow, nextAt: Math.max(now + 1, nextAt), deadlineAt,
      knownMinutes: plan.knownMinutes, missingKwh: plan.missingKwh,
      costEUR: cost(plan.slots), slots: plan.slots };
  }
}

module.exports = { EvDeadlinePlanner, prepareEvPriceCurve };
