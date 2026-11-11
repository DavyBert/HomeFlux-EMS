'use strict';
const assert=require('node:assert/strict');const {setup,installVirtualClearTimeout}=require('./pv-source-harness'),I=require('../lib/active-injection');
const restore=installVirtualClearTimeout(),originalNow=Date.now;
(async()=>{try{
 const h=await setup(undefined,{injectionEnabled:true,fixedImportPrice:1,exportLimitEnabled:false,peakShaveEnabled:false,optimizeMultiBatteryEfficiency:false,gridZeroMinW:-5,gridZeroMaxW:5},undefined,0),a=h.app;
 await h.drain();await I.start(a);await h.flush();
 for(let step=0;step<3;step++){h.setNow(h.now()+8000);await h.grid(800-a.state.lastTotalCommandW);await h.flush();}
 assert.equal(a.state.lastTotalCommandW,3800,'existing real fast feedback converges to 3 kW net export with 800 W house');
 h.setNow(h.now()+8000);await h.grid(1800-a.state.lastTotalCommandW);await h.flush();assert.equal(a.state.lastTotalCommandW,4800,'household change corrected on existing cadence');
 h.setNow(h.now()+8000);await h.pv(1500);await h.grid(800-1500-a.state.lastTotalCommandW);await h.flush();
 h.setNow(h.now()+8000);await h.grid(800-1500-a.state.lastTotalCommandW);await h.flush();
 assert.equal(a.state.lastTotalCommandW,2300,'PV reduces battery demand to 2300 W');
 const snapshot=a.getFastControlSnapshot(a.getSettings(),h.now(),{gridPowerW:-3000,controlGridPowerW:-3000,evGridImportTargetW:500});
 assert.equal(snapshot.zone,'inside');assert.equal(snapshot.evTargetW,0,'no old EV allowance shifts the injection goal');
 // Peak Guard hands back to the ordinary controller, never an intervening 0 W export stop.
 h.setNow(h.now()+8000);a.setSetting('peakShaveEnabled',true);a.setSetting('peakLimitW',2650);
 const before=h.traces.length;await h.grid(4000);await h.flush();
 assert.equal(a.injectionRuntime.active,false);assert.equal(a.injectionRuntime.pendingStop,false);
 assert(a.lastEmittedCommands.some(x=>x>0),'normal Peak Guard support remains');
 assert(!h.traces.slice(before).some(x=>x.total===0),'no intermediate zero command during Peak Guard takeover');
 assert.deepEqual(h.errors,[]);console.log('Injection fast feedback 1.3.1: 8 checks passed on real scheduler and publication path');
 }finally{restore();Date.now=originalNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
