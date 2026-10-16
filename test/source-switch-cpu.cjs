'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(process.env.EMS_ROOT || path.join(__dirname,'..')),req=createRequire(path.join(root,'package.json'));
const engine=req('./lib/ems-engine');
let measuring=false,trace=process.argv.includes('--trace'),requestId=0,activeRequest=0,phase='',cause='';
let lastPreview=null,lastPreflightState=null;const counts={},pairs=[],events=[],rejects={};
for(const name of ['previewBatteryFeedback','evaluate']){
 const original=engine[name];engine[name]=(...args)=>{
  let key;if(measuring){counts[name]=(counts[name]||0)+1;if(trace)key=JSON.stringify(args[0]);}
  const result=original(...args);
  if(measuring&&trace){
   if(name==='previewBatteryFeedback')lastPreview={request:activeRequest,at:Date.now(),key,settings:args[1],commands:result.commands};
   else if(phase==='fast'&&lastPreview&&lastPreview.request===activeRequest&&lastPreview.key===key&&lastPreview.settings===args[1]){
    counts.sameInputPreviewThenFull=(counts.sameInputPreviewThenFull||0)+1;
    if(pairs.length<8)pairs.push({at:Date.now(),cause,request:activeRequest,preview:lastPreview.commands,full:result.commands});
   }
   if(name==='evaluate'&&phase==='fast'&&lastPreflightState&&lastPreflightState.request===activeRequest&&lastPreflightState.key===key&&lastPreflightState.builds>1){counts.sameInputStateBuiltTwice=(counts.sameInputStateBuiltTwice||0)+1;}
   if(events.length<10&&name==='evaluate')events.push({at:Date.now(),cause,phase,mode:result.baseMode,action:result.action,commands:result.commands});
  }return result;
 };
}
const {setup,installVirtualClearTimeout}=require(path.join(root,'test/pv-source-harness'));
const scenario=process.argv[2]||'steady_free',warmup=180,duration=300;
(async()=>{
 const realNow=Date.now,restore=installVirtualClearTimeout();let session;
 try{
  const cap=scenario.endsWith('_cap')?1000:6000;
  const h=await setup(root,{gridControlWindowSeconds:3,gridZeroMinW:-10,gridZeroMaxW:20,
   adaptiveLiveControlEnabled:false,controlProfile:'normal',hvacCount:2,hvacEnabled:true,
   boilerCount:1,boilerEnabled:true,exportLimitEnabled:true,maxTotalChargeW:cap},
   Date.parse('2026-10-13T11:32:00Z'),1200),a=h.app;
  for(const name of ['getEvaluationState','refreshControlContext','refreshPlanningInContext','queueStatusUpdate','canSkipBatteryFeedback']){
   const original=a[name].bind(a);a[name]=(...args)=>{
    if(measuring)counts[name]=(counts[name]||0)+1;
    if(name==='canSkipBatteryFeedback'){
     const previous=phase;phase='preflight';
     if(measuring&&h.now()<Math.max(a.nextCommandAllowedAt||0,(a.lastEmitAt||0)+7000))counts.preflightDuringCommandWait=(counts.preflightDuringCommandWait||0)+1;
     const result=original(...args);phase=previous;
     if(measuring&&trace&&!result){
      const m=a.batteryFeedbackMemo;let why='other';
      if(!m)why='no_memo';else if(h.now()>=m.validUntil)why='expired';
      else if(a.commandPublishing||a.pendingResult||a.pendingCommandBypassInterval)why='pending';
      else if(lastPreflightState&&lastPreflightState.request===activeRequest){
       const actual=a.getBatteryFeedbackDependencies(lastPreflightState.state,m.result.baseMode==='charge');
       if(actual!==m.dependencies){const old=JSON.parse(m.dependencies),now=JSON.parse(actual);why='dependencies:'+now.map((v,i)=>JSON.stringify(v)!==JSON.stringify(old[i])?i:null).filter(v=>v!==null).join(',');}
       else why='preview_or_output';
      }rejects[why]=(rejects[why]||0)+1;
     }
     return result;
    }
    const result=original(...args);
    if(measuring&&trace&&name==='getEvaluationState'&&phase==='preflight')lastPreflightState={request:activeRequest,key:JSON.stringify(result),state:result,builds:lastPreflightState?.request===activeRequest?(lastPreflightState.builds||0)+1:1};
    return result;
   };
  }
  for(const [name,label] of [['evaluateFastNow','fast'],['evaluateContextNow','context']]){
   const original=a[name].bind(a);a[name]=(...args)=>{const previous=phase;phase=label;try{return original(...args);}finally{phase=previous;}};
  }
  const request=a.requestEvaluate.bind(a);a.requestEvaluate=(...args)=>{const previous=activeRequest;activeRequest=++requestId;try{return request(...args);}finally{activeRequest=previous;}};
  await h.start();const start=h.now();let pv=1200,lastAction='',flips=0;const modes=new Set(),actions=new Set();
  async function tick(i){
   h.setNow(start+i*1000);
   const planned=Number(a.latestResult.plannedChargeW)||1383;
   if(i%5===0){
    const half=Math.floor(i/10)%2;
    const surplus=scenario==='steady_cap'?950:scenario==='flip_cap'?(half?1050:950):
     scenario==='vary_cap'?100+(i%61)*10:scenario==='flip_free'?planned+(half?250:-250):
     scenario==='ramp_free'?planned+Math.round(400*Math.sin(i*Math.PI/30)):600;
    pv=600+surplus;cause='PV';await h.pv(pv);
   }
   cause='P1';await h.grid(600-pv-a.state.lastTotalCommandW);
   cause='timer';await h.flush();
   if(i%60===0){cause='heartbeat';a.runContextHeartbeat();await h.drain();await h.flush();}
   if(measuring){const action=a.latestResult.action;modes.add(a.latestResult.baseMode);actions.add(action);if(lastAction&&action!==lastAction)flips++;lastAction=action;}
  }
  for(let i=1;i<=warmup;i++)await tick(i);
  a.diagnostics.counters={};h.traces.length=0;h.contexts.length=0;requestId=0;
  if(trace){session=new(require('node:inspector').Session)();session.connect();const post=(m,p={})=>new Promise((resolve,reject)=>session.post(m,p,(e,r)=>e?reject(e):resolve(r)));session.postAsync=post;await post('Profiler.enable');await post('Profiler.startPreciseCoverage',{callCount:true,detailed:true});}
  measuring=true;const cpuStart=process.cpuUsage();
  for(let i=warmup+1;i<=warmup+duration;i++)await tick(i);
  const cpu=process.cpuUsage(cpuStart);measuring=false;
  let functionCalls;
  if(trace){const data=await session.postAsync('Profiler.takePreciseCoverage');const code=data.result.find(r=>r.url.endsWith('/lib/ems-engine.js'));functionCalls=Object.fromEntries(code.functions.filter(f=>['computeChargePlanW','plannedChargeFeedback','distributeCommand','finalizeBatteryCommands','evaluate','previewBatteryFeedback','batteryChargeSources','applyPeakGuard'].includes(f.functionName)).map(f=>[f.functionName,f.ranges[0].count]));await session.postAsync('Profiler.stopPreciseCoverage');session.disconnect();session=null;}
  assert.deepEqual(h.errors,[]);assert(modes.size===1&&modes.has('charge'),'source changes must not change base control mode');
  if(scenario.endsWith('_cap'))assert.equal(h.traces.length,0,'the capped output must remain unchanged');
  console.log(JSON.stringify({scenario,trace,node:process.version,seconds:duration,cpuMs:trace?null:(cpu.user+cpu.system)/1000,
   counts,counters:a.diagnostics.counters,commands:h.traces,flexible:h.flexible,contexts:h.contexts.length,modes:[...modes],actions:[...actions],actionChanges:flips,functionCalls,rejects,pairs,events}));
 }finally{if(session)session.disconnect();Date.now=realNow;restore();}
})().catch(e=>{console.error(e);process.exitCode=1;});
