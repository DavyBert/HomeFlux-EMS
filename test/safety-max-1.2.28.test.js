'use strict';
const assert=require('node:assert/strict'),E=require('../lib/ems-engine'),P=require('../lib/phase-guard');
const now=new Date('2026-11-05T12:00:00Z');
const base={...E.DEFAULTS,timezone:'UTC',batteryCount:2,totalCapacityKwh:21.6,minSoc:10,safetySoc:23,maxSoc:90,forcedMode:'auto',maxChargePerBatteryW:2400,maxTotalChargeW:4000,peakLimitW:10000,peakSoftMarginW:100,peakShaveEnabled:true,fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'02:00',solarTargetTime:'17:00',sunnyMonthsMinSocEnabled:false,peakReserveTargetSoc:0,lowForecastFixedEnabled:true};
const state={batterySoc:[22.99,22.99],gridPowerW:500,controlGridPowerW:500,pvPowerW:0,lastTotalCommandW:0,lastBatteryCommands:[0,0],forecastRemainingKwh:0,forecastTomorrowKwh:0,forecastDailyMaxKwh:0,nightPlanningActive:false,plannedBatteryGridLimitW:0};
let cases=0;
for(const contractType of ['fixed','tou','dynamic_hour','dynamic_quarter']){
 const s={...base,contractType,dynamicPriceDataReady:false,touRates:[{id:'peak',name:'Peak',importPrice:.5,weekdayChargeMode:'never',weekendChargeMode:'never'}],touSchedule:[{rateId:'peak',start:'00:00',end:'23:59',days:[1,2,3,4,5,6,7]}]};
 const r=E.evaluate(state,s,now);assert.equal(r.safetySocRecoveryActive,true);assert.equal(r.plannedChargeW,4000);assert.equal(r.totalCommandW,-4000);cases++;
 const reached=E.evaluate({...state,batterySoc:[23,23]},s,now);assert.equal(reached.safetySocRecoveryActive,false);cases++;
}
const limited=E.evaluate(state,{...base,individualBatteryPowerLimitsEnabled:true,battery1MaxChargeW:600,battery2MaxChargeW:800,battery1CapacityKwh:5.4,battery2CapacityKwh:16.2,maxTotalChargeW:10000},now);assert.equal(limited.plannedChargeW,1400);assert.equal(limited.totalCommandW,-1400);assert(limited.commands[0]>=-600&&limited.commands[1]>=-800);cases++;
const peak=E.evaluate({...state,gridPowerW:2000,controlGridPowerW:2000},{...base,peakLimitW:2650},now);assert(peak.totalCommandW>=-550);assert(peak.totalCommandW<0);cases++;
const overloaded=E.evaluate({...state,gridPowerW:4000,controlGridPowerW:4000},{...base,peakLimitW:2650},now);assert(overloaded.totalCommandW>=0);cases++;
assert.equal(E.evaluate({...state,batterySoc:[null,null]},base,now).totalCommandW,0);cases++;
assert.equal(E.evaluate(state,{...base,forcedMode:'standby'},now).safetySocRecoveryActive,false);cases++;
const s={...base,phaseGuard:{...P.defaults,enabled:true,phases:3,voltage:230,amps:25,limitW:4500,batteries:['L1','L2']}};
function phaseApp(watts){return {state,lastEmittedCommands:[0,0],phaseGuardRuntime:{lastIncreaseAt:now.getTime()},gridPhases:watts.map(watts=>({watts,at:now.getTime()}))};}
const a=phaseApp([500,500,500]);let r={safetySocRecoveryActive:true,candidateCommands:[-2000,-2000]};P.apply(a,r,s,now.getTime());assert.deepEqual(r.candidateCommands,[-2000,-2000],'safety recovery must not be reduced to100 W recovery steps');cases++;
const b=phaseApp([4300,500,500]);r={safetySocRecoveryActive:true,candidateCommands:[-2000,-2000]};P.apply(b,r,s,now.getTime());assert.equal(r.candidateCommands[0],-100);assert(P.charge(r.candidateCommands)<=4000);cases++;
const c=phaseApp([500,500,500]);c.gridPhases[0].at-=16000;r={safetySocRecoveryActive:true,candidateCommands:[-2000,-2000]};P.apply(c,r,s,now.getTime());assert.deepEqual(r.candidateCommands,[0,0]);cases++;
console.log(`Safety recovery: ${cases} full-power/target/tariff/individual/Peak Guard/phase/stale/Standby checks passed.`);

// Actual application path: the requested full recovery survives context,
// phase safety and publication (only Homey I/O and time are mocked).
(async()=>{
 const {setup,installVirtualClearTimeout}=require('./pv-source-harness');const original=Date.now,restore=installVirtualClearTimeout();
 try{
  const h=await setup(undefined,{forcedMode:'auto',safetySoc:23,minSoc:10,peakLimitW:10000,exportLimitEnabled:false,maxTotalChargeW:6000,phaseGuard:{...P.defaults,enabled:true,phases:3,voltage:230,amps:25,limitW:4500,batteries:Array(8).fill('balanced3')}},now.getTime(),0);
  h.app.state.batterySoc=[22.99,22.99,22.99,22.99];h.app.state.gridPowerW=1500;P.ingest(h.app,{l1:500,l2:500,l3:500},h.now());
  await h.start();await h.flush();assert.equal(h.app.latestResult.safetySocRecoveryActive,true);assert.equal(h.app.state.lastTotalCommandW,-6000);assert.deepEqual(h.errors,[]);
  console.log('Safety recovery: real app context/phase/publication emits full6000 W within grid limits.');
 }finally{Date.now=original;restore();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
