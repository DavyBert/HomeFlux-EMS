'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {boot,DEFAULTS}=require('./startup-harness');
const H=require('../lib/hvac-permanent'),C=require('../lib/hvac-coordination');
const {recordMinuteSample}=require('../lib/ev-session');
const nativeNow=Date.now;let now=Date.UTC(2026,10,1,12);Date.now=()=>now;
const passed=[];
async function check(name,fn){await fn();passed.push(name);}
async function setup(count=5,extra={}) {
 const settings={...DEFAULTS,settingsSchemaVersion:71,hvacCount:count,evCount:0,batteryCount:0,boilerCount:0,controlEnabled:false,peakShaveEnabled:false,priorityEvaluationMinutes:5,...extra};
 for(let i=0;i<count;i++)for(const [suffix,value]of Object.entries({Enabled:true,AutomaticControlEnabled:true,PermanentEnabled:true,TariffEnabled:true,Direction:'heat',AllowSetpointControl:true,AllowModeControl:true,AllowPowerControl:true,CheapTargetC:23,NormalTargetC:21,ExpensiveTargetC:19,ControlIntervalMinutes:5,ComfortMinC:20,ComfortMaxC:24})) {
  const key=`hvac${i?i+1:''}${suffix}`;if(!Object.hasOwn(extra,key))settings[key]=value;
 }
 const optionNames=['DirectTariffEnabled','DirectPvEnabled','SharedPowerEnabled','SharedPowerWith','StandbyTemperatureC','AutomaticOffAction'];
 settings.hvacCoordination=structuredClone(settings.hvacCoordination);for(let i=0;i<count;i++){const stem='hvac'+(i?i+1:'');for(const name of optionNames)if(Object.hasOwn(settings,stem+name)){settings.hvacCoordination[i][name]=settings[stem+name];delete settings[stem+name];}}
 const h=await boot(new Map(Object.entries(settings))),a=h.app;
 const set=a.setSetting.bind(a);a.setSetting=(key,value)=>{const match=/^(hvac(?:[2-9]|10)?)(DirectTariffEnabled|DirectPvEnabled|SharedPowerEnabled|SharedPowerWith|StandbyTemperatureC|AutomaticOffAction)$/.exec(key);if(!match)return set(key,value);const index=Number(match[1].slice(4)||1)-1;const saved=a.getSettings().hvacCoordination;return set('hvacCoordination',saved.map((c,i)=>i===index?{...c,[match[2]]:value}:c));};
 a.requestContextEvaluate=()=>{};a.requestEvaluate=()=>{};for(let n=0;n<250;n++)await Promise.resolve();
 Object.assign(a.state,{gridPowerW:400,pvPowerW:0,lastTotalCommandW:0});Object.assign(a.inputSeen,{grid:true,pv:true});a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;
 a.hvacPermanentRuntime=undefined;a.flexiblePriorityState.nextEvaluationAt=0;
 for(let i=0;i<count;i++) {
  if(!i){Object.assign(a.state,{hvacRoomTemperatureC:21,hvacSetpointC:20,hvacMode:'heat'});Object.assign(a.inputSeen.hvac,{roomTemperature:true,setpoint:true,mode:true});a.lastPublishedHvacSetpoint=20;a.lastPublishedHvacMode='heat';a.lastPublishedHvacPower=null;a.hvacBaselineSetpoint=null;a.hvacManagedPowerOn=false;}
  else {const r=a.getExtraHvac(i);Object.assign(r.state,{roomTemperatureC:21,setpointC:20,mode:'heat'});Object.assign(r.seen,{roomTemperature:true,setpoint:true,mode:true});r.lastPublishedSetpoint=20;r.lastPublishedMode='heat';r.lastPublishedPower=null;r.baselineSetpoint=null;r.managedPowerOn=false;}
 }
 a.latestResult={tariff:{className:'cheap',id:'low',importPrice:.1}};
 a.publishEvPortfolio=async()=>({evDecisions:[],adjustedGridW:a.state.gridPowerW,totalActualEvPowerW:0,totalDesiredEvPowerW:0,evStartedThisCycle:false});
 h.events=[];
 for(const kind of ['setpoint','power','mode'])h.cards.get(`hvac_${kind}_updated_for_configured`).trigger=async(t,s)=>h.events.push({kind,instance:s.hvac,...t,at:now});
 return h;
}
async function cycle(h){return h.app.publishFlexibleLoads(h.app.latestResult,0,0);}
function known(a,count,watts=1000){for(let i=0;i<count;i++)Object.assign(H.unit(a,i),{heat:watts,heatReview:false});}
function baseline(a){a.evSessionDetection.houseHistory=[];for(let m=-4;m<0;m++)for(let n=0;n<3;n++)recordMinuteSample(a.evSessionDetection.houseHistory,400,now+m*60000+n*1000);}
async function main(){
 await check('Five known independent sources change in one pass; unchanged targets do not republish or start learning',async()=>{
  const h=await setup(),a=h.app;known(a,5);const timers=h.timers.length;
  await cycle(h);assert.equal(h.events.filter(e=>e.kind==='setpoint').length,5);assert.equal(H.runtime(a).observation,null);
  const before=h.events.length;await cycle(h);assert.equal(h.events.length,before);assert.equal(h.timers.length,timers);
 });
 await check('Known sources proceed while unknown sources retain global priority and interval fallback',async()=>{
  const h=await setup(),a=h.app;known(a,2);await cycle(h);
  assert.deepEqual(h.events.filter(e=>e.kind==='setpoint').map(e=>e.instance),[1,2]);
  now+=300000;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;a.flexiblePriorityState.nextEvaluationAt=0;await cycle(h);
  assert.equal(h.events.filter(e=>e.kind==='setpoint').length,3);
 });
 await check('Direct tariff changes bypass an active global timer for all configured devices and suppress automatic learning',async()=>{
  const extra={};for(let i=0;i<5;i++)extra[`hvac${i?i+1:''}DirectTariffEnabled`]=true;
  const h=await setup(5,extra),a=h.app;baseline(a);H.runtime(a).nextAt=now+300000;a.flexiblePriorityState.nextEvaluationAt=now+300000;
  await cycle(h);assert.equal(h.events.filter(e=>e.kind==='setpoint').length,5);assert.equal(H.runtime(a).observation,null);
  a.latestResult={tariff:{className:'normal',id:'mid',importPrice:.2}};await cycle(h);
  assert.equal(h.events.filter(e=>e.kind==='setpoint'&&e.setpoint===21).length,5);
  assert.equal(H.runtime(a).observation,null);
 });
 await check('One heat pump with four thermostats reserves one full source plus modulation margin, and all zones can change',async()=>{
  const h=await setup(4,{hvacDirectTariffEnabled:true,hvac2DirectTariffEnabled:true,hvac3DirectTariffEnabled:true,hvac4DirectTariffEnabled:true,
   hvac2SharedPowerEnabled:true,hvac2SharedPowerWith:1,hvac3SharedPowerEnabled:true,hvac3SharedPowerWith:1,hvac4SharedPowerEnabled:true,hvac4SharedPowerWith:1,hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:1500}),a=h.app;
  Object.assign(H.unit(a,0),{heat:1000,heatReview:false});await cycle(h);
  assert.equal(h.events.filter(e=>e.kind==='setpoint').length,4);
  const d=a.getExtraHvac(3).latestDecision;assert.equal(d.hvacAdmission.siteReservedW,1200);assert.equal(d.hvacEstimatedExtraImportW,1200);
  assert.throws(()=>C.manualRequest(a,3),/gedeelde/);assert.throws(()=>C.manualRequest(a,0),/gedeelde/);
 });
 await check('Shared zones never assume free additional load; unsafe source capacity, invalid parents and cycles are blocked',async()=>{
  const h=await setup(3,{hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:1000,hvacDirectTariffEnabled:true,hvac2DirectTariffEnabled:true,hvac2SharedPowerEnabled:true,hvac2SharedPowerWith:1}),a=h.app;
  Object.assign(H.unit(a,0),{heat:2000,heatReview:false});await cycle(h);assert.deepEqual(h.events.filter(e=>e.kind==='setpoint').map(e=>e.instance),[3]); // 1.2.25: an oversized shared group must not block an independent source that fits.
  a.setSetting('hvacSharedPowerEnabled',true);a.setSetting('hvacSharedPowerWith',2);a.setSetting('hvacExtraGridBudgetEnabled',false);
  await cycle(h);assert.equal(h.events.filter(e=>e.instance<=2).length,0);
  a.setSetting('hvac2SharedPowerWith',10);const p=C.prepare(a,a.getSettings(),a.latestResult);assert.equal(p.roots[1],null);
 });
 await check('Parallel independent sources share Peak Guard and HVAC budget instead of each reusing the same margin',async()=>{
  const h=await setup(5,{hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:2500,peakShaveEnabled:true,peakLimitW:3000,peakSoftMarginW:100}),a=h.app;known(a,5);
  await cycle(h);assert.equal(h.events.filter(e=>e.kind==='setpoint').length,2);
  assert.equal(a.getExtraHvac(1).latestDecision.hvacAdmission.siteReservedW,2400);
 });
 await check('Household import changes leave the estimated HVAC budget and running outputs unchanged',async()=>{
  const h=await setup(2,{hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:2500}),a=h.app;known(a,2);await cycle(h);
  const requests=[];a.requestContextEvaluate=(...args)=>requests.push(args);
  a.state.gridPowerW=3200;a.checkFlexibleSafetyFromGrid(now);a.checkFlexibleSafetyFromGrid(now);
  assert.equal(requests.filter(x=>x[1]==='hvac_budget').length,0);
  await cycle(h);assert.equal(h.events.filter(e=>e.kind==='power'&&e.state_value===0).length,0);assert.equal(H.runtime(a).budgetGuard.watts,2400);
 });
 await check('Peak Guard and stale P1 reduce permanent HVAC immediately, even inside the start interval',async()=>{
  for(const stale of [false,true]) {
   const h=await setup(2,{peakShaveEnabled:true,peakLimitW:4000}),a=h.app;known(a,2);await cycle(h);
   if(stale){now+=600000;a.inputUpdatedAt.grid=now-600000;}else a.state.gridPowerW=4500;
   const old=h.events.length;await cycle(h);assert(h.events.slice(old).some(e=>e.kind==='power'&&e.state_value===0));
  }
 });
 await check('Direct PV requires sustained surplus, shares available watts and respects stop hysteresis',async()=>{
  const h=await setup(3,{hvacDirectPvEnabled:true,hvac2DirectPvEnabled:true,hvac3DirectPvEnabled:true,hvacPvEnabled:true,hvac2PvEnabled:true,hvac3PvEnabled:true,hvacPvTargetC:25,hvac2PvTargetC:25,hvac3PvTargetC:25}),a=h.app;known(a,3);
  a.state.gridPowerW=-2700;a.state.pvPowerW=5000;H.runtime(a).nextAt=now+300000;a.flexiblePriorityState.nextEvaluationAt=now+300000;
  await cycle(h);assert.equal(h.events.length,0);
  now+=16000;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;await cycle(h);assert.equal(h.events.filter(e=>e.kind==='setpoint').length,2);
  a.state.gridPowerW=500;await cycle(h);assert(h.events.some(e=>e.kind==='setpoint'&&e.setpoint===23));assert.equal(H.runtime(a).observation,null);
 });
 await check('Settings/grid/battery/tariff changes during awaited Flow publication invalidate remaining batch increases',async()=>{
  for(const change of ['grid','battery','tariff','settings']) {
   const h=await setup(3),a=h.app;known(a,3);
   h.cards.get('hvac_setpoint_updated_for_configured').trigger=async(t,s)=>{h.events.push({instance:s.hvac,...t});
    if(change==='grid')a.state.gridPowerW+=500;
    if(change==='battery')a.state.lastTotalCommandW=500;
    if(change==='tariff')a.latestResult={tariff:{className:'expensive'}};
    if(change==='settings'){a.setSetting('hvac2CheapTargetC',19);a.hvacConfigRevision++;}
   };
   await cycle(h);assert.equal(h.events.length,1,change+JSON.stringify(h.events));
  }
 });
 await check('Default OFF action preserves the optional standby temperature without sending a setpoint and respects permissions',async()=>{
  const h=await setup(10),a=h.app;
  for(let i=0;i<10;i++)await h.cards.get('set_hvac_automatic_control_for_configured').listener({hvac:{kind:'hvac',id:String(i+1),name:'HVAC'},enabled:'no',standby_temperature:16.5});
  assert.equal(h.events.filter(e=>e.kind==='power'&&e.state_value===0).length,10);
  assert.equal(h.events.filter(e=>e.kind==='setpoint').length,0);
  await a.setHvacAutomaticControlFor(0,{enabled:'no'});assert.equal(h.events.filter(e=>e.kind==='power').length,11);const before=h.events.length;
  assert.equal(a.getHvacInstanceSettings(0).hvacCoordination.StandbyTemperatureC,16.5);
  assert.match(a.getHvacInstanceDeviceStatus(0),/Uit/);assert.equal(a.lastPublishedHvacSetpoint,20);
  await assert.rejects(()=>a.setHvacAutomaticControlFor(0,{enabled:'no',standby_temperature:0}),/5 en 99/);
  a.setSetting('hvac2AllowPowerControl',false);a.setSetting('hvac2AllowSetpointControl',false);
  await a.setHvacAutomaticControlFor(1,{enabled:'no',standby_temperature:17});assert.equal(h.events.length,before);
  await a.setHvacAutomaticControlFor(0,{enabled:'yes'});await cycle(h);assert(h.events.some(e=>e.instance===1&&e.kind==='power'&&e.state_value===1));
 });
 await check('Old numbered and deprecated selector Flows keep missing-argument semantics and preserve standby after restart',async()=>{
  const h=await setup(2),a=h.app;
  await h.cards.get('set_hvac1_automatic_control').listener({enabled:'no'});assert.equal(h.events.filter(e=>e.kind==='power').length,1);assert.equal(a.getHvacInstanceSettings(0).hvacCoordination.StandbyTemperatureC,'');
  await h.cards.get('set_hvac_automatic_control_for').listener({hvac:'2',enabled:'no'});assert.equal(h.events.filter(e=>e.kind==='power').length,2);
  await a.setHvacAutomaticControlFor(1,{enabled:'no',standby_temperature:17});
  Object.assign(H.unit(a,0),{heat:912,heatReview:false});H.persist(a);
  const r=await boot(new Map(h.store));assert.equal(r.app.getHvacInstanceSettings(1).hvacCoordination.StandbyTemperatureC,17);assert.equal(H.unit(r.app,0).heat,912);
 });
 await check('Manual learning queues one reliable independent step; connected EV, active boiler, short intervals and unstable baselines block it',async()=>{
  const h=await setup(2,{hvacDirectTariffEnabled:true,hvac2DirectTariffEnabled:true,hvac2AutomaticControlEnabled:false}),a=h.app;baseline(a);
  assert.equal(C.manualRequest(a,0).manualPending,true);C.manualRequest(a,0);assert.equal(H.runtime(a).manualQueue.length,1);
  a.setSetting('hvacControlIntervalMinutes',1);await cycle(h);assert.equal(H.runtime(a).observation,null);
  a.setSetting('hvacControlIntervalMinutes',5);a.boilerState.outputOn=true;await cycle(h);assert.equal(H.runtime(a).observation,null);a.boilerState.outputOn=false;
  // Retire the prior output to create an idle, observable manual step.
  a.lastPublishedHvacSetpoint=20;a.state.hvacRoomTemperatureC=21;Object.assign(H.unit(a,0),{setpoint:20,mode:'heat',powerOff:false});
  a.getExtraHvac(1).lastPublishedSetpoint=21;Object.assign(H.unit(a,1),{setpoint:21,mode:'heat',powerOff:false});
  a.setSetting('hvac2AutomaticControlEnabled',false);now+=310000;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;baseline(a);a.flexiblePriorityState.nextEvaluationAt=0;await cycle(h);
  assert(H.runtime(a).observation?.manual,JSON.stringify({r:H.runtime(a),d:a.latestHvacDecision,events:h.events}));assert.equal(H.runtime(a).observation.index,0);
 });
 await check('Manual plateaus build independent confidence, preserve prior watts, restore targets and retain trusted power on interference',async()=>{
  const h=await setup(1,{hvacDirectTariffEnabled:true,hvacCheapTargetC:20}),a=h.app;known(a,1,700);C.manualRequest(a,0);
  for(let round=1;round<=3;round++){
   now+=310000;a.state.gridPowerW=400;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;baseline(a);
   a.state.hvacRoomTemperatureC=21;await cycle(h);const o=H.runtime(a).observation;assert(o?.manual);assert.equal(H.unit(a,0).heat,700);
   const start=now;
   for(let sec=1;sec<=300;sec++){now=start+sec*1000;a.state.gridPowerW=1400;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;recordMinuteSample(a.evSessionDetection.houseHistory,1400,now);H.observe(a,now);if(sec%60===0)H.slowTick(a,now);}
   assert.equal(H.unit(a,0).heat,round===3?1000:700);assert.equal(H.unit(a,0).heatSamples,round);
   assert.equal(H.runtime(a).manualQueue.length,round===3?0:1);await cycle(h);assert.equal(a.lastPublishedHvacSetpoint,20);
  }
  C.manualRequest(a,0);now+=310000;a.state.gridPowerW=400;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;baseline(a);await cycle(h);assert(H.runtime(a).observation);
  H.inputChanged(a,0,'fan',3);H.slowTick(a,now);assert.equal(H.runtime(a).observation,null);assert.equal(H.unit(a,0).heat,1000);assert(H.runtime(a).manualQueue.length);
 });
 await check('Automatic learning stays single-source; direct flags, queued manual work and real external changes prevent contaminated automatic results',async()=>{
  const h=await setup(2),a=h.app;baseline(a);H.begin(a,0,{direction:'heat'},now);assert(H.runtime(a).observation);
  H.begin(a,1,{direction:'heat'},now);assert.equal(H.runtime(a).observation.index,0);
  H.inputChanged(a,1,'mode','cool');H.slowTick(a,now);assert.equal(H.runtime(a).observation,null);
  a.setSetting('hvacDirectTariffEnabled',true);H.begin(a,0,{direction:'heat'},now);assert.equal(H.runtime(a).observation,null);
  a.setSetting('hvacDirectTariffEnabled',false);C.manualRequest(a,1);H.begin(a,0,{direction:'heat'},now);assert.equal(H.runtime(a).observation,null);
  a.setSetting('evCount',1);a.inputSeen.ev.connected=true;a.state.evConnected=true;assert.equal(H.canBegin(a,1,now),null);
 });
 await check('Known legacy PV units start together with their original half-degree steps; ongoing demand remains reserved',async()=>{
  const h=await setup(3,{hvacPermanentEnabled:false,hvac2PermanentEnabled:false,hvac3PermanentEnabled:false,hvacComfortMinC:22,hvac2ComfortMinC:22,hvac3ComfortMinC:22,hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:1300}),a=h.app;
  known(a,3);a.state.gridPowerW=-2000;a.state.pvPowerW=3500;a.state.hvacRoomTemperatureC=19;for(let i=1;i<3;i++)a.getExtraHvac(i).state.roomTemperatureC=19;
  // Initially stopped devices: existing active baseline demand now also counts.
  a.state.hvacMode='off';a.lastPublishedHvacMode='';for(let i=1;i<3;i++){a.getExtraHvac(i).state.mode='off';a.getExtraHvac(i).lastPublishedMode='';}
  await cycle(h);assert.equal(h.events.filter(e=>e.kind==='setpoint').length,1);assert.equal(h.events.find(e=>e.kind==='setpoint').setpoint,20.5);
  a.state.gridPowerW=-5000;a.state.pvPowerW=6500;await cycle(h);
  assert(h.events.filter(e=>e.kind==='setpoint').every(e=>e.instance===1),'PV never increases the admitted HVAC budget; a follow-up step on the same HVAC is allowed within 10 seconds');
  // The new start gate uses the previous actual HVAC action, not an idle evaluation.
  now+=300000;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;
  a.setSetting('hvacExtraGridBudgetW',3600);a.flexiblePriorityState.nextEvaluationAt=0;await cycle(h);assert.deepEqual([...new Set(h.events.filter(e=>e.kind==='setpoint').map(e=>e.instance))],[1,2,3]);
  assert.equal(H.runtime(a).observation,null);
 });
 await check('Direct legacy PV waits for stability and budget reductions reuse the existing restoration controller',async()=>{
  const h=await setup(1,{hvacPermanentEnabled:false,hvacDirectPvEnabled:true,hvacComfortMinC:22,hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:1500}),a=h.app;known(a,1);a.state.hvacRoomTemperatureC=19;a.state.gridPowerW=-2000;a.state.pvPowerW=3500;
  await cycle(h);assert.equal(h.events.length,0);now+=16000;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;await cycle(h);assert.equal(a.lastPublishedHvacSetpoint,20.5);
  a.state.gridPowerW=2400;a.state.pvPowerW=0;await cycle(h);assert.equal(a.lastPublishedHvacSetpoint,20);
 });
 await check('A boiler start and parallel HVAC reserve combined physical headroom',async()=>{
  const h=await setup(3,{peakShaveEnabled:true,peakLimitW:4000,peakSoftMarginW:0}),a=h.app;known(a,3);
  a.setSetting('boilerPowerW',1800);a.getFlexibleLoadPriorityOrder=()=>['boiler','hvac1','hvac2','hvac3'];
  let boilerGrid=null;a.calculateBoilerDecision=(_r,_s,o)=>{if(o.allowStart)boilerGrid=o.gridPowerW;return {startEligible:true,on:Boolean(o.allowStart),outputCommand:o.allowStart?true:null};};a.publishBoilerDecision=async()=>{};
  await cycle(h);assert.equal(h.events.filter(e=>e.kind==='setpoint').length,1);assert.equal(boilerGrid,1600);
 });
 await check('Manual requests survive an unsafe opportunity and a restart restores an interrupted probe without discarding learned power',async()=>{
  const h=await setup(1),a=h.app;known(a,1,820);const u=H.unit(a,0);Object.assign(u,{setpoint:24,manualProbe:true,manualOriginalTarget:21});H.persist(a);
  const r=await boot(new Map(h.store));assert.equal(H.unit(r.app,0).heat,820);assert(H.unit(r.app,0).manualRestore);
 });
 await check('Stable PV requests one immediate existing context from meter feedback, without adding a timer or planning there',async()=>{
  const h=await setup(2,{hvacDirectPvEnabled:true,hvac2DirectPvEnabled:true,hvacPvEnabled:true,hvac2PvEnabled:true}),a=h.app;
  await cycle(h);const requests=[],timers=h.timers.length;a.requestContextEvaluate=(...args)=>requests.push(args);
  a.state.gridPowerW=-5000;a.state.pvPowerW=6500;C.observeSurplus(a,now);
  now+=16000;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;a.checkFlexibleSafetyFromGrid(now);a.checkFlexibleSafetyFromGrid(now);
  assert.equal(requests.filter(x=>x[0]&&x[1]==='hvac_pv_direct').length,1);assert.equal(h.timers.length,timers);
  a.state.gridPowerW=0;a.checkFlexibleSafetyFromGrid(now);a.state.gridPowerW=-5000;a.checkFlexibleSafetyFromGrid(now);
  now+=16000;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;a.checkFlexibleSafetyFromGrid(now);assert.equal(requests.filter(x=>x[1]==='hvac_pv_direct').length,2);
 });
 await check('A disabled module and a removed permanent slot send the allowed OFF, and a standby argument works while the module is disabled',async()=>{
  const h=await setup(2),a=h.app;known(a,2);await cycle(h);a.setSetting('hvacEnabled',false);a.setSetting('hvacCount',1);
  await cycle(h);assert.equal(h.events.filter(e=>e.kind==='power'&&e.state_value===0).length,2);
  a.setSetting('hvacAutomaticOffAction','standby');await a.setHvacAutomaticControlFor(0,{enabled:'no',standby_temperature:15});assert.equal(a.lastPublishedHvacSetpoint,15);
 });
 await check('Manual learning also uses an ordinary legacy PV demand step when safe',async()=>{
  const h=await setup(1,{hvacPermanentEnabled:false,hvacComfortMinC:22}),a=h.app;baseline(a);for(const b of a.evSessionDetection.houseHistory)b.sumW=1500*b.samples;a.state.gridPowerW=-5000;a.state.pvPowerW=6500;a.state.hvacRoomTemperatureC=19;a.state.hvacMode='off';
  C.manualRequest(a,0);await cycle(h);assert(H.runtime(a).observation?.manual);assert.equal(H.runtime(a).observation.index,0);assert(!H.unit(a,0).manualProbe);
 });
 await check('Shared source modes change together when all linked thermostats agree; conflicting modes remain blocked',async()=>{
  const h=await setup(2,{hvacDirectTariffEnabled:true,hvac2DirectTariffEnabled:true,hvac2SharedPowerEnabled:true,hvac2SharedPowerWith:1}),a=h.app;
  Object.assign(H.unit(a,0),{heat:1000,cool:1000,heatReview:false,coolReview:false});await cycle(h);
  a.setSetting('hvacDirection','cool');a.setSetting('hvac2Direction','cool');a.setSetting('hvacCheapTargetC',18);a.setSetting('hvac2CheapTargetC',18);
  a.latestResult={tariff:{className:'cheap',id:'another'}};await cycle(h);assert.equal(h.events.filter(e=>e.kind==='mode'&&e.mode==='cool').length,2);
 });
 await check('Explicit re-enable waits for an in-flight OFF Flow and then restores ON through the existing publication slot',async()=>{
  const h=await setup(1),a=h.app;known(a,1);Object.assign(H.unit(a,0),{setpoint:20,mode:'heat'});
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});
  h.cards.get('hvac_power_updated_for_configured').trigger=async(t,s)=>{h.events.push({kind:'power',instance:s.hvac,...t});if(t.state_value===0){entered();await new Promise(resolve=>{release=resolve;});}};
  const stopping=a.setHvacAutomaticControlFor(0,{enabled:'no',standby_temperature:16});await started;
  let enabled=false;const enabling=a.setHvacAutomaticControlFor(0,{enabled:'yes'}).then(()=>{enabled=true;});
  for(let i=0;i<20;i++)await Promise.resolve();assert.equal(enabled,false);assert.equal(a.getHvacInstanceSettings(0).hvacPermanentEnabled,false);
  release();await stopping;await enabling;await cycle(h);assert.equal(a.lastPublishedHvacPower,true);assert.equal(a.lastPublishedHvacSetpoint,23);assert.equal(a.getHvacPublishSlot(0).pending,null);
 });
 await check('New Virtual sharing an unknown source starts at 300 W plus margin under the reported 2650 W Peak Guard',async()=>{
  const h=await setup(5,{hvacPermanentEnabled:false,hvacUsePvSurplus:false,hvac2Enabled:false,hvac3Enabled:false,hvac4Enabled:false,
   hvac5DirectTariffEnabled:true,hvac5DirectPvEnabled:true,hvac5SharedPowerEnabled:true,hvac5SharedPowerWith:1,hvac5CheapTargetC:30,hvac5ComfortMinC:21,
   peakShaveEnabled:true,peakLimitW:2650,peakSoftMarginW:100,hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:1200}),a=h.app;
  a.state.gridPowerW=623;const r=a.getExtraHvac(4);Object.assign(r.state,{roomTemperatureC:19,setpointC:null,mode:''});Object.assign(r.seen,{setpoint:false,mode:false});r.lastPublishedSetpoint=null;r.lastPublishedMode='';
  await cycle(h);const d=r.latestDecision;assert.equal(d.hvacEstimateW,360);assert.equal(d.hvacKnown,false);assert.equal(d.setpointCommand,30);
  assert(h.events.some(e=>e.instance===5&&e.kind==='setpoint'&&e.setpoint===30));assert.equal(d.hvacAdmission.siteReservedW,360);assert.equal(H.runtime(a).observation,null);
 });
 await check('PV thresholds do not raise the 300 W unknown-power estimate; valid learned source power still takes precedence',async()=>{
  const h=await setup(2,{hvacSurplusStartW:8000,hvac2SharedPowerEnabled:true,hvac2SharedPowerWith:1}),a=h.app;
  let p=C.prepare(a,a.getSettings(),a.latestResult);assert.deepEqual(C.estimate(a,p,1,'heat'),{watts:360,known:false});
  Object.assign(H.unit(a,0),{heat:1800,heatReview:false});assert.deepEqual(C.estimate(a,p,1,'heat'),{watts:2160,known:true});
  H.unit(a,0).heatReview=true;assert.deepEqual(C.estimate(a,p,1,'heat'),{watts:360,known:false});
  const single=await setup(1,{hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:360,hvacSurplusStartW:8000});
  let d=single.app.calculateHvacControlFor(0,single.app.latestResult,null,0,0,{now,allowStart:true});assert.equal(d.hvacEstimatedExtraImportW,360);assert.equal(d.setpointCommand,23);
  single.app.setSetting('hvacExtraGridBudgetW',359);d=single.app.calculateHvacControlFor(0,single.app.latestResult,null,0,0,{now,allowStart:true});assert.equal(d.setpointCommand,null);
  const independent=await setup(2,{hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:500}),other=independent.app;
  Object.assign(H.unit(other,1),{setpoint:23,mode:'heat'});
  d=other.calculateHvacControlFor(0,other.latestResult,null,0,0,{now,allowStart:true});assert.equal(d.hvacEstimatedExtraImportW,720);assert.equal(d.setpointCommand,null,'two unknown independent demands each reserve 360 W including margin in the standalone controller');
 });
 await check('Unknown independent sources each reserve 360 W while linked unknown thermostats share one reservation',async()=>{
  const flags={};for(let i=0;i<5;i++)flags[`hvac${i?i+1:''}DirectTariffEnabled`]=true;
  const h=await setup(5,{...flags,hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:1100,peakShaveEnabled:true,peakLimitW:2000,peakSoftMarginW:100}),a=h.app;
  await cycle(h);assert.equal(h.events.filter(e=>e.kind==='setpoint').length,3);assert.equal(a.getExtraHvac(2).latestDecision.hvacAdmission.siteReservedW,1080);
  const shared=await setup(4,{hvacDirectTariffEnabled:true,hvac2DirectTariffEnabled:true,hvac3DirectTariffEnabled:true,hvac4DirectTariffEnabled:true,
   hvac2SharedPowerEnabled:true,hvac2SharedPowerWith:1,hvac3SharedPowerEnabled:true,hvac3SharedPowerWith:1,hvac4SharedPowerEnabled:true,hvac4SharedPowerWith:1,hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:400});
  await cycle(shared);assert.equal(shared.events.filter(e=>e.kind==='setpoint').length,4);assert.equal(shared.app.getExtraHvac(3).latestDecision.hvacAdmission.siteReservedW,360);
 });
 await check('Physical P1 overload triggers independent Peak Guard; household import cannot trigger the HVAC budget',async()=>{
  for(const limit of ['budget','peak']){
   const h=await setup(1,{hvacDirectTariffEnabled:true,hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:1200,peakShaveEnabled:true,peakLimitW:2650,peakSoftMarginW:100}),a=h.app;
   await cycle(h);assert(h.events.some(e=>e.kind==='setpoint'));
   const requests=[];a.requestContextEvaluate=(...args)=>requests.push(args);a.state.gridPowerW=limit==='peak'?2800:2000;a.checkFlexibleSafetyFromGrid(now);
   assert.equal(requests.some(args=>args[0]===true&&args[1]==='peak_guard'),limit==='peak');assert(!requests.some(args=>args[1]==='hvac_budget'));await cycle(h);
   assert.equal(h.events.some(e=>e.kind==='power'&&e.state_value===0),limit==='peak');assert.equal(a.lastPublishedHvacPower===false,limit==='peak');
  }
 });
 await check('Ten-slot settings defaults are off; active Flow extension is optional and deprecated cards remain byte-identical',async()=>{
  for(let i=0;i<10;i++)for(const suffix of ['DirectTariffEnabled','DirectPvEnabled','SharedPowerEnabled'])assert.equal(DEFAULTS.hvacCoordination[i][suffix],false);
  assert(Object.keys(DEFAULTS).length<1020,'new settings must avoid the large-object spread cliff');
  const card=require('../.homeycompose/flow/actions/set_hvac_automatic_control_for_configured.json');assert.equal(card.args.find(x=>x.name==='standby_temperature').required,false);
  const previous=process.env.HOMEFLUX_PREVIOUS_SOURCE;
  if(previous)for(const kind of ['actions','conditions','triggers'])for(const c of require('../app.json').flow[kind])if(c.deprecated)assert.equal(fs.readFileSync(`.homeycompose/flow/${kind}/${c.id}.json`,'utf8'),fs.readFileSync(`${previous}/.homeycompose/flow/${kind}/${c.id}.json`,'utf8'));
 });
 fs.mkdirSync('validation',{recursive:true});fs.writeFileSync('validation/hvac-coordination-1.2.16.json',JSON.stringify({version:'1.2.16',environment:'Node host with real application HVAC/Flow functions and mocked Homey transport; no Homey hardware measurement',passed},null,2)+'\n');
 console.log(`HVAC 1.2.15: ${passed.length} scenario groups passed.`);
}
module.exports={setup,cycle,known,baseline,clock:{now:()=>now,set:value=>{now=value;}}};
if(require.main===module)main().catch(e=>{console.error('After:',passed.at(-1)||'setup');console.error(e.stack);process.exitCode=1;}).finally(()=>{Date.now=nativeNow;});
