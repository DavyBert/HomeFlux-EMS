'use strict';
// Reproducible real P1/PV/Flow loop; Homey I/O and plant response are simulated.
const {createRequire}=require('node:module'),path=require('node:path'),{performance}=require('node:perf_hooks');
const root=path.resolve(process.argv[2]),mode=process.argv[3]||'off',req=createRequire(path.join(root,'package.json'));
const {fixture}=req('./test/ev-work-harness'),{installVirtualClearTimeout}=req('./test/pv-source-harness');
const N=Date,originalNow=Date.now;global.Date=class extends N{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const restore=installVirtualClearTimeout();
(async()=>{try{
 const h=await fixture({type:'current',evs:4,batteries:4,batteryEnabled:true,chargeAllowed:true,pv:0,
  extra:{peakShaveEnabled:true,peakLimitW:100000,peakSoftMarginW:100,
   evBlockBatteryDischargeAlways:mode==='always',evBlockBatteryDischargeGridMajority:mode==='majority'}});
 const a=h.app;a.savings.inventory={pvKwh:2,unknownKwh:0,grid:{cheap:{kwh:12,cost:2}}};let step=0;
 async function tick(){h.setNow(h.now()+1000);
  if(step++%5===0)for(let i=0;i<4;i++)await h.cards.get(`set_ev${i+1}_status`).listener({connected:'yes',charge_current:8});
  await h.pv(0);await h.grid(4000+4*8*Math.sqrt(3)*400-a.state.lastTotalCommandW);await h.flush();}
 for(let n=0;n<1500;n++)await tick();
 if(global.gc)global.gc();const heap=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),at=performance.now();
 const before={contexts:h.contexts.length,outputs:h.flexible.length,timers:h.timers.length,counters:{...a.diagnostics?.counters}};
 for(let n=0;n<400;n++)await tick();
 const used=process.cpuUsage(cpu),elapsedMs=performance.now()-at;if(global.gc)global.gc();
 console.log(JSON.stringify({mode,cpuMs:(used.user+used.system)/1000,elapsedMs,retainedHeapDeltaBytes:process.memoryUsage().heapUsed-heap,
  contexts:h.contexts.length-before.contexts,outputEvents:h.flexible.length-before.outputs,scheduledTimers:h.timers.length-before.timers,
  counters:Object.fromEntries(Object.entries(a.diagnostics?.counters||{}).map(([k,v])=>[k,v-(before.counters[k]||0)]).filter(([,v])=>v)),
  batteryOutputW:a.state.lastTotalCommandW,errors:h.errors}));
}finally{restore();global.Date=N;Date.now=originalNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
