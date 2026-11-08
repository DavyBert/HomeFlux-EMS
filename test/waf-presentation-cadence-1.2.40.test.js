'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const W=require('../lib/waf-presentation');
const originalNow=Date.now,restore=installVirtualClearTimeout(),start=Date.parse('2026-11-08T11:00:00Z');
(async()=>{
 const h=await setup(path.join(__dirname,'..'),{minSoc:95,safetySoc:95,peakReserveEnabled:false,expectedEnergyNeedKwh:1},start,0);
 const a=h.app;a.state.batterySoc=[95,95,95,95];await h.start();await h.flush();
 assert.equal(a.getEmsWidgetTokens().emsdecision,'Saving battery');
 const initial=a.planningCache.wafPresentation,budget=a.planningCache.energyBudget;assert(initial.active);
 const oldRoom=initial.gridRoomW,oldGeneration=a.planningCache.generation;
 h.setNow(start+1000);await h.grid(2000);await h.flush();
 assert.strictEqual(a.planningCache.wafPresentation,initial,'P1 must not refresh the presentation');assert.strictEqual(a.planningCache.energyBudget,budget);assert.equal(initial.gridRoomW,oldRoom);
 h.setNow(start+60000);a.inputUpdatedAt.grid=h.now();a.state.gridPowerW=1000;const output=a.state.lastTotalCommandW;
 W.updateRoom(a,a.getSettings(),h.now());assert.equal(initial.gridRoomW,1500);assert.equal(a.state.lastTotalCommandW,output);assert.strictEqual(a.planningCache.energyBudget,budget);assert.equal(a.planningCache.generation,oldGeneration);
 h.setNow(start+120000);a.inputUpdatedAt.grid=h.now();a.state.gridPowerW=1010;const viewBefore=JSON.stringify(initial);assert(!W.updateRoom(a,a.getSettings(),h.now()));assert.equal(JSON.stringify(initial),viewBefore);
 a.inputUpdatedAt.grid=h.now()-60001;W.updateRoom(a,a.getSettings(),h.now());assert.equal(initial.gridRoomW,null);
 h.setNow(start+300000);a.inputUpdatedAt.grid=h.now();a.state.gridPowerW=500;await h.start();await h.flush();assert.notStrictEqual(a.planningCache.wafPresentation,initial);assert.equal(a.planningCache.wafPresentation.calculatedAt,h.now());
 assert.deepEqual(h.errors,[]);
 // Pin the integration to slow WAF work and the existing single heartbeat.
 const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 const fast=source.slice(source.indexOf('  evaluateFastNow('),source.indexOf('  async runContextEvaluation('));
 assert(!fast.includes('wafPresentation.refresh('));assert.equal((source.match(/wafPresentation\.updateRoom\(/g)||[]).length,1);
 console.log('WAF cadence: real startup, P1 inputs, 100 W categories, minute room checks, five-minute colour refresh, stale inputs and unchanged command/energy caches passed.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>{Date.now=originalNow;restore();});
