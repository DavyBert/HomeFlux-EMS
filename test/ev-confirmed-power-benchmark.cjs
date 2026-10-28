'use strict';
// Optional comparison worker: real Flow/P1 path with mocked Homey I/O.
const {createRequire}=require('node:module'),path=require('node:path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),type=process.argv[3]||'mode',evs=Number(process.argv[4]||1),req=createRequire(path.join(root,'package.json'));
const {fixture}=req('./test/ev-work-harness'),{installVirtualClearTimeout}=req('./test/pv-source-harness'),{evPowerPerAmp}=req('./lib/flexible-loads');
const N=Date,originalNow=Date.now;global.Date=class extends N{constructor(...a){super(...(a.length?a:[Date.now()]));}};const restore=installVirtualClearTimeout();
(async()=>{try{
 const h=await fixture({type,evs,batteries:0,batteryEnabled:false,chargeAllowed:true,extra:{peakShaveEnabled:true,peakLimitW:100000,peakSoftMarginW:100,evIdleHouseLoadW:4000}}),a=h.app;
 for(let i=0;i<evs;i++){const stem=i?'ev'+(i+1):'ev';await h.setExternalSetting(stem+'ModeStandardCurrentA',10);await h.setExternalSetting(stem+'MaxCurrentA',10);await h.setExternalSetting(stem+'StandardCurrentA',10);a.setEvSessionOverrideFor(i,'emergency','flow');}
 a.evSessionDetection.portfolioBaselineW=4000;const perAmp=evPowerPerAmp(a.getEvElectricalSettingsFor(0));let step=0;
 async function tick(){h.setNow(h.now()+1000);if(step++%5===0)for(let i=0;i<evs;i++)await h.cards.get(`set_ev${i+1}_status`).listener({connected:'yes',charge_current:8});await h.pv(0);await h.grid(4000+evs*8*perAmp);await h.flush();}
 for(let n=0;n<1500;n++)await tick();
 if(global.gc)global.gc();const countersBefore={...(a.diagnostics?.counters||{})};const heap=process.memoryUsage().heapUsed,contexts=h.contexts.length,writes=h.flexible.length,timers=h.timers.length,cpu=process.cpuUsage(),at=performance.now();
 for(let n=0;n<400;n++)await tick();
 const used=process.cpuUsage(cpu),elapsedMs=performance.now()-at;if(global.gc)global.gc();
 const reading=a.evSessionDetection.modePowerSnapshot;
 console.log(JSON.stringify({type,evs,steps:400,cpuMs:(used.user+used.system)/1000,elapsedMs,retainedHeapDeltaBytes:process.memoryUsage().heapUsed-heap,
 contexts:h.contexts.length-contexts,outputEvents:h.flexible.length-writes,scheduledTimers:h.timers.length-timers,
 counters:Object.fromEntries(Object.entries(a.diagnostics?.counters||{}).map(([k,v])=>[k,v-(countersBefore[k]||0)]).filter(([,v])=>v)),observedPowerW:Array.from({length:evs},(_,i)=>a.getEvCommandedPowerW(i)),modeSnapshotJsonBytes:reading?Buffer.byteLength(JSON.stringify(reading)):0,errors:h.errors}));
 }finally{restore();global.Date=N;Date.now=originalNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
