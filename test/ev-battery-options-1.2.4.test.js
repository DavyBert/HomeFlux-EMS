'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {boot,DEFAULTS}=require('./startup-harness');
const {evaluate,previewBatteryFeedback}=require('../lib/ems-engine');
const {origin}=require('../lib/ev-battery-policy');
const root=path.join(__dirname,'..'),results=[];
const nativeDate=Date,originalNow=Date.now;
let clock=nativeDate.parse('2026-10-28T12:00:00Z');
global.Date=class extends nativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
async function check(name,fn){await fn();results.push(name);console.log('PASS',name);}
async function fixture(extra={}){
 const h=await boot(new Map(Object.entries({...DEFAULTS,batteryCount:1,totalCapacityKwh:10,evCount:2,
  evEnabled:true,ev2Enabled:true,evControlType:'current',ev2ControlType:'hybrid',controlEnabled:false,
  _savingsInventory:{pvKwh:4,unknownKwh:0,grid:{cheap:{kwh:6,cost:1}}},...extra})));const a=h.app;
 a.requestContextEvaluate=()=>{};a.requestEvaluate=()=>{};
 a.state.batterySoc=[80];a.inputSeen.batterySoc=[true];a.state.gridPowerW=6000;a.state.pvPowerW=0;
 a.inputSeen.grid=true;a.inputSeen.pv=true;a.inputUpdatedAt.grid=clock;a.inputUpdatedAt.pv=clock;
 a.updateEvStatusInput(0,true,10,clock);a.updateEvStatusInput(1,true,0,clock);
 for(let i=0;i<100;i++)await Promise.resolve();
 return h;
}
(async()=>{try{
 await check('Both global settings default OFF, persisted settings restore without changing power limits',async()=>{
  assert.equal(DEFAULTS.evBlockBatteryDischargeAlways,false);assert.equal(DEFAULTS.evBlockBatteryDischargeGridMajority,false);
  const h=await fixture();assert(!h.app.getEvBatteryDischargePolicy().blocked);
  h.app.setSetting('evBlockBatteryDischargeAlways',true);assert(h.app.getEvBatteryDischargePolicy().blocked);
  const restarted=await boot(new Map(h.store));assert.equal(restarted.app.getSettings().evBlockBatteryDischargeAlways,true);
  assert.equal(restarted.app.getSettings().maxTotalDischargeW,h.app.getSettings().maxTotalDischargeW);
 });
 await check('Grid majority strictly above 50%; solar, unknown and missing initial energy never manufacture a majority',async()=>{
  const h=await fixture({evBlockBatteryDischargeGridMajority:true}),a=h.app;
  assert(a.getEvBatteryDischargePolicy().blocked);assert.equal(a.getEvBatteryDischargePolicy().gridShare,.6);
  a.savings.inventory={pvKwh:5,unknownKwh:0,grid:{cheap:{kwh:5}}};assert(!a.getEvBatteryDischargePolicy().blocked);
  a.savings.inventory={pvKwh:8,unknownKwh:0,grid:{cheap:{kwh:2}}};assert(!a.getEvBatteryDischargePolicy().blocked);
  a.savings.inventory={pvKwh:0,unknownKwh:5,grid:{cheap:{kwh:5}}};assert(!a.getEvBatteryDischargePolicy().blocked);
  a.savings.inventory={pvKwh:0,unknownKwh:0,grid:{cheap:{kwh:1}}};assert(!a.getEvBatteryDischargePolicy().blocked);
  a.savings.inventory={pvKwh:0,unknownKwh:0,grid:{}};assert.equal(a.getEvBatteryDischargePolicy().gridShare,0);
  a.state.batterySoc=[null];assert(!a.getEvBatteryDischargePolicy().blocked);
  assert.equal(origin({pvKwh:0,unknownKwh:0,grid:{}},0).gridShare,null);
 });
 await check('Always takes priority, no origin mutation or new energy integration; zero/stale/disconnected EV does not trigger restriction',async()=>{
  const h=await fixture({evBlockBatteryDischargeAlways:true,evBlockBatteryDischargeGridMajority:true}),a=h.app;
  a.savings.inventory={pvKwh:10,unknownKwh:0,grid:{}};const saved=JSON.stringify(a.savings.inventory);
  assert(a.getEvBatteryDischargePolicy().blocked);assert.equal(JSON.stringify(a.savings.inventory),saved);
  a.updateEvStatusInput(0,true,0);assert(!a.getEvBatteryDischargePolicy().blocked);
  a.updateEvStatusInput(1,true,8);assert(a.getEvBatteryDischargePolicy().blocked,'second EV alone counts');
  clock+=61000;assert(!a.getEvBatteryDischargePolicy().blocked,'stale Flow cannot claim active power');
  a.updateEvStatusInput(1,false,30);assert(!a.getEvBatteryDischargePolicy().blocked);
 });
 await check('Mode consumes only physical P1 observation, never configured or Flow amperes; multiple batteries use one existing origin pool',async()=>{
  const h=await fixture({batteryCount:2,totalCapacityKwh:20,evControlType:'mode',evBlockBatteryDischargeAlways:true}),a=h.app;
  a.state.batterySoc=[80,80];a.inputSeen.batterySoc=[true,true];a.lastPublishedEvAllowed=true;a.lastPublishedEvChargeMode='standard';
  a.updateEvStatusInput(0,true,30);assert(!a.getEvBatteryDischargePolicy().blocked);
  a.evSessionDetection.modePowerSnapshot={revision:a.evPhysicalConfigRevision||0,at:clock,validUntil:clock+60000,watts:[7000,0]};
  assert(a.getEvBatteryDischargePolicy().blocked);
  clock+=61000;assert(!a.getEvBatteryDischargePolicy().blocked);
 });
 await check('Actual battery engine and feedback preview block discharge, including Peak Guard, while PV charge and individual limits remain valid',async()=>{
  const settings={...DEFAULTS,batteryCount:2,totalCapacityKwh:20,forcedMode:'self_consumption',minSoc:10,safetySoc:20,
   maxSoc:100,controlProfile:'exact',gridZeroMinW:-5,gridZeroMaxW:5,peakShaveEnabled:false,
   maxTotalChargeW:3000,maxTotalDischargeW:3000,maxChargePerBatteryW:2000,maxDischargePerBatteryW:2000};
  const state={gridPowerW:1000,controlGridPowerW:1000,pvPowerW:0,batterySoc:[80,80],lastTotalCommandW:0};
  assert(evaluate(state,settings).totalCommandW>0);
  const restricted={...state,batteryDischargeBlockedByEv:true};const b=evaluate(restricted,settings);
  assert.equal(b.totalCommandW,0);assert.equal(b.batteryPauseCode,'ev_discharge_block');
  assert(previewBatteryFeedback(restricted,settings,20).commands.every(n=>n===0));
  for(const individual of [false,true]){
   const pv=evaluate({...restricted,gridPowerW:-5000,controlGridPowerW:-5000,pvPowerW:8000},{...settings,individualBatteryPowerLimitsEnabled:individual});
   assert(pv.totalCommandW<0);assert(pv.totalCommandW>=-3000);assert(pv.commands.every(n=>n<=0&&n>=-2000));
  }
  const peak=evaluate({...restricted,gridPowerW:19000,controlGridPowerW:19000},{...settings,peakShaveEnabled:true,peakLimitW:17500});
  assert.equal(peak.totalCommandW,0);assert.equal(peak.override,'peak_shave');assert.equal(peak.predictedGridW,19000);
 });
 await check('Split discharge minimum cannot leak through zero or a direction lock; delayed publication rechecks active EV',async()=>{
  const h=await fixture({evBlockBatteryDischargeAlways:true,splitCommandBattery1Enabled:true,
   splitCommandBattery1MinimumPowerW:100,splitCommandBattery1KeepMinimumPower:true}),a=h.app;
  const settings=a.getSettings();a.splitCommandState[0].currentMode='discharge';
  assert.equal(a.getSplitPowerValue('discharge',0,a.getSplitBatteryConfig(0,settings)),0);
  assert.deepEqual(a.getEffectiveSplitCommands([0],settings),[0]);
  const writes=[];a.splitCommandTriggers[0].dischargePower={trigger:async t=>writes.push(t.power)};
  assert.deepEqual(await a.publishSplitBatteryCommands([0],settings),[0]);assert.deepEqual(writes,[0]);
  a.updateEvStatusInput(0,true,0);a.splitCommandState[0].currentMode=null;
  a.waitSplitPowerDelay=async()=>{a.updateEvStatusInput(0,true,10);};
  assert.deepEqual(await a.publishSplitBatteryCommands([1000],settings),[0]);assert.equal(writes.at(-1),0);
 });
 await check('Conditional support cannot finance an EV start with battery energy that will be protected once charging',async()=>{
  const h=await fixture({evBlockBatteryDischargeGridMajority:true}),a=h.app;
  a.updateEvStatusInput(0,true,0);assert(a.getEvBatteryDischargePolicy().eligible);assert(!a.getEvBatteryDischargePolicy().blocked);
  assert.equal(a.getEvBatterySupportAvailableW(a.getSettings(),2000),0);
 });
 await check('Real fast/context battery loop, published output and Hybrid ownership honour restriction and resume PV charging',async()=>{
  const {setup,installVirtualClearTimeout}=require('./pv-source-harness');const restore=installVirtualClearTimeout();
  try{
   const h=await setup(root,{evCount:1,evEnabled:true,evSocEnabled:false,evControlType:'current',evMode:'emergency',
    evBlockBatteryDischargeAlways:true,evPeakGuardBatteryAssistEmergency:true,
    forcedMode:'self_consumption',hybridEmsEnabled:true,peakLimitW:20000,exportLimitEnabled:false},clock,0);
   const a=h.app;a.updateEvStatusInput(0,true,10,clock);await h.grid(6000);await h.start();await h.flush();
   assert(a.getEvaluationState().batteryDischargeBlockedByEv);assert(a.latestResult.batteryDischargeBlockedByEv);
   assert(a.latestResult.candidateCommands.every(v=>v<=0));assert(a.lastEmittedCommands.every(v=>v<=0));
   assert(!a.hybridEmsRuntime.delegated);assert.equal(a.getEvBatterySupportAvailableW(a.getSettings(),0),0);
   clock+=8000;h.setNow(clock);await h.pv(10000);await h.grid(-3000);await h.start();await h.flush();
   assert(a.latestResult.candidateTotalCommandW<0);assert(a.state.lastTotalCommandW<0,'real PV charge output still published');
   assert(a.lastEmittedCommands.every(v=>v<=0));assert.deepEqual(h.errors,[]);
  }finally{restore();Date.now=()=>clock;}
 });
 await check('Unreachable target trigger sends once per cable session despite text changes, recovered feasibility, new goals and overlap',async()=>{
  const h=await fixture(),a=h.app;let calls=0;
  a.evTargetWarningTrigger={trigger:async()=>{calls++;}};
  for(let i=0;i<85;i++)await a.publishEvTargetWarning(0,{targetWarning:`Need ${i} kWh`,energyNeedKwh:i});
  assert.equal(calls,1);await a.publishEvTargetWarning(0,{targetWarning:''});
  a.setEvSocPlan(0,80,'07:00',true);await a.publishEvTargetWarning(0,{targetWarning:'Different target'});assert.equal(calls,1);
  await Promise.all([a.publishEvTargetWarning(1,{targetWarning:'EV2'}),a.publishEvTargetWarning(1,{targetWarning:'EV2 changed'})]);assert.equal(calls,2);
  a.updateEvStatusInput(0,false,0);a.updateEvStatusInput(0,true,0);
  await a.publishEvTargetWarning(0,{targetWarning:'Next session'});assert.equal(calls,3);
  assert.deepEqual(h.store.get('_evTargetWarningSent'),[true,true,false,false]);
 });
 await check('Unreachable warning latch survives app restart, confirmed first disconnect resets only selected EV',async()=>{
  const h=await fixture(),a=h.app;await a.publishEvTargetWarning(0,{targetWarning:'Unreachable'});
  const restarted=await boot(new Map(h.store));let count=0;restarted.app.evTargetWarningTrigger={trigger:async()=>count++};
  restarted.app.requestContextEvaluate=()=>{};restarted.app.updateEvStatusInput(0,true,0);
  await restarted.app.publishEvTargetWarning(0,{targetWarning:'Still unreachable'});assert.equal(count,0);
  restarted.app.updateEvStatusInput(0,false,0);restarted.app.updateEvStatusInput(0,true,0);
  await restarted.app.publishEvTargetWarning(0,{targetWarning:'New session'});assert.equal(count,1);
 });
 await check('WAF tag reads exact existing cached value and validity, including negative/expired; active faults clear and runtime error works without diagnostics',async()=>{
  const h=await fixture(),a=h.app;
  for(const id of ['emserrors','emslasterror','emswaf','emswafavailable'])assert(a.tokens.has(id));
  a.planningCache={energyBudget:{ready:true,valueKwh:-1.42,calculatedAt:clock,validUntil:clock+300000}};
  let t=a.getEmsHealthTokens({warningText:'Balance issue'});assert.equal(t.emswaf,-1.42);assert(t.emswafavailable);assert(t.emserrors.includes('Balance issue'));
  assert.equal(a.getEmsHealthTokens({}).emserrors,'');
  const published=[];a.tokens.get('emswaf').setValue=async value=>published.push(value);
  const result={...(a.latestResult||{}),inputReady:true,missingInputs:[],warningText:'',statusText:'Test status'};
  const signature=a.getStatusResultSignature(result);
  a.pendingStatusResult=result;await a.publishPendingStatus();assert.equal(published.at(-1),-1.42);
  const writes=published.length;a.pendingStatusResult=result;await a.publishPendingStatus();assert.equal(published.length,writes);
  a.planningCache.energyBudget.valueKwh=2.51;assert.notEqual(a.getStatusResultSignature(result),signature);
  a.pendingStatusResult=result;await a.publishPendingStatus();assert.equal(published.at(-1),2.51);
  clock+=300001;t=a.getEmsHealthTokens({});assert(!t.emswafavailable);assert.equal(t.emswaf,0);
  a.inputSeen.grid=false;assert(a.getEmsHealthTokens({}).emserrors.length>0);
  let last='';a.tokens.get('emslasterror').setValue=async v=>{last=v;};
  Object.getPrototypeOf(a).error.call(a,'Example',new Error('Failure'));await Promise.resolve();assert.equal(last,'Example Failure');
 });
 await check('Each visible general EMS tile has an independent declared switch; hiding timing preserves target and bounds',async()=>{
  const html=fs.readFileSync(path.join(root,'widgets/status/public/index.html'),'utf8');
  const script=html.match(/<script[^>]*>\s*([\s\S]*?)<\/script>/)[1];
  class El{constructor(tag='div'){this.tag=tag;this.children=[];this.textContent='';this.className='';this.hidden=false;this.dataset={};this.style={};}set innerHTML(x){this.children=[];}get innerHTML(){return '';}append(...els){this.children.push(...els);}appendChild(el){this.children.push(el);return el;}setAttribute(){}get childElementCount(){return this.children.length;}}
  const content=new El(),document={createElement:t=>new El(t),createElementNS:(_,t)=>new El(t),getElementById:id=>id==='content'?content:null};
  const ctx=vm.createContext({document,Date,console,Math,Number,String,Boolean,Array,Map,JSON,setTimeout:()=>0,setInterval:()=>0,window:{}});vm.runInContext(script,ctx);
  const compose=JSON.parse(fs.readFileSync(path.join(root,'widgets/status/widget.compose.json')));
  const off=Object.fromEntries(compose.settings.filter(s=>s.type==='checkbox').map(s=>[s.id,false]));
  const status={action:'idle',avgSoc:50,targetSoc:80,planningChargeTargetSoc:80,ordinaryDischargeFloorSoc:20,
    batteryTiming:{direction:'charge',hours:2,targetSoc:80},settings:{peakShaveEnabled:true,peakLimitW:17500},tariff:{label:'Fixed'},
    planningSummary:{ready:true,energyNeedKwh:6,gridPlannedKwh:4,forecastKwh:10,phase:'day',targetAt:clock+3600000},
    evs:[],hvacs:[]};
  const H={__:k=>k};const texts=el=>[el.textContent,...el.children.flatMap(texts)];
  const render=setting=>{ctx.status=status;ctx.settings={...off,...setting};ctx.H=H;vm.runInContext('renderStatus(status, settings, H)',ctx);return texts(content).filter(Boolean);};
  assert.deepEqual(render({}),[]);
  const target=render({showBatteryTarget:true});assert(target.includes('Planning target'));assert(!target.includes('Full to target'));
  const timing=render({showBatteryTiming:true});assert(timing.includes('Full to target'));assert(!timing.includes('Planning target'));
  for(const id of ['showBatteryBounds','showBatteryTiming','showPlanningPhase','showPlanningForecast'])assert(compose.settings.some(s=>s.id===id));
  status.priceData={required:true,sources:['homey','external','external2'].map(source=>({source,sourcePrice:.2,available:true,ready:true}))};
  status.priceCurves=[{source:'homey',points:[[clock,.2],[clock+900000,.3]]}];
  const general=['showTariff','showNextTariff','showPriceStatus','showPrimaryPrice','showSecondaryPrice','showTertiaryPrice','showPriceCurves',
    'showEmsMode','showControlOwner','showOutput','showBatterySoc','showBatteryTarget','showBatteryBounds','showBatteryTiming',
    'showNextCharge','showPeakGuard','showPlanningPhase','showPlanningForecast','showPlanningNeed','showPlanningGrid','showPlanningSolar'];
  const cells=el=>(el.className==='metric'?1:0)+el.children.reduce((sum,c)=>sum+cells(c),0);
  for(const id of general){render({[id]:true});assert.equal(cells(content),1,id+' must show exactly one independently selectable tile');}
  const used=[...html.matchAll(/enabled\(settings,\s*['"]([^'"]+)/g)].map(m=>m[1]);
  for(const id of used)assert(compose.settings.some(s=>s.id===id),id+' has no configuration control');
 });
 fs.writeFileSync(path.join(root,'validation/ev-battery-options-1.2.4.json'),JSON.stringify({simulatedHomey:true,physicalHardwareTested:false,passed:results.length,results},null,2)+'\n');
 console.log(results.length+' EV battery/options/session/widget/token groups passed');
}finally{global.Date=nativeDate;Date.now=originalNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
