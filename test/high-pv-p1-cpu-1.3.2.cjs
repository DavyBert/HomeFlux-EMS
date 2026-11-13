'use strict';
const path=require('node:path'),assert=require('node:assert/strict');
// Usage: node --expose-gc test/high-pv-p1-cpu-1.3.2.cjs SOURCE_ROOT fixed 3 900
// Real app startup/settings/P1/evaluation/publication gates; Homey I/O and time are mocked.
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),kind=process.argv[3]||'fixed',rounds=Number(process.argv[4]||3),frames=Number(process.argv[5]||900);
let calls={};const wrap=(o,k)=>{const f=o[k];o[k]=function(...args){calls[k]=(calls[k]||0)+1;return f.apply(this,args)}};
const E=require(root+'/lib/ems-engine');for(const k of ['evaluate','prepareControlContext','buildSocPlan','prepareChargeStrategy','previewBatteryFeedback'])wrap(E,k);
const {setup,installVirtualClearTimeout}=require(root+'/test/pv-source-harness');
const RealDate=Date,realNow=Date.now;global.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[Date.now()]));}};
const clear=installVirtualClearTimeout();
(async()=>{
 const at=RealDate.parse('2026-11-13T11:00:05Z');
 const tou=kind.startsWith('tou'),dynamic=kind.startsWith('dynamic'),same=kind.includes('same'),off=kind.endsWith('off');
 const settings={contractType:tou?'tou':dynamic?'dynamic_hour':'fixed',forcedMode:'auto',expectedEnergyNeedKwh:0,
  fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00',exportLimitEnabled:false,
  batterySaveDischargeAboveSoc:100,peakShaveEnabled:true,lowForecastSelfConsumptionMinKwh:5,
  dynamicPriceSources:['external'],dynamicPriceSource:'external',cheapHours:1,expensiveHours:1,
  dynamicUseBatteryNormalHours:same,
  highForecastDynamicCheapBatterySave:true,highForecastDynamicCheapDischargeToTarget:!off,
  highForecastDynamicNormalBatterySave:true,highForecastDynamicNormalDischargeToTarget:!off,
  lowForecastDynamicNormalEnabled:kind.includes('low'),lowForecastDynamicNormalDischargeToTarget:true,
  touRates:[{id:'r',name:'Rate',importPrice:.3,weekdayChargeMode:'never',weekendChargeMode:'never',avoidGridImport:false,
   highForecastBatterySave:kind!=='tou_same_off',highForecastDischargeToTarget:!off}],
  touSchedule:[{rateId:'r',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]}]};
 settings.highForecastDynamicPolicy=Object.fromEntries(['Cheap','Normal'].flatMap(c=>['BatterySave','DischargeToTarget'].map(k=>{const key='highForecastDynamic'+c+k;return [key,settings[key]!==false]})));
 const h=await setup(root,settings,at,0),a=h.app;
 for(const k of ['getSettings','getEvaluationState','evaluateFastNow','evaluateContextNow','refreshControlContext','getRuntimeSettings','queueCommandEmit','queueStatusUpdate','triggerCalculatedSetpoint','publishStatus','shouldRunFastEvaluation','canSkipBatteryFeedback','canSkipBatteryIdle','requestEvaluate'])if(typeof a[k]==='function')wrap(a,k);
 Object.assign(a.state,{batterySoc:[70,70,70,70],targetSocOverride:40,forecastRemainingKwh:20,forecastDailyMaxKwh:kind.includes('low')?4:20,forecastTomorrowKwh:20});
 a.diagnostics.options={cpu:false,planning:false,errors:false,memory:false};
 if(dynamic){const slots=[];for(let t=at-24*3600000;t<at+72*3600000;t+=3600000){const p=require(root+'/lib/homey-energy').localParts(new Date(t),'Europe/Brussels');slots.push({startMs:t,dateKey:p.dateKey,minute:p.minuteOfDay,price:p.minuteOfDay===60?.1:p.minuteOfDay===18*60?.6:.3})}Object.assign(a.externalEnergy,{slots,currentPrice:.3,curveUpdatedAt:at,currentUpdatedAt:at});}
 await h.start();await h.flush();
 function trim(){h.traces.length=0;h.flexible.length=0;h.contexts.length=0;h.logs.length=0;h.timers.splice(0,h.timers.length,...h.timers.filter(t=>!t.done))}
 let n=0,modes={};
 async function batch(count){for(let i=0;i<count;i++){n++;h.setNow(h.now()+1000);if(n%60===0){a.inputUpdatedAt.pv=h.now();a.inputUpdatedAt.batterySoc.fill(h.now());}
 const house=600+((n%11)-5)*43;await h.grid(house-a.state.lastTotalCommandW);await h.flush();
 if(n%60===0){await h.start();await h.flush();}
 modes[a.latestResult.baseMode]=(modes[a.latestResult.baseMode]||0)+1;if(n%50===0)trim();}}
 await batch(300);trim();const report=[];
 for(let r=0;r<rounds;r++){calls={};modes={};if(global.gc)global.gc();const start=process.cpuUsage();await batch(frames);const cpu=process.cpuUsage(start);report.push({cpuMs:(cpu.user+cpu.system)/1000,calls:{...calls},modes,publishedTotal:a.state.lastTotalCommandW,baseMode:a.latestResult.baseMode,ordinaryFloor:a.latestResult.ordinaryDischargeFloorSoc,tariff:a.latestResult.tariff?.className});trim();}
 assert.deepEqual(h.errors,[]);console.log(JSON.stringify({root,kind,node:process.version,cacheKeys:Object.keys(a.settingsCache).length,frames,rounds:report}));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>{clear();global.Date=RealDate;Date.now=realNow});
