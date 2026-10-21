'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const req = createRequire(path.join(root, 'package.json'));
const { evaluate } = req('./lib/ems-engine');
const start = Date.parse('2026-10-21T10:00:00Z');
const perAmpW = Math.sqrt(3) * 400;
const house = 623;
const rate = { id: 'test', name: 'Test', importPrice: .2, feedInPrice: .03,
  weekdayChargeMode: 'never', weekendChargeMode: 'never', evMaxGridImportW: 40000,
  evChargeAllowed: true, evPvChargeAllowed: true, ev2ChargeAllowed: true, ev2PvChargeAllowed: true };
const stem = i => i ? `ev${i + 1}` : 'ev';
const latest = (a, i = 0) => i ? a.getExtraEv(i).latestDecision : a.latestEvDecision;
const permitted = (a, i = 0) => i ? a.getExtraEv(i).lastPublishedAllowed : a.lastPublishedEvAllowed;
let cases = 0;
const results = [];
async function fixture(type = 'current', interval = 7, count = 1, extra = {}) {
  const settings = { forcedMode: 'self_consumption', peakShaveEnabled: false, exportLimitEnabled: false,
    commandIntervalSeconds: interval, evCount: count, evPvSharePercent: 100, evIdleHouseLoadW: house,
    contractType: 'tou', touRates: [{ ...rate }],
    touSchedule: [{ rateId: 'test', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }], ...extra };
  for (let i = 0; i < count; i++) for (const [key, value] of Object.entries({ Enabled: true,
    SocEnabled: true, Mode: 'smart', ControlType: type, Phases: 3, Voltage: 400, VoltageReference: 'line',
    MinCurrentA: 6, MaxCurrentA: 16, StandardCurrentA: 16, ModeStandardCurrentA: 16, ModeSmartCurrentA: 6,
    AfterSocTarget: 'stop', TargetSoc: 80, GuaranteeTarget: false, SmartGridPriority: 'ev_first',
    CommandIntervalSeconds: interval, PeakGuardStopHoldSeconds: 0,
    PeakGuardBatteryAssistNormal: false, PeakGuardBatteryAssistEmergency: false,
    NightSurplusChargeEnabled: false, PvGridTopUpMode: 'off', PvStartSurplusW: 1000,
    PvStopSurplusW: 0, PvStopDelaySeconds: 0 })) settings[`${stem(i)}${key}`] = value;
  const h = await setup(root, settings, start, 0);
  for (const [id, card] of h.cards) if (/^ev[1-4]_(charge_current|charging_allowed|charge_mode)_updated$/.test(id)) {
    card.trigger = async tokens => h.flexible.push({ at: h.now(), id, tokens });
  }
  for (let i = 0; i < count; i++) {
    await h.cards.get(`set_ev${i + 1}_status`).listener({ connected: 'yes', charge_current: 0 });
    await h.cards.get(`set_ev${i + 1}_soc`).listener({ soc: 50 });
  }
  await h.drain(); await h.start(); await h.flush();
  return h;
}
async function status(h, amps, i = 0, connected = true) {
  await h.cards.get(`set_ev${i + 1}_status`).listener({ connected: connected ? 'yes' : 'no', charge_current: amps });
  await h.drain();
}
async function pass(h) {
  h.app.requestContextEvaluate(true, 'ev_transition_test'); await h.drain(); await h.flush();
}
async function step(h, second, amps, pv = 0, order = 'current_first') {
  h.setNow(start + second * 1000);
  const values = Array.isArray(amps) ? amps : [amps];
  await h.pv(pv);
  const grid = () => house + values.reduce((sum,a) => sum+a*perAmpW,0) - pv - h.app.state.lastTotalCommandW;
  if (order === 'grid_first') await h.grid(grid());
  for (let i = 0; i < values.length; i++) await status(h, values[i], i);
  if (order !== 'grid_first') await h.grid(grid());
  await h.flush();
}
async function warm(h, count = 1, pv = 0) {
  for (let second = 1; second <= 75; second++) {await step(h, second, Array.from({length:count},(_,i)=>permitted(h.app,i)?16:0), second>=30?pv:0);}
  await pass(h);
  assert(permitted(h.app), 'real production publication must permit the original charging');
}
async function directCases() {
  if (!process.env.EV_TRANSITION_PV_ONLY) {
  const h = await fixture(), a = h.app;
  await warm(h);
  // Actual production states, then an isolated evaluation to test exact energy accounting.
  Object.assign(a.state, { gridPowerW: 16*perAmpW, lastTotalCommandW: house, pvPowerW: 0 });
  a.lastEmittedCommands = [house,0,0,0];
  const calc = () => evaluate(a.getEvaluationState(a.getSettings(),h.now()), a.getSettings(),new Date(h.now())).totalCommandW;
  const beforeStopW = calc();
  assert(Math.abs(beforeStopW-house)<30);
  await h.cards.get('end_ev1_charging_session').listener({}); await h.drain(); await h.flush();
  assert.equal(permitted(a),false);
  assert(a.getEvMeasuredCurrent(0).fresh, 'session STOP must not invalidate a fresh physical measurement');
  assert(Math.abs(calc()-house)<30, `stop must preserve household support, got ${calc()}`);
  assert(a.getEvGridImportControlStatus().activeTargetW > 11000);
  results.push({scenario:'stop-with-remaining-load',beforeStopW,afterStopW:calc(),
    measuredFresh:a.getEvMeasuredCurrent(0).fresh,publishedAllowed:permitted(a)});
  cases++;
  }

  const pv = await fixture(), b = pv.app;
  await warm(pv,1,5000);
  assert(latest(b).pvAttributedW>4000 && latest(b).pvAttributedW<=5000-house+2,
    'PV first covers the house; only the surplus belongs to the EV');
  assert(b.state.lastTotalCommandW<35,
    `PV covers the house, so house battery discharge must stop: ${b.state.lastTotalCommandW}`);
  results.push({ scenario:'mixed-pv-grid', batteryW:b.state.lastTotalCommandW,
    allowance:b.getEvGridImportControlStatus(), decision:latest(b) });
  cases++;
}
async function stopMatrix() {
  for (const type of ['current','mode','hybrid']) for (const interval of [7,55]) for (const reason of ['flow','soc','energy']) {
    const h = await fixture(type,interval), a=h.app;
    await warm(h);
    if (reason==='flow') await h.cards.get('end_ev1_charging_session').listener({});
    if (reason==='soc') await h.cards.get('set_ev1_soc').listener({soc:80});
    if (reason==='energy') {
      await h.cards.get('set_ev1_energy_deadline').listener({energy:0.01,time:'23:00',guarantee:'yes'});
      h.setNow(h.now()+5000); await status(h,16);
    }
    await pass(h);
    if(reason==='energy' && !a.getEvSessionDetectionRuntime(0).endedLatched) {
      h.setNow(h.now()+5000); await status(h,16); await pass(h);
    }
    assert.equal(permitted(a),false,`${type}/${interval}/${reason}: STOP published`);
    assert(a.getEvSessionDetectionRuntime(0).endedLatched, `${reason} completion latch`);
    const stopAt=h.now();
    for(let n=1;n<=12;n++) {
      const sec=(stopAt-start)/1000+n;
      await step(h,sec,n<9?16:0,0,n%2?'current_first':'grid_first');
      assert(a.state.lastTotalCommandW<=house+40,
        `${type}/${interval}/${reason} unwanted discharge ${a.state.lastTotalCommandW} at ${n}`);
      assert.equal(permitted(a),false,'physical residual must not restart output');
    }
    if(type!=='mode') assert.equal(a.lastPublishedEvCurrentA,0);
    if(type!=='current') assert.equal(a.lastPublishedEvChargeMode,'stop');
    assert.equal(a.getEvGridImportControlStatus().activeTargetW,0,'zero delivery retires allowance');
    assert.deepEqual(h.errors,[]);
    results.push({scenario:'stop',type,interval,reason,batteryW:a.state.lastTotalCommandW,
      batteryPublishes:h.traces.length,stops:h.flexible.filter(x=>x.tokens.allowed_value===0).length});
    cases++;
  }
}
async function asynchronousCases() {
  for(const order of ['current_first','grid_first']) {
    const h=await fixture(),a=h.app; await warm(h);
    await h.cards.get('end_ev1_charging_session').listener({});await pass(h);
    h.setNow(h.now()+1000);
    if(order==='current_first') {
      await status(h,8); await status(h,0); await pass(h);
      assert(a.getEvGridImportControlStatus().heldEvPowerW>11000, 'successive drops retain only the original pending P1 contribution');
      assert(a.state.lastTotalCommandW<=house+40,'old P1 must not cause a discharge spike after zero current');
      await h.grid(house-a.state.lastTotalCommandW);
    } else {
      await h.grid(house-a.state.lastTotalCommandW);await pass(h);
      assert(a.getEvGridImportControlStatus().activeTargetW<=2,'old current must not exempt household after P1 falls');
      a.setInput({ev:{connected:true,chargeCurrentA:0}}); await h.drain();
    }
    await pass(h);assert.equal(permitted(a),false);cases++;
  }
}
async function lifecycleCases() {
  const h=await fixture('hybrid',7,2),a=h.app; await warm(h,2,5000);
  await h.cards.get('end_ev1_charging_session').listener({});await pass(h);
  for(let n=76;n<=90;n++) await step(h,n,[n<84?16:0,16],n<80?5000:3000);
  assert.equal(permitted(a),false);assert.equal(permitted(a,1),true);
  assert(a.state.lastTotalCommandW<house+100,'stopping one EV cannot fund either EV from the house battery');
  await status(h,0,0,false);await pass(h);
  assert(!a.getEvGridImportControlStatus().residualInstances?.includes(1));
  h.setNow(h.now()+1000);await status(h,0,0,true);await pass(h);
  assert(!a.getEvGridImportControlStatus().residualInstances?.includes(1),'reconnect cannot inherit residual grant');
  cases++;

  const expire=await fixture(),e=expire.app;await warm(expire);
  await expire.cards.get('end_ev1_charging_session').listener({});await pass(expire);
  expire.setNow(expire.now()+61000);
  assert.equal(e.getEvGridImportControlStatus().activeTargetW,0,'stale current has no indefinite allowance');cases++;

  for(const extra of [{batteryCount:0,controlEnabled:false},{controlEnabled:false}]) {
    const independent=await fixture('current',7,1,extra);await warm(independent);
    assert(permitted(independent.app));cases++;
  }
}
async function policyAndFeedbackCases() {
  const h=await fixture(),a=h.app;await warm(h);
  // Complete into normal preferences, then explicitly end the session.
  await h.setExternalSetting('evAfterSocTarget','preferences');
  await h.cards.get('set_ev1_soc').listener({soc:80});await pass(h);
  assert.equal(a.getEvSessionDetectionRuntime(0).socTargetReached,true);
  assert.equal(permitted(a),true);
  await h.cards.get('end_ev1_charging_session').listener({});await pass(h);
  assert.equal(permitted(a),false);
  assert(a.getEvGridImportControlStatus().activeTargetW>11000);
  cases++;

  const tariff=await fixture(),t=tariff.app;await warm(tariff);
  await tariff.setExternalSetting('touRates',[{...rate,evChargeAllowed:false,evPvChargeAllowed:false}]);
  await pass(tariff);assert.equal(permitted(t),false);
  assert(t.getEvGridImportControlStatus().activeTargetW>11000,'revoking tariff rights must stop output without transferring residual load to battery');
  tariff.setNow(tariff.now()+1000);await status(tariff,0);await tariff.grid(house-t.state.lastTotalCommandW);await pass(tariff);
  assert.equal(t.getEvGridImportControlStatus().activeTargetW,0);cases++;

  const mode=await fixture('mode'),m=mode.app;await warm(mode);
  // No reliable current input: preserve only the previously observed P1 mode load.
  m.inputSeen.ev.chargeCurrent=false;
  await mode.cards.get('end_ev1_charging_session').listener({});await pass(mode);
  assert(m.getEvGridImportControlStatus().activeTargetW>10000);
  assert(m.getEvGridImportControlStatus().inferredEvPowerW>10000);
  assert.equal(m.getEvGridImportControlStatus().confirmedEvPowerW,0,'inferred mode load is not reported as measured current');
  mode.setNow(mode.now()+1000);await mode.grid(house-m.state.lastTotalCommandW);await pass(mode);
  assert.equal(m.getEvGridImportControlStatus().activeTargetW,0,'P1 house-only evidence retires inferred mode residual');cases++;

  const support=await fixture(),b=support.app;await warm(support);
  // Narrow attribution checks: only explicitly allocated battery support is excluded.
  const d=latest(b);d.batterySupportAllocatedW=1000;d.nightSurplusAllocatedW=500;
  assert.equal(b.getEvGridImportControlStatus().activeTargetW,Math.round(16*perAmpW-1500));
  d.batterySupportAllocatedW=0;d.nightSurplusAllocatedW=0;
  assert.equal(b.getEvGridImportControlStatus().activeTargetW,Math.round(16*perAmpW));
  b.inputSeen.ev.chargeCurrent=false;
  assert.equal(b.getEvGridImportControlStatus().activeTargetW,0,'missing current cannot become a guessed current-controlled load');cases++;
}
async function safetyCases() {
  const h=await fixture('hybrid',7,2),a=h.app;await warm(h,2);
  await h.setExternalSetting('peakLimitW',5000);await h.setExternalSetting('peakSoftMarginW',100);
  await h.setExternalSetting('peakShaveEnabled',true);await pass(h);
  assert([latest(a),latest(a,1)].reduce((s,d)=>s+d.desiredPowerW,0)<=4900,
    'physical residual protection cannot grant extra EV Peak Guard headroom');
  assert(a.getEvaluationState(a.getSettings(),h.now()).gridPowerW>10000,'raw peak meter remains physical');cases++;

  const zero=await fixture(),z=zero.app;await warm(zero);
  await zero.setExternalSetting('touRates',[{...rate,evMaxGridImportW:0}]);await pass(zero);
  assert.equal(permitted(z),false);assert(z.getEvGridImportControlStatus().activeTargetW>11000);
  assert(z.getGridControlSelection(z.getSettings(),zero.now()).source==='live_ev_transition');cases++;

  const cable=await fixture(),c=cable.app;await warm(cable);
  cable.setNow(cable.now()+1000);await status(cable,0,0,false);await pass(cable);
  assert(c.state.lastTotalCommandW<=house+40,'disconnect before the next P1 sample must not discharge into old P1 load');
  await cable.grid(house-c.state.lastTotalCommandW);await pass(cable);
  assert.equal(c.getEvGridImportControlStatus().activeTargetW,0);assert.equal(permitted(c),false);cases++;
}
async function run() {
 const original=Date.now,restore=installVirtualClearTimeout();
 try {
  if(!process.env.EV_TRANSITION_MATRIX_ONLY) await directCases();
  if(!process.env.EV_TRANSITION_DIRECT_ONLY) {await stopMatrix();await asynchronousCases();await lifecycleCases();await policyAndFeedbackCases();await safetyCases();}
  console.log(`1.1.9 EV battery transitions: ${cases} scenarios passed.`);
  if(process.env.EV_TRANSITION_JSON) require('node:fs').writeFileSync(process.env.EV_TRANSITION_JSON,JSON.stringify(results,null,2));
 } finally {Date.now=original;restore();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run,fixture,status,pass,step,warm,permitted,latest,perAmpW,start};
