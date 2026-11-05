'use strict';
const assert=require('node:assert/strict');
const nativeNow=Date.now;
const {setup,cycle,clock}=require('./hvac-coordination-1.2.15.test');
const H=require('../lib/hvac-permanent');
let checks=0;
async function check(name,run){await run();checks++;}
function room(a,index,value){if(index)a.getExtraHvac(index).state.roomTemperatureC=value;else a.state.hvacRoomTemperatureC=value;}
function mode(a,index,value){if(index)a.getExtraHvac(index).state.mode=value;else a.state.hvacMode=value;}
function tick(a){clock.set(clock.now()+360000);a.inputUpdatedAt.grid=clock.now();a.inputUpdatedAt.pv=clock.now();a.flexiblePriorityState.nextEvaluationAt=0;}
function calc(a,index=0,next=a.state.lastTotalCommandW,current=a.state.lastTotalCommandW,extra={}){
 return a.calculateHvacControlFor(index,a.latestResult,null,next,current,{now:clock.now(),allowStart:true,storedSettings:a.getSettings(),totalActualEvPowerW:0,totalDesiredEvPowerW:0,...extra});
}
async function fresh(count=1,extra={}){
 const settings={};
 for(let i=0;i<count;i++)Object.assign(settings,{['hvac'+(i?i+1:'')+'TariffEnabled']:false,
  ['hvac'+(i?i+1:'')+'HeatingActivationBelowC']:20,['hvac'+(i?i+1:'')+'CoolingActivationAboveC']:25,
  ['hvac'+(i?i+1:'')+'ComfortMinC']:21,['hvac'+(i?i+1:'')+'ComfortMaxC']:23});
 const h=await setup(count,{...settings,...extra}),a=h.app;
 for(let i=0;i<count;i++){
  mode(a,i,'off');room(a,i,18);
  Object.assign(H.unit(a,i),{heat:300,cool:300});
  if(i){a.getExtraHvac(i).lastPublishedPower=false;a.getExtraHvac(i).lastPublishedMode='off';}
  else{a.lastPublishedHvacPower=false;a.lastPublishedHvacMode='off';}
 }
 return h;
}
async function start(a,index=0,direction='heat'){
 room(a,index,direction==='heat'?18:26);tick(a);
 if(!index)a.inputUpdatedAt.hvac.mode=clock.now();else a.getExtraHvac(index).updatedAt.mode=clock.now();
 const d=calc(a,index);assert.equal(d.powerCommand,true);assert.equal(d.direction,direction);
 await a.publishHvacDecisionFor(index,d);mode(a,index,direction);
 assert.equal(H.runtime(a).comfortCycles[index].mode,direction);
 return d;
}
function active(a,index=0){return H.runtime(a).comfortCycles?.[index];}
(async()=>{
 await check('Heating and cooling hold until first target, then allow OFF without extra hysteresis',async()=>{
  for(const direction of ['heat','cool']){
   const h=await fresh(1,{hvacDirection:direction}),a=h.app,timers=h.timers.length;
   await start(a,0,direction);
   const target=direction==='heat'?21:23;
   for(const value of direction==='heat'?[18,20,20.9]:[26,24.5,23.1]){
    room(a,0,value);const d=calc(a);assert.notEqual(d.powerCommand,false);assert.equal(active(a).reached,false);
   }
   room(a,0,target);const stop=calc(a);assert.equal(stop.powerCommand,false);assert.equal(active(a).reached,true);
   await a.publishHvacDecisionFor(0,stop);assert.equal(active(a),undefined);assert.equal(H.unit(a,0).comfortMode,'');
   assert.equal(h.timers.length,timers,'no new timers');
   mode(a,0,'off');await start(a,0,direction);assert.equal(active(a).reached,false,'next start gets its own first-target cycle');
  }
 });
 await check('First target remains reached when OFF was calculated but superseded before publication',async()=>{
  for(const direction of ['heat','cool']){
   const h=await fresh(1,{hvacDirection:direction}),a=h.app;await start(a,0,direction);
   room(a,0,direction==='heat'?21:23);assert.equal(calc(a).powerCommand,false);
   room(a,0,direction==='heat'?20.8:23.2);assert.equal(calc(a).powerCommand,false,'do not re-arm protection after a reached target');
  }
 });
 await check('Failed or merely calculated starts do not arm ownership',async()=>{
  const h=await fresh(),a=h.app;const d=calc(a);assert.equal(d.powerCommand,true);assert.equal(active(a),undefined);
  a._publishHvacDecisionNowFor=async()=>{throw new Error('test output failure');};
  await assert.rejects(a.publishHvacDecisionFor(0,d),/test output failure/);assert.equal(active(a),undefined);
  const partial=await fresh(),b=partial.app;
  partial.cards.get('hvac_mode_updated_for_configured').trigger=async()=>{throw new Error('partial output failure');};
  await assert.rejects(b.publishHvacDecisionFor(0,calc(b)),/partial output failure/);
  assert.equal(b.lastPublishedHvacPower,true,'partial power receipt is retained');assert.equal(active(b),undefined,'partial publication is not an acknowledged comfort start');
 });
 await check('PV, tariff, periodic and manual learning takeovers clear ownership',async()=>{
  for(const takeover of ['hvacPvEnabled','hvacTariffEnabled','hvacPeriodicHeatEnabled','hvacPermanentEnabled','hvacEnabled','learning']){
   const h=await fresh(),a=h.app;await start(a);
   if(takeover==='learning')H.runtime(a).manualQueue=[{index:0,requestedAt:clock.now()}];
   else a.setSetting(takeover,!['hvacPermanentEnabled','hvacEnabled'].includes(takeover));
   calc(a);assert.equal(active(a),undefined,takeover);assert.equal(H.unit(a,0).comfortMode,'',takeover);
  }
 });
 await check('Explicit Flow stop and external mode/setpoint changes clear ownership',async()=>{
  const h=await fresh(),a=h.app;await start(a);H.inputChanged(a,0,'mode','heat');H.inputChanged(a,0,'setpoint',21);assert(active(a));
  H.inputChanged(a,0,'setpoint',19);assert.equal(active(a),undefined);
  mode(a,0,'off');await start(a);H.inputChanged(a,0,'mode','off');assert.equal(active(a),undefined);
  mode(a,0,'off');await start(a);await a.setHvacAutomaticControlFor(0,{enabled:'no'});assert.equal(active(a),undefined);assert.equal(a.lastPublishedHvacPower,false);
 });
 await check('Each HVAC owns a separate cycle',async()=>{
  const h=await fresh(2),a=h.app;await start(a,0);await start(a,1);
  room(a,0,21);await a.publishHvacDecisionFor(0,calc(a,0));assert.equal(active(a,0),undefined);
  assert(active(a,1));assert.notEqual(calc(a,1).powerCommand,false);
 });
 await check('A rounded requested target, not a different raw temperature, ends the cycle',async()=>{
  const h=await fresh(1,{hvacComfortMinC:21.2}),a=h.app;await start(a);assert.equal(active(a).target,21);
  room(a,0,21);assert.equal(calc(a).powerCommand,false);
 });
 await check('Peak Guard waits for first target only during ongoing battery charging',async()=>{
  const h=await fresh(),a=h.app;await start(a);
  a.state.lastTotalCommandW=-1500;a.state.gridPowerW=2900;a.setSetting('peakShaveEnabled',true);a.setSetting('peakLimitW',2650);
  assert.equal(H.protectsFromPeakStop(a,0,{...calc(a),roomTemperatureC:null}),false,'missing room data never grants an exception');
  await a.publishFlexibleLoads(a.latestResult,-1500,-1500);
  assert.equal(a.lastPublishedHvacPower,true);assert(active(a));assert.equal(active(a).reached,false);
  room(a,0,21);await a.publishFlexibleLoads(a.latestResult,-1500,-1500);assert.equal(a.lastPublishedHvacPower,false);assert.equal(active(a),undefined);
 });
 await check('Discharging, idle and an imminent discharge keep the existing Peak Guard OFF',async()=>{
  for(const [current,next,effective] of [[500,500,500],[0,0,0],[-1500,500,500],[-1500,-1500,500]]){
   const h=await fresh(),a=h.app;await start(a);a.state.lastTotalCommandW=current;a.state.gridPowerW=6000;
   a.setSetting('peakShaveEnabled',true);a.setSetting('peakLimitW',2650);
   await a.publishFlexibleLoads(a.latestResult,next,current,{effectiveNextBatteryCommandW:effective});
   assert.equal(a.lastPublishedHvacPower,false,JSON.stringify({current,next,effective}));assert.equal(active(a),undefined);
  }
 });
 await check('New starts still respect Peak Guard even during charging',async()=>{
  const h=await fresh(1,{peakShaveEnabled:true,peakLimitW:2650}),a=h.app;
  a.state.lastTotalCommandW=-1500;a.state.gridPowerW=2900;
  await a.publishFlexibleLoads(a.latestResult,-1500,-1500);assert.notEqual(a.lastPublishedHvacPower,true);assert.equal(active(a),undefined);
  a.state.gridPowerW=1000;tick(a);await a.publishFlexibleLoads(a.latestResult,-1500,-1500);
  assert.equal(a.lastPublishedHvacPower,true,'charging and active Peak Guard do not prevent a start when headroom exists');
 });
 await check('Stale meter, outdoor OFF and HVAC budget retain priority during charging',async()=>{
  for(const stop of ['stale','outdoor','budget']){
   const h=await fresh(),a=h.app;await start(a);a.state.lastTotalCommandW=-1500;
   a.setSetting('peakShaveEnabled',true);a.setSetting('peakLimitW',2650);a.state.gridPowerW=2900;
   if(stop==='stale')a.inputUpdatedAt.grid=clock.now()-120000;
   if(stop==='outdoor'){a.setSetting('hvacOutdoorOffEnabled',true);a.setSetting('hvacOutdoorOffBelowC',5);a.inputSeen.hvac.outdoorTemperature=true;a.state.hvacOutdoorTemperatureC=0;}
   if(stop==='budget'){a.setSetting('hvacExtraGridBudgetEnabled',true);a.setSetting('hvacExtraGridBudgetW',0);}
   await a.publishFlexibleLoads(a.latestResult,-1500,-1500);
   if(stop==='budget'){assert(a.latestHvacDecision.hvacBudgetReduction);assert.equal(active(a),undefined);}
   else{assert.equal(a.lastPublishedHvacPower,false,stop+' '+JSON.stringify(a.latestHvacDecision));assert.equal(active(a),undefined);}
  }
 });
 await check('PV surplus loss can still stop before target, also with a 15-minute control interval',async()=>{
  const h=await fresh(1,{hvacPermanentEnabled:false,hvacUsePvSurplus:true,hvacControlIntervalMinutes:15}),a=h.app;
  a.state.gridPowerW=-3000;a.state.pvPowerW=4000;tick(a);await cycle(h);mode(a,0,'heat');assert.equal(a.lastPublishedHvacPower,true);assert.equal(active(a),undefined);
  a.state.gridPowerW=1800;a.state.pvPowerW=0;await cycle(h);assert.equal(a.lastPublishedHvacPower,false);assert.equal(active(a),undefined);
 });
 await check('Tariff commands never acquire first-target protection',async()=>{
  const h=await fresh(1,{hvacTariffEnabled:true,hvacCheapTargetC:23}),a=h.app;
  tick(a);await cycle(h);mode(a,0,'heat');assert.equal(a.lastPublishedHvacPower,true);assert.equal(active(a),undefined);
  a.state.lastTotalCommandW=-1500;a.state.gridPowerW=2900;a.setSetting('peakShaveEnabled',true);a.setSetting('peakLimitW',2650);
  await a.publishFlexibleLoads(a.latestResult,-1500,-1500);assert.equal(a.lastPublishedHvacPower,false);
 });
 await check('Peak Guard treats protected and unprotected HVACs independently',async()=>{
  const h=await fresh(2,{hvac2TariffEnabled:true,hvac2CheapTargetC:23}),a=h.app;await start(a,0);
  tick(a);await a.publishHvacDecisionFor(1,calc(a,1));mode(a,1,'heat');assert.equal(a.getExtraHvac(1).lastPublishedPower,true);
  a.state.lastTotalCommandW=-1500;a.state.gridPowerW=2900;a.setSetting('peakShaveEnabled',true);a.setSetting('peakLimitW',2650);
  await a.publishFlexibleLoads(a.latestResult,-1500,-1500);
  assert.equal(a.lastPublishedHvacPower,true);assert.equal(a.getExtraHvac(1).lastPublishedPower,false);assert(active(a,0));assert.equal(active(a,1),undefined);
 });
 console.log(`HVAC first-target protection: ${checks} scenario groups passed.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{Date.now=nativeNow;});
