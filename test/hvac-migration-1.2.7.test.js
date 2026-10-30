'use strict';
const assert=require('node:assert/strict'),{boot,DEFAULTS}=require('./startup-harness');
const originalPause=Object.getPrototypeOf; // Keep the actual production pause under test below.
const extra=k=>/^hvac(?:[5-9]|10)[A-Z]/.test(k);
(async()=>{
 const old=new Map(Object.entries(DEFAULTS).filter(([k])=>!extra(k)));old.set('settingsSchemaVersion',71);old.set('hvacName','Existing');old.set('hvacCount',4);
 let h=await boot(new Map(old));assert.deepEqual(h.errors,[]);
 assert.equal(h.timers.filter(t=>t.type==='hvac-settings-migration-pause').length,5);
 assert.equal(h.store.get('hvacName'),'Existing');assert.equal(h.store.get('hvacCount'),4);
 for(const [k,v]of Object.entries(DEFAULTS))if(extra(k))assert.deepEqual(h.store.get(k),v);
 const complete=new Map(h.store);h=await boot(new Map(complete));assert.deepEqual(h.errors,[]);assert.equal(h.timers.filter(t=>t.type==='hvac-settings-migration-pause').length,0);
 // Interrupt midway and resume, preserving an explicitly saved value.
 const partial=new Map(old);partial.set('hvac5Name','Keep HVAC 5');
 await assert.rejects(()=>boot(partial,({app})=>{const set=app.homey.settings.set;app.homey.settings.set=(k,v)=>{if(k==='hvac7Name')throw Error('simulated interrupted write');set(k,v);};}),/simulated interrupted write/);
 h=await boot(partial);assert.deepEqual(h.errors,[]);assert.equal(h.store.get('hvac5Name'),'Keep HVAC 5');assert.equal(h.store.get('hvac10Enabled'),false);
 // An external write during a pause must not be replaced by a queued default.
 h=await boot(new Map(old),({app,store})=>{app.pauseHvacSettingsMigration=async()=>{store.set('hvac6Name','During pause');};});assert.equal(h.store.get('hvac6Name'),'During pause');
 // Execute the real timer implementation once; no permanent control timer is started.
 const pause=originalPause(h.app).pauseHvacSettingsMigration;let requested=0;const started=Date.now();
 await pause.call({homey:{setTimeout:(fn,ms)=>{requested=ms;return setTimeout(fn,ms);}}});assert.equal(requested,2000);assert(Date.now()-started>=1900);
 console.log('HVAC migration: five 2-second gaps, no restart delays, preserved settings, interrupted upgrade recovery and writes during pause passed; real 2-second timer verified.');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
