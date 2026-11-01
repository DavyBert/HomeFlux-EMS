'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),{setup,installVirtualClearTimeout}=require(root+'/test/pv-source-harness');
const NativeDate=Date,restore=installVirtualClearTimeout();global.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[Date.now()]));}};
(async()=>{try{
 const h=await setup(root,{exportLimitEnabled:false,forcedMode:'self_consumption'},NativeDate.parse('2026-10-20T09:00:05Z'),0),a=h.app;
 a.diagnostics.options={cpu:false,planning:false,errors:false,memory:false};await h.start();await h.flush();
 const at=h.now();a.lastEmitAt=at;a.nextCommandAllowedAt=at+7000;a.state.gridPowerW=1200;a.inputUpdatedAt.grid=at;
 a.requestEvaluate(true);const timer=a.controlTimer;assert(timer);
 let calls=0;const preflight=a.shouldRunFastEvaluation;a.shouldRunFastEvaluation=function(...args){calls++;return preflight.apply(this,args);};
 const batch=()=>{for(let n=0;n<30000;n++){a.state.gridPowerW=800+n%700;a.requestEvaluate();}};
 for(let i=0;i<4;i++)batch();const rounds=[];
 for(let i=0;i<7;i++){calls=0;const cpu=process.cpuUsage();batch();const used=process.cpuUsage(cpu);rounds.push({cpuMs:(used.user+used.system)/1000,preflights:calls});}
 assert.equal(a.controlTimer,timer);h.setNow(at+7000);a.inputUpdatedAt.grid=h.now();await h.flush();assert.deepEqual(h.errors,[]);
 const result={rounds,warmup:120000,unit:'30000 queued scheduler requests',scope:'Component-only real requestEvaluate/preflight with pending interval, synthetic repeated calls; not P1 replay or Homey CPU.',traces:h.traces};
 fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2));console.log('PASS timer component');
}finally{restore();global.Date=NativeDate;}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
