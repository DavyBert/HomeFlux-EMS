'use strict';
// Optional reproducible Node microbenchmark of the existing P1 house sampler.
// Usage: node --expose-gc test/ev-house-reference-benchmark.cjs /app/root
const path=require('node:path'),{createRequire}=require('node:module'),{performance}=require('node:perf_hooks');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const req=createRequire(path.join(root,'package.json'));
const {setup,installVirtualClearTimeout}=req('./test/pv-source-harness');
const {powerPerAmp}=req('./settings/ev-headroom');
const NativeDate=Date,originalNow=Date.now,restore=installVirtualClearTimeout();
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
(async()=>{try{
 const h=await setup(root,{evCount:1,evEnabled:true,evSocEnabled:false,evControlType:'mode',batteryCount:0,controlEnabled:false,
  evPhases:3,evVoltage:400,evVoltageReference:'line'},NativeDate.parse('2026-10-27T12:00:00Z'),3000);
 const a=h.app;await h.drain();a.requestContextEvaluate=()=>{};a.requestEvaluate=()=>{};
 const settings=a.getSettings(),perAmp=powerPerAmp(3,400,'line');
 await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:7000/perAmp});await h.drain();
 a.lastPublishedEvAllowed=true;a.lastPublishedEvChargeMode='standard';a.lastEvPublishedAt=0;
 Object.assign(a.state,{gridPowerW:9000,pvPowerW:3000,lastTotalCommandW:0});
 let at=h.now();
 function sample(){at+=1000;h.setNow(at);a.inputUpdatedAt.grid=at;a.inputUpdatedAt.pv=at;a.inputUpdatedAt.ev.chargeCurrent=at;
  a.recordEvHouseLoadSample(9000,at,settings);}
 for(let i=0;i<5000;i++)sample();
 if(global.gc)global.gc();const heap=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),start=performance.now(),timers=h.timers.length;
 for(let i=0;i<50000;i++)sample();
 const used=process.cpuUsage(cpu),elapsedMs=performance.now()-start;if(global.gc)global.gc();
 const points=a.evSessionDetection.recentHouseSamples;
 console.log(JSON.stringify({iterations:50000,warmup:5000,cpuMs:(used.user+used.system)/1000,elapsedMs,
  retainedHeapDeltaBytes:global.gc?process.memoryUsage().heapUsed-heap:null,newTimerCount:h.timers.length-timers,
  recentPoints:points?.length||0,bufferJsonBytes:points?Buffer.byteLength(JSON.stringify(points)):0,
  recentAverageW:typeof a.getEvStartHouseReference==='function'?a.getEvStartHouseReference().houseRecentAverageW:null,
  scope:'Production P1 house sampler; steady 7 kW fresh EV current and 5 kW household; mocked Homey I/O and time, no device CPU measurement.'}));
}finally{restore();global.Date=NativeDate;Date.now=originalNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
