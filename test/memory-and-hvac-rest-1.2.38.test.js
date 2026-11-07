'use strict';
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {boot}=require('./startup-harness');
const H=require('../lib/hvac-permanent'),L=require('../lib/hvac-learning');
const {normalizeDynamicPriceResponse}=require('../lib/homey-energy');
const {parseExternalPrices}=require('../lib/external-prices');
const {prepareEvPriceCurve}=require('../lib/ev-deadline-planner');
const realNow=Date.now;let now=Date.UTC(2026,10,7,12);Date.now=()=>now;
let checks=0;
const check=async(name,fn)=>{await fn();checks++;console.log('PASS',name);};
function fixture(){
 const s={batteryCount:2,evCount:0,hvacCount:1,controlEnabled:true,hybridEmsEnabled:false,hvacEnabled:true,hvacAutomaticControlEnabled:true,hvacDirection:"heat",hvacCoordination:[{}]};
 const commands=[0,0],settings={hvacEnabled:true,hvacAutomaticControlEnabled:true,hvacDirection:'heat',hvacControlIntervalMinutes:5,hvacCoordination:{}};
 const a={homey:{settings:{get:()=>null}},settingsCache:s,state:{gridPowerW:500,pvPowerW:0,lastTotalCommandW:0},inputSeen:{grid:true,pv:true},inputUpdatedAt:{grid:now,pv:now},
 lastEmittedCommands:commands,batteryIdleKnownOutput:commands,lastEmitAt:now-1000,latestResult:{baseMode:'solar_capture',candidateCommands:[0,0]},
 getSettings:()=>s,getBatteryCount:()=>s.batteryCount,getEvCount:()=>0,getHvacCount:()=>1,isChargeTestValid:()=>true,
 getGridFreshness:(_,t)=>({fresh:t>=a.inputUpdatedAt.grid&&t-a.inputUpdatedAt.grid<=30000}),getHvacInstanceSettings:()=>settings,setSetting:()=>{}};
 H.unit(a,0);return {a,s};
}
function point(a,watts){a.state.gridPowerW=watts;a.inputUpdatedAt.grid=a.inputUpdatedAt.pv=now;H.observe(a,now);}
function reference(a){const start=now;L.prepare(a,0,now);for(let n=0;n<=24;n++){now=start+n*10000;point(a,500);}}
function begin(a){reference(a);H.begin(a,0,{direction:'heat',currentMode:'off',currentSetpointC:18,roomTemperatureC:18},now);assert(H.runtime(a).observation);}
async function run(){
 await check('Battery Save without physical battery feedback learns from settled, published zero outputs',()=>{
  const {a}=fixture();assert.equal(L.meter(a,now).reason,L.reasons.rest);
  for(let trial=0;trial<3;trial++){
   begin(a);const start=now;
   assert.equal(H.runtime(a).observation.batterySource,'managed_rest');
   for(let n=1;n<=30;n++){now=start+n*10000;point(a,1400);}
   H.finish(a,now);
  }
  assert.equal(H.unit(a,0).heat,900);assert.equal(H.status(a,0).heatBatterySource,'managed_rest');
 });
 await check('Standby supports rest, while charge, self-consumption, Hybrid, unpublished and cancelling battery vectors do not',()=>{
  for(const mutate of [
   a=>a.settingsCache.hybridEmsEnabled=true,
   a=>a.settingsCache.controlEnabled=false,
   a=>a.isChargeTestValid=()=>false,
   a=>a.batteryIdleKnownOutput=null,
   a=>{a.lastEmittedCommands=[-500,500];a.batteryIdleKnownOutput=a.lastEmittedCommands;},
   a=>a.latestResult.baseMode='charge',
   a=>a.latestResult.baseMode='self_consumption',
   a=>a.latestResult.candidateCommands=[-300,0],
   a=>a.inFlightBatteryCommands=[0,0],
   a=>a.commandPublishing=true,
   a=>a.pendingResult={candidateCommands:[100,0]},
   a=>a.batteryEfficiencyTransitionTimer={},
   a=>a.hvacLearningBattery={powerW:500,at:now-16000},
   a=>a.hvacLearningBattery={powerW:0,at:now+1},
  ]){const {a}=fixture();mutate(a);assert.equal(L.meter(a,now).reason,L.reasons.battery);}
  const {a}=fixture();a.latestResult.baseMode='standby';assert.equal(L.meter(a,now).reason,L.reasons.rest);now+=60000;a.inputUpdatedAt.grid=a.inputUpdatedAt.pv=now;assert.equal(L.meter(a,now).batterySource,'managed_rest');
 });
 await check('Battery activity during a rest-based measurement discards the observation and preserves trusted watts',()=>{
  const {a}=fixture();H.unit(a,0).heat=1100;H.recheck(a,0,'heat');begin(a);
  a.latestResult.candidateCommands=[-400,0];now+=70000;point(a,1400);H.slowTick(a,now);
  assert.equal(H.runtime(a).observation,null);assert.equal(H.unit(a,0).heat,1100);assert.equal(H.status(a,0).heatReason,L.reasons.battery);
 });
 await check('Fresh actual feedback wins, and measured correction can still learn with active batteries',()=>{
  const {a}=fixture();a.latestResult.baseMode='charge';L.batteryFeedback(a,-1000,now);const m=L.meter(a,now);
  assert.equal(m.batterySource,'measured');assert.equal(m.watts,-500);assert.equal(m.battery,-1000);
  a.latestResult.baseMode='solar_capture';delete a.hvacLearningBattery;begin(a);L.batteryFeedback(a,400,now+1000);
  assert.equal(H.runtime(a).observation.invalidReason,L.reasons.battery);
 });
 await check('Missing/stale PV and grid do not become valid simply because batteries are resting',()=>{
  const {a}=fixture();L.meter(a,now);now+=60000;
  assert.equal(L.meter(a,now).reason,L.reasons.grid);a.inputUpdatedAt.grid=now;a.inputSeen.pv=false;
  assert.equal(L.meter(a,now).reason,L.reasons.pv);
 });
 await check('Physical price correction and explicit EV interval ends survive removal of raw metadata',()=>{
  const start=new Date(now).toISOString(),end=new Date(now+300000).toISOString();
  const slots=normalizeDynamicPriceResponse({pricesPerInterval:[{periodStart:start,periodEnd:end,value:.1,valueWithUserCosts:.25,unused:'x'.repeat(100000)}]});
  assert.equal(slots[0].price,.25);assert.equal(slots[0].rawPrice,.1);assert.equal(slots[0].raw,undefined);assert.equal(slots[0].endMs,now+300000);
  assert.equal(prepareEvPriceCurve(slots).intervals[0].endAt,now+300000);assert(JSON.stringify(slots).length<300);
 });
 await check('External prices reject oversize inputs atomically and bound next-hours normalization',async()=>{
  const h=await boot(new Map([['settingsSchemaVersion',71]])),a=h.app;a.requestContextEvaluate=()=>{};
  a.readExternalPrices('external',JSON.stringify([{start:new Date(now).toISOString(),price:.2,unused:'x'.repeat(10000)}]));
  const old=a.externalEnergy.slots;assert.equal(old[0].raw,undefined);assert(!JSON.stringify(h.store.get('_externalPriceCurves')).includes('unused'));
  assert.throws(()=>a.readExternalPrices('external',' '.repeat(1048577)+'[]'),/1 MiB/);assert.equal(a.externalEnergy.slots,old);
  assert.throws(()=>parseExternalPrices(JSON.stringify(Array(4097).fill(.2))),/4096/);
  const curve=parseExternalPrices(JSON.stringify(Array(1000).fill(.2)),{period:'next_hours',intervalMinutes:15,now:new Date(now)});
  assert(curve.slots.length<=481);assert(curve.slots.every(s=>s.raw===undefined));
 });
 await check('Stored raw price objects are compacted on an ordinary same-version restart',async()=>{
  const slots=[{startMs:now,dateKey:'2026-11-07',minute:720,price:.2,raw:{periodEnd:new Date(now+900000).toISOString(),unused:'obsolete'}}];
  const h=await boot(new Map([['settingsSchemaVersion',71],['_externalPriceCurves',{external:{slots,curveUpdatedAt:now}}]]));
  assert.equal(h.app.externalEnergy.slots[0].raw,undefined);assert(!JSON.stringify(h.store.get('_externalPriceCurves')).includes('obsolete'));
 });
 await check('Stopped diagnostics release recording graphs but preserve report export, reset and a new session',async()=>{
  const h=await boot(new Map([['settingsSchemaVersion',71]])),a=h.app;
  a.startDiagnosticsSession({planning:true,memory:true},now);
  const plan={rows:Array.from({length:96},(_,i)=>({at:i,value:Math.random(),detail:'x'.repeat(60)}))};
  for(let i=0;i<600;i++)a.recordDiagnosticPlanning(plan,now+i,a.getSettings(),a.state);
  assert(a.diagnostics.planningEvents.length<600);assert(a.diagnostics.droppedPlanningForMemory>0);
  const before=a.getDiagnosticsReport();a.expireDiagnostics('48h_expired',now+172800000);
  assert(a.diagnostics.archivedReport);assert.equal(a.diagnostics.planningEvents.length,0);assert.equal(a.diagnostics.compact,null);
  const report=a.getDiagnosticsReport();assert.deepEqual(report.planning.events,before.planning.events);assert.equal(report.session.active,false);
  assert(a.diagnostics.archivedReport.length<Buffer.byteLength(JSON.stringify(before))/3);
  a.resetDiagnosticsReport();assert.equal(a.getDiagnosticsReport().planning.events.length,0);assert.equal(a.diagnostics.archivedReport,undefined);
  a.startDiagnosticsSession({planning:true},now);assert(a.diagnostics.sessionActive);assert.equal(a.diagnostics.planningConfigurations.length,1);
  a.setSetting('diagnosticsPlanningEnabled',false);a.handleDiagnosticsSettingsChanged();assert(a.diagnostics.archivedReport);assert.equal(a.getDiagnosticsReport().session.endReason,'manual');
 });
 await check('Shutdown clears all registered app timers, listeners and API clients',async()=>{
  const handles=[],settings=new EventEmitter(),homey=new EventEmitter(),clear=global.clearTimeout,clearInterval=global.clearInterval;
  global.clearTimeout=global.clearInterval=t=>{if(t?.audit)t.cleared=true;else clear(t);};
  try{
   const h=await boot(new Map([['settingsSchemaVersion',71]]),({app})=>{
    app.homey.on=homey.on.bind(homey);app.homey.off=homey.off.bind(homey);app.homey.settings.on=settings.on.bind(settings);app.homey.settings.off=settings.off.bind(settings);
    for(const [name,type]of [['setTimeout','timeout'],['setInterval','interval']])app.homey[name]=(fn,ms)=>{const t={audit:true,fn,ms,type};handles.push(t);return t;};
   });
   let destroyed=0;h.app.homeyApi=h.app.ownerHomeyApi={destroy:()=>destroyed++};h.app.startDiagnosticsSession({memory:true},now);
   await h.app.onUninit();assert.equal(destroyed,1);assert.equal(settings.listenerCount('set'),0);assert.equal(homey.listenerCount('cpuwarn'),0);assert(handles.every(t=>t.cleared));
   const count=handles.length;h.app.requestContextEvaluate();h.app.requestEvaluate();await h.app.runContextEvaluation();assert.equal(handles.length,count);
  }finally{global.clearTimeout=clear;global.clearInterval=clearInterval;}
 });
 console.log(`Memory and battery-rest learning 1.2.38: ${checks} scenario groups passed.`);
}
run().finally(()=>Date.now=realNow).catch(e=>{console.error(e);process.exitCode=1;});
