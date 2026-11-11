'use strict';

// Read-only gates for deliberate export. Reuse the selected normalized import
// curve and the persistent Savings inventory; never create a second ledger,
// price source, scheduler or device-control path.
const { isDynamicContract, findCurrentTariff, computeAverageSoc, configuredBatteryCapacityKwh } = require('./ems-engine');
const { localParts, localDateTimeUtcMs, shiftDateKey } = require('./homey-energy');
const { origin } = require('./ev-battery-policy');

const defaults = Object.freeze({
  injectionPriceDifferenceEnabled: false,
  injectionMinimumPriceDifference: 0.20,
  injectionSolarOverrideEnabled: false,
  injectionMinimumSolarSharePercent: 50,
});
const priceStopReasons = Object.freeze([
  'Onvoldoende prijsverschil voor injectie',
  'Laagste inkoopprijs vandaag niet beschikbaar',
]);
const finite = value => value !== null && value !== undefined && value !== ''
  && typeof value !== 'boolean' && Number.isFinite(Number(value));
const greater = (value, threshold) => value - threshold > 1e-9;
// A single per-app memo, not a price history. Keys are references to existing
// immutable-on-update settings/price arrays, never a copy of the curve.
const dayMemos = new WeakMap();

function validSettings(settings) {
  if (!settings.injectionPriceDifferenceEnabled) return true;
  const margin = settings.injectionMinimumPriceDifference ?? defaults.injectionMinimumPriceDifference;
  const share = settings.injectionMinimumSolarSharePercent ?? defaults.injectionMinimumSolarSharePercent;
  return finite(margin) && Number(margin) >= 0 && Number(margin) <= 100
    && (!settings.injectionSolarOverrideEnabled || finite(share) && Number(share) >= 0 && Number(share) <= 100);
}

function touMinimum(settings, dateKey, timezone) {
  const start = localDateTimeUtcMs(dateKey, '00:00', timezone);
  const end = localDateTimeUtcMs(shiftDateKey(dateKey, 1), '00:00', timezone);
  if (!finite(start) || !finite(end) || end <= start) return null;
  let at = start, minimum = null;
  // Use the engine's own weekday, overlap, midnight and tariff-transition
  // rules. An unused weekend rate must not become Monday's daily minimum.
  for (let step = 0; step < 4096 && at < end; step++) {
    const tariff = findCurrentTariff(new Date(at), { ...settings, timezone });
    const raw = String(tariff.rateId || '').startsWith('legacy-')
      ? settings.touTariffs?.[Number(tariff.rateId.slice(7)) - 1]
      : settings.touRates?.find(rate => String(rate.id) === tariff.rateId);
    if (finite(raw?.importPrice) && finite(tariff.price)) {
      minimum = minimum === null ? Number(tariff.price) : Math.min(minimum, Number(tariff.price));
    }
    const next = tariff.nextAt instanceof Date ? tariff.nextAt.getTime() : end;
    if (!Number.isFinite(next) || next <= at) return null;
    if (next >= end) return minimum;
    at = next;
  }
  return null;
}

function lowestImportToday(app, settings, now, selection) {
  if (settings.contractType === 'fixed') return finite(settings.fixedImportPrice) ? Number(settings.fixedImportPrice) : null;
  const dynamic = isDynamicContract(settings);
  if (settings.contractType !== 'tou' && !dynamic) return null;
  // A Flow export quote alone is not evidence of today's import prices.
  if (dynamic && !selection?.slots?.length) return null;
  const timezone = app.homey?.clock?.getTimezone?.() || settings.timezone || 'UTC';
  const dateKey = localParts(new Date(now), timezone).dateKey;
  const key = [dateKey, timezone, settings.contractType, settings.touRates, settings.touSchedule,
    settings.touTariffs, dynamic ? selection.slots : null];
  const memo = dayMemos.get(app);
  if (memo && key.every((value, index) => value === memo.key[index])) return memo.minimum;
  let minimum = null;
  if (dynamic) {
    // Include already elapsed and later known slots of this LOCAL calendar
    // day, but not yesterday or tomorrow. Prices are already normalized by
    // the ordinary source selector (including calibrated fallback sources).
    for (const row of selection.slots) {
      if (row.dateKey !== dateKey || !finite(row.price) || !finite(row.minute)
        || Number(row.minute) < 0 || Number(row.minute) >= 1440) continue;
      minimum = minimum === null ? Number(row.price) : Math.min(minimum, Number(row.price));
    }
  } else {
    minimum = touMinimum(settings, dateKey, timezone);
  }
  dayMemos.set(app, { key, minimum });
  return minimum;
}

function solarShare(app, settings, now) {
  const count = app.getBatteryCount(settings);
  if (!count) return null;
  for (let index = 0; index < count; index++) {
    const at = Number(app.inputUpdatedAt?.batterySoc?.[index]);
    const soc = app.state?.batterySoc?.[index];
    if (!app.inputSeen?.batterySoc?.[index] || !finite(soc) || Number(soc) < 0 || Number(soc) > 100
      || !(at > 0) || at > now || now - at > 600000) return null;
  }
  const soc = computeAverageSoc(app.state, settings);
  const capacity = configuredBatteryCapacityKwh(settings);
  if (!finite(soc) || !finite(capacity) || capacity <= 0 || soc <= 0) return null;
  const inventory = app.savings?.inventory;
  const total = origin(inventory, capacity * soc / 100).totalKwh;
  const pvKwh = finite(inventory?.pvKwh) ? Math.max(0, Number(inventory.pvKwh)) : 0;
  // The denominator includes tracked grid/unknown stock AND untracked energy
  // implied by current SoC. Missing provenance must never be counted as PV.
  return total > 0 ? Math.min(100, pvKwh / total * 100) : null;
}

function evaluate(app, settings, price, now = Date.now(), selection = null) {
  if (!settings.injectionPriceDifferenceEnabled) return { enabled: false, allowed: true, reason: '' };
  const minimumDifference = Number(settings.injectionMinimumPriceDifference ?? defaults.injectionMinimumPriceDifference);
  const solarOverrideEnabled = Boolean(settings.injectionSolarOverrideEnabled);
  const minimumSolarSharePercent = Number(settings.injectionMinimumSolarSharePercent ?? defaults.injectionMinimumSolarSharePercent);
  const minimumImportPrice = lowestImportToday(app, settings, now, selection);
  const difference = finite(price?.price) && minimumImportPrice !== null ? Number(price.price) - minimumImportPrice : null;
  const solarSharePercent = solarOverrideEnabled ? solarShare(app, settings, now) : null;
  const differenceAllowed = difference !== null && greater(difference, minimumDifference);
  const solarAllowed = solarOverrideEnabled && solarSharePercent !== null && greater(solarSharePercent, minimumSolarSharePercent);
  const allowed = validSettings(settings) && (differenceAllowed || solarAllowed);
  return { enabled: true, allowed, minimumImportPrice, minimumDifference, difference,
    solarOverrideEnabled, minimumSolarSharePercent, solarSharePercent,
    solarOverrideUsed: allowed && !differenceAllowed && solarAllowed,
    reason: !validSettings(settings) ? 'Ongeldige injectie-instellingen'
      : allowed ? '' : minimumImportPrice === null ? priceStopReasons[1] : priceStopReasons[0] };
}

module.exports = { defaults, priceStopReasons, validSettings, lowestImportToday, solarShare, evaluate };
