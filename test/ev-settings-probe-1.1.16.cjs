'use strict';
const {fixture}=require('./ev-work-harness');
const {installVirtualClearTimeout}=require('./pv-source-harness');
const NativeDate=Date;
class Clock extends NativeDate {constructor(...a){super(...(a.length?a:[Clock.now()]));}}
(async()=>{
 const restore=installVirtualClearTimeout();global.Date=Clock;
 try{
  const h=await fixture({type:process.env.EV_TYPE||'mode',batteries:1,connected:true,chargeAllowed:true}),a=h.app;
  await h.cards.get('set_ev1_soc_deadline').listener({target_soc:100,time:'07:00',guarantee:'yes'});await h.flush();
  const original=a.getEvInstanceSettings, callers={};let n=0;
  a.getEvInstanceSettings=function(...xs){const caller=(new Error().stack||'').split('\n').slice(2,6).map(x=>x.trim().replace(/\:\d+\:\d+\)?$/, '')).join(' < ');callers[caller]=(callers[caller]||0)+1;n++;return original.apply(this,xs);};
  const cpu=process.cpuUsage();const stamp=h.now();
  for(let sec=1;sec<=180;sec++){
   h.setNow(stamp+sec*1000);
   const mode=a.lastPublishedEvChargeMode;const amp=process.env.EV_CURRENT==='1'?16:mode==='standard'?16:mode==='smart'?6:0;
   await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:amp});
   await h.cards.get('set_ev1_soc').listener({soc:22});
   await h.grid(623+amp*Math.sqrt(3)*400-a.state.lastTotalCommandW);
   if(sec%60===0){a.runContextHeartbeat();await a.runEvHeartbeat();await h.drain();}
   await h.flush();
  }
  const used=process.cpuUsage(cpu);
  console.log(JSON.stringify({calls:n,callers:Object.entries(callers).sort((a,b)=>b[1]-a[1]),cpuMs:(used.user+used.system)/1000,errors:h.errors},null,2));
 }finally{restore();global.Date=NativeDate;}
})().catch(err=>{console.error(err);process.exitCode=1;});
