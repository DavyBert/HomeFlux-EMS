'use strict';
process.env.TZ='Europe/Brussels';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),{performance}=require('perf_hooks');
const root=path.resolve(__dirname,'..'),engine=require('../lib/ems-engine');
const {BatteryNightPlanner}=require('../lib/battery-night-planner');
const {planDynamicChargeDeferral}=require('../lib/dynamic-charge-deferral');
const {buildWidgetTouTimeline}=require('../lib/widget-tou-timeline');
const {localParts}=require('../lib/homey-energy');
const html=fs.readFileSync(path.join(root,'widgets/status/public/visual.html'),'utf8');
const H=3600000,M=60000;
function between(a,b){return html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)+a.length))}
function load(){
 const ctx=vm.createContext({Date,console,HOUR_MS:H,DAY_MS:24*H,CHART_STEPS:96,STEP_H:.25,source:'json',s:{},rawStatusObject:{},
 num:(v,f=null)=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?f:Number(v),cap:(v,a,b)=>Math.max(a,Math.min(b,v))});
 vm.runInContext(between('let normalizedTariffCache=null;','function buildRollingTimelineFromRows(')+between('function readHouseSamples(','function hourFromClock(')+between('function hourFromClock(','// Cumulative PV forecast')+'\nthis.rules=forecastRules;',ctx);return ctx;
}
const cases=[
 {name:'TOU hoog SOC, bestaand plan 0.4 kWh',start:'2026-11-16T17:00:00+01:00',soc:93.3,house:1.6},
 {name:'TOU laag SOC',start:'2026-11-16T22:00:00+01:00',soc:20},
 {name:'TOU onvoldoende capaciteit',start:'2026-11-16T22:00:00+01:00',soc:20,power:600},
 {name:'TOU weekend',start:'2026-11-21T16:00:00+01:00',soc:65},
 {name:'Dynamisch uur, aansluitend goedkoper',start:'2026-11-16T01:00:00+01:00',soc:35,dynamic:true,gap:0},
 {name:'Dynamisch kwartier, kort duur blok',start:'2026-11-16T01:00:00+01:00',soc:14,dynamic:true,quarter:true,gap:.5},
 {name:'Dynamisch lang duur blok',start:'2026-11-16T01:00:00+01:00',soc:18,dynamic:true,quarter:true,gap:3},
 {name:'Dynamisch ontbrekende toekomst',start:'2026-11-16T01:00:00+01:00',soc:35,dynamic:true,missing:true},
 {name:'Zonnige dag',start:'2026-11-16T07:00:00+01:00',soc:30,pv:35,reserve:0},
 {name:'Overgang 07 en 17 zonder PV-meting',start:'2026-11-16T06:00:00+01:00',soc:85,noForecast:true},
 {name:'Zomertijd 23 uur',start:'2026-03-28T17:00:00+01:00',soc:80},
 {name:'Wintertijd 25 uur',start:'2026-10-24T17:00:00+02:00',soc:80},
 {name:'Vast contract, maximum centrum binnen laadvenster',start:'2026-11-16T22:00:00+01:00',soc:35,fixed:true,strategy:'center'},
 {name:'TOU twee nachttarieven toegestaan',start:'2026-11-16T22:00:00+01:00',soc:20,dual:true},
 {name:'Maximum vroeg',start:'2026-11-16T22:00:00+01:00',soc:35,strategy:'early'},
 {name:'Maximum laatst',start:'2026-11-16T22:00:00+01:00',soc:35,strategy:'latest'},
 {name:'Maximum centrum',start:'2026-11-16T22:00:00+01:00',soc:35,strategy:'center'},
 {name:'Peak Guard laadruimte',start:'2026-11-16T22:00:00+01:00',soc:35,peak:true},
 {name:'Dynamisch avond, aansluitend goedkoper',start:'2026-11-16T15:00:00+01:00',soc:30,dynamic:true,quarter:true,evening:true,gap:.25},
];
function configure(c){
 const cfg={...engine.DEFAULTS,contractType:c.dynamic?(c.quarter?'dynamic_quarter':'dynamic_hour'):c.fixed?'fixed':'tou',timezone:'Europe/Brussels',batteryCount:1,totalCapacityKwh:21.6,
  minSoc:12,safetySoc:14,maxSoc:100,maxTotalChargeW:c.power||6000,maxChargePerBatteryW:c.power||6000,maxTotalDischargeW:6000,maxDischargePerBatteryW:6000,
  expectedEnergyNeedKwh:20,peakReserveTargetSoc:c.reserve??95,peakReserveNightEnabled:true,nightPlanningMaxSoc:95,dayPlanningMaxSoc:90,nightHysteresisEnabled:true,nightHysteresisSoc:3,
  peakShaveEnabled:false,sunChanceReserveEnabled:false,exportLimitEnabled:false,controlEnabled:true,forcedMode:'auto',cheapHours:4,expensiveHours:6,
  dynamicNormalChargeEnabled:true,dynamicNormalChargeMaxSoc:95,gridZeroMinW:0,gridZeroMaxW:0,batteryCommandStepW:1,
  lowForecastSelfConsumptionMinKwh:5};
 if(c.strategy)cfg.chargeStrategy={year:{day:{mode:'maximum',position:c.strategy},night:{mode:'maximum',position:c.strategy}}};
 if(c.peak){cfg.peakShaveEnabled=true;cfg.peakLimitW=2650;cfg.peakSoftMarginW=100;}
 cfg.touRates=cfg.touRates.map((r,i)=>({...r,importPrice:[.20,.30,.5][i]}));
 if(c.dual)cfg.touRates=cfg.touRates.map(r=>r.id==='dal'?{...r,weekdayChargeMode:'always',weekendChargeMode:'always'}:r);
 if(c.name==='TOU weekend')cfg.touSchedule=cfg.touSchedule.map(r=>r.rateId==='superdal'?{...r,start:'02:00',end:'07:00'}:r);
 return cfg;
}
function timeline(c,cfg,start){
 if(c.fixed)return [{startAt:start,endAt:start+49*H,className:'normal',price:.30,nightChargeAllowed:true,dayChargeAllowed:true}];
 if(!c.dynamic)return buildWidgetTouTimeline(cfg,start,49);
 const midnight=new Date(start);midnight.setHours(0,0,0,0);const end=start+49*H,step=c.quarter?15*M:H,rows=[];
 for(let at=midnight.getTime();at<end;at+=step){
  const d=new Date(at),hour=d.getHours()+d.getMinutes()/60,target=c.evening?17:7;
  const cheap=hour>=target+c.gap&&hour<target+c.gap+5;
  const expensive=hour>=target&&hour<target+c.gap;
  if(c.missing&&hour>=7&&hour<8)continue;
  rows.push({startAt:at,endAt:at+step,className:cheap?'cheap':expensive||hour>=20?'expensive':'normal',price:cheap?.08:expensive||hour>=20?.65:.30});
 }
 return rows;
}
function setup(c){
 const ctx=load(),cfg=configure(c),start=Date.parse(c.start),d=new Date(start),h=d.getHours()+d.getMinutes()/60;
 ctx.s={time:h*60,timeReferenceAt:start,soc:c.soc,capacityKwh:21.6,target:95,minSoc:14,maxSoc:100,dayMaxSoc:90,nightMaxSoc:95,dayTargetTime:'17:00',nightTargetTime:'07:00',forecast:c.noForecast?null:c.pv||0,remaining:c.noForecast?null:c.pv||0,tomorrowForecast:c.noForecast?null:c.pv||0,dailyHouseKwh:24,planReady:true,planRows:[]};
 const profile=ctx.getProfile();profile.house=Array(96).fill(c.house||1);profile.daily=24*(c.house||1);
 const rows=timeline(c,cfg,start);
 const phase=ctx.forecastPhase(start,{});ctx.s.planningTargetAt=phase.targetAt;
 const fw=rows.find(r=>r.endAt>start&&r.nightChargeAllowed);
 if(fw)ctx.s.planRows=[{startAt:fw.startAt,endAt:fw.endAt,plannedNetCharge:true,plannedChargeW:400/((fw.endAt-fw.startAt)/H),plannedEnergyKwh:.4,targetSoc:95}];
 ctx.rawStatusObject={settings:cfg,visualPlanner:{forecastSettings:cfg,nightHysteresisEnabled:cfg.nightHysteresisEnabled,forcedMode:'auto',maxTotalChargeW:cfg.maxTotalChargeW,maxTotalDischargeW:6000,expectedEnergyNeedKwh:20,chargeStrategy:cfg.chargeStrategy,peakReserveMonths:Array.from({length:12},(_,i)=>cfg['peakReserveMonth'+(i+1)])},tariffTimeline:rows};
 return {ctx,cfg,start,profile,rows};
}
function applyPhysical(energy,command,house,pv,dt,floor){
 const charge=Math.max(0,-command)/1000,discharge=Math.max(0,command)/1000;
 const solar=Math.min(charge,Math.max(0,pv-house)),grid=Math.max(0,charge-solar);
 return Math.max(0,Math.min(21.6,energy+(solar*.92+grid*.95)*dt-Math.min(discharge*dt/.93,Math.max(0,energy-floor*21.6/100))));
}
function simulate(c){
 const {ctx,cfg,start,profile,rows}=setup(c),before=performance.now(),prediction=ctx.projectedSoc(profile),ms=performance.now()-before;
 let energy=c.soc*21.6/100,previous=0,restart=null,nightPlanner=new BatteryNightPlanner(),previousStrategy=null;
 const curve={intervals:rows.map(r=>({startAt:r.startAt,endAt:r.endAt,price:r.price,className:r.className}))};
 const trace=[{at:start,soc:c.soc}],commands=[],targetRows=[];
 for(let i=1;i<prediction.pts.length;i++){
  const end=prediction.pts[i].at,at=prediction.pts[i-1].at,dt=(end-at)/H,h=ctx.forecastDisplayHour((at+end)/2),power=ctx.forecastPowerAt(profile,h),date=new Date(at),phase={night:date.getHours()<7||date.getHours()>=17};
  const remaining=(h<24?profile.pv:profile.tomorrowPv)?.reduce((sum,w,j)=>sum+Math.max(0,(j+1)*.25-Math.max(h%24,j*.25))*w,0)??null;
  const tomorrow=ctx.s.tomorrowForecast;
  const state={batterySoc:[energy/21.6*100],pvPowerW:c.noForecast?null:power.pv*1000,gridPowerW:(power.house-power.pv)*1000,controlGridPowerW:(power.house-power.pv)*1000,
   forecastDailyMaxKwh:c.noForecast?null:c.pv||0,forecastRemainingKwh:remaining,forecastTomorrowKwh:tomorrow,planningForecastDay:phase.night&&date.getHours()>=17?'tomorrow':'today',nightPlanningActive:phase.night,chargeRestartState:restart,lastTotalCommandW:0};
  const dated=rows.map(r=>({startMs:r.startAt,endMs:r.endAt,price:r.price,className:r.className}));
  const slots=rows.filter(r=>new Date(r.startAt).toDateString()===date.toDateString()).map(r=>({time:String(new Date(r.startAt).getHours()).padStart(2,'0')+':'+String(new Date(r.startAt).getMinutes()).padStart(2,'0'),price:r.price}));
  const settings={...cfg,dynamicSlots:slots,dynamicTariffTimeline:dated,dynamicPriceDataReady:!c.dynamic||slots.length>0,forecastDataReady:!c.noForecast,forecastDailyDataReady:!c.noForecast,forecastTomorrowDataReady:!c.noForecast};
  settings.dynamicChargeDeferral=engine.prepareDynamicChargeDeferral(state,settings,date);
  const args=engine.getBatteryNightPlanningInputs(state,settings,date);
  if(args)settings.batteryNightPlan=nightPlanner.evaluate({...args,curve});
  settings.batteryChargeStrategyPlan=engine.prepareChargeStrategy(state,settings,date,curve,null,previousStrategy);previousStrategy=settings.batteryChargeStrategyPlan;
  const plan=engine.buildSocPlan(state,settings,date);targetRows.push({at,target:plan.targetSoc,needKwh:plan.energyNeedKwh,plannedKwh:plan.rows.reduce((sum,r)=>sum+(r.plannedNetCharge?r.plannedEnergyKwh:0),0)});
  let result;
  for(let feedback=0;feedback<3;feedback++){
   state.lastTotalCommandW=previous;state.lastBatteryCommands=[previous];state.gridPowerW=(power.house-power.pv)*1000-previous;state.controlGridPowerW=state.gridPowerW;
   result=engine.evaluate(state,settings,date);previous=result.totalCommandW;
  }
  restart=result.chargeRestartState;
  energy=applyPhysical(energy,result.totalCommandW,power.house,power.pv,dt,result.ordinaryDischargeFloorSoc);
  commands.push({at,end,powerW:result.totalCommandW,houseKw:power.house,pvKw:power.pv,gridChargeKw:Math.max(0,-result.totalCommandW/1000-Math.max(0,power.pv-power.house)),mode:result.baseMode,target:result.planningChargeTargetSoc,deferral:settings.dynamicChargeDeferral?.active||false});
  trace.push({at:end,soc:energy/21.6*100});
 }
 const comparisons=prediction.goals.map(g=>{const at=ctx.forecastAtHour(g.h),achieved=trace.reduce((best,p)=>Math.abs(p.at-at)<Math.abs(best.at-at)?p:best,trace[0]).soc;return {at:new Date(at).toISOString(),hour:g.h,forecast:g.soc,achieved,deviation:Math.abs(g.soc-achieved)}});
 return {name:c.name,start:c.start,startSoc:c.soc,contract:cfg.contractType,forecastMs:ms,comparisons,prediction,commands,trace,rows,targets:targetRows};
}
// Pure policy copies are checked against the actual production modules.
const pure=load().rules;
for(const f of ['dynamic-charge-deferral.js','battery-night-planner.js','charge-strategy.js']){
 const source=fs.readFileSync(path.join(root,'lib',f),'utf8');assert(html.includes(source.slice(0,source.lastIndexOf('module.exports'))),'pure rule source drift: '+f);
}
let parity=0;
const matrix=timeline({dynamic:true,quarter:true,gap:1},configure({dynamic:true}),Date.parse('2026-11-16T01:00:00+01:00')).map(r=>({startMs:r.startAt,endMs:r.endAt,className:r.className,price:r.price}));
for(const soc of [14,20,35,94.8,95])for(const powerW of [100,600,2500,6000])for(const difference of [.009,.01,.011])for(const gap of [false,true]){
 const opts={rows:matrix.filter(r=>!gap||new Date(r.startMs).getHours()!==6).map(r=>({...r,price:r.className==='cheap'?.30-difference:r.price})),
  now:Date.parse('2026-11-16T01:00:00+01:00'),targetAt:Date.parse('2026-11-16T07:00:00+01:00'),nextTargetAt:Date.parse('2026-11-16T17:00:00+01:00'),targetSoc:95,soc,safetySoc:14,capacityKwh:21.6,powerW,expectedDailyKwh:20,normalChargeEnabled:true,normalMaxSoc:50};
 assert.equal(JSON.stringify(pure.planDynamicChargeDeferral(opts)),JSON.stringify(planDynamicChargeDeferral(opts)));parity++;
}
console.log('PASS '+parity+' exact dynamic-deferral comparisons, including 1-cent threshold, gaps, normal limits and capacity; three pure source copies match');
const check=setup(cases[0]);
const cached=check.ctx.projectedSoc(check.profile);
assert.strictEqual(check.ctx.projectedSoc(check.profile),cached,'unchanged input reuses the complete forecast');
check.ctx.rawStatusObject.evs=[{connected:true}];
assert.strictEqual(check.ctx.projectedSoc(check.profile),cached,'an EV status alone cannot invalidate the forecast');
const unknown=setup(cases[4]);unknown.ctx.rawStatusObject.tariffTimeline=unknown.rows.map(r=>({...r,price:null}));
assert(unknown.ctx.projectedSoc(unknown.profile).pts.every(p=>!p.gridKwh),'unknown dynamic prices cannot authorize ordinary charging');
const results=cases.map(c=>simulate(c));
for(const [i,r] of results.entries()){
 for(const p of r.prediction.pts){assert(p.soc>=14-1e-8&&p.soc<=100+1e-8,r.name+': safety/range');}
 for(let j=1;j<r.prediction.pts.length;j++){
  const p=r.prediction.pts[j],prev=r.prediction.pts[j-1];
  if(!p.gridKwh)continue;
  const rate=r.rows.find(row=>row.startAt<=prev.at&&row.endAt>prev.at);assert(rate,r.name+': charging requires known interval');
  if(cases[i].fixed){const hour=new Date(prev.at).getHours();assert(hour>=1&&hour<7,'fixed-contract charging outside configured window');}
  if(!cases[i].dynamic){const hour=new Date(prev.at).getHours(),night=hour<7||hour>=17;
   assert(rate[night?'nightChargeAllowed':'dayChargeAllowed']&&!rate.avoidGridImport,r.name+': forbidden TOU charging');}
 }
}
const high=results[0];assert(high.prediction.totalGrid>.4+5,'small active snapshot cannot limit future replanning');
assert(high.prediction.pts.find(p=>p.h>=25).soc<56,'high-SOC regression must actually reach the reported 50–55% range before superdal');
assert(results[2].comparisons[0].forecast<50,'unreachable goal is not forced to 95%');
assert(results[7].prediction.deferrals.length===0,'missing future intervals forbid deferral');
for(const r of results)console.log(r.name, r.comparisons.map(g=>`${g.hour}: ${g.forecast.toFixed(2)} vs ${g.achieved.toFixed(2)} Δ${g.deviation.toFixed(2)}`).join(' / '),r.forecastMs.toFixed(1)+'ms');
const dir=process.env.HOMEFLUX_SIMULATION_OUTPUT||path.join(root,'validation/release-1.5.8');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'simulations.json'),JSON.stringify({node:process.version,results},null,2));
for(const r of results)for(const g of r.comparisons)assert(g.deviation<=3,`${r.name}: ${g.hour} deviation ${g.deviation}`);
