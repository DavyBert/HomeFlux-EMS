'use strict';

const { localDateTimeUtcMs, inferIntervalMinutes } = require('../../lib/homey-energy');
const inputWarnings = require('../../lib/input-warnings');
const { buildWidgetTouTimeline, widgetTouSignature } = require('../../lib/widget-tou-timeline');
const { shiftKey, createHistoryCache } = require('../../lib/savings-history');
const { calibrateEnergy, addDays } = require('../../lib/savings');
const { rollingRange, readCategory } = require('../../lib/savings-flow');

// Share the last display calculation across widget instances. This cache is
// read only and is never used by the EMS or the P1 control loop.
const widgetTouCache = new WeakMap();
function getWidgetTouTimeline(app, settings, now) {
  const signature = widgetTouSignature(settings);
  const saved = widgetTouCache.get(app);
  if (saved && saved.signature === signature && now >= saved.at && now - saved.at < 60_000) return saved.rows;
  const rows = buildWidgetTouTimeline(settings, now);
  widgetTouCache.set(app, { signature, at: now, rows });
  return rows;
}

// Cache only the *presentation* price curves. The EMS planner never reads
// this cache. A fresh source-array reference/revision or source selection
// invalidates immediately, while unchanged arrays are converted at most once
// a minute. This also avoids allocating hundreds of display points on each
// 10-second status request (classic and Visual Look widgets share the cache).
const widgetPriceCurveCache = new WeakMap();
function getWidgetPriceCurves(app, sources, settings, now) {
  const timezone = settings.timezone || 'UTC';
  const inputs = (Array.isArray(sources) ? sources : []).map(item => {
    const state = item.source === 'homey' ? app.homeyEnergy
      : item.source === 'external2' ? app.externalEnergy2 : app.externalEnergy;
    return { source: item.source, name: item.name, slots: state?.slots || [],
      revision: item.source === 'homey' ? state?.lastUpdatedAt : state?.curveUpdatedAt };
  });
  const previous = widgetPriceCurveCache.get(app);
  if (previous && previous.timezone === timezone && now >= previous.at && now - previous.at < 60_000
    && previous.inputs.length === inputs.length && inputs.every((item, index) => {
      const saved = previous.inputs[index];
      return item.source === saved.source && item.name === saved.name
        && item.slots === saved.slots && item.revision === saved.revision
        && item.slots.length === saved.length;
    })) return previous.curves;

  const curves = inputs.map(item => {
    // Graph the received prices only: no resampling, re-ranking or planner work.
    const rows = item.slots;
    const intervalMinutes = inferIntervalMinutes(rows, 15);
    const points = [];
    for (const row of rows) {
      const start = row.startMs ?? localDateTimeUtcMs(row.dateKey,
        `${Math.floor(row.minute / 60)}:${String(row.minute % 60).padStart(2, '0')}`, timezone);
      const at = Number(start);
      if (start != null && at + intervalMinutes * 60_000 > now && at < now + 120 * 3_600_000)
        points.push([at, Number(row.price)]);
    }
    return { source: item.source, name: item.name, intervalMinutes, normalized: false, points };
  }).filter(curve => curve.points.length);
  widgetPriceCurveCache.set(app, { at: now, timezone,
    inputs: inputs.map(item => ({ source: item.source, name: item.name, slots: item.slots,
      revision: item.revision, length: item.slots.length })), curves });
  return curves;
}

// Visual Look uses the same existing Savings ledger as the original Savings widget.
// Deliver lightweight snapshots with /status as a fallback for dashboards where
// separately requested historic widget endpoints do not reach the iframe.
// No new P1 listener, settings field, scheduler, or controller work is introduced.
const visualSavingsSnapshots = new WeakMap();
const VISUAL_SAVINGS_PERIODS = Object.freeze({ day: 1, week: 7, month: 30, year: 365, total: 1827 });
function getVisualEvSavingsPeriod(app, settings, today, days, count) {
  const records = {};
  if (count === 0) return records;
  // One shared daily-ledger aggregate per period, for all configured EVs.
  // No selected-period query, live charger connection or separate EV request.
  const range = rollingRange(today, days, 'days');
  app.savingsHistoryCache ||= createHistoryCache();
  const aggregate = app.savingsHistoryCache.sum(app.savings?.history || {}, range, today);
  if (app.savings?.today && today >= range.startKey && today < range.endKey)
    addDays(aggregate, calibrateEnergy(app.savings.today));
  for (const ev of ['all', ...Array.from({ length: count }, (_, i) => String(i + 1))]) {
    const solar = readCategory(aggregate, 'ev_savings', { ev, settings });
    const grid = readCategory(aggregate, 'ev_grid', { ev, settings });
    records[ev] = { ...solar, pvKwh: solar.kwh, gridKwh: grid.kwh,
      gridCost: grid.value_available ? grid.value : null,
      grid_value_available: grid.value_available };
  }
  return records;
}

function getVisualSavingsSnapshot(app, now, settings) {
  const today = typeof app.getSavingsDateKey === 'function' ? app.getSavingsDateKey(now) : new Date(now).toISOString().slice(0, 10);
  const count = Math.max(0, Math.min(4, typeof app.getEvCount === 'function' ? app.getEvCount(settings) : Number(settings.evCount) || 0));
  const signature = JSON.stringify([count, settings.evConsumptionKwhPer100Km, settings.ev2ConsumptionKwhPer100Km,
    settings.ev3ConsumptionKwhPer100Km, settings.ev4ConsumptionKwhPer100Km]);
  const cached = visualSavingsSnapshots.get(app);
  if (cached && cached.date === today && cached.signature === signature
    && now - cached.at >= 0 && now - cached.at < 60000) return cached.value;
  const periods = {}, evPeriods = {}, evErrors = {};
  // getSavingsStatus uses the existing RAM history cache; never re-read a
  // persisted ledger from the Homey settings API and never compute on P1.
  for (const [name, days] of Object.entries(VISUAL_SAVINGS_PERIODS)) {
    const row = app.getSavingsStatus({ period: days === 1 ? 'day' : 'rolling', days });
    // Keep the status reply small. These are precisely the fields consumed by
    // the Visual Look savings amounts, costs and per-category breakdown.
    periods[name] = {
      period: row.period, startDate: row.startDate, endDate: row.endDate,
      currencySymbol: row.currencySymbol, periodSavings: row.periodSavings,
      actualCost: row.actualCost, grossImportCost: row.grossImportCost,
      directPv: row.directPv, pvBatteryHome: row.pvBatteryHome,
      pvExport: row.pvExport, loadShift: row.loadShift,
      directGrid: row.directGrid, unattributedGrid: row.unattributedGrid,
      batteryCharging: row.batteryCharging,
      importedEnergyToday: row.importedEnergyToday,
    };
    try {
      evPeriods[name] = getVisualEvSavingsPeriod(app, settings, today, days, count);
    } catch (error) {
      // Keep the independently valid house snapshot and normal EMS status.
      evErrors[name] = String(error?.message || error);
    }
  }
  // Closed *previous calendar day* from the SAME already-loaded Savings ledger.
  // Category totals are a historical demand proxy, not 24-hour P1 house samples.
  // In particular, battery *charging* kWh must not count as household usage.
  const yesterdayKey = shiftKey(today, -1);
  const closedDay = app.savings?.history?.[yesterdayKey];
  let yesterdayHouseDemand = null;
  if (closedDay && typeof closedDay === 'object') {
    const calibrated = calibrateEnergy(closedDay);
    const buckets = ['directGridKwh', 'unattributedGridKwh', 'directPvKwh', 'pvBatteryHomeKwh'];
    const allFinite = buckets.every(key => Number.isFinite(Number(calibrated[key])));
    const kwh = buckets.reduce((sum, key) => sum + Math.max(0, Number(calibrated[key]) || 0), 0);
    if (allFinite && kwh >= 0.25 && kwh < 300) {
      yesterdayHouseDemand = { date: yesterdayKey, kwh: Math.round(kwh * 100) / 100,
        source: 'savings-categories', approximate: true };
    }
  }
  const value = { updatedAt: now, periods, evPeriods, yesterdayHouseDemand,
    ...(Object.keys(evErrors).length ? { evErrors } : {}) };
  visualSavingsSnapshots.set(app, { at: now, date: today, signature, value });
  return value;
}

module.exports = {
  async getVisualWidgetProfile({ homey, query }) {
    return require('../../lib/visual-widget-profiles').get(homey,String(query?.name||'medium'));
  },
  async getHouseLoadHistory({ homey }) {
    // Purely read-only, already sampled in the standard P1/Savings path.
    return homey.app.getVisualHouseLoadHistory();
  },
  // Savings is demand-driven by Visual Look and cached in the widget browser.
  // These read-only endpoints do not run the EMS controller or change settings.
  async getSavings({ homey, query }) {
    const days = [1, 7, 30, 365, 1827].includes(Number(query?.days)) ? Number(query.days) : 1;
    const requestedPeriod = String(query?.period || '');
    // Exactly the same period contract as the original Savings widget:
    // a rolling range is always requested explicitly for 7/30/365 days.
    const period = requestedPeriod === 'rolling' || days !== 1 ? 'rolling' : 'day';
    return homey.app.localizeDisplay(homey.app.getSavingsStatus({ period, days }));
  },
  async getEvSavings({ homey, query }) {
    const days = [1, 7, 30, 365, 1827].includes(Number(query?.days)) ? Number(query.days) : 1;
    const ev = ['all', '1', '2', '3', '4'].includes(String(query?.ev)) ? String(query.ev) : 'all';
    const category = query?.category === 'ev_grid' ? 'ev_grid' : 'ev_savings';
    return homey.app.localizeDisplay(homey.app.getSavingsCategory({ category, ev, count: days, unit: 'days', format: 'kwh_price' }));
  },
  async getStatus({ homey, query }) {
    const app = homey.app;
    const status = app.getPublicStatus();
    const settings = app.getSettings();
    const now = Date.now();
    if (query?.visualSavings === '1' || query?.visualSavings === 1 || query?.visualSavings === true) {
      try {
        status.visualSavings = getVisualSavingsSnapshot(app, now, settings);
      } catch (error) {
        // This is optional presentation data. A ledger failure must never
        // prevent /status or HomeFlux's core battery controls from responding.
        status.visualSavingsError = String(error?.message || error);
      }
    }
    // Visual Look: use the exact cached planner classification for every
    // available 15/60-minute interval. Never infer the color from a different
    // price source, re-rank prices, or change the actual EMS control logic.
    // The classic widget does not request this optional presentation payload.
    const contract = String(settings.contractType || '');
    const visualRequest = query?.visualSavings === '1' || query?.visualSavings === 1 || query?.visualSavings === true;
    if (visualRequest) {
      // Presentation-only planner context, reusing the already-read settings.
      // These fields are intentionally not part of the classic status widget.
      status.visualPlanner = {
        solarTargetTime: String(settings.solarTargetTime || '17:00'),
        nightTargetTime: String(settings.nightTargetTime || '07:00'),
        dayPlanningMaxSoc: Number(settings.dayPlanningMaxSoc ?? settings.maxSoc ?? 100),
        nightPlanningMaxSoc: Number(settings.nightPlanningMaxSoc ?? settings.maxSoc ?? 100),
        maxSoc: Number(settings.maxSoc ?? 100),
        // Read-only policy context, only in Visual Look's optional status.
        // Never used by the controller, planning or the classic widget.
        forcedMode: String(settings.forcedMode || 'auto'),
        maxTotalDischargeW: Number(settings.maxTotalDischargeW ?? 2500),
        nightHysteresisEnabled: settings.nightHysteresisEnabled !== false,
      };
    }
    if (visualRequest && contract === 'tou') {
      try {
        // Fixed multi-rate contracts: the same engine that decides the live
        // tariff also supplies every upcoming transition. A hard-coded
        // weekday/weekend schedule would be incorrect for user customizations.
        status.tariffTimeline = getWidgetTouTimeline(app, settings, now);
        status.tariffTimelineSource = 'configured-tou';
      } catch (error) {
        status.tariffTimeline = [];
        status.tariffTimelineError = String(error?.message || error);
      }
    }
    if (visualRequest && ['dynamic','dynamic_quarter','dynamic_hour'].includes(contract)) {
      try {
        const rows = app.getHomeyEngineTariffTimeline(settings, new Date(now));
        status.tariffTimeline = Array.isArray(rows) ? rows.map(row => ({
          startAt: row.startMs, endAt: row.endMs,
          className: row.className, price: row.price,
          intervalMinutes: row.intervalMinutes,
        })) : [];
        status.tariffTimelineSource = app.getPriceSelectionSnapshot()?.selection?.source || 'none';
      } catch (error) {
        // A missing price selection must never block /status or the EMS.
        status.tariffTimeline = [];
        status.tariffTimelineError = String(error?.message || error);
      }
    }
    // A selected source may contain future prices without covering the current
    // slot. Keep its available curve visible; planning readiness stays unchanged.
    if (visualRequest) {
      status.priceCurves = getWidgetPriceCurves(app, status.priceData?.sources, settings, now);
    } else {
      // Preserve the classic text widget's existing rendering contract and
      // refresh behavior byte-for-byte; this optimization is Visual Look only.
      status.priceCurves = (status.priceData?.sources || []).map(item => {
        // Graph the received rows, never resampled or aligned planning rows.
        const rows = (item.source === 'homey' ? app.homeyEnergy : item.source === 'external2' ? app.externalEnergy2 : app.externalEnergy)?.slots || [];
        const intervalMinutes = inferIntervalMinutes(rows, 15);
        const timedRows = rows.map(row => ({...row, startMs: row.startMs ?? localDateTimeUtcMs(row.dateKey, `${Math.floor(row.minute/60)}:${String(row.minute%60).padStart(2,'0')}`, settings.timezone || 'UTC')}));
        return { source: item.source, name: item.name, intervalMinutes, normalized: false, points: timedRows
          .filter(row => row.startMs != null && Number(row.startMs) + intervalMinutes * 60000 > now && Number(row.startMs) < now + 120 * 3600000)
          .map(row => [Number(row.startMs), Number(row.price)]) };
      }).filter(curve => curve.points.length);
    }
    status.inputWarnings = inputWarnings.collect(app, status, settings, now);
    return status;
  },
};
