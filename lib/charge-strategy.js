'use strict';

// Called by the existing slow context only. Fast control reads the resulting
// small schedule; it never ranks prices or determines a new charging window.
const HOUR = 3600000, RESERVE = 15 * 60000;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
function normalize(config = {}) {
  const result = { seasonal: config?.seasonal === true };
  for (const profile of ['year', 'summer', 'winter']) {
    result[profile] = {};
    for (const phase of ['day', 'night']) {
      const value = config?.[profile]?.[phase];
      result[profile][phase] = {
        mode: value?.mode === 'maximum' ? 'maximum' : 'standard',
        extraPercent: Math.max(0, Math.min(100, number(value?.extraPercent))),
        position: ['early', 'latest', 'center'].includes(value?.position) ? value.position : phase === 'night' ? 'center' : 'latest',
      };
    }
  }
  return result;
}
function select(settings, now, night) {
  const config = normalize(settings.chargeStrategy);
  const month = config.seasonal ? Number(new Intl.DateTimeFormat('en', { timeZone: settings.timezone || 'UTC', month: 'numeric' }).format(new Date(now))) : 0;
  // Selected reserve months are winter; the other months are summer. This
  // deliberately does not depend on enabling either minimum-SoC feature.
  const profile = config.seasonal ? (settings[`peakReserveMonth${month}`] ? 'winter' : 'summer') : 'year';
  const phase = night ? 'night' : 'day';
  return { ...config[profile][phase], profile, phase };
}
function spansFor(rows) {
  const spans = [];
  for (const row of rows) {
    const last = spans[spans.length - 1];
    if (last && row.startAt <= last.endAt) last.endAt = Math.max(last.endAt, row.endAt);
    else spans.push({ startAt: row.startAt, endAt: row.endAt });
  }
  return spans;
}
function take(spans, duration, reverse = false) {
  const blocks = [];
  for (const span of reverse ? spans.slice().reverse() : spans) {
    const ms = Math.min(duration, span.endAt - span.startAt);
    if (ms > 0) blocks.push(reverse ? { startAt: span.endAt - ms, endAt: span.endAt }
      : { startAt: span.startAt, endAt: span.startAt + ms });
    duration -= ms;
    if (duration <= 0) break;
  }
  return blocks.sort((a, b) => a.startAt - b.startAt);
}
function build(inputs, previous = null) {
  const { now, startAt, deadlineAt, needKwh, gridPowerW, choice, targetSoc } = inputs;
  if (choice.mode === 'standard' && choice.extraPercent === 0) return null;
  const plan = { createdAt: now, startAt, deadlineAt, phase: choice.phase, profile: choice.profile,
    mode: choice.mode, extraPercent: choice.extraPercent, position: choice.position, targetSoc,
    needKwh, gridPowerW, batteryPowerW: inputs.batteryPowerW, pvPowerW: inputs.pvPowerW,
    baselineW: inputs.baselineW, blocks: [], missingKwh: 0, reserveMissed: false };
  if (choice.mode === 'standard') return plan;
  const rows = (inputs.rows || []).filter(r => Number.isFinite(r.price) && r.endAt > now && r.startAt < deadlineAt)
    .map(r => ({ startAt: Math.max(now, startAt, r.startAt), endAt: Math.min(deadlineAt, r.endAt), price: r.price,
      anchorStartAt: Math.max(startAt, r.startAt), anchorEndAt: Math.min(deadlineAt, r.endAt) }))
    .filter(r => r.endAt > r.startAt).sort((a, b) => a.startAt - b.startAt);
  const spans = spansFor(rows);
  const duration = gridPowerW > 0 ? Math.max(Math.max(0, needKwh) * HOUR * 1000 / gridPowerW, (inputs.requiredHours || 0) * HOUR) : Infinity;
  plan.requiredHours = duration / HOUR;
  const key = JSON.stringify([startAt, deadlineAt, choice]);
  plan.key = key;
  // Keep the existing immutable price fingerprint by reference, privately.
  // Never copy a complete price curve into fast status publications.
  Object.defineProperty(plan, 'priceKey', { value: inputs.priceKey });
  if (needKwh <= 0 || !spans.length || gridPowerW <= 0) {
    plan.missingKwh = Math.max(0, needKwh);
    plan.reason = needKwh <= 0 ? 'target_reached' : !spans.length ? 'no_valid_prices_or_window' : 'no_grid_capacity';
    return plan;
  }
  // Once charging has started, do not move a shrinking remainder to the right
  // of the price centre on each context pass. PV can still finish/cancel it.
  const continuing = previous?.key === key && previous.priceKey === inputs.priceKey && previous.blocks.some(b => b.startAt <= now && b.endAt >= now)
    && Math.abs(previous.targetSoc - targetSoc) < 0.25;
  if (choice.position === 'early' || continuing && choice.position !== 'latest') plan.blocks = take(spans, duration);
  else if (choice.position === 'latest') {
    const finishAt = spans[spans.length - 1].endAt - RESERVE;
    plan.reserveEndAt = finishAt;
    const reserved = spans.map(s => ({ startAt: s.startAt, endAt: Math.min(s.endAt, finishAt) })).filter(s => s.endAt > s.startAt);
    const reservedMs = reserved.reduce((sum, s) => sum + s.endAt - s.startAt, 0);
    plan.reserveMissed = duration > reservedMs + 1;
    plan.blocks = take(plan.reserveMissed ? spans : reserved, duration, !plan.reserveMissed);
  } else {
    // Dynamic rows are the actual published intervals; TOU rows are actual
    // tariff periods, never synthetic quarter prices. Equal adjacent rates
    // form one period, so flat contracts centre in the entire window.
    let cheapest = rows[0];
    const periods = [];
    for (const row of rows) {
      const last = periods[periods.length - 1];
      if (!inputs.dynamic && last?.price === row.price && last.endAt === row.startAt) { last.endAt = row.endAt; last.anchorEndAt = row.anchorEndAt; }
      else periods.push({ ...row });
    }
    for (const row of periods) if (row.price < cheapest.price) cheapest = row;
    if (!inputs.dynamic) cheapest = periods.find(r => r.price === cheapest.price);
    const middle = (cheapest.anchorStartAt + cheapest.anchorEndAt) / 2;
    const fitting = spans.filter(s => s.endAt - s.startAt >= duration);
    // Prefer the span containing the cheapest quarter; if an input gap makes
    // that impossible, use the nearest sufficiently long valid span.
    const span = fitting.sort((a, b) => Math.abs(Math.max(a.startAt, Math.min(a.endAt, middle)) - middle)
      - Math.abs(Math.max(b.startAt, Math.min(b.endAt, middle)) - middle))[0];
    if (span) {
      const begin = Math.max(span.startAt, Math.min(span.endAt - duration, middle - duration / 2));
      plan.blocks = [{ startAt: begin, endAt: begin + duration }];
    } else plan.blocks = take(spans, duration); // gaps: never invent missing prices
  }
  // Start no later than the last slow context preceding the calculated time.
  // This only advances starts, preserves tariff/window boundaries, and covers
  // the existing cadence without another timer or heartbeat planning.
  const cadence = Math.max(15000, Math.min(300000, inputs.contextMs || 300000));
  for (const block of plan.blocks) {
    // Latest charging keeps its absolute end (window end minus 15 minutes),
    // including during replanning. The existing app context timer wakes at
    // the exact block boundary; rounding both ends would move this anchor.
    if (choice.position === 'latest') continue;
    const span = spans.find(s => s.startAt <= block.startAt && s.endAt >= block.endAt);
    const aligned = now + Math.floor((block.startAt - now) / cadence) * cadence;
    const shift = block.startAt - Math.max(span?.startAt || block.startAt, aligned);
    block.startAt -= shift;
    block.endAt -= shift;
  }
  if (choice.position === 'latest' && plan.blocks.at(-1)?.endAt > spans.at(-1).endAt - RESERVE + 1) plan.reserveMissed = true;
  for (const block of plan.blocks) {
    let cost = 0;
    for (const row of rows) cost += Math.max(0, Math.min(block.endAt, row.endAt) - Math.max(block.startAt, row.startAt)) * row.price;
    block.price = cost / (block.endAt - block.startAt);
  }
  const capacity = plan.blocks.reduce((sum, b) => sum + (b.endAt - b.startAt) / duration * needKwh, 0);
  plan.missingKwh = Math.max(0, needKwh - capacity);
  plan.reason = plan.missingKwh > 0.000001 ? 'insufficient_capacity' : plan.reserveMissed ? 'reserve_unreachable' : 'scheduled';
  return plan;
}
// Constant-size policy lookup, no planning, forecasting, prices or allocations.
function policy(plan, now, night) {
  if (!plan || plan.phase !== (night ? 'night' : 'day') || now < plan.createdAt || now >= plan.deadlineAt) return null;
  const { key, ...summary } = plan;
  return { ...summary, active: plan.blocks.some(b => now >= b.startAt && now < b.endAt) };
}
module.exports = { normalize, select, build, policy };
