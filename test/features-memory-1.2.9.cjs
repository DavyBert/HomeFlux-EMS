'use strict';
const path=require('node:path');
const root=path.resolve(process.argv[2]), variant=process.argv[3];
const {boot}=require(path.join(root,'test/startup-harness'));
const {localDateTimeUtcMs:at}=require(path.join(root,'lib/homey-energy'));
const RealDate=Date,realNow=Date.now,now=at('2026-10-30','12:00','Europe/Brussels');
global.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}};Date.now=()=>now;
(async()=>{try{
 const before=process.memoryUsage();
 const h=await boot(new Map(Object.entries({evCount:4,evEnabled:true,ev2Enabled:true,ev3Enabled:true,ev4Enabled:true,batteryCount:0,controlEnabled:false}))),a=h.app;
 for(let i=0;a.statusPublishing&&i<1000;i++)await Promise.resolve();
 a.requestContextEvaluate=()=>{};
 const startupBeforeGC=process.memoryUsage();if(global.gc)global.gc();const startupAfterGC=process.memoryUsage();
 for(let i=0;i<4;i++){
  await h.cards.get(`set_ev${i+1}_energy_deadline`).listener({energy:20,time:'06:00',guarantee:'yes'});
  if(variant==='new')await h.cards.get('set_ev_session_override_for_configured').listener({ev:{kind:'ev',id:String(i+1)},mode:'extend_plan_6_days'});
  else await a.setEvDashboard({evId:String(i+1),requestId:'bench_multiday_'+i,change:{days:7}});
 }
 const r={...a.latestResult,inputReady:true,controlEnabled:false,modeLabel:'Test · Preserved planning explanation',statusText:'Stable'};
 let tagWrites=0;for(const token of a.tokens.values())token.setValue=async()=>{tagWrites++;};
 for(let i=0;i<100;i++){a.getStatusResultSignature(r);a.pendingStatusResult=r;await a.publishPendingStatus();}
 tagWrites=0;const timers=h.timers.length;if(global.gc)global.gc();const startHeap=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),start=performance.now();
 for(let i=0;i<4000;i++){a.getStatusResultSignature(r);a.pendingStatusResult=r;await a.publishPendingStatus();}
 const elapsedMs=performance.now()-start,used=process.cpuUsage(cpu);if(global.gc)global.gc();
 const statusRetained=process.memoryUsage().heapUsed-startHeap;
 const inputs=[0,1,2,3].map(i=>({now:new Date(now),settings:a.getEvInstanceSettings(i),gridPowerW:500,currentBatteryCommandW:0}));
 const targets=[0,1,2,3].map(i=>({deadlineAt:a.evEnergyPlans[i].deadlineAt,energyNeedKwh:20,maxPowerW:11085,minPowerW:4157,standardPowerW:11085,guarantee:true}));
 for(let i=0;i<4;i++)a.planEvDeadline(i,inputs[i],targets[i]);
 const builds=a.evDeadlinePlanner.builds;
 for(let i=0;i<100;i++)for(let n=0;n<4;n++)a.planEvDeadline(n,inputs[n],targets[n]);
 if(global.gc)global.gc();const plannerHeap=process.memoryUsage().heapUsed,plannerCpu=process.cpuUsage();
 for(let i=0;i<1000;i++)for(let n=0;n<4;n++)a.planEvDeadline(n,inputs[n],targets[n]);
 const plannerUsed=process.cpuUsage(plannerCpu);if(global.gc)global.gc();
 console.log(JSON.stringify({variant,simulatedHomey:true,node:process.version,startupHeapBeforeGC:startupBeforeGC.heapUsed,startupHeapAfterGC:startupAfterGC.heapUsed,startupRss:startupAfterGC.rss,
  calls:4000,cpuMs:(used.user+used.system)/1000,elapsedMs,retainedHeapDeltaBytes:statusRetained,plannerCalls:4000,plannerCpuMs:(plannerUsed.user+plannerUsed.system)/1000,plannerRetainedHeapDeltaBytes:process.memoryUsage().heapUsed-plannerHeap,extraPlanBuilds:a.evDeadlinePlanner.builds-builds,newTimers:h.timers.length-timers,unchangedTagWrites:tagWrites,
  tokenCount:a.tokens.size,lastStatusCacheSize:a.lastStatusTokenValues.size,storedPlanBytes:Buffer.byteLength(JSON.stringify([h.store.get('evSocDeadlineOverrides'),h.store.get('evEnergyDeadlineOverrides'),h.store.get('_evWidgetPlanRuntime')]))}));
 }finally{global.Date=RealDate;Date.now=realNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
