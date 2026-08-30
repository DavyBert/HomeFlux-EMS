'use strict';

const FORMATTERS = new Map();

function getFormatter(timezone = 'UTC') {
  const key = String(timezone || 'UTC');
  let formatter = FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: key,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    FORMATTERS.set(key, formatter);
  }
  return formatter;
}

function localParts(date, timezone = 'UTC') {
  const parts = getFormatter(timezone).formatToParts(date);
  const out = { year: 1970, month: 1, day: 1, hour: 0, minute: 0 };
  for (const part of parts) {
    if (part.type in out) out[part.type] = Number(part.value) || out[part.type];
  }
  return {
    ...out,
    dateKey: `${String(out.year).padStart(4, '0')}-${String(out.month).padStart(2, '0')}-${String(out.day).padStart(2, '0')}`,
    minuteOfDay: (out.hour * 60) + out.minute,
  };
}

function formatMinute(minute) {
  const m = ((Math.round(Number(minute) || 0) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function parseTimeOnly(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return (hour * 60) + minute;
}

function pickNumber(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function pickValue(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

const PRICE_KEYS = [
  'price', 'value', 'amount', 'cost', 'total', 'rate', 'tariff',
  'priceKwh', 'pricePerKwh', 'electricityPrice', 'marketPrice', 'spotPrice',
];
const TIME_KEYS = [
  'periodStart', 'start', 'startTime', 'startsAt', 'from', 'time', 'datetime', 'dateTime',
  'timestamp', 'at', 'date',
];

function parseStart(value, dateHint, timezone) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const startMs = value > 1e12 ? value : value > 1e9 ? value * 1000 : null;
    if (startMs !== null) {
      const lp = localParts(new Date(startMs), timezone);
      return { startMs, dateKey: lp.dateKey, minute: lp.minuteOfDay };
    }
  }

  const text = String(value ?? '').trim();
  if (!text) return null;
  const timeOnly = parseTimeOnly(text);
  if (timeOnly !== null) return { startMs: null, dateKey: dateHint || '', minute: timeOnly };

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const lp = localParts(new Date(parsed), timezone);
    return { startMs: parsed, dateKey: lp.dateKey, minute: lp.minuteOfDay };
  }
  return null;
}

function collectCandidateRows(value, dateHint, timezone, out, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (const item of value) collectCandidateRows(item, dateHint, timezone, out, depth + 1);
    return;
  }

  if (typeof value !== 'object') return;

  const price = pickNumber(value, PRICE_KEYS);
  const startValue = pickValue(value, TIME_KEYS);
  const start = parseStart(startValue, dateHint, timezone);
  if (price !== null && start) {
    out.push({ ...start, price, raw: value });
  }

  // Some APIs return an object map: { "2026-08-22T01:00:00Z": 0.123, ... }
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'number' && Number.isFinite(child)) {
      const mapStart = parseStart(key, dateHint, timezone);
      if (mapStart) out.push({ ...mapStart, price: child, raw: { [key]: child } });
    }
    if (typeof child === 'object' && child !== null) {
      collectCandidateRows(child, dateHint, timezone, out, depth + 1);
    }
  }
}

function normalizePriceUnit(rows) {
  if (!rows.length) return rows;
  const abs = rows.map(row => Math.abs(row.price)).filter(Number.isFinite).sort((a, b) => a - b);
  const median = abs[Math.floor(abs.length / 2)] || 0;
  // Homey normally exposes EUR/kWh. This fallback also accepts raw EUR/MWh payloads.
  const divisor = median > 5 ? 1000 : 1;
  return rows.map(row => ({ ...row, price: row.price / divisor }));
}

function inferUserCostAdder(payload, rawRows) {
  if (!payload || typeof payload !== 'object' || !rawRows.length) return 0;
  const rawPrices = rawRows.map(row => Number(row.price)).filter(Number.isFinite);
  if (!rawPrices.length) return 0;

  const rawMin = Math.min(...rawPrices);
  const rawMax = Math.max(...rawPrices);
  const rawAvg = rawPrices.reduce((sum, value) => sum + value, 0) / rawPrices.length;
  const candidates = [];
  const lowWithCosts = pickNumber(payload, ['lowestPriceWithUserCosts']);
  const highWithCosts = pickNumber(payload, ['highestPriceWithUserCosts']);
  const avgWithCosts = pickNumber(payload, ['averagePriceWithUserCosts']);
  if (lowWithCosts !== null) candidates.push(lowWithCosts - rawMin);
  if (highWithCosts !== null) candidates.push(highWithCosts - rawMax);
  if (avgWithCosts !== null) candidates.push(avgWithCosts - rawAvg);
  if (!candidates.length) return 0;

  const adder = median(candidates);
  // Homey's user-cost summaries can be used as a per-kWh adder when the
  // low/high/average deltas agree. If they do not, keep the raw slot values
  // rather than inventing a transformation.
  const spread = Math.max(...candidates) - Math.min(...candidates);
  return Number.isFinite(adder) && spread <= 0.002 ? adder : 0;
}

function normalizeDynamicPriceResponse(payload, { dateHint = '', timezone = 'UTC' } = {}) {
  const rows = [];

  // Official Homey Energy shape:
  // { priceInterval: '15', pricesPerInterval: [{ periodStart, periodEnd, value }], ... }
  if (payload && typeof payload === 'object' && Array.isArray(payload.pricesPerInterval)) {
    for (const item of payload.pricesPerInterval) {
      const price = pickNumber(item, ['value', 'price']);
      const start = parseStart(item && item.periodStart, dateHint, timezone);
      if (price !== null && start) rows.push({ ...start, price, raw: item });
    }
  } else {
    collectCandidateRows(payload, dateHint, timezone, rows);
  }

  const normalized = normalizePriceUnit(rows);
  const userCostAdder = inferUserCostAdder(payload, normalized);
  const adjusted = normalized.map(row => ({
    ...row,
    rawPrice: row.price,
    userCostAdder,
    price: row.price + userCostAdder,
  }));

  const unique = new Map();
  for (const row of adjusted) {
    const key = row.startMs !== null && row.startMs !== undefined
      ? `ms:${row.startMs}`
      : `local:${row.dateKey}:${row.minute}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) => {
    if (a.startMs !== null && b.startMs !== null) return a.startMs - b.startMs;
    if (a.dateKey !== b.dateKey) return String(a.dateKey).localeCompare(String(b.dateKey));
    return a.minute - b.minute;
  });
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function resamplePriceSlots(rows, targetIntervalMinutes = 15) {
  const target = Math.max(1, Math.round(Number(targetIntervalMinutes) || 15));
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const source = inferIntervalMinutes(rows, target);
  if (source >= target) return rows.slice();

  const groups = new Map();
  for (const row of rows) {
    if (!row || !Number.isFinite(Number(row.price)) || !Number.isFinite(Number(row.minute))) continue;
    const bucketMinute = Math.floor(Number(row.minute) / target) * target;
    const key = `${row.dateKey || ''}:${bucketMinute}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.values()].map(group => {
    const first = group.slice().sort((a, b) => a.minute - b.minute)[0];
    const avg = key => {
      const values = group.map(row => Number(row[key])).filter(Number.isFinite);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    const price = avg('price');
    const rawPrice = avg('rawPrice');
    const userCostAdder = avg('userCostAdder');
    return {
      ...first,
      minute: Math.floor(Number(first.minute) / target) * target,
      price,
      rawPrice,
      userCostAdder: userCostAdder ?? 0,
    };
  }).filter(row => Number.isFinite(row.price)).sort((a, b) => {
    if (a.dateKey !== b.dateKey) return String(a.dateKey).localeCompare(String(b.dateKey));
    return a.minute - b.minute;
  });
}

function inferIntervalMinutes(rows, fallback = 60) {
  const diffs = [];
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.dateKey)) grouped.set(row.dateKey, []);
    grouped.get(row.dateKey).push(row.minute);
  }
  for (const minutes of grouped.values()) {
    minutes.sort((a, b) => a - b);
    for (let i = 1; i < minutes.length; i += 1) {
      const d = minutes[i] - minutes[i - 1];
      if (d > 0 && d <= 180) diffs.push(d);
    }
  }
  const result = median(diffs);
  return result && result >= 1 ? Math.round(result) : fallback;
}

function groupSelected(rows, intervalMinutes) {
  if (!rows.length) return [];
  const sorted = rows.slice().sort((a, b) => a.minute - b.minute);
  const groups = [];
  let group = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].minute - sorted[i - 1].minute === intervalMinutes) group.push(sorted[i]);
    else {
      groups.push(group);
      group = [sorted[i]];
    }
  }
  groups.push(group);
  return groups;
}

function groupSummary(rows, intervalMinutes) {
  return groupSelected(rows, intervalMinutes)
    .map(group => {
      const start = group[0].minute;
      const end = group[group.length - 1].minute + intervalMinutes;
      return `${formatMinute(start)}–${formatMinute(end)}`;
    })
    .join(', ');
}

function cheapestConsecutiveBlock(rows, hours, intervalMinutes) {
  const count = Math.max(1, Math.round((Number(hours) * 60) / intervalMinutes));
  if (rows.length < count) return null;
  const sorted = rows.slice().sort((a, b) => a.minute - b.minute);
  let best = null;
  for (let i = 0; i <= sorted.length - count; i += 1) {
    const window = sorted.slice(i, i + count);
    let contiguous = true;
    for (let j = 1; j < window.length; j += 1) {
      if (window[j].minute - window[j - 1].minute !== intervalMinutes) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) continue;
    const avg = window.reduce((sum, row) => sum + row.price, 0) / window.length;
    if (!best || avg < best.averagePrice) {
      best = {
        rows: window,
        startMinute: window[0].minute,
        endMinute: window[window.length - 1].minute + intervalMinutes,
        averagePrice: avg,
      };
    }
  }
  if (best) best.summary = `${formatMinute(best.startMinute)}–${formatMinute(best.endMinute)}`;
  return best;
}

function selectByPrice(rows, hours, intervalMinutes, highest = false) {
  const count = Math.max(1, Math.min(rows.length, Math.round((Number(hours) * 60) / intervalMinutes)));
  return rows
    .slice()
    .sort((a, b) => highest ? (b.price - a.price || a.minute - b.minute) : (a.price - b.price || a.minute - b.minute))
    .slice(0, count)
    .sort((a, b) => a.minute - b.minute);
}

function analyzePriceSlots(slots, now = new Date(), timezone = 'UTC', cheapHours = 3, expensiveHours = 3) {
  const lp = localParts(now, timezone);
  const today = slots.filter(slot => slot.dateKey === lp.dateKey);
  const intervalMinutes = inferIntervalMinutes(today.length ? today : slots, 60);
  const cheap = selectByPrice(today, cheapHours, intervalMinutes, false);
  const expensive = selectByPrice(today, expensiveHours, intervalMinutes, true);
  const cheapKeys = new Set(cheap.map(row => row.minute));
  const expensiveKeys = new Set(expensive.map(row => row.minute));
  const current = today.find(row => lp.minuteOfDay >= row.minute && lp.minuteOfDay < row.minute + intervalMinutes) || null;
  const sortedByPrice = today.slice().sort((a, b) => a.price - b.price || a.minute - b.minute);
  const currentRank = current ? sortedByPrice.findIndex(row => row.minute === current.minute) + 1 : null;
  const cheapestBlock = cheapestConsecutiveBlock(today, cheapHours, intervalMinutes);

  return {
    dateKey: lp.dateKey,
    intervalMinutes,
    slotCount: today.length,
    currentPrice: current ? current.price : null,
    currentRawPrice: current && Number.isFinite(Number(current.rawPrice)) ? Number(current.rawPrice) : null,
    currentUserCostAdder: current && Number.isFinite(Number(current.userCostAdder)) ? Number(current.userCostAdder) : 0,
    currentMinute: current ? current.minute : null,
    currentRank,
    isCheapNow: current ? cheapKeys.has(current.minute) : false,
    isExpensiveNow: current ? expensiveKeys.has(current.minute) : false,
    cheapestSummary: groupSummary(cheap, intervalMinutes),
    expensiveSummary: groupSummary(expensive, intervalMinutes),
    cheapestBlockSummary: cheapestBlock ? cheapestBlock.summary : '',
    cheapestBlockAveragePrice: cheapestBlock ? cheapestBlock.averagePrice : null,
    cheapestMinutes: cheap.map(row => row.minute),
    expensiveMinutes: expensive.map(row => row.minute),
    cheapestBlockMinutes: cheapestBlock ? cheapestBlock.rows.map(row => row.minute) : [],
  };
}

function currentMatches(slots, now, timezone, hours, kind = 'cheap') {
  const analysis = analyzePriceSlots(slots, now, timezone, hours, hours);
  if (kind === 'expensive') return analysis.isExpensiveNow;
  if (kind === 'cheapest_block') return analysis.currentMinute !== null && analysis.cheapestBlockMinutes.includes(analysis.currentMinute);
  return analysis.isCheapNow;
}

module.exports = {
  localParts,
  normalizeDynamicPriceResponse,
  inferIntervalMinutes,
  resamplePriceSlots,
  analyzePriceSlots,
  currentMatches,
  formatMinute,
};
