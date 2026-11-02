'use strict';
// Optional, reproducible container replay; no physical Homey CPU claim.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),reportPath=process.argv[3];
const engine=require(root+'/lib/ems-engine');let calls={};
const wrap=(object,name)=>{const fn=object[name];object[name]=function(...args){calls[name]=(calls[name]||0)+1;return fn.apply(this,args);};};
for(const name of ['evaluate','previewBatteryFeedback','prepareControlContext'])wrap(engine,name);
const {setup,installVirtualClearTimeout}=require(root+'/test/pv-source-harness');
const RealDate=Date,realNow=Date.now;global.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[Date.now()]));}};
const restore=installVirtualClearTimeout();
const cases=[
 {name:'normal_auto_discharge',soc:80,pv:0},
 {name:'auto_soc_floor_pv_zero',soc:14,pv:0},
 {name:'auto_soc_floor_pv_200W',soc:14,pv:200},
 {name:'manual_self_consumption_at_floor',soc:14,pv:200,forcedMode:'self_consumption'},
 {name:'manual_avoid_import_at_floor',soc:14,pv:200,forcedMode:'avoid_import'},
 {name:'manual_solar_capture_at_floor',soc:20,pv:200,forcedMode:'solar_capture'},
 {name:'manual_standby',soc:80,pv:0,forcedMode:'standby'},
 {name:'auto_soc_floor_ev_disconnected',soc:14,pv:0,evCount:1},
 {name:'auto_soc_hard_floor_above_peak',soc:14,pv:0,load:3000,hardFloor:true},
];
(async()=>{try{
 const reports=[];
 for(const s of cases){
  const h=await setup(root,{forcedMode:s.forcedMode||'auto',fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00',
   minSoc:s.hardFloor?14:12,safetySoc:14,batterySaveDischargeAboveSoc:30,lowForecastFixedEnabled:false,
   evCount:s.evCount||0,evEnabled:Boolean(s.evCount),evControlType:'current',exportLimitEnabled:false,peakLimitW:2650,peakSoftMarginW:100},Date.parse('2026-10-04T12:00:05Z'),s.pv);
  const a=h.app;Object.assign(a.state,{batterySoc:Array(4).fill(s.soc),targetSocOverride:null,gridPowerW:s.load||1200});
  a.inputUpdatedAt.batterySoc=Array(4).fill(h.now());if(s.evCount)await h.cards.get('set_ev1_status').listener({connected:'no',charge_current:0});
  a.diagnostics.options={cpu:false,planning:false,errors:false};
  for(const name of ['getEvaluationState','getBatteryIdleDependencies','getRuntimeSettings','evaluateFastNow'])wrap(a,name);
  await h.start();await h.flush();
  async function frame(i){h.setNow(h.now()+1000);await h.grid((s.load||1200)-a.state.lastTotalCommandW);await h.flush();
   if(i%60===0){a.inputUpdatedAt.pv=h.now();a.inputUpdatedAt.batterySoc=Array(4).fill(h.now());await h.start();await h.flush();}}
  for(let n=1;n<=30;n++)await frame(n);
  calls={};const traces=h.traces.length,contexts=h.contexts.length,timers=h.timers.length;
  if(global.gc)global.gc();const heapBefore=process.memoryUsage().heapUsed,cpu=process.cpuUsage();
  for(let n=1;n<=240;n++)await frame(n);
  const used=process.cpuUsage(cpu);if(global.gc)global.gc();assert.deepEqual(h.errors,[]);
  reports.push({name:s.name,p1:240,mode:a.latestResult.baseMode,output:a.lastEmittedCommands,
   stateBuilds:calls.getEvaluationState||0,previews:calls.previewBatteryFeedback||0,fullEvaluations:calls.evaluate||0,
   measuredFastEvaluations:calls.evaluateFastNow||0,
   contexts:h.contexts.length-contexts,publishes:h.traces.length-traces,scheduledTimers:h.timers.length-timers,
   cpuMs:(used.user+used.system)/1000,retainedHeapDeltaBytes:process.memoryUsage().heapUsed-heapBefore,memoJsonBytes:Buffer.byteLength(JSON.stringify(a.batteryFeedbackMemo))});
 }
 const report={version:JSON.parse(fs.readFileSync(root+'/app.json')).version,node:process.version,simulatedHomey:true,physicalHomeyCpuMeasured:false,reports,
  note:'Independent process per version, 4-minute control replay per case. GC/JIT/process noise affects CPU and heap; counts and real output vectors are the primary evidence.'};
 if(reportPath)fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(reports.map(({name,stateBuilds,previews,measuredFastEvaluations,publishes,cpuMs})=>({name,stateBuilds,previews,fast:measuredFastEvaluations,publishes,cpuMs:Math.round(cpuMs)}))));
 }finally{restore();global.Date=RealDate;Date.now=realNow;}
})().catch(e=>{console.error(e);process.exitCode=1;});
