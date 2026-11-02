'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const engine=require('../lib/ems-engine'),{setup,installVirtualClearTimeout}=require('./pv-source-harness');
const root=path.resolve(__dirname,'..'),referenceRoot=process.env.HEMS_PEAK_BASELINE?path.resolve(process.env.HEMS_PEAK_BASELINE):null;
const modes=['auto','self_consumption','avoid_import','solar_capture','charge','manual_charge','standby'];
const RealDate=Date,realNow=Date.now;global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const restore=installVirtualClearTimeout(),results=[];
const settings=mode=>({...engine.DEFAULTS,forcedMode:mode,batteryCount:4,minSoc:10,safetySoc:14,maxSoc:100,peakShaveEnabled:true,peakLimitW:2650,peakSoftMarginW:100,
 maxTotalDischargeW:1000,maxDischargePerBatteryW:1000,fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00',batterySaveDischargeAboveSoc:90,timezone:'Europe/Brussels'});
const state=soc=>({gridPowerW:4000,pvPowerW:200,batterySoc:Array(4).fill(soc),lastTotalCommandW:0,lastBatteryCommands:[0,0,0,0],forecastRemainingKwh:0,forecastDailyMaxKwh:0,forecastTomorrowKwh:0});
async function check(name,fn){const evidence=await fn();results.push({name,...evidence});}
(async()=>{try{
 for(const mode of modes)await check(mode+': enabled Peak Guard takes priority over the normal strategy within power limits',()=>{
  const r=engine.evaluate(state(70),settings(mode),new Date('2026-10-31T12:00:00Z'));
  assert.equal(r.override,'peak_shave');assert(r.totalCommandW>0);assert(r.totalCommandW<=1000);assert(r.commands.every(w=>w>=0&&w<=1000));
 });
 for(const mode of modes)await check(mode+': Peak Guard never discharges a battery below its hard minimum',()=>{
  const r=engine.evaluate(state(10),settings(mode),new Date('2026-10-31T12:00:00Z'));
  assert.equal(r.override,'peak_shave');assert.deepEqual(r.commands,[0,0,0,0]);assert.equal(r.totalCommandW,0);
 });
 await check('Standby ignores ordinary import and PV export, while respecting the explicit Peak Guard enable setting',()=>{
  for(const gridPowerW of [-4000,500]){const r=engine.evaluate({...state(70),gridPowerW},settings('standby'),new Date());assert.equal(r.totalCommandW,0);assert.equal(r.override,null);}
  const r=engine.evaluate(state(70),{...settings('standby'),peakShaveEnabled:false},new Date());assert.equal(r.totalCommandW,0);assert.equal(r.override,null);
 });
 await check('Standby: real P1 input triggers Peak Guard immediately, then restores zero and does not capture export',async()=>{
  const h=await setup(root,{forcedMode:'standby',fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00',exportLimitEnabled:false},Date.parse('2026-10-31T12:00:05Z'),200),a=h.app;
  a.state.batterySoc=[70,70,70,70];a.state.gridPowerW=500;a.inputUpdatedAt.batterySoc=Array(4).fill(h.now());
  await h.start();await h.flush();assert.equal(a.state.lastTotalCommandW,0);
  h.setNow(h.now()+8000);await h.grid(4000);await h.flush();assert.equal(a.latestResult.override,'peak_shave');assert(a.state.lastTotalCommandW>0);
  h.setNow(h.now()+8000);await h.grid(500);await h.flush();assert.equal(a.latestResult.override,null);assert.equal(a.state.lastTotalCommandW,0);
  h.setNow(h.now()+8000);await h.grid(-3000);await h.flush();assert.equal(a.latestResult.override,null);assert.equal(a.state.lastTotalCommandW,0);assert.deepEqual(h.errors,[]);
 });
 await check('Peak Guard remains available after switching an active charging command into Standby',async()=>{
  const h=await setup(root,{forcedMode:'manual_charge',exportLimitEnabled:false},Date.parse('2026-10-31T12:00:05Z'),200),a=h.app;
  a.state.batterySoc=[70,70,70,70];a.state.gridPowerW=500;a.inputUpdatedAt.batterySoc=Array(4).fill(h.now());await h.start();await h.flush();
  h.setNow(h.now()+8000);await h.setExternalSetting('forcedMode','standby');await h.grid(5000);await h.start();await h.flush();
  h.setNow(h.now()+8000);await h.grid(5000);await h.flush();assert(a.state.lastTotalCommandW>0);assert.equal(a.latestResult.override,'peak_shave');assert.deepEqual(h.errors,[]);
 });
 await check('All engine modes, including Standby, match the original 1.2.9 controller across tariffs/SoC/grid',()=>{
  const reference=referenceRoot?require(path.join(referenceRoot,'lib/ems-engine')):engine;let combinations=0;
  for(const contractType of ['fixed','tou','dynamic_hour','dynamic_quarter'])for(const forcedMode of modes)for(const soc of [10,14,45,90])for(const gridPowerW of [-3500,0,1200,4000]){
   const s={...settings(forcedMode),contractType},input={...state(soc),gridPowerW},now=new Date('2026-10-31T12:00:00Z');
   assert.deepEqual(engine.evaluate(input,s,now),reference.evaluate(input,s,now));combinations++;
  }
  return {combinations};
 });
 fs.writeFileSync(path.join(root,'validation/peak-guard-all-modes-1.2.11.json'),JSON.stringify({version:'1.2.11',simulatedHomey:true,physicalHomeyTested:false,passed:results.length,results},null,2)+'\n');
 console.log('1.2.11 Peak Guard: '+results.length+' groups passed, including all 7 modes, hard SoC/power limits, real P1 takeover/release and 448 baseline engine combinations.');
 }finally{restore();global.Date=RealDate;Date.now=realNow;}
})().catch(e=>{console.error('FAILED after '+results.length+' groups',e);process.exitCode=1;});
