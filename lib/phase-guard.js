'use strict';
// Existing battery pipeline's optional charging envelope. No scheduler/listener.
const finite=x=>x!==null&&x!==undefined&&x!==''&&typeof x!=='boolean'&&Number.isFinite(Number(x));
const defaults={phases:1,enabled:false,voltage:null,amps:null,safetyPercent:80,limitW:null,priority:'battery_first',batteries:Array(8).fill('unknown')};
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
  commands:(app.lastEmittedCommands||[]).slice(0,Number(settings.batteryCount)||0),types:(settings.phaseGuard.batteries||[]).slice()};
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
 const joint=require('./ev-phase-guard').adjustments(app,settings,now);
 const baseline=s.values.map((v,i)=>v.watts+(joint?.delta[i]||0)),room=[0,0,0],over=s.values.some(v=>v.watts>s.limitW);
 for(let j=0;j<count;j++){const w=previous.types[j]===c.batteries?.[j]?weights(c.batteries?.[j]):null;if(w)for(let i=0;i<3;i++)baseline[i]-=Math.max(0,-Number(previous.commands[j])||0)*w[i];
  const lostDischarge=Math.max(0,Math.max(0,Number(previous.commands[j])||0)-Math.max(0,Number(commands[j])||0));
  for(let i=0;i<3;i++)baseline[i]+=lostDischarge*(w?w[i]:1);}
 for(let i=0;i<3;i++)room[i]=Math.max(0,s.limitW-baseline[i]);
 if(baseline.some(v=>v>s.limitW))s.reason='Fasebewaking: overbelasting buiten batterijlaadvermogen';
 const requested=charge(commands),budget=Math.min(requested,Math.max(0,Number(settings.maxTotalChargeW)||0));
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
 const wasLimited=Boolean(app.phaseGuardStatus?.limited);
 const runtime=app.phaseGuardRuntime ||= {lastIncreaseAt:0};runtime.lastAttemptAt=now;
 // A new genuine zero-charge decision ends recovery; the final publication
 // of a phase-capped zero must retain its pending recovery state instead.
 if(!charge(result.candidateCommands))app.phaseGuardStatus=null;
 const out=limit(app,result.candidateCommands||[],settings,now);
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
module.exports={capture,committed,status,defaults,config,proposal,ingest,inspect,urgent,recovery,limit,apply,charge,weights,reduction};
