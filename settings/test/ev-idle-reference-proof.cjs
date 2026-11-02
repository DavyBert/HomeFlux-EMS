'use strict';
const path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(process.argv[2]),fresh=process.argv[3]==='fresh';
const req=createRequire(root+'/package.json'),{fixture}=req('./test/ev-work-harness'),{installVirtualClearTimeout}=req('./test/pv-source-harness');
const N=Date,oldNow=Date.now;global.Date=class extends N{constructor(...a){super(...(a.length?a:[Date.now()]));}};const restore=installVirtualClearTimeout();
(async()=>{try{const h=await fixture({root,type:'mode',evs:1,batteries:0,batteryEnabled:false,chargeAllowed:false,extra:{peakShaveEnabled:true,peakLimitW:15000,peakSoftMarginW:100,evIdleHouseLoadW:4000}}),a=h.app;
await h.setExternalSetting('evModeSmartCurrentA',16);await h.setExternalSetting('evModeStandardCurrentA',16);a.evSessionDetection.portfolioBaselineW=4000;a.evBatteryHouseReferenceW=null;
const start=h.now();for(let s=1;s<=90;s++){h.setNow(start+s*1000);if(fresh)await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});await h.pv(0);await h.grid(700);a.runContextHeartbeat();await a.runEvHeartbeat();await h.flush();}
const reference=a.getEvStartHouseReference(h.now());a.setEvSessionOverrideFor(0,'emergency','flow');await h.start();await h.flush();
h.setNow(h.now()+1000);if(fresh)await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});await h.pv(0);await h.grid(700+Math.sqrt(3)*400*16);a.runContextHeartbeat();await a.runEvHeartbeat();await h.flush();
console.log(JSON.stringify({root,fresh,reference,baselineAfterStart:a.evSessionDetection.portfolioBaselineW,publishedMode:a.lastPublishedEvChargeMode,accounting:a.latestEvDecision?.peakGuardAccounting,reason:a.latestEvDecision?.reason,errors:h.errors}));}finally{restore();global.Date=N;Date.now=oldNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
