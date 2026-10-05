'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { boot, DEFAULTS } = require('./startup-harness');
const { parseExternalPrices } = require('../lib/external-prices');
const { localParts } = require('../lib/homey-energy');
const { sourceOrder } = require('../lib/price-normalization');
const now = new Date('2026-10-04T12:00:00Z');
const start = Date.parse('2026-10-04T00:00:00Z');
const rows = (transform=p=>p, length=480, interval=15) => Array.from({length},(_,i)=> {
  const startMs=start+i*interval*60000, lp=localParts(new Date(startMs),'UTC');
  return {startMs,dateKey:lp.dateKey,minute:lp.minuteOfDay,price:transform(.10+(i%96)*.003)};
});
const permutations = values => values.length ? values.flatMap((value,index)=>permutations(values.filter((_,i)=>i!==index)).map(rest=>[value,...rest])) : [[]];

async function run() {
  for (const intervalMinutes of [15,60]) {
    const count=120*60/intervalMinutes;
    const numeric=JSON.stringify(Array.from({length:count+20},(_,i)=>.1+(i%24)*.01));
    const parsed=parseExternalPrices(numeric,{now,timezone:'UTC',intervalMinutes,period:'next_hours'});
    assert.equal(parsed.slots.length,count);
    assert.equal(parsed.slots.at(-1).startMs,now.getTime()+(count-1)*intervalMinutes*60000);
    const timestamps=JSON.stringify(Array.from({length:count+20},(_,i)=>({timestamp:now.getTime()+i*intervalMinutes*60000,price:.2})));
    assert.equal(parseExternalPrices(timestamps,{now,intervalMinutes}).slots.length,count);
    assert(parsed.slots.some(row=>row.startMs>now.getTime()+72*3600000));
  }
  assert.throws(()=>parseExternalPrices('[null, true]',{sequentialOnly:true}),/array of numbers/);
  assert.throws(()=>parseExternalPrices('{bad}'),/Invalid/);
  // DST transition days retain 23/25 hours (92/100 quarters).
  for(const [date,count] of [['2026-03-29T10:00:00Z',92],['2026-10-25T10:00:00Z',100]]) {
    assert.equal(parseExternalPrices(JSON.stringify(Array(count).fill(.2)),{now:new Date(date),timezone:'Europe/Brussels',period:'this_day'}).slots.length,count);
    assert.throws(()=>parseExternalPrices(JSON.stringify(Array(96).fill(.2)),{now:new Date(date),timezone:'Europe/Brussels',period:'this_day'}),/expects/);
  }
  const migrations={homey:['homey'],external:['external'],homey_external_fallback:['homey','external'],external_homey_fallback:['external','homey']};
  for(const [mode,expected] of Object.entries(migrations)) {
    const {app,store}=await boot(new Map([['settingsSchemaVersion',69],['dynamicPriceSource',mode]]));
    assert.deepEqual(store.get('dynamicPriceSources'),expected);
    assert.deepEqual(app.getSettings().dynamicPriceSources,expected);
    await app.migrateSettings();assert.deepEqual(store.get('dynamicPriceSources'),expected);
  }
  const {app,store,cards}=await boot();
  app.homey.clock.getTimezone=()=> 'UTC';
  app.homeyEnergy={available:true,slots:rows(p=>1.21*p+.12),lastUpdatedAt:now.getTime(),formulaKnown:true,formulaKey:'p*1.21+.12'};
  app.externalEnergy={slots:rows(),curveUpdatedAt:now.getTime()};
  app.externalEnergy2={slots:rows(p=>p*2+.03),curveUpdatedAt:now.getTime()};
  // Every source subset and priority order uses only its selected members.
  for(let mask=1;mask<8;mask++) {
    const selected=['homey','external','external2'].filter((_,index)=>mask&(1<<index));
    for(const order of permutations(selected)) {
      const settings={...DEFAULTS,contractType:'dynamic_quarter',dynamicPriceSources:order,timezone:'UTC'};
      let selection=app.getDynamicPriceSelection(settings,now);
      assert.equal(selection.source,order[0]);assert.deepEqual(selection.sources.map(item=>item.source),order);
      assert(selection.sources.every(item=>item.ready));
      if(order.length>1) {
        const state=order[0]==='homey'?app.homeyEnergy:order[0]==='external'?app.externalEnergy:app.externalEnergy2;
        const saved=state.slots;state.slots=[];
        app.homeyEnergyResampleCache=null;app.externalEnergyResampleCache=null;app.externalEnergy2ResampleCache=null;
        selection=app.getDynamicPriceSelection(settings,now);
        assert.equal(selection.source,order[1]);assert(selection.fallbackActive);
        assert.equal(selection.skippedSources[0].reason,'no_price_slots');
        state.slots=saved;
        app.homeyEnergyResampleCache=null;app.externalEnergyResampleCache=null;app.externalEnergy2ResampleCache=null;
      }
    }
  }
  let settings={...DEFAULTS,contractType:'dynamic_quarter',dynamicPriceSources:['external','external2','homey'],timezone:'UTC'};
  app.getDynamicPriceSelection(settings,now);
  app.externalEnergy.slots=[];app.externalEnergy2.slots=[];
  app.externalEnergyResampleCache=null;app.externalEnergy2ResampleCache=null;
  const lastFallback=app.getDynamicPriceSelection(settings,now);
  assert.equal(lastFallback.source,'homey');assert.equal(lastFallback.skippedSources.length,2);
  assert.equal(app.getDynamicPriceSelection({...settings,dynamicPriceSources:['external2']},now).source,'none');
  assert.equal(app.getDynamicPriceSelection({...settings,dynamicPriceSources:[]},now).source,'none');
  assert.deepEqual(sourceOrder('homey',['external2','external2','bad']),['external2']);
  const before=JSON.stringify([...store]);app.getDynamicPriceSelection(settings,now,{readOnly:true});assert.equal(JSON.stringify([...store]),before);
  // Exercise the actual new and deprecated listeners, atomic rejection and restart persistence.
  app.setSetting('contractType','dynamic_hour');app.setSetting('dynamicPriceSources',['external2','external']);
  app.requestContextEvaluate=()=>{};
  const liveNow=new Date(), future=Array.from({length:120},(_,i)=>({timestamp:liveNow.getTime()+i*3600000,price:.1+i*.001}));
  await cards.get('read_external_prices_json').listener({source:'external2',curve:JSON.stringify(future)});
  assert.equal(app.externalEnergy2.slots.length,120);assert.equal(app.externalEnergy.slots.length,0);
  await cards.get('set_pbth_electricity_price_curve').listener({period:'next_hours',curve:JSON.stringify(Array(120).fill(.2))});
  assert.equal(app.externalEnergy.slots.length,120);assert.equal(app.externalEnergy2.slots.length,120);
  const prior=JSON.stringify(app.externalEnergy2.slots);
  await assert.rejects(()=>cards.get('read_external_prices_json').listener({source:'external2',curve:'bad'}));
  assert.equal(JSON.stringify(app.externalEnergy2.slots),prior);
  await cards.get('set_external_electricity_price_curve').listener({curve:JSON.stringify(future.map(item=>({...item,price:.3})))});
  assert.equal(app.externalEnergy.slots[0].price,.3);assert.equal(app.externalEnergy2.slots[0].price,.1);
  const restarted=await boot(store);
  assert.equal(restarted.app.externalEnergy.slots.length,120);assert.equal(restarted.app.externalEnergy2.slots.length,120);
  const statusApi=require('../widgets/status/api');
  const status=await statusApi.getStatus({homey:{app}});
  assert.deepEqual(status.priceCurves.map(curve=>curve.source),['external2','external']);
  assert.equal(status.priceCurves[0].points.length,120);
  assert.equal(status.priceCurves[1].points.length,120);
  // Selecting a source does not populate it. Missing data remains explicit in
  // status, while a future-only curve is visible without becoming usable now.
  app.externalEnergy2.slots=[];app.externalEnergy2ResampleCache=null;
  const missingSource=await statusApi.getStatus({homey:{app}});
  assert.deepEqual(missingSource.priceData.sources.map(item=>item.source),['external2','external']);
  assert.equal(missingSource.priceData.sources[0].available,false);
  assert.equal(missingSource.priceData.sources[0].sourcePrice,null);
  assert.equal(missingSource.priceData.sources[0].reason,'no_price_slots');
  assert.deepEqual(missingSource.priceCurves.map(curve=>curve.source),['external']);
  app.externalEnergy2.slots=future.filter(item=>item.timestamp>liveNow.getTime()+3600000)
    .map(item=>{const lp=localParts(new Date(item.timestamp),'UTC');return {startMs:item.timestamp,dateKey:lp.dateKey,minute:lp.minuteOfDay,price:item.price};});
  app.externalEnergy2ResampleCache=null;
  const futureSource=await statusApi.getStatus({homey:{app}});
  assert.equal(futureSource.priceData.sources[0].available,false);
  assert.equal(futureSource.priceData.sources[0].reason,'no_current_price_slot');
  assert.deepEqual(futureSource.priceCurves.map(curve=>curve.source),['external2','external']);
  const manifest=require('../app.json');
  for(const id of ['set_external_electricity_price','set_external_electricity_price_curve','set_pbth_electricity_price_curve']) {
    assert.equal(manifest.flow.actions.find(card=>card.id===id).deprecated,true);assert(cards.get(id).listener);
  }
  assert(fs.readFileSync(require.resolve('../widgets/status/public/index.html'),'utf8').includes('showTertiaryPrice'));
  console.log('1.0.6 price-source tests passed: migration, 15 priority permutations, shared parser, 120h, DST, three-stage fallback, retained Flows, atomic import, restart persistence and widget curves');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
