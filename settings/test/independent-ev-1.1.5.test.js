'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const rate={id:'dal',name:'Dal',importPrice:.2,feedInPrice:.03,
 weekdayChargeMode:'never',weekendChargeMode:'never',evChargeAllowed:true,evPvChargeAllowed:true,
 ev2ChargeAllowed:true,ev2PvChargeAllowed:true,evMaxGridImportW:15000};
async function fixture({batteries=0,enabled=false,type='current',...overrides}={}){
 const h=await setup(root,{batteryCount:batteries,controlEnabled:enabled,forcedMode:'standby',
  evCount:1,evEnabled:true,evSocEnabled:false,evControlType:type,evMode:'smart',
  evPhases:3,evVoltage:400,evVoltageReference:'line',evMinCurrentA:6,evMaxCurrentA:16,
  evStandardCurrentA:16,evCommandIntervalSeconds:7,evPeakGuardStopHoldSeconds:0,
  evSmartGridPriority:'ev_first',evGuaranteeTarget:false,evNightSurplusChargeEnabled:false,
  evPeakGuardBatteryAssistNormal:false,evPeakGuardBatteryAssistEmergency:false,
  contractType:'tou',peakLimitW:16000,peakSoftMarginW:0,exportLimitEnabled:false,
  touRates:[{...rate}],touSchedule:[{rateId:'dal',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]}],
  ...overrides},Date.parse('2026-10-18T10:00:00Z'),0);
 for(const [id,card]of h.cards)if(/^ev[1-4]_(charge_current|charging_allowed|charge_mode)_updated$/.test(id))
  card.trigger=async tokens=>h.flexible.push({at:h.now(),id,tokens});
 h.setting=async(key,value)=>{
  if(h.setExternalSetting)await h.setExternalSetting(key,value);
  else{h.app.setSetting(key,value);h.app.requestContextEvaluate(true,`setting:${key}`);}
  await h.drain();await h.flush();
 };
 return h;
}
const active=(a,index=0)=>index===0?Boolean(a.lastPublishedEvAllowed):Boolean(a.getExtraEv(index)?.lastPublishedAllowed);
async function start(h){
 const a=h.app;
 if(a.getSettings().evSocEnabled){a.state.evSoc=50;a.inputSeen.ev.soc=true;a.inputUpdatedAt.ev.soc=h.now();}
 await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});await h.drain();
 if(a.getEvCount()>1){await h.cards.get('set_ev2_status').listener({connected:'yes',charge_current:0});await h.drain();}
 await h.start();h.setNow(h.now()+10000);await a.runEvHeartbeat();await h.drain();
 assert(active(a),'EV must start with its own valid tariff/P1/configuration');
}
async function pass(h){
 const a=h.app;
 await a.runEvHeartbeat();await h.drain();
 a.requestContextEvaluate(true,'independent_ev_test');await h.drain();await h.flush();
}
async function run(){const original=Date.now,restore=installVirtualClearTimeout();let cases=0;
 try{
  for(const batteries of [0,4])for(const enabled of [false,true])for(const type of ['current','mode','hybrid']){
   const h=await fixture({batteries,enabled,type}),a=h.app;await start(h);const before=h.flexible.length;
   for(let i=0;i<3;i++){
    h.setNow(h.now()+10000);await h.grid(623);await pass(h);
    assert(active(a));assert.equal(a.getSettings().controlEnabled,enabled);
   }
   assert.equal(h.flexible.length,before,'unchanged setpoints must not publish again');
   assert.deepEqual(h.errors,[]);cases++;
  }
  // Real settings listener: switching battery output cannot change EV permission.
  for(const batteries of [0,4])for(const type of ['current','mode','hybrid']){
   const h=await fixture({batteries,enabled:true,type}),a=h.app;await start(h);const before=h.flexible.length;
   await h.setting('controlEnabled',false);
   for(let i=0;i<3;i++){h.setNow(h.now()+10000);await h.grid(623);await pass(h);assert(active(a));}
   assert.equal(h.flexible.length,before,'battery output off must not stop/restart the EV');
   const status=a.getPublicStatus();assert.match(status.statusText,/independent EV control/);
   assert.doesNotMatch(status.statusText,/SIMULATION/);
   assert(a.lastEmittedCommands.every(w=>w===0));
   await h.setting('controlEnabled',true);await pass(h);assert(active(a));
   assert.deepEqual(h.errors,[]);cases++;
  }
  // Every publication route must stop safely for its own real conditions.
  for(const type of ['current','mode','hybrid'])for(const reason of ['stale','missing','peak','tariff','disconnect','module','target','session']){
   const h=await fixture({type,evSocEnabled:reason==='target',evMode:reason==='target'?'soc_target':'smart'}),a=h.app;
   await start(h);h.setNow(h.now()+10000);
   if(reason==='stale')a.inputUpdatedAt.grid=h.now()-600001;
   if(reason==='missing')a.inputSeen.grid=false;
   if(reason==='peak')await h.grid(25000);
   if(reason==='tariff')await h.setting('touRates',[{...rate,evChargeAllowed:false,evPvChargeAllowed:false}]);
   if(reason==='disconnect'){await h.cards.get('set_ev1_status').listener({connected:'no',charge_current:0});await h.drain();}
   if(reason==='module')await h.setting('evEnabled',false);
   if(reason==='session'){await h.cards.get('end_ev1_charging_session').listener({});await h.drain();}
   if(reason==='target'){await a.setInput({ev:{soc:90}});await h.drain();}
   // Test a regular pass before the heartbeat; neither route may resume it.
   a.requestContextEvaluate(true,'safety_test');await h.drain();await h.flush();
   assert.equal(active(a),false,`${type}/${reason}: context stop`);
   await a.runEvHeartbeat();await h.drain();assert.equal(active(a),false,`${type}/${reason}: heartbeat stop`);
   assert.deepEqual(h.errors,[]);cases++;
  }
  // No battery test, battery SoC, or enabled battery output is needed for EVs.
  for(const type of ['current','mode','hybrid']){
   const h=await fixture({type,touRates:[{...rate,evChargeAllowed:false}],evPvStartSurplusW:1500}),a=h.app;
   await h.grid(-7000);await h.pv(7600);await start(h);assert(active(a));
   assert(a.latestEvDecision.pvAllocatedW>0);
   h.setNow(h.now()+120000);await h.grid(623);await h.pv(0);await pass(h);
   h.setNow(h.now()+120000);await h.grid(623);await pass(h);
   assert.equal(active(a),false,'PV-only EV must stop when real surplus remains absent');
   assert.deepEqual(h.errors,[]);cases++;
  }
  for(const batteries of [0,4]){
   const h=await fixture({batteries,enabled:false,chargeTestPassed:false}),a=h.app;
   h.store.delete('_chargeTestSignature');a.inputSeen.batterySoc=Array(8).fill(false);
   a.state.batterySoc=Array(8).fill(null);await start(h);await pass(h);assert(active(a));
   assert(a.lastEmittedCommands.every(w=>w===0));assert.deepEqual(h.errors,[]);cases++;
  }
  // An old simulated battery candidate is not a promise of support, PV release
  // or a future net reservation when battery output is disabled.
  {
   const h=await fixture({batteries:4,enabled:false,evPeakGuardBatteryAssistNormal:true,evNightSurplusChargeEnabled:true}),a=h.app;
   await start(h);a.state.gridPowerW=500;
   const result={...a.latestResult,pvChargeW:0,gridChargeAssistW:0,candidateCommands:[0,0,0,0]};
   const ordinary=a.calculateEvPortfolioDecisions(result,0,0,a.getSettings());
   const simulated=a.calculateEvPortfolioDecisions({...result,pvChargeW:9000,gridChargeAssistW:9000,candidateCommands:[-6000,0,0,0]},-6000,0,a.getSettings());
   assert.deepEqual(simulated,ordinary);
   assert(ordinary.every(d=>!d.batterySupportEnabled&&!d.nightSurplusActive&&!(d.batterySupportAllocatedW>0)));
   await a.publishEvPortfolio({...result,candidateCommands:[-6000,0,0,0]},-6000,0);
   assert(active(a),'a simulated charge reservation must not block an otherwise valid EV');
   // A real pending battery write still consumes physical future headroom.
   a.state.gridPowerW=11585; // 623 W house + the physically active 16 A EV
   a.inFlightBatteryCommands=[-15000,0,0,0];
   await a.publishEvPortfolio(result,0,0);assert.equal(active(a),false);
   a.inFlightBatteryCommands=null;assert.deepEqual(h.errors,[]);cases++;
  }
  // A serialized pending publication finishes, then uses the newest setting.
  {
   const h=await fixture({batteries:4,enabled:false,evPvSharePercent:90,
    touRates:[{...rate,evChargeAllowed:false}]}),a=h.app;
   await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});await h.drain();
   a.state.gridPowerW=0;a.state.pvPowerW=6600;a.state.lastTotalCommandW=-6000;
   const result={...a.latestResult,pvChargeW:6000,gridChargeAssistW:0};
   const charging=a.calculateEvPortfolioDecisions(result,-6000,-6000,a.getSettings());
   assert.equal(charging[0].desiredCurrentA,0,'physical battery PV cannot be promised to an independent EV');
   assert.equal(charging[0].pvPoolBudgetW,0);
   a.state.gridPowerW=-6000;a.state.lastTotalCommandW=0;
   const stopped=a.calculateEvPortfolioDecisions(result,0,0,a.getSettings());
   assert(stopped[0].desiredCurrentA>0,'real residual PV becomes immediately available');
   assert.deepEqual(h.errors,[]);cases++;
  }
  {
   const h=await fixture({batteries:4,enabled:true,forcedMode:'manual_charge',
    evPhases:1,evVoltage:230,evVoltageReference:'phase'}),a=h.app;
   await start(h);assert(a.lastEmittedCommands.some(w=>w<0),'battery output must really be active');
   const before=h.flexible.length;
   await h.setting('controlEnabled',false);await pass(h);
   assert(a.lastEmittedCommands.every(w=>w===0),'existing battery safety stop is preserved');
   assert(active(a));
   assert(h.flexible.slice(before).filter(t=>/^ev/.test(t.id)).every(t=>
    t.tokens.allowed_value!==0&&t.tokens.charge_current!==0&&t.tokens.charge_mode!=='stop'));
   assert.deepEqual(h.errors,[]);cases++;
  }
  {
   const h=await fixture({batteries:4,enabled:true,chargeTestPassed:false}),a=h.app;
   assert.equal(a.getSettings().controlEnabled,false,'startup still blocks invalid battery output');
   await start(h);await pass(h);assert(active(a));assert.deepEqual(h.errors,[]);cases++;
  }
  for(const change of ['ems','module','failure']){
   const h=await fixture({batteries:4,enabled:true}),a=h.app;
   let release,held=false;const trigger=a.evCurrentTrigger.trigger;
   a.evCurrentTrigger.trigger=async tokens=>{
    if(tokens.charge_current>0&&!held){held=true;await new Promise(r=>release=r);
     if(change==='failure')throw Error('synthetic EV transport failure');}
    await trigger(tokens);
   };
   await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});await h.drain();
   a.requestContextEvaluate(true,'pending_start');await h.drain();assert(release);
   const setting=h.setting(change==='module'?'evEnabled':'controlEnabled',false);
   await h.drain();release();await setting;await h.drain();await h.flush();
   h.setNow(h.now()+10000);await h.grid(623);await pass(h);
   assert.equal(active(a),change!=='module');
   assert.equal(a.evPublishing,false);
   if(change==='failure')assert(h.errors.some(e=>e.includes('synthetic EV transport failure')));
   else assert.deepEqual(h.errors,[]);cases++;
  }
  // Multiple EVs share one real budget; removing EV2 stops only EV2.
  {
   const h=await fixture({evCount:2,ev2Enabled:true,ev2SocEnabled:false,ev2ControlType:'current',ev2Mode:'smart',
    ev2Phases:1,ev2Voltage:230,ev2VoltageReference:'phase',ev2MinCurrentA:6,ev2MaxCurrentA:16,ev2StandardCurrentA:16}),a=h.app;
   await start(h);
   for(let i=0;i<3;i++){h.setNow(h.now()+10000);await h.grid(623);await pass(h);}
   assert(active(a)&&active(a,1));
   await h.setting('evCount',1);await pass(h);
   assert(active(a));assert.equal(active(a,1),false);
   await h.setting('evCount',0);await pass(h);assert.equal(active(a),false);
   assert.deepEqual(h.errors,[]);cases++;
  }
  console.log(`Independent EV: ${cases} production-cache scenarios passed (matrix, settings transitions, safety, missing battery test, simulation budgets, pending/failure and multi-EV).`);
 }finally{Date.now=original;restore();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
module.exports={run};
