'use strict';
process.env.TZ='Europe/Brussels';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const engine=require('../lib/ems-engine'),strategy=require('../lib/charge-strategy');
const {buildWidgetTouTimeline}=require('../lib/widget-tou-timeline');
const {BatteryNightPlanner}=require('../lib/battery-night-planner');
const H=3600000,root=path.resolve(__dirname,'..');
const html=fs.readFileSync(process.env.HOMEFLUX_FORECAST_HTML||path.join(root,'widgets/status/public/visual.html'),'utf8');
function between(a,b){return html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)+a.length));}
function load(){
 const ctx=vm.createContext({Date,console,HOUR_MS:H,DAY_MS:24*H,CHART_STEPS:96,STEP_H:.25,source:'json',s:{},rawStatusObject:{},
  num:(v,f=null)=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?f:Number(v),cap:(v,a,b)=>Math.max(a,Math.min(b,v))});
 vm.runInContext(between('let normalizedTariffCache=null;','function buildRollingTimelineFromRows(')+between('function readHouseSamples(','function hourFromClock(')+between('function hourFromClock(','// Cumulative PV forecast'),ctx);
 return ctx;
}
function fixture(c={}){
 const ctx=load(),start=Date.parse('2026-11-16T13:00:00+01:00'),resume=Date.parse(c.resume||'2026-11-16T17:00:00+01:00');
 const cfg={...engine.DEFAULTS,timezone:'Europe/Brussels',contractType:c.dynamic?'dynamic_hour':'tou',batteryCount:1,totalCapacityKwh:21.6,
  minSoc:12,safetySoc:14,maxSoc:c.maxSoc??100,maxTotalChargeW:6000,maxChargePerBatteryW:6000,maxTotalDischargeW:6000,maxDischargePerBatteryW:6000,
  expectedEnergyNeedKwh:20,peakReserveTargetSoc:95,peakReserveNightEnabled:true,dayPlanningMaxSoc:95,nightPlanningMaxSoc:95,
  forcedMode:c.auto?'auto':'manual_charge',overrideResumeOnTariffChange:c.noResume!==true,
  controlEnabled:true,peakShaveEnabled:!!c.peak,peakLimitW:2650,peakSoftMarginW:100,exportLimitEnabled:false,
  gridZeroMinW:0,gridZeroMaxW:0,batteryCommandStepW:1,nightHysteresisEnabled:true,cheapHours:6,expensiveHours:5};
 cfg.touRates=cfg.touRates.map((r,i)=>({...r,importPrice:[.20,.30,.50][i]}));
 if(c.maximum){cfg.chargeStrategy=strategy.normalize();cfg.chargeStrategy.year.day={mode:'maximum',position:c.maximum,extraPercent:0,planningMarginPercent:0};}
 ctx.s={time:13*60,timeReferenceAt:start,soc:c.soc??35,capacityKwh:21.6,target:95,minSoc:14,maxSoc:cfg.maxSoc,
  dayMaxSoc:95,nightMaxSoc:95,dayTargetTime:'17:00',nightTargetTime:'07:00',forecast:c.pv??0,remaining:c.pv??0,tomorrowForecast:0,
  dailyHouseKwh:c.noBudget?null:24,planReady:true,planningTargetAt:Date.parse('2026-11-16T17:00:00+01:00'),planPhase:'day',planRows:[]};
 const midnight=new Date(start);midnight.setHours(0,0,0,0);
 const rows=c.dynamic?Array.from({length:72},(_,i)=>{const a=midnight.getTime()+i*H,h=new Date(a).getHours(),kind=h>=1&&h<7?'cheap':h>=17&&h<22?'expensive':'normal';
  return {startAt:a,endAt:a+H,className:kind,price:c.unknownPrices?null:kind==='cheap'?.1:kind==='expensive'?.5:.3};})
  :buildWidgetTouTimeline(cfg,start,49);
 ctx.rawStatusObject={settings:cfg,forcedMode:cfg.forcedMode,forcedModeResumeAt:resume,
  visualPlanner:{forecastSettings:cfg,forcedMode:cfg.forcedMode,chargeStrategy:cfg.chargeStrategy,maxTotalChargeW:6000,maxTotalDischargeW:6000,
   expectedEnergyNeedKwh:20,peakReserveMonths:Array.from({length:12},(_,i)=>cfg['peakReserveMonth'+(i+1)])},tariffTimeline:rows};
 const profile=ctx.getProfile();
 if(!c.noBudget){profile.house=Array(96).fill(1);profile.daily=24;}
 return {ctx,cfg,start,resume,rows,profile};
}
function simulate(c){
 const f=fixture(c),{ctx,cfg,start,resume,profile}=f,p=ctx.projectedSoc(profile);
 let energy=21.6*ctx.s.soc/100,previous=0,restart=null,maxError=0,errorAt=null;
 const trace=[{at:start,soc:ctx.s.soc}],nightPlanner=new BatteryNightPlanner();
 for(let i=1;i<p.pts.length;i++){
  const a=p.pts[i-1].at,b=p.pts[i].at;if(a>=Date.parse('2026-11-16T20:00:00+01:00'))break;
  const h=ctx.forecastDisplayHour((a+b)/2),physical=ctx.forecastPowerAt(profile,h),date=new Date(a),hour=date.getHours()+date.getMinutes()/60;
  const powers=h<24?profile.pv:profile.tomorrowPv;
  const remaining=powers?.reduce((sum,w,j)=>sum+Math.max(0,(j+1)*.25-Math.max(h%24,j*.25))*w,0)??null;
  const state={batterySoc:[energy/21.6*100],pvPowerW:physical.pv*1000,gridPowerW:0,controlGridPowerW:0,
   forecastRemainingKwh:remaining,forecastDailyMaxKwh:c.pv??0,forecastTomorrowKwh:0,
   planningForecastDay:hour>=17?'tomorrow':'today',nightPlanningActive:hour<7||hour>=17,
   lastTotalCommandW:previous,chargeRestartState:restart};
  const forced=cfg.overrideResumeOnTariffChange&&a>=resume?'auto':cfg.forcedMode;
  const settings={...cfg,forcedMode:forced,forecastDataReady:true,forecastDailyDataReady:true,forecastTomorrowDataReady:true};
  if(c.dynamic){
   settings.dynamicTariffTimeline=f.rows.filter(r=>r.price!==null).map(r=>({startMs:r.startAt,endMs:r.endAt,price:r.price,className:r.className}));
   settings.dynamicSlots=f.rows.filter(r=>r.price!==null&&new Date(r.startAt).toDateString()===date.toDateString()).map(r=>({time:new Date(r.startAt).toTimeString().slice(0,5),price:r.price}));
   settings.dynamicPriceDataReady=!c.unknownPrices;
   settings.dynamicChargeDeferral=engine.prepareDynamicChargeDeferral(state,settings,date);
   const args=engine.getBatteryNightPlanningInputs(state,settings,date);
   if(args)settings.batteryNightPlan=nightPlanner.evaluate({...args,curve:{intervals:f.rows.filter(r=>r.price!==null)}});
  }
  let out;
  for(let j=0;j<3;j++){
   state.lastTotalCommandW=previous;state.lastBatteryCommands=[previous];state.gridPowerW=(physical.house-physical.pv)*1000-previous;state.controlGridPowerW=state.gridPowerW;
   out=engine.evaluate(state,settings,date);previous=out.totalCommandW;
  }
  restart=out.chargeRestartState;
  const dt=(b-a)/H,charge=Math.max(0,-out.totalCommandW/1000),discharge=Math.max(0,out.totalCommandW/1000);
  const solar=Math.min(charge,Math.max(0,physical.pv-physical.house)),grid=Math.max(0,charge-solar);
  energy=Math.min(21.6*cfg.maxSoc/100,Math.max(0,energy+(solar*.92+grid*.95)*dt-Math.min(discharge*dt/.93,Math.max(0,energy-21.6*out.ordinaryDischargeFloorSoc/100))));
  const soc=energy/21.6*100;trace.push({at:b,soc});
  if(Math.abs(soc-p.pts[i].soc)>maxError){maxError=Math.abs(soc-p.pts[i].soc);errorAt={at:new Date(b).toISOString(),soc,forecast:p.pts[i],mode:out.baseMode,command:out.totalCommandW,tariff:out.tariff};}
 }
 assert(p.pts[1].soc>p.pts[0].soc,'forced charging must increase the forecast: '+c.name);
 assert(p.pts.every(x=>x.soc>=14-1e-8&&x.soc<=cfg.maxSoc+1e-8),c.name+': physical range');
 assert(maxError<=3,c.name+': maximum engine error '+maxError+' '+JSON.stringify(errorAt));
 if(c.noResume)assert(p.pts.every(x=>!x.lossKwh),'do not invent a return to Auto at full SoC');
 else if(!c.unknownPrices)assert(p.pts.some(x=>x.at>resume&&x.lossKwh>0),c.name+': discharge policy must resume');
 for(let i=1;i<p.pts.length;i++){
  const dt=(p.pts[i].at-p.pts[i-1].at)/H;
  assert(p.pts[i].gridKwh*.95+p.pts[i].pvKwh<=6*dt*.95+1e-8,'PV and grid share maximum power');
 }
 console.log('PASS '+c.name+'; max error '+maxError.toFixed(3)+' pp');return {name:c.name,maxError,prediction:p,trace};
}
const results=[
 {name:'forced TOU, return to Auto'},
 {name:'forced TOU with PV',pv:20},
 {name:'forced TOU with Peak Guard',peak:true},
 {name:'forced TOU, configured maximum 80%',maxSoc:80},
 {name:'forced charge remains selected without automatic resume',noResume:true},
 {name:'forced dynamic, known prices',dynamic:true},
 {name:'forced dynamic, unknown prices',dynamic:true,unknownPrices:true},
 {name:'resume between five-minute boundaries',resume:'2026-11-16T17:02:30+01:00'},
].map(simulate);
const f=fixture(),first=f.ctx.projectedSoc(f.profile);
assert.strictEqual(f.ctx.projectedSoc(f.profile),first,'complete forecast cache remains active');
f.ctx.rawStatusObject.batteryTiming={direction:'charge',powerW:500,hours:20};
assert.strictEqual(f.ctx.projectedSoc(f.profile),first,'no extrapolation of a momentary command');
f.ctx.rawStatusObject.forcedModeResumeAt+=H;
assert.notStrictEqual(f.ctx.projectedSoc(f.profile),first,'resume boundary invalidates forecast cache');
const missing=fixture({noBudget:true});
assert.equal(missing.profile.daily,20,'existing EMS demand estimate remains available without WAF budget');
const m=missing.ctx.projectedSoc(missing.profile);assert(m.pts.some(x=>x.lossKwh>0),'missing WAF budget cannot freeze a known demand estimate');
for(const maximum of [false,'early','latest','center']){
 const a=fixture({auto:true,maximum});const p=a.ctx.projectedSoc(a.profile);
 assert(p.pts.some(x=>x.gridKwh>0)&&p.pts.some(x=>x.lossKwh>0),'normal/max strategy forecasts charge and discharge');
 assert(p.pts.every(x=>{const h=new Date(x.at-1).getHours();return !x.gridKwh||a.rows.some(r=>r.startAt<=x.at-1&&r.endAt>=x.at&&r[h>=17||h<7?'nightChargeAllowed':'dayChargeAllowed']);}),'Auto never charges outside allowed windows');
}
if(process.env.HOMEFLUX_FORCED_SIMULATION_OUTPUT)fs.writeFileSync(process.env.HOMEFLUX_FORCED_SIMULATION_OUTPUT,JSON.stringify({node:process.version,results},null,2));
console.log('PASS cache, PV separation, missing budget, normal and all maximum-power strategies');
