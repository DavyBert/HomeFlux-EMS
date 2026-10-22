'use strict';
const assert = require('node:assert/strict');
const { fixture, start } = require('./ev-battery-transition-1.1.9.test');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const originalNow = Date.now;
const restore = installVirtualClearTimeout();
(async () => {
 const results=[];
 for(const interval of [10,1]) {
  const h=await fixture('mode'); const a=h.app;
  await h.setExternalSetting('touRates',[{id:'test',name:'Test',importPrice:.2,feedInPrice:.03,weekdayChargeMode:'never',weekendChargeMode:'never',evChargeAllowed:false,evPvChargeAllowed:false}]);
  await h.start();await h.flush();
  const reasons={};const request=a.requestContextEvaluate.bind(a);
  a.requestContextEvaluate=(...args)=>{reasons[args[1]]=(reasons[args[1]]||0)+1;return request(...args);};
  let portfolio=0; const calculate=a.calculateEvPortfolioDecisions.bind(a);
  a.calculateEvPortfolioDecisions=(...args)=>{portfolio++;return calculate(...args);};
  const before=h.contexts.length;
  const cpu=process.cpuUsage();const wall=performance.now();
  for(let n=1;n<=180;n++) {
   h.setNow(start+n*1000);
   if((n-1)%interval===0)await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:10});
   await h.grid(623-a.state.lastTotalCommandW);await h.flush();
   if(n%60===0){a.runContextHeartbeat();await a.runEvHeartbeat();await h.drain();await h.flush();}
   assert.equal(a.lastPublishedEvChargeMode,'stop');
   assert(a.state.lastTotalCommandW<=663,'battery cannot fund an absent EV');
  }
  const used=process.cpuUsage(cpu);
  results.push({interval,seconds:180,cpuMs:(used.user+used.system)/1000,wallMs:performance.now()-wall,contexts:h.contexts.length-before,portfolio,reasons:{...reasons}});
  assert.equal(a.inputUpdatedAt.ev.chargeCurrent,start+(interval===1?180:171)*1000);
  assert.deepEqual(h.errors,[]);
  if(!process.env.BASELINE) {
   const session=a.getEvSessionDetectionRuntime(0);
   assert.equal(session.loadAbsent,true);
   assert.equal(session.state,'paused');
   // A changed input and recovery after stale telemetry remain real events.
   h.setNow(h.now()+1000);
   await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:11});
   assert.equal(session.loadAbsent,false);
   await h.grid(623-a.state.lastTotalCommandW);await h.flush();
   assert.equal(session.loadAbsent,true);
   h.setNow(h.now()+61000);
   await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:11});
   assert.equal(session.loadAbsent,false,'stale recovery must still register delivery');
   await h.cards.get('set_ev1_status').listener({connected:'no',charge_current:0});
   assert.equal(session.state,'ended');
  }
 }
 console.log(JSON.stringify(results,null,2));
 if(!process.env.BASELINE) {
  assert(results[1].contexts<=results[0].contexts+2,'duplicate cadence must not increase contexts');
  assert((results[1].reasons.ev_house_load_protection||0)<=3,'no P1/EV state oscillation');
 }
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Date.now=originalNow;restore();});
