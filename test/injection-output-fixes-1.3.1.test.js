'use strict';
const assert = require('node:assert/strict');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const injection = require('../lib/active-injection');
const restore = installVirtualClearTimeout(), originalNow = Date.now;

async function fresh(extra = {}) {
  const h = await setup(undefined, { injectionEnabled: true, fixedImportPrice: .87,
    fixedFeedInPrice: .87, peakShaveEnabled: false, exportLimitEnabled: false,
    optimizeMultiBatteryEfficiency: false, ...extra }, Date.parse('2026-11-09T14:05:00Z'), 0);
  await h.drain();
  h.app.requestEvaluate = () => {};
  h.app.requestContextEvaluate = () => {};
  h.app.setSetting('splitCommandBattery1Enabled', true);
  h.app.setSetting('splitCommandBattery1MinimumPowerW', 100);
  h.app.setSetting('_chargeTestSignature', h.app.getChargeTestSignature());
  h.app.getSplitPowerDelayMs = () => 0;
  return h;
}

(async () => {
  let groups = 0;
  try {
    for (const zeroMode of ['charge', 'discharge']) {
      const h = await fresh(), a = h.app, split = [];
      a.setSetting('splitCommandBattery1ZeroMode', zeroMode);
      a.setSetting('_chargeTestSignature', a.getChargeTestSignature());
      a.splitCommandTriggers[0].dischargePower.trigger = async t => split.push(t.power);
      a.splitCommandTriggers[0].chargePower.trigger = async t => split.push(t.power);
      await injection.start(a);
      a.evaluateContextNow(true); await h.drain();
      assert(a.lastEmittedCommands[0] > 0);
      const mode = a.splitCommandState[0].currentMode;
      a.state.batterySoc.fill(40);
      injection.tick(a, a.getSettings(), h.now(), false); await h.drain();
      assert.deepEqual(a.lastEmittedCommands, [0, 0, 0, 0]);
      assert.equal(split.at(-1), 0);
      assert.equal(a.splitCommandState[0].currentMode, mode);
      assert.equal(injection.locked(a), false);
      assert.deepEqual(h.errors, []);
      groups++;
    }

    {
      const h = await fresh(), a = h.app;
      a.state.batterySoc = [10, 80, 80, 80];
      await injection.start(a); a.evaluateContextNow(true); await h.drain();
      assert.equal(a.latestResult.candidateCommands[0], 0);
      assert.equal(a.lastEmittedCommands[0], 0);
      assert(a.lastEmittedCommands.slice(1).some(x => x > 0));
      assert.deepEqual(h.errors, []);
      groups++;
    }

    {
      const h = await fresh(), a = h.app;
      a.setSetting('splitCommandBattery1MinimumPowerW', 1000);
      a.setSetting('_chargeTestSignature', a.getChargeTestSignature());
      await injection.start(a);
      const options = injection.engineState(a, a.getSettings());
      const output = await a.publishSplitBatteryCommands([50, 0, 0, 0], a.getSettings(), options);
      assert.equal(output[0], 50, 'Split minimum cannot increase the bounded injection request');
      a.splitCommandState[0].currentMode = null;
      a.splitCommandTriggers[0].dischargeMode.trigger = async () => { a.state.batterySoc[0] = 10; };
      const afterFeedback = await a.publishSplitBatteryCommands([800, 0, 0, 0], a.getSettings(), options);
      assert.equal(afterFeedback[0], 0, 'Fresh per-battery SoC is checked after mode I/O');
      groups++;
    }

    {
      const h = await fresh(), a = h.app, powers = [];
      await injection.start(a);
      const options = injection.engineState(a, a.getSettings());
      a.splitCommandState[0].currentMode = 'discharge';
      const writeTokens = a.setSplitOutputTokens.bind(a);
      a.setSplitOutputTokens = async (...args) => {
        await writeTokens(...args);
        a.state.batterySoc[0] = 10;
      };
      a.splitCommandTriggers[0].dischargePower.trigger = async tokens => powers.push(tokens.power);
      const afterTags = await a.publishSplitBatteryCommands([800, 0, 0, 0], a.getSettings(), options);
      assert.equal(afterTags[0], 0, 'SoC changes during Logic-tag writes are checked at the physical trigger');
      assert.equal(powers.at(-1), 0);
      groups++;
    }
    {
      const h = await fresh({ injectionEnabled: false, forcedMode: 'self_consumption',
        overrideResumeOnTariffChange: false }), a = h.app;
      a.state.batterySoc = [10, 80, 80, 80];
      a.evaluateContextNow(true); await h.drain();
      assert.equal(a.latestResult.candidateCommands[0], 0);
      assert.equal(a.lastEmittedCommands[0], 100, 'Disabled injection preserves existing configured Split minimum');
      assert.deepEqual(h.errors, []);
      groups++;
    }
    console.log('Injection physical output fixes 1.3.1:', groups, 'scenario groups passed');
  } finally { restore(); Date.now = originalNow; }
})().catch(error => { console.error(error); process.exitCode = 1; });
