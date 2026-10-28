'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./ev-work-harness');
const {installVirtualClearTimeout}=require('./pv-source-harness');
const {localDateTimeUtcMs}=require('../lib/homey-energy');
const RealDate=Date,originalNow=Date.now;
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const restore=installVirtualClearTimeout(),results=[];let seq=0;
const submit=(a,i,change,more={})=>a.setEvDashboard({evId:String(i+1),change,requestId:'control_multiday_'+(++seq),...more});
const output=(a,i=0)=>a.getEvControlTypeFor(i)==='mode'?(i?a.getExtraEv(i).lastPublishedChargeMode:a.lastPublishedEvChargeMode)==='standard'?16:(i?a.getExtraEv(i).lastPublishedChargeMode:a.lastPublishedEvChargeMode)==='smart'?6:0:i?a.getExtraEv(i).lastPublishedCurrentA||0:a.lastPublishedEvCurrentA||0;
async function settle(h,grid=623){await h.start();h.setNow(h.now()+8000);await h.grid(grid);await h.start();await h.flush();}
async function check(name,fn){const detail=await fn();results.push({name,...detail});}
(async()=>{try{
 for(const type of ['current','hybrid','mode'])await check(type+': Max PV waits for known surplus, forecast drop reopens existing tariff plan',async()=>{
  const h=await fixture({type,batteries:0,batteryEnabled:false,chargeAllowed:true}),a=h.app;
  await submit(a,0,{target:{type:'kwh',value:20},time:'07:00',days:3,maxPv:true,guaranteed:false},{createOnly:true});
  await h.cards.get('set_forecast_remaining').listener({energy:50});await h.setExternalSetting('expectedEnergyNeedKwh',0);await settle(h);
  assert.equal(a.latestEvDecision.deadlinePlanPvCreditKwh,20);assert.equal(a.latestEvDecision.selectedTariff,false);assert.equal(output(a),0);
  const firstDeadline=a.evEnergyPlans[0].deadlineAt;
  await h.cards.get('set_forecast_remaining').listener({energy:0});await settle(h);
  assert.equal(a.latestEvDecision.deadlinePlanPvCreditKwh,0);assert(a.latestEvDecision.selectedTariff);assert(output(a)>0);assert.equal(a.evEnergyPlans[0].deadlineAt,firstDeadline);
  assert.deepEqual(h.errors,[]);return {firstDeadline,resumedCurrentA:output(a),pvCreditAfterDrop:a.latestEvDecision.deadlinePlanPvCreditKwh};
 });
 await check('Max PV off keeps full grid need, Max PV on preserves real PV start and no grid top-up',async()=>{
  const h=await fixture({type:'current',batteries:0,batteryEnabled:false,chargeAllowed:true}),a=h.app;
  await h.setExternalSetting('expectedEnergyNeedKwh',0);await h.setExternalSetting('evPvGridTopUpMode','full');
  await h.cards.get('set_forecast_remaining').listener({energy:50});
  await submit(a,0,{target:{type:'kwh',value:20},time:'07:00',days:3,maxPv:false,guaranteed:false},{createOnly:true});await settle(h);assert(output(a)>0);assert.equal(a.latestEvDecision.deadlinePlanPvCreditKwh,0);
  await submit(a,0,{maxPv:true});await h.pv(5000);await settle(h,623-5000);
  assert.equal(a.latestEvDecision.selectedTariff,false);assert(a.latestEvDecision.pvRequestPowerW>0);assert(a.latestEvDecision.gridRequestPowerW<1);assert(a.latestEvDecision.desiredPowerW<=5000);
  assert.deepEqual(h.errors,[]);return {desiredPowerW:a.latestEvDecision.desiredPowerW,gridRequestPowerW:a.latestEvDecision.gridRequestPowerW};
 });
 await check('Four EV widget goals preserve shared Peak Guard and hardware current limits',async()=>{
  const h=await fixture({type:'current',evs:4,batteries:0,batteryEnabled:false,chargeAllowed:true,extra:{peakShaveEnabled:true,peakLimitW:17500,peakSoftMarginW:300}}),a=h.app;
  for(let i=0;i<4;i++)await submit(a,i,{target:{type:'kwh',value:20},time:'07:00',days:i+1,guaranteed:true},{createOnly:true});
  await settle(h,500);
  const decisions=[a.latestEvDecision,...a.extraEvInstances.map(e=>e.latestDecision)].slice(0,4),total=decisions.reduce((s,d)=>s+Math.max(0,d?.desiredPowerW||0),0);
  assert(decisions.some(d=>d.desiredPowerW>0));assert(decisions.every(d=>d.desiredCurrentA<=16));assert(total<=17500-300-500+1,{total});
  const builds=a.evDeadlinePlanner.builds;
  for(let i=0;i<120;i++){h.setNow(h.now()+1000);await h.grid(500+(i%2));}
  assert.equal(a.evDeadlinePlanner.builds,builds,'P1-only inputs do not build multi-day plans');
  assert.deepEqual(h.errors,[]);return {desiredTotalW:total,gridW:500,peakLimitW:17500,softMarginW:300,buildsDuring120P1Events:0};
 });
 await check('Future deadline supports fixed contract and chosen TOU rate limits without battery EMS',async()=>{
  for(const contractType of ['fixed','tou']){
   const h=await fixture({type:'current',batteries:0,batteryEnabled:false,chargeAllowed:true,extra:{contractType,fixedChargeWindowStart:'00:00',fixedChargeWindowEnd:'23:59',evFixedChargeWindowEnabled:true,evFixedMaxGridImportW:40000}}),a=h.app;
   await submit(a,0,{target:{type:'kwh',value:20},time:'07:00',days:7,guaranteed:false},{createOnly:true});await settle(h);
   assert(a.latestEvDecision.deadlinePlanning);assert(output(a)>0);assert.equal(a.evEnergyPlans[0].deadlineAt,localDateTimeUtcMs('2026-10-30','07:00','Europe/Brussels'));assert.deepEqual(h.errors,[]);
  }
 });
 fs.writeFileSync(path.join(__dirname,'../validation/ev-multiday-control-1.2.4.json'),JSON.stringify({simulatedHomey:true,physicalHomeyTested:false,passed:results.length,results},null,2)+'\n');console.log('EV multi-day control: '+results.length+' full production-path scenario groups passed');
 }finally{restore();global.Date=RealDate;Date.now=originalNow;}
})().catch(e=>{console.error('FAILED after',results.length,results.at(-1),e);process.exitCode=1;});
