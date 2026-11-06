'use strict';
const path=require('node:path');
const root=process.argv[2]||path.resolve(__dirname,'..'),{setup,cycle,known,clock}=require(path.join(root,'test/hvac-coordination-1.2.15.test.js')),H=require(path.join(root,'lib/hvac-permanent'));
(async()=>{
 const cases=[['standard',{}],['tariff',{hvacTariffEnabled:true}],['pv',{hvacPvEnabled:true}],['tariff-pv',{hvacTariffEnabled:true,hvacPvEnabled:true}],['keep',{keep:true}],['keep-limit',{keep:true,limit:true}],['periodic',{hvacPeriodicHeatEnabled:true}],['outdoor',{hvacOutdoorOffAboveEnabled:true,hvacOutdoorOffAboveC:15}],['budget',{hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:500}],['peak',{peakShaveEnabled:true,peakLimitW:1000}],['flow-off',{}],['non-permanent',{hvacPermanentEnabled:false,hvacUsePvSurplus:true}]];
 const out=[];
 for(const [name,options]of cases){
  clock.set(Date.UTC(2026,10,6,12));const h=await setup(1,{hvacPermanentEnabled:true,hvacTariffEnabled:false,hvacPvEnabled:false,hvacComfortMinC:21,hvacComfortMaxC:23,hvacHeatingActivationBelowC:20,hvacCoolingActivationAboveC:25,hvacOutdoorOffAboveHysteresisC:1,...options}),a=h.app;
  if(options.keep)a.setSetting('hvacCoordination',a.getSettings().hvacCoordination.map((c,i)=>i?c:{...c,KeepOnEnabled:true,KeepOnLimitEnabled:Boolean(options.limit),KeepOnMarginC:1}));
  known(a,1,1000);Object.assign(H.unit(a,0),{setpoint:21,mode:'heat',comfortMode:'heat',powerOff:false});Object.assign(a,{lastPublishedHvacSetpoint:21,lastPublishedHvacMode:'heat',lastPublishedHvacPower:true});
  const states=[];
  for(const [room,grid,outdoor]of [[18,-2000,14],[21,400,15.2],[24,3000,14.8]]){
   clock.set(clock.now()+300000);Object.assign(a.state,{hvacRoomTemperatureC:room,hvacOutdoorTemperatureC:outdoor,gridPowerW:grid,pvPowerW:grid<0?3000:0});a.inputSeen.hvac.outdoorTemperature=true;a.inputUpdatedAt.grid=clock.now();a.inputUpdatedAt.pv=clock.now();a.inputUpdatedAt.hvac.outdoorTemperature=clock.now();a.flexiblePriorityState.nextEvaluationAt=0;
   if(name==='flow-off'&&room===24)await a.setHvacAutomaticControlFor(0,{enabled:'no'});else await cycle(h);
   const d=a.latestHvacDecision;states.push(d?Object.fromEntries(['reason','powerCommand','modeCommand','setpointCommand','direction','energySource','waiting','startEligible','comfortStop','outdoorStop','keepOnStop','hvacBudgetReduction','safetyReduction'].filter(k=>d[k]!==undefined).map(k=>[k,d[k]])):null);
  }
  out.push({name,states,commands:h.events});
 }
 process.stdout.write(JSON.stringify(out));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
