'use strict';
// Existing battery pipeline's optional charging envelope. No scheduler/listener.
const finite=x=>x!==null&&x!==undefined&&x!==''&&typeof x!=='boolean'&&Number.isFinite(Number(x));
const defaults={phases:1,enabled:false,voltage:null,amps:null,safetyPercent:80,limitW:null,priority:'battery_first',emergencyPriority:'ev_settings',peakGuardBatteryAssistEnabled:false,batteries:Array(8).fill('unknown')};
const charge=commands=>(commands||[]).reduce((s,x)=>s+Math.max(0,-Number(x)||0),0);
const enabled=s=>Number(s.phaseGuard?.phases)===3&&s.phaseGuard?.enabled;
function config(s){return {...defaults,...s.phaseGuard};}
function proposal(c){return require('../settings/phase-guard').proposal(c.voltage,c.amps,c.safetyPercent);}
function ingest(app,args,now){
 app.gridPhases=Array.from({length:3},(_,i)=>({watts:finite(args['l'+(i+1)])?Number(args['l'+(i+1)]):null,at:finite(args['l'+(i+1)])?now:0}));
 // Presentation may retain the last received value of each phase, with its
 // original age. Control still requires the existing complete valid snapshot.
 app.gridPhaseDisplayValues=app.gridPhases.map((sample,i)=>sample.at?sample:app.gridPhaseDisplayValues?.[i]||sample);
}
function weights(type){return type==='balanced3'?[1/3,1/3,1/3]:['L1','L2','L3'].includes(type)?[0,1,2].map(i=>type==='L'+(i+1)?1:0):null;}
function capture(app,settings){
 if(!enabled(settings))return null;
 const r=app.phaseGuardRuntime ||= {lastIncreaseAt:0};
 if(r.reference?.samples!==app.gridPhases||!r.reference)r.reference={samples:app.gridPhases,
  // A sample arriving inside asynchronous output cannot confirm any charging
  // component of that partial command (including a delayed Split reduction).
  commands:(app.lastEmittedCommands||[]).slice(0,Number(settings.batteryCount)||0).map((v,i)=>app.inFlightBatteryCommands?.[i]===undefined?v:Math.max(0,Number(v)||0,Number(app.inFlightBatteryCommands[i])||0)),types:(settings.phaseGuard.batteries||[]).slice()};
 return r.reference;
}
function inspect(app,settings,now=Date.now()){
 const c=config(settings),active=enabled(settings),values=Array.from({length:3},(_,i)=>app.gridPhases?.[i]||{watts:null,at:0});
 const suggested=proposal(c),limitW=finite(c.limitW)?Number(c.limitW):suggested;
 const status={enabled:Boolean(active),state:active?'active':'inactive',evaluatedAt:now,values,displayValues:app.gridPhaseDisplayValues||values,limitW,proposedW:suggested,batteries:c.batteries,currentChargeW:charge(app.lastEmittedCommands),maxChargeW:null,phase:null,reason:'Fasebewaking uit'};
 if(!active)return status;
 if(app.phaseGuardRuntime?.publicationUncertain)return {...status,state:'unavailable',maxChargeW:0,reason:'Fasebewaking: batterijopdracht niet volledig gepubliceerd'};
 if(suggested===null||!finite(limitW)||limitW<=0)return {...status,state:'unavailable',maxChargeW:0,reason:'Fasebewaking: configuratie onvolledig'};
 if(values.some(v=>!finite(v.watts)||!v.at||now<v.at||now-v.at>15000))return {...status,state:'unavailable',maxChargeW:0,reason:'Fasebewaking: fasemetingen ontbreken of zijn verouderd'};
 const max=Math.max(...values.map(v=>v.watts));status.phase='L'+(values.findIndex(v=>v.watts===max)+1);
 status.reason=max>limitW?'Fasebewaking: batterij laden begrensd':'Fasebewaking: laadruimte beschikbaar';
 return status;
}
function envelope(app,commands,settings,now,redistribute=true){
 const s=inspect(app,settings,now),c=config(settings),count=commands.length;
 if(s.state==='unavailable')return {status:{...s,appliedChargeW:0,limited:charge(commands)>0},out:commands.map(w=>w<0?0:w)};
 const previous=capture(app,settings);
 const joint=require('./ev-phase-guard').adjustments(app,settings,now,commands);
 s.evPreparation=Boolean(joint?.preparation);
 const baseline=s.values.map((v,i)=>v.watts+(joint?.delta[i]||0)),room=[0,0,0],over=s.values.some(v=>v.watts>s.limitW);
 for(let j=0;j<count;j++){const w=previous.types[j]===c.batteries?.[j]?weights(c.batteries?.[j]):null;if(w)for(let i=0;i<3;i++)baseline[i]-=Math.max(0,-Number(previous.commands[j])||0)*w[i];
  const lostDischarge=Math.max(0,Math.max(0,Number(previous.commands[j])||0)-Math.max(0,Number(commands[j])||0));
  for(let i=0;i<3;i++)baseline[i]+=lostDischarge*(w?w[i]:1);}
 for(let i=0;i<3;i++)room[i]=Math.max(0,s.limitW-baseline[i]);
 if(baseline.some(v=>v>s.limitW))s.reason='Fasebewaking: overbelasting buiten batterijlaadvermogen';
 const requested=charge(commands),budget=Math.min(requested,Math.max(0,Number(settings.maxTotalChargeW)||0),joint?.batteryBudgetW??Infinity);
 const allocation=commands.map(()=>0);let remaining=budget;
 // Read the same maxima as the engine without running its allocator.
 const {batteryPowerLimits}=require('./ems-engine');
 const ceilings=commands.map((_,i)=>{const soc=app.state.batterySoc?.[i];return finite(soc)&&Number(soc)<Number(settings.maxSoc)?batteryPowerLimits(settings,i).maxCharge:0;});
 const quantum=[1,10,100].includes(Number(settings.batteryCommandStepW))?Number(settings.batteryCommandStepW):1;
 function grant(j,wanted){
  if(commands[j]>0)return;
  const known=weights(c.batteries?.[j]),w=known||[1,1,1];
  if(!known&&over)return;
  let n=Math.min(remaining,Math.max(0,ceilings[j]-allocation[j]),wanted);
  for(let i=0;i<3;i++)if(w[i])n=Math.min(n,room[i]/w[i]);
  n=Math.max(0,Math.floor((n+1e-7)/quantum)*quantum);
  allocation[j]+=n;remaining-=n;for(let i=0;i<3;i++)room[i]-=n*w[i];
 }
 // First preserve valid incumbents, then use spare capacity on other phases.
 for(let j=0;j<count;j++)grant(j,Math.max(0,-Number(commands[j])||0));
 if(redistribute)for(let j=0;j<count&&remaining>=quantum;j++)grant(j,remaining);

 const out=commands.map((w,j)=>w>0?w:allocation[j]?-allocation[j]:0);
 s.maxChargeW=charge(out);s.appliedChargeW=charge(out);s.limited=charge(out)<requested;s.baselineW=baseline;
 if(c.batteries?.slice(0,count).some(x=>!weights(x)))s.reason+=' · onbekende faseverdeling';
 return {status:s,out};
}
// Peak Guard uses actual P1 for the battery controller. For flexible loads
// only, a valid phase overload supplies an additional, stricter Peak Guard
// budget. Reducing a balanced three-phase EV by 3 W removes 1 W per phase.
// The settings snapshot is never persisted or applied to battery planning.
function phaseExcessW(app,settings,now){
 if(!settings.peakShaveEnabled||!enabled(settings))return null;
 const c=config(settings),limit=finite(c.limitW)?Number(c.limitW):proposal(c);
 const values=app.gridPhases;
 if(!finite(limit)||limit<=0||!Array.isArray(values)||values.length!==3
   ||values.some(v=>!finite(v?.watts)||!v.at||now<v.at||now-v.at>15000))return null;
 // A partially published battery command must NOT suppress EV/HVAC shedding.
 return Math.max(...values.map(v=>v.watts-limit));
}
function phasePressure(app,settings,now=Date.now()){
 return Math.max(0,phaseExcessW(app,settings,now)||0);
}
// Existing Peak Guard margin provides release hysteresis for the flexible
// context signature. Noise around the exact phase limit must not trigger a
// new full context on every alternate P1 sample.
function phaseNearLimit(app,settings,now=Date.now()){
 const excess=phaseExcessW(app,settings,now);
 return excess!==null&&excess>=-Math.max(0,Number(settings.peakSoftMarginW)||0);
}
function flexiblePeakSettings(app,settings,now=Date.now()){
 const over=phasePressure(app,settings,now);
 if(!over)return settings;
 const grid=Number(app.state?.gridPowerW);
 if(!Number.isFinite(grid))return settings;
 const margin=Math.max(0,Number(settings.peakSoftMarginW)||0);
 const limit=Math.max(0,Math.min(Number(settings.peakLimitW)||0,grid-over*3+margin));
 return {...settings,peakLimitW:limit};
}
const assistEnabled=s=>enabled(s)&&Boolean(s.peakShaveEnabled)&&Boolean(s.phaseGuard?.peakGuardBatteryAssistEnabled);
const sum=list=>(list||[]).reduce((n,v)=>n+(Number(v)||0),0);
function flexibleReductionPending(app,settings,now,decisions){
 const ref=require('./ev-phase-guard').reference(app,settings,now);
 for(const e of ref?.ev||[]){
  const runtime=e.index?app.getExtraEv?.(e.index):app;
  const published=runtime?.lastPublishedAllowed===false?0:Number(e.index?runtime?.lastPublishedCurrentA:app.lastPublishedEvCurrentA)||0;
  const d=(Array.isArray(decisions)?decisions[e.index]:null)||(e.index?runtime?.latestDecision:app.latestEvDecision);
  // Unknown EV phase or missing current feedback cannot confirm a reduction.
  if((e.phases!==3||!e.measuredFresh)&&Math.max(e.current,published)>0)return true;
  if(e.pending&&(!e.pending.complete||e.current>e.pending.current+.2))return true;
  if(e.current>e.cap+.2||published>e.cap+.2)return true;
  if(d&&((d.allowed===false&&e.current>0)||Number.isFinite(Number(d.desiredCurrentA))
    &&e.current>Math.max(0,Number(d.desiredCurrentA))+.2))return true;
 }
 // Mode-controlled EVs are curtailed by the ordinary flexible-load Peak Guard,
 // not by the three-phase current cap. Do not pre-empt their output.
 if(typeof app.getEvCount==='function')for(let i=0;i<app.getEvCount(settings);i++){
  if(app.getEvControlTypeFor?.(i,settings)!=='mode')continue;
  const ev=i?app.getExtraEv?.(i):app;
  const active=i?ev?.lastPublishedAllowed!==false&&ev?.lastPublishedChargeMode!=='stop':app.lastPublishedEvAllowed!==false&&app.lastPublishedEvChargeMode!=='stop';
  const meter=app.getEvMeasuredCurrent?.(i,app.getEvInputSnapshot?.(i),now);
  if((active&&app.isEvOutputActiveFor?.(i,settings))||(meter?.fresh&&meter.currentA>0))return true;
 }
 if(settings.boilerEnabled&&app.boilerState?.outputOn)return true;
 if(typeof app.getHvacCount==='function')for(let i=0;i<app.getHvacCount(settings);i++){
  const hvac=app.getHvacInstanceSettings?.(i,settings);
  if(!hvac?.hvacEnabled||hvac.hvacCoordination?.EssentialEnabled||hvac.hvacCoordination?.KeepOnEnabled
     ||!hvac.hvacAutomaticControlEnabled||!app.isHvacManagedActiveFor?.(i))continue;
  const power=i?app.getExtraHvac?.(i)?.lastPublishedPower:app.lastPublishedHvacPower;
  if(power!==false&&(hvac.hvacAllowPowerControl||hvac.hvacAllowSetpointControl))return true;
 }
 return false;
}
// Last resort only: reuse the existing battery Flow/publication pipeline and
// respect P1 >= 0. No urgent fast evaluation, timer, listener or second EV loop.
function assist(app,commands,settings,now=Date.now(),options={}){
 const unchanged=commands.slice();const off={out:unchanged,extraW:0};
 if(!assistEnabled(settings)||!settings.controlEnabled||options.canPublishCommands===false
   ||options.injectionActive||options.injectionStop||app.inFlightBatteryCommands
   ||app.chargeTestOperationRunning||app.isHybridExternalControlActive?.(settings)
   ||app.getEvBatteryDischargePolicy?.(settings,now)?.blocked)return off;
 const s=inspect(app,settings,now);
 if(s.state!=='active'||!s.values.some(v=>v.watts>s.limitW))return off;
 const grid=Number(app.state?.gridPowerW);
 if(!Number.isFinite(grid)||grid<=0||flexibleReductionPending(app,settings,now,options.evDecisions))return off;
 const count=Math.min(8,Math.max(0,Number(settings.batteryCount)||0),commands.length);
 const old=Array.from({length:count},(_,i)=>Number(app.lastEmittedCommands?.[i])||0);
 const out=unchanged.slice();const shares=Array.from({length:count},(_,i)=>weights(s.batteries?.[i]));
 const prospectiveGrid=grid+sum(old)-sum(out);
 let headroom=Math.max(0,Math.floor(prospectiveGrid));
 if(!headroom)return off;
 const load=s.values.map(v=>v.watts);
 for(let j=0;j<count;j++){
  const delta=old[j]-(Number(out[j])||0),w=shares[j];
  if(w)for(let i=0;i<3;i++)load[i]+=delta*w[i];
  else if(delta>0)for(let i=0;i<3;i++)load[i]+=delta;
 }
 const need=load.map(v=>Math.max(0,v-s.limitW));
 if(!need.some(v=>v>0))return off;
 const {batteryPowerLimits}=require('./ems-engine');
 const floor=Math.max(Number(settings.minSoc)||0,Number(settings.safetySoc)||0);
 const step=[1,10,100].includes(Number(settings.batteryCommandStepW))?Number(settings.batteryCommandStepW):1;
 let groupRoom=Math.max(0,(Number(settings.maxTotalDischargeW)||0)-out.reduce((n,v)=>n+Math.max(0,Number(v)||0),0));
 const maxima=Array.from({length:count},(_,i)=>{
  const soc=app.state?.batterySoc?.[i];
  return shares[i]&&finite(soc)&&Number(soc)>floor?batteryPowerLimits(settings,i).maxDischarge:0;
 });
 for(const phaseIndex of [0,1,2].sort((a,b)=>need[b]-need[a]||a-b))for(const kind of [1,1/3])for(let j=0;j<count;j++){
  const share=shares[j]?.[phaseIndex]||0;
  if(!need[phaseIndex]||Math.abs(share-kind)>1e-8||!maxima[j]||out[j]<0)continue;
  const possible=Math.min(headroom,groupRoom,maxima[j]-(Number(out[j])||0),need[phaseIndex]/share);
  const grant=Math.max(0,Math.floor((possible+1e-8)/step)*step);
  if(!grant)continue;
  out[j]=(Number(out[j])||0)+grant;headroom-=grant;groupRoom-=grant;
  for(let i=0;i<3;i++)need[i]=Math.max(0,need[i]-grant*(shares[j]?.[i]||0));
 }
 const extraW=Math.max(0,sum(out)-sum(unchanged));
 return extraW?{out,extraW,predictedGridW:prospectiveGrid-extraW,phaseResidualW:need}:off;
}
function assistOutput(app,commands,result,settings,now=Date.now()){
 const original=result?.phaseBatteryAssist;
 if(!original?.extraW)return commands;
 const base=original.baseCommands||[];
 if(base.length!==commands.length)return commands;
 const clean=commands.map((v,i)=>Math.min(v,base[i]));
 const checked=assist(app,clean,settings,now,{canPublishCommands:result.canPublishCommands,
  injectionActive:result.injectionActive,injectionStop:result.injectionStop,evDecisions:result.evDecisions});
 return checked.out.map((v,i)=>Math.min(v,commands[i]));
}
function urgent(app,settings,now=Date.now()){
 if(!enabled(settings)||!charge(app.lastEmittedCommands))return false;
 const s=inspect(app,settings,now);if(s.state==='unavailable')return true;
 return s.values.some((v,i)=>v.watts>s.limitW&&(app.lastEmittedCommands||[]).some((w,j)=>w<0&&(!weights(s.batteries?.[j])||weights(s.batteries[j])[i]>0)));
}
// Phase relief can keep total charging unchanged by transferring it to a
// different battery. Such a reduction must still bypass the ordinary interval.
function reduction(app,commands,settings,now=Date.now()){
 if(!urgent(app,settings,now))return false;
 const status=inspect(app,settings,now),previous=app.lastEmittedCommands||[];
 if(status.state==='unavailable')return charge(commands)<charge(previous);
 const onPhase=(list,i)=>list.reduce((n,v,j)=>n+Math.max(0,-Number(v)||0)*(weights(status.batteries?.[j])||[1,1,1])[i],0);
 return status.values.some((v,i)=>v.watts>status.limitW&&onPhase(commands,i)<onPhase(previous,i)-.5);
}
function recovery(app,settings,now){
 if(!enabled(settings)||!app.phaseGuardStatus?.limited||now<Number(app.nextCommandAllowedAt||0))return false;
 const s=inspect(app,settings,now),r=app.phaseGuardRuntime;
 if(s.state!=='active'||r?.lastAttemptState==='active'&&r.lastAttemptPhases?.every((value,i)=>value===s.values[i].watts))return false;
 return s.batteries?.slice(0,Number(settings.batteryCount)||0).some(type=>{const w=weights(type)||[1,1,1];return s.values.every((v,i)=>!w[i]||v.watts<s.limitW);});
}
function limit(app,commands,settings,now=Date.now(),calculation=true,redistribute=true){
 if(!enabled(settings))return commands;
 if(!charge(commands)){if(app.phaseGuardStatus?.limited)return commands;app.phaseGuardStatus={...inspect(app,settings,now),state:'inactive',reason:'Fasebewaking: batterij laadt niet',appliedChargeW:0,maxChargeW:0,limited:false};return commands;}
 const r=envelope(app,commands,settings,now,redistribute);
 if(!calculation&&app.phaseGuardStatus?.limited)r.status.limited=true;
 app.phaseGuardStatus=r.status;return r.out;
}
function apply(app,result,settings,now){
 if(!enabled(settings))return result;
 app.phaseRequestedCommands=(result.candidateCommands||[]).slice();
 app.phaseSafetyRecovery=Boolean(result.safetySocRecoveryActive);
 const wasLimited=Boolean(app.phaseGuardStatus?.limited);
 const runtime=app.phaseGuardRuntime ||= {lastIncreaseAt:0};runtime.lastAttemptAt=now;
 // A new genuine zero-charge decision ends recovery; the final publication
 // of a phase-capped zero must retain its pending recovery state instead.
 if(!charge(result.candidateCommands))app.phaseGuardStatus=null;
 const capped=limit(app,result.candidateCommands||[],settings,now);
 const support=assist(app,capped,settings,now,{canPublishCommands:result.canPublishCommands,
  injectionActive:result.injectionActive,injectionStop:result.injectionStop,evDecisions:result.evDecisions});
 result.phaseBatteryAssist=support.extraW?{extraW:support.extraW,baseCommands:capped.slice()}:null;
 const out=support.out;
 runtime.lastAttemptPhases=app.gridPhases?.map(v=>v.watts);runtime.lastAttemptState=app.phaseGuardStatus?.state;
 result.phaseRecovery=wasLimited&&out.some((w,i)=>w<Math.min(0,Number(app.lastEmittedCommands?.[i])||0));
 result.candidateCommands=out;result.candidateTotalCommandW=out.reduce((a,b)=>a+b,0);result.phaseChargeGuard=app.phaseGuardStatus;
 return result;
}
function committed(app,previous,commands,settings,now=Date.now()){
 if(!enabled(settings))return;
 const runtime=app.phaseGuardRuntime ||= {};runtime.publicationUncertain=false;
 if(commands.some((w,i)=>w<Math.min(0,Number(previous?.[i])||0))){runtime.lastIncreaseAt=now;}
}
function status(app,settings,now){
 const s=inspect(app,settings,now);
 if(s.enabled&&s.state==='active'&&!s.currentChargeW){
  const ev=app.evPhaseRuntime;
  if(ev?.ev.some(e=>e.current>0||ev.pending[e.index]?.current>0||ev.receipts[e.index]?.current>0))return {...s,reason:'Fasebewaking: EV-laden bewaken'};
  return {...s,state:'inactive',reason:'Fasebewaking: batterij laadt niet'};
 }
 return s;
}
module.exports={capture,committed,status,defaults,config,proposal,ingest,inspect,urgent,recovery,limit,apply,charge,weights,reduction,phasePressure,phaseNearLimit,flexiblePeakSettings,assistEnabled,assist,assistOutput};
