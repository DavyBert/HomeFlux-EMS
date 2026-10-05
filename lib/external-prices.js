'use strict';
const { normalizeDynamicPriceResponse, normalizeSequentialPriceArray, sequentialPricePeriodInfo, localParts, localDateTimeUtcMs } = require('./homey-energy');
const HORIZON_HOURS = 120;
const PERIODS = ['this_day', 'tomorrow', 'next_hours'];

function trimCurve(rows, now, timezone = 'UTC') {
  const past = now.getTime() - 36 * 3600000;
  const future = now.getTime() + HORIZON_HOURS * 3600000;
  return rows.filter(row => {
    if (!row || !Number.isFinite(Number(row.price))) return false;
    const at = row.startMs == null ? localDateTimeUtcMs(row.dateKey, `${Math.floor(row.minute / 60)}:${String(row.minute % 60).padStart(2,'0')}`, timezone) : Number(row.startMs);
    return Number.isFinite(at) && at >= past && at < future;
  })
    .sort((a,b) => a.startMs != null && b.startMs != null ? a.startMs-b.startMs
      : String(a.dateKey).localeCompare(String(b.dateKey)) || a.minute-b.minute);
}

// One import path for both external sources and all retained Flow interfaces.
// The legacy timestamp card keeps its original date-hint interpretation.
function parseExternalPrices(text, { period = 'next_hours', sequentialOnly = false, legacy = false,
  intervalMinutes = 15, timezone = 'UTC', now = new Date(), previous = [] } = {}) {
  if (!String(text || '').trim()) throw new Error('External electricity price curve is empty');
  let payload;
  try { payload = JSON.parse(String(text)); }
  catch (error) { throw new Error(`Invalid external electricity price curve JSON: ${error.message}`); }
  const numeric = Array.isArray(payload) && payload.length > 0
    && payload.every(value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)));
  const sequential = sequentialOnly || !legacy && numeric;
  let rows;
  let shape;
  if (sequential) {
    if (!numeric) throw new Error('External electricity price curve must be a non-empty JSON array of numbers');
    period = PERIODS.includes(period) ? period : 'this_day';
    const info = sequentialPricePeriodInfo(period, intervalMinutes, now, timezone);
    if (!info) throw new Error('Could not determine the external price period');
    if (info.expectedCount !== null && payload.length !== info.expectedCount) {
      throw new Error(`External source returned ${payload.length} prices for ${period}, but HomeFlux expects ${info.expectedCount} for the configured ${intervalMinutes === 15 ? '15-minute' : 'hourly'} dynamic contract`);
    }
    rows = normalizeSequentialPriceArray(payload, { period, intervalMinutes, now, timezone });
    const merged = new Map();
    for (const row of [...previous, ...rows]) {
      const key = row.startMs != null ? `ms:${row.startMs}` : `local:${row.dateKey}:${row.minute}`;
      merged.set(key, row);
    }
    rows = [...merged.values()];
    shape = `${period} array(${payload.length}) · ${intervalMinutes} min`;
  } else {
    const dateHint = /^\d{4}-\d{2}-\d{2}$/.test(String(payload?.date || ''))
      ? payload.date : localParts(now, timezone).dateKey;
    rows = normalizeDynamicPriceResponse(payload, { dateHint, timezone });
    shape = Array.isArray(payload) ? `array(${payload.length})` : payload && typeof payload === 'object'
      ? Object.keys(payload).slice(0,8).join(', ') : typeof payload;
  }
  rows = trimCurve(rows, now, timezone);
  if (!rows.length) throw new Error('External electricity price curve contains no usable price slots');
  return { slots: rows, responseShape: shape };
}
module.exports = { HORIZON_HOURS, parseExternalPrices, trimCurve };
