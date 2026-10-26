'use strict';

// Called only by refreshPlanningInContext, before the optional buildSocPlan.
// This module never schedules work, reads devices, or changes a control input.
const { computeAverageSoc, computeEffectiveCapacityKwh, parseTime } = require('./ems-engine');
const { localParts, shiftDateKey, localDateTimeUtcMs } = require('./homey-energy');
const HOUR = 3600000;
const BUDGET_REFRESH_MS = 5 * 60000;
const finite = value => value !== null && value !== undefined && value !== ''
  && typeof value !== 'boolean' && Number.isFinite(Number(value));

function budgetHorizon(state, settings, now) {
  const timezone = settings.timezone || 'UTC';
  const today = localParts(new Date(now), timezone).dateKey;
  const clockTime = (value, fallback) => {
    const minute = parseTime(value) ?? fallback;
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  };
  const morning = clockTime(settings.nightTargetTime, 7 * 60);
  const evening = clockTime(settings.solarTargetTime, 17 * 60);
  const morningAt = localDateTimeUtcMs(today, morning, timezone);
  const eveningAt = localDateTimeUtcMs(today, evening, timezone);
  // The battery's overnight phase intentionally survives a dark morning.
  // Only the presentation horizon moves on at the morning goal. A newly
  // observed PV end today still starts night immediately, including in winter
  // before the daytime goal. Keep battery phase/forecast state untouched.
  const night = Boolean(state.nightPlanningActive)
    && (now < morningAt || state.nightPlanningStartedDate === today);
  const eveningRemainder = !night && now >= eveningAt;
  const targetAt = night || eveningRemainder
    ? (now < morningAt ? morningAt : localDateTimeUtcMs(shiftDateKey(today, 1), morning, timezone))
    : eveningAt;
  const phase = night ? 'night' : 'day';
  const horizon = night ? 'night_target' : eveningRemainder ? 'remaining_today_to_morning' : 'day_target';
  return { phase, horizon, targetAt, key: `${phase}|${horizon}|${targetAt}`,
    nextRefreshAt: Math.min(now + BUDGET_REFRESH_MS, targetAt) };
}

function householdDaily(planning, fallback) {
  const days = (planning?.days || []).slice(-14);
  const current = planning?.currentDay;
  if (current) {
    const index = days.findIndex(day => day.dateKey === current.dateKey);
    if (index >= 0) days.splice(index, 1);
    days.push({ sampleHours: Number(current.sampleMillis) / HOUR, estimatedDemandKwh: current.estimatedDemandKwh });
  }
  // Reuse Autotune's established >=18h coverage, 24h normalization and
  // median; do not call its recommendation or learning/update machinery.
  const values = days.filter(day => Number(day.sampleHours) >= 18 && Number(day.estimatedDemandKwh) > 0)
    .map(day => Number(day.estimatedDemandKwh) * 24 / Math.min(24, Number(day.sampleHours)))
    .filter(value => Number.isFinite(value) && value > 0 && value <= 100).sort((a, b) => a - b);
  if (values.length >= 2) {
    const mid = Math.floor(values.length / 2);
    return { kwh: values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2,
      source: 'autotune_non_ev_median', days: values.length };
  }
  return finite(fallback) && Number(fallback) >= 0
    ? { kwh: Number(fallback), source: 'expectedEnergyNeedKwh', days: 0 } : null;
}

function calculateBudget({ plan, settings, state, learning, evs = [], reserveSoc = 0,
  batteryAvailable = true, now }) {
  const targetAt = Number(plan.planningChargeDeadlineAt);
  const invalid = reason => ({ ready: false, valueKwh: null, calculatedAt: now,
    targetAt: targetAt || 0, validUntil: 0, reason });
  if (!plan.ready || !batteryAvailable || !finite(plan.currentSoc) || !(targetAt > now)) return invalid('planning_unavailable');
  const count = Number(settings.batteryCount);
  const socs = state.batterySoc?.slice(0, count) || [];
  if (!(count > 0) || socs.length !== count || socs.some(soc => !finite(soc) || Number(soc) < 0 || Number(soc) > 100)) return invalid('battery_data_missing');
  const capacityKwh = computeEffectiveCapacityKwh(state, settings);
  const soc = computeAverageSoc(state, settings);
  const demand = householdDaily(learning, settings.expectedEnergyNeedKwh);
  if (!demand || !(capacityKwh > 0) || soc === null) return invalid('household_data_missing');
  // Remaining-today is the existing day planner's energy horizon. There is
  // no intraday PV curve in this app: never assign tomorrow's full forecast
  // (or the night median of it) to the hours BEFORE the morning target.
  const night = plan.planningPhase === 'night';
  if (!night && (plan.forecastUsedSource !== 'today_remaining' || !plan.forecastReady
    || !finite(plan.forecastUsedKwh))) return invalid('remaining_forecast_missing');
  if (!night && (!finite(settings.maxSoc) || Number(settings.maxSoc) < 0 || Number(settings.maxSoc) > 100)) {
    return invalid('maximum_soc_missing');
  }
  const solarKwh = night ? 0 : Math.max(0, Number(plan.forecastUsedKwh));
  const remainingHours = (targetAt - now) / HOUR;
  const householdKwh = demand.kwh / 24 * remainingHours;
  // Daytime surplus is energy LEFT AFTER solar has filled the battery to
  // its configured maximum. The lower grid-planning goal/cap must never
  // turn remaining battery room into a household solar surplus.
  // Night has no credited PV and retains its existing morning reserve goal.
  const budgetTargetSoc = night ? Number(plan.targetSoc) || 0 : Number(settings.maxSoc);
  const goalSoc = Math.max(Number(settings.minSoc) || 0, Number(plan.safetySoc) || 0,
    budgetTargetSoc, plan.peakReserveActive ? Number(plan.peakReserveTargetSoc) || 0 : 0);
  const floorSoc = Math.max(goalSoc, Number(reserveSoc) || 0);
  // Protect the actual ordinary-discharge floor as well as the goal. A save
  // floor can prohibit spending without creating a new CHARGING requirement.
  // Reserve goal shortfall once, never add planned grid charging as surplus.
  const batteryAvailableKwh = Math.max(0, capacityKwh * (soc - floorSoc) / 100);
  const batteryGoalNeedKwh = Math.max(0, capacityKwh * (goalSoc - soc) / 100);
  const batteryBalanceKwh = batteryAvailableKwh - batteryGoalNeedKwh;
  let evReservedKwh = 0;
  for (const ev of evs) {
    if (!ev.reserved) continue;
    if (!finite(ev.needKwh) || !finite(ev.deadlineAt) || !(ev.deadlineAt > now)) return invalid('ev_reservation_unknown');
    let reservedKwh;
    if (ev.deadlineAt <= targetAt) reservedKwh = Math.max(0, Number(ev.needKwh));
    else if (Array.isArray(ev.slots)) {
      reservedKwh = Math.min(Math.max(0, Number(ev.needKwh)), ev.slots.reduce((sum, slot) => sum
        + Math.max(0, Math.min(targetAt, slot.endAt) - Math.max(now, slot.startAt)) / HOUR
        * Math.max(0, Number(slot.powerW) || 0) / 1000, 0));
    } else return invalid('ev_horizon_unknown');
    // Night battery support and a minimum EV goal can serve the SAME kWh.
    evReservedKwh += Math.max(reservedKwh, Math.max(0, Number(ev.nightReservedKwh) || 0));
  }
  const valueKwh = solarKwh + batteryBalanceKwh - householdKwh - evReservedKwh;
  return { ready: true, valueKwh, calculatedAt: now, targetAt, validUntil: targetAt,
    phase: plan.planningPhase, targetSoc: goalSoc, dischargeFloorSoc: floorSoc, remainingHours,
    planningTargetSoc: Number(plan.targetSoc), targetSource: night ? 'night_planning_goal' : 'day_maximum_soc',
    solarKwh, solarSource: night ? 'no_pv_credit_before_morning_target' : plan.forecastUsedSource,
    householdDailyKwh: demand.kwh, householdSource: demand.source, householdDays: demand.days,
    householdKwh, batteryAvailableKwh, batteryGoalNeedKwh, batteryBalanceKwh, evReservedKwh };
}
module.exports = { calculateBudget, householdDaily, budgetHorizon, BUDGET_REFRESH_MS };
