'use strict';
const assert=require('node:assert/strict'),P=require('../lib/phase-guard'),E=require('../lib/ems-engine');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const original=Date.now,restore=installVirtualClearTimeout();
function fixture(step=1){const now=Date.UTC(2026,10,4,12);return {now,state:{batterySoc:[50]},lastEmittedCommands:[0],nextCommandAllowedAt:0,phaseGuardStatus:{limited:true},gridPhases:[100,100,100].map(watts=>({watts,at:now})),settings:{...E.DEFAULTS,batteryCount:1,maxChargePerBatteryW:10000,batteryCommandStepW:step,commandDeadbandW:1000,phaseGuard:{...P.defaults,enabled:true,phases:3,voltage:230,amps:25,limitW:4500,batteries:['L1']}}};}
(async()=>{
 let checks=0;
 for(const step of [1,10,100]){
  const a=fixture(step),s=a.settings,r={candidateCommands:[-1000]};P.apply(a,r,s,a.now);
  assert.deepEqual(r.candidateCommands,[-1000]);assert.equal(r.phaseRecovery,true);
  assert.equal(a.phaseGuardStatus.limited,false,'full safe command has no remaining phase restriction');
  assert.equal(a.phaseGuardRuntime.lastIncreaseAt,0,'calculation is not a publication');
  P.committed(a,[0],[-1000],s,a.now);a.lastEmittedCommands=[-1000];
  assert.deepEqual(P.limit(a,[-2000],s,a.now),[-2000],'no phase ramp between calculations');
  P.ingest(a,{l1:5000,l2:100,l3:100},a.now+1000);P.apply(a,{candidateCommands:[-2000]},s,a.now+1000);
  assert.equal(a.phaseGuardStatus.limited,true);
  for(let i=2;i<7;i++)assert.equal(P.recovery(a,s,a.now+i*1000),false,'identical phase values do not force repeated full evaluations');
  P.ingest(a,{l1:100,l2:100,l3:100},a.now+7000);a.nextCommandAllowedAt=a.now+10000;
  assert.equal(P.recovery(a,s,a.now+7000),false,'ordinary battery interval still applies');
  assert(P.recovery(a,s,a.now+10000),'changed phase values release capacity at the normal command boundary');
  assert.deepEqual(P.limit(a,[-4000],s,a.now+10000),[-4000]);checks++;
 }
 const h=await setup(undefined,{forcedMode:'manual_charge',manualChargeW:1000,exportLimitEnabled:false,peakLimitW:20000,commandDeadbandW:1000,phaseGuard:{...P.defaults,enabled:true,phases:3,voltage:230,amps:25,limitW:4500,batteries:Array(8).fill('L1')}},Date.UTC(2026,10,4,12),0),a=h.app;
 await h.start();await h.flush();a.requestEvaluate=()=>{};a.requestContextEvaluate=()=>{};P.ingest(a,{l1:100,l2:100,l3:100},h.now());a.lastEmittedCommands=[0,0,0,0];a.phaseGuardStatus={limited:true};
 let result={...a.latestResult,candidateCommands:[-1000,0,0,0],candidateTotalCommandW:-1000,canPublishCommands:true,_runFlexibleLoadPass:false};P.apply(a,result,a.getSettings(),h.now());assert(a.commandChangedEnough(result),'phase recovery cannot be blocked by1000 W deadband');checks++;
 a.nextCommandAllowedAt=0;a.lastEmitAt=0;a.commandTrigger.trigger=async()=>{throw Error('injected publication failure');};a.pendingResult=result;await assert.rejects(()=>a.emitPending(),/injected/);assert.equal(a.phaseGuardRuntime.lastIncreaseAt,0);assert.equal(a.phaseGuardRuntime.publicationUncertain,true);assert.deepEqual(a.lastEmittedCommands,[0,0,0,0]);checks++;
 a.commandTrigger.trigger=async()=>{};a.nextCommandAllowedAt=0;a.lastEmitAt=0;a.pendingResult={...result,candidateCommands:[0,0,0,0],candidateTotalCommandW:0};await a.emitPending();assert.equal(a.phaseGuardRuntime.publicationUncertain,false);checks++;
 h.setNow(h.now()+11000);P.ingest(a,{l1:100,l2:100,l3:100},h.now());a.phaseGuardStatus={limited:true};result={...result,candidateCommands:[-1000,0,0,0]};P.apply(a,result,a.getSettings(),h.now());a.nextCommandAllowedAt=0;a.lastEmitAt=0;a.pendingResult=result;await a.emitPending();assert.equal(a.phaseGuardRuntime.lastIncreaseAt,h.now());assert(P.charge(a.lastEmittedCommands)>0);checks++;
 // A changed individual limit/SoC is read directly, not inherited from an earlier allocator result.
 const f=fixture();Object.assign(f.settings,{individualBatteryPowerLimitsEnabled:true,battery1MaxChargeW:30});assert.deepEqual(P.limit(f,[-1000],f.settings,f.now,false),[-30]);f.state.batterySoc[0]=100;assert.deepEqual(P.limit(f,[-1000],f.settings,f.now,false),[0]);checks++;
 for(const positive of [true,false]){
  const z=await setup(undefined,{splitCommandBattery1Enabled:true,splitCommandBattery1ChargePowerPositive:positive,phaseGuard:{...P.defaults,enabled:true,phases:3,voltage:230,amps:25,limitW:4500,batteries:Array(8).fill('L1')}},h.now()+60000,0);
  P.ingest(z.app,{l1:100,l2:100,l3:100},z.now());let release;z.app.waitSplitPowerDelay=()=>new Promise(r=>{release=r;});const outputs=[];z.app.splitCommandTriggers[0].chargePower.trigger=async t=>outputs.push(t.power);
  const pending=z.app.publishSplitBatteryCommands([-1000,0,0,0],z.app.getSettings());await z.drain();
  z.app.setSetting('individualBatteryPowerLimitsEnabled',true);z.app.setSetting('battery1MaxChargeW',25);release();const actual=await pending;assert.equal(Math.abs(outputs.at(-1)),25);assert.equal(actual[0],-25);checks++;
 }
 const z=await setup(undefined,{splitCommandBattery1Enabled:true,splitCommandBattery2Enabled:true,phaseGuard:{...P.defaults,enabled:true,phases:3,voltage:230,amps:25,limitW:4500,batteries:Array(8).fill('L1')}},h.now()+120000,0);
 P.ingest(z.app,{l1:100,l2:100,l3:100},z.now());z.app.splitCommandState[0].currentMode='charge';z.app.splitCommandState[1].currentMode='charge';let finish;
 z.app.splitCommandTriggers[0].chargePower.trigger=async()=>{throw Error('split failure');};z.app.splitCommandTriggers[1].chargePower.trigger=()=>new Promise(r=>{finish=r;});
 let settled=false;const partial=z.app.publishSplitBatteryCommands([-100,-100,0,0],z.app.getSettings()).then(()=>{settled=true;},e=>{settled=true;throw e;});await z.drain();assert.equal(settled,false,'all in-flight Split writes must finish before failure releases caller');finish();await assert.rejects(()=>partial,/split failure/);checks++;
 console.log(`Phase recovery/publication: ${checks} focused scenarios passed.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>{Date.now=original;restore();});
