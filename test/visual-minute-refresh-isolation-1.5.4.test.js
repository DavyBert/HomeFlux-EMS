'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root=path.resolve(__dirname,'..');
const outer=fs.readFileSync(path.join(root,'widgets/status/public/index.html'),'utf8');
const inner=fs.readFileSync(path.join(root,'widgets/status/public/visual.html'),'utf8');
const settings=fs.readFileSync(path.join(root,'settings/index.html'),'utf8');
function between(s,start,end){
 const a=s.indexOf(start);
 assert(a>=0, 'missing start: '+start);
 const b=s.indexOf(end,a+start.length);
 assert(b>a, 'missing end: '+end);
 return s.slice(a,b);
}

(async()=>{
 assert(!settings.includes("api('POST','/visual-widget-refresh'"),
  'ordinary EMS settings Save must not request a widget refresh');
 const events=[];
 const ctx={
  visualLook:true,selectedVisualProfile:'medium',
  document:{hidden:false},console,
  refreshVisualWidgetProfile:async forced=>{events.push(['profile',forced]);},
  sendVisual:type=>{events.push(['notify',type]);},
  refresh:async forced=>{events.push(['status',forced]);},
 };
 const handlerCode=between(outer,'      const visualRefreshRequested = event => {',
   "      if (visualLook) Homey.on?.('homeflux.visual.refresh', visualRefreshRequested);");
 const handler=vm.runInNewContext(handlerCode+'\nvisualRefreshRequested',ctx);
 await handler({reason:'settings'});
 await handler({reason:'profile',name:'compact'});
 await handler({reason:'other'});
 assert.deepEqual(events,[],'only a Save on the selected profile may bypass 60-second cache');
 await handler({reason:'profile',name:'medium'});
 assert.deepEqual(events,[
  ['profile',true],['notify','homeflux.visual.recalculate'],['status',false],
 ],'profile must be loaded before recalc and fresh status');
 events.length=0;
 ctx.document.hidden=true;
 await handler({reason:'profile',name:'medium'});
 assert.deepEqual(events,[['profile',true],['notify','homeflux.visual.recalculate']],
  'hidden widget must not perform an unnecessary status request');

 const savings=between(inner,'function updateLiveSavings(message){','function updateLiveSavingsError(message){');
 const house=between(inner,'function updateLiveHouseHistory(rows,initial=false){','function liveSelectionChanged(){');
 const status=between(inner,'function updateLiveStatus(status, history){','function updateLiveSavings(message){');
 assert(!savings.includes('calculateLiveViews('),'Savings response must never initiate derived calculation');
 assert(house.includes('initial&&!initialHouseHistoryRendered&&rawStatusObject'),'only the one initial history reply may draw immediately');
 assert(status.includes('calculateLiveViews();'),'normal status refresh must still run the minute gate');
 const calcCode=between(inner,'const LIVE_CALC_INTERVAL_MS=60000;','function updateLiveStatus(status, history){');
 let clock=100000;
 const seen=[];
 const calcCtx={
  Date:{now:()=>clock},source:'json',rawStatusObject:{},
  s:{historyRows:[]},chartFrameKey:'',readHouseSamples:rows=>rows,
  centralSocObservations:[],readCentralSocHistory:rows=>rows.filter(row=>Number.isFinite(row.soc)),
  renderEnergyDay:()=>seen.push('chart'),renderExtras:()=>seen.push('savings'),
  renderTariffLive:()=>seen.push('tariffs'),
 };
 const controls=vm.runInNewContext(calcCode+`\n({tick:calculateLiveViews,invalidate:()=>{liveCalculationInvalidated=true},setHistory:r=>{pendingHouseHistory=r},state:()=>({at:liveCalculationAt,pending:pendingHouseHistory})})`,calcCtx);
 assert.equal(controls.tick(),true,'initial status calculates once');
 assert.deepEqual(seen,['chart','savings','tariffs']);
 clock+=10000;
 assert.equal(controls.tick(),false,'10s live refresh does not re-calculate');
 clock+=49000;
 assert.equal(controls.tick(),false,'minute is not due yet');
 clock+=1000;
 assert.equal(controls.tick(),true,'regular status refresh calculates at one-minute limit');
 assert.equal(seen.length,6);
 clock+=1000;
 controls.setHistory([{at:123,powerW:345}]);
 assert.equal(controls.tick(),false,'new history waits for next minute');
 assert.equal(controls.state().pending.length,1);
 controls.invalidate();
 assert.equal(controls.tick(),true,'explicit profile save invalidates the minute gate');
 assert.equal(controls.state().pending,null);
 assert.deepEqual(calcCtx.s.historyRows,[{at:123,powerW:345}]);
 assert.equal(seen.length,9);
 console.log('PASS Visual Look refresh isolation: profile-only save, general/savings/history isolated, 60s live gate');
})().catch(error=>{console.error(error);process.exitCode=1});
