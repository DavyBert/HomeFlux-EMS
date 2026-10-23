'use strict';
// Real, advancing Date.now(), independent of the simulated replay clock.
const path=require('node:path'),fs=require('node:fs'),Module=require('node:module');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
let conversions=0,calls=0;
const extension=Module._extensions['.js'];
global.__evClockProbe=()=>{conversions++;};
Module._extensions['.js']=(mod,filename)=>{
 if(filename!==path.join(root,'lib/flexible-loads.js'))return extension(mod,filename);
 const s=fs.readFileSync(filename,'utf8').replace('if (localParts(candidate, timezone).minuteOfDay === targetMinute)',
  'if ((global.__evClockProbe(),localParts(candidate, timezone)).minuteOfDay === targetMinute)');
 mod._compile(s,filename);
};
const NativeDate=Date;global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const{fixture}=require('./ev-work-harness');
const{installVirtualClearTimeout}=require('./pv-source-harness');
(async()=>{const restore=installVirtualClearTimeout();try{
 const h=await fixture({root}),a=h.app;
 a.evSocPlans[0]={active:true,targetSoc:80,targetTime:'07:00',deadlineAt:0,guarantee:false};
 // Restore the real constructor and monotonic wall-clock observations after boot.
 global.Date=NativeDate;
 a.diagnostics=a.createDiagnosticsRuntime();
 conversions=0;const seen=new Set(),cpu=process.cpuUsage(),wall=performance.now();
 let functionCpuMs=0;
 for(let i=0;i<300;i++){
  await new Promise(resolve=>setTimeout(resolve,2));
  seen.add(Date.now());const at=process.cpuUsage();
  a.getEvInstanceSettings(0);calls++;
  const used=process.cpuUsage(at);functionCpuMs+=(used.user+used.system)/1000;
 }
 const used=process.cpuUsage(cpu);
 console.log(JSON.stringify({root,calls,distinctRealTimestamps:seen.size,calendarConversions:conversions,
  cpuMs:(used.user+used.system)/1000,functionCpuMs,wallMs:performance.now()-wall,errors:h.errors}));
}finally{restore();Module._extensions['.js']=extension;global.Date=NativeDate;delete global.__evClockProbe;}})().catch(e=>{console.error(e);process.exitCode=1;});
