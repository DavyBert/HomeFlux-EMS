'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const { boot, DEFAULTS } = require('./startup-harness');
const { fixture } = require('./ev-work-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const { localDateTimeUtcMs } = require('../lib/homey-energy');
const NativeDate = Date, restore = installVirtualClearTimeout();
let clock = localDateTimeUtcMs('2026-10-24','18:20','Europe/Brussels');
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } static now() { return clock; } };
const select = i => ({ id: String(i+1), kind: 'ev', name: 'EV '+(i+1) });
const result = [];
async function check(name, run) { const data=await run();result.push({name,...data});console.log('PASS',name); }
async function fresh(evs=4, extra={}) {
  const settings={...DEFAULTS,settingsSchemaVersion:70,evCount:evs,batteryCount:0,controlEnabled:false,contractType:'fixed',...extra};
  for(let i=0;i<4;i++) Object.assign(settings,{[i?'ev'+(i+1)+'Enabled':'evEnabled']:true,
    [i?'ev'+(i+1)+'SocEnabled':'evSocEnabled']:true,[i?'ev'+(i+1)+'TargetTime':'evTargetTime']:'07:00'});
  return boot(new Map(Object.entries(settings)));
}
async function goal(h,i,type,value,time='06:30') {
 return h.cards.get(`set_ev_${type}_deadline_for_configured`).listener({ev:select(i),
   ...(type==='soc'?{target_soc:value}:{energy:value}),time,guarantee:'yes'});
}
async function connected(h,i,value=true,amps=0) {
 return h.cards.get('set_ev_status_for_configured').listener({ev:select(i),connected:value?'yes':'no',charge_current:amps});
}
async function main(){try{
 await check('Four EVs: SoC and kWh goals, time and guarantee survive repeated fresh app boots',async()=>{
  for(const type of ['soc','energy']){
   let h=await fresh();
   for(let i=0;i<4;i++)assert(await goal(h,i,type,type==='soc'?75+i:10+i,`06:${String(20+i*5).padStart(2,'0')}`));
   const saved=JSON.parse(JSON.stringify(Object.fromEntries(h.store)));
   for(let reboot=0;reboot<3;reboot++){
    h=await boot(new Map(h.store));
    for(let i=0;i<4;i++){
     const p=(type==='soc'?h.app.evSocPlans:h.app.evEnergyPlans)[i];
     assert(p.active);assert.equal(p.targetTime,`06:${String(20+i*5).padStart(2,'0')}`);assert(p.guarantee);
     const s=h.app.getEvInstanceSettings(i);assert.equal(s.evPlanningSource,type==='soc'?'flow_soc':'flow_energy');
     assert.equal(s.evTargetTime,p.targetTime);assert(s[type==='soc'?'evSocDeadlineAt':'evEnergyDeadlineAt']>Date.now());
    }
    assert.deepEqual(h.errors,[]);
   }
   assert.equal(saved[type==='soc'?'evSocDeadlineOverrides':'evEnergyDeadlineOverrides'].filter(p=>p.active).length,4);
  }
  return{types:2,slots:4,freshBootsPerType:3};
 });
 await check('Completion, disconnect, settings changes and hidden EV slots do not delete Flow targets',async()=>{
  const h=await fresh();
  await goal(h,0,'soc',80);await goal(h,1,'energy',12);
  await connected(h,0);await connected(h,1);
  h.app.markEvSessionEnded(0,'soc_target');h.app.markEvSessionEnded(1,'energy_target');
  await connected(h,0,false);await connected(h,1,false);
  for(const [key,value] of [['evTargetTime','08:00'],['evSocEnabled',false],['evCount',0]])await h.setExternalSetting(key,value);
  const r=await boot(new Map(h.store));assert(r.app.evSocPlans[0].active);assert(r.app.evEnergyPlans[1].active);
  await r.setExternalSetting('evCount',4);await r.setExternalSetting('evSocEnabled',true);
  assert.equal(r.app.getEvInstanceSettings(0).evTargetTime,'06:30');
  assert.equal(r.app.getEvInstanceSettings(1).evTargetTime,'06:30');
  assert.deepEqual(h.errors,[]);assert.deepEqual(r.errors,[]);return{preserved:true};
 });
 await check('Graceful restart checkpoints latest kWh progress rather than an older five-minute value',async()=>{
  const h=await fresh(1);await connected(h,0);await goal(h,0,'energy',15);
  let previousVersionSavedKwh=null;
  if(process.env.HEMS_BASELINE_ROOT){
   const req=createRequire(path.join(path.resolve(process.env.HEMS_BASELINE_ROOT),'package.json'));
   const old=await req('./test/startup-harness').boot(new Map(h.store));await connected(old,0);
   old.app.evEnergyPlans[0].remainingKwh=12;await old.app.onUninit();
   previousVersionSavedKwh=old.store.get('evEnergyDeadlineOverrides')[0].remainingKwh;
   assert.equal(previousVersionSavedKwh,15);
  }
  h.app.evEnergyPlans[0].remainingKwh=12;
  assert.equal(h.store.get('evEnergyDeadlineOverrides')[0].remainingKwh,15);
  await h.app.onUninit();
  const r=await boot(new Map(h.store));await connected(r,0);
  assert(r.app.evEnergyPlans[0].active);assert.equal(r.app.evEnergyPlans[0].remainingKwh,12);
  assert.equal(r.app.evEnergyPlans[0].targetTime,'06:30');return{savedRemainingKwh:12,previousVersionSavedKwh};
 });
 await check('Completed kWh plan does not refill merely because the app restarts while cable stays connected',async()=>{
  const h=await fresh(1);await connected(h,0);await goal(h,0,'energy',15);
  let previousVersionRestartKwh=null;
  if(process.env.HEMS_BASELINE_ROOT){
   const req=createRequire(path.join(path.resolve(process.env.HEMS_BASELINE_ROOT),'package.json'));
   const oldBoot=req('./test/startup-harness').boot;
   let old=await oldBoot(new Map(h.store));await connected(old,0);
   old.app.evEnergyPlans[0].remainingKwh=0;old.app.persistEvEnergyPlanOverrides(true);
   old.app.markEvSessionEnded(0,'energy_target');old=await oldBoot(new Map(old.store));await connected(old,0);
   previousVersionRestartKwh=old.app.evEnergyPlans[0].remainingKwh;assert.equal(previousVersionRestartKwh,15);
  }
  h.app.evEnergyPlans[0].remainingKwh=0;h.app.persistEvEnergyPlanOverrides(true);
  h.app.markEvSessionEnded(0,'energy_target');
  let r=await boot(new Map(h.store));await connected(r,0);
  assert(r.app.evEnergyPlans[0].active);assert.equal(r.app.evEnergyPlans[0].remainingKwh,0);
  assert.equal(r.app.getEvInstanceSettings(0).evPlanningSource,'flow_energy');
  await connected(r,0,false);await connected(r,0,true);
  assert.equal(r.app.evEnergyPlans[0].remainingKwh,15,'a real new cable session still rearms the persistent goal');
  return{restartRemainingKwh:0,newConnectionKwh:15,previousVersionRestartKwh};
 });
 await check('Reached SoC goal is retained through restart and requires fresh SoC feedback for decisions',async()=>{
  const h=await fresh(1);await connected(h,0);await goal(h,0,'soc',80);
  await h.cards.get('set_ev_soc_for_configured').listener({ev:select(0),soc:80});
  h.app.markEvSessionEnded(0,'soc_target');
  const r=await boot(new Map(h.store));assert(r.app.evSocPlans[0].active);
  assert(!r.app.getEvSocFreshness(0).fresh);await connected(r,0);
  await r.cards.get('set_ev_soc_for_configured').listener({ev:select(0),soc:80});
  assert(r.app.getEvSocFreshness(0).fresh);assert.equal(r.app.getEvInstanceSettings(0).evTargetSoc,80);
  return{targetSoc:80,freshInputRequired:true};
 });
 await check('Completed kWh data from older versions stays completed until an observed new connection',async()=>{
  const h=await fresh(1,{evEnergyDeadlineOverrides:[{active:true,targetKwh:15,remainingKwh:0,targetTime:'06:30',
    deadlineAt:Date.now()+3600000,guarantee:true,sessionStarted:false}]});
  await connected(h,0);assert.equal(h.app.evEnergyPlans[0].remainingKwh,0);
  await connected(h,0,false);await connected(h,0,true);assert.equal(h.app.evEnergyPlans[0].remainingKwh,15);
  return{legacyCompletionPreserved:true};
 });
 await check('Only explicit clear deletes a plan; zero kWh remains a completed Flow goal after restart',async()=>{
  const h=await fresh(1);await connected(h,0);await goal(h,0,'energy',0);
  let r=await boot(new Map(h.store));await connected(r,0);
  assert(r.app.evEnergyPlans[0].active);assert.equal(r.app.evEnergyPlans[0].remainingKwh,0);
  const before=structuredClone(r.app.evEnergyPlans[0]);
  for(const value of [null,undefined,'',false,NaN,-1,251])assert.equal(r.app.setEvEnergyPlan(0,value,'06:30'),false);
  assert.deepEqual(r.app.evEnergyPlans[0],before,'invalid input cannot clear a saved target');
  await r.cards.get('clear_ev_soc_deadline_override_for_configured').listener({ev:select(0)});
  const cleared=await boot(new Map(r.store));assert(!cleared.app.evEnergyPlans[0].active);assert(!cleared.app.evSocPlans[0].active);
  return{zeroGoalPreserved:true,explicitClearPersists:true};
 });
 await check('Newest Flow goal replaces the previous kind and remains the only active source after restart',async()=>{
  const h=await fresh(1);await goal(h,0,'energy',12);await goal(h,0,'soc',85);
  let r=await boot(new Map(h.store));assert(r.app.evSocPlans[0].active);assert(!r.app.evEnergyPlans[0].active);
  await goal(r,0,'energy',9);r=await boot(new Map(r.store));assert(r.app.evEnergyPlans[0].active);assert(!r.app.evSocPlans[0].active);
  assert.equal(r.app.getEvInstanceSettings(0).evPlanningSource,'flow_energy');return{oneActiveSource:true};
 });
 await check('Rolling deadlines across midnight/DST and repeated feedback do not remove the saved goal',async()=>{
  const h=await fresh(1);await goal(h,0,'soc',80);
  const saved=h.store.get('evSocDeadlineOverrides');
  clock=localDateTimeUtcMs('2026-10-25','07:10','Europe/Brussels');
  const r=await boot(new Map(h.store));const s=r.app.getEvInstanceSettings(0);
  assert(s.evSocDeadlineAt>Date.now());assert.equal(s.evTargetTime,'06:30');
  for(let i=0;i<100;i++)await goal(r,0,'soc',80);
  assert(r.app.evSocPlans[0].active);assert.deepEqual(r.store.get('evSocDeadlineOverrides'),saved);
  return{deadlineRolled:true,targetRetained:true};
 });
 fs.writeFileSync(path.join(ROOT,'validation/ev-persistence-1.1.20.json'),JSON.stringify(result,null,2)+'\n');
 console.log(`1.1.20 EV persistence: ${result.length} scenario groups passed.`);
}finally{restore();global.Date=NativeDate;}}
main().catch(e=>{console.error(e);process.exitCode=1;});
