'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {fixture,ROOT}=require('./ev-work-harness');
const {installVirtualClearTimeout}=require('./pv-source-harness');
const {localDateTimeUtcMs,localParts}=require('../lib/homey-energy');
const NativeDate=Date,originalNow=Date.now;
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const restore=installVirtualClearTimeout(),ZONE='Europe/Brussels',Q=900000,HOUR=3600000;
const at=(day,time)=>localDateTimeUtcMs(day,time,ZONE);
const count=(a,k)=>a.diagnostics?.counters?.[k]||0;
function prices(kind='gerrit') {
 const rows=[];for(let t=at('2026-10-23','00:00');t<at('2026-10-26','00:00');t+=Q){
  const p=localParts(new Date(t),ZONE);
  const price=kind==='continuous'?(p.dateKey==='2026-10-23'&&p.minuteOfDay>=1380||p.dateKey==='2026-10-24'&&p.minuteOfDay<60?.05:.4)
    :p.dateKey==='2026-10-23'?(p.minuteOfDay>=1365?.3:.45):p.minuteOfDay<420?.2:p.minuteOfDay>=720&&p.minuteOfDay<795?.1:.4;
  rows.push({startMs:t,dateKey:p.dateKey,minute:p.minuteOfDay,price});
 }return rows;
}
async function setup({root=ROOT,type='current',evs=1,batteries=0,begin=at('2026-10-23','18:00'),kind='gerrit',need=11.5,soc=false,extra={}}={}) {
 const h=await fixture({root,type,evs,batteries,batteryEnabled:batteries>0,extra:{contractType:'dynamic_quarter',dynamicPriceSource:'external',dynamicPriceSources:['external'],cheapHours:1.25,expensiveHours:3,
  evDynamicCheapMaxGridImportW:10000,evDynamicNormalMaxGridImportW:0,evDynamicExpensiveMaxGridImportW:0,
  nightTargetTime:'07:00',solarTargetTime:'17:00',forcedMode:batteries?'auto':'self_consumption',batteryCommandPauseEnabled:false,...extra}}),a=h.app;
 for(let i=0;i<evs;i++){
  const stem=i?`ev${i+1}`:'ev';
  for(const [key,value] of Object.entries({Phases:1,Voltage:230,VoltageReference:'phase',MinCurrentA:6,MaxCurrentA:20,StandardCurrentA:20,
    ModeStandardCurrentA:20,ModeSmartCurrentA:6,BatteryCapacityKwh:50,SocEnabled:soc,DynamicCheapEnabled:true,DynamicNormalEnabled:false,DynamicExpensiveEnabled:false})) await h.setExternalSetting(stem+key,value);
 }
 h.setNow(begin);a.state.nightPlanningActive=true;a.state.nightPlanningStartedDate='2026-10-23';
 a.state.pvProducingDate='2026-10-23';a.state.pvSeenProducingToday=false;
 a.externalEnergy={...a.externalEnergy,slots:prices(kind),curveUpdatedAt:begin,currentUpdatedAt:begin,currentPrice:.3};
 a.invalidatePlanningCache();
 for(let i=0;i<evs;i++){
  if(soc){await h.cards.get(`set_ev${i+1}_soc`).listener({soc:50});await h.cards.get(`set_ev${i+1}_soc_deadline`).listener({target_soc:50+need*2,time:'07:00',guarantee:'yes'});}
  else await h.cards.get(`set_ev${i+1}_energy_deadline`).listener({energy:need,time:'07:00',guarantee:'yes'});
 }
 await h.grid(500);await h.start();await h.flush();return h;
}
function output(a,i=0){const runtime=i?a.getExtraEv(i):null;if(a.getEvControlTypeFor(i)==='mode'){const mode=i?runtime.lastPublishedChargeMode:a.lastPublishedEvChargeMode;return mode==='standard'?20:mode==='smart'?6:0;}return i?runtime.lastPublishedCurrentA||0:a.lastPublishedEvCurrentA||0;}
async function tick(h,now,{soc=false,delivered=0,pv=0,actualCurrentA=null}={}){
 const a=h.app;h.setNow(now);let evW=0;
 for(let i=0;i<a.getEvCount();i++){
  const current=actualCurrentA===null?output(a,i):actualCurrentA;evW+=current*230;
  await h.cards.get(`set_ev${i+1}_status`).listener({connected:'yes',charge_current:current});
  if(soc)await h.cards.get(`set_ev${i+1}_soc`).listener({soc:Math.min(100,50+delivered*2)});
 }
 if(pv!==a.state.pvPowerW)await h.pv(pv);
 await h.grid(500+evW-pv-a.state.lastTotalCommandW);await h.flush();
 if(now%60000===0){a.runContextHeartbeat();await a.runEvHeartbeat();await h.flush();}
}
async function economic({root=ROOT,soc=false}={}){
 const h=await setup({root,soc}),a=h.app,begin=h.now(),end=at('2026-10-24','07:00');
 let energy=0,cost=0,starts=0,stops=0,prior=output(a)>0;
 if(prior)starts++;
 const events=[];const rows=prices(),cpu=process.cpuUsage(),wall=performance.now();
 for(let t=begin+30000;t<=end;t+=30000){
  const current=output(a),kwh=current*.230*30000/HOUR;
  energy+=kwh;const row=rows.find(r=>r.startMs<=t-30000&&r.startMs+Q>t-30000);cost+=kwh*row.price;
  await tick(h,t,{soc,delivered:energy});const on=output(a)>0;
  if(on!==prior){if(on)starts++;else stops++;events.push({at:t,on,currentA:output(a)});}prior=on;
 }
 const used=process.cpuUsage(cpu);
 assert.deepEqual(h.errors,[]);
 return {soc,energyKwh:energy,costEUR:cost,starts,stops,interruptions:Math.max(0,starts-1),events,
  deadlineMet:soc?a.state.evSoc>=73-0.01:a.evEnergyPlans[0].remainingKwh<=.001,
  planBuilds:count(a,'evDeadlinePlanBuilds'),planReuses:count(a,'evDeadlinePlanReuses'),
  portfolioCalculations:count(a,'evPortfolioCalculations'),cpuMs:(used.user+used.system)/1000,wallMs:performance.now()-wall};
}
let cases=0;const results=[];
async function check(name,run){if(process.env.HEMS_TEST_FILTER&&!name.includes(process.env.HEMS_TEST_FILTER))return;const detail=await run();cases++;results.push({name,...detail});fs.mkdirSync(path.join(ROOT,'validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'validation/ev-deadline-integration.json'),JSON.stringify(results,null,2)+'\n');}
async function main(){try{
 await check('Gerrit kWh: full production replay',async()=>{const r=await economic();assert(r.deadlineMet);assert(Math.abs(r.energyKwh-11.5)<.01);assert(r.costEUR<2.32);assert.equal(r.starts,1);assert.equal(r.planBuilds,1);assert(r.events[0].at===at('2026-10-24','00:00'));return r;});
 await check('Gerrit SoC: same production decisions',async()=>{const r=await economic({soc:true});assert(r.deadlineMet);assert(r.costEUR<2.32);assert.equal(r.starts,1);assert.equal(r.planBuilds,1);return r;});
 await check('Midnight and 1-second inputs reuse EV plan',async()=>{
  const h=await setup({begin:at('2026-10-23','23:58')}),a=h.app;
  const before={builds:count(a,'evDeadlinePlanBuilds'),portfolio:count(a,'evPortfolioCalculations'),physical:count(a,'evPhysicalConfigCacheHits')};
  let fastBuilds=0;const fast=a.evaluateFastNow;a.evaluateFastNow=function(...args){const n=count(a,'evDeadlinePlanBuilds');const r=fast.apply(this,args);fastBuilds+=count(a,'evDeadlinePlanBuilds')-n;return r;};
  for(let s=1;s<=180;s++)await tick(h,at('2026-10-23','23:58')+s*1000);
  assert.equal(count(a,'evDeadlinePlanBuilds'),before.builds);assert.equal(fastBuilds,0);
  assert.equal(output(a),20);assert(count(a,'evPhysicalConfigCacheHits')-before.physical>=179);
  const control=a.getEvGridImportControlStatus();assert(control.requestedTargetW>0,'EV cheap window must remain protected while daily tariff is normal');
  return {planBuildsDuring180Seconds:0,fastPathBuilds:fastBuilds,portfolios:count(a,'evPortfolioCalculations')-before.portfolio};
 });
 await check('Battery midnight PV refresh independent of EV plan',async()=>{
  const h=await setup({begin:at('2026-10-23','23:58'),batteries:1,kind:'continuous'}),a=h.app;
  assert(output(a)>0);const deadline=a.evEnergyPlans[0].deadlineAt,builds=count(a,'evDeadlinePlanBuilds');
  await h.cards.get('set_forecast_tomorrow').listener({energy:9});await h.flush();
  for(let s=1;s<=180;s++)await tick(h,at('2026-10-23','23:58')+s*1000);
  assert.equal(a.getSettings().nightTargetTime,'07:00');assert.equal(a.getSettings().solarTargetTime,'17:00');
  assert(a.state.nightPlanningActive);assert.equal(a.evEnergyPlans[0].deadlineAt,deadline);assert(output(a)>0);
  assert.equal(a.state.forecastDailyMaxKwh,9,'tomorrow PV forecast is promoted after midnight');
  const batteryCalculations=count(a,'planningCalculations');
  const generation=a.planningCache.generation;
  await h.cards.get('set_forecast_remaining').listener({energy:6});await h.flush();
  for(let minute=0;minute<5;minute++)await tick(h,h.now()+60000);
  assert.equal(a.state.forecastRemainingKwh,6);assert(a.planningCache.generation>=generation);
  assert(count(a,'planningCalculations')>batteryCalculations,'new PV forecast reaches battery planner through its existing cadence');
  assert.equal(count(a,'evDeadlinePlanBuilds'),builds,'PV forecast refresh does not rebuild the EV price plan');
  return {nightTarget:'07:00',solarTarget:'17:00',forecastRemainingKwh:a.state.forecastRemainingKwh,promotedDailyForecastKwh:a.state.forecastDailyMaxKwh,initialPlanBuilds:builds,finalPlanBuilds:count(a,'evDeadlinePlanBuilds')};
 });
 await check('New price JSON and invalid publication',async()=>{
  const h=await setup({begin:at('2026-10-24','00:15')}),a=h.app,card=h.cards.get('read_external_prices_json');
  const payload=rows=>JSON.stringify({pricesPerInterval:rows.map(r=>({periodStart:new Date(r.startMs).toISOString(),periodEnd:new Date(r.startMs+Q).toISOString(),value:r.price}))});
  const curve=a.externalEnergy.slots,original=a.evDeadlinePlanner.plans.get(0).curve,builds=count(a,'evDeadlinePlanBuilds');
  await card.listener({source:'external',curve:payload(curve),period:'next_hours'});await tick(h,h.now()+60000);
  assert.strictEqual(a.evDeadlinePlanner.plans.get(0).curve,original);assert.equal(count(a,'evDeadlinePlanBuilds'),builds);
  const valid=a.externalEnergy.slots;await assert.rejects(()=>card.listener({source:'external',curve:'bad',period:'next_hours'}));assert.strictEqual(a.externalEnergy.slots,valid);
  const changed=curve.map(r=>({...r,price:r.startMs>=at('2026-10-24','04:00')&&r.startMs<at('2026-10-24','06:00')?.01:r.price}));
  await card.listener({source:'external',curve:payload(changed),period:'next_hours'});await tick(h,h.now()+60000);
  assert(count(a,'evDeadlinePlanBuilds')>builds);assert(a.evDeadlinePlanner.plans.get(0).slots.some(s=>s.price===.01));
  return {identicalCurveReused:true,invalidCurveRetained:true,cheaperPublicationReplanned:true};
 });
 await check('Flow changes, repeats, disconnect and end latch',async()=>{
  const h=await setup(),a=h.app;
  await h.cards.get('set_ev1_energy_deadline').listener({energy:8,time:'07:00',guarantee:'yes'});await h.flush();
  let revision=a.evPlanRevision[0],builds=count(a,'evDeadlinePlanBuilds');
  for(let i=0;i<30;i++)await h.cards.get('set_ev1_energy_deadline').listener({energy:8,time:'07:00',guarantee:'yes'});
  assert.equal(a.evPlanRevision[0],revision);assert.equal(count(a,'evDeadlinePlanBuilds'),builds);
  await h.setExternalSetting('evSocEnabled',true);await h.cards.get('set_ev1_soc').listener({soc:50});
  await h.cards.get('set_ev1_soc_deadline').listener({target_soc:75,time:'07:00',guarantee:'yes'});await h.flush();
  assert(a.evSocPlans[0].active);assert(!a.evEnergyPlans[0].active);
  await h.cards.get('set_ev1_status').listener({connected:'no',charge_current:0});await h.flush();assert(!a.latestEvDecision.allowed);
  await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});await h.cards.get('end_ev1_charging_session').listener({});await h.flush();
  assert(a.getEvSessionDetectionRuntime(0).endedLatched);assert(!a.latestEvDecision.allowed);
  return {passed:true};
 });
 await check('Same-day and absolute two-boundary deadlines',async()=>{
  const h=await setup({need:4.6}),a=h.app;
  await h.cards.get('set_ev1_energy_deadline').listener({energy:4.6,time:'23:45',guarantee:'yes'});await h.flush();
  let slots=a.evDeadlinePlanner.plans.get(0).slots;assert(slots.every(s=>s.endAt<=at('2026-10-23','23:45')));
  a.evEnergyPlans[0].deadlineAt=at('2026-10-25','07:00');a.evEnergyPlans[0].targetOccurrenceAt=a.evEnergyPlans[0].deadlineAt;
  a.markEvPlanChanged(0,'test_absolute_deadline');await a.runContextEvaluation(true);await h.flush();
  assert(a.latestEvDecision.deadlinePlanning);assert.equal(a.latestEvDecision.deadlineAt,at('2026-10-25','07:00'));
  return {sameDay:true,twoBoundaries:true};
 });
 await check('PV first and unavailable price source fallback',async()=>{
  const h=await setup(),a=h.app;await tick(h,h.now()+1000,{pv:5000});await h.start();await h.flush();
  assert(a.latestEvDecision.allowed);assert(a.latestEvDecision.pvRequestPowerW>0);assert(!a.latestEvDecision.selectedTariff);
  // Source outage does not weaken the existing deadline/permission fallback.
  h.setNow(at('2026-10-24','06:00'));a.externalEnergy.slots=[];a.externalEnergy.curveUpdatedAt=h.now();
  await h.cards.get('set_ev1_energy_deadline').listener({energy:9.2,time:'07:00',guarantee:'yes'});
  await tick(h,h.now()+1000);await h.start();await h.flush();
  assert(!a.latestEvDecision.deadlinePlanning);assert(a.latestEvDecision.guaranteeActive);assert(a.latestEvDecision.allowed);
  return {pvAvailableWhileWaiting:true,existingPriceFallback:true};
 });
 await check('Persistent lower measured current uses deliverable capacity',async()=>{
  const h=await setup({begin:at('2026-10-24','00:00')}),a=h.app,begin=h.now();
  assert.equal(output(a),20);
  for(let second=1;second<=120;second++)await tick(h,begin+second*1000,{actualCurrentA:second<=30?2:8});
  await a.runContextEvaluation(true);await h.flush();
  const plan=a.evDeadlinePlanner.plans.get(0);
  assert(plan.slots.every(s=>s.powerW<=1840.001),'plan capacity follows persistent actual 8A, not commanded 20A '+JSON.stringify({delivery:a.evDeadlineDelivery,measured:a.getEvMeasuredCurrent(0),slot:plan.slots[0]}));
  assert.equal(output(a),20,'capacity estimate must not replace allowed charger setpoint');
  assert(a.latestEvDecision.targetReachable);
  a.lastPublishedEvCurrentA=0;a.lastPublishedEvAllowed=false;
  await tick(h,h.now()+1000,{actualCurrentA:0});await a.runContextEvaluation(true);await h.flush();
  assert(a.evDeadlinePlanner.plans.get(0).slots.every(s=>s.powerW<=1840.001),'learned delivery limit survives a planned pause');
  return {commandedA:20,measuredA:8,plannedPowerW:plan.slots[0].powerW};
 });
 await check('Current, mode, hybrid and shared Peak Guard',async()=>{
  for(const type of ['current','mode','hybrid']){
   const h=await setup({type,begin:at('2026-10-24','00:00'),evs:2,extra:{peakShaveEnabled:true,peakLimitW:5500,peakSoftMarginW:0}}),a=h.app;
   await tick(h,h.now()+1000);await h.start();await h.flush();const ds=a.calculateEvPortfolioDecisions(a.latestResult,a.state.lastTotalCommandW,a.state.lastTotalCommandW);
   assert(ds.reduce((n,d)=>n+d.desiredPowerW,0)<=5000,'one physical shared peak budget '+type+': '+JSON.stringify(ds.map(d=>({w:d.desiredPowerW,actual:d.actualCurrentA,reason:d.reason}))));
   assert(ds.some(d=>d.deadlinePlanning));assert.deepEqual(h.errors,[]);
   if(type==='mode')for(const plan of a.evDeadlinePlanner.plans.values())assert(plan.slots.every(s=>[1380,4600].includes(s.powerW)),'mode plans use only controllable Smart/Standard power');
  }return {controlTypes:3,sharedBudgetW:5000};
 });
 fs.mkdirSync(path.join(ROOT,'validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'validation/ev-deadline-integration.json'),JSON.stringify(results,null,2)+'\n');
 console.log(`1.1.17 deadline integration: ${cases} production scenario groups passed.`);
}finally{restore();global.Date=NativeDate;Date.now=originalNow;}}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={setup,tick,economic,prices,at,cleanup:()=>{restore();global.Date=NativeDate;Date.now=originalNow;}};
