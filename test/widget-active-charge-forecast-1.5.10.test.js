'use strict';
process.env.TZ='Europe/Brussels';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),engine=require('../lib/ems-engine'),{buildWidgetTouTimeline}=require('../lib/widget-tou-timeline');
const {BatteryNightPlanner}=require('../lib/battery-night-planner');
const html=fs.readFileSync(process.env.HOMEFLUX_FORECAST_HTML||path.join(root,'widgets/status/public/visual.html'),'utf8');
const H=3600000,start=Date.parse('2026-11-17T16:25:00+01:00'),end=Date.parse('2026-11-17T16:45:00+01:00'),deadline=Date.parse('2026-11-17T17:00:00+01:00');
const keys=['avoidGridImport','lowForecastBatterySave','lowForecastDischargeToTarget','highForecastBatterySave','highForecastDischargeToTarget','dayChargeAllowed','nightChargeAllowed'];
function span(a,b){return html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)+a.length));}
function setup(c={}){
 const cfg={...engine.DEFAULTS,timezone:'Europe/Brussels',contractType:c.dynamic?(c.quarter?'dynamic_quarter':'dynamic_hour'):c.fixed?'fixed':'tou',batteryCount:1,totalCapacityKwh:21.6,
  minSoc:12,safetySoc:14,maxSoc:100,maxTotalChargeW:c.power??6000,maxTotalDischargeW:6000,maxChargePerBatteryW:6000,maxDischargePerBatteryW:6000,
  expectedEnergyNeedKwh:28,peakReserveTargetSoc:95,peakReserveNightEnabled:true,dayPlanningMaxSoc:90,nightPlanningMaxSoc:95,
  cheapHours:c.dynamic?10:6,expensiveHours:5,dynamicNormalChargeEnabled:true,dynamicNormalChargeMaxSoc:95,
  peakShaveEnabled:c.peak!==false,peakLimitW:2650,peakSoftMarginW:100,controlEnabled:true,forcedMode:'auto',
  exportLimitEnabled:false,sunChanceReserveEnabled:false,nightHysteresisEnabled:true,gridZeroMinW:0,gridZeroMaxW:0,batteryCommandStepW:1,
  chargeStrategy:{year:{day:{mode:c.standard?'standard':'maximum',position:c.position||'latest',planningMarginPercent:12},night:{mode:c.standard?'standard':'maximum',position:'latest',planningMarginPercent:12}}}};
 cfg.touRates=cfg.touRates.map((r,i)=>({...r,importPrice:[.2,.28,.4][i]}));
 if(c.fixed){cfg.fixedChargeWindowStart='11:00';cfg.fixedChargeWindowEnd='17:00';cfg.peakReserveNightEnabled=false;for(let m=1;m<=12;m++)cfg['peakReserveMonth'+m]=false;}
 const ctx=vm.createContext({Date,console,source:'json',HOUR_MS:H,DAY_MS:24*H,CHART_STEPS:96,STEP_H:.25,
  num:(v,f=null)=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?f:Number(v),cap:(v,a,b)=>Math.max(a,Math.min(b,v))});
 vm.runInContext(span('let normalizedTariffCache=null;','function buildRollingTimelineFromRows(')+span('function readHouseSamples(','function hourFromClock(')+span('function hourFromClock(','// Cumulative PV forecast'),ctx);
 const window={startAt:start-120000,endAt:end,plannedNetCharge:true,plannedChargeW:c.planPower??1800,plannedEnergyKwh:.6,targetSoc:90};
 ctx.s={time:16*60+25,timeReferenceAt:start,soc:87.8,target:90,capacityKwh:21.6,minSoc:90,maxSoc:100,dayMaxSoc:90,nightMaxSoc:95,
  dayTargetTime:'17:00',nightTargetTime:'07:00',forecast:c.pv??4.4,remaining:c.remaining??0,tomorrowForecast:4.4,dailyHouseKwh:14.4,
  planPhase:'day',planReady:true,planningTargetAt:deadline,
  nextChargeDetail:{state:'active',startAt:window.startAt,endAt:end,powerW:window.plannedChargeW,targetSoc:90},planned:.6,planRows:[window]};
 let rows=buildWidgetTouTimeline(cfg,start,49);
 if(c.fixed)rows=[{startAt:start,endAt:start+49*H,className:'normal',price:.28,nightChargeAllowed:true,dayChargeAllowed:true}];
 if(c.dynamic){const midnight=new Date(start);midnight.setHours(0,0,0,0);const step=c.quarter?H/4:H;
  rows=Array.from({length:72*H/step},(_,i)=>{const a=midnight.getTime()+i*step,h=new Date(a).getHours(),k=h>=1&&h<7||h>=13&&h<17?'cheap':h>=17&&h<22?'expensive':'normal';
   return {startAt:a,endAt:a+step,className:k,price:k==='cheap'?.1:k==='expensive'?.5:.28};});}
 const policies=structuredClone(rows);
 if(c.noPolicy)rows=rows.map(row=>{const copy={...row};for(const key of keys)delete copy[key];return copy;});
 const forecastSettings={...cfg,...c.forecastSettings};
 ctx.rawStatusObject={settings:cfg,baseMode:'charge',action:'grid_charge',forcedMode:'auto',controlEnabled:true,ordinaryDischargeFloorSoc:90,
  tariff:{className:'normal',rateId:'dal'},
  visualPlanner:{forecastSettings,forcedMode:'auto',maxTotalChargeW:cfg.maxTotalChargeW,maxTotalDischargeW:6000,chargeStrategy:cfg.chargeStrategy,expectedEnergyNeedKwh:28,
   nightHysteresisEnabled:true,peakReserveMonths:Array.from({length:12},(_,i)=>cfg['peakReserveMonth'+(i+1)]===true),...(c.noBackup?{}:{tariffPolicies:policies})},tariffTimeline:rows};
 const profile=ctx.getProfile();profile.house=Array(96).fill(.6);profile.daily=14.4;
 return {ctx,cfg,rows:policies,profile};
}
function simulate(c){
 const f=setup(c),{ctx,cfg,profile,rows}=f,p=ctx.projectedSoc(profile),goal=p.pts.find(v=>v.at===deadline);
 assert(goal.soc>89.7,'active plan must reach its feasible target: '+c.name);
 assert(p.pts.some(v=>v.at>deadline&&v.lossKwh>0),'normal discharge must resume: '+c.name);
 assert(p.pts.every(v=>v.soc>=14-1e-8&&v.soc<=100+1e-8),'safety reserve and maximum remain protected');
 const during=p.pts.filter(v=>v.at>start&&v.at<=end);
 assert(during.some(v=>v.charging==='ems'),'active charging remains confirmed EMS energy');
 assert(during.every(v=>!v.gridKwh||v.charging==='ems'),'do not count the same active charge as additional forecast');
 let energy=21.6*.878,previous=0,restart=null,previousStrategy=null;const nightPlanner=new BatteryNightPlanner(),trace=[{at:start,soc:87.8}],comparisons=[];
 const curve={intervals:rows.map(r=>({startAt:r.startAt,endAt:r.endAt,price:r.price,className:r.className}))};
 for(let i=1;i<p.pts.length;i++){
  const a=p.pts[i-1].at,b=p.pts[i].at,h=ctx.forecastDisplayHour((a+b)/2),physical=ctx.forecastPowerAt(profile,h),date=new Date(a),hour=date.getHours()+date.getMinutes()/60;
  const powers=h<24?profile.pv:profile.tomorrowPv;
  const remaining=powers?.reduce((n,w,j)=>n+Math.max(0,(j+1)*.25-Math.max(h%24,j*.25))*w,0)??null;
  const state={batterySoc:[energy/21.6*100],pvPowerW:physical.pv*1000,gridPowerW:(physical.house-physical.pv)*1000,controlGridPowerW:(physical.house-physical.pv)*1000,
   forecastRemainingKwh:remaining,forecastDailyMaxKwh:ctx.s.forecast,forecastTomorrowKwh:ctx.s.tomorrowForecast,
   planningForecastDay:hour>=17?'tomorrow':'today',nightPlanningActive:hour<7||hour>=17,chargeRestartState:restart,lastTotalCommandW:previous};
  const settings={...cfg,forecastDataReady:true,forecastDailyDataReady:true,forecastTomorrowDataReady:true};
  if(c.dynamic){settings.dynamicTariffTimeline=rows.map(r=>({startMs:r.startAt,endMs:r.endAt,price:r.price,className:r.className}));
   settings.dynamicSlots=rows.filter(r=>new Date(r.startAt).toDateString()===date.toDateString()).map(r=>({time:new Date(r.startAt).toTimeString().slice(0,5),price:r.price}));settings.dynamicPriceDataReady=true;
   settings.dynamicChargeDeferral=engine.prepareDynamicChargeDeferral(state,settings,date);
   const args=engine.getBatteryNightPlanningInputs(state,settings,date);if(args)settings.batteryNightPlan=nightPlanner.evaluate({...args,curve});}
  settings.batteryChargeStrategyPlan=engine.prepareChargeStrategy(state,settings,date,curve,null,previousStrategy);previousStrategy=settings.batteryChargeStrategyPlan;
  let out;for(let j=0;j<3;j++){state.lastTotalCommandW=previous;state.lastBatteryCommands=[previous];state.gridPowerW=(physical.house-physical.pv)*1000-previous;state.controlGridPowerW=state.gridPowerW;out=engine.evaluate(state,settings,date);previous=out.totalCommandW;}
  restart=out.chargeRestartState;
  const dt=(b-a)/H,charge=Math.max(0,-out.totalCommandW/1000),discharge=Math.max(0,out.totalCommandW/1000),solar=Math.min(charge,Math.max(0,physical.pv-physical.house)),grid=Math.max(0,charge-solar);
  energy=Math.min(21.6,Math.max(0,energy+(solar*.92+grid*.95)*dt-Math.min(discharge*dt/.93,Math.max(0,energy-21.6*out.ordinaryDischargeFloorSoc/100))));
  trace.push({at:b,soc:energy/21.6*100});
 }
 for(const g of p.goals){const at=ctx.forecastAtHour(g.h),actual=trace.find(v=>v.at===at);assert(actual);const error=Math.abs(actual.soc-g.soc);comparisons.push({hour:g.h,forecast:g.soc,engine:actual.soc,error});assert(error<=3,c.name+': goal error '+JSON.stringify(comparisons));}
 for(let i=1;i<p.pts.length;i++)assert(p.pts[i].gridKwh*.95+p.pts[i].pvKwh<=cfg.maxTotalChargeW/1000*((p.pts[i].at-p.pts[i-1].at)/H)*.95+1e-8,'PV/grid share charge limit');
 console.log('PASS '+c.name+' '+comparisons.map(g=>g.hour+': '+g.forecast.toFixed(2)+' / '+g.engine.toFixed(2)).join('; '));
 return {name:c.name,comparisons,prediction:p,trace};
}
const regression=setup({noPolicy:true});const regressionCurve=regression.ctx.projectedSoc(regression.profile);
assert(regressionCurve.pts.find(v=>v.at===deadline).soc>89.7&&regressionCurve.pts.some(v=>v.at>deadline&&v.lossKwh>0),'87.8% screenshot regression: active plan and exact cached tariff permissions must not leave a flat curve');
const results=[{name:'normal active charging',standard:true},{name:'maximum/latest active charging'},
 {name:'normal with missing display permissions',standard:true,noPolicy:true},{name:'maximum with missing display permissions',noPolicy:true},
 {name:'maximum/early active charging',position:'early'},{name:'PV and grid charging',pv:10,remaining:2},
 {name:'dynamic hourly active charging',dynamic:true},{name:'dynamic quarterly active charging',dynamic:true,quarter:true},{name:'fixed contract, active charging',fixed:true}].map(simulate);
const drift=setup({forecastSettings:{expectedEnergyNeedKwh:12,peakReserveTargetSoc:80}});assert(drift.ctx.projectedSoc(drift.profile).pts.find(v=>v.at===deadline).soc>=89.7,'current official target wins over an independently estimated target');
const noBackup=setup({noPolicy:true,noBackup:true});const partial=noBackup.ctx.projectedSoc(noBackup.profile);assert(partial.pts.find(v=>v.at===end).soc>89.7,'confirmed active charge remains usable without synthetic permissions');assert(partial.pts.every(v=>v.at<=end||!v.gridKwh),'do not invent later permissions');
const limited=setup({power:200,planPower:1800});assert(limited.ctx.projectedSoc(limited.profile).pts.find(v=>v.at===deadline).soc<89,'never force an infeasible goal');
for(const change of [{action:'pv_charge'},{decisionOutputPending:true},{batteryCommandPauseActive:true},{controlEnabled:false},{hybridEms:{delegated:true}},{baseMode:'self_consumption',action:'discharge'},{safetySocRecoveryActive:true}]){
 const f=setup({noPolicy:true,noBackup:true});Object.assign(f.ctx.rawStatusObject,change);assert(f.ctx.projectedSoc(f.profile).pts.every(v=>!v.gridKwh),'stale plan cannot force charging: '+JSON.stringify(change));}
const denied=setup({noPolicy:true});denied.ctx.rawStatusObject.tariffTimeline=denied.ctx.rawStatusObject.tariffTimeline.map(r=>({...r,dayChargeAllowed:false,nightChargeAllowed:false}));assert(denied.ctx.projectedSoc(denied.profile).pts.every(v=>!v.gridKwh),'active snapshot and backup never override an explicit prohibition');
const cached=setup();const a=cached.ctx.projectedSoc(cached.profile);assert.strictEqual(cached.ctx.projectedSoc(cached.profile),a);cached.ctx.rawStatusObject.action='idle';assert.notStrictEqual(cached.ctx.projectedSoc(cached.profile),a,'actual charge-state change invalidates forecast cache');
const changedEnergy=setup();const beforeEnergy=changedEnergy.ctx.projectedSoc(changedEnergy.profile);changedEnergy.ctx.s.planRows[0].plannedEnergyKwh=6;assert.deepEqual(changedEnergy.ctx.projectedSoc(changedEnergy.profile).pts,beforeEnergy.pts,'cached full-plan kWh cannot be added again');
const wrongPolicy=setup({noPolicy:true});wrongPolicy.ctx.rawStatusObject.visualPlanner.tariffPolicies=wrongPolicy.ctx.rawStatusObject.visualPlanner.tariffPolicies.map(p=>({...p,rateId:'another-rate'}));assert(wrongPolicy.ctx.projectedSoc(wrongPolicy.profile).pts.every(v=>v.at<=end||!v.gridKwh),'never borrow permissions from another rate');
const unknown=setup({dynamic:true});unknown.ctx.rawStatusObject.tariffTimeline=unknown.ctx.rawStatusObject.tariffTimeline.map(r=>({...r,price:null}));assert(unknown.ctx.projectedSoc(unknown.profile).pts.every(v=>!v.gridKwh),'cached policy context does not invent unknown dynamic prices');
const avoid=setup();avoid.ctx.rawStatusObject.tariffTimeline=avoid.ctx.rawStatusObject.tariffTimeline.map(r=>({...r,avoidGridImport:true}));const avoiding=avoid.ctx.projectedSoc(avoid.profile);assert(avoiding.pts[1].soc<87.8&&avoiding.pts.every(v=>!v.gridKwh),'explicit import avoidance wins over stale active-plan protection');
const deferred=setup({dynamic:true,quarter:true});deferred.ctx.rawStatusObject.tariffTimeline=deferred.ctx.rawStatusObject.tariffTimeline.map(r=>{const h=new Date(r.startAt).getHours();return {...r,className:h<17?'normal':h<18?'expensive':'cheap',price:h<17?.28:h<18?.5:.1};});const deferring=deferred.ctx.projectedSoc(deferred.profile);assert(deferring.deferrals.length>0&&deferring.pts.every(v=>v.at>deadline||!v.gridKwh),'active snapshot cannot defeat a feasible dynamic deferral');
if(process.env.HOMEFLUX_ACTIVE_SIMULATION_OUTPUT)fs.writeFileSync(process.env.HOMEFLUX_ACTIVE_SIMULATION_OUTPUT,JSON.stringify({node:process.version,results},null,2));
console.log('PASS screenshot scenario, official target, physical limits, no double counting, PV-only/stale/paused/external rejection, exact permissions and cache');
