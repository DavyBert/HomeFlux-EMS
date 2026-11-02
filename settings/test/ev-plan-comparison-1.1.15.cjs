'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const{spawnSync}=require('node:child_process');
const baseline=path.resolve(process.argv[2]),current=path.resolve(__dirname,'..');
const profiles=['disconnected','connected','soc-active','energy-active','soc-disconnected','energy-disconnected',
 'soc-repeat','energy-repeat','soc-repeat50','energy-repeat50','soc-feedback','soc-live',
 'soc-change','energy-change','soc-charging','energy-charging','soc-dynamic-guarantee','energy-dynamic-guarantee',
 'soc-feedback1','energy-feedback1','soc-charging-mode','energy-charging-mode',
 'soc-dynamic-imminent-guarantee','energy-dynamic-imminent-guarantee',
 'soc-repeat-settings-events','energy-repeat-settings-events',
 'soc-change-settings-events','energy-change-settings-events']
 .filter(p=>!process.env.EV_PLAN_FILTER||new RegExp(process.env.EV_PLAN_FILTER).test(p));
const seconds=Number(process.env.EV_PLAN_SECONDS||300),runs=Number(process.env.EV_PLAN_RUNS||3);
const result={scope:'Host process CPU; real control code with simulated Homey I/O/time. Clean CPU runs have no function wrappers.',seconds,runs,results:[],summary:[]};
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
for(const profile of profiles){
 const rows={before:[],after:[]};
 for(let run=0;run<=runs;run++){
  const pair={};
  for(const mode of run%2?['after','before']:['before','after']){
   const env={...process.env,EV_PLAN_TIMED:run===0?'1':'0',EV_PLAN_CLEAN:run===0?'0':'1'};delete env.EV_PLAN_OUTPUT;
   const child=spawnSync(process.execPath,['--expose-gc',path.join(__dirname,'ev-plan-probe-1.1.15.cjs'),mode==='before'?baseline:current,profile,String(seconds)],{env,encoding:'utf8',maxBuffer:30*1024*1024});
   assert.equal(child.status,0,`${profile}/${mode}: ${child.stderr}`);
   const r=JSON.parse(child.stdout);r.mode=mode;r.run=run;result.results.push(r);pair[mode]=r;if(run)rows[mode].push(r);
  }
  // Compare actuator commands, including publication time and token values.
  assert.deepEqual(pair.after.battery,pair.before.battery,`${profile}: battery actuation`);
  assert.deepEqual(pair.after.ev,pair.before.ev,`${profile}: EV actuation`);
  assert.deepEqual(pair.after.snapshots,pair.before.snapshots,`${profile}: energy/deadline/control snapshots`);
 }
 const summary={profile,outputsIdentical:true};
 for(const mode of['before','after']){
  const r=rows[mode],p=result.results.find(x=>x.profile===profile&&x.mode===mode&&x.run===0);
  summary[mode]={medianCpuMs:median(r.map(x=>x.cpuMs)),minCpuMs:Math.min(...r.map(x=>x.cpuMs)),maxCpuMs:Math.max(...r.map(x=>x.cpuMs)),
   medianWallMs:median(r.map(x=>x.wallMs)),medianHeapRetainedBytes:median(r.map(x=>x.retainedHeapBytes)),
   calls:p.metrics.calls,cpuMsInclusiveSync:p.metrics.cpuMs,byPhase:p.metrics.byPhase,calendarConversions:p.metrics.calendar,
   writes:p.metrics.writes,counters:p.counters};
 }
 result.summary.push(summary);process.stderr.write(`Completed ${profile}\n`);
}
if(process.env.EV_PLAN_COMPARISON_OUTPUT)fs.writeFileSync(process.env.EV_PLAN_COMPARISON_OUTPUT,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({profiles:profiles.length,replays:result.results.length,outputsIdentical:true,summary:result.summary},null,2));
