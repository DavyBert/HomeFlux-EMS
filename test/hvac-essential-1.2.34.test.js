'use strict';
const assert=require('node:assert/strict');
const {setup,known,clock}=require('./hvac-coordination-1.2.15.test');
const H=require('../lib/hvac-permanent'),C=require('../lib/hvac-coordination');
let checks=0;
function essential(a,index,on=true){const rows=a.getSettings().hvacCoordination.map((c,i)=>i===index?{...c,EssentialEnabled:on}:c);a.setSetting('hvacCoordination',rows);}
function active(a,count){known(a,count,1000);for(let i=0;i<count;i++){Object.assign(H.unit(a,i),{setpoint:23,mode:'heat',powerOff:false,outputAt:clock.now()});if(!i){Object.assign(a.state,{hvacRoomTemperatureC:18,hvacSetpointC:23,hvacMode:'heat'});Object.assign(a,{lastPublishedHvacSetpoint:23,lastPublishedHvacMode:'heat',lastPublishedHvacPower:true});}else{const r=a.getExtraHvac(i);Object.assign(r.state,{roomTemperatureC:18,setpointC:23,mode:'heat'});Object.assign(r,{lastPublishedSetpoint:23,lastPublishedMode:'heat',lastPublishedPower:true});}}}
function preview(a,p){return p.settings.map((s,i)=>a.calculateHvacControlFor(i,a.latestResult,null,0,0,{now:clock.now(),allowStart:true,storedSettings:a.getSettings(),hvacPortfolio:p}));}
(async()=>{
 assert.equal(H.fields.Coordination.EssentialEnabled,false);checks++;
 const h=await setup(3,{hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:1500}),a=h.app;active(a,3);essential(a,0);
 let p=C.prepare(a,a.getSettings(),a.latestResult),d=preview(a,p);assert.equal(p.totalReservedW,2400);assert.equal(p.fixedReserved.get(0),1200);checks++;
 C.plan(a,p,d,'hvac1',false);assert.notEqual(d[0].powerCommand,false);assert(!d[0].hvacBudgetReduction);assert.equal(d.filter(x=>x.powerCommand===false).length,1);checks++;
 a.setSetting('hvacExtraGridBudgetW',1);const savedStates=[a.getExtraHvac(1).state.mode,a.getExtraHvac(2).state.mode];
 a.getExtraHvac(1).state.mode='off';a.getExtraHvac(2).state.mode='off';for(let i=1;i<3;i++)Object.assign(H.unit(a,i),{powerOff:true});
 p=C.prepare(a,a.getSettings(),a.latestResult);C.commit(a,p);assert.equal(p.totalReservedW,0);assert.equal(C.budgetAlarm(a),false);checks++;
 a.setSetting('peakShaveEnabled',true);a.setSetting('peakLimitW',1000);a.state.gridPowerW=3000;a.inputUpdatedAt.grid=clock.now();
 const s=a.getHvacInstanceSettings(0),candidate={direction:'heat',energySource:'tariff',predictedGridW:3000,virtualGridW:3000};
 assert(C.admission(a,p,0,candidate).allowed,'essential HVAC excluded from both budget and peak admission');checks++;
 assert(!C.admission(a,p,1,candidate).allowed,'other HVAC still respects constraints');checks++;
 // Two physical sources at the same P1: only the ordinary one is shed.
 active(a,2);a.setSetting('hvacExtraGridBudgetEnabled',false);p=C.prepare(a,a.getSettings(),a.latestResult);d=preview(a,p);C.plan(a,p,d,'hvac1',false);
 assert.notEqual(d[0].powerCommand,false);assert.equal(d[1].powerCommand,false);assert(d[1].safetyReduction);checks++;
 // Simultaneous budget overrun must not replace another unit's Peak Guard
 // OFF with a slower budget setpoint step while the essential unit is skipped.
 a.setSetting('hvacExtraGridBudgetEnabled',true);a.setSetting('hvacExtraGridBudgetW',1);
 p=C.prepare(a,a.getSettings(),a.latestResult);d=preview(a,p);C.plan(a,p,d,'hvac1',false);
 assert.notEqual(d[0].powerCommand,false);assert.equal(d[1].powerCommand,false);assert(d[1].safetyReduction);checks++;
 // Missing P1 remains an independent stop condition, not a Peak Guard exemption.
 d=preview(a,p);d[0].gridFresh=false;C.plan(a,p,d,'hvac1',false);assert.equal(d[0].powerCommand,false);checks++;
 // Explicit permanent-control OFF remains the original immediate Flow path.
 a.inputUpdatedAt.grid=clock.now();h.events.length=0;await a.setHvacAutomaticControlFor(0,{enabled:'no'});
 assert(h.events.some(e=>e.kind==='power'&&e.state_value===0));assert.equal(a.getSettings().hvacPermanentEnabled,false);checks++;
 // The optional room cutoff still stops an essential device; this is not an
 // exemption from temperature control, outdoor limits or user commands.
 a.setSetting('hvacPermanentEnabled',true);a.setSetting('hvacCoordination',a.getSettings().hvacCoordination.map((c,i)=>i?c:{...c,KeepOnEnabled:true,KeepOnLimitEnabled:true,KeepOnMarginC:1}));
 active(a,1);a.state.hvacRoomTemperatureC=24;p=C.prepare(a,a.getSettings(),a.latestResult);d=preview(a,p);assert.equal(d[0].powerCommand,false);assert(d[0].keepOnStop);checks++;
 assert.equal(H.beforePublish(a,0,{hvacBudgetReduction:true}),false);assert.equal(H.beforePublish(a,0,{hvacEnergyReduction:true}),false);assert.equal(H.beforePublish(a,0,{safetyReduction:true,gridFresh:true}),false);checks++;
 // Physical sources shared with an essential zone count once as fixed house
 // load, never as a source that the HVAC budget can pretend to switch off.
 a.setSetting('hvacCoordination',a.getSettings().hvacCoordination.map((c,i)=>i===1?{...c,SharedPowerEnabled:true,SharedPowerWith:1}:c));p=C.prepare(a,a.getSettings(),a.latestResult);assert(p.fixedRoots.has(p.roots[1]));assert(!p.reserved.has(p.roots[1]));checks++;
 // Existing outdoor cutoff/hysteresis is reused; only the missing/new default
 // is 0.5 C. Explicitly configured values survive settings snapshots/restarts.
 const out=await setup(1,{hvacOutdoorOffAboveEnabled:true,hvacOutdoorOffAboveC:15,hvacOutdoorOffAboveHysteresisC:.5});essential(out.app,0);active(out.app,1);
 out.app.inputSeen.hvac.outdoorTemperature=true;out.app.inputUpdatedAt.hvac.outdoorTemperature=clock.now();
 for(const [temperature,blocked]of [[15.1,true],[14.8,true],[14.5,false]]){
  out.app.state.hvacOutdoorTemperatureC=temperature;
  const cfg=out.app.getHvacInstanceSettings(0),v=out.app.calculateHvacControlFor(0,out.app.latestResult,null,0,0,{now:clock.now(),allowStart:true,storedSettings:out.app.getSettings()});
  assert.equal(Boolean(v.outdoorStop),blocked);if(blocked)Object.assign(H.unit(out.app,0),{outdoorHighBlocked:true,outdoorStopped:true});checks++;
 }
 assert.equal(H.fields.OutdoorOffAboveHysteresisC,.5);out.app.setSetting('hvacOutdoorOffAboveHysteresisC',1.7);assert.equal(out.app.getHvacInstanceSettings(0).hvacOutdoorOffAboveHysteresisC,1.7);checks++;
 // Legacy PV continuation uses the same flag for energy-driven fast reset.
 // It still respects its independent battery/temperature stop conditions.
 for(const enabled of [false,true]){
  const legacy=await setup(1,{batteryCount:1,hvacPermanentEnabled:false,hvacUsePvSurplus:true,hvacAllowOnBattery:true,hvacMinBatterySoc:90,hvacStopBatterySoc:50,peakShaveEnabled:true,peakLimitW:1000});
  const b=legacy.app;essential(b,0,enabled);active(b,1);Object.assign(b.state,{gridPowerW:3000,batterySoc:[95],hvacRoomTemperatureC:18});b.inputSeen.batterySoc[0]=true;b.inputUpdatedAt.batterySoc[0]=clock.now();b.hvacBoostMode='heat';b.hvacBaselineSetpoint=20;b.hvacManagedPowerOn=true;b.latestResult={override:'peak_shave',tariff:{className:'cheap'}};
  const v=b.calculateHvacControlFor(0,b.latestResult,null,0,0,{now:clock.now(),allowStart:true,storedSettings:b.getSettings()});
  assert.equal(v.powerCommand===false,!enabled);checks++;
 }
 console.log(`HVAC essential 1.2.34: ${checks} budget, Peak Guard, explicit Flow OFF, independent stops, shared-source and hysteresis checks passed.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
