'use strict';
const assert=require('node:assert/strict');const {setup,installVirtualClearTimeout}=require('./pv-source-harness');const P=require('../lib/phase-guard');
const original=Date.now,restore=installVirtualClearTimeout();
(async()=>{
 const h=await setup(undefined,{forcedMode:'manual_charge',manualChargeW:5400,exportLimitEnabled:false,peakLimitW:10000,maxChargePerBatteryW:2400,phaseGuard:{...P.defaults,enabled:true,phases:3,voltage:230,amps:25,limitW:4500,batteries:Array(8).fill('balanced3')}},Date.UTC(2026,10,4,12),0),a=h.app;
 await h.start();await h.flush();a.requestEvaluate=()=>{};a.requestContextEvaluate=()=>{};
 P.ingest(a,{l1:1800,l2:5600,l3:1800},h.now());a.state.gridPowerW=9200;a.lastEmittedCommands=[-1800,-1800,-1800,0];a.state.lastTotalCommandW=-5400;
 a.nextCommandAllowedAt=0;a.lastEmitAt=0;let sent;
 a.commandTrigger.trigger=async t=>{sent=t;};a.pendingResult={...a.latestResult,canPublishCommands:true,candidateCommands:[-1800,-1800,-1800,0],candidateTotalCommandW:-5400,_runFlexibleLoadPass:false};
 await a.emitPending();assert.equal(sent.total_command,-2100);assert.equal(a.state.lastTotalCommandW,-2100);
 // A later planner request cannot replace the final output ceiling.
 a.lastEmittedCommands=[-1800,-1800,-1800,0];a.state.lastTotalCommandW=-5400;a.nextCommandAllowedAt=0;a.lastEmitAt=0;
 a.pendingResult={...a.latestResult,canPublishCommands:true,candidateCommands:[-2000,-2000,-2000,0],candidateTotalCommandW:-6000,_runFlexibleLoadPass:false};await a.emitPending();assert.equal(sent.total_command,-2100);
 // The ordinary real P1 path must reduce charging inside the minimum interval
 // without an additional slow context run.
 const u=await setup(undefined,{forcedMode:'manual_charge',manualChargeW:5400,exportLimitEnabled:false,peakLimitW:20000,phaseGuard:{...P.defaults,enabled:true,phases:3,voltage:230,amps:25,limitW:4500,batteries:Array(8).fill('balanced3')}},h.now()+60000,0);
 await u.start();await u.flush();u.app.lastEmittedCommands=[-1800,-1800,-1800,0];u.app.state.lastTotalCommandW=-5400;u.app.lastEmitAt=u.now();u.app.nextCommandAllowedAt=u.now()+7000;
 const contexts=u.contexts.length;u.setNow(u.now()+1000);
 await u.cards.get('set_grid_power_phases').listener({power:9200,l1:1800,l2:5600,l3:1800});await u.drain();await u.flush();
 assert(P.charge(u.app.lastEmittedCommands)<=2100,'phase relief must not wait for the ordinary battery interval');assert.equal(u.contexts.length,contexts,'phase data must not add a full EMS context');
 // Both positive and signed Split outputs must obey a cap below the hardware
 // minimum; a configured minimum cannot silently reintroduce charging.
 for(const positive of [false,true]){
  const z=await setup(undefined,{splitCommandBattery1Enabled:true,splitCommandBattery1KeepMinimumPower:true,splitCommandBattery1MinimumPowerW:100,splitCommandBattery1ChargePowerPositive:positive,phaseGuard:{...P.defaults,enabled:true,phases:3,voltage:230,amps:25,limitW:4500,batteries:Array(8).fill('L1')}},u.now()+60000,0);
  z.app.waitSplitPowerDelay=async()=>{};z.app.splitCommandState[0].currentMode='charge';P.ingest(z.app,{l1:200,l2:200,l3:200},z.now());
  const values=[];z.app.splitCommandTriggers[0].chargePower.trigger=async t=>values.push(t.power);
  await z.app.publishSplitBatteryCommands([-25,0,0,0],z.app.getSettings());assert.equal(Math.abs(values.at(-1)),100,'preserve safe configured Split minimum');
  z.app.lastEmittedCommands=[-100,0,0,0];P.ingest(z.app,{l1:4575,l2:200,l3:200},z.now());
  await z.app.publishSplitBatteryCommands([-25,0,0,0],z.app.getSettings());assert.equal(Math.abs(values.at(-1)),25,'phase headroom overrides hardware minimum');
  z.app.gridPhases[0].at-=16000;await z.app.publishSplitBatteryCommands([0,0,0,0],z.app.getSettings());assert.equal(Math.abs(values.at(-1)),0);
 }
 assert.deepEqual(h.errors,[]);console.log('Phase output: final publication boundary blocks planner overwrite; issued Split commands and total setpoint agree, urgent P1 relief and both Split signs passed.');
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>{restore();Date.now=original});
