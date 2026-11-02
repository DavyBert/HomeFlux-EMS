'use strict';
// Development regression coverage only: never invoked by the Homey app.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const {boot}=require('./startup-harness');
const test=require('../lib/battery-response-test');
const NativeDate=Date,originalNow=Date.now;
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const restore=installVirtualClearTimeout();
async function fixture(extra={}){
 const h=await setup(undefined,{forcedMode:'self_consumption',exportLimitEnabled:false,...extra},Date.parse('2026-11-02T12:00:00Z'),0),a=h.app;
 a.diagnostics.options={cpu:false,planning:false,memory:false,errors:false};
 await h.start();await h.flush();
 const writes=[];a.commandTrigger.trigger=async(tokens,state)=>{writes.push({at:h.now(),tokens:structuredClone(tokens),state:structuredClone(state)});};
 h.responseWrites=writes;
 h.sample=async(grid=600,delta=1000)=>{h.setNow(h.now()+delta);a.inputUpdatedAt.pv=h.now();await h.grid(grid);await h.flush();};
 return h;
}
async function complete(h,rise=4,fall=4){
 for(let cycle=0;cycle<5;cycle++){
  let attempts=0;while(h.app.batteryResponseTest.stage==='baseline'&&attempts++<8)await h.sample();
  assert.equal(h.app.batteryResponseTest.stage,'rising');
  for(let i=1;i<=rise;i++)await h.sample(i===rise?1000:600);
  assert.equal(h.app.batteryResponseTest.stage,'falling');
  for(let i=1;i<=fall;i++)await h.sample(i===fall?600:1000);
 }
}
async function main(){
 assert.deepEqual(test.guidance({responseMs:4000,cadenceMs:1000},{gridControlWindowSeconds:3,commandIntervalSeconds:6}),{responseSeconds:4,cadenceSeconds:1,samples:3,recommendedSeconds:7,recommendedUpperSeconds:8,warning:true});
 assert.equal(test.guidance({responseMs:4000,cadenceMs:1000},{gridControlWindowSeconds:3,commandIntervalSeconds:7}).warning,false);
 assert.equal(test.guidance({responseMs:5000,cadenceMs:1000},{gridControlWindowSeconds:0,commandIntervalSeconds:6}).recommendedSeconds,6);
 assert.equal(test.guidance({responseMs:4000,cadenceMs:2000},{gridControlWindowSeconds:3,commandIntervalSeconds:9}).recommendedSeconds,10);
 const h=await fixture(),a=h.app,passed=a.getSettings().chargeTestPassed,signature=h.store.get('_chargeTestSignature'),interval=a.getSettings().commandIntervalSeconds;
 const timersBefore=h.timers.length;test.status(a);test.status(a);assert.equal(h.timers.length,timersBefore,'viewing status must never start a timer or test');
 await a.startBatteryResponseTest();
 const permission=a.getAutoTunePermissions,noiseSamples=a.autoTuneRuntime.grid.samples;
 a.getAutoTunePermissions=()=>({commandIntervalSeconds:true});assert.equal(a.isAutoTuneEvaluationDue(h.now()),false,'the manual response tool must not trigger automatic tuning');a.getAutoTunePermissions=permission;
 await complete(h);
 assert.equal(a.autoTuneRuntime.grid.samples,noiseSamples,'manual test pulses must not be learned as normal control noise');
 assert.equal(a.batteryResponseTest.running,false);assert.equal(a.batteryResponseTest.stage,'completed');
 const result=a.batteryResponseTest.lastResult;assert.equal(result.cycles,5);assert.equal(result.responseMs,4000);assert.equal(result.cadenceMs,1000);assert.deepEqual(result.riseMs,Array(5).fill(4000));assert.deepEqual(result.fallMs,Array(5).fill(4000));
 const pulses=h.responseWrites.filter(x=>x.state?.mode==='battery_response_test');
 assert.equal(pulses.filter(x=>Math.abs(x.tokens.total_command)===400).length,5);assert.equal(pulses.length,11,'one initial zero plus five charge/zero pairs');
 assert(pulses.filter(x=>Math.abs(x.tokens.total_command)===400).every(x=>x.tokens.battery1command===-100&&x.tokens.battery4command===-100));
 assert.equal(a.getSettings().commandIntervalSeconds,interval,'advice never applies settings');assert.equal(a.getSettings().chargeTestPassed,passed);assert.equal(h.store.get('_chargeTestSignature'),signature);assert.equal(a.chargeTestRunning,false);
 const saved=structuredClone(h.store.get('_batteryResponseTest'));
 for(let i=0;i<8;i++)await h.sample();assert.equal(h.responseWrites.filter(x=>x.state?.mode==='battery_response_test').length,11,'completed test never repeats');
 assert.deepEqual(a.batteryResponseTest.lastResult,result);assert.deepEqual(h.errors,[]);
 h.setNow(h.now()+86400000);await h.flush();assert.equal(h.responseWrites.filter(x=>x.state?.mode==='battery_response_test').length,11,'a new day must never start another response test');
 const unequal=await fixture();await unequal.app.startBatteryResponseTest();await complete(unequal,2,4);assert.equal(unequal.app.batteryResponseTest.lastResult.responseMs,3000);assert.equal(unequal.app.batteryResponseTest.lastResult.actions,10);assert.equal(unequal.app.batteryResponseTest.running,false);
 // A 300 W drop completes the fall timing, not necessarily full settling.
 const settling=await fixture();await settling.app.startBatteryResponseTest();
 for(let cycle=0;cycle<5;cycle++){
  for(let i=0;i<4;i++)await settling.sample(600);
  assert.equal(settling.app.batteryResponseTest.stage,'rising');
  await settling.sample(1000,2000);await settling.sample(700,3000);
  assert.equal(settling.app.batteryResponseTest.completed,cycle+1);
  if(cycle<4){for(let i=0;i<6;i++)await settling.sample(700);assert.equal(settling.app.batteryResponseTest.running,true);assert.equal(settling.app.batteryResponseTest.stage,'baseline');}
 }
 assert.equal(settling.app.batteryResponseTest.running,false);
 assert.equal(settling.app.batteryResponseTest.lastResult.responseMs,2500);
 assert.equal(settling.app.batteryResponseTest.lastResult.measuredAt,settling.now());
 assert.equal(settling.store.get('_batteryResponseTest').lastResult.measuredAt,settling.now());
 const stuck=await fixture();await stuck.app.startBatteryResponseTest();for(let i=0;i<4;i++)await stuck.sample(600);await stuck.sample(1000);await stuck.sample(700);stuck.setNow(stuck.now()+60001);await stuck.flush();assert.equal(stuck.app.batteryResponseTest.running,false);assert.equal(stuck.app.batteryResponseTest.lastResult,null);
 const fast=await fixture();await fast.app.startBatteryResponseTest();for(let i=0;i<7;i++)await fast.sample(600,500);assert.equal(fast.app.batteryResponseTest.stage,'rising','sub-second P1 updates can establish a stable baseline without polling');await fast.app.stopBatteryResponseTest();
 const shutdown=await fixture();await shutdown.app.startBatteryResponseTest();await shutdown.app.onUninit();assert.equal(shutdown.app.batteryResponseTest.running,false);assert.equal(shutdown.responseWrites.filter(x=>x.state?.mode==='battery_response_test').at(-1).tokens.total_command,0);
 // Restart retains the completed result and schedules no new diagnostic.
 const restarted=await boot(new Map([...h.store]));assert.equal(restarted.app.batteryResponseTest.running,false);assert.deepEqual(restarted.app.batteryResponseTest.lastResult,saved.lastResult);assert.deepEqual(restarted.errors,[]);
 // Cancellation, missing P1, PV changes and Peak Guard end at zero and never
 // replace a prior successful result with incomplete measurements.
 for(const reason of ['cancel','timeout','pv','peak','full','settings']){
  const x=await fixture(),app=x.app;app.batteryResponseTest={running:false,stage:'completed',lastResult:result};await app.startBatteryResponseTest();
  if(reason==='cancel')await app.stopBatteryResponseTest();
  else if(reason==='timeout'){for(let i=0;i<4;i++)await x.sample();assert.equal(app.state.lastTotalCommandW,-400);x.setNow(x.now()+60001);await x.flush();}
  else if(reason==='pv'){app.state.pvPowerW=200;await x.sample();}
  else if(reason==='peak')await x.sample(5000);
  else if(reason==='full'){for(let i=0;i<4;i++)await x.sample();app.state.batterySoc.fill(100);await x.sample();}
  else await x.setExternalSetting('commandIntervalSeconds',9);
  await x.drain();assert.equal(app.batteryResponseTest.running,false,reason);assert.deepEqual(app.batteryResponseTest.lastResult,result,reason);
  assert.equal(x.responseWrites.filter(v=>v.state?.mode==='battery_response_test').at(-1).tokens.total_command,0,reason);
  assert.deepEqual(x.errors,[],reason);
 }
 const tolerance=await fixture();await tolerance.app.startBatteryResponseTest();for(let i=0;i<4;i++)await tolerance.sample();
 await tolerance.sample(959);assert.equal(tolerance.app.batteryResponseTest.stage,'rising');await tolerance.sample(960);assert.equal(tolerance.app.batteryResponseTest.stage,'falling');
 await tolerance.sample(661);assert.equal(tolerance.app.batteryResponseTest.stage,'falling');await tolerance.sample(660);assert.equal(tolerance.app.batteryResponseTest.completed,1);await tolerance.app.stopBatteryResponseTest();
 // No shared ownership with the original battery test, external EMS or EV.
 for(const extra of [{hybridEmsEnabled:true},{maxTotalChargeW:300},{splitCommandBattery1Enabled:true,splitCommandBattery1KeepMinimumPower:true}]){
  const x=await fixture(extra);await assert.rejects(()=>x.app.startBatteryResponseTest());assert(!x.app.batteryResponseTest?.running);
 }
 const busy=await fixture();busy.app.chargeTestRunning=true;await assert.rejects(()=>busy.app.startBatteryResponseTest(),/batterijtest/);busy.app.chargeTestRunning=false;
 const ev=await fixture({evCount:1,evEnabled:true});ev.app.state.evChargeCurrentA=6;await assert.rejects(()=>ev.app.startBatteryResponseTest(),/EV/);
 const disabled=await fixture({controlEnabled:false});await assert.rejects(()=>disabled.app.startBatteryResponseTest(),/EMS/);
 // Batched API inputs are assessed only after EV feedback has also been
 // applied, so a coincidental 400 W EV change cannot finish a pulse.
 const bulk=await fixture({evCount:1,evEnabled:true});await bulk.app.startBatteryResponseTest();for(let i=0;i<4;i++)await bulk.sample();
 bulk.setNow(bulk.now()+4000);bulk.app.setInput({gridPowerW:1000,ev:{connected:true,chargeCurrentA:6}});await bulk.drain();await bulk.flush();assert.equal(bulk.app.batteryResponseTest.running,false);assert.equal(bulk.app.batteryResponseTest.lastResult,null);
 // Inversion and heterogeneous capacities never alter the physical 400 W
 // total or bypass per-battery maximum charging power.
 const inverted=await fixture({invertBatteryCommand:true});inverted.store.set('_chargeTestSignature',inverted.app.getChargeTestSignature());inverted.app.setSetting('chargeTestPassed',true);inverted.app.setSetting('controlEnabled',true);
 await inverted.app.startBatteryResponseTest();for(let i=0;i<4;i++)await inverted.sample();assert.equal(inverted.responseWrites.filter(x=>x.state?.mode==='battery_response_test').at(-1).tokens.total_command,400);await inverted.app.stopBatteryResponseTest();
 const limited=await fixture({individualBatteryPowerLimitsEnabled:true,battery1MaxChargeW:25,battery2MaxChargeW:75,battery3MaxChargeW:100,battery4MaxChargeW:400});await limited.app.startBatteryResponseTest();for(let i=0;i<4;i++)await limited.sample();const v=limited.app.batteryResponseTest.commands;assert.equal(v.reduce((a,b)=>a+b,0),-400);assert(v[0]>=-25&&v[1]>=-75&&v[2]>=-100);await limited.app.stopBatteryResponseTest();
 // The existing Split output surface is used without rewriting any Split
 // configuration or changing the existing direction-test implementation.
 const split=await fixture({splitCommandBattery1Enabled:true,splitCommandBattery1KeepMinimumPower:false,splitCommandBattery1ChargePowerPositive:true});
 split.app.waitSplitPowerDelay=async()=>{};
 split.store.set('_chargeTestSignature',split.app.getChargeTestSignature());split.app.setSetting('chargeTestPassed',true);split.app.setSetting('controlEnabled',true);
 await split.app.startBatteryResponseTest();await complete(split);assert.equal(split.app.batteryResponseTest.lastResult.cycles,5);assert.equal(split.app.getSettings().splitCommandBattery1KeepMinimumPower,false);
 // Failed or interrupted publications still attempt zero on every output;
 // cancellation waits for an in-flight Flow so a late 400 W cannot follow zero.
 const delayed=await fixture();await delayed.app.startBatteryResponseTest();for(let i=0;i<3;i++)await delayed.sample();
 let release;const gate=new Promise(resolve=>release=resolve),raw=delayed.app.commandTrigger.trigger;
 delayed.app.commandTrigger.trigger=async(tokens,state)=>{await raw(tokens,state);if(state?.mode==='battery_response_test'&&Math.abs(tokens.total_command)===400)await gate;};
 const pending=delayed.sample();await delayed.drain();assert.equal(delayed.app.batteryResponseTest.stage,'rising');const stopping=delayed.app.stopBatteryResponseTest();await delayed.drain();assert.equal(delayed.app.batteryResponseTest.running,true);release();await pending;await stopping;assert.equal(delayed.responseWrites.filter(x=>x.state?.mode==='battery_response_test').at(-1).tokens.total_command,0);assert.equal(delayed.app.batteryResponseTest.running,false);
 const failed=await fixture();await failed.app.startBatteryResponseTest();const publish=failed.app.commandTrigger.trigger;
 failed.app.commandTrigger.trigger=async(tokens,state)=>{await publish(tokens,state);if(Math.abs(tokens.total_command)===400)throw new Error('simulated transport failure');};
 for(let i=0;i<4;i++)await failed.sample();assert.equal(failed.app.batteryResponseTest.running,false);assert.equal(failed.app.batteryResponseTest.lastResult,null);assert.equal(failed.responseWrites.filter(x=>x.state?.mode==='battery_response_test').at(-1).tokens.total_command,0);
 const interrupted=await fixture();await interrupted.app.startBatteryResponseTest();const crashStore=new Map([...interrupted.store].map(([k,v])=>[k,structuredClone(v)]));await interrupted.app.stopBatteryResponseTest();
 const recovered=await boot(crashStore);assert.equal(recovered.app.batteryResponseTest.running,false);assert.equal(crashStore.get('_batteryResponseTest').running,false);assert.equal(recovered.app.batteryResponseTest.lastResult,null,'restart only stops an interrupted test; never runs its pulses again');
 // A fresh minimum is retained even if charging completes before the normal
 // context sample. Only a genuinely lower tenth-percent value is persisted.
 const minimum=await fixture(),m=minimum.app;minimum.store.delete('_autoTuneDailyMinimumSoc');m.autoTuneRuntime.dailyMinimumSoc=null;
 m.state.batterySoc.fill(18);m.recordAutoTuneDailyMinimumSoc();m.state.batterySoc.fill(90);m.recordAutoTuneDailyMinimumSoc();m.recordAutoTunePlanningSample(minimum.now(),m.getSettings());assert.equal(m.autoTuneRuntime.planning.currentDay.minObservedSoc,18);assert.equal(minimum.store.get('_autoTuneDailyMinimumSoc').soc,18);
 m.restoreAutoTuneLearning();m.recordAutoTunePlanningSample(minimum.now(),m.getSettings());assert.equal(m.autoTuneRuntime.planning.currentDay.minObservedSoc,18,'restart must not replace the earlier minimum with the recharged SoC');
 minimum.setNow(minimum.now()+86400000);m.recordAutoTuneDailyMinimumSoc();assert.equal(m.autoTuneRuntime.dailyMinimumSoc.soc,90,'local calendar day starts a new minimum');
 // Original test methods, including all direction-test publication behavior,
 // are byte-identical to the latest uploaded baseline.
 const baseline=process.env.HF_RESPONSE_BASELINE;
 if(baseline){
  const old=fs.readFileSync(path.join(baseline,'app.js'),'utf8'),now=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const part=s=>s.slice(s.indexOf('  async publishChargeTestCommands('),s.indexOf('  normalizeForcedMode('));assert.equal(part(now),part(old));
 }
 for(const lang of ['nl','en','fr','es','de']){
  const d=JSON.parse(fs.readFileSync(path.join(__dirname,`../settings/translations/${lang}.json`),'utf8'));
  for(const key of ['start','stop','help','progress','result','warning','limit'])assert(d.strings['batteryResponse.'+key]);
 }
 console.log('1.2.19: five on-demand pulses, raw P1 timing, 0 W cleanup, persistence, restart, cancellation/timeouts/safety, physical limits/inversion, unchanged direction test, daily minimum and interval advice passed.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{restore();global.Date=NativeDate;Date.now=originalNow;});
