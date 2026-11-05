'use strict';
const assert=require('node:assert/strict');
const P=require('../lib/phase-guard'),E=require('../lib/ev-phase-guard');
const {DEFAULTS}=require('../lib/ems-engine');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const NativeDate=Date,nativeNow=Date.now,restore=installVirtualClearTimeout();
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const now=Date.UTC(2026,10,4,12);
let checks=0;
function fixture(types=['L1'],old=[0],values=[100,100,100]){
 const s={...DEFAULTS,batteryCount:types.length,maxTotalChargeW:20000,maxChargePerBatteryW:10000,maxSoc:100,
  phaseGuard:{...P.defaults,phases:3,enabled:true,voltage:230,amps:25,limitW:4500,batteries:types}};
 return {state:{batterySoc:types.map(()=>50)},settings:s,lastEmittedCommands:old,gridPhases:values.map(watts=>({watts,at:now}))};
}
(async()=>{try{
 // Actual scheduler/publication: the ordinary seven-second interval delays the
 // moment, never the size, of a safe 1500 -> 4000 W charging command.
 const h=await setup(undefined,{batteryCount:1,forcedMode:'manual_charge',manualChargeW:4000,
  maxChargePerBatteryW:10000,maxTotalChargeW:4000,peakLimitW:20000,exportLimitEnabled:false,
  commandIntervalSeconds:7,optimizeMultiBatteryEfficiency:false,
  phaseGuard:{...P.defaults,phases:3,enabled:true,voltage:230,amps:25,limitW:4500,batteries:['L1']}},now,0);
 const a=h.app;h.store.set('_chargeTestSignature',a.getChargeTestSignature(a.getSettings()));
 a.setSetting('controlEnabled',true);await h.start();await h.flush();
 a.requestContextEvaluate=()=>{};a.lastEmittedCommands=[-1500];a.state.lastTotalCommandW=-1500;
 a.lastEmitAt=h.now();a.nextCommandAllowedAt=h.now()+7000;
 const before=h.traces.length;
 await h.cards.get('set_grid_power_phases').listener({power:2200,l1:2000,l2:100,l3:100});a.requestEvaluate(true);await h.drain();
 assert.equal(h.traces.length,before,'no early ordinary charging publication');
 h.setNow(now+6999);await h.flush();assert.equal(h.traces.length,before);
 h.setNow(now+7000);await h.flush();
 assert.equal(h.traces.at(-1).at,now+7000);assert.equal(h.traces.at(-1).total,-4000);
 assert.equal(a.nextCommandAllowedAt,now+14000);assert.deepEqual(h.errors,[]);checks++;

 // Opposite-phase relief must not cap a healthy phase to its previous charge.
 const m=fixture(['L1','L2'],[-1000,-1000],[5000,1000,100]);
 assert.deepEqual(P.limit(m,[-1000,-1000],m.settings,now),[-500,-1500]);checks++;
 // Dropping a discharging battery removes that contribution from phase room.
 const discharge=fixture(['L1'],[1000],[4000,100,100]);
 assert.deepEqual(P.limit(discharge,[-1000],discharge.settings,now),[0]);checks++;
 // A changed phase assignment cannot reuse credit from the old assignment.
 const changed=fixture(['L1'],[-2000],[4000,4000,100]);P.capture(changed,changed.settings);
 changed.settings.phaseGuard={...changed.settings.phaseGuard,batteries:['L2']};
 assert.deepEqual(P.limit(changed,[-2000],changed.settings,now),[-500]);checks++;

 // Deterministic fast load changes, real limiter and all command quantizations.
 // Every predicted phase stays within its limit; repeated publication on the
 // same meter sample cannot invent additional available capacity.
 let seed=12345;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 for(const quantum of [1,10,100]){
  const f=fixture(['L1','L2','L3','balanced3'],[0,0,0,0]);f.settings.batteryCommandStepW=quantum;
  for(let iteration=0;iteration<200;iteration++){
   const base=Array.from({length:3},()=>random(4401));
   const measured=base.slice();f.lastEmittedCommands.forEach((v,j)=>P.weights(f.settings.phaseGuard.batteries[j]).forEach((w,i)=>measured[i]+=Math.max(0,-v)*w));
   const at=now+iteration*1000;P.ingest(f,{l1:measured[0],l2:measured[1],l3:measured[2]},at);P.capture(f,f.settings);
   const wanted=Array.from({length:4},()=>-random(6001));const out=P.limit(f,wanted,f.settings,at);
   const predicted=base.slice();out.forEach((v,j)=>P.weights(f.settings.phaseGuard.batteries[j]).forEach((w,i)=>predicted[i]+=Math.max(0,-v)*w));
   assert(predicted.every(v=>v<=4500+1e-7));assert(P.charge(out)<=P.charge(wanted));
   P.committed(f,f.lastEmittedCommands,out,f.settings,at);f.lastEmittedCommands=out;
   assert.deepEqual(P.limit(f,wanted,f.settings,at),out,'same-sample output is idempotent');
  }
  checks++;
 }

 // Disabled/single-phase path does not even access app state or phase inputs.
 const untouched=new Proxy({},{get(){throw Error('disabled phase calculation');}});
 for(const c of [{phases:3,enabled:false},{phases:1,enabled:true}]){
  const s={phaseGuard:c},commands=[-4000],result={candidateCommands:commands};
  assert.equal(P.capture(untouched,s),null);assert.equal(P.limit(untouched,commands,s,now),commands);
  assert.equal(P.apply(untouched,result,s,now),result);assert(!P.recovery(untouched,s,now));checks++;
 }

 // EV restoration uses genuinely released capacity even before an earlier
 // reduction was acknowledged. No artificial EV or battery recovery ramp.
 for(const priority of ['battery_first','shared','ev_first']){
  const f=fixture(['balanced3'],[-6000],[5680,5680,5680]),s=f.settings;
  s.phaseGuard.priority=priority;s.evCount=1;s.evEnabled=true;s.evControlType='current';
  const meter={fresh:true,currentA:16,updatedAt:now};
  Object.assign(f,{getEvCount:()=>1,getEvSettingKey:(_i,k)=>'ev'+k,getEvElectricalSettingsFor:()=>({evPhases:3,evVoltage:230,evVoltageReference:'phase'}),
   getEvInputSnapshot:()=>({}),getEvMeasuredCurrent:()=>meter,getEvControlTypeFor:()=> 'current',lastPublishedEvCurrentA:16,lastPublishedEvAllowed:true});
  E.reference(f,s,now);const desired=()=>({desiredCurrentA:16,desiredPowerW:11040,allowed:true});
  const limited=E.cap(f,0,desired(),s,now);
  assert.equal(limited.desiredCurrentA,priority==='battery_first'?10:priority==='shared'?13:16);
  E.begin(f,0,s,limited.desiredCurrentA,now);E.complete(f,0,s,limited.desiredCurrentA,true,now);
  assert.deepEqual(P.limit(f,[-6000],s,now),[-2460],'unconfirmed EV reductions never finance battery charging');
  P.ingest(f,{l1:3500,l2:3500,l3:3500},now+1000);
  assert.equal(E.cap(f,0,desired(),s,now+1000).desiredCurrentA,16);
  assert.deepEqual(P.limit(f,[-6000],s,now+1000),[-6000]);checks++;
  f.lastPublishedEvCurrentA=20;E.begin(f,0,s,20,now+1000);E.complete(f,0,s,20,true,now+1000);
  assert.deepEqual(P.limit(f,[-10000],s,now+1000),[-6240],'a successfully issued EV increase is reserved until measured');
  P.ingest(f,{l1:3500,l2:3500,l3:3500},now+2000);
  assert.deepEqual(P.limit(f,[-10000],s,now+2000),[-6240],'unconfirmed EV increases remain reserved across phase packets');checks++;

 }
 console.log(`Phase limiter 1.2.30: ${checks} focused groups, including 600 rapid-load/quantization cases, passed.`);
}finally{global.Date=NativeDate;Date.now=nativeNow;restore();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
