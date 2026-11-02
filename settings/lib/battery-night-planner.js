'use strict';

// Battery-only charging windows. Public daily tariff classes and EV policy are
// intentionally not changed. All sorting/selection happens in the slow context.
const HOUR = 3600000;
const EPS = 0.000001;
const STABILITY_EUR = 0.02;
const HEADROOM = 0.9;
const remainingHours = (rows, now) => rows.reduce((sum, r) =>
  sum + Math.max(0, r.endAt - Math.max(now, r.startAt)) / HOUR, 0);
const averagePrice = (rows, now) => {
  const hours = remainingHours(rows, now);
  return hours > 0 ? rows.reduce((sum, r) => sum + r.price
    * Math.max(0, r.endAt - Math.max(now, r.startAt)) / HOUR, 0) / hours : 0;
};

function indexed(rows) {
  const suffixMs = new Array(rows.length + 1).fill(0);
  for (let i = rows.length - 1; i >= 0; i--) suffixMs[i] = suffixMs[i + 1] + rows[i].endAt - rows[i].startAt;
  return { rows, suffixMs };
}

// O(log n), no price scans, sorts, timezone work or planning in the P1 path.
function available(index, now) {
  const { rows, suffixMs } = index;
  let low = 0, high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid].endAt <= now) low = mid + 1;
    else high = mid;
  }
  const row = rows[low];
  const hours = row ? (suffixMs[low] - Math.max(0, now - row.startAt)) / HOUR : 0;
  return { hours, row, active: Boolean(row && now >= row.startAt) };
}

function nightPolicy(plan, now) {
  if (!plan) return null;
  const expired = now >= plan.deadlineAt || now < plan.createdAt;
  const cheap = available(plan.cheapIndex, now), normal = available(plan.normalIndex, now);
  const current = cheap.active ? cheap : normal.active ? normal : null;
  const className = cheap.active ? 'cheap' : normal.active ? 'normal' : null;
  // Like existing battery plans, update minimum charging power per minute.
  // Second-by-second clock drift must not defeat the stable-P1 feedback memo.
  const rateAt = Math.max(plan.createdAt, Math.floor(now / 60000) * 60000);
  const rateHours = className === 'cheap' ? available(plan.cheapIndex, rateAt).hours
    : className === 'normal' ? available(plan.normalIndex, rateAt).hours : 0;
  const nextStart = Math.min(...[cheap.row?.startAt, normal.row?.startAt, plan.deadlineAt].filter(t => t > now));
  return {
    eligibleNow: !expired && Boolean(current),
    className,
    remainingHours: expired ? 0 : rateHours,
    nextAt: expired ? 0 : current ? Math.min(current.row.endAt, plan.deadlineAt) : nextStart,
    deadlineAt: plan.deadlineAt,
  };
}

function merge(rows) {
  const out = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.endAt === row.startAt && last.className === row.className) {
      const duration = row.endAt - row.startAt, oldDuration = last.endAt - last.startAt;
      last.price = (last.price * oldDuration + row.price * duration) / (oldDuration + duration);
      last.endAt = row.endAt;
    } else out.push({ ...row });
  }
  return out;
}

class BatteryNightPlanner {
  constructor() { this.window = null; this.plan = null; this.windowBuilds = 0; this.builds = 0; this.reuses = 0; }

  evaluate(args) {
    const { curve, now, deadlineAt, startAt, needKwh, targetSoc, powerW, cheapHours,
      expensiveHours, normalEnabled, normalMaxSoc } = args;
    if (!curve) { this.plan = null; return null; }
    const key = JSON.stringify([startAt, deadlineAt, cheapHours,
      expensiveHours, normalEnabled, normalMaxSoc]);
    let changed = false;
    if (!this.window || this.window.key !== key || this.window.curve !== curve) {
      // A real early sunset may activate the night before solarTargetTime.
      // The phase's calendar identity stays fixed; usable prices start NOW.
      const rows = curve.intervals.filter(r => r.endAt > now && r.startAt < deadlineAt)
        .map(r => ({ ...r, startAt: Math.max(r.startAt, now), endAt: Math.min(r.endAt, deadlineAt) }));
      const surviving = this.window?.key === key ? this.window.rows.filter(r => r.endAt > now)
        .map(r => ({ ...r, startAt: Math.max(now, r.startAt) })) : null;
      // Prices outside this deadline and removed past intervals are irrelevant.
      // Compare only on a real publication, never on ordinary P1/SoC progress.
      if (surviving && JSON.stringify(surviving) === JSON.stringify(rows)) this.window.curve = curve;
      else {
        this.window = { key, curve, rows, ranked: rows.slice().sort((a, b) => a.price - b.price || a.startAt - b.startAt) };
        this.windowBuilds++;
        changed = true;
      }
    }
    const old = this.plan;
    const compatible = old && old.deadlineAt === deadlineAt && old.startAt === startAt && now >= old.createdAt
      && old.cheapHours === cheapHours && old.expensiveHours === expensiveHours
      && old.normalEnabled === normalEnabled && old.normalMaxSoc === normalMaxSoc;
    const oldHours = compatible ? remainingHours(old.cheapRows, now) : 0;
    const targetChanged = !compatible || Math.abs(targetSoc - old.targetAnchorSoc) >= 2 - EPS;
    const powerChanged = !compatible || Math.abs(powerW - old.powerW) > Math.max(100, old.powerW * 0.1);
    // Ordinary progress consumes energy and time together. It must not roll a
    // fresh cheapHours quota forward or replace the chosen windows at midnight.
    const enough = compatible && needKwh <= oldHours * powerW / 1000 * HEADROOM + 0.05;
    if (!changed && compatible && !targetChanged && !powerChanged && (enough || needKwh <= EPS || old.unreachable && old.powerW === powerW)) {
      this.reuses++;
      return this.snapshot(old, args);
    }

    const live = this.window.ranked.filter(r => r.endAt > now);
    const totalHours = remainingHours(live, now);
    const requiredHours = powerW > 0 ? needKwh * 1000 / powerW : 0;
    // Prefer 10% delivery headroom for forecast corrections. Use full available
    // power rather than miss a feasible deadline when that headroom cannot fit.
    const withHeadroom = requiredHours / HEADROOM;
    const desiredHours = Math.max(Math.max(0.25, Math.min(12, cheapHours)),
      withHeadroom <= totalHours + EPS ? withHeadroom : requiredHours);
    const selected = new Set();
    let hours = 0;
    for (const row of live) {
      if (hours >= desiredHours - EPS) break;
      selected.add(row.startAt);
      hours += Math.max(0, row.endAt - Math.max(now, row.startAt)) / HOUR;
    }
    const expensive = new Set(); let expensiveMinutes = 0;
    for (let i = this.window.ranked.length - 1; i >= 0; i--) {
      if (expensiveMinutes >= Math.max(0.25, Math.min(12, expensiveHours)) * 60) break;
      const row = this.window.ranked[i];
      if (row.endAt <= now) continue;
      expensive.add(row.startAt); expensiveMinutes += (row.endAt - Math.max(now, row.startAt)) / 60000;
    }
    let cheapRows = this.window.rows.filter(r => selected.has(r.startAt));
    // Near-equal scattered quarters should not create avoidable battery starts.
    // Allow at most two cents total extra for one contiguous, feasible window.
    if (needKwh > EPS && hours >= desiredHours - EPS) {
      const cheapestCost = averagePrice(cheapRows, now) * needKwh;
      const chronological = this.window.rows.filter(r => r.endAt > now);
      let contiguous = null, bestCost = Infinity;
      for (let i = 0; i < chronological.length; i++) {
        let duration = 0;
        for (let j = i; j < chronological.length; j++) {
          if (j > i && chronological[j].startAt > chronological[j - 1].endAt) break;
          duration += Math.max(0, chronological[j].endAt - Math.max(now, chronological[j].startAt)) / HOUR;
          if (duration >= desiredHours - EPS) {
            const candidate = chronological.slice(i, j + 1), price = averagePrice(candidate, now) * needKwh;
            if (price <= cheapestCost + STABILITY_EUR && price < bestCost - EPS) {
              contiguous = candidate; bestCost = price;
            }
            break;
          }
        }
      }
      if (contiguous) cheapRows = contiguous;
    }
    // A genuinely cheaper publication may move the plan; a tiny change may not
    // interrupt an otherwise feasible session. Check actual surviving intervals.
    if ((changed || powerChanged) && compatible && !targetChanged && enough) {
      const mapped = old.cheapRows.filter(r => r.endAt > now).map(r => this.window.rows.find(n =>
        n.startAt <= Math.max(now, r.startAt) && n.endAt >= r.endAt));
      const retained = [...new Set(mapped.filter(Boolean))];
      const oldCost = averagePrice(retained, now) * needKwh;
      const newCost = averagePrice(cheapRows, now) * needKwh;
      if (mapped.every(Boolean) && remainingHours(retained, now) * powerW / 1000 >= needKwh - EPS
        && oldCost <= newCost + STABILITY_EUR) cheapRows = retained;
    }
    const cheapKeys = new Set(cheapRows.map(r => r.startAt));
    const normalRows = normalEnabled ? this.window.rows.filter(r => r.endAt > now
      && !cheapKeys.has(r.startAt) && !expensive.has(r.startAt)) : [];
    const rows = merge(this.window.rows.filter(r => cheapKeys.has(r.startAt) || normalRows.includes(r))
      .map(r => ({ ...r, className: cheapKeys.has(r.startAt) ? 'cheap' : 'normal' })));
    const plan = { key, createdAt: now, startAt, deadlineAt, targetAnchorSoc: targetSoc,
      cheapHours, expensiveHours, normalEnabled, normalMaxSoc, powerW, cheapRows,
      cheapIndex: indexed(merge(cheapRows.map(r => ({ ...r, className: 'cheap' })))),
      normalIndex: indexed(merge(normalRows.map(r => ({ ...r, className: 'normal' })))), rows,
      unreachable: needKwh > remainingHours(cheapRows, now) * powerW / 1000 + EPS };
    this.plan = plan;
    this.builds++;
    return this.snapshot(plan, args);
  }

  snapshot(plan, args) {
    const capacityKwh = remainingHours(plan.cheapRows, args.now) * args.powerW / 1000;
    return { ...plan, needKwh: args.needKwh, targetSoc: args.targetSoc, powerW: args.powerW,
      missingKwh: Math.max(0, args.needKwh - capacityKwh), targetReachable: args.needKwh <= capacityKwh + EPS };
  }
}

module.exports = { BatteryNightPlanner, nightPolicy };
