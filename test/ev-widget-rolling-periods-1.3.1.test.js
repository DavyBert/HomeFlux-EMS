'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const { emptyDay }=require('../lib/savings');
const { createHistoryCache }=require('../lib/savings-history');
const dashboard=require('../lib/ev-dashboard');
const RealDate=Date;
const cases=[];
const expect=(name,fn)=>{fn();cases.push(name);};
function energy(date,gridKwh,pvKwh=0,evId='1') {
  const day=emptyDay(date);
  const metric={kwh:gridKwh+pvKwh,gridKwh,pvKwh,batteryKwh:0,unknownKwh:0,estimatedKwh:gridKwh+pvKwh,
    gridCost:gridKwh*.25,solarValue:pvKwh*.05,solarSavings:pvKwh*.2,unpricedKwh:0,missingSeconds:0};
  day.ev={version:1,seconds:86400,sharedKwh:0,total:{...metric},byId:{[evId]:{...metric}}};
  return day;
}
function environment(today,dates){
  const history=Object.fromEntries(Object.entries(dates).filter(([date])=>date!==today));
  const a={ homey:{clock:{getTimezone:()=> 'Europe/Brussels'}},
    getSavingsDateKey:()=>today,getSettings:()=>({currencySymbol:'€'}),
    savings:{today:dates[today] || emptyDay(today),history},savingsHistoryCache:createHistoryCache(),
    getSavingsPeriodRange:(period)=>{assert.equal(period,'day','EV widget must not reuse weekly/monthly Savings calendar ranges');return{startKey:today,endKey:require('../lib/savings-history').shiftKey(today,1)};} };
  return a;
}
function runDate(date,fn){global.Date=class extends RealDate{static now(){return RealDate.parse(`${date}T12:00:00Z`);}};try{fn();}finally{global.Date=RealDate;}}
try {
 runDate('2026-11-10',()=>{
  const dates={
   '2026-10-11':energy('2026-10-11',64),  // 31st day, not month
   '2026-10-12':energy('2026-10-12',32),  // 30th day inclusive
   '2026-10-31':energy('2026-10-31',16),
   '2026-11-03':energy('2026-11-03',8),   // 8th day, not week
   '2026-11-04':energy('2026-11-04',4),   // 7th day inclusive
   '2026-11-09':energy('2026-11-09',2),
   '2026-11-10':energy('2026-11-10',1),
  };
  const app=environment('2026-11-10',dates);
  const got=key=>dashboard.insights(app,key).byId['1'].gridKwh;
  expect('Dag remains the current 24-hour calendar day, excluding yesterday',()=>assert.equal(got('day'),1));
  expect('Week counts 7 most recent calendar dates incl. today, excluding day 8',()=>assert.equal(got('week'),7));
  expect('Maand counts 30 most recent calendar dates incl. today, excluding day 31',()=>assert.equal(got('month'),63));
  expect('Alles retains all recorded days',()=>assert.equal(got('all'),127));
  expect('EV total, PV/Grid source and currency remain consistent',()=>{
   const m=dashboard.insights(app,'month');assert.equal(m.total.gridKwh,63);assert.equal(m.byId['1'].gridCost,63*.25);assert.equal(m.currency,'€');
  });
  expect('Historical savings state is unchanged by all four selectors',()=>{
    const before=JSON.stringify(app.savings);for(let n=0;n<10;n++)for(const key of ['day','week','month','all'])dashboard.insights(app,key);
    assert.equal(JSON.stringify(app.savings),before);
  });
 });
 runDate('2026-01-01',()=>{
  const app=environment('2026-01-01',{'2025-12-02':energy('2025-12-02',100),
    '2025-12-03':energy('2025-12-03',10),'2025-12-26':energy('2025-12-26',3),
    '2026-01-01':energy('2026-01-01',1)});
  expect('Month crosses year boundary but excludes day 31',()=>assert.equal(dashboard.insights(app,'month').byId['1'].gridKwh,14));
  expect('Week crosses year boundary',()=>assert.equal(dashboard.insights(app,'week').byId['1'].gridKwh,4));
 });
 runDate('2026-03-01',()=>{
  const app=environment('2026-03-01',{'2026-01-30':energy('2026-01-30',10),
    '2026-01-31':energy('2026-01-31',8),'2026-02-22':energy('2026-02-22',4),
    '2026-03-01':energy('2026-03-01',1)});
  expect('February-to-March month selector does not reset',()=>assert.equal(dashboard.insights(app,'month').byId['1'].gridKwh,13));
 });
 runDate('2026-10-25',()=>{
  const app=environment('2026-10-25',{'2026-10-18':energy('2026-10-18',4),
   '2026-10-19':energy('2026-10-19',3),'2026-10-24':energy('2026-10-24',2),
   '2026-10-25':energy('2026-10-25',1)});
  expect('DST switch does not move the 7 calendar-day window',()=>assert.equal(dashboard.insights(app,'week').byId['1'].gridKwh,6));
 });
 // Frontend enforces equal columns + no wrapping, and preserves original period translation keys.
 const widget=fs.readFileSync(path.join(__dirname,'../widgets/ev/public/index.html'),'utf8');
 expect('Both kilometre columns use equal grid fractions and independent responsive sizes',()=>{
  assert.match(widget,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(widget,/container-type:inline-size/);assert.match(widget,/white-space:nowrap;overflow-wrap:normal/);
  assert.match(widget,/--km-size:\$\{kmSize\(m\?\.solarKm\)\}/);
  assert.match(widget,/--km-size:\$\{kmSize\(m\?\.gridKm\)\}/);
 });
 expect('Original four period identifiers and translated labels remain unchanged',()=>{
  assert(widget.includes("['day','week','month','all'].map"));
  for(const lang of ['nl','en','fr','de','es']){
    const dict=require('../locales/'+lang+'.json').evWidget;
    for(const key of ['day','week','month','all'])assert(typeof dict[key]==='string' && dict[key].length>0,lang+'.'+key);
  }
 });
 expect('Font scaling stays responsive to long numbers without extra timers/polling',()=>{
  const script=widget.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const c=vm.createContext({document:{getElementById:()=>({})}});vm.runInContext(script.slice(0,script.indexOf('function button(')),c);
  const size=v=>Number(vm.runInContext(`kmSize(${v}).replace('cqi','')`,c));
  assert(size(1000000)<size(1000));assert(size(1000)<size(0));
 });
 console.log('EV rolling periods + responsive kilometres:',cases.length,'checks passed');
}catch(e){console.error(e.stack);process.exitCode=1;}finally{global.Date=RealDate;}
