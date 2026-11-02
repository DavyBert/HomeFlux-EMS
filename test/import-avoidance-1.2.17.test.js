'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {createRequire}=require('node:module');
const root=require('node:path').resolve(__dirname,'..');
const req=createRequire(root+'/package.json'),e=req('./lib/ems-engine'),cs=req('./lib/charge-strategy');
const NativeDate=Date,nativeNow=Date.now;
const time=(phase)=>new Date(phase==='day'?'2026-11-02T08:00:00+01:00':'2026-11-02T18:00:00+01:00');
function strategy(mode='standard',position='latest',extraPercent=0){const c=cs.normalize();for(const p of ['day','night'])c.year[p]={mode,position,extraPercent};return c;}
function settings(extra={}){return {...e.DEFAULTS,timezone:'Europe/Brussels',contractType:'tou',batteryCount:4,totalCapacityKwh:21.6,controlProfile:'exact',
 commandDeadbandW:0,batteryCommandStepW:1,gridZeroMinW:0,gridZeroMaxW:0,minSoc:12,safetySoc:14,maxTotalChargeW:6000,maxChargePerBatteryW:2400,
 maxTotalDischargeW:6000,maxDischargePerBatteryW:2000,peakShaveEnabled:true,peakLimitW:2650,peakSoftMarginW:100,peakReserveTargetSoc:60,
 sunChanceReserveEnabled:false,chargeStrategy:strategy(),lowForecastSelfConsumptionMinKwh:5,
 touRates:[{id:'low',name:'Dal',importPrice:.2,weekdayChargeMode:'always',weekendChargeMode:'always',avoidGridImport:false,lowForecastBatterySave:true},
 {id:'high',name:'Piek',importPrice:.45,weekdayChargeMode:'never',weekendChargeMode:'never',avoidGridImport:true,lowForecastBatterySave:true,lowForecastDischargeToTarget:true}],
 touSchedule:[{rateId:'high',start:'07:00',end:'11:00',days:[1,2,3,4,5,6,7]},{rateId:'low',start:'11:00',end:'17:00',days:[1,2,3,4,5,6,7]},
 {rateId:'high',start:'17:00',end:'22:00',days:[1,2,3,4,5,6,7]},{rateId:'low',start:'22:00',end:'07:00',days:[1,2,3,4,5,6,7]}],...extra};}
function state(phase='day',extra={}){return {batterySoc:[77.5,77.5,77.5,77.5],gridPowerW:1533,pvPowerW:0,lastTotalCommandW:0,
 forecastDailyMaxKwh:1,forecastRemainingKwh:0,forecastTomorrowKwh:1,planningForecastDay:phase==='day'?'today':'tomorrow',nightPlanningActive:phase==='night',targetSocOverride:90,...extra};}
const rows=[],checks=[],violations=[];
const reference=process.env.HOMEFLUX_PREVIOUS_SOURCE?require(require('node:path').join(process.env.HOMEFLUX_PREVIOUS_SOURCE,'lib/ems-engine')):null;
function record(name,fn){fn();checks.push(name);}
function summarize(r){return {baseMode:r.baseMode,lowForecastSave:r.lowForecastBatterySaveActive,avoidGridImport:r.tariff.avoidGridImport,
 lowForecastEnabled:r.tariff.lowForecastBatterySave,action:r.action,batteryW:r.totalCommandW,predictedGridW:r.predictedGridW,
 safetyRecovery:r.safetySocRecoveryActive,floor:r.batteryDischargeFloorSoc,goal:r.planningChargeTargetSoc,
 strategy:r.tariff.chargeStrategy&&{mode:r.tariff.chargeStrategy.mode,active:r.tariff.chargeStrategy.active,missingKwh:r.tariff.chargeStrategy.missingKwh},
 reason:r.modeLabel};}
async function main(){
 record('Tariff checkbox overrides conflicting low-PV flags in all tariff price classes and in both planning phases',()=>{
  for(const phase of ['day','night'])for(const price of [.1,.2,.9]){
   const s=settings();s.touRates[1].importPrice=price;const r=e.evaluate(state(phase),s,time(phase));
   assert(r.tariff.avoidGridImport);assert(!r.tariff.lowForecastBatterySave);assert(!r.tariff.lowForecastDischargeToTarget);
   assert.equal(r.baseMode,'avoid_import');assert(!r.lowForecastBatterySaveActive);assert(r.totalCommandW>1500);
  }
 });
 for(const phase of ['day','night'])for(const choice of [['standard','latest',0],['standard','latest',20],['maximum','latest',0],['maximum','early',0],['maximum','center',0]])
 for(const forecast of ['low','high','missing'])for(const soc of [50,77.5,95])for(const load of [1533,5879])for(const cached of [false,true]){
  const s=settings({chargeStrategy:strategy(...choice)}),st=state(phase,{batterySoc:Array(4).fill(soc),gridPowerW:load});
  if(forecast==='high')st.forecastDailyMaxKwh=st.forecastTomorrowKwh=20;
  if(forecast==='missing')Object.assign(s,{forecastDataReady:false,forecastDailyDataReady:false,forecastTomorrowDataReady:false});
  const plan=e.prepareChargeStrategy(st,s,time(phase)),rt={...s,batteryChargeStrategyPlan:plan};
  const r=e.evaluate(st,rt,time(phase),cached?e.prepareControlContext(st,rt,time(phase)):null);
  assert.equal(r.tariff.rateId,'high');assert.equal(r.tariff.avoidGridImport,true);assert.equal(r.lowForecastBatterySaveActive,false);
  const baseline=e.evaluate(st,{...s,batteryChargeStrategyPlan:null},time(phase));
  assert.equal(r.baseMode,'avoid_import');assert(Math.abs(r.totalCommandW-baseline.totalCommandW)<=4);
  if(reference){const old=reference.evaluate(st,rt,time(phase));
   if(old.baseMode!=='avoid_import'||old.totalCommandW<baseline.totalCommandW-10)violations.push({phase,choice:choice.join('/'),forecast,soc,load,cached});}
  const row={phase,choice:choice.join('/'),forecast,soc,load,cached,planMode:plan?.mode,...summarize(r),expectedBatteryW:baseline.totalCommandW};rows.push(row);

 }
 checks.push('360 production engine/planner comparisons, including prepared fast contexts, three forecast states, SoC and load changes');
 record('Expired prepared contexts follow 11:00, 17:00 and 22:00 tariff changes while retaining the pending charge plan',()=>{
  for(const [phase,boundary,expected]of [['day','11:00','charge'],['night','17:00','avoid_import'],['night','22:00','charge']]){
   const s=settings({chargeStrategy:strategy('maximum')}),st=state(phase);
   const at=new Date(`2026-11-02T${boundary}:00+01:00`),before=new Date(at.getTime()-1000),after=new Date(at.getTime()+1000);
   s.batteryChargeStrategyPlan=e.prepareChargeStrategy(st,s,before);
   const context=e.prepareControlContext(st,s,before);
   assert.equal(context.tariffValidUntil,at.getTime());
   const r=e.evaluate(st,s,after,context);assert.equal(r.baseMode,expected);
   assert.equal(r.tariff.avoidGridImport,expected==='avoid_import');
   if(expected==='avoid_import')assert(r.totalCommandW>1500);
  }
 });
 record('Forced Battery Save is an explicit override; Safety recovery, battery minima, PV capture and power caps remain effective',()=>{
  const s=settings(),st=state();assert.equal(e.evaluate(st,{...s,forcedMode:'solar_capture'},time('day')).totalCommandW,0);
  assert(e.evaluate({...st,batterySoc:[13,13,13,13]},s,time('day')).totalCommandW<0);
  assert.equal(e.evaluate({...st,batterySoc:[14,14,14,14]},s,time('day')).totalCommandW,0);
  assert.equal(e.evaluate({...st,batterySoc:[12,12,12,12],gridPowerW:5879},s,time('day')).totalCommandW,0);
  const pv=e.evaluate({...st,gridPowerW:-800,pvPowerW:1000},s,time('day'));assert(pv.totalCommandW<0);
  const capped=e.evaluate({...st,gridPowerW:5879},{...s,maxTotalDischargeW:3000},time('day'));assert(capped.totalCommandW<=3000);assert(capped.totalCommandW>2900);
 });
 record('Independent sunshine reserve may still be explicitly enabled at a high tariff; default high-tariff selection is off',()=>{
  const st=state('night',{batterySoc:[50,50,50,50],sunChanceForecasts:{'2026-11-03':5}}),s=settings({sunChanceReserveEnabled:true,sunChanceBand1MinSoc:80});
  let r=e.evaluate(st,s,time('night'));assert(!r.sunChanceReserve.active);assert(r.totalCommandW>0);
  s.touRates[1].sunChanceReserveAllowed=true;r=e.evaluate(st,s,time('night'));assert(r.sunChanceReserve.active);assert.equal(r.totalCommandW,0);
 });
 record('A future cheap-window plan, PV capture, EV discharge protection and deliberate active dynamic charging keep their existing semantics',()=>{
  const s=settings({chargeStrategy:strategy('maximum')}),st=state(),at=new Date('2026-11-02T12:00:00+01:00');
  s.batteryChargeStrategyPlan=e.prepareChargeStrategy(st,s,at);
  assert(s.batteryChargeStrategyPlan.blocks[0].startAt>at.getTime());
  const saved=JSON.stringify(s.batteryChargeStrategyPlan);
  const wait=e.evaluate(st,s,at);assert.equal(wait.baseMode,'charge');assert.equal(wait.totalCommandW,0);
  assert(e.evaluate({...st,gridPowerW:-800,pvPowerW:1000},s,at).totalCommandW<0);
  assert.equal(JSON.stringify(s.batteryChargeStrategyPlan),saved);
  const blocked=e.evaluate({...st,batteryDischargeBlockedByEv:true},s,time('day'));assert.equal(blocked.totalCommandW,0);
  assert.equal(blocked.batteryDischargeBlockedByEv,true);
  const d=settings({contractType:'dynamic_hour',dynamicPriceDataReady:true,lowForecastDynamicExpensiveEnabled:true,
   cheapHours:1,expensiveHours:1,dynamicSlots:Array.from({length:24},(_,h)=>({time:String(h).padStart(2,'0')+':00',price:h===18?.5:h===0?.1:.2})),chargeStrategy:strategy('maximum','early')});
  const activeAt=time('night'),ds=state('night');
  const curve=req('./lib/ev-deadline-planner').prepareEvPriceCurve([{startMs:activeAt.getTime(),price:.5},{startMs:activeAt.getTime()+3600000,price:.2}],'Europe/Brussels',60);
  d.batteryChargeStrategyPlan=e.prepareChargeStrategy(ds,d,activeAt,curve);
  assert(d.batteryChargeStrategyPlan.blocks[0].startAt<=activeAt.getTime());
  const r=e.evaluate(ds,d,activeAt);assert.equal(r.tariff.className,'expensive');assert(r.tariff.chargeStrategy.active);
  assert.equal(r.baseMode,'charge');assert(r.totalCommandW<0);
  const missing=e.evaluate(ds,{...d,dynamicPriceDataReady:false},activeAt);assert.equal(missing.baseMode,'solar_capture');assert.equal(missing.totalCommandW,0);
 });
 const dynamic=[];
 record('Dynamic high-price Battery Save stays configurable; a future maximum plan respects ordinary high-price discharge',()=>{
  for(const contract of ['dynamic_hour','dynamic_quarter'])for(const phase of ['day','night'])for(const save of [false,true]){
   const step=contract==='dynamic_hour'?60:15,at=time(phase),start=Date.parse('2026-11-01T23:00:00Z');
   const entries=Array.from({length:48*60/step},(_,i)=>{const t=start+i*step*60000,h=new NativeDate(t+3600000).getUTCHours();return {startMs:t,price:h>=7&&h<11||h>=17&&h<22?.45:.2};});
   const curve=req('./lib/ev-deadline-planner').prepareEvPriceCurve(entries,'Europe/Brussels',step);
   for(const max of [false,true]){
    const s=settings({contractType:contract,dynamicPriceDataReady:true,cheapHours:3,expensiveHours:10,lowForecastDynamicExpensiveEnabled:save,
     chargeStrategy:strategy(max?'maximum':'standard'),dynamicSlots:Array.from({length:24*60/step},(_,i)=>({time:String(Math.floor(i*step/60)).padStart(2,'0')+':'+String(i*step%60).padStart(2,'0'),price:i*step>=7*60&&i*step<11*60||i*step>=17*60&&i*step<22*60?.45:.2}))});
    const st=state(phase);if(phase==='night')s.batteryNightPlan=new(req('./lib/battery-night-planner').BatteryNightPlanner)().evaluate({...e.getBatteryNightPlanningInputs(st,s,at),curve});
    s.batteryChargeStrategyPlan=e.prepareChargeStrategy(st,s,at,curve);
    const r=e.evaluate(st,s,at);assert.equal(r.tariff.className,'expensive');
    if(!max){assert.equal(r.baseMode,save?'solar_capture':'avoid_import');assert.equal(r.lowForecastBatterySaveActive,save);}
    else{assert.equal(r.baseMode,save?'solar_capture':'avoid_import');if(!save)assert(r.totalCommandW>1500);else assert.equal(r.totalCommandW,0);}
    dynamic.push({contract,phase,lowForecastSaveSelected:save,maximumPlan:max,...summarize(r)});
   }
  }
 });
 const appResults=[];
 const {setup,installVirtualClearTimeout}=req('./test/pv-source-harness');
 global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
 const restore=installVirtualClearTimeout();
 try{
  for(const phase of ['day','night'])for(const maximum of [false,true])for(const load of [1533,5879]){
   const s=settings({controlEnabled:true,chargeTestPassed:true,chargeStrategy:strategy(maximum?'maximum':'standard'),expectedEnergyNeedKwh:23,nightPlanningMaxSoc:90,dayPlanningMaxSoc:100});
   const h=await setup(root,s,time(phase).getTime(),0),a=h.app;
   Object.assign(a.state,state(phase,{targetSocOverride:null,nightPlanningStartedDate:'2026-11-02',pvSeenProducingToday:true,pvProducingDate:'2026-11-02'}));
   a.inputSeen.batterySoc.fill(true);a.inputSeen.forecast=true;a.inputSeen.forecastTomorrow=true;
   a.inputUpdatedAt.forecast=h.now();a.inputUpdatedAt.forecastTomorrow=h.now();
   // Physical P1 includes the requested battery power after each publication.
   const trigger=a.commandTrigger.trigger;a.commandTrigger.trigger=async t=>{await trigger(t);a.state.gridPowerW=load-Number(t.total_command);a.gridSamples=[];};
   await h.grid(load);await h.start();await h.flush();
   for(let t=0;t<5;t++){h.setNow(h.now()+8000);await h.grid(load-a.state.lastTotalCommandW);await h.flush();}
   await h.start();await h.flush();assert.deepEqual(h.errors,[]);assert.equal(a.latestResult.tariff.avoidGridImport,true);
   assert.equal(a.latestResult.baseMode,'avoid_import');
   const emitted=a.lastEmittedCommands.reduce((n,v)=>n+Number(v||0),0);
   assert(emitted>load-500);assert(emitted<=6000);
   assert(h.traces.some(t=>t.total>load-500));
   const tags=req('./lib/ems-status-tags').values(a.latestResult,null,'nl');
   appResults.push({phase,load,maximumPlan:maximum,...summarize(a.latestResult),publishedBatteryW:emitted,publishedGridW:a.state.gridPowerW,
    widget:tags.emsdecision,widgetReason:tags.emsdecisionreasons,publicationCount:h.traces.length});
  }
  checks.push('Eight real startup/context/fast-loop/publication traces with physical meter feedback avoid high-tariff import, including loads above Peak Guard');
 }finally{restore();global.Date=NativeDate;Date.now=nativeNow;}
 const result={version:'1.2.17',productionCodeModified:true,checks,comparisons:rows.length,baselinePriorityViolationsFixed:violations.length,
  violationsByChoice:Object.fromEntries([...new Set(violations.map(r=>r.choice))].map(k=>[k,violations.filter(r=>r.choice===k).length])),
  examples:rows.filter(r=>r.soc===77.5&&r.forecast==='low'&&!r.cached&&r.choice==='maximum/latest/0'),dynamic,appResults};
 fs.writeFileSync(root+'/validation/import-avoidance-1.2.17.json',JSON.stringify(result,null,2)+'\n');
 console.log(`Import avoidance 1.2.17: ${checks.length} groups; ${rows.length} TOU comparisons, ${dynamic.length} dynamic cases and ${appResults.length} real app/publication traces passed; ${violations.length} earlier violations resolved.`);
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>{global.Date=NativeDate;Date.now=nativeNow;});
