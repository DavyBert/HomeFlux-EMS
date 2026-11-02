'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'), baseline=process.env.HEMS_BLOCKED_BASELINE ? path.resolve(process.env.HEMS_BLOCKED_BASELINE) : null;
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const engine=require('../lib/ems-engine');
const RealDate=Date,realNow=Date.now;
global.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[Date.now()]));}};
const restore=installVirtualClearTimeout(),results=[];
async function check(name,fn){const evidence=await fn();results.push({name,...evidence});}
async function fixture({mode='self_consumption',pv=200,soc=14,min=12,evCount=0,peak=false,source=root,extra={}}={}){
 const h=await setup(source,{forcedMode:mode,minSoc:min,safetySoc:14,batterySaveDischargeAboveSoc:30,
  fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00',peakLimitW:2650,peakSoftMarginW:100,
  evCount,evEnabled:evCount>0,evControlType:'current',exportLimitEnabled:false,lowForecastFixedEnabled:false,...extra},Date.parse('2026-10-04T12:00:05Z'),pv);
 const a=h.app;Object.assign(a.state,{batterySoc:Array(4).fill(soc),targetSocOverride:null,gridPowerW:peak?3000:1200});
 a.inputUpdatedAt.batterySoc=Array(4).fill(h.now());
 if(evCount)await h.cards.get('set_ev1_status').listener({connected:'no',charge_current:0});
 a.diagnostics.options={cpu:false,planning:false,errors:false};
 const observe=a.getEvaluationState;let stateCalls=0,fastCalls=0;
 const fast=a.evaluateFastNow;a.evaluateFastNow=function(...args){fastCalls++;return fast.apply(this,args);};
 a.getEvaluationState=function(...args){stateCalls++;return observe.apply(this,args);};
 await h.start();await h.flush();
 const frame=async(n,load=peak?3000:1200)=>{h.setNow(h.now()+1000);await h.grid(load-a.state.lastTotalCommandW);await h.flush();
  if(n%60===0){a.inputUpdatedAt.pv=h.now();a.inputUpdatedAt.batterySoc=Array(4).fill(h.now());await h.start();await h.flush();}};
 for(let i=1;i<=30;i++)await frame(i);
 return {...h,frame,stateCalls:()=>stateCalls,fastCalls:()=>fastCalls};
}
const modes=['self_consumption','avoid_import','solar_capture'];
(async()=>{try{
 for(const mode of modes)for(const evCount of [0,1])await check(`${mode}, ${evCount} disconnected EV: stable blocked output reuses idle proof with PV`,async()=>{
  const h=await fixture({mode,evCount,soc:mode==='solar_capture'?20:14}),a=h.app;
  assert.deepEqual(a.lastEmittedCommands,[0,0,0,0]);assert(a.canSkipBatteryIdle(a.getSettings(),h.now()));
  const state=h.stateCalls(),fast=h.fastCalls(),contexts=h.contexts.length,pubs=h.traces.length;
  for(let i=1;i<=240;i++)await h.frame(i);
  const fastDelta=h.fastCalls()-fast,stateDelta=h.stateCalls()-state;
  assert(fastDelta<=6,{mode,fastDelta});assert(stateDelta<=14,{mode,stateDelta});assert.equal(h.traces.length,pubs);
  assert.deepEqual(a.lastEmittedCommands,[0,0,0,0]);assert.deepEqual(h.errors,[]);
  return {p1:240,fast:fastDelta,stateBuilds:stateDelta,contexts:h.contexts.length-contexts};
 });
 for(const mode of modes)await check(`${mode}: new PV export immediately leaves the idle proof and is captured`,async()=>{
  const h=await fixture({mode,soc:mode==='solar_capture'?20:14}),a=h.app;
  h.setNow(h.now()+1000);await h.pv(3000);await h.grid(-1500);await h.flush();
  assert(a.state.lastTotalCommandW<-1000,'Live P1 export must cause real charging');assert.deepEqual(h.errors,[]);
 });
 for(const mode of modes)await check(`${mode}: Peak Guard can use energy below the strategy floor but never below hard minimum`,async()=>{
  const h=await fixture({mode,soc:mode==='solar_capture'?20:14}),a=h.app;
  h.setNow(h.now()+1000);await h.grid(3500);await h.flush();
  assert.equal(a.latestResult.override,'peak_shave');assert(a.state.lastTotalCommandW>0,'Peak support must start');assert.deepEqual(h.errors,[]);
 });
 for(const mode of modes)await check(`${mode}: repeated peak at hard minimum is cheap, fresh SoC restores Peak Guard immediately`,async()=>{
  const h=await fixture({mode,soc:14,min:14,peak:true}),a=h.app;
  assert(a.batteryFeedbackMemo.idlePeakBlocked);assert(a.canSkipBatteryIdle(a.getSettings(),h.now()));
  const initial=h.fastCalls(),stateBefore=h.stateCalls(),pubs=h.traces.length;
  for(let i=1;i<=240;i++)await h.frame(i);
  assert(h.fastCalls()-initial<=6);assert(h.stateCalls()-stateBefore<=14);assert.equal(h.traces.length,pubs);assert.equal(a.state.lastTotalCommandW,0);
  h.setNow(h.now()+1000);await h.cards.get('set_battery_soc').listener({battery:1,soc:20});await h.flush();
  assert(a.state.lastTotalCommandW>0,'A newly available battery must restore peak support');assert(3000-a.state.lastTotalCommandW<2650,'Restored discharge must relieve the measured peak');assert.deepEqual(h.errors,[]);
 });
 for(const mode of modes)await check(`${mode}: new export still charges at hard minimum after a blocked peak`,async()=>{
  const h=await fixture({mode,soc:14,min:14,peak:true}),a=h.app;
  h.setNow(h.now()+1000);await h.grid(-1800);await h.flush();assert(a.state.lastTotalCommandW<-1000);assert.equal(a.latestResult.override,null);assert.deepEqual(h.errors,[]);
 });
 await check('Disabled boiler clock/preview changes do not invalidate proof; real boiler output or peak request does',async()=>{
  const h=await fixture({pv:0}),a=h.app;
  assert(a.canSkipBatteryIdle(a.getSettings(),h.now()));
  a.boilerState.lastTickAt+=999;a.boilerState.lastPersistAt+=999;a.boilerState.latestDecision={...a.boilerState.latestDecision,gridAgeSeconds:99};
  a.latestBoilerDecision={...a.latestBoilerDecision,gridAgeSeconds:99};assert(a.canSkipBatteryIdle(a.getSettings(),h.now()));
  a.boilerState.outputOn=true;assert.equal(a.canSkipBatteryIdle(a.getSettings(),h.now()),false);a.boilerState.outputOn=false;
  a.boilerState.peakSupportRequestedAt=h.now();assert.equal(a.canSkipBatteryIdle(a.getSettings(),h.now()),false);assert.deepEqual(h.errors,[]);
 });
 await check('Unknown/reconnected EV and nonzero EV feedback/output bypass the inactive-EV proof',async()=>{
  const h=await fixture({evCount:1}),a=h.app;
  assert(a.canSkipBatteryIdle(a.getSettings(),h.now()));
  a.inputSeen.ev.connected=false;assert.equal(a.canSkipBatteryIdle(a.getSettings(),h.now()),false);a.inputSeen.ev.connected=true;
  a.state.evConnected=true;assert.equal(a.canSkipBatteryIdle(a.getSettings(),h.now()),false);a.state.evConnected=false;
  a.state.evChargeCurrentA=6;assert.equal(a.canSkipBatteryIdle(a.getSettings(),h.now()),false);a.state.evChargeCurrentA=0;
  a.lastPublishedEvAllowed=true;assert.equal(a.canSkipBatteryIdle(a.getSettings(),h.now()),false);a.lastPublishedEvAllowed=false;
  a.evBatteryCurrentDrop=[{at:h.now()+1,expiresAt:h.now()+60000,currentA:6}];assert.equal(a.canSkipBatteryIdle(a.getSettings(),h.now()),false,'Unacknowledged disconnect load must retain physical accounting');assert.deepEqual(h.errors,[]);
 });
 await check('Pending writes, stale/missing inputs and changed SoC/mode/context retain existing fallback paths',async()=>{
  const changes=[a=>{a.commandPublishing=true;},a=>{a.pendingResult=a.latestResult;},a=>{a.controlTimer={};},a=>{a.controlContextDirty=true;},
   a=>{a.inputUpdatedAt.grid-=1000000;},a=>{a.inputSeen.pv=false;},a=>{a.inputUpdatedAt.batterySoc[0]-=1000000;},a=>{a.state.batterySoc[0]=40;},
   a=>{a.controlContext={};},a=>{a.pendingCommandBypassInterval=true;},a=>{a.hvacPublishSlots[0].publishing=true;}];
  for(const change of changes){const h=await fixture(),a=h.app;assert(a.canSkipBatteryIdle(a.getSettings(),h.now()));change(a);assert.equal(a.canSkipBatteryIdle(a.getSettings(),h.now()),false);assert.deepEqual(h.errors,[]);}
  const h=await fixture(),a=h.app;await h.setExternalSetting('forcedMode','manual_charge');assert.equal(a.canSkipBatteryIdle(a.getSettings(),h.now()),false);
 });
 await check('Live and averaged export both bypass idle; a peak transition is processed even before hard-floor reuse',async()=>{
  const h=await fixture({min:14}),a=h.app;h.setNow(h.now()+1000);a.state.gridPowerW=3500;a.inputUpdatedAt.grid=h.now();
  assert.equal(a.canSkipBatteryIdle(a.getSettings(),h.now()),false);await h.grid(3500);await h.flush();assert(a.batteryFeedbackMemo.idlePeakBlocked);
  h.setNow(h.now()+8000);await h.grid(1200);await h.flush();assert.equal(a.latestResult.override,null);
 });
 await check('Standby ignores ordinary PV export but allows Peak Guard takeover and returns to zero',async()=>{
  const h=await fixture({mode:'standby',soc:80}),a=h.app;
  h.setNow(h.now()+1000);await h.grid(-4000);await h.flush();await h.start();await h.flush();
  assert.equal(a.state.lastTotalCommandW,0);assert.equal(a.latestResult.override,null);
  h.setNow(h.now()+8000);await h.grid(4000);await h.flush();
  assert(a.state.lastTotalCommandW>0);assert.equal(a.latestResult.override,'peak_shave');
  h.setNow(h.now()+8000);await h.grid(500);await h.flush();
  assert.equal(a.state.lastTotalCommandW,0);assert.equal(a.latestResult.override,null);assert.deepEqual(h.errors,[]);
 });
 await check('All active engine modes retain baseline results across contracts, SoC and import/export; standby retains Peak Guard',()=>{
  const reference=baseline?require(path.join(baseline,'lib/ems-engine')):engine;let combinations=0;
  for(const contractType of ['fixed','tou','dynamic_hour','dynamic_quarter'])for(const forcedMode of ['auto',...modes,'charge','manual_charge'])for(const soc of [10,14,45,90])for(const gridPowerW of [-3500,0,1200,4000]){
   const settings={...engine.DEFAULTS,timezone:'Europe/Brussels',contractType,forcedMode,batteryCount:4,minSoc:12,safetySoc:14,peakLimitW:2650};
   const state={gridPowerW,pvPowerW:gridPowerW<0?5000:200,batterySoc:Array(4).fill(soc),lastBatteryCommands:[0,0,0,0],lastTotalCommandW:0,forecastRemainingKwh:4,forecastDailyMaxKwh:4,forecastTomorrowKwh:3};
   const now=new Date('2026-10-04T12:00:00Z');assert.deepEqual(engine.evaluate(state,settings,now),reference.evaluate(state,settings,now));combinations++;
  }
  return {identicalActiveModeCombinations:combinations};
 });
 fs.writeFileSync(path.join(root,'validation/blocked-feedback-1.2.10.json'),JSON.stringify({version:'1.2.10',simulatedHomey:true,physicalHomeyTested:false,passed:results.length,results},null,2)+'\n');
 console.log('1.2.10 blocked feedback: '+results.length+' groups passed, including 384 active engine baseline combinations, PV capture, Peak Guard and Standby.');
 }finally{restore();global.Date=RealDate;Date.now=realNow;}
})().catch(e=>{console.error('FAILED after '+results.length+' groups',e);process.exitCode=1;});
