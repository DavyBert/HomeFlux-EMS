'use strict';
const assert = require('node:assert/strict');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const realNow = Date.now, restore = installVirtualClearTimeout();
async function make(overrides = {}, pv = 623) {
 const h = await setup(undefined, {gridControlWindowSeconds: 3,
   forcedMode: 'self_consumption', adaptiveLiveControlEnabled: false,
   exportLimitEnabled: false, ...overrides}, undefined, pv);
 await h.start(); h.setNow(h.now()+7000); return h;
}
(async () => {
 // PV changes/expiry cannot request a full calculation just to update a label.
 for (const route of ['flow','api']) {
  const h = await make(), a=h.app;
  await h.pv(623);
  const before = a.diagnostics.counters.fastEvaluations || 0;
  for (const value of [1000,1500,1500,1500,2000]) {
   h.setNow(h.now()+1000);
   if(route==='flow') await h.pv(value); else { a.setInput({pvPowerW:value}); await h.drain(); }
  }
  assert.equal(a.diagnostics.counters.fastEvaluations||0,before);
  h.setNow(a.pvLiveObservation.expiresAt); a.inputUpdatedAt.grid=h.now();
  a.requestEvaluate(); await h.drain();
  assert.equal(a.diagnostics.counters.fastEvaluations||0,before);
  assert.equal(a.getEvaluationState().controlGridSource,'average_3_inputs');
  assert.equal(a.diagnostics.counters.fastReasonPvLive,undefined);
  assert.deepEqual(h.errors,[]);
 }
 // Averaged P1 is in band, live P1 is export: choose live BEFORE the skip gate.
 {
  const h=await make(), a=h.app; await h.pv(623);
  a.gridInputHistory=[{at:h.now()-2,value:450},{at:h.now()-1,value:450}];
  await h.grid(-900); assert.equal(a.getEvaluationState().controlGridPowerW,0);
  const before=a.diagnostics.counters.fastEvaluations||0;
  await h.pv(1000); await h.flush();
  assert.equal(a.diagnostics.counters.fastEvaluations,before+1);
  assert.equal(a.latestResult.controlGridSource,'live_pv_delta');
  assert.equal(a.latestResult.controlGridPowerW,-900);
  assert(h.traces.at(-1).total<0);
  const expires=a.pvLiveObservation.expiresAt;
  h.setNow(expires); a.inputUpdatedAt.grid=h.now(); a.requestEvaluate(); await h.flush();
  assert.equal(a.getEvaluationState().controlGridPowerW,0);
  assert.equal(a.getEvaluationState().controlGridSource,'average_3_inputs');
  // Independent adaptive live selection outlives PV expiry.
  a.setSetting('adaptiveLiveControlEnabled',true); a.adaptiveLiveUntil=h.now()+10000;
  assert.equal(a.getEvaluationState().controlGridPowerW,-900);
  assert.equal(a.getEvaluationState().controlGridSource,'live_adaptive_setpoint');
  h.setNow(h.now()+10000);
  assert.equal(a.getEvaluationState().controlGridPowerW,0);
  assert.deepEqual(h.errors,[]);
 }
 // Raw P1 stays visible to Peak Guard even while the configured average is zero.
 {
  const h=await make(), a=h.app;
  a.gridInputHistory=[{at:h.now()-2,value:-1600},{at:h.now()-1,value:-1600}];
  await h.grid(3200); await h.flush();
  assert.equal(a.latestResult.override,'peak_shave');
  assert.equal(a.latestResult.liveGridPowerW,3200);
  assert.deepEqual(h.errors,[]);
 }
 // Exact existing cooldown and coalescing; latest source at the boundary wins.
 {
  const h=await make({gridControlWindowSeconds:0}), a=h.app;
  await h.grid(-600); await h.flush(); const first=h.traces.at(-1).at;
  for(let i=1;i<=6;i++){h.setNow(first+i*1000);await h.grid(-900);}
  assert.equal(h.traces.at(-1).at,first);
  h.setNow(first+7000); await h.flush();
  assert.equal(h.traces.at(-1).at,first+7000);
  assert.deepEqual(h.errors,[]);
 }
 // Real SoC safety and a pending asynchronous publication retain their gates.
 for (const [soc,grid] of [[100,-1000],[0,1000]]) {
  const h=await make({gridControlWindowSeconds:0}), a=h.app;
  a.setInput({batterySoc:Array(4).fill(soc),gridPowerW:grid});
  a.requestEvaluate(true); await h.drain(); await h.flush();
  const commands=a.latestResult.candidateCommands;
  assert(commands.every(w=>soc===100?w>=0:w<=0));
  assert.deepEqual(h.errors,[]);
 }
 {
  const h=await make({gridControlWindowSeconds:0}),a=h.app;
  const original=a.commandTrigger.trigger; let release;
  a.commandTrigger.trigger=async tokens=>{await original(tokens);await new Promise(r=>{release=r;});};
  await h.grid(-600); assert(a.commandPublishing); assert(release);
  const sent=h.traces.length;
  h.setNow(h.now()+7000); await h.grid(-900);
  assert.equal(h.traces.length,sent); assert(a.pendingResult);
  a.commandTrigger.trigger=original; release(); await h.drain(); await h.flush();
  assert(!a.commandPublishing); assert(h.traces.length>=sent);
  assert.deepEqual(h.errors,[]);
 }
 console.log('1.1.1 PV source: production startup/settings/cache, Flow/API, no PV-only evaluations, live vs average, expiry, adaptive live, raw peak protection and 7-second coalescing passed.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Date.now=realNow;restore();});
