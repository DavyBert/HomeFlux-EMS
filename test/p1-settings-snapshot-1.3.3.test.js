'use strict';
const assert = require('node:assert/strict');
const { boot, DEFAULTS } = require('./startup-harness');
const batteryResponseTest = require('../lib/battery-response-test');

(async () => {
  // One Flow input should share one ordinary settings snapshot across
  // Savings, the fast request and its synchronous helper functions.
  {
    const h = await boot(new Map(Object.entries({ ...DEFAULTS,
      evCount: 0, hvacCount: 0, boilerCount: 0, batteryCount: 4,
      controlEnabled: true, contractType: 'fixed' })));
    const app = h.app;
    app.inputSeen.grid = true;
    app.inputUpdatedAt.grid = Date.now();
    app.state.gridPowerW = 800;
    app.startP1Trace();
    await h.cards.get('set_grid_power').listener({ power: 800 });
    await h.cards.get('set_grid_power_phases').listener({ power: 790, l1: 300, l2: 250, l3: 240 });
    const report = app.stopP1Trace();
    assert.equal(report.totalP1, 2);
    assert(report.cycles.some(cycle => cycle.settingsReads === 1),
      `An ordinary synchronous P1 cycle should take just one snapshot: ${report.cycles.map(c => c.settingsReads)}`);
    assert(report.cycles.every(cycle => cycle.settingsReads >= 1),
      'A battery/context publication may independently read fresh safety settings');
    assert.equal(h.errors.length, 0, h.errors.join('\n'));
  }

  // A genuine await may allow settings to change while a Flow listener is
  // suspended. Subsequent control must discard the old snapshot.
  {
    const h = await boot(new Map(Object.entries({ ...DEFAULTS,
      evCount: 0, hvacCount: 0, boilerCount: 0, controlEnabled: true,
      commandIntervalSeconds: 7 })));
    const app = h.app;
    app.inputSeen.grid = true;
    app.inputUpdatedAt.grid = Date.now();
    app.state.gridPowerW = 500;
    const previousActive = batteryResponseTest.active;
    const previousObserve = batteryResponseTest.observe;
    const previousRequest = app.requestEvaluate;
    const requests = [];
    try {
      batteryResponseTest.active = () => true;
      batteryResponseTest.observe = async () => {
        await Promise.resolve();
        app.setSetting('commandIntervalSeconds', 17);
      };
      app.requestEvaluate = function (immediate, settingsSnapshot) {
        requests.push({ suppliedSnapshot: settingsSnapshot, latest: this.getSettings().commandIntervalSeconds });
        return previousRequest.call(this, immediate, settingsSnapshot);
      };
      await h.cards.get('set_grid_power').listener({ power: 500 });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].suppliedSnapshot, null,
        'P1 must drop its earlier settings snapshot after an actual await');
      assert.equal(requests[0].latest, 17,
        'The next control pass must see a setting changed during the await');
    } finally {
      batteryResponseTest.active = previousActive;
      batteryResponseTest.observe = previousObserve;
      app.requestEvaluate = previousRequest;
    }
    assert.equal(h.errors.length, 0, h.errors.join('\n'));
  }

  // A postponed battery pass is a NEW invocation and must fetch fresh settings
  // rather than retaining any snapshot from the triggering P1 packet.
  {
    const h = await boot(new Map(Object.entries({ ...DEFAULTS,
      evCount: 0, hvacCount: 0, boilerCount: 0, controlEnabled: true,
      commandIntervalSeconds: 7 })));
    const app = h.app;
    app.nextCommandAllowedAt = Date.now() + 9000;
    const settings = app.getSettings();
    const originalRequest = app.requestEvaluate;
    const observed = [];
    app.requestEvaluate = function (immediate, snapshot) {
      observed.push({ immediate, snapshot, currentInterval: this.getSettings().commandIntervalSeconds });
      return originalRequest.call(this, immediate, snapshot);
    };
    app.requestEvaluate(true, settings);
    const scheduled = h.timers.filter(entry => entry.type === 'timeout' && entry.ms >= 1 && entry.ms <= 9000);
    assert(scheduled.length > 0, 'A deferred battery evaluation must be scheduled');
    app.setSetting('commandIntervalSeconds', 13);
    scheduled.at(-1).fn();
    assert(observed.length >= 2, 'The deferred timer must enter a new control request');
    assert.equal(observed.at(-1).snapshot, undefined,
      'Timers must never retain an earlier P1 settings object');
    assert.equal(observed.at(-1).currentInterval, 13,
      'Deferred controls must see updated settings');
    assert.equal(h.errors.length, 0, h.errors.join('\n'));
  }
  console.log('P1 settings snapshots: single synchronous read, await invalidation, and fresh deferred timer settings passed');
})().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
