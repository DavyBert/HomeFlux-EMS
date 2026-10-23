'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {fixture,START}=require('./ev-work-harness');
const {findNextLocalTime}=require('../lib/flexible-loads');
const {installVirtualClearTimeout}=require('./pv-source-harness');
const NativeDate=Date;
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const restore=installVirtualClearTimeout();
let scenarios=0, calendarChecks=0;
async function settle(h){await h.drain();await h.flush();assert.deepEqual(h.errors,[]);}
async function planned(type,options={}){
 const h=await fixture(options),a=h.app;
 const args=type==='energy'?{energy:15,time:'07:00',guarantee:'no'}:{target_soc:80,time:'07:00',guarantee:'no'};
 await h.cards.get(`set_ev1_${type}_deadline`).listener(args);await settle(h);
 return{h,a,args};
}
function spy(a){
 const counts={requests:0,settings:0,writes:0};
 const request=a.requestContextEvaluate,settings=a.getEvInstanceSettings,write=a.homey.settings.set;
 a.requestContextEvaluate=function(...args){counts.requests++;return request.apply(this,args);};
 a.getEvInstanceSettings=function(...args){counts.settings++;return settings.apply(this,args);};
 a.homey.settings.set=(key,value)=>{if(['evSocDeadlineOverrides','evEnergyDeadlineOverrides'].includes(key))counts.writes++;return write(key,value);};
 return counts;
}
async function repeatedGoals(){
 for(const type of ['soc','energy']){
  const{h,a,args}=await planned(type),counts=spy(a),origin=h.now();
  a.inputMonitor.start();
  const plans=structuredClone([a.evSocPlans,a.evEnergyPlans]);
  for(let n=0;n<300;n++){
    h.setNow(origin+n*1000);
    const id=n%3===0?`set_ev1_${type}_deadline`:n%3===1?`set_ev_${type}_deadline_for`:`set_ev_${type}_deadline_for_configured`;
    const selection=n%3===1?{ev:'1'}:n%3===2?{ev:{id:'1',kind:'ev',name:'test'}}:{};
    assert.equal(await h.cards.get(id).listener({...args,...selection}),true);
  }
  assert.deepEqual([a.evSocPlans,a.evEnergyPlans],plans,'duplicates must not reset plans or administrative timestamps');
  assert.deepEqual(counts,{requests:0,settings:0,writes:0});
  const report=a.inputMonitor.snapshot();
  assert.equal(report.totalReceived,300,'monitor still counts every received card');
  assert.equal(report.requests.context,0);a.inputMonitor.stop();scenarios++;
 }
}
async function changedAndConflictingGoals(){
 for(const type of ['soc','energy']){
  const{h,a,args}=await planned(type),c=spy(a);
  const value=type==='soc'?'target_soc':'energy';
  assert.equal(await h.cards.get(`set_ev1_${type}_deadline`).listener({...args,[value]:args[value]+Number.EPSILON*args[value]}),true);
  assert.equal(c.requests,0);assert.equal(c.writes,0);
  await h.cards.get(`set_ev1_${type}_deadline`).listener({...args,[value]:args[value]+.0001});await settle(h);
  assert(c.requests>0);assert(c.writes>0);scenarios++;
  const n=c.requests;
  await h.cards.get(`set_ev1_${type}_deadline`).listener({...args,time:'08:00'});await settle(h);
  assert(c.requests>n);const p=type==='soc'?a.evSocPlans[0]:a.evEnergyPlans[0];assert.equal(p.targetTime,'08:00');scenarios++;
  const before=c.requests;
  await h.cards.get(`set_ev1_${type}_deadline`).listener({...args,time:'08:00',guarantee:'yes'});await settle(h);
  assert(c.requests>before);assert(p.guarantee);scenarios++;
 }
 const{h,a}=await planned('soc');
 await h.cards.get('set_ev1_energy_deadline').listener({energy:15,time:'07:00',guarantee:'no'});await settle(h);
 assert(a.evEnergyPlans[0].active);assert(!a.evSocPlans[0].active);
 await h.cards.get('set_ev1_soc_deadline').listener({target_soc:80,time:'07:00',guarantee:'no'});await settle(h);
 assert(a.evSocPlans[0].active);assert(!a.evEnergyPlans[0].active);scenarios++;
}
async function progressAndRecovery(){
 const h=await fixture({type:'current',chargeAllowed:true}),a=h.app;
 await h.cards.get('set_ev1_energy_deadline').listener({energy:15,time:'07:00',guarantee:'yes'});await settle(h);
 await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:10});await settle(h);
 h.setNow(h.now()+30000);
 await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:10});await settle(h);
 assert(a.evEnergyPlans[0].remainingKwh<15,'actual delivered current decreases remaining energy');
 const before=structuredClone(a.evEnergyPlans[0]),counts=spy(a);
 await h.cards.get('set_ev1_energy_deadline').listener({energy:15,time:'07:00',guarantee:'yes'});
 assert.deepEqual(a.evEnergyPlans[0],before,'repeated persistent target cannot refill delivered kWh');
 assert.equal(counts.requests,0);assert.equal(counts.writes,0);scenarios++;
 await h.cards.get('set_ev1_status').listener({connected:'no',charge_current:0});await settle(h);
 await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});await settle(h);
 assert.equal(a.evEnergyPlans[0].remainingKwh,15,'new connection rearms persistent kWh goal');scenarios++;
 a.evEnergyPlans[0].deadlineAt=h.now()-1;
 a.tickEvEnergyPlan(0,h.now());
 assert(a.evEnergyPlans[0].deadlineAt>h.now(),'idle tick preserves deadline rollover side effect');scenarios++;
 for(const type of ['soc','energy']){
  const{h:q,a:b,args}=await planned(type);
  b.markEvSessionEnded(0,type==='soc'?'soc_target':'energy_target');await settle(q);
  assert(b.getEvSessionDetectionRuntime(0).endedLatched);
  const c=spy(b);await q.cards.get(`set_ev1_${type}_deadline`).listener(args);await settle(q);
  assert.equal(c.requests,0,'identical input must not rearm an already completed target');
  assert(b.getEvSessionDetectionRuntime(0).endedLatched);
  const changed={...args};if(type==='soc')changed.target_soc=85;else changed.energy=16;
  await q.cards.get(`set_ev1_${type}_deadline`).listener(changed);await settle(q);
  assert(c.requests>0,'a genuinely different goal can still rearm the target');
  assert(!b.getEvSessionDetectionRuntime(0).endedLatched);scenarios++;
 }
}
async function pendingAndMulti(){
 for(const type of ['soc','energy']){
  const{h,a,args}=await planned(type),origin=h.now();
  await h.grid(1123);await settle(h);
  const timer=a.evContextRefresh.timer;assert(timer);
  h.setNow(origin+5000);
  await h.cards.get(`set_ev1_${type}_deadline`).listener(args);await settle(h);
  assert.equal(a.evContextRefresh.timer,timer);assert.equal(timer.due,origin+15000);
  h.setNow(origin+15000);await settle(h);
  assert.equal(a.evContextRefresh.timer,null);scenarios++;
 }
 const h=await fixture({evs:2}),a=h.app;
 await h.cards.get('set_ev_soc_deadline_for_configured').listener({ev:{id:'2',kind:'ev',name:'two'},target_soc:85,time:'08:00',guarantee:'yes'});await settle(h);
 const one=structuredClone(a.evSocPlans[0]),two=structuredClone(a.evSocPlans[1]),c=spy(a);
 for(let n=0;n<60;n++)await h.cards.get('set_ev2_soc_deadline').listener({target_soc:85,time:'08:00',guarantee:'yes'});
 assert.deepEqual(a.evSocPlans[0],one);assert.deepEqual(a.evSocPlans[1],two);assert.equal(c.requests,0);scenarios++;
 const old=structuredClone(a.evSocPlans[1]);
 assert.equal(a.setEvSocPlan(1,101,'08:00'),false);assert.equal(a.setEvSocPlan(1,85,'24:00'),false);
 assert.deepEqual(a.evSocPlans[1],old);scenarios++;
 const version=require('../app.json').version;
 assert.equal(a.getDiagnosticsReport().version,version);assert.equal(a.getPublicStatus().version,version);scenarios++;
}
async function calendarEquivalence(){
 const h=await fixture(),a=h.app;
 function same(instant,target,zone){
  const now=typeof instant==='number'?instant:Date.parse(instant);
  const actual=()=>a.getEvSocPlanDeadlineAt(now,target,zone);
  let expected,error;try{expected=findNextLocalTime(new Date(now),target,zone).getTime();}catch(e){error=e;}
  if(error)assert.throws(actual,e=>e.name===error.name&&e.message===error.message);
  else assert(Object.is(actual(),expected),`${instant}/${target}/${zone}`);
  calendarChecks++;
 }
 // Every currently supported IANA zone, changing seconds within a UTC minute.
 for(const zone of Intl.supportedValuesOf('timeZone')){
  same('2026-10-23T10:00:00.001Z','07:00',zone);
  same('2026-10-23T10:00:59.999Z','07:00',zone);
 }
 for(const zone of ['UTC','Europe/Brussels','America/New_York','Australia/Lord_Howe','Asia/Kathmandu']){
  for(const instant of ['2026-03-28T03:00:37.123Z','2026-03-29T00:59:59.999Z','2026-03-29T01:00:00.001Z',
    '2026-10-25T00:30:00.001Z','2026-10-25T00:30:59.999Z','2026-10-25T01:30:59.999Z',
    '2026-10-23T23:59:59.999Z','2026-10-23T05:00:00.001Z','2026-10-23T05:00:59.999Z']){
    for(const target of ['02:30','07:00','00:00'])same(instant,target,zone);
  }
 }
 same('1900-01-01T10:00:27.123Z','07:00','Europe/Amsterdam');
 same('1971-01-01T10:00:27.123Z','07:00','Africa/Monrovia');
 same(NaN,'07:00','UTC');same('2026-10-23T10:00:27.123Z','07:00','Bad/Zone');
 scenarios++;
}
async function persistenceEvents(){
 for(const type of ['soc','energy']){
  const{h,a,args}=await planned(type),c=spy(a),context=a.controlContext;
  const runtime=a.cachedRuntimeSettings;
  const key=type==='soc'?'evSocDeadlineOverrides':'evEnergyDeadlineOverrides';
  await h.setExternalSetting(key,h.store.get(key));await settle(h);
  assert.equal(c.requests,0,'persisted EV state cannot schedule a duplicate context');
  assert.equal(a.controlContext,context);assert.equal(a.cachedRuntimeSettings,runtime);
  const changed={...args};if(type==='soc')changed.target_soc=85;else changed.energy=14;
  await h.cards.get(`set_ev1_${type}_deadline`).listener(changed);await settle(h);
  assert(c.requests>0,'actual goal change still requests its explicit context');scenarios++;
 }
}
async function withoutBattery(){
 for(const type of ['soc','energy']){
  const{h,a,args}=await planned(type,{batteries:0,batteryEnabled:false,type:'current',chargeAllowed:true});
  assert(a.lastPublishedEvAllowed);assert(a.lastPublishedEvCurrentA>0);
  const c=spy(a);for(let n=0;n<30;n++)await h.cards.get(`set_ev1_${type}_deadline`).listener(args);
  assert.equal(c.requests,0);assert.equal(c.writes,0);assert(a.lastPublishedEvAllowed);scenarios++;
 }
}
async function newDeadlineOccurrence(){
 for(const type of ['soc','energy']){
  const{h,a,args}=await planned(type),plan=type==='soc'?a.evSocPlans[0]:a.evEnergyPlans[0];
  a.markEvSessionEnded(0,type==='soc'?'soc_target':'energy_target');await settle(h);
  const previous=plan.targetOccurrenceAt;
  h.setNow(Math.floor(previous/60000)*60000);
  // Ordinary reads may already have rolled the displayed deadline forward.
  a.getEvInstanceSettings(0);
  const c=spy(a);await h.cards.get(`set_ev1_${type}_deadline`).listener(args);await settle(h);
  assert(c.requests>0,'a new daily deadline is a relevant goal change');
  assert(plan.targetOccurrenceAt>previous);assert(!a.getEvSessionDetectionRuntime(0).endedLatched);scenarios++;
  const n=c.requests;a.homey.clock.getTimezone=()=> 'UTC';
  await h.cards.get(`set_ev1_${type}_deadline`).listener(args);await settle(h);
  assert(c.requests>n);assert.equal(plan.targetTimezone,'UTC');scenarios++;
 }
}
async function restoredGoals(){
 for(const type of ['soc','energy']){
  const extra=type==='soc'?{evSocDeadlineOverrides:[{active:true,targetSoc:80,targetTime:'07:00',guarantee:false}]}
   :{evEnergyDeadlineOverrides:[{active:true,targetKwh:15,remainingKwh:12,targetTime:'07:00',deadlineAt:START+19*3600000,guarantee:false,sessionStarted:true}]};
  const h=await fixture({extra}),a=h.app,c=spy(a);
  const plans=structuredClone([a.evSocPlans,a.evEnergyPlans]);
  if(type==='soc')a.setEvSocPlan(0,80,'07:00','no');else a.setEvEnergyPlan(0,15,'07:00','no');
  assert.deepEqual([a.evSocPlans,a.evEnergyPlans],plans);assert.equal(c.requests,0);assert.equal(c.writes,0);
  if(type==='energy')assert.equal(a.evEnergyPlans[0].remainingKwh,12);
  scenarios++;
 }
}
async function tariffWindowReuse(){
 const file=path.join(__dirname,'../lib/flexible-loads.js');let scans=0;
 const source=fs.readFileSync(file,'utf8').replace('function countEvTariffMinutes(','function measuredCountEvTariffMinutes(')
  +'\nfunction countEvTariffMinutes(...args){windowScan();return measuredCountEvTariffMinutes(...args);}\n';
 const mod={exports:{}};
 vm.runInNewContext(source,{module:mod,exports:mod.exports,Date,require:createRequire(file),windowScan:()=>{scans++;}});
 const h=await fixture({chargeAllowed:true}),a=h.app;
 const settings={...a.getEvInstanceSettings(0),evEnergyPlanActive:true,evEnergyNeedKwh:15,
  evEnergyDeadlineAt:h.now()+3*3600000,evGuaranteeTarget:true,evAllowUnselectedTariffForDeadline:true};
 const input={settings,connected:true,soc:50,socSeen:true,socFresh:true,now:new Date(h.now()),
  tariff:{kind:'tou',className:'cheap',rateId:'test'},gridPowerW:2500};
 const first=mod.exports.calculateEvDecision(input);assert.equal(scans,1,'one shared tariff window per selected-tariff decision');
 assert(first.targetReachable);assert(first.desiredCurrentA>0);scenarios++;
 mod.exports.calculateEvDecision({...input,settings:{...settings,evEnergyNeedKwh:20}});
 assert.equal(scans,2,'another decision has an independent tariff window');scenarios++;
 const before=scans;
 mod.exports.calculateEvDecision({...input,settings:{...settings,touRates:settings.touRates.map(r=>({...r,evChargeAllowed:false}))}});
 assert.equal(scans-before,1,'the exact five-minute suffix of the guarantee window reuses the first scan');scenarios++;
}
(async()=>{try{
 await repeatedGoals();await changedAndConflictingGoals();await progressAndRecovery();await pendingAndMulti();await calendarEquivalence();await persistenceEvents();await withoutBattery();await newDeadlineOccurrence();await restoredGoals();await tariffWindowReuse();
 console.log(`1.1.15 EV planning: ${scenarios} scenarios and ${calendarChecks} exact calendar/DST comparisons passed.`);
}finally{restore();global.Date=NativeDate;}})().catch(e=>{console.error(e);process.exitCode=1;});
