'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),{setup,installVirtualClearTimeout}=require(root+'/test/pv-source-harness');
const engine=require(root+'/lib/ems-engine');let stats={};
function wrap(obj,name){const f=obj[name];obj[name]=function(...args){const at=process.cpuUsage();try{const r=f.apply(this,args);if(name==='prepareChargeStrategy'&&r?.costComparison)stats.priceCostComparisons=(stats.priceCostComparisons||0)+1;return r;}finally{const cpu=process.cpuUsage(at);const row=stats[name]||={calls:0,cpuMs:0};row.calls++;row.cpuMs+=(cpu.user+cpu.system)/1000;}};}
for(const n of ['prepareControlContext','prepareChargeStrategy','buildSocPlan'])wrap(engine,n);
const NativeDate=Date,restore=installVirtualClearTimeout();global.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[Date.now()]));}};
(async()=>{try{
 const at=NativeDate.parse('2026-10-20T09:00:00Z'),c=require(root+'/lib/charge-strategy').normalize();c.year.day.mode='maximum';c.year.day.position='center';
 const h=await setup(root,{contractType:'dynamic_quarter',dynamicPriceSource:'external',dynamicPriceSources:['external'],chargeStrategy:c,exportLimitEnabled:false,boilerCount:0},at,0),a=h.app;
 const {localParts}=require(root+'/lib/homey-energy'),slots=[];
 for(let t=at-12*3600000;t<at+36*3600000;t+=900000){const p=localParts(new Date(t),'Europe/Brussels');slots.push({startMs:t,dateKey:p.dateKey,minute:p.minuteOfDay,price:p.minuteOfDay>=780&&p.minuteOfDay<840?.05:.3});}
 a.externalEnergy={...a.externalEnergy,slots,currentPrice:.3,curveUpdatedAt:at,currentUpdatedAt:at};a.state.pvProducingDate=a.getLocalDateKey(new Date(at));a.state.pvSeenProducingToday=true;a.state.nightPlanningActive=false;a.diagnostics.options={cpu:false,planning:false,errors:false};
 for(const n of ['getBoilerSolarDayWindow','getBoilerSolarFallbackStatus','getRuntimeSettings','getEvaluationState','refreshControlContext','refreshPlanningInContext'])wrap(a,n);
 for(let n=0;n<100;n++){h.setNow(at+n*1000);a.inputUpdatedAt.grid=h.now();await h.start();await h.flush();}
 stats={};const cpu=process.cpuUsage();
 for(let n=100;n<300;n++){h.setNow(at+n*1000);a.inputUpdatedAt.grid=h.now();await h.start();await h.flush();}
 const used=process.cpuUsage(cpu);assert.deepEqual(h.errors,[]);
 fs.writeFileSync(process.argv[3],JSON.stringify({contexts:200,cpuMs:(used.user+used.system)/1000,stats,debug:{choice:require(root+'/lib/charge-strategy').select(a.getSettings(),h.now(),a.isNightPlanningPhase()),config:a.getSettings().chargeStrategy,night:a.isNightPlanningPhase(),phase:a.state.nightPlanningActive,pvDate:a.state.pvProducingDate,plan:a.controlRuntimeSettings.batteryChargeStrategyPlan},note:'Inclusive synchronous process CPU; overlapping nested sections must not be added. Per-call measurement overhead is included equally. No Homey measurement.'},null,2));
 console.log('PASS context breakdown');
}finally{restore();global.Date=NativeDate;}})().catch(e=>{console.error(e);process.exitCode=1;});
