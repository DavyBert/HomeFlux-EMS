'use strict';
const assert=require('node:assert/strict');
const {boot}=require('./startup-harness'),options=require('../lib/ev-plan-options');
const {localDateTimeUtcMs:at,shiftDateKey}=require('../lib/homey-energy');
const {create}=require('../widgets/ev/public/controller');
const RealDate=Date;let zone='Europe/Brussels',now=at('2026-11-06','10:00',zone),sequence=0,checks=0;
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const submit=(a,change,extra={})=>a.setEvDashboard({evId:'1',change,requestId:'calendar_request_'+(++sequence),...extra});
async function setup(store={}){
 const h=await boot(new Map(Object.entries({evCount:1,evEnabled:true,evSocEnabled:true,batteryCount:0,controlEnabled:false,...store})));
 h.app.homey.clock.getTimezone=()=>zone;h.app.requestContextEvaluate=()=>{};return h;
}
(async()=>{try{
 const h=await setup(),a=h.app;
 await submit(a,{target:{type:'soc',value:80},time:'07:00'},{createOnly:true});
 for(let days=1;days<=7;days++){
  await submit(a,{days});const p=a.getEvDashboard().evs[0].plan;
  assert.equal(p.days,days);assert(!p.manualDate);assert.equal(p.deadlineAt,at(shiftDateKey('2026-11-06',days),'07:00',zone));checks++;
 }
 await assert.rejects(submit(a,{days:8}),/input/);checks++;
 for(const days of [3,10,14,30]){
  const dateKey=shiftDateKey('2026-11-06',days);
  const saved=await submit(a,{deadline:{dateKey,time:'17:00'}});
  assert(saved.accepted);assert.equal(saved.plan.deadlineAt,at(dateKey,'17:00',zone));assert(saved.plan.manualDate);assert.equal(saved.plan.days,0);
  assert.equal(h.store.get('evSocDeadlineOverrides')[0].deadlineAt,saved.plan.deadlineAt);
  assert.deepEqual(a.getPublicStatus().evs[0].centralPlan,saved.plan);checks++;
 }
 await submit(a,{time:'12:00'});assert.equal(options.current(a,0).deadlineAt,at('2026-12-06','12:00',zone));checks++;
 await submit(a,{days:3});assert.equal(options.current(a,0).deadlineAt,at('2026-11-09','12:00',zone));assert(!options.widget(a,0).manualDate);checks++;
 await submit(a,{deadline:{dateKey:'2026-12-06',time:'12:00'}});
 const restart=await setup(Object.fromEntries(h.store));assert.equal(restart.app.getEvDashboard().evs[0].plan.deadlineAt,at('2026-12-06','12:00',zone));
 now=at('2026-11-11','10:00',zone);restart.app.getEvInstanceSettings(0);assert.equal(options.current(restart.app,0).deadlineAt,at('2026-12-06','12:00',zone));checks++;
 const before=JSON.stringify(a.evSocPlans);
 for(const dateKey of ['2026-11-01','2026-02-30','2026-11-31','not-a-date'])await assert.rejects(submit(a,{deadline:{dateKey,time:'12:00'}}),/schedule/);
 assert.equal(JSON.stringify(a.evSocPlans),before);checks++;
 // Existing SoC/kWh plan storage remains central; changing a date never refills
 // already delivered kWh or modifies Guaranteed.
 await submit(a,{clear:true});
 await submit(a,{target:{type:'kwh',value:20},deadline:{dateKey:'2026-12-06',time:'07:00'},guaranteed:true},{createOnly:true});
 a.evEnergyPlans[0].remainingKwh=12.5;
 await submit(a,{deadline:{dateKey:'2026-12-10',time:'12:00'}});
 assert.equal(a.evEnergyPlans[0].remainingKwh,12.5);assert(a.evEnergyPlans[0].guarantee);checks++;
 // A thrown or silently ignored storage write cannot become a successful
 // calendar confirmation, nor replace the previous central/persisted goal.
 for(const silent of [false,true]){
  const previous=JSON.stringify(options.current(a,0)),stored=JSON.stringify(h.store.get('evEnergyDeadlineOverrides'));
  const write=a.homey.settings.set;
  a.homey.settings.set=(key,value)=>{if(key==='evEnergyDeadlineOverrides'){if(silent)return;throw Error('injected storage failure');}return write(key,value);};
  await assert.rejects(submit(a,{deadline:{dateKey:'2026-12-12',time:'17:00'}}),/save/);
  a.homey.settings.set=write;
  assert.equal(JSON.stringify(options.current(a,0)),previous);assert.equal(JSON.stringify(h.store.get('evEnergyDeadlineOverrides')),stored);checks++;
 }
 // A failed delayed acknowledgement must never roll back a newer valid goal.
 {
  const key='set_ev1_energy_deadline',original=a.slotFlowCards.actions.get(key);let reject;
  a.slotFlowCards.actions.set(key,args=>{original(args);return new Promise((_resolve,fail)=>{reject=fail;});});
  const older=submit(a,{deadline:{dateKey:'2026-12-20',time:'07:00'}});
  a.slotFlowCards.actions.set(key,original);
  await submit(a,{deadline:{dateKey:'2026-12-22',time:'17:00'}});reject(Error('late failed acknowledgement'));
  await assert.rejects(older,/save/);assert.equal(a.getEvDashboard().evs[0].plan.deadlineLabel.dateKey,'2026-12-22');checks++;
 }
 const listener=a.slotFlowCards.actions.get('set_ev1_energy_deadline');let writes=0;
 a.slotFlowCards.actions.set('set_ev1_energy_deadline',args=>{writes++;return listener(args);});
 const body={evId:'1',requestId:'calendar_same_request_id',change:{deadline:{dateKey:'2026-12-14',time:'07:00'}}};
 await Promise.all([a.setEvDashboard(body),a.setEvDashboard(body)]);assert.equal(writes,1);checks++;
 // The same local calendar string is converted by Homey's timezone, never by
 // the browser/host timezone. Missing spring times are rejected by round-trip.
 for(const [date,time,expected] of [['2026-11-12','00:15','2026-11-11T23:15:00Z'],['2027-03-28','07:00','2027-03-28T05:00:00Z'],['2026-10-25','07:00','2026-10-25T06:00:00Z']]){
  now=at(shiftDateKey(date,-1),'23:55',zone);await submit(a,{deadline:{dateKey:date,time}});
  assert.equal(options.current(a,0).deadlineAt,RealDate.parse(expected));checks++;
 }
 now=at('2027-03-27','12:00',zone);await assert.rejects(submit(a,{deadline:{dateKey:'2027-03-28',time:'02:30'}}),/schedule/);checks++;
 now=at('2026-11-06','23:59',zone);await submit(a,{deadline:{dateKey:'2026-11-07',time:'00:15'}});assert.equal(options.current(a,0).deadlineAt,RealDate.parse('2026-11-06T23:15:00Z'));checks++;
 // Farther dates enter the same bounded rolling planner; no calendar-sized
 // price/PV data or extra evaluation schedule is generated.
 now=at('2026-11-06','10:00',zone);
 const p=await setup({contractType:'tou',touRates:[{id:'all',name:'All',importPrice:.2,evChargeAllowed:true,evMaxGridImportW:20000}],touSchedule:[{rateId:'all',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]}],peakShaveEnabled:false});
 await p.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});
 for(const days of [14,30]){
  if(options.current(p.app,0))await submit(p.app,{clear:true});
  await submit(p.app,{target:{type:'kwh',value:20},deadline:{dateKey:shiftDateKey('2026-11-06',days),time:'17:00'}},{createOnly:true});
  const settings=p.app.getEvInstanceSettings(0),deadlineAt=options.current(p.app,0).deadlineAt;
  const target={deadlineAt,energyNeedKwh:20,minPowerW:1380,guarantee:false};
  const planned=p.app.planEvDeadline(0,{settings,now:new Date(now),gridPowerW:0,currentBatteryCommandW:0},target);
  assert(planned);assert(planned.provisional);assert.equal(settings.evEnergyDeadlineAt,deadlineAt);
  assert(p.app.evConfiguredDeadlineCurves[0].curve.intervals.length<=1200);checks++;
 }
 // Controller: direct calendar creation needs a goal and deadline.time, not a
 // redundant preset time; a missing/wrong saved-plan acknowledgement fails.
 let sent=0;const date='2026-12-06',savedPlan={type:'soc',value:80,time:'17:00',deadlineLabel:{dateKey:date}};
 const c=create({nonce:()=> 'calendar_nonce',send:async()=>{sent++;return{accepted:true,plan:savedPlan};}});c.select('1');c.update(null);
 await c.tap('goal',{target:{type:'soc',value:80}});await c.tap('goal',{target:{type:'soc',value:80}});
 assert.equal(sent,0);await c.tap('deadline',{deadline:{dateKey:date,time:'17:00'}});assert((await c.tap('deadline',{deadline:{dateKey:date,time:'17:00'}})).success);assert.equal(sent,1);checks++;
 const bad=create({send:async()=>({accepted:true,plan:{...savedPlan,time:'12:00'}})});bad.select('1');bad.update(savedPlan);
 await bad.tap('deadline',{deadline:{dateKey:date,time:'17:00'}});await assert.rejects(bad.tap('deadline',{deadline:{dateKey:date,time:'17:00'}}),/save/);checks++;
 console.log(`EV calendar 1.2.32: ${checks} central storage, controller, local-time/DST and rolling-planner checks passed.`);
}finally{global.Date=RealDate;}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
