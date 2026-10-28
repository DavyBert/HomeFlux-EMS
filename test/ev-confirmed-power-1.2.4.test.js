'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./ev-work-harness');const {installVirtualClearTimeout}=require('./pv-source-harness');
const {evPowerPerAmp}=require('../lib/flexible-loads');
const N=Date,oldNow=Date.now;global.Date=class extends N{constructor(...a){super(...(a.length?a:[Date.now()]));}};
const restore=installVirtualClearTimeout(),results=[];
async function check(name,fn){const detail=await fn();results.push({name,...detail});}
async function setup(type='mode',operating='emergency',evs=1){
 const h=await fixture({type,evs,batteries:0,batteryEnabled:false,chargeAllowed:true,extra:{peakShaveEnabled:true,peakLimitW:17500,peakSoftMarginW:100,evIdleHouseLoadW:4000}}),a=h.app;
 for(let i=0;i<evs;i++){const stem=i?'ev'+(i+1):'ev';for(const suffix of ['ModeStandardCurrentA','MaxCurrentA','StandardCurrentA'])await h.setExternalSetting(stem+suffix,10);a.setEvSessionOverrideFor(i,operating,'flow');}
 a.evSessionDetection.portfolioBaselineW=4000;await h.start();await h.flush();h.setNow(h.now()+8000);await h.flush();return h;
}
async function reading(h,{grid=4000,pv=0,currents=[0],battery=0}={}){
 h.setNow(h.now()+1000);const a=h.app;
 for(let i=0;i<currents.length;i++)if(currents[i]!==null)await h.cards.get(`set_ev${i+1}_status`).listener({connected:'yes',charge_current:currents[i]});
 a.state.lastTotalCommandW=battery;await h.pv(pv);await h.grid(grid);await h.start();await h.flush();
}
(async()=>{try{
 for(const type of ['mode','current','hybrid'])for(const operating of ['emergency','smart','soc_target'])await check(type+'/'+operating+': zero feedback never becomes physical command power after expiry',async()=>{
  const h=await setup(type,operating),a=h.app;a.evSessionDetection.portfolioBaselineW=13000;
  await reading(h,{grid:13000});const start=h.now();
  for(let second=1;second<=100;second++){
   h.setNow(start+second*1000);if(second<5)await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});
   await h.pv(0);await h.grid(13000);a.runContextHeartbeat();await a.runEvHeartbeat();await h.flush();
   assert.equal(a.getEvCommandedPowerW(0),0);assert.equal(a.getEvControlCurrentA(0),0);assert(a.latestEvDecision.desiredCurrentA<=6);
  }
  assert.deepEqual(h.errors,[]);return {finalAmps:a.latestEvDecision.desiredCurrentA,creditedW:a.getEvCommandedPowerW(0),p1W:13000,availableGridW:4400};
 });
 await check('Mode ignores positive Flow amps when P1 shows no EV load; a command is never proof',async()=>{
  const h=await setup(),a=h.app;await reading(h,{grid:4000,currents:[10]});
  assert.equal(a.state.evChargeCurrentA,10);assert.equal(a.getEvCommandedPowerW(0),0);assert.equal(a.getEvControlCurrentA(0),0);
  const status=a.getPublicStatus().evs[0];assert.equal(status.measuredPowerW,0);assert.equal(status.measuredPowerSource,'homeflux_p1_estimate');
 });
 await check('Mode derives actual P1 delta even when Flow says zero or an unrelated current',async()=>{
  const h=await setup(),a=h.app,perAmp=evPowerPerAmp(a.getEvElectricalSettingsFor(0));
  await reading(h,{grid:4000+8*perAmp,currents:[0]});assert(Math.abs(a.getEvCommandedPowerW(0)-8*perAmp)<1);
  await reading(h,{grid:4000+8*perAmp,currents:[30]});assert(Math.abs(a.getEvCommandedPowerW(0)-8*perAmp)<1);
  assert.equal(a.getEvGridImportControlStatus().confirmedEvPowerW,0,'Mode Flow current is not direct measurement proof');
 });
 for(const type of ['current','hybrid'])await check(type+': fresh reported 8A wins over a 10A command and stale report gives no credit',async()=>{
  const h=await setup(type),a=h.app,perAmp=evPowerPerAmp(a.getEvElectricalSettingsFor(0));
  await reading(h,{grid:4000+8*perAmp,currents:[8]});assert.equal(a.getEvControlCurrentA(0),8);assert(Math.abs(a.getEvCommandedPowerW(0)-8*perAmp)<1);
  h.setNow(h.now()+61000);assert.equal(a.getEvControlCurrentA(0),0);assert.equal(a.getEvCommandedPowerW(0),0);
 });
 await check('Two Mode EVs with no observed load get zero credit instead of two nominal currents',async()=>{
  const h=await setup('mode','emergency',2),a=h.app;await reading(h,{grid:4000,currents:[0,0]});
  assert.deepEqual([0,1].map(i=>a.getEvCommandedPowerW(i)),[0,0]);
  const decisions=[a.latestEvDecision,a.getExtraEv(1).latestDecision];assert(decisions.reduce((s,d)=>s+d.desiredPowerW,0)<=13401);
 });
 await check('A common Mode P1 delta is shared once and never attributed twice',async()=>{
  const h=await setup('mode','emergency',2),a=h.app,perAmp=evPowerPerAmp(a.getEvElectricalSettingsFor(0));
  await reading(h,{grid:4000+10*perAmp,currents:[0,0]});
  const credits=[0,1].map(i=>a.getEvCommandedPowerW(i));assert(credits.every(w=>w>0));assert(Math.abs(credits.reduce((s,w)=>s+w,0)-10*perAmp)<1);
  return {aggregateObservedW:10*perAmp,credits,individualAttribution:'estimated shared P1 split'};
 });
 await check('Mixed Mode/current EVs subtract Flow load before sharing the P1 remainder',async()=>{
  const h=await setup('mode','emergency',2),a=h.app;await h.setExternalSetting('ev2ControlType','current');
  const perAmp=evPowerPerAmp(a.getEvElectricalSettingsFor(0));await reading(h,{grid:4000+14*perAmp,currents:[0,8]});
  assert(Math.abs(a.getEvCommandedPowerW(0)-6*perAmp)<1);assert(Math.abs(a.getEvCommandedPowerW(1)-8*perAmp)<1);
  h.setNow(h.now()+61000);await reading(h,{grid:4000+14*perAmp,currents:[0,null]});assert.equal(a.getEvCommandedPowerW(0),0);
 });
 await check('Mode measurement accounts for PV and signed battery once, without adding PV to P1 headroom',async()=>{
  const h=await setup(),a=h.app,perAmp=evPowerPerAmp(a.getEvElectricalSettingsFor(0));
  for(const battery of [1000,-2000]){
   await reading(h,{grid:4000+8*perAmp-3807-battery,pv:3807,battery,currents:[0]});
   assert(Math.abs(a.getEvCommandedPowerW(0)-8*perAmp)<1);
  }
 });
 await check('Missing P1/PV, config changes, restart and disconnect cannot preserve old Mode credit',async()=>{
  const h=await setup(),a=h.app,perAmp=evPowerPerAmp(a.getEvElectricalSettingsFor(0));await reading(h,{grid:4000+8*perAmp});assert(a.getEvCommandedPowerW(0)>0);
  h.setNow(h.now()+61000);assert.equal(a.getEvCommandedPowerW(0),0);
  await reading(h,{grid:4000+8*perAmp});await h.setExternalSetting('evVoltage',230);assert.equal(a.getEvCommandedPowerW(0),0);
  h.setNow(h.now()+1000);await h.cards.get('set_ev1_status').listener({connected:'no',charge_current:0});assert.equal(a.getEvCommandedPowerW(0),0);
 });
 fs.writeFileSync(path.join(__dirname,'../validation/ev-confirmed-power-1.2.4.json'),JSON.stringify({simulatedHomey:true,physicalHomeyTested:false,passed:results.length,results},null,2)+'\n');console.log('Confirmed EV power: '+results.length+' production-path groups passed');
 }finally{restore();global.Date=N;Date.now=oldNow;}})().catch(e=>{console.error('FAILED after',results.length,results.at(-1),e);process.exitCode=1;});
