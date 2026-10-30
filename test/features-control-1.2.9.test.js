'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./ev-work-harness'),{installVirtualClearTimeout}=require('./pv-source-harness');
const options=require('../lib/ev-plan-options');
const RealDate=Date,realNow=Date.now;
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const restore=installVirtualClearTimeout(),results=[];
async function settle(h,grid=500){await h.start();h.setNow(h.now()+8000);await h.grid(grid);await h.start();await h.flush();}
(async()=>{try{
 for(const type of ['current','hybrid','mode']){
  const h=await fixture({type,evs:4,batteries:0,batteryEnabled:false,chargeAllowed:true,extra:{peakShaveEnabled:true,peakLimitW:17500,peakSoftMarginW:300}}),a=h.app;
  for(let i=0;i<4;i++){
   assert.equal(await h.cards.get(`set_ev${i+1}_energy_deadline`).listener({energy:20,time:'07:00',guarantee:'yes'}),true);
   assert.equal(await h.cards.get('set_ev_session_override_for_configured').listener({ev:{id:String(i+1),kind:'ev'},mode:'extend_plan_7_days'}),true);
  }
  await settle(h);
  let ds=[a.latestEvDecision,...a.extraEvInstances.map(e=>e.latestDecision)].slice(0,4);
  const total=ds.reduce((s,d)=>s+Math.max(0,d?.desiredPowerW||0),0);
  assert(ds.some(d=>d.desiredPowerW>0));assert(ds.every(d=>d.desiredCurrentA<=16));assert(total<=17500-300-500+1);
  // Emergency keeps its existing priority; deadline protection stays intact.
  for(let i=0;i<4;i++){
   await h.cards.get('set_ev_session_override_for_configured').listener({ev:{id:String(i+1),kind:'ev'},mode:'emergency'});
   assert.equal(a.getEffectiveEvModeFor(i),'emergency');assert(options.protectedPlan(a,i));
  }
  await settle(h);
  assert([a.latestEvDecision,...a.extraEvInstances.map(e=>e.latestDecision)].reduce((sum,d)=>sum+Math.max(0,d?.desiredPowerW||0),0)<=17500-300-500+1);
  const builds=a.evDeadlinePlanner.builds;
  for(let i=0;i<120;i++){h.setNow(h.now()+1000);await h.grid(500+(i%2));}
  assert.equal(a.evDeadlinePlanner.builds,builds,'No multi-day rebuild on fast P1');
  await h.setExternalSetting('peakLimitW',1000);await settle(h,1500);
  ds=[a.latestEvDecision,...a.extraEvInstances.map(e=>e.latestDecision)].slice(0,4);
  assert(ds.every(d=>!d.allowed || d.desiredPowerW===0),'Peak Guard stops all EVs above limit');
  assert.equal(a.lastPublishedEvAllowed,false);
  assert(a.extraEvInstances.every(e=>!e.lastPublishedAllowed));
  assert([0,1,2,3].every(i=>options.protectedPlan(a,i)),'Safety stop must not discard plan');
  assert.deepEqual(h.errors,[]);results.push({type,desiredTotalW:total,peakLimitW:17500,buildsDuring120P1Events:0,peakStopPassed:true});
 }
 // Real SoC feedback enters the existing decision/session path and releases lock.
 const h=await fixture({type:'current',batteries:0,batteryEnabled:false,chargeAllowed:true}),a=h.app;
 await h.cards.get('set_ev1_soc_deadline').listener({target_soc:60,time:'07:00',guarantee:'yes'});
 await h.cards.get('set_ev_session_override_for_configured').listener({ev:{id:'1',kind:'ev'},mode:'extend_plan_2_days'});
 await settle(h);await h.cards.get('set_ev1_soc').listener({soc:60});await settle(h);
 assert(options.widget(a,0).completed);assert.equal(options.protectedPlan(a,0),false);assert.equal(a.lastPublishedEvAllowed,false);
 await h.cards.get('set_ev_session_override_for_configured').listener({ev:{id:'1',kind:'ev'},mode:'emergency'});
 await settle(h);assert.equal(options.current(a,0),null);assert.equal(a.getEffectiveEvModeFor(0),'emergency');assert(a.lastPublishedEvAllowed);
 assert.equal(await h.cards.get('set_ev1_soc_deadline').listener({target_soc:75,time:'08:00',guarantee:'no'}),true);
 assert.deepEqual(h.errors,[]);results.push({type:'soc_completion',freshFeedbackCompleted:true,newGoalAccepted:true});
 fs.writeFileSync(path.join(__dirname,'../validation/features-control-1.2.9.json'),JSON.stringify({simulatedHomey:true,passed:results.length,results},null,2)+'\n');
 console.log('1.2.9 control: '+results.length+' production-path groups passed; Current/Hybrid/Mode, four EVs, Peak Guard, P1 cache and SoC completion.');
 }finally{restore();global.Date=RealDate;Date.now=realNow;}
})().catch(e=>{console.error('FAILED after',results.length,e);process.exitCode=1;});
