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
async function run() {
 try {
  // Both same-zone export and unexpected import must reach the existing engine.
  // Exercise real Flow/API inputs, scheduler, safety result and output queue.
  for(const optimization of [false,true])for(const input of ['flow','api'])for(const exportCase of [true,false]) {
   const h=await setup({optimizeMultiBatteryEfficiency:optimization},exportCase?-100:100,exportCase?-1000:-2000);
   assert.equal(h.app.latestResult.baseMode,'charge');
   if(input==='flow')await h.cards.get('set_grid_power').listener({power:exportCase?-600:600});
   else h.app.setInput({gridPowerW:exportCase?-600:600});
   await drain();
   assert.equal(h.app.diagnostics.counters.fastEvaluations,1);
   assert.equal(h.app.diagnostics.counters.fastSkipped,undefined);
   assert.equal(h.publishes.length,1);assert.equal(h.publishes[0].total,exportCase?-1600:-1400);
   assert.equal(h.app.diagnostics.counters.batteryCommandPublishes,1);
   assert.equal(h.errors.length,0);
  }
  // Repeated requests coalesce at a fixed boundary, rather than postponing it.
  for(const contractType of ['tou','dynamic_hour','dynamic_quarter']) {
   const interval=contractType==='dynamic_hour'?60:15;
   const dynamicSlots=Array.from({length:1440/interval},(_,i)=>({dateKey:'2026-10-04',minute:i*interval,
    time:`${String(Math.floor(i*interval/60)).padStart(2,'0')}:${String(i*interval%60).padStart(2,'0')}`,
    price:i*interval>=14*60&&i*interval<17*60?.05:.3+i*.0001}));
   const h=await setup({contractType,dynamicSlots,dynamicPriceDataReady:true,
    touRates:[{id:'cheap',name:'Cheap',importPrice:.1,feedInPrice:.03,weekdayChargeMode:'always',weekendChargeMode:'always'}],
    touSchedule:[{rateId:'cheap',start:'00:00',end:'23:59',days:[1,2,3,4,5,6,7]}]});
   assert.equal(h.app.latestResult.baseMode,'charge',contractType);
   await h.cards.get('set_grid_power').listener({power:-600});await drain();
   assert.equal(h.app.diagnostics.counters.fastEvaluations,1);assert(h.publishes[0].total<-1000);
  }
  {
   const h=await setup();h.app.lastEmitAt=now;h.app.nextCommandAllowedAt=now+5000;
   for(let i=1;i<=4;i++) {now+=1000;await h.cards.get('set_grid_power').listener({power:-100-i*100});}
   assert.equal(h.timers.length,1);assert.equal(h.app.diagnostics.counters.fastScheduled,1);
   assert.equal(h.app.diagnostics.counters.fastCoalesced,3);assert.equal(h.publishes.length,0);
   now=h.timers[0].due;h.timers[0].fn();await drain();
   assert.equal(h.app.diagnostics.counters.fastEvaluations,1);assert.equal(h.publishes[0].total,-1500);
   const first=h.publishes[0].at;now+=1000;
   await h.cards.get('set_grid_power').listener({power:-300});
   assert.equal(h.publishes.length,1);now=h.timers.at(-1).due;h.timers.at(-1).fn();await drain();
   assert.equal(h.publishes.length,2);assert(h.publishes[1].at-first>=5000);
  }
  // A residual export needs another correction even without a signal change.
  {
   const h=await setup({},0,-100);h.app.lastEmitAt=now;h.app.nextCommandAllowedAt=now+5000;
   h.app.requestEvaluate(false);assert.equal(h.timers.length,0);
   h.app.requestEvaluate(true);assert.equal(h.timers.length,1);
   now=h.timers[0].due;h.timers[0].fn();await drain();
   assert.equal(h.app.diagnostics.counters.fastEvaluations,1,'a forced pending correction must not lose its force flag at the timer boundary');
   assert.equal(h.publishes.length,1);assert(h.publishes[0].total<-100);
  }
  {
   const h=await setup({},-100,-100);h.app.lastEmitAt=now;h.app.nextCommandAllowedAt=now+5000;
   h.app.requestEvaluate(false);assert.equal(h.timers.length,1);
   h.app.requestEvaluate(true);assert.equal(h.timers.length,1);assert.equal(h.app.controlTimerForce,true);
   h.app.state.gridPowerW=0;h.app.rememberFastControlSnapshot(h.settings,now,h.app.getEvaluationState(h.settings,now));
   h.app.nextCommandAllowedAt=now+8000;
   now=h.timers[0].due;h.timers[0].fn();assert.equal(h.publishes.length,0);assert.equal(h.timers.length,2);
   assert.equal(h.app.controlTimerForce,true,'force must also survive a later reserved output boundary');
   now=h.timers[1].due;h.timers[1].fn();await drain();assert.equal(h.publishes.length,1);
  }
  {
   const h=await setup({controlProfile:'calm'},-600,-1000);
   const previous=h.app.state.lastTotalCommandW;
   h.app.requestEvaluate();await drain();assert(h.app.state.lastTotalCommandW<previous);
   now+=5000;h.app.inputUpdatedAt.grid=now;h.app.requestEvaluate();await drain();
   assert.equal(h.app.diagnostics.counters.fastEvaluations,2);assert.equal(h.publishes.length,2);
  }
  // Inside-band noise stays filtered; limits can yield an evaluation with no write.
  {
   const h=await setup({},0,-1000);h.app.requestEvaluate();
   assert.equal(h.app.diagnostics.counters.fastSkipStableSignal,1);assert.equal(h.publishes.length,0);
  }
  {
   const h=await setup({},100,-1000),floor=h.app.latestResult.plannedChargeW;
   const state={...h.app.getEvaluationState(h.settings,now),lastTotalCommandW:-floor};
   const held=evaluate(state,h.settings,new Date(now),h.app.controlContext);
   h.app.lastEmittedCommands=held.commands.slice();h.app.state.lastTotalCommandW=held.totalCommandW;
   h.app.latestResult=h.app.createSafetyResult(held,h.settings,h.app.getInputReadiness(h.settings));
   h.app.requestEvaluate();await drain();
   assert.equal(h.app.diagnostics.counters.fastNoCommandChange,1);
   assert.equal(h.publishes.length,0,'intentional grid charging at the configured planning floor must remain allowed');
  }
  {
   const dayAt=now;now=Date.parse('2026-10-04T00:00:00Z');
   const h=await setup();Object.assign(h.app.state,{pvSeenProducingToday:false,pvPowerW:0,
    nightPlanningActive:true,nightPlanningStartedDate:'2026-10-03'});
   const state=h.app.getEvaluationState(h.settings,now);assert(state.nightPlanningActive);
   h.app.controlContext=prepareControlContext(state,h.settings,new Date(now));
   h.app.latestResult=h.app.createSafetyResult(evaluate(state,h.settings,new Date(now),h.app.controlContext),h.settings,h.app.getInputReadiness(h.settings));
   assert.equal(h.app.latestResult.baseMode,'charge');h.app.rememberFastControlSnapshot(h.settings,now,state);
   await h.cards.get('set_grid_power').listener({power:-600});await drain();
   assert.equal(h.app.diagnostics.counters.fastEvaluations,1);assert(h.publishes[0].total<-1000);
   now=dayAt;
  }
  {
   const h=await setup({maxTotalChargeW:1000},-600,-1000);
   h.app.lastEmittedCommands=h.app.latestResult.candidateCommands.slice();
   h.app.requestEvaluate();await drain();
   assert.equal(h.app.diagnostics.counters.fastEvaluations,1);
   assert.equal(h.app.diagnostics.counters.fastNoCommandChange,1);assert.equal(h.publishes.length,0);
   assert.equal(h.app.nextCommandAllowedAt,0);
  }
  // The same feedback correction remains active with 5-sample averaging.
  {
   const h=await setup({gridControlWindowSeconds:5},-100,-1000);
   for(let i=0;i<5;i++)h.app.recordGridSample(-600,now-i*1000);
   h.app.state.gridPowerW=-600;h.app.requestEvaluate();await drain();assert.equal(h.publishes[0].total,-1600);
  }
  // Peak Guard remains authoritative and excessive import is not hidden.
  {
   const h=await setup({peakLimitW:2650},100,-2000);
   await h.cards.get('set_grid_power').listener({power:3200});await drain();
   assert.equal(h.app.diagnostics.counters.fastReasonPeakTransition,1);
   assert(h.publishes.length===1);assert(h.publishes[0].total>-2000);
  }
  // An active publisher serializes writes, but does not suppress evaluation.
  {
   const h=await setup();h.app.commandPublishing=true;h.app.state.gridPowerW=-600;
   h.app.requestEvaluate();await drain();assert.equal(h.app.diagnostics.counters.fastEvaluations,1);
   assert.equal(h.publishes.length,0);assert(h.app.pendingResult);
   h.app.commandPublishing=false;await h.app.emitPending();assert.equal(h.publishes.length,1);
  }
  // Missing context has its own reason. Ordinary startup creates context; a
  // recovered grid schedules an immediate context pass, without a warm-up timer.
  {
   const h=await setup();h.app.controlContext=null;h.app.requestEvaluate();
   assert.equal(h.app.diagnostics.counters.fastSkipContextUnavailable,1);
   h.app.inputSeen.grid=false;await h.cards.get('set_grid_power').listener({power:-600});
   assert.equal(h.slow,1);
  }
  {
   const {app,errors}=await boot();assert(app.controlContext);assert(app.controlRuntimeSettings);assert(app.latestResult);
   assert(app.appStartedAt>0);assert(app.appInitializedAt>=app.appStartedAt);
   assert.equal(errors.length,0);
  }
  // Operator pause, stand-by, invalid input, unknown/full SoC and Hybrid
  // ownership remain separate from ordinary grid-feedback scheduling.
  {
   const h=await setup();h.app.getBatteryCommandPauseInfo=()=>({active:true});h.app.scheduleBatteryCommandPauseResume=()=>{};
   h.app.requestEvaluate();assert.equal(h.app.diagnostics.counters.fastPaused,1);assert.equal(h.app.diagnostics.counters.fastSkipped,undefined);
  }
  {
   const h=await setup();h.app.latestResult.baseMode='standby';h.app.requestEvaluate();
   assert.equal(h.app.diagnostics.counters.fastSkipNonFeedbackMode,1);
  }
  {
   const h=await setup();h.app.state.gridPowerW=NaN;h.app.requestEvaluate();assert.equal(h.app.diagnostics.counters.fastSkipInvalidGrid,1);
  }
  for(const soc of [null,100]) {
   const h=await setup({},-600,0);h.app.state.batterySoc=Array(4).fill(soc);h.app.inputSeen.batterySoc=Array(4).fill(soc!==null);
   h.app.requestEvaluate(true);await drain();assert(h.publishes.every(p=>p.total===0),'unknown/full batteries must never receive a charging command');
  }
  {
   const h=await setup({hybridEmsEnabled:true},-600,-1000);h.app.hybridEmsRuntime={delegated:true,takeover:false,status:'external_control'};
   h.app.queueCommandEmit(h.app.latestResult,true);assert.equal(h.publishes.length,0);assert.equal(h.app.pendingResult,null);
  }
  console.log('1.0.6 fast-control audit passed: planned charge export/import, real Flow/API inputs, efficiency on/off, repeated feedback, fixed cooldown/coalescing, averaging, unchanged output, startup/context, pause, Peak Guard, output mutex, SoC and Hybrid safeguards.');
 } finally {Date.now=realNow;}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
