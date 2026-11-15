'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const orig = Module._load;
Module._load = function(request,parent,main){
  if (request === 'homey') return {App:class{}};
  if (request === 'homey-api') return {HomeyAPI:{}};
  return orig.call(this,request,parent,main);
};
let HomeFlux;
try {HomeFlux=require('../app')} finally {Module._load=orig}
const {emptyDay,emptyInventory,compactDay,rawImportedKwh,calibrateEnergy} =
  {...require('../lib/savings'),...require('../lib/savings-history')};
const api=require('../widgets/status/api');
const now=new Date('2026-11-15T12:05:00+01:00').getTime();
function mock({pvKnown=false,gridFresh=true,gridW=1200,pvW=null}={}){
  const app=Object.create(HomeFlux.prototype);
  const today='2026-11-15';
  app.homey={clock:{getTimezone:()=> 'Europe/Brussels'}};
  app.savings={today:emptyDay(today),history:{},inventory:emptyInventory(),total:0,lastSampleAt:now-300000};
  app.settingsCache={currencySymbol:'€'};
  app.getSettings=()=>({contractType:'fixed',fixedImportPrice:.40,fixedFeedInPrice:.10,timezone:'Europe/Brussels',batteryCount:4});
  app.getSavingsTariffSnapshot=()=>({id:'fixed',label:'Vast',importPrice:.40,feedInPrice:.10,feedInSource:'fixed'});
  app.getGridFreshness=()=>({fresh:gridFresh,value:gridW});
  app.getEvCount=()=>0;
  app.state={gridPowerW:gridW,pvPowerW:pvW,lastTotalCommandW:0};
  app.inputSeen={grid:true,pv:pvKnown};
  app.inputUpdatedAt={pv:pvKnown?now-1000:0};
  app.getSavingsDateKey=()=>today;
  return app;
}
const close=(v,w)=>assert.ok(Math.abs(v-w)<1e-9,`${v} differs from ${w}`);
{
  const app=mock();app.recordSavingsSample(now);app.recordSavingsSample=()=>{};
  const kwh=1.2*300/3600;
  close(app.savings.today.unattributedGridKwh,kwh);
  close(app.savings.today.unattributedGridCost,kwh*.4);
  close(app.savings.today.directPvKwh,0);
  close(app.getSavingsStatus({period:'day'}).actualCost,kwh*.4);
  close(app.getSavingsStatus({period:'rolling',days:7}).grossImportCost,kwh*.4);
  close(app.getSavingsStatus({period:'day'}).importedEnergyToday.measuredKwh,kwh);
  close(rawImportedKwh(compactDay(app.savings.today,'2026-11-15')),kwh);
}
{
  const app=mock({gridFresh:false});app.recordSavingsSample(now);
  close(app.savings.today.unattributedGridKwh,0);
}
{
  const app=mock({gridW:-1200});app.recordSavingsSample(now);app.recordSavingsSample=()=>{};
  close(app.savings.today.unattributedExportKwh,0.1);
  close(app.getSavingsStatus({period:'day'}).actualCost,-0.01);
}
{
  const app=mock({pvKnown:true,pvW:0});app.recordSavingsSample(now);
  close(app.savings.today.directGridKwh,0.1);
  close(app.savings.today.unattributedGridKwh,0);
}
{
  const app=mock();app.recordSavingsSample(now);
  app.savings.today.importedEnergyKnown=true;
  app.savings.today.importedEnergyKwh=0.2;
  close(calibrateEnergy(app.savings.today).unattributedGridKwh,0.2);
  app.savings.today.importedEnergyKwh=0;
  close(calibrateEnergy(app.savings.today).unattributedGridKwh,0.1);
  close(calibrateEnergy(app.savings.today).unattributedGridCost,0.04);
}
// Visual Look profiles are managed through a private settings-tab API.
// This does not change the valid P1 / Savings accounting assertions above.
const config=require('../widgets/status/widget.compose.json');
const profiles=require('../lib/visual-widget-profiles');
assert.equal(typeof api.getVisualLayout,'undefined');
assert.equal(typeof api.setVisualLayout,'undefined');
assert.equal(config.settings[0].id,'visualLook');
const profileSetting=config.settings.find(s=>s.id==='visualProfile');
assert(profileSetting);
assert.deepEqual(profileSetting.values.map(v=>v.id),profiles.PROFILES);
assert.equal(config.name.nl,'EMS Status');
console.log('Savings P1 fallback, no PV fabrication, rolling costs and external visual profile configuration PASS');
