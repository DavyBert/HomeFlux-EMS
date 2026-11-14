'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),v8=require('node:v8');
const H=require('../lib/hvac-permanent'),L=require('../lib/hvac-learning');
const {boot,DEFAULTS}=require('./startup-harness');
const nativeNow=Date.now;let now=Date.UTC(2026,10,7,12);Date.now=()=>now;
const cases=[],check=async(name,fn)=>{await fn();cases.push(name);};
function fixture(extra={}){
 const store=new Map(),s={batteryCount:0,evCount:0,hvacCount:10,...extra},settings=Array.from({length:10},()=>({hvacEnabled:true,hvacAutomaticControlEnabled:true,hvacDirection:'heat',hvacControlIntervalMinutes:5,hvacCoordination:{}}));
 const inputs=Array.from({length:4},()=>({seen:{connected:true,chargeCurrent:true},connected:false,chargeCurrentA:0,updatedAt:{chargeCurrent:now}}));
 const a={homey:{settings:{get:k=>store.get(k)}},state:{gridPowerW:500,pvPowerW:0,lastTotalCommandW:0},inputSeen:{grid:true,pv:true},inputUpdatedAt:{grid:now,pv:now},
  evSessionDetection:{houseHistory:[]},boilerState:{outputOn:false},writes:0,getSettings:()=>s,getHvacCount:()=>s.hvacCount,getBatteryCount:()=>s.batteryCount,getEvCount:()=>s.evCount,
  getHvacInstanceSettings:i=>settings[i],getHvacInputSnapshot:()=>({roomTemperatureC:18}),getEvInputSnapshot:i=>inputs[i],
  getEvMeasuredCurrent:(i,v,t)=>({currentA:v.chargeCurrentA,updatedAt:v.updatedAt.chargeCurrent,fresh:v.seen.chargeCurrent&&t>=v.updatedAt.chargeCurrent&&t-v.updatedAt.chargeCurrent<=30000}),
  getGridFreshness:(_,t)=>({fresh:a.inputSeen.grid&&t-a.inputUpdatedAt.grid<=30000}),setSetting:(k,v)=>{a.writes++;store.set(k,structuredClone(v));}};
 H.unit(a,0);return {a,s,settings,inputs,store};
}
function point(a,load,{pv=0,battery=0,feedback=true,refreshPv=true,refreshGrid=true}={}){
 a.state.gridPowerW=load-pv-battery;a.state.pvPowerW=pv;
 if(refreshGrid)a.inputUpdatedAt.grid=now;if(refreshPv)a.inputUpdatedAt.pv=now;
 if(feedback)L.batteryFeedback(a,battery,now);
 for(let i=0;i<a.getEvCount();i++)a.getEvInputSnapshot(i).updatedAt.chargeCurrent=now;
 H.observe(a,now);
}
function reference(a,options={}){
 const start=now;L.prepare(a,0,now);
 for(let i=0;i<=18;i++){now=start+i*10000;point(a,500+(options.noise?Math.sin(i*2)*options.noise:0),typeof options.sample==='function'?options.sample(i):options);}
}
function attempt(a,options={}){
 reference(a,options);const start=now;
 H.begin(a,0,{direction:options.mode||'heat',manualLearning:Boolean(options.manual)},now);
 if(!H.runtime(a).observation)return false;
 for(let i=1;i<=30;i++){
  now=start+i*10000;if(options.missing===i)continue;
  options.event?.(i);
  const signal=typeof options.power==='function'?options.power(i):options.power??900;
  point(a,500+signal+(options.noise?Math.sin(i*2)*options.noise:0),typeof options.sample==='function'?options.sample(i+19):options);
 }
 H.finish(a,now);return true;
}
async function main(){
 await check('A +10 W command is not physical evidence and does not blindly block with physical telemetry',()=>{
  const {a}=fixture({batteryCount:4});a.state.lastTotalCommandW=10;assert(attempt(a,{battery:500}));assert.equal(H.unit(a,0).heatProvisionalW,900);assert.equal(H.unit(a,0).heat,null);
 });
 await check('Four active batteries and 350 W changing PV are corrected with the measured discharge/charge signs',()=>{
  const {a}=fixture({batteryCount:4});a.state.lastTotalCommandW=-2400;
  for(let n=0;n<3;n++)assert(attempt(a,{sample:i=>({pv:3000+(i%2)*350,battery:i%2?1400:-2400}),noise:80}));
  assert(Math.abs(H.unit(a,0).heat-900)<=40);assert.equal(H.status(a,0).heatSamples,3);assert.equal(H.unit(a,0).heatReview,false);
 });
 await check('Fresh external reports take priority and stale reports fall back to the current Hybrid setpoint',()=>{
  const {a}=fixture({batteryCount:4});a.hybridEmsRuntime={delegated:true,takeover:false,externalSetpointW:1000,externalSetpointAt:now};
  assert.equal(L.meter(a,now).battery,1000);
  assert.equal(L.meter(a,now).batterySource,'external_setpoint');
  L.batteryFeedback(a,1500,now);assert.equal(L.meter(a,now).battery,1500);
  for(const at of [now-16000,now+1]){
   a.hvacLearningBattery={powerW:777,at};
   assert.equal(L.meter(a,now).battery,1000);
   assert.equal(L.meter(a,now).batterySource,'external_setpoint');
  }
  a.hybridEmsRuntime.externalSetpointW=-900;
  assert.equal(L.meter(a,now).battery,-900);
  assert.equal(L.meter(a,now).watts,-400);
 });
 await check('Changing HomeFlux battery commands during baseline and HVAC learning are corrected per P1 sample',()=>{
  const {a}=fixture({batteryCount:4});
  for(let trial=0;trial<3;trial++){
   assert(attempt(a,{sample:i=>{
    const battery=i%4===0?-1800:i%4===1?1600:i%4===2?0:600;
    a.state.lastTotalCommandW=battery;
    return {battery,pv:3000+(i%2)*350,feedback:false};
   }}));
  }
  assert.equal(H.unit(a,0).heat,900);
  assert.equal(H.status(a,0).heatSamples,3);
  assert.equal(H.status(a,0).heatBatterySource,'commanded');
 });
 await check('Loss of physical feedback does not cancel learning when command data is available',()=>{
  const {a}=fixture({batteryCount:4});a.state.lastTotalCommandW=800;
  reference(a,{battery:800});const start=now;H.begin(a,0,{direction:'heat'},now);
  for(let i=1;i<=30;i++){
   now=start+i*10000;
   const battery=i*90;a.state.lastTotalCommandW=battery;
   point(a,1400,{battery,feedback:i<10});
  }
  H.finish(a,now);assert.equal(H.unit(a,0).heatProvisionalW,900);
  assert.equal(H.status(a,0).heatSamples,1);
 });
 await check('Strong PV changes without fresh correction reject; future, negative and old PV inputs are not measurements',()=>{
  const {a}=fixture();assert(attempt(a,{event:i=>{if(i>8)a.inputSeen.pv=false;},sample:i=>({pv:i*350})}));assert.equal(H.unit(a,0).heatSamples||0,0);assert.equal(H.status(a,0).heatReason,L.reasons.pv);
  for(const [value,at] of [[1000,now+1],[-1,now],[1000,now-61000]]){a.inputSeen.pv=true;a.state.pvPowerW=value;a.inputUpdatedAt.pv=at;assert.equal(L.meter(a,now).reason,L.reasons.pv);}
 });
 await check('A stable PV source reporting once per minute remains usable with fresh P1 observations',()=>{
  const {a}=fixture();assert(attempt(a,{sample:i=>({pv:3000,refreshPv:i%6===0})}));assert.equal(H.unit(a,0).heatProvisionalW,900);
 });
 await check('A stable second HVAC is allowed; a second HVAC start or fan/mode change invalidates attribution',()=>{
  let {a}=fixture();Object.assign(H.unit(a,1),{setpoint:24,mode:'heat'});assert(attempt(a));assert.equal(H.unit(a,0).heatProvisionalW,900);
  ({a}=fixture());assert(attempt(a,{event:i=>{if(i===12)H.inputChanged(a,1,'mode','heat');}}));assert.equal(H.status(a,0).heatReason,L.reasons.other);assert.equal(H.unit(a,0).heatSamples||0,0);
 });
 await check('Normal 500–1000 W modulation, 100 W background noise and one large outlier remain learnable',()=>{
  const {a}=fixture();assert(attempt(a,{power:i=>i===17?9000:750+250*Math.sin(i*2),noise:100}));
  assert(H.unit(a,0).heatProvisionalW>=600&&H.unit(a,0).heatProvisionalW<=900);
 });
 await check('Compressor startup peak is excluded and a single missing P1 sample is tolerated',()=>{
  const {a}=fixture();assert(attempt(a,{power:i=>i<6?6000:900,missing:13}));assert.equal(H.unit(a,0).heatProvisionalW,900);
 });
 await check('Small indistinguishable signal, strong unexplained modulation and missing P1 data are refused',()=>{
  for(const options of [{power:80,noise:150},{power:i=>i%2?300:3000},{event:i=>{if(i===8)now+=100000;},sample:()=>({refreshGrid:false})}]){
   const {a}=fixture();attempt(a,options);assert.equal(H.unit(a,0).heatSamples||0,0);assert.equal(H.unit(a,0).heat,null);
  }
 });
 await check('A connected EV with fresh zero current is allowed, whereas a charging transition invalidates the event',()=>{
  let f=fixture({evCount:1});f.inputs[0].connected=true;assert(attempt(f.a));assert.equal(H.unit(f.a,0).heatProvisionalW,900);
  f=fixture({evCount:1});f.inputs[0].connected=true;assert(attempt(f.a,{event:i=>{if(i===11)f.inputs[0].chargeCurrentA=6;}}));assert.equal(H.status(f.a,0).heatReason,L.reasons.ev);
  f.inputs[0].chargeCurrentA=0;f.inputs[0].updatedAt.chargeCurrent=now-60000;assert(!H.evFree(f.a,now));
 });
 await check('Boiler OFF is allowed; ON without actual telemetry is excluded',()=>{
  const {a}=fixture();assert(attempt(a));a.boilerState.outputOn=true;assert.equal(L.meter(a,now).reason,L.reasons.boiler);
 });
 await check('Confidence grows over three independent attempts, keeps heat/cool separate and survives restart',()=>{
  const {a,store,settings}=fixture();settings[0].hvacDirection='auto';for(let n=1;n<=3;n++){assert(attempt(a));assert.equal(H.status(a,0).heatSamples,n);assert.equal(H.unit(a,0).heat,n===3?900:null);}
  const saved=structuredClone(store.get('_hvacPermanent')),restart=fixture().a;restart.homey.settings.get=k=>k==='_hvacPermanent'?saved:null;delete restart.hvacPermanentRuntime;
  assert.equal(H.unit(restart,0).heat,900);assert.equal(H.status(restart,0).heatSamples,3);assert.equal(H.unit(restart,0).cool,null);
  assert(attempt(a,{mode:'cool',power:700}));assert.equal(H.unit(a,0).heat,900);assert.equal(H.unit(a,0).cool,null);
 });
 await check('A bad review does not destroy stored reliable power; retry later succeeds without a manual reset',()=>{
  const {a}=fixture();H.unit(a,0).heat=1100;H.recheck(a,0,'heat');assert(attempt(a,{power:50}));assert.equal(H.unit(a,0).heat,1100);
  assert(attempt(a,{power:1050}));assert.equal(H.unit(a,0).heat,1100);assert.equal(H.unit(a,0).heatSamples,1);
  assert(attempt(a,{power:1070}));assert.equal(H.unit(a,0).heat,1100);
  assert(attempt(a,{power:1060}));assert.equal(H.unit(a,0).heat,1060);assert.equal(H.unit(a,0).heatReview,false);
 });
 await check('Direct mode remains excluded from automatic learning, and one observation serves all ten channels',()=>{
  const {a,settings}=fixture();settings[0].hvacCoordination.DirectTariffEnabled=true;reference(a);H.begin(a,0,{direction:'heat'},now);assert.equal(H.runtime(a).observation,null);
  settings[0].hvacCoordination.DirectTariffEnabled=false;reference(a);H.begin(a,0,{direction:'heat'},now);const first=H.runtime(a).observation;assert(first);
  for(let i=1;i<10;i++)H.begin(a,i,{direction:'heat'},now);assert.equal(H.runtime(a).observation,first);
 });
 await check('Persistence is deduplicated, P1 never saves, and buffers stay capped for ten devices',()=>{
  const {a}=fixture();H.persist(a);let writes=a.writes;for(let n=0;n<50;n++)H.persist(a);assert.equal(a.writes,writes);
  reference(a);const start=now;H.begin(a,0,{direction:'heat'},now);writes=a.writes;
  for(let i=1;i<=300;i++){now=start+i*1000;point(a,1400);}assert.equal(a.writes,writes);assert(H.runtime(a).observation.points.length<=40);
 });
 await check('Physical input Flow is reused outside Hybrid without changing commands, and connected zero-current receipts do not cancel',async()=>{
  const h=await boot(new Map(Object.entries({...DEFAULTS,settingsSchemaVersion:71,hvacCount:1,batteryCount:4,evCount:1}))),a=h.app;
  assert.deepEqual(h.errors,[]);a.requestContextEvaluate=()=>{};const oldCommand=a.state.lastTotalCommandW;
  a.handleExternalEmsSetpoint(-1500,now);assert.deepEqual(a.hvacLearningBattery,{powerW:-1500,at:now});assert.equal(a.state.lastTotalCommandW,oldCommand);
  H.runtime(a).observation={index:0,mode:'heat',points:[],startAt:now,endAt:now+300000};
  a.updateEvStatusInput(0,true,0,now);assert(H.runtime(a).observation);a.updateEvStatusInput(0,true,6,now);assert.equal(H.runtime(a).observation,null);assert.equal(H.status(a,0).heatReason,L.reasons.ev);
  a.getSettings();const cache=a.settingsCache,runtime=a.cachedRuntimeSettings={sentinel:true},revision=a.evPhysicalConfigRevision;
  await h.setExternalSetting('_hvacPermanent',{version:1,nextAt:0,units:{}});assert.equal(a.settingsCache,cache);assert.equal(a.cachedRuntimeSettings,runtime);assert.equal(a.evPhysicalConfigRevision,revision);
 });
 await check('Manual relearning with four measured batteries can acquire a reference while keeping previous trusted watts',()=>{
  const {a,settings}=fixture({batteryCount:4});H.unit(a,0).heat=1000;settings[0].hvacCoordination.DirectTariffEnabled=true;
  H.runtime(a).manualQueue=[{index:0,requestedAt:now}];assert.equal(H.canBegin(a,0,now),null);assert.equal(H.status(a,0).waitingReason,L.reasons.reference);assert(attempt(a,{battery:1400,manual:true,power:950}));
  assert.equal(H.unit(a,0).heat,1000);assert.equal(H.unit(a,0).heatProvisionalW,950);assert.equal(H.status(a,0).heatSamples,1);
 });
 await check('API HVAC input changes invalidate attribution without changing comfort-cycle ownership',async()=>{
  const h=await boot(new Map(Object.entries({...DEFAULTS,settingsSchemaVersion:71,hvacCount:2,batteryCount:0,evCount:0}))),a=h.app;
  a.requestContextEvaluate=()=>{};a.requestEvaluate=()=>{};
  Object.assign(H.unit(a,0),{setpoint:22,mode:'heat'});H.unit(a,1);
  const cycle={mode:'heat',target:22,reached:false};H.runtime(a).comfortCycles={0:cycle};
  H.runtime(a).observation={index:0,mode:'heat',points:[],startAt:now,endAt:now+300000};
  a.setInput({hvac:{mode:'heat',setpointC:22}});assert.equal(H.runtime(a).observation.invalidReason,undefined);
  a.setInput({hvacs:[null,{mode:'cool'}]});assert.equal(H.runtime(a).observation.invalidReason,L.reasons.other);
  assert.equal(H.runtime(a).comfortCycles[0],cycle);
  H.slowTick(a,now);assert.equal(H.runtime(a).observation,null);
 });
 await check('A small scheduler delay does not reject a completed valid window or extend its measurements',()=>{
  const {a}=fixture();reference(a);const start=now;H.begin(a,0,{direction:'heat'},now);
  for(let n=1;n<=30;n++){now=start+n*10000;point(a,1400);}
  const count=H.runtime(a).observation.points.length;now+=90000;point(a,9000);
  assert.equal(H.runtime(a).observation.points.length,count);H.finish(a,now);
  assert.equal(H.unit(a,0).heatProvisionalW,900);assert.equal(H.unit(a,0).heatLastValidAt,start+300000);
 });
 await check('A household load change before the command cannot be attributed to the HVAC start',()=>{
  const {a}=fixture();reference(a);a.state.gridPowerW=1500;
  H.begin(a,0,{direction:'heat'},now);assert.equal(H.runtime(a).observation,null);assert.equal(H.status(a,0).heatReason,L.reasons.reference);
 });
 await check('One physical start cannot be counted twice; an active incremental setpoint increase is not certified as full device power',()=>{
  const {a}=fixture();reference(a);H.begin(a,0,{direction:'heat',currentMode:'heat',currentSetpointC:24,roomTemperatureC:18},now);assert.equal(H.runtime(a).observation,null);assert.equal(H.status(a,0).heatReason,L.reasons.step);
  const u=H.unit(a,0);assert.equal(L.accept(u,'heat',{power:900,uncertainty:10},now,now-300000),false);assert.equal(L.accept(u,'heat',{power:900,uncertainty:10},now,now-300000),false);assert.equal(u.heatEvidence.length,1);
 });
 const bench=fixture({batteryCount:4}),a=bench.a;reference(a,{battery:800});H.begin(a,0,{direction:'heat'},now);const start=now;
 global.gc?.();const heap=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),wall=performance.now();
 for(let n=1;n<=30000;n++){now=start+n*10;point(a,1400,{battery:800});}
 const elapsed=performance.now()-wall,used=process.cpuUsage(cpu);global.gc?.();
 const memory={retainedHeapDeltaBytes:process.memoryUsage().heapUsed-heap,serializedLearnerBytes:v8.serialize({reference:a.hvacPermanentRuntime.learningReference,observation:a.hvacPermanentRuntime.observation,units:a.hvacPermanentRuntime.units}).byteLength,maxReferencePoints:40,maxObservationPoints:40,maxEvidencePerMode:5,observations:1};
 fs.writeFileSync('validation/hvac-learning-1.2.38.json',JSON.stringify({passed:cases.length,cases,benchmark:{hostOnly:true,physicalHomeyMeasured:false,calls:30000,simulatedSeconds:300,cpuMs:(used.user+used.system)/1000,wallMs:elapsed,...memory}},null,2));
 console.log(`HVAC learning 1.2.38: ${cases.length} scenario groups passed; ${JSON.stringify(memory)}`);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>Date.now=nativeNow);
