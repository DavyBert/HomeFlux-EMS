'use strict';
// Optional host measurement, separate from regression execution. Real HVAC
// decision/portfolio/Flow functions; only transport, EV portfolio and time are
// controlled. No claim about Homey CPU or compressor response is implied.
const fs=require('node:fs'),path=require('node:path');
const current=path.resolve(__dirname,'..'),previous=path.resolve(process.argv[2]||'../../v1.2.14/HomeFlux-EMS');
let now=Date.UTC(2026,10,1,12);const nativeNow=Date.now;Date.now=()=>now;
async function fixture(root,count,changing) {
 const {boot,DEFAULTS}=require(root+'/test/startup-harness');
 const settings={...DEFAULTS,settingsSchemaVersion:71,hvacCount:count,evCount:0,batteryCount:0,boilerCount:0,controlEnabled:false,peakShaveEnabled:false};
 for(let i=0;i<count;i++)for(const [suffix,v]of Object.entries({Enabled:true,PermanentEnabled:true,TariffEnabled:true,Direction:'heat',AllowSetpointControl:true,AllowModeControl:true,CheapTargetC:23,NormalTargetC:21,ExpensiveTargetC:19}))settings[`hvac${i?i+1:''}${suffix}`]=v;
 const h=await boot(new Map(Object.entries(settings))),a=h.app,H=require(root+'/lib/hvac-permanent');a.requestContextEvaluate=()=>{};a.requestEvaluate=()=>{};
 for(let n=0;n<300;n++)await Promise.resolve();
 a.state.gridPowerW=400;a.state.pvPowerW=0;a.state.lastTotalCommandW=0;a.inputSeen.grid=true;a.inputSeen.pv=true;
 let publications=0,settingsBuilds=0,calculations=0;
 const getSettings=a.getHvacInstanceSettings.bind(a),calculate=a.calculateHvacControl.bind(a);
 a.getHvacInstanceSettings=(...args)=>{settingsBuilds++;return getSettings(...args);};a.calculateHvacControl=(...args)=>{calculations++;return calculate(...args);};
 a.publishEvPortfolio=async()=>({evDecisions:[],adjustedGridW:400,totalActualEvPowerW:0,totalDesiredEvPowerW:0,evStartedThisCycle:false});
 h.cards.get('hvac_setpoint_updated_for_configured').trigger=async()=>{publications++;};
 for(let i=0;i<count;i++) {
  const setpoint=changing?20:23;
  if(!i){a.state.hvacRoomTemperatureC=21;a.state.hvacSetpointC=setpoint;a.state.hvacMode='heat';Object.assign(a.inputSeen.hvac,{roomTemperature:true,setpoint:true,mode:true});a.lastPublishedHvacSetpoint=setpoint;a.lastPublishedHvacMode='heat';}
  else{const r=a.getExtraHvac(i);Object.assign(r.state,{roomTemperatureC:21,setpointC:setpoint,mode:'heat'});Object.assign(r.seen,{roomTemperature:true,setpoint:true,mode:true});r.lastPublishedSetpoint=setpoint;r.lastPublishedMode='heat';}
  Object.assign(H.unit(a,i),{setpoint,mode:'heat',heat:1000,heatReview:false});
 }
 async function run(n) {
  for(let k=0;k<n;k++){
   now+=300000;a.inputUpdatedAt.grid=now;a.inputUpdatedAt.pv=now;
   a.latestResult={tariff:{className:changing?(k%2?'expensive':'cheap'):'cheap'}};
   a.flexiblePriorityState.nextEvaluationAt=0;
   await a.publishFlexibleLoads(a.latestResult,0,0);
  }
 }
 return {run,counts:()=>({publications,settingsBuilds,calculations}),reset:()=>{publications=0;settingsBuilds=0;calculations=0;}};
}
async function measure() {
 const results=[];
 for(const count of [0,5,10])for(const changing of [false,true]){
  if(!count&&changing)continue;
  const a=await fixture(previous,count,changing),b=await fixture(current,count,changing);
  await a.run(100);await b.run(100);
  const rounds={previous:[],current:[]};
  for(let round=0;round<7;round++)for(const [name,f]of round%2?[['current',b],['previous',a]]:[['previous',a],['current',b]]){
   global.gc?.();const heapBefore=process.memoryUsage().heapUsed;f.reset();const cpu=process.cpuUsage(),wall=process.hrtime.bigint();
   await f.run(250);const used=process.cpuUsage(cpu),wallMs=Number(process.hrtime.bigint()-wall)/1e6;global.gc?.();
   rounds[name].push({cpuMs:(used.user+used.system)/1000,wallMs,retainedHeapBytes:process.memoryUsage().heapUsed-heapBefore,...f.counts()});
  }
  results.push({count,scenario:changing?'tariff-changing':'stable-targets',warmupPasses:100,passesPerRound:250,rounds});
 }
 const report={environment:{node:process.version,platform:process.platform,measurement:'Node host CPU and retained heap; mocked transport; no Homey device measurements'},results};
 fs.writeFileSync(current+'/validation/hvac-host-1.2.15.json',JSON.stringify(report,null,2)+'\n');
 for(const x of results){const median=name=>x.rounds[name].map(r=>r.cpuMs).sort((a,b)=>a-b)[3];console.log(`${x.count} ${x.scenario}: median CPU / 250 passes: 1.2.14=${median('previous').toFixed(1)} ms; 1.2.15=${median('current').toFixed(1)} ms`);}
}
async function memory() {
 if(!global.gc)throw new Error('Run with --expose-gc.');
 const f=await fixture(current,10,true);await f.run(500);global.gc();
 const samples=[{passes:0,heapUsed:process.memoryUsage().heapUsed}];
 for(let i=1;i<=8;i++){await f.run(500);global.gc();samples.push({passes:i*500,heapUsed:process.memoryUsage().heapUsed});}
 const report={environment:'Node host; real HVAC functions, mocked Flow transport; after 500 warmup passes; GC before every sample',samples,
  retainedChangeBytes:samples.at(-1).heapUsed-samples[0].heapUsed,rangeBytes:Math.max(...samples.map(s=>s.heapUsed))-Math.min(...samples.map(s=>s.heapUsed))};
 fs.writeFileSync(current+'/validation/hvac-memory-1.2.15.json',JSON.stringify(report,null,2)+'\n');
 console.log(`Host memory: 4000 changing ten-HVAC passes; retained change ${Math.round(report.retainedChangeBytes/1024)} KiB, range ${Math.round(report.rangeBytes/1024)} KiB. No Homey memory measurement.`);
}
(process.argv.includes('--memory-only')?memory():measure()).catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{Date.now=nativeNow;});
