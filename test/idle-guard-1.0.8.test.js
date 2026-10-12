'use strict';
const assert=require('node:assert/strict');
const {boot,DEFAULTS}=require('./startup-harness');
const {evaluate,prepareControlContext}=require('../lib/ems-engine');
const realNow=Date.now;
let now=Date.parse('2026-10-04T12:00:00Z');
Date.now=()=>now;
const drain=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
async function setup(overrides={},grid=-100,total=-1000) {
 const {app,cards,errors}=await boot();
 const settings={...DEFAULTS,timezone:'Europe/Brussels',controlEnabled:true,chargeTestPassed:true,
  batteryCount:4,totalCapacityKwh:21.6,maxTotalChargeW:6000,maxTotalDischargeW:6000,
  maxChargePerBatteryW:2400,contractType:'fixed',fixedChargeWindowStart:'00:00',fixedChargeWindowEnd:'23:59',
  controlProfile:'exact',batteryCommandPauseEnabled:false,gridZeroMinW:-20,gridZeroMaxW:20,
  gridControlWindowSeconds:0,commandIntervalSeconds:5,evCount:0,hvacCount:0,boilerCount:0,
  exportLimitEnabled:false,...overrides};
 app.getSettings=()=>settings;app.isChargeTestValid=()=>true;
 app.getPlannedBatteryGridLimitW=()=>null;
 app.state={...app.state,gridPowerW:grid,pvPowerW:2200,batterySoc:[70,70,70,70],
  lastTotalCommandW:total,targetSocOverride:75,forecastRemainingKwh:0,forecastDailyMaxKwh:0};
 Object.assign(app.state,{nightPlanningActive:false,nightPlanningStartedDate:'',nightPlanningDecisionSource:'',
  pvSeenProducingToday:true,pvProducingDate:'2026-10-04'});
 app.inputSeen.grid=true;app.inputSeen.pv=true;app.inputSeen.batterySoc=[true,true,true,true];
 app.inputUpdatedAt.grid=now;app.gridInputHistory=[];
 app.lastEmittedCommands=[total/2,total/2,0,0];app.lastEmittedMode='charge';app.lastEmittedOverride='';
 app.lastEmitAt=now-10000;app.nextCommandAllowedAt=0;app.commandPublishing=false;
 const state=app.getEvaluationState(settings,now);
 app.controlRuntimeSettings=settings;app.controlContext=prepareControlContext(state,settings,new Date(now));
 app.latestResult=app.createSafetyResult(evaluate(state,settings,new Date(now),app.controlContext),settings,app.getInputReadiness(settings));
 app.rememberFastControlSnapshot(settings,now,state);
 app.batteryFeedbackMemo=null;
 const timers=[],publishes=[];let slow=0;
 app.homey.setTimeout=(fn,ms)=>{const t={fn,ms,due:now+ms};timers.push(t);return t;};
 app.requestContextEvaluate=()=>{slow++;};app.queueStatusUpdate=()=>{};
 app.commandTrigger.trigger=async tokens=>{publishes.push({at:now,total:tokens.total_command});};
 app.diagnostics=app.createDiagnosticsRuntime({startedAt:now,expiresAt:now+3600000,options:{cpu:true,planning:true,errors:true}});
 return {app,settings,cards,errors,timers,publishes,get slow(){return slow;}};
}

async function idle(overrides={}) {
 now=Date.parse('2026-10-04T12:00:05Z');
 const h=await setup({minSoc:12,safetySoc:14,peakReserveTargetSoc:65,peakReserveMonth10:true,
  lowForecastFixedEnabled:false,fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00',
  optimizeMultiBatteryEfficiency:true,peakLimitW:2650,peakSoftMarginW:100,...overrides},1200,0);
 Object.assign(h.app.state,{pvPowerW:0,batterySoc:[20,20,20,20],targetSocOverride:null});
 h.app.inputUpdatedAt.pv=now;h.app.inputUpdatedAt.batterySoc=[now,now,now,now];
 h.app.refreshControlContext(h.settings,h.app.getEvaluationState(h.settings,now),now);
 h.app.requestEvaluate(true);await drain();
 now+=5000;h.app.inputUpdatedAt.grid=now;
 h.app.requestEvaluate(true);await drain();
 assert.equal(h.app.latestResult.baseMode,'self_consumption');
 assert.deepEqual(h.app.lastEmittedCommands,[0,0,0,0]);
 assert.equal(h.app.canSkipBatteryIdle(h.settings,now),true);
 return h;
}
function grid(h,value){h.app.state.gridPowerW=value;h.app.inputUpdatedAt.grid=now;}
async function runIdleRegression(){
 try{
  // No allocator/status reconstruction is allowed in the cheap guard.
  {
   const h=await idle(),before=h.app.diagnostics.counters.fastEvaluations;
   h.app.getEvaluationState=()=>{throw Error('idle must not rebuild engine input');};
   h.app.getFastControlSnapshot=()=>{throw Error('idle must precede expensive preflight');};
   for(let i=0;i<30;i++){now+=1000;grid(h,1200+(i%3-1)*80);h.app.requestEvaluate();}
   assert.equal(h.app.diagnostics.counters.fastEvaluations,before);
   assert(h.app.diagnostics.counters.fastIdleGuardSkipped>=30);
   assert.equal(h.errors.length,0);
  }
  // Peak Guard has the original soft threshold and command interval. Its
  // exception uses the hard min, never the protected strategic discharge floor.
  {
   const h=await idle();now+=1000;grid(h,3000);h.app.requestEvaluate();await drain();
   assert(h.app.diagnostics.counters.fastIdleGuardBypassPeakGuard>0);
   assert.equal(h.app.latestResult.override,'peak_shave');
   assert.equal(h.app.state.lastTotalCommandW,450);
  }
  {
   const h=await idle({minSoc:14,safetySoc:14});h.app.state.batterySoc=[14,14,14,14];
   h.app.requestEvaluate(true);await drain();now+=10000;grid(h,3000);
   h.app.requestEvaluate();await drain();assert.equal(h.app.state.lastTotalCommandW,0,'Peak Guard cannot unlock SoC below the hard minimum');
  }
  // Check the entire per-battery vector, including a hidden net-zero mix.
  for(const commands of [[-2000,0,0,0],[2000,0,0,0],[0,-2000,0,0],[-2000,2000,0,0]]){
   const h=await idle();h.app.lastEmittedCommands=commands;
   h.app.state.lastTotalCommandW=commands.reduce((a,b)=>a+b,0);
   assert.equal(h.app.canSkipBatteryIdle(h.settings,now),false);
   assert(h.app.diagnostics.counters.fastIdleGuardBypassActiveSetpoint>0);
   now+=10000;grid(h,1200);
   const expected=evaluate(h.app.getEvaluationState(h.settings,now),h.settings,new Date(now),h.app.controlContext);
   h.app.requestEvaluate();await drain();
   assert.deepEqual(h.app.latestResult.calculatedCommands,expected.commands,'active output follows the original controller');
  }
  {
   const h=await idle({minSoc:20,safetySoc:20});
   h.app.lastEmittedCommands=[2000,0,0,0];h.app.state.lastTotalCommandW=2000;
   now+=10000;grid(h,1200);h.app.requestEvaluate();await drain();
   assert.deepEqual(h.app.lastEmittedCommands,[0,0,0,0],'hard minimum must stop an outstanding discharge');
  }
  // Age/missing input checks only qualify optimization, never introduce a new
  // hardware-stop policy. The original preflight/evaluator remains available.
  const changes=[
   h=>{h.app.batteryIdleKnownOutput=null;},
   h=>{h.app.lastEmittedCommands=[];},
   h=>{h.app.inputUpdatedAt.batterySoc[0]=now-11*60000;},
   h=>{h.app.inputSeen.batterySoc[0]=false;},
   h=>{h.app.inputUpdatedAt.grid=now-600000;},
   h=>{h.app.inputUpdatedAt.pv=now-6*60000;},
   h=>{h.app.inputSeen.pv=false;},
   h=>{h.app.state.batterySoc[0]=21;},
   h=>{h.app.state.batterySoc[0]=70;},
   h=>{h.app.state.forecastTomorrowKwh=12;},
   h=>{h.app.state.nightPlanningActive=true;},
   h=>{h.app.controlContextDirty=true;},
   h=>{h.app.controlContext={};},
   h=>{h.app.controlRuntimeSettings={...h.settings};},
   h=>{h.settings.forcedMode='manual_charge';},
   h=>{h.settings.hybridEmsEnabled=true;},
   h=>{h.settings.evCount=1;},
   h=>{h.app.boilerState.peakSupportRequestedAt=now;},
   h=>{h.app.extraHvacInstances[0].state.mode='heat';},
   h=>{h.app.hvacPublishSlots[0].publishing=true;},
   h=>{h.settings.splitCommandBattery1Enabled=true;},
  ];
  for(const [i,change]of changes.entries()){
   const h=await idle();change(h);assert.equal(h.app.canSkipBatteryIdle(h.settings,now),false,`state change ${i}`);
  }
  for(const change of [h=>{h.app.pendingResult=h.app.latestResult;},h=>{h.app.commandPublishing=true;},
   h=>{h.app.pendingCommandBypassInterval=true;},h=>{h.app.inFlightBatteryCommands=[0,0,0,0];},
   h=>{h.app.batteryEfficiencyTransitionTimer={};}]){
   const h=await idle();change(h);assert.equal(h.app.canSkipBatteryIdle(h.settings,now),false);
   assert(h.app.diagnostics.counters.fastIdleGuardBypassPendingCommand>0);
  }
  // New solar export, and remembered export in the averaging window, bypass
  // the guard and retain live PV capture at low/strategically protected SoC.
  {
   const h=await idle();now+=10000;grid(h,-1500);h.app.requestEvaluate();await drain();
   assert.equal(h.app.state.lastTotalCommandW,-1500);
  }
  {
   const h=await idle({gridControlWindowSeconds:3});
   h.app.gridInputHistory=[{at:now-2,value:-3000},{at:now-1,value:-3000},{at:now,value:1200}];
   assert.equal(h.app.canSkipBatteryIdle(h.settings,now),false,'raw import cannot hide old averaged export');
  }
  // Planning starts and stops through the same context/forced evaluation paths.
  {
   const h=await idle();now=Date.parse('2026-10-04T21:59:55Z');grid(h,1200);
   h.app.inputUpdatedAt.pv=now;h.app.inputUpdatedAt.batterySoc=[now,now,now,now];
   h.app.refreshControlContext(h.settings,h.app.getEvaluationState(h.settings,now),now);
   h.app.requestEvaluate(true);await drain();assert(h.app.canSkipBatteryIdle(h.settings,now));
   assert.equal(h.app.batteryFeedbackMemo.idleValidUntil,Date.parse('2026-10-04T22:00:00Z'));
   now+=5000;grid(h,1200);assert.equal(h.app.canSkipBatteryIdle(h.settings,now),false,'local midnight ends idle proof');
  }
  {
   const h=await idle({fixedChargeWindowStart:'14:01',fixedChargeWindowEnd:'15:00'});
   now=Date.parse('2026-10-04T12:01:00Z');grid(h,1200);
   assert.equal(h.app.canSkipBatteryIdle(h.settings,now),false,'a tariff/window boundary ends idle proof');
   h.app.requestEvaluate();await drain();
   // The existing prepared context has a 1-second boundary tolerance. Keep
   // that behavior rather than adding a new timing rule in the guard.
   now+=1001;grid(h,1200);h.app.requestEvaluate();await drain();
   assert.equal(h.app.latestResult.baseMode,'charge');
   assert(h.app.state.lastTotalCommandW<0,'charging starts without a new guard delay');
  }
  {
   const h=await idle();h.settings.fixedChargeWindowStart='00:00';h.settings.fixedChargeWindowEnd='23:59';
   h.app.refreshControlContext(h.settings,h.app.getEvaluationState(h.settings,now),now);
   now+=10000;grid(h,1200);h.app.requestEvaluate(true);await drain();
   assert.equal(h.app.latestResult.baseMode,'charge');assert(h.app.state.lastTotalCommandW<0);
   assert.equal(h.app.canSkipBatteryIdle(h.settings,now),false);
   h.settings.fixedChargeWindowStart='01:00';h.settings.fixedChargeWindowEnd='07:00';
   h.app.refreshControlContext(h.settings,h.app.getEvaluationState(h.settings,now),now);
   now+=10000;grid(h,1200-h.app.state.lastTotalCommandW);h.app.requestEvaluate(true);await drain();
   assert.deepEqual(h.app.lastEmittedCommands,[0,0,0,0]);
  }
  // Internal storage writes cannot erase a proven identical state, while real
  // settings writes still do. This also tests the actual cache refresh hook.
  {
   const h=await idle(),memo=h.app.batteryFeedbackMemo;
   h.app.setSetting('_autoTuneLearning',{days:[]});assert.equal(h.app.batteryFeedbackMemo,memo);
   h.app.refreshCachedSetting('_autoTuneLearning');assert.equal(h.app.batteryFeedbackMemo,memo);
   h.app.setSetting('peakLimitW',2500);assert.equal(h.app.batteryFeedbackMemo,null);
  }
  // A failed stop is not a confirmed zero publication. It remains on the
  // original retry/re-evaluation path; no additional retry mechanism is added.
  {
   const h=await idle();h.app.commandTrigger.trigger=async()=>{throw Error('transport failure');};
   h.app.queueCommandEmit({...h.app.latestResult,candidateCommands:[0,0,0,0]},true);await drain();
   assert.equal(h.app.batteryIdleKnownOutput,null);
   assert.equal(h.app.canSkipBatteryIdle(h.settings,now),false);
   assert(h.errors.some(e=>e.includes('transport failure')));
  }
  console.log('1.0.8 idle guard passed: stable/gaming P1, soft Peak Guard/hard SoC, all individual active/mixed setpoints, zero-output confirmation/failure, stale/missing data, pending work, PV/averaging, planning/mode/state changes, bookkeeping and flexible-load/Split/Hybrid fallbacks.');
 }finally{Date.now=realNow;}
}
runIdleRegression().catch(e=>{console.error(e);process.exitCode=1;});
