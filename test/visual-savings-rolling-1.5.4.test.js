'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const load = Module._load;
Module._load = function(request, parent, main) {
  if(request === 'homey') return {App:class{}};
  if(request === 'homey-api') return {HomeyAPI:{}};
  return load.call(this,request,parent,main);
};
let HomeFlux;
try { HomeFlux = require('../app'); } finally { Module._load = load; }
const { emptyDay, emptyInventory } = require('../lib/savings');
const statusApi = require('../widgets/status/api');
const savingsApi = require('../widgets/savings/api');
const app = Object.create(HomeFlux.prototype);
const mk = (date,pv=0,cost=0) => ({...emptyDay(date),directPvValue:pv,directPvKwh:pv/0.35,directGridCost:cost,directGridKwh:cost/0.4});
app.savings = {
  today: mk('2026-11-15',0.55,1.25),total:0,inventory:emptyInventory(),
  history: {
    '2026-10-09':mk('2026-10-09',8.40,18), // Outside rolling 30 days
    '2026-10-20':mk('2026-10-20',1.40,2.40),
    '2026-11-11':mk('2026-11-11',2.30,3.20),
    '2026-11-14':mk('2026-11-14',0.80,0.90),
  },
};
app.recordSavingsSample = () => {};
app.getSavingsDateKey = () => '2026-11-15';
app.getSavingsTariffSnapshot = () => ({feedInPrice:0,feedInSource:'none'});
app.settingsCache = {currencySymbol:'€'};
app.getSettings = () => ({timezone:'Europe/Brussels'});
app.homey = {clock:{getTimezone:()=> 'Europe/Brussels'}};
const homey = {app:{getSavingsStatus: (args)=>app.getSavingsStatus(args),localizeDisplay:x=>x}};
(async()=>{
  const old = await savingsApi.getSavings({homey,query:{period:'rolling',days:'30'}});
  const visual = await statusApi.getSavings({homey,query:{period:'rolling',days:'30'}});
  const seven = await statusApi.getSavings({homey,query:{period:'rolling',days:'7'}});
  const one = await statusApi.getSavings({homey,query:{period:'day',days:'1'}});
  assert.equal(old.period, 'rolling');
  assert.deepEqual(visual,old,'Old and Visual Look must read precisely the same ledger and date range');
  assert.equal(old.periodSavings,5.05);
  assert.equal(old.actualCost,7.75);
  assert.ok(Math.abs(seven.periodSavings-3.65)<1e-9);
  assert.equal(one.periodSavings,0.55);
  assert.equal(visual.startDate,'2026-10-17');
  assert.equal(visual.endDate,'2026-11-16');
  const fixture={day:one,week:seven,month:visual};
  const file='/mnt/data/visual_154_rolling_historical_fixture.json';
  fs.writeFileSync(file,JSON.stringify(fixture));
  console.log('Historical 30d ledger, original Savings widget and Visual Look API match. fixture='+file);
})().catch(e=>{console.error(e);process.exitCode=1});
