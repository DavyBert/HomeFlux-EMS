'use strict';
const assert = require('node:assert/strict');
const engine = require('../lib/ems-engine');
const originalBuild = engine.buildSocPlan;
let builds = 0, depth = 0, lastBuild = null;
engine.buildSocPlan = (...args) => {
  assert(depth > 0, 'An automatic plan was calculated outside the slow context pass');
  builds++;
  lastBuild = { state: structuredClone(args[0]), settings: structuredClone(args[1]) };
  return originalBuild(...args);
};
const { boot } = require('./startup-harness');
const App = require('../app');
const originalContext = App.prototype.evaluateContextNow;
App.prototype.evaluateContextNow = function(...args) {
  depth++;
  try { return originalContext.apply(this,args); } finally { depth--; }
};
const api = require('../api');
const realNow = Date.now;
let now = Date.parse('2026-09-28T19:00:00Z');
Date.now = () => now;
const drain = async () => { for (let i=0;i<60;i++) await Promise.resolve(); };
async function setup(slow = 60, planning = 5) {
  const h = await boot(new Map(Object.entries({batteryCount:1,totalCapacityKwh:10,
    controlEnabled:false,contractType:'fixed',slowControlIntervalSeconds:slow,
    planningMinIntervalMinutes:planning,evCount:0,hvacCount:0,boilerCount:0})));
  const {app}=h;
  app.queueStatusUpdate=()=>{};
  app.triggerCalculatedSetpoint=async()=>{};
  app.publishFlexibleLoads=async()=>{};
  app.publishPvPowerLimit=async()=>{};
  app.queueCommandEmit=()=>false;
  app.requestEvaluate=()=>{}; // keep sensor-input tests focused on the slow scheduler
  app.clearContextTimer();
  app.homey.setTimeout=(fn,ms)=>({fn,ms});
  app.state.batterySoc=[50];app.inputSeen.batterySoc[0]=true;
  app.state.gridPowerW=0;app.state.pvPowerW=0;
  app.invalidatePlanningCache(true);
  await app.runContextEvaluation();await drain();
  assert.deepEqual(h.errors,[]);
  return h;
}
async function fireContext(app) {
  const timer=app.contextTimer;
  assert(timer && typeof timer.fn==='function','Expected the shared context timer');
  now=app.contextTimerAt;
  timer.fn();await drain();
}
(async()=>{
 const {app,cards,errors}=await setup();
 const first=app.getPlanningStatus(), initialBuilds=builds, firstAt=now;
 let publishes=0; app.chargePlanTrigger={trigger:async()=>{publishes++;}};
 app.lastChargePlanSignature=null;
 now+=1000;
 await cards.get('set_battery_soc').listener({battery:'1',soc:49});
 await cards.get('set_forecast_remaining').listener({energy:5});
 await cards.get('set_forecast_tomorrow').listener({energy:8});
 await cards.get('set_external_electricity_price').listener({price:0.2});
 assert.equal(builds,initialBuilds,'Inputs must not calculate directly');
 assert.equal(app.contextTimerAt,firstAt+60000,'Inputs share the slow deadline');
 for(let i=0;i<100;i++) await cards.get('set_battery_soc').listener({battery:'1',soc:49+i/1000});
 assert.equal(builds,initialBuilds,'A SoC burst cannot rebuild planning');
 assert.equal(app.contextTimerAt,firstAt+60000,'A SoC burst cannot move the shared deadline');
 for(let i=0;i<100;i++) { app.getPlanningStatus();app.getCompactChargePlanDeviceStatus();await api.getPlanning({homey:{app}}); }
 assert.equal(builds,initialBuilds,'Status/device/API reads cannot calculate');
 assert.equal(app.getPlanningStatus(),first);
 await fireContext(app);
 assert.equal(builds,initialBuilds,'First slow pass still respects planning minimum');
 assert.equal(app.contextTimerAt,firstAt+300000,'Pending plan uses shared timer without new inputs');
 now+=1000;
 await cards.get('set_battery_soc').listener({battery:'1',soc:48});
 assert.equal(app.planningCache.nextAllowedAt,firstAt+300000,'New input must not debounce planning deadline');
 await fireContext(app); // ordinary context at t+120 s
 assert.equal(builds,initialBuilds);
 await fireContext(app); // pending plan at t+300 s
 assert.equal(builds,initialBuilds+1);
 assert.equal(app.getPlanningStatus().currentSoc,48);
 assert.equal(lastBuild.state.forecastTomorrowKwh,8,'Planner uses newest context inputs');
 assert.equal(app.planningCache.dirty,false);
 assert.equal(app.contextTimer,null,'No independent recurring planner loop');
 assert(!('timer' in app.planningCache));
 assert(publishes>0,'Night plan publication follows context');
 const after=builds;const count=publishes;
 await app.runContextEvaluation();await drain();
 assert.equal(builds,after);assert.equal(publishes,count,'Unchanged plan does not republish');
 now+=1000;
 const manual=await api.refreshPlanning({homey:{app}});
 assert.equal(builds,after+1,'Manual refresh forces exactly one context-owned plan');
 assert.equal(manual.currentSoc,app.getPlanningStatus().currentSoc);
 // Fast control must never build a plan, even when dirty and overdue.
 app.invalidatePlanningCache();now+=301000;
 const beforeFast=builds;
 app.evaluateFastNow();
 assert.equal(builds,beforeFast);
 assert.deepEqual(errors,[]);

 // With a slower context interval than planning interval, context remains the lower bound.
 const h=await setup(300,1); const b=h.app; const at=now, n=builds;
 now+=1000; b.invalidatePlanningCache();b.requestContextEvaluate(false,'forecast');
 assert.equal(b.contextTimerAt,at+300000);
 now=at+60000;
 await b.runContextEvaluation(true); // urgent safety context, not a structural plan reset
 assert.equal(builds,n,'An urgent context pass cannot exceed the ordinary planning cadence');
 await fireContext(b);assert.equal(builds,n+1);

 // Day/night changes bypass the planning block through the same context path.
 const day=await setup(); const d=day.app;
 now=Date.parse('2026-09-28T12:00:00Z');
 d.state.nightPlanningActive=false; d.state.nightPlanningStartedDate='';
 await d.refreshChargePlanning();const beforeNight=builds;
 now+=1000;d.activateNightPlanning('test');await drain();
 assert.equal(builds,beforeNight+1);
 assert.equal(lastBuild.state.planningForecastDay,'tomorrow');
 // Local midnight switches the forecast day even without a meter update.
 now=Date.parse('2026-09-28T21:59:30Z');
 await d.refreshChargePlanning(); const beforeMidnight=builds;
 now=Date.parse('2026-09-28T22:00:01Z');d.runContextHeartbeat();await drain();
 assert.equal(builds,beforeMidnight+1);
 assert.equal(lastBuild.state.planningForecastDay,'today');
 assert.equal(d.planningCache.phaseKey.split('|')[0],'2026-09-29');
 // Battery pause cannot block planning and cannot be lifted by planning.
 const pauseResult={paused:true};d.getPausedEvaluationResult=()=>pauseResult;
 const beforePause=builds;await d.refreshChargePlanning();
 assert.equal(builds,beforePause+1);
 assert.equal(d.evaluateContextNow(),pauseResult);
 assert.deepEqual(day.errors,[]);assert.deepEqual(h.errors,[]);
 const savedRefresh=d.refreshPlanningInContext;
 d.refreshPlanningInContext=()=>{throw new Error('synthetic plan failure');};
 assert.equal(d.evaluateContextNow(),pauseResult,'Planner failure must not block battery pause/safety evaluation');
 assert(day.errors.some(e=>e.includes('synthetic plan failure')));
 d.refreshPlanningInContext=savedRefresh;
 console.log('0.9.7: context-only planning, input coalescing, throttle, shared deadline, read-only status, manual refresh, phase/midnight, publication, pause and fast-loop isolation passed');
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(()=>{Date.now=realNow;engine.buildSocPlan=originalBuild;App.prototype.evaluateContextNow=originalContext;});
