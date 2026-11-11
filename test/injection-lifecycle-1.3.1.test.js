'use strict';
const assert=require('node:assert/strict');
const I=require('../lib/active-injection');const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const {boot}=require('./startup-harness');
const restore=installVirtualClearTimeout(),originalNow=Date.now;
async function fresh(extra={}){const h=await setup(undefined,{injectionEnabled:true,fixedImportPrice:1,exportLimitEnabled:false,peakShaveEnabled:false,...extra},undefined,0);await h.drain();h.app.requestContextEvaluate=()=>{};h.app.requestEvaluate=()=>{};return h;}
(async()=>{let checks=0;try{
 let h=await fresh({injectionAutomaticEnabled:true}),a=h.app;
 I.tick(a,a.getSettings(),h.now(),true);await h.drain();assert(a.injectionRuntime.active);assert.equal(a.injectionRuntime.source,'automatic');checks++;
 assert.equal(a.homey.settings.get('_injectionLatch').needsStop,true,'receipt persisted before first export');checks++;
 await h.setExternalSetting('injectionAutomaticEnabled',false);await h.drain();assert(!I.locked(a));checks++;
 // A restart with an interrupted export neutralizes hardware once through the existing publisher, even with no current inputs.
 const resumeMap=new Map(h.store);resumeMap.set('_injectionLatch',{key:'manual-stop',until:h.now()+900000,reason:'Injectie handmatig gestopt',needsStop:true});
 const resumed=await boot(resumeMap);for(let n=0;n<300;n++)await Promise.resolve();const b=resumed.app;
 I.tick(b,b.getSettings(),h.now(),false);for(let n=0;n<300;n++)await Promise.resolve();
 assert(!b.injectionRuntime.active);assert.equal(resumeMap.get('_injectionLatch').needsStop,false);assert.equal(resumeMap.get('_injectionLatch').key,'manual-stop');checks++;
 const interrupted=await boot(new Map([...h.store].filter(([k])=>k!=='_injectionLatch').concat([['_injectionLatch',{needsStop:true}]])));
 for(let n=0;n<300;n++)await Promise.resolve();
 assert.doesNotThrow(()=>interrupted.app.getPublicStatus());assert.equal(interrupted.app.getPublicStatus().injection.state,'inactive');checks++;
 // No repeated checkpoint writes once the receipt is settled.
 let writes=0;const set=b.setSetting.bind(b);b.setSetting=(k,v)=>{if(k==='_injectionLatch')writes++;return set(k,v);};
 for(let i=0;i<100;i++)I.tick(b,b.getSettings(),h.now(),false);assert.equal(writes,0);checks++;
 // A pending normal command cannot race the active export goal; a stop drains behind a single in-flight batch.
 h=await fresh();a=h.app;await I.start(a);let release,entered=false,concurrent=0,max=0;const sent=[];
 a.commandTrigger.trigger=async tokens=>{concurrent++;max=Math.max(max,concurrent);sent.push(tokens.total_command);if(!entered){entered=true;await new Promise(r=>release=r);}concurrent--;};
 a.lastEmitAt=0;a.nextCommandAllowedAt=0;
 a.pendingResult={...a.latestResult,injectionActive:true,injectionTargetW:3000,canPublishCommands:true,candidateCommands:[1000,1000,1000,1000],candidateTotalCommandW:4000,baseMode:'injection',modeLabel:'Actieve injectie',statusText:'Actieve injectie',_runFlexibleLoadPass:false};
 const running=a.emitPending();await h.drain();assert(entered);I.stop(a);assert(a.pendingResult.injectionStop);release();await running;await h.drain();
 assert.equal(max,1);assert.equal(sent.at(-1),0);assert(a.lastEmittedCommands.every(x=>x===0));assert(!I.locked(a));checks++;
 // Transition cards and physical zero remain idempotent under duplicate UI/Flow requests.
 h=await fresh();a=h.app;let starts=0,stops=0,zeros=0;
 a.injectionStartedTrigger.trigger=async()=>starts++;a.injectionStoppedTrigger.trigger=async()=>stops++;
 a.commandTrigger.trigger=async tokens=>{if(tokens.total_command===0)zeros++;};
 await I.start(a);await I.start(a);I.stop(a);I.stop(a);await h.drain();
 assert.equal(starts,1);assert.equal(stops,1);assert.equal(zeros,1);checks++;
 // After a manual stop the following price interval is eligible again, with fresh inputs and explicit auto opt-in.
 h=await fresh({injectionAutomaticEnabled:true});a=h.app;await I.start(a);I.stop(a);await h.drain();const end=a.injectionRuntime.latch.until;h.setNow(end+1);
 a.inputUpdatedAt.grid=h.now();a.inputUpdatedAt.batterySoc.fill(h.now());I.tick(a,a.getSettings(),h.now(),true);await h.drain();assert(a.injectionRuntime.active);checks++;
 h=await fresh({forcedMode:'solar_capture'});a=h.app;await I.start(a);assert(a.injectionRuntime.active);I.stop(a);await h.drain();assert.equal(a.getSettings().forcedMode,'solar_capture');checks++;
 h=await fresh();a=h.app;await I.start(a);a.inputUpdatedAt.batterySoc.fill(h.now()-600001);I.tick(a,a.getSettings(),h.now(),false);await h.drain();assert(!I.locked(a));assert(a.injectionRuntime.reason.includes('SoC'));checks++;
 console.log('Injection lifecycle 1.3.1:',checks,'checks passed');
 }finally{restore();Date.now=originalNow;}})().catch(e=>{console.error(e);process.exitCode=1;});
