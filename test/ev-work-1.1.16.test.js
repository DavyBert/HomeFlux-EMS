'use strict';
const assert = require('node:assert/strict');
const { fixture } = require('./ev-work-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const restore = installVirtualClearTimeout();
let cases = 0;
const count = (app, key) => app.diagnostics.counters[key] || 0;

async function overlap({ evs = 1, change = false, tariffBoundary = false, flowGoal = false } = {}) {
  const h = await fixture({ evs, type: 'current', batteries: 0, batteryEnabled: false,
    chargeAllowed: true }), a = h.app;
  let resume, entered;
  const pending = new Promise(resolve => { resume = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const original = a.publishEvDecision;
  a.publishEvDecision = async function(decision) {
    await original.call(this, decision);
    entered();
    await pending;
  };
  const before = count(a, 'evPortfolioCalculations');
  const first = a.publishEvPortfolio(null,0,0,{evOnly:true}); // Exercise the publication mutex directly; production timers use slow context.
  await started;
  assert(a.evPortfolioPass);
  const waiting = a.runEvHeartbeat();
  if (change) {
    // A fresh P1 sample while Homey I/O is still pending must defeat reuse.
    a.state.gridPowerW += 900;
    a.inputUpdatedAt.grid = h.now();
  }
  if (tariffBoundary) h.setNow(h.now() + 60000);
  if (flowGoal) await h.cards.get('set_ev1_soc_deadline').listener({
    target_soc: 95, time: '12:30', guarantee: 'yes',
  });
  resume();
  await Promise.all([first, waiting]);
  assert.deepEqual(h.errors, []);
  const delta = count(a, 'evPortfolioCalculations') - before;
  if (flowGoal) {
    assert(delta >= 2, 'a new Flow target during I/O needs fresh work');
    assert.equal(a.evSocPlans[0].targetSoc, 95);
  } else if (change || tariffBoundary) {
    assert.equal(delta,1,'heartbeat cannot run a second portfolio itself');
    h.setNow(h.now()+a.getSlowControlIntervalMs());a.inputUpdatedAt.grid=h.now();await h.flush();assert(count(a,'evPortfolioCalculations')-before>=2,'slow context refreshes changed input/time');
  }
  else {
    assert.equal(delta, 1, 'one shared portfolio handles a simultaneous heartbeat');
    assert(count(a,'evSlowContextRequests')>=1);
  }
  cases++;
}

async function endedStillConnected() {
  const h = await fixture({ type: 'mode', chargeAllowed: false,
    batteries: 0, batteryEnabled: false }), a = h.app;
  // The last STOP has already been acknowledged and no current is present.
  a.getEvSessionDetectionRuntime(0).endedLatched = true;
  a.lastPublishedEvChargeMode = 'stop';
  a.lastPublishedEvAllowed = false;
  assert.equal(a.isEvPortfolioQuiet(a.getSettings()), true);
  a.getEvSessionDetectionRuntime(0).observedModePowerW = 2500;
  a.getEvSessionDetectionRuntime(0).loadAbsent = false;
  assert.equal(a.isEvPortfolioQuiet(a.getSettings()), false, 'physical mode load still needs service');
  a.getEvSessionDetectionRuntime(0).observedModePowerW = null;
  const before = count(a, 'evPortfolioCalculations');
  await a.runEvHeartbeat();
  assert.equal(count(a, 'evPortfolioCalculations'), before);
  // Old charge feedback is still a safety input: it must not be suppressed.
  a.state.evChargeCurrentA = 10;
  a.inputUpdatedAt.ev.chargeCurrent = h.now();
  assert.equal(a.isEvPortfolioQuiet(a.getSettings()), false);
  await a.runEvHeartbeat();
  assert.equal(count(a,'evPortfolioCalculations'),before,'physical feedback requests context, not a separate scan');
  h.setNow(h.now()+a.getSlowControlIntervalMs());a.inputUpdatedAt.grid=h.now();await h.flush();assert(count(a,'evPortfolioCalculations')>before);
  assert.deepEqual(h.errors, []);
  cases++;
}

async function liveStatusNoActuation() {
  for (const type of ['mode', 'current', 'hybrid']) {
    const h = await fixture({ type, evs: 2, chargeAllowed: true }), a = h.app;
    const before = { calculations: count(a, 'evPortfolioCalculations'), flexible: h.flexible.length,
      battery: h.traces.length, builds: count(a, 'evInstanceSettingsBuilds') };
    for (let n = 0; n < 10; n++) {
      const state = a.getPublicStatus();
      assert.equal(state.evs.length, 2);
    }
    assert.equal(count(a, 'evPortfolioCalculations'), before.calculations);
    assert.equal(h.flexible.length, before.flexible);
    assert.equal(h.traces.length, before.battery);
    assert(count(a, 'evInstanceSettingsBuilds') - before.builds <= 20,
      'one status request should not fully expand a policy more than once per EV');
    cases++;
  }
}
(async () => { try {
  await overlap(); await overlap({ evs: 2 }); await overlap({ change: true });
  await overlap({ tariffBoundary: true }); await overlap({ flowGoal: true });
  await endedStillConnected(); await liveStatusNoActuation();
  console.log(`1.1.16 EV work: ${cases} concurrent, safety and status scenarios passed.`);
} finally { restore(); } })().catch(error => { console.error(error); process.exitCode = 1; });
