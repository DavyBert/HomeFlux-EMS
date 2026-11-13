'use strict';
// Engine-only microbenchmark; use high-pv-p1-cpu-1.3.2.cjs for complete app CPU.
// Invoke: node test/high-pv-cpu-1.3.2.cjs /path/to/original-source
const path=require('node:path'),{spawnSync}=require('node:child_process');
const originalRoot=path.resolve(process.argv[2]||'.');
const currentRoot=path.resolve(__dirname,'..');
if(process.argv[3]==='worker') {
 const E=require(path.join(process.argv[4],'lib/ems-engine.js'));
 const defaults=require(path.join(originalRoot,'lib/ems-engine.js')).DEFAULTS;
 const now=new Date('2026-11-13T12:00:00+01:00');
 const common={...defaults,batteryCount:4,totalCapacityKwh:21.6,minSoc:10,safetySoc:14,
  contractType:'dynamic_hour',controlProfile:'exact',peakShaveEnabled:true,peakLimitW:2650,
  batterySaveDischargeAboveSoc:100,expectedEnergyNeedKwh:20,cheapHours:1,expensiveHours:1,
  dynamicUseBatteryNormalHours:false,highForecastDynamicCheapBatterySave:true,
  highForecastDynamicCheapDischargeToTarget:false,highForecastDynamicNormalBatterySave:true,
  highForecastDynamicNormalDischargeToTarget:false,dynamicPriceDataReady:true,
  dynamicSlots:Array.from({length:24},(_,h)=>({time:`${String(h).padStart(2,'0')}:00`,price:h===11?.1:h===13?.5:.3}))};
 const st={gridPowerW:600,pvPowerW:0,batterySoc:[70,70,70,70],forecastDailyMaxKwh:20,forecastRemainingKwh:15,forecastTomorrowKwh:20,targetSocOverride:40};
 const cases=[
  ['dynamic_high_save',common,st],
  ['dynamic_low_save',{...common,lowForecastDynamicNormalEnabled:true,dynamicUseBatteryNormalHours:true},{...st,forecastDailyMaxKwh:4}],
  ['dynamic_high_forecast',{...common,highForecastDynamicNormalDischargeToTarget:true},st],
  ['tou_high_save',{...common,contractType:'tou',touRates:[{id:'r',importPrice:.3,weekdayChargeMode:'never',weekendChargeMode:'never',avoidGridImport:false,highForecastBatterySave:true,highForecastDischargeToTarget:true}],touSchedule:[{rateId:'r',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]}]},st],
  ['fixed',{...common,contractType:'fixed'},st]
 ];
 for(const item of cases)item[1]={...item[1],highForecastDynamicPolicy:require('../settings/high-forecast-policy').normalize(null,item[1])};
 const contexts=cases.map(([,s,st])=>E.prepareControlContext(st,s,now));let sink=0;
 for(let i=0;i<2500;i++)for(let k=0;k<cases.length;k++){const [,s,st]=cases[k];sink+=E.evaluate(st,s,now,contexts[k]).totalCommandW;}
 const results=[];
 for(let k=0;k<cases.length;k++) {
  const [name,s,st]=cases[k],start=process.cpuUsage();
  for(let i=0;i<5000;i++)sink+=E.evaluate(st,s,now,contexts[k]).totalCommandW;
  const cpu=process.cpuUsage(start);results.push({name,cpuUs:cpu.user+cpu.system,iterations:5000});
 }
 process.stdout.write(JSON.stringify({results,sink}));
} else {
 const samples={baseline:[],modified:[]};
 for(let round=0;round<7;round++)for(const kind of (round%2?['modified','baseline']:['baseline','modified'])) {
  const p=spawnSync(process.execPath,[__filename,originalRoot,'worker',kind==='baseline'?originalRoot:currentRoot],{encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1'}});
  if(p.status!==0)throw Error(p.stderr);samples[kind].push(JSON.parse(p.stdout).results);
 }
 const median=a=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)];
 const comparison=samples.baseline[0].map((r,i)=>{
  const a=samples.baseline.map(v=>v[i].cpuUs/5000),b=samples.modified.map(v=>v[i].cpuUs/5000);
  return {scenario:r.name,baselineUsPerEval:median(a),modifiedUsPerEval:median(b),changePercent:(median(b)/median(a)-1)*100,baselineSamples:a,modifiedSamples:b};
 });
 console.log(JSON.stringify({node:process.version,method:'7 paired alternating isolated-process trials; 2500 warmup iterations per scenario; 5000 timed evaluations per scenario; process CPU, prepared context',comparison},null,2));
}
