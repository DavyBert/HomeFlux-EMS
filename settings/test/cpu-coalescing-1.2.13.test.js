'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const NativeDate = Date, originalNow = Date.now;
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
const restore = installVirtualClearTimeout();
async function main() {
  // A pending interval retains one timer/force flag; every execution goes back
  // through the genuine scheduler with the newest settings and physical state.
  for (const change of ['input', 'interval_longer', 'interval_shorter', 'publication', 'pause']) {
    const h = await setup(undefined, { exportLimitEnabled: false, forcedMode: 'self_consumption' }, NativeDate.parse('2026-10-20T10:00:00Z'), 0);
    const a = h.app; await h.start(); await h.flush();
    const at = h.now(); a.lastEmitAt = at; a.nextCommandAllowedAt = at + 7000;
    let preflights = 0; const original = a.shouldRunFastEvaluation;
    a.shouldRunFastEvaluation = function(...args) { preflights++; return original.apply(this, args); };
    a.requestEvaluate(true); const timer = a.controlTimer;
    assert(timer); assert.equal(timer.due, at + 7000);
    const before = preflights;
    for (let i = 1; i <= 5; i++) {
      h.setNow(at + i * 1000); a.state.gridPowerW = 800 + i * 70;
      a.inputUpdatedAt.grid = h.now(); a.requestEvaluate(i === 3);
      assert.equal(a.controlTimer, timer); assert(a.controlTimerForce);
    }
    assert.equal(preflights, before, 'queued requests must not repeat preflight');
    if (change === 'interval_longer') a.setSetting('commandIntervalSeconds', 12);
    if (change === 'interval_shorter') { a.setSetting('commandIntervalSeconds', 1); a.nextCommandAllowedAt = 0; }
    if (change === 'publication') { a.lastEmitAt = at + 5000; a.nextCommandAllowedAt = at + 12000; }
    if (change === 'pause') {
      a.setSetting('batteryCommandPauseEnabled', true);
      a.setSetting('batteryCommandPauseStart', '00:00'); a.setSetting('batteryCommandPauseEnd', '23:59');
      a.requestEvaluate(true); assert.equal(a.controlTimer, null); assert.equal(a.controlTimerForce, false);
    } else {
      h.setNow(at + 7000); a.inputUpdatedAt.grid = h.now(); await h.flush();
      if (['interval_longer', 'publication'].includes(change)) {
        assert(a.controlTimer); assert.equal(a.controlTimer.due, at + 12000); assert(a.controlTimerForce);
        h.setNow(at + 12000); a.inputUpdatedAt.grid = h.now(); await h.flush();
      }
      assert(preflights > before, 'execution must perform a fresh preflight');
      assert.equal(a.controlTimerForce, false);
      assert.equal(a.latestResult.liveGridPowerW, 1150);
    }
    assert.deepEqual(h.errors, []);
  }
  // Cache the scalar solar-day status, keeping the daily cold reset, complete
  // solar days, overnight windows, DST, settings and completed cycles exact.
  const h = await setup(undefined, { exportLimitEnabled: false, boilerCount: 1, boilerEnabled: true });
  const a = h.app;
  let reference = null;
  if (process.env.HF_BASELINE_ROOT) reference = (await require(path.resolve(process.env.HF_BASELINE_ROOT, 'test/startup-harness')).boot()).app;
  let windows = 0; const window = a.getBoilerSolarDayWindow;
  a.getBoilerSolarDayWindow = function(...args) { windows++; return window.apply(this, args); };
  let comparisons = 0;
  for (const zone of ['Europe/Brussels', 'UTC']) for (const start of ['07:00','23:00','02:30']) {
    a.homey.clock.getTimezone = () => zone;
    const settings = { ...a.getSettings(), timezone: zone, boilerDayStartTime: start,
      boilerDayEndTime: start === '23:00' ? '06:00' : '23:00', boilerColdResetTime: '07:00', boilerFallbackDays: 3 };
    const base = NativeDate.parse('2026-10-23T00:00:00Z');
    a.boilerState.lastCompletedAt = 0; a.boilerState.trackingStartedAt = base;
    for (let i = 0; i < 10 * 24 * 4; i++) {
      const now = base + i * 900000; h.setNow(now);
      const got = a.getBoilerSolarFallbackStatus(now, settings);
      const cache = a.boilerState.solarFallbackCache;
      const expected = reference ? reference.getBoilerSolarFallbackStatus.call(a, now, settings)
        : (() => { a.boilerState.solarFallbackCache = null; return a.getBoilerSolarFallbackStatus(now, settings); })();
      a.boilerState.solarFallbackCache = cache;
      assert.deepEqual(got, expected); comparisons++;
    }
    const now = base + 11 * 86400000 + 3600000; h.setNow(now);
    a.getBoilerSolarFallbackStatus(now, settings); const before = windows;
    for (let i = 0; i < 30; i++) a.getBoilerSolarFallbackStatus(now + i * 1000, settings);
    assert.equal(windows, before, 'same solar day must not rebuild calendar windows');
    for (const mutate of [s => { s.boilerFallbackDays = 1; }, s => { s.boilerDayEndTime = '22:00'; },
      s => { s.boilerDayStartTime = '08:00'; }, s => { a.boilerState.lastCompletedAt = now - 3600000; },
      s => { s.boilerColdResetTime = '09:00'; }]) {
      mutate(settings); const got = a.getBoilerSolarFallbackStatus(now, settings);
      const cached = a.boilerState.solarFallbackCache; a.boilerState.solarFallbackCache = null;
      const expected = reference ? reference.getBoilerSolarFallbackStatus.call(a, now, settings) : a.getBoilerSolarFallbackStatus(now, settings);
      a.boilerState.solarFallbackCache = cached; assert.deepEqual(got, expected); comparisons++;
    }
    // Clock moving backwards and caller mutation cannot poison later status.
    const got = a.getBoilerSolarFallbackStatus(now - 86400000, settings); got.missedSolarDays = -999;
    assert.notEqual(a.getBoilerSolarFallbackStatus(now - 86400000, settings).missedSolarDays, -999);
  }
  a.homey.clock.getTimezone = () => 'Europe/Brussels';
  const settings = { ...a.getSettings(), boilerColdResetTime: '07:00' };
  a.boilerState.lastCompletedAt = NativeDate.parse('2026-11-01T04:00:00Z');
  assert(a.isBoilerCompletedToday(NativeDate.parse('2026-11-01T05:59:59Z'), settings));
  assert.equal(a.isBoilerCompletedToday(NativeDate.parse('2026-11-01T06:00:00Z'), settings), false, 'cold reset remains 07:00 local');
  assert.deepEqual(h.errors, []);
  console.log(`PASS 1.2.13: queued preflights, force, latest inputs, interval/publication changes, pause; ${comparisons} solar-day/DST/cache comparisons and daily cold reset.`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => { restore(); global.Date = NativeDate; Date.now = originalNow; });
