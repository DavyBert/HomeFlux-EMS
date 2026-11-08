'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {boot,DEFAULTS}=require('./startup-harness');
const NativeNow=Date.now;let now=Date.UTC(2026,10,8,6);Date.now=()=>now;
const KEY='_evSessionContinuity',passed=[],check=async(name,fn)=>{await fn();passed.push(name);};
async function setup(store){
 const config={...DEFAULTS,settingsSchemaVersion:71,batteryCount:0,controlEnabled:false,evCount:4,evEnabled:true,ev2Enabled:true,ev3Enabled:true,ev4Enabled:true,evMode:'standard',ev2Mode:'standard',ev3Mode:'standard',ev4Mode:'standard',peakShaveEnabled:false};
 const h=await boot(store||new Map(Object.entries(config)));assert.deepEqual(h.errors,[]);for(let n=0;n<250;n++)await Promise.resolve();
 h.app.requestEvaluate=()=>{};h.app.requestContextEvaluate=()=>{};h.app.syncEmsDevices=async()=>{};
 return h;
}
async function main(){
 await check('New/older installations keep unknown connection inputs and need no migration or initial write',async()=>{
  const h=await setup();assert.equal(h.store.has(KEY),false);for(let i=0;i<4;i++){assert.equal(h.app.getEvInputSnapshot(i).seen.connected,false);assert.equal(h.app.getEvSessionDetectionRuntime(i).endedLatched,false);}
 });
 await check('All four last-known connection states survive restart without restoring fake current/SoC telemetry',async()=>{
  const h=await setup();for(let i=0;i<4;i++){now+=1000;h.app.updateEvStatusInput(i,i%2===0,6,now);}
  const saved=structuredClone(h.store.get(KEY));now+=60000;const r=await setup(new Map(h.store));
  for(let i=0;i<4;i++){
   const input=r.app.getEvInputSnapshot(i);assert.equal(input.connected,i%2===0);assert.equal(input.seen.connected,true);assert.equal(input.updatedAt.connected,saved.entries[i].at);assert.equal(input.seen.chargeCurrent,false);assert.equal(input.seen.soc,false);assert.equal(r.app.getEvMeasuredCurrent(i,input,now).fresh,false);
  }
 });
 await check('Flow-ended sessions remain blocked for all four EVs after one or repeated restarts',async()=>{
  const h=await setup();for(let i=0;i<4;i++){now+=1000;h.app.updateEvStatusInput(i,true,6,now);assert(await h.cards.get(`end_ev${i+1}_charging_session`).listener({}));}
  for(let reboot=0;reboot<2;reboot++){
   now+=10000;const r=await setup(new Map(h.store));
   for(let i=0;i<4;i++){
    const session=r.app.getEvSessionDetectionRuntime(i);assert(session.endedLatched);assert.equal(session.endedReason,'flow');assert.equal(r.app.getEvInputSnapshot(i).connected,true);
    const result=r.app.applyEvSessionEndLatch(i,{allowed:true,desiredCurrentA:16,desiredPowerW:3680,requestedChargeMode:'standard'});
    assert.equal(result.allowed,false);assert.equal(result.desiredCurrentA,0);assert.equal(result.requestedChargeMode,'stop');assert.equal(result.sessionEnded,true);
   }
  }
 });
 await check('The first same-connection report and repeated current/heartbeat updates cannot rearm a Flow-ended session or rewrite its checkpoint',async()=>{
  const h=await setup();h.app.updateEvStatusInput(0,true,6,now);h.app.markEvSessionEnded(0,'flow',now);now+=10000;const r=await setup(new Map(h.store));let writes=0;
  const set=r.app.homey.settings.set;r.app.homey.settings.set=(key,value)=>{if(key===KEY)writes++;return set(key,value);};
  const before=structuredClone(r.store.get(KEY));
  for(let n=0;n<50;n++){now+=1000;r.app.updateEvStatusInput(0,true,n%2?0:6,now);assert(r.app.getEvSessionDetectionRuntime(0).endedLatched);}
  assert.equal(writes,0);assert.deepEqual(r.store.get(KEY),before);
 });
 await check('A real disconnect clears and persists the block; a later reconnection starts a normal new session',async()=>{
  const h=await setup();h.app.updateEvStatusInput(0,true,6,now);h.app.markEvSessionEnded(0,'flow',now);now+=1000;const r=await setup(new Map(h.store));
  r.app.updateEvStatusInput(0,false,0,now);assert.equal(r.app.getEvSessionDetectionRuntime(0).endedLatched,false);assert.equal(r.store.get(KEY).entries[0].flowEndedAt,0);assert.equal(r.store.get(KEY).entries[0].connected,false);
  const off=await setup(new Map(r.store));assert.equal(off.app.getEvInputSnapshot(0).connected,false);assert.equal(off.app.getEvInputSnapshot(0).seen.connected,true);assert.equal(off.app.getEvSessionDetectionRuntime(0).endedLatched,false);
  now+=1000;off.app.updateEvStatusInput(0,true,0,now);assert.equal(off.app.getEvSessionDetectionRuntime(0).endedLatched,false);assert.equal(off.app.getEvSessionDetectionRuntime(0).state,'waiting');
  const next=await setup(new Map(off.store));assert.equal(next.app.getEvInputSnapshot(0).connected,true);assert.equal(next.app.getEvSessionDetectionRuntime(0).endedLatched,false);
 });
 await check('Disconnecting EV 2 cannot clear the saved Flow blocks of the other three EVs',async()=>{
  const h=await setup();for(let i=0;i<4;i++){h.app.updateEvStatusInput(i,true,0,now);h.app.markEvSessionEnded(i,'flow',now);}
  h.app.updateEvStatusInput(1,false,0,now);const r=await setup(new Map(h.store));
  for(let i=0;i<4;i++)assert.equal(r.app.getEvSessionDetectionRuntime(i).endedLatched,i!==1);
 });
 await check('Restoring a known connected session does not refill an existing energy goal on the first connected=true feedback',async()=>{
  const h=await setup();h.app.updateEvStatusInput(0,true,6,now);await h.cards.get('set_ev1_energy_deadline').listener({energy:10,time:'07:00',guarantee:'yes'});
  h.app.evEnergyPlans[0].remainingKwh=3;h.app.evEnergyPlans[0].sessionStarted=true;h.app.persistEvEnergyPlanOverrides(true,now);
  now+=60000;const r=await setup(new Map(h.store));assert.equal(r.app.evEnergyPlans[0].remainingKwh,3);r.app.updateEvStatusInput(0,true,0,now);assert.equal(r.app.evEnergyPlans[0].remainingKwh,3);
 });
 await check('Continuity checkpoint events do not invalidate settings or queue a new EMS evaluation',async()=>{
  const h=await setup();h.app.updateEvStatusInput(0,true,0,now);let contexts=0,fast=0;h.app.requestContextEvaluate=()=>contexts++;h.app.requestEvaluate=()=>fast++;const cache=h.app.settingsCache;
  await h.setExternalSetting(KEY,h.store.get(KEY));assert.equal(h.app.settingsCache,cache);assert.equal(contexts,0);assert.equal(fast,0);
 });
 await check('Malformed checkpoints are ignored and a clock rollback cannot erase a valid Flow stop intent',async()=>{
  const h=await setup();h.store.set(KEY,{version:99,entries:[]});const ignored=await setup(new Map(h.store));assert.equal(ignored.app.getEvInputSnapshot(0).seen.connected,false);
  h.store.set(KEY,{version:1,entries:[{connected:true,at:now+600000,flowEndedAt:now+600000},{connected:'yes',at:now,flowEndedAt:now}]});const future=await setup(new Map(h.store));assert(future.app.getEvSessionDetectionRuntime(0).endedLatched);assert.equal(future.app.getEvInputSnapshot(0).updatedAt.connected,0);assert.equal(future.app.getEvInputSnapshot(1).seen.connected,false);
 });
 fs.writeFileSync('validation/ev-session-continuity-1.2.39.json',JSON.stringify({passed:passed.length,cases:passed,maximumSavedEvRecords:4,periodicWrites:0,currentAndSocTelemetryRestored:false},null,2)+'\n');console.log(`EV continuity: ${passed.length} scenario groups passed for connection, Flow-stop, restart and reconnect.`);
}
main().catch(e=>{console.error('After:',passed.at(-1));console.error(e.stack);process.exitCode=1;}).finally(()=>Date.now=NativeNow);
