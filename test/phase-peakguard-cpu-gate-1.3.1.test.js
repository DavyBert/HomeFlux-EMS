'use strict';
const assert = require('node:assert/strict');
const P = require('../lib/phase-guard');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const realNow = Date.now;
const restore = installVirtualClearTimeout();

(async () => {
  try {
    for (const assist of [false, true]) for (const pattern of ['steady', 'jitter', 'limit-crossing']) {
      const h = await setup(undefined, {
        forcedMode: 'standby', batteryCount: 1, peakShaveEnabled: true,
        peakLimitW: 18000, peakSoftMarginW: 100, exportLimitEnabled: false,
        maxTotalDischargeW: 4000,
        phaseGuard: { ...P.defaults, phases: 3, enabled: true,
          peakGuardBatteryAssistEnabled: assist, limitW: 8000,
          voltage: 230, amps: 40, batteries: ['L1'] },
      }, Date.UTC(2026, 10, 11, 15, 0, 0), 0);
      const app = h.app;
      await h.start();
      await h.flush();
      // Model an active controllable load without introducing an extra EV
      // controller. We are verifying only the existing scheduling path.
      app.hasActiveFlexibleOutput = () => true;
      const reasons = [];
      const originalRequest = app.requestContextEvaluate.bind(app);
      app.requestContextEvaluate = (...args) => {
        if (args[1] === 'peak_guard_phase') reasons.push(args[1]);
        return originalRequest(...args);
      };
      const before = app.diagnostics.counters.fastEvaluations || 0;
      const contextsBefore = h.contexts.length;
      for (let second = 0; second < 25; second += 1) {
        h.setNow(h.now() + 1000);
        const delta = second % 2 ? 100 : -100;
        const l1 = pattern === 'steady' ? 9000 : pattern === 'jitter' ? 9000 + delta : 8000 + delta;
        await h.cards.get('set_grid_power_phases').listener({ power: l1 + 7000, l1, l2: 4000, l3: 3000 });
        await h.flush();
      }
      assert.equal(reasons.length, 1,
        `${pattern}: sustained overload must notify the existing context scheduler only on transition`);
      const fast = (app.diagnostics.counters.fastEvaluations || 0) - before;
      assert(fast <= (assist ? 4 : 0),
        `${pattern}: ${fast} redundant fast evaluations; phase updates must use the existing command interval`);
      assert(h.contexts.length - contextsBefore <= 2,
        `${pattern}: repeated P1 packets must coalesce through the existing slow scheduler`);
      if (pattern !== 'limit-crossing') {
        assert(P.phasePressure(app, app.getSettings(), h.now()) >= 900);
        assert(P.flexiblePeakSettings(app, app.getSettings(), h.now()).peakLimitW < 18000);
      }
      assert(app.state.gridPowerW < 18000, 'total grid remains below the ordinary Peak Guard limit');
      // Releasing well below the existing Peak Guard margin must clear the
      // signature, so a later real overload is not accidentally ignored.
      h.setNow(h.now() + 1000);
      await h.cards.get('set_grid_power_phases').listener({ power: 14000, l1: 7000, l2: 4000, l3: 3000 });
      await h.flush();
      assert.notEqual(app.flexibleSafetySignature, 'peak_guard_phase');
      assert.deepEqual(h.errors, []);
    }
    console.log('Phase Peak Guard scheduler: 6 scenarios, 25 P1 samples each (steady/noisy/limit-crossing, option OFF/ON), max 4 fast evaluations and one context transition.');
  } finally {
    restore();
    Date.now = realNow;
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
