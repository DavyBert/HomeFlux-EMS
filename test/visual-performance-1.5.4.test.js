'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const api=require('../widgets/status/api');
const visual=fs.readFileSync(path.join(root,'widgets/status/public/visual.html'),'utf8');
const outer=fs.readFileSync(path.join(root,'widgets/status/public/index.html'),'utf8');
function snippet(text,begin,end){
 const from=text.indexOf(begin),to=text.indexOf(end,from+begin.length);
 assert(from>=0 && to>from,`Missing code boundaries: ${begin}`);
 return text.slice(from,to);
}
(async()=>{
 // Homey-side: equivalent status calls share converted rows; changed source
 // data, timezone and time window always invalidate the display cache.
 let now=1800000000000;
 const originalNow=Date.now;
 Date.now=()=>now;
 try{
  const app={
   homeyEnergy:{lastUpdatedAt:1,slots:[
    {startMs:now-60000,price:.22},{startMs:now+840000,price:.38},
    {startMs:now+1740000,price:.48}]},
   getPublicStatus(){return{priceData:{sources:[{source:'homey',name:'Homey'}]}}},
   getSettings(){return{contractType:'fixed',timezone:'Europe/Brussels'}},
   getSavingsStatus(){return{}},
  };
  const query={homey:{app},query:{visualSavings:'1'}};
  const first=await api.getStatus(query),second=await api.getStatus(query);
  const classic1=await api.getStatus({homey:{app},query:{}});
  const classic2=await api.getStatus({homey:{app},query:{}});
  assert.notStrictEqual(classic1.priceCurves,classic2.priceCurves,'classic status keeps its original unmodified path');
  assert.strictEqual(first.priceCurves,second.priceCurves,'identical inputs should reuse display curves');
  assert.deepEqual(first.priceCurves[0].points,second.priceCurves[0].points);
  app.homeyEnergy.slots=[...app.homeyEnergy.slots,{startMs:now+2640000,price:.61}];
  app.homeyEnergy.lastUpdatedAt++;
  const updated=await api.getStatus(query);
  assert.notStrictEqual(updated.priceCurves,second.priceCurves,'new price source must invalidate immediately');
  assert.equal(updated.priceCurves[0].points.length,4);
  now+=61000;
  const later=await api.getStatus(query);
  assert.notStrictEqual(later.priceCurves,updated.priceCurves,'one-minute display cache must expire');
  app.getSettings=()=>({contractType:'fixed',timezone:'UTC'});
  const changedZone=await api.getStatus(query);
  assert.notStrictEqual(changedZone.priceCurves,later.priceCurves,'timezone change must invalidate');
 }finally{Date.now=originalNow;}

 // Browser-side: unchanged EV/HVAC fields cannot recreate cards; relevant
 // changes and clicking a detail still do update them immediately.
 const cardSource=snippet(visual,'function labelStatus(ev){','function clockText(minutes){');
 const nodes={};
 for(const id of ['evCount','evGrid','evDetail','hvacCount','hvacGrid','hvacDetail']){
  let html='',count=0;
  nodes[id]={hidden:false,get innerHTML(){return html},set innerHTML(v){html=v;count++},get writes(){return count}};
 }
 const ctx={
  evs:[{enabled:true,name:'EV 1',status:'laden',connected:true,soc:50,target:80,
   current:10,phases:1,reportedPowerW:2300,deadline:'07:00',reason:'Laden',mode:'smart',jsonSnapshot:true}],
  hvacs:[{enabled:true,name:'Salon',mode:'heat',room:19.5,set:21,reason:'Verwarmen',essential:false}],
  source:'json',selectedEv:-1,selectedHvac:-1,
  icons:{car:'CAR',heat:'HEAT',cool:'COOL',off:'OFF'},
  $:name=>nodes[name],num:(v,d)=>Number.isFinite(Number(v))?Number(v):d,
  nl:(value,precision=0)=>Number(value).toFixed(precision),
  cap:(v,min,max)=>Math.min(max,Math.max(min,v)),safe:v=>String(v),
  console,uiText:(text,...args)=>String(text).replace(/\{(\d+)\}/g,(_,i)=>String(args[i]??'')),
 };
 const renderer=vm.runInNewContext(cardSource+'\n({ev:renderEvs,hvac:renderHvacs})',ctx);
 renderer.ev();renderer.hvac();
 assert.equal(nodes.evGrid.writes,1);assert.equal(nodes.hvacGrid.writes,1);
 renderer.ev();renderer.hvac();
 assert.equal(nodes.evGrid.writes,1,'unchanged EV card must not be rewritten');
 assert.equal(nodes.hvacGrid.writes,1,'unchanged HVAC card must not be rewritten');
 ctx.evs[0].diagnosticCounter=999;
 renderer.ev();assert.equal(nodes.evGrid.writes,1,'invisible EV diagnostics must not redraw');
 ctx.evs[0].soc=51;
 renderer.ev();assert.equal(nodes.evGrid.writes,2,'changed EV SoC must redraw');
 ctx.hvacs[0].room=20.5;
 renderer.hvac();assert.equal(nodes.hvacGrid.writes,2,'changed room temperature must redraw');
 ctx.selectedEv=0;
 renderer.ev();assert.equal(nodes.evGrid.writes,3,'opening EV detail must redraw immediately');

 // EV event bursts merge with an ordinary in-flight status request. Peak
 // Guard/WAF updates bypass the debounce and remain immediate.
 const events=snippet(outer,'      function requestEvStatusRefresh(){',"      Homey.on?.('homeflux.ev.changed',evPlanChanged);");
 let clock=1000,requests=0,queued=[];
 const eventContext={Date:{now:()=>clock},document:{hidden:false},
  lastEvChangedAt:0,evChangedRefreshTimer:null,lastStatusSuccessStartedAt:0,
  lastStatusStartedAt:0,refreshBusy:false,refreshAgain:false,
  latestStatus:{},wafGuardEvent:null,visualLook:true,
  setTimeout:fn=>{queued.push(fn);return queued.length},
  refresh:()=>{requests++},sendVisual:()=>{eventContext.wafCount=(eventContext.wafCount||0)+1},
  updateDecisionDisplay:()=>{},settings:{},Homey:{},
 };
 const handlers=vm.runInNewContext(events+'\n({changed:evPlanChanged})',eventContext);
 for(let i=0;i<6;i++)handlers.changed(null);
 assert.equal(queued.length,1,'six events must schedule a single request');
 queued.shift()();assert.equal(requests,1);
 clock=2000;handlers.changed(null);
 eventContext.lastStatusSuccessStartedAt=2001;
 queued.shift()();assert.equal(requests,1,'recent completed status supersedes EV event');
 clock=3000;handlers.changed(null);
 eventContext.refreshBusy=true;eventContext.lastStatusStartedAt=2900;
 queued.shift()();assert.equal(eventContext.refreshAgain,true,'event after request start needs one follow-up');
 handlers.changed({wafPeakGuard:{peakGuardBlocked:true}});
 assert.equal(eventContext.wafCount,1,'WAF safety update is immediate');

 // Ensure the most expensive graph/savings/tariff rendering is still gated.
 assert(visual.includes('const LIVE_CALC_INTERVAL_MS=60000;'));
 assert(visual.includes('if(!liveCalculationInvalidated&&liveCalculationAt>0'));
 console.log('PASS Visual Look optimization: cached price curves + immediate invalidation, EV/HVAC diff, coalesced events, live WAF, 60s calculation');
})().catch(error=>{console.error(error);process.exitCode=1});
