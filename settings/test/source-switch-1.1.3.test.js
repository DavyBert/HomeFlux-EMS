'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');

async function settled(overrides = {}) {
  const h = await setup(path.join(__dirname, '..'), {
    gridControlWindowSeconds: 0, maxTotalChargeW: 1000,
    adaptiveLiveControlEnabled: false, ...overrides,
  }, Date.parse('2026-10-13T11:32:10Z'), 1550);
  await h.start();
  h.setNow(h.now() + 10000);
  await h.grid(50);
  h.app.requestEvaluate(true);
  await h.drain();
  return h;
}

async function run() {
  const realNow = Date.now;
  const restore = installVirtualClearTimeout();
  try {
    // Genuine settings/cache/engine/output. Cross zero repeatedly with exactly
    // the same individual commands; an unseen pair still needs numeric proof.
    {
      const h = await settled(), a = h.app;
      const before = a.diagnostics.counters.fastEvaluations;
      const commands = [...a.lastEmittedCommands], publishes = h.traces.length;
      for (let i = 0; i < 12; i++) {
        h.setNow(h.now() + 1000);
        await h.grid(i % 2 ? 50 : -50);
        await h.flush();
      }
      assert.equal(a.diagnostics.counters.fastEvaluations, before);
      assert.deepEqual(a.lastEmittedCommands, commands);
      assert.equal(h.traces.length, publishes);
      assert(a.diagnostics.counters.fastChargeZoneUnchangedSkipped > 0);
      // Raw P1 defeats the zone proof and reaches the unchanged Peak Guard.
      h.setNow(h.now() + 1000);
      await h.grid(4000); await h.flush();
      assert.equal(a.latestResult.override, 'peak_shave');
      assert.deepEqual(h.errors, []);
    }
    // Stale committed output is rejected BEFORE evaluation-state construction.
    {
      const h = await settled(), a = h.app;
      a.state.lastTotalCommandW -= 1;
      let builds = 0;
      const original = a.getEvaluationState.bind(a);
      a.getEvaluationState = (...args) => { builds++; return original(...args); };
      assert.equal(a.canSkipBatteryFeedback(a.getSettings(), h.now()), false);
      assert.equal(builds, 0);
      assert(a.diagnostics.counters.fastChargeOutputMemoRejected > 0);
    }
    // A failed dependency proof shares only this synchronous state. Altering
    // SoC forces full calculation, with one state build rather than two.
    {
      const h = await settled(), a = h.app;
      a.state.batterySoc[0] = 100;
      let builds = 0;
      const original = a.getEvaluationState.bind(a);
      a.getEvaluationState = (...args) => { builds++; return original(...args); };
      const before = a.diagnostics.counters.fastEvaluations;
      await h.grid(50); await h.flush();
      assert.equal(a.diagnostics.counters.fastEvaluations, before + 1);
      assert.equal(builds, 1);
      assert.equal(a.lastEmittedCommands[0], 0);
      assert(a.diagnostics.counters.fastEvaluationStateReused > 0);
      assert.deepEqual(h.errors, []);
    }
    // No state construction while the hard interval is reserved; the existing
    // timer then reads the newest SoC and P1, rather than a queued old state.
    {
      const h = await settled(), a = h.app;
      a.nextCommandAllowedAt = h.now() + 7000;
      const due = a.nextCommandAllowedAt;
      let builds = 0;
      const original = a.getEvaluationState.bind(a);
      a.getEvaluationState = (...args) => { builds++; return original(...args); };
      for (let i = 1; i <= 6; i++) {
        h.setNow(due - 7000 + i * 1000);
        await h.grid(-100 - i * 100); await h.flush();
      }
      assert.equal(builds, 0);
      assert(a.controlTimer);
      a.state.batterySoc[0] = 100;
      h.setNow(due);
      await h.grid(-1800); await h.flush();
      assert.equal(builds, 1);
      assert.equal(a.lastEmittedCommands[0], 0);
      assert(a.diagnostics.counters.fastChargePreflightDeferred > 0);
      assert.deepEqual(h.errors, []);
    }
    // Expired minute/tariff proofs and adaptive transitions retain full checks.
    {
      const h = await settled(), a = h.app;
      h.setNow(a.batteryFeedbackMemo.validUntil);
      const before = a.diagnostics.counters.fastEvaluations;
      await h.grid(-50); await h.flush();
      assert(a.diagnostics.counters.fastEvaluations > before);
      assert.deepEqual(h.errors, []);
    }
    console.log('1.1.3 source-switch: fixed cap, raw Peak Guard, stale output, synchronous reuse, newest timer inputs and proof expiry passed.');
  } finally { Date.now = realNow; restore(); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
