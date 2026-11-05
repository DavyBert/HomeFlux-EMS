'use strict';
const assert=require('node:assert/strict'),P=require('../lib/phase-guard'),E=require('../lib/ev-phase-guard');
const {fixture}=require('./ev-work-harness'),{installVirtualClearTimeout}=require('./pv-source-harness');
const NativeDate=Date,originalNow=Date.now,restore=installVirtualClearTimeout();
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
let checks=0;
async function scenario({type='current',priority='ev_settings',gridPriority='battery_first',evs=1,batteries=['balanced3'],old=[-6000],peak=20000,values=[4500,4500,4500],total=values.reduce((a,b)=>a+b,0)}={}){
 const config={...P.defaults,phases:3,enabled:true,voltage:230,amps:25,limitW:4500,priority:'shared',emergencyPriority:priority,batteries};
 const h=await fixture({type,evs,batteries:batteries.length,chargeAllowed:true,extra:{forcedMode:'manual_charge',maxTotalChargeW:10000,maxChargePerBatteryW:10000,peakShaveEnabled:true,peakLimitW:peak,phaseGuard:config}}),a=h.app;
 a.requestEvaluate=()=>{};a.requestContextEvaluate=()=>{};
 for(let i=0;i<evs;i++){
  const stem=i?'ev'+(i+1):'ev';
  for(const [key,value] of [['Voltage',230],['VoltageReference','phase'],['SmartGridPriority',gridPriority]])await h.setExternalSetting(stem+key,value);
  a.setEvSessionOverrideFor(i,'emergency','flow');
  await h.cards.get('set_ev'+(i+1)+'_status').listener({connected:'yes',charge_current:0});
  const runtime=i?a.getExtraEv(i):a;
  Object.assign(runtime,i?{lastPublishedCurrentA:0,lastPublishedAllowed:false,lastPublishedChargeMode:'stop',lastPublishedAt:0}:{lastPublishedEvCurrentA:0,lastPublishedEvAllowed:false,lastPublishedEvChargeMode:'stop',lastEvPublishedAt:0});
 }
 delete a.evPhaseRuntime;delete a.evPhaseRequests;delete a.evPhaseStartReservations;
 a.lastEmittedCommands=old.slice();a.state.lastTotalCommandW=old.reduce((x,y)=>x+y,0);a.state.batterySoc=batteries.map(()=>50);
 a.state.gridPowerW=total;a.inputUpdatedAt.grid=h.now();P.ingest(a,Object.fromEntries(values.map((v,i)=>['l'+(i+1),v])),h.now());
 const result={...a.latestResult,safetySocRecoveryActive:false,candidateCommands:old.slice(),candidateTotalCommandW:a.state.lastTotalCommandW,canPublishCommands:true,_runFlexibleLoadPass:false};
 const calculate=()=>a.calculateEvPortfolioDecisions(result,result.candidateTotalCommandW,a.state.lastTotalCommandW,a.getSettings());
 const sample=(watts,totalPower=watts.reduce((x,y)=>x+y,0))=>{
  h.setNow(h.now()+8000);a.state.gridPowerW=totalPower;a.inputUpdatedAt.grid=h.now();P.ingest(a,Object.fromEntries(watts.map((v,i)=>['l'+(i+1),v])),h.now());
 };
 return {...h,a,result,calculate,sample};
}
(async()=>{try{
 for(const type of ['current','hybrid'])for(const priority of ['ev_settings','battery_first','shared','ev_first']){
  const h=await scenario({type,priority}),{a,result}=h,s=a.getSettings();
  const before=h.calculate()[0];assert.equal(before.desiredCurrentA,0);assert.match(before.reason,/batterijreductie/);
  const limited=P.limit(a,[-6000],s,h.now());assert.deepEqual(limited,[-1860],'only 6 A start capacity is reserved');
  const events=[];a.commandTrigger.trigger=async t=>events.push(['battery',t.total_command]);
  a.evCurrentTrigger.trigger=async t=>events.push(['ev',t.charge_current]);
  a.pendingResult={...result,candidateCommands:limited,candidateTotalCommandW:-1860};a.nextCommandAllowedAt=0;a.lastEmitAt=0;
  await a.emitPending();assert.deepEqual(events,[['battery',-1860]]);
  await a.publishEvDecision(h.calculate()[0]);assert(!events.some(e=>e[0]==='ev'&&e[1]>0),'an output receipt does not confirm phase capacity');
  h.sample([3120,3120,3120]);const start=h.calculate()[0];assert.equal(start.desiredCurrentA,6);assert(start.allowed);
  await a.publishEvDecision(start);assert(events.some(e=>e[0]==='ev'&&e[1]===6));assert.equal(a.lastPublishedEvCurrentA,6);
  assert.deepEqual(P.limit(a,[-6000],s,h.now()),[-1860],'pending EV start cannot release its reservation');checks++;
 }
 // The normal Shared choice follows each EV's grid priority, not PV share.
 for(const [setting,expected] of [['battery_first','battery_first'],['share','share'],['ev_first','ev_first']]){
  const h=await scenario({gridPriority:setting}),s=h.a.getSettings();
  assert.equal(E.priority(h.a,0,s,true),expected);assert.equal(E.priority(h.a,0,s,false),expected);
  h.a.setSetting('evPvSharePercent',99);assert.equal(E.priority(h.a,0,h.a.getSettings(),true),expected);checks++;
 }
 // Once physically charging, priorities determine the capacity above 6 A.
 const allocationByPriority={};
 for(const priority of ['battery_first','shared','ev_first']){
  const h=await scenario({priority}),{a}=h;h.calculate();a.lastEmittedCommands=[-1860];a.state.lastTotalCommandW=-1860;
  await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:6});
  Object.assign(a,{lastPublishedEvCurrentA:6,lastPublishedEvAllowed:true,lastPublishedEvChargeMode:'standard'});
  h.sample([4500,4500,4500]);h.calculate();allocationByPriority[priority]=E.allocation(a,a.getSettings(),h.now()).targets[0];
 }
 assert.deepEqual(allocationByPriority,{battery_first:6,shared:7,ev_first:8});checks++;
 // No-export preparation: retain all PV absorption at a zero total reading.
 {
  const h=await scenario({values:[0,0,0]}),s=h.a.getSettings();
  assert.equal(h.calculate()[0].desiredCurrentA,6);assert.deepEqual(P.limit(h.a,[-6000],s,h.now()),[-6000]);checks++;
 }
 {
  const h=await scenario({values:[4500,-2200,-2200],total:100}),s=h.a.getSettings();
  assert.equal(h.calculate()[0].desiredCurrentA,0);
  assert(P.charge(P.limit(h.a,[-6000],s,h.now()))>=5900,'EV preparation cannot turn 100 W import into export');checks++;
 }
 for(const step of [1,10,100]){
  const h=await scenario({values:[4500,-175,-175],total:4150});h.a.setSetting('batteryCommandStepW',step);h.calculate();
  const out=P.limit(h.a,[-6000],h.a.getSettings(),h.now());
  assert(4150-(6000-P.charge(out))>=0,'command rounding cannot introduce export during EV preparation');checks++;
 }
 // Unknown battery phase provides no invented, transferable capacity.
 {
  const h=await scenario({batteries:['unknown']}),s=h.a.getSettings();
  assert.equal(h.calculate()[0].desiredCurrentA,0);assert.equal(E.allocation(h.a,s,h.now()).targets[0],0);checks++;
 }
 // The battery on the constrained phase is reduced; unrelated phases retain
 // their command. Do not replace the engine's per-battery allocation.
 {
  const h=await scenario({batteries:['L1','L2'],old:[-3000,-1000],values:[4500,1000,500]});h.calculate();
  const out=P.limit(h.a,[-3000,-1000],h.a.getSettings(),h.now());assert.equal(out[0],-1620);assert(out[1]<=-1000,'healthy phase is not unnecessarily reduced');assert(P.charge(out)<=4000);checks++;
 }
 // Safety reserve restoration takes priority over an Emergency start.
 {
  const h=await scenario();h.result.safetySocRecoveryActive=true;h.a.state.batterySoc[0]=5;
  h.calculate();assert.deepEqual(P.limit(h.a,[-6000],h.a.getSettings(),h.now()),[-6000]);assert.equal(E.allocation(h.a,h.a.getSettings(),h.now()).targets[0],0);checks++;
 }
 // Shared total Peak Guard remains stricter even when every phase has room.
 {
  const h=await scenario({peak:3000,values:[1000,1000,1000],old:[0]});
  assert.equal(h.calculate()[0].desiredCurrentA,0);assert.match(h.calculate()[0].reason,/Peak Guard/);checks++;
 }
 {
  const h=await scenario({peak:8000,values:[2666,2667,2667]}),{a}=h;h.calculate();
  const out=P.limit(a,[-6000],a.getSettings(),h.now());assert.equal(P.charge(out),1760,'reserve shared total Peak Guard capacity even with ample phase room');
  a.lastEmittedCommands=out;a.state.lastTotalCommandW=-1760;h.sample([1253,1253,1254],3760);
  assert.equal(h.calculate()[0].desiredCurrentA,6);checks++;
 }
 // Missing EV feedback, phase loss and stale readings cannot grant a start.
 for(const kind of ['ev_feedback','missing_phase','stale_phase']){
  const h=await scenario(),{a}=h;h.calculate();
  if(kind==='ev_feedback'){h.setNow(h.now()+61000);a.inputUpdatedAt.grid=h.now();P.ingest(a,{l1:100,l2:100,l3:100},h.now());}
  if(kind==='missing_phase')P.ingest(a,{l1:100,l3:100},h.now());
  if(kind==='stale_phase'){h.setNow(h.now()+16000);a.inputUpdatedAt.grid=h.now();}
  assert.equal(h.calculate()[0].desiredCurrentA,0);checks++;
 }
 // Failed battery writes never unlock a start; a successful zero can clear the
 // existing uncertainty lock, without treating it as a physical measurement.
 {
  const h=await scenario(),{a}=h;h.calculate();a.commandTrigger.trigger=async()=>{throw Error('battery write failed');};
  a.pendingResult={...h.result,candidateCommands:[-1860],candidateTotalCommandW:-1860};a.nextCommandAllowedAt=0;a.lastEmitAt=0;
  await assert.rejects(a.emitPending(),/battery write failed/);assert.equal(h.calculate()[0].desiredCurrentA,0);checks++;
 }
 // Failed EV starts release the preparation reservation and get feedback time.
 {
  const h=await scenario(),{a}=h;h.calculate();a.lastEmittedCommands=[-1860];a.state.lastTotalCommandW=-1860;h.sample([3120,3120,3120]);
  const d=h.calculate()[0];a.evCurrentTrigger.trigger=async()=>{throw Error('EV write failed');};
  await assert.rejects(a.publishEvDecision(d),/EV write failed/);
  assert.equal(E.allocation(a,a.getSettings(),h.now()).targets[0],0);checks++;
 }
 // Reservations are bounded, cancel with the session/override and never add
 // a periodic timer. Full capacity is available immediately after cancellation.
 for(const kind of ['timeout','cancel']){
  const h=await scenario(),{a}=h;h.calculate();
  if(kind==='timeout'){h.setNow(h.now()+61000);P.ingest(a,{l1:4500,l2:4500,l3:4500},h.now());h.calculate();assert.equal(E.allocation(a,a.getSettings(),h.now()).targets[0],0);}
  else {a.clearEvSessionOverrideFor(0);a.setSetting('evMode','smart');assert.equal(E.allocation(a,a.getSettings(),h.now()),null);}
  assert.deepEqual(P.limit(a,[-6000],a.getSettings(),h.now()),[-6000]);checks++;
 }
 // Recovery of an expired/failed preparation is possible on a later existing
 // evaluation; the cooldown cannot renew itself forever.
 {
  const h=await scenario(),{a}=h;h.calculate();h.setNow(h.now()+61000);
  await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});
  P.ingest(a,{l1:4500,l2:4500,l3:4500},h.now());h.calculate();
  h.setNow(h.now()+61000);await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});
  P.ingest(a,{l1:4500,l2:4500,l3:4500},h.now());h.calculate();
  assert.equal(E.allocation(a,a.getSettings(),h.now()).targets[0],6);checks++;
 }
 // A partial start failure must not donate its potentially applied power to a
 // second EV on the next phase packet.
 {
  const h=await scenario({evs:2}),{a}=h;h.calculate();a.lastEmittedCommands=[-1860];a.state.lastTotalCommandW=-1860;h.sample([3120,3120,3120]);
  a.evCurrentTrigger.trigger=async()=>{throw Error('uncertain start');};
  await assert.rejects(a.publishEvDecision(h.calculate()[0]),/uncertain start/);
  h.sample([3120,3120,3120]);assert.equal(h.calculate()[1].desiredCurrentA,0);checks++;
 }
 // An overload with an already-running minimum Emergency current is relieved
 // by the battery where possible; restored headroom has no artificial ramp.
 {
  const h=await scenario(),{a}=h;h.calculate();a.lastEmittedCommands=[-1860];a.state.lastTotalCommandW=-1860;
  await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:6});
  Object.assign(a,{lastPublishedEvCurrentA:6,lastPublishedEvAllowed:true,lastPublishedEvChargeMode:'standard'});
  h.sample([5000,4500,4500]);const d=h.calculate()[0];assert.equal(d.desiredCurrentA,6);
  const reduced=P.limit(a,[-6000],a.getSettings(),h.now());assert.deepEqual(reduced,[-360]);
  a.lastEmittedCommands=reduced;a.state.lastTotalCommandW=-360;h.sample([2000,2000,2000]);h.calculate();
  assert.deepEqual(P.limit(a,[-6000],a.getSettings(),h.now()),[-6000]);checks++;
 }
 // A later phase load appearing during asynchronous token output must prevent
 // the EV start, even though the earlier planning result allowed 6 A.
 {
  const h=await scenario(),{a}=h;h.calculate();a.lastEmittedCommands=[-1860];a.state.lastTotalCommandW=-1860;h.sample([3120,3120,3120]);
  const d=h.calculate()[0],events=[];
  a.tokens.set('emsevcurrent',{setValue:async()=>{P.ingest(a,{l1:4500,l2:3120,l3:3120},h.now());}});
  a.evCurrentTrigger.trigger=async t=>events.push(t.charge_current);
  await a.publishEvDecision(d);assert.deepEqual(events,[]);checks++;
 }
 // A phase sample inside a battery/Split publication cannot confirm the old
 // or the partially applied charging allocation and create fictitious credit.
 {
  const h=await scenario(),{a}=h;h.calculate();a.inFlightBatteryCommands=[-1860];
  h.sample([3120,3120,3120]);h.calculate();assert.deepEqual(P.capture(a,a.getSettings()).commands,[0]);
  a.lastEmittedCommands=[-1860];a.state.lastTotalCommandW=-1860;a.inFlightBatteryCommands=null;
  assert.deepEqual(P.limit(a,[-6000],a.getSettings(),h.now()),[0]);
  h.sample([3120,3120,3120]);h.calculate();assert.deepEqual(P.limit(a,[-6000],a.getSettings(),h.now()),[-1860]);checks++;
 }
 {
  const h=await scenario(),{a}=h;h.calculate();a.lastEmittedCommands=[-1860];a.state.lastTotalCommandW=-1860;
  h.sample([3120,3120,3120]);h.calculate();E.begin(a,0,a.getSettings(),6,h.now());
  h.sample([4500,4500,4500]);h.calculate();
  assert.equal(a.evPhaseRuntime.pending[0].current,6,'a new P1 packet cannot erase an in-flight EV increase');
  assert.deepEqual(P.limit(a,[-6000],a.getSettings(),h.now()),[0]);
  E.complete(a,0,a.getSettings(),6,false,h.now());assert.equal(a.evPhaseInFlight[0],undefined);checks++;
 }
 // Existing EV weights select which minimum start fits when two cannot fit.
 {
  const h=await scenario({evs:2}),{a}=h;await h.setExternalSetting('ev2Weight',3);h.calculate();
  const joint=E.allocation(a,a.getSettings(),h.now());assert.equal(joint.targets[0],0);assert.equal(joint.targets[1],6);checks++;
 }
 console.log(`Emergency phase coordination 1.2.31: ${checks} focused scenario groups passed.`);
}finally{restore();global.Date=NativeDate;Date.now=originalNow;}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
