'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{boot,DEFAULTS}=require('./startup-harness');
const H=require('../lib/hvac-permanent');
const {recordMinuteSample}=require('../lib/ev-session');
const results=[],near=(a,b)=>assert(Math.abs(a-b)<.01,`${a} != ${b}`);
const nativeNow=Date.now;let now=Date.UTC(2026,9,30,12);Date.now=()=>now;
async function check(name,f){await f();results.push(name);}
async function setup(extra={}) {
 const config={...DEFAULTS,settingsSchemaVersion:71,hvacCount:10,batteryCount:0,evCount:0,controlEnabled:false,
  peakShaveEnabled:false,hvacPermanentEnabled:true,hvacTariffEnabled:true,hvacEnabled:true,hvacDirection:'heat',
  hvacAllowSetpointControl:true,hvacAllowModeControl:true,hvacControlIntervalMinutes:5,
  hvacCheapTargetC:23,hvacNormalTargetC:21,hvacExpensiveTargetC:20,...extra};
 for(let i=2;i<=10;i++)for(const suffix of ['Enabled','PermanentEnabled','TariffEnabled','Direction','AllowSetpointControl','AllowModeControl','ControlIntervalMinutes','CheapTargetC','NormalTargetC','ExpensiveTargetC'])if(!Object.hasOwn(extra,`hvac${i}${suffix}`))config[`hvac${i}${suffix}`]=config[`hvac${suffix}`];
 const h=await boot(new Map(Object.entries(config))),a=h.app;assert.deepEqual(h.errors,[]);
 a.requestContextEvaluate=()=>{};a.requestEvaluate=()=>{};
 for(let n=0;n<300;n++)await Promise.resolve();
 a.state.gridPowerW=500;a.state.pvPowerW=0;a.state.lastTotalCommandW=0;
 a.inputSeen.grid=true;a.inputSeen.pv=true;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;
 for(let i=0;i<10;i++) {
  if(!i){Object.assign(a.state,{hvacRoomTemperatureC:21,hvacSetpointC:20,hvacMode:'heat'});Object.assign(a.inputSeen.hvac,{roomTemperature:true,setpoint:true,mode:true});a.lastPublishedHvacSetpoint=20;a.lastPublishedHvacMode='heat';}
  else {const r=a.getExtraHvac(i);Object.assign(r.state,{roomTemperatureC:21,setpointC:20,mode:'heat'});Object.assign(r.seen,{roomTemperature:true,setpoint:true,mode:true});r.lastPublishedSetpoint=20;r.lastPublishedMode='heat';}
 }
 a.latestResult={tariff:{className:'cheap'}};return h;
}
function calc(a,i=0,allowStart=true){return a.calculateHvacControlFor(i,a.latestResult,null,0,0,{now,allowStart,storedSettings:a.getSettings(),totalActualEvPowerW:0,totalDesiredEvPowerW:0});}
async function main(){
 await check('Real TOU tariff selection publishes COP and ordinary targets through unchanged Flow output for all ten fixed-direction setpoint-only channels',async()=>{
  const {findCurrentTariff}=require('../lib/ems-engine');
  const rates=[{id:'low',name:'Low',importPrice:.1},{id:'mid',name:'Mid',importPrice:.2},{id:'high',name:'High',importPrice:.3}];
  const schedule=rates.map((r,i)=>({rateId:r.id,start:['00:00','08:00','16:00'][i],end:['08:00','16:00','00:00'][i],days:[1,2,3,4,5,6,7]}));
  const tariffCop={cheap:{outsideBelowC:6,targetC:5},normal:{outsideBelowC:6,targetC:55},expensive:{outsideBelowC:6,targetC:99}};
  const h=await setup({hvacAllowModeControl:false,contractType:'tou',touRates:rates,touSchedule:schedule}),a=h.app,events=[];
  h.cards.get('hvac_setpoint_updated_for_configured').trigger=async(t,s)=>events.push({setpoint:t.setpoint,instance:s.hvac});
  for(const mode of ['heat','cool'])for(let i=0;i<10;i++) {
   a.setSetting(a.getHvacSettingKey(i,'Direction'),mode);a.setSetting(a.getHvacSettingKey(i,'DirectionTemperature'),{source:'outdoor',tariffCop});
   for(const [hour,cls,ordinary] of [[5,'cheap',23],[12,'normal',21],[18,'expensive',20]])for(const outside of [5.5,6,6.5]) {
    now=Date.UTC(2026,9,30,hour);a.inputUpdatedAt.grid=now;
    const tariff=findCurrentTariff(new Date(now),a.getRuntimeSettings(a.getSettings()));assert.equal(tariff.className,cls);a.latestResult={tariff};
    await h.cards.get('set_hvac_outdoor_temperature').listener({temperature:outside});
    const reportedMode=['auto','off',''][i%3];
    if(!i){a.state.hvacMode=reportedMode;a.inputSeen.hvac.mode=Boolean(reportedMode);a.lastPublishedHvacMode='';a.lastPublishedHvacSetpoint=null;}
    else {const r=a.getExtraHvac(i);r.state.mode=reportedMode;r.seen.mode=Boolean(reportedMode);r.lastPublishedMode='';r.lastPublishedSetpoint=null;}
    Object.assign(H.unit(a,i),{mode:'',setpoint:null});H.runtime(a).nextAt=0;
    const d=calc(a,i),expected=outside<6?tariffCop[cls].targetC:ordinary,before=events.length;
    near(d.desiredSetpointC,expected);near(d.setpointCommand,expected);assert.equal(d.modeCommand,null);assert.equal(d.copTargetActive,outside<6);
    await a.publishHvacDecisionFor(i,d);assert.equal(events.length,before+1);assert.deepEqual(events.at(-1),{setpoint:expected,instance:i+1});
    assert.equal(i?a.getExtraHvac(i).lastPublishedMode:a.lastPublishedHvacMode,'','setpoint-only control must not claim a published mode');
    near(H.unit(a,i).setpoint,expected);
   }
  }
 });
 await check('Setpoint-only fixed direction preserves timers, budget, Peak Guard, outdoor limits and rejects known conflicting or automatic mode switches',async()=>{
  const h=await setup({hvacAllowModeControl:false,hvacDirectionTemperature:{source:'indoor',tariffCop:{cheap:{outsideBelowC:6,targetC:55}}}}),a=h.app;
  a.inputSeen.hvac.outdoorTemperature=true;a.state.hvacOutdoorTemperatureC=5;a.inputSeen.hvac.mode=false;a.lastPublishedHvacMode='';
  Object.assign(H.unit(a,0),{mode:'',setpoint:null});H.runtime(a).nextAt=now+300000;assert.equal(calc(a).setpointCommand,null);
  H.runtime(a).nextAt=0;a.setSetting('hvacExtraGridBudgetEnabled',true);a.setSetting('hvacExtraGridBudgetW',0);assert.equal(calc(a).setpointCommand,null);
  a.setSetting('hvacExtraGridBudgetEnabled',false);a.setSetting('peakShaveEnabled',true);a.setSetting('peakLimitW',1000);assert.equal(calc(a).setpointCommand,null);
  a.setSetting('peakShaveEnabled',false);a.setSetting('hvacOutdoorNoIncreaseEnabled',true);a.setSetting('hvacOutdoorNoIncreaseAboveC',0);assert.equal(calc(a).setpointCommand,null);
  a.setSetting('hvacOutdoorNoIncreaseEnabled',false);const queued=calc(a);near(queued.setpointCommand,55);
  a.inputSeen.hvac.mode=true;a.state.hvacMode='cool';assert.equal(H.beforePublish(a,0,queued),false,'new conflicting mode feedback invalidates a queued setpoint-only command');
  for(const mode of ['heat','cool']) {
   a.setSetting('hvacDirection',mode);a.inputSeen.hvac.mode=true;a.state.hvacMode=mode==='heat'?'cool':'heat';a.lastPublishedHvacMode=mode;H.unit(a,0).mode=mode;
   const d=calc(a);assert.equal(d.setpointCommand,null);assert.equal(d.reason,'HVAC-modusuitvoer niet toegestaan');
  }
  a.setSetting('hvacDirection','heat');a.state.hvacMode='cool';a.setSetting('hvacAllowPowerControl',true);a.setSetting('hvacOutdoorOffEnabled',true);a.setSetting('hvacOutdoorOffBelowC',10);
  const stop=calc(a);assert.equal(stop.powerCommand,false);assert(H.beforePublish(a,0,stop),'mode conflict must never prevent an outdoor safety shutdown');
  await a.publishHvacDecisionFor(0,stop);assert(H.unit(a,0).outdoorStopped);a.setSetting('hvacOutdoorOffEnabled',false);
  a.setSetting('hvacDirection','auto');a.setSetting('hvacDirectionTemperature',{source:'outdoor',heatingBelowC:16,coolingAboveC:25});a.state.hvacMode='cool';a.lastPublishedHvacMode='cool';H.unit(a,0).mode='cool';assert.equal(calc(a).setpointCommand,null);
 });
 await check('COP tariff targets select strictly below independent outdoor thresholds for all ten channels and preserve ordinary targets without valid feedback/configuration',async()=>{
  const h=await setup(),a=h.app;a.inputSeen.hvac.outdoorTemperature=true;
  const tariffCop={cheap:{outsideBelowC:6,targetC:19},normal:{outsideBelowC:3,targetC:18},expensive:{outsideBelowC:0,targetC:17}};
  for(let i=0;i<10;i++) {
   const key=a.getHvacSettingKey(i,'DirectionTemperature');a.setSetting(key,{source:'indoor',heatingBelowC:16,coolingAboveC:25,tariffCop});
   for(const mode of ['heat','cool'])for(const [cls,ordinary] of [['cheap',23],['normal',21],['expensive',20]]) {
    a.setSetting(a.getHvacSettingKey(i,'Direction'),mode);a.latestResult.tariff.className=cls;const rule=tariffCop[cls];
    a.state.hvacOutdoorTemperatureC=rule.outsideBelowC-.5;let d=calc(a,i);near(d.desiredSetpointC,rule.targetC);assert(d.copTargetActive);
    a.state.hvacOutdoorTemperatureC=rule.outsideBelowC;d=calc(a,i);near(d.desiredSetpointC,ordinary);assert(!d.copTargetActive);
    a.state.hvacOutdoorTemperatureC=rule.outsideBelowC+1;near(calc(a,i).desiredSetpointC,ordinary);
    a.inputSeen.hvac.outdoorTemperature=false;near(calc(a,i).desiredSetpointC,ordinary);a.inputSeen.hvac.outdoorTemperature=true;
   }
   a.latestResult.tariff.className='cheap';a.state.hvacOutdoorTemperatureC=-5;
   for(const incomplete of [null,{}, {outsideBelowC:6}, {targetC:19}, {outsideBelowC:'',targetC:19}, {outsideBelowC:6,targetC:NaN}]) {
    a.setSetting(key,{source:'indoor',tariffCop:{cheap:incomplete}});near(calc(a,i).desiredSetpointC,23);
   }
   a.setSetting(key,{source:'indoor',tariffCop:{cheap:{outsideBelowC:6,targetC:120}}});near(calc(a,i).desiredSetpointC,99);
  }
 });
 await check('Cold-weather reductions are immediate; normal-target recovery respects the interval and queued COP decisions revalidate weather/settings',async()=>{
  const config={source:'indoor',heatingBelowC:16,coolingAboveC:25,tariffCop:{cheap:{outsideBelowC:6,targetC:19}}};
  const h=await setup({hvacDirectionTemperature:config}),a=h.app;a.inputSeen.hvac.outdoorTemperature=true;a.state.hvacOutdoorTemperatureC=5;
  H.runtime(a).nextAt=now+300000;let d=calc(a);near(d.setpointCommand,19);assert(!d.increase);await a.publishHvacDecisionFor(0,d);
  a.state.hvacOutdoorTemperatureC=6;d=calc(a);assert.equal(d.setpointCommand,null);assert(d.waiting);
  now+=300000;a.inputUpdatedAt.grid=now;d=calc(a);near(d.setpointCommand,23);a.state.hvacOutdoorTemperatureC=5;assert.equal(H.beforePublish(a,0,d),false);
  a.state.hvacOutdoorTemperatureC=6;d=calc(a);a.setSetting('hvacDirectionTemperature',{...config,tariffCop:{cheap:{outsideBelowC:6,targetC:18}}});assert.equal(H.beforePublish(a,0,d),false);
  a.state.hvacOutdoorTemperatureC=5;d=calc(a);near(d.setpointCommand,18);await a.publishHvacDecisionFor(0,d);
  const restarted=await boot(new Map(h.store));assert.deepEqual(restarted.app.getHvacInstanceSettings(0).hvacDirectionTemperature.tariffCop,{cheap:{outsideBelowC:6,targetC:18}});
 });
 await check('COP changes tariff targets only; PV, after-PV and periodic heating retain their existing priorities',async()=>{
  const h=await setup({hvacDirectionTemperature:{source:'indoor',tariffCop:{cheap:{outsideBelowC:6,targetC:18}}},hvacPvEnabled:true,hvacPvTargetC:27,hvacAfterPvTargetC:22}),a=h.app;
  a.inputSeen.hvac.outdoorTemperature=true;a.state.hvacOutdoorTemperatureC=5;a.state.gridPowerW=-6000;a.state.pvPowerW=7000;a.inputUpdatedAt.pv=now;
  let d=calc(a);near(d.desiredSetpointC,27);assert(!d.copTargetActive);assert(!d.copOutdoorDependent);
  a.state.gridPowerW=500;d=calc(a);near(d.desiredSetpointC,18);assert(d.copTargetActive);
  a.setSetting('hvacTariffEnabled',false);d=calc(a);near(d.desiredSetpointC,22);assert(!d.copTargetActive);
  a.setSetting('hvacTariffEnabled',true);a.setSetting('hvacPeriodicHeatEnabled',true);a.setSetting('hvacPeriodicHeatTargetC',55);
  d=calc(a);near(d.setpointCommand,55);assert(d.periodicHeating);assert(!d.copTargetActive);await a.publishHvacDecisionFor(0,d);
  a.setSetting('hvacPeriodicHeatEnabled',false);d=calc(a);assert(d.periodicCleanup);near(d.setpointCommand,18);
 });
 await check('Outdoor automatic direction selects heat below 16, cool above 25 and holds the current mode between thresholds for all ten channels',async()=>{
  const h=await setup(),a=h.app;a.inputSeen.hvac.outdoorTemperature=true;
  for(let i=0;i<10;i++) {
   a.setSetting(a.getHvacSettingKey(i,'Direction'),'auto');a.setSetting(a.getHvacSettingKey(i,'DirectionTemperature'),{source:'outdoor',heatingBelowC:16,coolingAboveC:25});
   for(const [outside,inside,current,expected] of [[15,23,'cool','heat'],[26,21,'heat','cool'],[16,18,'cool','cool'],[25,28,'heat','heat'],[20,30,'heat','heat'],[20,10,'cool','cool']]) {
    a.state.hvacOutdoorTemperatureC=outside;
    if(!i){a.state.hvacRoomTemperatureC=inside;a.state.hvacMode=current;a.lastPublishedHvacMode=current;}
    else {const r=a.getExtraHvac(i);r.state.roomTemperatureC=inside;r.state.mode=current;r.lastPublishedMode=current;}
    assert.equal(calc(a,i).direction,expected);
   }
   a.setSetting(a.getHvacSettingKey(i,'DirectionTemperature'),{source:'outdoor',heatingBelowC:10,coolingAboveC:30});
   a.state.hvacOutdoorTemperatureC=26;assert.equal(calc(a,i).direction,'cool','neutral band retains actual cooling');
   if(!i)a.state.hvacMode='heat';else a.getExtraHvac(i).state.mode='heat';
   assert.equal(calc(a,i).direction,'heat');a.state.hvacOutdoorTemperatureC=31;assert.equal(calc(a,i).direction,'cool');
   a.setSetting(a.getHvacSettingKey(i,'Direction'),'heat');assert.equal(calc(a,i).direction,'heat','fixed direction overrides selected source');
  }
 });
 await check('Outdoor automatic switches respect intervals, permission, missing feedback, publication revalidation and periodic heating',async()=>{
  const h=await setup({hvacDirection:'auto',hvacDirectionTemperature:{source:'outdoor',heatingBelowC:16,coolingAboveC:25}}),a=h.app;
  a.state.hvacRoomTemperatureC=23;assert.equal(calc(a).setpointCommand,null,'unknown outdoor temperature cannot start extra demand');
  a.inputSeen.hvac.outdoorTemperature=true;a.state.hvacOutdoorTemperatureC=20;a.state.hvacMode='off';a.lastPublishedHvacMode='';
  assert.equal(calc(a).setpointCommand,null,'neutral outdoor temperature cannot invent a first heating/cooling mode');
  a.state.hvacMode='heat';a.lastPublishedHvacMode='heat';
  a.inputSeen.hvac.outdoorTemperature=true;a.state.hvacOutdoorTemperatureC=26;
  H.runtime(a).nextAt=now+300000;let d=calc(a);assert.equal(d.direction,'cool');assert.equal(d.modeCommand,null);assert(d.waiting);
  H.runtime(a).nextAt=0;a.setSetting('hvacAllowModeControl',false);d=calc(a);assert.equal(d.modeCommand,null);assert(d.waiting);
  a.setSetting('hvacAllowModeControl',true);d=calc(a);assert.equal(d.modeCommand,'cool');a.state.hvacOutdoorTemperatureC=15;
  assert.equal(H.beforePublish(a,0,d),false,'changed outdoor source invalidates queued cooling');
  a.state.hvacOutdoorTemperatureC=26;d=calc(a);await a.publishHvacDecisionFor(0,d);assert.equal(H.unit(a,0).mode,'cool');
  now+=300000;a.inputUpdatedAt.grid=now;a.state.hvacMode='cool';a.state.hvacOutdoorTemperatureC=15;
  d=calc(a);assert.equal(d.direction,'heat');assert.equal(d.modeCommand,'heat');await a.publishHvacDecisionFor(0,d);assert.equal(H.unit(a,0).mode,'heat');
  a.setSetting('hvacPeriodicHeatEnabled',true);a.state.hvacOutdoorTemperatureC=30;a.state.hvacMode='heat';
  now+=300000;a.inputUpdatedAt.grid=now;d=calc(a);assert(d.periodicHeating);assert.equal(d.direction,'heat');
  const restarted=await boot(new Map(h.store));assert.equal(restarted.app.getHvacInstanceSettings(0).hvacDirectionTemperature.source,'outdoor');
 });
 await check('Indoor source remains the default and non-permanent PV activation can explicitly use outdoor thresholds',async()=>{
  const h=await setup({hvacPermanentEnabled:false,hvacDirection:'auto'}),a=h.app;
  assert.equal(a.getSettings().hvacDirectionTemperature.source,'indoor');
  for(let i=0;i<10;i++){const s=a.getHvacInstanceSettings(i);assert.equal(s.hvacDirectionTemperature.source,'indoor');assert.equal(s.hvacDirectionTemperature.heatingBelowC,16);assert.equal(s.hvacDirectionTemperature.coolingAboveC,25);}
  a.inputSeen.hvac.outdoorTemperature=true;a.state.hvacOutdoorTemperatureC=15;a.state.hvacRoomTemperatureC=20.5;
  a.state.gridPowerW=-6000;a.state.pvPowerW=7000;a.inputUpdatedAt.pv=now;
  assert.equal(calc(a).setpointCommand,null,'legacy indoor activation stays within the neutral band');
  a.setSetting('hvacDirectionTemperature',{source:'outdoor',heatingBelowC:16,coolingAboveC:25});let d=calc(a);assert.equal(d.boostMode,'heat');assert.notEqual(d.setpointCommand,null);
  a.hvacBaselineSetpoint=null;a.hvacBoostMode=null;a.state.hvacMode='cool';a.lastPublishedHvacMode='cool';a.state.hvacOutdoorTemperatureC=26;a.state.hvacRoomTemperatureC=23.5;a.lastHvacControlAt=0;
  d=calc(a);assert.equal(d.boostMode,'cool');
 });
 await check('Outdoor limits block extra demand, allow reductions and stop/resume heat and cool',async()=>{
  for(const mode of ['heat','cool']) {
   const h=await setup({hvacDirection:mode,hvacAllowPowerControl:true,hvacOutdoorNoIncreaseEnabled:true,hvacOutdoorNoIncreaseAboveC:20,hvacOutdoorOffEnabled:true,hvacOutdoorOffBelowC:5}),a=h.app;
   a.inputSeen.hvac.outdoorTemperature=true;a.state.hvacOutdoorTemperatureC=25;
   a.state.hvacMode=mode;a.lastPublishedHvacMode=mode;
   a.lastPublishedHvacSetpoint=mode==='heat'?20:24;a.setSetting('hvacCheapTargetC',mode==='heat'?23:19);
   assert.equal(calc(a).setpointCommand,null);
   a.lastPublishedHvacSetpoint=mode==='heat'?25:18;
   assert.equal(calc(a).setpointCommand,mode==='heat'?23:19);
   a.state.hvacOutdoorTemperatureC=2;let d=calc(a);assert.equal(d.powerCommand,false);assert.equal(d.setpointCommand,null);
   await a.publishHvacDecisionFor(0,d);assert.equal(H.unit(a,0).outdoorStopped,true);
   a.state.hvacOutdoorTemperatureC=10;d=calc(a);assert.equal(d.powerCommand,true);
   await a.publishHvacDecisionFor(0,d);assert.equal(H.unit(a,0).outdoorStopped,false);
   a.state.hvacOutdoorTemperatureC=2;a.setSetting('hvacAllowPowerControl',false);assert.equal(calc(a).powerCommand,null);
   a.inputSeen.hvac.outdoorTemperature=false;a.lastPublishedHvacSetpoint=mode==='heat'?20:24;
   assert.equal(calc(a).setpointCommand,null);
  }
 });
 await check('Outdoor high/low shutdown hysteresis prevents flapping and persists successful stops',async()=>{
  for(const mode of ['heat','cool'])for(const side of ['low','high'])for(const margin of [1,2.5,0]) {
   const h=await setup({hvacDirection:mode,hvacAllowPowerControl:true,hvacOutdoorOffEnabled:side==='low',hvacOutdoorOffBelowC:5,hvacOutdoorOffBelowHysteresisC:margin,hvacOutdoorOffAboveEnabled:side==='high',hvacOutdoorOffAboveC:25,hvacOutdoorOffAboveHysteresisC:margin}),a=h.app;
   a.inputSeen.hvac.outdoorTemperature=true;a.state.hvacMode=mode;a.lastPublishedHvacMode=mode;
   a.setSetting('hvacCheapTargetC',mode==='heat'?23:19);
   const edge=side==='low'?5:25,sign=side==='low'?1:-1;
   a.state.hvacOutdoorTemperatureC=edge-sign*.2;
   let d=calc(a);assert.equal(d.powerCommand,false);await a.publishHvacDecisionFor(0,d);
   const saved=h.store.get('_hvacPermanent');assert.equal(saved.units[0][side==='low'?'outdoorLowBlocked':'outdoorHighBlocked'],true);
   const restarted=await boot(new Map(h.store));assert.equal(H.unit(restarted.app,0)[side==='low'?'outdoorLowBlocked':'outdoorHighBlocked'],true);
   for(const value of [edge-sign*.1,edge+sign*(margin-.1)]) {a.state.hvacOutdoorTemperatureC=value;assert.equal(calc(a).powerCommand,false);}
   a.state.hvacOutdoorTemperatureC=edge+sign*margin;d=calc(a);assert.equal(d.powerCommand,true,'release exactly at threshold plus/minus margin');
   await a.publishHvacDecisionFor(0,d);assert.equal(H.unit(a,0).outdoorStopped,false);
   a.state.hvacOutdoorTemperatureC=edge;assert.equal(calc(a).powerCommand,null,'no shutdown at exact edge');
  }
 });
 await check('Periodic heating starts only in cheap tariff and counts holding time after successful target and reached temperature',async()=>{
  const h=await setup({hvacPeriodicHeatEnabled:true,hvacPeriodicHeatDays:7,hvacPeriodicHeatHours:.1,hvacPeriodicHeatTargetC:30}),a=h.app;
  const tick=()=>{a.inputUpdatedAt.hvac.roomTemperature=now;return calc(a);};
  a.latestResult.tariff.className='expensive';assert.equal(tick().periodicHeating,false);
  a.latestResult.tariff.className='cheap';let d=tick();assert.equal(d.periodicHeating,true);assert.equal(d.setpointCommand,30);await a.publishHvacDecisionFor(0,d);
  for(let n=0;n<3;n++){now+=60000;a.inputUpdatedAt.grid=now;tick();}assert.equal(H.unit(a,0).periodic.heldMs,0,'warmup is not holding time');
  a.state.hvacRoomTemperatureC=30;tick();
  for(let n=0;n<3;n++){now+=60000;a.inputUpdatedAt.grid=now;tick();}assert.equal(H.unit(a,0).periodic.heldMs,180000);
  a.latestResult.tariff.className='expensive';d=tick();assert.equal(d.periodicCleanup,true);assert.equal(d.setpointCommand,23);await a.publishHvacDecisionFor(0,d);
  const held=H.unit(a,0).periodic.heldMs;now+=3600000;a.inputUpdatedAt.grid=now;tick();assert.equal(H.unit(a,0).periodic.heldMs,held);
  a.latestResult.tariff.className='cheap';d=tick();await a.publishHvacDecisionFor(0,d);tick();
  for(let n=0;n<3;n++){now+=60000;a.inputUpdatedAt.grid=now;d=tick();}assert.equal(d.periodicCleanup,true);assert.equal(H.unit(a,0).periodic.lastCompletedAt,now);
  await a.publishHvacDecisionFor(0,d);assert.equal(H.unit(a,0).periodic.applied,false);assert.equal(tick().periodicHeating,false);
  now+=7*86400000;a.inputUpdatedAt.grid=now;assert.equal(tick().periodicHeating,true);
 });
 await check('Periodic heating respects external limits and restores on disable without counting restart downtime',async()=>{
  const h=await setup({hvacPeriodicHeatEnabled:true,hvacPeriodicHeatHours:1,hvacPeriodicHeatTargetC:30}),a=h.app;
  const tick=()=>{a.inputUpdatedAt.hvac.roomTemperature=now;return calc(a);};
  a.setSetting('hvacOutdoorOffAboveEnabled',true);a.setSetting('hvacOutdoorOffAboveC',25);a.inputSeen.hvac.outdoorTemperature=true;a.state.hvacOutdoorTemperatureC=26;
  assert.equal(tick().setpointCommand,null);assert(!H.unit(a,0).periodic.applied);
  a.state.hvacOutdoorTemperatureC=20;let d=tick();await a.publishHvacDecisionFor(0,d);assert.equal(H.unit(a,0).periodic.applied,true);
  const restarted=await boot(new Map(h.store));assert.equal(H.unit(restarted.app,0).periodic.applied,true);assert(!H.runtime(restarted.app).periodicLive?.[0]?.qualified);assert.equal(H.unit(restarted.app,0).periodic.heldMs,H.unit(a,0).periodic.heldMs);
  a.setSetting('hvacPeriodicHeatEnabled',false);a.setSetting('hvacTariffEnabled',false);a.setSetting('hvacPvEnabled',false);d=tick();assert.equal(d.periodicCleanup,true);await a.publishHvacDecisionFor(0,d);assert.equal(H.unit(a,0).periodic.applied,false);
 });
 await check('HVAC uses only slow context cadence; P1 breadcrumbs do not evaluate or schedule HVAC',async()=>{
  const h=await setup({hvacPeriodicHeatEnabled:true}),a=h.app;
  const baseline=a.getSettings();a.getHvacInstanceSettings=()=>{throw Error('meter predicates must not project HVAC settings');};
  assert(a.needsNonEvMeterContext(baseline));assert(a.needsSlowMeterContext(baseline));delete a.getHvacInstanceSettings;
  H.runtime(a).observation={index:0,startAt:now,lastAt:now,endAt:now+300000};
  const settings=a.getSettings,ev=a.getEvInputSnapshot;a.getSettings=()=>{throw Error('P1 must not read full settings');};a.getEvInputSnapshot=()=>{throw Error('P1 must not scan EVs');};
  for(let n=1;n<=30;n++){now+=1000;H.observe(a,now);}
  assert(H.runtime(a).observation);assert.equal(H.runtime(a).observation.count,undefined);
  a.getSettings=settings;a.getEvInputSnapshot=ev;H.runtime(a).observation=null;
  let calls=0;const calcFor=a.calculateHvacControlFor.bind(a);a.calculateHvacControlFor=(...args)=>{calls++;return calcFor(...args);};
  a.lastHvacContextEvalAt=0;const first=a.evaluateContextNow();for(let n=0;n<400;n++)await Promise.resolve();assert.equal(first._runHvacContextPass,true);assert(calls>0);
  const before=calls;now+=1000;a.inputUpdatedAt.grid=now;const second=a.evaluateContextNow();for(let n=0;n<400;n++)await Promise.resolve();assert.equal(second._runHvacContextPass,false);assert.equal(calls,before);
  now+=a.getSlowControlIntervalMs();a.inputUpdatedAt.grid=now;const third=a.evaluateContextNow();for(let n=0;n<400;n++)await Promise.resolve();assert.equal(third._runHvacContextPass,true);assert(calls>before);
  assert.deepEqual(h.errors,[]);
 });
 await check('All ten channels through unchanged dynamic input and output cards',async()=>{
  const h=await setup(),a=h.app;assert.equal(a.getHvacCount(),10);
  assert.equal((await h.cards.get('set_hvac_room_temperature_for_configured').autocomplete.hvac('')).length,10);
  for(let i=1;i<=10;i++) {
   await h.cards.get('set_hvac_room_temperature_for_configured').listener({hvac:{id:String(i),kind:'hvac',name:`HVAC ${i}`},temperature:19+i/10});
   near(a.getHvacInputSnapshot(i-1).roomTemperatureC,19+i/10);
  }
  assert(![...h.cards.keys()].some(k=>/^(?:set_)?hvac(?:[5-9]|10)_/.test(k)),'no nonexistent legacy cards registered');
  const events=[];h.cards.get('hvac_setpoint_updated_for_configured').trigger=async(t,s)=>events.push({t,s});
  const d=calc(a,9);await a.publishHvacDecisionFor(9,d);
  assert.equal(events.length,1);assert.equal(events[0].s.hvac,10);near(events[0].t.setpoint,23);
 });
 await check('Matrix A/C: five simultaneous reductions bypass budget, interval and already reached room',async()=>{
  for(const mode of ['heat','cool']) {
   const h=await setup(),a=h.app;H.runtime(a).nextAt=now+300000;
   for(let i=0;i<5;i++) {
    a.setSetting(a.getHvacSettingKey(i,'Direction'),mode);a.setSetting(a.getHvacSettingKey(i,'CheapTargetC'),mode==='heat'?20:23);
    const u=H.unit(a,i);u.setpoint=mode==='heat'?23:19;u.mode=mode;
    if(!i){a.lastPublishedHvacSetpoint=u.setpoint;a.lastPublishedHvacMode=mode;a.state.hvacRoomTemperatureC=mode==='heat'?22.5:20;}
    else{const r=a.getExtraHvac(i);r.lastPublishedSetpoint=u.setpoint;r.lastPublishedMode=mode;r.state.roomTemperatureC=mode==='heat'?22.5:20;}
    a.setSetting('hvacExtraGridBudgetEnabled',true);a.setSetting('hvacExtraGridBudgetW',0);
    const d=calc(a,i,false);assert(!d.increase);near(d.setpointCommand,mode==='heat'?20:23);
    await a.publishHvacDecisionFor(i,d);assert.equal(H.unit(a,i).setpoint,d.setpointCommand,JSON.stringify({i,mode,d,slot:a.getHvacPublishSlot(i),u:H.unit(a,i)}));
   }
  }
 });
 await check('Matrix B/D: at most one heat increase or cooling decrease per global interval',async()=>{
  for(const mode of ['heat','cool']) {
   const h=await setup(),a=h.app;
   for(let i=0;i<5;i++){a.setSetting(a.getHvacSettingKey(i,'Direction'),mode);a.setSetting(a.getHvacSettingKey(i,'CheapTargetC'),mode==='heat'?23:19);
    if(!i){a.lastPublishedHvacSetpoint=mode==='heat'?20:23;a.lastPublishedHvacMode=mode;a.state.hvacMode=mode;}
    else {const r=a.getExtraHvac(i);r.lastPublishedSetpoint=mode==='heat'?20:23;r.lastPublishedMode=mode;r.state.mode=mode;}}
   await a.publishHvacDecisionFor(0,calc(a,0));for(let i=1;i<5;i++)assert.equal(calc(a,i).setpointCommand,null);
   now+=300000;a.inputUpdatedAt.grid=now;assert.equal(calc(a,1).setpointCommand,mode==='heat'?23:19);
  }
 });
 await check('Tariff matrix and all four optimization combinations with correct PV fallback',async()=>{
  const h=await setup(),a=h.app;
  for(const [cls,target]of [['cheap',23],['normal',21],['expensive',20]]){a.latestResult.tariff.className=cls;near(calc(a).desiredSetpointC,target);}
  a.setSetting('hvacPvEnabled',true);a.setSetting('hvacPvTargetC',25);a.state.gridPowerW=-5000;a.state.pvPowerW=6000;a.inputUpdatedAt.pv=now;
  near(calc(a).desiredSetpointC,25);assert.equal(calc(a).energySource,'pv');
  a.state.gridPowerW=500;near(calc(a).desiredSetpointC,20);
  a.setSetting('hvacTariffEnabled',false);a.setSetting('hvacAfterPvTargetC',19);near(calc(a).desiredSetpointC,19);
  a.setSetting('hvacPvEnabled',false);assert(!calc(a).permanent);
  a.setSetting('hvacTariffEnabled',true);a.setSetting('hvacPermanentEnabled',false);assert(!calc(a).permanent);
 });
 await check('Budget respects learned power and review; necessary comfort survives optional grid cap',async()=>{
  const h=await setup({hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:1500}),a=h.app;
  assert.equal(calc(a).setpointCommand,null);
  H.unit(a,0).heat=800;near(calc(a).setpointCommand,23);
  H.recheck(a,0,'heat');assert.equal(calc(a).setpointCommand,null);near(H.unit(a,0).heat,800);
  a.state.hvacRoomTemperatureC=18;near(calc(a).setpointCommand,23);
  a.setSetting('peakShaveEnabled',true);a.setSetting('peakLimitW',1000);assert.equal(calc(a).setpointCommand,null);
 });
 await check('Shared HVAC import budget reserves other units and excludes unrelated household import',async()=>{
  const h=await setup({hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:1500}),a=h.app;
  a.state.gridPowerW=7000;H.unit(a,0).heat=800;near(calc(a).setpointCommand,23);
  H.unit(a,1).heat=800;H.unit(a,1).setpoint=23;H.unit(a,1).mode='heat';
  assert.equal(calc(a).setpointCommand,null,'combined 1600 W exceeds 1500 W');
 });
 await check('All ten HVAC channels accept warm-water tariff/PV targets and clamp only beyond 5–99 C',async()=>{
  const h=await setup(),a=h.app;
  for(let i=0;i<10;i++)for(const [input,expected] of [[4,5],[40,40],[55,55],[98.5,98.5],[99,99],[120,99]]) {
   a.setSetting(a.getHvacSettingKey(i,'TariffEnabled'),true);a.setSetting(a.getHvacSettingKey(i,'PvEnabled'),false);
   for(const [cls,suffix] of [['cheap','CheapTargetC'],['normal','NormalTargetC'],['expensive','ExpensiveTargetC']]) {
    a.latestResult.tariff.className=cls;a.setSetting(a.getHvacSettingKey(i,suffix),input);near(calc(a,i).desiredSetpointC,expected);
   }
   a.setSetting(a.getHvacSettingKey(i,'PvEnabled'),true);a.setSetting(a.getHvacSettingKey(i,'PvTargetC'),input);
   a.state.gridPowerW=-5000;near(calc(a,i).desiredSetpointC,expected);
   a.state.gridPowerW=500;a.setSetting(a.getHvacSettingKey(i,'TariffEnabled'),false);a.setSetting(a.getHvacSettingKey(i,'AfterPvTargetC'),input);near(calc(a,i).desiredSetpointC,expected);
  }
  for(const mode of ['heat','cool'])for(const input of [55,99,120]) {
   const s={hvacComfortMinC:input,hvacComfortMaxC:input,hvacEnergyDeviationC:2,hvacPriority:'comfort'};
   near(a.getHvacTargetSetpoint(mode,s),Math.min(99,input));s.hvacPriority='pv';near(a.getHvacTargetSetpoint(mode,s),Math.min(99,input+(mode==='heat'?2:-2)));
  }
 });
 await check('Warm-water targets publish, receive feedback and persist for channels 1–10',async()=>{
  const h=await setup(),a=h.app,events=[];
  h.cards.get('hvac_setpoint_updated_for_configured').trigger=async(t,s)=>events.push({t,s});
  for(let i=0;i<10;i++)for(const target of [55,99]) {
   now+=300000;a.inputUpdatedAt.grid=now;a.setSetting(a.getHvacSettingKey(i,'CheapTargetC'),target);
   const d=calc(a,i);near(d.setpointCommand,target);await a.publishHvacDecisionFor(i,d);
   assert.equal(events.at(-1).s.hvac,i+1);near(events.at(-1).t.setpoint,target);
   const selection={id:String(i+1),kind:'hvac',name:`HVAC ${i+1}`};
   await h.cards.get('set_hvac_setpoint_for_configured').listener({hvac:selection,setpoint:target});
   await h.cards.get('set_hvac_room_temperature_for_configured').listener({hvac:selection,temperature:target});
   near(a.getHvacInputSnapshot(i).setpointC,target);near(a.getHvacInputSnapshot(i).roomTemperatureC,target);
   assert.equal(calc(a,i).setpointCommand,null);
  }
  const restarted=await boot(new Map(h.store));for(let i=0;i<10;i++)near(H.unit(restarted.app,i).setpoint,99);
 });
 await check('Periodic warm-water heating supports 55–99 C and completes holding after measured target',async()=>{
  for(const [input,target] of [[55,55],[99,99],[120,99]]) {
   const h=await setup({hvacPeriodicHeatEnabled:true,hvacPeriodicHeatTargetC:input,hvacPeriodicHeatHours:.1}),a=h.app;
   let d=calc(a);near(d.setpointCommand,target);await a.publishHvacDecisionFor(0,d);
   a.state.hvacRoomTemperatureC=target;a.inputUpdatedAt.hvac.roomTemperature=now;calc(a);
   for(let n=0;n<6;n++){now+=60000;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.hvac.roomTemperature=now;d=calc(a);}
   assert.equal(H.unit(a,0).periodic.lastCompletedAt,now);assert(d.periodicCleanup);near(d.setpointCommand,23);
  }
 });
 await check('Missing room/P1 rejects increases, while reducing known goals needs no room feedback',async()=>{
  const h=await setup(),a=h.app;a.inputSeen.hvac.roomTemperature=false;assert.equal(calc(a).setpointCommand,null);
  a.lastPublishedHvacSetpoint=25;near(calc(a).setpointCommand,23);
  a.inputUpdatedAt.grid=0;near(calc(a).setpointCommand,23);
 });
 await check('Automatic direction switches are treated conservatively as energy increases',async()=>{
  const h=await setup({hvacDirection:'auto'}),a=h.app;a.state.hvacRoomTemperatureC=27;
  const d=calc(a,0,false);assert.equal(d.direction,'cool');assert(d.increase);assert.equal(d.setpointCommand,null);
 });
 await check('Restart restores receipts and delay; failed/partial outputs never record new target',async()=>{
  let h=await setup(),a=h.app;await a.publishHvacDecisionFor(0,calc(a));
  const saved=h.store.get('_hvacPermanent');near(saved.units[0].setpoint,23);
  h=await boot(h.store);a=h.app;near(H.unit(a,0).setpoint,23);assert(H.runtime(a).nextAt>now);assert.equal(H.runtime(a).observation,null);
  h=await setup();a=h.app;a.hvacSetpointTrigger.trigger=async()=>{throw new Error('synthetic failure');};
  await assert.rejects(a.publishHvacDecisionFor(0,calc(a)),/synthetic failure/);assert.equal(H.unit(a,0).setpoint,null);assert(H.runtime(a).nextAt>now);
 });
 await check('No duplicate published targets; stale queued settings do not publish obsolete goals',async()=>{
  const h=await setup(),a=h.app;await a.publishHvacDecisionFor(0,calc(a));assert.equal(calc(a).setpointCommand,null);
  const pending=calc(a,1);a.hvacConfigRevision=1;assert.equal(H.beforePublish(a,1,pending),false);
 });
 await check('Shared physical installation has one owner; other channels cannot issue conflicting goals',async()=>{
  const h=await setup({hvacPhysicalGroup:'pump',hvac2PhysicalGroup:'pump',flexibleLoadPriorityOrder:['hvac2','hvac1']}),a=h.app;
  assert.equal(calc(a,0).setpointCommand,null);near(calc(a,1).setpointCommand,23);
 });
 await check('Learning uses existing minute bins, accepts a stable plateau and stores heat/cool separately',async()=>{
  for(const mode of ['heat','cool']) {
   const h=await setup(),a=h.app;const start=now;
   a.evSessionDetection.houseHistory=[];
   for(let m=-4;m<0;m++)for(let n=0;n<3;n++)recordMinuteSample(a.evSessionDetection.houseHistory,500,start+m*60000+n*1000);
   H.begin(a,0,{direction:mode},now);assert(H.runtime(a).observation);
   for(let n=1;n<=300;n++) {now=start+n*1000;a.state.gridPowerW=1300;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;recordMinuteSample(a.evSessionDetection.houseHistory,1300,now);H.observe(a,now);if(n%60===0)H.slowTick(a,now);}
   H.finish(a,now);near(H.unit(a,0)[mode],800);assert.equal(H.runtime(a).observation,null);assert.equal(H.status(a,0)[`${mode}Status`],'Betrouwbaar');
   assert.equal(H.status(a,0)[`${mode==='heat'?'cool':'heat'}W`],null);
  }
 });
 await check('Learning rejects any configured EV with unknown or connected status, including 0 A',async()=>{
  const h=await setup({evCount:2}),a=h.app;assert(!H.evFree(a));
  for(let i=0;i<2;i++){const input=i?a.getExtraEv(i):null;if(input){input.seen.connected=true;input.state.connected=false;}else{a.inputSeen.ev.connected=true;a.state.evConnected=false;}}
  assert(H.evFree(a));a.getExtraEv(1).state.connected=true;assert(!H.evFree(a));
  H.runtime(a).observation={index:0,lastAt:now,endAt:now+300000};H.observe(a);H.slowTick(a);assert.equal(H.runtime(a).observation,null);
 });
 await check('Short/unstable/missing/battery-contaminated learning is rejected without replacing stored power',async()=>{
  for(const scenario of ['short','unstable','gap','battery']) {
   const h=await setup(),a=h.app;H.unit(a,0).heat=900;H.unit(a,0).heatReview=true;
   const start=now;a.evSessionDetection.houseHistory=[];for(let m=-4;m<0;m++)for(let n=0;n<3;n++)recordMinuteSample(a.evSessionDetection.houseHistory,500,start+m*60000+n*1000);
   if(scenario==='short')a.setSetting('hvacControlIntervalMinutes',1);
   H.begin(a,0,{direction:'heat'},now);
   if(scenario==='short'){assert.equal(H.runtime(a).observation,null);continue;}
   for(let n=1;n<=300;n++){now=start+n*1000;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;if(scenario==='battery'&&n===50)a.state.lastTotalCommandW=1000;
    if(scenario!=='gap'||n<50) {recordMinuteSample(a.evSessionDetection.houseHistory,scenario==='unstable'?(n%80<40?1000:3000):1300,now);H.observe(a,now);if(n%60===0)H.slowTick(a,now);}}
   H.finish(a,now);near(H.unit(a,0).heat,900);assert(H.unit(a,0).heatReview);assert.equal(H.runtime(a).observation,null);
  }
 });
 await check('An immediate correction cancels observation without delaying the correction; review creates no output',async()=>{
  const h=await setup(),a=h.app;H.runtime(a).observation={index:0,lastAt:now,endAt:now+300000};
  a.getExtraHvac(1).lastPublishedSetpoint=25;const d=calc(a,1,false);near(d.setpointCommand,23);
  await a.publishHvacDecisionFor(1,d);assert.equal(H.runtime(a).observation,null);
  const before=H.runtime(a).nextAt;H.recheck(a,0,'both');assert.equal(H.runtime(a).nextAt,before);assert.equal(H.unit(a,0).setpoint,null);
 });
 await check('Production portfolio applies priority ordering and grants only one increase per HVAC interval',async()=>{
  const h=await setup({flexibleLoadPriorityOrder:['hvac5','hvac1','hvac2']}),a=h.app;
  a.flexiblePriorityState.nextEvaluationAt=0;
  await a.publishFlexibleLoads(a.latestResult,0,0);
  near(H.unit(a,4).setpoint,23);assert.equal(H.unit(a,0).setpoint,null);
  assert.equal(Object.values(H.runtime(a).units).filter(u=>u.setpoint===23).length,1);
  now+=300000;a.inputUpdatedAt.grid=now;a.flexiblePriorityState.nextEvaluationAt=0;
  await a.publishFlexibleLoads(a.latestResult,0,0);
  near(H.unit(a,0).setpoint,23);
 });
 if(process.env.HEMS_HVAC_BASELINE_ROOT) await check('Permanent-off legacy decisions match delivered 1.2.6 in 150 diverse scenarios',async()=>{
  const old=await require(require('node:path').resolve(process.env.HEMS_HVAC_BASELINE_ROOT,'test/startup-harness')).boot();
  const fresh=await setup({hvacPermanentEnabled:false});
  for(let n=0;n<150;n++) {
   const config={...DEFAULTS,hvacCount:1,hvacEnabled:true,hvacPermanentEnabled:false,hvacDirection:'auto',batteryCount:n%3?0:1,peakShaveEnabled:n%2===0,hvacAllowOnBattery:n%2===1,hvacUsePvSurplus:n%5!==0};
   const state={gridPowerW:(n%7-4)*700,pvPowerW:(n%5)*1000,lastTotalCommandW:(n%3-1)*500,batterySoc:[95],hvacRoomTemperatureC:17+n%12,hvacOutdoorTemperatureC:15,hvacMode:n%2?'heat':'cool',hvacSetpointC:21,hvacFanSpeed:20};
   for(const a of [old.app,fresh.app]){
    a.settingsCache={...config};Object.assign(a.state,state);Object.assign(a.inputSeen,{grid:true,pv:true});a.inputSeen.hvac={roomTemperature:true,outdoorTemperature:true,mode:true,setpoint:true,fanSpeed:true};a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;
    a.lastPublishedHvacSetpoint=null;a.lastPublishedHvacMode='';a.hvacBaselineSetpoint=n%3===0?21:null;a.hvacBaselineMode='heat';a.hvacBoostMode=n%3===0?'heat':null;a.hvacManagedPowerOn=n%3===0;a.lastHvacControlAt=0;
   }
   const options={now,allowStart:n%2===0,totalActualEvPowerW:0,totalDesiredEvPowerW:0};
   assert.deepEqual(fresh.app.calculateHvacControl({tariff:{className:'normal'}},null,0,0,options),old.app.calculateHvacControl({tariff:{className:'normal'}},null,0,0,options));
  }
 });
 await check('No configured HVAC produces no controller allocation, extra P1 reference or observation timer',async()=>{
  const h=await boot(new Map(Object.entries({...DEFAULTS,settingsSchemaVersion:71,hvacCount:0,evCount:0})));assert.deepEqual(h.errors,[]);
  assert.equal(h.app.hvacPermanentRuntime,undefined);const before=h.timers.length;
  H.observe(h.app);H.finish(h.app);assert.equal(h.timers.length,before);assert.equal(h.app.hvacPermanentRuntime,undefined);
 });
 await check('Bounded learning over 60 minutes reuses the unchanged 40-minute EV reference buffer',async()=>{
  const h=await setup({hvacControlIntervalMinutes:60}),a=h.app,start=now;
  a.evSessionDetection.houseHistory=[];
  for(let m=-4;m<0;m++)for(let n=0;n<3;n++)recordMinuteSample(a.evSessionDetection.houseHistory,500,start+m*60000+n*1000);
  H.begin(a,0,{direction:'heat'},now);
  for(let n=1;n<=3600;n++){now=start+n*1000;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;recordMinuteSample(a.evSessionDetection.houseHistory,1300,now);H.observe(a,now);if(n%60===0)H.slowTick(a,now);}
  assert(a.evSessionDetection.houseHistory.length<=40);near(H.unit(a,0).heat,800);assert.equal(H.runtime(a).observation,null);
 });
 const benchmark=[];
 for(const count of [0,10]) {
  const h=await setup({hvacCount:count,hvacCheapTargetC:20}),a=h.app;
  for(let n=0;n<10;n++)await a.publishFlexibleLoads(a.latestResult,0,0);
  global.gc?.();const memory=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),start=performance.now();
  for(let n=0;n<100;n++)await a.publishFlexibleLoads(a.latestResult,0,0);
  const used=process.cpuUsage(cpu),elapsed=performance.now()-start;global.gc?.();
  benchmark.push({configured:count,passes:100,cpuMs:(used.user+used.system)/1000,wallMs:elapsed,retainedHeapDeltaBytes:process.memoryUsage().heapUsed-memory,learningActive:Boolean(a.hvacPermanentRuntime?.observation)});
 }
 fs.writeFileSync(require('node:path').join(__dirname,'../validation/hvac-performance-1.2.7.json'),JSON.stringify({simulatedHomey:true,physicalHomeyMeasured:false,benchmark},null,2));
 console.log(`HVAC 1.2.7: ${results.length} targeted groups passed.`);
 fs.writeFileSync(require('node:path').join(__dirname,'../validation/hvac-1.2.7.json'),JSON.stringify({passed:results.length,cases:results},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Date.now=nativeNow;});
