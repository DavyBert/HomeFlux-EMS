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
  const ticket=app.evPhaseStartReservations?.[i];
  const confirmedPartial=ticket?.unconfirmedA>0&&meter.fresh&&meter.updatedAt>ticket.attemptAt&&meter.currentA>=ticket.unconfirmedA-.2
   &&app.gridPhases?.every(v=>v.at>=meter.updatedAt);
  const incumbent=(typeof app.isEvOutputPermittedFor!=='function'||app.isEvOutputPermittedFor(i))
   &&(typeof app.isEvOutputActiveFor!=='function'||app.isEvOutputActiveFor(i,s)||confirmedPartial);
  const uncertain=ticket&&now<ticket.uncertainUntil&&!(meter.fresh&&meter.updatedAt>ticket.attemptAt&&meter.currentA>=ticket.unconfirmedA-.2)?ticket.unconfirmedA:0;
  result.push({index:i,type,phases,volts:perAmp/phases,perAmp,electrical,weight:Math.max(1,Number(key('Weight'))||1),min:Math.max(1,Number(key('MinCurrentA'))||6),measuredFresh:meter.fresh,
   current:meter.fresh&&incumbent?positive(meter.currentA):0,fresh:meter.fresh&&incumbent,feedbackAt:meter.updatedAt||0,uncertain});
 }
 return result;
}
function reference(app,s,now=Date.now()){
 if(!enabled(s)||typeof app.getEvCount!=='function'||!app.getEvCount(s))return null;
 const ev=entries(app,s,now);if(!ev.length)return null;
 const c=s.phaseGuard,key=[c.voltage,c.amps,c.safetyPercent,c.limitW,c.priority,c.emergencyPriority,s.batteryCount,(c.batteries||[]).join(','),
  ...ev.flatMap(e=>[e.index,e.type,e.phases,e.volts,e.min,e.weight,e.uncertain,priority(app,e.index,s,app.getEffectiveEvModeFor?.(e.index,s)==='emergency')])].join('|');
 const old=app.evPhaseRuntime;
 if(old&&old.samples===app.gridPhases&&old.config===c&&old.key===key)return old;
 const guard=require('./phase-guard'),status=guard.inspect(app,s,now);
 const batteryReference=guard.capture(app,s);
 const batteries=batteryReference.commands;
 const batteryPhase=[0,0,0];
 for(let j=0;j<batteries.length;j++){
  const w=batteryReference.types[j]===c.batteries?.[j]?guard.weights(c.batteries?.[j]):null;if(w)for(let i=0;i<3;i++)batteryPhase[i]+=positive(-batteries[j])*w[i];
 }
 const evPhase=ev.filter(e=>e.phases===3&&e.fresh).reduce((w,e)=>w+e.current*e.volts,0);
 const ceilings=new Map(ev.map(e=>[e.index,e.current]));
 if(status.state==='active'&&evPhase>0){
  for(let i=0;i<3;i++){
   const over=Math.max(0,status.values[i].watts-status.limitW);
   if(!over)continue;
   let remaining=over;
   const known=ev.filter(e=>e.phases===3&&e.fresh);
   const group=kind=>known.filter(e=>priority(app,e.index,s,app.getEffectiveEvModeFor?.(e.index,s)==='emergency')===kind);
   const grant=(list,budget)=>{
    const assigned=new Map(list.map(e=>[e.index,0]));let left=Math.max(0,budget);
    for(let pass=0;pass<list.length&&left>1e-7;pass++){
     const active=list.filter(e=>assigned.get(e.index)<e.current*e.volts-1e-7),weight=active.reduce((n,e)=>n+e.weight,0);
     let used=0;for(const e of active){const n=Math.min(e.current*e.volts-assigned.get(e.index),left*e.weight/weight);assigned.set(e.index,assigned.get(e.index)+n);used+=n;}left-=used;
    }
    for(const e of list){const n=assigned.get(e.index);ceilings.set(e.index,Math.min(ceilings.get(e.index),n/e.volts));}
   };
   const total=list=>list.reduce((n,e)=>n+e.current*e.volts,0);
   const lower=group('battery_first'),lowRelief=Math.min(remaining,total(lower));
   grant(lower,total(lower)-lowRelief);remaining-=lowRelief;
   const shared=group('share'),need=total(shared);
   const evRelief=Math.min(need,Math.max(remaining/2,remaining-batteryPhase[i]));
   grant(shared,need-evRelief);remaining-=evRelief;
   remaining=Math.max(0,remaining-batteryPhase[i]);
   const higher=group('ev_first');grant(higher,Math.max(0,total(higher)-remaining));
  }
 }
 for(const e of ev){
  e.cap=e.phases===3&&e.fresh?Math.floor(ceilings.get(e.index)+1e-8):0;
  if(e.cap<e.min)e.cap=0;
  const pending=app.evPhaseFeedback?.[e.index];
  if(pending&&(now-pending.at>60000||e.type!==pending.type||e.phases!==pending.phases||e.volts!==pending.volts
   ||e.fresh&&e.feedbackAt>=pending.at&&e.current<=pending.current+.2))delete app.evPhaseFeedback[e.index];
  else if(pending)e.pending=pending;
 }
 return app.evPhaseRuntime={samples:app.gridPhases,config:c,key,ev,batteries,batteryPhase,receipts:{},pending:app.evPhaseInFlight||{}};
}
function publishedCurrent(app,index,s){
 const r=index?app.getExtraEv(index):null;
 const allowed=index?r?.lastPublishedAllowed:app.lastPublishedEvAllowed;
 const mode=index?r?.lastPublishedChargeMode:app.lastPublishedEvChargeMode;
 const type=app.getEvControlTypeFor(index,s);
 return allowed!==false&&(type==='current'||mode!=='stop')?positive(index?r?.lastPublishedCurrentA:app.lastPublishedEvCurrentA):0;
}
function physicalAdjustments(app,s,now){
 const r=reference(app,s,now);if(!r)return null;
 const result=[0,0,0],issuedCurrents={};let totalDeltaW=0;
 for(const e of r.ev){
  const receipt=r.receipts[e.index],pending=r.pending[e.index];
  const feedback=app.getEvMeasuredCurrent(e.index,app.getEvInputSnapshot(e.index),now);
  // Only actual current feedback releases per-phase capacity. An EV is given
  // the existing 60-second feedback horizon; the battery temporarily carries
  // extra relief while a successful reduction is still awaiting confirmation.
  let issued=feedback.fresh&&feedback.updatedAt>=e.feedbackAt?feedback.currentA:e.current;
  const published=publishedCurrent(app,e.index,s);
  if(published>e.current)issued=Math.max(issued,published);
  issued=Math.max(issued,e.uncertain||0);
  // Partial/in-flight output never releases capacity; increases reserve it.
  if(pending)issued=Math.max(issued,pending.current);
  if(receipt&&!(feedback.fresh&&feedback.updatedAt>receipt.at))issued=Math.max(issued,receipt.current,receipt.complete?0:e.current);
  const delta=(issued-e.current)*e.volts;
  issuedCurrents[e.index]=issued;totalDeltaW+=(issued-e.current)*e.perAmp;
  for(let i=0;i<3;i++)result[i]+=e.phases===3?delta:Math.max(0,delta);
 }
 return {delta:result,reference:r,issuedCurrents,totalDeltaW};
}
function priority(app,index,s,emergency=false){
 const c=s.phaseGuard;
 const chosen=emergency?c.emergencyPriority||'ev_settings':c.priority;
 if(chosen==='battery_first'||chosen==='ev_first')return chosen;
 if(emergency&&chosen==='shared')return 'share';
 const configured=s[app.getEvSettingKey(index,'SmartGridPriority')];
 return ['battery_first','share','ev_first'].includes(configured)?configured:'battery_first';
}
// Requests come only from the existing, permission-checked EV portfolio pass.
// No planner, timer or separate evaluation is attached to this bounded state.
function prepare(app,decisions,s,result,now=Date.now(),final=false){
 if(!enabled(s))return;
 if(!decisions.some(d=>d.phaseRequest?.allowed&&d.phaseRequest.mode==='emergency')){
  app.evPhaseRequests=null;
  for(const [index,ticket] of Object.entries(app.evPhaseStartReservations||{}))if(!(ticket.uncertainUntil>now))delete app.evPhaseStartReservations[index];
  return;
 }
 const until=Number(result?.nextEventAt)>now?Math.min(now+60000,Number(result.nextEventAt)):now+60000;
 app.evPhaseRequests={at:now,until,config:s.phaseGuard,revision:app.evDeadlineSettingsRevision||0,
  requests:decisions.map((d,index)=>d.phaseRequest?{...d.phaseRequest,
   ...(final&&d.phaseRequest.mode!=='emergency'?{allowed:Boolean(d.allowed),currentA:Math.min(d.phaseRequest.currentA,positive(d.desiredCurrentA))}:{}),
   index,revision:app.evPlanRevision?.[index]||0}:null).filter(Boolean)};
 const active=new Set(app.evPhaseRequests.requests.filter(d=>d.allowed&&d.mode==='emergency').map(d=>String(d.index)));
 for(const [index,ticket] of Object.entries(app.evPhaseStartReservations||{}))if(!active.has(index)&&!(ticket.uncertainUntil>now))delete app.evPhaseStartReservations[index];
 if(Array.isArray(result?.candidateCommands)&&!result.phaseChargeGuard)app.phaseRequestedCommands=result.candidateCommands.slice();
 app.phaseSafetyRecovery=Boolean(result?.safetySocRecoveryActive);
}
function validRequests(app,s,now){
 const stored=app.evPhaseRequests;
 if(!stored||stored.config!==s.phaseGuard||now<stored.at||now>stored.until||stored.revision!==(app.evDeadlineSettingsRevision||0))return [];
 return stored.requests.filter(d=>{
  const input=app.getEvInputSnapshot(d.index);
  return d.allowed&&s[app.getEvSettingKey(d.index,'Enabled')]&&input?.seen?.connected&&input.connected
   &&!app.getEvSessionDetectionRuntime?.(d.index)?.endedLatched
   &&(app.evPlanRevision?.[d.index]||0)===d.revision
   &&app.getEffectiveEvModeFor(d.index,s)===d.mode;
 });
}
function allocation(app,s,now,commands,physical=null){
 if(!enabled(s))return null;
 const demands=validRequests(app,s,now);
 if(!demands.some(d=>d.mode==='emergency'))return null;
 physical ||= physicalAdjustments(app,s,now);if(!physical)return null;
 commands ||= app.phaseRequestedCommands;
 const r=physical.reference,guard=require('./phase-guard'),status=guard.inspect(app,s,now);
 if(status.state!=='active')return null;
 const canReduce=Boolean(s.controlEnabled)&&app.isChargeTestValid(s)&&!app.isHybridExternalControlActive(s)
  &&String(app.hybridEmsRuntime?.status||'')!=='handover_wait'
  &&!app.chargeTestRunning&&!app.chargeTestOperationRunning&&!app.batteryResponseTest?.running&&!app.batteryResponseTest?.stopping
  &&!app.getBatteryCommandPauseInfo(now,s).active;
 const sampled=r.batteries,knownPhase=r.batteryPhase;
 const base=status.values.map((v,i)=>v.watts-knownPhase[i]);
 const measuredEv=[0,0,0];let evWatts=0;
 for(const e of r.ev)if(e.phases===3&&e.fresh){for(let i=0;i<3;i++){base[i]-=e.current*e.volts;measuredEv[i]+=e.current*e.volts;}evWatts+=e.current*e.perAmp;}
 const room=base.map(v=>Math.max(0,status.limitW-v));
 const knownBatteryW=sampled.reduce((sum,v,j)=>sum+(guard.weights(s.phaseGuard.batteries?.[j])?positive(-v):0),0);
 const soft=s.peakShaveEnabled?Math.max(0,Number(s.peakLimitW)-positive(s.peakSoftMarginW)):Infinity;
 let netRoom=Math.max(0,soft-(Number(app.state.gridPowerW)-knownBatteryW-evWatts+positive(app.state.lastTotalCommandW)));
 const requested=(Array.isArray(commands)?commands:sampled).map((v,j)=>canReduce?positive(-v):positive(-sampled[j]));
 const quantum=[1,10,100].includes(Number(s.batteryCommandStepW))?Number(s.batteryCommandStepW):1;
 const battery=requested.map(()=>0),ev=new Map();
 function giveBattery(maximum=Infinity){
  let left=maximum;
  for(let j=0;j<requested.length&&left>0;j++){
   const w=guard.weights(s.phaseGuard.batteries?.[j]);if(!w)continue;
   let n=Math.min(left,netRoom,Math.max(0,requested[j]-battery[j]));
   for(let i=0;i<3;i++)if(w[i])n=Math.min(n,room[i]/w[i]);
   n=Math.max(0,canReduce?Math.floor((n+1e-7)/quantum)*quantum:n);battery[j]+=n;left-=n;netRoom-=n;for(let i=0;i<3;i++)room[i]-=n*w[i];
  }
 }
 const blocked=new Set();
 const entries=demands.map(d=>{
  const e=r.ev.find(v=>v.index===d.index);if(!e||!e.measuredFresh)return null;
  const emergency=d.mode==='emergency',starting=emergency&&e.current<e.min;
  if(starting){
   const tickets=app.evPhaseStartReservations||={};let ticket=tickets[e.index];
   if(!ticket)ticket=tickets[e.index]={since:now,retryAfter:0};
   if(now<ticket.retryAfter){blocked.add(e.index);return null;}
   if(ticket.retryAfter){ticket.since=now;ticket.retryAfter=0;}
   else if(now-ticket.since>60000){ticket.retryAfter=now+60000;blocked.add(e.index);return null;}
  }else if(emergency&&app.evPhaseStartReservations&&!app.evPhaseStartReservations[e.index]?.uncertainUntil)delete app.evPhaseStartReservations[e.index];
  return {...e,mode:d.mode,priority:priority(app,d.index,s,emergency),weight:d.weight,
   maxA:Math.min(d.currentA,starting?e.min:d.currentA),settings:{...e.electrical,evControlType:e.type,evMinCurrentA:e.min,evMaxCurrentA:d.currentA}};
 }).filter(Boolean);
 function giveEv(list,maximum=Infinity,minimumOnly=false){
  if(!list.length)return;
  const candidates=list.map(e=>({index:e.index,settings:e.settings,weight:e.weight,
   maxPowerW:(minimumOnly?Math.min(e.min,e.maxA):e.maxA)*e.perAmp}));
  const previous=new Map(list.map(e=>[e.index,ev.get(e.index)||0]));
  const used=[...previous.values()].reduce((sum,v)=>sum+v,0);
  const phaseFactor=list.some(e=>e.phases!==3)?1:3;
  const available=Math.max(0,Math.min(maximum,netRoom,Math.min(...room)*phaseFactor));
  const assigned=app.allocateWeightedEvPower(candidates,used+available,previous);
  for(const e of list){
   const old=ev.get(e.index)||0;let extra=Math.max(0,(assigned.get(e.index)||0)-old);
   extra=Math.min(extra,netRoom,...room.map(v=>v*(e.phases===3?3:1)));
   const amps=Math.floor((old+extra)/e.perAmp+1e-8),next=amps>=e.min?amps*e.perAmp:old;
   const delta=Math.max(0,next-old);ev.set(e.index,old+delta);netRoom-=delta;
   for(let i=0;i<3;i++)room[i]-=delta/(e.phases===3?3:1);
  }
 }
 // Preparing an EV must not turn today's import into export. At zero import,
 // preserve the battery's PV absorption until real EV power creates room.
 const wanted=requested.reduce((a,b)=>a+b,0);
 const noExportFloor=Math.min(wanted,Math.max(0,guard.charge(app.lastEmittedCommands)-positive(app.state.gridPowerW)));
 const safety=app.phaseSafetyRecovery||(app.state.batterySoc||[]).some(v=>Number.isFinite(v)&&v<Number(s.safetySoc));
 giveBattery(!canReduce||safety?Infinity:Math.ceil(noExportFloor/quantum)*quantum);
 giveEv(entries.filter(e=>e.mode==='emergency'),Infinity,true);
 giveEv(entries.filter(e=>e.priority==='ev_first'));
 const shared=entries.filter(e=>e.priority==='share');
 const batteryLeft=requested.reduce((sum,n,j)=>sum+Math.max(0,n-battery[j]),0);
 const sharedNeed=shared.reduce((sum,e)=>sum+Math.max(0,e.maxA*e.perAmp-(ev.get(e.index)||0)),0);
 if(shared.length){
  const pool=Math.min(netRoom,Math.min(...room)*3),share=Math.min(sharedNeed,Math.max(pool/2,pool-batteryLeft));
  giveEv(shared,share);giveBattery();giveEv(shared);
 }else giveBattery();
 giveEv(entries.filter(e=>e.priority==='battery_first'));
 const reserved=[0,0,0],targets=Object.fromEntries(demands.map(d=>[d.index,0]));
 for(const e of entries){const watts=ev.get(e.index)||0;targets[e.index]=Math.floor(watts/e.perAmp+1e-8);for(let i=0;i<3;i++)reserved[i]+=watts/(e.phases===3?3:1);}
 return {targets,reserved,measuredEv,demands,status,blocked};
}
function adjustments(app,s,now,commands){
 const physical=physicalAdjustments(app,s,now);if(!physical)return null;
 const joint=allocation(app,s,now,commands,physical);
 if(joint){physical.preparation=joint.demands.some(d=>d.mode==='emergency'&&(joint.targets[d.index]||0)>0&&physical.reference.ev.find(e=>e.index===d.index)?.current===0);
  for(let i=0;i<3;i++)physical.delta[i]+=Math.max(0,joint.reserved[i]-joint.measuredEv[i]-physical.delta[i]);
  if(s.peakShaveEnabled){
   const r=physical.reference,knownCharge=r.batteryPhase.reduce((a,b)=>a+b,0);
   const desired=commands||app.phaseRequestedCommands||r.batteries;
   const lostDischarge=r.batteries.reduce((sum,v,j)=>sum+Math.max(0,positive(v)-positive(desired[j])),0);
   const extra=r.ev.reduce((sum,e)=>sum+Math.max(0,(joint.targets[e.index]||0)-(physical.issuedCurrents[e.index]||0))*e.perAmp,0);
   physical.batteryBudgetW=Math.max(0,Number(s.peakLimitW)-positive(s.peakSoftMarginW)
    -(Number(app.state.gridPowerW)-knownCharge+lostDischarge)-physical.totalDeltaW-extra);
  }
 }
 return physical;
}
function cap(app,index,d,s,now=Date.now(),reserved=null){
 if(!enabled(s)||!d||app.getEvControlTypeFor(index,s)==='mode')return d;
 const r=reference(app,s,now),e=r?.ev.find(v=>v.index===index);if(!e)return d;
 const status=require('./phase-guard').inspect(app,s,now);
 let maxA=0,pendingPeakW=0;
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
    const issued=Math.max(other.current,publishedCurrent(app,other.index,s),r.pending[other.index]?.current||0,other.uncertain||0);
    const increase=(issued-other.current)*other.volts;
    pendingPeakW+=(issued-other.current)*other.perAmp;
    for(let i=0;i<3;i++)load[i]+=increase;
   }
   const guard=require('./phase-guard');
   for(let j=0;j<Math.max(r.batteries.length,app.lastEmittedCommands?.length||0);j++){
    const pending=app.inFlightBatteryCommands?.[j];
    const increase=Math.max(0,positive(-Number(app.lastEmittedCommands?.[j]))-positive(-r.batteries[j]),
     positive(-Number(pending))-positive(-r.batteries[j]));
    pendingPeakW+=increase;
    const w=guard.weights(s.phaseGuard.batteries?.[j])||[1,1,1];for(let i=0;i<3;i++)load[i]+=increase*w[i];
   }
   const headroom=Math.min(...status.values.map((v,i)=>status.limitW-v.watts-load[i]-(reserved?.[i]||0)));
   // Three-phase telemetry can reconstruct its own per-phase incumbent.
   // The location of a one-phase EV is unknown, so it receives residual room.
   maxA=Math.max(0,Math.floor((e.phases===3&&e.fresh?e.current:0)+headroom/e.volts+1e-8));
  }
 }
 // Keep an unconfirmed reduction stable while the sampled load still fills
 // the phase. Genuinely released headroom may restore the request immediately.
 if(e.pending&&maxA<=e.current)maxA=Math.min(maxA,e.pending.current);
 if(maxA<e.min)maxA=0;
 const joint=allocation(app,s,now);
 const request=joint?.demands.find(v=>v.index===index&&v.mode==='emergency');
 if(request&&e.fresh&&status.state==='active'&&status.values.some(v=>v.watts>status.limitW))maxA=Math.min(e.current,joint.targets[index]||0);
 if(joint&&Object.hasOwn(joint.targets,index))maxA=Math.min(maxA,joint.targets[index]);
 // A portfolio Peak Guard cap may have been calculated while the battery was
 // still charging. Only measured room, never a promised reduction, can undo it.
 if(request&&e.measuredFresh){
  const soft=s.peakShaveEnabled?Math.max(0,Number(s.peakLimitW)-positive(s.peakSoftMarginW)):Infinity;
  const peakA=Math.max(0,Math.floor(e.current+(soft-Number(app.state.gridPowerW)-pendingPeakW)/e.perAmp+1e-8));
  maxA=Math.min(maxA,peakA);
 }
 const desired=request?request.currentA:positive(d.desiredCurrentA),limited=desired>maxA;
 maxA=Math.min(maxA,desired);if(maxA<e.min)maxA=0;
 if(request){d.allowed=maxA>=e.min;d.source=d.allowed?'emergency':'off';d.effectiveChargeMode=d.allowed?'standard':'stop';}
 if(reserved){const increase=Math.max(0,Math.min(desired,maxA)-e.current)*e.volts;for(let i=0;i<3;i++)reserved[i]+=increase;}
 d.phaseMaxCurrentA=maxA;d.phaseLimited=limited||Boolean(d.phaseLimited);
 d.phaseFeedbackPending=Boolean(e.pending);
 d.phaseFeedbackRemainingSeconds=e.pending?Math.max(0,Math.ceil((e.pending.at+60000-now)/1000)):0;
 if(!limited&&!request)return d;
 const factor=desired>0?maxA/desired:0;
 d.desiredCurrentA=maxA;d.desiredPowerW=Math.round(maxA*e.perAmp);d.allowed=Boolean(d.allowed&&maxA>0);
 for(const key of ['pvAllocatedW','pvAttributedW','gridAllocatedW','batterySupportAllocatedW','nightSurplusAllocatedW'])if(Number.isFinite(d[key]))d[key]=Math.round(d[key]*factor);
 if(request){d.gridAllocatedW=Math.max(0,d.desiredPowerW-positive(d.pvAllocatedW)-positive(d.batterySupportAllocatedW)-positive(d.nightSurplusAllocatedW));d.intentionalGridImport=d.gridAllocatedW>0;}
 d.reason=status.state==='active'?'Fasebewaking begrenst EV-laadstroom':'EV wacht op geldige fasegegevens';
 if(e.pending&&status.state==='active')d.reason='Fasebewaking begrenst EV-laadstroom · wachten op EV-terugkoppeling';
 if(request&&!maxA&&status.state==='active'){
  const target=joint.targets[index]||0;
  d.reason=target>=e.min?'Emergency Charge wacht op bevestigde batterijreductie':'Emergency Charge wacht op veilige fasecapaciteit';
  if(s.peakShaveEnabled&&Number(app.state.gridPowerW)+e.min*e.perAmp>Number(s.peakLimitW)-positive(s.peakSoftMarginW)&&target<e.min)d.reason='Emergency Charge wacht op totale Peak Guard';
  if(joint.blocked.has(index))d.reason='Emergency Charge wacht op EV-terugkoppeling';
 }
 if(!maxA){d.source='off';d.effectiveChargeMode='stop';}
 return d;
}
function begin(app,index,s,current,now=Date.now()){
 if(!enabled(s))return;
 const r=reference(app,s,now);if(r?.ev.some(e=>e.index===index)){
  const pending=app.evPhaseInFlight||={};pending[index]={current:positive(current)};r.pending=pending;
 }
}
function complete(app,index,s,current,success,now=Date.now()){
 if(app.evPhaseInFlight)delete app.evPhaseInFlight[index];
 if(!enabled(s))return;
 const r=reference(app,s,now);if(!r?.ev.some(e=>e.index===index))return;
 delete r.pending[index];r.receipts[index]={current:positive(current),complete:Boolean(success),at:now};
 const e=r.ev.find(v=>v.index===index);
 if(!success&&app.evPhaseStartReservations?.[index])Object.assign(app.evPhaseStartReservations[index],{retryAfter:now+60000,unconfirmedA:positive(current),attemptAt:now,uncertainUntil:now+60000});
 if(e&&current<e.current-.2){
  (app.evPhaseFeedback ||= {})[index]={current:positive(current),at:now,type:e.type,phases:e.phases,volts:e.volts,complete:Boolean(success)};
  e.pending=app.evPhaseFeedback[index];
 }else if(success&&e){
  delete app.evPhaseFeedback?.[index];delete e.pending;
 }
 if(success&&current>0&&e?.current>=e.min&&app.evPhaseStartReservations)delete app.evPhaseStartReservations[index];
}
function waitingForFailedAttempt(app,index,s,d,now=Date.now()){
 if(!enabled(s)||!d?.phaseLimited)return false;
 const pending=app.evPhaseFeedback?.[index];
 return Boolean(pending&&!pending.complete&&positive(d.desiredCurrentA)===pending.current&&now-pending.at<=60000);
}
function permitted(app,index,d,s,now=Date.now()){
 if(!enabled(s)||d.phaseRequest?.mode!=='emergency')return true;
 if(positive(d.desiredCurrentA)<=publishedCurrent(app,index,s))return true;
 if(!validRequests(app,s,now).some(v=>v.index===index&&v.mode==='emergency'))return false;
 const checked=cap(app,index,{...d},s,now);
 return checked.allowed&&checked.desiredCurrentA>=d.desiredCurrentA;
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
module.exports={enabled,reference,adjustments,cap,begin,complete,reduceBeforeBattery,urgent,waitingForFailedAttempt,prepare,allocation,priority,permitted};
