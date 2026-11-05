'use strict';
const assert=require('node:assert/strict'),P=require('../lib/phase-guard'),calculator=require('../settings/phase-guard');
const {boot,DEFAULTS}=require('./startup-harness');
const now=Date.UTC(2026,10,4,12);
function fixture(types=['balanced3'],old=[-5400],watts=[1800,5600,1800]){return {state:{batterySoc:types.map(()=>50)},lastEmittedCommands:old,gridPhases:watts.map(watts=>({watts,at:now})),phaseGuardRuntime:{lastIncreaseAt:now},settings:{...DEFAULTS,batteryCount:types.length,maxTotalChargeW:10000,maxChargePerBatteryW:10000,maxSoc:100,phaseGuard:{...P.defaults,phases:3,enabled:true,voltage:230,amps:25,limitW:4500,batteries:types}}};}
let cases=0;
for(const [v,a,out] of [[230,25,4600],[120,20,1920]]){assert.equal(P.proposal({...P.defaults,voltage:v,amps:a}),out);assert.equal(calculator.proposal(v,a),out);cases++;}
assert.equal(P.proposal({...P.defaults,voltage:null,amps:25}),null);cases++;
{
 const a=fixture();assert.deepEqual(P.limit(a,[-5400],a.settings,now,false),[-2100]);assert.equal(a.phaseGuardStatus.phase,'L2');cases++;
 a.gridPhases[0].watts=6000;assert.deepEqual(P.limit(a,[-5400],a.settings,now,false),[-900]);cases++;
}
{
 const a=fixture(['L1','L2'],[-1000,-1000],[2000,5000,1000]);a.settings.maxChargePerBatteryW=2400;
 const out=P.limit(a,[-1000,-1000],a.settings,now,false);assert.deepEqual(out,[-1500,-500]);assert.equal(P.charge(out),2000);assert.equal(P.reduction(a,out,a.settings,now),true);cases++;
}
{
 const a=fixture(['unknown'],[-400],[1000,5000,1000]);assert.deepEqual(P.limit(a,[-400],a.settings,now,false),[0]);cases++;
 assert.deepEqual(P.limit(a,[300],a.settings,now,false),[300]);cases++;
 a.gridPhases[1].at=now-15001;assert.deepEqual(P.limit(a,[-400],a.settings,now,false),[0]);cases++;
 assert.equal(a.phaseGuardStatus.limited,true);P.limit(a,[0],a.settings,now,false);assert.equal(a.phaseGuardStatus.limited,true,'publication of capped zero must retain recovery');
 a.gridPhases.forEach(v=>{v.watts=100;v.at=now+16000;});assert.equal(P.recovery(a,a.settings,now+16000),true);P.apply(a,{candidateCommands:[0]},a.settings,now+16000);assert.equal(a.phaseGuardStatus.limited,false,'a real zero-charge plan ends recovery');cases++;
 a.settings.phaseGuard.enabled=false;const input=[-400];assert.equal(P.limit(a,input,a.settings,now),input);cases++;
}
{
 const a=fixture(['L1'],[0],[1000,1000,1000]);a.phaseGuardRuntime.lastIncreaseAt=0;let out=P.limit(a,[-1000],a.settings,now);assert.deepEqual(out,[-100]);P.committed(a,a.lastEmittedCommands,out,a.settings,now);a.lastEmittedCommands=out;
 assert.deepEqual(P.limit(a,[-1000],a.settings,now),[-100]);out=P.limit(a,[-1000],a.settings,now+10000);assert.deepEqual(out,[-200]);cases++;
}
{
 const a=fixture(['L1','L2','L3'],[0,0,0],[100,100,100]);Object.assign(a.settings,{individualBatteryPowerLimitsEnabled:true,battery1MaxChargeW:1200,battery2MaxChargeW:600,battery3MaxChargeW:300});a.state.batterySoc=[100,50,60];
 assert.deepEqual(P.limit(a,[-1200,-1200,-1200],a.settings,now,false),[0,-600,-300],'redistribution retains each battery SoC and power ceiling');cases++;
}
(async()=>{
 const h=await boot(new Map(Object.entries({...DEFAULTS,batteryCount:1,evCount:0,hvacCount:0}))),a=h.app;a.requestEvaluate=()=>{};a.requestContextEvaluate=()=>{};
 assert.equal(await h.cards.get('set_grid_power').listener({power:-500}),true);assert.equal(a.state.gridPowerW,-500);cases++;
 assert.equal(await h.cards.get('set_grid_power_phases').listener({power:400}),true);assert(a.gridPhases.every(v=>v.watts===null));cases++;
 assert.equal(await h.cards.get('set_grid_power_phases').listener({power:300,l1:-100,l2:500,l3:-100}),true);assert.deepEqual(a.gridPhases.map(v=>v.watts),[-100,500,-100]);cases++;
 assert.equal(await h.cards.get('set_grid_power_phases').listener({power:100,l2:100}),true);assert.deepEqual(a.gridPhases.map(v=>v.watts),[null,100,null]);cases++;
 assert(a.getPublicStatus().phaseGuard);assert(a.getDiagnosticsReport().phaseGuard);cases++;
 console.log(`Phase guard 1.2.28: ${cases} scenarios passed.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1});
