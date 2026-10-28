'use strict';
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(process.argv[2]),type=process.argv[3]||'mode',operating=process.argv[4]||'emergency',feedback=process.argv[5]||'zero_once',steps=Number(process.argv[6]||420),smartA=Number(process.argv[7]||16),baseline=Number(process.argv[8]||4000),houseW=Number(process.argv[9]||700),pvW=Number(process.argv[10]||0),hold=Number(process.argv[11]??180);
const req=createRequire(root+'/package.json'),{fixture}=req('./test/ev-work-harness'),{installVirtualClearTimeout}=req('./test/pv-source-harness');
const NativeDate=Date,oldNow=Date.now;global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const restore=installVirtualClearTimeout(),perAmp=Math.sqrt(3)*400;
(async()=>{try{
const h=await fixture({root,type,evs:1,batteries:0,batteryEnabled:false,chargeAllowed:operating!=='pv_transitions',extra:{peakShaveEnabled:true,peakLimitW:15000,peakSoftMarginW:100,evIdleHouseLoadW:baseline,hybridEmsEnabled:true}}),a=h.app;
await h.setExternalSetting('evModeSmartCurrentA',smartA);await h.setExternalSetting('evModeStandardCurrentA',16);await h.setExternalSetting('evPeakGuardStopHoldSeconds',hold);await h.setExternalSetting('evCommandIntervalSeconds',60);
a.evSessionDetection.portfolioBaselineW=baseline;a.evBatteryHouseReferenceW=null;
a.setEvSessionOverrideFor(0,['transitions','pv_transitions'].includes(operating)?'smart':operating,'flow');await h.start();await h.flush();
const output=()=>type==='mode'?(a.lastPublishedEvChargeMode==='standard'?16:a.lastPublishedEvChargeMode==='smart'?smartA:0):type==='hybrid'&&a.lastPublishedEvChargeMode==='stop'?0:Number(a.lastPublishedEvCurrentA)||0;
const start=h.now(),events=[],rows=[];let old=output();
for(let second=1;second<=steps;second++){
h.setNow(start+second*1000);if(['transitions','pv_transitions'].includes(operating)&&[120,240].includes(second))a.setEvSessionOverrideFor(0,second===120?'emergency':'smart','flow');const actualA=output();
if(feedback==='fresh'||feedback==='zero'||feedback==='positive_once'&&second===1)await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:feedback==='zero'?0:actualA});
await h.pv(pvW);await h.grid(houseW+actualA*perAmp-pvW);a.runContextHeartbeat();await a.runEvHeartbeat();await h.flush();
const d=a.latestEvDecision,n=output(),row={second,actualA,outputA:n,publishedMode:a.lastPublishedEvChargeMode,gridW:Math.round(a.state.gridPowerW),creditW:Math.round(a.getEvCommandedPowerW(0)),baselineW:a.evSessionDetection.portfolioBaselineW,reference:a.evSessionDetection.houseStartReference??null,modeObservedW:a.getEvSessionDetectionRuntime(0)?.observedModePowerW,cacheW:a.evSessionDetection.modePowerSnapshot?.totalW??null,reason:d?.reason,accounting:d?.peakGuardAccounting??null};
if(n!==old||['transitions','pv_transitions'].includes(operating)&&[120,240].includes(second)){events.push(row);old=n;}if(second<=3||second%60===0)rows.push(row);
}
console.log(JSON.stringify({root,version:a.homey.manifest.version,type,operating,feedback,steps,smartA,baseline,houseW,pvW,hold,stopCount:events.filter(r=>r.outputA===0).length,startCount:events.filter(r=>r.outputA>0&&r.actualA===0).length,finalA:output(),events,rows,errors:h.errors}));
}finally{restore();global.Date=NativeDate;Date.now=oldNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
