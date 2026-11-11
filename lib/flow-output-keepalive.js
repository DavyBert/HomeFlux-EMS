'use strict';
// Transport-only replay on the existing heartbeat. No evaluator, split output,
// timer or settings persistence. Keep only one bounded successful Flow receipt.
const responseTest=require('./battery-response-test');
const phaseGuard=require('./phase-guard');
const interval=value=>Math.max(1,Math.min(60,Number(value)||5))*60000;
const runtime=app=>app.flowOutputKeepalive ||= {battery:null,batteryAt:0,externalAt:0,externalPublishing:0};
function signature(app,s){
 return JSON.stringify([app.getChargeTestSignature(s),s.forcedMode,s.minSoc,s.safetySoc,s.maxSoc,
  s.maxTotalChargeW,s.maxTotalDischargeW,s.maxChargePerBatteryW,s.maxDischargePerBatteryW,
  s.individualBatteryPowerLimitsEnabled,s.peakShaveEnabled,s.peakLimitW,s.peakSoftMarginW,s.phaseGuard,
  ...Array.from({length:app.getBatteryCount(s)},(_,i)=>[s[`battery${i+1}MaxChargeW`],s[`battery${i+1}MaxDischargeW`]])]);
}
function remember(app,tokens,state,commands,settings,now=Date.now()){
 const r=runtime(app);
 r.battery={tokens,state,commands:commands.slice(),signature:signature(app,settings)};
 r.batteryAt=now;
}
function invalidate(app){if(app.flowOutputKeepalive)app.flowOutputKeepalive.battery=null;}
function busy(app){
 return app.commandPublishing||app.pendingResult||app.pendingCommandBypassInterval||app.inFlightBatteryCommands
  ||app.chargeTestRunning||app.chargeTestAwaitingConfirmation||app.chargeTestOperationRunning||responseTest.active(app);
}
function release(app){
 app.commandPublishing=false;
 // Drain only a normal publication already requested while this lock was held.
 if(app.pendingResult)app.emitPending().catch(err=>app.error('Queued battery command emit failed',err));
}
async function tick(app,now=Date.now()){
 const s=app.settingsCache||app.getSettings();
 if(!s.batteryFlowKeepaliveEnabled&&!s.externalEmsFlowKeepaliveEnabled)return;
 const r=runtime(app);if(busy(app)||!s.controlEnabled||!app.isChargeTestValid(s)
  ||!app.getInputReadiness(s).ready||app.getBatteryCommandPauseInfo(now,s).active)return;
 if(app.hybridEmsRuntime?.status==='handover_wait')return;
 if(app.isHybridExternalControlActive(s)){
  if(!s.externalEmsFlowKeepaliveEnabled||r.externalPublishing)return;
  const since=Math.max(Number(app.hybridEmsRuntime.modeRequestedAt)||0,r.externalAt||0);
  if(since>0&&now-since>=interval(s.externalEmsFlowKeepaliveMinutes)){
   app.commandPublishing=true;
   try{await app.requestExternalEmsSelfConsumption('keepalive',false);}finally{release(app);}
  }
  return;
 }
 if(!s.batteryFlowKeepaliveEnabled||r.externalPublishing||app.hybridEmsRuntime?.delegated||app.hybridEmsRuntime?.status==='handover_wait')return;
 const receipt=r.battery;
 if(receipt?.state?.mode==='injection'&&!require('./active-injection').validPublication(app,{injectionActive:true,injectionTargetW:require('./active-injection').engineState(app,s).injectionTargetW},s))return;
 if(!receipt||now-r.batteryAt<interval(s.batteryFlowKeepaliveMinutes))return;
 const minimum=Math.max(1,Number(s.commandIntervalSeconds)||10)*1000;
 if(now<Number(app.nextCommandAllowedAt||0)||now-Number(app.lastEmitAt||0)<minimum)return;
 // Never replay an obsolete format/limit or a command superseded by a split
 // hold, phase reduction, test, or any other completed battery publication.
 if(app.batteryIdleKnownOutput!==app.lastEmittedCommands||receipt.signature!==signature(app,s)||receipt.commands.length!==app.lastEmittedCommands.length
  ||receipt.commands.some((w,i)=>w!==app.lastEmittedCommands[i]))return;
 if(app.latestResult?.canPublishCommands!==true||app.phaseGuardRuntime?.publicationUncertain||phaseGuard.urgent(app,s,now))return;
 if(receipt.commands.some((w,i)=>w!==0&&(!app.inputSeen.batterySoc[i]||app.state.batterySoc[i]==null
  ||!Number.isFinite(Number(app.state.batterySoc[i]))||w<0&&Number(app.state.batterySoc[i])>=Number(s.maxSoc)
  ||w>0&&Number(app.state.batterySoc[i])<=Number(s.minSoc))))return;
 if(s.peakShaveEnabled&&receipt.commands.some(w=>w<0)
  &&Number(app.state.gridPowerW)>Number(s.peakLimitW)-Math.max(0,Number(s.peakSoftMarginW)||0))return;
 if(receipt.commands.some(w=>w>0)&&app.getEvBatteryDischargePolicy(s,now).blocked)return;
 app.commandPublishing=true;
 try{
  await app.commandTrigger.trigger({...receipt.tokens},{...receipt.state});
  r.batteryAt=Date.now();
 }finally{
  release(app);
 }
}
module.exports={runtime,remember,invalidate,tick};
