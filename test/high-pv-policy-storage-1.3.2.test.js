'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const P=require('../settings/high-forecast-policy'),E=require('../lib/ems-engine'),{boot}=require('./startup-harness');
let checks=0;
(async()=>{
 for(let mask=0;mask<16;mask++){
  const legacy=Object.fromEntries(P.keys.map((k,i)=>[k,Boolean(mask&(1<<i))]));
  const store=new Map(Object.entries({...legacy,settingsSchemaVersion:71,contractType:'dynamic_hour'}));
  const h=await boot(store);assert.deepEqual(h.errors,[]);assert.deepEqual(h.app.getSettings().highForecastDynamicPolicy,legacy);
  assert.equal(Object.keys(h.app.settingsCache).length,1020);
  for(const key of P.keys)assert(!Object.hasOwn(h.app.settingsCache,key));
  const grouped=h.store.get('highForecastDynamicPolicy');
  const writes=[];const set=h.app.homey.settings.set;h.app.homey.settings.set=(k,v)=>{writes.push(k);return set(k,v)};
  await h.app.migrateSettings();assert(!writes.includes('highForecastDynamicPolicy'));assert.deepEqual(h.store.get('highForecastDynamicPolicy'),grouped);
  // A complete saved group wins over stale flat keys on a subsequent boot.
  for(const key of P.keys)h.store.set(key,!legacy[key]);
  const reopen=await boot(new Map(h.store));assert.deepEqual(reopen.app.getSettings().highForecastDynamicPolicy,legacy);assert.deepEqual(reopen.errors,[]);checks++;
 }
 assert.equal(P.normalize(null,{[P.keys[0]]:0})[P.keys[0]],false);
 assert.equal(P.normalize(null,{[P.keys[0]]:''})[P.keys[0]],false);
 checks+=2;
 const fresh=await boot(new Map());assert.deepEqual(fresh.app.getSettings().highForecastDynamicPolicy,{...P.defaults});assert.equal(Object.keys(fresh.app.settingsCache).length,1020);checks++;
 const mixed=await boot(new Map([['settingsSchemaVersion',71],['highForecastDynamicPolicy',{[P.keys[0]]:false}],[P.keys[1],false]]));
 assert.equal(mixed.app.getSettings().highForecastDynamicPolicy[P.keys[0]],false);assert.equal(mixed.app.getSettings().highForecastDynamicPolicy[P.keys[1]],false);assert.equal(mixed.app.getSettings().highForecastDynamicPolicy[P.keys[2]],true);checks++;
 // Optional complete result comparison against the exact pre-grouping 1.3.2 source.
 if(process.env.HF_POLICY_BASELINE_ROOT){
  const old=require(path.resolve(process.env.HF_POLICY_BASELINE_ROOT,'lib/ems-engine.js'));
  const slots=Array.from({length:24},(_,h)=>({time:`${String(h).padStart(2,'0')}:00`,price:h===11?.1:h===13?.6:.3}));
  for(let mask=0;mask<16;mask++)for(const type of ['dynamic_hour','dynamic_quarter'])for(const hour of [11,12,13])for(const pv of [4,20])for(const soc of [30,40,70]){
   const legacy=Object.fromEntries(P.keys.map((k,i)=>[k,Boolean(mask&(1<<i))]));
   const settings={contractType:type,batteryCount:1,totalCapacityKwh:10,expectedEnergyNeedKwh:0,peakShaveEnabled:false,cheapHours:1,expensiveHours:1,dynamicSlots:slots,lowForecastSelfConsumptionMinKwh:5,timezone:'Europe/Brussels',lowForecastDynamicCheapEnabled:true,lowForecastDynamicNormalEnabled:true,lowForecastDynamicCheapDischargeToTarget:true,lowForecastDynamicNormalDischargeToTarget:true};
   const state={gridPowerW:900,batterySoc:[soc],targetSocOverride:40,forecastDailyMaxKwh:pv,forecastRemainingKwh:20};
   const now=new Date(`2026-11-13T${hour}:00:00+01:00`);
   assert.deepEqual(E.evaluate(state,{...settings,highForecastDynamicPolicy:legacy},now),old.evaluate(state,{...settings,...legacy},now));checks++;
  }
 }
 console.log(`High-PV compact storage: ${checks} checks; 16 upgrade/restart combinations, defaults, partial migration and stale-key precedence passed.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1});
