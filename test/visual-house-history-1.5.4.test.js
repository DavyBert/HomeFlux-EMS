'use strict';
const assert=require('node:assert/strict');
const Module=require('module');
const old=Module._load;
Module._load=function(req,parent,main){
 if(req==='homey') return {App:class{}};
 if(req==='homey-api') return {HomeyAPI:{}};
 return old.call(this,req,parent,main);
};
let HomeFlux;
try{HomeFlux=require('../app')}finally{Module._load=old}
const {emptyDay,emptyInventory}=require('../lib/savings');
const api=require('../widgets/status/api');
const T=Date.parse('2026-11-15T12:00:00+01:00');
const store=new Map();
const settings={contractType:'fixed',fixedImportPrice:.40,fixedFeedInPrice:.10,timezone:'Europe/Brussels',batteryCount:4};
const app=Object.create(HomeFlux.prototype);
app.settingsCache={currencySymbol:'€'};
app.homey={clock:{getTimezone:()=> 'Europe/Brussels'},settings:{get:k=>store.get(k),set:(k,v)=>store.set(k,v)}};
app.savings={today:emptyDay('2026-11-15'),history:{},inventory:emptyInventory(),total:0,lastSampleAt:T-60000};
app.getSavingsDateKey=()=>'2026-11-15';
app.getSettings=()=>settings;
app.getEvCount=()=>0;
app.getGridFreshness=()=>({fresh:true,value:1200});
app.getSavingsTariffSnapshot=()=>({id:'fixed',label:'Vast',importPrice:.40,feedInPrice:.1,feedInSource:'fixed'});
app.state={gridPowerW:1200,pvPowerW:800,lastTotalCommandW:300};
app.inputSeen={grid:true,pv:true};
app.inputUpdatedAt={pv:T-3000};
const totals=()=>app.savings.today.directGridKwh;
app.evSessionDetection={physicalSiteLoadW:2300};
app.recordSavingsSample(T);
app.recordVisualHouseLoadSample(T);
assert.equal(app.savings.today.houseLoadHistory,undefined);
let firstTotal=totals();
app.recordSavingsSample(T+30000);
assert.ok(totals()>firstTotal,'Savings continues independently');
for(let at=T+10000;at<=T+300000;at+=10000){app.inputUpdatedAt.pv=at;app.recordVisualHouseLoadSample(at)}
assert.equal(app.savings.today.houseLoadHistory.length,1);
assert.equal(app.savings.today.houseLoadHistory[0][1],2300);
assert.equal(app.savings.today.houseLoadHistory[0][3],300000);
(async()=>{
 const result=await api.getHouseLoadHistory({homey:{app}});
 assert.equal(result.rows.length,1);
 assert.equal(result.intervalSeconds,300);
 assert.equal(result.source,'shared_physical_site_load');
 app.persistSavingsState=HomeFlux.prototype.persistSavingsState;
 app.syncEmsDevices=()=>Promise.resolve();
 app.persistSavingsState(T+300000,true);
 assert.equal(store.get('_savingsToday').houseLoadHistory.length,1);
 const restarted=Object.create(HomeFlux.prototype);
 restarted.homey=app.homey;
 restarted.getSavingsDateKey=app.getSavingsDateKey;
 restarted.savings={today:null,history:{},inventory:emptyInventory(),total:0,lastSampleAt:T};
 restarted.restoreSavingsState();
 assert.equal(restarted.getVisualHouseLoadHistory().rows.length,1);
 assert.equal(restarted.getVisualHouseLoadHistory().rows[0].coveredMs,300000);
 // No fresh PV reading: do not fabricate a site-load observation.
 const count=app.savings.today.houseLoadHistory.length;
 app.inputSeen.pv=false;
 app.recordVisualHouseLoadSample(T+330000);
 assert.equal(app.savings.today.houseLoadHistory.length,count);
 // Storage is the existing _savingsToday value; there is no new settings entry.
 assert.deepEqual([...store.keys()].filter(x=>x.startsWith('_visual')),[]);
 console.log('Visual House: shared P1+PV observations, time-weighted 5-minute averages, no fabricated PV, saved/restored and endpoint PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
