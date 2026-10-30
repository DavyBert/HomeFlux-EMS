'use strict';
const assert = require('node:assert/strict');
const { fixture, pass, perAmpW } = require('./ev-battery-transition-1.1.9.test');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const originalNow = Date.now;
const restore = installVirtualClearTimeout();
const independent = { batteryCount: 0, controlEnabled: false };
let cases = 0;
const count = (a, name) => a.diagnostics.counters[name] || 0;
async function ready(type = 'current', evs = 1, settings = {}) {
  const h = await fixture(type, 7, evs, { ...independent, ...settings });
  h.app.state.pvProducingDate = h.app.getLocalDateKey(new Date(h.now()));
  h.app.state.pvSeenProducingToday = true;
  h.setNow(h.now() + 8000);
  await h.grid(623); await h.flush(); await pass(h); await h.flush();
  assert.equal(h.app.evContextRefresh.timer, null);
  return h;
}
async function at(h, second) { h.setNow(h.origin + second * 1000); await h.flush(); }
async function meter(h, pv) { await h.pv(pv); await h.grid(623 - pv - h.app.state.lastTotalCommandW); await h.flush(); }
async function transientAndSustained() {
  const h = await ready(), a = h.app; h.origin = h.now();
  const before = count(a, 'evPortfolioCalculations');
  for (let second = 1; second <= 8; second++) { await at(h, second); await meter(h, second % 2 ? 50 : 0); }
  assert.equal(a.evContextRefresh.timer, null, 'sub-threshold noise does not request EV strategy');
  await at(h, 10); await meter(h, 500);
  const first = a.evContextRefresh.timer;
  assert.equal(first.due, h.origin + 25000);
  for (let second = 11; second < 15; second++) { await at(h, second); await meter(h, 500); assert.equal(a.evContextRefresh.timer, first); }
  await at(h, 15); await meter(h, 0);
  assert.equal(a.evContextRefresh.timer, null); assert(first.done);
  first.fn(); // Even an already-dispatched obsolete callback is harmless.
  await at(h, 27);
  assert.equal(count(a, 'evPortfolioCalculations'), before);
  assert.equal(count(a, 'evContextTimersCancelled'), 1);
  cases += 3;
  await at(h, 30); await meter(h, 500);
  const timer = a.evContextRefresh.timer;
  for (let second = 31; second < 45; second++) { await at(h, second); await meter(h, 500); assert.equal(a.evContextRefresh.timer, timer); }
  assert.equal(count(a, 'evPortfolioCalculations'), before);
  await at(h, 45);
  assert.equal(count(a, 'evPortfolioCalculations'), before, '15-second meter debounce only requests slow context');
  await at(h, 60);
  const afterSlow=count(a, 'evPortfolioCalculations');assert(afterSlow>before);assert.equal(a.evContextRefresh.requests.size,0);
  for (let second = 61; second <= 65; second++) { await at(h, second); await meter(h, 500); }
  assert.equal(a.evContextRefresh.timer, null, 'same handled situation cannot start another timer');
  assert.equal(count(a, 'evPortfolioCalculations'), afterSlow);
  assert.deepEqual(h.errors, []); cases++;
}
async function normalContextAndMulti() {
  const h = await ready(), a = h.app; h.origin = h.now();
  await at(h, 1); await meter(h, 400);
  const old = a.evContextRefresh.timer;
  await at(h, 6); await pass(h);
  const after = count(a, 'evPortfolioCalculations');
  assert(old.done); assert.equal(a.evContextRefresh.timer, null);
  await at(h, 20); old.fn(); await h.drain(); await h.flush();
  assert.equal(count(a, 'evPortfolioCalculations'), after);
  cases++;
  const m = await ready('hybrid', 2), b = m.app; m.origin = m.now();
  const before = count(b, 'evPortfolioCalculations');
  await at(m, 1); await m.cards.get('set_ev1_status').listener({ connected: 'yes', charge_current: 10 });
  const timer = b.evContextRefresh.timer;
  await at(m, 4); await m.cards.get('set_ev2_status').listener({ connected: 'yes', charge_current: 11 });
  assert.equal(b.evContextRefresh.timer, timer);
  await at(m, 8); await m.cards.get('set_ev1_status').listener({ connected: 'yes', charge_current: 0 });
  assert(!b.evContextRefresh.requests.has('feedback:0'));
  assert(b.evContextRefresh.requests.has('feedback:1'));
  assert.equal(b.evContextRefresh.timer, timer);
  await at(m, 16);
  assert.equal(count(b, 'evPortfolioCalculations'), before);
  await at(m,60);assert(count(b, 'evPortfolioCalculations')>before);
  assert.equal(b.evContextRefresh.requests.size, 0);
  assert.equal(b.latestResult.evDecisions.length, 2);
  assert.deepEqual(m.errors, []); cases++;
}
async function immediateSafety() {
  for (const type of ['current', 'mode', 'hybrid']) {
    const h = await ready(type, 2, { peakShaveEnabled: true, peakLimitW: 40000, peakSoftMarginW: 0 }), a = h.app;
    h.origin = h.now();
    assert(a.isEvOutputActiveFor(0));
    await at(h, 1); await meter(h, 500);
    assert(a.evContextRefresh.timer);
    await at(h, 2); await h.grid(100000); await h.flush();
    assert.equal(a.lastPublishedEvAllowed, false, `${type}: Peak Guard STOP on same meter event`);
    assert.equal(a.getExtraEv(1).lastPublishedAllowed, false);
    assert(h.flexible.some(x => x.at === h.now() && x.tokens.allowed_value === 0));
    assert.equal(a.evContextRefresh.timer, null);
    assert.deepEqual(h.errors, []); cases++;
  }
  for (const route of ['flow', 'api']) {
    const h = await ready('current', 2), a = h.app; h.origin = h.now();
    await at(h, 1); await meter(h, 500);
    await at(h, 2);
    if (route === 'api') a.setInput({ ev: { connected: false, chargeCurrentA: 0 }, evs: [null, { connected: false, chargeCurrentA: 0 }] });
    else await h.cards.get('set_ev1_status').listener({ connected: 'no', charge_current: 0 });
    await h.drain(); await h.flush();
    assert.equal(a.lastPublishedEvAllowed, false, `${route}: disconnect STOP cannot wait for debounce`);
    if (route === 'api') assert.equal(a.getExtraEv(1).lastPublishedAllowed, false);
    assert.deepEqual(h.errors, []); cases++;
  }
}
async function outputAndQueuedCancellation() {
  const h = await ready('hybrid', 2), a = h.app; h.origin = h.now();
  const full = h.contexts.length, before = count(a, 'evPortfolioCalculations');
  a.scheduleEvPublish(1234); a.scheduleAdditionalEvPublish(1, 1234);
  await at(h, 1.234);
  assert.equal(h.contexts.length, full, 'output deadline does not run full EMS');
  assert.equal(count(a, 'evPortfolioCalculations'), before, 'output timers request slow context without scanning');
  await at(h,60);assert(h.contexts.length>full);assert(count(a,'evPortfolioCalculations')>before);
  cases++;
  const q = await ready(), b = q.app; q.origin = q.now();
  let release;
  b.evPortfolioPass = new Promise(resolve => { release = resolve; });
  const initial = count(b, 'evPortfolioCalculations');
  await at(q, 1); await meter(q, 500);
  await at(q, 16);
  assert(b.evContextRefresh.due);
  await at(q, 17); await meter(q, 0);
  assert(!b.evContextRefresh.due);
  // A different request starts before the older queued task completes.
  await at(q, 18); await meter(q, 800);
  const newTimer = b.evContextRefresh.timer;
  b.evPortfolioPass = null; release(); await q.drain();
  assert.equal(count(b, 'evPortfolioCalculations'), initial);
  assert.equal(b.evContextRefresh.timer, newTimer, 'old completion cannot erase a newer generation');
  await at(q, 33);
  assert.equal(count(b, 'evPortfolioCalculations'), initial);
  await at(q,60);assert(count(b,'evPortfolioCalculations')>initial);assert.equal(b.evContextRefresh.requests.size,0);
  cases++;
  const stop = await ready(), c = stop.app; stop.origin = stop.now();
  await at(stop, 1); await meter(stop, 500);
  const timer = c.evContextRefresh.timer;
  await c.onUninit();
  assert(timer.done); assert.equal(c.evContextRefresh.timer, null);
  timer.fn(); await stop.drain();
  assert.equal(count(c, 'evContextDeferredEvaluations'), 0); cases++;
  const removed = await ready(), d = removed.app; removed.origin = removed.now();
  await at(removed, 1); await meter(removed, 500);
  const obsolete = d.evContextRefresh.timer;
  await removed.setExternalSetting('evCount', 0); await removed.drain(); await removed.flush();
  assert(obsolete.done); assert.equal(d.evContextRefresh.reference, null);
  assert.equal(d.lastPublishedEvAllowed, false);
  obsolete.fn(); await removed.drain();
  assert.equal(count(d, 'evContextDeferredEvaluations'), 0); cases++;
}
async function duplicatesAndIndependence() {
  for (const type of ['current', 'mode', 'hybrid']) {
    const h = await ready(type), a = h.app;
    await h.cards.get('set_ev1_status').listener({ connected: 'yes', charge_current: 10 });
    await h.grid(623 + 10 * perAmpW); await pass(h);
    h.origin = h.now();
    const before = { feedback: count(a, 'evFeedbackInputs'), unchanged: count(a, 'evFeedbackUnchanged'), calculations: count(a, 'evPortfolioCalculations') };
    for (let second = 1; second <= 300; second++) {
      h.setNow(h.origin + second * 1000);
      await h.cards.get('set_ev1_status').listener({ connected: 'yes', charge_current: 10 });
      await h.grid(623 + 10 * perAmpW); await h.flush();
      if (second % 60 === 0) { a.runContextHeartbeat(); await a.runEvHeartbeat(); await h.drain(); await h.flush(); }
    }
    assert.equal(count(a, 'evFeedbackInputs') - before.feedback, 300);
    assert.equal(count(a, 'evFeedbackUnchanged') - before.unchanged, 300);
    assert(count(a, 'evPortfolioCalculations') - before.calculations <= 20);
    assert.equal(a.inputUpdatedAt.ev.chargeCurrent, h.now());
    assert.deepEqual(h.errors, []); cases++;
  }
  for (const extra of [{ batteryCount: 0, controlEnabled: true }, { batteryCount: 4, controlEnabled: false }]) {
    const h = await ready('current', 1, extra);
    assert(h.app.lastPublishedEvAllowed, 'tariff EV works independently of battery control');
    assert(h.traces.every(trace => trace.total === 0), 'inactive battery cannot publish charging/discharging power'); cases++;
  }
}
(async () => {
  try {
    await transientAndSustained(); await normalContextAndMulti(); await immediateSafety();
    await outputAndQueuedCancellation(); await duplicatesAndIndependence();
    console.log(`1.1.13 deferred EV context: ${cases} scenarios passed.`);
  } finally { Date.now = originalNow; restore(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
