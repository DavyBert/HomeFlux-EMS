'use strict';
const assert=require('node:assert/strict');
const {boot,DEFAULTS}=require('./startup-harness');
const {emptyDay,emptyInventory}=require('../lib/savings');
const {empty}=require('../lib/ev-energy-breakdown');
const {compactDay}=require('../lib/savings-history');
const {insights}=require('../lib/ev-dashboard');
const api=require('../widgets/status/api');
const nativeNow=Date.now;let now=Date.parse('2026-11-15T16:12:00Z');Date.now=()=>now;
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let checks=0;
const evDay=(date,id,metric)=>({...emptyDay(date),ev:{version:1,seconds:3600,sharedKwh:0,total:{...empty(),...metric},byId:{[id]:{...empty(),...metric}}}});
async function fixture(){
 const h=await boot(new Map(Object.entries({...DEFAULTS,settingsSchemaVersion:71,controlEnabled:false,
  contractType:'fixed',evCount:1,evEnabled:true,evConsumptionKwhPer100Km:18,ev2ConsumptionKwhPer100Km:20})));
 const a=h.app;a.recordSavingsSample=()=>{};a.getSavingsDateKey=()=>'2026-11-15';
 a.savings={today:emptyDay('2026-11-15'),history:{'2026-11-14':compactDay(evDay('2026-11-14','1',{
  kwh:361.3,pvKwh:12.8,gridKwh:343.9,unknownKwh:4.6,gridCost:94.41,solarSavings:3.58}),'2026-11-14')},inventory:emptyInventory(),total:0};
 a.getPublicStatus=()=>({version:'1.5.6',decisionText:'EMS live',priceData:{sources:[]},settings:{evCount:a.getEvCount()},evs:[{instance:1,enabled:true,connected:false}]});
 return a;
}
const status=a=>api.getStatus({homey:{app:a},query:{visualSavings:'1'}});
async function test(name,run){await run();checks++;console.log('PASS',name);}
(async()=>{try{
 const a=await fixture();const response=await status(a);
 await test('The single house/status payload includes all five EV periods and every configured selection',()=>{
  assert.deepEqual(Object.keys(response.visualSavings.evPeriods),['day','week','month','year','total']);
  for(const rows of Object.values(response.visualSavings.evPeriods))assert.deepEqual(Object.keys(rows),['1','all']);
  assert.equal(response.visualEvSavings,undefined,'no separate selected-EV status path');
 });
 await test('Disconnected BMW monthly values match the established EV reader and Savings categories',()=>{
  const got=response.visualSavings.evPeriods.month.all;const m=insights(a,'month').byId['1'];
  near(got.value,3.58);near(got.gridCost,94.41);near(got.kwh,12.8);near(got.gridKwh,343.9);
  near(got.kwh,m.pvKwh);near(got.gridKwh,m.gridKwh);near(got.solar_km,12.8/18*100);
  for(const [period,days] of Object.entries({day:1,week:7,month:30,year:365,total:1827})){
   for(const ev of ['all','1']){
    const expected=a.getSavingsCategory({category:'ev_savings',ev,count:days,unit:'days'});
    const row=response.visualSavings.evPeriods[period][ev];near(row.kwh,expected.kwh);near(row.value,expected.value);
    assert.equal(row.ev_data_available,expected.ev_data_available);
   }
  }
 });
 await test('Multiple EVs have independent values and a correct all-EV total in the same response',async()=>{
  const app=await fixture();app.settingsCache.evCount=2;
  app.savings.history['2026-11-13']=compactDay(evDay('2026-11-13','2',{kwh:10,pvKwh:2,gridKwh:8,gridCost:2.4,solarSavings:.6}),'2026-11-13');
  const rows=(await status(app)).visualSavings.evPeriods.month;
  near(rows.all.value,rows['1'].value+rows['2'].value);near(rows.all.value,4.18);near(rows.all.gridCost,96.81);
  near(rows['2'].solar_km,10);
 });
 await test('Missing data remains unavailable; a recorded zero and negative costs are preserved',async()=>{
  const app=await fixture();app.savings.history={};
  assert.equal((await status(app)).visualSavings.evPeriods.day['1'].ev_data_available,false);
  app.savings.today=evDay('2026-11-15','1',{});now+=60001;
  let row=(await status(app)).visualSavings.evPeriods.day['1'];assert(row.ev_data_available);near(row.value,0);near(row.gridCost,0);
  app.savings.today=evDay('2026-11-15','1',{kwh:2,gridKwh:2,gridCost:-.4,solarSavings:-.1});now+=60001;
  row=(await status(app)).visualSavings.evPeriods.day['1'];near(row.gridCost,-.4);near(row.value,-.1);
 });
 await test('Classic status skips EV aggregation, the minute cache is reused, and the ledger is read-only',async()=>{
  const app=await fixture();const before=JSON.stringify(app.savings);const classic=await api.getStatus({homey:{app}});
  assert.equal(classic.visualSavings,undefined);
  const first=await status(app),second=await status(app);assert.strictEqual(first.visualSavings,second.visualSavings);
  assert.equal(JSON.stringify(app.savings),before);
  now+=60001;const later=await status(app);assert.notStrictEqual(later.visualSavings,first.visualSavings);
  app.settingsCache.evConsumptionKwhPer100Km=20;
  const changed=await status(app);near(changed.visualSavings.evPeriods.month['1'].solar_km,64);
 });
 await test('EV aggregation failure cannot remove independently valid house periods or EMS status',async()=>{
  const app={getPublicStatus:()=>({decisionText:'EMS live',priceData:{sources:[]}}),getSettings:()=>({evCount:1}),
   getSavingsStatus:()=>({periodSavings:1}),savingsHistoryCache:{sum(){throw new Error('EV fixture unavailable')}}};
  const result=await status(app);assert.equal(result.decisionText,'EMS live');near(result.visualSavings.periods.month.periodSavings,1);
  assert.match(result.visualSavings.evErrors.month,/fixture unavailable/);
 });
 await test('No configured EV does not trigger extra EV history reads',async()=>{
  const app=await fixture();app.settingsCache.evCount=0;let reads=0;app.getSavingsStatus=()=>({periodSavings:1});
  app.savingsHistoryCache={sum(){reads++;throw new Error('unexpected EV read')}};
  const result=await status(app);assert.equal(reads,0);assert.deepEqual(result.visualSavings.evPeriods.month,{});
 });
 console.log(`Visual EV Savings 1.5.6: ${checks} groups passed`);
}finally{Date.now=nativeNow;}})().catch(e=>{console.error(e.stack);process.exitCode=1});
