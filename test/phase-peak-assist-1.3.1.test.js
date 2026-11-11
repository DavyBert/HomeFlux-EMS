'use strict';
const assert=require('node:assert/strict');
const guard=require('../lib/phase-guard');
const evGuard=require('../lib/ev-phase-guard');
const {DEFAULTS}=require('../lib/ems-engine');
const now=Date.UTC(2026,10,11,15);
let checks=0;
function fixture({types=['L1','L2','L3','balanced3'],watts=[9000,4000,3000],grid=watts.reduce((a,b)=>a+b,0),old=null,soc=null,extra={},assist=true}={}){
 const count=types.length;
 const settings={...DEFAULTS,controlEnabled:true,peakShaveEnabled:true,peakLimitW:18000,peakSoftMarginW:100,
  batteryCount:count,maxTotalDischargeW:8000,maxDischargePerBatteryW:5000,maxTotalChargeW:8000,
  phaseGuard:{...guard.defaults,phases:3,enabled:true,peakGuardBatteryAssistEnabled:assist,limitW:8000,
   voltage:230,amps:40,batteries:types},...extra};
 const app={state:{gridPowerW:grid,batterySoc:soc||types.map(()=>75)},lastEmittedCommands:old||types.map(()=>0),
  gridPhases:watts.map(watts=>({watts,at:now})),phaseGuardRuntime:{lastIncreaseAt:now}};
 return {settings,app,run:commands=>guard.assist(app,commands||types.map(()=>0),settings,now)};
}
function test(title,fn){try{fn();checks++;}catch(err){err.message=title+': '+err.message;throw err;}}
test('default off and legacy unchanged',()=>{
 const f=fixture({assist:false});assert.equal(guard.defaults.peakGuardBatteryAssistEnabled,false);
 assert.deepEqual(f.run().out,[0,0,0,0]);assert.equal(f.run().extraW,0);
});
test('new installs and upgrades without the checkbox remain disabled',()=>{
 assert.equal(DEFAULTS.phaseGuard.peakGuardBatteryAssistEnabled,false);
 const f=fixture();
 delete f.settings.phaseGuard.peakGuardBatteryAssistEnabled;
 assert.equal(guard.assistEnabled(f.settings),false);
 assert.deepEqual(f.run().out,[0,0,0,0]);
});
test('L1 preferred over balanced3, no unrelated batteries',()=>{
 const f=fixture();const result=f.run();assert.deepEqual(result.out,[1000,0,0,0]);
 assert.equal(result.predictedGridW,15000);
});
test('L2 preferred over balanced3',()=>{
 const f=fixture({watts:[3000,9000,4000]});assert.deepEqual(f.run().out,[0,1000,0,0]);
});
test('balanced three-phase only after local exhausted',()=>{
 const f=fixture({soc:[10,75,75,75]});assert.deepEqual(f.run().out,[0,0,0,3000]);
 assert.equal(f.run().predictedGridW,13000);
});
test('no fictitious compensation with unknown phase',()=>{
 const f=fixture({types:['unknown'],watts:[9000,4000,3000]});assert.deepEqual(f.run().out,[0]);
});
test('zero import is a hard upper bound even if another phase exports',()=>{
 const f=fixture({watts:[6000,-2500,-2500],grid:1000,types:['L1'],extra:{phaseGuard:{...guard.defaults,phases:3,enabled:true,peakGuardBatteryAssistEnabled:true,voltage:230,amps:30,limitW:5000,batteries:['L1']}}});
 assert.deepEqual(f.run().out,[1000]);assert.equal(f.run().predictedGridW,0);
 f.app.state.gridPowerW=300;assert.deepEqual(f.run().out,[300]);assert.equal(f.run().predictedGridW,0);
});
test('negative one-phase allowed with positive total P1',()=>{
 const f=fixture({types:['L1'],watts:[9000,-5000,1000],grid:5000});assert.deepEqual(f.run().out,[1000]);
 assert.equal(f.run().predictedGridW,4000);
});
test('no support when total P1 already injecting',()=>{
 const f=fixture({types:['L1'],watts:[9000,-8000,-2000],grid:-1000});assert.equal(f.run().extraW,0);
});
test('shared peak shaving command counted once',()=>{
 const f=fixture({old:[0,0,0,0]});const result=f.run([500,0,0,0]);assert.deepEqual(result.out,[1000,0,0,0]);
 assert.equal(result.extraW,500);assert.equal(result.predictedGridW,15000);
});
test('existing hardware commands credited through measured P1',()=>{
 const f=fixture({types:['L1'],old:[500],grid:15000,watts:[8500,3500,3000]});
 assert.deepEqual(f.run([500]).out,[1000]);assert.equal(f.run([500]).predictedGridW,14500);
});
test('safety SoC and discharge power limits',()=>{
 let f=fixture({types:['L1'],soc:[10]});assert.deepEqual(f.run().out,[0]);
 f=fixture({types:['L1'],extra:{maxTotalDischargeW:600,maxDischargePerBatteryW:500}});
 assert.deepEqual(f.run().out,[500]);
});
test('user EV discharge block overrides phase assistance',()=>{
 const f=fixture();f.app.getEvBatteryDischargePolicy=()=>({blocked:true});assert.equal(f.run().extraW,0);
});
test('hybrid ownership, injection and disabled output skip assistance',()=>{
 const f=fixture();f.app.isHybridExternalControlActive=()=>true;assert.equal(f.run().extraW,0);
 f.app.isHybridExternalControlActive=()=>false;assert.equal(guard.assist(f.app,[0,0,0,0],f.settings,now,{injectionActive:true}).extraW,0);
 assert.equal(guard.assist(f.app,[0,0,0,0],f.settings,now,{canPublishCommands:false}).extraW,0);
});
test('missing, partial, stale readings never authorize discharge',()=>{
 for(const kind of ['missing','stale','partial']){
  const f=fixture();if(kind==='missing')f.app.gridPhases=null;
  else if(kind==='partial')f.app.gridPhases[1]={watts:null,at:0};
  else f.app.gridPhases[2].at=now-16000;
  assert.equal(f.run().extraW,0);
 }
});
test('recovery terminates additional phase intervention',()=>{
 const f=fixture();assert.equal(f.run().extraW,1000);
 f.app.gridPhases[0].watts=7000;assert.equal(f.run().extraW,0);
});
test('EV reduction anticipated, never credited before P1 confirms',()=>{
 const original=evGuard.reference;
 try{
  evGuard.reference=()=>({ev:[{index:0,measuredFresh:true,current:16,cap:10,perAmp:690,phases:3,pending:null}]});
  const f=fixture();assert.equal(f.run().extraW,0,'EV will relieve 1380 W on each phase');
  evGuard.reference=()=>({ev:[{index:0,measuredFresh:true,current:16,cap:10,perAmp:230,phases:1,pending:null}]});
  const g=fixture({types:['L1'],watts:[9000,-4200,-4000],grid:800});
  assert.equal(g.run().extraW,0,'expected EV stop exceeds total net import, so no battery injection risk');
 }finally{evGuard.reference=original;}
});
test('no discharge while an unknown-phase EV can still be reduced',()=>{
 const original=evGuard.reference;
 try{
  evGuard.reference=()=>({ev:[{index:0,measuredFresh:true,current:16,cap:0,perAmp:230,phases:1,pending:null}]});
  const f=fixture({types:['L1'],watts:[9000,-3000,-3000],grid:3000});
  assert.equal(f.run().extraW,0,'first stop the controllable EV, before helping with the battery');
  evGuard.reference=()=>({ev:[{index:0,measuredFresh:true,current:0,cap:0,perAmp:230,phases:1,pending:null}]});
  assert.equal(f.run().out[0],1000,'after confirmed EV stop, help with remaining household overload');
 }finally{evGuard.reference=original;}
});
test('three-phase EV curtailment wins while total power is below ordinary Peak Guard',()=>{
 const f=fixture({types:['L1'],watts:[9000,4000,3000],grid:16000});
 Object.assign(f.settings,{evCount:1,evEnabled:true,evControlType:'current',evPhases:3,evVoltage:230,
  evVoltageReference:'phase',evMinCurrentA:6});
 const meter={currentA:16,updatedAt:now};
 Object.assign(f.app,{lastPublishedEvCurrentA:16,lastPublishedEvAllowed:true,
  getEvCount:()=>1,getEvSettingKey:(_i,k)=>'ev'+k,getEvControlTypeFor:()=> 'current',
  getEvElectricalSettingsFor:()=>({evPhases:3,evVoltage:230,evVoltageReference:'phase'}),
  getEvInputSnapshot:()=>({}),getEvMeasuredCurrent:()=>({fresh:true,currentA:meter.currentA,updatedAt:meter.updatedAt})});
 const phaseDecision=evGuard.cap(f.app,0,{allowed:true,desiredCurrentA:16,desiredPowerW:11040},f.settings,now);
 assert.equal(phaseDecision.desiredCurrentA,11,'the existing EV phase guard supplies the cap');
 assert.equal(phaseDecision.phaseLimited,true);
 assert.equal(f.run().extraW,0,'do not ask the battery before the EV has curtailed');
 // The EV is still able to reduce after a first reduction, so the battery
 // may not prematurely carry the remaining load either.
 meter.currentA=11;f.app.lastPublishedEvCurrentA=11;
 guard.ingest(f.app,{l1:8500,l2:3500,l3:2500},now+1000);
 f.app.state.gridPowerW=14500;
 const further=evGuard.cap(f.app,0,{allowed:true,desiredCurrentA:16,desiredPowerW:11040},f.settings,now+1000);
 assert.equal(further.desiredCurrentA,8);
 assert.equal(guard.assist(f.app,[0],f.settings,now+1000).extraW,0);
 // Once P1/charger feedback confirms the controllable load stopped, a
 // surviving household phase peak can ask for temporary battery relief.
 meter.currentA=0;f.app.lastPublishedEvCurrentA=0;
 guard.ingest(f.app,{l1:8500,l2:2000,l3:2000},now+2000);
 f.app.state.gridPowerW=12500;
 assert.equal(guard.assist(f.app,[0],f.settings,now+2000).extraW,500);
});
test('even a severe overload waits for an outstanding EV-reduction command',()=>{
 const original=evGuard.reference;
 try{
  evGuard.reference=()=>({ev:[{index:0,measuredFresh:true,current:16,cap:0,perAmp:690,phases:3,pending:{current:0,at:now,complete:true}}]});
  const f=fixture({types:['L1'],watts:[12000,3000,3000],grid:18000});
  assert.equal(f.run().extraW,0,'no battery until EV physical curtailment is confirmed');
  evGuard.reference=()=>({ev:[{index:0,measuredFresh:true,current:0,cap:0,perAmp:690,phases:3,pending:null}]});
  assert.equal(f.run().out[0],4000,'household excess remains after EV is at 0 A');
 }finally{evGuard.reference=original;}
});
test('ordinary Peak Guard EV reduction is honoured, not overturned by phase battery assistance',()=>{
 const original=evGuard.reference;
 try{
  evGuard.reference=()=>({ev:[{index:0,measuredFresh:true,current:16,cap:16,perAmp:690,phases:3,pending:null}]});
  const f=fixture({types:['L1'],watts:[9500,4000,3000],grid:16500});
  f.app.latestEvDecision={allowed:true,desiredCurrentA:12,peakLimited:true};
  assert.equal(f.run().extraW,0,'ordinary Peak Guard still has EV curtailment available');
  f.app.latestEvDecision={allowed:false,desiredCurrentA:0,peakLimited:true};
  assert.equal(f.run().extraW,0,'an issued EV stop is not physical feedback');
  evGuard.reference=()=>({ev:[{index:0,measuredFresh:true,current:0,cap:0,perAmp:690,phases:3,pending:null}]});
  assert.equal(f.run().extraW,1500,'support starts only for the residual measured overload');
 }finally{evGuard.reference=original;}
});
test('outgoing command rechecked against last P1 total',()=>{
 const f=fixture({types:['L1']});const candidate=f.run();const result={phaseBatteryAssist:{...candidate,baseCommands:[0]},canPublishCommands:true};
 f.app.state.gridPowerW=200;
 assert.deepEqual(guard.assistOutput(f.app,candidate.out,result,f.settings,now),[200]);
 f.app.state.gridPowerW=0;
 assert.deepEqual(guard.assistOutput(f.app,candidate.out,result,f.settings,now),[0]);
});
test('no separate output on settings switch or stale input',()=>{
 const f=fixture({types:['L1']});const candidate=f.run();const result={phaseBatteryAssist:{...candidate,baseCommands:[0]},canPublishCommands:true};
 f.settings.phaseGuard.peakGuardBatteryAssistEnabled=false;
 assert.deepEqual(guard.assistOutput(f.app,candidate.out,result,f.settings,now),[0]);
 f.settings.phaseGuard.peakGuardBatteryAssistEnabled=true;
 f.app.gridPhases[0].at=now-16000;
 assert.deepEqual(guard.assistOutput(f.app,candidate.out,result,f.settings,now),[0]);
});
test('different total and per-battery ceilings',()=>{
 const f=fixture({types:['L1','L1','balanced3'],soc:[75,75,75],extra:{maxTotalDischargeW:700,individualBatteryPowerLimitsEnabled:true,battery1MaxDischargeW:300,battery2MaxDischargeW:300,battery3MaxDischargeW:1500}});
 assert.deepEqual(f.run().out,[300,300,100]);
});
test('phase overload uses existing flexible-load Peak Guard only; battery settings unchanged',()=>{
 const f=fixture({assist:false});
 const derived=guard.flexiblePeakSettings(f.app,f.settings,now);
 assert.equal(guard.phasePressure(f.app,f.settings,now),1000);
 assert.equal(derived.peakLimitW,13100);
 assert.equal(f.settings.peakLimitW,18000);
 assert.equal(f.run().extraW,0);
 f.app.gridPhases[0].watts=7000;
 assert.equal(guard.flexiblePeakSettings(f.app,f.settings,now),f.settings);
});
test('flexible load shedding precedes battery assistance',()=>{
 const f=fixture({types:['L1']});
 f.app.boilerState={outputOn:true};f.settings.boilerEnabled=true;
 assert.equal(f.run().extraW,0);
 f.app.boilerState.outputOn=false;
 assert.equal(f.run().extraW,1000);
});
console.log(`Phase Peak Guard assistance: ${checks} targeted safety scenarios passed.`);
