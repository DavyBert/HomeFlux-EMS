'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const outer = fs.readFileSync(path.join(root, 'widgets/status/public/index.html'), 'utf8');
const inner = fs.readFileSync(path.join(root, 'widgets/status/public/visual.html'), 'utf8');
function between(text, start, end) {
 const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
 assert(a >= 0 && b > a, `Missing code section: ${start}`);
 return text.slice(a, b);
}
const houseCode = between(outer,'      let persistedHouseHistory = []','      let requestedPeriod =');
const refreshCode = between(outer,'      async function refresh(first = false) {','      function applyWafGuardEvent() {');
assert(!/setTimeout|setInterval|fetch\(/.test(houseCode + refreshCode), 'no new timers, polling or fetch');
const row = at => ({at, cursorAt:at, powerW:1700, endAt:at+300000, coveredMs:300000});
function createHarness(mode) {
 let now=100000, settleInitial, rejectInitial;
 const queries=[], sent=[], chart=[];
 const initial = new Promise((resolve,reject)=>{settleInitial=resolve;rejectInitial=reject;});
 const context = {
  Date:{now:()=>now}, console:{warn(){},error(){}}, visualLook:true,
  Homey:{api:async(method,url)=>{
   assert.equal(method,'GET'); queries.push(url);
   if(url==='/house-load-history')return initial;
   assert(url.startsWith('/status?'),`unexpected URL ${url}`);
   return {visualHouseHistory:url.includes('historyAfter=')?{date:'2026-11-17',rows:
     url.includes('historyAfter=200000')?[]:[row(200000)]}:undefined};
  }},
  latestVisualPlan:null,latestStatus:null,
  refreshBusy:false,refreshAgain:false,
  lastStatusStartedAt:0,lastStatusSuccessStartedAt:0,
  widgetConfigurationReady:true,visualProfileRetryAfter:0,visualProfilePending:null,
  visualView:{classList:{remove(){},add(){}}},
  sendVisual:(type,data)=>sent.push({type,data}),
  settings:{},enabled:()=>true,receiveStatusSavings(){},applyWafGuardEvent(){},
  requestVisualSavings:async()=>{},sendVisualAppearance(){},
  document:{hidden:false,getElementById:()=>({classList:{add(){},remove(){}},textContent:''})},
  waitForVisualHeight:async()=>{},resize:async()=>440,
  hasRendered:false,renderStatus(){},updateDecisionDisplay(){},syncDisplayClock(){},
  HomeyReadyUnused:0,
 };
 context.Homey.ready=async()=>{};
 const iface=vm.runInNewContext(houseCode+'\n'+refreshCode+`\n({
  start:refreshHouseHistory,refresh,
  state:()=>({done:houseHistoryDone,pending:houseHistoryPending,after:historyAfter,count:persistedHouseHistory.length}),
 })`,context);
 return {iface,queries,sent,advance:ms=>{now+=ms;},settle:()=>settleInitial({date:'2026-11-17',rows:[row(200000)]}),reject:()=>rejectInitial(new Error('API unavailable'))};
}
const wait=()=>new Promise(resolve=>setImmediate(resolve));
async function stalledInitial() {
 const h=createHarness();
 const first=h.iface.start();
 await h.iface.refresh();
 assert.equal(h.queries.filter(x=>x.startsWith('/status')).length,1);
 assert(!h.queries.some(x=>x.includes('historyAfter=')),'normal first status remains compact');
 h.advance(16000);
 await h.iface.refresh();
 assert(h.queries.some(x=>x.includes('historyAfter=0')),'stalled startup repaired via existing status request');
 assert.equal(h.iface.state().count,1);
 assert.equal(h.iface.state().done,true);
 h.advance(10000);
 await h.iface.refresh();
 assert(h.queries.some(x=>x.includes('historyAfter=200000')),'later status is incremental');
 assert.equal(h.queries.filter(x=>x==='/house-load-history').length,1,'no retry request');
 h.settle();await first;
 assert.equal(h.iface.state().count,1,'late full history does not duplicate samples');
}
async function quickInitial() {
 const h=createHarness();
 const first=h.iface.start();h.settle();await first;
 assert.equal(h.iface.state().count,1);
 await h.iface.refresh();
 assert(h.queries.some(x=>x.includes('historyAfter=200000')),'normal startup stays incremental');
 assert.equal(h.queries.filter(x=>x==='/house-load-history').length,1);
}
async function failedInitial() {
 const h=createHarness();
 const first=h.iface.start();h.reject();await first;
 assert.equal(h.iface.state().done,true);
 await h.iface.refresh();
 assert.equal(h.iface.state().count,1,'failed standalone history recovered via status');
 assert.equal(h.queries.filter(x=>x==='/house-load-history').length,1);
}
function visualFallback() {
 const code = between(inner,'const LIVE_CALC_INTERVAL_MS=60000;','function updateLiveSavings(message){');
 let clock=100000;
 const calls=[];
 const errors=[];
 const context={
  Date:class extends Date {static now(){return clock;}},console:{error:(...args)=>errors.push(args)},source:'json',rawStatusObject:null,
  s:{historyRows:[]},evs:[],hvacs:[],
  chartFrameKey:'',readHouseSamples:rows=>rows.filter(r=>typeof r.powerW==='number'),
  readCentralSocHistory:rows=>rows.filter(r=>typeof r.soc==='number'),
  renderEnergyDay:()=>calls.push('chart'),renderExtras:()=>{},renderTariffLive:()=>{},
  readJsonStatus:()=>({result:{historyRows:context.s.historyRows},mappedEvs:[],mappedHvacs:[]}),
  statusModuleFlags:()=>({}),paint(){},updateLiveLabels(){},
  liveHasStatus:false,liveFitLabelChanged:false,reportLiveHeight(){},
  ResizeObserver:function(){},sendParent(){},document:{body:{classList:{add(){}}}},
 };
 const api=vm.runInNewContext('let initialHouseHistoryRendered=false;\n'+code+`\n({status:updateLiveStatus,state:()=>({count:s.historyRows.length})})`,context);
 api.status({}); assert.equal(calls.length,1,'first status calculated');
 clock+=10000;
 api.status({},[{at:1000,soc:50,socAt:1000}]);
 assert.equal(calls.length,1,'SOC-only history does not force needless house graph');
 clock+=10000;
 api.status({},[{at:1000,soc:50,socAt:1000},row(2000)]);
 assert.equal(calls.length,2,'first house samples draw before one-minute gate');
 assert.equal(api.state().count,1);
 clock+=10000;
 api.status({},[{at:1000,soc:50,socAt:1000},row(2000),row(3000)]);
 assert.equal(calls.length,2,'incremental house samples do not recalculate every status tick');
 assert.equal(errors.length,0,'live rendering must not throw');
}
(async()=>{
 await stalledInitial();await quickInitial();await failedInitial();visualFallback();
 console.log('PASS 1.5.11 history startup recovery: stuck, normal, failed, late reply, no extra API/timers, immediate first graph, minute gate');
})().catch(error=>{console.error(error);process.exitCode=1});
