'use strict';
const assert = require('node:assert/strict');
const { boot, DEFAULTS } = require('./startup-harness');
const { findCurrentTariff, evaluate } = require('../lib/ems-engine');
const { localParts, preparePriceAnalysis, buildDynamicTariffTimeline } = require('../lib/homey-energy');
const RealDate = Date;
let now = RealDate.parse('2026-11-14T20:50:00Z'); // 21:50 in Brussels
// Match the same virtual clock used by the existing price/source tests.
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};

function curve(interval = 15, days = 2) {
  const start = RealDate.parse('2026-11-13T23:00:00Z'); // Belgium winter midnight Nov 14
  return Array.from({ length: days * 24 * 60 / interval }, (_, i) => {
    const ms = start + i * interval * 60000;
    const parts = localParts(new Date(ms), 'Europe/Brussels');
    const today = parts.dateKey === '2026-11-14';
    let price;
    if (today) {
      price = parts.minuteOfDay < 180 ? 0.400 : 0.20;
      if (parts.minuteOfDay === 21 * 60 + 45) price = 0.374;
    } else {
      price = parts.minuteOfDay < 180 ? 0.345 : 0.15;
    }
    return { startMs: ms, dateKey: parts.dateKey, minute: parts.minuteOfDay, price };
  });
}

(async () => {
  try {
    const appSettings = { ...DEFAULTS, contractType: 'dynamic_quarter', timezone: 'Europe/Brussels',
      dynamicPriceSource: 'external', dynamicPriceSources: ['external'], cheapHours: 3, expensiveHours: 3,
      evCount: 0, hvacCount: 0, boilerCount: 0 };
    const { app } = await boot();
    app.getSettings = () => appSettings;
    app.externalEnergy = { slots: curve(), curveUpdatedAt: now, currentUpdatedAt: now };
    app.externalEnergyResampleCache = null;
    const runtime = app.getRuntimeSettings(appSettings);
    const tariff = findCurrentTariff(new Date(now), runtime);
    assert.equal(tariff.price, 0.374);
    assert.equal(tariff.className, 'normal');
    assert.equal(tariff.nextLabel, 'Duur €0.345/kWh');
    assert.equal(Number(tariff.nextAt), RealDate.parse('2026-11-14T23:00:00Z'));
    const snapshot = app.getPriceSelectionSnapshot();
    assert.equal(snapshot.selection.analysis.currentPrice, 0.374);
    assert.equal(app.getHomeyEnergyStatus(appSettings, new Date(now)).priceClass, 'normaal');
    assert.equal(runtime.dynamicSlots.length, 96, 'battery planning retains today-only slots');
    assert(runtime.dynamicTariffTimeline.length > 96, 'forward tariff look-ahead covers tomorrow');
    assert.equal(app.getRuntimeSettings(appSettings).dynamicTariffTimeline, runtime.dynamicTariffTimeline,
      'reuses timeline without rebuilding on repeated slow-context reads');
    // The real slow context and fast battery evaluator consume the exact
    // same tariff, without introducing another ranking pass in the P1 route.
    const state = app.getEvaluationState(appSettings, now);
    app.refreshControlContext(appSettings, state, now);
    assert.equal(app.controlContext.tariff.nextLabel, 'Duur €0.345/kWh');
    assert.equal(app.controlContext.tariffValidUntil, RealDate.parse('2026-11-14T23:00:00Z'));
    const evaluated = evaluate(state, app.controlRuntimeSettings, new Date(now), app.controlContext);
    assert.equal(evaluated.tariff.nextLabel, 'Duur €0.345/kWh');
    assert.equal(Number(evaluated.tariff.nextAt), RealDate.parse('2026-11-14T23:00:00Z'));

    // Real calendar rollover: tomorrow's daily classes become authoritative.
    now = RealDate.parse('2026-11-14T23:00:00Z');
    const midnightRuntime = app.getRuntimeSettings(appSettings);
    const midnightTariff = findCurrentTariff(new Date(now), midnightRuntime);
    assert.equal(midnightTariff.price, 0.345);
    assert.equal(midnightTariff.className, 'expensive');
    assert.equal(app.getHomeyEnergyStatus(appSettings, new Date(now)).currentPrice, 0.345);

    // With no tomorrow prices the engine MUST NOT invent tomorrow's rate from
    // today's midnight slot. It may still report genuine changes later today.
    now = RealDate.parse('2026-11-14T20:50:00Z');
    app.externalEnergy.slots = curve().filter(r => r.dateKey === '2026-11-14');
    app.externalEnergy.curveUpdatedAt = now + 1;
    app.externalEnergyResampleCache = null;
    const todayRuntime = app.getRuntimeSettings(appSettings);
    const todayTariff = findCurrentTariff(new Date(now), todayRuntime);
    assert.equal(todayTariff.price, 0.374);
    assert.equal(todayTariff.nextAt, null, 'missing tomorrow prices are unknown, not cyclic');
    const legacy = findCurrentTariff(new Date(now), { ...appSettings, dynamicSlots: todayRuntime.dynamicSlots });
    assert.equal(legacy.nextAt, null, 'direct engine callers cannot wrap day prices into tomorrow');

    // Hourly curves and date-qualified read-only source analysis agree.
    const hourly = curve(60);
    now = RealDate.parse('2026-11-14T20:05:00Z');
    const daily = preparePriceAnalysis(hourly, new Date(now), 'Europe/Brussels', 3, 3);
    const timeline = buildDynamicTariffTimeline(hourly, daily, new Date(now), 'Europe/Brussels');
    assert(timeline.some(r => r.startMs === RealDate.parse('2026-11-14T23:00:00Z')));
    assert(timeline.every((row, index) => !index || row.startMs > timeline[index - 1].startMs));

    // Real 23h/25h days retain chronological order and a genuine 24-hour
    // look-ahead, independent of local wall-clock hour duplication/omission.
    for (const at of ['2026-03-28T22:30:00Z', '2026-10-24T21:30:00Z']) {
      const clock = RealDate.parse(at);
      const dstRows = Array.from({ length: 3 * 24 * 4 + 20 }, (_, i) => {
        const startMs = clock - 2 * 3600000 + i * 15 * 60000;
        const lp = localParts(new Date(startMs), 'Europe/Brussels');
        return { startMs, dateKey: lp.dateKey, minute: lp.minuteOfDay, price: 0.2 + (i % 17) * .01 };
      });
      const dstPrepared = preparePriceAnalysis(dstRows, new Date(clock), 'Europe/Brussels', 3, 3);
      const dstTimeline = buildDynamicTariffTimeline(dstRows, dstPrepared, new Date(clock), 'Europe/Brussels');
      assert(dstTimeline.some(r => r.startMs <= clock && r.endMs > clock));
      assert(dstTimeline.some(r => r.startMs > clock + 23 * 3600000),
        'absolute 24-hour look-ahead crosses DST without local-day assumptions');
      assert(dstTimeline.every((row, i) => !i || row.startMs > dstTimeline[i - 1].startMs));
    }

    // Gaps in the source cannot certify future tariff changes across missing periods.
    const gapRows = curve().filter(r => r.minute < 22 * 60 || r.dateKey === '2026-11-15');
    const gdays = preparePriceAnalysis(gapRows, new Date(now), 'Europe/Brussels', 3, 3);
    const gtimeline = buildDynamicTariffTimeline(gapRows, gdays, new Date(now), 'Europe/Brussels');
    const gapResult = findCurrentTariff(new Date(RealDate.parse('2026-11-14T20:50:00Z')),
      { ...appSettings, dynamicSlots: curve().filter(r => r.dateKey === '2026-11-14').map(r => ({time:`${String(Math.floor(r.minute/60)).padStart(2,'0')}:${String(r.minute%60).padStart(2,'0')}`,price:r.price})), dynamicTariffTimeline: gtimeline });
    assert.equal(gapResult.nextAt, null);

    console.log('1.5.2 tariff date rollover: Brussels 21:50, midnight, missing tomorrow, cached look-ahead, hourly and gap coverage passed');
  } finally { global.Date = RealDate; }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
