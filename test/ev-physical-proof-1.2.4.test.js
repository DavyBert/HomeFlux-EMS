'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./ev-work-harness');
const {installVirtualClearTimeout}=require('./pv-source-harness');
const {resolveEvOutput}=require('../lib/ev-output-policy');
const root=path.resolve(__dirname,'..'),perAmp=Math.sqrt(3)*400,NativeDate=Date,oldNow=Date.now;
global.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[Date.now()]));}};
const restore=installVirtualClearTimeout(),results=[];
async function check(name,fn){const evidence=await fn();results.push({name,...evidence});console.log('PASS',name);}
function actual(h,i=0){const a=h.app,r=i?a.getExtraEv(i):null,type=a.getEvControlTypeFor(i),mode=i?r.lastPublishedChargeMode:a.lastPublishedEvChargeMode;
 if(!a.isEvOutputPermittedFor(i))return 0;
 if(type==='mode')return mode==='standard'?16:mode==='smart'?h.smartA:0;
 if(type==='hybrid'&&mode==='stop')return 0;
 return Math.max(0,Number(i?r.lastPublishedCurrentA:a.lastPublishedEvCurrentA)||0);}
async function make({type='mode',smartA=16,evs=1,tariff=true}={}){
 const h=await fixture({type,evs,connected:false,batteries:0,batteryEnabled:false,chargeAllowed:tariff,
  extra:{peakShaveEnabled:true,peakLimitW:15000,peakSoftMarginW:100,evIdleHouseLoadW:4000}}),a=h.app;
 h.smartA=smartA;h.tick=0;h.begin=h.now();h.type=type;h.evs=evs;
 for(let i=0;i<evs;i++)for(const [key,value]of Object.entries({ModeSmartCurrentA:smartA,ModeStandardCurrentA:16,PeakGuardStopHoldSeconds:180,CommandIntervalSeconds:7}))await h.setExternalSetting(a.getEvSettingKey(i,key),value);
 // The physical EV is disconnected for this already-required observation
 // window. The runtime will receive only one Mode 0A placeholder on connect.
 for(let s=1;s<=90;s++)await frame(h,{feedback:false});
 const contextRequest=a.requestContextEvaluate,fastRequest=a.requestEvaluate;
 a.requestContextEvaluate=()=>{};a.requestEvaluate=()=>{};
 for(let i=0;i<evs;i++)await h.cards.get(`set_ev${i+1}_status`).listener({connected:'yes',charge_current:0});
 a.requestContextEvaluate=contextRequest;a.requestEvaluate=fastRequest;
 // Preserve the deliberately stale reference until the real START publisher
 // chooses between it and the independent recent stopped-site measurements.
 a.evSessionDetection.portfolioBaselineW=4000;a.evBatteryHouseReferenceW=null;
 return h;
}
async function frame(h,{house=700,pv=0,battery=0,feedback=true,flowMode=null,order='pv_first',delayedA=null}={}){
 const a=h.app;h.tick++;h.setNow(h.begin+h.tick*1000);
 const amps=Array.from({length:h.evs},(_,i)=>i===0&&delayedA!==null?delayedA:actual(h,i));
 if(feedback)for(let i=0;i<h.evs;i++)if(a.getEvControlTypeFor(i)!=='mode'||flowMode!==null)await h.cards.get(`set_ev${i+1}_status`).listener({connected:'yes',charge_current:a.getEvControlTypeFor(i)==='mode'?flowMode:amps[i]});
 a.state.lastTotalCommandW=battery;
 const grid=house+amps.reduce((s,v)=>s+v*perAmp,0)-pv-battery;
 if(order==='grid_first'){await h.grid(grid);await h.pv(pv);}else{await h.pv(pv);await h.grid(grid);}
 a.runContextHeartbeat();await a.runEvHeartbeat();await h.flush();
 assert.deepEqual(h.errors,[]);return {grid,amps};
}
async function start(h,mode='emergency'){
 for(let i=0;i<h.evs;i++)h.app.setEvSessionOverrideFor(i,mode,'flow');await h.start();await h.flush();
 // Allow the existing command interval to publish the first START, never
 // bypassing a timer or manipulating a physical output in the test.
 for(let i=0;i<10&&!actual(h);i++)await frame(h);
}
(async()=>{try{
 for(const type of ['mode','current','hybrid'])for(const smartA of [6,16])for(const mode of ['smart','emergency'])await check(`${type} ${smartA}/16 A ${mode}: 13 minutes full 16A, no false STOP`,async()=>{
  const h=await make({type,smartA});await start(h,mode);assert.equal(actual(h),16);
  const reference=h.app.evSessionDetection.houseStartReference;
  if(type==='mode'){assert(!reference.houseReferenceFallback);assert.equal(reference.houseReferenceW,700);assert.equal(reference.housePreviousBaselineW,4000);}
  let stops=0;for(let s=0;s<780;s++){await frame(h);if(!actual(h))stops++;}
  assert.equal(stops,0);assert.equal(actual(h),16);assert(h.app.state.gridPowerW<14900);
  return {seconds:780,stopSamples:stops,finalA:actual(h),gridW:Math.round(h.app.state.gridPowerW)};
 });
 await check('Mode false/missing/large Flow amperes cannot change physical watts or teach a house reference',async()=>{
  const h=await make();await start(h);
  for(const feedback of [0,8,30]){await frame(h,{flowMode:feedback});assert(Math.abs(h.app.getEvCommandedPowerW(0)-16*perAmp)<1);}
  assert.equal(h.app.evBatteryHouseReferenceW,700);
  const ref=h.app.getEvStartHouseReference();assert(ref.houseReferenceFallback);assert.equal(ref.houseReferenceFallbackReason,'mode_house_unobserved');
 });
 for(const type of ['mode','current','hybrid'])await check(`${type}: Smart PV -> Emergency -> Smart, delayed physical reply and both meter orders`,async()=>{
  const h=await make({type,smartA:6,tariff:false});h.app.setEvSessionOverrideFor(0,'smart','flow');
  for(let s=0;s<20;s++)await frame(h,{pv:5200});assert.equal(actual(h),6);
  h.app.setEvSessionOverrideFor(0,'emergency','flow');for(let s=0;s<20;s++)await frame(h,{pv:5200});assert.equal(actual(h),16);
  h.app.setEvSessionOverrideFor(0,'smart','flow');
  for(let s=0;s<5;s++){await frame(h,{pv:5200,delayedA:16,order:s%2?'grid_first':'pv_first'});assert.equal(actual(h),6);}
  for(let s=0;s<10;s++){await frame(h,{pv:5200});assert.equal(actual(h),6);}
 });
 await check('Actual Peak Guard overload stops immediately; lower fallback fits when physically safe',async()=>{
  const h=await make({smartA:6});await start(h);await frame(h,{house:13000});assert.equal(actual(h),0);
  const last=h.app.getCompactDiagnostics().events.find(e=>e.kind==='ev_decision'&&e.outputRequest?.stopReason==='peak_guard'&&e.peakGuardAccounting?.gridPowerW>14900);
  assert(last,'Actual P1 peak must be diagnosed at the STOP decision');
  assert.equal(last.peakGuardAccounting.currentEvPowerW,Math.round(16*perAmp));assert(h.app.evPeakGuardStopHoldUntil>h.now());
 });
 await check('PV-only loss remains a valid non-Peak-Guard stop',async()=>{
  const h=await make({smartA:6,tariff:false});h.app.setEvSessionOverrideFor(0,'smart','flow');
  for(let s=0;s<20;s++)await frame(h,{pv:5200});assert.equal(actual(h),6);
  for(let s=0;s<3;s++)await frame(h,{pv:0});assert.equal(actual(h),0);assert(h.app.state.gridPowerW<14900);
 });
 await check('Mode STOP tail uses previous P1 observation, never Flow amperes or restart credit',async()=>{
  const h=await make();await start(h);for(let s=0;s<10;s++)await frame(h);
  await h.cards.get('end_ev1_charging_session').listener({});await h.flush();assert.equal(actual(h),0);
  for(const value of [0,30]){
   await frame(h,{delayedA:16,flowMode:value});assert.equal(actual(h),0);
   const status=h.app.getEvGridImportControlStatus();
   assert(status.activeTargetW>10000);assert(status.activeTargetW<=16*perAmp+1);
   assert.equal(status.confirmedEvPowerW,0);assert.equal(h.app.getEvCommandedPowerW(0),0);
  }
  await frame(h,{delayedA:0,flowMode:30});assert.equal(h.app.getEvGridImportControlStatus().activeTargetW,0);
 });
 await check('Two Mode EVs share one P1 pool; grid, PV and signed battery never create duplicate credit',async()=>{
  const h=await make({evs:2,smartA:6});await start(h);
  for(let s=0;s<25;s++)await frame(h);
  const sum=[0,1].reduce((n,i)=>n+h.app.getEvCommandedPowerW(i),0);
  assert(sum<=h.app.evSessionDetection.modePowerSnapshot.totalW+.01);
  assert(h.app.state.gridPowerW<=14900+1);
  // A single-EV observation proves signed battery/PV reconstruction with a
  // deliberately fixed current physical load, not an inferred new command.
  const one=await make();await start(one);
  for(const battery of [-1000,2000]){await frame(one,{pv:3807,battery,delayedA:16});assert(Math.abs(one.app.getEvCommandedPowerW(0)-16*perAmp)<1);}
 });
 await check('All slots use one output policy; explicit policy stops and restart holds retain their authority',async()=>{
  const h=await make({evs:4}),a=h.app;
  const settings={...a.getEvInstanceSettings(0),evEnabled:true,evControlType:'mode'};
  const d={connected:true,allowed:true,desiredCurrentA:16,effectiveChargeMode:'standard'};
  for(const i of [0,1,2,3])assert.equal(a.getEvOutputFor(i,d,settings).mode,'standard');
  for(const patch of [{connected:false},{allowed:false},{allowed:false,targetCompleted:'energy_target'}])assert.equal(a.getEvOutputFor(0,{...d,...patch},settings).mode,'stop');
  assert.equal(resolveEvOutput({decision:d,settings,now:100,holdUntil:200}).stopReason,'restart_hold');
  assert.equal(resolveEvOutput({decision:{...d,allowed:false,peakLimited:true},settings:{...settings,peakShaveEnabled:true,peakLimitW:15000,peakSoftMarginW:100},gridW:700}).stopReason,'insufficient_safe_budget');
 });
 await check('Unknown active Mode house data cannot turn its own inferred EV delta into fresh baseline evidence',async()=>{
  const h=await make();await start(h);h.app.evSessionDetection.portfolioBaselineW=4000;
  for(let s=0;s<10;s++)await frame(h);
  const r=h.app.getEvStartHouseReference();assert(r.houseReferenceFallback);assert.equal(r.houseReferenceFallbackReason,'mode_house_unobserved');
 });
 fs.writeFileSync(path.join(root,'validation/ev-physical-proof-1.2.4.json'),JSON.stringify({simulatedHomey:true,physicalHardwareTested:false,passed:results.length,results},null,2)+'\n');
 console.log('Physical EV proof:',results.length,'groups passed');
}finally{restore();global.Date=NativeDate;Date.now=oldNow;}})().catch(e=>{console.error('FAILED after',results.length,results.at(-1),e);process.exitCode=1;});
