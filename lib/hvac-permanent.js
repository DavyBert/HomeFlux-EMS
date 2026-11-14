'use strict';
// Extension of the existing HVAC decision/publication pipeline. No timers or
// raw meter histories: bounded corrected residuals belong to the learner only.
const learning = require('./hvac-learning');
const periodic = require('./hvac-periodic');
const coordination = require('./hvac-coordination');
const MINUTE = 60000;
const CONTROL_SETTLE_MS = 10000;
const finite = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
const clamp = (x,a,b) => Math.max(a,Math.min(b,Number(x)));
const fields = { PermanentEnabled:false, TariffEnabled:false, PvEnabled:false, Direction:'auto', DirectionTemperature:{source:'indoor',heatingBelowC:16,coolingAboveC:25},
 CheapTargetC:21, NormalTargetC:21, ExpensiveTargetC:21, PvTargetC:23, AfterPvTargetC:21, Coordination:{TariffAutoModeEnabled:true,CoolingOffsetC:2,EssentialEnabled:false,DirectTariffEnabled:false,DirectPvEnabled:false,SharedPowerEnabled:false,SharedPowerWith:0,StandbyTemperatureC:'',AutomaticOffAction:'off',KeepOnEnabled:false,KeepOnLimitEnabled:false,KeepOnMarginC:1}, OutdoorNoIncreaseEnabled:false, OutdoorNoIncreaseAboveC:20, OutdoorOffEnabled:false, OutdoorOffBelowC:5, OutdoorOffBelowHysteresisC:1, OutdoorOffAboveEnabled:false, OutdoorOffAboveC:25, OutdoorOffAboveHysteresisC:.5, PeriodicHeatEnabled:false, PeriodicHeatDays:7, PeriodicHeatHours:1, PeriodicHeatTargetC:30 };
function defaults() {
 const d={hvacExtraGridBudgetEnabled:false,hvacExtraGridBudgetW:0,hvacCoordination:Array.from({length:10},()=>({...fields.Coordination}))};
 for(let i=1;i<=10;i++)for(const [k,v]of Object.entries(fields))if(k!=='Coordination')d[`hvac${i===1?'':i}${k}`]=v;
 return d;
}
function signature(s) { return JSON.stringify(Object.keys(fields).map(k=>s['hvac'+k]).concat(s.hvacEnabled,s.hvacAutomaticControlEnabled,s.hvacAllowSetpointControl,s.hvacAllowModeControl,s.hvacAllowPowerControl,s.hvacExtraGridBudgetEnabled,s.hvacExtraGridBudgetW,s.peakShaveEnabled,s.peakLimitW,s.peakSoftMarginW)); }
function enabled(s) { return Boolean(s.hvacPermanentEnabled); }
function activationMode(s,room,outdoor,indoorOnly=false) {
 const outside=!indoorOnly&&s.hvacDirectionTemperature?.source==='outdoor',temperature=outside?outdoor:room;
 const indoorBelow=Number(s.hvacHeatingActivationBelowC),indoorAbove=Number(s.hvacCoolingActivationAboveC);
 const below=outside?(finite(s.hvacDirectionTemperature?.heatingBelowC)?Number(s.hvacDirectionTemperature?.heatingBelowC):16):(Number.isFinite(indoorBelow)?indoorBelow:20);
 const above=outside?(finite(s.hvacDirectionTemperature?.coolingAboveC)?Number(s.hvacDirectionTemperature?.coolingAboveC):25):(Number.isFinite(indoorAbove)?indoorAbove:24);
 return !finite(temperature)?null:Number(temperature)<below?'heat':Number(temperature)>above?'cool':null;
}
function runtime(app) {
 if(!app.hvacPermanentRuntime) {
  const saved=app.homey.settings.get('_hvacPermanent');
  app.hvacPermanentRuntime={version:1, nextAt:Math.max(0,Number(saved?.nextAt)||0), units:saved?.version===1? saved.units||{}:{}, observation:null, manualQueue:[]};
  for(const u of Object.values(app.hvacPermanentRuntime.units)){if(u.manualProbe)u.manualRestore=true;if(u.status==='Leren')u.status='Wachten';for(const m of ['heat','cool'])if(u[m+'Status']==='Leren')u[m+'Status']='Wachten';}
 }
 return app.hvacPermanentRuntime;
}
function unit(app,index) { const r=runtime(app); return r.units[index] ||= { setpoint:null,mode:'',heat:null,cool:null,heatReview:false,coolReview:false,status:'Nog niet geleerd' }; }
// Each HVAC has its own control window. A successful change opens a 10-second
// window for follow-up commands; only after that quiet period does the normal
// configured control interval count down. No timer or additional polling.
function controlIntervalReady(app,index,s,now=Date.now()) {
 const u=unit(app,index);
 const last=Number(u.controlChangedAt || u.outputAt) || 0;
 if(last<=0)return true;
 const elapsed=now-last;
 if(elapsed<0)return false;
 const interval=Math.max(1,Number(s.hvacControlIntervalMinutes)||5)*MINUTE;
 return elapsed<CONTROL_SETTLE_MS || elapsed>=CONTROL_SETTLE_MS+interval;
}
function recordControlChange(app,index,now=Date.now()) {
 const r=runtime(app),u=unit(app,index),s=app.getHvacInstanceSettings(index);
 u.controlChangedAt=now;
 u.nextAt=now+CONTROL_SETTLE_MS+Math.max(1,Number(s.hvacControlIntervalMinutes)||5)*MINUTE;
 // Retain the old diagnostic field for stored-state compatibility, but it
 // must never block another independently controlled HVAC.
 r.nextAt=u.nextAt;
 persist(app);
}
// Transient ownership, separate from persisted learning/output receipts. Only
// a successful standard comfort start arms a cycle; a takeover cannot inherit it.
function clearComfortCycle(app,index,preserveMode=false) {
 const r=app.hvacPermanentRuntime;
 if(!r?.comfortCycles?.[index])return;
 delete r.comfortCycles[index];
 if(!preserveMode&&r.units[index])r.units[index].comfortMode='';
}
function syncComfortCycle(app,index,s,explicitOff=false) {
 const r=app.hvacPermanentRuntime,c=r?.comfortCycles?.[index];if(!c)return;
 const target=c.mode==='heat'?s.hvacComfortMinC:s.hvacComfortMaxC;
 if(explicitOff||!s.hvacEnabled||!s.hvacPermanentEnabled||s.hvacAutomaticControlEnabled===false
  ||s.hvacTariffEnabled||s.hvacPvEnabled||s.hvacPeriodicHeatEnabled||s.hvacCoordination?.KeepOnEnabled
  ||r.units[index]?.periodic?.applied||r.units[index]?.manualProbe||r.manualQueue?.some(x=>x.index===index)
  ||s.hvacDirection!=='auto'&&s.hvacDirection!==c.mode||!finite(target)||Math.round(clamp(target,5,99)*2)/2!==c.target)
  clearComfortCycle(app,index,Boolean(!explicitOff&&s.hvacEnabled&&s.hvacPermanentEnabled&&s.hvacAutomaticControlEnabled!==false
   &&s.hvacCoordination?.KeepOnEnabled&&!s.hvacTariffEnabled&&!s.hvacPvEnabled&&!s.hvacPeriodicHeatEnabled));
}
function persist(app) {
 const r=runtime(app),saved={version:1,nextAt:r.nextAt,units:r.units},json=JSON.stringify(saved);
 if(r.persistedLearningJson===json)return;
 app.setSetting('_hvacPermanent',saved);r.persistedLearningJson=json;
}
function evFree(app,now=Date.now()) {return learning.evFree(app,now);}
function safeMeter(app,now) {return !learning.meter(app,now).reason;}
function cancel(app,reason='Onvoldoende betrouwbaar') {
 const r=app.hvacPermanentRuntime;if(!r?.observation)return;
 const o=r.observation,u=unit(app,o.index);u.status=reason;u[o.mode+'Status']=reason;
 u[o.mode+'Reason']=reason;u[o.mode+'Phase']='rejected';r.observation=null;
 if(u.manualProbe)u.manualRestore=true;
 persist(app);
}
function observe(app,now=Date.now()) {learning.sample(app,now);}
function slowTick(app,now=Date.now()) {
 const r=app.hvacPermanentRuntime;if(!r)return;
 if(r.observation){learning.sample(app,now);if(r.observation.invalidReason)cancel(app,r.observation.invalidReason);else finish(app,now);return;}
 // Retry reference acquisition on the existing HVAC scheduler only. A new
 // attributable load step is still required; never invent a step on P1 input.
 for(let i=0;i<app.getHvacCount();i++)learning.prepare(app,i,now);
 if(r.learningReference){
  const reason=learning.meter(app,now).reason||(!learning.baseline(app,now)?learning.reasons.reference:learning.reasons.wait);
  let changed=false;
  for(const u of Object.values(r.units))for(const mode of ['heat','cool'])if(u[mode+'Phase']==='waiting'&&u[mode+'Reason']!==reason){u[mode+'Reason']=reason;changed=true;}
  if(changed)persist(app);
 }
}
function finish(app,now=Date.now()) {
 const r=app.hvacPermanentRuntime,o=r?.observation;if(!o||now<o.endAt)return;
 learning.sample(app,now);r.observation=null;
 const cadence=Number(app.getSlowControlIntervalMs?.(app.settingsCache||app.getSettings()))||MINUTE;
 const lateLimit=Math.max(MINUTE,Math.min(5*MINUTE,2*cadence));
 const u=unit(app,o.index),result=now>o.endAt+lateLimit?{reason:learning.reasons.points}:learning.estimate(o);
 const reliable=!result.reason&&learning.accept(u,o.mode,result,o.endAt,o.startAt);
 if(!result.reason)u[o.mode+'BatterySource']=o.batterySource||'measured';
 u.status=result.reason|| (reliable?'Betrouwbaar':learning.reasons.building);
 u[o.mode+'Status']=u.status;u[o.mode+'Reason']=result.reason||(reliable?learning.reasons.done:learning.reasons.building);
 u[o.mode+'Phase']=result.reason?'rejected':reliable?'reliable':'provisional';
 if(o.manual){if(reliable)r.manualQueue=(r.manualQueue||[]).filter(x=>x.index!==o.index);if(u.manualProbe)u.manualRestore=true;}
 r.referenceBarrier=now;delete r.learningReference;
 persist(app);
}
function canBegin(app,index,now=Date.now()) {
 const r=runtime(app),s=app.getHvacInstanceSettings(index),u=unit(app,index);
 learning.prepare(app,index,now);
 const fail=reason=>{u.learningWaitReason=reason;return null;};
 if(r.observation)return fail(learning.reasons.wait);
 if(s.hvacCoordination?.SharedPowerEnabled)return fail(learning.reasons.shared);
 const cached=app.settingsCache;
 const all=Array.from({length:app.getHvacCount(cached)},(_,i)=>cached?{hvacCoordination:cached.hvacCoordination?.[i]||fields.Coordination}:app.getHvacInstanceSettings(i));
 if(all.some((_,i)=>i!==index&&coordination.rootFor(all,i)===index))return fail(learning.reasons.shared);
 const interval=Math.max(1,Number(s.hvacControlIntervalMinutes)||5)*MINUTE;
 if(interval<5*MINUTE)return fail(learning.reasons.interval);
 const measured=learning.meter(app,now);if(measured.reason)return fail(measured.reason);
 const step=r.learningStep;
 const baseline=step?.index===index&&now>=step.at&&now-step.at<15000?step.baseline:learning.baseline(app,now);
 if(!baseline)return fail(learning.reasons.reference);
 const expected=finite(u.heat)?Number(u.heat):finite(u.cool)?Number(u.cool):1000;
 if(baseline.baseSigma>Math.max(200,expected*.25)||baseline.baseError>Math.max(100,expected*.15))return fail(learning.reasons.noise);
 const before=step?.index===index&&now>=step.at&&now-step.at<15000?step.beforeW:measured.watts;
 if(!finite(before)||Math.abs(before-baseline.base)>Math.max(150,3*baseline.baseSigma,expected*.25))return fail(learning.reasons.reference);
 delete u.learningWaitReason;
 return {interval,...baseline};
}
function begin(app,index,d,now=Date.now()) {
 const r=runtime(app),u=unit(app,index),s=app.getHvacInstanceSettings(index);
 if(r.observation||s.hvacCoordination?.SharedPowerEnabled||!['heat','cool'].includes(d.direction))return;
 if(!d.manualLearning&&(s.hvacCoordination?.DirectTariffEnabled||s.hvacCoordination?.DirectPvEnabled||d.suppressAutoLearning||r.manualQueue?.length))return;
 if(!d.manualLearning&&finite(u[d.direction])&&!u[d.direction+'Review'])return;
 const baseline=canBegin(app,index,now);
 // Increasing an already demanding setpoint measures an incremental change,
 // not the device's full power. Do not certify that as normal HVAC wattage.
 const running=finite(d.currentSetpointC)&&finite(d.roomTemperatureC)&&d.currentMode!=='off'&&
  (d.currentMode==='cool'?Number(d.roomTemperatureC)>Number(d.currentSetpointC)+.25:Number(d.roomTemperatureC)<Number(d.currentSetpointC)-.25);
 if(!baseline||running){
  u.status='Wachten';u[d.direction+'Status']='Wachten';u[d.direction+'Reason']=running?learning.reasons.step:u.learningWaitReason;
  u[d.direction+'Phase']='waiting';persist(app);return;
 }
 r.observation={index,mode:d.direction,...baseline,startAt:now,lastAt:now,endAt:now+baseline.interval,
  spacing:Math.max(10000,(baseline.interval-MINUTE)/39),points:[],attempted:0,manual:Boolean(d.manualLearning)};
 delete r.learningReference;delete r.learningStep;
 if(d.manualLearning&&!d.manualLegacy){u.manualProbe=true;u.manualOriginalTarget=d.manualOriginalTarget;}
 u.status='Leren';u[d.direction+'Status']='Leren';u[d.direction+'Reason']='';u[d.direction+'Phase']='measuring';persist(app);
}
function recheck(app,index,direction) {
 if(!Number.isInteger(index)||index<0||index>=app.getHvacCount())throw new Error('HVAC is niet geconfigureerd.');
 if(!['heat','cool','both'].includes(direction))throw new Error('Ongeldige richting.');
 const u=unit(app,index);for(const k of direction==='both'?['heat','cool']:[direction]){u[`${k}Review`]=true;u[k+'Status']='Opnieuw evalueren';u[k+'Reason']=learning.reasons.wait;u[k+'Phase']='waiting';delete u[k+'Evidence'];u[k+'Samples']=0;delete u[k+'ProvisionalW'];}
 u.status='Opnieuw evalueren';cancel(app,'Opnieuw evalueren');persist(app);return status(app,index);
}
function status(app,index) {
 const u=unit(app,index),r=runtime(app),out={heatW:finite(u.heat)?Number(u.heat):null,coolW:finite(u.cool)?Number(u.cool):null,
 heatReview:Boolean(u.heatReview),coolReview:Boolean(u.coolReview),status:u.status,
 manualPending:Boolean(r.manualQueue?.some(x=>x.index===index)),lastMeasuredAt:u.learnedAt||null,publishedSetpointC:u.setpoint,publishedMode:u.mode};
 out.waitingReason=out.manualPending&&r.observation?.index!==index?u.learningWaitReason||learning.reasons.wait:'';
 for(const mode of ['heat','cool']){
  out[mode+'Status']=r.observation?.index===index&&r.observation.mode===mode?'Leren':u[mode+'Status']||(u[mode+'Review']?'Opnieuw evalueren':finite(u[mode])?'Betrouwbaar':'Nog niet geleerd');
  out[mode+'Reason']=r.observation?.index===index&&r.observation.mode===mode?'':u[mode+'Reason']|| (finite(u[mode])?learning.reasons.done:learning.reasons.wait);
  out[mode+'Phase']=u[mode+'Phase']||(finite(u[mode])?'reliable':'waiting');
  out[mode+'Samples']=u[mode+'Samples']||0;out[mode+'LastValidAt']=u[mode+'LastValidAt']||u.learnedAt||null;
  out[mode+'ProvisionalW']=u[mode+'ProvisionalW']??null;
  out[mode+'BatterySource']=r.observation?.index===index&&r.observation.mode===mode?r.observation.batterySource:u[mode+'BatterySource']||null;
 }
 return out;
}
function inputChanged(app,index,field,value) {
 const c=app.hvacPermanentRuntime?.comfortCycles?.[index];
 if(c&&(field==='mode'&&value!==c.mode||field==='setpoint'&&(!finite(value)||Math.abs(Number(value)-c.target)>=.11)))clearComfortCycle(app,index);
 learning.inputChanged(app,index,field,value);
}
function calculate(app,index,s,d,context) {
 const now=context.now,r=runtime(app),u=unit(app,index);finish(app,now);learning.prepare(app,index,now,s);
 const optionalLimit=require('./active-injection').limitLoads(app,s)&&!s.hvacCoordination?.EssentialEnabled&&!s.hvacCoordination?.KeepOnEnabled;
 const keepOn=Boolean(s.hvacPermanentEnabled&&s.hvacCoordination?.KeepOnEnabled);
 let mode=['heat','cool'].includes(s.hvacDirection)?s.hvacDirection
  : (s.hvacTariffEnabled&&s.hvacCoordination?.TariffAutoModeEnabled===false?null:activationMode(s,d.roomTemperatureC,d.outdoorTemperatureC))
   || (['heat','cool'].includes(d.currentMode)?d.currentMode:u.mode==='cool'?'cool':'heat');

 // Base comfort uses the existing activation thresholds and mode targets.
 // An acknowledged session continues to its target (the existing hysteresis
 // between activation threshold and comfort target), never to a PV target.
 const comfortOnly=!s.hvacTariffEnabled&&!s.hvacPvEnabled&&!s.hvacPeriodicHeatEnabled
  &&!periodic.needsRestore(app,index)&&!r.manualQueue?.some(x=>x.index===index)&&!u.manualProbe;
 if(comfortOnly){
  const demand=activationMode(s,d.roomTemperatureC,d.outdoorTemperatureC,true);
  const active=['heat','cool'].includes(u.comfortMode)?u.comfortMode:keepOn&&u.keepOnStopped&&['heat','cool'].includes(u.mode)?u.mode:null;
  const allowed=m=>m&&(s.hvacDirection==='auto'||s.hvacDirection===m);
  mode=allowed(active)?active:allowed(demand)?demand:null;
  d.comfortControl=true;d.sampleRoomC=d.roomTemperatureC;
  if(!mode){
   // No comfort start is requested, but an already active physical load may
   // still need a permissioned budget/Peak Guard reduction in this same pass.
   Object.assign(d,{permanent:true,direction:['heat','cool'].includes(d.currentMode)?d.currentMode:u.mode||s.hvacDirection,
    configSignature:signature(s),hvacRevision:app.hvacConfigRevision||0,tariffClass:context.result?.tariff?.className||'normal',
    sampleGridW:app.state.gridPowerW,sampleOutdoorC:d.outdoorTemperatureC,reason:'HVAC-doel ongewijzigd'});
   return d;
  }
 }
 const room=d.roomTemperatureC;
 const start=Math.max(0,Number(s.hvacSurplusStartW)||800),stop=Math.min(start,Math.max(0,Number(s.hvacSurplusStopW)||200));
 const lastSource=(index===0?app.latestHvacDecision:app.getExtraHvac(index)?.latestDecision)?.energySource;
 const socOkay=app.getBatteryCount(s)===0 || d.averageBatterySoc!==null && d.averageBatterySoc>=Number(s.hvacMinBatterySoc);
 const pv=Boolean(!optionalLimit && s.hvacPvEnabled && socOkay && d.gridFresh && d.virtualGridW<-(lastSource==='pv'?stop:start));
 const cls=['cheap','normal','expensive'].includes(context.result?.tariff?.className)?context.result.tariff.className:'normal';
 let raw=pv?s.hvacPvTargetC:s.hvacTariffEnabled?{cheap:s.hvacCheapTargetC,normal:s.hvacNormalTargetC,expensive:s.hvacExpensiveTargetC}[cls]:s.hvacAfterPvTargetC;
 const cop=s.hvacDirectionTemperature?.tariffCop?.[cls];
 const copConfigured=Boolean(!pv&&s.hvacTariffEnabled&&finite(cop?.outsideBelowC)&&finite(cop?.targetC));
 const copActive=Boolean(copConfigured&&finite(d.outdoorTemperatureC)&&Number(d.outdoorTemperatureC)<Number(cop.outsideBelowC));
 if(copActive)raw=Number(cop.targetC);
 // Cooling shifts the selected tariff/COP target only in automatic tariff
 // direction. PV and periodic goals keep their own temperature settings.
 if(!pv&&s.hvacTariffEnabled&&s.hvacDirection==='auto'&&s.hvacCoordination?.TariffAutoModeEnabled!==false&&mode==='cool'&&finite(raw))
  raw=Number(raw)+(finite(s.hvacCoordination?.CoolingOffsetC)?Number(s.hvacCoordination?.CoolingOffsetC):2);
 if(comfortOnly||s.hvacPeriodicHeatEnabled&&!s.hvacTariffEnabled&&!s.hvacPvEnabled)raw=mode==='heat'?s.hvacComfortMinC:s.hvacComfortMaxC;
 const cycle=periodic.select(app,index,s,u,mode,raw,context.result?.tariff,now,persist);mode=cycle.mode;raw=cycle.target;
 d.periodicHeating=Boolean(cycle.periodicHeating);d.periodicCleanup=Boolean(cycle.periodicCleanup);d.periodicRestoreTarget=cycle.restoreTarget;
 d.copOutdoorDependent=Boolean(copConfigured&&!d.periodicHeating&&!d.periodicCleanup);
 d.copTargetActive=Boolean(copActive&&d.copOutdoorDependent);
 d.configSignature=signature(s);d.hvacRevision=app.hvacConfigRevision||0;d.tariffClass=cls;d.sampleGridW=app.state.gridPowerW;
 d.permanent=true;d.direction=mode;
 const comfortCycle=r.comfortCycles?.[index];
 const comfortTarget=comfortCycle?comfortCycle.target:Number(raw);
 const comfortReached=finite(room)&&(mode==='heat'?room>=comfortTarget:room<=comfortTarget);
 // Once observed, reaching the goal remains true even if this OFF cannot be
 // published yet and the next room sample has moved back across the goal.
 if(comfortOnly&&comfortCycle&&comfortReached)comfortCycle.reached=true;
 d.standardComfort=Boolean(comfortOnly&&!keepOn);
 d.comfortBatteryCharging=Boolean(d.standardComfort&&context.batteryCharging);
 if(!keepOn&&comfortOnly&&u.comfortMode&&finite(room)&&(comfortCycle?comfortCycle.reached:comfortReached)){
  d.increase=false;d.comfortStop=true;d.configSignature=signature(s);
  if(s.hvacAllowPowerControl)d.powerCommand=false;
  else if(s.hvacAllowSetpointControl)d.setpointCommand=Math.round(clamp(room,5,99)*2)/2;
  d.reason='Comfortdoel bereikt · HVAC-boost afgerond';return d;
 }
 const manual=coordination.manualTarget(app,index,s,mode,Number(raw),room);
 if(manual!==null){d.manualLearning=true;d.manualOriginalTarget=raw;raw=manual;}
 else if(u.manualProbe&&!u.manualRestore&&r.observation?.index===index)raw=u.setpoint;
 else if(u.manualRestore&&finite(u.manualOriginalTarget)){raw=u.manualOriginalTarget;d.manualRestore=true;}
 d.desiredSetpointC=finite(raw)?Math.round(clamp(raw,5,99)*2)/2:null;
 if(optionalLimit)d.injectionComfortTarget=d.desiredSetpointC;
 d.energySource=comfortOnly?'comfort':pv&&!d.periodicHeating?'pv':'tariff';d.boostActive=false;d.waiting=false;d.learning=status(app,index);
 // Only successful publication receipts, or received device input before the
 // first publication, establish the comparison point. Room never gates a fix.
 const sent=finite(app.lastPublishedHvacSetpoint)?Number(app.lastPublishedHvacSetpoint):finite(u.setpoint)?Number(u.setpoint):d.currentSetpointC;
 const oldMode=app.lastPublishedHvacMode || u.mode || d.currentMode;
 const feedbackOff=d.currentMode==='off'&&Number(app.inputUpdatedAt.hvac?.mode)>(Number(u.outputAt)||0);
 const needsPower=d.currentMode==='off'&&s.hvacAllowPowerControl&&(app.lastPublishedHvacPower!==true||feedbackOff);
 d.hvacRestartFromFeedback=Boolean(feedbackOff&&needsPower);
 const changingMode=oldMode!==mode || Boolean(u.outdoorStopped||u.powerOff)||needsPower;
 // Fixed-direction thermostats/water heaters can expose only a setpoint.
 // Do not require a mode output merely because that feedback is absent/auto.
 // A known conflicting heat/cool mode still requires explicit permission.
 const confirmedMode=['heat','cool'].includes(d.currentMode)?d.currentMode:oldMode;
 const fixedSetpointOnly=!s.hvacAllowModeControl&&s.hvacDirection===mode
  && (!['heat','cool'].includes(confirmedMode)||confirmedMode===mode);
 const changed=(d.periodicHeating&&(!u.periodic?.applied||u.periodic.appliedTarget!==d.desiredSetpointC))||d.periodicCleanup||finite(d.desiredSetpointC) && (!finite(sent)||Math.abs(d.desiredSetpointC-sent)>=.1);
 const increase=changingMode||!finite(sent)||(mode==='heat'?d.desiredSetpointC>sent:d.desiredSetpointC<sent);
 d.increase=increase;d.hvacChangingMode=changingMode;d.hvacWasStopped=Boolean(u.outdoorStopped||u.powerOff);
 const token=coordination.tariffKey(context.result);
 const tariffDirect=Boolean(s.hvacCoordination?.DirectTariffEnabled&&s.hvacTariffEnabled&&u.tariffToken!==token);
 if(pv){u.pvSince ||= now;}else u.pvSince=0;
 const pvDirect=Boolean(s.hvacCoordination?.DirectPvEnabled&&pv&&u.pvSince&&now-u.pvSince>=15000);
 d.hvacDirect=tariffDirect||pvDirect;d.tariffToken=token;
 d.hvacKnown=coordination.trusted(app,index,mode)!==null;
 if(context.portfolio){const e=coordination.estimate(app,context.portfolio,index,mode);d.hvacKnown=e.known;d.hvacEstimateW=e.watts;}
 d.hvacBypassInterval=Boolean(d.hvacDirect||controlIntervalReady(app,index,s,now));
d.publishedSetpointC=finite(u.setpoint)?Number(u.setpoint):null;
 d.sampleOutdoorC=d.outdoorTemperatureC;
 const outdoorKnown=finite(d.outdoorTemperatureC);
 const lowHeld=Boolean(u.outdoorLowBlocked || u.outdoorStopped && u.outdoorLowBlocked===undefined && u.outdoorHighBlocked===undefined);
 const highHeld=Boolean(u.outdoorHighBlocked);
 const lowMargin=finite(s.hvacOutdoorOffBelowHysteresisC)?clamp(s.hvacOutdoorOffBelowHysteresisC,0,10):1;
 const highMargin=finite(s.hvacOutdoorOffAboveHysteresisC)?clamp(s.hvacOutdoorOffAboveHysteresisC,0,10):.5;
 const lowBlocked=Boolean(s.hvacOutdoorOffEnabled && outdoorKnown && d.outdoorTemperatureC<Number(s.hvacOutdoorOffBelowC)+(lowHeld?lowMargin:0));
 const highBlocked=Boolean(s.hvacOutdoorOffAboveEnabled && outdoorKnown && d.outdoorTemperatureC>Number(s.hvacOutdoorOffAboveC)-(highHeld?highMargin:0));
 if(lowBlocked || highBlocked) {
  d.increase=false;d.waiting=true;d.outdoorStop=true;d.outdoorLowBlocked=lowBlocked;d.outdoorHighBlocked=highBlocked;
  d.reason=s.hvacAllowPowerControl?(lowBlocked?'HVAC uit onder buitentemperatuurgrens':'HVAC uit boven buitentemperatuurgrens'):'HVAC buitengrens: aan/uit-sturing niet toegestaan';
  if(s.hvacAllowPowerControl)d.powerCommand=false;
  return d;
 }
 if(!d.automaticControlEnabled||!d.enabled||!s.hvacAllowSetpointControl||d.desiredSetpointC===null){d.reason='Permanente HVAC-sturing niet beschikbaar';return d;}
 // Optional room limit uses the current selected goal, never an alternative
 // tariff/comfort target. Outdoor, publication, budget and Peak Guard guards
 // remain in the existing chain. Periodic/manual measurements are untouched.
 if(keepOn&&s.hvacCoordination?.KeepOnLimitEnabled&&!d.periodicHeating&&!d.periodicCleanup&&!d.manualLearning&&!u.manualProbe&&finite(room)) {
  const margin=finite(s.hvacCoordination?.KeepOnMarginC)?clamp(s.hvacCoordination.KeepOnMarginC,0,10):1;
  const reached=mode==='heat'?room>=d.desiredSetpointC+margin:room<=d.desiredSetpointC-margin;
  if(reached){
   d.increase=false;d.keepOnStop=true;d.comfortStop=comfortOnly;
   if(s.hvacAllowPowerControl)d.powerCommand=false;
   d.reason=s.hvacAllowPowerControl?'HVAC uit · temperatuurgrens bij permanent sturen bereikt':'HVAC temperatuurgrens bereikt · aan/uit-sturing niet toegestaan';return d;
  }
  if(u.keepOnStopped&&(mode==='heat'?room>d.desiredSetpointC-margin:room<d.desiredSetpointC+margin)){
   d.increase=false;d.waiting=true;d.reason='HVAC wacht op temperatuurvraag na uitschakelgrens';return d;
  }
 }
 const roomAt=Number(app.inputUpdatedAt?.hvac?.roomTemperature)||0;
 if(optionalLimit&&!d.periodicHeating&&!d.periodicCleanup&&!d.manualLearning&&!u.manualProbe) {
  const fresh=roomAt>0&&now-roomAt<=300000;
  const reached=fresh&&finite(room)&&finite(d.desiredSetpointC)&&(mode==='heat'?room>=d.desiredSetpointC:room<=d.desiredSetpointC);
  if(reached) {
   d.increase=false;d.startEligible=false;d.setpointCommand=null;
   if(s.hvacAllowPowerControl&&['heat','cool'].includes(d.currentMode)&&now>=Number(u.nextAt||0)) {
    d.powerCommand=false;d.comfortStop=true;d.injectionOptionalStop=true;
   } else d.waiting=true;
   d.reason='HVAC-comfortdoel bereikt tijdens injectie';return d;
  }
  if(!fresh){d.reason='Injectie: geen extra HVAC-stop zonder verse kamertemperatuur';return d;}
 }
 if(!changed&&!changingMode){d.reason='HVAC-doel ongewijzigd';return d;}
 const conflictingFixedMode=!s.hvacAllowModeControl&&s.hvacDirection===mode
  && ['heat','cool'].includes(d.currentMode)&&d.currentMode!==mode;
 if(conflictingFixedMode||changingMode&&!s.hvacAllowModeControl&&!fixedSetpointOnly){d.reason='HVAC-modusuitvoer niet toegestaan';d.waiting=true;return d;}
 if(increase&&!comfortOnly&&!d.periodicHeating&&s.hvacDirection==='auto'&&!(s.hvacTariffEnabled&&s.hvacCoordination?.TariffAutoModeEnabled===false)&&s.hvacDirectionTemperature?.source==='outdoor'
   &&(!outdoorKnown||!activationMode(s,room,d.outdoorTemperatureC)&&!['heat','cool'].includes(d.currentMode)&&!['heat','cool'].includes(u.mode))) {
  d.waiting=true;d.reason=outdoorKnown?'Wachten op buitengrens of bestaande HVAC-modus':'Wachten op buitentemperatuur voor automatische regelrichting';return d;
 }
 if(increase && ((s.hvacOutdoorNoIncreaseEnabled || s.hvacOutdoorOffEnabled || s.hvacOutdoorOffAboveEnabled) && !outdoorKnown
   || s.hvacOutdoorNoIncreaseEnabled && d.outdoorTemperatureC>Number(s.hvacOutdoorNoIncreaseAboveC))) {
  d.waiting=true;d.reason=outdoorKnown?'HVAC wacht: buitentemperatuur boven verhogingsgrens':'HVAC wacht op buitentemperatuur';return d;
 }
 if(increase) {
  const comfort=finite(room)&&(mode==='heat'?room<Number(s.hvacComfortMinC):room>Number(s.hvacComfortMaxC));
  d.hvacExtraDemand=!comfort;
  if(context.portfolio){
   d.hvacCandidate=true;
   const intervalOkay=d.hvacBypassInterval;
   const check=coordination.admission(app,context.portfolio,index,d);
   d.hvacReadyWithoutBudget=Boolean(finite(room)&&d.gridFresh&&intervalOkay&&(!s.hvacCoordination?.DirectPvEnabled||!pv||pvDirect));
   d.hvacBudgetBlocked=check.reason==='HVAC wacht op gezamenlijk vermogensbudget';
   d.startEligible=d.hvacReadyWithoutBudget&&check.allowed;
   d.waiting=true;d.reason=!d.gridFresh?'Wachten op verse netmeting':!intervalOkay?'HVAC wacht op regelinterval':!check.allowed?check.reason:s.hvacCoordination?.DirectPvEnabled&&pv&&!pvDirect?'HVAC wacht op stabiel PV-overschot':'HVAC wacht op prioriteiten';
   return d;
  }
  const snapshot=context.budgetSnapshot;
  const check=coordination.admission(app,snapshot,index,d);
  d.hvacEstimatedPowerW=check.watts;d.hvacEstimatedExtraImportW=check.watts;
  const intervalOkay=d.hvacBypassInterval;
  d.startEligible=Boolean(finite(room)&&d.gridFresh&&intervalOkay&&check.allowed);
  if(!d.startEligible||!context.allowStart){d.waiting=true;d.reason=!d.gridFresh?'Wachten op verse netmeting':!intervalOkay?'HVAC wacht op regelinterval':!check.allowed?check.reason:'HVAC wacht op prioriteiten';return d;}

 }
 d.setpointCommand=d.desiredSetpointC;d.modeCommand=changingMode&&s.hvacAllowModeControl?mode:null;
 if(increase&&(d.currentMode==='off'||u.outdoorStopped||u.powerOff)&&s.hvacAllowPowerControl)d.powerCommand=true;
 d.reason=increase?'HVAC gespreid · '+(d.periodicHeating?'periodiek opwarmen':pv?'PV-overschot':comfortOnly?'comfortdoel':'tariefdoel'):'HVAC direct · energievraag afbouwen';
 return d;
}
function legacyCandidate(app,index,d) {
 if(d.permanent)return null;
 const mode=d.modeCommand||d.boostMode||d.currentMode;
 if(!['heat','cool'].includes(mode))return null;
 const previous=index===0?app.lastPublishedHvacSetpoint:app.getExtraHvac(index)?.lastPublishedSetpoint;
 const old=finite(previous)?Number(previous):d.currentSetpointC;
 if(finite(old)&&finite(d.setpointCommand)&&(mode==='heat'?d.setpointCommand>old:d.setpointCommand<old))return {...d,direction:mode,
  manualLearning:runtime(app).manualQueue?.[0]?.index===index,manualLegacy:true};
 return null;
}
function offSignature(s) {return JSON.stringify([s.hvacAutomaticControlEnabled,s.hvacPermanentEnabled,s.hvacCoordination?.AutomaticOffAction==='standby'?'standby':'off',s.hvacCoordination?.StandbyTemperatureC,s.hvacAllowPowerControl,s.hvacAllowSetpointControl]);}
function outputChanges(app,index,d) {
 if(d.powerCommand==null&&!d.modeCommand&&!finite(d.setpointCommand)&&d.fanTarget==null&&!d.fanAction)return false;
 const u=index===0?null:app.getExtraHvac(index),s=app.getHvacInstanceSettings(index);
 if(d.forceAutomaticOff&&d.automaticControlOff)return Boolean(d.powerCommand!==null&&s.hvacAllowPowerControl||finite(d.setpointCommand)&&s.hvacAllowSetpointControl);
 const power=index===0?app.lastPublishedHvacPower:u?.lastPublishedPower;
 const mode=index===0?app.lastPublishedHvacMode:u?.lastPublishedMode;
 const setpoint=index===0?app.lastPublishedHvacSetpoint:u?.lastPublishedSetpoint;
 const fan=index===0?app.lastPublishedHvacFanSpeed:u?.lastPublishedFanSpeed;
 return Boolean(d.powerCommand!==null&&d.powerCommand!==undefined&&s.hvacAllowPowerControl&&(power!==Boolean(d.powerCommand)||d.powerCommand===true&&d.hvacRestartFromFeedback)
  ||d.modeCommand&&s.hvacAllowModeControl&&mode!==d.modeCommand
  ||finite(d.setpointCommand)&&s.hvacAllowSetpointControl&&(!finite(setpoint)||Math.abs(Number(d.setpointCommand)-Number(setpoint))>=.1)
  ||s.hvacAllowFanControl&&(finite(d.fanTarget)&&(!finite(fan)||Math.abs(Number(d.fanTarget)-Number(fan))>.0001)||d.fanAction));
}
function injectionPublicationAllowed(app,index,d) {
 if(d.forceAutomaticOff)return true;
 const marked=d.injectionLoadGeneration!==undefined;
 if(!app.injectionRuntime?.active&&!marked)return true;
 const s=app.getSettings(),c=s.hvacCoordination?.[index]||fields.Coordination;
 const protectedLoad=Boolean(c.EssentialEnabled||c.KeepOnEnabled);
 const limited=Boolean(app.injectionRuntime?.active&&s.injectionLimitOptionalLoads&&!protectedLoad);
 if(d.injectionOptionalStop&&(!limited||protectedLoad))return false;
 if(protectedLoad)return true;
 if(marked&&(!limited||d.injectionLoadGeneration!==(Number(app.injectionRuntime?.loadGeneration)||0)))return false;
 if(!limited||d.periodicHeating||d.periodicCleanup||d.manualLearning||app.hvacPermanentRuntime?.units?.[index]?.manualProbe)return true;
 const input=app.getHvacInputSnapshot(index),at=Number(input?.updatedAt?.roomTemperature)||0,now=Date.now();
 const room=input?.seen?.roomTemperature&&finite(input.roomTemperatureC)?Number(input.roomTemperatureC):null;
 const fresh=room!==null&&at>0&&now>=at&&now-at<=300000;
 const mode=d.direction||d.boostMode||d.modeCommand||d.currentMode;
 const goal=finite(d.injectionComfortTarget)?Number(d.injectionComfortTarget):d.energySource!=='pv'&&finite(d.desiredSetpointC)?Number(d.desiredSetpointC):null;
 const reached=fresh&&goal!==null&&(mode==='heat'?room>=goal:mode==='cool'&&room<=goal);
 if(d.injectionOptionalStop)return reached;
 const published=index===0?app.lastPublishedHvacSetpoint:app.getExtraHvac(index)?.lastPublishedSetpoint;
 const previous=finite(published)?Number(published):d.currentSetpointC;
 const raising=finite(d.setpointCommand)&&(!finite(previous)||(mode==='cool'?d.setpointCommand<previous:d.setpointCommand>previous));
 const increasing=Boolean(d.increase||d.powerCommand===true||d.modeCommand||raising||d.fanAction==='higher');
 if(!increasing)return true;
 // A PV preview from before activation must be recalculated with the ordinary
 // comfort target. Newly calculated comfort demand remains eligible.
 if(d.energySource==='pv'&&!marked)return false;
 const commanded=finite(d.setpointCommand)?Number(d.setpointCommand):finite(d.desiredSetpointC)?Number(d.desiredSetpointC):previous;
 return fresh&&goal!==null&&!reached&&finite(commanded)
  &&(mode==='heat'?room<goal&&commanded<=goal:mode==='cool'&&room>goal&&commanded>=goal);
}
function injectionPublicationGuard(app,index,d) {
 const sent={};
 return {sent,allowed(){
  if(injectionPublicationAllowed(app,index,d))return true;
  // Keep only acknowledged components when activation/toggle/stop happened
  // during an awaited Flow. Never acknowledge a setpoint that was not sent.
  for(const key of ['powerCommand','modeCommand','setpointCommand','fanTarget','fanAction'])d[key]=sent[key]??null;
  d.outputChanged=Object.keys(sent).length>0;d.waiting=true;d.startEligible=false;d.suppressAutoLearning=true;
  app.markContextDirty?.('hvac_injection_changed',false);
  return false;
 }};
}
function beforePublish(app,index,d) {
 if(!injectionPublicationAllowed(app,index,d))return false;
 if(!d.forceAutomaticOff&&(d.hvacBudgetReduction||d.hvacEnergyReduction||d.safetyReduction&&d.gridFresh)
  &&coordination.mustSkipOff(app.getHvacInstanceSettings(index)))return false;
 if(d.automaticControlOff){const s=app.getHvacInstanceSettings(index);if((d.permanentControlOff?s.hvacPermanentEnabled!==false:s.hvacAutomaticControlEnabled!==false)||d.automaticOffSignature!==offSignature(s))return false;}
 if(d.coordinated&&!coordination.validPublication(app,index,d))return false;
 if(d.legacyCoordinated&&Math.abs(Number(app.state.gridPowerW)-Number(d.sampleGridW))>50)return false;
 if(d.permanent) {
  const s=app.getHvacInstanceSettings(index),cls=app.latestResult?.tariff?.className;
  const input=app.getHvacInputSnapshot(index);
  if(!d.outdoorStop&&!s.hvacAllowModeControl&&['heat','cool'].includes(s.hvacDirection)
    &&input?.seen?.mode&&['heat','cool'].includes(input.mode)&&input.mode!==d.direction)return false;
  if((d.comfortControl||d.keepOnStop)&&input?.roomTemperatureC!==(d.sampleRoomC??d.roomTemperatureC))return false;
  if(s.hvacTariffEnabled&&s.hvacDirection==='auto'&&s.hvacCoordination?.TariffAutoModeEnabled!==false
    &&s.hvacDirectionTemperature?.source!=='outdoor'&&!d.periodicHeating&&!d.periodicCleanup
    &&input?.roomTemperatureC!==d.roomTemperatureC)return false;
  if((!enabled(s)&&!periodic.needsRestore(app,index))||!s.hvacEnabled||s.hvacAutomaticControlEnabled===false||d.configSignature!==signature(s)
    ||(app.hvacConfigRevision||0)!==d.hvacRevision || cls&&cls!==d.tariffClass
    ||d.increase&&Math.abs(Number(app.state.gridPowerW)-Number(d.sampleGridW))>50
    ||(d.copOutdoorDependent||s.hvacOutdoorNoIncreaseEnabled||s.hvacOutdoorOffEnabled||s.hvacOutdoorOffAboveEnabled||s.hvacDirection==='auto'&&s.hvacDirectionTemperature?.source==='outdoor'&&!d.periodicHeating)&&app.getHvacInputSnapshot(index)?.outdoorTemperatureC!==d.sampleOutdoorC) {
   return false;
  }
  // An earlier OFF can finish while this latest decision waits in the bounded
  // publication slot. Recheck that receipt before restoring automatic demand.
  if(d.increase&&!d.waiting&&(finite(d.setpointCommand)||d.modeCommand||d.powerCommand===true)
    &&s.hvacAllowPowerControl&&(unit(app,index).powerOff||unit(app,index).outdoorStopped))d.powerCommand=true;
 }
 d.outputChanged=outputChanges(app,index,d);
 if(!d.outputChanged)return true;
 // Any other HVAC output can contaminate an ongoing observation. Immediate
 // reductions always proceed; only the measurement is discarded.
 if(app.hvacPermanentRuntime?.observation)cancel(app,index===app.hvacPermanentRuntime.observation.index?learning.reasons.own:learning.reasons.other);
 if(d.permanent&&d.increase) {
  if(!d.hvacDirect&&!controlIntervalReady(app,index,app.getHvacInstanceSettings(index),Date.now()))return false;
 }
 learning.command(app,index,Date.now());
 return true;
}
function published(app,index,d,now=Date.now()) {
 if(!d.permanent){clearComfortCycle(app,index);return;}
 if(!d.standardComfort||d.powerCommand===false||d.comfortStop||d.safetyReduction||d.hvacBudgetReduction||d.outdoorStop)clearComfortCycle(app,index);
 if(d.setpointCommand===null&&!d.modeCommand&&d.powerCommand===null){if(!d.waiting&&d.tariffToken&&unit(app,index).tariffToken!==d.tariffToken){unit(app,index).tariffToken=d.tariffToken;persist(app);}return;}
 const r=runtime(app),u=unit(app,index);
 if(d.actualControlChange)recordControlChange(app,index,now);
 if(d.outputChanged!==false)u.outputAt=now;
 if(d.hvacBudgetReduction&&d.outputChanged!==false)u.budgetNextAt=now+Math.max(1,Number(app.getHvacInstanceSettings(index).hvacControlIntervalMinutes)||5)*MINUTE;
 u.legacyCoordinated=false;
 if(d.comfortControl){if(d.comfortStop)u.comfortMode='';else if(d.increase&&d.outputChanged!==false)u.comfortMode=d.direction;}
 if(d.standardComfort&&d.increase&&!d.waiting&&d.outputChanged!==false&&!d.hvacBudgetReduction&&!d.safetyReduction
  &&d.powerCommand!==false&&(d.powerCommand===true||d.modeCommand||finite(d.setpointCommand))&&!r.comfortCycles?.[index]) {
  (r.comfortCycles ||= {})[index]={mode:d.direction,target:d.desiredSetpointC,reached:false};
 }
 if(d.tariffToken)u.tariffToken=d.tariffToken;
 if(d.powerCommand!==null)u.powerOff=d.powerCommand===false;
 if(d.keepOnStop&&d.powerCommand===false)u.keepOnStopped=true;
 else if(d.powerCommand===true)u.keepOnStopped=false;
 if(d.manualRestore){u.manualRestore=false;u.manualProbe=false;delete u.manualOriginalTarget;}
 periodic.ack(app,index,u,d,now);
 if(d.outdoorStop && d.powerCommand===false){u.outdoorStopped=true;u.outdoorLowBlocked=Boolean(d.outdoorLowBlocked);u.outdoorHighBlocked=Boolean(d.outdoorHighBlocked);}
 else if(d.powerCommand===true){u.outdoorStopped=false;u.outdoorLowBlocked=false;u.outdoorHighBlocked=false;}
 if(finite(d.setpointCommand))u.setpoint=Number(d.setpointCommand);
 if(d.modeCommand)u.mode=d.modeCommand;else if(!u.mode)u.mode=d.direction;
 if(d.outputChanged!==false&&d.increase&&(finite(d.setpointCommand)||d.modeCommand||d.powerCommand===true)) {
  begin(app,index,d,now);
  // The existing slow heartbeat will revisit the interval; no HVAC wake-up.
 }
 persist(app);
}
function protectsFromPeakStop(app,index,d) {
 const c=app.hvacPermanentRuntime?.comfortCycles?.[index];
 return Boolean(d.standardComfort&&d.comfortBatteryCharging&&d.gridFresh&&finite(d.roomTemperatureC)
  &&Number(app.state.lastTotalCommandW)<0&&c&&!c.reached);
}
module.exports={injectionPublicationGuard,injectionPublicationAllowed,protectsFromPeakStop,syncComfortCycle,offSignature,needsPeriodicRestore:periodic.needsRestore,defaults,fields,enabled,activationMode,calculate,runtime,unit,persist,canBegin,observe,slowTick,finish,cancel,recheck,status,inputChanged,beforePublish,published,evFree,legacyCandidate,begin,controlIntervalReady,recordControlChange};
