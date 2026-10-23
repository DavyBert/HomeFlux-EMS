'use strict';
const assert = require('node:assert/strict');
const { fixture } = require('./ev-work-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const originalNow = Date.now, restore = installVirtualClearTimeout();
const count = (a, key) => a.diagnostics.counters[key] || 0;
let cases = 0;
async function at(h, ms) { h.setNow(h.origin + ms); await h.flush(); }
async function stopped(options = {}) {
  const h = await fixture({ batteries: 0, batteryEnabled: false, ...options });
  assert.equal(h.app.lastPublishedEvChargeMode, 'stop');
  h.origin = h.now();
  return h;
}

async function timerRecovery() {
  for (const route of ['flow','api','expiry','queue']) {
    const h = await stopped(), a = h.app;
    await h.pv(500); await h.grid(623); await h.flush();
    const timer = a.evContextRefresh.timer;
    assert(timer); const before = count(a, 'evContextDeferredEvaluations');
    let release;
    if (route === 'queue') {
      a.evPortfolioPass = new Promise(resolve => { release = resolve; });
      await at(h, 15000); assert(a.evContextRefresh.due);
    } else await at(h, 8000);
    if (route === 'api') a.setInput({ pvPowerW: 0 });
    else if (route === 'expiry' || route === 'queue') {
      // Model a newer available PV value before its normal handler completes.
      // Deadline/lock validation must independently reject the stale reason.
      a.state.pvPowerW = 0; a.inputUpdatedAt.pv = h.now();
    } else await h.pv(0);
    if (route === 'flow' || route === 'api') assert.equal(a.evContextRefresh.timer, null);
    if (release) { a.evPortfolioPass = null; release(); await h.drain(); }
    await at(h, 16000); await h.drain(); await h.flush();
    assert.equal(count(a, 'evContextDeferredEvaluations'), before, route);
    assert.equal(a.evContextRefresh.timer, null); assert.equal(a.evContextRefresh.requests.size, 0);
    assert.equal(a.lastPublishedEvChargeMode, 'stop'); assert.deepEqual(h.errors, []); cases++;
  }
  const h = await stopped(), a = h.app;
  await h.grid(1123); const timer = a.evContextRefresh.timer;
  for (let second = 1; second < 15; second++) {
    await at(h, second * 1000); await h.grid(1123);
    assert.equal(a.evContextRefresh.timer, timer); assert.equal(timer.due, h.origin + 15000);
  }
  assert.equal(count(a, 'evContextTimersStarted'), 1);
  assert.equal(count(a, 'evContextRequestsCoalesced'), 14);
  const deferred = a.getDiagnosticsReport().ev.deferredContext;
  assert.equal(deferred.startedAt, h.origin);
  assert.equal(deferred.deadlineAt, h.origin + 15000);
  assert(deferred.reasons.includes('meter'));
  await at(h, 15000); assert.equal(count(a, 'evContextDeferredEvaluations'), 1);
  for (let second = 16; second <= 45; second++) { await at(h, second * 1000); await h.grid(1123); }
  assert.equal(count(a, 'evContextTimersStarted'), 1); assert.equal(a.evContextRefresh.timer, null); cases++;
  assert.equal(a.getDiagnosticsReport().ev.deferredContext.deadlineAt, 0);
}

async function multipleReasons() {
  const h = await stopped({ evs: 2 }), a = h.app;
  await h.pv(500); await h.grid(623); const first = a.evContextRefresh.timer;
  await at(h, 3000);
  await h.cards.get('set_ev2_status').listener({ connected: 'yes', charge_current: 10 });
  assert(a.evContextRefresh.requests.has('feedback:1'));
  await at(h, 8000); await h.pv(0);
  assert(!a.evContextRefresh.requests.has('meter'));
  assert(a.evContextRefresh.requests.has('feedback:1'));
  assert.equal(a.evContextRefresh.timer, first, 'resolving one reason cannot extend another');
  await at(h, 15000);
  assert.equal(count(a, 'evContextDeferredEvaluations'), 1); assert.equal(a.evContextRefresh.requests.size, 0);
  assert.deepEqual(h.errors, []); cases++;
  const q = await stopped({ evs: 2 }), b = q.app;
  await q.grid(1123); const timer = b.evContextRefresh.timer;
  await at(q, 5000);
  await q.cards.get('set_ev1_status').listener({ connected:'no', charge_current:0 });
  await q.cards.get('set_ev2_status').listener({ connected:'no', charge_current:0 });
  await q.drain(); await q.flush(); timer.fn(); await at(q, 17000);
  assert.equal(count(b, 'evContextDeferredEvaluations'), 0); assert(!b.evContextRefresh.timer);
  await q.cards.get('set_ev1_status').listener({ connected:'yes', charge_current:0 });
  await q.drain(); await q.flush(); assert(b.latestEvDecision.connected); assert.deepEqual(q.errors, []); cases++;
}

async function scopedAccounting() {
  for (const connected of [true, false]) {
    const h = await fixture({ connected }), a = h.app;
    await h.grid(2500 - a.state.lastTotalCommandW); await h.start(); await h.flush();
    h.setNow(h.now() + 10000); await h.flush(); await h.grid(2500 - a.state.lastTotalCommandW); await h.start(); await h.flush();
    const before = count(a, 'evPhysicalAccountingChecks'), settings = count(a, 'evInstanceSettingsBuilds');
    h.origin = h.now();
    for (let second = 1; second <= 45; second++) { await at(h, second * 1000); await h.grid(2500 - a.state.lastTotalCommandW); }
    assert(count(a, 'evPhysicalAccountingChecks') - before <= 50);
    assert(count(a, 'evPhysicalAccountingReused') > 30);
    assert(count(a, 'evInstanceSettingsBuilds') - settings < 110);
    if (!connected) assert(count(a, 'evPhysicalAccountingInactiveSkipped') > 30);
    assert.equal(a.lastPublishedEvChargeMode, 'stop'); assert.deepEqual(h.errors, []); cases++;
  }
  const h = await fixture({ type:'current', chargeAllowed:true }), a = h.app;
  await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:16});
  await h.grid(623 + 16 * Math.sqrt(3) * 400 - a.state.lastTotalCommandW); await h.start(); await h.flush();
  const physical = a.getEvGridImportControlStatus.bind(a); let calls = 0;
  a.getEvGridImportControlStatus = (...args) => { calls++; return physical(...args); };
  // One public status read is still fresh. It must never consume the preceding
  // fast request's observation or a status result from the same millisecond.
  let one = a.getPublicStatus().evGridControl;
  assert(one.activeTargetW > 0);
  a.state.evChargeCurrentA = 6;
  a.inputUpdatedAt.ev.chargeCurrent = h.now();
  let two = a.getPublicStatus().evGridControl;
  assert(two.activeTargetW < one.activeTargetW); assert.equal(calls, 2); cases++;
  const priorCommand = a.state.lastTotalCommandW;
  a.state.lastTotalCommandW = priorCommand + 500;
  const three = a.getPublicStatus().evGridControl;
  assert.equal(three.batteryDischargeW, Math.max(0, priorCommand + 500));
  assert.equal(calls, 3, 'changed battery command gets its own physical validation');
  a.state.lastTotalCommandW = priorCommand;
  const before = calls;
  const tokens = [], gate = a.shouldRunFastEvaluation.bind(a);
  a.shouldRunFastEvaluation = function(force, settings, now, preflight) {
    tokens.push(preflight.evObservation); return gate(force, settings, now, preflight);
  };
  await h.grid(4500); await h.grid(4501); // Deliberately the same Date.now().
  assert(tokens.length >= 2); assert.notEqual(tokens[0], tokens[1]); assert(calls >= before + 2); cases++;
  const oldSettings = a.getEvInstanceSettings(0);
  await h.setExternalSetting('evTargetSoc', 65); await h.drain(); await h.flush();
  assert.equal(a.getEvInstanceSettings(0).evTargetSoc, 65); assert.equal(oldSettings.evTargetSoc, 80); cases++;
  await h.cards.get('set_ev1_soc_deadline').listener({ target_soc:70,time:'12:30',guarantee:'no' });
  await h.drain(); await h.flush();
  const deadline = a.getEvInstanceSettings(0).evSocDeadlineAt;
  h.setNow(deadline + 1);
  const rolled = a.getEvInstanceSettings(0).evSocDeadlineAt;
  assert(rolled > h.now()); assert(rolled > deadline); cases++;
  assert.deepEqual(h.errors, []);
}

async function quietAndRestLoad() {
  for (const type of ['current','mode','hybrid']) {
    const h = await fixture({ type, connected:false }), a = h.app;
    assert(a.isEvPortfolioQuiet(a.getSettings()));
    const n = count(a, 'evPortfolioCalculations'); await a.runEvHeartbeat(); await h.drain(); await h.flush();
    assert.equal(count(a, 'evPortfolioCalculations'), n); assert(count(a, 'evHeartbeatQuietSkipped') > 0); cases++;
    a.forceEvOutput = true; assert(!a.isEvPortfolioQuiet(a.getSettings()));
    await a.runEvHeartbeat(); await h.drain(); await h.flush(); assert(!a.forceEvOutput); cases++;
  }
  const h = await stopped(), a = h.app;
  assert(!a.isEvPortfolioQuiet(a.getSettings()), 'connected waiting EV retains tariff/deadline heartbeat');
  const n = count(a, 'evPortfolioCalculations'); await a.runEvHeartbeat(); await h.drain();
  assert(count(a, 'evPortfolioCalculations') > n); cases++;
  const q = await fixture({ connected:false }), b = q.app;
  let release; b.evPortfolioPass = new Promise(resolve=>{release=resolve;});
  const before = count(b, 'evPortfolioCalculations'), task = b.runEvHeartbeat();
  await q.drain(); b.evPortfolioPass = null; release(); await task; await q.drain();
  assert.equal(count(b, 'evPortfolioCalculations'), before, 'quiet is checked again after I/O'); cases++;
  b.evBatteryCurrentDrop = [{ at:q.now()+1, expiresAt:q.now()+60000, currentA:16 }];
  assert(!b.isEvPortfolioQuiet(b.getSettings())); assert(b.hasEvPhysicalAccountingInput(b.getSettings(),q.now()));
  q.setNow(q.now()+2);
  b.inputUpdatedAt.grid = q.now();
  assert(b.isEvPortfolioQuiet(b.getSettings())); assert(!b.hasEvPhysicalAccountingInput(b.getSettings(),q.now())); cases++;
}

(async()=>{try{
  await timerRecovery(); await multipleReasons(); await scopedAccounting(); await quietAndRestLoad();
  console.log(`1.1.15 EV work: ${cases} targeted scenarios passed.`);
}finally{Date.now=originalNow;restore();}})().catch(err=>{console.error(err);process.exitCode=1;});
