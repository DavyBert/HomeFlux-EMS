'use strict';
// One user-requested pulse; shares response-test ownership, publication, safety
// gates and cancellation. P1 events advance it. No idle polling or test loop.
const P=require('./phase-guard');
const response=()=>require('./battery-response-test');
const status=app=>{const r=app.batteryPhaseDetection;return r?{running:r.running,stage:r.stage,index:r.index+1,message:r.message||'',result:r.result||null}:{running:false,stage:'idle',message:''};};
const values=app=>(app.gridPhases||[]).map(x=>x.watts);
const close=(a,b,t=40)=>a.length===3&&b.length===3&&a.every((v,i)=>Math.abs(v-b[i])<=t);
function watch(app,r){if(r.timer)clearTimeout(r.timer);r.deadline=Date.now()+60000;r.timer=app.homey.setTimeout(()=>stop(app,'Fasedetectie: geen betrouwbare reactie binnen de testtijd.').catch(e=>app.error('Phase detection timeout',e)),60000);}
async function send(app,r,commands,stage){r.stage=stage;r.busy=true;watch(app,r);r.operation=response().tools.publish(app,r,commands);try{await r.operation;}finally{r.busy=false;r.operation=null;}}
async function start(app,index){
 const s=app.getSettings(),tools=response().tools;response().status(app);
 if(app.batteryResponseTest.running||app.commandPublishing)throw Error('Er is al een batterijtest of publicatie actief.');
 const reason=tools.unsafe(app,s);if(reason)throw Error(reason);
 if(!Number.isInteger(index)||index<0||index>=app.getBatteryCount(s))throw Error('Selecteer een geconfigureerde batterij.');
 const guard=P.inspect(app,{...s,phaseGuard:{...P.config(s),enabled:true}},Date.now());
 if(Number(s.phaseGuard?.phases)!==3||guard.state!=='active')throw Error('Fasedetectie vereist drie actuele fasemetingen en een geldige calculator.');
 const low=tools.lowCommands(app,s),commands=low.slice();commands[index]-=400;
 const soc=app.state.batterySoc?.[index];const max=s.individualBatteryPowerLimitsEnabled?s[`battery${index+1}MaxChargeW`]:s.maxChargePerBatteryW;
 if(soc==null||!app.inputSeen.batterySoc?.[index]||soc>=Number(s.maxSoc)-1||soc<Math.max(Number(s.minSoc)||0,Number(s.safetySoc)||0)||-commands[index]>Number(max)||P.charge(commands)>Number(s.maxTotalChargeW))throw Error('Onvoldoende veilige laadruimte voor een puls van 400 W.');
 // Unknown phase: require the whole pulse to fit on every phase, also when
 // moving all existing batteries to their diagnostic baseline first.
 const previous=app.lastEmittedCommands||[];
 const lostDischarge=previous.reduce((n,w)=>n+Math.max(0,Number(w)||0),0);
 const extraBaseline=Math.max(0,P.charge(low)-P.charge(previous))+lostDischarge;
 if(low.some((w,i)=>w<0&&(!app.inputSeen.batterySoc?.[i]||app.state.batterySoc?.[i]==null||Number(app.state.batterySoc[i])>=Number(s.maxSoc)))||low.some((w,i)=>-w>Number(s.individualBatteryPowerLimitsEnabled?s[`battery${i+1}MaxChargeW`]:s.maxChargePerBatteryW))||guard.values.some(v=>v.watts+extraBaseline+400+100>guard.limitW)||(Number(s.peakLimitW)>0&&Number(app.state.gridPowerW)+extraBaseline+400+Math.max(100,Number(s.peakSoftMarginW)||0)>Number(s.peakLimitW)))throw Error('Onvoldoende fase- of Peak Guard-marge voor de test.');
 const r={kind:'phase',running:true,stage:'baseline',index,count:commands.length,settings:s,commands,low,signature:app.getChargeTestSignature(s),pvAtStart:Number(app.state.pvPowerW)||0,loadFingerprint:tools.fingerprint(app),startedAt:Date.now(),phaseSignature:JSON.stringify(s.phaseGuard),previousResponse:app.batteryResponseTest,lastResult:app.batteryResponseTest.lastResult||null,window:[],message:'Fasedetectie: wacht op stabiele fasemetingen'};
 app.batteryPhaseDetection=r;app.batteryResponseTest=r;response().tools.persist(app,r);app.pendingResult=null;app.pendingCommandBypassInterval=false;
 try{await send(app,r,low,'baseline');}catch(e){await stop(app,'Fasedetectie: publiceren mislukt.');throw e;}
 return status(app);
}
async function stop(app,message='Fasedetectie gestopt.',resume=true,success=false){
 const r=app.batteryPhaseDetection;if(!r?.running)return status(app);if(r.stopping)return r.stopping;
 r.stopping=Promise.resolve().then(async()=>{
  if(r.timer)clearTimeout(r.timer);if(r.operation)try{await r.operation;}catch(_){}
  let safe=true;
  try{if(!success||!r.returnConfirmed)await response().tools.publish(app,r,r.low);}catch(e){safe=false;app.error('Phase detection return failed',e);message='Fasedetectie: terugkeercommando niet bevestigd.';}
  r.running=false;r.stage=success&&safe?'completed':'stopped';r.message=message;
  app.batteryResponseTest=r.previousResponse;response().tools.persist(app,r.previousResponse);
  if(success&&safe&&r.detected){
   const s=app.getSettings(),c=P.config(s),batteries=Array.from({length:8},(_,i)=>i===r.index?r.detected:c.batteries?.[i]||'unknown');
   app.setSetting('phaseGuard',{...c,batteries});r.result={phase:r.detected,measuredAt:Date.now(),deltaW:r.delta,pulseW:400};
   app.homey.settings.set('_batteryPhaseDetection',r.result);
  }
  if(resume)app.requestContextEvaluate(true,'battery_phase_detection_finished');
  return status(app);
 });return r.stopping;
}
async function observe(app,now,settings){
 const r=app.batteryPhaseDetection;if(!r?.running||r.busy||r.stopping)return;
 if(now>=r.deadline)return stop(app,'Fasedetectie: geen betrouwbare reactie binnen de testtijd.');
 const reason=response().tools.unsafe(app,settings,r);if(reason)return stop(app,reason);
 if(JSON.stringify(settings.phaseGuard)!==r.phaseSignature)return stop(app,'Fasedetectie: fase-instellingen gewijzigd.');
 if(P.inspect(app,{...settings,phaseGuard:{...P.config(settings),enabled:true}},now).state!=='active')return stop(app,'Fasedetectie: fasemetingen ontbreken of zijn verouderd.');
 const sampleAt=Math.min(...app.gridPhases.map(v=>v.at));if(sampleAt<=Number(r.lastAt||0))return;r.lastAt=sampleAt;
 const sample=values(app),total=Number(app.state.gridPowerW),limit=P.inspect(app,{...settings,phaseGuard:{...P.config(settings),enabled:true}},now).limitW;
 if(sample.some(v=>v>limit))return stop(app,'Onvoldoende fase- of Peak Guard-marge voor de test.');
 if(r.stage==='baseline'){
  if(!r.window.length||!close(sample,r.window[0].values,25)||Math.abs(total-r.window[0].total)>30)r.window=[];
  r.window.push({values:sample,total,at:now});if(r.window.length>6)r.window.shift();
  if(r.window.length<4||now-r.window[0].at<3000)return;
  if(sample.some(v=>v+500>limit)||(Number(settings.peakLimitW)>0&&total+400+Math.max(100,Number(settings.peakSoftMarginW)||0)>Number(settings.peakLimitW)))return stop(app,'Onvoldoende fase- of Peak Guard-marge voor de test.');
  r.baseline=r.window.at(-1).values;r.baselineTotal=total;r.window=[];return send(app,r,r.commands,'pulse');
 }
 if(r.stage==='pulse'){
  const delta=sample.map((v,i)=>v-r.baseline[i]);if(Math.abs(total-r.baselineTotal-400)>40){r.matches=0;return;}
  let type=null;
  for(let i=0;i<3;i++)if(close(delta,[0,1,2].map(j=>i===j?400:0)))type='L'+(i+1);
  if(close(delta,[400/3,400/3,400/3],400/30))type='balanced3';
  if(!type){r.matches=0;return;}
  r.matches=r.candidate===type?(r.matches||0)+1:1;r.candidate=type;
  if(r.matches<2)return;r.detected=type;r.delta=delta;r.matches=0;
  return send(app,r,r.low,'return');
 }
 if(r.stage==='return'){
  if(!close(sample,r.baseline)||Math.abs(total-r.baselineTotal)>40){r.matches=0;return;}
  if(++r.matches<2)return;r.returnConfirmed=true;return stop(app,'Fasedetectie voltooid.',true,true);
 }
}
module.exports={start,stop,observe,status};
