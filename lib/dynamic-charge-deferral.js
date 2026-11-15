'use strict';

// 1.5.5: read-only, slow-context decision about postponing a *normal-price*
// grid-charge target past 07:00/17:00. The live battery feedback does no
// price ranking or scans. Only published, date-qualified tariff rows qualify.
const HOUR_MS = 3600000;
const PRICE_ADVANTAGE_EUR_KWH = 0.01;
const FUTURE_HEADROOM = 0.85;
const PEAK_CONSUMPTION_MARGIN = 1.15;
const EPS = 1e-6;
const finite = v => v !== null && v !== undefined && Number.isFinite(Number(v));

function planDynamicChargeDeferral({ rows, now, targetAt, nextTargetAt, targetSoc,
  soc, safetySoc, capacityKwh, powerW, expectedDailyKwh,
  normalChargeEnabled = false, normalMaxSoc = 50 }) {
  if (!(now < targetAt && targetAt < nextTargetAt) || !finite(soc) || !finite(targetSoc)
    || !finite(safetySoc) || !(capacityKwh > 0) || !(powerW > 0)
    || !Array.isArray(rows) || !rows.length || !(targetSoc > soc + 0.25)) return null;
  const timeline = rows.filter(r => finite(r?.startMs) && finite(r?.endMs) && finite(r?.price)
    && r.endMs > now && r.startMs < nextTargetAt)
    .sort((a, b) => a.startMs - b.startMs);
  const current = timeline.find(r => r.startMs <= now && r.endMs > now);
  // A price being merely lower is insufficient: it also needs a tariff class
  // that actually permits grid charging under the configured dynamic contract.
  if (!current || current.className !== 'normal') return null;
  const affordable = r => r.className === 'cheap'
    || r.className === 'normal' && normalChargeEnabled && targetSoc <= normalMaxSoc + EPS;
  let cheaper = null;
  let coveredUntil = now;
  for (const row of timeline) {
    const start = Math.max(now, Number(row.startMs));
    if (row.endMs <= coveredUntil) continue;
    if (start > coveredUntil + 1000) break; // Never assume unreported tariff intervals.
    if (start >= targetAt && affordable(row) && row.price <= current.price - PRICE_ADVANTAGE_EUR_KWH + EPS) {
      cheaper = row;
      break;
    }
    coveredUntil = Math.max(coveredUntil, Number(row.endMs));
  }
  if (!cheaper) return null;

  // All expensive blocks between NOW and the postponed charge must be covered.
  // This intentionally gives no credit for tomorrow's *uncertain* PV forecast.
  let expensiveHours = 0;
  for (const row of timeline) {
    if (row.startMs >= cheaper.startMs) break;
    if (row.className !== 'expensive') continue;
    expensiveHours += Math.max(0, Math.min(row.endMs, cheaper.startMs) - Math.max(row.startMs, now)) / HOUR_MS;
  }
  const peakKwh = Math.max(0, Number(expectedDailyKwh) || 0) / 24 * expensiveHours * PEAK_CONSUMPTION_MARGIN;
  const peakReserveSoc = Math.min(100, safetySoc + peakKwh / capacityKwh * 100);
  // An expensive period BEFORE the old deadline requires its reserve before
  // that period begins. The existing spread planner does not guarantee a
  // partial target by an earlier intermediate peak; do not falsely defer.
  if (timeline.some(r => r.className === 'expensive' && r.startMs < targetAt
    && r.endMs > now) && soc + EPS < peakReserveSoc) return null;

  // The remaining target cannot be postponed further than the documented
  // chargeable capacity after the current goal. Prices after a gap are unknown.
  let futureHours = 0;
  coveredUntil = cheaper.startMs;
  for (const row of timeline) {
    if (row.endMs <= cheaper.startMs) continue;
    const start = Math.max(cheaper.startMs, Number(row.startMs), coveredUntil);
    if (start > coveredUntil + 1000) break;
    const end = Math.min(nextTargetAt, Number(row.endMs));
    if (end > start && affordable(row) && row.price <= current.price - PRICE_ADVANTAGE_EUR_KWH + EPS) {
      futureHours += (end - start) / HOUR_MS;
    }
    coveredUntil = Math.max(coveredUntil, end);
    if (coveredUntil >= nextTargetAt) break;
  }
  const futureCapacityKwh = futureHours * powerW / 1000 * FUTURE_HEADROOM;
  if (futureCapacityKwh < 0.1) return null;
  const totalNeedKwh = Math.max(0, (targetSoc - soc) * capacityKwh / 100);
  // If later cheap charging cannot deliver the full amount, preload only the
  // shortfall (plus expensive-period reserve) before the original deadline.
  const requiredPreloadSoc = Math.max(safetySoc, peakReserveSoc,
    // Planned expensive-period discharge is spent before the deferred cheap
    // charge, so it must ALSO be included in the future energy balance.
    soc + Math.max(0, totalNeedKwh + peakKwh - futureCapacityKwh) / capacityKwh * 100);
  const preloadTargetSoc = Math.min(targetSoc, requiredPreloadSoc);
  // No meaningful room to defer: retain the original charging target.
  if (!(preloadTargetSoc < targetSoc - 0.5)) return null;

  return {
    active: true, startAt: now, deadlineAt: targetAt, nextTargetAt,
    cheaperAt: cheaper.startMs, priceNow: current.price, cheaperPrice: cheaper.price,
    preloadTargetSoc: Math.round(preloadTargetSoc * 100) / 100,
    originalTargetSoc: targetSoc,
    peakReserveSoc: Math.round(peakReserveSoc * 100) / 100,
    peakDemandKwh: Math.round(peakKwh * 100) / 100,
    futureCapacityKwh: Math.round(futureCapacityKwh * 100) / 100,
    expensiveHours: Math.round(expensiveHours * 100) / 100,
  };
}

module.exports = { planDynamicChargeDeferral };
