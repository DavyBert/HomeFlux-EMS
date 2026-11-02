'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
if(!process.argv[2]){console.error('Usage: node test/charge-cpu-comparison.js /path/to/original-1.0.7 [path/to/1.0.8]');process.exit(1);}
const roots=[path.resolve(process.argv[2]),path.resolve(process.argv[3]||path.join(__dirname,'..'))];
const engines=roots.map(r=>require(r+'/lib/ems-engine'));
let engineCases=0;
for(const contractType of ['fixed','tou','dynamic_hour','dynamic_quarter'])for(const optimize of [false,true])for(const phase of ['day','night']){
 const interval=contractType==='dynamic_quarter'?15:60;
 const settings={...engines[0].DEFAULTS,timezone:'UTC',contractType,batteryCount:4,totalCapacityKwh:21.6,
  maxTotalChargeW:6000,maxTotalDischargeW:6000,maxChargePerBatteryW:2400,maxDischargePerBatteryW:2400,
  optimizeMultiBatteryEfficiency:optimize,controlProfile:'exact',peakShaveEnabled:true,peakLimitW:2650,
  dayPlanningMaxSoc:80,nightPlanningMaxSoc:90,fixedChargeWindowStart:'00:00',fixedChargeWindowEnd:'23:59',
  dynamicPriceDataReady:true,dynamicSlots:Array.from({length:1440/interval},(_,i)=>({time:`${String(Math.floor(i*interval/60)).padStart(2,'0')}:${String(i*interval%60).padStart(2,'0')}`,price:.1+i*.002})),
  touRates:[{id:'low',name:'Low',importPrice:.1,weekdayChargeMode:'always',weekendChargeMode:'always'}],
  touSchedule:[{rateId:'low',start:'00:00',end:'23:59',days:[1,2,3,4,5,6,7]}]};
 for(const forcedMode of ['auto','manual_charge','self_consumption','standby'])for(let i=0;i<40;i++){
  const now=new Date(`2026-10-04T${phase==='night'?'01':'12'}:00:00Z`);
  const state={gridPowerW:-2000+i*180,controlGridPowerW:-2000+i*180,pvPowerW:Math.max(0,5000-i*200),
   forecastRemainingKwh:i%20,forecastDailyMaxKwh:i%25,forecastTomorrowKwh:i%22,batterySoc:[20+i,35+i*.3,i%9?60:null,100-i],
   lastTotalCommandW:-5000+i*180,lastBatteryCommands:[-1000,-1000,0,0],efficiencyChargeStickyIndex:1,
   plannedBatteryGridLimitW:i%2?null:500,peakGuardExtraLoadW:i%5?0:1800,nightPlanningActive:phase==='night',planningForecastDay:phase==='night'?'tomorrow':'today'};
  for(const cached of [false,true]){
   const results=engines.map(e=>e.evaluate(state,{...settings,forcedMode},now,cached?e.prepareControlContext(state,{...settings,forcedMode},now):null));
   assert.deepEqual(results[1],results[0],`${contractType}/${optimize}/${phase}/${forcedMode}/${i}/${cached}`);engineCases++;
  }
 }
}
async function replay(root,variable){
 const req=createRequire(root+'/test/fast-control-audit-1.0.6.test.js');
 const prefix=fs.readFileSync(root+'/test/fast-control-audit-1.0.6.test.js','utf8').split('async function run()')[0];
 const m={exports:{}};new Function('require','module',prefix+'\nmodule.exports={setup,drain,setNow:v=>now=v};')(req,m);
 const {setup,drain,setNow}=m.exports;let at=Date.parse('2026-10-04T12:00:00Z');setNow(at);
 const h=await setup({optimizeMultiBatteryEfficiency:true,commandIntervalSeconds:7,peakLimitW:2650},600,0);
 h.app.state.pvPowerW=0;const traces=[];
 h.app.commandTrigger.trigger=async t=>traces.push({at:Date.now(),total:t.total_command,batteries:[1,2,3,4].map(i=>t[`battery${i}command`]),mode:h.app.latestResult.baseMode,override:h.app.latestResult.override});
 h.app.requestEvaluate(true);await drain();
 const cpu=process.cpuUsage(),start=process.hrtime.bigint();
 for(let i=1;i<=1500;i++){
  at+=1000;setNow(at);
  if(i%60===0)h.app.refreshControlContext(h.settings,h.app.getEvaluationState(h.settings,at),at);
  const pv=variable?[0,2500,0,4500,1000,0][Math.floor(i/75)%6]:0;
  const house=variable?[600,900,3600,150,1500][Math.floor(i/55)%5]:600+(i%3-1)*3;
  if(variable&&i%120===0){h.app.state.batterySoc[0]+=0.1;h.app.requestEvaluate(true);await drain();}
  if(variable&&i===400){h.app.state.batterySoc[1]=100;h.app.requestEvaluate(true);await drain();}
  if(variable&&i===600){h.app.inputSeen.batterySoc[2]=false;h.app.requestEvaluate(true);await drain();}
  if(variable&&i===800){h.app.inputSeen.batterySoc[2]=true;h.app.requestEvaluate(true);await drain();}
  const grid=house-pv-h.app.state.lastTotalCommandW;
  if(pv!==h.app.state.pvPowerW){await h.cards.get('set_pv_power').listener({power:pv});await drain();}
  await h.cards.get('set_grid_power').listener({power:grid});await drain();
  for(const t of h.timers.slice())if(!t.done&&t.due<=at){t.done=true;t.fn();await drain();}
 }
 const cost=process.cpuUsage(cpu);
 assert.equal(h.errors.length,0,h.errors.join('\n'));
 return {p1Updates:1500,counters:h.app.diagnostics.counters,sections:h.app.diagnostics.cpuSections,
  processCpuMs:(cost.user+cost.system)/1000,wallMs:Number(process.hrtime.bigint()-start)/1e6,traces};
}
const clear=global.clearTimeout;global.clearTimeout=t=>{if(t&&typeof t==='object'&&'due'in t)t.done=true;else clear(t);};
(async()=>{
 const modes={};
 for(const variable of [false,true]){
  const before=await replay(roots[0],variable),after=await replay(roots[1],variable);
  assert.deepEqual(after.traces,before.traces,'battery publication time, allocation and mode/override must match');
  modes[variable?'changingLoad':'stableCharge']={before,after};
 }
 console.log(JSON.stringify({engineCases,identicalEngineResults:true,identicalTimedBatteryTraces:true,modes},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
