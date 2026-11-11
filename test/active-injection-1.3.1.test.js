'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const I=require('../lib/active-injection'),E=require('../lib/ems-engine');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const {resolveEvOutput}=require('../lib/ev-output-policy');
const originalNow=Date.now,restore=installVirtualClearTimeout();let checks=0;
const check=(condition,message)=>{assert(condition,message);checks++;};
const base={...E.DEFAULTS,batteryCount:1,totalCapacityKwh:10,maxTotalDischargeW:10000,maxDischargePerBatteryW:10000,
 maxTotalChargeW:10000,maxChargePerBatteryW:10000,controlProfile:'exact',gridZeroMinW:-5,gridZeroMaxW:5,
 optimizeMultiBatteryEfficiency:false,contractType:'fixed',fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00',
 safetySoc:10,minSoc:7,peakShaveEnabled:false,batterySaveDischargeAboveSoc:100,forcedMode:'auto'};
const state={batterySoc:[80],gridPowerW:800,pvPowerW:0,forecastRemainingKwh:20,lastTotalCommandW:0,
 injectionActive:true,injectionTargetW:3000,injectionStopSoc:40};
const at=new Date('2026-11-09T14:05:00Z');
async function fresh(overrides={}) {
 const h=await setup(undefined,{injectionEnabled:true,fixedImportPrice:1,exportLimitEnabled:false,
   peakShaveEnabled:false,optimizeMultiBatteryEfficiency:false,...overrides},undefined,0);
 await h.drain();
 h.app.requestContextEvaluate=()=>{};h.app.requestEvaluate=()=>{};
 return h;
}
(async()=>{try{
 // One controller, net P1 goal, household/PV compensation and hard battery limits.
 let r=E.evaluate(state,base,at);assert.equal(r.baseMode,'injection');assert.equal(r.totalCommandW,3800);checks++;
 r=E.evaluate({...state,gridPowerW:-700,pvPowerW:1500},base,at);assert.equal(r.totalCommandW,2300);checks++;
 r=E.evaluate({...state,gridPowerW:-3000,lastTotalCommandW:3800},base,at);assert.equal(r.totalCommandW,3800);checks++;
 r=E.evaluate(state,{...base,maxTotalDischargeW:2000},at);assert.equal(r.totalCommandW,2000);checks++;
 r=E.evaluate({...state,batterySoc:[40]},base,at);check(!r.injectionActive&&r.baseMode!=='injection','aggregate SoC stops intentional export and resumes normal strategy');
 r=E.evaluate({...state,batterySoc:[5]},base,at);check(!r.injectionActive&&r.totalCommandW<0,'Safety recovery takes priority');
 r=E.evaluate({...state,batterySoc:[40,80]}, {...base,batteryCount:2,totalCapacityKwh:20},at);assert.equal(r.commands[0],0);check(r.commands[1]>0,'individual SoC protection');
 r=E.evaluate(state,{...base,forcedMode:'solar_capture'},at);check(r.injectionActive&&r.totalCommandW===3800,'explicit Battery Saving does not block intentional export');
 for(const forcedMode of ['standby','manual_charge']) {r=E.evaluate(state,{...base,forcedMode},at);check(!r.injectionActive&&r.baseMode===forcedMode,'forced mode remains authoritative');}
 for(const type of ['current','mode','hybrid'])for(const mode of ['smart','standard','emergency','soc_target']) {
  const d={connected:true,allowed:true,desiredCurrentA:16,effectiveChargeMode:'standard',source:'guarantee',mode};
  const o=resolveEvOutput({decision:d,settings:{evEnabled:true,evControlType:type},injectionBlocked:true});
  check(!o.allowed&&o.currentA===0&&(type==='current'||o.mode==='stop'),'all EV output modes vetoed');
 }
 // Inactive defaults: compare production engine against unmodified 1.2.41.
 const fixture=require('./fixtures/injection-inactive-1.2.41.json');
 for(let i=0;i<100;i++) {
  const sample={...state,injectionActive:false,gridPowerW:-4000+i*125,batterySoc:[10+i*.8],lastTotalCommandW:(i%7-3)*400};
  const settings={...base,peakShaveEnabled:true,contractType:i%2?'fixed':'dynamic',forcedMode:['auto','solar_capture','self_consumption','standby'][i%4]};
  const before=fixture.cases[i],after=E.evaluate(sample,settings,at);
  for(const key of Object.keys(before))assert.deepEqual(after[key],before[key],key);
 }checks++;
 let h=await fresh(),a=h.app;
 check(h.errors.length===0&&a.getSettings().injectionStopSoc===40,'upgrade defaults and startup');
 const initialTimers=h.timers.length;
 await I.start(a);check(a.injectionRuntime.active,'manual start');
 a.evaluateContextNow(true);await h.drain();check(a.latestResult.injectionActive,'real app uses injection engine');
 const normalSettings=a.getSettings();I.stop(a);await h.drain();check(!I.locked(a)&&a.lastEmittedCommands.every(x=>x===0),'shared publisher stops export');
 check(a.getSettings().forcedMode===normalSettings.forcedMode&&a.getSettings().batterySaveDischargeAboveSoc===normalSettings.batterySaveDischargeAboveSoc,'no strategy settings changed');
 const latch=a.homey.settings.get('_injectionLatch');check(latch&&latch.until>h.now(),'manual-stop latch persisted');
 await h.setExternalSetting('injectionAutomaticEnabled',true);I.tick(a,a.getSettings(),h.now(),true);await h.drain();check(!I.locked(a),'manual stop overrides automatic in same interval');
 const saved=structuredClone(a.homey.settings.get('_injectionLatch'));a.injectionRuntime=null;I.runtime(a);
 check(!I.locked(a)&&a.injectionRuntime.latch.key===saved.key,'restart never restores active and preserves stop latch');
 I.tick(a,a.getSettings(),h.now(),true);await h.drain();check(!I.locked(a),'restart respects interval block');
 await I.start(a);check(I.locked(a),'explicit manual start may override latch after gate validation');
 a.state.batterySoc=[40,40,40,40];I.tick(a,a.getSettings(),h.now(),false);await h.drain();check(!I.locked(a)&&a.lastEmittedCommands.every(x=>x===0),'SoC immediately terminates export');
 a.state.batterySoc=[60,60,60,60];I.tick(a,a.getSettings(),h.now(),true);await h.drain();check(!I.locked(a),'SoC stop does not oscillate in same interval');
 h=await fresh();a=h.app;await I.start(a);await h.setExternalSetting('injectionEnabled',false);await h.drain();
 check(!I.locked(a),'permission OFF ends mode');await assert.rejects(()=>I.start(a),/niet toegestaan/);checks++;
 h=await fresh({injectionEnabled:false});a=h.app;await assert.rejects(()=>h.cards.get('start_injection').listener({}),/niet toegestaan/);checks++;
 // A dynamic fallback requires a real, current canonical import price.
 h=await fresh({contractType:'dynamic'});a=h.app;
 I.refreshPrice(a,a.getSettings(),h.now());check(!a.injectionRuntime.price,'no invented dynamic price when the import source is unavailable');
 I.feed(a,{price:900,currency:'EUR',unit:'MWh',minutes:15},h.now());assert.equal(a.injectionRuntime.price.price,.9);checks++;
 I.feed(a,{price:90,currency:'EUR',unit:'cent/kWh',minutes:'15'},h.now());assert.equal(a.injectionRuntime.price.price,.9);checks++;
 I.feed(a,{price:.9,currency:'GBP',unit:'kWh',minutes:15},h.now());check(!a.injectionRuntime.price,'currency mismatch rejected');
 await h.setExternalSetting('currencySymbol','£');I.refreshPrice(a,a.getSettings(),h.now());assert.equal(a.injectionRuntime.price.price,.9);checks++;
 for(const date of ['2026-10-25T00:35:00Z','2026-10-25T01:35:00Z','2026-03-29T00:35:00Z','2026-03-29T01:35:00Z']) {
  const stamp=Date.parse(date);I.feed(a,{price:.9,currency:'GBP',unit:'kWh',minutes:15},stamp);const p=a.injectionRuntime.feed;
  check(p.startAt<=stamp&&stamp<p.endAt&&p.endAt-p.startAt===900000,'DST interval is an absolute current quarter');
 }
 const stamp=h.now();I.feed(a,{price:.9,currency:'GBP',unit:'kWh',minutes:15},stamp);
 I.refreshPrice(a,a.getSettings(),a.injectionRuntime.feed.endAt);check(!a.injectionRuntime.price,'price expires exactly at boundary');
 for(const bad of [{price:null},{price:Infinity},{price:1,currency:'JPY'},{price:1,unit:'watts'},{price:1,minutes:30}])assert.throws(()=>I.feed(a,{currency:'EUR',unit:'kWh',minutes:15,...bad},stamp));checks++;
 h=await fresh({fixedImportPrice:.69});a=h.app;await assert.rejects(()=>I.start(a),/onder minimum/);checks++;
 h=await fresh({fixedImportPrice:.69});a=h.app;I.feed(a,{price:.9,currency:'EUR',unit:'kWh',minutes:15},h.now());await I.start(a);
 h.setNow(a.injectionRuntime.feed.endAt);a.inputUpdatedAt.grid=h.now();a.inputUpdatedAt.batterySoc.fill(h.now());
 I.tick(a,a.getSettings(),h.now(),false);await h.drain();check(!I.locked(a)&&a.injectionRuntime.reason.includes('onder minimum'),'expired Flow price stops when the current import fallback is below threshold');
 h=await fresh();a=h.app;I.feed(a,{price:.9,currency:'EUR',unit:'kWh',minutes:15},h.now());await I.start(a);
 h.setNow(a.injectionRuntime.feed.endAt);a.inputUpdatedAt.grid=h.now();a.inputUpdatedAt.batterySoc.fill(h.now());
 I.tick(a,a.getSettings(),h.now(),false);await h.drain();check(a.injectionRuntime.active&&a.injectionRuntime.price.source==='import','expired Flow price uses the qualifying current import fallback');
 h=await fresh();a=h.app;await I.start(a);a.inputUpdatedAt.grid=h.now()-120000;I.tick(a,a.getSettings(),h.now(),false);await h.drain();check(!I.locked(a),'stale P1 stops');
 h=await fresh({hybridEmsEnabled:true});a=h.app;a.hybridEmsRuntime.delegated=true;
 await assert.rejects(()=>I.start(a),/Externe EMS/);checks++;
 a.hybridEmsRuntime.delegated=false;a.hybridEmsRuntime.status='handover_wait';await assert.rejects(()=>I.start(a),/overdracht/);checks++;
 h=await fresh({exportLimitEnabled:true,minimumExportW:1500});a=h.app;await I.start(a);assert.equal(I.engineState(a,a.getSettings()).injectionTargetW,1500);checks++;
 h=await fresh();a=h.app;await I.start(a);a.evaluateContextNow();await h.drain();const obsolete={...a.latestResult};I.stop(a);await h.drain();check(!I.validPublication(a,obsolete,a.getSettings()),'stale queued export cannot publish');
 h=await fresh({peakShaveEnabled:true,peakLimitW:3000});a=h.app;await I.start(a);a.state.gridPowerW=4000;I.tick(a,a.getSettings(),h.now(),false);await h.drain();check(!a.injectionRuntime.active&&a.injectionRuntime.returningToControl,'Peak Guard takes over without an intervening zero command');
 h=await fresh();a=h.app;await I.start(a);await assert.rejects(()=>a.startChargeTestNow(),/Stop eerst/);assert.throws(()=>a.startBatteryResponseTest(),/Stop eerst/);await assert.rejects(()=>a.testEvOutput({}),/geblokkeerd/);checks++;
 // Four managed chargers: same lock in allocator, primary and extra publishers.
 h=await fresh({evCount:4,evEnabled:true,ev2Enabled:true,ev3Enabled:true,ev4Enabled:true,
  evControlType:'current',ev2ControlType:'mode',ev3ControlType:'hybrid',ev4ControlType:'current'});a=h.app;
 for(let i=0;i<4;i++){const input=a.getEvInputSnapshot(i);if(i){Object.assign(a.getExtraEv(i).state,{connected:true,chargeCurrentA:0});Object.assign(a.getExtraEv(i).seen,{connected:true,chargeCurrent:true});}else{Object.assign(a.state,{evConnected:true,evChargeCurrentA:0});Object.assign(a.inputSeen.ev,{connected:true,chargeCurrent:true});}}
 await I.start(a);await h.drain();check(a.injectionRuntime.active,'all four chargers stopped before export');
 for(let i=0;i<4;i++){const d={connected:true,allowed:true,desiredCurrentA:16,desiredPowerW:3680,source:'guarantee',effectiveChargeMode:'standard'};const s=a.getEvInstanceSettings(i);const output=a.getEvOutputFor(i,d,s);check(output.currentA===0&&!output.allowed,'EV output lock '+i);}
 a.state.evChargeCurrentA=10;I.tick(a,a.getSettings(),h.now(),false);await h.drain();check(!I.locked(a),'real EV charging feedback aborts export');
 // At most one compact runtime, no histories, no new background primitives.
 const code=fs.readFileSync(path.join(__dirname,'../lib/active-injection.js'),'utf8');
 check(!/setInterval\s*\(|setTimeout\s*\(|\.on\s*\(/.test(code),'no new background work');
 check(!Object.values(a.injectionRuntime).some(Array.isArray),'bounded runtime without history');
 console.log('Active injection 1.3.1:',checks,'checks passed');
 }finally{Date.now=originalNow;restore();}})().catch(e=>{console.error(e);process.exitCode=1;});
