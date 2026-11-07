'use strict';
// Learning-only residuals, never raw P1/PV/battery histories. One reference
// buffer and at most one observation; no scheduler, device access or commands.
const MINUTE=60000, MAX_POINTS=40, SAMPLE_MS=10000;
const REST_SETTLE_MS=60000, REST_UNCERTAINTY_W=50;
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const median=xs=>{const a=xs.slice().sort((a,b)=>a-b),n=a.length;return n?(a[(n-1)>>1]+a[n>>1])/2:null;};
const stats=xs=>{const value=median(xs);return {value,sigma:xs.length?1.4826*median(xs.map(x=>Math.abs(x-value))):0};};
const reasons={grid:'Wachten op verse netmeting',battery:'Batterijvermogen onvoldoende betrouwbaar',pv:'PV-correctie onvoldoende betrouwbaar',ev:'EV-laadactiviteit verstoorde de meting',boiler:'Boilervermogen niet veilig uit te sluiten',reference:'Onvoldoende referentiemetingen',noise:'HVAC-vermogensverschil te klein tegenover achtergrondruis',points:'Onvoldoende geldige meetpunten',modulation:'Compressorvermogen nog onvoldoende representatief',other:'Andere HVAC gewijzigd tijdens meting',own:'HVAC-sturing gewijzigd tijdens meting',wait:'Wachten op geschikt HVAC-stuurmoment',shared:'Gedeeld HVAC-vermogen niet afzonderlijk meetbaar',interval:'Meetvenster korter dan vijf minuten',step:'Geen afzonderlijke HVAC-start meetbaar',building:'Meting geslaagd, betrouwbaarheid wordt opgebouwd',done:'Vermogen betrouwbaar aangeleerd'};
reasons.rest='Wachten op bevestigde batterijrust (60 s)';
function resetBatteryRest(app) {
 const hadRest=Boolean(app.hvacLearningRest);
 delete app.hvacLearningRest;
 const r=app.hvacPermanentRuntime;
 if(r?.observation?.batterySource==='managed_rest')r.observation.invalidReason=reasons.battery;
 if(r?.learningReference&&(hadRest||r.learningReference.points.some(p=>p.batterySource==='managed_rest')))r.learningReference.points=[];
}
function restingBattery(app,s,now) {
 const commands=app.lastEmittedCommands,count=app.getBatteryCount(s),result=app.latestResult;
 const zero=xs=>Array.isArray(xs)&&xs.length===count&&xs.every(v=>v===0);
 // This is an explicitly estimated, settled rest state, never a substitute
 // for physical correction while batteries charge/discharge or Hybrid owns them.
 const allowed=s.controlEnabled===true&&!s.hybridEmsEnabled&&!app.hybridEmsRuntime?.delegated
  &&app.isChargeTestValid?.(s)===true&&['solar_capture','standby'].includes(result?.baseMode)
  &&zero(commands)&&app.batteryIdleKnownOutput===commands&&app.lastEmitAt>0&&app.lastEmitAt<=now
  &&app.state.lastTotalCommandW===0&&zero(result.candidateCommands)
  &&(!app.pendingResult||zero(app.pendingResult.candidateCommands))
  &&!app.commandPublishing&&!app.inFlightBatteryCommands&&!app.batteryEfficiencyTransitionTimer
  &&!app.chargeTestRunning&&!app.chargeTestOperationRunning&&!app.batteryResponseTest?.running&&!app.batteryPhaseDetection?.running
  &&!(app.splitCommandState||[]).some(v=>v.pendingMode||v.recheckTimer)
  &&!(app.hvacLearningBattery&&Math.abs(app.hvacLearningBattery.powerW)>REST_UNCERTAINTY_W);
 if(!allowed){if(app.hvacLearningRest)resetBatteryRest(app);return {reason:reasons.battery};}
 let r=app.hvacLearningRest;
 if(!r||now<r.since)r=app.hvacLearningRest={since:now};
 if(now-r.since<REST_SETTLE_MS)return {reason:reasons.rest};
 return {powerW:0,at:now,source:'managed_rest',uncertainty:REST_UNCERTAINTY_W};
}
function evFree(app,now=Date.now(),s=app.settingsCache||app.getSettings()) {
 for(let i=0;i<app.getEvCount(s);i++){
  const v=app.getEvInputSnapshot(i);
  if(!v?.seen?.connected)return false;
  if(v.connected===false)continue;
  const m=app.getEvMeasuredCurrent?.(i,v,now);
  if(!m?.fresh||m.updatedAt>now||m.currentA>.5)return false;
 }
 return true;
}
function batteryFeedback(app,power,now=Date.now()) {
 // This existing Flow explicitly reports ACTUAL aggregate power: positive
 // discharge, negative charge. Do not use lastTotalCommandW or Hybrid setpoints.
 if(!finite(power)||Math.abs(Number(power))>50000||!finite(now))return;
 if(Math.abs(Number(power))>REST_UNCERTAINTY_W&&app.hvacLearningRest)resetBatteryRest(app);
 app.hvacLearningBattery={powerW:Number(power),at:Number(now)};
}
function meter(app,now) {
 const s=app.settingsCache||app.getSettings(),gridAt=Number(app.inputUpdatedAt?.grid),pvAt=Number(app.inputUpdatedAt?.pv);
 if(!app.getGridFreshness(s,now).fresh||!finite(app.state.gridPowerW)||!(gridAt>0&&gridAt<=now))return {reason:reasons.grid};
 if(!app.inputSeen.pv||!finite(app.state.pvPowerW)||Number(app.state.pvPowerW)<0||!(pvAt>0&&pvAt<=now&&now-pvAt<=60000))return {reason:reasons.pv};
 if(!evFree(app,now,s))return {reason:reasons.ev};
 // There is no actual boiler power input in this app. Its nominal wattage
 // cannot certify a stable load, so an active boiler remains excluded.
 if(app.boilerState?.outputOn)return {reason:reasons.boiler};
 let battery=0,batteryAt=now,batterySource='none',batteryError=0;
 if(app.getBatteryCount(s)>0){
  const b=app.hvacLearningBattery;
  if(b&&finite(b.powerW)&&b.at>0&&b.at<=now&&now-b.at<=15000){
   battery=b.powerW;batteryAt=b.at;batterySource='measured';
  }else{
   if(b?.at>now)return {reason:reasons.battery};
   const rest=restingBattery(app,s,now);if(rest.reason)return rest;
   battery=rest.powerW;batteryAt=rest.at;batterySource=rest.source;batteryError=rest.uncertainty;
  }
 }
 return {watts:Number(app.state.gridPowerW)+Number(app.state.pvPowerW)+battery,pv:Number(app.state.pvPowerW),pvAt,battery,batteryAt,batterySource,batteryError,gridAt};
}
function eligible(app,index,instance) {
 const source=app.settingsCache,stem=`hvac${index?index+1:''}`;
 const s=instance||(source?{hvacEnabled:source[stem+'Enabled'],hvacAutomaticControlEnabled:source[stem+'AutomaticControlEnabled'],hvacDirection:source[stem+'Direction'],hvacCoordination:source.hvacCoordination?.[index]}:app.getHvacInstanceSettings(index));
 const u=app.hvacPermanentRuntime?.units?.[index];
 const manual=app.hvacPermanentRuntime?.manualQueue?.some(x=>x.index===index);
 return s.hvacEnabled&&s.hvacAutomaticControlEnabled!==false&&
  (!(s.hvacCoordination?.DirectTariffEnabled||s.hvacCoordination?.DirectPvEnabled)||manual)&&
  (manual||!u||['heat','cool'].some(m=>(s.hvacDirection==='auto'||s.hvacDirection===m)&&(!finite(u[m])||u[m+'Review'])));
}
function prepare(app,index,now,instance) {
 const r=app.hvacPermanentRuntime;
 if(!r||r.observation||!eligible(app,index,instance))return;
 const ref=r.learningReference ||= {points:[],lastAt:0};
 ref.until=now+10*MINUTE;
}
function sample(app,now) {
 const r=app.hvacPermanentRuntime,o=r?.observation,ref=r?.learningReference;
 const target=o||ref;if(!target)return;
 if(!o&&now>ref.until){delete r.learningReference;return;}
 if(o&&now<o.startAt+MINUTE)return;
 const spacing=o?o.spacing:SAMPLE_MS;
 if(now<target.lastAt){if(o)o.invalidReason=reasons.points;else ref.points=[];return;}
 if(now-target.lastAt<spacing)return;
 target.lastAt=now;
 const v=meter(app,now);
 if(o){
  if(now<o.startAt+MINUTE||now>o.endAt)return; // exclude compressor start
  o.attempted++;
 }
 if(v.reason){target.lastReason=v.reason;if(o&&(v.reason===reasons.ev||v.reason===reasons.boiler||o.batterySource==='managed_rest'))o.invalidReason=v.reason;return;}
 if(o?.batterySource==='managed_rest'&&v.batterySource==='measured'&&Math.abs(v.battery)>REST_UNCERTAINTY_W){o.invalidReason=reasons.battery;return;}
 if(v.gridAt<=Number(target.lastGridAt||0))return;
 target.lastGridAt=v.gridAt;
 // Age alone is not a correction. Account for sensor skew using the observed
 // rate since the preceding sensor update; reject residual uncertainty later.
 let error=v.batteryError||0;
 for(const [key,atKey] of [['pv','pvAt'],['battery','batteryAt']]){
  const previous=target[key+'Last'];
  if(previous&&v[atKey]>previous.at){
   target[key+'Rate']=Math.abs(v[key]-previous.value)/Math.max(1,(v[atKey]-previous.at)/1000);
  }
  if(!previous||v[atKey]!==previous.at)target[key+'Last']={value:v[key],at:v[atKey]};
  error+=(target[key+'Rate']||0)*Math.abs(v.gridAt-v[atKey])/1000;
 }
 target.points.push({at:now,watts:v.watts,error,batterySource:v.batterySource});
 if(target.points.length>MAX_POINTS)target.points.shift();
}
function baseline(app,now) {
 const r=app.hvacPermanentRuntime,ref=r?.learningReference;
 let points=(ref?.points||[]).filter(p=>p.at>=Math.max(now-3*MINUTE,r.referenceBarrier||0)&&p.at<=now);
 if(points.length>=9&&points.at(-1).at>=now-20000&&points.at(-1).at-points[0].at>=2*MINUTE){
  const b=stats(points.map(p=>p.watts));return {base:b.value,baseSigma:b.sigma,baseError:median(points.map(p=>p.error)),batterySource:points.some(p=>p.batterySource==='managed_rest')?'managed_rest':'measured'};
 }
 // Reuse existing, completed EV reference buckets only when there cannot be
 // any battery-command correction in them. No copied meter history is kept.
 if(app.getBatteryCount(app.settingsCache||app.getSettings())===0&&Number(app.state.lastTotalCommandW)===0){
  const bins=(app.evSessionDetection?.houseHistory||[]).filter(b=>b.samples>=2&&b.minuteAt>=Math.max(now-4*MINUTE,r?.referenceBarrier||0)&&b.minuteAt+MINUTE<=now);
  if(bins.length>=3&&bins.at(-1).minuteAt+MINUTE>=now-MINUTE){
   const b=stats(bins.map(x=>x.sumW/x.samples));return {base:b.value,baseSigma:b.sigma,baseError:0};
  }
 }
 return null;
}
function command(app,index,now) {
 const r=app.hvacPermanentRuntime;if(!r)return;
 if(eligible(app,index))r.learningStep={index,at:now,baseline:baseline(app,now),beforeW:meter(app,now).watts};
 else delete r.learningStep;
 r.referenceBarrier=now;
 delete r.learningReference;
}
function inputChanged(app,index,field,value) {
 const o=app.hvacPermanentRuntime?.observation;if(!o)return;
 const u=app.hvacPermanentRuntime.units[o.index];
 if(index===o.index&&(field==='setpoint'&&finite(u?.setpoint)&&Math.abs(Number(value)-u.setpoint)<.11||field==='mode'&&value===o.mode))return;
 o.invalidReason=index===o.index?reasons.own:reasons.other;
}
function estimate(o) {
 if(o.invalidReason)return {reason:o.invalidReason};
 const expected=Math.floor((o.interval-MINUTE)/o.spacing)+1;
 if(o.points.length<8||o.points.length<Math.min(MAX_POINTS,expected)*.65||o.points.at(-1).at<o.endAt-Math.max(30000,o.spacing*1.5)||o.points.at(-1).at-o.points[0].at<2*MINUTE)return {reason:o.lastReason||reasons.points};
 const first=stats(o.points.map(p=>p.watts)),cut=Math.max(150,first.sigma*3);
 const points=o.points.filter(p=>Math.abs(p.watts-first.value)<=cut);
 if(points.length<8||points.length<o.points.length*.7)return {reason:reasons.points};
 const measured=stats(points.map(p=>p.watts)),power=measured.value-o.base;
 const middle=(o.startAt+MINUTE+o.endAt)/2;
 const early=median(points.filter(p=>p.at<middle).map(p=>p.watts)),late=median(points.filter(p=>p.at>=middle).map(p=>p.watts));
 if(early===null||late===null)return {reason:reasons.points};
 const drift=Math.abs(late-early),error=(o.baseError||0)+median(points.map(p=>p.error));
 const uncertainty=Math.hypot(o.baseSigma,measured.sigma)/Math.sqrt(Math.min(12,points.length))+error+drift*.25;
 if(power<Math.max(100,3*o.baseSigma,2*error)||power>20000||uncertainty>power*.25)return {reason:reasons.noise};
 if(measured.sigma>Math.max(250,power*.6)||drift>Math.max(300,power*.6))return {reason:reasons.modulation};
 return {power:Math.round(power/10)*10,uncertainty:Math.ceil(uncertainty),points:points.length};
}
function accept(u,mode,result,now,startAt) {
 const evidence=u[mode+'Evidence'] ||= [];
 // A single switching event contributes once, never once per P1/evaluation.
 if(evidence.some(x=>x.startAt===startAt))return false;
 evidence.push({power:result.power,uncertainty:result.uncertainty,at:now,startAt});
 if(evidence.length>5)evidence.shift();
 u[mode+'LastValidAt']=now;
 const candidates=evidence.filter(x=>now-x.at<=30*24*60*MINUTE);
 const center=median(candidates.map(x=>x.power));
 const consistent=candidates.filter(x=>Math.abs(x.power-center)<=Math.max(50,center*.25));
 u[mode+'Samples']=consistent.length;
 u[mode+'ProvisionalW']=consistent.length?median(consistent.map(x=>x.power)):null;
 if(consistent.length<3)return false;
 const learned=Math.round(median(consistent.map(x=>x.power))/10)*10;
 // An existing trusted estimate needs a corroborated replacement cluster.
 u[mode]=learned;u[mode+'Review']=false;u.learnedAt=now;return true;
}
module.exports={reasons,median,stats,meter,evFree,batteryFeedback,resetBatteryRest,prepare,sample,baseline,command,inputChanged,estimate,accept,MAX_POINTS};
