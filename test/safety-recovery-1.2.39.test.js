'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const E=require('../lib/ems-engine');const previousRoot=process.env.HOMEFLUX_BASELINE_138;
const now=new Date('2026-11-08T03:56:00Z');
const settings={...E.DEFAULTS,batteryCount:4,totalCapacityKwh:21.6,minSoc:5,safetySoc:7,maxSoc:100,maxTotalChargeW:10000,maxChargePerBatteryW:5000,controlProfile:'exact',peakShaveEnabled:false,forcedMode:'auto',contractType:'fixed',fixedChargeWindowStart:'00:00',fixedChargeWindowEnd:'23:59',timezone:'Europe/Brussels'};
const state={batterySoc:[6,6,6,6],gridPowerW:0,pvPowerW:0,lastTotalCommandW:0,forecastRemainingKwh:0,forecastDailyMaxKwh:0,forecastTomorrowKwh:0,targetSocOverride:7};
const cases=[],check=(name,fn)=>{fn();cases.push(name);};
const calc=(soc=6,s={},a={})=>E.evaluate({...state,batterySoc:Array(4).fill(soc),...a},{...settings,...s},now);
check('A 1 percentage point deficit in 21.6 kWh asks 1296 W, not 10 kW',()=>{const r=calc();assert(r.safetySocRecoveryActive);assert.equal(r.plannedChargeW,1296);assert.equal(r.totalCommandW,-1296);});
check('Requested recovery tapers to the 250 W floor as SoC approaches safety',()=>{assert.equal(calc(6.5).plannedChargeW,648);assert.equal(calc(6.9).plannedChargeW,250);});
check('Floor obeys limits below 250 W, including a disabled charge ceiling',()=>{for(const cap of [0,100,200]){const r=calc(6.99,{maxTotalChargeW:cap});assert.equal(r.plannedChargeW,cap);assert(Math.abs(r.totalCommandW)<=cap);}});
check('A large deficit can reach the configured maximum but never bypasses battery limits',()=>{
 const r=calc(0,{safetySoc:50});assert.equal(r.plannedChargeW,10000);assert(Math.abs(r.totalCommandW)<=10000);
 const capped=calc(0,{safetySoc:50,maxChargePerBatteryW:600});assert.equal(capped.plannedChargeW,2400);assert(Math.abs(capped.totalCommandW)<=2400);
});
check('Peak Guard still caps recovery below the recovery floor when necessary',()=>{const r=calc(0,{safetySoc:50,peakShaveEnabled:true,peakLimitW:2650,peakSoftMarginW:100},{gridPowerW:2500});assert(r.safetySocRecoveryActive);assert(r.plannedChargeW===10000);assert(r.totalCommandW>=-150);});
check('Recovery exits exactly at safety without a new latch or discharge block',()=>{const r=calc(7);assert.equal(r.safetySocRecoveryActive,false);assert.equal(r.plannedChargeW,0);assert.equal(r.totalCommandW,0);assert.equal(calc(8,{}, {gridPowerW:500}).totalCommandW,492);});
check('Reaching safety after two minutes ends recovery; ten minutes is not a mandatory duration',()=>{
 const end=E.evaluate({...state,batterySoc:[7,7,7,7],lastTotalCommandW:-1296,gridPowerW:1296},settings,new Date(now.getTime()+120000));
 assert.equal(end.safetySocRecoveryActive,false);assert.equal(end.plannedChargeW,0);assert(end.totalCommandW>=-20);
});
check('Effective capacity uses only valid batteries and respects individual capacities',()=>{
 const partial=calc(6,{}, {batterySoc:[6,6,null,null]});assert.equal(partial.plannedChargeW,648);
 const s={individualBatteryPowerLimitsEnabled:true,battery1CapacityKwh:2,battery2CapacityKwh:4,battery3CapacityKwh:6,battery4CapacityKwh:8};assert.equal(calc(6,s).plannedChargeW,1200);
});
check('Safety target remains clamped to the existing configured min/max range',()=>{assert.equal(calc(6,{minSoc:8,safetySoc:7}).plannedChargeW,2592);assert.equal(calc(6,{maxSoc:6.5,safetySoc:7}).plannedChargeW,648);});
check('Safety recovery stays independent of cheap/expensive tariff windows',()=>{
 for(const change of [{fixedChargeWindowStart:'12:00',fixedChargeWindowEnd:'13:00'},{contractType:'tou',touRates:[{id:'peak',name:'Peak',importPrice:1}],touSchedule:[{rateId:'peak',start:'00:00',end:'23:59',days:[1,2,3,4,5,6,7]}]}])assert.equal(calc(6,change).plannedChargeW,1296);

});
let equivalent=0;
if(previousRoot){const old=require(previousRoot+'/lib/ems-engine');
 check('400 non-recovery input combinations retain the exact 1.2.38 engine output',()=>{
 for(let i=0;i<400;i++){
  const s={...settings,safetySoc:5,forcedMode:['auto','charge','discharge','standby','solar_capture'][i%5],controlProfile:['exact','balanced','gentle'][i%3],peakShaveEnabled:i%2===0,peakLimitW:2650,balanceEnabled:i%2===1,optimizeMultiBatteryEfficiency:i%3===0,maxTotalChargeW:6000};
  const a={...state,batterySoc:[30+i%50,40+i%30,50+i%20,60+i%10],gridPowerW:(i%17)*300-2000,pvPowerW:(i%13)*500,lastTotalCommandW:(i%7)*200-600,targetSocOverride:50+i%30};
  const x=old.evaluate(structuredClone(a),s,now),y=E.evaluate(structuredClone(a),s,now);assert(!x.safetySocRecoveryActive);assert.deepEqual(y,x);equivalent++;
 }
 });
}
fs.writeFileSync('validation/safety-recovery-1.2.39.json',JSON.stringify({passed:cases.length,cases,unchanged138Comparisons:equivalent},null,2)+'\n');
console.log(`Safety recovery: ${cases.length} groups passed; ${equivalent} unchanged non-recovery comparisons.`);
