'use strict';
const assert=require('node:assert/strict');
const {boot,DEFAULTS}=require('./startup-harness');
const {evaluate,prepareControlContext,previewBatteryFeedback}=require('../lib/ems-engine');
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

function refreshGrid(h, grid) {
 h.app.state.gridPowerW=grid;h.app.inputUpdatedAt.grid=now;
}
async function stable(overrides={}) {
 const h=await setup({optimizeMultiBatteryEfficiency:true,...overrides},600,0);
 h.app.requestEvaluate(true);await drain();
 now+=10000;refreshGrid(h,600-h.app.state.lastTotalCommandW);
 h.app.requestEvaluate(true);await drain();
 assert.equal(h.app.latestResult.baseMode,'charge');
 assert(h.app.canSkipBatteryFeedback(h.settings,now),'stable charge must establish a reusable memo');
 return h;
}
async function runChargeRegression() {
 try {
  // Stable import and rounding-sized noise skip calculations, not necessary
  // correction. Minute/context expiry still forces the periodic full check.
  {
   const h=await stable(),before=h.app.diagnostics.counters.fastEvaluations;
   for(let i=0;i<20;i++){now+=1000;refreshGrid(h,600-h.app.state.lastTotalCommandW+(i%3-1)*3);h.app.requestEvaluate();}
   assert.equal(h.app.diagnostics.counters.fastEvaluations,before);
   assert(h.app.diagnostics.counters.fastChargeUnchangedSkipped>=20);
   now=Math.ceil((now+1)/60000)*60000;refreshGrid(h,600-h.app.state.lastTotalCommandW);
   assert.equal(h.app.canSkipBatteryFeedback(h.settings,now),false,'a memo cannot cross a minute boundary');
   h.app.requestEvaluate();await drain();assert.equal(h.app.diagnostics.counters.fastEvaluations,before+1);
  }
  // Import can remain unchanged at the grid-charge floor. New export/PV and
  // excessive import must still reach exactly the existing full engine.
  for(const grid of [-1500,2000,3200]){
   const h=await stable({peakLimitW:2650});
   if(grid===2000){now+=10000;refreshGrid(h,-1500);h.app.requestEvaluate(true);await drain();}
   now+=10000;refreshGrid(h,grid);
   assert.equal(h.app.canSkipBatteryFeedback(h.settings,now),false);
   const state=h.app.getEvaluationState(h.settings,now),reference=evaluate(state,h.settings,new Date(now),h.app.controlContext);
   h.app.requestEvaluate();await drain();
   assert.deepEqual(h.app.latestResult.calculatedCommands,reference.commands);
   if(grid<0)assert(h.app.state.lastTotalCommandW<-h.app.latestResult.plannedChargeW,'extra PV must exceed the planned floor');
   if(grid===3200)assert.equal(h.app.latestResult.override,'peak_shave');
   assert.equal(h.errors.length,0);
  }
  // A change from entirely grid to partly solar charging must update the
  // physical source/status even when final battery commands stay identical.
  {
   const h=await stable();now+=10000;
   refreshGrid(h,Math.abs(h.app.state.lastTotalCommandW)-100);
   assert.equal(h.app.canSkipBatteryFeedback(h.settings,now),false);
   h.app.requestEvaluate();await drain();assert.equal(h.app.latestResult.pvChargeW,100);
  }
  // Structural dependencies, input freshness, output ownership and pending
  // asynchronous work must never reuse an otherwise identical charge result.
  const invalidations=[
   h=>{h.app.state.batterySoc[0]+=0.1;},
   h=>{h.app.state.batterySoc[0]=100;},
   h=>{h.app.state.batterySoc[0]=null;},
   h=>{h.app.state.forecastRemainingKwh=4;},
   h=>{h.app.state.forecastTomorrowKwh=4;},
   h=>{h.app.state.nightPlanningActive=true;},
   h=>{h.app.controlContextDirty=true;},
   h=>{h.app.controlRuntimeSettings={...h.settings,maxTotalChargeW:500};},
   h=>{h.app.state.targetSocOverride=80;},
   h=>{h.app.lastEmittedCommands[0]-=10;h.app.lastEmittedCommands[1]+=10;},
   h=>{h.app.efficiencyChargeStickyIndex=2;},
   h=>{h.app.commandPublishing=true;},
   h=>{h.app.pendingResult=h.app.latestResult;},
   h=>{h.app.pendingCommandBypassInterval=true;},
   h=>{h.settings.hybridEmsEnabled=true;},
   h=>{h.settings.controlEnabled=false;},
   h=>{h.app.inputUpdatedAt.grid=now-600000;},
   h=>{h.app.inputSeen.batterySoc[0]=false;},
   h=>{h.app.getPlannedBatteryGridLimitW=()=>100;},
   h=>{h.app.getBoilerPeakGuardReserveW=()=>1800;},
   h=>{h.app.getEvGridImportControlStatus=()=>({activeTargetW:1100,requestedTargetW:1100,state:'active'});},
   h=>{h.app.splitModeChangeNeeded=()=>true;},
  ];
  for(const [index,change] of invalidations.entries()){const h=await stable();change(h);assert.equal(h.app.canSkipBatteryFeedback(h.settings,now),false,`invalidation ${index}: ${change}`);}
  // 1.0.7 deliberately retains last-known battery SoC without an age cutoff.
  // Preserve that policy; expiry still causes the periodic full evaluation.
  {
   const h=await stable();h.app.inputUpdatedAt.batterySoc[0]=now-600000;
   assert.equal(h.app.canSkipBatteryFeedback(h.settings,now),true);
  }
  // Four unequal SoCs, per-battery caps, missing batteries and efficiency
  // rotations are checked per battery. Identical totals are insufficient.
  for(const optimize of [false,true])for(const soc of [[45,55,65,75],[100,55,65,75],[null,55,65,75]]){
   const h=await setup({optimizeMultiBatteryEfficiency:optimize,individualBatteryPowerLimitsEnabled:true,
    battery1CapacityKwh:5.4,battery2CapacityKwh:5.4,battery3CapacityKwh:5.4,battery4CapacityKwh:5.4,
    battery1MaxChargeW:400,battery2MaxChargeW:700,battery3MaxChargeW:1500,battery4MaxChargeW:2400},-1200,-600);
   h.app.state.batterySoc=soc;
   const state=h.app.getEvaluationState(h.settings,now),result=evaluate(state,h.settings,new Date(now),h.app.controlContext);
   assert.equal(result.baseMode,'charge');
   const preview=previewBatteryFeedback(state,h.settings,result.ordinaryDischargeFloorSoc,result);
   assert.deepEqual(preview.commands,result.commands);
  }
  // Reaching a target is a new mode decision; never keep a charging memo.
  {
   const h=await stable();h.app.state.batterySoc=[75,75,75,75];now+=10000;refreshGrid(h,600-h.app.state.lastTotalCommandW);
   assert.equal(h.app.canSkipBatteryFeedback(h.settings,now),false);
   h.app.requestEvaluate();await drain();assert.notEqual(h.app.latestResult.baseMode,'charge');
  }
  // Safety recovery/manual control use their original evaluation paths.
  for(const forcedMode of ['manual_charge','auto']){
   const h=await setup({forcedMode,safetySoc:20},600,0);
   if(forcedMode==='auto')h.app.state.batterySoc=[15,15,15,15];
   h.app.requestEvaluate(true);await drain();assert.equal(h.app.batteryFeedbackMemo,null);
  }
  // Input arriving while Flow output awaits: calculations continue and the
  // latest result replaces pending work, without introducing a new queue.
  {
   const h=await stable();let release;
   h.app.commandTrigger.trigger=()=>new Promise(resolve=>{release=resolve;});
   now+=10000;refreshGrid(h,-1000);h.app.requestEvaluate();await drain();
   assert.equal(h.app.commandPublishing,true);
   refreshGrid(h,-2000);h.app.requestEvaluate(true);await drain();
   assert(h.app.controlTimer,'new input is coalesced at the existing command interval');
   now=h.app.controlTimer.due;h.app.controlTimer.fn();await drain();
   assert(h.app.pendingResult);assert.equal(h.app.latestResult.liveGridPowerW,-2000);
   h.app.commandTrigger.trigger=async()=>{};
   release();await drain();assert.equal(h.app.commandPublishing,false);
  }
  console.log('1.0.8 charge feedback regression passed: stable/noisy P1, minute expiry, PV source/capture, import/Peak Guard, target/SoC/limits/balancing, unavailable battery, safety/manual, Hybrid, stale input, split timers, flexible-load targets and concurrent publication.');
 }finally{Date.now=realNow;}
}
runChargeRegression().catch(error=>{console.error(error);process.exitCode=1;});
