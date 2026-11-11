'use strict';
const { installVirtualDate } = require('./helpers/virtual-date.cjs');
const restoreDate = installVirtualDate();
const assert=require('node:assert/strict');
const I=require('../lib/active-injection');
const {localParts}=require('../lib/homey-energy');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const restore=installVirtualClearTimeout(),originalNow=Date.now;
const at=Date.parse('2026-11-09T14:05:00Z');
let groups=0;
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
async function fresh(extra={}){
 const h=await setup(undefined,{injectionEnabled:true,injectionAutomaticEnabled:false,
  fixedImportPrice:.87,fixedFeedInPrice:.08,injectionExportCost:.1,
  exportLimitEnabled:false,peakShaveEnabled:false,optimizeMultiBatteryEfficiency:false,...extra},at,0);
 await h.drain();h.realRequestContext=h.app.requestContextEvaluate.bind(h.app);
 h.app.requestContextEvaluate=()=>{};h.app.requestEvaluate=()=>{};
 return h;
}
const tou=(price=.87)=>({contractType:'tou',touRates:[{id:'rate',name:'Tarief',importPrice:price,feedInPrice:.08}],
 touSchedule:[{rateId:'rate',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]}]});
const rows=(price=.87,transform=x=>x)=>Array.from({length:96},(_,i)=>{
 const startMs=Date.parse('2026-11-09T00:00:00Z')+i*900000,local=localParts(new Date(startMs),'Europe/Brussels');
 return {startMs,dateKey:local.dateKey,minute:local.minuteOfDay,price:transform(typeof price==='function'?price(i):price)};
});
function seed(a,source,price=.87){
 const input=source==='homey'?a.homeyEnergy:source==='external2'?a.externalEnergy2:a.externalEnergy;
 Object.assign(input,{slots:rows(price),available:true,lastUpdatedAt:Date.now(),curveUpdatedAt:Date.now()});
}
function refreshInputs(h){
 h.app.inputUpdatedAt.grid=h.now();h.app.inputUpdatedAt.batterySoc.fill(h.now());
}
(async()=>{try{
 // Fixed and TOU use gross import for eligibility, net import-minus-cost for accounting.
 for(const settings of [{contractType:'fixed',fixedImportPrice:.70},tou(.70)]){
  const h=await fresh(settings),a=h.app;
  const before=JSON.stringify([...h.store]);
  const p=I.getEffectiveFeedInPrice(a,a.getSettings(),h.now());
  assert.equal(JSON.stringify([...h.store]),before,'price reader never writes settings');
  assert.equal(p.source,'import');near(p.comparisonPrice,.70);near(p.price,.60);near(p.cost,.10);
  await I.start(a);assert(a.injectionRuntime.active,'gross .70 meets .70 even after .10 cost');
  near(a.getSavingsTariffSnapshot().feedInPrice,.60);
  const status=I.status(a);assert.equal(status.priceSource,'import');near(status.comparisonPrice,.70);near(status.price,.60);near(status.exportCost,.10);
  I.stop(a);await h.drain();assert(!I.locked(a));assert.deepEqual(h.errors,[]);groups++;
 }
 for(const settings of [{contractType:'fixed',fixedImportPrice:.69},tou(.69)]){
  const h=await fresh(settings);
  await assert.rejects(()=>I.start(h.app),/onder minimum/);
  assert(!I.locked(h.app));groups++;
 }
 // Both contract types accept explicit net Flow prices even with a low import/fixed feed-in price.
 for(const settings of [{contractType:'fixed',fixedImportPrice:.08},tou(.08)]){
  for(const [value,unit] of [[.87,'kWh'],[87,'cent/kWh'],[870,'MWh']]){
   const h=await fresh(settings),a=h.app;
   const timers=h.timers.length,stored=JSON.stringify([...h.store]);
   const normalized=I.normalizeFeed({price:value,currency:'EUR',unit,minutes:60},h.now());
   near(normalized.price,.87);assert.equal(normalized.endAt,Date.parse('2026-11-09T14:15:00Z'));
   await h.cards.get('set_current_feed_in_price').listener({price:value,currency:'EUR',unit,minutes:60});
   assert.equal(h.timers.length,timers,'Flow price creates no timer');
   assert.equal(JSON.stringify([...h.store]),stored,'price input persists no price marker or history');
   const p=I.getEffectiveFeedInPrice(a,a.getSettings(),h.now());
   assert.equal(p.source,'flow');near(p.comparisonPrice,.87);near(p.price,.87);assert.equal(p.cost,0);
   near(a.getSavingsTariffSnapshot().feedInPrice,.87);
   await I.start(a);assert(a.injectionRuntime.active);
   h.setNow(normalized.endAt);refreshInputs(h);I.tick(a,a.getSettings(),h.now(),false);await h.drain();
   assert(!I.locked(a),'low import fallback stops injection at the exact quarter boundary');
   assert(a.lastEmittedCommands.every(x=>x===0));
   const fallback=I.getEffectiveFeedInPrice(a,a.getSettings(),h.now());
   assert.equal(fallback.source,'import');near(fallback.comparisonPrice,.08);near(fallback.price,-.02);
   // Historical accounting can still close the previous interval at its actual Flow price.
   near(I.getEffectiveFeedInPrice(a,a.getSettings(),h.now()-1).price,.87);
   a.evaluateContextNow(true);await h.drain();assert.notEqual(a.latestResult.baseMode,'injection');
   assert.deepEqual(h.errors,[]);groups++;
  }
 }
 // A valid high import fallback continues the session; expiry is not itself a forced stop.
 for(const settings of [{contractType:'fixed',fixedImportPrice:.70},tou(.70)]){
  const h=await fresh(settings),a=h.app;
  I.feed(a,{price:.87,currency:'EUR',unit:'kWh',minutes:15},h.now());
  await I.start(a);
  h.setNow(a.injectionRuntime.feed.endAt);refreshInputs(h);
  I.tick(a,a.getSettings(),h.now(),false);await h.drain();
  assert(a.injectionRuntime.active);assert.equal(a.injectionRuntime.price.source,'import');near(a.injectionRuntime.price.price,.60);
  near(a.getSavingsTariffSnapshot().feedInPrice,.60);
  I.stop(a);await h.drain();groups++;
 }
 // Real canonical dynamic source selection, with no EV installed.
 for(const contractType of ['dynamic','dynamic_hour','dynamic_quarter'])for(const source of ['homey','external','external2']){
  const h=await fresh({contractType,dynamicPriceSources:[source]}),a=h.app;
  assert.equal(a.getEvCount(a.getSettings()),0);
  seed(a,source,.87);a.getEffectiveDynamicSlots(a.getSettings(),new Date(h.now()));
  const selected=a.evDeadlinePriceSelection.selection;assert.equal(selected.source,source);
  const p=I.getEffectiveFeedInPrice(a,a.getSettings(),h.now());
  near(p.comparisonPrice,.87);near(p.price,.77);assert.equal(p.source,'import');
  await I.start(a);assert(a.injectionRuntime.active);near(a.getSavingsTariffSnapshot().feedInPrice,.77);
  I.stop(a);await h.drain();assert.deepEqual(h.errors,[]);groups++;
 }
 // A calibrated fallback must use the chosen normalized price, never its raw source price.
 {
  const h=await fresh({contractType:'dynamic_quarter',dynamicPriceSources:['homey','external2']}),a=h.app;
  const base=i=>.30+i*.002;
  Object.assign(a.homeyEnergy,{slots:rows(base,x=>x*1.21+.12),available:true,lastUpdatedAt:h.now(),formulaKnown:true,formulaKey:'p*1.21+.12'});
  Object.assign(a.externalEnergy2,{slots:rows(base),curveUpdatedAt:h.now()});
  a.getEffectiveDynamicSlots(a.getSettings(),new Date(h.now()));
  a.homeyEnergy.slots=[];a.homeyEnergyResampleCache=null;
  a.getEffectiveDynamicSlots(a.getSettings(),new Date(h.now()));
  const selected=a.evDeadlinePriceSelection.selection;assert.equal(selected.source,'external2');
  const p=I.getEffectiveFeedInPrice(a,a.getSettings(),h.now());
  near(p.comparisonPrice,selected.analysis.currentPrice);
  assert.notEqual(p.comparisonPrice,selected.sources.find(x=>x.source==='external2').sourcePrice);
  near(p.price,p.comparisonPrice-.1);
  const store=JSON.stringify([...h.store]);I.getEffectiveFeedInPrice(a,a.getSettings(),h.now());assert.equal(JSON.stringify([...h.store]),store);
  groups++;
 }
 // Missing/stale/mismatched sources fail closed; an expired Flow returns to a valid fallback.
 {
  const h=await fresh({contractType:'dynamic_quarter',dynamicPriceSources:['homey']}),a=h.app;
  a.getEffectiveDynamicSlots(a.getSettings(),new Date(h.now()));assert.equal(I.getEffectiveFeedInPrice(a,a.getSettings(),h.now()),null);
  await assert.rejects(()=>I.start(a),/geldige actuele terugleverprijs/);
  seed(a,'homey',.87);a.getEffectiveDynamicSlots(a.getSettings(),new Date(h.now()));await I.start(a);
  a.homeyEnergy.lastUpdatedAt=h.now()-20*60000-1;
  I.tick(a,a.getSettings(),h.now(),false);await h.drain();assert(!I.locked(a));
  assert.equal(I.getEffectiveFeedInPrice(a,a.getSettings(),h.now()),null);groups++;
 }
 for(const settings of [{contractType:'fixed'},tou(),{contractType:'dynamic_quarter',dynamicPriceSources:['external2']}]){
  const h=await fresh(settings),a=h.app;
  if(settings.contractType==='dynamic_quarter'){seed(a,'external2',.87);a.getEffectiveDynamicSlots(a.getSettings(),new Date(h.now()));}
  I.feed(a,{price:.87,currency:'GBP',unit:'kWh',minutes:15},h.now());
  assert.equal(I.getEffectiveFeedInPrice(a,a.getSettings(),h.now()),null);
  await assert.rejects(()=>I.start(a),/valuta/);
  h.setNow(a.injectionRuntime.feed.endAt);refreshInputs(h);
  assert.equal(I.getEffectiveFeedInPrice(a,a.getSettings(),h.now()).source,'import');
  a.setSetting('currencySymbol','unknown');
  assert.equal(I.getEffectiveFeedInPrice(a,a.getSettings(),h.now()),null);groups++;
 }
 // Explicit manual takeover is idempotent and survives disabling automatic operation.
 {
  const h=await fresh({injectionAutomaticEnabled:true}),a=h.app;let starts=0,stops=0;
  a.injectionStartedTrigger.trigger=async()=>starts++;a.injectionStoppedTrigger.trigger=async()=>stops++;
  I.tick(a,a.getSettings(),h.now(),true);await h.drain();assert(a.injectionRuntime.active);
  await I.start(a,'manual');await I.start(a,'manual');assert.equal(a.injectionRuntime.source,'manual');assert.equal(starts,1);
  await h.setExternalSetting('injectionAutomaticEnabled',false);await h.drain();assert(a.injectionRuntime.active);assert.equal(stops,0);
  I.stop(a);await h.drain();assert.equal(stops,1);groups++;
 }
 // A takeover while EV-stop I/O is pending is not overwritten by the original automatic start.
 {
  const h=await fresh({injectionAutomaticEnabled:true}),a=h.app;
  const publish=a.publishEvPortfolioNow.bind(a);let release;
  const blocked=new Promise(resolve=>{release=resolve;});
  a.publishEvPortfolioNow=async(...args)=>{await blocked;return publish(...args);};
  const running=I.start(a,'automatic');await h.drain();assert(a.injectionRuntime.preparing);
  await I.start(a,'manual');await h.setExternalSetting('injectionAutomaticEnabled',false);
  release();await running;await h.drain();assert(a.injectionRuntime.active);assert.equal(a.injectionRuntime.source,'manual');
  I.stop(a);await h.drain();groups++;
 }
 // Exactly one percentage point is enough; exactly the stop floor remains forbidden.
 {
  const h=await fresh({injectionAutomaticEnabled:true}),a=h.app;
  a.state.batterySoc.fill(40.999);I.tick(a,a.getSettings(),h.now(),true);await h.drain();assert(!I.locked(a));
  a.state.batterySoc.fill(41);I.tick(a,a.getSettings(),h.now(),true);await h.drain();assert(a.injectionRuntime.active);
  a.state.batterySoc.fill(40);I.tick(a,a.getSettings(),h.now(),false);await h.drain();assert(!I.locked(a));
  await assert.rejects(()=>I.start(a,'manual'),/SoC/);groups++;
 }
 // A card received on the exact quarter belongs to the NEW quarter, in either event order.
 for(const ordering of ['feed_then_tick','tick_then_feed','tick_then_feed_one_second_later']){
  const h=await fresh({injectionAutomaticEnabled:true,fixedImportPrice:.30}),a=h.app;
  let starts=0,stops=0;a.injectionStartedTrigger.trigger=async()=>starts++;a.injectionStoppedTrigger.trigger=async()=>stops++;
  I.feed(a,{price:.87,currency:'EUR',unit:'kWh',minutes:15},h.now());
  I.tick(a,a.getSettings(),h.now(),true);await h.drain();assert(a.injectionRuntime.active);
  const boundary=a.injectionRuntime.feed.endAt;h.setNow(boundary);refreshInputs(h);
  if(ordering!=='feed_then_tick'){
   I.tick(a,a.getSettings(),h.now(),false);await h.drain();assert(!I.locked(a));
   if(ordering==='tick_then_feed_one_second_later'){h.setNow(boundary+1000);refreshInputs(h);}
  }
  await h.cards.get('set_current_feed_in_price').listener({price:.91,currency:'EUR',unit:'kWh',minutes:60});
  assert.equal(a.injectionRuntime.feed.startAt,boundary);
  assert.equal(a.injectionRuntime.feed.endAt,boundary+900000);
  I.tick(a,a.getSettings(),h.now(),true);await h.drain();assert(a.injectionRuntime.active);
  const expectedStarts=ordering==='feed_then_tick'?1:2;assert.equal(starts,expectedStarts);
  assert.equal(stops,ordering==='feed_then_tick'?0:1);
  I.feed(a,{price:.91,currency:'EUR',unit:'kWh',minutes:15},h.now());
  I.tick(a,a.getSettings(),h.now(),true);await h.drain();assert.equal(starts,expectedStarts,'duplicate card does not duplicate start');
  assert.deepEqual(h.errors,[]);groups++;
 }
 // A fresh price cannot acknowledge an unfinished physical zero, but resumes after its real publication.
 {
  const h=await fresh({injectionAutomaticEnabled:true,fixedImportPrice:.30}),a=h.app;
  let starts=0;a.injectionStartedTrigger.trigger=async()=>starts++;
  I.feed(a,{price:.87,currency:'EUR',unit:'kWh',minutes:15},h.now());
  I.tick(a,a.getSettings(),h.now(),true);await h.drain();a.evaluateContextNow(true);await h.drain();
  assert(a.lastEmittedCommands.some(x=>x>0));
  let release,entered=false;const sent=[];
  a.commandTrigger.trigger=async tokens=>{
   sent.push(tokens.total_command);
   if(tokens.total_command===0&&!entered){entered=true;await new Promise(resolve=>{release=resolve;});}
  };
  h.setNow(a.injectionRuntime.feed.endAt);refreshInputs(h);
  I.tick(a,a.getSettings(),h.now(),false);await h.drain();assert(entered);assert(a.commandPublishing);
  I.feed(a,{price:.91,currency:'EUR',unit:'kWh',minutes:60},h.now());
  I.tick(a,a.getSettings(),h.now(),true);await h.drain();
  assert(a.injectionRuntime.pendingStop);assert.equal(h.store.get('_injectionLatch').needsStop,true);
  assert(!a.injectionRuntime.active);assert.equal(starts,1);
  a.requestContextEvaluate=h.realRequestContext;
  release();await h.drain();await h.flush();
  assert(!a.injectionRuntime.pendingStop);assert(a.injectionRuntime.active);
  assert.equal(starts,2);assert.equal(sent.filter(x=>x===0).length,1);
  assert.deepEqual(h.errors,[]);groups++;
 }
 // New prices never release explicit manual-stop or SoC holds in the same interval.
 for(const why of ['manual','soc']){
  const h=await fresh({injectionAutomaticEnabled:true,fixedImportPrice:.30}),a=h.app;
  I.feed(a,{price:.87,currency:'EUR',unit:'kWh',minutes:15},h.now());
  I.tick(a,a.getSettings(),h.now(),true);await h.drain();
  if(why==='manual')I.stop(a);
  else {a.state.batterySoc.fill(40);I.tick(a,a.getSettings(),h.now(),false);}
  await h.drain();const latch=structuredClone(h.store.get('_injectionLatch'));
  a.state.batterySoc.fill(80);h.setNow(h.now()+1000);refreshInputs(h);
  I.feed(a,{price:.91,currency:'EUR',unit:'kWh',minutes:15},h.now());
  I.tick(a,a.getSettings(),h.now(),true);await h.drain();
  assert(!I.locked(a));assert.deepEqual(h.store.get('_injectionLatch'),latch);groups++;
 }
 console.log(`Injection price fixes1.3.1: ${groups} real-app scenario groups passed`);
}finally{Date.now=originalNow;restore();restoreDate();}})().catch(error=>{console.error(error);process.exitCode=1;});
