'use strict';
// Periodic temperature target inside the existing HVAC controller. No own timer.
const DAY=86400000,HOUR=3600000;
function select(app,index,s,u,mode,normalTarget,tariff,now,persist) {
 const configured=Boolean(s.hvacPermanentEnabled&&s.hvacPeriodicHeatEnabled);
 const key=JSON.stringify([s.hvacPeriodicHeatDays,s.hvacPeriodicHeatHours,s.hvacPeriodicHeatTargetC]);
 let c=u.periodic;
 if(!c&&!configured)return {mode,target:normalTarget};
 if(!c)c=u.periodic={lastCompletedAt:0,heldMs:0,applied:false};
 const live=(app.hvacPermanentRuntime.periodicLive ||= {}),old=live[index];
 const target=Math.round(Math.max(5,Math.min(99,Number(s.hvacPeriodicHeatTargetC)||30))*2)/2;
 const duration=Math.max(.1,Math.min(48,Number(s.hvacPeriodicHeatHours)||1))*HOUR;
 const interval=Math.max(1,Math.min(365,Number(s.hvacPeriodicHeatDays)||7))*DAY;
 const cheap=tariff?.className==='cheap';
 const room=app.getHvacInputSnapshot(index),reached=room?.seen?.roomTemperature&&Number.isFinite(Number(room.roomTemperatureC))&&Number(room.roomTemperatureC)>=target-.25;
 const updatedAt=Number(room?.updatedAt?.roomTemperature)||0;
 const feedbackFresh=updatedAt>0&&now>=updatedAt&&now-updatedAt<=300000;
 const qualified=configured&&cheap&&reached&&feedbackFresh&&c.applied&&c.appliedTarget===target&&!u.outdoorStopped;
 let dirty=false;
 if(c.key!==key){c.key=key;c.heldMs=0;delete live[index];dirty=true;}
 else if(old?.qualified&&qualified&&old.key===key&&now>=old.at&&now-old.at<=Math.max(90000,app.getSlowControlIntervalMs(s)+30000)){c.heldMs+=now-old.at;dirty=true;}
 if(configured&&c.heldMs>=duration){c.lastCompletedAt=now;c.heldMs=0;dirty=true;}
 const due=!c.lastCompletedAt||now>=c.lastCompletedAt+interval;
 const active=configured&&cheap&&due;
 live[index]={at:now,qualified:qualified&&active,key};
 if(dirty)persist(app);
 if(active){
  return {mode:'heat',target,periodicHeating:true,restoreTarget:Math.min(target,mode==='heat'?Number(normalTarget)||Number(s.hvacComfortMinC):Number(s.hvacComfortMinC))};
 }
 if(c.applied){
  // Lower the heating goal before any later cooling-mode change is considered.
  return {mode:'heat',target:Math.min(Number(c.restoreTarget)||Number(s.hvacComfortMinC),Number(u.setpoint)||target),periodicCleanup:true};
 }
 return {mode,target:normalTarget};
}
function ack(app,index,u,d,now){
 const c=u.periodic;if(!c)return;
 if(d.periodicHeating&&d.setpointCommand!==null&&!d.outdoorStop){c.applied=true;c.appliedTarget=Number(d.setpointCommand);c.restoreTarget=d.periodicRestoreTarget;}
 if(d.periodicCleanup&&d.setpointCommand!==null){c.applied=false;delete app.hvacPermanentRuntime.periodicLive?.[index];}
 if(d.outdoorStop)delete app.hvacPermanentRuntime.periodicLive?.[index];
}
function needsRestore(app,index){return Boolean((app.hvacPermanentRuntime?.units || app.homey.settings.get('_hvacPermanent')?.units)?.[index]?.periodic?.applied);}
module.exports={select,ack,needsRestore};
