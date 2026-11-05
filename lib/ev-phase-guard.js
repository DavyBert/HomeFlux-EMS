'use strict';
// Optional arithmetic within existing P1, EV and battery publication paths.
// A phase sample owns one bounded reference (8 batteries, 4 EVs). Receipts
// reserve commands; they are deliberately not physical power confirmations.
const {evPowerPerAmp}=require('./flexible-loads');
const enabled=s=>Number(s.phaseGuard?.phases)===3&&Boolean(s.phaseGuard?.enabled);
const positive=x=>Math.max(0,Number(x)||0);
function entries(app,s,now){
 const result=[];
 for(let i=0;i<app.getEvCount(s);i++){
  const key=k=>s[app.getEvSettingKey(i,k)],type=key('ControlType')||'current';
  if(!key('Enabled')||!['current','hybrid'].includes(type))continue;
  const electrical=app.getEvElectricalSettingsFor(i,s),phases=Number(electrical.evPhases)===1?1:3;
  const perAmp=evPowerPerAmp(electrical),meter=app.getEvMeasuredCurrent(i,app.getEvInputSnapshot(i),now);
  const incumbent=(typeof app.isEvOutputPermittedFor!=='function'||app.isEvOutputPermittedFor(i))
   &&(typeof app.isEvOutputActiveFor!=='function'||app.isEvOutputActiveFor(i,s));
  result.push({index:i,type,phases,volts:perAmp/phases,perAmp,min:Math.max(1,Number(key('MinCurrentA'))||6),
   current:meter.fresh&&incumbent?positive(meter.currentA):0,fresh:meter.fresh&&incumbent,feedbackAt:meter.updatedAt||0});
 }
 return result;
}
function reference(app,s,now=Date.now()){
 if(!enabled(s)||typeof app.getEvCount!=='function'||!app.getEvCount(s))return null;
 const ev=entries(app,s,now);if(!ev.length)return null;
 const c=s.phaseGuard,key=[c.voltage,c.amps,c.safetyPercent,c.limitW,c.priority,s.batteryCount,(c.batteries||[]).join(','),
  ...ev.flatMap(e=>[e.index,e.type,e.phases,e.volts,e.min])].join('|');
 const old=app.evPhaseRuntime;
 if(old&&old.samples===app.gridPhases&&old.config===c&&old.key===key)return old;
 const guard=require('./phase-guard'),status=guard.inspect(app,s,now);
 const batteries=(app.lastEmittedCommands||[]).slice(0,Number(s.batteryCount)||0);
 const batteryPhase=[0,0,0];
 for(let j=0;j<batteries.length;j++){
  const w=guard.weights(c.batteries?.[j]);if(w)for(let i=0;i<3;i++)batteryPhase[i]+=positive(-batteries[j])*w[i];
 }
 const evPhase=ev.filter(e=>e.phases===3&&e.fresh).reduce((w,e)=>w+e.current*e.volts,0);
 let fraction=0;
 if(status.state==='active'&&evPhase>0){
  for(let i=0;i<3;i++){
   const over=Math.max(0,status.values[i].watts-status.limitW);
   // Equal phase-watt relief between the battery and EV groups where both
   // can help. A group unable to supply its half transfers the remainder.
   const evRelief=Math.min(evPhase,c.priority==='shared'?Math.max(over/2,over-batteryPhase[i])
    :c.priority==='ev_first'?Math.max(0,over-batteryPhase[i]):over);
   fraction=Math.max(fraction,evRelief/evPhase);
  }
 }
 for(const e of ev){
  e.cap=e.phases===3&&e.fresh?Math.floor(e.current*(1-fraction)+1e-8):0;
  if(e.cap<e.min)e.cap=0;
  const pending=app.evPhaseFeedback?.[e.index];
  if(pending&&(now-pending.at>60000||e.type!==pending.type||e.phases!==pending.phases||e.volts!==pending.volts
   ||e.fresh&&e.feedbackAt>=pending.at&&e.current<=pending.current+.2))delete app.evPhaseFeedback[e.index];
  else if(pending)e.pending=pending;
 }
 return app.evPhaseRuntime={samples:app.gridPhases,config:c,key,ev,batteries,batteryPhase,receipts:{},pending:{}};
}
function publishedCurrent(app,index,s){
 const r=index?app.getExtraEv(index):null;
 const allowed=index?r?.lastPublishedAllowed:app.lastPublishedEvAllowed;
 const mode=index?r?.lastPublishedChargeMode:app.lastPublishedEvChargeMode;
 const type=app.getEvControlTypeFor(index,s);
 return allowed!==false&&(type==='current'||mode!=='stop')?positive(index?r?.lastPublishedCurrentA:app.lastPublishedEvCurrentA):0;
}
function adjustments(app,s,now,planning=false){
 const r=reference(app,s,now);if(!r)return null;
 const guard=require('./phase-guard'),result=[0,0,0],previous=app.lastEmittedCommands||[];
 // Keep the battery reference anchored to the meter sample across repeated
 // calculations/publications, rather than subtracting a newly issued increase.
 for(let j=0;j<r.batteries.length;j++){
  const w=guard.weights(s.phaseGuard.batteries?.[j]);if(w)for(let i=0;i<3;i++)result[i]+=(positive(-previous[j])-positive(-r.batteries[j]))*w[i];
 }
 for(const e of r.ev){
  const receipt=r.receipts[e.index],pending=r.pending[e.index];
  const feedback=app.getEvMeasuredCurrent(e.index,app.getEvInputSnapshot(e.index),now);
  // Only actual current feedback releases per-phase capacity. An EV is given
  // the existing 60-second feedback horizon; the battery temporarily carries
  // extra relief while a successful reduction is still awaiting confirmation.
  let issued=feedback.fresh&&feedback.updatedAt>=e.feedbackAt?feedback.currentA:e.current;
  if(planning&&e.phases===3&&e.fresh)issued=Math.min(issued,e.pending?e.pending.current:e.cap);
  // Partial/in-flight output never releases capacity; increases reserve it.
  if(pending)issued=Math.max(issued,pending.current);
  if(receipt&&!receipt.complete&&!(feedback.fresh&&feedback.updatedAt>receipt.at))issued=Math.max(issued,receipt.current,e.current);
  const delta=(issued-e.current)*e.volts;
  for(let i=0;i<3;i++)result[i]+=e.phases===3?delta:Math.max(0,delta);
 }
 return {delta:result,reference:r};
}
function cap(app,index,d,s,now=Date.now(),reserved=null){
 if(!enabled(s)||!d||app.getEvControlTypeFor(index,s)==='mode')return d;
 const r=reference(app,s,now),e=r?.ev.find(v=>v.index===index);if(!e)return d;
 const status=require('./phase-guard').inspect(app,s,now);
 let maxA=0;
 if(status.state==='active'&&e.volts>0){
  const over=status.values.some(v=>v.watts>status.limitW);
  if(over){
   maxA=e.phases===3&&e.fresh?e.cap:0;
   if(e.pending){
    const pendingRelief=r.ev.reduce((w,v)=>w+(v.phases===3&&v.fresh&&v.pending?Math.max(0,v.current-v.pending.current)*v.volts:0),0);
    const canWait=status.values.every((v,i)=>Math.max(0,v.watts-status.limitW)<=r.batteryPhase[i]+pendingRelief+1e-7);
    maxA=canWait?e.pending.current:Math.min(maxA,e.pending.current);
   }
  }
  else{
   const load=[0,0,0];
   // Never finance new increases with merely commanded reductions.
   for(const other of r.ev){
    if(other.index===index)continue;
    const issued=Math.max(other.current,publishedCurrent(app,other.index,s),r.pending[other.index]?.current||0);
    const increase=(issued-other.current)*other.volts;
    for(let i=0;i<3;i++)load[i]+=increase;
   }
   const guard=require('./phase-guard');
   for(let j=0;j<Math.max(r.batteries.length,app.lastEmittedCommands?.length||0);j++){
    const pending=app.inFlightBatteryCommands?.[j];
    const increase=Math.max(0,positive(-Number(app.lastEmittedCommands?.[j]))-positive(-r.batteries[j]),
     positive(-Number(pending))-positive(-r.batteries[j]));
    const w=guard.weights(s.phaseGuard.batteries?.[j])||[1,1,1];for(let i=0;i<3;i++)load[i]+=increase*w[i];
   }
   const headroom=Math.min(...status.values.map((v,i)=>status.limitW-100-v.watts-load[i]-(reserved?.[i]||0)));
   // Three-phase telemetry can reconstruct its own per-phase incumbent.
   // The location of a one-phase EV is unknown, so it receives residual room.
   maxA=Math.max(0,Math.floor((e.phases===3&&e.fresh?e.current:0)+headroom/e.volts+1e-8));
  }
 }
 if(e.pending)maxA=Math.min(maxA,e.pending.current);
 if(maxA<e.min)maxA=0;
 const desired=positive(d.desiredCurrentA),limited=desired>maxA;
 if(reserved){const increase=Math.max(0,Math.min(desired,maxA)-e.current)*e.volts;for(let i=0;i<3;i++)reserved[i]+=increase;}
 d.phaseMaxCurrentA=maxA;d.phaseLimited=limited||Boolean(d.phaseLimited);
 d.phaseFeedbackPending=Boolean(e.pending);
 d.phaseFeedbackRemainingSeconds=e.pending?Math.max(0,Math.ceil((e.pending.at+60000-now)/1000)):0;
 if(!limited)return d;
 const factor=desired>0?maxA/desired:0;
 d.desiredCurrentA=maxA;d.desiredPowerW=Math.round(maxA*e.perAmp);d.allowed=Boolean(d.allowed&&maxA>0);
 for(const key of ['pvAllocatedW','pvAttributedW','gridAllocatedW','batterySupportAllocatedW','nightSurplusAllocatedW'])if(Number.isFinite(d[key]))d[key]=Math.round(d[key]*factor);
 d.reason=status.state==='active'?'Fasebewaking begrenst EV-laadstroom':'EV wacht op geldige fasegegevens';
 if(e.pending&&status.state==='active')d.reason='Fasebewaking begrenst EV-laadstroom · wachten op EV-terugkoppeling';
 if(!maxA){d.source='off';d.effectiveChargeMode='stop';}
 return d;
}
function begin(app,index,s,current,now=Date.now()){
 if(!enabled(s))return;
 const r=reference(app,s,now);if(r?.ev.some(e=>e.index===index))r.pending[index]={current:positive(current)};
}
function complete(app,index,s,current,success,now=Date.now()){
 if(!enabled(s))return;
 const r=reference(app,s,now);if(!r?.ev.some(e=>e.index===index))return;
 delete r.pending[index];r.receipts[index]={current:positive(current),complete:Boolean(success),at:now};
 const e=r.ev.find(v=>v.index===index);
 if(e&&current<e.current-.2){
  (app.evPhaseFeedback ||= {})[index]={current:positive(current),at:now,type:e.type,phases:e.phases,volts:e.volts,complete:Boolean(success)};
  e.pending=app.evPhaseFeedback[index];
 }
}
function waitingForFailedAttempt(app,index,s,d,now=Date.now()){
 if(!enabled(s)||!d?.phaseLimited)return false;
 const pending=app.evPhaseFeedback?.[index];
 return Boolean(pending&&!pending.complete&&positive(d.desiredCurrentA)===pending.current&&now-pending.at<=60000);
}
function reduceBeforeBattery(app,s,now=Date.now()){
 if(!enabled(s))return;
 const r=reference(app,s,now);if(!r)return;
 const status=require('./phase-guard').inspect(app,s,now);
 if(status.state!=='active'||!status.values.some(v=>v.watts>status.limitW))return;
 const candidates=r.ev.filter(e=>{
  if(e.pending&&!e.pending.complete&&now-e.pending.at<=60000&&e.cap>=e.pending.current)return false;
  const latest=e.index?app.getExtraEv(e.index)?.latestDecision:app.latestEvDecision;
  return latest?.allowed&&publishedCurrent(app,e.index,s)>e.cap;
 });
 if(!candidates.length)return;
 return (async()=>{for(const e of candidates){
  const latest=e.index?app.getExtraEv(e.index)?.latestDecision:app.latestEvDecision;
  if(!latest||!latest.allowed||publishedCurrent(app,e.index,s)<=e.cap)continue;
  const d=cap(app,e.index,{...latest},app.getSettings(),Date.now());
  if(!d.phaseLimited)continue;
  // A failed EV reduction leaves its relief uncredited. The battery's final
  // existing phase check then takes the remaining safe reduction itself.
  try{if(e.index)await app.publishAdditionalEvDecision(e.index,d);else await app.publishEvDecision(d);}
  catch(error){app.error('EV phase reduction failed',error);}
 }})();
}
function urgent(app,s,now=Date.now()){
 if(!enabled(s))return false;
 const r=reference(app,s,now);if(!r)return false;
 const status=require('./phase-guard').inspect(app,s,now);
 return r.ev.some(e=>publishedCurrent(app,e.index,s)>0)&&(status.state!=='active'||status.values.some(v=>v.watts>status.limitW));
}
module.exports={enabled,reference,adjustments,cap,begin,complete,reduceBeforeBattery,urgent,waitingForFailedAttempt};
