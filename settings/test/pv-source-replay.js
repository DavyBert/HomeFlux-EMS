'use strict';
// Reproducible before/after replay. Supply a source root and scenario.
// Homey I/O and time are virtual; settings/cache/engine/scheduler are production.
const path=require('node:path'), assert=require('node:assert/strict');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const restore=installVirtualClearTimeout(), realNow=Date.now;
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const scenario=process.argv[3]||'quiet';
(async()=>{
 const planned=scenario==='planned', quiet=scenario==='quiet';
 const h=await setup(root,{gridControlWindowSeconds:3,exportLimitEnabled:false,
   adaptiveLiveControlEnabled:false,forcedMode:planned?'auto':'self_consumption'},undefined,623);
 const a=h.app, counts={};
 for(const key of ['getSettings','getEvaluationState','getFastControlSnapshot','canSkipBatteryFeedback',
   'refreshControlContext','refreshPlanningInContext','queueStatusUpdate','triggerCalculatedSetpoint']) {
  const original=a[key].bind(a); a[key]=(...args)=>{counts[key]=(counts[key]||0)+1;return original(...args);};
 }
 const writes=[];
 for(const [id,card] of h.cards){const original=card.trigger.bind(card);card.trigger=async tokens=>{writes.push({at:h.now(),id,tokens});return original(tokens);};}
 await h.start(); const start=h.now();
 async function tick(i){
  h.setNow(start+i*1000);
  if(i%15===0){
   const pv=quiet||planned? (i%30===0?623:1000) : [300,1800,700,2600][Math.floor(i/15)%4];
   await h.pv(pv);
  }
  let grid=quiet?0:planned?300:623-a.state.pvPowerW-a.state.lastTotalCommandW;
  if(scenario==='peak' && i%120>=90 && i%120<100)grid+=4200;
  await h.grid(grid); await h.flush();
  if(i%60===0){a.runContextHeartbeat();await h.drain();await h.flush();}
 }
 for(let i=1;i<=600;i++)await tick(i);
 for(const key of Object.keys(counts))counts[key]=0;
 a.diagnostics.counters={};h.traces.length=0;h.contexts.length=0;writes.length=0;
 const cpuStart=process.cpuUsage();
 for(let i=601;i<=2400;i++)await tick(i);
 const cpu=process.cpuUsage(cpuStart);
 assert.deepEqual(h.errors,[]);
 for(let i=1;i<h.traces.length;i++)assert(h.traces[i].at-h.traces[i-1].at>=7000);
 console.log(JSON.stringify({scenario,node:process.version,cpuMs:(cpu.user+cpu.system)/1000,
   counts,counters:a.diagnostics.counters,contexts:h.contexts,traces:h.traces,writes}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Date.now=realNow;restore();});
