'use strict';
const assert=require('node:assert/strict');
const originalNow=Date.now;
const {setup,clock}=require('./hvac-coordination-1.2.15.test');
const H=require('../lib/hvac-permanent');
(async()=>{let checks=0;try{
 const h=await setup(10,{hvacTariffEnabled:true,hvacPvEnabled:true,hvacDirection:'heat',hvacCheapTargetC:21,hvacPvTargetC:25,
 injectionEnabled:true,injectionLimitOptionalLoads:true}),a=h.app;
 a.injectionRuntime={active:true};a.inputUpdatedAt.grid=clock.now();
 function prime(i,room,mode='heat'){
  const r=i?a.getExtraHvac(i):null,input=i?r.state:a.state;
  if(i){Object.assign(input,{roomTemperatureC:room,mode,setpointC:25});r.updatedAt.roomTemperature=clock.now();r.lastPublishedSetpoint=25;r.lastPublishedPower=true;r.lastPublishedMode=mode;}
  else{Object.assign(input,{hvacRoomTemperatureC:room,hvacMode:mode,hvacSetpointC:25});a.inputUpdatedAt.hvac.roomTemperature=clock.now();a.lastPublishedHvacSetpoint=25;a.lastPublishedHvacPower=true;a.lastPublishedHvacMode=mode;}
  Object.assign(H.unit(a,i),{heat:1000,mode,setpoint:25,nextAt:0,powerOff:false});
 }
 for(let i=0;i<10;i++){
  const stem='hvac'+(i?i+1:'');a.setSetting(stem+'TariffEnabled',true);a.setSetting(stem+'PvEnabled',true);a.setSetting(stem+'CheapTargetC',21);a.setSetting(stem+'PvTargetC',25);a.setSetting(stem+'Direction','heat');
  prime(i,21.5);let d=a.calculateHvacControlFor(i,a.latestResult,null,0,0,{allowStart:true});
  assert.equal(d.powerCommand,false,'ordinary target reached '+i);assert(d.desiredSetpointC<=21,'PV boost suppressed '+i);checks++;
  prime(i,18);d=a.calculateHvacControlFor(i,a.latestResult,null,0,0,{allowStart:true});assert.notEqual(d.powerCommand,false,'necessary heat remains '+i);checks++;
 }
 // A satisfied unit that is already OFF must not be restarted by the tariff setpoint pass.
 prime(0,22);a.state.hvacMode='off';H.unit(a,0).powerOff=true;
 let held=a.calculateHvacControlFor(0,a.latestResult,null,0,0,{allowStart:true});assert.notEqual(held.powerCommand,true);assert.equal(held.increase,false);checks++;
 // Essential, keep-running, stale room, power permissions and tariff/COP.
 for(const key of ['EssentialEnabled','KeepOnEnabled']){
  const c=a.getSettings().hvacCoordination;a.setSetting('hvacCoordination',c.map((v,i)=>i? v:{...v,[key]:true}));
  prime(0,21.5);const d=a.calculateHvacControlFor(0,a.latestResult,null,0,0,{allowStart:true});assert.notEqual(d.powerCommand,false,key);checks++;
  a.setSetting('hvacCoordination',a.getSettings().hvacCoordination.map((v,i)=>i?v:{...v,[key]:false}));
 }
 prime(0,22);a.inputUpdatedAt.hvac.roomTemperature=clock.now()-600000;
 let d=a.calculateHvacControlFor(0,a.latestResult,null,0,0,{allowStart:true});assert.notEqual(d.powerCommand,false);assert(d.reason.includes('verse kamertemperatuur'));checks++;
 prime(0,22);a.setSetting('hvacAllowPowerControl',false);d=a.calculateHvacControlFor(0,a.latestResult,null,0,0,{allowStart:true});assert.notEqual(d.powerCommand,false);checks++;
 a.setSetting('hvacAllowPowerControl',true);prime(0,21.5);a.injectionRuntime.active=false;d=a.calculateHvacControlFor(0,a.latestResult,null,0,0,{allowStart:true});assert.notEqual(d.powerCommand,false,'ordinary existing HVAC resumes');checks++;
 // Boiler: only PV is optional; an ongoing mandatory tariff fallback survives.
 a.setSetting('boilerCount',1);a.setSetting('boilerEnabled',true);a.setSetting('boilerStartSoc',40);a.setSetting('boilerStopSoc',20);a.setSetting('boilerTariffStopBatterySoc',10);a.setSetting('peakShaveEnabled',false);
 a.injectionRuntime.active=true;a.state.batterySoc=[95,95,95,95];a.inputUpdatedAt.grid=clock.now();
 a.isBoilerTariffSelected=()=>true;a.isBoilerTariffPeriodAllowed=()=>true;
 a.getBoilerSolarFallbackStatus=()=>({fallbackDue:true,missedSolarDays:4});
 Object.assign(a.boilerState,{outputOn:true,activeSource:'pv',cycleAccumulatedMs:0,lastTickAt:clock.now(),lastCompletedAt:0});
 d=a.calculateBoilerDecision(a.latestResult,a.getSettings(),{now:clock.now()});assert.equal(d.outputCommand,false);assert(d.reason.includes('Optionele'),JSON.stringify(d));checks++;
 Object.assign(a.boilerState,{outputOn:true,activeSource:'tariff',cycleAccumulatedMs:0,lastTickAt:clock.now(),lastCompletedAt:0});
 d=a.calculateBoilerDecision(a.latestResult,a.getSettings(),{now:clock.now()});assert.notEqual(d.outputCommand,false);assert(d.reason.includes('tarief'));checks++;
 console.log('Injection optional loads 1.3.1:',checks,'checks passed');
 }finally{Date.now=originalNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
