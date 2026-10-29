'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const { boot, DEFAULTS } = require('./startup-harness');
const savings = require('../lib/savings'), history = require('../lib/savings-history');
const flow = require('../lib/savings-flow');
const { localDateTimeUtcMs } = require('../lib/homey-energy');
const cases = [];
const near = (a,b) => assert(Math.abs(a-b)<1e-8, `${a} != ${b}`);
async function check(name, fn) { await fn(); cases.push(name); }
function day(date='2026-10-29', extra={}) {
 const d=savings.emptyDay(date),inventory=savings.emptyInventory();
 for(let i=0;i<12;i++)savings.integrateInterval({day:d,inventory,seconds:300,pvW:5000,gridW:2000,batteryW:0,
  importPrice:.3,feedInPrice:.03,evs:[{id:'1',powerW:3000,coveredSeconds:300,scope:'individual'},
  {id:'2',powerW:4000,coveredSeconds:300,scope:'individual'}],...extra});
 return d;
}
async function main(){
 await check('EV categories match existing Insight energy, known cost and solar saving amounts',()=>{
  const d=day(),m=d.ev.total,settings={evConsumptionKwhPer100Km:15,ev2ConsumptionKwhPer100Km:20};
  for(const [category,kwh,value,available] of [
   ['ev_total',m.kwh,m.gridCost+m.solarValue,true],['ev_pv',m.pvKwh,m.solarValue,true],
   ['ev_grid',m.gridKwh,m.gridCost,true],['ev_battery',0,0,false],['ev_unknown',m.unknownKwh,0,false],
   ['ev_savings',m.pvKwh,m.solarSavings,true]]) {
   const r=flow.readCategory(d,category,{settings});near(r.kwh,kwh);near(r.value,value);
   assert.equal(r.value_available,available);assert(r.ev_data_available);
   near(r.solar_km,d.ev.byId['1'].pvKwh/15*100+d.ev.byId['2'].pvKwh/20*100);
   assert(r.solar_km_available);near(r.solar_share_percent,m.pvKwh/m.kwh*100);
  }
 });
 await check('EV 1–4 selection, retired slots and mixed-vehicle consumption remain separate',()=>{
  const d=day();const settings={evConsumptionKwhPer100Km:15,ev2ConsumptionKwhPer100Km:20};
  for(const id of ['1','2']) {
   const r=flow.readCategory(d,'ev_total',{ev:id,settings}),m=d.ev.byId[id];
   near(r.kwh,m.kwh);near(r.value,m.gridCost+m.solarValue);
   near(r.solar_km,m.pvKwh/settings[id==='1'?'evConsumptionKwhPer100Km':'ev2ConsumptionKwhPer100Km']*100);
  }
  const fourth=day('2026-10-28',{evs:[{id:'4',powerW:7000,coveredSeconds:300,scope:'individual'}]});
  near(flow.readCategory(history.expandDay(history.compactDay(fourth,fourth.date)),'ev_total',{ev:'4',settings:{ev4ConsumptionKwhPer100Km:18}}).kwh,7);
  assert.throws(()=>flow.readCategory(d,'ev_total',{ev:'5'}));
 });
 await check('Legacy/missing EV records are unavailable; recorded zero remains a valid zero',()=>{
  for(const d of [savings.emptyDay('2026-10-28'),day('2026-10-29',{evs:[{id:'1',powerW:0,coveredSeconds:0,scope:'individual'}]})]) {
   const r=flow.readCategory(d,'ev_total',{ev:'1'});assert(!r.ev_data_available);assert(!r.value_available);
   for(const format of ['kwh','kwh_price','price'])assert.equal(flow.formatResult(r,format,'€','nl'),'Geen EV-gegevens');
  }
  const stopped=day('2026-10-29',{evs:[{id:'1',powerW:0,coveredSeconds:300,scope:'individual'}]});
  const r=flow.readCategory(stopped,'ev_total',{ev:'1',settings:{evConsumptionKwhPer100Km:18}});
  assert(r.ev_data_available);assert(r.value_available);near(r.kwh,0);assert.equal(flow.formatResult(r,'price','€','nl'),'€ 0,00');
 });
 await check('Shared energy is counted once, unproven battery energy stays unknown and km need a reliable conversion',()=>{
  const shared=day('2026-10-29',{evs:[{id:'1',powerW:7000,coveredSeconds:300,scope:'shared'},
   {id:'2',powerW:0,coveredSeconds:300,scope:'individual'}]});
  const all=flow.readCategory(shared,'ev_total',{settings:{evConsumptionKwhPer100Km:18,ev2ConsumptionKwhPer100Km:20}});
  near(all.kwh,7);assert(!all.solar_km_available);assert(!flow.hasEvData(shared,'1'));
  const battery=day('2026-10-29',{pvW:3000,gridW:0,batteryW:4000});
  near(flow.readCategory(battery,'ev_unknown').kwh,4);near(flow.readCategory(battery,'ev_battery').kwh,0);
  assert(!flow.readCategory(day(),'ev_total',{ev:'1',settings:{evConsumptionKwhPer100Km:0}}).solar_km_available);
 });
 await check('Negative prices and missing tariff coverage preserve existing financial meaning',()=>{
  const d=day('2026-10-29',{importPrice:-.15,feedInPrice:-.02});
  near(flow.readCategory(d,'ev_total').value,-.4);near(flow.readCategory(d,'ev_savings').value,-.65);
  assert.equal(flow.formatResult(flow.readCategory(d,'ev_total'),'kwh_price','$','en'),'7 kWh · $ -0.40');
  const unpriced=day('2026-10-29',{evPriceKnown:false});near(flow.readCategory(unpriced,'ev_total').value,.15);
  near(unpriced.ev.total.unpricedKwh,7);
 });
 const nativeNow=Date.now;let now=localDateTimeUtcMs('2026-10-29','12:00','Europe/Brussels');Date.now=()=>now;
 try {
  const h=await boot(new Map(Object.entries({...DEFAULTS,settingsSchemaVersion:71,evCount:0,controlEnabled:false}))),a=h.app;
  assert.deepEqual(h.errors,[]);let samples=0;a.recordSavingsSample=()=>{samples++;};
  a.savings.today=day();a.savings.history={'2026-10-28':history.compactDay(day('2026-10-28'),'2026-10-28'),
   '2026-10-27':history.compactDay({directPvValue:4},'2026-10-27')};
  const run=h.cards.get('get_savings_category').listener;
  await check('Actual Flow handler aggregates daily EV data, exposes gaps and keeps all three formats',async()=>{
   const before=JSON.stringify(a.savings);
   const all=await run({category:'ev_total',count:3,unit:'days',format:'kwh_price'});
   near(all.kwh,14);near(all.value,1.5);assert.equal(all.available_days,2);assert(!all.complete);assert(!all.ev_data_complete);
   assert(all.result.includes('14 kWh'));assert(all.result.includes('€ 1.50'));
   const single=await run({category:'ev_total',ev:'1',count:3,unit:'days',format:'price'});
   near(single.kwh,6);assert(!single.result.includes('kWh'));
   const missing=await run({category:'ev_total',ev:'3',count:3,unit:'days',format:'kwh'});
   assert.equal(missing.result,'No EV data');assert.equal(missing.available_days,0);assert(!missing.ev_data_available);
   assert.equal(JSON.stringify(a.savings),before);assert.equal(samples,3);
  });
  await check('Flow values match the existing widget Insight reader for the same day',async()=>{
   const insight=require('../lib/ev-dashboard').insights(a,'day');
   for(const ev of ['all','1','2']) {
    const r=await run({category:'ev_total',ev,count:1,unit:'days',format:'kwh'});
    const m=ev==='all'?insight.total:insight.byId[ev];
    near(r.kwh,m.kwh);near(r.value,m.gridCost+m.solarValue);
   }
  });
  await check('Complete coverage, partial prices/unknown source and calibrated current-day readings',async()=>{
   a.savings.today.ev.seconds=43200;
   const good=await run({category:'ev_total',ev:'1',count:1,unit:'days',format:'kwh'});assert(good.ev_data_complete);
   a.savings.today.importedEnergyKnown=true;a.savings.today.importedEnergyKwh=1;
   const calibrated=await run({category:'ev_grid',count:1,unit:'days',format:'price'});
   near(calibrated.kwh,1);near(calibrated.value,.3);assert(!calibrated.ev_data_complete);
   a.savings.today.importedEnergyKnown=false;a.savings.today.ev.total.unpricedKwh=7;
   assert(!(await run({category:'ev_total',count:1,unit:'days',format:'price'})).ev_data_complete);
  });
  await check('Existing categories, arguments and result tokens stay compatible; EV choice is ignored outside EV categories',async()=>{
   const manifest=JSON.parse(fs.readFileSync('app.json'));
   const card=JSON.parse(fs.readFileSync('.homeycompose/flow/actions/get_savings_category.json'));
   assert.deepEqual(manifest.flow.actions.find(c=>c.id==='get_savings_category'),{id:'get_savings_category',...card});
   assert.deepEqual(card.args.find(x=>x.name==='format').values.map(v=>v.id),['kwh','kwh_price','price']);
   assert.equal(card.args.find(x=>x.name==='ev').values.length,5);
   for(const category of card.args[0].values.filter(v=>!flow.isEvCategory(v.id))) {
    const first=await run({category:category.id,count:2,unit:'days',format:'kwh_price'});
    const ev=await run({category:category.id,count:2,unit:'days',format:'kwh_price',ev:'4'});
    assert.deepEqual(first,ev);assert(!first.ev_data_available);
    for(const token of card.tokens)assert.equal(typeof first[token.name],{number:'number',boolean:'boolean',string:'string'}[token.type],token.name);
   }
  });
 } finally {Date.now=nativeNow;}
 console.log(`EV Savings Flow: ${cases.length} targeted regression groups passed.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
