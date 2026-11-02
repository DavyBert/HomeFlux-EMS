'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const { boot } = require('./startup-harness');
const { recordMinuteSample } = require('../lib/ev-session');
const NativeDate = Date, nativeNow = Date.now;
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
const restore = installVirtualClearTimeout(), rows = [];
const near = (a, b) => assert(Math.abs(a - b) < .01, `${a} != ${b}`);
const key = (i, suffix) => `${i ? 'ev' + (i + 1) : 'ev'}${suffix}`;
async function check(name, fn) { const evidence = await fn(); rows.push({ name, ...evidence }); console.log('PASS', name); }
async function make({ count = 1, type = 'mode' } = {}) {
  const config = {};
  for (let i = 0; i < count; i++) for (const [suffix, value] of Object.entries({ Enabled: true, SocEnabled: false,
    ControlType: type, Mode: 'emergency', Phases: 3, Voltage: 400, VoltageReference: 'line',
    ModeSmartCurrentA: 6, ModeStandardCurrentA: 16, MinCurrentA: 6, MaxCurrentA: 32,
    StandardCurrentA: 16, CommandIntervalSeconds: 7, PeakGuardStopHoldSeconds: 0 })) config[key(i, suffix)] = value;
  const h = await setup(undefined, { ...config, batteryCount: 0, controlEnabled: false, evCount: count,
    evIdleHouseLoadW: 4000, contractType: 'fixed', exportLimitEnabled: false,
    peakShaveEnabled: true, peakLimitW: 17500, peakSoftMarginW: 100 }, Date.parse('2026-10-28T12:00:00Z'), 0);
  const a = h.app;
  a.requestContextEvaluate = () => {}; a.requestEvaluate = () => {};
  await h.drain(); a.evPublishing = false;
  for (let i = 0; i < count; i++) {
    await h.cards.get(`set_ev${i + 1}_status`).listener({ connected: 'yes', charge_current: 0 });
    if (i) a.getExtraEv(i).publishing = false;
    await a.testEvOutput({ instance: i + 1, output: 'mode', mode: 'stop' });
  }
  a.evSessionDetection.portfolioBaselineW = 4000; a.evBatteryHouseReferenceW = 4000;
  a.evSessionDetection.houseHistory = []; a.evSessionDetection.recentHouseSamples = [];
  h.type = type; h.count = count; h.sent = [];
  for (let i = 0; i < count; i++) {
    const trigger = i ? a.extraEvTriggers[i - 1].mode : a.evModeTrigger;
    trigger.trigger = async tokens => h.sent.push({ i, at: h.now(), ...tokens });
  }
  return h;
}
async function sample(h, site = 10000, seconds = 65) {
  for (let n = 0; n < seconds; n++) {
    h.setNow(h.now() + 1000);
    await h.pv(0); await h.grid(site);
  }
}
async function publish(h, i = 0, mode = 'standard', force = true) {
  const a = h.app, on = mode !== 'stop';
  const last = i ? a.getExtraEv(i).lastPublishedAt : a.lastEvPublishedAt;
  if (h.now() < last + 8000) h.setNow(last + 8000);
  const d = { connected: Boolean(a.getEvInputSnapshot(i).connected), allowed: on,
    desiredCurrentA: on ? mode === 'smart' ? 6 : 16 : 0, desiredPowerW: on ? 11085 : 0,
    effectiveChargeMode: mode, requestedChargeMode: mode, source: on ? 'emergency' : 'off', mode: 'emergency',
    reason: 'publication test', peakLimited: false };
  if (i) { a.getExtraEv(i).forceOutput = force; await a.publishAdditionalEvDecision(i, d); }
  else { a.forceEvOutput = force; await a.publishEvDecision(d); }
  return d;
}
(async () => { try {
  await check('START publishes then freezes both histories before charging detection', async () => {
    const h = await make(); await sample(h, 4000); await publish(h);
    const a = h.app, history = JSON.stringify(a.evSessionDetection.houseHistory);
    assert.notEqual(a.getEvSessionDetectionRuntime(0).state, 'charging');
    await sample(h, 11000);
    near(a.evSessionDetection.portfolioBaselineW, 4000); assert(a.isEvModeHouseLearningFrozen());
    assert.equal(JSON.stringify(a.evSessionDetection.houseHistory), history);
    assert.equal(a.evSessionDetection.recentHouseSamples.length, 0);
    return { frozenW: 4000, physicalSimulatedSiteW: 11000 };
  });
  await check('Missing, zero and false-positive Mode amperes never change the frozen reference', async () => {
    const h = await make(); await publish(h);
    for (const current of [0, 30]) {
      await h.cards.get('set_ev1_status').listener({ connected: 'yes', charge_current: current });
      await sample(h, 14000, 10); near(h.app.evSessionDetection.portfolioBaselineW, 4000);
    }
    await sample(h, 14000, 70); near(h.app.evSessionDetection.portfolioBaselineW, 4000);
  });
  await check('Smart/Standard/Emergency switches and repeated START preserve one reference', async () => {
    const h = await make(); await publish(h, 0, 'smart');
    for (const mode of ['standard', 'smart', 'standard']) { await sample(h, 12000, 10); await publish(h, 0, mode); }
    h.app.setEvSessionOverrideFor(0, 'emergency', 'flow');
    const stored = JSON.stringify(h.store.get('_evModeHouseReference'));
    await publish(h, 0, 'standard');
    assert.equal(JSON.stringify(h.store.get('_evModeHouseReference')), stored);
    near(h.app.evSessionDetection.portfolioBaselineW, 4000);
  });
  await check('A computed STOP and publication mutex do not release the reference', async () => {
    const h = await make(); await publish(h); const a = h.app;
    a.latestEvDecision = { allowed: false, desiredCurrentA: 0, effectiveChargeMode: 'stop' };
    a.evPublishing = true; const sent = h.sent.length; await publish(h, 0, 'stop');
    assert.equal(h.sent.length, sent); await sample(h, 14000);
    assert(a.isEvModeHouseLearningFrozen()); near(a.evSessionDetection.portfolioBaselineW, 4000);
  });
  await check('Failed STOP trigger retains lock, saved receipt and both references', async () => {
    const h = await make(); await publish(h); const a = h.app;
    const saved = JSON.stringify(h.store.get('_evModeHouseReference'));
    a.evModeTrigger.trigger = async () => { throw new Error('simulated STOP failure'); };
    await assert.rejects(publish(h, 0, 'stop'), /STOP failure/); await sample(h, 14000);
    assert.equal(JSON.stringify(h.store.get('_evModeHouseReference')), saved);
    near(a.evSessionDetection.portfolioBaselineW, 4000); near(a.evBatteryHouseReferenceW, 4000);
    assert(a.isEvModeHouseLearningFrozen());
  });
  await check('Successful STOP alone releases; learning needs a new complete post-STOP window', async () => {
    const h = await make(); await sample(h, 4000); await publish(h); await sample(h, 14000);
    await publish(h, 0, 'stop'); const a = h.app;
    assert(!a.isEvModeHouseLearningFrozen()); near(a.evSessionDetection.portfolioBaselineW, 4000);
    assert.equal(a.evSessionDetection.recentHouseSamples.length, 0);
    await sample(h, 5000, 20); assert(a.getEvStartHouseReference().houseReferenceFallback);
    await sample(h, 5000, 45); assert(!a.getEvStartHouseReference().houseReferenceFallback);
    near(a.getEvStartHouseReference().houseReferenceW, 5000);
    await publish(h); near(a.evSessionDetection.portfolioBaselineW, 5000);
  });
  for (const phase of ['waiting', 'paused', 'ended']) await check(`${phase} session status cannot release an active command`, async () => {
    const h = await make(); await publish(h); const a = h.app, s = a.getEvSessionDetectionRuntime(0);
    if (phase === 'ended') a.markEvSessionEnded(0, 'flow'); else { s.state = phase; s.loadAbsent = true; }
    await sample(h, 14000); near(a.evSessionDetection.portfolioBaselineW, 4000);
    assert(a.isEvModeHouseLearningFrozen()); assert.equal(a.evSessionDetection.houseHistory.length, 0);
  });
  await check('Disconnect/reconnect retains the command reference until an actual STOP', async () => {
    const h = await make(); await publish(h); const a = h.app;
    for (const connected of ['no', 'yes']) {
      await h.cards.get('set_ev1_status').listener({ connected, charge_current: 0 });
      await sample(h, 14000); near(a.evSessionDetection.portfolioBaselineW, 4000);
      near(a.evBatteryHouseReferenceW, 4000); assert(a.isEvModeHouseLearningFrozen());
    }
  });
  await check('Second Mode EV and STOP of only one EV cannot replace the shared house reference', async () => {
    const h = await make({ count: 2 }); await publish(h); await sample(h, 14000);
    await publish(h, 1); near(h.app.evSessionDetection.portfolioBaselineW, 4000);
    await publish(h, 0, 'stop'); await sample(h, 16000);
    assert(h.app.isEvModeHouseLearningFrozen()); near(h.app.evSessionDetection.portfolioBaselineW, 4000);
    await publish(h, 1, 'stop'); assert(!h.app.isEvModeHouseLearningFrozen());
  });
  await check('EV2 failed STOP retains its receipt independently of EV1', async () => {
    const h = await make({ count: 2 }); await publish(h, 1);
    h.app.extraEvTriggers[0].mode.trigger = async () => { throw new Error('EV2 STOP failure'); };
    await assert.rejects(publish(h, 1, 'stop'), /EV2 STOP failure/);
    await sample(h, 16000); near(h.app.evSessionDetection.portfolioBaselineW, 4000);
    assert(h.app.isEvModeHouseLearningFrozen());
  });
  await check('Concurrent STARTs preserve the pre-send candidate when EV2 publishes before EV1', async () => {
    const h = await make({ count: 2 }); await sample(h, 5000); let release, reached = false;
    h.app.evModeTrigger.trigger = async () => { reached = true; await new Promise(r => { release = r; }); };
    const first = publish(h, 0); for (let n = 0; n < 200 && !reached; n++) await Promise.resolve();
    assert(reached); await publish(h, 1); near(h.app.evSessionDetection.portfolioBaselineW, 5000);
    release(); await first; near(h.app.evSessionDetection.portfolioBaselineW, 5000);
    assert(h.app.isEvModeHouseLearningFrozen());
  });
  await check('Permission failure after a successful STOP cannot undo that published STOP receipt', async () => {
    const h = await make(); await publish(h);
    h.app.evAllowedTrigger.trigger = async () => { throw new Error('permission failed later'); };
    await assert.rejects(publish(h, 0, 'stop'), /permission failed/);
    assert.equal(h.app.evModeHouseCommands[0].mode, 'stop'); assert(!h.app.isEvModeHouseLearningFrozen());
  });
  await check('Token-only STOP without Mode Flow publication cannot release the reference', async () => {
    const h = await make(); await publish(h); h.app.evModeTrigger = null;
    await publish(h, 0, 'stop'); assert.equal(h.app.lastPublishedEvChargeMode, 'stop');
    await sample(h, 14000); assert(h.app.isEvModeHouseLearningFrozen()); near(h.app.evSessionDetection.portfolioBaselineW, 4000);
  });
  await check('Token-only START does not manufacture a successfully sent command', async () => {
    const h = await make(); h.app.evModeTrigger = null; await publish(h);
    assert.equal(h.app.evModeHouseCommands[0].mode, 'stop'); assert(!h.app.isEvModeHouseLearningFrozen());
  });
  await check('P1 during an unresolved START trigger is quarantined; success freezes the pre-send value', async () => {
    const h = await make(); await sample(h, 4000); let release, reached = false;
    h.app.evModeTrigger.trigger = async () => { reached = true; await new Promise(r => { release = r; }); };
    const sending = publish(h); for (let i = 0; i < 200 && !reached; i++) await Promise.resolve();
    assert(reached); await sample(h, 14000, 2);
    assert(h.app.isEvModeHouseLearningFrozen()); assert.equal(h.app.evSessionDetection.recentHouseSamples.length, 0);
    release(); await sending; near(h.app.evSessionDetection.portfolioBaselineW, 4000);
  });
  await check('A failed START retains the previous STOP receipt and no in-flight samples', async () => {
    const h = await make(); h.app.evModeTrigger.trigger = async () => { throw new Error('START failed'); };
    await assert.rejects(publish(h), /START failed/); assert(!h.app.isEvModeHouseLearningFrozen());
    assert.equal(h.app.evModeHouseCommands[0].mode, 'stop'); assert.equal(h.app.evSessionDetection.recentHouseSamples.length, 0);
  });
  await check('Restart restores active command and reference before any P1; only the real startup STOP releases it', async () => {
    const h = await make(); await publish(h); const store = new Map(h.store); let running, release, reached = false;
    const starting = boot(store, ({ app }) => {
      running = app;
      app.homey.flow.getTriggerCard('ev1_charge_mode_updated').trigger = async () => {
        reached = true; await new Promise(r => { release = r; });
      };
    });
    for (let i = 0; i < 1000 && !reached; i++) await Promise.resolve();
    assert(reached); assert(running.isEvModeHouseLearningFrozen()); near(running.evSessionDetection.portfolioBaselineW, 4000);
    running.inputSeen.grid = true; running.inputSeen.pv = true;
    Object.assign(running.state, { gridPowerW: 14000, pvPowerW: 0, lastTotalCommandW: 0 });
    running.inputUpdatedAt.grid = Date.now(); running.inputUpdatedAt.pv = Date.now();
    running.recordEvHouseLoadSample(14000, Date.now());
    assert.equal(running.evSessionDetection.houseHistory.length, 0);
    release(); await starting; for (let i = 0; i < 200; i++) await Promise.resolve();
    assert.equal(running.evModeHouseCommands[0].mode, 'stop'); assert(!running.isEvModeHouseLearningFrozen());
  });
  await check('A saved old STOP is not physical evidence after restart until a new publication succeeds', async () => {
    const h = await make(); await publish(h); await publish(h, 0, 'stop'); let running, release, reached = false;
    const starting = boot(new Map(h.store), ({ app }) => {
      running = app; app.homey.flow.getTriggerCard('ev1_charge_mode_updated').trigger = async () => {
        reached = true; await new Promise(r => { release = r; });
      };
    });
    for (let i = 0; i < 1000 && !reached; i++) await Promise.resolve();
    assert(reached); assert.equal(running.evModeHouseCommands[0].mode, 'stop');
    assert(running.isEvModeHouseLearningFrozen()); near(running.evSessionDetection.portfolioBaselineW, 4000);
    release(); await starting; for (let i = 0; i < 200; i++) await Promise.resolve();
    assert(!running.isEvModeHouseLearningFrozen());
  });
  await check('Persisted zero and unknown house references remain distinct during startup recovery', async () => {
    for (const value of [0, null]) {
      const h = await make(); h.app.evSessionDetection.portfolioBaselineW = value; h.app.evBatteryHouseReferenceW = value;
      await publish(h); assert.strictEqual(h.store.get('_evModeHouseReference').referenceW, value);
      let running, release, reached = false;
      const starting = boot(new Map(h.store), ({ app }) => {
        running = app; app.homey.flow.getTriggerCard('ev1_charge_mode_updated').trigger = async () => {
          reached = true; await new Promise(r => { release = r; });
        };
      });
      for (let i = 0; i < 1000 && !reached; i++) await Promise.resolve();
      assert(reached); assert(running.isEvModeHouseLearningFrozen());
      assert.strictEqual(running.evSessionDetection.portfolioBaselineW, value);
      release(); await starting;
    }
  });
  await check('Mode output tests use the same actual-publication accounting for START and STOP', async () => {
    const h = await make(); await h.app.testEvOutput({ instance: 1, output: 'mode', mode: 'standard' });
    assert(h.app.isEvModeHouseLearningFrozen()); await sample(h, 14000);
    await h.app.testEvOutput({ instance: 1, output: 'mode', mode: 'stop' }); assert(!h.app.isEvModeHouseLearningFrozen());
  });
  await check('P1/refreshes do not persist per sample or request extra contexts from bookkeeping callbacks', async () => {
    const h = await make(); await publish(h); const a = h.app; let writes = 0, contexts = 0;
    const set = a.homey.settings.set; a.homey.settings.set = (k, v) => { if (k === '_evModeHouseReference') writes++; return set(k, v); };
    await sample(h, 14000, 300); assert.equal(writes, 0);
    a.requestContextEvaluate = () => { contexts++; };
    await h.setExternalSetting('_evModeHouseReference', h.store.get('_evModeHouseReference'));
    assert.equal(contexts, 0); assert(a.evSessionDetection.recentHouseSamples.length <= 64);
  });
  for (const type of ['current', 'hybrid']) await check(`${type} keeps existing measured-current house learning and no Mode persistence`, async () => {
    const h = await make({ type }), a = h.app; const before = JSON.stringify(h.store.get('_evModeHouseReference'));
    await publish(h); await sample(h, 4000, 5);
    assert.equal(JSON.stringify(h.store.get('_evModeHouseReference')), before); assert(!a.isEvModeHouseLearningFrozen());
  });
  await check('Mixed fleet cannot update battery house reference through another EV while Mode is frozen', async () => {
    const h = await make({ count: 2 }); await h.setExternalSetting('ev2ControlType', 'current'); await publish(h);
    await h.cards.get('set_ev2_status').listener({ connected: 'yes', charge_current: 10 });
    await sample(h, 16000); near(h.app.evBatteryHouseReferenceW, 4000);
    h.app.applyEvStartHouseReference(1, { at: h.now(), revision: h.app.evPhysicalConfigRevision,
      houseReferenceW: 12000, houseReferenceFallback: false });
    near(h.app.evSessionDetection.portfolioBaselineW, 4000);
  });
  fs.writeFileSync(path.join(__dirname, '../validation/ev-house-publication-1.2.5.json'), JSON.stringify({
    productionFunctions: true, simulatedHomey: true, physicalHardwareTested: false,
    passed: rows.length, results: rows }, null, 2) + '\n');
  console.log('Published Mode house reference:', rows.length, 'groups passed');
} finally { restore(); global.Date = NativeDate; Date.now = nativeNow; } })().catch(e => { console.error(e); process.exitCode = 1; });
