'use strict';
const assert=require('node:assert/strict');
const {boot}=require('./startup-harness');
const realNow=Date.now;let now=Date.parse('2026-09-28T12:00:00Z');Date.now=()=>now;
const drain=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
async function setup() {
 const h=await boot(new Map(Object.entries({batteryCount:1,totalCapacityKwh:10,controlEnabled:true,
 contractType:'fixed',forcedMode:'self_consumption',gridControlWindowSeconds:5,pvDeltaThresholdW:200,
 adaptiveLiveControlEnabled:false,peakShaveEnabled:false,commandIntervalSeconds:7,commandDeadbandW:20,
 evCount:0,hvacCount:0,boilerCount:0,balanceWarningEnabled:false})));
 const a=h.app;a.isChargeTestValid=()=>true;a.getInputReadiness=()=>({ready:true,degraded:[],received:{}});
 a.setSetting('controlEnabled',true);a.queueStatusUpdate=()=>{};a.triggerCalculatedSetpoint=async()=>{};a.publishFlexibleLoads=async()=>{};
 a.publishPvPowerLimit=async()=>{};a.recordSavingsSample=()=>{};a.requestContextEvaluate=()=>{};
 a.state.batterySoc=[50];a.inputSeen.batterySoc[0]=true;a.state.gridPowerW=0;a.state.pvPowerW=3000;
 a.state.lastTotalCommandW=0;a.lastEmitAt=0;a.nextCommandAllowedAt=0;a.lastEmittedCommands=[0];
 a.getGridAverage=()=>0;h.queue=a.queueCommandEmit;a.queueCommandEmit=()=>false;
 a.noteAutoTunePvSample(3000,now-15000);a.evaluateContextNow();
 h.sample=(v,ms=15000)=>{now+=ms;a.state.pvPowerW=v;a.noteAutoTunePvSample(v,now);};
 assert.deepEqual(h.errors,[]);return h;
}
(async()=>{
 // Both directions, exact threshold, each configured average, and first/missing/zero samples.
 for(const sign of [-1,1])for(const window of [3,5,7,10]){
  const h=await setup(),a=h.app,cfg={...a.getSettings(),gridControlWindowSeconds:window};
  h.sample(3000+sign*200);
  assert.equal(a.getEvaluationState(cfg).controlGridSource,'live_pv_delta');
  h.sample(3000+sign*250);
  assert.equal(a.getEvaluationState(cfg).controlGridSource,`average_${window}_inputs`);
  h.sample(3000+sign*450);
  assert.equal(a.getEvaluationState({...cfg,pvDeltaThresholdW:0}).controlGridSource,`average_${window}_inputs`);
 }
 const h=await setup(),a=h.app;
 let calls=0;const evaluate=a.evaluateFastNow.bind(a);a.evaluateFastNow=(...args)=>{calls++;return evaluate(...args);};
 h.sample(3500);a.requestEvaluate();assert.equal(calls,1);
 for(let i=0;i<20;i++){now+=100;a.requestEvaluate();}
 assert.equal(calls,1,'Unchanged P1 cannot retrigger the same PV sample when P1 is in band');
 h.sample(3500);a.requestEvaluate();assert.equal(calls,2,'Stable PV switches back to averaging once');
 assert.equal(a.latestResult.controlGridSource,'average_5_inputs');
 h.sample(4000);a.requestEvaluate();const before=calls;
 now=a.pvLiveObservation.expiresAt;a.requestEvaluate();
 assert.equal(calls,before+1,'Missing PV expires and changes the selected source once');
 assert.equal(a.latestResult.controlGridSource,'average_5_inputs');
 for(let i=0;i<20;i++){now+=1000;a.requestEvaluate();}
 assert.equal(calls,before+1,'Expired PV cannot sustain a loop');
 // Even after sunset with no new command, 0 W becomes a valid stable reference.
 h.sample(0);a.requestEvaluate();h.sample(0);a.requestEvaluate();const nightCalls=calls;
 for(let i=0;i<6;i++){now+=1000;a.requestEvaluate();}assert.equal(calls,nightCalls);
 // Same-source new large PV input still gets one evaluation (planned charge included).
 a.latestResult.baseMode='charge';h.sample(500);a.requestEvaluate();a.latestResult.baseMode='charge';
 const beforeLarge=calls;h.sample(1000);a.requestEvaluate();assert.equal(calls,beforeLarge+1);
 // Genuine P1 error is still corrected without waiting for another PV sample.
 a.latestResult.baseMode='self_consumption';a.state.gridPowerW=-800;a.getGridAverage=()=>-800;
 const beforeP1=calls;a.requestEvaluate();assert.equal(calls,beforeP1+1);
 // Expiry uses the existing cadence, also for slower-than-Autotune inputs.
 h.sample(1500,120000);assert.equal(a.pvLiveObservation.expiresAt-now,240000);
 const observation=a.pvLiveObservation;
 for(const bad of [null,undefined,NaN,Infinity,'',false])a.noteAutoTunePvSample(bad,now+1);
 assert.equal(a.pvLiveObservation,observation,'Invalid input cannot change or prolong live mode');
 const init=await setup();init.app.pvLiveObservation=null;init.app.autoTuneRuntime=init.app.createAutoTuneRuntime();
 init.app.noteAutoTunePvSample(0,now);assert.equal(init.app.getRecentPvDelta(),0);
 now+=1000;init.app.noteAutoTunePvSample(200,now);assert.equal(init.app.getRecentPvDelta(),200);
 // Cooldown uses the newest input: a fresh large change -> live; a quiet sample -> average.
 for(const quiet of [false,true]){
  const c=await setup(),b=c.app;c.sample(3500);b.state.gridPowerW=-1000;b.getGridAverage=()=>-100;
  b.queueCommandEmit=c.queue;b.lastEmitAt=now;b.nextCommandAllowedAt=now+7000;
  const sent=[];b.commandTrigger={trigger:async t=>sent.push(t)};
  now+=1000;const index=c.timers.length;b.requestEvaluate();assert.equal(sent.length,0);
  const timer=c.timers.slice(index).find(t=>t.ms===6000);assert(timer);
  now+=6000;b.state.pvPowerW=quiet?3500:4000;b.noteAutoTunePvSample(b.state.pvPowerW,now);
  b.state.gridPowerW=-1200;timer.fn();await drain();assert.equal(sent.length,1);
  assert.equal(b.latestResult.controlGridSource,quiet?'average_5_inputs':'live_pv_delta');
  assert.equal(b.latestResult.controlGridPowerW,quiet?-100:-1200);
  assert.deepEqual(c.errors,[]);
 }
 // Publication (including slow or failed output) never resets a newer PV observation.
 const t=await setup(),b=t.app;t.sample(3500);b.state.gridPowerW=-800;
 const result=b.evaluateFastNow();let release;b.commandTrigger={trigger:()=>new Promise(r=>release=r)};
 b.pendingResult=result;b.lastEmitAt=0;b.nextCommandAllowedAt=0;
 const pending=b.emitPending();await drain();assert(release);
 t.sample(3500);const latest=b.pvLiveObservation;release();await pending;
 assert.equal(b.pvLiveObservation,latest);assert.equal(b.getEvaluationState().controlGridSource,'average_5_inputs');
 now+=8000;b.pendingResult=result;b.commandTrigger={trigger:async()=>{throw Error('transport failure');}};
 await assert.rejects(b.emitPending(),/transport failure/);assert.equal(b.pvLiveObservation,latest);
 now+=8000;b.pendingResult=result;b.commandTrigger={trigger:async()=>{}};
 b.publishSplitBatteryCommands=async()=>{throw Error('split failure');};
 await assert.rejects(b.emitPending(),/split failure/);assert.equal(b.pvLiveObservation,latest);
 // Real Flow and API inputs use the same detector; malformed input is ignored.
 const f=await setup();f.app.requestEvaluate=()=>{};
 now+=15000;await f.cards.get('set_pv_power').listener({power:3400});assert.equal(f.app.getRecentPvDelta(),400);
 now+=15000;await f.app.setInput({pvPowerW:3400});assert.equal(f.app.getRecentPvDelta(),0);
 const rev=f.app.pvLiveObservation.revision;
 await f.cards.get('set_pv_power').listener({power:null});await f.app.setInput({pvPowerW:null});
 assert.equal(f.app.pvLiveObservation.revision,rev);
 assert.deepEqual(h.errors,[]);assert.deepEqual(t.errors,[]);assert.deepEqual(f.errors,[]);
 console.log('0.9.8: consecutive PV samples, all averages, expiry/cadence, no repeated stable evaluations, night zero, live P1 corrections, cooldown, newest input, async/failed publication and Flow/API paths passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Date.now=realNow;});
