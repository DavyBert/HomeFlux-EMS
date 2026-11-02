'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {boot}=require('./startup-harness');
const {localDateTimeUtcMs:atLocal}=require('../lib/homey-energy');
const options=require('../lib/ev-plan-options'),resources=require('../lib/ev-plan-resources');
const {EvDeadlinePlanner}=require('../lib/ev-deadline-planner');
const {calculateEvDecision}=require('../lib/flexible-loads');
const RealDate=Date,realNow=Date.now,TZ='Europe/Brussels';
let now=atLocal('2026-10-27','10:00',TZ),seq=0;
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const at=(day,time)=>atLocal(day,time,TZ),results=[];
async function check(name,fn){await fn();results.push(name);}
async function setup(extra={}){const h=await boot(new Map(Object.entries({evCount:4,evEnabled:true,ev2Enabled:true,ev3Enabled:true,ev4Enabled:true,batteryCount:0,controlEnabled:false,...extra})));h.app.requestContextEvaluate=()=>{};return h;}
const submit=(a,id,change,more={})=>a.setEvDashboard({evId:String(id),change,requestId:'multiday_request_'+(++seq),...more});
const flow=(h,id,mode)=>h.cards.get(`set_ev${id}_session_override`).listener({mode});
const create=(a,id=1,extra={})=>submit(a,id,{target:{type:'kwh',value:20},time:'07:00',guaranteed:false,...extra},{createOnly:true});
(async()=>{try{
 const h=await setup(),a=h.app;
 await check('Standard keeps nearest HH:mm, is opt-in owned only for widget input; no Max PV default',async()=>{
  await create(a);const p=a.getEvDashboard().evs[0].plan;assert.equal(p.days,0);assert.equal(p.maxPv,false);assert.equal(p.deadlineAt,at('2026-10-28','07:00'));
  assert.equal(p.owner,'widget');
 });
 await check('Days 1..7 use confirmation-day local calendar plus N, preserving HH:mm',async()=>{
  for(let d=1;d<=7;d++){await submit(a,1,{days:d});const p=options.current(a,0);assert.equal(p.deadlineAt,atLocal(require('../lib/homey-energy').shiftDateKey('2026-10-27',d),'07:00',TZ));assert.equal(p.targetTime,'07:00');}
  await submit(a,1,{days:3});assert.equal(options.current(a,0).deadlineAt,at('2026-10-30','07:00'));
 });
 await check('Widget and EMS status expose identical central date immediately, no context run needed',()=>{
  const p=a.getEvDashboard().evs[0].plan;assert.deepEqual(a.getPublicStatus().evs[0].centralPlan,p);assert(p.deadlineLabel.nl.includes('vr 30/10/2026'));
 });
 await check('Deadline/Guaranteed/Max PV patches preserve delivered kWh and newer central goal',async()=>{
  a.evEnergyPlans[0].remainingKwh=12.5;
  await submit(a,1,{guaranteed:true});await submit(a,1,{maxPv:true});
  assert.equal(a.evEnergyPlans[0].remainingKwh,12.5);assert.equal(a.evEnergyPlans[0].deadlineAt,at('2026-10-30','07:00'));
  await submit(a,1,{deadline:{dateKey:'2026-10-29',time:'12:00'}});assert.equal(a.evEnergyPlans[0].remainingKwh,12.5);
  assert.equal(a.evEnergyPlans[0].deadlineAt,at('2026-10-29','12:00'));
 });
 await check('Invalid horizon, past/invalid calendar dates and deadline beyond selected horizon preserve valid plan',async()=>{
  const before=JSON.stringify(a.evEnergyPlans);
  for(const change of [{days:8},{days:-1},{days:1.5},{maxPv:'yes'},{deadline:{dateKey:'2026-11-01',time:'07:00'}},{deadline:{dateKey:'2026-10-26',time:'07:00'}},{deadline:{dateKey:'2026-10-32',time:'07:00'}}])await assert.rejects(submit(a,1,change),/input/);
  assert.equal(JSON.stringify(a.evEnergyPlans),before);
 });
 await check('Midnight does not move fixed deadline or refill progress; restart preserves all options',async()=>{
  const deadline=a.evEnergyPlans[0].deadlineAt;now=at('2026-10-28','01:00');a.getEvInstanceSettings(0);
  assert.equal(a.evEnergyPlans[0].deadlineAt,deadline);assert.equal(a.evEnergyPlans[0].remainingKwh,12.5);
  a.persistEvEnergyPlanOverrides(true);const b=(await setup(Object.fromEntries(h.store))).app;
  assert.equal(b.evEnergyPlans[0].deadlineAt,deadline);assert.equal(b.evEnergyPlans[0].remainingKwh,12.5);assert(b.evEnergyPlans[0].guarantee);assert(b.evEnergyPlans[0].widgetPlan.maxPv);
 });
 await check('Unknown/null connection and a pause do not end widget plan; feedback display never becomes physical evidence',async()=>{
  a.updateEvStatusInput(0,true,10,now);a.getEvSessionDetectionRuntime(0).state='paused';options.capture(a,0,now,true);
  const b=(await setup(Object.fromEntries(h.store))).app;
  assert.equal(b.getEvInputSnapshot(0).seen.connected,false);assert.equal(b.getEvMeasuredCurrent(0).fresh,false);
  const ev=b.getEvDashboard().evs[0];assert.equal(ev.connected,true);assert.equal(ev.state,'paused');assert(ev.feedbackStale);assert.equal(b.getPublicStatus().evs[0].lastKnownFeedback.state,'paused');
  b.updateEvStatusInput(0,undefined,undefined,now);b.updateEvStatusInput(0,null,undefined,now);assert(options.widget(b,0));
 });
 await check('Connected widget goal defers latest ordinary Flow mode before state/output/context mutation',async()=>{
  now+=1000;a.updateEvStatusInput(0,true,0,now);
  const override=JSON.stringify(a.getEvSessionOverrideFor(0));let contexts=0;const original=a.requestContextEvaluate;a.requestContextEvaluate=()=>contexts++;
  const force=a.forceEvOutput;
  await flow(h,1,'emergency');await flow(h,1,'soc_target');
  assert.equal(contexts,0);assert.equal(a.forceEvOutput,force);assert.equal(JSON.stringify(a.getEvSessionOverrideFor(0)),override);
  assert.equal(a.getEffectiveEvModeFor(0),'smart');assert.equal(options.runtime(a)[0].resumeMode.mode,'soc_target');assert(a.getEvDashboard().evs[0].flowDeferred);
  a.requestContextEvaluate=original;
 });
 await check('Clear resumes exactly latest saved ordinary Flow override via existing handler; other EV unaffected',async()=>{
  await create(a,2);a.updateEvStatusInput(1,true,0,now);await flow(h,2,'emergency');
  await submit(a,1,{clear:true});assert.equal(options.current(a,0),null);assert.equal(a.getEffectiveEvModeFor(0),'soc_target');
  assert(options.widget(a,1));assert.equal(a.getEffectiveEvModeFor(1),'smart');
 });
 await check('Confirmed disconnect ends only widget plan and resumes latest Flow; first false after restart also ends it',async()=>{
  a.updateEvStatusInput(1,false,0,now);assert.equal(options.current(a,1),null);assert.equal(a.getEffectiveEvModeFor(1),'emergency');
  await create(a,3);a.updateEvStatusInput(2,true,0,now);await flow(h,3,'soc_target');
  const b=(await setup(Object.fromEntries(h.store))).app;b.updateEvStatusInput(2,false,0,now);
  assert.equal(options.current(b,2),null);assert.equal(b.getEffectiveEvModeFor(2),'soc_target');
 });
 await check('Legacy Flow-created plans retain old disconnect/reconnect and ordinary mode precedence',async()=>{
  await h.cards.get('set_ev4_energy_deadline').listener({energy:10,time:'07:00',guarantee:'no'});
  a.updateEvStatusInput(3,true,0,now);await flow(h,4,'emergency');assert.equal(a.getEffectiveEvModeFor(3),'emergency');
  a.evEnergyPlans[3].remainingKwh=4;a.updateEvStatusInput(3,false,0,now);assert(a.evEnergyPlans[3].active);assert(!a.evEnergyPlans[3].widgetPlan);
  a.updateEvStatusInput(3,true,0,now);assert.equal(a.evEnergyPlans[3].remainingKwh,10);
 });
 await check('Explicit Flow planning cards can replace widget plan; old stale widget patch preserves new Flow target',async()=>{
  await create(a,1);a.updateEvStatusInput(0,true,0,now);await flow(h,1,'smart');
  await h.cards.get('set_ev1_soc_deadline').listener({target_soc:90,time:'17:00',guarantee:'yes'});
  assert.equal(options.widget(a,0),null);assert.equal(a.evSocPlans[0].targetSoc,90);
  await submit(a,1,{time:'12:00'});assert.equal(a.evSocPlans[0].targetSoc,90);assert(a.evSocPlans[0].guarantee);
 });
 await check('Completion stays protected/visible after restart and forbids further charging; clear resumes Flow',async()=>{
  await submit(a,1,{target:{type:'kwh',value:0}});a.updateEvStatusInput(0,true,0,now);
  a.markEvSessionEnded(0,'energy_target',now);await flow(h,1,'emergency');
  assert(options.widget(a,0).completed);const b=(await setup(Object.fromEntries(h.store))).app;
  const settings=b.getEvInstanceSettings(0);const d=calculateEvDecision({settings,connected:true,soc:50,now:new Date(now)});
  assert.equal(d.allowed,false);assert.equal(d.desiredPowerW,0);assert.equal(d.targetCompleted,'energy_target');assert.equal(b.getEvDashboard().evs[0].plan.completed,true);
  b.clearEvSocPlan(0);assert.equal(b.getEffectiveEvModeFor(0),'emergency');
 });
 await check('Expired absolute deadline survives restart and produces STOP, never a new tomorrow goal',async()=>{
  await submit(a,2,{target:{type:'kwh',value:10},time:'07:00',days:1},{createOnly:true});
  const deadline=a.evEnergyPlans[1].deadlineAt;now=deadline+60000;
  const b=(await setup(Object.fromEntries(h.store))).app,settings=b.getEvInstanceSettings(1);
  assert.equal(b.evEnergyPlans[1].deadlineAt,deadline);const d=calculateEvDecision({settings,connected:true,soc:50,now:new Date(now)});
  assert.equal(d.allowed,false);assert.equal(d.targetReachable,false);assert.equal(d.deadlineAt,deadline);assert(b.getEvDashboard().evs[1].plan.expired);
 });
 await check('Local calendar handles 23h/25h DST days and rejects nonexistent local wall time',async()=>{
  const b=(await setup()).app;now=at('2027-03-27','10:00');await create(b,1,{days:1});assert.equal(b.evEnergyPlans[0].deadlineAt,at('2027-03-28','07:00'));
  await assert.rejects(submit(b,1,{deadline:{dateKey:'2027-03-28',time:'02:30'}}),/input/);
  now=at('2026-10-24','10:00');await submit(b,1,{days:1});assert.equal(b.evEnergyPlans[0].deadlineAt,at('2026-10-25','07:00'));
 });
 await check('PV resources reserve house and battery once; two EVs share remaining forecast without duplication',async()=>{
  now=at('2026-10-27','10:00');const x=await setup({evEnabled:true,ev2Enabled:true,ev3Enabled:false,ev4Enabled:false,expectedEnergyNeedKwh:0,batteryCount:1,totalCapacityKwh:10,maxSoc:100});const b=x.app;
  b.state.batterySoc=[50];b.inputSeen.forecast=true;b.state.forecastDailyMaxDate='2026-10-27';b.state.forecastRemainingKwh=20;
  await create(b,1,{days:2,maxPv:true});await create(b,2,{days:2,maxPv:true});
  const budget=resources.pvCredits(b,now);assert.equal(budget.credits.reduce((n,v)=>n+v,0),15);assert.equal(budget.credits[0],15);assert.equal(budget.credits[1],0);
  assert.strictEqual(resources.pvCredits(b,now),budget);
  b.state.forecastRemainingKwh=8;assert.equal(resources.pvCredits(b,now).credits.reduce((n,v)=>n+v,0),3);
 });
 await check('No intraday forecast profile: a full day total is never credited before morning/noon deadline',async()=>{
  const x=await setup({evEnabled:true,expectedEnergyNeedKwh:0}),b=x.app;b.inputSeen.forecast=true;b.state.forecastDailyMaxDate='2026-10-27';b.state.forecastRemainingKwh=50;
  await create(b,1,{time:'17:00',maxPv:true});assert.equal(resources.pvCredits(b,now).credits[0],0);
  b.inputSeen.forecast=false;b.state.forecastRemainingKwh=null;assert.equal(resources.pvCredits(b,now).credits[0],0);
 });
 await check('Max PV reduces planned grid deficit; Guaranteed latest safe start is based on FULL goal',()=>{
  const planner=new EvDeadlinePlanner(),deadline=now+4*3600000,curve={intervals:[{startAt:now,endAt:deadline,price:.2}],fingerprint:'test'};
  const args={index:0,now,curve,deadlineAt:deadline,needKwh:10,powerW:5000,maxPowerW:5000,limitsW:{cheap:5000,normal:5000,expensive:5000},cheap:true,normal:false,expensive:false,cheapHours:1,expensiveHours:1,guarantee:true};
  const p=planner.evaluate({...args,pvCreditKwh:10});assert.equal(p.slots.length,0);assert.equal(p.selectedNow,false);assert.equal(p.guaranteeNow,false);
  const urgent=planner.evaluate({...args,pvCreditKwh:10,now:deadline-2*3600000});assert(urgent.guaranteeNow);
  const deficit=planner.evaluate({...args,pvCreditKwh:4});assert(Math.abs(deficit.slots.reduce((n,s)=>n+s.kwh,0)-6)<1e-8);
  const dropped=planner.evaluate({...args,pvCreditKwh:0});assert(Math.abs(dropped.slots.reduce((n,s)=>n+s.kwh,0)-10)<1e-8);
 });
 await check('Configured fixed/TOU multi-day curves use real tariff transitions/prices and configured permissions',async()=>{
  const x=await setup({contractType:'fixed',evEnabled:true,evFixedChargeWindowEnabled:true,fixedChargeWindowStart:'01:07',fixedChargeWindowEnd:'07:13'}),b=x.app;
  let settings=b.getEvInstanceSettings(0),curve=resources.configuredCurve(b,0,settings,now);
  assert(curve.intervals.length>8);assert(curve.intervals.some(s=>s.allowed));assert(curve.intervals.some(s=>new Date(s.startAt).getTime()===at('2026-10-28','01:07')));assert.strictEqual(resources.configuredCurve(b,0,settings,now),curve);
  await x.setExternalSetting('contractType','tou');await x.setExternalSetting('touRates',[{id:'cheap',name:'Cheap',importPrice:.1,evChargeAllowed:true,evMaxGridImportW:6000},{id:'high',name:'High',importPrice:.4,evChargeAllowed:false,evMaxGridImportW:7000}]);await x.setExternalSetting('touSchedule',[{rateId:'cheap',start:'00:00',end:'06:17',days:[1,2,3,4,5,6,7]},{rateId:'high',start:'06:17',end:'00:00',days:[1,2,3,4,5,6,7]}]);
  settings=b.getEvInstanceSettings(0);curve=resources.configuredCurve(b,0,settings,now);assert(curve.intervals.some(s=>s.rateId==='cheap'&&s.allowed&&s.price===.1));assert(curve.intervals.some(s=>s.rateId==='high'&&!s.allowed&&s.price===.4));
 });
 await check('Max PV without Guaranteed never widens cheap permission to expensive dynamic/TOU slots',()=>{
  const planner=new EvDeadlinePlanner(),end=now+4*3600000;
  const curve={intervals:Array.from({length:4},(_,i)=>({startAt:now+i*3600000,endAt:now+(i+1)*3600000,price:[.1,.2,.4,.5][i]}))};
  const args={index:0,now,curve,deadlineAt:end,needKwh:6,powerW:2000,maxPowerW:2000,limitsW:{cheap:2000,normal:2000,expensive:2000},cheap:true,normal:false,expensive:true,cheapHours:1,expensiveHours:2,guarantee:false,excludeExpensive:true};
  const p=planner.evaluate(args);assert.equal(p.slots.length,1);assert.equal(p.slots[0].price,.1);assert(p.missingKwh>0);
  const configured={intervals:curve.intervals.map((s,i)=>({...s,className:i===0?'cheap':'expensive',rateId:String(i),allowed:true}))};
  const q=new EvDeadlinePlanner().evaluate({...args,curve:configured,rateLimitsW:{0:2000,1:2000,2:2000,3:2000}});assert.equal(q.slots.length,1);assert.equal(q.slots[0].price,.1);
 });
 await check('Explicit safety/session-end feedback still stops during a widget plan and is never deferred',async()=>{
  const x=await setup(),b=x.app;await create(b);b.updateEvStatusInput(0,true,10,now);
  const result=await x.cards.get('end_ev1_charging_session').listener({});assert.equal(result,true);assert(b.getEvSessionDetectionRuntime(0).endedLatched);assert(options.widget(b,0));
 });
 await check('Unknown competing EV need blocks forecast credit, not the existing planner or live PV path',async()=>{
  const x=await setup({expectedEnergyNeedKwh:0}),b=x.app;b.inputSeen.forecast=true;b.state.forecastDailyMaxDate='2026-10-27';b.state.forecastRemainingKwh=50;
  await create(b,1,{days:2,maxPv:true});await x.cards.get('set_ev2_soc_deadline').listener({target_soc:90,time:'07:00',guarantee:'no'});
  assert.equal(resources.pvCredits(b,now).credits.reduce((n,v)=>n+v,0),0);
 });
 await check('Tomorrow forecast reserves possible battery refill again; completed EV does not reserve PV',async()=>{
  const x=await setup({expectedEnergyNeedKwh:0,batteryCount:1,totalCapacityKwh:10,maxSoc:100}),b=x.app;
  b.state.batterySoc=[100];b.inputSeen.forecastTomorrow=true;b.state.forecastTomorrowDate='2026-10-28';b.state.forecastTomorrowKwh=15;
  await create(b,1,{days:3,maxPv:true});assert.equal(resources.pvCredits(b,now).credits[0],5);
  options.complete(b,0,'energy_target');b.evMaxPvBudget=null;assert.equal(resources.pvCredits(b,now).credits[0],0);
 });
 await check('An entirely unpublished dynamic horizon stays provisional with zero cheap slots and retains safe start',async()=>{
  const x=await setup({contractType:'dynamic_quarter',dynamicPriceSource:'external',dynamicPriceSources:['external'],peakShaveEnabled:false,evDynamicCheapMaxGridImportW:40000}),b=x.app;
  await create(b,1,{days:3,maxPv:true});b.updateEvStatusInput(0,true,0,now);
  const input={settings:b.getEvInstanceSettings(0),now:new Date(now),gridPowerW:623,currentBatteryCommandW:0};
  const target={deadlineAt:b.evEnergyPlans[0].deadlineAt,energyNeedKwh:20,maxPowerW:11000,minPowerW:4000,standardPowerW:11000,guarantee:true};
  const p=b.planEvDeadline(0,input,target);assert(p);assert.equal(p.knownMinutes,0);assert.equal(p.selectedNow,false);assert.equal(p.slots.length,0);assert(p.provisional);
  const q=b.planEvDeadline(0,input,{...target,deadlineAt:now+3600000});assert(q.guaranteeNow);assert.equal(q.slots.length,0);
 });
 await check('Partial dynamic curves never invent future prices; future cheapest quarter remains selectable',()=>{
  const end=now+7*86400000,planner=new EvDeadlinePlanner(),curve={intervals:[{startAt:now,endAt:now+900000,price:.5},{startAt:now+86400000,endAt:now+86400000+900000,price:.05}]};
  const p=planner.evaluate({index:0,now,curve,deadlineAt:end,needKwh:1,powerW:4000,maxPowerW:4000,limitsW:{cheap:4000,normal:0,expensive:0},cheap:true,normal:false,expensive:false,cheapHours:.25,expensiveHours:.25,guarantee:false});
  assert.equal(p.selectedNow,false);assert.equal(p.slots[0].startAt,now+86400000);assert.equal(p.knownMinutes,30);assert.equal(p.slots.length,1);
 });
 fs.writeFileSync(path.join(__dirname,'../validation/ev-multiday-1.2.4.json'),JSON.stringify({simulatedHomey:true,physicalHomeyTested:false,passed:results.length,results},null,2)+'\n');console.log('EV multi-day: '+results.length+' production-function scenario groups passed');
 }finally{global.Date=RealDate;Date.now=realNow;}
})().catch(e=>{console.error('FAILED after',results.length,results.at(-1),e);process.exitCode=1;});
