'use strict';
const assert=require('node:assert/strict'),{fixture}=require('./ev-work-harness');
const {installVirtualClearTimeout}=require('./pv-source-harness');
const P=require('../lib/phase-guard'),E=require('../lib/ev-phase-guard');
const NativeDate=Date,nativeNow=Date.now;
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const restore=installVirtualClearTimeout();let checks=0;
const guard={...P.defaults,phases:3,enabled:true,voltage:230,amps:25,limitW:4500,priority:'shared',batteries:Array(8).fill('balanced3')};
function desired(a){return {...a.latestEvDecision,enabled:true,connected:true,allowed:true,desiredCurrentA:16,desiredPowerW:11040,source:'tariff',mode:'emergency',peakLimited:false};}
async function setup(type,evs=1){
 const h=await fixture({type,evs,batteries:1,batteryEnabled:true,chargeAllowed:true,extra:{maxTotalChargeW:10000,maxChargePerBatteryW:10000,phaseGuard:guard}}),a=h.app;
 a.requestEvaluate=()=>{};a.requestContextEvaluate=()=>{};
 for(let i=0;i<evs;i++){
  const stem=i?'ev'+(i+1):'ev';await h.setExternalSetting(stem+'Voltage',230);await h.setExternalSetting(stem+'VoltageReference','phase');
  await h.cards.get('set_ev'+(i+1)+'_status').listener({connected:'yes',charge_current:16});
  if(i)Object.assign(a.getExtraEv(i),{lastPublishedCurrentA:16,lastPublishedAllowed:true,lastPublishedChargeMode:'standard',lastPublishedAt:h.now()});
  else Object.assign(a,{lastPublishedEvCurrentA:16,lastPublishedEvAllowed:true,lastPublishedEvChargeMode:'standard',lastEvPublishedAt:h.now()});
 }
 a.lastEmittedCommands=[-6000];a.state.lastTotalCommandW=-6000;a.state.batterySoc[0]=50;
 a.state.gridPowerW=17040;P.ingest(a,{l1:5680,l2:5680,l3:5680},h.now());
 return h;
}
(async()=>{try{
 for(const type of ['current','hybrid']){
  const h=await setup(type),a=h.app,timers=h.timers.length;
  await h.setExternalSetting('evCommandIntervalSeconds',3600);
  const d=desired(a);await a.publishEvDecision(d);
  assert.equal(a.lastPublishedEvCurrentA,13,'phase reduction bypasses normal output interval');
  assert(h.flexible.some(e=>e.id==='ev1_charge_current_updated'&&e.tokens.charge_current===13));
  assert(a.evPhaseFeedback[0]);assert.equal(a.evPhaseRuntime.receipts[0].complete,true);
  a.nextCommandAllowedAt=0;a.lastEmitAt=0;a.latestEvDecision=d;
  a.pendingResult={...a.latestResult,canPublishCommands:true,candidateCommands:[-6000],candidateTotalCommandW:-6000,_runFlexibleLoadPass:false};
  await a.emitPending();assert.equal(a.state.lastTotalCommandW,-2460,'temporary battery relief waits for physical EV confirmation');
  const count=h.flexible.filter(e=>e.id==='ev1_charge_current_updated').length;
  for(let i=0;i<3;i++){
   h.setNow(h.now()+10000);await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:16});
   P.ingest(a,{l1:4500,l2:4500,l3:4500},h.now());await a.publishEvDecision(desired(a));
   assert.equal(a.lastPublishedEvCurrentA,13);
  }
  assert.equal(h.flexible.filter(e=>e.id==='ev1_charge_current_updated').length,count,'delayed feedback must not cause repeated commands');
  h.setNow(h.now()+1000);await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:13});
  P.ingest(a,{l1:3810,l2:3810,l3:3810},h.now());E.reference(a,a.getSettings(),h.now());assert.equal(a.evPhaseFeedback[0],undefined);
  const out=P.limit(a,[-6000],a.getSettings(),h.now(),false);assert(out[0]<-2460);
  assert.equal(h.timers.length,timers,'no phase timer is created');assert.deepEqual(h.errors,[]);checks++;
 }
 for(const type of ['current','hybrid']){
  const h=await setup(type),a=h.app;
  let attempts=0;a.evCurrentTrigger.trigger=async()=>{attempts++;throw new Error('simulated EV output failure');};
  await assert.rejects(a.publishEvDecision(desired(a)),/simulated EV output failure/);
  assert.equal(a.evPhaseRuntime.receipts[0].complete,false);
  await a.publishEvDecision(desired(a));assert.equal(attempts,1,'failed output gets feedback time instead of immediate retries');
  assert.deepEqual(P.limit(a,[-6000],a.getSettings(),h.now(),false),[-2460]);checks++;
 }
 for(const type of ['current','hybrid']){
  const h=await setup(type,4),a=h.app;
  for(let i=1;i<4;i++){
   const d={...desired(a),instance:i+1};await a.publishAdditionalEvDecision(i,d);
   assert(a.getExtraEv(i).lastPublishedCurrentA<16);assert(a.evPhaseFeedback[i]);
  }
  checks++;
 }
 for(const type of ['current','hybrid'])for(const operating of ['smart','soc_target','emergency']){
  const h=await setup(type),a=h.app;a.setEvSessionOverrideFor(0,operating,'flow');
  const d=a.calculateEvPortfolioDecisions(a.latestResult,-6000,-6000,a.getSettings())[0];
  assert(d.desiredCurrentA<=13,type+'/'+operating+' portfolio bypassed phase cap');
  assert(d.portfolioGridImportTargetW<=d.desiredPowerW,'phase-limited EV cannot retain a larger intentional grid target');checks++;
 }
 for(const [priority,amps] of [['battery_first',10],['shared',13],['ev_first',16]]){
  const h=await setup('current'),a=h.app;a.setSetting('phaseGuard',{...guard,priority});a.setEvSessionOverrideFor(0,'emergency','flow');
  const d=a.calculateEvPortfolioDecisions(a.latestResult,-6000,-6000,a.getSettings())[0];
  assert.equal(d.desiredCurrentA,amps,priority);checks++;
 }
 {
  const h=await setup('current'),a=h.app;a.latestEvDecision=desired(a);
  a.evCurrentTrigger.trigger=async()=>{a.setSetting('controlEnabled',false);};
  const before=h.traces.length;a.nextCommandAllowedAt=0;a.lastEmitAt=0;
  a.pendingResult={...a.latestResult,canPublishCommands:true,candidateCommands:[-6000],candidateTotalCommandW:-6000,_runFlexibleLoadPass:false};
  await a.emitPending();assert.equal(h.traces.length,before,'disabling battery control during EV I/O cancels the old battery command');assert.equal(a.commandPublishing,false);checks++;
 }
 // Compare real old/new portfolio decisions and output tokens with the feature
 // disabled. This also checks that no optional phase helper is entered.
 if(process.env.HOMEFLUX_PREVIOUS_SOURCE)for(const type of ['current','hybrid','mode'])for(const operating of ['smart','soc_target','emergency']){
  const outputs=[];
  for(const root of [process.env.HOMEFLUX_PREVIOUS_SOURCE,undefined]){
   const h=await fixture({root,type,evs:2,batteries:1,batteryEnabled:true,chargeAllowed:true}),a=h.app;
   a.setEvSessionOverrideFor(0,operating,'flow');a.setEvSessionOverrideFor(1,operating,'flow');
   await h.start();await h.flush();
   const decisions=a.calculateEvPortfolioDecisions(a.latestResult,a.state.lastTotalCommandW,a.state.lastTotalCommandW,a.getSettings());
   outputs.push({decisions:JSON.parse(JSON.stringify(decisions)),events:h.flexible.map(v=>({id:v.id,tokens:v.tokens}))});
  }
  assert.deepEqual(outputs[1],outputs[0],type+'/'+operating+' disabled behavior changed');checks++;
 }
 console.log(`EV phase real app/output: ${checks} scenario groups passed.`);
}finally{restore();global.Date=NativeDate;Date.now=nativeNow;}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
