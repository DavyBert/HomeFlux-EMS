'use strict';
const assert = require('node:assert/strict');
const { boot, DEFAULTS } = require('./startup-harness');
const { localParts } = require('../lib/homey-energy');
const { evaluate } = require('../lib/ems-engine');
const NativeDate=Date;
const ZONE='Europe/Brussels',start=NativeDate.parse('2026-11-14T23:00:00Z');
let clock=start+3600000;
global.Date=class extends NativeDate{
 constructor(...args){super(...(args.length?args:[clock]));}
 static now(){return clock;}
};
function slots(step){
 const result=[];
 for(let t=start;t<start+48*3600000;t+=step){
  const l=localParts(new Date(t),ZONE),h=(t-start)/3600000;
  const price=h>=9&&h<15?.09:h>=7&&h<9?.75:h<7?.33:.49;
  result.push({startMs:t,dateKey:l.dateKey,minute:l.minuteOfDay,price});
 }
 return result;
}
(async()=>{
 try{
  for(const mode of ['dynamic_hour','dynamic_quarter']){
   const settings={...DEFAULTS,contractType:mode,timezone:ZONE, dynamicPriceSources:['external'],dynamicPriceSource:'external',
    cheapHours:6,expensiveHours:8,peakShaveEnabled:false,batteryCount:1,totalCapacityKwh:20,
    minSoc:10,safetySoc:14,maxSoc:100,maxTotalChargeW:2500,maxChargePerBatteryW:2500,
    forcedMode:'auto',expectedEnergyNeedKwh:20,nightTargetTime:'07:00',solarTargetTime:'17:00',
    sunChanceReserveEnabled:false,peakReserveNightEnabled:false};
   const {app}=await boot();app.getSettings=()=>settings;
   app.externalEnergy={...app.externalEnergy,slots:slots(mode==='dynamic_hour'?3600000:900000),curveUpdatedAt:clock,currentUpdatedAt:clock,currentPrice:.33};
   app.externalEnergyResampleCache=null;
   const runtime=app.getRuntimeSettings(settings);
   assert(runtime.dynamicTariffTimeline.some(r=>r.className==='normal'&&r.startMs<=clock&&r.endMs>clock));
   const state=app.getEvaluationState(settings,clock);
   Object.assign(state,{batterySoc:[20],lastTotalCommandW:0,gridPowerW:300,
    controlGridPowerW:300,nightPlanningActive:true,planningForecastDay:'today',
    targetSocOverride:80,forecastTomorrowKwh:0,pvPowerW:0});
   app.refreshControlContext(settings,state,clock);
   const decision=app.controlRuntimeSettings.dynamicChargeDeferral;
   assert(decision?.active, `${mode}: missing deferral`);
   assert(decision.peakDemandKwh>1,`${mode}: reserve should cover 07:00-09:00 peak`);
   assert(app.controlRuntimeSettings.batteryNightPlan?.targetSoc<80);
   const result=evaluate(state,app.controlRuntimeSettings,new Date(clock),app.controlContext);
   assert(result.planningChargeTargetSoc<80);assert(result.planningChargeTargetSoc>=decision.peakReserveSoc);
   assert(result.safetySocRecoveryActive===false);
   console.log('PASS',mode,'preload target',decision.preloadTargetSoc,'night plan',app.controlRuntimeSettings.batteryNightPlan.targetSoc);
  }
 }finally{global.Date=NativeDate;}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
