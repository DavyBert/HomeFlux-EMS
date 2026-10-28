'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const {recordMinuteSample}=require('../lib/ev-session');
const {findCurrentTariff}=require('../lib/ems-engine');
const {powerPerAmp}=require('../settings/ev-headroom');
const recent=require('../lib/ev-house-reference');
const NativeDate=Date,originalNow=Date.now,restore=installVirtualClearTimeout();
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const results=[],near=(a,b)=>assert(Math.abs(a-b)<.01,`${a} != ${b}`);
async function fixture({count=1,type='mode',recordingOnly=true,root=path.join(__dirname,'..')}={}){
 const extra={};for(let i=1;i<count;i++)for(const[k,v]of Object.entries({Enabled:true,SocEnabled:false,Mode:'emergency',
  ControlType:type,Phases:3,Voltage:380,VoltageReference:'line',ModeSmartCurrentA:6,ModeStandardCurrentA:10,
  MinCurrentA:6,MaxCurrentA:24,StandardCurrentA:6,PeakGuardStopHoldSeconds:0,CommandIntervalSeconds:7}))extra[`ev${i+1}${k}`]=v;
 const begin=NativeDate.parse('2026-10-27T12:00:00Z');
 const h=await setup(root,{batteryCount:1,controlEnabled:false,evCount:count,evEnabled:true,evSocEnabled:false,
  evControlType:type,evMode:'emergency',evPhases:3,evVoltage:380,evVoltageReference:'line',
  evModeStandardCurrentA:10,evModeSmartCurrentA:6,evMaxCurrentA:24,evStandardCurrentA:6,
  evIdleHouseLoadW:4000,evCommandIntervalSeconds:7,evPeakGuardStopHoldSeconds:0,
  evPeakGuardBatteryAssistEmergency:false,evNightSurplusChargeEnabled:false,
  peakShaveEnabled:true,peakLimitW:17500,peakSoftMarginW:100,exportLimitEnabled:false,
  contractType:'fixed',evFixedChargeWindowEnabled:true,fixedChargeWindowStart:'00:00',fixedChargeWindowEnd:'00:00',...extra},begin,3073);
 const a=h.app;a.requestContextEvaluate=()=>{};
 // Recording fixtures isolate pre-existing background output scheduling; the
 // explicit START publisher/allocator and the P1/EV Flow listeners stay real.
 if(recordingOnly)a.requestEvaluate=()=>{};
 for(let m=1;m<=40;m++)recordMinuteSample(a.evSessionDetection.houseHistory,12782,begin-m*60000);
 for(let i=0;i<count;i++){
  if(i===0){a.lastPublishedEvChargeMode='stop';a.lastPublishedEvAllowed=false;a.lastEvPublishedAt=0;}
  else Object.assign(a.getExtraEv(i),{lastPublishedChargeMode:'stop',lastPublishedAllowed:false,lastPublishedAt:0});
  await h.cards.get(`set_ev${i+1}_status`).listener({connected:'yes',charge_current:0});
 }
 await h.drain();
 const perAmp=powerPerAmp(3,380,'line');
 async function frame(second,{house=4670,evs=Array(count).fill(0),pv=3073,battery=-100,feedback=true,pvFeedback=true}={}){
  h.setNow(begin+second*1000);a.state.lastTotalCommandW=battery;
  if(feedback)for(let i=0;i<count;i++)await h.cards.get(`set_ev${i+1}_status`).listener({connected:'yes',charge_current:evs[i]/perAmp});
  if(pvFeedback)await h.pv(pv);
  await h.grid(house+evs.reduce((s,x)=>s+x,0)-pv-battery);
 }
 function active(i,on=true){
  const settings=a.getSettings(),tariff=findCurrentTariff(new Date(),settings);
  const decision=a.calculateEvPortfolioDecisions({tariff},a.state.lastTotalCommandW,a.state.lastTotalCommandW,settings)[i];
  if(i===0)a.latestEvDecision=decision;else a.getExtraEv(i).latestDecision=decision;
  if(i===0){a.lastPublishedEvChargeMode=on?'standard':'stop';a.lastPublishedEvAllowed=on;}
  else Object.assign(a.getExtraEv(i),{lastPublishedChargeMode:on?'standard':'stop',lastPublishedAllowed:on});}
 async function start(i=0){
  const settings=a.getSettings(),tariff=findCurrentTariff(new Date(),settings);
  const d=a.calculateEvPortfolioDecisions({tariff},a.state.lastTotalCommandW,a.state.lastTotalCommandW,settings)[i];
  if(i===0)a.latestEvDecision=d;else a.getExtraEv(i).latestDecision=d;
  if(i===0)await a.publishEvDecision(d);else await a.publishAdditionalEvDecision(i,d);
  return d;
 }
 return{...h,a,begin,frame,active,start,perAmp};
}
async function check(name,fn){await fn();results.push(name);}
(async()=>{try{
 await check('Reproduced frozen 12782 W; reliable stopped 60-second window selects 4670 W and clears only stale house hold',async()=>{
  const h=await fixture({recordingOnly:false}),a=h.a;near(a.evSessionDetection.portfolioBaselineW,12782);
  for(let s=1;s<=65;s++)await h.frame(s);
  const plans=JSON.stringify([a.evSocPlans,a.evEnergyPlans]);
  a.evSessionDetection.gridReleaseBlocked=true;
  await h.start();const ref=a.evSessionDetection.houseStartReference;
  assert.equal(ref.houseReferenceSource,'recent_60s');near(ref.houseReferenceW,4670);near(ref.housePreviousBaselineW,12782);
  assert.equal(ref.houseRecentCoverageSeconds,60);assert(ref.houseRecentSampleCount>=6);assert(!ref.houseReferenceFallback);
  assert(!ref.houseLoadHold);assert.notEqual(a.getEvSessionDetectionRuntime(0).state,'charging');
  assert.equal(JSON.stringify([a.evSocPlans,a.evEnergyPlans]),plans);
  assert(a.getCompactDiagnostics().events.some(e=>e.houseReference?.houseReferenceSource==='recent_60s'));
 });
 await check('Mode-only resumed EV is recognised with zero-A placeholder; existing two-sample/five-second confirmation and correct Peak Guard add-back survive',async()=>{
  const h=await fixture({recordingOnly:false}),a=h.a;
  for(let s=1;s<=65;s++)await h.frame(s,{battery:-6000});
  await h.start();
  for(let s=66;s<=72;s++)await h.frame(s,{evs:[10*h.perAmp],battery:-6000,feedback:false});
  const d=await h.start();assert.equal(d.desiredCurrentA,10);assert.equal(a.getEvSessionDetectionRuntime(0).state,'charging');
  assert(d.peakGuardAccounting.currentEvPowerW>6580);assert(d.peakGuardAccounting.peakBudgetW>=d.desiredPowerW-1);
  assert.equal(a.getEvGridImportControlStatus().houseLoadHold,false);
 });
 await check('Active Mode Flow amperes cannot independently establish its house reference',async()=>{
  const h=await fixture();h.active(0);
  for(let s=0;s<=65;s++)await h.frame(s,{house:5000,evs:[7000]});
  const r=h.a.getEvStartHouseReference();assert(r.houseReferenceFallback);assert.equal(r.houseReferenceFallbackReason,'mode_house_unobserved');near(h.a.evSessionDetection.portfolioBaselineW,12782);
 });
 await check('Irregular P1 sampling uses elapsed-time weighting instead of averaging sample values',async()=>{
  const h=await fixture();
  for(const s of [0,1,2,3,4,5,10,20,30,40,50,60])await h.frame(s,{house:s<30?2000:6000});
  const r=h.a.getEvStartHouseReference();assert(!r.houseReferenceFallback,JSON.stringify(r));near(r.houseRecentAverageW,4000);
 });
 await check('Two active Mode EVs cannot manufacture a new independent house reference',async()=>{
  const h=await fixture({count:2});h.active(0);h.active(1);
  for(let s=0;s<=65;s++)await h.frame(s,{house:5000,evs:[3000,4000]});
  assert(h.a.getEvStartHouseReference().houseReferenceFallback);
  h.active(1,false);
  for(let s=66;s<=131;s++)await h.frame(s,{house:5000,evs:[3000,0]});
  await h.start(1);assert(h.a.evSessionDetection.houseStartReference.houseReferenceFallback);near(h.a.evSessionDetection.portfolioBaselineW,12782);
 });
 await check('STOP rejects delayed old positive EV feedback; fresh zero then a full quiet window permits a new reference',async()=>{
  const h=await fixture();h.active(0);
  for(let s=0;s<=65;s++)await h.frame(s,{house:5000,evs:[7000]});
  h.active(0,false);h.a.lastEvPublishedAt=h.now();
  for(let s=66;s<=75;s++)await h.frame(s,{house:5400,feedback:false});
  assert(h.a.getEvStartHouseReference().houseReferenceFallback);
  for(let s=76;s<=141;s++)await h.frame(s,{house:5400});
  await h.start();near(h.a.evSessionDetection.portfolioBaselineW,5400);
 });
 await check('Delayed Mode Flow feedback cannot reduce the recent household estimate',async()=>{
  const h=await fixture();h.active(0);await h.frame(0,{house:5000,evs:[7000]});
  for(let s=1;s<=60;s++)await h.frame(s,{house:5000,evs:[7000],feedback:false});
  const r=h.a.getEvStartHouseReference();assert(r.houseReferenceFallback);assert.equal(r.houseReferenceFallbackReason,'mode_house_unobserved');
  near(h.a.evSessionDetection.portfolioBaselineW,12782);
 });
 await check('A single snapshot, too few points, missing time coverage and a P1 gap all preserve fallback',async()=>{
  const h=await fixture();await h.frame(0);assert(h.a.getEvStartHouseReference().houseReferenceFallback);
  for(let s=1;s<=10;s++)await h.frame(s);assert.equal(h.a.getEvStartHouseReference().houseReferenceFallbackReason,'insufficient_coverage');
  for(let s=30;s<=80;s++)await h.frame(s);assert.equal(h.a.getEvStartHouseReference().houseReferenceFallbackReason,'p1_gap');
  h.setNow(h.now()+6000);assert.equal(h.a.getEvStartHouseReference().houseReferenceFallbackReason,'p1_stale');
 });
 await check('PV changes are included once in physical site power and never added to Peak Guard headroom again',async()=>{
  const h=await fixture();
  for(let s=0;s<=65;s++)await h.frame(s,{house:5000,evs:[0],pv:s%2?8000:0});
  near(h.a.getEvStartHouseReference().houseRecentAverageW,5000);
  const d=await h.start();assert(d.peakGuardAccounting.peakBudgetW<=17400-d.peakGuardAccounting.gridPowerW+d.peakGuardAccounting.currentEvPowerW+1);
 });
 await check('Charging/discharging battery commands reconstruct one non-EV household load with correct signs',async()=>{
  const h=await fixture();
  for(let s=0;s<=65;s++)await h.frame(s,{house:5000,evs:[0],battery:s%2?2000:-2000});
  const r=h.a.getEvStartHouseReference();assert(!r.houseReferenceFallback,JSON.stringify(r));near(r.houseRecentAverageW,5000);
 });
 await check('Missing/stale PV, unknown EV connection and physically inconsistent EV power force fallback',async()=>{
  const h=await fixture();for(let s=0;s<=65;s++)await h.frame(s);
  h.a.inputSeen.pv=false;assert(h.a.getEvStartHouseReference().houseReferenceFallback);h.a.inputSeen.pv=true;
  for(let s=66;s<=130;s++)await h.frame(s,{pvFeedback:false});assert(h.a.getEvStartHouseReference().houseReferenceFallback);
  h.a.inputSeen.ev.connected=false;await h.frame(131,{feedback:false});assert(h.a.getEvStartHouseReference().houseReferenceFallback);
  h.a.inputSeen.ev.connected=true;h.active(0);h.a.state.gridPowerW=0;h.a.state.pvPowerW=0;h.a.state.lastTotalCommandW=0;
  h.a.state.evChargeCurrentA=20;h.a.inputUpdatedAt.ev.chargeCurrent=h.now();
  h.a.recordRecentEvHouseLoadSample(0,h.now()+1000,h.a.getSettings());assert(h.a.getEvStartHouseReference(h.now()+1000).houseReferenceFallback);
 });
 await check('A brief missing-PV interval remains uncertain after recovery instead of manufacturing covered time',async()=>{
  const h=await fixture();for(let second=0;second<=65;second++)await h.frame(second);
  for(let second=66;second<=70;second++){
   h.setNow(h.begin+second*1000);h.a.inputSeen.pv=false;
   await h.grid(4670-3073+100);
  }
  await h.frame(71);
  const reference=h.a.getEvStartHouseReference();assert(reference.houseReferenceFallback);
  assert.equal(reference.houseReferenceFallbackReason,'site_unknown');assert(reference.houseRecentCoverageSeconds<60);
 });
 await check('Configuration changes and slow/failed START publication never apply a stale candidate',async()=>{
  const h=await fixture();for(let s=0;s<=65;s++)await h.frame(s);
  let candidate=h.a.getEvStartHouseReference();assert(!candidate.houseReferenceFallback);
  h.a.evPhysicalConfigRevision++;let r=h.a.applyEvStartHouseReference(0,candidate);assert(r.houseReferenceFallback);near(r.houseReferenceW,12782);
  h.a.evPhysicalConfigRevision--;candidate=h.a.getEvStartHouseReference();r=h.a.applyEvStartHouseReference(0,candidate,h.now()+6000);assert(r.houseReferenceFallback);near(h.a.evSessionDetection.portfolioBaselineW,12782);
  h.a.evModeTrigger.trigger=async()=>{throw Error('simulated Flow failure');};await assert.rejects(h.start(),/simulated Flow failure/);
  near(h.a.evSessionDetection.portfolioBaselineW,12782);
 });
 await check('Peak Guard, stop hold and command interval still veto START before any reference is applied',async()=>{
  const h=await fixture();for(let s=0;s<=65;s++)await h.frame(s);
  h.a.state.gridPowerW=17400;const d=await h.start();assert.equal(d.allowed,false);assert.equal(h.a.lastPublishedEvChargeMode,'stop');near(h.a.evSessionDetection.portfolioBaselineW,12782);
  await h.frame(66);h.a.evPeakGuardStopHoldUntil=h.now()+180000;await h.start();near(h.a.evSessionDetection.portfolioBaselineW,12782);
  h.a.evPeakGuardStopHoldUntil=0;h.a.lastEvPublishedAt=h.now();await h.start();near(h.a.evSessionDetection.portfolioBaselineW,12782);
 });
 await check('Reconnect uses new quiet measurements without subtracting old EV current; long-term fallback still uses existing configured idle only when history is absent',async()=>{
  const h=await fixture();h.active(0);for(let s=0;s<=65;s++)await h.frame(s,{house:5000,evs:[7000]});
  await h.cards.get('set_ev1_status').listener({connected:'no',charge_current:20});h.active(0,false);
  for(let s=66;s<=131;s++){
   h.setNow(h.begin+s*1000);h.a.state.lastTotalCommandW=-100;await h.pv(3073);await h.grid(5400-3073+100);
  }
  near(h.a.getEvStartHouseReference().houseRecentAverageW,5400);
  await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});await h.start();near(h.a.evSessionDetection.portfolioBaselineW,5400);
  h.a.evSessionDetection.houseHistory=[];near(h.a.getLearnedEvHouseBaselineW(),4000);
 });
 await check('Smart operating mode with Mode control uses the same STOP-to-START recent reference',async()=>{
  const h=await fixture();h.a.setSetting('evMode','smart');h.a.setSetting('evFixedMaxGridImportW',20000);
  h.a.setSetting('evGuaranteeTarget',false);
  for(let second=0;second<=65;second++)await h.frame(second);
  const decision=await h.start();assert(decision.allowed);assert(['smart','standard'].includes(h.a.lastPublishedEvChargeMode));
  near(h.a.evSessionDetection.portfolioBaselineW,4670);
 });
 await check('A paused vehicle with an active mode output and zero feedback uses fallback, not an invented EV-free household',async()=>{
  const h=await fixture();h.active(0);
  for(let second=0;second<=65;second++)await h.frame(second,{house:5000,evs:[7000]});
  for(let second=66;second<=131;second++)await h.frame(second,{house:5000,evs:[0]});
  const reference=h.a.getEvStartHouseReference();assert(reference.houseReferenceFallback);
  assert.equal(reference.houseReferenceFallbackReason,'mode_house_unobserved');near(h.a.evSessionDetection.portfolioBaselineW,12782);
 });
 await check('Mixed Mode-stopped plus Current/Hybrid: both independently reported EV powers are excluded from the recent house reference',async()=>{
  const h=await fixture({count:3});
  await h.setExternalSetting('ev2ControlType','current');await h.setExternalSetting('ev3ControlType','hybrid');
  for(const i of [1,2]){h.active(i);h.a.getExtraEv(i).lastPublishedCurrentA=10;}
  for(let second=0;second<=65;second++)await h.frame(second,{house:5000,evs:[0,3000,4000]});
  const r=h.a.getEvStartHouseReference();assert(!r.houseReferenceFallback,JSON.stringify(r));near(r.houseRecentAverageW,5000);
  await h.start(0);near(h.a.evSessionDetection.houseStartReference.houseReferenceW,5000);
 });
 await check('Current/Hybrid-only installations allocate no new buffer and do not rebase their existing reference',async()=>{
  for(const type of ['current','hybrid']){const h=await fixture({type});for(let s=0;s<=65;s++)await h.frame(s);await h.start();
   assert.equal(h.a.evSessionDetection.recentHouseSamples,undefined);near(h.a.evSessionDetection.portfolioBaselineW,12782);}
 });
 await check('Duplicate/high-rate samples cannot manufacture coverage; history remains bounded to 64 points',()=>{
  const owner={};for(let i=0;i<100;i++)recent.record(owner,100000,5000);assert(recent.read(owner,100000).fallbackReason);
  for(let i=1;i<10000;i++)recent.record(owner,100000+i*1000,5000);
  assert.equal(owner.recentHouseSamples.length,64);const r=recent.read(owner,100000+9999*1000);assert(r.usable);near(r.averageW,5000);
 });
 fs.writeFileSync(path.join(__dirname,'../validation/ev-house-reference-1.2.4.json'),JSON.stringify({passed:results.length,cases:results,
  productionFunctions:true,simulatedHomey:true,nativeHomeyTested:false},null,2)+'\n');
 console.log('EV recent household reference:',results.length,'cases passed');
}finally{restore();global.Date=NativeDate;Date.now=originalNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
