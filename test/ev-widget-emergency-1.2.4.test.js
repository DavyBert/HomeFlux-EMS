'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {boot}=require('./startup-harness'),{create}=require('../widgets/ev/public/controller');
const results=[];let seq=0;
const submit=(a,evId,change,more={})=>a.setEvDashboard({evId:String(evId),change,requestId:'emergency_test_'+(++seq),...more});
const plan=(a,i=1)=>submit(a,i,{target:{type:'kwh',value:20},time:'07:00',days:2,guaranteed:false},{createOnly:true});
async function check(name,fn){await fn();results.push(name);}
(async()=>{
 const h=await boot(new Map(Object.entries({evCount:2,evEnabled:true,ev2Enabled:true,batteryCount:0,controlEnabled:false}))),a=h.app;a.requestContextEvaluate=()=>{};
 await check('Emergency without any goal invokes the exact registered mode listener; no fictional goal/deadline',async()=>{
  const original=a.slotFlowCards.actions.get('set_ev1_session_override');let count=0;
  a.slotFlowCards.actions.set('set_ev1_session_override',args=>{count++;assert.equal(args.mode,'emergency');return original(args);});
  await submit(a,1,{mode:'emergency'});assert.equal(count,1);assert.equal(a.getEffectiveEvModeFor(0),'emergency');assert.equal(a.getEvDashboard().evs[0].plan,null);
  assert(!a.evSocPlans[0].active&&!a.evEnergyPlans[0].active);a.slotFlowCards.actions.set('set_ev1_session_override',original);
 });
 await check('Confirmed Emergency clears only the selected widget goal, then activates existing mode override',async()=>{
  await plan(a,1);await plan(a,2);assert.equal(a.getEffectiveEvModeFor(0),'smart');
  await submit(a,1,{mode:'emergency'});assert(!a.evEnergyPlans[0].active);assert(a.evEnergyPlans[1].active);assert.equal(a.getEffectiveEvModeFor(0),'emergency');assert.equal(a.getEffectiveEvModeFor(1),'smart');
  assert.equal(a.evWidgetPlanRuntime[0].endedReason,'widget_emergency');
 });
 await check('Switching Emergency off uses existing Smart mode input and does not recreate an ended widget goal',async()=>{
  await submit(a,1,{mode:'smart'});assert.equal(a.getEffectiveEvModeFor(0),'smart');assert.equal(a.getEvDashboard().evs[0].plan,null);
 });
 await check('Existing Flow-created goal stays persistent when Emergency mode is chosen',async()=>{
  await h.cards.get('set_ev1_soc_deadline').listener({target_soc:80,time:'07:00',guarantee:'yes'});
  await submit(a,1,{mode:'emergency'});assert(a.evSocPlans[0].active);assert.equal(a.evSocPlans[0].targetSoc,80);
  await submit(a,1,{mode:'smart'});assert(a.evSocPlans[0].active);
 });
 await check('Invalid action or missing listener cannot clear the previous valid widget goal',async()=>{
  a.clearEvSocPlan(0);await plan(a,1);const before=JSON.stringify(a.evEnergyPlans[0]);
  for(const mode of ['soc_target','stop',true,null])await assert.rejects(async()=>submit(a,1,{mode}),/input/);
  const old=a.slotFlowCards.actions.get('set_ev1_session_override');a.slotFlowCards.actions.delete('set_ev1_session_override');await assert.rejects(async()=>submit(a,1,{mode:'emergency'}),/ev/);a.slotFlowCards.actions.set('set_ev1_session_override',old);
  assert.equal(JSON.stringify(a.evEnergyPlans[0]),before);
 });
 await check('Duplicate confirmations with the same request ID execute the central mode action once',async()=>{
  const old=a.slotFlowCards.actions.get('set_ev1_session_override');let calls=0;
  a.slotFlowCards.actions.set('set_ev1_session_override',args=>{calls++;return old(args);});
  const body={evId:'1',change:{mode:'emergency'},requestId:'emergency_same_12345'};await Promise.all([a.setEvDashboard(body),a.setEvDashboard(body)]);assert.equal(calls,1);a.slotFlowCards.actions.set('set_ev1_session_override',old);
 });
 await check('Controller double-confirmation works without a plan and without completing a target/time draft',async()=>{
  let now=1000;const sent=[];const c=create({now:()=>now,nonce:()=> 'emergency_nonce',send:async body=>{sent.push(body);return{accepted:true,plan:null,mode:'emergency'};}});c.select('1');c.update(null);
  assert((await c.tap('emergency',{mode:'emergency'})).confirm);assert.equal(sent.length,0);
  assert((await c.tap('emergency',{mode:'emergency'})).success);assert.equal(sent.length,1);assert.equal(sent[0].createOnly,false);assert.deepEqual(sent[0].change,{mode:'emergency'});
  await c.tap('emergency',{mode:'emergency'});now+=5000;assert((await c.tap('emergency',{mode:'emergency'})).confirm);assert.equal(sent.length,1);
  c.select('2');assert.equal(c.snapshot().pending,null);
 });
 fs.writeFileSync(path.join(__dirname,'../validation/ev-widget-emergency-1.2.4.json'),JSON.stringify({simulatedHomey:true,passed:results.length,results},null,2)+'\n');console.log('EV widget Emergency: '+results.length+' groups passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
