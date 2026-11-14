'use strict';
// Compact evidence collected by existing slow housekeeping only. Measured PV
// and P1 are separate from command-derived energy estimates; no invented history.
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const median=xs=>{const a=xs.filter(finite).map(Number).sort((a,b)=>a-b);return a.length?a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2:null;};
const season=date=>{const m=Number(String(date).slice(5,7));return [12,1,2].includes(m)?'winter':[3,4,5].includes(m)?'spring':[6,7,8].includes(m)?'summer':'autumn';};
const round=x=>Math.round(x*2)/2;
function socFresh(app,settings,now){const count=Number(settings.batteryCount)||0,ttl=require('./input-warnings').LIMITS.batterySoc*60000;return count>0&&Array.from({length:count},(_,i)=>i).every(i=>app.inputSeen?.batterySoc?.[i]&&Number(app.inputUpdatedAt?.batterySoc?.[i])>0&&now>=app.inputUpdatedAt.batterySoc[i]&&now-app.inputUpdatedAt.batterySoc[i]<=ttl);}
function observe(app,day,settings,{gapMs,pvW,gridW,batteryW,siteWithoutEvW,avgSoc,now}){
 const h=gapMs/3600000;
 day.evidenceVersion=2;day.season=season(day.dateKey);
 const sum=(key,value)=>day[key]=(Number(day[key])||0)+value;
 sum('pvProductionKwh',Math.max(0,pvW)*h/1000);sum('exportKwh',Math.max(0,-gridW)*h/1000);
 const totalLoad=Math.max(0,gridW+pvW+batteryW);
 sum('directPvEstimateKwh',Math.min(pvW,totalLoad)*h/1000);
 sum('pvBatteryEstimateKwh',Math.min(Math.max(0,-batteryW),Math.max(0,pvW-totalLoad))*h/1000);
 const uncovered=Math.max(0,siteWithoutEvW-pvW)*h/1000;sum('uncoveredDemandKwh',uncovered);
 if(app.latestResult?.tariff?.className==='expensive'){sum('expensiveUncoveredKwh',uncovered);sum('expensiveHours',h);if(socFresh(app,settings,now)&&finite(avgSoc))day.expensiveMinSoc=Math.min(day.expensiveMinSoc??100,avgSoc);}
 const plan=app.planningCache?.value?.plan||{};
 // Never turn a low night target into the daytime solar goal. A changed
 // daytime cap makes this day non-representative rather than inventing a goal.
 const goal=Math.min(Number(settings.maxSoc)||100,Number(settings.dayPlanningMaxSoc)||100);
 if(finite(day.goalSoc)&&Math.abs(day.goalSoc-goal)>.1)day.configurationChanged=true;
 day.goalSoc=goal;
 const signature=JSON.stringify([settings.maxSoc,settings.dayPlanningMaxSoc,settings.maxTotalChargeW,settings.totalCapacityKwh,settings.batteryCount,settings.minSoc,settings.safetySoc]);
 if(day.configurationSignature&&day.configurationSignature!==signature)day.configurationChanged=true;
 day.configurationSignature=signature;
 const protectedFloor=Math.max(Number(settings.minSoc)||0,Number(settings.safetySoc)||0,plan.sunnyMonthsMinSocActive?Number(plan.sunnyMonthsMinSoc)||0:0);
 day.protectedFloorSoc=Math.max(Number(day.protectedFloorSoc)||0,protectedFloor);
 if(pvW>100&&finite(avgSoc)&&avgSoc>=goal-.5)sum('goalLimitedHours',h);
 if(finite(avgSoc)&&avgSoc>=Number(settings.maxSoc)-.5)sum('storageFullHours',h);
 if(-batteryW>=Number(settings.maxTotalChargeW)*.9&&gridW<-200)sum('powerLimitedHours',h);
 if(finite(app.lastPublishedPvLimitPercent)&&app.lastPublishedPvLimitPercent<99)sum('curtailmentHours',h);
 // A command is not a physical meter. Exclude unstable/delegated periods from
 // energy recommendations rather than presenting their allocation as measured.
 const stable=finite(day.previousBatteryW)&&Math.abs(batteryW-day.previousBatteryW)<=200&&!app.inFlightBatteryCommands&&!app.batteryResponseTest?.running&&!app.hybridEmsRuntime?.delegated;
 day.previousBatteryW=batteryW;
 if(stable&&socFresh(app,settings,now)&&Number(app.inputUpdatedAt?.grid)>0&&Number(app.inputUpdatedAt?.pv)>0){sum('reliableHours',h);if(app.latestResult?.tariff?.className==='expensive')sum('expensiveReliableHours',h);}
}
const fields=['configurationChanged','protectedFloorSoc','evidenceVersion','season','goalSoc','pvProductionKwh','exportKwh','directPvEstimateKwh','pvBatteryEstimateKwh','uncoveredDemandKwh','expensiveUncoveredKwh','expensiveReliableHours','expensiveHours','expensiveMinSoc','goalLimitedHours','storageFullHours','powerLimitedHours','curtailmentHours','reliableHours'];
function summary(day){return Object.fromEntries(fields.map(k=>[k,day[k]??null]));}
function classification(d){
 if(d.configurationChanged||d.evidenceVersion!==2||Number(d.sampleHours)<18||Number(d.reliableHours)<18||!finite(d.pvProductionKwh))return 'insufficient_data';
 if(Number(d.curtailmentHours)>.1)return 'curtailment';
 if(Number(d.storageFullHours)>.1)return 'storage_full';
 if(Number(d.goalLimitedHours)>.1||finite(d.solarTargetSoc)&&finite(d.goalSoc)&&d.solarTargetSoc>=d.goalSoc-.5)return 'configured_goal_reached';
 if(Number(d.powerLimitedHours)>.1)return 'charge_power_limited';
 if(Number(d.exportKwh)>.5)return 'pv_available_but_not_stored';
 if(Number(d.directPvEstimateKwh)>Number(d.pvProductionKwh)*.8)return 'direct_household_consumption';
 return 'insufficient_pv';
}
function recommendations(days,settings,nowDate,desiredSoc=null){
 const targetSeason=season(nowDate),usable=[...new Map(days.map(d=>[d.dateKey,finite(desiredSoc)&&finite(d.goalSoc)?{...d,goalSoc:Math.min(Number(d.goalSoc),Number(desiredSoc))}:d])).values()].filter(d=>!d.configurationChanged&&d.evidenceVersion===2&&d.season===targetSeason&&String(d.dateKey)<nowDate&&Date.parse(nowDate)-Date.parse(d.dateKey)<=42*86400000&&Number(d.sampleHours)>=18&&Number(d.reliableHours)>=18&&finite(d.estimatedDemandKwh)).sort((a,b)=>String(a.dateKey).localeCompare(String(b.dateKey)));
 if(usable.length<7)return [];
 const period={from:usable[0].dateKey,to:usable.at(-1).dateKey,days:usable.length,season:targetSeason};
 const results=[];const push=(key,current,value,reason)=>{
  if(!finite(current)||!finite(value)||Math.abs(current-value)<.49)return;
  results.push({key,current:Number(current),recommended:value,reason,measurementPeriod:period,confidence:Math.round(Math.min(.97,.52+.45*(1-Math.exp(-usable.length/3)))*100),evidence:usable.map(d=>({date:d.dateKey,classification:classification(d)}))});
 };
 const demands=usable.map(d=>d.estimatedDemandKwh*24/Math.min(24,d.sampleHours));
 const currentNeed=Number(settings.expectedEnergyNeedKwh),measuredNeed=median(demands);
 // This setting is DAILY gross non-EV demand. The live planner already
 // subtracts forecast PV; writing a net deficit here would subtract PV twice.
 const stepNeed=Math.max(.5,Math.min(1,currentNeed*.1));
 const shortageDays=usable.filter(d=>finite(d.minObservedSoc)&&d.minObservedSoc<20).length;
 if(measuredNeed<=currentNeed||shortageDays>=Math.ceil(usable.length/2))push('expectedEnergyNeedKwh',currentNeed,round(Math.max(0,currentNeed+Math.max(-stepNeed,Math.min(stepNeed,measuredNeed-currentNeed)))),'AutoTune: dagelijkse huishoudvraag zonder EV; PV wordt eenmaal door de bestaande planning verrekend.');
 const low=Number(settings.lowForecastSelfConsumptionMinKwh),floor=Math.max(Number(settings.minSoc)||0,Number(settings.safetySoc)||0);
 const good=usable.filter(d=>classification(d)==='configured_goal_reached'||classification(d)==='storage_full');
 const bad=usable.filter(d=>classification(d)==='insufficient_pv'&&finite(d.forecastKwh)&&finite(d.solarTargetSoc)&&d.solarTargetSoc<Number(d.goalSoc)-2&&finite(d.minObservedSoc)&&d.minObservedSoc<=floor+2&&d.pvProductionKwh>=Number(d.forecastKwh)*.6);
 const maxStep=Math.max(.5,Math.min(1,low*.1));let proposed=null;
 if(bad.length>=4&&bad.length>=usable.length*.6){const v=median(bad.map(d=>d.forecastKwh));if(v>low+.5)proposed=Math.min(low+maxStep,v);}
 else if(good.length>=5){const v=median(good.map(d=>d.forecastKwh));if(finite(v)&&v<low-1)proposed=Math.max(low-maxStep,v);}
 if(proposed!==null)push('lowForecastSelfConsumptionMinKwh',low,round(Math.max(0,proposed)),'AutoTune: lage PV op representatieve meetdagen; volle opslag, bereikt doel, vermogensbegrenzing en curtailment gelden niet als PV-tekort.');
 const expensive=usable.filter(d=>Number(d.expensiveReliableHours)>=Math.max(1,Number(d.expensiveHours)*.9)&&finite(d.minObservedSoc)&&finite(d.expensiveMinSoc)&&finite(d.expensiveUncoveredKwh));
 if(expensive.length>=7){
  const current=Number(settings.batterySaveDischargeAboveSoc),minimum=median(expensive.map(d=>d.expensiveMinSoc));
  const lowHits=expensive.filter(d=>d.expensiveMinSoc<=floor+2).length;
  const hard=Math.max(floor,...expensive.map(d=>Number(d.protectedFloorSoc)||0));
  // No measured discharge efficiency exists. Repeated observed minima, not a
  // fictitious efficiency/capacity formula, authorize only small adjustments.
  if(minimum>hard+8&&median(expensive.map(d=>d.minObservedSoc))>hard+8&&current>hard+5)push('batterySaveDischargeAboveSoc',current,Math.max(hard,Math.round(current-2)),'AutoTune: herhaald energieoverschot tijdens dure uren; kleine verlaging zonder veiligheidsreserves op te tellen.');
  else if(lowHits>=5&&current<95)push('batterySaveDischargeAboveSoc',current,Math.min(95,Math.round(current+2)),'AutoTune: herhaald lage SoC tijdens dure uren; kleine verhoging van de spaargrens.');
 }
 return results;
}
// Advisory evidence only: this is not a second planner or a new live floor.
// The observed uncovered expensive-period demand already deducts concurrent PV
// exactly once. No daily forecast is assigned to hours for which no PV profile
// exists, and future scheduled charging is not counted as stored energy.
function energyEvidence(app,settings,days,nowDate){
 const valid=days.filter(d=>!d.configurationChanged&&d.evidenceVersion===2&&d.season===season(nowDate)&&d.dateKey<nowDate&&Date.parse(nowDate)-Date.parse(d.dateKey)<=42*86400000&&Number(d.reliableHours)>=18&&Number(d.expensiveReliableHours)>=Math.max(1,Number(d.expensiveHours)*.9)&&finite(d.expensiveUncoveredKwh));
 const engine=require('./ems-engine'),capacity=engine.computeEffectiveCapacityKwh(app.state||{},settings),soc=engine.computeAverageSoc(app.state||{},settings);
 const plan=app.planningCache?.value?.plan||{};
 const floor=Math.max(Number(settings.minSoc)||0,Number(settings.safetySoc)||0,plan.sunnyMonthsMinSocActive?Number(plan.sunnyMonthsMinSoc)||0:0);
 const uncovered=valid.length>=7?median(valid.map(d=>d.expensiveUncoveredKwh)):null;
 const available=capacity>0&&soc!==null&&socFresh(app,settings,Date.now())?Math.max(0,capacity*(soc-floor)/100):null;
 return {representativeDays:valid.length,period:'observed_expensive_hours',uncoveredDemandKwh:uncovered,availableNominalBatteryKwh:available,technicalAndSeasonalFloorSoc:floor,
  nominalReserveLowerBoundSoc:uncovered!==null&&capacity>0?floor+uncovered/capacity*100:null,
  nominalShortfallKwh:uncovered!==null&&available!==null?Math.max(0,uncovered-available):null,
  dischargeEfficiency:null,extraReserveKwh:0,futureGridChargeCreditKwh:0,futurePvCreditKwh:null,
  source:'observed_uncovered_demand_after_concurrent_pv',estimatedBatteryPower:true,reviewOnly:true,
  limitation:'Geen gemeten batterijrendement of tijdgebonden PV-profiel: energiebalans is indicatief en wijzigt geen live reserve.'};
}
module.exports={observe,summary,classification,recommendations,energyEvidence,socFresh,season,median};
