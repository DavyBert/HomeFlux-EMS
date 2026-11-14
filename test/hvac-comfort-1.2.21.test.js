'use strict';
const assert=require('node:assert/strict');
const {boot,DEFAULTS}=require('./startup-harness');
const H=require('../lib/hvac-permanent');
let now=Date.UTC(2026,10,3,10);const oldNow=Date.now;Date.now=()=>now;
async function setup(extra={}){
 const h=await boot(new Map(Object.entries({...DEFAULTS,hvacCount:1,batteryCount:0,evCount:0,hvacEnabled:true,hvacPermanentEnabled:true,hvacTariffEnabled:false,hvacPvEnabled:false,hvacPeriodicHeatEnabled:false,hvacAutomaticControlEnabled:true,hvacDirection:'auto',hvacHeatingActivationBelowC:16,hvacCoolingActivationAboveC:25,hvacComfortMinC:21,hvacComfortMaxC:23,hvacAllowPowerControl:true,hvacAllowModeControl:true,hvacAllowSetpointControl:true,peakShaveEnabled:false,...extra}))),a=h.app;
 a.requestContextEvaluate=()=>{};a.requestEvaluate=()=>{};
 for(let i=0;i<100;i++)await Promise.resolve();
 Object.assign(a.state,{gridPowerW:500,pvPowerW:0,lastTotalCommandW:0,hvacRoomTemperatureC:12,hvacSetpointC:21,hvacMode:'off'});a.inputSeen.grid=true;a.inputUpdatedAt.grid=now;Object.assign(a.inputSeen.hvac,{roomTemperature:true,setpoint:true,mode:true});a.latestResult={tariff:{className:'normal'}};
 return h;
}
function calc(a,allowStart=true){return a.calculateHvacControlFor(0,a.latestResult,null,0,0,{now,allowStart,storedSettings:a.getSettings(),totalActualEvPowerW:0,totalDesiredEvPowerW:0});}
async function main(){
 const h=await setup(),a=h.app,timers=h.timers.length;
 let d=calc(a,false);assert(d.startEligible);assert.equal(d.setpointCommand,null,'priority admission remains required');
 d=calc(a);assert.equal(d.modeCommand,'heat');assert.equal(d.powerCommand,true);assert.equal(d.setpointCommand,21);await a.publishHvacDecisionFor(0,d);assert.equal(H.unit(a,0).comfortMode,'heat');
 a.state.hvacMode='heat';a.state.hvacRoomTemperatureC=16.1;d=calc(a);assert.equal(d.powerCommand,null);assert.equal(d.modeCommand,null);assert.equal(d.setpointCommand,null,'no repeated command at activation threshold');
 a.state.hvacRoomTemperatureC=21;d=calc(a);assert.equal(d.powerCommand,false);await a.publishHvacDecisionFor(0,d);assert.equal(H.unit(a,0).comfortMode,'');
 a.state.hvacMode='off';a.state.hvacRoomTemperatureC=15.9;
 assert.equal(calc(a).powerCommand,true,'a new comfort request may act inside the 10-second follow-up window');
 now+=11000;a.inputUpdatedAt.grid=now;
 assert.equal(calc(a).setpointCommand,null,'after 10 quiet seconds, the minimum interval is active');
 now+=360000;a.inputUpdatedAt.grid=now;d=calc(a);assert.equal(d.powerCommand,true);
 a.state.hvacRoomTemperatureC=22;assert.equal(H.beforePublish(a,0,d),false,'queued demand invalidated by changed room input');
 assert.equal(calc(a).powerCommand,null,'comfortable idle does not start');
 a.state.hvacRoomTemperatureC=28;d=calc(a);assert.equal(d.modeCommand,'cool');assert.equal(d.setpointCommand,23);await a.publishHvacDecisionFor(0,d);
 a.state.hvacMode='cool';a.state.hvacRoomTemperatureC=23;d=calc(a);assert.equal(d.powerCommand,false);await a.publishHvacDecisionFor(0,d);
 assert.equal(h.timers.length,timers,'comfort evaluation adds no timers');
 const disabled=await setup({hvacPermanentEnabled:false,hvacUsePvSurplus:false});assert(!calc(disabled.app).permanent);assert.equal(calc(disabled.app).powerCommand,null);
 // With permanent control OFF, room demand alone must never start HVAC,
 // even when the existing PV option is enabled and all permanent options ON.
 const pvOnly=await setup({hvacPermanentEnabled:false,hvacUsePvSurplus:true,hvacTariffEnabled:true,hvacPvEnabled:true});
 for(const room of [12,28]){pvOnly.app.state.hvacRoomTemperatureC=room;const idle=calc(pvOnly.app);assert(!idle.permanent);assert.equal(idle.powerCommand,null);assert.equal(idle.modeCommand,null);assert.equal(idle.setpointCommand,null);}
 pvOnly.app.state.hvacRoomTemperatureC=12;pvOnly.app.state.gridPowerW=-3000;pvOnly.app.state.pvPowerW=4000;
 const surplus=calc(pvOnly.app);assert(!surplus.permanent);assert.equal(surplus.energySource,'pv');assert.equal(surplus.powerCommand,true,'legacy PV activation remains available');
 const stale=await setup();stale.app.inputUpdatedAt.grid=now-120000;assert.equal(calc(stale.app).powerCommand,null);
 const peak=await setup({peakShaveEnabled:true,peakLimitW:600});assert.equal(calc(peak.app).powerCommand,null);
 const fixed=await setup({hvacDirection:'cool'});assert.equal(calc(fixed.app).powerCommand,null,'heating demand cannot reverse fixed cooling');
 const missing=await setup();missing.app.inputSeen.hvac.roomTemperature=false;assert.equal(calc(missing.app).powerCommand,null);
 const portfolio=await setup();now+=360000;portfolio.app.inputUpdatedAt.grid=now;await portfolio.app.publishFlexibleLoads(portfolio.app.latestResult,0,0);assert.equal(portfolio.app.latestHvacDecision.modeCommand,'heat');assert.equal(portfolio.app.lastPublishedHvacPower,true,'existing portfolio evaluates comfort without PV');
 portfolio.app.state.hvacRoomTemperatureC=21;portfolio.app.state.hvacMode='heat';await portfolio.app.publishFlexibleLoads(portfolio.app.latestResult,0,0);assert.equal(portfolio.app.lastPublishedHvacPower,false,'portfolio also stops at comfort target');
 console.log('Comfort: heat/cool, target shutdown, threshold hysteresis, priority/interval, stale inputs, Peak Guard, fixed direction, queued revalidation, permanent off and real portfolio without PV passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>Date.now=oldNow);
