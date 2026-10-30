'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const engine=require('../lib/ems-engine'),{boot,DEFAULTS}=require('./startup-harness');
const reference=process.env.HEMS_BATTERY_BASELINE_ROOT
 ? require(path.resolve(process.env.HEMS_BATTERY_BASELINE_ROOT,'lib/ems-engine')):null;

(async()=>{
 let scenarios=0;
 for(const contractType of ['fixed','tou','dynamic_hour','dynamic_quarter'])for(const hour of [0,6,12,17])for(const grid of [-3000,500,4000]) {
  const now=new Date(Date.UTC(2026,9,30,hour)),settings={...DEFAULTS,contractType,timezone:'Europe/Brussels',batteryCount:2,totalCapacityKwh:10,peakLimitW:3000};
  const state={gridPowerW:grid,pvPowerW:grid<0?4500:500,batterySoc:[35,70],forecastRemainingKwh:8,forecastDailyMaxKwh:12,forecastTomorrowKwh:6,lastBatteryCommands:[0,0],nightPlanningActive:hour<7};
  const expectedContext=(reference||engine).prepareControlContext(state,settings,now);
  const expected=(reference||engine).evaluate(state,settings,now,expectedContext);
  const expectedPlan=(reference||engine).buildSocPlan(state,settings,now);
  let reads=0;
  for(const key of Object.keys(settings))if(key.startsWith('hvac'))Object.defineProperty(settings,key,{enumerable:true,configurable:true,get(){reads++;throw Error('Battery calculation read HVAC setting '+key);}});
  const context=engine.prepareControlContext(state,settings,now);
  assert.deepEqual(context,expectedContext);assert.deepEqual(engine.evaluate(state,settings,now,context),expected);
  assert.deepEqual(engine.buildSocPlan(state,settings,now),expectedPlan);assert.equal(reads,0);scenarios++;
 }
 const partial={batteryCount:1,contractType:'fixed',timezone:'Europe/Brussels'};
 if(reference)assert.deepEqual(engine.evaluate({},partial,new Date('2026-10-30T12:00:00Z')),reference.evaluate({},partial,new Date('2026-10-30T12:00:00Z')),'partial settings retain battery defaults');

 // Block the existing upgrade pause: no battery context may run before all
 // missing settings have been initialized. No production timer is changed.
 const saved=new Map(Object.entries(DEFAULTS).filter(([k])=>!/^hvac(?:[5-9]|10)[A-Z]/.test(k)));
 saved.set('settingsSchemaVersion',71);saved.set('hvacCount',10);saved.set('hvac5Name','Keep channel 5');
 const cop={source:'outdoor',heatingBelowC:16,coolingAboveC:25,tariffCop:{expensive:{outsideBelowC:6,targetC:55}}};
 saved.set('hvac5DirectionTemperature',cop);
 let release,paused,contextCalls=0,upgradeComplete=false;
 const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{paused=resolve;});
 const pending=boot(saved,({app})=>{
  app.pauseHvacSettingsMigration=async()=>{paused();await gate;};
  const run=app.runContextEvaluation;app.runContextEvaluation=function(...args){assert(upgradeComplete,'battery context started during settings migration');contextCalls++;return run.apply(this,args);};
  const ensure=app.ensureDefaults;app.ensureDefaults=async function(){await ensure.call(this);upgradeComplete=true;};
 });
 await entered;assert.equal(contextCalls,0);release();const h=await pending;
 assert.deepEqual(h.errors,[]);assert(contextCalls>0);assert.equal(h.app.getSettings().hvac5Name,'Keep channel 5');
 assert.deepEqual(h.app.getHvacInstanceSettings(4).hvacDirectionTemperature,cop);
 for(let i=5;i<=10;i++)assert.notEqual(h.store.get(`hvac${i}ComfortMinC`),undefined);
 console.log(`1.2.8 battery/HVAC isolation: ${scenarios} tariff/time/grid cases${reference?' match 1.2.7':''}; HVAC getters unread, partial defaults retained, upgrade barrier and saved COP settings passed.`);
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
