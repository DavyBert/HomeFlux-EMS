'use strict';
const assert = require('node:assert/strict');
const {boot, DEFAULTS} = require('./startup-harness');
const H = require('../lib/hvac-permanent');
const originalNow = Date.now;
let now = Date.UTC(2026, 10, 14, 12, 0, 0);
Date.now = () => now;

async function setup(extra = {}) {
  const config = {
    ...DEFAULTS, settingsSchemaVersion: 71, evCount: 0, batteryCount: 0,
    boilerCount: 0, hvacCount: 2, controlEnabled: false, peakShaveEnabled: false,
    priorityEvaluationMinutes: 5,
    hvacEnabled: true, hvac2Enabled: true,
    hvacAutomaticControlEnabled: true, hvac2AutomaticControlEnabled: true,
    hvacPermanentEnabled: true, hvac2PermanentEnabled: true,
    hvacTariffEnabled: true, hvac2TariffEnabled: true,
    hvacDirection: 'heat', hvac2Direction: 'heat',
    hvacAllowSetpointControl: true, hvac2AllowSetpointControl: true,
    hvacAllowPowerControl: true, hvac2AllowPowerControl: true,
    hvacAllowModeControl: true, hvac2AllowModeControl: true,
    hvacControlIntervalMinutes: 5, hvac2ControlIntervalMinutes: 5,
    hvacCheapTargetC: 23, hvac2CheapTargetC: 23,
    hvacNormalTargetC: 21, hvac2NormalTargetC: 21,
    ...extra,
  };
  const h=await boot(new Map(Object.entries(config))), a=h.app;
  assert.deepEqual(h.errors, []);
  a.requestContextEvaluate=()=>{}; a.requestEvaluate=()=>{};
  for(let n=0;n<220;n++) await Promise.resolve();
  Object.assign(a.state,{gridPowerW:300,pvPowerW:0,lastTotalCommandW:0,hvacRoomTemperatureC:21,hvacSetpointC:20,hvacMode:'heat'});
  Object.assign(a.inputSeen,{grid:true,pv:true});
  Object.assign(a.inputSeen.hvac,{roomTemperature:true,setpoint:true,mode:true});
  a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;
  a.lastPublishedHvacSetpoint=20;a.lastPublishedHvacMode='heat';a.lastPublishedHvacPower=null;
  const extraHvac=a.getExtraHvac(1);
  Object.assign(extraHvac.state,{roomTemperatureC:21,setpointC:20,mode:'heat'});
  Object.assign(extraHvac.seen,{roomTemperature:true,setpoint:true,mode:true});
  extraHvac.lastPublishedSetpoint=20;extraHvac.lastPublishedMode='heat';
  extraHvac.lastPublishedPower=null;
  a.latestResult={tariff:{className:'cheap',id:'low',importPrice:.1}};
  a.publishEvPortfolio=async()=>({evDecisions:[],adjustedGridW:a.state.gridPowerW,totalActualEvPowerW:0,totalDesiredEvPowerW:0,evStartedThisCycle:false});
  h.events=[];
  for(const kind of ['setpoint','power','mode'])
    h.cards.get(`hvac_${kind}_updated_for_configured`).trigger=async(tokens,choice)=>h.events.push({kind,index:Number(choice.hvac),...tokens,at:now});
  return h;
}
async function cycle(h){return h.app.publishFlexibleLoads(h.app.latestResult,0,0);}
function tick(app,delta){now+=delta;app.inputUpdatedAt.grid=now;app.inputUpdatedAt.pv=now;}
function commands(h,i=1){return h.events.filter(e=>e.kind==='setpoint'&&e.index===i).map(e=>e.setpoint);}
(async()=>{
 try {
  {
   const h=await setup({hvac2Enabled:false}),a=h.app,timers=h.timers.length;
   H.unit(a,0).heat=900;
   await cycle(h);
   assert.deepEqual(commands(h),[23], 'HVAC without prior action starts immediately');
   const first=H.unit(a,0).controlChangedAt;
   assert.equal(first,now);
   tick(a,4000);a.setSetting('hvacCheapTargetC',24);
   await cycle(h);assert.deepEqual(commands(h),[23,24], 'second command is immediate during the first 10 seconds');
   assert.equal(H.unit(a,0).controlChangedAt,now);
   tick(a,6000);a.setSetting('hvacCheapTargetC',25);
   await cycle(h);assert.deepEqual(commands(h),[23,24,25], 'last actual change opens a new 10-second window');
   const last=H.unit(a,0).controlChangedAt;
   assert.equal(H.controlIntervalReady(a,0,a.getHvacInstanceSettings(0),last+9999),true);
   assert.equal(H.controlIntervalReady(a,0,a.getHvacInstanceSettings(0),last+10000),false);
   tick(a,11000);a.setSetting('hvacCheapTargetC',26);
   await cycle(h);assert.deepEqual(commands(h),[23,24,25], 'after 10 quiet seconds normal increases wait');
   assert.equal(H.unit(a,0).controlChangedAt,last,'a blocked evaluation cannot restart the timer');
   tick(a,298000);await cycle(h);
   assert.deepEqual(commands(h),[23,24,25], 'at 5 min + 9 s the interval has not expired');
   tick(a,1000);await cycle(h);
   assert.deepEqual(commands(h),[23,24,25,26], 'at 5 min + 10 s a fresh control action is allowed');
   assert.equal(h.timers.length,timers,'must not introduce a new timer or polling loop');
   const before=H.unit(a,0).controlChangedAt;
   tick(a,2000);await cycle(h);
   assert.equal(H.unit(a,0).controlChangedAt,before,'identical/no-output evaluations do not prolong the free window');
   const restart=await boot(new Map(h.store));
   assert.equal(H.unit(restart.app,0).controlChangedAt,before,'control clock survives an app restart');
   assert.equal(H.controlIntervalReady(restart.app,0,restart.app.getHvacInstanceSettings(0),before+11000),false);
   assert.equal(H.controlIntervalReady(restart.app,0,restart.app.getHvacInstanceSettings(0),before+310000),true);
  }
  {
   now+=3600000;
   const h=await setup({hvac2Enabled:false}),a=h.app;
   a.state.hvacMode='off';
   a.lastPublishedHvacPower=false;
   Object.assign(H.unit(a,0),{heat:900,powerOff:true,controlChangedAt:now-3600000,outputAt:now-3600000});
   await cycle(h);
   assert(h.events.some(e=>e.kind==='power'&&e.state_value===1),'an HVAC idle for an hour starts immediately');
   assert.deepEqual(commands(h),[23]);
   tick(a,3500);a.state.hvacMode='heat';a.setSetting('hvacCheapTargetC',24);
   await cycle(h);
   assert.deepEqual(commands(h),[23,24],'raising the target shortly after the actual ON action is immediate');
  }
  {
   now+=3600000;
   const h=await setup({hvac2Enabled:false,hvacPermanentEnabled:false,
    hvacUsePvSurplus:true,hvacComfortMinC:24,hvacHeatingActivationBelowC:20}),a=h.app;
   a.state.gridPowerW=-3000;a.state.pvPowerW=4500;
   a.state.hvacRoomTemperatureC=19;
   await cycle(h);
   assert.deepEqual(commands(h),[20.5],'legacy PV starts with its normal half-degree step');
   tick(a,4000);await cycle(h);
   assert.deepEqual(commands(h),[20.5,21],'legacy PV can make a follow-up step during the free window');
   tick(a,11000);await cycle(h);
   assert.deepEqual(commands(h),[20.5,21],'legacy PV waits after 10 seconds of inactivity');
   tick(a,299000);await cycle(h);
   assert.deepEqual(commands(h),[20.5,21,21.5],'legacy PV resumes after the configured interval following the quiet period');
  }
  {
   now+=3600000;
   const h=await setup(),a=h.app;
   H.unit(a,0).heat=900;H.unit(a,1).heat=900;
   await cycle(h);
   const previous=H.unit(a,0).controlChangedAt;
   // Simulate an already running independent second HVAC: its last actual
   // change is long ago and must not inherit HVAC1's cooldown.
   Object.assign(H.unit(a,1),{setpoint:23,mode:'heat',powerOff:false,controlChangedAt:now-3600000});
   a.getExtraHvac(1).lastPublishedSetpoint=23;
   a.getExtraHvac(1).state.setpointC=23;
   tick(a,11000);a.setSetting('hvac2CheapTargetC',24);
   await cycle(h);
   assert.equal(a.getExtraHvac(1).lastPublishedSetpoint,24,'HVAC2 acts independently of HVAC1');
   assert.equal(H.unit(a,0).controlChangedAt,previous,'HVAC2 does not reset HVAC1');
  }
  {
   now+=3600000;
   const h=await setup({hvac2Enabled:false,peakShaveEnabled:true,peakLimitW:4000}),a=h.app;
   H.unit(a,0).heat=900;
   await cycle(h);
   tick(a,11000);
   assert.equal(H.controlIntervalReady(a,0,a.getHvacInstanceSettings(0),now),false);
   a.state.gridPowerW=5000;
   await cycle(h);
   assert(h.events.some(e=>e.kind==='power'&&e.state_value===0),'Peak Guard stop bypasses the cooldown');
  }
  console.log('HVAC per-unit 10-second settling + configured interval, restart, no-op, safety: passed');
 } finally {Date.now=originalNow;}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;Date.now=originalNow;});
