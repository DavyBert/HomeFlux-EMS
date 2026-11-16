'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),Module=require('module');
process.env.TZ='UTC';
const {createSampler}=require('../lib/visual-house-history');
const T=Date.parse('2026-11-16T00:00:00Z'), H=3600000;
let checks=0;const ok=(v,msg)=>{assert.ok(v,msg);checks++};
const sampler=createSampler();let rows=[];
for(let i=0;i<=150;i++) rows.push(...sampler.sample(T+i*2000,1000+2000*i/150));
ok(rows.length===1,'one finalized five-minute average');
ok(rows[0][1]===2000&&rows[0][3]===300000,'time-weighted linear samples average to 2000 W');
ok(Math.abs(rows[0][1]*rows[0][3]/3.6e9-1/6)<1e-10,'correct measured kWh');
ok(sampler.sample(T+300000,9000).length===0,'duplicate P1 timestamps do not add energy');
const gaps=createSampler();gaps.sample(T,1000);gaps.sample(T+30000,1000);gaps.sample(T+31000,null);
gaps.sample(T+200000,1000);const incomplete=gaps.sample(T+300000,1000);
ok(incomplete.length===1&&incomplete[0][3]===30000,'invalid telemetry and gaps are never filled');
const midnight=createSampler();midnight.sample(T-10000,1000);const cross=midnight.sample(T+10000,1000);
ok(cross.length===1&&cross[0][0]===T-10000&&cross[0][3]===10000,'midnight splits old/new intervals');
const upgrade=createSampler();upgrade.sample(T+120001,1000);
let upgraded=[];for(let at=T+130001;at<T+300000;at+=10000)upgraded.push(...upgrade.sample(at,1000));
upgraded.push(...upgrade.sample(T+300000,1000));
ok(upgraded[0][0]===T+120001&&upgraded[0][3]===179999,'upgrade interval starts after existing legacy point, without losing partial bucket');
const load=Module._load;Module._load=function(r,p,m){if(r==='homey')return {App:class{}};if(r==='homey-api')return {HomeyAPI:{}};return load.call(this,r,p,m)};
let App;try{App=require('../app')}finally{Module._load=load}
const app=Object.create(App.prototype);
app.getSavingsDateKey=at=>new Date(at).toISOString().slice(0,10);app.state={pvPowerW:0};app.inputSeen={pv:true};
app.inputUpdatedAt={pv:T};app.evSessionDetection={physicalSiteLoadW:1800};app.savings={today:{date:'2026-11-16'}};
// No EV configuration and no Battery Saving/dispatch state is required by this observer.
for(let at=T;at<=T+300000;at+=10000)app.recordVisualHouseLoadSample(at);
ok(app.savings.today.houseLoadHistory.length===1,'recording independent of EV or Battery Saving');
app.state.pvPowerW=1000;app.inputUpdatedAt.pv=T-600000;
for(let at=T+310000;at<=T+900000;at+=10000)app.recordVisualHouseLoadSample(at);
ok(app.savings.today.houseLoadHistory.length===1,'stale nonzero PV cannot create house readings');
const oldNow=Date.now;Date.now=()=>T+H;
try{
 let full=app.getVisualHouseLoadHistory();ok(full.rows.length===1&&full.intervalSeconds===300,'read-only full snapshot');
 let delta=app.getVisualHouseLoadHistory({date:full.date,after:full.rows[0].at});ok(delta.rows.length===0,'unchanged status delta is empty');
 app.savings.today.houseLoadHistory.push([T+300000,2000,T+600000,300000]);
 delta=app.getVisualHouseLoadHistory({date:full.date,after:full.rows[0].at});ok(delta.rows.length===1,'only new five-minute point');
 ok(app.getVisualHouseLoadHistory({date:'2026-11-15',after:T+H}).rows.length===2,'new day resets cursor');
}finally{Date.now=oldNow}
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'widgets/status/public/visual.html'),'utf8');
const outer=fs.readFileSync(path.join(root,'widgets/status/public/index.html'),'utf8');
function between(s,a,b){return s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)+a.length))}
const num=(v,f=null)=>v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?f:Number(v);
const ctx=vm.createContext({console,Date,source:'json',s:{},rawStatusObject:{},num,cap:(v,a,b)=>Math.max(a,Math.min(b,v)),HOUR_MS:H,DAY_MS:24*H,CHART_STEPS:96,STEP_H:.25});
vm.runInContext(between(html,'let normalizedTariffCache=null;','function buildRollingTimelineFromRows(')+
 between(html,'function readHouseSamples(','function hourFromClock(')+
 between(html,'function hourFromClock(','// Cumulative PV forecast'),ctx);
ctx.s={time:10,historyRows:ctx.readHouseSamples([[T,1000],[T+120000,1000],[T+300000,2000,T+600000,300000]]),timeReferenceAt:T};
let hist=ctx.readHistory({nowH:1});ok(Math.abs(hist.total-(2/60+2*5/60))<1e-9,'mixed legacy/new durations are integrated independently');
function setup(overrides={}){
 ctx.s={time:60,timeReferenceAt:T+H,soc:15,capacityKwh:21.6,target:75,minSoc:12,maxSoc:100,
  dayMaxSoc:90,nightMaxSoc:95,dayTargetTime:'17:00',nightTargetTime:'07:00',forecast:0,remaining:0,tomorrowForecast:0,
  dailyHouseKwh:24,planReady:false,planRows:[],...overrides};
 ctx.rawStatusObject={settings:{contractType:'dynamic_quarter',minSoc:12,safetySoc:14,lowForecastSelfConsumptionMinKwh:5},
  visualPlanner:{maxTotalChargeW:6000,maxTotalDischargeW:6000,expectedEnergyNeedKwh:20,nightHysteresisEnabled:false},
  tariffTimeline:Array.from({length:192},(_,i)=>({startAt:T+i*.25*H,endAt:T+(i+1)*.25*H,className:'expensive',price:.5}))};
 return {nowH:ctx.s.time/60,pv:Array(96).fill(0),house:Array(96).fill(1),tomorrowPv:Array(96).fill(0),daily:24};
}
let profile=setup({soc:5});ctx.rawStatusObject.visualPlanner.forcedMode='standby';let curve=ctx.projectedSoc(profile);
ok(curve.pts.every(p=>p.soc<=5),'below-floor SoC never jumps to safety or target');
profile=setup({soc:60,target:60});ctx.rawStatusObject.settings.lowForecastDynamicExpensiveEnabled=true;
curve=ctx.projectedSoc(profile);ok(curve.pts.every(p=>Math.abs(p.soc-60)<1e-9),'full Battery Saving prevents forecast discharge');
ctx.rawStatusObject.settings.lowForecastDynamicExpensiveDischargeToTarget=true;ctx.s.target=40;
curve=ctx.projectedSoc(profile);ok(curve.pts.at(-1).soc>=40&&curve.pts.at(-1).soc<60,'discharge-to-target preserves target floor');
profile=setup({soc:50});ctx.rawStatusObject.settings.lowForecastDynamicExpensiveEnabled=true;
ctx.rawStatusObject.visualPlanner.sunnyOverrideDate='2026-11-16';
curve=ctx.projectedSoc(profile);ok(curve.pts.some(p=>p.h<24&&p.soc<50),'Sunny Override disables today low-PV saving');
profile=setup({soc:15});
for(const r of ctx.rawStatusObject.tariffTimeline){const h=(r.startAt-T)/H;if(h>=2&&h<4){r.className='cheap';r.price=.15}if(h>=8&&h<10){r.className='cheap';r.price=.10}}
curve=ctx.projectedSoc(profile);
ok(curve.predictedWindows.some(w=>w.startAt<T+7*H),'reserve charged before intervening expensive hours');
ok(curve.predictedWindows.some(w=>w.startAt>=T+8*H),'remaining charge deferred to cheaper later window');
ok(curve.pts.every(p=>p.soc>=14-1e-8),'future reserve respects safety floor when initially above it');
const repeated=ctx.projectedSoc(profile);ok(repeated===curve,'same relevant inputs reuse forecast result');
ctx.s.soc=30;ok(ctx.projectedSoc(profile)!==curve,'SOC change invalidates forecast cache');
profile=setup({soc:20,planReady:true,planningTargetAt:T+7*H,target:30,planRows:[{startAt:T+2*H,endAt:T+3*H,plannedChargeW:1000,plannedEnergyKwh:1,targetSoc:30,plannedNetCharge:true}]});
curve=ctx.projectedSoc(profile);ok(curve.windows.length===1&&curve.fromPlan,'existing EMS windows remain separately identified');
ok(curve.predictedWindows.some(w=>w.startAt<T+7*H),'future replanning can add charge inside the active phase without changing the snapshot');
profile=setup({soc:20,forecast:10,remaining:10});profile.pv=Array(96).fill(2);
curve=ctx.projectedSoc(profile);ok(curve.pts.some(p=>p.soc>20),'SOC increases from real forecast PV surplus');
// Evening deferral is independent from the morning fixture, for both source resolutions.
for(const contract of ['dynamic_hour','dynamic_quarter']){
 profile=setup({time:16*60,timeReferenceAt:T+16*H,soc:15,target:75});profile.nowH=16;
 ctx.rawStatusObject.settings.contractType=contract;
 for(const r of ctx.rawStatusObject.tariffTimeline){const h=(r.startAt-T)/H;
  if(h>=16&&h<17){r.className='cheap';r.price=.15}
  if(h>=18&&h<20){r.className='cheap';r.price=.10}
 }
 curve=ctx.projectedSoc(profile);
 ok(curve.predictedWindows.some(w=>w.startAt<T+17*H),contract+' evening bridge reserve before expensive hour');
 ok(curve.predictedWindows.some(w=>w.startAt>=T+18*H),contract+' additional window after evening goal');
}
profile=setup({soc:60,target:60,forecast:20,tomorrowForecast:20});
ctx.rawStatusObject.tariffTimeline=ctx.rawStatusObject.tariffTimeline.map(r=>({...r,className:'normal'}));
ctx.rawStatusObject.settings.highForecastDynamicPolicy={highForecastDynamicNormalBatterySave:true,highForecastDynamicNormalDischargeToTarget:false};
curve=ctx.projectedSoc(profile);ok(curve.pts.every(p=>Math.abs(p.soc-60)<1e-8),'High-PV full saving prevents discharge');
ctx.rawStatusObject.settings.highForecastDynamicPolicy.highForecastDynamicNormalBatterySave=false;
ok(ctx.projectedSoc(profile).pts.some(p=>p.soc<59),'existing high-PV setting change invalidates forecast');
profile=setup({time:65,timeReferenceAt:T+65*60000,soc:50});profile.nowH=65/60;
curve=ctx.projectedSoc(profile);ok(Math.abs(curve.pts[1].h-70/60)<1e-8,'partial first interval is included');
profile=setup({soc:15,target:95,forecast:100,remaining:100});profile.pv=Array(96).fill(20);
ctx.rawStatusObject.tariffTimeline=ctx.rawStatusObject.tariffTimeline.map(r=>({...r,className:'cheap',price:.1}));
curve=ctx.projectedSoc(profile);
ok(curve.predictedWindows.length===0,'PV already consuming full battery charge limit leaves no extra grid headroom');
for(let i=1;i<curve.pts.length;i++){
 const a=curve.pts[i-1],b=curve.pts[i],maxRise=6*(b.h-a.h)*.95/21.6*100;
 ok(b.soc-a.soc<=maxRise+1e-7,'combined PV/grid rise respects shared charge power');
}
// Widget transport: one initial endpoint call, then cursor deltas on /status.
let calls=0;const parent=vm.createContext({visualLook:true,Homey:{api:async()=>{calls++;return {date:'2026-11-16',rows:[{at:T,powerW:1000}]}}},sendVisual:()=>{},console});
vm.runInContext(between(outer,"      let persistedHouseHistory = [], historyDate = '', historyAfter = 0;","      let requestedPeriod = 'day'")+ '\nthis.read=refreshHouseHistory;this.merge=mergeHouseHistory;this.snap=visualHistorySnapshot;',parent);
(async()=>{
 await Promise.all([parent.read(),parent.read(),parent.read()]);ok(calls===1,'duplicate widget initialization makes one full history request');
 parent.merge({date:'2026-11-16',rows:[{at:T,powerW:1000},{at:T+300000,powerW:2000}]});
 ok(parent.snap(true).length===2,'incremental merge deduplicates points');
 ok(parent.snap()===undefined,'unchanged status does not copy full history');
 parent.merge({date:'2026-11-17',rows:[]});ok(parent.snap(true).length===0,'new day clears local history');
 parent.merge({date:'2026-11-16',rows:[{at:T,powerW:1000}]});ok(parent.snap(true).length===0,'late previous-day response ignored');
 let failures=0;
 const failed=vm.createContext({visualLook:true,Homey:{api:async()=>{failures++;throw new Error('temporary source failure')}},sendVisual:()=>{},console:{warn:()=>{}}});
 vm.runInContext(between(outer,"      let persistedHouseHistory = [], historyDate = '', historyAfter = 0;","      let requestedPeriod = 'day'")+'\nthis.read=refreshHouseHistory;',failed);
 await failed.read();await failed.read();ok(failures===1,'failed full history read cannot loop on future status changes');
 ok(!outer.includes('collectHouseSample(')&&!outer.includes('lastHouseHistoryAt'),'no competing local observations or history polling');
 console.log(`PASS 1.5.7 consolidation: ${checks} history, forecast, reserve, cache and transport checks`);
})().catch(e=>{console.error(e);process.exitCode=1});
// Snapshot protocol is stateless per widget cursor; unchanged planning rows are
// neither recalculated nor resent. Settings remain fresh on the same refresh.
(async()=>{
 const api=require('../widgets/status/api');
 let cfg={contractType:'fixed',batteryCount:1,fixedImportPrice:.3,dayPlanningMaxSoc:80};
 const fixture={planningCache:{lastCalculatedAt:T,value:{plan:{targetSoc:75,rows:[{startAt:T,endAt:T+H,plannedNetCharge:true,plannedChargeW:1000,plannedEnergyKwh:1}]}}},
  getPublicStatus:()=>({tariff:{label:'Vaste prijs'},inputs:{batterySoc:[50]}}),getSettings:()=>cfg,getSavingsStatus:()=>({})};
 const first=await api.getStatus({homey:{app:fixture},query:{visualSavings:'1'}});
 const second=await api.getStatus({homey:{app:fixture},query:{visualSavings:'1',planRevision:first.visualSocPlanRevision}});
 assert.equal(first.visualSocPlan.rows.length,1);assert.equal(second.visualSocPlan,undefined);
 assert.equal(second.tariffTimeline[0].label,'Vaste prijs');
 cfg={...cfg,dayPlanningMaxSoc:65};
 const changed=await api.getStatus({homey:{app:fixture},query:{visualSavings:'1',planRevision:first.visualSocPlanRevision}});
 assert.equal(changed.visualPlanner.dayPlanningMaxSoc,65);
 fixture.planningCache.value.plan={targetSoc:70,rows:[]};
 const updated=await api.getStatus({homey:{app:fixture},query:{visualSavings:'1',planRevision:first.visualSocPlanRevision}});
 assert.ok(updated.visualSocPlanRevision>first.visualSocPlanRevision);assert.equal(updated.visualSocPlan.rows.length,0);
 console.log('PASS 1.5.7 API: compact plan revision, cache invalidation, fresh settings and fixed-contract future tariff');
})().catch(e=>{console.error(e);process.exitCode=1});
