'use strict';
const assert=require('node:assert/strict'),{setup,installVirtualClearTimeout}=require('./pv-source-harness');
const P=require('../lib/phase-guard'),D=require('../lib/phase-detection');
const native=Date.now,restore=installVirtualClearTimeout();
async function make(overrides={}){
 const h=await setup(undefined,{batteryCount:4,evCount:0,hvacCount:0,controlEnabled:true,forcedMode:'self_consumption',exportLimitEnabled:false,peakLimitW:10000,phaseGuard:{...P.defaults,phases:3,enabled:false,voltage:230,amps:25,limitW:4500},...overrides},Date.UTC(2026,10,4,12),0),a=h.app;
 a.requestContextEvaluate=(...v)=>{h.resumed=v;};a.requestEvaluate=()=>{};
 const writes=[];a.commandTrigger.trigger=async t=>writes.push(t);h.writes=writes;
 const base=[200,200,200];h.sample=async(arr=base)=>{h.setNow(h.now()+1000);a.inputUpdatedAt.pv=h.now();await h.cards.get('set_grid_power_phases').listener({power:arr.reduce((a,b)=>a+b,0),l1:arr[0],l2:arr[1],l3:arr[2]});await h.drain();};
 await h.sample();return h;
}
(async()=>{let cases=0;
 for(const [type,delta] of [['L1',[400,0,0]],['L2',[0,400,0]],['L3',[0,0,400]],['balanced3',[133,134,133]]]){
  const h=await make(),a=h.app,timers=h.timers.length;
  D.status(a);assert.equal(h.timers.length,timers);await D.start(a,1);
  for(let i=0;i<4;i++)await h.sample();assert.equal(D.status(a).stage,'pulse');
  assert(h.writes.some(t=>t.battery2command===-400&&t.battery1command===0&&t.battery3command===0));
  for(let i=0;i<2;i++)await h.sample(delta.map(x=>x+200));assert.equal(D.status(a).stage,'return');
  for(let i=0;i<2;i++)await h.sample();assert.equal(D.status(a).running,false);assert.equal(a.getSettings().phaseGuard.batteries[1],type);
  assert.equal(h.writes.filter(t=>t.battery2command===-400).length,1);assert(h.resumed);
  assert.equal(a.batteryResponseTest.running,false);assert.equal(h.store.get('_batteryResponseTest').running,false);cases++;
 }
 const h=await make();await D.start(h.app,0);for(let i=0;i<4;i++)await h.sample();for(let i=0;i<2;i++)await h.sample([400,400,200]);
 assert.equal(D.status(h.app).stage,'pulse');await D.stop(h.app);assert.equal(h.app.getSettings().phaseGuard.batteries[0],'unknown');assert(h.resumed);cases++;
 const c=await make();await D.start(c.app,0);await c.app.stopBatteryResponseTest();assert.equal(D.status(c.app).running,false);assert(c.resumed);cases++;
 // Existing Split test baseline: 100 -> 500 -> 100, still exactly +400 W.
 const dual=await make({splitCommandBattery2Enabled:true,splitCommandBattery2KeepMinimumPower:true,splitCommandBattery2MinimumPowerW:100});
 dual.app.waitSplitPowerDelay=async()=>{};dual.store.set('_chargeTestSignature',dual.app.getChargeTestSignature());dual.app.setSetting('chargeTestPassed',true);dual.app.setSetting('controlEnabled',true);
 await D.start(dual.app,1);for(let i=0;i<4;i++)await dual.sample();
 assert.equal(dual.app.batteryPhaseDetection.low[1],-100);assert.equal(dual.app.batteryPhaseDetection.commands[1],-500);
 for(let i=0;i<2;i++)await dual.sample([200,600,200]);for(let i=0;i<2;i++)await dual.sample();
 assert.equal(D.status(dual.app).running,false);assert.equal(dual.app.getSettings().phaseGuard.batteries[1],'L2');cases++;
 const changed=await make();await D.start(changed.app,0);changed.app.setSetting('phaseGuard',{...changed.app.getSettings().phaseGuard,limitW:4400});await changed.sample();assert.equal(D.status(changed.app).running,false);assert(changed.resumed);cases++;
 const stale=await make();await D.start(stale.app,0);stale.app.gridPhases[0].at-=16000;await D.observe(stale.app,stale.now(),stale.app.getSettings());assert.equal(D.status(stale.app).running,false);cases++;
 const unsafe=await make();unsafe.app.lastEmittedCommands=[4000,0,0,0];unsafe.app.gridPhases[0].watts=1000;await assert.rejects(()=>D.start(unsafe.app,0),/Onvoldoende fase/);cases++;
 const interrupted=await make();await D.start(interrupted.app,0);assert.equal(interrupted.store.get('_batteryResponseTest').running,true);
 if(interrupted.app.batteryPhaseDetection.timer)clearTimeout(interrupted.app.batteryPhaseDetection.timer);
 interrupted.app.batteryResponseTest=null;await require('../lib/battery-response-test').restore(interrupted.app);
 assert.equal(interrupted.app.batteryResponseTest.running,false);assert.equal(interrupted.store.get('_batteryResponseTest').running,false);cases++;
 const timeout=await make();await D.start(timeout.app,0);timeout.setNow(timeout.now()+61000);await timeout.flush();assert.equal(D.status(timeout.app).running,false);assert(timeout.resumed);cases++;
 const noisy=await make();await D.start(noisy.app,0);noisy.app.state.pvPowerW=200;await noisy.sample();assert.equal(D.status(noisy.app).running,false);cases++;
 const boundary=await make();await D.start(boundary.app,0);for(let i=0;i<4;i++)await boundary.sample([4300,200,200]);assert.equal(D.status(boundary.app).running,false);assert.equal(boundary.writes.filter(t=>t.battery1command===-400).length,0);cases++;
 console.log(`Phase detection: ${cases} scenarios passed, one pulse only, independent battery selection, cancellation and EMS resume.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>{Date.now=native;restore();});
