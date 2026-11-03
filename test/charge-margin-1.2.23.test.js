'use strict';
const assert=require('node:assert/strict'),E=require('../lib/ems-engine'),C=require('../lib/charge-strategy');
const {prepareEvPriceCurve}=require('../lib/ev-deadline-planner');
const at=Date.parse('2026-11-03T08:00:00Z'),hour=3600000;
const curve=prepareEvPriceCurve(Array.from({length:48},(_,i)=>({startMs:at-8*hour+i*hour,price:.1})),'UTC',60);
const settings={...E.DEFAULTS,timezone:'UTC',batteryCount:2,totalCapacityKwh:10,maxChargePerBatteryW:1000,maxTotalChargeW:2000,minSoc:10,safetySoc:10,maxSoc:100,peakShaveEnabled:false,fixedChargeWindowStart:'07:00',fixedChargeWindowEnd:'17:00',solarTargetTime:'17:00',nightTargetTime:'07:00',peakReserveTargetSoc:0,sunnyMonthsMinSocEnabled:false,sunChanceReserveEnabled:false,dayMaxSoc:80,nightMaxSoc:80,dynamicPriceDataReady:true};
const state={batterySoc:[70,70],gridPowerW:0,controlGridPowerW:0,lastTotalCommandW:0,lastBatteryCommands:[0,0],targetSocOverride:80,forecastRemainingKwh:0,planningForecastDay:'today',nightPlanningActive:false};
let count=0;
for(const contract of ['fixed','tou','dynamic_hour','dynamic_quarter'])for(const position of ['early','latest','center']){
 const c=C.normalize();c.year.day={...c.year.day,mode:'maximum',position};
 const s={...settings,contractType:contract,chargeStrategy:c,touRates:[{id:'low',name:'Low',importPrice:.1,weekdayChargeMode:'day',weekendChargeMode:'day'}],touSchedule:[{rateId:'low',start:'07:00',end:'17:00',days:[1,2,3,4,5,6,7]}]};
 const baseline=E.prepareChargeStrategy(state,s,new Date(at),curve);s.chargeStrategy.year.day.planningMarginPercent=20;
 const extra=E.prepareChargeStrategy(state,s,new Date(at),curve);
 assert(Math.abs(extra.requiredHours-baseline.requiredHours*1.2)<1e-8);assert.equal(extra.needKwh,baseline.needKwh);assert.equal(extra.targetSoc,80);assert.equal(extra.gridPowerW,baseline.gridPowerW);if(position==='latest'){assert.equal(extra.reserveEndAt,baseline.reserveEndAt);assert(extra.blocks[0].startAt<baseline.blocks[0].startAt);}
 const progress=E.prepareChargeStrategy({...state,batterySoc:[75,75]},s,new Date(at),curve,null,extra);assert(progress.requiredHours<extra.requiredHours);
 const reached=E.prepareChargeStrategy({...state,batterySoc:[80,80]},s,new Date(at),curve,null,progress);assert.equal(reached.blocks.length,0);
 if(extra.reason==='standard_no_price_advantage'){assert.equal(baseline.reason,extra.reason);count++;continue;}
 assert(extra.blocks.length,JSON.stringify({contract,position,reason:extra.reason}));
 const active=extra.blocks[0].startAt+1000;const result=E.evaluate(state,{...s,batteryChargeStrategyPlan:extra},new Date(active));assert(result.totalCommandW<0);assert(result.plannedChargeW<=settings.maxTotalChargeW);
 const done=E.evaluate({...state,batterySoc:[80,80]},{...s,batteryChargeStrategyPlan:extra},new Date(active));assert.equal(done.plannedChargeW,0);count++;
}
// Night planning and seasonal selection use the same bounded margin.
for(const profile of ['year','summer','winter'])for(const percent of [0,20,100]){
 const c=C.normalize();c.seasonal=profile!=='year';c[profile].night={...c[profile].night,mode:'maximum',position:'latest',planningMarginPercent:percent};
 const ns={...settings,contractType:'fixed',chargeStrategy:c,peakReserveMonth11:profile==='winter',fixedChargeWindowStart:'23:00',fixedChargeWindowEnd:'07:00'};
 const nightAt=new Date('2026-11-03T23:00:00Z'),nightState={...state,nightPlanningActive:true};
 const plan=E.prepareChargeStrategy(nightState,ns,nightAt);assert.equal(plan.profile,profile);assert.equal(plan.planningMarginPercent,percent);assert(Math.abs(plan.requiredHours-.5*(1+percent/100))<1e-8);
}
const old=C.normalize({year:{day:{mode:'standard',extraPercent:0}}});assert.equal(old.year.day.planningMarginPercent,0);
for(const [input,expected] of [[-1,0],[101,100],[null,0],['bad',0],[20,20]])assert.equal(C.normalize({year:{day:{planningMarginPercent:input}}}).year.day.planningMarginPercent,expected);
const standard=C.normalize();standard.year.day.planningMarginPercent=100;assert.equal(E.prepareChargeStrategy(state,{...settings,contractType:'fixed',chargeStrategy:standard},new Date(at)),null,'margin has no effect on standard charging');
console.log(`Charge margin: ${count} contract/position cases; +20% duration, unchanged target/power/end anchor, shorter remaining plan, target stop, default zero and 0–100 validation passed.`);
