'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const nativeNow=Date.now;
const {setup,cycle,clock}=require('./hvac-coordination-1.2.15.test');
const engine=require('../lib/ems-engine'),strategy=require('../lib/charge-strategy');
const {prepareEvPriceCurve}=require('../lib/ev-deadline-planner');
const {localDateTimeUtcMs}=require('../lib/homey-energy');
const at=(time,day='2026-11-02',zone='UTC')=>localDateTimeUtcMs(day,time,zone);
const HOUR=3600000,passed=[];
async function check(name,fn){await fn();passed.push(name);}
function choice(){const c=strategy.normalize();c.year.day={mode:'maximum',position:'latest',extraPercent:0};c.year.night={...c.year.day};return c;}
function planning(contract='tou') {
 const s={...engine.DEFAULTS,timezone:'UTC',contractType:contract,batteryCount:2,totalCapacityKwh:10,minSoc:10,safetySoc:10,maxSoc:100,
  maxTotalChargeW:4000,maxChargePerBatteryW:2000,maxTotalDischargeW:4000,maxDischargePerBatteryW:2000,
  peakShaveEnabled:true,peakLimitW:2600,peakSoftMarginW:0,chargeStrategy:choice(),nightTargetTime:'07:00',solarTargetTime:'17:00',
  fixedChargeWindowStart:'11:00',fixedChargeWindowEnd:'17:00',commandDeadbandW:0,batteryCommandStepW:1,controlProfile:'exact',gridZeroMinW:0,gridZeroMaxW:0,
  peakReserveTargetSoc:0,sunnyMonthsMinSocEnabled:false,sunChanceReserveEnabled:false,dynamicPriceDataReady:true,
  touRates:[{id:'low',name:'Low',importPrice:.2,weekdayChargeMode:'always',weekendChargeMode:'always'},
   {id:'high',name:'High',importPrice:.5,weekdayChargeMode:'never',weekendChargeMode:'never'}],
  touSchedule:[{rateId:'high',start:'00:00',end:'11:00',days:[1,2,3,4,5,6,7]},{rateId:'low',start:'11:00',end:'17:00',days:[1,2,3,4,5,6,7]},
   {rateId:'high',start:'17:00',end:'00:00',days:[1,2,3,4,5,6,7]}]};
 const state={batterySoc:[67,67],gridPowerW:1600,controlGridPowerW:1600,lastTotalCommandW:0,lastBatteryCommands:[0,0],targetSocOverride:80,
  forecastRemainingKwh:0,planningForecastDay:'today',nightPlanningActive:false};
 const step=contract==='dynamic_hour'?60:15;
 const curve=prepareEvPriceCurve(Array.from({length:1440/step},(_,i)=>({startMs:at('00:00')+i*step*60000,price:i*step>=17*60?.5:.2})),'UTC',step);
 return {s,state,curve};
}
async function main(){
 await check('Latest plans retain 16:45 across active replanning for fixed, TOU and hourly/quarter-hour dynamic prices',()=>{
  for(const contract of ['fixed','tou','dynamic_hour','dynamic_quarter']) {
   const {s,state,curve}=planning(contract);let p=engine.prepareChargeStrategy(state,s,new Date(at('11:00')),curve);
   assert.equal(p.blocks.at(-1).endAt,at('16:45'));assert.equal(p.blocks[0].startAt,at('15:27'));
   state.batterySoc=[67+1/3,67+1/3];state.gridPowerW=1600;state.lastTotalCommandW=-1000;
   p=engine.prepareChargeStrategy(state,s,new Date(at('15:31')),curve,null,p);
   assert.equal(p.reserveEndAt,at('16:45'));assert.equal(p.blocks.at(-1).endAt,at('16:45'));
   assert(Math.abs(p.blocks[0].startAt-at('16:07'))<2,contract);assert.equal(p.reserveMissed,false);
   const runtime={...s,batteryChargeStrategyPlan:p};
   assert.equal(engine.evaluate(state,runtime,new Date(at('15:31'))).plannedChargeW,0,'a shorter remainder is moved to the fixed latest window');
   const display=engine.buildSocPlan(state,runtime,new Date(at('15:31')));
   assert(Math.abs(display.rows.find(r=>r.plannedNetCharge).plannedEndAt-at('16:45'))<2);
   for(const time of ['15:32','15:35','15:51','16:00']){p=engine.prepareChargeStrategy(state,s,new Date(at(time)),curve,null,p);assert.equal(p.blocks.at(-1).endAt,at('16:45'));}
   state.batterySoc=[71+2/3,71+2/3];p=engine.prepareChargeStrategy(state,s,new Date(at('16:20')),curve,null,p);assert.equal(p.blocks.at(-1).endAt,at('16:45'));
  }
 });
 await check('Latest boundaries remain exact before charging starts and follow edited window ends without cumulative reserve shifts',()=>{
  const {s,state,curve}=planning();state.gridPowerW=600;state.batterySoc=[50.7,50.7];let previous=null;
  for(const time of ['11:00','12:17','13:42','14:08']){previous=engine.prepareChargeStrategy(state,s,new Date(at(time)),curve,null,previous);assert.equal(previous.blocks.at(-1).endAt,at('16:45'));}
  const next={...s,solarTargetTime:'16:00'};assert.equal(engine.prepareChargeStrategy(state,next,new Date(at('13:42')),curve,null,previous).blocks.at(-1).endAt,at('15:45'));
 });
 await check('The reserve remains bounded by valid price windows, shortages stay explicit, and reaching the goal cancels charging',()=>{
  const input={now:at('11:00'),startAt:at('07:00'),deadlineAt:at('17:00'),needKwh:1,gridPowerW:2000,targetSoc:80,choice:{mode:'maximum',position:'latest',profile:'year',phase:'day'}};
  const gap=strategy.build({...input,rows:[{startAt:at('11:00'),endAt:at('14:00'),price:.1},{startAt:at('15:00'),endAt:at('16:00'),price:.2}]});assert.equal(gap.blocks.at(-1).endAt,at('15:45'));
  const late=strategy.build({...input,now:at('16:50'),rows:[{startAt:at('11:00'),endAt:at('17:00'),price:.2}]});assert(late.reserveMissed);assert(late.missingKwh>0);assert.equal(late.blocks.at(-1).endAt,at('17:00'));
  assert.equal(strategy.build({...input,needKwh:0,rows:[{startAt:at('11:00'),endAt:at('17:00'),price:.2}]}).blocks.length,0);
 });
 await check('Nighttime latest plans finish at local 06:45 across both Brussels DST transitions',()=>{
  for(const day of ['2026-03-29','2026-10-25']) {
   const {s,state}=planning('fixed');Object.assign(s,{timezone:'Europe/Brussels',fixedChargeWindowStart:'23:00',fixedChargeWindowEnd:'07:00'});
   Object.assign(state,{nightPlanningActive:true,gridPowerW:600,batterySoc:[50,50]});const p=engine.prepareChargeStrategy(state,s,new Date(at('00:00',day,s.timezone)));
   assert.equal(p.blocks.at(-1).endAt,at('06:45',day,s.timezone));assert(!p.reserveMissed);
  }
 });
 await check('The planned display uses the anchored end for heterogeneous batteries whose remaining power tapers',()=>{
  const {s,state}=planning('fixed');s.peakLimitW=10000;state.gridPowerW=0;state.batterySoc=[99,50];
  const p=engine.prepareChargeStrategy(state,s,new Date(at('11:00')));assert(p.requiredHours>p.needKwh*1000/p.gridPowerW);
  const view=engine.buildSocPlan(state,{...s,batteryChargeStrategyPlan:p},new Date(at('11:00')));assert.equal(view.rows.find(r=>r.plannedNetCharge).plannedEndAt,at('16:45'));
 });
 await check('Each explicit OFF Flow emits exactly one power command on all ten slots, with no baseline mode or fan restoration',async()=>{
  const h=await setup(10),a=h.app;
  a.hvacBaselineSetpoint=25;a.hvacBaselineMode='cool';a.hvacBoostMode='heat';a.lastPublishedHvacPower=false;
  for(let i=1;i<10;i++){const r=a.getExtraHvac(i);r.lastPublishedPower=false;r.baselineSetpoint=25;r.baselineMode='cool';}
  const timers=h.timers.length;
  for(let i=0;i<10;i++)await h.cards.get('set_hvac_automatic_control_for_configured').listener({hvac:{kind:'hvac',id:String(i+1),name:'Test'},enabled:'no',standby_temperature:16.5});
  assert.equal(h.events.length,10);assert(h.events.every(e=>e.kind==='power'&&e.state_value===0));assert.equal(h.timers.length,timers);
  await a.setHvacAutomaticControlFor(0,{enabled:'no'});assert.equal(h.events.length,11);
  for(let n=0;n<4;n++){clock.set(clock.now()+60000);a.inputUpdatedAt.grid=clock.now();a.inputUpdatedAt.pv=clock.now();await cycle(h);}
  assert.equal(h.events.length,11,'normal contexts do not retry a completed Flow action');assert.equal(h.timers.length,timers);
 });
 await check('Standby sends exactly one saved/Flow-overridden setpoint, never OFF, on all ten slots; no periodic repeat follows',async()=>{
  const h=await setup(10),a=h.app,timers=h.timers.length;
  for(let i=0;i<10;i++){
   a.setSetting(a.getHvacSettingKey(i,'AutomaticOffAction'),'standby');a.setSetting(a.getHvacSettingKey(i,'StandbyTemperatureC'),17+i*.5);
   if(i===0)a.lastPublishedHvacPower=true;else a.getExtraHvac(i).lastPublishedPower=true;
   await a.setHvacAutomaticControlFor(i,{enabled:'no',...(i%2?{standby_temperature:16.5}:{})});
  }
  assert.equal(h.events.length,10);assert(h.events.every(e=>e.kind==='setpoint'));
  for(let i=0;i<10;i++)assert.equal(h.events.find(e=>e.instance===i+1).setpoint,i%2?16.5:17+i*.5);
  const before=h.events.length;for(let n=0;n<5;n++){clock.set(clock.now()+60000);a.inputUpdatedAt.grid=clock.now();a.inputUpdatedAt.pv=clock.now();await cycle(h);}
  assert.equal(h.events.length,before);assert.equal(h.timers.length,timers);for(let i=0;i<10;i++)assert(!a.isHvacManagedActiveFor(i));
  await a.setHvacAutomaticControlFor(9,{enabled:'no'});assert.equal(h.events.length,before+1);assert.equal(h.events.at(-1).setpoint,16.5);
 });
 await check('The selected action respects its output permission and missing standby configuration fails before disabling automatic control',async()=>{
  const h=await setup(2),a=h.app;a.setSetting('hvacAllowPowerControl',false);await a.setHvacAutomaticControlFor(0,{enabled:'no'});assert.equal(h.events.length,0);
  a.setSetting('hvac2AutomaticOffAction','standby');await assert.rejects(()=>a.setHvacAutomaticControlFor(1,{enabled:'no'}),/stand-bytemperatuur/);assert.equal(a.getHvacInstanceSettings(1).hvacAutomaticControlEnabled,true);
  a.setSetting('hvac2AllowSetpointControl',false);await a.setHvacAutomaticControlFor(1,{enabled:'no',standby_temperature:17});assert.equal(h.events.length,0);assert.equal(a.getHvacInstanceSettings(1).hvacPermanentEnabled,false);assert.equal(a.getHvacInstanceSettings(1).hvacAutomaticControlEnabled,true);
 });
 await check('Explicit Flow calls survive a busy publication and ordinary contexts; concurrent standby overrides each publish once without timers',async()=>{
  const h=await setup(1),a=h.app,timers=h.timers.length;
  let release;const blocked=new Promise(resolve=>{release=resolve;});
  const original=h.cards.get('hvac_setpoint_updated_for_configured').trigger;
  let first=true;
  h.cards.get('hvac_setpoint_updated_for_configured').trigger=async(t,s)=>{
   await original(t,s);if(first){first=false;await blocked;}
  };
  const running=cycle(h);for(let i=0;i<100;i++)await Promise.resolve();
  assert(a.getHvacPublishSlot(0).publishing);
  a.setSetting('hvacAutomaticOffAction','standby');
  const stop1=a.setHvacAutomaticControlFor(0,{enabled:'no',standby_temperature:17});
  const stop2=a.setHvacAutomaticControlFor(0,{enabled:'no',standby_temperature:16});
  for(let i=0;i<100;i++)await Promise.resolve();
  const ordinary=a.calculateHvacControlFor(0,a.latestResult,null,0,0,{});assert.equal(ordinary.setpointCommand,null);
  await a.publishHvacDecisionFor(0,ordinary);
  release();await Promise.all([running,stop1,stop2]);
  assert.deepEqual(h.events.filter(e=>e.kind==='setpoint').map(e=>e.setpoint),[23,17,16]);
  assert.equal(h.timers.length,timers);
  const before=h.events.length;await cycle(h);assert.equal(h.events.length,before);
 });
 await check('Queued stale OFF/standby decisions are rejected after the action changes, and the new choice survives restart',async()=>{
  const h=await setup(1),a=h.app;a.setSetting('hvacAutomaticControlEnabled',false);
  const old=a.calculateHvacControlFor(0,a.latestResult,null,0,0,{automaticOffFromFlow:true});
  a.setSetting('hvacAutomaticOffAction','standby');a.setSetting('hvacStandbyTemperatureC',17);
  await a.publishHvacDecisionFor(0,old);assert.equal(h.events.length,0);
  await a.setHvacAutomaticControlFor(0,{enabled:'no'});assert.equal(h.events.length,1);assert.equal(h.events[0].setpoint,17);
  const restarted=await require('./startup-harness').boot(new Map(h.store));assert.equal(restarted.app.getHvacInstanceSettings(0).hvacCoordination.AutomaticOffAction,'standby');
 });
 await check('The exact shorter Dutch battery-saving waiting text is shared by the widget and Logic tags',()=>{
  const nl=require('../locales/nl.json');assert.equal(nl.widget.status.reasonChargeDeferred,'Batterij reserve behouden, laden later gepland.');
  const tags=require('../lib/ems-status-tags').values({inputReady:true,controlEnabled:true,baseMode:'charge',action:'idle',tariff:{chargeStrategy:{mode:'maximum',active:false,missingKwh:0,reserveMissed:false}}},null,'nl');
  assert.equal(tags.emsdecisionreasons,nl.widget.status.reasonChargeDeferred);
 });
 fs.writeFileSync('validation/features-1.2.16.json',JSON.stringify({version:'1.2.16',environment:'Node host; real planner/application functions with mocked Homey transport',passed},null,2)+'\n');
 console.log(`1.2.16: ${passed.length} targeted scenario groups passed.`);
}
main().catch(e=>{console.error('After:',passed.at(-1)||'setup');console.error(e.stack);process.exitCode=1;}).finally(()=>{Date.now=nativeNow;});
