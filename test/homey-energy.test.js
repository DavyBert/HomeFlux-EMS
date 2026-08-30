'use strict';

const assert = require('assert');
const {
  normalizeDynamicPriceResponse,
  inferIntervalMinutes,
  analyzePriceSlots,
  currentMatches,
  resamplePriceSlots,
} = require('../lib/homey-energy');

function time(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

// Simulate one full day of quarter-hour prices. The 3 cheapest hours are 02:00-05:00,
// and the 3 most expensive hours are 18:00-21:00.
const payload = {
  prices: Array.from({ length: 96 }, (_, index) => {
    const minute = index * 15;
    let price = 0.30 + (index / 10000);
    if (minute >= 120 && minute < 300) price = 0.05 + (index / 100000);
    if (minute >= 1080 && minute < 1260) price = 0.60 + (index / 100000);
    return { start: time(minute), price };
  }),
};

const slots = normalizeDynamicPriceResponse(payload, {
  dateHint: '2026-08-22',
  timezone: 'UTC',
});
assert.strictEqual(slots.length, 96, 'all quarter-hour prices should be parsed');
assert.strictEqual(inferIntervalMinutes(slots), 15, 'quarter-hour interval should be detected');

const now = new Date('2026-08-22T02:07:00Z');
const analysis = analyzePriceSlots(slots, now, 'UTC', 3, 3);
assert.strictEqual(analysis.intervalMinutes, 15);
assert.strictEqual(analysis.cheapestMinutes.length, 12, '3 hours must equal 12 quarter-hour slots');
assert.strictEqual(analysis.expensiveMinutes.length, 12, '3 expensive hours must equal 12 quarter-hour slots');
assert.strictEqual(analysis.cheapestSummary, '02:00–05:00');
assert.strictEqual(analysis.expensiveSummary, '18:00–21:00');
assert.strictEqual(analysis.cheapestBlockSummary, '02:00–05:00');
assert.strictEqual(analysis.isCheapNow, true);
assert.strictEqual(analysis.isExpensiveNow, false);
assert.strictEqual(currentMatches(slots, now, 'UTC', 3, 'cheap'), true);
assert.strictEqual(currentMatches(slots, now, 'UTC', 3, 'cheapest_block'), true);
assert.strictEqual(currentMatches(slots, new Date('2026-08-22T19:00:00Z'), 'UTC', 3, 'expensive'), true);

// Also accept an ISO timestamp object-map and EUR/MWh-like values.
const mwhPayload = {
  '2026-08-22T00:00:00Z': 120,
  '2026-08-22T01:00:00Z': 80,
};
const mwhSlots = normalizeDynamicPriceResponse(mwhPayload, { timezone: 'UTC' });
assert.strictEqual(mwhSlots.length, 2);
assert.strictEqual(mwhSlots[0].price, 0.12);
assert.strictEqual(mwhSlots[1].price, 0.08);

console.log('HomeFlux EMS Homey Energy tests: OK');

// Official Homey Energy response shape observed on a Belgian dynamic contract.
const officialStart = Date.parse('2026-08-21T22:00:00.000Z');
const officialPrices = Array.from({ length: 96 }, (_, index) => {
  const periodStart = new Date(officialStart + index * 15 * 60 * 1000).toISOString();
  const periodEnd = new Date(officialStart + (index + 1) * 15 * 60 * 1000).toISOString();
  let value = 0.10 + index / 10000;
  if (index >= 50 && index < 62) value = 0.001 + (index - 50) / 100000;
  return { periodStart, periodEnd, value };
});
const rawValues = officialPrices.map(row => row.value);
const rawMin = Math.min(...rawValues);
const rawMax = Math.max(...rawValues);
const rawAvg = rawValues.reduce((sum, value) => sum + value, 0) / rawValues.length;
const officialPayload = {
  zoneId: '10YBE----------2',
  zoneName: 'BE',
  priceIntervals: ['15', '60'],
  priceInterval: '15',
  interval: 15,
  pricesPerInterval: officialPrices,
  lowestPriceWithUserCosts: rawMin + 0.2,
  highestPriceWithUserCosts: rawMax + 0.2,
  averagePriceWithUserCosts: rawAvg + 0.2,
};
const officialSlots = normalizeDynamicPriceResponse(officialPayload, {
  dateHint: '2026-08-22',
  timezone: 'Europe/Brussels',
});
assert.strictEqual(officialSlots.length, 96, 'official Homey pricesPerInterval payload should parse all 96 slots');
assert.strictEqual(officialSlots[0].dateKey, '2026-08-22', '22:00 UTC should map to local midnight in Belgium in summer');
assert.strictEqual(officialSlots[0].minute, 0);
assert.ok(Math.abs(officialSlots[0].rawPrice - officialPrices[0].value) < 1e-9);
assert.ok(Math.abs(officialSlots[0].userCostAdder - 0.2) < 1e-6, 'Homey user cost adder should be inferred from summary fields');
assert.ok(Math.abs(officialSlots[0].price - (officialPrices[0].value + 0.2)) < 1e-6, 'slot price should include Homey user costs when safely inferable');
assert.strictEqual(inferIntervalMinutes(officialSlots), 15);
const officialAnalysis = analyzePriceSlots(officialSlots, new Date('2026-08-22T00:18:00.000Z'), 'Europe/Brussels', 3, 3);
assert.strictEqual(officialAnalysis.slotCount, 96);
assert.strictEqual(officialAnalysis.currentMinute, 135, '00:18 UTC is 02:18 local, inside the 02:15 slot');
assert.ok(Number.isFinite(officialAnalysis.currentPrice));
assert.ok(Number.isFinite(officialAnalysis.currentRawPrice));
assert.ok(Math.abs(officialAnalysis.currentUserCostAdder - 0.2) < 1e-6);

// Zero and negative prices are legitimate dynamic prices, never missing values.
const zeroNegativePayload = {
  pricesPerInterval: [
    { periodStart: '2026-08-21T22:00:00.000Z', periodEnd: '2026-08-21T22:15:00.000Z', value: 0 },
    { periodStart: '2026-08-21T22:15:00.000Z', periodEnd: '2026-08-21T22:30:00.000Z', value: -0.0001 },
  ],
};
const zeroNegativeSlots = normalizeDynamicPriceResponse(zeroNegativePayload, { timezone: 'Europe/Brussels' });
assert.strictEqual(zeroNegativeSlots.length, 2);
assert.strictEqual(zeroNegativeSlots[0].price, 0);
assert.strictEqual(zeroNegativeSlots[1].price, -0.0001);


// Quarter-hour Homey prices can be deliberately controlled as hourly prices.
{
  const hourly = resamplePriceSlots(officialSlots, 60);
  assert.strictEqual(hourly.length, 24);
  assert.strictEqual(inferIntervalMinutes(hourly), 60);
  const expectedFirst = officialSlots.slice(0, 4).reduce((sum, row) => sum + row.price, 0) / 4;
  assert.ok(Math.abs(hourly[0].price - expectedFirst) < 1e-9);
  const hourlyAnalysis = analyzePriceSlots(hourly, new Date('2026-08-22T00:18:00.000Z'), 'Europe/Brussels', 3, 3);
  assert.strictEqual(hourlyAnalysis.intervalMinutes, 60);
  assert.strictEqual(hourlyAnalysis.slotCount, 24);
}

console.log('HomeFlux EMS official Homey Energy payload tests: OK');
