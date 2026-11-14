'use strict';
const assert=require('node:assert/strict');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const I=require('../lib/active-injection'),H=require('../lib/hvac-permanent');
const restore=installVirtualClearTimeout(),originalNow=Date.now;
let checks=0;
const stem=i=>'hvac'+(i?i+1:'');
async function fixture(units,extra={}) {
 const settings={injectionEnabled:true,injectionLimitOptionalLoads:true,fixedImportPrice:1,
  exportLimitEnabled:false,peakShaveEnabled:false,hvacCount:Math.max(...units.map(x=>x.index))+1,...extra};
 for(const unit of units)for(const [key,value]of Object.entries({Enabled:true,AutomaticControlEnabled:true,
  PermanentEnabled:true,TariffEnabled:true,PvEnabled:true,UsePvSurplus:true,Direction:'heat',Priority:'pv',
  ComfortMinC:21,ComfortMaxC:24,CheapTargetC:21,NormalTargetC:21,ExpensiveTargetC:21,PvTargetC:25,
  EnergyDeviationC:2,MinBatterySoc:20,AllowPowerControl:true,AllowSetpointControl:true,AllowModeControl:true,...unit.settings}))settings[stem(unit.index)+key]=value;
 const h=await setup(undefined,settings,undefined,0),a=h.app;
 await h.drain();a.requestContextEvaluate=()=>{};a.requestEvaluate=()=>{};
 a.state.gridPowerW=-6000;a.state.pvPowerW=8000;a.inputUpdatedAt.grid=h.now();a.inputUpdatedAt.pv=h.now();
 a.flexiblePriorityState.nextEvaluationAt=0;
 h.events=[];
 for(const kind of ['power','mode','setpoint'])h.cards.get('hvac_'+kind+'_updated_for_configured').trigger=async(t,s)=>h.events.push({kind,index:s.hvac-1,...t});
 return h;
}
function prime(h,index,{room=21.5,target=21,mode='heat',off=false,legacy=false,previousMode=mode}={}) {
 const a=h.app,r=index?a.getExtraHvac(index):null,input=index?r.state:a.state;
 if(index){Object.assign(input,{roomTemperatureC:room,setpointC:target,mode:off?'off':mode});Object.assign(r.seen,{roomTemperature:true,setpoint:true,mode:true});Object.assign(r.updatedAt,{roomTemperature:h.now(),mode:h.now()});Object.assign(r,{lastPublishedSetpoint:target,lastPublishedMode:previousMode,lastPublishedPower:!off,baselineSetpoint:legacy?(mode==='heat'?21:24):null,baselineMode:'off',boostMode:legacy?mode:null,managedPowerOn:legacy&&!off,lastControlAt:0});}
 else{Object.assign(input,{hvacRoomTemperatureC:room,hvacSetpointC:target,hvacMode:off?'off':mode});Object.assign(a.inputSeen.hvac,{roomTemperature:true,setpoint:true,mode:true});Object.assign(a.inputUpdatedAt.hvac,{roomTemperature:h.now(),mode:h.now()});Object.assign(a,{lastPublishedHvacSetpoint:target,lastPublishedHvacMode:previousMode,lastPublishedHvacPower:!off,hvacBaselineSetpoint:legacy?(mode==='heat'?21:24):null,hvacBaselineMode:'off',hvacBoostMode:legacy?mode:null,hvacManagedPowerOn:legacy&&!off,lastHvacControlAt:0});}
 Object.assign(H.unit(a,index),{heat:1000,cool:1000,heatReview:false,coolReview:false,mode:previousMode,setpoint:target,powerOff:off,nextAt:0});
}
function feedbackOff(h,index) {
 h.setNow(h.now()+1000);const a=h.app;
 if(index){a.getExtraHvac(index).state.mode='off';a.getExtraHvac(index).updatedAt.mode=h.now();}
 else{a.state.hvacMode='off';a.inputUpdatedAt.hvac.mode=h.now();}
 a.state.gridPowerW-=1000;a.inputUpdatedAt.grid=h.now();
}
async function run() {
 // Real PV can otherwise re-admit an old boost after its OFF feedback. Exercise
 // all physical channels and both directions through the complete load pass.
 for(const mode of ['heat','cool'])for(let index=0;index<10;index++) {
  const h=await fixture([{index,settings:{PermanentEnabled:false,Direction:mode}}]),a=h.app;
  a.state.gridPowerW=-3000;a.state.pvPowerW=5000;
  prime(h,index,{room:mode==='heat'?21.5:23.5,target:mode==='heat'?23:22,mode,legacy:true});
  await I.start(a);await a.publishFlexibleLoads(a.latestResult,0,0);
  assert(h.events.some(e=>e.index===index&&e.kind==='power'&&e.state_value===0));
  feedbackOff(h,index);await a.publishFlexibleLoads(a.latestResult,0,0);
  assert(!h.events.some(e=>e.index===index&&e.kind==='power'&&e.state_value===1));
  assert.equal(index?a.getExtraHvac(index).boostMode:a.hvacBoostMode,null,'release boost only after acknowledged OFF');
  checks++;
 }
 // Negative control: a meter export produced only by battery discharge does
 // not become a new HVAC opportunity after the optional boost was stopped.
 {
  const h=await fixture([{index:0,settings:{PermanentEnabled:false}}]),a=h.app;
  a.state.gridPowerW=-3000;a.state.pvPowerW=0;
  prime(h,0,{room:21.5,target:23,legacy:true});await I.start(a);
  a.state.lastTotalCommandW=3600;a.lastEmittedCommands=[900,900,900,900];
  await a.publishFlexibleLoads(a.latestResult,3600,3600);feedbackOff(h,0);
  await a.publishFlexibleLoads(a.latestResult,3600,3600);
  assert(!h.events.some(e=>e.kind==='power'&&e.state_value===1));checks++;
 }
 // Optional limits never add a stop for protected loads or stale room data,
 // and never cut short the existing minimum control interval.
 for(const protection of ['EssentialEnabled','KeepOnEnabled','stale','interval','no_power']) {
  const h=await fixture([{index:0,settings:{PermanentEnabled:false}}]),a=h.app;
  prime(h,0,{room:21.5,target:23,legacy:true});
  if(protection==='EssentialEnabled'||protection==='KeepOnEnabled')a.setSetting('hvacCoordination',a.getSettings().hvacCoordination.map((c,i)=>i?c:{...c,[protection]:true}));
  if(protection==='stale')a.inputUpdatedAt.hvac.roomTemperature=h.now()-300001;
  if(protection==='interval')H.unit(a,0).controlChangedAt=h.now()-30000;
  if(protection==='no_power')a.setSetting('hvacAllowPowerControl',false);
  await I.start(a);await a.publishFlexibleLoads(a.latestResult,0,0);
  assert(!h.events.some(e=>e.kind==='power'&&e.state_value===0),protection);checks++;
 }
 // A queued PV preview must be dropped when a preceding awaited publication
 // activates injection; ordinary comfort, essential and keep-on remain valid.
 for(const second of ['optional','essential','keepOn','comfort']) {
  const h=await fixture([{index:0},{index:1,settings:second==='comfort'?{PvEnabled:false}:{}}]),a=h.app;
  prime(h,0);prime(h,1,{room:second==='comfort'?18:21.5,target:second==='comfort'?20:21});
  if(second==='essential'||second==='keepOn')a.setSetting('hvacCoordination',a.getSettings().hvacCoordination.map((c,i)=>i===1?{...c,[second==='essential'?'EssentialEnabled':'KeepOnEnabled']:true}:c));
  let activated=false;
  h.cards.get('hvac_setpoint_updated_for_configured').trigger=async(t,s)=>{
   h.events.push({kind:'setpoint',index:s.hvac-1,setpoint:t.setpoint,active:a.injectionRuntime.active});
   if(!activated){activated=true;await I.start(a);}
  };
  await a.publishFlexibleLoads(a.latestResult,0,0);
  const secondOutputs=h.events.filter(e=>e.index===1);
  if(second==='optional'){assert.equal(secondOutputs.length,0);assert.equal(H.unit(a,1).setpoint,21);}
  else assert(secondOutputs.some(e=>e.kind==='setpoint'&&e.setpoint===(second==='comfort'?21:25)),second);
  checks++;
 }
 // Recheck between power/mode/setpoint components of one publication. A
 // received ON may be committed; the unsent PV setpoint must never be recorded.
 for(const index of [0,9])for(const change of ['activate','enable_optional']) {
  const h=await fixture([{index}],change==='enable_optional'?{injectionLimitOptionalLoads:false}:{}),a=h.app;
  prime(h,index,{off:true,previousMode:'cool'});
  if(change==='enable_optional')await I.start(a);
  h.cards.get('hvac_power_updated_for_configured').trigger=async(t,s)=>{
   h.events.push({kind:'power',index:s.hvac-1,...t});
   if(t.state_value===1){if(change==='activate')await I.start(a);else a.setSetting('injectionLimitOptionalLoads',true);}
  };
  await a.publishFlexibleLoads(a.latestResult,0,0);
  assert(h.events.some(e=>e.kind==='power'&&e.state_value===1));
  assert(!h.events.some(e=>e.kind==='mode'||e.kind==='setpoint'));
  assert.equal(H.unit(a,index).setpoint,21);assert.equal(H.unit(a,index).powerOff,false);
  checks++;
 }
 // A new session, disabling optional limits, or stale temperature invalidates
 // an old injection-only OFF while retaining explicit user OFF commands.
 for(const change of ['new_session','disable_optional','stale_room']) {
  const h=await fixture([{index:0}]),a=h.app;prime(h,0,{target:25});
  await I.start(a);const old=a.calculateHvacControlFor(0,a.latestResult,null,0,0,{allowStart:true});assert.equal(old.powerCommand,false);
  if(change==='new_session'){I.stop(a);await h.drain();await I.start(a);}
  if(change==='disable_optional')a.setSetting('injectionLimitOptionalLoads',false);
  if(change==='stale_room'){h.setNow(h.now()+300001);a.inputUpdatedAt.grid=h.now();}
  const before=h.events.length;await a.publishHvacDecisionFor(0,old);
  assert.equal(h.events.length,before,change);checks++;
 }
 // Necessary legacy comfort continues only towards the ordinary target; no
 // extra half-degree PV target may be added during injection.
 for(const mode of ['heat','cool']) {
  const h=await fixture([{index:0,settings:{PermanentEnabled:false,Direction:mode}}]),a=h.app;
  prime(h,0,{room:mode==='heat'?18:28,target:mode==='heat'?20:25,mode,legacy:true});
  await I.start(a);await a.publishFlexibleLoads(a.latestResult,0,0);
  assert(!h.events.some(e=>e.kind==='power'&&e.state_value===0));
  const targets=h.events.filter(e=>e.kind==='setpoint').map(e=>e.setpoint);
  assert(targets.length>0);assert(targets.every(t=>mode==='heat'?t<=21:t>=24));checks++;
 }
 console.log('Injection HVAC publication 1.3.1:',checks,'scenario groups passed');
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{restore();Date.now=originalNow;});
