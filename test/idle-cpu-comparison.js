'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
if(!process.argv[2]){console.error('Usage: node test/idle-cpu-comparison.js /path/to/previous-1.0.8 [path/to/updated-1.0.8]');process.exit(1);}
const roots=[path.resolve(process.argv[2]),path.resolve(process.argv[3]||path.join(__dirname,'..'))];
const originalClear=global.clearTimeout;
global.clearTimeout=t=>{if(t&&typeof t==='object'&&'due'in t)t.done=true;else originalClear(t);};
async function replay(root,kind){
 const req=createRequire(root+'/test/fast-control-audit-1.0.6.test.js');
 const prefix=fs.readFileSync(root+'/test/fast-control-audit-1.0.6.test.js','utf8').split('async function run()')[0];
 const m={exports:{}};new Function('require','module',prefix+'\nmodule.exports={setup,drain,setNow:v=>now=v};')(req,m);
 const {setup,drain,setNow}=m.exports;let at=Date.parse('2026-10-04T12:00:05Z');setNow(at);
 const h=await setup({minSoc:12,safetySoc:14,peakReserveTargetSoc:65,peakReserveMonth10:true,
  peakReserveNightEnabled:true,lowForecastFixedEnabled:false,fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00',
  optimizeMultiBatteryEfficiency:true,peakLimitW:2650,peakSoftMarginW:100,commandIntervalSeconds:7,gridControlWindowSeconds:3},1200,0);
 Object.assign(h.app.state,{pvPowerW:0,batterySoc:[20,20,20,20],targetSocOverride:null,forecastTomorrowKwh:0});
 h.app.inputUpdatedAt.pv=at;h.app.inputUpdatedAt.batterySoc=[at,at,at,at];
 h.app.refreshControlContext(h.settings,h.app.getEvaluationState(h.settings,at),at);
 const trace=[];h.app.commandTrigger.trigger=async t=>trace.push({at:Date.now(),total:t.total_command,batteries:[1,2,3,4].map(i=>t[`battery${i}command`]),mode:h.app.latestResult.baseMode,override:h.app.latestResult.override});
 h.app.requestEvaluate(true);await drain();at+=10000;setNow(at);h.app.inputUpdatedAt.grid=at;h.app.requestEvaluate(true);await drain();
 const cpu=process.cpuUsage(),started=process.hrtime.bigint();
 for(let i=1;i<=1500;i++){
  at+=1000;setNow(at);
  if(i%60===0)h.app.refreshControlContext(h.settings,h.app.getEvaluationState(h.settings,at),at);
  if(i%120===0)h.app.inputUpdatedAt.batterySoc=[at,at,at,at];
  h.app.inputUpdatedAt.pv=at;
  if(kind==='bookkeeping'&&i%15===0)h.app.setSetting('_autoTuneLearning',{days:[]});
  const pv=kind==='changing'?[0,3000,0,4500,1000,0][Math.floor(i/75)%6]:0;
  const house=kind==='changing'?[1200,2200,3000,650,1700][Math.floor(i/55)%5]:1200+(i%3-1)*20;
  if(kind==='changing'&&i===700){h.app.state.batterySoc=[75,74,73,72];h.app.requestEvaluate(true);await drain();}
  if(kind==='changing'&&i===1100){h.app.state.batterySoc=[20,20,20,20];h.app.requestEvaluate(true);await drain();}
  const grid=house-pv-h.app.state.lastTotalCommandW;
  if(pv!==h.app.state.pvPowerW){await h.cards.get('set_pv_power').listener({power:pv});await drain();}
  await h.cards.get('set_grid_power').listener({power:grid});await drain();
  for(const timer of h.timers.slice())if(!timer.done&&timer.due<=at){timer.done=true;timer.fn();await drain();}
 }
 const cost=process.cpuUsage(cpu);assert.equal(h.errors.length,0,h.errors.join('\n'));
 return {p1Updates:1500,counters:h.app.diagnostics.counters,sections:h.app.diagnostics.cpuSections,
  processCpuMs:(cost.user+cost.system)/1000,wallMs:Number(process.hrtime.bigint()-started)/1e6,trace};
}
(async()=>{
 const cases={};
 for(const kind of ['stable','bookkeeping','changing']){
  const before=await replay(roots[0],kind),after=await replay(roots[1],kind);
  assert.deepEqual(after.trace,before.trace,`${kind}: commands, distribution, mode and timestamps must match`);
  cases[kind]={before,after};
 }
 console.log(JSON.stringify({version:'1.0.8',identicalTimedBatteryTraces:true,cases},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
