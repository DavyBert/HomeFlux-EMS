'use strict';

// Presentation only. Called by the existing status-widget GET, never by an
// input listener, controller, heartbeat, tag publisher or planning function.
const { localDateTimeUtcMs } = require('./homey-energy');
const MINUTE = 60000;
const LIMITS = Object.freeze({ pv: 5, batterySoc: 10, forecast: 90, room: 15, outdoor: 60, evCurrent: 1 });
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

function collect(app, status, settings, now = Date.now()) {
  const seen = app.inputSeen || {}, times = app.inputUpdatedAt || {}, state = app.state || {};
  const start = Number(app.appStartedAt) || now;
  const result = new Map();
  const add = (id, key, received, at, minutes, category = 'reliability', params = {}, graceStart = start) => {
    const timestamp = Number(at) || 0;
    const ageMs = timestamp > 0 ? Math.max(0, now - timestamp) : null;
    const missing = !received;
    // Requests are not receipts. A value restored without a receipt timestamp
    // is not described as stale until the normal startup grace has elapsed.
    if (missing || ageMs === null) {
      if (now - graceStart <= minutes * MINUTE) return;
    } else if (ageMs <= minutes * MINUTE) return;
    const ageMinutes = ageMs === null ? null : Math.max(0, Math.round(ageMs / MINUTE));
    result.set(id, { id, key: key + (missing ? 'Missing' : ageMs === null ? 'Unknown' : 'Old'), category,
      ageMinutes, params: { ...params, minutes: ageMinutes === null ? '?' : ageMinutes } });
  };
  const count = Math.max(0, Math.min(8, Number(settings.batteryCount) || 0));
  const battery = Boolean(status.controlEnabled) && count > 0
    && (settings.forcedMode !== 'standby' || settings.peakShaveEnabled);
  const evs = (status.evs || []).filter(ev => ev.enabled && (ev.outputAllowed || Number(ev.outputCurrentA) > 0
    || Number(ev.actualCurrentA) > 0 || ev.connected && !ev.session?.socTargetReached && !ev.centralPlan?.completed));
  const hvacs = (status.hvacs || []).filter(h => {
    const stem = h.instance > 1 ? 'hvac' + h.instance : 'hvac';
    return h.enabled && h.automaticControlEnabled !== false
      && ['Power', 'Mode', 'Setpoint', 'Fan'].some(part => settings[stem + 'Allow' + part + 'Control']);
  });
  const boiler = Boolean(settings.boilerEnabled) && Number(settings.boilerCount) > 0;
  const flexible = evs.length > 0 || hvacs.length > 0 || boiler;
  const active = battery || flexible;

  if (active) {
    // Same hard P1 horizon as getGridFreshness. Its existing critical red
    // alert remains authoritative; the renderer hides its orange duplicate.
    const gridMinutes = Math.max(60000, Math.max(1, Number(settings.commandIntervalSeconds) || 10) * 6000) / MINUTE;
    add('grid', 'grid', seen.grid && finite(state.gridPowerW),
      times.grid, gridMinutes, 'regulation');
  }

  let pvNeeded = battery && settings.forcedMode !== 'standby' || evs.length > 0 || boiler;
  let socNeeded = battery || evs.length > 0 || boiler;
  let pricesNeeded = battery && String(settings.forcedMode || 'auto') === 'auto' || evs.length > 0
    || boiler && ['Cheap', 'Normal', 'Expensive'].some(t => settings['boilerDynamic' + t + 'Enabled']);
  const outdoorUsers = [];
  let outdoorMinutes = Infinity, copNeeded = false;
  for (const h of hvacs) {
    const index = Math.max(0, Number(h.instance) - 1), stem = index ? 'hvac' + h.instance : 'hvac';
    const get = suffix => settings[stem + suffix];
    const input = index === 0 ? { seen: seen.hvac, updatedAt: times.hvac }
      : app.extraHvacInstances?.[index - 1];
    const received = input?.seen || {}, updatedAt = input?.updatedAt || {};
    const permanent = Boolean(get('PermanentEnabled') && (get('TariffEnabled') || get('PvEnabled') || get('PeriodicHeatEnabled')));
    const source = get('DirectionTemperature')?.source;
    socNeeded ||= !permanent || Boolean(get('PvEnabled')) || Boolean(settings.hvacExtraGridBudgetEnabled);
    pricesNeeded ||= permanent && Boolean(get('TariffEnabled') || get('PeriodicHeatEnabled'));
    const roomNeeded = !permanent || get('Direction') === 'auto' && source !== 'outdoor'
      || get('PvEnabled') || get('PeriodicHeatEnabled') || settings.hvacExtraGridBudgetEnabled;
    const interval = Math.max(1, Number(get('ControlIntervalMinutes')) || 5);
    const label = h.name || 'HVAC ' + h.instance;
    if (roomNeeded) add('hvac' + h.instance + ':room', 'room', received.roomTemperature,
      updatedAt.roomTemperature, Math.max(LIMITS.room, 3 * interval), 'reliability', { device: label });
    // Mode/setpoint are stable device state, not periodic sensor readings.
    // Diagnose only missing prerequisites for the legacy PV controller.
    if (!permanent) for (const field of ['mode', 'setpoint']) {
      if (!received[field]) add('hvac' + h.instance + ':' + field, field, false, 0,
        Math.max(LIMITS.room, 3 * interval), 'regulation', { device: label });
    }
    const rule = get('DirectionTemperature')?.tariffCop?.[status.tariff?.className];
    const cop = Boolean(h.copOutdoorDependent || permanent && get('TariffEnabled')
      && !h.periodicHeating && finite(rule?.outsideBelowC) && finite(rule?.targetC));
    if (get('AllowFanControl') || get('Direction') === 'auto' && source === 'outdoor'
      || permanent && (cop || get('OutdoorNoIncreaseEnabled') || get('OutdoorOffEnabled') || get('OutdoorOffAboveEnabled'))) {
      outdoorUsers.push(label); outdoorMinutes = Math.min(outdoorMinutes, Math.max(LIMITS.outdoor, 3 * interval));
      copNeeded ||= cop;
    }
    pvNeeded ||= permanent ? Boolean(get('PvEnabled')) : get('UsePvSurplus') !== false;
  }
  if (outdoorUsers.length) add('hvac:outdoor', copNeeded ? 'outdoorCop' : 'outdoor', seen.hvac?.outdoorTemperature,
    times.hvac?.outdoorTemperature, outdoorMinutes, 'reliability', { device: outdoorUsers.join(', ') });
  const learning = app.hvacPermanentRuntime?.observation;
  const learningActive = learning && hvacs.some(h => Number(h.instance) === learning.index + 1);
  if (pvNeeded || learningActive) add('pv', learningActive ? 'pvLearning' : 'pv', seen.pv && finite(state.pvPowerW),
    times.pv, learningActive ? 1 : LIMITS.pv, learningActive ? 'regulation' : 'reliability');
  if (count > 0 && socNeeded) for (let i = 0; i < count; i++) {
    add('battery' + (i + 1) + ':soc', 'batterySoc', seen.batterySoc?.[i] && finite(state.batterySoc?.[i]),
      times.batterySoc?.[i], LIMITS.batterySoc, 'reliability', { device: i + 1 });
  }

  for (const ev of evs) {
    const index = ev.instance - 1, stem = index ? 'ev' + ev.instance : 'ev';
    const input = index === 0 ? { seen: seen.ev, updatedAt: times.ev } : app.extraEvInstances?.[index - 1];
    const graceStart = Math.max(start, Number(ev.session?.connectedAt) || 0);
    const energyPlan = finite(ev.planningTargetKwh) && Number(ev.planningTargetKwh) > 0;
    if (ev.socEnabled !== false && ev.mode !== 'emergency' && !energyPlan) {
      const minutes = Math.max(1, Math.min(60, Math.round(Number(settings[stem + 'SocFreshnessMinutes']) || 15)));
      add('ev' + ev.instance + ':soc', 'evSoc', input?.seen?.soc, input?.updatedAt?.soc,
        minutes, 'regulation', { device: ev.name || 'EV ' + ev.instance }, graceStart);
    }
    if (ev.controlType !== 'mode' && (Number(ev.outputCurrentA) > 0 || ev.outputAllowed
      || Number(ev.actualCurrentA) > 0 || Number(ev.desiredCurrentA) > 0)) {
      add('ev' + ev.instance + ':current', 'evCurrent', input?.seen?.chargeCurrent,
        input?.updatedAt?.chargeCurrent, LIMITS.evCurrent, 'regulation',
        { device: ev.name || 'EV ' + ev.instance }, graceStart);
    }
  }

  // Forecasts are calendar-valid, not invalidated after a generic timeout.
  // Three unanswered half-hour requests merit an informational age warning.
  const forecastNeeded = battery && String(settings.forcedMode || 'auto') === 'auto'
    && (!finite(state.targetSocOverride) || status.tariff?.lowForecastBatterySave || settings.lowForecastAutoSunnyEnabled);
  const pvEv = evs.some(ev => ev.centralPlan?.maxPv && !ev.centralPlan?.completed);
  if ((forecastNeeded || pvEv) && !(forecastNeeded && !pvEv && settings.nightForecastHoldEnabled
    && state.nightPlanningActive && app.nightForecastMedian?.hold?.frozen && finite(app.nightForecastMedian.hold.value))) {
    const tomorrow = status.forecastPlanningDay === 'tomorrow';
    const key = tomorrow ? 'forecastTomorrow' : 'forecast';
    const calendarStart = !times[key] && /^\d{4}-\d{2}-\d{2}$/.test(state.forecastDailyMaxDate || '')
      ? localDateTimeUtcMs(state.forecastDailyMaxDate, '00:00', settings.timezone || 'UTC') : 0;
    add(key, key, seen[key], times[key], LIMITS.forecast, 'reliability', {}, Math.max(start, calendarStart || 0));
  }
  if (pricesNeeded && status.priceData?.required && (!status.priceData.ready || !status.priceData.fresh)) {
    const source = status.priceData.sources?.find(s => s.source === status.priceData.source);
    // The controller's selected-source readiness owns validity (including
    // fallback and current-slot coverage); curve age alone is not an expiry.
    const at = Number(status.priceData.lastUpdatedAt) || 0;
    if (at > 0 || now - start > 3 * MINUTE) result.set('prices', {
      id: 'prices', key: at > 0 ? 'pricesOld' : 'pricesMissing', category: 'regulation', ageMinutes: at > 0 ? Math.round(Math.max(0, now - at) / MINUTE) : null,
      params: { device: source?.name || status.priceData.sourceName || '', minutes: at > 0 ? Math.round(Math.max(0, now - at) / MINUTE) : '?' },
    });
  }
  const priority = item => item.id === 'grid' ? 0 : item.id === 'prices' ? 1
    : item.category === 'regulation' ? 2 : item.id === 'pv' ? 3
      : item.id.startsWith('battery') ? 4 : item.id.startsWith('hvac') ? 5 : 6;
  // Stable numeric insertion order already follows configured battery/EV/HVAC
  // slots; no locale/collation work is needed for every widget request.
  return [...result.values()].sort((a, b) => priority(a) - priority(b));
}
module.exports = { collect, LIMITS };
