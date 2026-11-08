'use strict';
// Widget-only snapshots. No controller writes, subscriptions or scheduling.
const { findCurrentTariff } = require('./ems-engine');
const { localParts, shiftDateKey, localDateTimeUtcMs } = require('./homey-energy');
const phaseGuard = require('./phase-guard');
const finite = value => value !== null && value !== undefined && value !== ''
  && typeof value !== 'boolean' && Number.isFinite(Number(value));
const ROOM_STEP_W = 100;

function cheapWindow(settings, tariff, priceStatus, selection, now, minimumMinutes = settings.wafMinCheapMinutes) {
  if (tariff?.className !== 'cheap' || !finite(tariff.price)) return false;
  const minutes = finite(minimumMinutes)
    ? Math.max(0, Math.min(1440, Number(minimumMinutes))) : 90;
  const requiredUntil = now + minutes * 60000;
  let current = tariff, at = now;
  if (tariff.kind === 'dynamic') {
    // Reuse the selected, normalized curve/classification; never rank prices here.
    if (!priceStatus?.available || !priceStatus.isCheapNow || !finite(priceStatus.currentPrice)
      || !selection || selection.source !== priceStatus.source
      || !selection.sources?.some(source => source.source === selection.source && source.ready)) return false;
    const timezone = settings.timezone || 'UTC';
    const local = localParts(new Date(now), timezone);
    const midnight = localDateTimeUtcMs(shiftDateKey(local.dateKey, 1), '00:00', timezone);
    // The engine's daily classification must not wrap into an unclassified tomorrow.
    if (requiredUntil >= midnight) return false;
    const interval = Number(priceStatus.slotIntervalMinutes) * 60000;
    if (!(interval > 0 && interval <= 3600000)) return false;
    let coveredUntil = now;
    for (const slot of selection.slots || []) {
      if (slot.dateKey !== local.dateKey || !finite(slot.price)) continue;
      const start = finite(slot.startMs) ? Number(slot.startMs)
        : localDateTimeUtcMs(slot.dateKey, `${String(Math.floor(slot.minute / 60)).padStart(2, '0')}:${String(slot.minute % 60).padStart(2, '0')}`, timezone);
      if (start > coveredUntil || start + interval <= coveredUntil) continue;
      coveredUntil = start + interval;
      if (coveredUntil > requiredUntil) break;
    }
    return coveredUntil > requiredUntil && Number(tariff.nextAt) > requiredUntil;
  }
  // Adjacent equal-price TOU blocks can belong to the same cheap segment.
  // Use the existing tariff resolver, bounded and only on the ordinary WAF refresh.
  for (let i = 0; i < 96; i += 1) {
    const next = Number(current.nextAt);
    if (!Number.isFinite(next) || next <= at) return false;
    if (next > requiredUntil) return true;
    if (tariff.kind !== 'tou') return false;
    current = findCurrentTariff(new Date(next), settings);
    if (current.className !== 'cheap' || !finite(current.price)) return false;
    at = next;
  }
  return false;
}

function gridRoom(app, settings, now) {
  if (!settings.peakShaveEnabled || !finite(settings.peakLimitW) || Number(settings.peakLimitW) <= 0) return null;
  const grid = app.getGridFreshness(settings, now);
  if (!grid.fresh || grid.updatedAt > now || !finite(grid.value)) return null;
  const target = Math.max(0, Number(settings.peakLimitW) - Math.max(0, Number(settings.peakSoftMarginW) || 0));
  let room = target - Number(grid.value) - Math.max(0, Number(app.latestResult?.peakGuardExtraLoadW) || 0);
  if (Number(settings.phaseGuard?.phases) === 3 && settings.phaseGuard?.enabled) {
    // inspect/status only: no allocation or phase-control calculation.
    const phases = phaseGuard.status(app, settings, now);
    if (phases.state === 'unavailable' || !finite(phases.limitW) || phases.limitW <= 0
      || phases.values?.length !== 3
      || phases.values.some(sample => !finite(sample.watts) || !sample.at || sample.at > now || now - sample.at > 15000)) return null;
    // Unknown appliance phase: the smallest phase margin is the safe indication.
    for (const sample of phases.values) room = Math.min(room, phases.limitW - Number(sample.watts));
  }
  return Math.floor(Math.max(0, room) / ROOM_STEP_W) * ROOM_STEP_W;
}

// This read-only latch follows existing EMS results, never meter subscriptions.
function isSaving(app, result, now) {
  const language = app.displayLanguage();
  return app.getEmsWidgetTokens(result, now).emsdecision
    === require(`../locales/${language}.json`).widget.status.decisionSaveBattery;
}
function notify(app, view) {
  try {
    const sent = app.homey?.api?.realtime?.('homeflux.ev.changed', { wafPeakGuard: { ...view } });
    sent?.catch?.(() => {});
  } catch (_) { /* Optional widget transport; never affect control. */ }
}
function observeGuard(app, result, settings, now = Date.now()) {
  const phase = result?.phaseChargeGuard;
  const phasePeak = phase?.enabled && (phase.limited || phase.state !== 'unavailable'
    && phase.values?.some(sample => finite(sample.watts) && sample.at > 0
      && sample.at <= now && now - sample.at <= 15000 && Number(sample.watts) >= Number(phase.limitW)));
  const active = result?.override === 'peak_shave' || result?.action === 'peak_shave'
    || phasePeak || app.isHybridPeakGuardRequired?.(result, settings) === true;
  let guard = app.wafPeakGuard;
  if (active) {
    if (!guard) guard = app.wafPeakGuard = { active: false, blocked: false, clearSince: 0, revision: 0 };
    const changed = !guard.blocked;
    guard.active = true; guard.blocked = true; guard.clearSince = 0;
    if (changed) guard.revision = Math.max(guard.revision + 1, now);
    let view = app.planningCache?.wafPresentation;
    if (!view && app.planningCache) view = app.planningCache.wafPresentation = {
      active: false, eligible: false, calculatedAt: now, gridRoomW: null, roomUpdatedAt: 0,
    };
    if (view) {
      view.eligible ??= Boolean(view.active);
      const wasVisible = view.active;
      view.active = false; view.gridRoomW = null; view.peakGuardBlocked = true;
      view.guardRevision = guard.revision;
      if (changed || wasVisible) notify(app, view);
    }
  } else if (guard?.blocked) {
    // Missing feedback cannot establish a minute of confirmed recovery.
    if (result?.inputReady === false || phase?.enabled && phase.state === 'unavailable') { guard.active = true; guard.clearSince = 0; }
    else if (guard.active) { guard.active = false; guard.clearSince = now; }
  }
}
function updateRoom(app, settings, now = Date.now()) {
  const view = app.planningCache?.wafPresentation;
  if (!view) return false;
  const guard = app.wafPeakGuard;
  if (guard?.blocked) {
    if (guard.active || !guard.clearSince || now < guard.clearSince + 60000
      || !app.getGridFreshness(settings, now).fresh) return false;
    guard.blocked = false; guard.revision = Math.max(guard.revision + 1, now);
    view.peakGuardBlocked = false; view.guardRevision = guard.revision;
    // Reuse the cached WAF eligibility; only the existing normalized decision is read.
    if (view.eligible && app.latestResult?.tariff?.className === 'cheap' && isSaving(app, app.latestResult, now)) {
      const watts = gridRoom(app, settings, now);
      if (watts !== null) {
        view.active = true; view.gridRoomW = watts; view.roomUpdatedAt = now;
        notify(app, view); return true;
      }
    }
    notify(app, view);
    return true;
  }
  if (!view.active) return false;
  const watts = gridRoom(app, settings, now);
  if (view.gridRoomW === watts) return false;
  view.gridRoomW = watts;
  view.roomUpdatedAt = now;
  return true;
}

function refresh(app, result, settings, now) {
  const cache = app.planningCache;
  if (!cache || cache.energyBudget?.calculatedAt !== now) return;
  observeGuard(app, result, settings, now);
  const saving = isSaving(app, result, now);
  const snapshot = app.evDeadlinePriceSelection;
  const selection = snapshot && Math.abs(snapshot.at - now) <= 1000
    && snapshot.revision === app.evDeadlineSettingsRevision ? snapshot.selection : null;
  const preferences = app.wafPreferences || settings;
  const blocked = Boolean(app.wafPeakGuard?.blocked);
  const eligible = preferences.wafBatterySavingEnabled !== false
    && (saving || blocked && cache.wafPresentation?.eligible)
    && cheapWindow(settings, result.tariff, result.homeyEnergy, selection, now, preferences.wafMinCheapMinutes);
  cache.wafPresentation = {
    active: Boolean(eligible && saving && !blocked), eligible: Boolean(eligible),
    peakGuardBlocked: blocked, guardRevision: app.wafPeakGuard?.revision || now,
    calculatedAt: now, gridRoomW: null, roomUpdatedAt: 0,
  };
  updateRoom(app, settings, now);
}

const defaults = { wafBatterySavingEnabled: true, wafMinCheapMinutes: 90, wafColorsEnabled: true,
  wafReserveRedKwh: -4, wafReserveOrangeKwh: 1, wafReserveGreenKwh: 7,
  wafRoomRedW: 0, wafRoomOrangeW: 1000, wafRoomGreenW: 2000 };
const isSetting = key => Object.prototype.hasOwnProperty.call(defaults, key);
function loadPreferences(app) {
  const preferences = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = app.homey.settings.get(key);
    preferences[key] = typeof fallback === 'boolean' ? value !== false : finite(value) ? Number(value) : fallback;
  }
  preferences.wafMinCheapMinutes = Math.max(0, Math.min(1440, Math.round(preferences.wafMinCheapMinutes)));
  for (const stem of ['wafReserve', 'wafRoom']) {
    const unit = stem === 'wafReserve' ? 'Kwh' : 'W';
    const keys = ['Red', 'Orange', 'Green'].map(color => stem + color + unit);
    if (!(preferences[keys[0]] < preferences[keys[1]] && preferences[keys[1]] < preferences[keys[2]])
      || unit === 'W' && preferences[keys[0]] < 0) for (const key of keys) preferences[key] = defaults[key];
  }
  app.wafPreferences = preferences;
}
module.exports = { refresh, updateRoom, observeGuard, cheapWindow, gridRoom, ROOM_STEP_W, isSetting, loadPreferences, defaults };
