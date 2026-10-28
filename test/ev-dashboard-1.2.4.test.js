'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./startup-harness');
const { create } = require('../widgets/ev/public/controller');
const api = require('../widgets/ev/api');
const cases = [];
const check = async (name, fn) => { await fn(); cases.push(name); };
(async () => {
  const h = await boot(new Map(Object.entries({ evCount: 4, batteryCount: 0, controlEnabled: false })));
  const a = h.app; a.requestContextEvaluate = () => {};
  const flow = (id, kind, args) => h.cards.get(`set_ev${id}_${kind}_deadline`).listener(args);
  let sequence = 0;
  const submit = (evId, change, extra = {}) => api.setSchedule({ homey: { app: a }, body: {
    evId, change, requestId: 'test_request_' + ++sequence, ...extra } });
  await check('One/multiple EVs use stable 1..4 IDs, configured names and explicit unknown feedback', () => {
    const status = a.getEvDashboard(); assert.equal(status.evs.length, 4);
    assert.deepEqual(status.evs.map(e => e.id), ['1','2','3','4']); assert.equal(status.evs[0].soc, null);
    assert.equal(status.evs[0].connected, null);
  });
  await check('Guaranteed without a plan, target only and deadline only never create a plan', async () => {
    for (const change of [{ guaranteed: true }, { target: { type: 'soc', value: 80 } }, { time: '07:00' }]) {
      await assert.rejects(submit('1', change), /incomplete/); assert.equal(a.evSocPlans[0].active, false);
    }
  });
  await check('SoC submission reuses EXACT registered Flow listener and persistence', async () => {
    await submit('1', { target: { type: 'soc', value: 80 }, time: '07:00', guaranteed: false }, { createOnly: true });
    assert.equal(a.evSocPlans[0].targetSoc, 80); assert.equal(h.store.get('evSocDeadlineOverrides')[0].targetSoc, 80);
  });
  await check('A newer 90% Flow goal survives an outdated widget deadline-only action', async () => {
    await flow(1, 'soc', { target_soc: 90, time: '07:00', guarantee: 'yes' });
    await submit('1', { time: '12:00' });
    assert.equal(a.evSocPlans[0].targetSoc, 90); assert.equal(a.evSocPlans[0].targetTime, '12:00'); assert(a.evSocPlans[0].guarantee);
  });
  await check('Target patches keep latest deadline; Guaranteed changes keep target and deadline', async () => {
    await submit('1', { target: { type: 'soc', value: 60 } });
    await submit('1', { guaranteed: false });
    assert.equal(a.evSocPlans[0].targetSoc, 60); assert.equal(a.evSocPlans[0].targetTime, '12:00'); assert(!a.evSocPlans[0].guarantee);
  });
  await check('kWh uses original targetKwh semantics, supports zero and exact validation', async () => {
    await submit('2', { target: { type: 'kwh', value: 10 }, time: '17:00', guaranteed: true }, { createOnly: true });
    assert.equal(a.evEnergyPlans[1].targetKwh, 10); assert.equal(a.evEnergyPlans[1].remainingKwh, 10);
    await submit('2', { target: { type: 'kwh', value: 0 } });
    assert(a.evEnergyPlans[1].active); assert.equal(a.evEnergyPlans[1].targetKwh, 0);
    const before = JSON.stringify(a.evEnergyPlans);
    await assert.rejects(submit('2', { target: { type: 'kwh', value: 251 } }), /input/);
    assert.equal(JSON.stringify(a.evEnergyPlans), before);
  });
  await check('Invalid input preserves previous valid plan; wrong EV never falls back to EV1', async () => {
    const before = JSON.stringify(a.evSocPlans);
    await assert.rejects(submit('1', { time: '25:00' }), /input/);
    for (const id of ['0','5','garbage',null]) await assert.rejects(submit(id, { time: '07:00' }), /ev/);
    assert.equal(JSON.stringify(a.evSocPlans), before);
  });
  await check('Simultaneous Flow and widget updates use synchronous current read/commit', async () => {
    const f = flow(1, 'soc', { target_soc: 91, time: '07:00', guarantee: 'yes' });
    const w = submit('1', { time: '17:00' }); await Promise.all([f, w]);
    assert.equal(a.evSocPlans[0].targetSoc, 91); assert.equal(a.evSocPlans[0].targetTime, '17:00');
  });
  await check('Stale complete drafts cannot override a Flow plan; active patches cannot carry stale full state', async () => {
    await assert.rejects(submit('1', { target: { type: 'soc', value: 80 }, time: '07:00' }, { createOnly: true }), /changed/);
    await assert.rejects(submit('1', { target: { type: 'soc', value: 80 }, time: '07:00' }), /changed/);
    assert.equal(a.evSocPlans[0].targetSoc, 91);
  });
  await check('Request-ID deduplication gives one handler execution and rejects ID reuse with another payload', async () => {
    const original = a.slotFlowCards.actions.get('set_ev1_soc_deadline'); let calls = 0;
    a.slotFlowCards.actions.set('set_ev1_soc_deadline', args => { calls++; return original(args); });
    const body = { evId: '1', change: { guaranteed: false }, requestId: 'same_request_1234' };
    await Promise.all([a.setEvDashboard(body), a.setEvDashboard(body)]); assert.equal(calls, 1);
    assert.throws(() => a.setEvDashboard({ ...body, change: { guaranteed: true } }), /input/);
    a.slotFlowCards.actions.set('set_ev1_soc_deadline', original);
  });
  await check('Restart restores widget-created SoC/kWh overrides via unchanged persistence', async () => {
    const reboot = await boot(new Map(h.store));
    assert.equal(reboot.app.evSocPlans[0].targetSoc, 91); assert.equal(reboot.app.evEnergyPlans[1].targetKwh, 0);
  });
  await check('Widget reads never evaluate, submit commands, record energy or rebuild a planner', () => {
    for (const method of ['recordSavingsSample','evaluateContextNow','publishEvPortfolio','setEvSocPlan','setEvEnergyPlan']) {
      const saved = a[method]; a[method] = () => { throw Error('Read called '+method); };
      for (let i = 0; i < 5; i++) a.getEvDashboard('week'); a[method] = saved;
    }
  });
  let clock = 1000, sent = [], resolve;
  const c = create({ now: () => clock, send: body => { sent.push(body); return new Promise(r => { resolve = r; }); }, nonce: () => 'widget_a' });
  c.select('1'); c.update({ type: 'soc', value: 80, time: '07:00', guaranteed: false });
  await check('First tap only selects; second SAME tap confirms; busy suppresses rapid duplicates', async () => {
    assert((await c.tap('soc', { target: { type: 'soc', value: 100 } })).confirm); assert.equal(sent.length, 0);
    const request = c.tap('soc', { target: { type: 'soc', value: 100 } }); assert.equal(sent.length, 1);
    assert((await c.tap('soc', {})).ignored); resolve({ accepted: true, plan: { type: 'soc', value: 100, time: '07:00' } });
    assert((await request).success);
  });
  await check('Five-second expiry and another button require a new first tap', async () => {
    await c.tap('time1', { time: '12:00' }); clock += 5000;
    assert((await c.tap('time1', { time: '12:00' })).confirm);
    assert((await c.tap('time2', { time: '17:00' })).confirm); assert.equal(sent.length, 1);
  });
  await check('EV switch and page invalidation cancel confirmations and discard a delayed previous-EV response', async () => {
    c.select('2'); assert.equal(c.snapshot().pending, null);
    c.update({ type: 'soc', value: 60, time: '07:00' });
    await c.tap('time', { time: '12:00' }); const job = c.tap('time', {});
    c.select('3'); resolve({ accepted: true, plan: { type: 'soc', value: 60, time: '12:00' } });
    assert((await job).stale); assert.equal(c.snapshot().selected, '3'); assert.equal(c.snapshot().current, null);
    await c.tap('goal', { target: { type: 'soc', value: 80 } }); c.invalidate(); assert.equal(c.snapshot().pending, null);
  });
  await check('No-plan Guaranteed, target and time are local drafts until complete and twice confirmed', async () => {
    const bodies = []; const d = create({ now: () => clock, send: async body => { bodies.push(body); return { accepted: true, plan: body.change }; } });
    d.select('4');
    for (const [key, change] of [['g',{ guaranteed:true }],['t',{ target:{type:'kwh',value:20} }]]) {
      await d.tap(key, change); assert((await d.tap(key, change)).draft);
    }
    assert.equal(bodies.length, 0);
    await d.tap('d',{time:'07:00'}); assert((await d.tap('d',{time:'07:00'})).success);
    assert.equal(bodies.length, 1); assert(bodies[0].createOnly); assert(bodies[0].change.guaranteed);
    assert.equal(bodies[0].change.target.value, 20);
  });
  await check('Rejected requests never show success and leave central plan unchanged', async () => {
    const d = create({ send: async () => { throw Error('failed'); } }); d.select('1'); d.update(a.getEvDashboard().evs[0].plan);
    await d.tap('x',{time:'12:00'}); await assert.rejects(d.tap('x',{time:'12:00'}), /failed/); assert(!d.snapshot().busy);
    assert.equal(a.evSocPlans[0].targetTime, '17:00');
  });
  await check('Independent widget instances and configured SoC/kWh/time presets', () => {
    const d = create({ send: async () => {} }); d.select('2'); assert.notEqual(d.snapshot().selected, c.snapshot().selected);
    const p = a.getEvDashboard().evs[0].presets;
    assert.deepEqual(p.soc,[60,80,100]); assert.deepEqual(p.kwh,[5,10,20]); assert.deepEqual(p.times,['07:00','12:00','17:00']);
  });
  await check('Unavailable realtime transport cannot reject a committed goal or create an unhandled promise', async () => {
    const saved = a.homey.api; a.homey.api = { realtime: () => Promise.reject(new Error('offline')) };
    await submit('1', { guaranteed: true });
    assert(a.evSocPlans[0].guarantee); a.homey.api = saved;
  });
  await check('Future slots and an allowed command never override the central session status', () => {
    const decision = a.latestEvDecision, planner = a.evDeadlinePlanner;
    const session = a.getEvSessionDetectionRuntime(0), before = { ...session };
    Object.assign(session, { state: 'waiting' });
    a.latestEvDecision = { allowed: true, source: 'emergency', desiredCurrentA: 10,
      deadlinePlanGoalRevision: a.evDeadlineGoalRevision?.[0] || 0,
      deadlinePlanSettingsRevision: a.evDeadlineSettingsRevision || 0 };
    a.evDeadlinePlanner = { plans: new Map([[0,{ slots:[{ startAt:Date.now()+3600000,powerW:1000 }] }]]) };
    assert.equal(a.getEvDashboard().evs[0].state, 'waiting');
    Object.assign(session, { state: 'paused' });assert.equal(a.getEvDashboard().evs[0].state, 'paused');
    a.latestEvDecision = decision; a.evDeadlinePlanner = planner; Object.assign(session, before);
  });
  await check('Four EVs read their own central session; missing status stays unknown and reads do not monitor', () => {
    const saved = a.evSessionDetection.sessions.map(s => ({ ...s }));
    const states = ['charging','paused','waiting','ended'];
    states.forEach((state,i) => { a.getEvSessionDetectionRuntime(i).state = state; });
    const monitorMethods = ['getEvMeasuredCurrent','getEvGridImportControlStatus','updateEvPortfolioLoadDetection','updateEvSessionFromCurrent'];
    const methods = Object.fromEntries(monitorMethods.map(k => [k,a[k]]));
    const snapshot = JSON.stringify(a.evSessionDetection), goals = JSON.stringify([a.evSocPlans,a.evEnergyPlans]);
    try {
      for (const key of monitorMethods) a[key] = () => { throw Error('Widget must not monitor: '+key); };
      for (let n=0;n<10;n++) assert.deepEqual(a.getEvDashboard().evs.map(e => e.state), states);
      assert.equal(JSON.stringify(a.evSessionDetection), snapshot);
      assert.equal(JSON.stringify([a.evSocPlans,a.evEnergyPlans]), goals);
      a.evSessionDetection.sessions[3] = null;
      assert.equal(a.getEvDashboard().evs[3].state,'unknown');
    } finally { Object.assign(a,methods);a.evSessionDetection.sessions=saved; }
  });
  await check('Existing charger-current input updates the central state copied by the widget', async () => {
    const fresh = await boot(new Map(Object.entries({ evCount:1,evEnabled:true,batteryCount:0,controlEnabled:false })));
    const app=fresh.app;app.requestContextEvaluate=()=>{};
    app.updateEvStatusInput(0,true,10);
    assert.equal(app.getEvSessionDetectionRuntime(0).state,'charging');
    assert.equal(app.getEvDashboard().evs[0].state,'charging');
    app.updateEvStatusInput(0,true,0);
    assert.equal(app.getEvSessionDetectionRuntime(0).state,'paused');
    assert.equal(app.getEvDashboard().evs[0].state,'paused');
    app.updateEvStatusInput(0,false,0);
    assert.equal(app.getEvDashboard().evs[0].state,'ended');
  });
  await check('Mode-only BMW reproduction: existing P1 detection gives charging then paused without current feedback', async () => {
    const fresh=await boot(new Map(Object.entries({evCount:1,evEnabled:true,batteryCount:0,controlEnabled:false,
      evControlType:'mode',evPhases:1,evVoltage:230,evModeStandardCurrentA:10,evModeSmartCurrentA:10})));
    const app=fresh.app;app.requestContextEvaluate=()=>{};const now=Date.now();
    app.updateEvStatusInput(0,true,0,now);app.evSessionDetection.portfolioBaselineW=1000;
    app.inputSeen.grid=true;app.inputSeen.pv=true;app.state.pvPowerW=0;app.state.lastTotalCommandW=0;
    app.lastPublishedEvChargeMode='standard';app.lastPublishedEvAllowed=true;
    function sample(offset,grid) { app.inputUpdatedAt.pv=now+offset;app.inputUpdatedAt.grid=now+offset;app.state.gridPowerW=grid;
      app.updateEvPortfolioLoadDetection(grid,now+offset,app.getSettings()); }
    sample(1000,3300);sample(7000,3300);
    const session=app.getEvSessionDetectionRuntime(0);
    assert.equal(session.state,'charging');assert.equal(session.detectionSource,'house_load');
    assert.equal(app.state.evChargeCurrentA,0);
    assert.equal(app.getEvDashboard().evs[0].state,'charging');
    sample(8000,1000);sample(68000,1000);
    assert.equal(session.state,'paused');assert.equal(app.getEvDashboard().evs[0].state,'paused');
  });
  await check('Active schedule reads the central effective mode: Emergency hides fallback goals without altering saved Flow input', async () => {
    const h=await boot(new Map(Object.entries({evCount:2,evEnabled:true,ev2Enabled:true,batteryCount:0,controlEnabled:false,
      evMode:'smart',evSocEnabled:true,ev2SocEnabled:false,evTargetSoc:30,evTargetTime:'07:00'})));
    const app=h.app;app.requestContextEvaluate=()=>{};
    await h.cards.get('set_ev1_soc_deadline').listener({target_soc:80,time:'12:00',guarantee:'yes'});
    app.setEvSessionOverrideFor(0,'emergency');
    const goals=JSON.stringify([app.evSocPlans,app.evEnergyPlans]);
    const descriptor=app.getEvDashboard().evs[0];
    assert.equal(descriptor.schedule.mode,'emergency');assert.equal(descriptor.schedule.target,null);
    assert.equal(descriptor.plan.value,80);assert.equal(descriptor.plan.time,'12:00');
    assert.equal(JSON.stringify([app.evSocPlans,app.evEnergyPlans]),goals);
    assert.equal(app.getEvDashboard().evs[1].schedule.target,null,'no fictitious SoC for a car without SoC');
  });
  await check('Active schedule displays current Flow SoC/kWh, fallback settings and completion using read-only fields', async () => {
    const h=await boot(new Map(Object.entries({evCount:2,evEnabled:true,ev2Enabled:true,batteryCount:0,controlEnabled:false,
      evSocEnabled:true,evMode:'smart',evTargetSoc:30,evTargetTime:'07:00',evGuaranteeTarget:true,
      evAllowUnselectedTariffForDeadline:true,evAfterSocTarget:'preferences',ev2SocEnabled:false})));
    const app=h.app;app.requestContextEvaluate=()=>{};
    let schedule=app.getEvDashboard().evs[0].schedule;
    assert.equal(schedule.source,'settings');assert.equal(schedule.target.value,30);assert.equal(schedule.time,'07:00');
    assert.equal(schedule.guaranteed,true);
    await h.cards.get('set_ev1_soc_deadline').listener({target_soc:90,time:'17:00',guarantee:'yes'});
    await h.cards.get('set_ev2_energy_deadline').listener({energy:20,time:'06:00',guarantee:'no'});
    const expand=app.getEvInstanceSettings;app.getEvInstanceSettings=()=>{throw Error('Widget must not expand settings or resolve deadlines');};
    try{
      const snapshot=JSON.stringify([app.evSocPlans,app.evEnergyPlans]);
      let evs=app.getEvDashboard().evs;
      assert.equal(evs[0].schedule.target.value,90);assert.equal(evs[0].schedule.source,'flow');
      assert.equal(evs[1].schedule.target.type,'kwh');assert.equal(evs[1].schedule.target.value,20);
      assert.equal(evs[1].schedule.time,'06:00');assert.equal(evs[1].schedule.guaranteed,false);
      assert.equal(JSON.stringify([app.evSocPlans,app.evEnergyPlans]),snapshot);
      app.getEvSessionDetectionRuntime(0).socTargetReached=true;
      schedule=app.getEvDashboard().evs[0].schedule;
      assert.equal(schedule.mode,'smart');assert.equal(schedule.continuing,true);assert.equal(schedule.guaranteed,false);
      app.evEnergyPlans[1].remainingKwh=0;assert.equal(app.getEvDashboard().evs[1].schedule.completed,true);
    }finally{app.getEvInstanceSettings=expand;}
  });
  await check('All 48 widget/reporting preferences stay outside EV planning revisions, battery memo and control requests', async () => {
    const isSetting = require('../lib/ev-dashboard').isSetting;
    const keys = Object.keys(a.getSettings()).filter(isSetting); assert.equal(keys.length, 48);
    const rev = a.evDeadlineSettingsRevision, physical = a.evPhysicalConfigRevision;
    const goals = JSON.stringify([a.evSocPlans,a.evEnergyPlans]), memo = {};
    a.batteryFeedbackMemo = memo;
    const original = a.requestContextEvaluate; let requests = 0; a.requestContextEvaluate = () => { requests++; };
    for (const key of keys) {
      const value = a.getSettings()[key];
      const changed = typeof value === 'number' ? value === 100 ? 99 : value + 1
        : value === 'soc' ? 'kwh' : value === 'individual' ? 'unavailable' : '12:30';
      a.setSetting(key, changed); await h.setExternalSetting(key, changed);
    }
    assert.equal(a.evDeadlineSettingsRevision, rev); assert.equal(a.evPhysicalConfigRevision, physical);
    assert.equal(a.batteryFeedbackMemo, memo); assert.equal(requests, 0);
    assert.equal(JSON.stringify([a.evSocPlans,a.evEnergyPlans]), goals); a.requestContextEvaluate = original;
  });
  fs.writeFileSync(path.join(__dirname, '../validation/ev-dashboard-1.2.4.json'), JSON.stringify({ cases, passed: cases.length, simulatedHomey: true },null,2)+'\n');
  console.log('EV Dashboard:', cases.length, 'scheduler cases passed');
})().catch(e => { console.error(e); process.exitCode=1; });
