'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const cases=['grid_only','stable','noise','pv_capture','peak','plan','soc','modes','live','pending','pending_changed','pending_safety','failed_output'];
async function replay(root=path.join(__dirname,'..'), scenario='stable', seconds=300, warmup=0) {
 root=path.resolve(root);
 // Count calls without replacing their implementation. App startup captures
 // this wrapper when requiring the real production engine.
 const req=createRequire(path.join(root,'package.json')), engine=req('./lib/ems-engine');
 const counter=engine.__activeChargeCount ||= {calls:0};
 if(!engine.__activeChargeOriginal) {
  engine.__activeChargeOriginal=engine.previewBatteryFeedback;
  engine.previewBatteryFeedback=(...args)=>{counter.calls++;return engine.__activeChargeOriginal(...args);};
 }
 const realNow=Date.now, restore=installVirtualClearTimeout();
 try {
  const h=await setup(root,{gridControlWindowSeconds:3,gridZeroMinW:-10,gridZeroMaxW:20,
   adaptiveLiveControlEnabled:scenario==='live',adaptiveSetpointDeltaW:1000,
   fixedChargeWindowStart:scenario==='grid_only'?'01:00':'11:00',
   fixedChargeWindowEnd:scenario==='grid_only'?'07:00':'17:00',
   controlProfile:'normal',hvacCount:2,hvacEnabled:true,boilerCount:1,boilerEnabled:true,
   exportLimitEnabled:true},Date.parse(scenario==='grid_only'?'2026-10-13T00:32:00Z':'2026-10-13T11:32:00Z'),scenario==='grid_only'?0:1200),a=h.app;
  if(scenario==='grid_only')a.state.pvSeenProducingToday=false;
  const counts={};
  for(const key of ['getEvaluationState','getSettings','refreshControlContext','refreshPlanningInContext','queueStatusUpdate']) {
   const original=a[key].bind(a);a[key]=(...args)=>{counts[key]=(counts[key]||0)+1;return original(...args);};
  }
  const writes=[];
  for(const [id,card] of h.cards){const orig=card.trigger.bind(card);card.trigger=async tokens=>{
   writes.push({at:h.now(),id,tokens});return orig(tokens);};}
  await h.start();const start=h.now();let pv=scenario==='grid_only'?0:1200,house=600,release=null,held=false,failed=false;
  const originalCommand=a.commandTrigger.trigger;
  if(scenario.startsWith('pending')||scenario==='failed_output') a.commandTrigger.trigger=async tokens=>{
   if(h.now()>=start+(warmup+70)*1000&&!held){held=true;
    if(scenario==='failed_output'){failed=true;throw Error('simulated transport failure');}
    await originalCommand(tokens);await new Promise(resolve=>{release=resolve;});
   }else await originalCommand(tokens);
  };
  const samples=[];
  async function tick(i,collect){
   h.setNow(start+i*1000);const t=collect?i-warmup:0;
   // Real API invalidation; the floor remains valid and both energy sources
   // are present. The pending slow cycle must keep its original deadline.
   if(i%120===25) {a.setInput({batterySoc:a.state.batterySoc.slice()});await h.drain();}
   if(scenario==='grid_only')pv=0;
   if(scenario==='pv_capture'&&t===60)pv=3200;
   if(scenario==='pv_capture'&&t===140)pv=1200;
   if(scenario==='peak'){if(t===90)house=4500;if(t===110)house=600;}
   if(scenario==='plan'&&(t===60||t===150)){
    a.setSetting('dayPlanningMaxSoc',t===60?70:100);
    a.requestContextEvaluate(true,'setting:dayPlanningMaxSoc');await h.drain();
   }
   if(scenario==='soc'&&t===60){a.setInput({batterySoc:[100,51,56,57]});await h.drain();}
   if(scenario==='soc'&&t===150){a.inputSeen.batterySoc[1]=false;a.invalidatePlanningCache();a.requestEvaluate(true);await h.drain();}
   if(scenario==='modes'){
    house=1100;pv=300;
    const modes={60:'standby',100:'self_consumption',160:'auto'};
    if(modes[t]){a.setSetting('forcedMode',modes[t]);a.requestContextEvaluate(true,'setting:forcedMode');await h.drain();}
   }
   if(scenario==='live'){
    if(t===20)pv=1500;if(t===35)pv=1200;
    if(t===130)house=1900;if(t===134)house=600;
   }
   if((scenario.startsWith('pending')||scenario==='failed_output')&&t===70)pv=3200;
   if(scenario==='pending_changed'&&t===82)pv=4000;
   if(scenario==='pending_safety'&&t===82){a.setSetting('controlEnabled',false);a.requestContextEvaluate(true,'setting:controlEnabled');await h.drain();}
   if(release&&t===95){const done=release;release=null;done();await h.drain();}
   if(i%15===0 && !(scenario==='live'&&t>=36&&t<110))await h.pv(pv);
   if((scenario==='pv_capture'&&[60,140].includes(t))
     ||(scenario.startsWith('pending')&&[70,82].includes(t))
     ||(scenario==='failed_output'&&t===70)
     ||(scenario==='live'&&[20,35].includes(t)))await h.pv(pv);
   const noise=scenario==='noise'?(i%5-2)*3:0;
   await h.grid(house+noise-pv-a.state.lastTotalCommandW);await h.flush();
   if(i%60===0){a.runContextHeartbeat();await h.drain();await h.flush();}
   if(collect&&t%5===0){
    const charge=Math.max(0,-a.state.lastTotalCommandW);
    const solar=Math.min(charge,Math.max(0,pv-house-noise));
    samples.push({second:t,command:a.state.lastTotalCommandW,commands:[...a.lastEmittedCommands],
     planned:a.latestResult.plannedChargeW,pvChargeW:solar,gridChargeW:charge-solar,
     rawP1:a.state.gridPowerW,mode:a.latestResult.baseMode,override:a.latestResult.override||'',
     source:a.getGridControlSelection(a.getSettings(),h.now()).source,
     contextDirty:a.controlContextDirty,contextDeadline:a.contextTimerAt});
   }
  }
  for(let i=1;i<=warmup;i++)await tick(i,false);
  a.diagnostics.counters={};counter.calls=0;for(const k of Object.keys(counts))counts[k]=0;
  h.traces.length=0;h.contexts.length=0;writes.length=0;
  const cpuStart=process.cpuUsage();
  for(let i=warmup+1;i<=warmup+seconds;i++)await tick(i,true);
  const cpu=process.cpuUsage(cpuStart);
  if(release){release();await h.drain();await h.flush();}
  if(scenario!=='failed_output')assert.deepEqual(h.errors,[]);else {
   assert(failed);assert(h.errors.some(e=>e.includes('simulated transport failure')));
   assert(h.errors.every(e=>e.includes('simulated transport failure')));
  }
  for(let i=1;i<h.traces.length;i++)assert(h.traces[i].at-h.traces[i-1].at>=7000);
  for(const tr of h.traces)assert.equal(tr.total,tr.commands.reduce((s,w)=>s+w,0));
  assert.equal(a.commandPublishing,false);
  if(['grid_only','stable','noise'].includes(scenario))assert(samples.every(s=>s.mode==='charge'&&s.planned>0&&s.command<0),'the entire measured window must remain actively charging');
  const both=samples.filter(s=>s.pvChargeW>25&&s.gridChargeW>25).length;
  if(['stable','noise','plan','soc'].includes(scenario))assert(both>10,'both real solar and grid must contribute');
  if(scenario==='pending_safety')assert(samples.filter(s=>s.second>=110).every(s=>s.commands.every(w=>w===0)));
  if(scenario==='pv_capture'){
   assert(samples.some(s=>s.second>=75&&s.second<140&&-s.command>s.planned+500));
   const after=samples.find(s=>s.second===180);assert(Math.abs(-after.command-after.planned)<2);
  }
  if(scenario==='peak')assert(samples.some(s=>s.second>=90&&s.second<=110&&s.override==='peak_shave'));
  if(scenario==='plan')assert(samples.find(s=>s.second===100).planned<samples.find(s=>s.second===50).planned);
  if(scenario==='soc')assert(samples.filter(s=>s.second>=80).every(s=>s.commands[0]===0));
  if(scenario==='modes'){
   assert(samples.some(s=>s.second>=70&&s.second<100&&s.commands.every(w=>w===0)));
   assert(samples.some(s=>s.second>=115&&s.second<160&&s.command>0));
   assert(samples.some(s=>s.second>=180&&s.command<0));
  }
  if(scenario==='live'){
   assert(samples.some(s=>s.second>=20&&s.second<45&&s.source==='live_pv_delta'));
   assert(samples.some(s=>s.second>=75&&s.second<=100&&s.source==='average_3_inputs'));
   assert(samples.some(s=>s.second>=135&&s.second<150&&s.source==='live_adaptive_setpoint'));
  }
  return {scenario,cpuMs:(cpu.user+cpu.system)/1000,node:process.version,counts,
   previewCalls:counter.calls,counters:a.diagnostics.counters,traces:h.traces,
   contexts:h.contexts,flexible:h.flexible,samples,bothSourcesSamples:both};
 } finally {Date.now=realNow;restore();}
}
async function verifyProofBoundaries(root=path.join(__dirname,'..')) {
 const realNow=Date.now,restore=installVirtualClearTimeout();
 try {
  const h=await setup(path.resolve(root),{gridControlWindowSeconds:0,exportLimitEnabled:false},
   Date.parse('2026-10-13T11:32:00Z'),1200),a=h.app;
  await h.start();h.setNow(h.now()+10000);
  await h.grid(600-1200-a.state.lastTotalCommandW);await h.flush();
  const input=()=>h.grid(600-1200-a.state.lastTotalCommandW);
  const full=()=>a.diagnostics.counters.fastEvaluations||0;
  a.requestContextEvaluate(false,'first_structural');const deadline=a.contextTimerAt;
  let before=full();await input();await h.flush();assert.equal(full(),before+1);
  assert(a.controlContextDirty);before=full();
  for(let i=0;i<5;i++){h.setNow(h.now()+1000);await input();await h.flush();}
  assert.equal(full(),before,'an already processed pending change must not force every P1');
  assert.equal(a.contextTimerAt,deadline,'the slow deadline is unchanged');
  a.markContextDirty('second_structural');before=full();await input();await h.flush();
  assert.equal(full(),before+1,'a second invalidation needs its own first full evaluation');
  // The lightweight proof must also expire at the original minute boundary.
  h.setNow(Math.ceil((h.now()+1)/60000)*60000);before=full();await input();await h.flush();
  assert(full()>before);assert.deepEqual(h.errors,[]);
  // Stale P1 defeats every proof and reaches the existing safe stop.
  h.setNow(h.now()+10000);a.inputUpdatedAt.grid=h.now()-600000;
  a.requestEvaluate();await h.drain();await h.flush();
  assert.equal(a.latestResult.inputReady,false);
  assert(a.lastEmittedCommands.every(w=>w===0));
 }finally{Date.now=realNow;restore();}
}
async function run(root=path.join(__dirname,'..')){
 const results=[];for(const name of cases)results.push(await replay(root,name));
 await verifyProofBoundaries(root);return results;
}
if(require.main===module){
 const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
 (process.argv[3]?replay(root,process.argv[3],Number(process.argv[4])||300,Number(process.argv[5])||0).then(r=>console.log(JSON.stringify(r)))
  :run(root).then(rs=>console.log(`Active charging: ${rs.length} production-cache scenarios passed.`)))
 .catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports={replay,run,cases};
