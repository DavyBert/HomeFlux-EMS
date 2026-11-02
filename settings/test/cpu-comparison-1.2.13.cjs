'use strict';
// Usage: node --expose-gc test/cpu-comparison-1.2.13.cjs ROOT MODE REPORT
// MODE: bench (warmed process CPU/heap), replay (exact output/time comparison).
// Homey I/O and clock are simulated; app/planner/engine/schedulers are real.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),mode=process.argv[3]||'bench',report=process.argv[4];
let calls={};
const wrap=(object,name)=>{const fn=object[name];object[name]=function(...args){calls[name]=(calls[name]||0)+1;return fn.apply(this,args);};};
const engine=require(root+'/lib/ems-engine');
for(const name of ['evaluate','prepareControlContext','prepareChargeStrategy','buildSocPlan','previewBatteryFeedback'])wrap(engine,name);
const {setup,installVirtualClearTimeout}=require(root+'/test/pv-source-harness');
const NativeDate=Date,originalNow=Date.now;global.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[Date.now()]));}};
const restore=installVirtualClearTimeout();
async function fixture(kind){
 const strategy=require(root+'/lib/charge-strategy').normalize();strategy.year.day.mode='maximum';strategy.year.day.position='center';
 const at=NativeDate.parse(kind==='boundaries'?'2026-10-31T22:59:55Z':'2026-10-20T09:00:05Z');
 const h=await setup(root,{forcedMode:'self_consumption',fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00',
  contractType:kind.includes('dynamic')?'dynamic_quarter':'fixed',dynamicPriceSources:['external'],dynamicPriceSource:'external',
  exportLimitEnabled:kind==='transitions',peakLimitW:kind==='active'?12000:2650,evCount:kind.includes('ev')?1:0,evEnabled:true,evSocEnabled:false,evMode:'emergency',evControlType:kind==='ev_mode'?'mode':kind==='ev_hybrid'?'hybrid':'current',
  chargeStrategy:kind==='dynamic_center'?strategy:undefined,hvacCount:kind==='disabled'?10:kind==='active'?1:0,hvacEnabled:kind==='active',
  hvacPermanentEnabled:true,hvacTariffEnabled:true,hvacDirection:'heat',hvacAllowSetpointControl:true,
  hvacAllowModeControl:true,hvacCheapTargetC:23,hvacNormalTargetC:21,hvacExpensiveTargetC:20,
  boilerCount:['disabled','active'].includes(kind)?1:0,boilerEnabled:kind==='active',boilerStartSoc:50,boilerFallbackDays:3,...(kind==='active'?{flexibleLoadPriorityOrder:['hvac1','boiler'],priorityEvaluationMinutes:1}:{})},at,0);
 const a=h.app;
 for(const [id,card] of h.cards)if(/^hvac.*_updated(?:_for_configured)?$/.test(id))card.trigger=async(tokens,state)=>{h.flexible.push({at:h.now(),id,tokens,state});};
 if(kind.includes('dynamic')){
 const {localParts}=require(root+'/lib/homey-energy');const slots=[];
 for(let t=at-12*3600000;t<at+48*3600000;t+=900000){const p=localParts(new Date(t),'Europe/Brussels');slots.push({startMs:t,dateKey:p.dateKey,minute:p.minuteOfDay,price:p.minuteOfDay>=780&&p.minuteOfDay<840?.05:.3});}
 a.externalEnergy={...a.externalEnergy,slots,currentPrice:.3,curveUpdatedAt:at,currentUpdatedAt:at};}
 if(kind==='dynamic_center'){a.setSetting('forcedMode','auto');a.state.targetSocOverride=80;}
 if(kind.includes('ev'))await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});
 if(kind==='save'){a.state.batterySoc=[14,14,14,14];a.state.targetSocOverride=null;}
 a.state.pvProducingDate=a.getLocalDateKey(new Date(at));a.state.pvSeenProducingToday=true;
 if(kind==='active'){Object.assign(a.state,{hvacRoomTemperatureC:18,hvacSetpointC:20,hvacMode:'heat',hvacOutdoorTemperatureC:2});
 Object.assign(a.inputSeen.hvac,{roomTemperature:true,setpoint:true,mode:true,outdoorTemperature:true});
 a.setSetting('hvacDirectionTemperature',{source:'outdoor',tariffCop:{cheap:{outsideBelowC:6,targetC:55},normal:{outsideBelowC:6,targetC:50}}});
 a.boilerState.trackingStartedAt=at-5*86400000;await h.pv(6000);}
 a.diagnostics.options={cpu:false,planning:false,errors:false,memory:false};
 for(const name of ['shouldRunFastEvaluation','getEvaluationState','getRuntimeSettings','refreshControlContext','refreshPlanningInContext','evaluateFastNow'])wrap(a,name);
 await h.start();await h.flush();
 return h;
}
function trim(h){h.traces.length=0;h.flexible.length=0;h.contexts.length=0;h.logs.length=0;h.timers.splice(0,h.timers.length,...h.timers.filter(t=>!t.done));}
async function frame(h,n,kind){const a=h.app;h.setNow(h.now()+1000);
 if(n%60===0){a.inputUpdatedAt.pv=h.now();a.inputUpdatedAt.batterySoc.fill(h.now());}
 const load=kind==='stable'?1200:kind==='zero'?0:kind==='save'?1200:['transitions','active'].includes(kind)?700-a.state.pvPowerW+(n%11)*130:700+(n%11)*130;
 await h.grid(load-a.state.lastTotalCommandW);await h.flush();
 if(n%60===0){await h.start();await h.flush();}
}
async function bench(){const reports=[];
for(const kind of ['stable','zero','save','changing','dynamic_ev','dynamic_center','disabled']){
 const h=await fixture(kind),a=h.app;
 const isContext=['dynamic_ev','dynamic_center','disabled'].includes(kind);
 async function batch(count){for(let i=1;i<=count;i++){
  if(isContext){h.setNow(h.now()+1000);a.inputUpdatedAt.grid=h.now();a.inputUpdatedAt.pv=h.now();await h.start();await h.flush();}
  else await frame(h,i,kind);
  if(i%50===0)trim(h);
 }}
 await batch(isContext?160:1200);trim(h);if(global.gc)global.gc();const heapStart=process.memoryUsage().heapUsed;
 const rounds=[];
 for(let r=0;r<7;r++){calls={};const cpu=process.cpuUsage();await batch(isContext?180:1800);const used=process.cpuUsage(cpu);
  const round={cpuMs:(used.user+used.system)/1000,calls:{...calls}};trim(h);if(global.gc)global.gc();round.heapUsed=process.memoryUsage().heapUsed;round.rss=process.memoryUsage().rss;rounds.push(round);}
 assert.deepEqual(h.errors,[]);
 reports.push({kind,unit:isContext?'180 contexts':'1800 one-second P1 frames',warmup:isContext?160:1200,
  rounds,heapStart,heapEnd:process.memoryUsage().heapUsed,diagnosticCounters:a.diagnostics.counters});
}
return {node:process.version,physicalHomeyMeasured:false,reports};}
async function replay(){const reports=[];
for(const kind of (process.env.HF_REPLAY_KINDS?.split(',') || ['stable','zero','save','transitions','dynamic_ev','dynamic_center','ev_current','ev_mode','ev_hybrid','active','boundaries'])){
 const h=await fixture(kind),a=h.app,samples=[];
 for(let i=1;i<=240;i++){
  if(kind==='transitions'){
   if(i===20){a.state.batterySoc=[96,98,97,99];await h.pv(16000);}
   if(i===70)await h.pv(0);
   if(i===90){a.setSetting('forcedMode','standby');await h.start();}
   if(i===110){a.state.gridPowerW=6000;await h.grid(6000);}
   if(i===130){a.setSetting('commandIntervalSeconds',12);a.markContextDirty('setting:commandIntervalSeconds');}
   if(i===150){a.inputSeen.batterySoc[1]=false;a.state.batterySoc[0]=100;await h.start();}
   if(i===170){a.inputSeen.grid=false;a.inputUpdatedAt.pv=h.now()-600000;await h.start();}
   if(i===190){a.inputSeen.grid=true;a.setSetting('forcedMode','auto');await h.start();}
  }
  if(kind.includes('ev')&&[30,100,160,210].includes(i))await h.cards.get('set_ev1_status').listener({connected:i===100?'no':'yes',charge_current:i===30?12:0});
  if(kind.startsWith('ev_')){
   if(i===40)a.setEvEnergyPlan(0,3,'18:00','yes');
   if(i===50)a.setEvSessionOverride('extend_plan_2_days');
   if(i===180)a.clearEvSocPlan(0,'flow');
   if(i===200)a.markEvSessionEnded(0,'flow');
  }
  if(kind==='active'){
   if(i===60)h.setNow(NativeDate.parse('2026-10-21T04:59:55Z'));
   if(i===90){a.boilerState.lastCompletedAt=h.now()-3600000;a.boilerState.lastCompletedDate='2026-10-21';}
   if(i===120){await h.pv(0);a.setSetting('boilerEnabled',false);a.setSetting('hvacEnabled',false);await h.start();}
   if(i===160){a.setSetting('boilerEnabled',true);a.setSetting('hvacEnabled',true);await h.pv(6000);await h.start();}
  }
  await frame(h,i,kind);
  samples.push({at:h.now(),battery:a.latestResult.candidateCommands,mode:a.latestResult.baseMode,override:a.latestResult.override,
   planned:a.latestResult.plannedChargeW,tariff:a.latestResult.tariff,ev:a.latestEvDecision,hvac:a.latestHvacDecision,boiler:a.boilerState.latestDecision,
   strategy:a.controlRuntimeSettings.batteryChargeStrategyPlan,waf:a.planningCache?.energyBudget});
 }
 assert.deepEqual(h.errors,[]);reports.push({kind,traces:h.traces,flexible:h.flexible,contexts:h.contexts,samples});
}
return {reports};}
(async()=>{try{const data=await(mode==='replay'?replay():bench());if(report)fs.writeFileSync(report,JSON.stringify(data,null,2));console.log('PASS '+mode+' '+path.basename(path.dirname(root))+' '+data.reports.length+' scenarios');}
finally{restore();global.Date=NativeDate;Date.now=originalNow;}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
