'use strict';

// Read-only tariff display for Visual Look. The engine remains the sole
// authority for which configured TOU rate is active. No P1/EMS control path
// uses this function, and a 25-hour lookahead lets the client slide a full
// 24-hour view forward until the next minute-level refresh.
const { findCurrentTariff } = require('./ems-engine');

function buildWidgetTouTimeline(settings, at = Date.now(), hours = 25) {
  if (!settings || settings.contractType !== 'tou') return [];
  const startAt = Number(at);
  if (!Number.isFinite(startAt)) return [];
  const endAt = startAt + hours * 60 * 60 * 1000;
  const rows = [];
  let cursor = startAt;
  // A valid weekly schedule has far fewer transitions. Bound iterations so
  // malformed schedules cannot trap a status read in an endless loop.
  for (let i = 0; i < 128 && cursor < endAt; i += 1) {
    const tariff = findCurrentTariff(new Date(cursor), settings);
    const nextAt = Number(tariff?.nextAt);
    const until = Number.isFinite(nextAt) && nextAt > cursor
      ? Math.min(nextAt, endAt) : endAt;
    const configured = tariff?.rateId !== null && tariff?.rateId !== undefined;
    rows.push({
      startAt: cursor,
      endAt: until,
      className: configured ? String(tariff.className || 'normal') : 'unknown',
      label: configured ? String(tariff.label || '') : '',
      price: configured && Number.isFinite(tariff.price) ? tariff.price : null,
      // Existing findCurrentTariff() already resolved this rate. Reuse its
      // actual policy rather than guessing battery behavior from price color.
      rateId: configured ? String(tariff.rateId) : null,
      avoidGridImport: configured ? Boolean(tariff.avoidGridImport) : null,
      lowForecastBatterySave: configured ? Boolean(tariff.lowForecastBatterySave) : null,
      lowForecastDischargeToTarget: configured ? Boolean(tariff.lowForecastDischargeToTarget) : null,
      highForecastBatterySave: configured ? Boolean(tariff.highForecastBatterySave) : null,
      highForecastDischargeToTarget: configured ? Boolean(tariff.highForecastDischargeToTarget) : null,
      nightChargeAllowed: configured ? Boolean(tariff.nightChargeAllowed) : null,
      dayChargeAllowed: configured ? Boolean(tariff.dayChargeAllowed) : null,
    });
    cursor = until;
  }
  return rows;
}

function widgetTouSignature(settings) {
  // Narrow fingerprint: incidental settings changes do not force another
  // calculation, but every rate, price, day or time edit does.
  return JSON.stringify([
    settings.timezone,
    (settings.touRates || []).map(rate => [rate.id, rate.name, rate.importPrice,
      rate.avoidGridImport, rate.lowForecastBatterySave, rate.lowForecastDischargeToTarget,
      rate.highForecastBatterySave, rate.highForecastDischargeToTarget,
      rate.weekdayChargeMode, rate.weekendChargeMode, rate.dayChargeAllowed, rate.nightChargeAllowed]),
    (settings.touSchedule || []).map(row => [row.rateId, row.start, row.end, row.days]),
    settings.touTariffs || null,
  ]);
}

module.exports = { buildWidgetTouTimeline, widgetTouSignature };
