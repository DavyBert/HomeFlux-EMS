'use strict';
const assert=require('node:assert/strict');
const P=require('../lib/phase-guard');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const NativeDate=Date,realNow=Date.now,restore=installVirtualClearTimeout();
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
(async()=>{try{
 const now=Date.UTC(2026,10,11,15,0,0);
 const h=await setup(undefined,{forcedMode:'standby',batteryCount:1,peakShaveEnabled:true,peakLimitW:18000,
  exportLimitEnabled:false,maxTotalDischargeW:4000,maxDischargePerBatteryW:4000,
  phaseGuard:{...P.defaults,phases:3,enabled:true,peakGuardBatteryAssistEnabled:true,limitW:8000,
   voltage:230,amps:40,batteries:['L1']}},now,0),a=h.app;
 await h.start();await h.flush();a.setSetting('controlEnabled',true);a.requestEvaluate=()=>{};a.requestContextEvaluate=()=>{};
 a.state.batterySoc[0]=75;a.inputUpdatedAt.batterySoc[0]=h.now();a.state.lastTotalCommandW=0;a.lastEmittedCommands=[0];
 a.state.gridPowerW=16000;a.inputUpdatedAt.grid=h.now();P.ingest(a,{l1:9000,l2:4000,l3:3000},h.now());
 const result={...a.latestResult,canPublishCommands:true,candidateCommands:[0],candidateTotalCommandW:0,_runFlexibleLoadPass:false};
 P.apply(a,result,a.getSettings(),h.now());
 assert.equal(result.phaseBatteryAssist?.extraW,1000,'phase help enters existing battery candidate');
 a.pendingResult=result;a.lastEmitAt=0;a.nextCommandAllowedAt=0;
 await a.emitPending();
 assert.equal(a.state.lastTotalCommandW,1000,'existing battery flow publishes phase help');
 assert.equal(h.traces.at(-1)?.total,1000,'one final command, not separate battery loop');
 h.setNow(h.now()+8000);a.state.gridPowerW=15000;a.inputUpdatedAt.grid=h.now();
 P.ingest(a,{l1:7000,l2:4500,l3:3500},h.now());
 const cleared={...a.latestResult,canPublishCommands:true,candidateCommands:[0],candidateTotalCommandW:0,_runFlexibleLoadPass:false};
 P.apply(a,cleared,a.getSettings(),h.now());
 assert.equal(cleared.phaseBatteryAssist,null,'phase help clears when measured overload ends');
 a.pendingResult=cleared;a.lastEmitAt=0;a.nextCommandAllowedAt=0;
 await a.emitPending();
 assert.equal(a.state.lastTotalCommandW,0,'ordinary controller resumes after phase overload');
 assert.deepEqual(h.errors,[]);
 console.log('Phase assistance end-to-end: standard battery Flow publishes once and releases on P1 recovery.');
}finally{restore();global.Date=NativeDate;Date.now=realNow;}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
