'use strict';
const assert = require('node:assert/strict');
const E = require('../lib/ems-engine');
const policyStorage = require('../settings/high-forecast-policy');
const packed = s => ({...s, highForecastDynamicPolicy:policyStorage.normalize(s.highForecastDynamicPolicy,s)});
let checks = 0;
const now = new Date('2026-11-13T12:00:00+01:00');
const slots = Array.from({length:24}, (_, hour) => ({time:`${String(hour).padStart(2,'0')}:00`,price:hour===11?.1:hour===13?.6:.3}));
const base = {batteryCount:1,totalCapacityKwh:10,minSoc:10,safetySoc:14,maxSoc:100,
  maxTotalChargeW:2400,maxTotalDischargeW:2000,maxChargePerBatteryW:2400,maxDischargePerBatteryW:2000,
  timezone:'Europe/Brussels',forcedMode:'auto',controlProfile:'exact',gridZeroMinW:-5,gridZeroMaxW:5,
  peakShaveEnabled:false,batterySaveDischargeAboveSoc:100,expectedEnergyNeedKwh:0,
  lowForecastSelfConsumptionMinKwh:5,forecastDataReady:true,forecastDailyDataReady:true,
  forecastTomorrowDataReady:true,dynamicPriceDataReady:true,cheapHours:1,expensiveHours:1,dynamicSlots:slots};
const state = {gridPowerW:900,forecastRemainingKwh:20,forecastDailyMaxKwh:20,forecastTomorrowKwh:20,batterySoc:[70],targetSocOverride:40};
function run(s, st = state, date = now) {checks++; return E.evaluate(st,packed(s),date);}
function dynamic(category, save, exception, contractType='dynamic_hour') {
  return {...base,contractType,[`highForecastDynamic${category}BatterySave`]:save,
    [`highForecastDynamic${category}DischargeToTarget`]:exception};
}
function tou(save, exception, extra={}) {
  return {...base,contractType:'tou',touRates:[{id:'r',name:'Rate',importPrice:.2,
    weekdayChargeMode:'never',weekendChargeMode:'never',avoidGridImport:false,
    highForecastBatterySave:save,highForecastDischargeToTarget:exception,...extra}],
    touSchedule:[{rateId:'r',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]}]};
}
// Full truth table, at/below/above the existing target, both dynamic contracts and TOU.
for (const type of ['dynamic_hour','dynamic_quarter','tou']) for (const category of (type==='tou'?['Rate']:['Cheap','Normal'])) {
  const date = category==='Cheap'?new Date('2026-11-13T11:00:00+01:00'):now;
  for(const save of [false,true]) for(const exception of [false,true]) for(const soc of [70,40,30]) {
    const s=type==='tou'?tou(save,exception):dynamic(category,save,exception,type);
    const st={...state,batterySoc:[soc]}; const r=run(s,st,date);
    assert.equal(r.targetSoc,40);
    const charging = type!=='tou' && category==='Cheap' && soc<40;
    assert.equal(r.baseMode,charging?'charge':save?'solar_capture':'self_consumption');
    assert.equal(r.highForecastBatterySaveActive,save&&!charging);
    assert.equal(r.highForecastDischargeToTargetActive,save&&exception&&soc>40&&!charging);
    if(charging) assert(r.plannedChargeW>0);
    else assert.equal(r.totalCommandW>0,!save || exception&&soc>40);
    // Slow-context reuse must make the same decision and publish the same setpoint.
    const cached=E.evaluate(st,packed(s),date,E.prepareControlContext(st,packed(s),date));
    assert.equal(cached.baseMode,r.baseMode);assert.equal(cached.totalCommandW,r.totalCommandW);
  }
}
// Low PV is governed solely by the explicit low-PV flags, never by high-PV/legacy flags.
for(const category of ['Cheap','Normal']) for(const save of [false,true]) for(const exception of [false,true]) {
  const date=category==='Cheap'?new Date('2026-11-13T11:00:00+01:00'):now;
  for(const old of [undefined,false,true]) {
    const s={...dynamic(category,true,true),dynamicUseBatteryNormalHours:old,
      [`lowForecastDynamic${category}Enabled`]:save,[`lowForecastDynamic${category}DischargeToTarget`]:exception};
    const r=run(s,{...state,forecastDailyMaxKwh:4},date);
    assert.equal(r.baseMode,save?'solar_capture':'self_consumption');
    assert.equal(r.lowForecastDischargeToTargetActive,save&&exception);
    assert(!r.highForecastBatterySaveActive);assert.equal(r.totalCommandW>0,!save||exception);
  }
}
// High-PV flags never grant low-PV TOU discharge or override import avoidance.
for(const lowSave of [false,true])for(const lowException of [false,true]) {
 const r=run(tou(true,true,{lowForecastBatterySave:lowSave,lowForecastDischargeToTarget:lowException}),{...state,forecastDailyMaxKwh:4});
 assert.equal(r.lowForecastBatterySaveActive,lowSave);assert.equal(r.totalCommandW>0,!lowSave||lowException);assert(!r.highForecastBatterySaveActive);
}
for(const save of [false,true])for(const exception of [false,true])for(const pv of [4,20]) {
 const r=run(tou(save,exception,{avoidGridImport:true,lowForecastBatterySave:true,lowForecastDischargeToTarget:true}),{...state,forecastDailyMaxKwh:pv});
 assert.equal(r.baseMode,'avoid_import');assert(r.totalCommandW>0);assert(!r.highForecastBatterySaveActive);
}
// Transitions, inclusive classification boundary, full-day forecast, and sunny override.
const policy={...dynamic('Normal',true,false),lowForecastDynamicNormalEnabled:false};
for(const pv of [4,5,20,4]) {
 const r=run(policy,{...state,forecastDailyMaxKwh:pv,forecastRemainingKwh:.1});
 assert.equal(r.highForecastBatterySaveActive,pv>=5);assert.equal(r.baseMode,pv>=5?'solar_capture':'self_consumption');
}
assert(run(policy,{...state,forecastDailyMaxKwh:4,lowForecastSunnyOverrideActive:true}).highForecastBatterySaveActive);
assert(!run(policy,{...state,forecastDailyMaxKwh:4,forecastTomorrowKwh:4,lowForecastSunnyOverrideActive:true,planningForecastDay:'tomorrow',nightPlanningActive:true}).highForecastBatterySaveActive);
assert(run(policy,{...state,forecastDailyMaxKwh:4,forecastTomorrowKwh:20,planningForecastDay:'tomorrow',nightPlanningActive:true}).highForecastBatterySaveActive);
assert(!run({...policy,forecastDailyDataReady:false,forecastDataReady:false},state).highForecastBatterySaveActive);
assert(!run({...policy,dynamicPriceDataReady:false},state).highForecastBatterySaveActive);
// Expensive dynamic prices keep their existing high/low-PV policies.
for(const contractType of ['dynamic_hour','dynamic_quarter'])for(const pv of [4,20])for(const lowSave of [false,true]) {
 const s={...dynamic('Normal',true,true,contractType),highForecastDynamicCheapBatterySave:true,
   lowForecastDynamicExpensiveEnabled:lowSave,lowForecastDynamicExpensiveDischargeToTarget:true};
 const r=run(s,{...state,forecastDailyMaxKwh:pv},new Date('2026-11-13T13:00:00+01:00'));
 assert.equal(r.baseMode,pv<5&&lowSave?'solar_capture':'avoid_import');assert(r.totalCommandW>0);assert(!r.highForecastBatterySaveActive);
}
// Every configured TOU rate, including the expensive class, can independently save.
const rates=['a','b','c'].map((id,i)=>({id,name:id,importPrice:.1+i*.1,weekdayChargeMode:'never',weekendChargeMode:'never',avoidGridImport:false,highForecastBatterySave:i!==1,highForecastDischargeToTarget:i===2}));
const schedule=rates.map((r,i)=>({rateId:r.id,start:`${String(i*8).padStart(2,'0')}:00`,end:i===2?'00:00':`${String((i+1)*8).padStart(2,'0')}:00`,days:[1,2,3,4,5,6,7]}));
for(let i=0;i<3;i++) {
 const r=run({...base,contractType:'tou',touRates:rates,touSchedule:schedule},state,new Date(`2026-11-13T${String(i*8+1).padStart(2,'0')}:00:00+01:00`));
 assert.equal(r.tariff.rateId,rates[i].id);assert.equal(r.highForecastBatterySaveActive,i!==1);assert.equal(r.totalCommandW>0,i!==0);
}
// Existing save floor, PV capture, Safety SoC recovery, per-battery floor and Peak Guard.
assert(run({...dynamic('Normal',true,false),batterySaveDischargeAboveSoc:60}).totalCommandW>0);
const capture=run(dynamic('Normal',true,false),{...state,gridPowerW:-1200,pvPowerW:2000});assert(capture.totalCommandW<0);assert(capture.pvChargeW>0);
const safety=run(dynamic('Normal',true,true),{...state,batterySoc:[13]});assert.equal(safety.baseMode,'charge');assert(safety.safetySocRecoveryActive);assert(safety.totalCommandW<0);
const peak=run({...dynamic('Normal',true,false),peakShaveEnabled:true,peakLimitW:2500,peakSoftMarginW:100},{...state,gridPowerW:4000});assert.equal(peak.override,'peak_shave');assert(peak.totalCommandW>0);
const split=run({...dynamic('Normal',true,true),batteryCount:2,totalCapacityKwh:20,maxTotalDischargeW:4000},{...state,batterySoc:[35,70]});assert.equal(split.commands[0],0);assert(split.commands[1]>0);
const blocked=run(dynamic('Normal',true,true),{...state,batteryDischargeBlockedByEv:true});assert.equal(blocked.totalCommandW,0);
const reserveState={...state,forecastRemainingKwh:0};
const reserve=run({...dynamic('Normal',true,true),peakReserveMonth11:true,peakReserveTargetSoc:60},reserveState);assert(reserve.ordinaryDischargeFloorSoc>=60);
const belowReserve=run({...dynamic('Normal',true,true),peakReserveMonth11:true,peakReserveTargetSoc:60},{...reserveState,batterySoc:[50]});assert.equal(belowReserve.totalCommandW,0);
// Explicit save keeps its normal floor once the forecast exception ends (no latch/timer).
const at=run(dynamic('Normal',true,true),{...state,batterySoc:[40]});assert.equal(at.baseMode,'solar_capture');assert.equal(at.ordinaryDischargeFloorSoc,100);
// Fixed contract is unchanged and never exposes/uses new tariff saving flags.
for(const soc of [70,40,30]) {
 const r=run({...base,contractType:'fixed',highForecastBatterySave:true,highForecastDynamicNormalBatterySave:true},{...state,batterySoc:[soc]});assert(!r.highForecastBatterySaveActive);assert.equal(r.baseMode,'self_consumption');
}
// Natural forecast target (no override), normal-price charging and manual modes.
const naturalState={...state,targetSocOverride:null,forecastRemainingKwh:20};
const natural=run({...dynamic('Normal',true,true),expectedEnergyNeedKwh:23},naturalState);
assert.equal(natural.targetSoc,40);assert.equal(natural.ordinaryDischargeFloorSoc,40);assert(natural.totalCommandW>0);
const normalCharge=run({...dynamic('Normal',true,true),dynamicNormalChargeEnabled:true,dynamicNormalChargeMaxSoc:50},{...state,batterySoc:[30]});
assert.equal(normalCharge.baseMode,'charge');assert(normalCharge.plannedChargeW>0);assert(!normalCharge.highForecastBatterySaveActive);
const manual=run({...dynamic('Normal',true,true),forcedMode:'solar_capture'});assert(!manual.highForecastBatterySaveActive);assert.equal(manual.totalCommandW,0);
const injected=run(dynamic('Normal',true,false),{...state,injectionActive:true,injectionTargetW:1000,injectionStopSoc:40});assert.equal(injected.baseMode,'injection');assert(!injected.highForecastBatterySaveActive);
console.log(`High-PV saving 1.3.2: ${checks} evaluations plus prepared-context comparisons passed.`);
