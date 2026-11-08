'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const nativeNow=Date.now,{setup,cycle,known}=require('./hvac-coordination-1.2.15.test');
const {boot}=require('./startup-harness'),H=require('../lib/hvac-permanent'),C=require('../lib/hvac-coordination');
(async()=>{
 const h=await setup(3,{hvacPhysicalGroup:'same old name',hvac2PhysicalGroup:'same old name',hvac3PhysicalGroup:'same old name',hvacDirectTariffEnabled:true,hvac2DirectTariffEnabled:true,hvac3DirectTariffEnabled:true,hvac2SharedPowerEnabled:true,hvac2SharedPowerWith:1,hvacExtraGridBudgetEnabled:true,hvacExtraGridBudgetW:2500}),a=h.app;
 known(a,3,1000);const before=JSON.stringify(a.getSettings().hvacCoordination),timers=h.timers.length;
 await cycle(h);assert.deepEqual(h.events.filter(e=>e.kind==='setpoint').map(e=>e.instance),[1,2,3],'all independent zone goals can publish despite equal legacy names');
 const budget=C.prepare(a,a.getSettings(),a.latestResult);assert.deepEqual(budget.roots,[0,0,2]);assert.equal(budget.totalReservedW,2400,'two sources, not three zones, plus existing 20% margin');
 assert.equal(h.timers.length,timers);assert.equal(h.store.get('hvacPhysicalGroup'),'same old name');
 H.persist(a);const saved=structuredClone(h.store.get('_hvacPermanent'));assert.equal(saved.units[0].heat,1000);
 const next=await boot(h.store);assert.deepEqual(next.errors,[]);assert.equal(JSON.stringify(next.app.getSettings().hvacCoordination),before);assert.equal(H.unit(next.app,0).heat,1000);assert.equal(h.store.get('hvac2PhysicalGroup'),'same old name');assert.equal(next.app.getSettings().hvacPhysicalGroup,undefined,'legacy name is not an active runtime setting');
 for(let i=1;i<=10;i++){const stem='hvac'+(i===1?'':i);assert(!Object.hasOwn(H.defaults(),stem+'PhysicalGroup'));}
 const source=fs.readFileSync('lib/hvac-permanent.js','utf8');assert(!/PhysicalGroup|groupOwner|HVAC wacht op gedeelde installatie/.test(source));
 assert.deepEqual(h.errors,[]);console.log('HVAC legacy group: independent Flow setpoints, shared source accounting/margin, timer count and upgrade/restart learning/power links preserved.');
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{Date.now=nativeNow;});
