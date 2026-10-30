'use strict';
// Extension of the existing HVAC decision/publication pipeline. No timers or
// P1 buffers: learning reads the existing EV household minute observations.
const { getRobustAverageW } = require('./ev-session');
const periodic = require('./hvac-periodic');
const MINUTE = 60000;
const finite = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
const clamp = (x,a,b) => Math.max(a,Math.min(b,Number(x)));
const fields = { PermanentEnabled:false, TariffEnabled:false, PvEnabled:false, Direction:'auto', DirectionTemperature:{source:'indoor',heatingBelowC:16,coolingAboveC:25},
 CheapTargetC:21, NormalTargetC:21, ExpensiveTargetC:21, PvTargetC:23, AfterPvTargetC:21, PhysicalGroup:'', OutdoorNoIncreaseEnabled:false, OutdoorNoIncreaseAboveC:20, OutdoorOffEnabled:false, OutdoorOffBelowC:5, OutdoorOffBelowHysteresisC:1, OutdoorOffAboveEnabled:false, OutdoorOffAboveC:25, OutdoorOffAboveHysteresisC:1, PeriodicHeatEnabled:false, PeriodicHeatDays:7, PeriodicHeatHours:1, PeriodicHeatTargetC:30 };
function defaults() {
 const d={hvacExtraGridBudgetEnabled:false,hvacExtraGridBudgetW:0};
 for(let i=1;i<=10;i++)for(const [k,v]of Object.entries(fields))d[`hvac${i===1?'':i}${k}`]=v;
 return d;
}
function signature(s) { return JSON.stringify(Object.keys(fields).map(k=>s['hvac'+k]).concat(s.hvacEnabled,s.hvacAutomaticControlEnabled,s.hvacAllowSetpointControl,s.hvacAllowModeControl,s.hvacAllowPowerControl,s.hvacExtraGridBudgetEnabled,s.hvacExtraGridBudgetW)); }
function enabled(s) { return Boolean(s.hvacPermanentEnabled && (s.hvacTariffEnabled || s.hvacPvEnabled || s.hvacPeriodicHeatEnabled)); }
function activationMode(s,room,outdoor) {
 const outside=s.hvacDirectionTemperature?.source==='outdoor',temperature=outside?outdoor:room;
 const indoorBelow=Number(s.hvacHeatingActivationBelowC),indoorAbove=Number(s.hvacCoolingActivationAboveC);
 const below=outside?(finite(s.hvacDirectionTemperature?.heatingBelowC)?Number(s.hvacDirectionTemperature?.heatingBelowC):16):(Number.isFinite(indoorBelow)?indoorBelow:20);
 const above=outside?(finite(s.hvacDirectionTemperature?.coolingAboveC)?Number(s.hvacDirectionTemperature?.coolingAboveC):25):(Number.isFinite(indoorAbove)?indoorAbove:24);
 return !finite(temperature)?null:Number(temperature)<below?'heat':Number(temperature)>above?'cool':null;
}
function runtime(app) {
 if(!app.hvacPermanentRuntime) {
  const saved=app.homey.settings.get('_hvacPermanent');
  app.hvacPermanentRuntime={version:1, nextAt:Math.max(0,Number(saved?.nextAt)||0), units:saved?.version===1? saved.units||{}:{}, observation:null};
  for(const u of Object.values(app.hvacPermanentRuntime.units)){if(u.status==='Leren')u.status='Wachten';for(const m of ['heat','cool'])if(u[m+'Status']==='Leren')u[m+'Status']='Wachten';}
 }
 return app.hvacPermanentRuntime;
}
function unit(app,index) { const r=runtime(app); return r.units[index] ||= { setpoint:null,mode:'',heat:null,cool:null,heatReview:false,coolReview:false,status:'Nog niet geleerd' }; }
function persist(app) { const r=runtime(app); app.setSetting('_hvacPermanent',{version:1,nextAt:r.nextAt,units:r.units}); }
function evFree(app) {
 const s=app.getSettings();
 for(let i=0;i<app.getEvCount(s);i++){const v=app.getEvInputSnapshot(i);if(!v?.seen?.connected || v.connected!==false)return false;}
 return true;
}
function safeMeter(app,now) {
 if(!app.getGridFreshness(app.getSettings(),now).fresh || !app.inputSeen.pv)return false;
 const p=Number(app.state.pvPowerW),at=Number(app.inputUpdatedAt.pv)||0;
 // Battery commands cannot prove physical discharge/charge. Learn only at
 // idle output and without delegated Hybrid ownership; otherwise reject.
 return finite(p) && at>0 && now-at<=60000 && Number(app.state.lastTotalCommandW)===0
  && !app.hybridEmsRuntime?.delegated && evFree(app);
}
function cancel(app,reason='Onvoldoende betrouwbaar') {
 const r=app.hvacPermanentRuntime;if(!r?.observation)return;
 const u=unit(app,r.observation.index);u.status=reason;if(r.observation.mode)u[r.observation.mode+'Status']=reason;r.observation=null;persist(app);
}
function collect(app,o,now) {
 // Consume completed buckets from the existing reference once, retaining only
 // a count and three plateau values. This also supports 60-minute intervals
 // without extending the EV detector's own 40-minute reference history.
 const end=Math.min(now,o.endAt);
 for(const b of app.evSessionDetection?.houseHistory||[]) {
  if(b.minuteAt<Math.ceil(o.startAt/MINUTE)*MINUTE||b.minuteAt<=o.lastMinute||b.minuteAt+MINUTE>end)continue;
  o.lastMinute=b.minuteAt;
  if(b.samples>=2){o.count++;o.tail.push(b.sumW/b.samples);if(o.tail.length>3)o.tail.shift();}
 }
}
function observe(app,now=Date.now()) {
 // Meter path: breadcrumbs only. No settings copies, EV scans, bucket scans,
 // storage writes, decisions or context requests.
 const o=app.hvacPermanentRuntime?.observation;if(!o)return;
 if(now-o.lastAt>15000||now<o.lastAt||Number(app.state.lastTotalCommandW)!==0
   ||app.hybridEmsRuntime?.delegated||!app.inputSeen.pv||now-Number(app.inputUpdatedAt.pv)>60000)o.invalid=true;
 o.lastAt=now;
}
function slowTick(app,now=Date.now()) {
 const o=app.hvacPermanentRuntime?.observation;if(!o)return;
 if(o.invalid||!safeMeter(app,now)){cancel(app);return;}
 collect(app,o,now);finish(app,now);
}
function finish(app,now=Date.now()) {
 const r=app.hvacPermanentRuntime,o=r?.observation;if(!o || now<o.endAt)return;
 r.observation=null;const u=unit(app,o.index);
 collect(app,o,now);
 const tail=o.tail;
 const stable=tail.length===3 && Math.max(...tail)-Math.min(...tail)<=Math.max(100,o.base*.05);
 const mean=tail.reduce((a,b)=>a+b,0)/Math.max(1,tail.length),power=mean-o.base;
 if(o.invalid||!safeMeter(app,now)||now>o.endAt+60000||o.lastAt<o.endAt-60000||o.interval<5*MINUTE
  ||o.count<Math.floor(o.interval/MINUTE)-1||!stable||power<50||power>20000)u.status='Onvoldoende betrouwbaar';
 else {u[o.mode]=Math.round(power);u[`${o.mode}Review`]=false;u.status='Betrouwbaar';u.learnedAt=now;}
 u[o.mode+'Status']=u.status;persist(app);
}
function begin(app,index,d,now) {
 const r=runtime(app),u=unit(app,index),s=app.getHvacInstanceSettings(index);
 if(u[d.direction]!==null && !u[`${d.direction}Review`])return;
 u.status='Wachten';u[d.direction+'Status']='Wachten';
 const interval=Math.max(1,Number(s.hvacControlIntervalMinutes)||5)*MINUTE;
 const bins=(app.evSessionDetection?.houseHistory||[]).filter(x=>x.minuteAt>=now-4*MINUTE && x.minuteAt<Math.floor(now/MINUTE)*MINUTE && x.samples>=2);
 const values=bins.map(x=>x.sumW/x.samples),base=getRobustAverageW(bins,now,5);
 if(interval<5*MINUTE||!safeMeter(app,now)||values.length<3||base===null
  ||Math.max(...values)-Math.min(...values)>Math.max(100,base*.05)){persist(app);return;}
 r.observation={index,mode:d.direction,base,startAt:now,lastAt:now,endAt:now+interval,interval,lastMinute:-1,count:0,tail:[]};u.status='Leren';u[d.direction+'Status']='Leren';persist(app);
}
function recheck(app,index,direction) {
 if(!Number.isInteger(index)||index<0||index>=app.getHvacCount())throw new Error('HVAC is niet geconfigureerd.');
 if(!['heat','cool','both'].includes(direction))throw new Error('Ongeldige richting.');
 const u=unit(app,index);for(const k of direction==='both'?['heat','cool']:[direction]){u[`${k}Review`]=true;u[k+'Status']='Opnieuw evalueren';}
 u.status='Opnieuw evalueren';cancel(app,'Opnieuw evalueren');persist(app);return status(app,index);
}
function status(app,index) {
 const u=unit(app,index);return {heatW:finite(u.heat)?Number(u.heat):null,coolW:finite(u.cool)?Number(u.cool):null,
 heatReview:Boolean(u.heatReview),coolReview:Boolean(u.coolReview),status:u.status,
 heatStatus:u.heatReview?'Opnieuw evalueren':runtime(app).observation?.index===index&&runtime(app).observation?.mode==='heat'?'Leren':u.heatStatus || (finite(u.heat)?'Betrouwbaar':'Nog niet geleerd'),
 coolStatus:u.coolReview?'Opnieuw evalueren':runtime(app).observation?.index===index&&runtime(app).observation?.mode==='cool'?'Leren':u.coolStatus || (finite(u.cool)?'Betrouwbaar':'Nog niet geleerd'),
 publishedSetpointC:u.setpoint,publishedMode:u.mode};
}
function calculate(app,index,s,d,context) {
 const now=context.now,r=runtime(app),u=unit(app,index);finish(app,now);
 let mode=['heat','cool'].includes(s.hvacDirection)?s.hvacDirection
  : activationMode(s,d.roomTemperatureC,d.outdoorTemperatureC)
   || (['heat','cool'].includes(d.currentMode)?d.currentMode:u.mode==='cool'?'cool':'heat');
 const room=d.roomTemperatureC;
 const start=Math.max(0,Number(s.hvacSurplusStartW)||800),stop=Math.min(start,Math.max(0,Number(s.hvacSurplusStopW)||200));
 const lastSource=(index===0?app.latestHvacDecision:app.getExtraHvac(index)?.latestDecision)?.energySource;
 const socOkay=app.getBatteryCount(s)===0 || d.averageBatterySoc!==null && d.averageBatterySoc>=Number(s.hvacMinBatterySoc);
 const pv=Boolean(s.hvacPvEnabled && socOkay && d.gridFresh && d.virtualGridW<-(lastSource==='pv'?stop:start));
 const cls=['cheap','normal','expensive'].includes(context.result?.tariff?.className)?context.result.tariff.className:'normal';
 let raw=pv?s.hvacPvTargetC:s.hvacTariffEnabled?{cheap:s.hvacCheapTargetC,normal:s.hvacNormalTargetC,expensive:s.hvacExpensiveTargetC}[cls]:s.hvacAfterPvTargetC;
 const cop=s.hvacDirectionTemperature?.tariffCop?.[cls];
 const copConfigured=Boolean(!pv&&s.hvacTariffEnabled&&finite(cop?.outsideBelowC)&&finite(cop?.targetC));
 const copActive=Boolean(copConfigured&&finite(d.outdoorTemperatureC)&&Number(d.outdoorTemperatureC)<Number(cop.outsideBelowC));
 if(copActive)raw=Number(cop.targetC);
 if(s.hvacPeriodicHeatEnabled&&!s.hvacTariffEnabled&&!s.hvacPvEnabled)raw=mode==='heat'?s.hvacComfortMinC:s.hvacComfortMaxC;
 const cycle=periodic.select(app,index,s,u,mode,raw,context.result?.tariff,now,persist);mode=cycle.mode;raw=cycle.target;
 d.periodicHeating=Boolean(cycle.periodicHeating);d.periodicCleanup=Boolean(cycle.periodicCleanup);d.periodicRestoreTarget=cycle.restoreTarget;
 d.copOutdoorDependent=Boolean(copConfigured&&!d.periodicHeating&&!d.periodicCleanup);
 d.copTargetActive=Boolean(copActive&&d.copOutdoorDependent);
 d.configSignature=signature(s);d.hvacRevision=app.hvacConfigRevision||0;d.tariffClass=cls;d.sampleGridW=app.state.gridPowerW;
 d.permanent=true;d.direction=mode;d.desiredSetpointC=finite(raw)?Math.round(clamp(raw,5,99)*2)/2:null;
 d.energySource=pv&&!d.periodicHeating?'pv':'tariff';d.boostActive=false;d.waiting=false;d.learning=status(app,index);
 // Only successful publication receipts, or received device input before the
 // first publication, establish the comparison point. Room never gates a fix.
 const sent=finite(app.lastPublishedHvacSetpoint)?Number(app.lastPublishedHvacSetpoint):finite(u.setpoint)?Number(u.setpoint):d.currentSetpointC;
 const oldMode=app.lastPublishedHvacMode || u.mode || d.currentMode;
 const changingMode=oldMode!==mode || Boolean(u.outdoorStopped);
 // Fixed-direction thermostats/water heaters can expose only a setpoint.
 // Do not require a mode output merely because that feedback is absent/auto.
 // A known conflicting heat/cool mode still requires explicit permission.
 const confirmedMode=['heat','cool'].includes(d.currentMode)?d.currentMode:oldMode;
 const fixedSetpointOnly=!s.hvacAllowModeControl&&s.hvacDirection===mode
  && (!['heat','cool'].includes(confirmedMode)||confirmedMode===mode);
 const changed=(d.periodicHeating&&(!u.periodic?.applied||u.periodic.appliedTarget!==d.desiredSetpointC))||d.periodicCleanup||finite(d.desiredSetpointC) && (!finite(sent)||Math.abs(d.desiredSetpointC-sent)>=.1);
 const increase=changingMode||!finite(sent)||(mode==='heat'?d.desiredSetpointC>sent:d.desiredSetpointC<sent);
 d.increase=increase;d.publishedSetpointC=finite(u.setpoint)?Number(u.setpoint):null;
 d.sampleOutdoorC=d.outdoorTemperatureC;
 const outdoorKnown=finite(d.outdoorTemperatureC);
 const lowHeld=Boolean(u.outdoorLowBlocked || u.outdoorStopped && u.outdoorLowBlocked===undefined && u.outdoorHighBlocked===undefined);
 const highHeld=Boolean(u.outdoorHighBlocked);
 const lowMargin=finite(s.hvacOutdoorOffBelowHysteresisC)?clamp(s.hvacOutdoorOffBelowHysteresisC,0,10):1;
 const highMargin=finite(s.hvacOutdoorOffAboveHysteresisC)?clamp(s.hvacOutdoorOffAboveHysteresisC,0,10):1;
 const lowBlocked=Boolean(s.hvacOutdoorOffEnabled && outdoorKnown && d.outdoorTemperatureC<Number(s.hvacOutdoorOffBelowC)+(lowHeld?lowMargin:0));
 const highBlocked=Boolean(s.hvacOutdoorOffAboveEnabled && outdoorKnown && d.outdoorTemperatureC>Number(s.hvacOutdoorOffAboveC)-(highHeld?highMargin:0));
 if(lowBlocked || highBlocked) {
  d.increase=false;d.waiting=true;d.outdoorStop=true;d.outdoorLowBlocked=lowBlocked;d.outdoorHighBlocked=highBlocked;
  d.reason=s.hvacAllowPowerControl?(lowBlocked?'HVAC uit onder buitentemperatuurgrens':'HVAC uit boven buitentemperatuurgrens'):'HVAC buitengrens: aan/uit-sturing niet toegestaan';
  if(s.hvacAllowPowerControl)d.powerCommand=false;
  return d;
 }
 if(!d.automaticControlEnabled||!d.enabled||!s.hvacAllowSetpointControl||d.desiredSetpointC===null){d.reason='Permanente HVAC-sturing niet beschikbaar';return d;}
  const group=String(s.hvacPhysicalGroup||'').trim();
  const groupOwner=!group || app.getFlexibleLoadPriorityOrder().find(id=>{
   const n=Number(id.replace('hvac',''))-1;return id.startsWith('hvac')&&String(app.getSettings()[app.getHvacSettingKey(n,'PhysicalGroup')]||'').trim()===group;
  })===`hvac${index+1}`;
 if(!groupOwner){d.waiting=true;d.reason='HVAC wacht op gedeelde installatie';return d;}
 if(!changed&&!changingMode){d.reason='HVAC-doel ongewijzigd';return d;}
 const conflictingFixedMode=!s.hvacAllowModeControl&&s.hvacDirection===mode
  && ['heat','cool'].includes(d.currentMode)&&d.currentMode!==mode;
 if(conflictingFixedMode||changingMode&&!s.hvacAllowModeControl&&!fixedSetpointOnly){d.reason='HVAC-modusuitvoer niet toegestaan';d.waiting=true;return d;}
 if(increase&&!d.periodicHeating&&s.hvacDirection==='auto'&&s.hvacDirectionTemperature?.source==='outdoor'
   &&(!outdoorKnown||!activationMode(s,room,d.outdoorTemperatureC)&&!['heat','cool'].includes(d.currentMode)&&!['heat','cool'].includes(u.mode))) {
  d.waiting=true;d.reason=outdoorKnown?'Wachten op buitengrens of bestaande HVAC-modus':'Wachten op buitentemperatuur voor automatische regelrichting';return d;
 }
 if(increase && ((s.hvacOutdoorNoIncreaseEnabled || s.hvacOutdoorOffEnabled || s.hvacOutdoorOffAboveEnabled) && !outdoorKnown
   || s.hvacOutdoorNoIncreaseEnabled && d.outdoorTemperatureC>Number(s.hvacOutdoorNoIncreaseAboveC))) {
  d.waiting=true;d.reason=outdoorKnown?'HVAC wacht: buitentemperatuur boven verhogingsgrens':'HVAC wacht op buitentemperatuur';return d;
 }
 if(increase) {
  const learned=u[mode],trusted=finite(learned)&&!u[`${mode}Review`];
  const estimate=trusted?Number(learned):Math.max(3000,start);
  // Optional extra thermal storage must not be financed by battery discharge.
  const batteryDischarge=Math.max(0,Number(app.state.lastTotalCommandW)||0);
  const predicted=d.predictedGridW+batteryDischarge+estimate;
  const comfort=finite(room)&&(mode==='heat'?room<Number(s.hvacComfortMinC):room>Number(s.hvacComfortMaxC));
  const extra=!comfort;
  let otherExtraW=0;
  for(const [key,other] of Object.entries(r.units)) {
   const n=Number(key);if(n===index||n>=app.getHvacCount()||!finite(other.setpoint))continue;
   const os=app.getHvacInstanceSettings(n),input=app.getHvacInputSnapshot(n),om=other.mode||input?.mode;
   if(!enabled(os)||!os.hvacEnabled)continue;
   const demanding=!input?.seen?.roomTemperature||!finite(input.roomTemperatureC)
    ||(om==='heat'?input.roomTemperatureC<other.setpoint-.25:input.roomTemperatureC>other.setpoint+.25);
   const extraGoal=om==='heat'?other.setpoint>Number(os.hvacComfortMinC):om==='cool'&&other.setpoint<Number(os.hvacComfortMaxC);
   if(demanding&&extraGoal)otherExtraW+=finite(other[om])&&!other[om+'Review']?Number(other[om]):Math.max(3000,Number(os.hvacSurplusStartW)||800);
  }
  const residualSolar=Math.max(0,-d.virtualGridW-batteryDischarge);
  // Shared HVAC budget, separate from the site's Peak Guard. Reserve existing
  // extra HVAC demand conservatively instead of charging household base load
  // to this optional thermal-storage budget.
  d.hvacEstimatedExtraImportW=Math.max(0,otherExtraW+estimate-residualSolar);
  const budget=!s.hvacExtraGridBudgetEnabled||d.hvacEstimatedExtraImportW<=Math.max(0,Number(s.hvacExtraGridBudgetW)||0);
  const peak=!s.peakShaveEnabled || predicted<=Number(s.peakLimitW)-Math.max(0,Number(s.peakSoftMarginW)||0);
  const energy=(!extra||budget) && (!pv||d.periodicHeating||d.virtualGridW+batteryDischarge+estimate<=0);
  d.startEligible=Boolean(finite(room)&&d.gridFresh&&peak&&energy&&groupOwner&&now>=r.nextAt);
  if(!d.startEligible||!context.allowStart){d.waiting=true;d.reason=!groupOwner?'HVAC wacht op gedeelde installatie':!d.gridFresh?'Wachten op verse netmeting':now<r.nextAt?'HVAC wacht op regelinterval':!energy||!peak?'HVAC wacht op energiemarge':'HVAC wacht op prioriteiten';return d;}
 }
 d.setpointCommand=d.desiredSetpointC;d.modeCommand=changingMode&&s.hvacAllowModeControl?mode:null;
 if(increase&&(d.currentMode==='off'||u.outdoorStopped)&&s.hvacAllowPowerControl)d.powerCommand=true;
 d.reason=increase?'HVAC gespreid · '+(d.periodicHeating?'periodiek opwarmen':pv?'PV-overschot':'tariefdoel'):'HVAC direct · energievraag afbouwen';
 return d;
}
function legacyCandidate(app,index,d) {
 if(d.permanent || !(app.evSessionDetection?.houseHistory?.length>=3))return null;
 const mode=d.modeCommand||d.boostMode||d.currentMode;
 if(!['heat','cool'].includes(mode))return null;
 const previous=index===0?app.lastPublishedHvacSetpoint:app.getExtraHvac(index)?.lastPublishedSetpoint;
 const old=finite(previous)?Number(previous):d.currentSetpointC;
 if(finite(old)&&finite(d.setpointCommand)&&(mode==='heat'?d.setpointCommand>old:d.setpointCommand<old))return {...d,direction:mode};
 return null;
}
function beforePublish(app,index,d) {
 if(d.permanent) {
  const s=app.getHvacInstanceSettings(index),cls=app.latestResult?.tariff?.className;
  const input=app.getHvacInputSnapshot(index);
  if(!d.outdoorStop&&!s.hvacAllowModeControl&&['heat','cool'].includes(s.hvacDirection)
    &&input?.seen?.mode&&['heat','cool'].includes(input.mode)&&input.mode!==d.direction)return false;
  if((!enabled(s)&&!periodic.needsRestore(app,index))||!s.hvacEnabled||s.hvacAutomaticControlEnabled===false||d.configSignature!==signature(s)
    ||(app.hvacConfigRevision||0)!==d.hvacRevision || cls&&cls!==d.tariffClass
    ||d.increase&&Math.abs(Number(app.state.gridPowerW)-Number(d.sampleGridW))>50
    ||(d.copOutdoorDependent||s.hvacOutdoorNoIncreaseEnabled||s.hvacOutdoorOffEnabled||s.hvacOutdoorOffAboveEnabled||s.hvacDirection==='auto'&&s.hvacDirectionTemperature?.source==='outdoor'&&!d.periodicHeating)&&app.getHvacInputSnapshot(index)?.outdoorTemperatureC!==d.sampleOutdoorC) {
   return false;
  }
 }
 if(d.setpointCommand===null && !d.modeCommand && d.powerCommand===null)return true;
 // Any other HVAC output can contaminate an ongoing observation. Immediate
 // reductions always proceed; only the measurement is discarded.
 if(app.hvacPermanentRuntime?.observation)cancel(app);
 if(d.permanent&&d.increase) {
  const r=runtime(app);if(Date.now()<r.nextAt)return false;
  r.nextAt=Date.now()+Math.max(1,Number(app.getHvacInstanceSettings(index).hvacControlIntervalMinutes)||5)*MINUTE;
  persist(app);
 }
 return true;
}
function published(app,index,d,now=Date.now()) {
 if(!d.permanent || d.setpointCommand===null && !d.modeCommand && d.powerCommand===null)return;
 const r=runtime(app),u=unit(app,index);
 periodic.ack(app,index,u,d,now);
 if(d.outdoorStop && d.powerCommand===false){u.outdoorStopped=true;u.outdoorLowBlocked=Boolean(d.outdoorLowBlocked);u.outdoorHighBlocked=Boolean(d.outdoorHighBlocked);}
 else if(d.powerCommand===true){u.outdoorStopped=false;u.outdoorLowBlocked=false;u.outdoorHighBlocked=false;}
 if(finite(d.setpointCommand))u.setpoint=Number(d.setpointCommand);
 if(d.modeCommand)u.mode=d.modeCommand;else if(!u.mode)u.mode=d.direction;
 if(d.increase&&(finite(d.setpointCommand)||d.modeCommand||d.powerCommand===true)) {
  r.nextAt=now+Math.max(1,Number(app.getHvacInstanceSettings(index).hvacControlIntervalMinutes)||5)*MINUTE;
  begin(app,index,d,now);
  // The existing slow heartbeat will revisit the interval; no HVAC wake-up.
 }
 persist(app);
}
module.exports={needsPeriodicRestore:periodic.needsRestore,defaults,fields,enabled,activationMode,calculate,runtime,unit,observe,slowTick,finish,cancel,recheck,status,beforePublish,published,evFree,legacyCandidate,begin};
