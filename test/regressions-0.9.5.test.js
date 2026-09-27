'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sun = require('../settings/sun-chance');
const { evaluate, DEFAULTS, prepareControlContext, buildSocPlan } = require('../lib/ems-engine');
const { translate } = require('../lib/display-language');
const { boot } = require('./startup-harness');
const now = new Date('2026-09-27T12:00:00Z');
const config = { ...DEFAULTS, timezone:'Europe/Brussels', batteryCount:1, totalCapacityKwh:20,
  safetySoc:18, peakShaveEnabled:false, contractType:'fixed', expectedEnergyNeedKwh:0,
  maxTotalChargeW:6000, maxChargePerBatteryW:6000, maxTotalDischargeW:6000, maxDischargePerBatteryW:6000,
  sunChanceReserveEnabled:true };
const state = { batterySoc:[35], gridPowerW:500, pvPowerW:0, lastTotalCommandW:0,
  forecastRemainingKwh:30, forecastTomorrowKwh:30, sunChanceForecasts:{'2026-09-27':5,'2026-09-28':80},
  nightPlanningActive:false, planningForecastDay:'today' };
const reserve = (chance, overrides={}) => sun.reserve({...state,sunChanceForecasts:{'2026-09-27':chance}}, {...config,...overrides},'2026-09-27');
for (const [chance,floor] of [[0,48],[10,48],[10.01,38],[30,38],[30.01,28],[50,28],[50.01,18],[100,18]]) assert.equal(reserve(chance).floorSoc,floor);
for (const missing of [null,undefined,'',false,-1,101,NaN]) assert.equal(reserve(missing).active,false);
assert.equal(reserve(0,{sunChanceBand1MinSoc:90,maxSoc:80}).floorSoc,80);
assert.equal(reserve(0,{sunChanceBand1MinSoc:5}).floorSoc,18);
assert.equal(reserve(0,{sunChanceBand2Start:11}).active,false,'Invalid ranges fail without an extra reserve');
assert.equal(sun.validBands(sun.bands(config)),true);
for (const overrides of [{sunChanceBand1Start:1},{sunChanceBand2Start:9},{sunChanceBand3End:101},{sunChanceBand4End:99},{sunChanceBand1MinSoc:101}]) assert(!sun.validBands(sun.bands({...config,...overrides})));
const result = evaluate(state,config,now);
assert.equal(result.totalCommandW,0,'Low chance stops ordinary discharge below reserve');
assert.equal(result.sunChanceReserve.floorSoc,48);
assert.equal(result.batteryPauseCode,'sun_chance_floor');
assert.equal(translate(result.batteryPauseReason),'Discharging paused · sunshine reserve 48.0% reached');
const off = evaluate(state,{...config,sunChanceReserveEnabled:false},now);
assert(off.totalCommandW>0);
assert.equal(off.targetSoc,result.targetSoc,'Sunshine reserve does not raise the grid charging target');
assert.equal(result.safetySocRecoveryActive,false);
assert(evaluate(state,{...config,forcedMode:'discharge'},now).totalCommandW > 0,'Manual override retains priority');
const saving=evaluate(state,{...config,lowForecastFixedEnabled:true,lowForecastSelfConsumptionMinKwh:50,batterySaveDischargeAboveSoc:80},now);
assert.equal(saving.batteryDischargeFloorSoc,80,'A higher existing reserve wins');

assert(evaluate({...state,gridPowerW:-1500},config,now).totalCommandW<0,'PV charging remains available');
assert(evaluate({...state,batterySoc:[17]},config,now).totalCommandW<0,'Safety recovery remains available');
assert(evaluate({...state,gridPowerW:4000},{...config,peakShaveEnabled:true,peakLimitW:2500},now).totalCommandW>0,'Peak Guard retains priority');
assert(evaluate({...state,batterySoc:[49]},config,now).totalCommandW>0);
const saved = { ...config, sunChanceBand1MinSoc:25 };
assert.equal(evaluate(state,saved,now).sunChanceReserve.floorSoc,25);
const stale = evaluate({...state,sunChanceForecasts:{'2026-09-26':0}},config,now);
assert.equal(stale.sunChanceReserve.active,false);assert(stale.totalCommandW>0);
const prepared=prepareControlContext(state,config,now);
assert.equal(evaluate(state,config,now,prepared).totalCommandW,result.totalCommandW);
assert.equal(buildSocPlan(state,config,now).targetSoc,buildSocPlan(state,{...config,sunChanceReserveEnabled:false},now).targetSoc);
// Date-bound selection: previous tomorrow remains today's forecast after midnight.
const evening={...state,nightPlanningActive:true,planningForecastDay:'tomorrow'};
assert.equal(sun.reserve(evening,config,'2026-09-27').chance,80);
assert.equal(sun.reserve({...evening,planningForecastDay:'today'},config,'2026-09-28').chance,80);
assert.equal(sun.reserve({...evening,planningForecastDay:'today'},config,'2026-09-29').active,false);
const beforeMidnight=new Date('2026-09-27T21:59:59Z'),afterMidnight=new Date('2026-09-27T22:00:01Z');
assert.equal(evaluate(evening,config,beforeMidnight).sunChanceReserve.date,'2026-09-28');
assert.equal(evaluate({...evening,planningForecastDay:'today'},config,afterMidnight).sunChanceReserve.date,'2026-09-28');
// Tariff selection governs ordinary discharge, including both TOU and dynamic peaks.
const tou = { ...config, contractType:'tou', touRates:[
 {id:'low',name:'Dal',importPrice:0.1,weekdayChargeMode:'never',weekendChargeMode:'never',avoidGridImport:true,sunChanceReserveAllowed:true},
 {id:'peak',name:'Piek',importPrice:0.3,weekdayChargeMode:'never',weekendChargeMode:'never',avoidGridImport:true},
],touSchedule:[{rateId:'low',start:'00:00',end:'12:00',days:[1,2,3,4,5,6,7]},
 {rateId:'peak',start:'12:00',end:'00:00',days:[1,2,3,4,5,6,7]}] };
const peakResult=evaluate(state,tou,now);
assert.equal(peakResult.tariff.className,'expensive');
assert.equal(peakResult.sunChanceReserve.active,false);
assert.equal(peakResult.batteryDischargeFloorSoc,18);
assert(peakResult.totalCommandW>0,'TOU peak discharges through sunshine reserve');
assert.equal(evaluate({...state,batterySoc:[18]},tou,now).totalCommandW,0,'TOU peak stops at Safety SoC');
const peakSelected={...tou,touRates:tou.touRates.map(r=>({...r,sunChanceReserveAllowed:true}))};
assert.equal(evaluate(state,peakSelected,now).totalCommandW,0,'User may explicitly select peak too');
const morning=new Date('2026-09-27T08:00:00Z');
assert.equal(evaluate(state,tou,morning).totalCommandW,0,'Explicit cheap tariff selection holds reserve');
const allUnselected={...tou,touRates:tou.touRates.map(r=>({...r,sunChanceReserveAllowed:false}))};
assert(evaluate(state,allUnselected,morning).totalCommandW>0);
assert.equal(evaluate(state,{...config,sunChanceFixedEnabled:false},now).sunChanceReserve.active,false);
const dynamic={...config,contractType:'dynamic_hour',cheapHours:1,expensiveHours:1,dynamicUseBatteryNormalHours:true,
 dynamicSlots:[{time:'00:00',price:0.1},{time:'01:00',price:0.2},{time:'02:00',price:0.3}]};
for(const [hour,cls,key,active] of [[0,'cheap','sunChanceDynamicCheapEnabled',true],[1,'normal','sunChanceDynamicNormalEnabled',true],[2,'expensive','sunChanceDynamicExpensiveEnabled',false]]) {
 const time=new Date(`2026-09-27T0${hour}:30:00+02:00`);
 const r=evaluate(state,dynamic,time);
 assert.equal(r.tariff.className,cls);
 assert.equal(r.sunChanceReserve.active,active,cls);
 const toggled=evaluate(state,{...dynamic,[key]:!active},time);
 assert.equal(toggled.sunChanceReserve.active,!active,cls+' toggle');
 if(cls==='expensive') {
   assert(r.totalCommandW>0);
   assert.equal(r.batteryDischargeFloorSoc,18);
   assert.equal(evaluate({...state,batterySoc:[18]},dynamic,time).totalCommandW,0);
   assert.equal(toggled.totalCommandW,0);
 }
}
assert.equal(sun.tariffAllowed(dynamic,{kind:'dynamic',className:'normal',price:null}),false);
assert.equal(sun.touDefaultAllowed(tou.touRates[1],tou.touRates),false);
assert.equal(translate('Zonkansreserve uit voor dit tarief'),'Sunshine reserve off for this tariff');
// Browser module and server module use the same configuration semantics.
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../settings/sun-chance'),'utf8'),context);
assert.equal(JSON.stringify(context.HomeFluxSunChance.bands(config)),JSON.stringify(sun.bands(config)));
const html=fs.readFileSync(require.resolve('../settings/index.html'),'utf8');
for(const key of Object.keys(sun.defaults)) assert(html.includes(`id="${key}"`),key);
for(const text of ['Zonkansreserve inschakelen','Begin zonkans (%)','Einde zonkans (%)','Minimum-SoC voor dit bereik (%)','Zonkansreserve actief','Geen zonkans voor de planningsdag']) assert.notEqual(translate(text),text);
(async()=>{
 const {app,cards,store}=await boot(new Map([['safetySoc',18],['sunChanceBand2MinSoc',33]]));
 app.requestContextEvaluate=()=>{};
 assert.equal(app.getSettings().sunChanceReserveEnabled,false,'Upgrade is opt-in');
 assert.equal(app.getSettings().sunChanceBand2MinSoc,33,'Existing settings survive');
 const card=cards.get('set_sun_chance_forecast');
 for(const value of [null,'',-1,101]) assert.equal(await card.listener({today:value,tomorrow:70}),false);
 assert.equal(await card.listener({today:0,tomorrow:70}),true,'Zero is a valid probability');
 app.updateSunChanceForecast(5,80,now.getTime());
 app.state.batterySoc=[35];app.state.nightPlanningActive=false;
 assert.equal(app.getEvBatterySupportAvailableW(config,0,null,now.getTime()),0,'EV support cannot spend the sunshine reserve');
 assert(app.getEvBatterySupportAvailableW(tou,0,null,now.getTime())>0,'EV budget releases reserve on unselected peak');
 assert.equal(app.getEvBatterySupportAvailableW(peakSelected,0,null,now.getTime()),0,'EV budget respects selected peak');
 assert(app.getEvBatterySupportAvailableW({...config,sunChanceReserveEnabled:false},0,null,now.getTime())>0);
 app.updateSunChanceForecast(5,80,beforeMidnight.getTime());
 app.state.nightPlanningActive=true;app.state.nightPlanningStartedDate='2026-09-27';
 assert.equal(app.getPlanningForecastDay(beforeMidnight.getTime()),'tomorrow');
 assert.equal(app.getPlanningForecastDay(afterMidnight.getTime()),'today');
 const restarted=await boot(store);
 assert.deepEqual(restarted.app.state.sunChanceForecasts,{'2026-09-27':5,'2026-09-28':80});
 assert.equal(sun.reserve({...restarted.app.state,nightPlanningActive:true,planningForecastDay:'today'},config,'2026-09-28').chance,80);
 console.log('0.9.5 sunshine reserve: boundaries, dates, midnight, stale inputs, persistence, opt-in, discharge, PV, Safety SoC, Peak Guard and translations passed');
})().catch(e=>{console.error(e);process.exitCode=1});
