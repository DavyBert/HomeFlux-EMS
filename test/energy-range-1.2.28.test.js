'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{boot,DEFAULTS}=require('./startup-harness'),E=require('../lib/ems-engine'),W=require('../lib/widget-energy-budget');
(async()=>{
 const s={...DEFAULTS,batteryCount:2,totalCapacityKwh:200,expectedEnergyNeedKwh:180,minSoc:10,safetySoc:14,maxSoc:90,maxTotalChargeW:100000,maxChargePerBatteryW:60000,peakLimitW:20000,settingsSchemaVersion:70};const h=await boot(new Map(Object.entries(s))),a=h.app;
 assert.equal(a.getSettings().expectedEnergyNeedKwh,180);assert.equal(a.normalizeAutoTuneValue('expectedEnergyNeedKwh',180),180);assert.equal(a.getAutoTuneRangeProfile('expectedEnergyNeedKwh').hardMax,5000);assert(a.getDefaultAutoTuneLimit('expectedEnergyNeedKwh',180).max>=180);
 const legacy={expectedEnergyNeedKwh:{min:0,max:100,userDefined:false,minConfidencePercent:95}};assert(a.getAutoTuneLimitFor('expectedEnergyNeedKwh',180,legacy).max>=180);legacy.expectedEnergyNeedKwh.userDefined=true;assert.equal(a.getAutoTuneLimitFor('expectedEnergyNeedKwh',180,legacy).max,100,'explicit user bounds remain unchanged');
 const actual=W.householdDaily({days:[{sampleHours:24,estimatedDemandKwh:180},{sampleHours:24,estimatedDemandKwh:200}]},20);assert.equal(actual.kwh,190,'large measured days must not silently fall back to20');
 assert.equal(W.householdDaily({days:[]},180).kwh,180);
 const state={batterySoc:[50,60],gridPowerW:500,controlGridPowerW:500,pvPowerW:0,lastTotalCommandW:0,forecastRemainingKwh:0,forecastDailyMaxKwh:0,forecastTomorrowKwh:0,nightPlanningActive:false};
 for(const demand of [180,1000,5000]){const settings={...s,expectedEnergyNeedKwh:demand,controlEnabled:true,chargeTestPassed:true,fixedChargeWindowStart:'00:00',fixedChargeWindowEnd:'23:59'},r=E.evaluate(state,settings,new Date('2026-11-04T12:00:00Z'));assert(r.targetSoc<=90);assert(r.totalCommandW>=-100000);assert(r.commands.every(w=>w>=-60000),'individual power limits remain enforced');}
 const html=fs.readFileSync('settings/index.html','utf8');assert.match(html, /id="expectedEnergyNeedKwh" max="5000"/);
 console.log('Energy range:180/1000/5000 kWh accepted; learned high-demand days retained; SoC/individual/total power limits preserved.');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
