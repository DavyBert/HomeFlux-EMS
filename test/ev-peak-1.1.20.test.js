'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,ROOT}=require('./ev-work-harness');
const {installVirtualClearTimeout}=require('./pv-source-harness');
const NativeDate=Date;global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const restore=installVirtualClearTimeout(),PER_AMP=Math.sqrt(3)*400;
const results=[];
function output(a,index=0){
 const r=index?a.getExtraEv(index):null,type=a.getEvControlTypeFor(index);
 if(type==='mode'){const mode=index?r.lastPublishedChargeMode:a.lastPublishedEvChargeMode;return mode==='standard'?16:mode==='smart'?6:0;}
 return index?r.lastPublishedCurrentA||0:a.lastPublishedEvCurrentA||0;
}
async function setup({root=ROOT,type='mode',evs=1,baseline=4000,batteryEnabled=false}={}){
 const h=await fixture({root,type,evs,batteries:1,batteryEnabled,extra:{hybridEmsEnabled:true,peakShaveEnabled:true,
  peakLimitW:15000,peakSoftMarginW:100,evIdleHouseLoadW:baseline}}),a=h.app;
 for(let index=0;index<evs;index++){
  await h.setExternalSetting(index?'ev'+(index+1)+'PeakGuardStopHoldSeconds':'evPeakGuardStopHoldSeconds',300);
  a.setEvSessionOverrideFor(index,'emergency','flow');
 }
 await h.start();await h.flush();return h;
}
async function replay({root=ROOT,type='mode',seconds=660,baseline=4000,houseW=700,feedback='fresh',actualA=null,evs=1,batteryEnabled=false}={}){
 const h=await setup({root,type,baseline,evs,batteryEnabled}),a=h.app,begin=h.now();
 const events=[];let old=Array.from({length:evs},(_,i)=>output(a,i));
 const cpu=process.cpuUsage();
 for(let second=1;second<=seconds;second++){
  h.setNow(begin+second*1000);const amps=Array.from({length:evs},(_,i)=>output(a,i)>0?(actualA??output(a,i)):0);
  for(let i=0;i<evs;i++)if(feedback!=='stale'||second===1){
   await h.cards.get('set_ev_status_for_configured').listener({ev:{id:String(i+1),kind:'ev',name:'EV '+(i+1)},
    connected:'yes',charge_current:feedback==='zero'?0:amps[i]});
  }
  await h.pv(0);await h.grid(houseW+amps.reduce((sum,amp)=>sum+amp*PER_AMP,0));
  a.runContextHeartbeat();await a.runEvHeartbeat();await h.flush();
  for(let i=0;i<evs;i++){
   const next=output(a,i),decision=i?a.getExtraEv(i).latestDecision:a.latestEvDecision;
   if((next>0)!==(old[i]>0))events.push({second,ev:i+1,on:next>0,amps:next,gridPowerW:a.state.gridPowerW,
     measuredFresh:a.getEvMeasuredCurrent(i).fresh,reason:decision?.reason,accounting:decision?.peakGuardAccounting||null});
   old[i]=next;
  }
 }
 assert.deepEqual(h.errors,[]);const used=process.cpuUsage(cpu);
 return {h,app:a,report:{type,seconds,baseline,houseW,feedback,actualA,evs,batteryEnabled,
   stopCount:events.filter(e=>!e.on).length,events,finalAmps:Array.from({length:evs},(_,i)=>output(a,i)),
   finalAccounting:a.latestEvDecision?.peakGuardAccounting,cpuMs:(used.user+used.system)/1000}};
}
async function check(name,run){const detail=await run();results.push({name,...detail});console.log('PASS',name);}
async function main(){try{
 await check('Mode cannot bypass an uncertain high house reference using Flow amperes',async()=>{
  const r=await replay();assert.equal(r.report.stopCount,0);assert.equal(r.report.finalAmps[0],6);
  assert.equal(r.report.finalAccounting.currentEvPowerW,0);
  assert.equal(r.report.finalAccounting.houseBaselineW,4000);
  assert(r.report.finalAccounting.peakBudgetW>=6*PER_AMP-1);
  let baseline=null;
  if(process.env.HEMS_BASELINE_ROOT){
   const old=await replay({root:process.env.HEMS_BASELINE_ROOT});baseline=old.report;
   assert.equal(baseline.stopCount,3);assert(baseline.events.some(e=>e.reason==='Peak Guard laat geen gezamenlijk EV-laadvermogen toe'));
  }
  return{current:r.report,baseline};
 });
 await check('Actual lower delivery stays authoritative and kWh progress counts measured current',async()=>{
  const r=await replay({seconds:90,actualA:8,baseline:700});assert.equal(r.report.stopCount,0);assert.equal(r.report.finalAmps[0],16);
  assert(Math.abs(r.app.getEvCommandedPowerW(0)-8*PER_AMP)<.01);
  assert.equal(r.app.getEvControlCurrentA(0),8);assert(!r.app.getEvSessionDetectionRuntime(0).loadAbsent);
  r.app.setEvEnergyPlan(0,10,'07:00','yes');
  const start=r.h.now();await r.h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:8});
  r.h.setNow(start+30000);r.app.tickEvEnergyPlan(0,r.h.now());
  assert(Math.abs((10-r.app.evEnergyPlans[0].remainingKwh)-8*PER_AMP/1000/120)<.00001);
  return{measuredA:8,requestedA:16,deliveredKwh:10-r.app.evEnergyPlans[0].remainingKwh};
 });
 await check('Genuine peak overload still stops and retains the 300-second hold',async()=>{
  const r=await replay({houseW:13000,seconds:20});assert(r.report.stopCount>=1);
  assert.equal(r.report.finalAmps[0],0);assert(r.app.evPeakGuardStopHoldUntil>r.h.now());
  return r.report;
 });
 await check('Stale positive telemetry falls back conservatively instead of financing false headroom',async()=>{
  const r=await replay({type:'current',feedback:'stale',seconds:125});assert(r.report.stopCount>=1);
  assert(!r.app.getEvMeasuredCurrent(0).fresh);return r.report;
 });
 await check('Mode-only integration without current measurement retains P1 inference',async()=>{
  const r=await replay({feedback:'zero',baseline:700,seconds:125});assert.equal(r.report.stopCount,0);
  assert.equal(r.report.finalAmps[0],16);assert(r.app.getEvCommandedPowerW(0)>10000);return r.report;
 });
 await check('Current and hybrid charger control retain safe physical accounting',async()=>{
  const reports=[];
  for(const type of ['current','hybrid']){const r=await replay({type,seconds:90});assert.equal(r.report.stopCount,0);assert(r.report.finalAmps[0]>0);reports.push(r.report);}
  return{reports};
 });
 await check('Multiple mode EVs share one Peak Guard budget',async()=>{
  const r=await replay({evs:2,seconds:90});
  const total=700+r.report.finalAmps.reduce((sum,amp)=>sum+amp*PER_AMP,0);
  assert(total<=14900+1);assert(r.report.finalAmps.every(amp=>amp>0));return{...r.report,predictedGridW:total};
 });
 await check('Full planning diagnostic exposes Emergency-only Peak Guard arithmetic',async()=>{
  const r=await replay({seconds:20,baseline:700}),a=r.app;
  const accounting=a.latestEvDecision.peakGuardAccounting;assert(accounting);
  assert.equal(accounting.peakLimitW,15000);assert.equal(accounting.peakSoftMarginW,100);
  const records=a.getCompactDiagnostics().events||[];
  assert(records.some(e=>e.kind==='ev_decision'&&e.peakGuardAccounting?.currentEvPowerW>10000),JSON.stringify(records.slice(-3)));
  return{accounting};
 });
 fs.writeFileSync(path.join(ROOT,'validation/ev-peak-1.1.20.json'),JSON.stringify(results,null,2)+'\n');
 console.log(`1.1.20 EV Peak Guard: ${results.length} production-path groups passed.`);
}finally{restore();global.Date=NativeDate;}}
main().catch(e=>{console.error(e);process.exitCode=1;});
