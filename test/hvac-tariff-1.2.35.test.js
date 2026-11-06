'use strict';
const assert=require('node:assert/strict'),{boot,DEFAULTS}=require('./startup-harness'),H=require('../lib/hvac-permanent');
const nativeNow=Date.now,now=Date.UTC(2026,10,7,12);Date.now=()=>now;let checks=0;
const near=(a,b)=>{assert.equal(a,b);checks++;};
(async()=>{
 const original=new Map(Object.entries(DEFAULTS).filter(([k])=>!/(TariffAutoModeEnabled|CoolingOffsetC)$/.test(k)));
 original.set('settingsSchemaVersion',71);original.set('hvacCount',10);original.set('batteryCount',0);original.set('evCount',0);original.set('peakShaveEnabled',false);original.set('controlEnabled',false);
 for(let i=0;i<10;i++){
  const stem='hvac'+(i?i+1:'');
  for(const [k,v]of Object.entries({Enabled:true,AutomaticControlEnabled:true,PermanentEnabled:true,TariffEnabled:true,Direction:'auto',AllowPowerControl:true,AllowModeControl:true,AllowSetpointControl:true,CheapTargetC:23,NormalTargetC:21,ExpensiveTargetC:19,ComfortMinC:7,ComfortMaxC:90,HeatingActivationBelowC:20,CoolingActivationAboveC:25,DirectionTemperature:{source:'indoor',heatingBelowC:16,coolingAboveC:25,tariffCop:{cheap:{outsideBelowC:30,targetC:22},normal:{outsideBelowC:30,targetC:20},expensive:{outsideBelowC:30,targetC:18}}}}))original.set(stem+k,v);
 }
 const h=await boot(new Map(original)),a=h.app;assert.deepEqual(h.errors,[]);a.requestEvaluate=()=>{};a.requestContextEvaluate=()=>{};
 a.state.gridPowerW=0;a.state.pvPowerW=0;a.state.lastTotalCommandW=0;a.inputSeen.grid=true;a.inputSeen.pv=true;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;
 a.inputSeen.hvac.outdoorTemperature=true;a.state.hvacOutdoorTemperatureC=35;
 const set=(i,k,v)=>{if(['TariffAutoModeEnabled','CoolingOffsetC'].includes(k)){const config=structuredClone(a.getSettings().hvacCoordination);config[i]={...config[i],[k]:v};a.setSetting('hvacCoordination',config);}else a.setSetting(a.getHvacSettingKey(i,k),v);};
 function input(i,room,mode='heat'){
  if(!i){Object.assign(a.state,{hvacRoomTemperatureC:room,hvacSetpointC:21,hvacMode:mode});Object.assign(a.inputSeen.hvac,{roomTemperature:true,setpoint:true,mode:true});a.lastPublishedHvacMode=mode;a.lastPublishedHvacSetpoint=21;}
  else {const u=a.getExtraHvac(i);Object.assign(u.state,{roomTemperatureC:room,setpointC:21,mode});Object.assign(u.seen,{roomTemperature:true,setpoint:true,mode:true});u.lastPublishedMode=mode;u.lastPublishedSetpoint=21;}
  Object.assign(H.unit(a,i),{mode,setpoint:21});H.runtime(a).nextAt=0;
 }
 const calc=i=>a.calculateHvacControlFor(i,a.latestResult,null,0,0,{now,allowStart:true,storedSettings:a.getSettings(),totalActualEvPowerW:0,totalDesiredEvPowerW:0});
 for(let i=0;i<10;i++){
  const stem='hvac'+(i?i+1:'');near(h.store.get('hvacCoordination')[i].CoolingOffsetC,2);near(h.store.get('hvacCoordination')[i].TariffAutoModeEnabled,true);
  assert.deepEqual(h.store.get(stem+'DirectionTemperature'),original.get(stem+'DirectionTemperature'));checks++;
  for(const source of ['indoor','outdoor']){
   const config={...a.getSettings()[stem+'DirectionTemperature'],source};set(i,'DirectionTemperature',config);
   for(const [temperature,current,expected]of [[15,'cool','heat'],[26,'heat','cool'],[16,'cool',source==='outdoor'?'cool':'heat'],[20,'heat','heat'],[25,'cool','cool']]){
    input(i,source==='indoor'?temperature:22,current);a.state.hvacOutdoorTemperatureC=source==='outdoor'?temperature:35;
    for(const [cls,target]of [['cheap',23],['normal',21],['expensive',19]])for(const offset of [2,-2,0]){
     set(i,'CoolingOffsetC',offset);a.latestResult={tariff:{className:cls}};
     const d=calc(i);near(d.direction,expected);
     const cop=a.state.hvacOutdoorTemperatureC<30,base=target-(cop?1:0);
     near(d.desiredSetpointC,base+(expected==='cool'?offset:0));near(Boolean(d.copTargetActive),cop);
     assert(![7,90].includes(d.desiredSetpointC),'comfort targets must not replace tariff/COP targets');checks++;
    }
   }
  }
  // The switch can be disabled without changing the configured tariff/COP values.
  set(i,'TariffAutoModeEnabled',false);input(i,30,'heat');a.state.hvacOutdoorTemperatureC=35;a.latestResult={tariff:{className:'cheap'}};
  near(calc(i).direction,'heat');near(calc(i).desiredSetpointC,23);
  set(i,'TariffAutoModeEnabled',true);set(i,'Direction','cool');near(calc(i).desiredSetpointC,23);set(i,'Direction','auto');
  // PV takes its own goal; automatic tariff offset never leaks into it.
  set(i,'PvEnabled',true);set(i,'PvTargetC',27);set(i,'CoolingOffsetC',-2);a.state.gridPowerW=-6000;input(i,30,'heat');a.state.hvacOutdoorTemperatureC=35;
  near(calc(i).desiredSetpointC,27);near(calc(i).energySource,'pv');a.state.gridPowerW=0;set(i,'PvEnabled',false);
  set(i,'PeriodicHeatEnabled',true);set(i,'PeriodicHeatTargetC',55);near(calc(i).desiredSetpointC,55);near(calc(i).direction,'heat');set(i,'PeriodicHeatEnabled',false);
  // Actual mode/setpoint Flow publication and permission guard, per channel.
  set(i,'DirectionTemperature',{source:'indoor'});set(i,'CoolingOffsetC',2);input(i,30,'heat');
  const events=[];h.cards.get('hvac_mode_updated_for_configured').trigger=async(t,s)=>events.push(['mode',t.mode,s.hvac]);h.cards.get('hvac_setpoint_updated_for_configured').trigger=async(t,s)=>events.push(['target',t.setpoint,s.hvac]);
  let d=calc(i);near(d.modeCommand,'cool');near(d.setpointCommand,25);await a.publishHvacDecisionFor(i,d);
  assert(events.some(e=>e[0]==='mode'&&e[1]==='cool'&&e[2]===i+1));assert(events.some(e=>e[0]==='target'&&e[1]===25&&e[2]===i+1));checks++;
  input(i,30,'heat');set(i,'AllowModeControl',false);d=calc(i);near(d.modeCommand,null);near(d.setpointCommand,null);set(i,'AllowModeControl',true);
  input(i,30,'heat');d=calc(i);input(i,15,'heat');near(H.beforePublish(a,i,d),false);
  input(i,30,'heat');d=calc(i);set(i,'CoolingOffsetC',-2);near(H.beforePublish(a,i,d),false);
  set(i,'CoolingOffsetC',2);set(i,'DirectionTemperature',{source:'outdoor',heatingBelowC:16,coolingAboveC:25});input(i,22,'heat');a.state.hvacOutdoorTemperatureC=35;d=calc(i);a.state.hvacOutdoorTemperatureC=15;near(H.beforePublish(a,i,d),false);
 }
 const oldSettings=new Map(h.store);oldSettings.set('hvacCoordination',oldSettings.get('hvacCoordination').map(({TariffAutoModeEnabled,CoolingOffsetC,...rest})=>rest));const upgraded=await boot(oldSettings);assert.deepEqual(upgraded.errors,[]);checks++;
 const restarted=await boot(new Map(h.store));assert.deepEqual(restarted.errors,[]);for(let i=0;i<10;i++)near(restarted.app.getHvacInstanceSettings(i).hvacCoordination.CoolingOffsetC,2);
 const clean=await boot();assert.deepEqual(clean.errors,[]);near(clean.store.get('hvacPermanentEnabled'),false);near(clean.store.get('hvacCoordination')[0].CoolingOffsetC,2);
 Date.now=nativeNow;console.log(`HVAC tariff 1.2.35: ${checks} checks passed (10 channels, direction thresholds, signed offsets, COP, PV/periodic priority, Flow outputs, permissions, stale decisions, upgrade and clean start).`);
})().catch(e=>{Date.now=nativeNow;console.error(e.stack);process.exitCode=1;});
