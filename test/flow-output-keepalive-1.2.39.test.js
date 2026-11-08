'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),v8=require('node:v8');
const {boot,DEFAULTS}=require('./startup-harness'),K=require('../lib/flow-output-keepalive');
const originalNow=Date.now;let now=Date.UTC(2026,10,8,6);Date.now=()=>now;
const passed=[],check=async(name,fn)=>{await fn();passed.push(name);};
async function setup(extra={}){
 const count=extra.batteryCount??2,inverted=Boolean(extra.invertBatteryCommand);
 const s={...DEFAULTS,settingsSchemaVersion:71,batteryCount:count,controlEnabled:true,chargeTestPassed:true,peakShaveEnabled:false,evCount:0,hvacCount:0,boilerCount:0,forcedMode:'auto',minSoc:5,safetySoc:7,maxSoc:100,batteryCommandPauseEnabled:false,batteryFlowKeepaliveEnabled:true,...extra};
 const h=await boot(new Map(Object.entries({...s,_chargeTestSignature:`${count}:${inverted?'inverted':'normal'}:${Array(count).fill('single').join('|')}`}))),a=h.app;
 assert.deepEqual(h.errors,[]);for(let n=0;n<250;n++)await Promise.resolve();const requests={context:0,fast:0,flexible:0,pv:0,split:0};
 a.requestContextEvaluate=()=>requests.context++;a.requestEvaluate=()=>requests.fast++;a.queueStatusUpdate=()=>{};a.recordSavingsSample=()=>{};
 a.publishFlexibleLoads=async()=>requests.flexible++;a.publishPvPowerLimit=async()=>requests.pv++;
 const split=a.publishSplitBatteryCommands.bind(a);a.publishSplitBatteryCommands=async(...x)=>{requests.split++;return split(...x);};
 Object.assign(a.state,{gridPowerW:0,pvPowerW:0,batterySoc:Array(count).fill(50),lastTotalCommandW:0});a.inputSeen.grid=true;a.inputSeen.pv=true;a.inputSeen.batterySoc=Array(8).fill(true);
 a.latestResult={canPublishCommands:true,inputReady:true};a.lastEmitAt=0;a.nextCommandAllowedAt=0;
 const battery=[],mode=[];a.commandTrigger.trigger=async(tokens,state)=>battery.push(structuredClone({tokens,state}));a.externalEmsSelfConsumptionTrigger.trigger=async(tokens,state)=>mode.push(structuredClone({tokens,state}));
 const fresh=()=>{a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;};fresh();
 const publish=async(commands=Array(count).fill(-500))=>{
  fresh();a.pendingResult={canPublishCommands:true,candidateCommands:commands,candidateTotalCommandW:commands.reduce((x,y)=>x+y,0),baseMode:'charge',modeLabel:'Netladen',overrideLabel:'',statusText:'Opdracht',nextEventText:'Volgend tarief',_runFlexibleLoadPass:false};await a.emitPending();
 };
 const tick=async()=>{fresh();await K.tick(a,now);};
 const clear=()=>Object.keys(requests).forEach(k=>requests[k]=0);
 return {...h,a,battery,mode,requests,fresh,publish,tick,clear};
}
async function main(){
 await check('No successful normal publication means no replay, including after restart',async()=>{const h=await setup();now+=600000;await h.tick();assert.equal(h.battery.length,0);});
 await check('Exact last successful payload is repeated after five minutes with no control state or extra output changes',async()=>{
  const h=await setup();await h.publish();const first=structuredClone(h.battery[0]);h.clear();const a=h.a,timers=h.timers.length,store=JSON.stringify([...h.store]);
  const before={last:a.lastEmitAt,next:a.nextCommandAllowedAt,state:structuredClone(a.state),commands:a.lastEmittedCommands.slice(),mode:a.lastEmittedMode,override:a.lastEmittedOverride};
  now+=299999;await h.tick();assert.equal(h.battery.length,1);now++;await h.tick();assert.equal(h.battery.length,2);assert.deepEqual(h.battery[1],first);
  assert.equal(a.lastEmitAt,before.last);assert.equal(a.nextCommandAllowedAt,before.next);assert.deepEqual(a.state,before.state);assert.deepEqual(a.lastEmittedCommands,before.commands);assert.equal(a.lastEmittedMode,before.mode);assert.equal(a.lastEmittedOverride,before.override);
  assert.deepEqual(h.requests,{context:0,fast:0,flexible:0,pv:0,split:0});assert.equal(h.timers.length,timers);assert.equal(JSON.stringify([...h.store]),store);assert.equal(a.commandPublishing,false);
 });
 await check('A newer normal publication takes priority and restarts the keepalive deadline',async()=>{
  const h=await setup();await h.publish();now+=240000;await h.publish([-800,-200]);now+=60000;await h.tick();assert.equal(h.battery.length,2);now+=240000;await h.tick();assert.equal(h.battery.length,3);assert.equal(h.battery[2].tokens.total_command,-1000);assert.equal(h.battery[2].tokens.battery1command,-800);
 });
 await check('Zero commands, inversion and eight-battery Flow tokens replay verbatim',async()=>{
  for(const extra of [{},{invertBatteryCommand:true},{batteryCount:8,invertBatteryCommand:true}]){const h=await setup(extra);await h.publish(Array(h.a.getBatteryCount()).fill(0));now+=300000;await h.tick();assert.equal(h.battery.length,2);assert.deepEqual(h.battery[1],h.battery[0]);
   now+=10000;await h.publish(Array(h.a.getBatteryCount()).fill(-500));now+=300000;await h.tick();assert.equal(h.battery.length,4);assert.deepEqual(h.battery[3],h.battery[2]);assert.equal(h.battery[3].tokens.battery1command,extra.invertBatteryCommand?500:-500);
  }
 });
 await check('External ownership and pending handover immediately suppress battery replay',async()=>{
  const h=await setup({hybridEmsEnabled:true});await h.publish();now+=300000;h.a.hybridEmsRuntime.delegated=true;await h.tick();assert.equal(h.battery.length,1);
  h.a.hybridEmsRuntime.delegated=false;h.a.hybridEmsRuntime.status='handover_wait';await h.tick();assert.equal(h.battery.length,1);
 });
 await check('External-mode keepalive uses existing tokens without changing any Hybrid watchdog or ownership state',async()=>{
  const h=await setup({hybridEmsEnabled:true,externalEmsFlowKeepaliveEnabled:true});Object.assign(h.a.hybridEmsRuntime,{delegated:true,modeRequestedAt:now,status:'external_control',staleOutsideSince:now-120000,retrySentAt:0});
  await h.a.requestExternalEmsSelfConsumption('self_consumption',false);const before=structuredClone(h.a.hybridEmsRuntime);h.clear();now+=300000;await h.tick();assert.equal(h.mode.length,2);assert.deepEqual(h.mode[1].tokens,{reason:'keepalive',retry:0});assert.deepEqual(h.a.hybridEmsRuntime,before);assert.deepEqual(h.requests,{context:0,fast:0,flexible:0,pv:0,split:0});
  h.a.hybridEmsRuntime.delegated=false;h.a.hybridEmsRuntime.takeover=true;now+=300000;await h.tick();assert.equal(h.mode.length,2);
 });
 await check('Watchdog retry and fallback timelines are identical with mode keepalive enabled or disabled',async()=>{
  async function trace(enabled){
   const h=await setup({hybridEmsEnabled:true,externalEmsFlowKeepaliveEnabled:enabled});const start=now;Object.assign(h.a.hybridEmsRuntime,{delegated:true,modeRequestedAt:start,status:'external_control',externalSetpointW:0,externalSetpointAt:start,externalSetpointChangedAt:start});
   const trace=[];for(let n=0;n<=12;n++){now=start+n*60000;h.fresh();h.a.state.gridPowerW=1000;await h.tick();h.a.monitorHybridExternalControl(h.a.getSettings(),now);await Promise.resolve();const r=h.a.hybridEmsRuntime;trace.push({minute:n,delegated:r.delegated,takeover:r.takeover,status:r.status,stale:r.staleOutsideSince?Math.round((r.staleOutsideSince-start)/60000):null,retry:r.retrySentAt?Math.round((r.retrySentAt-start)/60000):null});}
   return {trace,retries:h.mode.filter(x=>x.tokens.retry===1).length,keepalives:h.mode.filter(x=>x.tokens.reason==='keepalive').length};
  }
  const off=await trace(false),on=await trace(true);assert.deepEqual(on.trace,off.trace);assert.equal(on.retries,off.retries);assert.equal(on.retries,1);assert(on.keepalives>0);assert(on.trace.some(x=>x.takeover));
 });
 await check('Both options off preserve outputs and allocate no extra timers or settings writes',async()=>{
  const h=await setup({batteryFlowKeepaliveEnabled:false,externalEmsFlowKeepaliveEnabled:false});await h.publish();const timers=h.timers.length,stored=JSON.stringify([...h.store]);h.clear();now+=3600000;await h.tick();assert.equal(h.battery.length,1);assert.equal(h.mode.length,0);assert.equal(h.timers.length,timers);assert.equal(JSON.stringify([...h.store]),stored);assert.deepEqual(h.requests,{context:0,fast:0,flexible:0,pv:0,split:0});
 });
 await check('Tests, missing/stale inputs, disabled control, pending work, invalid approval and command pauses block replay',async()=>{
  for(const kind of ['chargeTestRunning','chargeTestAwaitingConfirmation','chargeTestOperationRunning','response','publishing','pending','blocked','control','stale','unapproved','pause']){
   const h=await setup();await h.publish();now+=300000;h.fresh();
   if(kind.startsWith('chargeTest'))h.a[kind]=true;
   else if(kind==='response')h.a.batteryResponseTest={running:true};
   else if(kind==='publishing')h.a.commandPublishing=true;
   else if(kind==='pending')h.a.pendingResult={};
   else if(kind==='blocked')h.a.latestResult.canPublishCommands=false;
   else if(kind==='control')h.a.setSetting('controlEnabled',false);
   else if(kind==='stale')h.a.inputUpdatedAt.grid=now-3600000;
   else if(kind==='unapproved')h.a.setSetting('chargeTestPassed',false);
   else if(kind==='pause')h.a.getBatteryCommandPauseInfo=()=>({active:true});
   await K.tick(h.a,now);assert.equal(h.battery.length,1,kind);
  }
 });
 await check('A failed normal publication removes the old receipt; a failed replay releases the mutex',async()=>{
  const h=await setup();await h.publish();now+=10000;h.a.commandTrigger.trigger=async()=>{throw Error('simulated transport failure');};await assert.rejects(h.publish([-200,-200]),/transport failure/);assert.equal(h.a.flowOutputKeepalive.battery,null);now+=300000;await h.tick();assert.equal(h.a.commandPublishing,false);
  const k=await setup();await k.publish();now+=300000;k.a.commandTrigger.trigger=async()=>{throw Error('replay failed');};await assert.rejects(k.tick(),/replay failed/);assert.equal(k.a.commandPublishing,false);
 });
 await check('Shared publication mutex prevents duplicate replay and releases an already queued normal command',async()=>{
  const h=await setup();await h.publish();h.clear();now+=300000;h.fresh();let release;const sent=[];h.a.commandTrigger.trigger=async(t,s)=>{sent.push(structuredClone({t,s}));if(sent.length===1)await new Promise(r=>release=r);};
  const first=K.tick(h.a,now);assert(h.a.commandPublishing);await K.tick(h.a,now);assert.equal(sent.length,1);
  const publishing=h.publish([-250,-250]);await publishing;assert(h.a.pendingResult);release();await first;for(let i=0;i<100;i++)await Promise.resolve();assert.equal(sent.length,2);assert.equal(sent[1].t.total_command,-500);assert.equal(h.a.commandPublishing,false);assert.equal(h.requests.fast,0);
 });
 await check('No stale replay after changed sign/limits or a split/phase-modified output',async()=>{
  for(const key of ['maxTotalChargeW','invertBatteryCommand','phaseGuard']){const h=await setup();await h.publish();h.a.setSetting(key,key==='phaseGuard'?{...h.a.getSettings().phaseGuard,enabled:false,limitW:1000}:key==='invertBatteryCommand'?true:100);now+=300000;await h.tick();assert.equal(h.battery.length,1,key);}
  const h=await setup();await h.publish();h.a.lastEmittedCommands=[-100,-100];now+=300000;await h.tick();assert.equal(h.battery.length,1);
  const z=await setup();await z.publish([0,0]);z.a.lastEmittedCommands=[0,0];now+=300000;await z.tick();assert.equal(z.battery.length,1,'a completed test cannot make an older equal-valued normal receipt current again');
 });
 await check('An in-flight external mode write suppresses battery replay during ownership return',async()=>{
  const h=await setup({hybridEmsEnabled:true});await h.publish();now+=300000;h.fresh();let release;
  h.a.externalEmsSelfConsumptionTrigger.trigger=async()=>new Promise(r=>release=r);
  const external=h.a.requestExternalEmsSelfConsumption('watchdog_retry',true);assert.equal(h.a.flowOutputKeepalive.externalPublishing,1);
  h.a.hybridEmsRuntime.takeover=true;await h.tick();assert.equal(h.battery.length,1);release();await external;await h.tick();assert.equal(h.battery.length,1,'an external mode write invalidates the old ownership receipt');await h.publish();now+=300000;await h.tick();assert.equal(h.battery.length,3);
 });
 await check('Mode replay uses the publication mutex, keeps watchdog retry independent and lets queued takeover output finish afterwards',async()=>{
  const h=await setup({hybridEmsEnabled:true,externalEmsFlowKeepaliveEnabled:true});await h.publish();const start=now;
  Object.assign(h.a.hybridEmsRuntime,{delegated:true,modeRequestedAt:start,status:'external_control'});now+=300000;h.fresh();let release,watchdog=0;
  h.a.externalEmsSelfConsumptionTrigger.trigger=async tokens=>{if(tokens.reason==='keepalive')await new Promise(r=>release=r);else if(tokens.reason==='watchdog_retry')watchdog++;};
  const repeat=K.tick(h.a,now);assert(h.a.commandPublishing);
  h.a.state.gridPowerW=1000;h.a.hybridEmsRuntime.staleOutsideSince=now-300000;h.a.monitorHybridExternalControl(h.a.getSettings(),now);assert.equal(watchdog,1);assert.equal(h.a.hybridEmsRuntime.retrySentAt,now);
  h.a.hybridEmsRuntime.delegated=false;h.a.hybridEmsRuntime.takeover=true;await h.publish([-250,-250]);assert.equal(h.battery.length,1);assert(h.a.pendingResult);
  release();await repeat;for(let i=0;i<100;i++)await Promise.resolve();assert.equal(h.battery.length,2);assert.equal(h.battery[1].tokens.total_command,-500);assert.equal(h.a.commandPublishing,false);assert.equal(h.a.hybridEmsRuntime.modeRequestedAt,start);assert.equal(h.a.hybridEmsRuntime.retrySentAt,now);
 });
 await check('Current SoC bounds, Peak Guard and EV discharge protection continue to suppress unsafe replay',async()=>{
  const h=await setup();await h.publish();h.a.state.batterySoc=[100,100];now+=300000;await h.tick();assert.equal(h.battery.length,1);
  const p=await setup({peakShaveEnabled:true,peakLimitW:2000,peakSoftMarginW:100});await p.publish();p.a.state.gridPowerW=2500;now+=300000;await p.tick();assert.equal(p.battery.length,1);
  const e=await setup();await e.publish([500,500]);e.a.getEvBatteryDischargePolicy=()=>({blocked:true});now+=300000;await e.tick();assert.equal(e.battery.length,1);
 });
 await check('Existing minute heartbeat executes replay without a new timer or evaluator',async()=>{
  const h=await setup();await h.publish();h.clear();now+=300000;h.fresh();const count=h.timers.length;
  const heartbeat=h.timers.find(x=>x.type==='interval'&&x.ms===60000&&String(x.fn).includes('runContextHeartbeat'));
  assert(heartbeat);h.a.sampleDiagnostics=()=>{};h.a.runContextHeartbeat=()=>{};h.a.runEvHeartbeat=async()=>{};heartbeat.fn();for(let i=0;i<30;i++)await Promise.resolve();assert.equal(h.battery.length,2);assert.equal(h.timers.length,count);assert.deepEqual(h.requests,{context:0,fast:0,flexible:0,pv:0,split:0});
 });
 await check('Intervals are independent and clamp to 1–60 minutes; default is five minutes',async()=>{
  for(const [minutes,elapsed,expected] of [[1,60000,2],[0,60000,1],[undefined,300000,2],[90,3599999,1],[-10,60000,2]]){const h=await setup({batteryFlowKeepaliveMinutes:minutes});await h.publish();now+=elapsed;await h.tick();assert.equal(h.battery.length,expected,String(minutes));}
 });
 const h=await setup({batteryFlowKeepaliveEnabled:false});await h.publish();const cpu=process.cpuUsage(),start=performance.now();for(let i=0;i<10000;i++)await K.tick(h.a,now);const used=process.cpuUsage(cpu);
 const report={passed:passed.length,cases:passed,benchmark:{hostOnly:true,calls:10000,cpuMs:(used.user+used.system)/1000,wallMs:performance.now()-start,receiptSerializedBytes:v8.serialize(h.a.flowOutputKeepalive).byteLength,additionalTimers:0,additionalListeners:0,periodicSettingWrites:0}};
 fs.writeFileSync('validation/flow-output-keepalive-1.2.39.json',JSON.stringify(report,null,2)+'\n');console.log(`Flow keepalive: ${passed.length} scenario groups passed; ${JSON.stringify(report.benchmark)}`);
}
main().catch(e=>{console.error('After:',passed.at(-1));console.error(e.stack);process.exitCode=1;}).finally(()=>Date.now=originalNow);
