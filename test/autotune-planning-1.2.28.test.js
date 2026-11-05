'use strict';
const assert=require('node:assert/strict');
const A=require('../lib/autotune-planning'),E=require('../lib/ems-engine');
const today='2026-11-04',s={...E.DEFAULTS,batteryCount:1,totalCapacityKwh:21.6,minSoc:14,safetySoc:14,maxSoc:100,dayPlanningMaxSoc:80,expectedEnergyNeedKwh:12,lowForecastSelfConsumptionMinKwh:12,batterySaveDischargeAboveSoc:50};
function days(extra={}){return Array.from({length:10},(_,i)=>({dateKey:'2026-10-'+(22+i),season:'autumn',evidenceVersion:2,sampleHours:24,reliableHours:24,estimatedDemandKwh:16,pvProductionKwh:15,forecastKwh:16,solarTargetSoc:60,goalSoc:80,minObservedSoc:15,directPvEstimateKwh:3,exportKwh:0,expensiveHours:4,expensiveReliableHours:4,expensiveUncoveredKwh:3.5,expensiveMinSoc:15,protectedFloorSoc:14,...extra}));}
const rec=(ds,key,settings=s)=>A.recommendations(ds,settings,today).find(x=>x.key===key);
let checks=0;
for(const [extra,type] of [[{solarTargetSoc:80,goalSoc:80},'configured_goal_reached'],[{storageFullHours:2,solarTargetSoc:100},'storage_full'],[{exportKwh:8},'pv_available_but_not_stored'],[{powerLimitedHours:1},'charge_power_limited'],[{curtailmentHours:1},'curtailment'],[{directPvEstimateKwh:14},'direct_household_consumption'],[{reliableHours:2},'insufficient_data'],[{configurationChanged:true},'insufficient_data'],[{},'insufficient_pv']]){
 const d=days(extra);assert.equal(A.classification(d[0]),type);
 if(type!=='insufficient_pv'){const r=rec(d,'lowForecastSelfConsumptionMinKwh');assert(!r||r.recommended<=12,'restricted/fulfilled/unreliable days cannot justify an increase');}checks++;
}
{
 const r=rec(days(),'lowForecastSelfConsumptionMinKwh');assert.equal(r.recommended,13);assert.equal(r.current,12);assert.equal(r.measurementPeriod.days,10);assert.equal(r.confidence,95);assert.equal(r.reviewOnly,true);assert(r.reason&&r.evidence.length===10);checks++;
 assert.equal(rec(days().slice(0,6),'lowForecastSelfConsumptionMinKwh'),undefined);checks++;
 assert.equal(rec(days().map(d=>({...d,evidenceVersion:undefined})),'lowForecastSelfConsumptionMinKwh'),undefined);checks++;
 assert.equal(rec(days().map(d=>({...d,season:'summer'})),'lowForecastSelfConsumptionMinKwh'),undefined);checks++;
 assert.equal(rec(days().map(d=>({...d,dateKey:'2025-10-01'})),'lowForecastSelfConsumptionMinKwh'),undefined);checks++;
 assert.equal(rec(days().map(d=>({...d,pvProductionKwh:2})),'lowForecastSelfConsumptionMinKwh'),undefined,'forecast failure alone must not inflate low-PV threshold');checks++;
}
{
 const r=rec(days(),'expectedEnergyNeedKwh');assert.equal(r.recommended,13);assert.equal(r.reviewOnly,true);assert(r.reason.includes('eenmaal'));checks++;
 const app={inputSeen:{batterySoc:[true]},inputUpdatedAt:{batterySoc:[Date.now()]},state:{batterySoc:[30],gridPowerW:500,pvPowerW:0},planningCache:{value:{plan:{sunnyMonthsMinSocActive:true,sunnyMonthsMinSoc:20}}}};
 const b=A.energyEvidence(app,s,days(),today);assert.equal(b.technicalAndSeasonalFloorSoc,20);assert.equal(b.extraReserveKwh,0);assert.equal(b.uncoveredDemandKwh,3.5);assert.equal(b.dischargeEfficiency,null);assert.equal(b.futurePvCreditKwh,null);assert.equal(b.futureGridChargeCreditKwh,0);assert(Math.abs(b.availableNominalBatteryKwh-2.16)<1e-8);assert(Math.abs(b.nominalShortfallKwh-1.34)<1e-8);checks++;
}
{
 const high=days({expensiveMinSoc:40,minObservedSoc:16,nightTargetSoc:95});assert.equal(rec(high,'batterySaveDischargeAboveSoc'),undefined,'charged morning cannot erase the daily low');checks++;
 const lower=rec(days({expensiveMinSoc:40,minObservedSoc:35}),'batterySaveDischargeAboveSoc');assert.equal(lower.recommended,48);checks++;
 assert.equal(rec(days({expensiveMinSoc:40,minObservedSoc:null}),'batterySaveDischargeAboveSoc'),undefined);checks++;
}
{
 const app={inputSeen:{batterySoc:[true]},inputUpdatedAt:{batterySoc:[1000],grid:1000,pv:1000},state:{},planningCache:{value:{plan:{planningPhase:'night',targetSoc:16}}},latestResult:{tariff:{className:'expensive'}}};
 const day={dateKey:'2026-11-03',previousBatteryW:0};
 A.observe(app,day,s,{gapMs:60000,pvW:500,gridW:200,batteryW:0,siteWithoutEvW:700,avgSoc:80,now:1000});
 assert.equal(day.goalSoc,80,'night target must not become daytime PV target');assert(day.goalLimitedHours>0);assert.equal(day.expensiveMinSoc,80);assert.equal(day.evidenceVersion,2);checks++;
 app.inputUpdatedAt.batterySoc[0]=-600000;A.observe(app,day,s,{gapMs:60000,pvW:500,gridW:200,batteryW:0,siteWithoutEvW:700,avgSoc:90,now:1000});assert.equal(day.expensiveMinSoc,80,'stale SoC must not become expensive-period evidence');checks++;
 A.observe(app,day,{...s,dayPlanningMaxSoc:90},{gapMs:60000,pvW:500,gridW:200,batteryW:0,siteWithoutEvW:700,avgSoc:80,now:2000});assert.equal(day.configurationChanged,true);checks++;
 const restored=A.summary(day);assert.equal(restored.configurationChanged,true);assert(!('configurationSignature'in restored));checks++;
}
assert(!A.recommendations(days({goalSoc:100,solarTargetSoc:80}),s,today,80).some(r=>r.key==='lowForecastSelfConsumptionMinKwh'&&r.recommended>12),'user review goal cannot create a false PV deficit');checks++;
console.log(`AutoTune planning 1.2.28: ${checks} focused evidence/energy/goal/season checks passed.`);
