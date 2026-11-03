'use strict';
const assert=require('node:assert/strict');const nativeNow=Date.now;
const {setup,cycle,clock}=require('./hvac-coordination-1.2.15.test');const H=require('../lib/hvac-permanent');
async function main(){
 const h=await setup(10),a=h.app,timers=h.timers.length;
 for(let i=0;i<10;i++){
  const key=s=>a.getHvacSettingKey(i,s);
  await h.cards.get('set_hvac_automatic_control_for_configured').listener({hvac:{kind:'hvac',id:String(i+1)},enabled:'no'});
  assert.equal(a.getSettings()[key('PermanentEnabled')],false);assert.equal(a.getSettings()[key('AutomaticControlEnabled')],true);assert.equal(a.getSettings()[key('Enabled')],true);
  assert.equal(h.events.at(-1).kind,'power');assert.equal(h.events.at(-1).state_value,0);
  for(let j=i+1;j<10;j++)assert.equal(a.getSettings()[a.getHvacSettingKey(j,'PermanentEnabled')],true);
 }
 assert.equal(h.events.length,10);await cycle(h);assert.equal(h.events.length,10);
 await a.setHvacAutomaticControlFor(0,{enabled:'yes'});assert(a.getSettings().hvacPermanentEnabled);assert(a.getSettings().hvacAutomaticControlEnabled);
 a.setSetting('hvacAutomaticControlEnabled',false);await a.setHvacAutomaticControlFor(0,{enabled:'yes'});assert.equal(a.getSettings().hvacAutomaticControlEnabled,false);
 assert.equal(h.timers.length,timers);
 const pv=await setup(1,{hvacUsePvSurplus:true}),b=pv.app;
 b.setSetting('hvacAutomaticOffAction','standby');await b.setHvacAutomaticControlFor(0,{enabled:'no',standby_temperature:17});assert.equal(pv.events.at(-1).setpoint,17);assert.equal(b.getSettings().hvacPermanentEnabled,false);assert(b.getSettings().hvacAutomaticControlEnabled);
 Object.assign(b.state,{hvacRoomTemperatureC:12,hvacSetpointC:17,hvacMode:'off'});await cycle(pv);assert.equal(pv.events.length,1);
 clock.set(clock.now()+360000);b.state.gridPowerW=-4000;b.state.pvPowerW=5000;b.inputUpdatedAt.grid=clock.now();b.inputUpdatedAt.pv=clock.now();await cycle(pv);
 assert(pv.events.some(e=>e.kind==='power'&&e.state_value===1),'PV restarts');assert.equal(b.latestHvacDecision.energySource,'pv');assert(!b.latestHvacDecision.permanent);
 const stale=await setup(1),c=stale.app;c.setSetting('hvacPermanentEnabled',false);const decision=c.calculateHvacControlFor(0,c.latestResult,null,0,0,{permanentOffFromFlow:true});decision.forceAutomaticOff=true;c.setSetting('hvacPermanentEnabled',true);await c.publishHvacDecisionFor(0,decision);assert.equal(stale.events.length,0);
 const periodic=await setup(1),d=periodic.app;H.unit(d,0).periodic={applied:true,restoreTarget:21};await d.setHvacAutomaticControlFor(0,{enabled:'no'});assert.equal(H.needsPeriodicRestore(d,0),false);
 const denied=await setup(1,{hvacAllowPowerControl:false}),e=denied.app;H.unit(e,0).periodic={applied:true,restoreTarget:21};await e.setHvacAutomaticControlFor(0,{enabled:'no'});await cycle(denied);assert.equal(denied.events.length,0);assert.equal(H.needsPeriodicRestore(e,0),false);
 const restarted=await require('./startup-harness').boot(new Map(pv.store));assert.equal(restarted.app.getSettings().hvacPermanentEnabled,false);assert(restarted.app.getSettings().hvacAutomaticControlEnabled);
 console.log('1.2.22: ten independent slots, master permission preserved, immediate OFF/standby, ON, no retries/timers, PV restart, stale queue, periodic ownership and persistence passed.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>Date.now=nativeNow);
