'use strict';
const assert=require('node:assert/strict');
const {boot}=require('./startup-harness'),learning=require('../lib/autotune-learning');
const {localDateTimeUtcMs:at}=require('../lib/homey-energy');
const RealDate=Date;let now=at('2026-11-06','01:00','Europe/Brussels'),checks=0;
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const base={batteryCount:1,batteryCapacityKwh:20,minSoc:7,safetySoc:7,maxSoc:100,slowControlIntervalSeconds:60};
async function setup(store=new Map(Object.entries(base))){
 const h=await boot(store),a=h.app;
 for(const key of ['notifyEvDashboard','refreshBatteryChargeSourcePresentation','scheduleAutoTuneContextIfDue','recordSavingsSample','persistSavingsState'])a[key]=()=>{};
 a.syncEmsDevices=async()=>{};return h;
}
function fresh(h){const a=h.app;a.state.gridPowerW=300;a.state.pvPowerW=0;a.state.lastTotalCommandW=0;a.state.batterySoc[0]=50;a.inputSeen.grid=true;a.inputSeen.pv=true;a.inputSeen.batterySoc[0]=true;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;a.inputUpdatedAt.batterySoc[0]=now;a.state.forecastDailyMaxKwh=10;a.state.forecastDailyMaxDate=a.getLocalDateKey(new Date(now));}
function sample(h){fresh(h);h.app.runSlowHeartbeatHousekeeping(now,h.app.getSettings());}
function day(h){return h.app.autoTuneRuntime.planning.currentDay;}
const close=(a,b,label)=>assert(Math.abs(a-b)<1e-8,`${label}: ${a} != ${b}`);
(async()=>{try{
 let h=await setup();sample(h);const initialTimers=h.timers.length;
 for(let minute=1;minute<=60;minute++){now+=60000;sample(h);}
 assert.equal(day(h).sampleMillis,3600000);close(day(h).estimatedDemandKwh,.3,'one-hour demand');assert(day(h).reliableHours>.95);checks++;
 h.app.persistAutoTuneLearning(now,true);const snapshot=structuredClone(h.store.get('_autoTuneLearning'));
 assert(snapshot.currentDay);assert(!('previousBatteryW' in snapshot.currentDay));assert.equal(h.timers.length,initialTimers);checks++;
 const total=day(h).sampleMillis,energy=day(h).estimatedDemandKwh,reliable=day(h).reliableHours;
 now+=3600000;h=await setup(new Map(h.store));
 assert.equal(day(h).sampleMillis,total);close(day(h).estimatedDemandKwh,energy,'energy restored');close(day(h).reliableHours,reliable,'reliability restored');checks++;
 now+=60000;sample(h);assert.equal(day(h).sampleMillis,total+60000);close(day(h).estimatedDemandKwh,energy+.005,'downtime excluded');close(day(h).reliableHours,reliable,'stability re-established first');checks++;
 const before=day(h).sampleMillis,anchor=day(h).lastAt;now-=30000;fresh(h);h.app.recordAutoTunePlanningSample(now,h.app.getSettings());assert.equal(day(h).sampleMillis,before);assert.equal(day(h).lastAt,anchor);checks++;
 now=anchor+60000;sample(h);assert.equal(day(h).sampleMillis,before+60000);checks++;
 // Existing slow housekeeping saves at most every five minutes. Identical
 // aggregate totals (including observations with no valid inputs) do not write.
 let writes=0;const set=h.app.homey.settings.set;
 h.app.homey.settings.set=(key,value)=>{if(key==='_autoTuneLearning')writes++;return set(key,value);};
 h.app.persistAutoTuneLearning(now,true);writes=0;
 for(let i=1;i<=4;i++){now+=60000;sample(h);}assert.equal(writes,0);checks++;
 now+=60000;sample(h);assert.equal(writes,1);checks++;
 now+=300000;assert(!h.app.persistAutoTuneLearning(now));assert.equal(writes,1);checks++;
 h.app.inputSeen.grid=false;h.app.inputSeen.pv=false;
 for(let i=0;i<10;i++){now+=60000;h.app.runSlowHeartbeatHousekeeping(now,h.app.getSettings());}
 assert.equal(writes,1,'advancing only a time anchor is not new learning');checks++;
 // A failed checkpoint stays retryable on an existing heartbeat; no new timer.
 fresh(h);now+=60000;sample(h);const stored=structuredClone(h.store.get('_autoTuneLearning'));
 h.app.homey.settings.set=(key,value)=>{if(key==='_autoTuneLearning')throw Error('storage unavailable');return set(key,value);};
 assert.equal(h.app.persistAutoTuneLearning(now,true),false);assert.deepEqual(h.store.get('_autoTuneLearning'),stored);checks++;
 h.app.homey.settings.set=set;assert(h.app.persistAutoTuneLearning(now+300000));checks++;
 // Four six-hour sessions accumulate the same measured minutes. Crossing
 // midnight finalizes only observed time; no artificial restart gap is added.
 now=at('2026-11-06','01:00','Europe/Brussels');h=await setup();sample(h);
 for(let session=0;session<4;session++){
  for(let minute=0;minute<360;minute++){now+=60000;sample(h);}
  h.app.persistAutoTuneLearning(now,true);const totals=structuredClone(day(h));
  h=await setup(new Map(h.store));assert.equal(day(h).sampleMillis,totals.sampleMillis);close(day(h).estimatedDemandKwh,totals.estimatedDemandKwh,'six-hour restart demand');checks++;
 }
 const days=h.app.autoTuneRuntime.planning.days;assert.equal(days.length,1);assert.equal(days[0].dateKey,'2026-11-06');assert.equal(days[0].sampleHours,23);assert(days[0].reliableHours>22.8&&days[0].reliableHours<=23);assert(Math.abs(days[0].estimatedDemandKwh-6.895)<=.0050000001,'existing two-decimal summary rounding');assert.equal(day(h).sampleMillis,3600000);checks++;
 // A previous day's active checkpoint is finalized on boot with exactly the
 // existing validity rule and never duplicated by a second boot.
 now=at('2026-11-06','23:55','Europe/Brussels');h=await setup();sample(h);now+=60000;sample(h);h.app.persistAutoTuneLearning(now,true);
 const lastDay=structuredClone(day(h));now=at('2026-11-07','00:01','Europe/Brussels');h=await setup(new Map(h.store));
 assert.equal(h.app.autoTuneRuntime.planning.days.filter(x=>x.dateKey==='2026-11-06').length,1);checks++;
 h=await setup(new Map(h.store));assert.equal(h.app.autoTuneRuntime.planning.days.filter(x=>x.dateKey==='2026-11-06').length,1);assert(!day(h)||day(h).sampleMillis===0);checks++;
 for(const key of ['sampleMillis','estimatedDemandKwh','reliableHours']){if(lastDay[key]!=null)assert(lastDay[key]>=0);}checks++;
 // DST calendar days have 23 or 25 actual hours, not a fixed 24-hour limit.
 for(const [date,hours] of [['2027-03-28',23],['2026-10-25',25]]){
  now=at(date,'23:59','Europe/Brussels');const raw={dateKey:date,lastAt:now,sampleMillis:hours*3600000,estimatedDemandKwh:7,reliableHours:hours};
  assert(learning.restore(raw,date,now,'Europe/Brussels'));assert(!learning.restore({...raw,sampleMillis:(hours+1)*3600000},date,now,'Europe/Brussels'));checks++;
 }
 // Corruption discards only the active checkpoint, never historical summaries.
 now=at('2026-11-06','12:00','Europe/Brussels');const valid={dateKey:'2026-11-06',lastAt:now,sampleMillis:3600000,estimatedDemandKwh:1,reliableHours:1};
 for(const raw of [undefined,null,[],{...valid,dateKey:'2026-02-30'},{...valid,sampleMillis:-1},{...valid,estimatedDemandKwh:'bad'},{...valid,reliableHours:25},{...valid,peakSoc:101},{...valid,configurationSignature:{}},{...valid,dateKey:'2026-11-08'},{...valid,lastAt:1e100},{...valid,dateKey:'2026-99-99'}]){
  h=await setup(new Map([...Object.entries(base),['_autoTuneLearning',{days:[{dateKey:'2026-11-01',sampleHours:23}],currentDay:raw}]]));
  assert.equal(h.app.autoTuneRuntime.planning.days[0].dateKey,'2026-11-01');assert(!day(h)||day(h).sampleMillis===0);checks++;
 }
 // Legacy {days} payloads remain accepted. A graceful shutdown flushes the
 // latest totals using the existing lifecycle, before the five-minute checkpoint.
 h=await setup(new Map([...Object.entries(base),['_autoTuneLearning',{days:[{dateKey:'2026-11-01',sampleHours:23}]}]]));sample(h);now+=60000;sample(h);const latest=day(h).sampleMillis;await h.app.onUninit();assert.equal(h.store.get('_autoTuneLearning').currentDay.sampleMillis,latest);checks++;
 // External feedback has no physical-source discriminator: even a fresh,
 // stable setpoint cannot be promoted into a verified power measurement.
 h=await setup();sample(h);h.app.hybridEmsRuntime.delegated=true;
 for(let i=0;i<10;i++){now+=60000;fresh(h);h.app.handleExternalEmsSetpoint(0,now);sample(h);}
 assert(day(h).sampleMillis>0);assert.equal(day(h).reliableHours||0,0);checks++;
 h.app.hybridEmsRuntime.delegated=false;now+=60000;sample(h);assert(day(h).reliableHours>0,'ordinary non-Hybrid learning remains available');checks++;
 console.log(`AutoTune restart 1.2.33: ${checks} checkpoint, restart, calendar/DST, energy and quality checks passed.`);
}finally{global.Date=RealDate;}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
