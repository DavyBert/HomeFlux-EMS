'use strict';
const assert = require('node:assert/strict');
const {boot,DEFAULTS}=require('./startup-harness');
const {evaluate}=require('../lib/ems-engine');
const now = new Date('2026-09-25T21:36:00Z');
const priorities=['battery_first','share','ev_first'];
function settings(extra={}) {
 return {...DEFAULTS,timezone:'UTC',batteryCount:1,totalCapacityKwh:20,maxChargePerBatteryW:10000,maxDischargePerBatteryW:10000,maxTotalChargeW:10000,maxTotalDischargeW:10000,controlProfile:'exact',gridZeroMinW:-5,gridZeroMaxW:5,peakShaveEnabled:true,peakLimitW:17000,peakSoftMarginW:0,contractType:'tou',touRates:[{id:'dal',name:'Dal',importPrice:.2,weekdayChargeMode:'always',weekendChargeMode:'always',lowForecastBatterySave:true,lowForecastDischargeToTarget:true,evChargeAllowed:true,evPvChargeAllowed:true,evMaxGridImportW:16000}],touSchedule:[{rateId:'dal',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]}],evCount:1,evEnabled:true,evSocEnabled:false,evMode:'smart',evControlType:'current',evPhases:3,evVoltage:380,evVoltageReference:'line',evMaxCurrentA:16,evStandardCurrentA:16,evModeStandardCurrentA:16,evCommandIntervalSeconds:1,evSkipFeedbackValidation:true,...extra};
}
async function setup(s) {
 const {app}=await boot();app.getSettings=()=>s;app.getRuntimeSettings=x=>x;app.getPvCurtailmentHeadroomW=()=>0;
 app.state={...app.state,gridPowerW:10181,pvPowerW:0,batterySoc:[84],lastTotalCommandW:-6000,targetSocOverride:77.8,forecastRemainingKwh:0,forecastTomorrowKwh:0,nightPlanningActive:true,planningForecastDay:'tomorrow',evConnected:true,evChargeCurrentA:16};
 app.inputSeen.ev={soc:false,connected:true,chargeCurrent:true};app.inputUpdatedAt.ev={connected:now.getTime(),chargeCurrent:now.getTime()};
 app.lastPublishedEvAllowed=true;app.lastPublishedEvCurrentA=16;app.lastEvPublishedAt=now.getTime()-1000;app.lastPublishedEvChargeMode='standard';
 app.latestEvDecision={connected:true,intentionalGridImport:true,selectedTariff:true,portfolioGridImportTargetW:16000,desiredCurrentA:16,requestedPowerW:10531,effectiveChargeMode:'standard'};
 app.evSessionDetection={};return app;
}
async function stuckCharging() {
 for(const priority of priorities)for(const type of ['current','hybrid','mode']) {
  const s=settings({evSmartGridPriority:priority,evControlType:type,controlProfile:'normal'}),app=await setup(s);
  // The car is full; deliberately echoed 16 A feedback and a large stale EV
  // permission must never let battery charging finance its own continuation.
  let output=-6000;
  for(let tick=0;tick<10;tick++) {
   app.state.lastTotalCommandW=output;app.state.gridPowerW=4181-output;
   const allowance=app.getEvGridImportControlStatus(s,now.getTime());
   assert.equal(allowance.activeTargetW,4181,'Exclude charging for every priority/control type');
   const r=evaluate({...app.state,controlGridPowerW:app.state.gridPowerW-allowance.activeTargetW},s,now);
   assert(r.totalCommandW>=output,'Old charging must monotonically decrease');
   if(r.totalCommandW< -25)assert.equal(r.action,'grid_charge','Residual grid charging is not solar');
   output=r.totalCommandW;
  }
  assert(Math.abs(output)<=5);
  app.state.gridPowerW=-200;app.state.lastTotalCommandW=1000;
  assert.equal(app.getEvGridImportControlStatus(s,now.getTime()).activeTargetW,800,'Net export must also be subtracted');
  app.latestEvDecision={...app.latestEvDecision,desiredCurrentA:0,intentionalGridImport:false};
  assert.equal(app.getEvGridImportControlStatus(s,now.getTime()).activeTargetW,0,'Stopped EV releases allowance');
 }
}
async function priorityCycles(type) {
 const final={};
 for(const priority of priorities) {
  const s=settings({evSmartGridPriority:priority,evControlType:type,evModeSmartCurrentA:10,evModeStandardCurrentA:20,evPhases:1,evVoltage:230,evVoltageReference:'phase',evMaxCurrentA:32,evStandardCurrentA:32,peakLimitW:9000});
  s.touRates[0].evMaxGridImportW=7000;
  const app=await setup(s);app.state.batterySoc=[20];app.state.targetSocOverride=80;
  app.latestEvDecision=null;app.lastPublishedEvCurrentA=0;app.lastPublishedEvChargeMode='stop';app.state.evChargeCurrentA=0;
  let battery=-5000,evW=0;
  for(let tick=0;tick<30;tick++) {
   app.state.lastTotalCommandW=battery;app.state.gridPowerW=400+evW-battery;
   const limit=app.getPlannedBatteryGridLimitW(s,now.getTime());
   const control=app.getEvGridImportControlStatus(s,now.getTime());
   // Fixed target/horizon produces a 5 kW plan independently of coordination.
   const r=evaluate({...app.state,controlGridPowerW:app.state.gridPowerW-control.activeTargetW,plannedBatteryGridLimitW:limit},s,now,{tariff:{kind:'tou',className:'cheap',rateId:'dal',planningWindowEligibleNow:true,selectedChargeMinutes:144},targetDetails:require('../lib/ems-engine').prepareControlContext(app.state,s,now).targetDetails});
   const decision=app.calculateEvPortfolioDecisions({...r,candidateTotalCommandW:r.totalCommandW},r.totalCommandW,battery,s)[0];
   assert(400+decision.desiredPowerW-battery<=7001,'EV must not exceed shared meter ceiling before battery reduction takes effect');
   app.latestEvDecision=decision;app.lastPublishedEvChargeMode=decision.effectiveChargeMode;
   battery=r.totalCommandW;evW=decision.desiredPowerW;
   app.lastPublishedEvCurrentA=decision.desiredCurrentA;app.state.evChargeCurrentA=decision.desiredCurrentA;app.lastPublishedEvAllowed=decision.allowed;app.lastEvPublishedAt=now.getTime()-1000;
   assert(400+evW-battery<=9001,'Combined physical result respects Peak Guard');
  }
  final[priority]={battery,evW};
  // Ending the EV session immediately releases the priority reservation.
  app.latestEvDecision=null;
  assert.equal(app.getPlannedBatteryGridLimitW(s,now.getTime()),null);
 }
 console.log(type+' priority steady states:',JSON.stringify(final));
 assert(final.battery_first.battery<final.share.battery);
 assert(final.share.battery<final.ev_first.battery);
 assert(final.battery_first.evW<final.share.evW);
 assert(final.share.evW<final.ev_first.evW);
}
async function releaseAndSolar() {
 const s=settings({evSmartGridPriority:'ev_first',evSkipFeedbackValidation:false});
 const app=await setup(s);
 app.state.evChargeCurrentA=0;
 assert.equal(app.getEvGridImportControlStatus(s,now.getTime()).activeTargetW,0,'Real zero-current feedback cannot confirm 16 A');
 app.state.evChargeCurrentA=16;
 assert(app.getPlannedBatteryGridLimitW(s,now.getTime())!==null);
 app.state.evConnected=false;
 assert.equal(app.getPlannedBatteryGridLimitW(s,now.getTime()),null,'Disconnected car releases priority reservation');
 app.state.evConnected=true;
 s.touRates[0].evChargeAllowed=false;
 app.latestEvDecision.pvGridTopUpAllowed=true;app.latestEvDecision.gridRequestPowerW=5000;
 assert.equal(app.getPlannedBatteryGridLimitW(s,now.getTime()),null,'Tariff transition releases an obsolete top-up reservation');
 const solarSettings={...settings(),contractType:'fixed',fixedChargeWindowStart:'00:00',fixedChargeWindowEnd:'23:59'};
 const solar=evaluate({batterySoc:[20],targetSocOverride:80,lastTotalCommandW:-2000,gridPowerW:-1000,pvPowerW:0,plannedBatteryGridLimitW:0},solarSettings,now);
 assert.equal(solar.totalCommandW,-3000,'EV grid priority must not cap physical solar capture');
 assert.equal(solar.gridChargeAssistW,0);
}
(async()=>{await stuckCharging();await releaseAndSolar();for(const type of ['current','hybrid','mode'])await priorityCycles(type);console.log('0.9.1 battery/EV regression tests passed');})().catch(e=>{console.error(e);process.exitCode=1});
