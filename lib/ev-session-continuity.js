'use strict';
// Only connection transitions and the explicit Flow end latch survive restart.
// Current/SoC measurements, learned baselines and complete sessions are not copied.
const KEY='_evSessionContinuity';
function restore(app,now=Date.now()){
 const saved=app.homey.settings.get(KEY);
 if(saved?.version!==1||!Array.isArray(saved.entries))return;
 for(let i=0;i<4;i++){
  const v=saved.entries[i];if(typeof v?.connected!=='boolean')continue;
  const extra=i?app.getExtraEv(i):null,seen=i?extra.seen:app.inputSeen.ev,updated=i?extra.updatedAt:app.inputUpdatedAt.ev;
  if(i)extra.state.connected=v.connected;else app.state.evConnected=v.connected;
  seen.connected=true;
  updated.connected=Number.isFinite(v.at)&&v.at>0&&v.at<=now?v.at:0;
  const session=app.getEvSessionDetectionRuntime(i);
  if(v.connected){session.connectedAt=updated.connected;session.state='waiting';}
  if(v.connected&&Number.isFinite(v.flowEndedAt)&&v.flowEndedAt>0){
   Object.assign(session,{state:'ended',endedLatched:true,endedReason:'flow',endedAt:v.flowEndedAt});
   if(i)extra.forceOutput=true;else app.forceEvOutput=true;
  }
 }
}
function persist(app){
 const entries=Array.from({length:4},(_,i)=>{
  const input=i&&!app.extraEvInstances?.[i-1]?null:app.getEvInputSnapshot(i),session=app.getEvSessionDetectionRuntime(i);
  return {connected:input?.seen?.connected?Boolean(input.connected):null,at:Number(input?.updatedAt?.connected)||0,
   flowEndedAt:session?.endedLatched&&session.endedReason==='flow'?Number(session.endedAt)||0:0};
 });
 app.setSetting(KEY,{version:1,entries});
}
module.exports={restore,persist};
