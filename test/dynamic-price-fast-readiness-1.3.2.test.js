'use strict';
const assert = require('node:assert/strict');
const { boot, DEFAULTS } = require('./startup-harness');
const { localParts } = require('../lib/homey-energy');

(async () => {
  const RealDate = Date;
  let now = RealDate.parse('2026-11-13T12:03:00Z');
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  try {
    const { app } = await boot();
    app.homey.clock.getTimezone = () => 'UTC';
    const settings = { ...DEFAULTS, contractType: 'dynamic_quarter', timezone: 'UTC',
      dynamicPriceSources: ['homey'], dynamicPriceSource: 'homey', controlEnabled: true,
      batteryCount: 1, chargeTestPassed: true, evCount: 0, hvacCount: 0, boilerCount: 0 };
    app.getSettings = () => settings;
    app.isChargeTestValid = () => true;
    const dateStart = Date.parse('2026-11-13T00:00:00Z');
    const makeSlots = (interval, hours = 48) => Array.from({ length: hours * 60 / interval }, (_, i) => {
      const at = dateStart + i * interval * 60000;
      const p = localParts(new Date(at), 'UTC');
      return { startMs: at, dateKey: p.dateKey, minute: p.minuteOfDay, price: 0.12 + (i % 11) * 0.03 };
    });
    app.homeyEnergy = { available: true, lastUpdatedAt: now, slots: makeSlots(15), formulaKnown: true, formulaKey: 'x' };
    app.inputSeen.grid = true;
    app.state.gridPowerW = 120;
    app.inputUpdatedAt.grid = now;
    app.inputSeen.batterySoc = [true];
    app.state.batterySoc = [55];
    app.state.forecastRemainingKwh = 8;
    app.state.forecastDailyMaxKwh = 8;
    const refresh = () => app.refreshControlContext(settings, app.getEvaluationState(settings, now), now);
    const sameReadiness = () => {
      const full = app.getInputReadiness(settings);
      const prepared = app.getInputReadiness(settings, { preparedPrices: true });
      assert.equal(prepared.priceDataReady, full.priceDataReady, 'prepared and complete pricing agree');
      assert.equal(prepared.ready, full.ready, 'grid safety remains identical');
    };
    refresh();
    sameReadiness();
    // Unrelated structural invalidation must not turn an already validated
    // price curve into a false warning or affect battery output permission.
    app.markContextDirty('battery_soc_changed');
    assert.equal(app.controlContextDirty, true);
    assert.equal(app.getInputReadiness(settings, { preparedPrices: true }).priceDataReady, true);
    assert.equal(app.getInputReadiness(settings, { preparedPrices: true }).ready, true);
    assert.equal(app.getPublicStatus().priceData.ready, true);
    // The flag still invalidates battery feedback proofs; only its influence
    // on the independent price-readiness check has been removed.
    assert.equal(app.isBatteryFeedbackContextCurrent({ result: { baseMode: 'self_consumption' } }), false);
    // Do not present an outdated price source or classification as current.
    settings.dynamicPriceSources = ['external'];
    assert.equal(app.getInputReadiness(settings, { preparedPrices: true }).priceDataReady, false);
    settings.dynamicPriceSources = ['homey'];
    settings.cheapHours = 4;
    assert.equal(app.getInputReadiness(settings, { preparedPrices: true }).priceDataReady, false);
    settings.cheapHours = DEFAULTS.cheapHours;
    refresh();
    sameReadiness();
    let analyses = 0;
    const getSelection = app.getDynamicPriceSelection;
    app.getDynamicPriceSelection = function(...args) { analyses++; return getSelection.apply(this, args); };
    for (let i = 0; i < 300; i++) {
      // A pending battery context never forces fresh price ranking on P1.
      if (i === 30) app.markContextDirty('pending_battery_plan');
      now += 1000;
      app.inputUpdatedAt.grid = now;
      const r = app.getInputReadiness(settings, { preparedPrices: true });
      assert.equal(r.priceDataReady, true);
      if (i % 60 === 0) {
        app.priceSourceHeartbeatSignature = 'homey|disabled';
        app.requestContextEvaluate = () => {};
        app.runContextHeartbeat();
      }
    }
    assert.equal(analyses, 0, 'P1/heartbeat must never reselect, rank or calibrate curves');
    // Failing Homey freshness must be noticed without accepting a stale source.
    now = app.homeyEnergy.lastUpdatedAt + 21 * 60000;
    app.inputUpdatedAt.grid = now;
    assert.equal(app.getInputReadiness(settings, { preparedPrices: true }).priceDataReady, false);
    assert.equal(app.getInputReadiness(settings).priceDataReady, false);
    app.markContextDirty('pending_battery_plan');
    assert.equal(app.getInputReadiness(settings, { preparedPrices: true }).priceDataReady, false,
      'an actually expired price source must remain invalid while context is dirty');
    // Existing refresh path must validate the new curve before it becomes active.
    app.homeyEnergy.lastUpdatedAt = now;
    app.homeyEnergy.slots = makeSlots(15).map(row => ({ ...row, price: row.price + 0.04 }));
    refresh();
    sameReadiness();
    settings.cheapHours = 4;
    refresh();
    sameReadiness();
    // Existing source input event must request an immediate context pass.
    const requests = [];
    app.requestContextEvaluate = (immediate, reason) => requests.push([immediate, reason]);
    const incoming = [{ periodStart: new Date(dateStart).toISOString(), value: 0.17 }];
    assert.equal(app.readExternalPrices('external', JSON.stringify(incoming)), true);
    assert(requests.some(([immediate, reason]) => immediate && reason === 'external_electricity_price_curve'));
    for (const interval of [60, 15]) {
      settings.contractType = interval === 60 ? 'dynamic_hour' : 'dynamic_quarter';
      app.homeyEnergy.slots = makeSlots(interval);
      app.homeyEnergy.lastUpdatedAt = now;
      refresh();
      sameReadiness();
    }
    // Midnight: do not treat yesterday's slot as today's current price.
    now = Date.parse('2026-11-14T00:00:00Z');
    app.inputUpdatedAt.grid = now;
    refresh();
    sameReadiness();
    console.log('Dynamic fast price readiness: 300 P1 samples, heartbeat, stale source, input arrival, thresholds, hourly/quarter-hour and midnight passed');
  } finally { global.Date = RealDate; }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
