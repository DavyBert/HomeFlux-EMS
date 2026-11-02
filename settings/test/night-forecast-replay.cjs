'use strict';
const path = require('node:path');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const root = path.resolve(process.env.EMS_ROOT || path.join(__dirname,'..'));
const trial = process.argv.includes('--median');
const values = [8,8,8,14,2,9,7,15,1,8,8];
(async () => {
 const realNow=Date.now, restore=installVirtualClearTimeout();
 try {
  const h=await setup(root,{fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00',
   expectedEnergyNeedKwh:20,peakReserveNightEnabled:false,sunChanceReserveEnabled:false,
   sunnyMonthsMinSocEnabled:false,adaptiveLiveControlEnabled:false},Date.parse('2026-10-13T00:10:00Z'),0),a=h.app;
  Object.assign(a.state,{targetSocOverride:null,forecastRemainingKwh:null,forecastDailyMaxKwh:null,
   forecastTomorrowKwh:null,forecastTomorrowDate:'',nightPlanningActive:true,
   nightPlanningStartedDate:'2026-10-12',pvSeenProducingToday:false});
  a.inputSeen.forecast=false;a.inputSeen.forecastTomorrow=false;
  const samples=[];
  if(trial){const original=a.getEvaluationState.bind(a);a.getEvaluationState=(...args)=>{
   const s=original(...args);
   if(s.nightPlanningActive&&samples.length){const sorted=[...samples].sort((x,y)=>x-y),m=sorted.length>>1;
    const median=sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;
    s.forecastRemainingKwh=median;s.forecastDailyMaxKwh=median;}
   return s;
  };}
  const out=[],start=h.now();samples.push(values[0]);
  await h.cards.get('set_forecast_remaining').listener({energy:values[0]});
  a.invalidatePlanningCache(true);await h.start();
  for(let i=0;i<values.length;i++){
   h.setNow(start+i*600000);if(i>0)samples.push(values[i]);
   if(i>0)await h.cards.get('set_forecast_remaining').listener({energy:values[i]});
   await h.grid(600-a.state.lastTotalCommandW);await h.flush();
   h.setNow(h.now()+61000);await h.grid(600-a.state.lastTotalCommandW);await h.flush();
   out.push({forecast:values[i],targetSoc:a.getPlanningStatus().targetSoc,
    forecastUsed:a.getPlanningStatus().forecastUsedKwh,plannedChargeW:a.latestResult.plannedChargeW});
  }
  if(h.errors.length)throw Error(h.errors.join('\n'));
  const targets=out.map(x=>x.targetSoc),span=Math.max(...targets)-Math.min(...targets),movement=targets.slice(1).reduce((s,v,i)=>s+Math.abs(v-targets[i]),0);
  console.log(JSON.stringify({trial,span,movement,out}));
 }finally{Date.now=realNow;restore();}
})().catch(e=>{console.error(e);process.exitCode=1;});
