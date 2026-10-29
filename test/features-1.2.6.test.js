'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { boot, DEFAULTS } = require('./startup-harness');
const { evaluate, prepareControlContext, buildSocPlan } = require('../lib/ems-engine');
const { emptyDay, emptyInventory, integrateInterval, rawExportedKwh } = require('../lib/savings');
const { compactDay, expandDay } = require('../lib/savings-history');
const { rollingRange, readCategory } = require('../lib/savings-flow');
const { localDateTimeUtcMs } = require('../lib/homey-energy');
const near = (a,b) => assert(Math.abs(a-b)<1e-7, `${a} != ${b}`);
const at = (day,time) => localDateTimeUtcMs(day,time,'Europe/Brussels');
const NativeDate = Date;
let now = at('2026-10-29','00:00');
global.Date = class extends NativeDate { constructor(...args){super(...(args.length ? args : [now]));} static now(){return now;} };
let cases=0;
async function check(name,fn){await fn();cases++;console.log('PASS',name);}
async function appWith(extra={}) {
 const h=await boot(new Map(Object.entries({...DEFAULTS,settingsSchemaVersion:71,batteryCount:1,totalCapacityKwh:20,
  timezone:'Europe/Brussels',controlEnabled:false,peakShaveEnabled:false,contractType:'fixed',evCount:0,...extra})));
 h.app.requestContextEvaluate=()=>{};h.app.requestEvaluate=()=>{};
 assert.deepEqual(h.errors,[]);return h;
}
async function main(){
 await check('P1 zero: export within/beyond negative band, small import and zero use the real meter', async()=>{
  for(const grid of [-750,-600,-450,-300,-100,-1,0,1,100]) {
   const h=await appWith({gridZeroMinW:-600,gridZeroMaxW:-300});const a=h.app;
   await h.cards.get('set_pv_power').listener({power:1000});
   await h.cards.get('set_grid_power').listener({power:grid});
   a.state.lastTotalCommandW=0;
   a.savings.today=emptyDay(a.getSavingsDateKey());a.savings.lastSampleAt=now;
   now+=10000;a.recordSavingsSample(now);
   near(rawExportedKwh(a.savings.today),Math.max(0,-grid)/1000/360);
   near(a.savings.today.directGridKwh,Math.max(0,grid)/1000/360);
   near(a.state.gridPowerW,grid);
  }
 });
 await check('Export attribution preserves PV, grid-origin battery and unknown battery export',()=>{
  for (const source of ['pv','grid','unknown']) {
   const day=emptyDay('2026-10-29'),inventory=emptyInventory();
   if(source==='pv')inventory.pvKwh=5;
   if(source==='unknown')inventory.unknownKwh=5;
   if(source==='grid')inventory.grid.low={label:'Low',kwh:5,cost:1};
   integrateInterval({day,inventory,seconds:300,gridW:-450,pvW:0,batteryW:1000,importPrice:.3,feedInPrice:.1,capacityKwh:20});
   near(rawExportedKwh(day),.0375);
   near(source==='pv'?day.pvBatteryExportKwh:source==='grid'?day.shiftExportKwh:day.unknownBatteryExportKwh,.0375);
  }
 });
 await check('Rolling day/week/calendar month/year boundaries, leap years and invalid input',()=>{
  assert.deepEqual(rollingRange('2026-10-29',5,'days'),{startKey:'2026-10-25',endKey:'2026-10-30',days:5});
  assert.equal(rollingRange('2026-10-29',2,'weeks').days,14);
  assert.equal(rollingRange('2026-03-30',1,'months').startKey,'2026-02-28');
  assert.equal(rollingRange('2025-02-27',1,'years').startKey,'2024-02-28');
  assert.equal(rollingRange('2024-02-28',1,'years').startKey,'2023-02-28');
  for(const args of [[0,'days'],[1.5,'days'],[1,'hours'],[6,'years'],[61,'months'],[261,'weeks'],[1828,'days']])
   assert.throws(()=>rollingRange('2026-10-29',...args));
 });
 await check('Then Flow: category totals, current day, gaps, negative values, no extra records',async()=>{
  now=at('2026-10-29','12:00');const h=await appWith(),a=h.app;
  a.recordSavingsSample=()=>{};
  a.savings.today=emptyDay('2026-10-29');a.savings.today.pvChargeKwh=3;a.savings.today.directPvValue=-.25;
  a.savings.history={'2026-10-25':compactDay({pvChargeKwh:2,directPvValue:1},'2026-10-25'),
   '2026-10-27':compactDay({pvChargeKwh:4,directPvValue:2},'2026-10-27'),
   '2026-10-24':compactDay({pvChargeKwh:100,directPvValue:100},'2026-10-24')};
  const keys=Object.keys(a.savings.history);
  const run=h.cards.get('get_savings_category').listener;
  const pv=await run({category:'pv_to_battery',count:5,unit:'days'});
  near(pv.kwh,9);assert.equal(pv.value_available,false);assert.equal(pv.available_days,3);assert.equal(pv.complete,false);
  assert.equal(pv.start_date,'2026-10-25');assert.equal(pv.end_date,'2026-10-29');
  const total=await run({category:'total',count:5,unit:'days'});near(total.value,2.75);
  const basic=await run({category:'total',count:5,unit:'days',format:'kwh'});
  assert(basic.result.endsWith(' kWh'));assert(!basic.result.includes('€'));
  const both=await run({category:'total',count:5,unit:'days',format:'kwh_price'});
  assert(both.result.includes('kWh · € 2.75'));
  const price=await run({category:'total',count:5,unit:'days',format:'price'});
  assert.equal(price.result,'€ 2.75');
  const unavailable=await run({category:'pv_to_battery',count:5,unit:'days',format:'kwh_price'});
  assert.equal(unavailable.result,'9 kWh · Amount unavailable');
  a.homey.i18n.getLanguage=()=> 'nl';a.setSetting('currencySymbol','$');
  const nl=await run({category:'total',count:5,unit:'days',format:'kwh_price'});
  assert(nl.result.includes('$ 2,75'));
  a.homey.i18n.getLanguage=()=> 'en';a.setSetting('currencySymbol','€');
  await assert.rejects(run({category:'total',count:5,unit:'days',format:'bad'}));

  for(const item of JSON.parse(fs.readFileSync('.homeycompose/flow/actions/get_savings_category.json')).args[0].values) {
   const r=await run({category:item.id,count:5,unit:'days'});
   assert(Number.isFinite(r.kwh));assert(Number.isFinite(r.value));
  }
  assert.deepEqual(Object.keys(a.savings.history),keys);
  assert.throws(()=>readCategory(emptyDay(),'bad'));
  near(expandDay(compactDay({pvBatteryHomeKwh:2,pvBatteryExportKwh:1},'2026-10-25')).pvBatteryKwh,3);
 });
 const settings={...DEFAULTS,batteryCount:1,totalCapacityKwh:20,timezone:'Europe/Brussels',contractType:'fixed',
  fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00',peakShaveEnabled:false,nightHysteresisEnabled:true,nightHysteresisSoc:3,
  expectedEnergyNeedKwh:20,controlProfile:'exact',gridZeroMinW:-5,gridZeroMaxW:5};
 const state={nightPlanningActive:true,batterySoc:[50],targetSocOverride:50,gridPowerW:500,pvPowerW:0,lastTotalCommandW:0};
 const t=new Date(at('2026-10-29','02:00'));
 await check('Optional night hysteresis stops charge/discharge cycling, resumes at margin, unchanged when off',()=>{
  let r=evaluate(state,settings,t);assert(r.nightChargeHold);near(r.totalCommandW,0);
  r=evaluate({...state,batterySoc:[48],chargeRestartState:r.chargeRestartState},settings,t);
  assert(r.nightChargeHold);assert.notEqual(r.baseMode,'charge');
  r=evaluate({...state,batterySoc:[47],chargeRestartState:r.chargeRestartState},settings,t);
  assert.equal(r.baseMode,'charge');assert(r.totalCommandW<0);
  const off=evaluate(state,{...settings,nightHysteresisEnabled:false},t);
  assert(!off.nightChargeHold);assert(off.totalCommandW>0);
  const day=evaluate({...state,nightPlanningActive:false},settings,t);
  assert(!day.nightChargeHold);
  const manual=evaluate(state,{...settings,forcedMode:'self_consumption'},t);
  assert(!manual.nightChargeHold);assert(manual.totalCommandW>0);
 });
 await check('Night target anchor tolerates small forecast changes, allows material changes, matches planning',()=>{
  const st={...state,targetSocOverride:null,batterySoc:[80],forecastRemainingKwh:6,forecastDailyMaxKwh:6};
  const first=evaluate(st,settings,t);near(first.planningChargeTargetSoc,80);
  const next={...st,forecastRemainingKwh:6.2,forecastDailyMaxKwh:6.2,chargeRestartState:first.chargeRestartState};
  const r=evaluate(next,settings,t);near(r.targetSoc,79);near(r.planningChargeTargetSoc,80);assert(r.nightChargeHold);
  const prepared=prepareControlContext(next,settings,t);near(evaluate(next,settings,t,prepared).planningChargeTargetSoc,80);
  near(buildSocPlan(next,settings,t).targetSoc,80);
  const material=evaluate({...next,forecastRemainingKwh:5,forecastDailyMaxKwh:5},settings,t);
  near(material.planningChargeTargetSoc,85);assert.equal(material.baseMode,'charge');
  const capped=evaluate(next,{...settings,nightPlanningMaxSoc:70},t);near(capped.planningChargeTargetSoc,70);
 });
 await check('Night hold applies only to permitted windows across fixed, TOU and dynamic contracts',()=>{
  for(const contractType of ['fixed','tou','dynamic_hour','dynamic_quarter']) {
   const config={...settings,contractType,dynamicPriceDataReady:true,dynamicUseBatteryNormalHours:true,
    dynamicSlots:Array.from({length:24},(_,hour)=>({time:String(hour).padStart(2,'0')+':00',price:hour===2?.05:.3})),
    cheapHours:1,expensiveHours:1,touRates:[{id:'low',name:'Low',importPrice:.2,weekdayChargeMode:'always',weekendChargeMode:'always'}],
    touSchedule:[{rateId:'low',start:'00:00',end:'23:59',days:[1,2,3,4,5,6,7]}]};
   const r=evaluate(state,config,t);assert(r.nightChargeHold,contractType);near(r.totalCommandW,0);
   if(contractType==='tou') {
    const never={...config,touRates:[{...config.touRates[0],weekdayChargeMode:'never',weekendChargeMode:'never'}]};
    assert(!evaluate(state,never,t).nightChargeHold,'never-charge TOU window must not hold');
   }
  }
  const normal={...settings,contractType:'dynamic_hour',timezone:'UTC',dynamicPriceDataReady:true,
   dynamicUseBatteryNormalHours:true,dynamicNormalChargeEnabled:true,dynamicNormalChargeMaxSoc:50,
   cheapHours:1,expensiveHours:1,dynamicSlots:Array.from({length:24},(_,hour)=>({time:String(hour).padStart(2,'0')+':00',price:hour===0?.05:hour===23?.5:.2}))};
  const n=evaluate({...state,targetSocOverride:80},normal,new Date('2026-10-29T02:00:00Z'));
  assert.equal(n.tariff.className,'normal');assert(n.nightChargeHold);near(n.totalCommandW,0);
  const {BatteryNightPlanner}=require('../lib/battery-night-planner');
  const start=t.getTime(),intervals=Array.from({length:20},(_,i)=>({startAt:start+i*900000,endAt:start+(i+1)*900000,price:.1}));
  const plan=new BatteryNightPlanner().evaluate({curve:{intervals},now:start,startAt:start,
   deadlineAt:start+5*3600000,needKwh:0,targetSoc:50,powerW:2000,cheapHours:1,expensiveHours:1,normalEnabled:false,normalMaxSoc:50});
  const config={...settings,contractType:'dynamic_quarter',dynamicPriceDataReady:true,batteryNightPlan:plan};
  assert(evaluate(state,config,t).nightChargeHold);
  assert(!evaluate(state,config,new Date(start+2*3600000)).nightChargeHold,'hold expires outside selected night rows');
 });
 await check('Night hold still captures solar and permits Peak Guard and Safety SoC recovery',()=>{
  const pv=evaluate({...state,gridPowerW:-1000,pvPowerW:1500},settings,t);assert(pv.totalCommandW<0);
  const peak=evaluate({...state,gridPowerW:4000},{...settings,peakShaveEnabled:true,peakLimitW:2500,peakSoftMarginW:100},t);
  assert.equal(peak.override,'peak_shave');assert(peak.totalCommandW>0);
  const safe=evaluate({...state,batterySoc:[8]},settings,t);assert(safe.safetySocRecoveryActive);assert(safe.totalCommandW<0);
 });
 await check('Optional 00-02 median freezes exactly once, excludes evening/post-02 inputs and survives restart',async()=>{
  now=at('2026-10-28','22:00');let h=await appWith({nightForecastHoldEnabled:true}),a=h.app;
  a.state.nightPlanningActive=true;a.state.nightPlanningStartedDate='2026-10-28';
  a.updateForecastTomorrowInput(100,now);
  now=at('2026-10-29','00:10');a.updateForecastInput(10,now);
  now=at('2026-10-29','01:10');a.updateForecastInput(20,now);
  now=at('2026-10-29','01:50');a.updateForecastInput(30,now);
  assert(!a.nightForecastMedian.hold.frozen);
  now=at('2026-10-29','02:00');a.getEvaluationState(a.getSettings(),now);
  assert(a.nightForecastMedian.hold.frozen);near(a.nightForecastMedian.value,20);
  a.updateForecastInput(200,now);near(a.nightForecastMedian.value,20);near(a.state.forecastRemainingKwh,200);
  assert.equal(h.store.get('_nightForecastHold').samples.length,3);
  h=await boot(h.store);a=h.app;a.requestContextEvaluate=()=>{};
  near(a.getNightForecastRuntime(now).value,20);
  a.state.batterySoc=[50];a.inputSeen.batterySoc=[true];
  const restartedPlan=buildSocPlan(a.getEvaluationState(a.getSettings(),now),a.getRuntimeSettings(),new Date(now));
  near(restartedPlan.forecastUsedKwh,20);
  await h.setExternalSetting('nightForecastHoldEnabled',false);
  a.updateForecastInput(300,now);assert(!a.getNightForecastRuntime(now).hold?.frozen);
  assert.notEqual(a.getNightForecastRuntime(now).value,20);
 });
 await check('Median default off, missing-window fallback, genuine PV start and next-night reset',async()=>{
  now=at('2026-10-29','00:00');const h=await appWith(),a=h.app;
  a.state.nightPlanningActive=true;a.state.nightPlanningStartedDate='2026-10-28';
  a.updateForecastInput(10,now);now+=60000;a.updateForecastInput(30,now);
  now=at('2026-10-29','03:00');a.updateForecastInput(50,now);near(a.nightForecastMedian.value,30);
  await h.setExternalSetting('nightForecastHoldEnabled',true);
  a.updateForecastInput(70,now);assert(!a.nightForecastMedian.hold.frozen);
  a.updatePvPlanningState(500,now);assert.equal(a.getNightForecastRuntime(now),null);
  now=at('2026-10-29','21:00');a.activateNightPlanning('test',now);
  assert.equal(a.getNightForecastRuntime(now).targetDate,'2026-10-30');assert.equal(a.nightForecastMedian.hold.samples.length,0);
 });
 await check('Autotune interval hard limits clamp legacy ranges, permission and recommendations',async()=>{
  for(const interval of [1,3,10,30,120]) {
   const h=await appWith({commandIntervalSeconds:interval}),a=h.app;
   h.store.set('_autoTuneLimits',{commandIntervalSeconds:{min:1,max:120,minConfidencePercent:50}});
   assert.equal(a.normalizeAutoTuneValue('commandIntervalSeconds',1),4);
   assert.equal(a.normalizeAutoTuneValue('commandIntervalSeconds',120),17);
   await a.setAutoTunePermission({settingKey:'commandIntervalSeconds',allowed:true});
   assert(h.store.get('commandIntervalSeconds')>=4&&h.store.get('commandIntervalSeconds')<=17);
   Object.assign(a.autoTuneRuntime.grid,{samples:400,gapSamples:400,ewmaAbsDelta:100,ewmaGapMs:10000});
   for(const rec of a.getAutoTuneRecommendations().filter(r=>r.settingKey==='commandIntervalSeconds'))assert(rec.recommended>=4&&rec.recommended<=17);
  }
 });
 await check('Autotune symmetric realistic pair: evidence, steps, one-off and automatic permission/ranges',async()=>{
  for(const step of [1,100]) {
   const h=await appWith({batteryCommandStepW:step,gridZeroMinW:-600,gridZeroMaxW:-300}),a=h.app;
   Object.assign(a.autoTuneRuntime.grid,{samples:20,ewmaAbsDelta:20});
   assert(!a.getAutoTuneRecommendations().some(r=>r.settingKey==='gridZeroMinW'));
   a.autoTuneRuntime.grid.samples=400;
   const rec=a.getAutoTuneRecommendations().find(r=>r.settingKey==='gridZeroMinW');
   assert(rec);assert.equal(rec.recommended,-Math.max(75,step*4));
   await a.setAutoTunePermission({settingKey:'gridZeroMinW',allowed:true});
   assert.equal(h.store.get('gridZeroMinW'),-600,'one permission cannot move half a pair');
   await a.setAutoTunePermission({settingKey:'gridZeroMaxW',allowed:true});
   assert.equal(h.store.get('gridZeroMinW')+h.store.get('gridZeroMaxW'),0);
   assert.equal(h.store.get('gridZeroMaxW'),Math.max(75,step*4));
   a.setSetting('gridZeroMinW',-600);a.setSetting('gridZeroMaxW',-300);
   await a.applyAutoTuneRecommendationOnce({settingKey:'gridZeroMaxW'});
   assert.equal(h.store.get('gridZeroMinW')+h.store.get('gridZeroMaxW'),0);
  }
  const h=await appWith({gridZeroMinW:-75,gridZeroMaxW:75}),a=h.app;
  Object.assign(a.autoTuneRuntime.grid,{samples:400,ewmaAbsDelta:20});
  assert(!a.getAutoTuneRecommendations().some(r=>r.settingKey.startsWith('gridZero')),'stable reasonable band needs no recommendation');
  a.setSetting('gridZeroMinW',-5);a.setSetting('gridZeroMaxW',5);a.autoTuneRuntime.grid.ewmaAbsDelta=0;
  assert(!a.getAutoTuneRecommendations().some(r=>r.settingKey.startsWith('gridZero')),'quiet precise battery needs no speculative wider band');

 });
 await check('Autotune pair honors both ranges and preserves other parameter cooldowns',async()=>{
  const h=await appWith({gridZeroMinW:-600,gridZeroMaxW:-300,commandDeadbandW:0}),a=h.app;
  Object.assign(a.autoTuneRuntime.grid,{samples:400,ewmaAbsDelta:20});
  h.store.set('_autoTunePermissions',{gridZeroMinW:true,gridZeroMaxW:true,commandDeadbandW:true});
  a.autoTuneRuntime.permissions=null;
  h.store.set('_autoTuneLastAppliedAt',{commandDeadbandW:now-86400000});
  h.store.set('_autoTuneLimits',{gridZeroMinW:{min:-500,max:-400,minConfidencePercent:50},
   gridZeroMaxW:{min:75,max:100,minConfidencePercent:50},commandDeadbandW:{min:0,max:100,minConfidencePercent:50}});
  await a.applyAutoTuneRecommendations({force:true});
  assert.equal(h.store.get('gridZeroMinW'),-600);assert.equal(h.store.get('gridZeroMaxW'),-300);
  h.store.set('_autoTuneLimits',{});a.setSetting('commandDeadbandW',0);
  await a.applyAutoTuneRecommendations({force:true});
  assert.equal(h.store.get('gridZeroMinW')+h.store.get('gridZeroMaxW'),0);
  assert.equal(h.store.get('_autoTuneLastAppliedAt').commandDeadbandW,now);
 });
 console.log(`${cases} feature regression groups passed (1.2.6)`);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{global.Date=NativeDate;});
