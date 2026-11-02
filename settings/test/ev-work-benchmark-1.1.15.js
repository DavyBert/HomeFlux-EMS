'use strict';
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { fixture, ROOT } = require('./ev-work-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const RealDate = Date;
class VirtualDate extends RealDate { constructor(...args) { super(...(args.length ? args : [VirtualDate.now()])); } }
const profiles = [
  { id:'connected-stop', type:'mode', connected:true, load:2500 },
  { id:'disconnected', type:'mode', connected:false, load:2500 },
  { id:'connected-jitter', type:'mode', connected:true, jitter:true, load:2500 },
  { id:'identical-feedback', type:'mode', connected:true, feedback10:true, load:2500 },
  { id:'live-status', type:'mode', connected:true, ui:true, load:2500 },
  { id:'disconnected-status', type:'mode', connected:false, ui:true, load:2500 },
  { id:'two-current', type:'current', connected:true, chargeAllowed:true, evs:2, load:623, pvCurve:true },
  { id:'two-hybrid', type:'hybrid', connected:true, chargeAllowed:true, evs:2, load:623 },
  { id:'no-battery', type:'current', connected:true, chargeAllowed:true, batteries:0, batteryEnabled:false, load:623 },
  { id:'battery-disabled', type:'mode', connected:true, chargeAllowed:true, batteryEnabled:false, load:623 },
  { id:'pv-only', type:'current', connected:true, chargeAllowed:false, batteries:0, batteryEnabled:false, load:623, pvCurve:true },
  { id:'diagnostics-off', type:'mode', connected:true, diagnosticsOff:true, load:2500 },
];
const median = xs => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];

async function replay(root, profile, seconds = 300) {
  const h = await fixture({ root, ...profile, extra:{ evPvSharePercent:100 } }), a = h.app;
  // Warm the actual plant at the intended household load before measuring.
  await h.grid(profile.load - a.state.lastTotalCommandW); await h.start(); await h.flush();
  h.setNow(h.now()+10000); await h.flush(); await h.grid(profile.load-a.state.lastTotalCommandW); await h.start(); await h.flush();
  if (profile.diagnosticsOff) a.diagnostics = a.createDiagnosticsRuntime();
  const origin=h.now(), traces=h.traces.length, flexible=h.flexible.length;
  const counters={}, calls={};
  const record=a.recordDiagnosticCounter;
  a.recordDiagnosticCounter=function(key,n=1){counters[key]=(counters[key]||0)+n;return record.call(this,key,n);};
  for(const name of ['getEvInstanceSettings','getEvGridImportControlStatus']){
    const fn=a[name];a[name]=function(...args){calls[name]=(calls[name]||0)+1;return fn.apply(this,args);};
  }
  const physicalPerAmp=Math.sqrt(3)*400;
  if(global.gc)global.gc();
  const memoryBefore=process.memoryUsage(),cpu=process.cpuUsage(),wall=performance.now();
  let received=0;
  for(let second=1;second<=seconds;second++){
    h.setNow(origin+second*1000);
    const pv=profile.pvCurve ? (Math.floor(second/30)%2 ? 5000 : 0) : 0;
    if(profile.pvCurve){await h.pv(pv);received++;}
    let evPower=0;
    for(let i=0;i<(profile.evs||1);i++){
      const r=i ? a.getExtraEv(i) : null;
      const mode=i?r.lastPublishedChargeMode:a.lastPublishedEvChargeMode;
      const allowed=i?r.lastPublishedAllowed:a.lastPublishedEvAllowed;
      const current=i?r.lastPublishedCurrentA:a.lastPublishedEvCurrentA;
      const amps=profile.connected && allowed ? (profile.type==='mode' ? (mode==='standard'?16:mode==='smart'?6:0) : Number(current)||0) : 0;
      evPower+=amps*physicalPerAmp;
      await h.cards.get(`set_ev${i+1}_status`).listener({connected:profile.connected?'yes':'no',charge_current:profile.feedback10?10:amps});received++;
    }
    const jitter=profile.jitter?(second%2?35:-35):0;
    await h.grid(profile.load+jitter+evPower-pv-a.state.lastTotalCommandW);received++;
    if(second%60===0){a.runContextHeartbeat();await a.runEvHeartbeat();await h.drain();}
    await h.flush();
    if(profile.ui && second%2===0){JSON.stringify(a.getPublicStatus());}
  }
  await h.drain();await h.flush();
  const used=process.cpuUsage(cpu),wallMs=performance.now()-wall;
  if(global.gc)global.gc();const memoryAfter=process.memoryUsage();
  assert.deepEqual(h.errors,[],profile.id);
  const outputs={battery:h.traces.slice(traces),flexible:h.flexible.slice(flexible),
    finalBatteryW:a.state.lastTotalCommandW,finalEv:Array.from({length:profile.evs||1},(_,i)=>{
      const r=i?a.getExtraEv(i):null,d=i?r.latestDecision:a.latestEvDecision;
      return {allowed:i?r.lastPublishedAllowed:a.lastPublishedEvAllowed,current:i?r.lastPublishedCurrentA:a.lastPublishedEvCurrentA,
        mode:i?r.lastPublishedChargeMode:a.lastPublishedEvChargeMode,desired:d?.desiredCurrentA};
    })};
  return{profile:profile.id,seconds,received,cpuMs:(used.user+used.system)/1000,wallMs,
    heapRetainedBytes:memoryAfter.heapUsed-memoryBefore.heapUsed,rssBytes:memoryAfter.rss,
    calls,counters,outputs};
}

async function main(){
  const baseline=path.resolve(process.argv[2]||process.env.HOMEFLUX_BASELINE||ROOT);
  const output=process.env.EV_WORK_OUTPUT;
  const runs=Number(process.env.EV_WORK_RUNS||7),seconds=Number(process.env.EV_WORK_SECONDS||300);
  const selected=profiles.filter(p=>!process.env.EV_WORK_FILTER||new RegExp(process.env.EV_WORK_FILTER).test(p.id));
  const result={node:process.version,scope:'Host process CPU, simulated Homey I/O and time. EV/battery controllers and handlers are real.',runs,seconds,results:[],summary:[]};
  global.Date=VirtualDate;const restore=installVirtualClearTimeout();
  try{
    for(let run=1;run<=runs;run++)for(const profile of selected){
      const pair={};
      for(const mode of run%2?['before','after']:['after','before']){
        const r=await replay(mode==='before'?baseline:ROOT,profile,seconds);r.run=run;r.mode=mode;result.results.push(r);pair[mode]=r;
      }
      assert.deepEqual(pair.after.outputs,pair.before.outputs,`actuation mismatch: ${profile.id}, run ${run}`);
      if(profile===selected.at(-1))process.stderr.write(`Completed run ${run}/${runs}\n`);
    }
    for(const profile of selected){
      const summary={profile:profile.id,outputsIdentical:true};
      for(const mode of ['before','after']){
        const all=result.results.filter(r=>r.profile===profile.id&&r.mode===mode);
        const rows=all.filter(r=>r.run>(runs>=5?2:0));
        summary[mode]={medianCpuMs:median(rows.map(r=>r.cpuMs)),minCpuMs:Math.min(...rows.map(r=>r.cpuMs)),maxCpuMs:Math.max(...rows.map(r=>r.cpuMs)),
          medianWallMs:median(rows.map(r=>r.wallMs)),medianHeapRetainedBytes:median(rows.map(r=>r.heapRetainedBytes)),
          calls:rows[0].calls,counters:rows[0].counters,received:rows[0].received};
      }
      result.summary.push(summary);
    }
    if(output)fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({profiles:selected.length,replays:result.results.length,outputsIdentical:true,summary:result.summary},null,2));
  }finally{restore();global.Date=RealDate;}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={replay,profiles};
