'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const originalLoad=Module._load;
Module._load=function(request,parent,main){
 if(request==='homey')return {App:class{}};
 if(request==='homey-api')return {HomeyAPI:{}};
 return originalLoad.call(this,request,parent,main);
};
let App;
try{App=require('../app')}finally{Module._load=originalLoad}
const {emptyDay,emptyInventory}=require('../lib/savings');
const oldWidget=require('../widgets/savings/api');
const newWidget=require('../widgets/status/api');
const app=Object.create(App.prototype);
const day=(date,sav,cost)=>({...emptyDay(date),directPvValue:sav,directPvKwh:sav/.25,directGridCost:cost,directGridKwh:cost/.32});
app.savings={today:day('2026-11-15',0.7,1.5),history:{
 '2024-04-02':day('2024-04-02',20,35),
 '2026-06-01':day('2026-06-01',10,20),
 '2026-10-10':day('2026-10-10',6,11),
 '2026-10-27':day('2026-10-27',5,9),
 '2026-11-12':day('2026-11-12',4,7),
 '2026-11-14':day('2026-11-14',3,4),
 },total:0,inventory:emptyInventory()};
let reads=0;
app.recordSavingsSample=()=>{};
app.getSavingsDateKey=()=>'2026-11-15';
app.getSavingsTariffSnapshot=()=>({feedInPrice:0,feedInSource:'none'});
app.getSettings=()=>({timezone:'Europe/Brussels',batteryCount:0,evCount:0,hvacCount:0});
app.settingsCache={currencySymbol:'€'};
app.homey={clock:{getTimezone:()=> 'Europe/Brussels'}};
app.getPublicStatus=()=>({version:'1.5.4',settings:{evCount:0},priceData:{sources:[]},evs:[],hvacs:[]});
const original=app.getSavingsStatus;
app.getSavingsStatus=function(options){reads++;return original.call(this,options)};
const homey={app};
(async()=>{
 const classic=await newWidget.getStatus({homey});
 assert.equal(classic.visualSavings,undefined,'Classic widget should not do historical work');
 assert.equal(reads,0);
 const visual=await newWidget.getStatus({homey,query:{visualSavings:'1'}});
 assert.equal(visual.visualSavingsError,undefined);
 assert.deepEqual(Object.keys(visual.visualSavings.periods),['day','week','month','year','total']);
 assert.equal(reads,5,'All five period snapshots computed once');
 const periods={day:1,week:7,month:30,year:365,total:1827};
 for(const [label,days] of Object.entries(periods)){
  const expected=await oldWidget.getSavings({homey,query:{period:days===1?'day':'rolling',days:String(days)}});
  const result=visual.visualSavings.periods[label];
  assert.equal(result.periodSavings,expected.periodSavings,label+' house Savings');
  assert.equal(result.actualCost,expected.actualCost,label+' house Costs');
  assert.equal(result.directGrid.kwh,expected.directGrid.kwh,label+' grid');
 }
 assert.ok(visual.visualSavings.periods.week.periodSavings>0);
 assert.ok(visual.visualSavings.periods.month.periodSavings>visual.visualSavings.periods.week.periodSavings);
 assert.ok(visual.visualSavings.periods.year.periodSavings>visual.visualSavings.periods.month.periodSavings);
 assert.ok(visual.visualSavings.periods.total.periodSavings>visual.visualSavings.periods.year.periodSavings);
 require('node:fs').writeFileSync('/mnt/data/visual_154_noev_historical_snapshot.json', JSON.stringify(visual.visualSavings));
 const before=reads;
 const again=await newWidget.getStatus({homey,query:{visualSavings:'1'}});
 assert.equal(reads,before,'Second visual /status uses one-minute RAM cache');
 assert.deepEqual(again.visualSavings,visual.visualSavings);
 console.log('PASS Visual Look 1.5.4: all 5 periods via /status, no EV, same historic ledger and costs, classic unaffected, RAM cache');
})().catch(err=>{console.error(err);process.exitCode=1});
