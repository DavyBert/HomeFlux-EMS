'use strict';
const assert = require('node:assert/strict');
const { boot } = require('./startup-harness');
const originalNow = Date.now;
let now = new Date('2026-09-27T12:00:00Z').getTime();
Date.now = () => now;
const drain = async () => { for(let i=0;i<50;i++) await Promise.resolve(); };
async function setup() {
  const {app,errors,timers}=await boot(new Map(Object.entries({batteryCount:1,totalCapacityKwh:10,controlEnabled:true,
    contractType:'fixed',forcedMode:'self_consumption',gridControlWindowSeconds:5,pvDeltaThresholdW:200,
    adaptiveLiveControlEnabled:false,peakShaveEnabled:false,commandIntervalSeconds:7,commandDeadbandW:20,
    evCount:0,hvacCount:0,boilerCount:0,balanceWarningEnabled:false})));
  app.isChargeTestValid=()=>true;
  app.getInputReadiness=()=>({ready:true,degraded:[],received:{}});
  app.queueStatusUpdate=()=>{};
  app.triggerCalculatedSetpoint=async()=>{};
  app.publishFlexibleLoads=async()=>{};
  app.publishPvPowerLimit=async()=>{};
  app.recordSavingsSample=()=>{};
  app.requestContextEvaluate=()=>{};
  app.state.batterySoc=[50];app.inputSeen.batterySoc[0]=true;
  app.state.gridPowerW=-800;app.state.pvPowerW=3700;
  app.state.lastTotalCommandW=-1000;app.lastEmittedCommands=[-1000];
  app.lastEmittedMode='self_consumption';app.lastEmittedOverride='';
  app.pvAtLastBatteryCommandW=3700;
  app.getGridAverage=()=>-40;
  const queue=app.queueCommandEmit;
  app.queueCommandEmit=()=>false;
  app.evaluateContextNow();
  assert.deepEqual(errors,[]);
  return {app,errors,timers,queue};
}
(async()=>{
 for(const direction of [-1,1]) {
  const {app,errors}=await setup();
  for(const [index,delta] of [100,200,300,400].entries()) {
    app.state.pvPowerW=3700+direction*delta;
    const r=index%2?app.evaluateContextNow():app.evaluateFastNow();
    assert.equal(r.pvDeltaW,direction*delta,'Fast/context evaluations must preserve cumulative change');
    assert.equal(r.controlGridSource,delta<200?'average_5_inputs':'live_pv_delta');
    assert.equal(r.controlGridPowerW,delta<200?-40:-800);
    assert.equal(app.pvAtLastBatteryCommandW,3700);
  }
  assert.deepEqual(errors,[]);
 }
 const {app,queue,timers,errors}=await setup();
 app.state.pvPowerW=3500;
 app.evaluateContextNow();
 app.queueCommandEmit=queue;
 app.lastEmitAt=now;app.nextCommandAllowedAt=now+7000;
 const sent=[];app.commandTrigger={trigger:async tokens=>{sent.push(tokens)}};
 const n=timers.length;
 now+=1000;app.requestEvaluate(false);
 assert.equal(sent.length,0,'No command before cooldown');
 const timer=timers.slice(n).find(t=>t.type==='timeout' && t.ms===6000);
 assert(timer,'Cumulative PV change schedules the existing command boundary');
 app.state.pvPowerW=3300;app.state.gridPowerW=-1200;
 now+=6000;timer.fn();await drain();
 assert.equal(sent.length,1);
 assert.equal(app.latestResult.controlGridPowerW,-1200,'Scheduled calculation uses latest P1');
 assert.equal(app.latestResult.pvDeltaW,-400);
 assert.equal(app.pvAtLastBatteryCommandW,3300);
 assert.equal(app.getPvDeltaSinceBatteryCommand(),0);
 app.state.pvPowerW=3250;
 assert.equal(app.getEvaluationState().controlGridSource,'average_5_inputs','A new command resets the reference');
 assert.deepEqual(errors,[]);
 // Observe PV while asynchronous publication is pending: never swallow that movement.
 const h=await setup();const b=h.app;
 b.state.pvPowerW=3400;
 const candidate={...b.evaluateFastNow(),_runFlexibleLoadPass:false};
 let release; b.commandTrigger={trigger:()=>new Promise(resolve=>{release=resolve})};
 b.pendingResult=candidate;b.lastEmitAt=0;b.nextCommandAllowedAt=0;
 const publishing=b.emitPending();await drain();assert(release);
 assert.equal(b.pvAtLastBatteryCommandW,3700);
 b.state.pvPowerW=3000;release();await publishing;
 assert.equal(b.pvAtLastBatteryCommandW,3400,'Use the observation from the command calculation');
 assert.equal(b.getPvDeltaSinceBatteryCommand(),-400);
 // Failed transport and pauses retain the baseline.
 now+=8000;b.pendingResult={...candidate,_pvAtCalculationW:3000};
 b.commandTrigger={trigger:async()=>{throw Error('transport failure')}};
 await assert.rejects(b.emitPending(),/transport failure/);
 assert.equal(b.pvAtLastBatteryCommandW,3400);
 now+=8000;b.pendingResult={...candidate,_pvAtCalculationW:3000};
 b.commandTrigger={trigger:async()=>{}};b.publishSplitBatteryCommands=async()=>{throw Error('split failure')};
 await assert.rejects(b.emitPending(),/split failure/);assert.equal(b.pvAtLastBatteryCommandW,3400);
 b.getBatteryCommandPauseInfo=()=>({active:true,remainingMs:1000});
 b.pendingResult=candidate;await b.emitPending();assert.equal(b.pvAtLastBatteryCommandW,3400);
 // Explicit zero disables PV live selection; genuine zero and missing PV differ.
 const j=await setup();const c=j.app;
 assert.equal(c.getEvaluationState({...c.getSettings(),pvDeltaThresholdW:0},now,900).controlGridSource,'average_5_inputs');
 c.pvAtLastBatteryCommandW=null;c.pvAtFirstObservationW=null;c.state.pvPowerW=null;
 assert.equal(c.getPvDeltaSinceBatteryCommand(),0);assert.equal(c.pvAtFirstObservationW,null);
 c.state.pvPowerW=0;assert.equal(c.getPvDeltaSinceBatteryCommand(),0);assert.equal(c.pvAtFirstObservationW,0);
 c.state.pvPowerW=250;assert.equal(c.getPvDeltaSinceBatteryCommand(),250);
 // Planned charging cannot filter out a significant PV change in the same grid zone.
 c.latestResult={baseMode:'charge',override:''};c.lastFastControlSnapshot=c.getFastControlSnapshot();
 assert.equal(c.shouldRunFastEvaluation(false),true);
 assert.equal(c.shouldRunFastEvaluation(false,{...c.getSettings(),pvDeltaThresholdW:0}),false);
 console.log('0.9.6: cumulative PV rises/falls, fast/context paths, live latest P1, cooldown, publication reset/failure, asynchronous PV movement, startup and disabled threshold passed');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Date.now=originalNow});
