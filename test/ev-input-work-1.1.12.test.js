'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture, warm, pass, perAmpW, start } = require('./ev-battery-transition-1.1.9.test');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const results=[];
async function input(h, route, i, connected, current) {
  if(route==='api') h.app.setInput(i?{evs:[null,...Array(i-1).fill(null),{connected,chargeCurrentA:current}]}:{ev:{connected,chargeCurrentA:current}});
  else await h.cards.get(route==='generic'?'set_ev_status_for':route==='configured'?'set_ev_status_for_configured':`set_ev${i+1}_status`).listener({
    ...(route==='generic'?{ev:String(i+1)}:route==='configured'?{ev:{kind:'ev',id:String(i+1),name:`EV ${i+1}`}}:{}),
    connected:connected?'yes':'no',charge_current:current});
  await h.drain();
}
async function duplicateCases() {
 for(const type of ['current','mode','hybrid']) for(const route of ['numbered','generic','configured','api']) for(const connected of [true,false]) {
  const h=await fixture(type,7,4);await warm(h,4);
  if(!connected){for(let i=0;i<4;i++)await input(h,route,i,false,0);await pass(h);}
  const a=h.app,values=Array.from({length:4},(_,i)=>a.getEvInputSnapshot(i).chargeCurrentA),requests=[];
  const original=a.requestContextEvaluate.bind(a);a.requestContextEvaluate=(...args)=>{if(/^ev\d_status$|^api_context_input$/.test(args[1]))requests.push(args[1]);return original(...args)};
  const bp=h.traces.length,ep=h.flexible.length,revision=a.controlContextRevision;
  for(let n=0;n<10;n++){h.setNow(h.now()+1000);for(let i=0;i<4;i++)await input(h,route,i,connected,values[i]);}
  await h.flush();
  const r={scenario:'duplicates',type,route,connected,updates:40,requests:requests.length,
    revisionDelta:a.controlContextRevision-revision,batteryPublishes:h.traces.length-bp,evPublishes:h.flexible.length-ep};results.push(r);
  assert.equal(requests.length,0,JSON.stringify(r));assert.equal(r.revisionDelta,0);
  assert.equal(r.batteryPublishes,0);assert.equal(r.evPublishes,0);
  for(let i=0;i<4;i++)assert.equal(a.getEvInputSnapshot(i).updatedAt.chargeCurrent,h.now());
  assert.deepEqual(h.errors,[]);
 }
}
async function transitionCases() {
 for(const route of ['numbered','api']) {
  const h=await fixture('current');await warm(h);const requests=[],orig=h.app.requestContextEvaluate.bind(h.app);
  h.app.requestContextEvaluate=(...args)=>{requests.push(args[1]);return orig(...args)};
  const deferred=h.app.setEvContextRefreshRequest.bind(h.app);
  h.app.setEvContextRefreshRequest=(reason,needed)=>{if(needed)requests.push(reason);return deferred(reason,needed)};
  h.setNow(h.now()+1000);await input(h,route,0,true,12);assert(requests.length>0);requests.length=0;
  h.setNow(h.now()+1000);await input(h,route,0,true,12);assert.equal(requests.length,0);
  h.setNow(h.now()+61000);await input(h,route,0,true,12);assert(requests.length>0,'stale recovery must reevaluate');requests.length=0;
  h.setNow(h.now()+1000);await input(h,route,0,true,0);assert(requests.length>0);requests.length=0;
  h.setNow(h.now()+1000);await input(h,route,0,false,0);assert(requests.length>0);requests.length=0;
  h.setNow(h.now()+1000);await input(h,route,0,false,0);assert.equal(requests.length,0);
  results.push({scenario:'transitions',route});
 }
 const h=await fixture();await warm(h);await h.cards.get('set_ev1_energy_deadline').listener({energy:.01,time:'23:00',guarantee:'yes'});await pass(h);
 for(let n=0;n<8;n++){h.setNow(h.now()+1000);await input(h,'numbered',0,true,16);await h.flush();}
 assert.equal(h.app.getEvSessionDetectionRuntime(0).endedReason,'energy_target');assert.equal(h.app.lastPublishedEvAllowed,false);
 results.push({scenario:'constant-current-completes-kWh',stopPublished:true});
}
async function splitCase() {
 const h=await setup(root,{evCount:0,forcedMode:'standby',peakShaveEnabled:false,exportLimitEnabled:false,
  commandIntervalSeconds:17,splitCommandBattery1Enabled:true,splitCommandBattery1ZeroMode:'charge',
  splitCommandBattery1MinimumPowerW:100,splitCommandBattery1KeepMinimumPower:true,
  splitCommandBattery1SafetyModeResendEnabled:true,splitCommandBattery1SafetyModeResendSeconds:7},start,0);
 h.store.set('_chargeTestSignature',h.app.getChargeTestSignature(h.app.getSettings()));
 await h.setExternalSetting('controlEnabled',true);
 let modeResends=0,powerWrites=0;
 for(const [id,c] of h.cards)if(/^split_command_battery1_/.test(id))c.trigger=async()=>{if(id.endsWith('charge_power'))powerWrites++;if(id.endsWith('charge_mode'))modeResends++};
 await h.start();
 for(let n=1;n<=180;n++){h.setNow(start+n*1000);await h.grid(623-h.app.state.lastTotalCommandW);await h.flush();}
 const r={scenario:'split-minimum',updates:180,batteryPublishes:h.traces.length,powerWrites,modeResends,finalW:h.app.state.lastTotalCommandW};results.push(r);
 assert.equal(r.finalW,-100);assert(r.batteryPublishes<=2,JSON.stringify(r));assert(powerWrites<=2,JSON.stringify(r));
 assert(modeResends>=20,'independent periodic mode safety resends must continue');assert.deepEqual(h.errors,[]);
}
async function p1Case() {
 const h=await fixture('hybrid');await warm(h);const a=h.app;let evCalculations=0;
 const original=a.calculateEvPortfolioDecisions.bind(a);a.calculateEvPortfolioDecisions=(...args)=>{evCalculations++;return original(...args)};
 for(let n=1;n<=120;n++){h.setNow(start+(75+n)*1000);if(n%10===0)await input(h,'numbered',0,true,16);await h.grid(623+16*perAmpW-a.state.lastTotalCommandW);await h.flush();if(n%60===0){a.runContextHeartbeat();await a.runEvHeartbeat();await h.drain();await h.flush();}}
 results.push({scenario:'P1-with-10s-EV',p1Updates:120,evCalculations});assert(evCalculations<20,'P1 must not run complete EV portfolio per sample');
}
async function run(){const real=Date.now,restore=installVirtualClearTimeout();try{
 if(process.env.EV_WORK_ONLY==='split')await splitCase();else{await duplicateCases();await transitionCases();await splitCase();await p1Case();}
 console.log(`1.1.12 EV input work: ${results.length} scenarios passed.`);
 }finally{Date.now=real;restore();if(process.env.EV_WORK_JSON)fs.writeFileSync(process.env.EV_WORK_JSON,JSON.stringify(results,null,2));}}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
module.exports={run};
