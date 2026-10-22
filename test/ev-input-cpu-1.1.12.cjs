'use strict';
// Real scheduler and process CPU; Homey I/O and physical response are simulated.
const path=require('node:path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
process.argv[2]=root;
const scenario=process.argv[3]||'api';
const {fixture,warm,perAmpW,start}=require('./ev-battery-transition-1.1.9.test');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
(async()=>{const real=Date.now,restore=installVirtualClearTimeout();try{
 let h;
 if(scenario==='split'){
  const settings={batteryCount:1,totalCapacityKwh:40,minSoc:0,safetySoc:4,maxSoc:100,
   maxTotalChargeW:10000,maxTotalDischargeW:5000,maxChargePerBatteryW:10000,maxDischargePerBatteryW:5000,
   balanceEnabled:false,optimizeMultiBatteryEfficiency:false,commandIntervalSeconds:17,batteryCommandStepW:100,
   commandDeadbandW:100,gridZeroMinW:200,gridZeroMaxW:500,gridControlWindowSeconds:5,forcedMode:'auto',
   peakLimitW:17500,exportLimitEnabled:true,minimumExportW:2000,lowForecastMode:'self_consumption',
   lowForecastSelfConsumptionMinKwh:70,batterySaveDischargeAboveSoc:60,contractType:'tou',
   touRates:[{id:'piek',name:'Piek',importPrice:.39,feedInPrice:-.03,lowForecastBatterySave:true,
    weekdayChargeMode:'never',weekendChargeMode:'never'}],
   touSchedule:[{rateId:'piek',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]}],
   splitCommandBattery1Enabled:true,splitCommandBattery1ChargePowerPositive:true,
   splitCommandBattery1KeepMinimumPower:true,splitCommandBattery1MinimumPowerW:100,
   splitCommandBattery1ZeroMode:'charge',splitCommandBattery1SafetyModeResendEnabled:true,
   splitCommandBattery1SafetyModeResendSeconds:600};
  // The publication mismatch is independent of EV activity. Keep its original
  // battery/PV settings; disable unrelated flexible devices in this replay.
  h=await setup(root,{...settings,evCount:0},start,5468);
  Object.assign(h.app.state,{gridPowerW:3546,batterySoc:[46,null,null,null]});
  h.store.set('_chargeTestSignature',h.app.getChargeTestSignature(h.app.getSettings()));
  await h.setExternalSetting('controlEnabled',true);await h.start();
 }else{h=await fixture('current',7,1,{forcedMode:'auto',contractType:'fixed',fixedChargeWindowStart:'11:00',fixedChargeWindowEnd:'17:00',evFixedMaxGridImportW:40000});await warm(h);}
 const a=h.app,counts={};for(const key of ['calculateEvPortfolioDecisions','getEvaluationState','evaluateFastNow','markControlContextDirty']){const f=a[key].bind(a);a[key]=(...args)=>{counts[key]=(counts[key]||0)+1;return f(...args)}}
 const origin=h.now(),traceStart=h.traces.length,initial={...a.diagnostics.counters};
 const cpuAt=process.cpuUsage();
 for(let n=1;n<=600;n++){
  h.setNow(origin+n*1000);
  if(scenario==='split'){
   if(n%15===0)await h.pv(5468);
   await h.grid(3546-a.state.lastTotalCommandW);
  }else{
   if(n%10===1){if(scenario==='api')a.setInput({ev:{connected:true,chargeCurrentA:10}});else await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:10});await h.drain();}
   await h.grid(623+10*perAmpW-a.state.lastTotalCommandW);
  }
  await h.flush();
  if(n%60===0){a.runContextHeartbeat();await a.runEvHeartbeat();await h.drain();await h.flush();}
 }
 const cpu=process.cpuUsage(cpuAt);
 const counters=Object.fromEntries(Object.entries(a.diagnostics.counters).map(([k,v])=>[k,v-(initial[k]||0)]));
 console.log(JSON.stringify({scenario,seconds:600,node:process.version,cpuMs:(cpu.user+cpu.system)/1000,counts,counters,
  batteryPublications:h.traces.length-traceStart,finalBatteryW:a.state.lastTotalCommandW,
  trace:h.traces.slice(traceStart).map(t=>({second:(t.at-origin)/1000,commands:t.commands})),errors:h.errors}));
 }finally{Date.now=real;restore()}})().catch(e=>{console.error(e);process.exitCode=1});
