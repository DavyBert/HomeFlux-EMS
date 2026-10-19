'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const ROOT = path.resolve(__dirname, '..');
const startAt = Date.parse('2026-10-19T19:00:00Z');
const rate = { id:'dal',name:'Dal',importPrice:.2,feedInPrice:.03,weekdayChargeMode:'never',weekendChargeMode:'never',
  evChargeAllowed:true,evPvChargeAllowed:true,ev2ChargeAllowed:true,evMaxGridImportW:15000 };
async function fixture(overrides = {}, root = ROOT) {
  const h = await setup(root, {batteryCount:0,controlEnabled:false,forcedMode:'standby',evCount:1,
    evEnabled:true,evSocEnabled:false,evMode:'smart',evControlType:'hybrid',evPhases:3,evVoltage:400,
    evVoltageReference:'line',evMinCurrentA:6,evMaxCurrentA:16,evStandardCurrentA:16,
    evCommandIntervalSeconds:7,evPeakGuardStopHoldSeconds:0,peakLimitW:18000,peakSoftMarginW:0,
    evPeakGuardBatteryAssistNormal:false,evNightSurplusChargeEnabled:false,evGuaranteeTarget:false,
    exportLimitEnabled:false,contractType:'tou',touRates:[{...rate}],
    touSchedule:[{rateId:'dal',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]}],...overrides},startAt,0);
  for (const [id,card] of h.cards) if (/^ev[1-4]_(charge_current|charging_allowed|charge_mode)_updated$/.test(id))
    card.trigger=async tokens=>h.flexible.push({at:h.now(),id,tokens});
  h.setting=async(k,v)=>{await h.setExternalSetting(k,v);await h.drain();await h.flush();};
  h.report=()=>h.app.getDiagnosticsReport();
  return h;
}
async function start(h) {
  await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});await h.drain();
  await h.start();h.setNow(h.now()+10000);await h.app.runEvHeartbeat();await h.drain();
}
function reconstruct(report) {
  let current={},previous=null; const states=new Map();
  for(const config of report.planning.configurations){
    if(config.kind==='snapshot'){current=structuredClone(config.settings);assert.equal(config.previousId,null);}
    else {assert.equal(config.previousId,previous);Object.assign(current,structuredClone(config.changes));for(const k of config.removed)delete current[k];}
    states.set(config.id,structuredClone(current));previous=config.id;
  }
  for(const event of [...report.planning.events,...report.ev.events])assert(states.has(event.configId),'event must have a reconstructable config: '+event.configId);
  if(report.planning.currentConfigId)assert(states.has(report.planning.currentConfigId));
  return states;
}
async function replay(root, options={}){
  const h=await fixture({},root),a=h.app;
  if(options.disabled)a.diagnostics=a.createDiagnosticsRuntime();
  if(options.cpuOnly){
    a.runContextEvaluation=Object.getPrototypeOf(a).runContextEvaluation.bind(a);
    a.commandTrigger.trigger=async()=>{};
    for(const [id,card]of h.cards)if(/^ev[1-4]_/.test(id))card.trigger=async()=>{};
  }
  await start(h);
  const perAmp= Math.sqrt(3)*400;
  let changes=0;
  const checkpoint=()=>({commands:h.traces,ev:h.flexible,contexts:h.contexts,
    counters:Object.fromEntries(Object.entries(a.diagnostics.counters).filter(([k])=>!k.startsWith('diagnostic'))),
    timers:h.timers.map(t=>({due:t.due,done:Boolean(t.done)})),
    final:{current:a.lastPublishedEvCurrentA,mode:a.lastPublishedEvChargeMode,allowed:a.lastPublishedEvAllowed}});
  async function tick(second,changing){
    h.setNow(startAt+10000+second*1000);
    const amps=a.lastPublishedEvAllowed?Number(a.lastPublishedEvCurrentA)||0:0;
    if(second%10===0){await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:amps});await h.drain();}
    await h.grid(500+amps*perAmp);
    if(changing&&second%10===0){changes++;await h.setting('evSocDeadlineOverrides',[{active:true,targetSoc:40+(changes%20),targetTime:'07:00',guarantee:false}]);}
    if(second%60===0){await a.runEvHeartbeat();await h.drain();}
    await h.flush();
  }
  for(let i=1;i<=60;i++)await tick(i,false);
  h.traces.length=0;h.flexible.length=0;h.contexts.length=0;
  a.diagnostics.counters={};
  const usage=process.cpuUsage();
  for(let i=61;i<=360;i++)await tick(i,true);
  const cpu=process.cpuUsage(usage);
  const report=h.report();
  const result=checkpoint();
  return {result,cpuUs:cpu.user+cpu.system,configurationBytes:Buffer.byteLength(JSON.stringify(report.planning.configurations)),
    exportBytes:Buffer.byteLength(JSON.stringify(report,null,2)),snapshots:report.planning.configurations.filter(c=>c.settings).length,
    configurationRecords:report.planning.configurations.length,evEvents:report.ev?.events.length||0,
    recordingFailures:report.recordingFailures||0,report:options.report?report:undefined};
}
async function run(){
 const original=Date.now,restore=installVirtualClearTimeout();let cases=0;
 try{
  // Real startup/settings callback/cache, including start/reset/join/restart.
  {
   const h=await fixture(),a=h.app;
   await h.setting('diagnosticsPlanningEnabled',true);
   await h.setting('diagnosticsCpuEnabled',true);
   a.startDiagnosticsSession({planning:true,cpu:true},h.now());
   assert.equal(a.diagnostics.planningConfigurations.length,1);cases++;
   let snapshots=0;const snapshot=a.getDiagnosticConfigurationSnapshot.bind(a);
   a.getDiagnosticConfigurationSnapshot=(...args)=>{snapshots++;return snapshot(...args);};
   for(let i=0;i<20;i++)a.recordDiagnosticPlanning({ready:true,rows:[]},h.now(),a.getSettings(),a.state);
   assert.equal(snapshots,0,'no full snapshot at unchanged planning events');cases++;
   await h.setting('evTargetSoc',65);await h.setting('evTargetSoc',65);
   let r=h.report();assert.equal(snapshots,0,'export/settings updates must not rebuild the full baseline');
   const delta=r.planning.configurations.filter(c=>c.changes?.evTargetSoc!==undefined);
   assert.equal(delta.length,1);assert.deepEqual(delta[0].changes,{evTargetSoc:65});
   assert.equal(r.planning.currentSettings,undefined);assert.equal(r.schema,'homeflux-diagnostics-v2');
   reconstruct(r);cases++;
   await h.setting('evSocDeadlineOverrides',[{active:true,targetSoc:50,targetTime:'07:00',guarantee:true}]);
   r=h.report();const state=reconstruct(r).get(r.planning.currentConfigId);
   assert.deepEqual(state.evSocDeadlineOverrides,[{active:true,targetSoc:50,targetTime:'07:00',guarantee:true}]);cases++;
   const rec=a.getCompactDiagnostics(),before=rec.id;
   rec.setting('api_secret','not exported');rec.setting('api_secret','another secret');
   assert.equal(rec.values.api_secret,'[redacted]');assert.equal(rec.sequence,Number(before.slice(4))+1);
   rec.setting('temporaryDiagnosticFixture',[1,2]);rec.setting('temporaryDiagnosticFixture',undefined);
   r=h.report();assert(!Object.hasOwn(reconstruct(r).get(r.planning.currentConfigId),'temporaryDiagnosticFixture'));
   assert(!JSON.stringify(r).includes('not exported'));cases++;
   const count=a.diagnostics.planningConfigurations.length;
   a.setSetting('_diagnosticsStartedAt',h.now()+1);a.setSetting('diagnosticsCpuEnabled',true);
   assert.equal(a.diagnostics.planningConfigurations.length,count);cases++;
   for(let i=0;i<80;i++){
    a.setSetting('evTargetSoc',20+i%70);
    a.recordDiagnosticPlanning({ready:true,rows:[]},h.now(),a.getSettings(),a.state);
    rec.event('fixture',{instance:1});
   }
   r=h.report();assert.equal(r.planning.configurations.length,50);
   assert.equal(r.planning.configurations.filter(c=>c.kind==='snapshot').length,1);
   assert(r.planning.droppedConfigurations>0);reconstruct(r);cases++;
   for(let i=0;i<700;i++)rec.event('fixture',{instance:1});
   assert.equal(h.report().ev.events.length,600);assert(h.report().ev.droppedEvents>0);cases++;
   const reset=a.resetDiagnosticsReport();assert.equal(reset.planning.configurations.length,1);assert.equal(reset.ev.events.length,0);cases++;
   a.restoreDiagnosticsSession();assert.equal(a.diagnostics.planningConfigurations.length,1);cases++;
   await h.setting('diagnosticsPlanningEnabled',false);
   const cfgBefore=a.diagnostics.planningConfigurations.length;
   await h.setting('evTargetSoc',72);assert.equal(a.diagnostics.planningConfigurations.length,cfgBefore);
   await h.setting('diagnosticsPlanningEnabled',true);
   r=h.report();assert.equal(reconstruct(r).get(r.planning.currentConfigId).evTargetSoc,72);cases++;
  }
  // Stable high-frequency physical input does not generate a P1 trace.
  {
   const h=await fixture(),a=h.app;await start(h);
   await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:16});await h.drain();
   await h.grid(11585);await a.runEvHeartbeat();await h.drain();await h.flush();
   const before=h.report().ev.events.length,publications=h.flexible.length;
   let snapshots=0;const snap=a.getDiagnosticConfigurationSnapshot.bind(a);
   a.getDiagnosticConfigurationSnapshot=(...args)=>{snapshots++;return snap(...args);};
   for(let i=0;i<1000;i++)await h.grid(11585+(i%3)-1);
   assert.equal(h.report().ev.events.length,before,'same decision must not log each P1 or tiny fluctuations');
   assert.equal(h.flexible.length,publications);assert.equal(snapshots,0);cases++;
   h.setNow(h.now()+61000);await h.grid(11585);await a.runEvHeartbeat();await h.drain();
   let r=h.report();assert(r.ev.events.some(e=>e.kind==='ev_decision'&&e.feedback.received&&!e.feedback.fresh));
   assert(r.ev.events.some(e=>e.kind==='ev_grid_allowance_transition'&&e.control.state==='waiting_response'));cases++;
   await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:16});await h.drain();
   await a.runEvHeartbeat();await h.drain();
   r=h.report();assert(r.ev.events.some(e=>e.kind==='ev_decision'&&e.feedback.fresh));cases++;
   await h.setting('touRates',[{...rate,evChargeAllowed:false,evPvChargeAllowed:false}]);
   assert(!a.lastPublishedEvAllowed);assert(h.report().ev.events.some(e=>e.kind==='ev_decision'&&!e.allowed));cases++;
   await h.setting('touRates',[{...rate}]);h.setNow(h.now()+10000);await h.grid(500);await a.runEvHeartbeat();await h.drain();
   assert(a.lastPublishedEvAllowed);cases++;
   assert.equal(h.report().recordingFailures,0);reconstruct(h.report());
  }
  // Waiting, partial failure, retry and interval use real publication methods.
  {
   const h=await fixture(),a=h.app;await start(h);
   h.setNow(h.now()+1000);
   const d={...a.latestEvDecision,allowed:true,connected:true,desiredCurrentA:14,desiredPowerW:9700};
   await a.publishEvDecision(d);
   assert(h.report().ev.events.some(e=>e.kind==='ev_command_waiting'&&e.reason==='command_interval'));cases++;
   h.setNow(h.now()+10000);
   const allowed=a.evAllowedTrigger.trigger; a.evAllowedTrigger.trigger=async()=>{throw new Error('simulated permission write failure');};
   const stop={...d,allowed:false,desiredCurrentA:0,desiredPowerW:0};
   await assert.rejects(a.publishEvDecision(stop),/simulated permission write failure/);
   let events=h.report().ev.events;
   const fail=events.findLast(e=>e.kind==='ev_command_failed');assert(fail);
   assert.equal(fail.published.currentA,0);assert.equal(fail.published.mode,'stop');assert.equal(fail.published.allowed,true);
   const components=events.filter(e=>e.requestId===fail.requestId&&e.kind==='ev_command_component_published');
   assert.deepEqual(components.map(e=>e.component),['current','mode']);cases++;
   a.evAllowedTrigger.trigger=allowed;await a.publishEvDecision(stop);
   events=h.report().ev.events;
   assert(events.some(e=>e.kind==='ev_command_published'&&e.requestId===fail.requestId&&e.attempt===2));cases++;
   // A new request during an awaiting write may not steal the old attempt id.
   let release;const trigger=a.evCurrentTrigger.trigger;
   a.evCurrentTrigger.trigger=()=>new Promise(resolve=>{release=resolve;});
   h.setNow(h.now()+10000);
   const p=a.publishEvDecision({...d,desiredCurrentA:12,desiredPowerW:8314});await h.drain();
   await a.publishEvDecision({...d,desiredCurrentA:10,desiredPowerW:6928});
   let r=h.report();const requests=r.ev.events.filter(e=>e.kind==='ev_command_request').slice(-2);
   release();await p;a.evCurrentTrigger.trigger=trigger;
   r=h.report();assert(r.ev.events.some(e=>e.kind==='ev_command_published'&&e.requestId===requests[0].id));
   assert(!r.ev.events.some(e=>e.kind==='ev_command_published'&&e.requestId===requests[1].id));cases++;
   assert.equal(r.recordingFailures,0);
  }
  // Same recorder through current/mode/hybrid and independent/combined setups.
  for(const batteries of [0,4])for(const enabled of [false,true])for(const type of ['current','mode','hybrid']){
   const h=await fixture({batteryCount:batteries,controlEnabled:enabled,evControlType:type});
   await start(h);const r=h.report();
   assert(r.ev.events.some(e=>e.kind==='ev_decision'&&e.controlType===type));
   assert(r.ev.events.some(e=>e.kind==='ev_command_published'));
   assert.equal(r.recordingFailures,0);reconstruct(r);cases++;
  }
  // Shared portfolio, PV/grid changes, Peak Guard and explicit session end.
  {
   const h=await fixture({evCount:2,ev2Enabled:true,ev2SocEnabled:false,ev2Mode:'smart',ev2ControlType:'current',
     ev2Phases:1,ev2Voltage:230,ev2VoltageReference:'phase',ev2MinCurrentA:6,ev2MaxCurrentA:16,ev2StandardCurrentA:16});
   const a=h.app;
   await h.cards.get('set_ev2_status').listener({connected:'yes',charge_current:0});await h.drain();
   await start(h);h.setNow(h.now()+10000);await a.runEvHeartbeat();await h.drain();
   let r=h.report();assert(r.ev.events.some(e=>e.kind==='ev_decision'&&e.instance===2));
   assert(r.ev.events.some(e=>e.kind==='ev_portfolio_budget'&&e.evCount===2));cases++;
   await h.pv(10000);await h.grid(-9500);h.setNow(h.now()+10000);await a.runEvHeartbeat();await h.drain();
   assert(h.report().ev.events.some(e=>e.kind==='ev_portfolio_budget'&&e.pvPoolW>0));cases++;
   await h.grid(25000);await a.runEvHeartbeat();await h.drain();
   assert(h.report().ev.events.some(e=>e.kind==='ev_decision'&&/Peak Guard/.test(e.reason)));cases++;
   await h.setting('evCount',0);h.setNow(h.now()+10000);await a.runEvHeartbeat();await h.drain();
   r=h.report();assert.equal(r.recordingFailures,0);reconstruct(r);cases++;
  }
  // No preparation or recorder allocation while Planning diagnostics are off.
  {
   const h=await fixture(),a=h.app;a.diagnostics=a.createDiagnosticsRuntime();
   a.getDiagnosticConfigurationSnapshot=()=>{throw new Error('disabled snapshot');};
   await start(h);for(let i=0;i<50;i++)await h.grid(500);
   assert.equal(a.diagnostics.compact,undefined);assert.equal(h.report().recordingFailures,0);cases++;
  }
  console.log(`Compact diagnostics: ${cases} production-path checks passed (deltas/reconstruction/lifecycle/bounds/EV feedback/publication/off).`);
 }finally{Date.now=original;restore();}
}
if(require.main===module){
 const original=Date.now,restore=installVirtualClearTimeout();
 (process.argv[2]==='--replay'?replay(path.resolve(process.argv[3]),{disabled:process.argv.includes('--disabled'),report:process.argv.includes('--report'),cpuOnly:process.argv.includes('--cpu-only')}).then(r=>console.log(JSON.stringify(r))):run())
 .catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Date.now=original;restore();});
}
module.exports={run,replay,fixture,reconstruct};
