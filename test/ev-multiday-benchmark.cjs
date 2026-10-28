'use strict';
// Optional benchmark: mocked Homey I/O, actual planner/resources, no physical CPU claim.
const {fixture,ROOT}=require('./ev-work-harness'),{installVirtualClearTimeout}=require('./pv-source-harness');
const fs=require('node:fs'),path=require('node:path');
const RealDate=Date,realNow=Date.now;global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const restore=installVirtualClearTimeout();
(async()=>{try{
 const h=await fixture({evs:4,type:'current',batteries:0,batteryEnabled:false,chargeAllowed:true}),a=h.app;
 await h.setExternalSetting('expectedEnergyNeedKwh',0);await h.cards.get('set_forecast_remaining').listener({energy:50});
 for(let i=0;i<4;i++)await a.setEvDashboard({evId:String(i+1),requestId:'benchmark_plan_'+i,change:{target:{type:'kwh',value:20},time:'07:00',days:7,maxPv:true,guaranteed:true},createOnly:true});
 const input=i=>({now:new Date(h.now()),settings:a.getEvInstanceSettings(i),gridPowerW:623,currentBatteryCommandW:0});
 const target={deadlineAt:a.evEnergyPlans[0].deadlineAt,energyNeedKwh:20,maxPowerW:16*Math.sqrt(3)*400,minPowerW:6*Math.sqrt(3)*400,standardPowerW:16*Math.sqrt(3)*400,guarantee:true};
 // Explicitly invalidate only this fixture's optional caches for a cold build.
 a.evConfiguredDeadlineCurves=null;a.evMaxPvBudget=null;a.evDeadlinePlanner=null;
 const before=process.cpuUsage(),coldAt=performance.now();for(let i=0;i<4;i++)a.planEvDeadline(i,input(i),target);
 const coldCpu=process.cpuUsage(before),coldMs=performance.now()-coldAt,builds=a.evDeadlinePlanner.builds;
 const inputs=[0,1,2,3].map(input);for(let n=0;n<100;n++)for(let i=0;i<4;i++)a.planEvDeadline(i,inputs[i],target);
 if(global.gc)global.gc();const heap=process.memoryUsage().heapUsed,at=performance.now(),cpu=process.cpuUsage(),timerCount=h.timers.length;
 for(let n=0;n<1000;n++)for(let i=0;i<4;i++)a.planEvDeadline(i,inputs[i],target);
 const used=process.cpuUsage(cpu),elapsedMs=performance.now()-at;if(global.gc)global.gc();
 const report={simulatedHomey:true,homeyCpuMeasured:false,evs:4,days:7,coldCpuMs:(coldCpu.user+coldCpu.system)/1000,coldElapsedMs:coldMs,
  calls:4000,cpuMs:(used.user+used.system)/1000,elapsedMs,extraBuilds:a.evDeadlinePlanner.builds-builds,newTimers:h.timers.length-timerCount,
  retainedHeapDeltaBytes:global.gc?process.memoryUsage().heapUsed-heap:null,
  configuredCurveIntervals:a.evConfiguredDeadlineCurves.map(x=>x.curve.intervals.length),
  cacheJsonBytes:Buffer.byteLength(JSON.stringify([a.evConfiguredDeadlineCurves,a.evMaxPvBudget])),
  note:'Synchronous production planner evaluations with fixed inputs; deliberate repeated calls measure reuse cost, not an added live loop. No timer, device-read or feedback recorder is added.'};
 fs.writeFileSync(path.join(ROOT,'validation/ev-multiday-performance-1.2.4.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{restore();global.Date=RealDate;Date.now=realNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
