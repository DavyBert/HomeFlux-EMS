'use strict';
const { installVirtualDate } = require('./helpers/virtual-date.cjs');
const restoreDate = installVirtualDate();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const I = require('../lib/active-injection');
const Q = require('../lib/injection-economics');
const S = require('../lib/savings');
const { localParts, localDateTimeUtcMs } = require('../lib/homey-energy');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const at = Date.parse('2026-11-09T14:05:00Z');
const originalNow = Date.now, restore = installVirtualClearTimeout();
let checks = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const near = (actual, expected, label) => { assert(actual !== null && Math.abs(actual - expected) < 1e-8, label || `${actual} != ${expected}`); checks++; };
const rejected = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++; };
async function fresh(extra = {}, start = at) {
  const h = await setup(undefined, { injectionEnabled: true, injectionAutomaticEnabled: false,
    injectionPriceDifferenceEnabled: true, fixedImportPrice: .50, injectionExportCost: 0,
    totalCapacityKwh: 20, peakShaveEnabled: false, exportLimitEnabled: false,
    optimizeMultiBatteryEfficiency: false, ...extra }, start, 0);
  await h.drain();
  h.app.requestContextEvaluate = () => {}; h.app.requestEvaluate = () => {};
  h.app.state.batterySoc.fill(60);
  equal(h.errors, [], 'clean startup');
  return h;
}
const quote = (h, price = .90) => I.feed(h.app, { price, currency: 'EUR', unit: 'kWh', minutes: 15 }, h.now());
function refresh(h) { h.app.inputUpdatedAt.grid = h.now(); h.app.inputUpdatedAt.batterySoc.fill(h.now()); }
function rows(day = '2026-11-09', interval = 15, price = .95) {
  const start = localDateTimeUtcMs(day, '00:00', 'Europe/Brussels');
  return Array.from({ length: 1440 / interval }, (_, index) => {
    const startMs = start + index * interval * 60000, parts = localParts(new Date(startMs), 'Europe/Brussels');
    return { startMs, dateKey: parts.dateKey, minute: parts.minuteOfDay, price: index === 1 ? .30 : price };
  });
}
function seed(h, source, slots) {
  const a = h.app, input = source === 'homey' ? a.homeyEnergy : source === 'external2' ? a.externalEnergy2 : a.externalEnergy;
  Object.assign(input, { slots, available: true, lastUpdatedAt: h.now(), curveUpdatedAt: h.now() });
  a.getEffectiveDynamicSlots(a.getSettings(), new Date(h.now()));
}
const tou = {
  contractType: 'tou',
  touRates: [{ id: 'low', name: 'Night', importPrice: .50 }, { id: 'high', name: 'Day', importPrice: .90 }, { id: 'unused', name: 'Weekend', importPrice: .01 }],
  touSchedule: [{ rateId: 'low', start: '00:00', end: '07:00', days: [1,2,3,4,5] },
    { rateId: 'high', start: '07:00', end: '00:00', days: [1,2,3,4,5] },
    { rateId: 'unused', start: '00:00', end: '00:00', days: [6,7] }],
};
(async () => { try {
  equal(I.defaults.injectionPriceDifferenceEnabled, false);
  equal(I.defaults.injectionMinimumPriceDifference, .20);
  equal(I.defaults.injectionSolarOverrideEnabled, false);
  equal(I.defaults.injectionMinimumSolarSharePercent, 50);
  // Disabled gates do not inspect input, inventory, calendars or sources.
  const untouched = new Proxy({}, { get() { throw Error('disabled gate accessed app'); } });
  equal(Q.evaluate(untouched, { injectionPriceDifferenceEnabled: false, injectionSolarOverrideEnabled: true, injectionMinimumPriceDifference: NaN }, null), { enabled: false, allowed: true, reason: '' });
  equal(Q.validSettings({ injectionPriceDifferenceEnabled: false, injectionMinimumPriceDifference: -1 }), true);
  let h = await fresh({ injectionPriceDifferenceEnabled: false, fixedImportPrice: .80 }), a = h.app;
  await I.start(a); equal(a.injectionRuntime.active, true); equal(I.status(a).economic.enabled, false);
  I.stop(a); await h.drain();

  // Strict numeric boundary, no floating-point accidental approval at equality.
  for (const [buy, sell, allowed] of [[.50,.70,false], [.70,.90,false], [.50,.701,true], [.80,.90,false], [.50,.90,true]]) {
    h = await fresh({ fixedImportPrice: buy }); a = h.app; quote(h, sell);
    equal(I.economicCondition(a,a.getSettings(),I.refreshPrice(a,a.getSettings(),h.now()),h.now()).allowed, allowed);
    if (allowed) { await I.start(a); equal(a.injectionRuntime.active,true); I.stop(a); await h.drain(); }
    else await rejected(() => I.start(a), /prijsverschil/);
  }
  // With a fixed import-based fallback the difference is never positive.
  h = await fresh({ fixedImportPrice: .90, injectionExportCost: .10 }); a = h.app;
  near(I.status(a).economic.difference, -.10);
  await rejected(() => I.start(a), /prijsverschil/);
  // Existing gross start threshold remains unchanged; the new difference is NET.
  h = await fresh({ ...tou, injectionExportCost: .20 }); a = h.app;
  near(I.status(a).comparisonPrice, .90); near(I.status(a).price, .70);
  near(I.status(a).economic.minimumImportPrice, .50);
  await rejected(() => I.start(a), /prijsverschil/);
  await h.setExternalSetting('injectionExportCost', .19);
  near(I.status(a).economic.difference, .21); await I.start(a); I.stop(a); await h.drain();
  quote(h, .71); near(I.status(a).economic.difference, .21); // Flow is already net; no second fee.
  await I.start(a); I.stop(a); await h.drain();

  // Today's REAL scheduled rates, including elapsed periods and midnight spill.
  h = await fresh(tou); a = h.app; near(I.status(a).economic.minimumImportPrice,.50);
  const overnight = { ...a.getSettings(), touRates: [{id:'sun',importPrice:.20},{id:'mon',importPrice:.90}],
    touSchedule: [{rateId:'sun',start:'22:00',end:'02:00',days:[7]}, {rateId:'mon',start:'02:00',end:'00:00',days:[1]}] };
  near(Q.lowestImportToday(a,overnight,h.now()),.20,'previous-day overnight tariff counts for today');
  const overlap = { ...overnight, touSchedule:[{rateId:'mon',start:'00:00',end:'00:00',days:[1]},...overnight.touSchedule] };
  near(Q.lowestImportToday(a,overlap,h.now()),.90,'shadowed low rate is not a usable daily price');
  const legacy = { ...a.getSettings(), touRates:[],touSchedule:[],touTariffs:[{name:'Old',start:'00:00',end:'00:00',days:[1],importPrice:.40}] };
  near(Q.lowestImportToday(a,legacy,h.now()),.40);
  for (const day of ['2026-03-29','2026-10-25']) {
    const now = Date.parse(day+'T12:00:00Z');
    near(Q.lowestImportToday(a,{...a.getSettings(),touRates:[{id:'low',importPrice:.21},{id:'high',importPrice:.99}],
      touSchedule:[{rateId:'low',start:'00:00',end:'04:00',days:[7]},{rateId:'high',start:'04:00',end:'00:00',days:[7]}]},now),.21,'DST local calendar day');
  }
  // A settings replacement invalidates the single-day memo immediately.
  await h.setExternalSetting('touRates',tou.touRates.map(rate=>({...rate,importPrice:rate.id==='low'?.55:rate.importPrice})));
  near(I.status(a).economic.minimumImportPrice,.55);

  // Actual normalized source selection for all dynamic contract/source combinations.
  for (const contractType of ['dynamic','dynamic_hour','dynamic_quarter']) for (const source of ['homey','external','external2']) {
    h = await fresh({contractType,dynamicPriceSources:[source]}); a=h.app;
    const slots=rows('2026-11-09',contractType==='dynamic_hour'?60:15);
    slots.unshift({dateKey:'2026-11-08',minute:0,price:-1,startMs:Date.parse('2026-11-07T23:00:00Z')});
    slots.push({dateKey:'2026-11-10',minute:0,price:-2,startMs:Date.parse('2026-11-09T23:00:00Z')});
    seed(h,source,slots);quote(h);
    near(I.status(a).economic.minimumImportPrice,.30,'do not use tomorrow or yesterday');
    near(I.status(a).economic.difference,.60); await I.start(a); I.stop(a); await h.drain();
    seed(h,source,rows('2026-11-09',contractType==='dynamic_hour'?60:15).map(row=>({...row,price:.80})));
    near(I.status(a).economic.minimumImportPrice,.80,'same-day curve replacement invalidates memo');
    await rejected(()=>I.start(a),/prijsverschil/);
  }
  h=await fresh({contractType:'dynamic_quarter',dynamicPriceSources:['homey']});a=h.app;quote(h);
  await rejected(()=>I.start(a),/Laagste inkoopprijs/);
  seed(h,'homey',rows());quote(h);await I.start(a);
  a.homeyEnergy.lastUpdatedAt=h.now()-1200001;
  equal(I.status(a).economic.minimumImportPrice,null,'stale Homey curve cannot support the condition');
  I.tick(a,a.getSettings(),h.now(),false);await h.drain();equal(I.locked(a),false);

  // Calibrated fallback minima use normalized prices, never raw market prices.
  h=await fresh({contractType:'dynamic_quarter',dynamicPriceSources:['homey','external2']});a=h.app;
  const raw=rows().map((row,index)=>({...row,price:.30+index*.002}));
  Object.assign(a.homeyEnergy,{slots:raw.map(row=>({...row,price:row.price*1.21+.12})),available:true,lastUpdatedAt:h.now(),formulaKnown:true,formulaKey:'p*1.21+.12'});
  Object.assign(a.externalEnergy2,{slots:raw,curveUpdatedAt:h.now()});
  a.getEffectiveDynamicSlots(a.getSettings(),new Date(h.now()));
  a.homeyEnergy.slots=[];a.homeyEnergyResampleCache=null;
  a.getEffectiveDynamicSlots(a.getSettings(),new Date(h.now()));quote(h);
  equal(a.evDeadlinePriceSelection.selection.source,'external2');
  near(I.status(a).economic.minimumImportPrice,.30*1.21+.12);
  const snapshots=JSON.stringify([...h.store]);
  for(let read=0;read<100;read++)I.status(a);
  equal(JSON.stringify([...h.store]),snapshots,'repeated price/stock reads never persist settings');
  // A negative daily low remains a legitimate price, not zero or missing.
  h=await fresh({contractType:'dynamic_quarter',dynamicPriceSources:['external']});a=h.app;
  seed(h,'external',rows().map((row,index)=>({...row,price:index===0?-.15:.80})));quote(h,.90);
  near(I.status(a).economic.minimumImportPrice,-.15);near(I.status(a).economic.difference,1.05);
  await I.start(a);I.stop(a);await h.drain();

  // Reuse stock, not daily PV charging, with exact thresholds and unknown energy.
  for (const [inventory,share,allowed] of [
    [{pvKwh:6,unknownKwh:0,grid:{grid:{kwh:6,cost:4}}},50,false],
    [{pvKwh:6.12,unknownKwh:0,grid:{grid:{kwh:5.88,cost:4}}},51,true],
    [{pvKwh:6,unknownKwh:6,grid:{}},50,false],
    [{pvKwh:1,unknownKwh:0,grid:{}},100/12,false],
    [{pvKwh:0,unknownKwh:0,grid:{}},0,false],
    [{pvKwh:8,unknownKwh:0,grid:{grid:{kwh:4,cost:4}}},100*2/3,true],
  ]) {
    h=await fresh({injectionSolarOverrideEnabled:true,fixedImportPrice:.80});a=h.app;quote(h);
    a.savings.inventory=structuredClone(inventory);a.savings.today.pvChargeKwh=0;
    const before=JSON.stringify(a.savings.inventory);
    near(I.status(a).economic.solarSharePercent,share);equal(I.status(a).economic.allowed,allowed);
    equal(I.status(a).economic.solarOverrideUsed,allowed);
    equal(JSON.stringify(a.savings.inventory),before,'read-only origin calculation');
    if(allowed){await I.start(a);I.stop(a);await h.drain();}else await rejected(()=>I.start(a),/prijsverschil/);
  }
  h=await fresh({injectionSolarOverrideEnabled:true,fixedImportPrice:.80,injectionMinimumSolarSharePercent:70});a=h.app;quote(h);
  a.savings.inventory={pvKwh:8,unknownKwh:0,grid:{g:{kwh:4,cost:4}}};
  await rejected(()=>I.start(a),/prijsverschil/);
  await h.setExternalSetting('injectionMinimumSolarSharePercent',60);
  await I.start(a);I.stop(a);await h.drain();
  // PV exception never overrides the original minimum, permission, SoC or P1.
  quote(h,.69);await rejected(()=>I.start(a),/onder minimum/);
  quote(h,.90);a.inputUpdatedAt.grid=h.now()-120000;await rejected(()=>I.start(a),/verse netmeting/);
  refresh(h);a.state.batterySoc.fill(40);await rejected(()=>I.start(a),/SoC/);
  a.state.batterySoc.fill(60);await h.setExternalSetting('injectionEnabled',false);await rejected(()=>I.start(a),/niet toegestaan/);

  // The same inventory survives rollover and the existing persistence/restore.
  h=await fresh({injectionSolarOverrideEnabled:true,fixedImportPrice:.80});a=h.app;
  a.savings.inventory=S.emptyInventory();
  const previous=S.emptyDay('2026-11-08');
  for(let sample=0;sample<12;sample++)S.integrateInterval({day:previous,inventory:a.savings.inventory,seconds:300,gridW:0,pvW:8000,batteryW:-8000,importPrice:.30,capacityKwh:20});
  for(let sample=0;sample<12;sample++)S.integrateInterval({day:previous,inventory:a.savings.inventory,seconds:300,gridW:4000,pvW:0,batteryW:-4000,importPrice:.30,capacityKwh:20});
  a.savings.today=previous;a.archiveSavingsDay('2026-11-09');
  equal(a.savings.today.pvChargeKwh,0);near(a.savings.inventory.pvKwh,8);
  a.persistSavingsState(h.now(),true);const saved=structuredClone(a.savings.inventory);
  a.savings.inventory=S.emptyInventory();a.restoreSavingsState();equal(a.savings.inventory,saved);
  quote(h);await I.start(a);equal(I.status(a).economic.solarOverrideUsed,true);
  // A new grid charge dilutes the remaining stock. Recheck before publication.
  const obsolete={...a.latestResult,injectionActive:true,injectionTargetW:3000,canPublishCommands:true};
  for(let sample=0;sample<12;sample++)S.integrateInterval({day:a.savings.today,inventory:a.savings.inventory,seconds:300,gridW:6000,pvW:0,batteryW:-6000,importPrice:.80,capacityKwh:20});
  a.state.batterySoc.fill(90);
  near(I.status(a).economic.solarSharePercent,100*8/18);
  equal(I.validPublication(a,obsolete,a.getSettings()),false);
  I.tick(a,a.getSettings(),h.now(),false);await h.drain();equal(I.locked(a),false);
  equal(a.lastEmittedCommands.every(x=>x===0),true,'real shared publisher zeroes rejected export');

  // Solar-only evidence cannot manufacture a missing daily price unless opt-in
  // is enabled; it still requires the original current export price and SoC.
  h=await fresh({contractType:'dynamic_quarter',injectionSolarOverrideEnabled:true});a=h.app;quote(h);
  a.savings.inventory={pvKwh:8,unknownKwh:0,grid:{g:{kwh:4,cost:4}}};
  await I.start(a);equal(I.status(a).economic.minimumImportPrice,null);I.stop(a);await h.drain();
  a.inputUpdatedAt.batterySoc.fill(h.now()-600001);equal(I.status(a).economic.solarSharePercent,null);
  await rejected(()=>I.start(a),/SoC/);

  // New local day, not UTC midnight; no stale minimum from yesterday.
  h=await fresh({contractType:'dynamic_quarter',dynamicPriceSources:['external']});a=h.app;
  seed(h,'external',rows().concat(rows('2026-11-10').map(row=>({...row,price:.85}))));quote(h);
  near(I.status(a).economic.minimumImportPrice,.30);
  h.setNow(Date.parse('2026-11-09T23:00:00Z'));refresh(h);quote(h);
  near(I.status(a).economic.minimumImportPrice,.85);await rejected(()=>I.start(a),/prijsverschil/);

  // Enabled gate applies to the real mode Flow and retains Automatic on refusal.
  h=await fresh({fixedImportPrice:.85});a=h.app;quote(h);
  await rejected(()=>h.cards.get('set_forced_mode').listener({mode:'injection'}),/prijsverschil/);
  equal(a.getEmsControlMode(),'auto');
  quote(h,1.10);await h.cards.get('set_forced_mode').listener({mode:'injection'});
  equal(a.getEmsControlMode(),'injection');I.stop(a);await h.drain();equal(a.getEmsControlMode(),'auto');
  // Automatic path + fresh Flow at an exact quarter, including price-stop rearm.
  h=await fresh({fixedImportPrice:.50,injectionAutomaticEnabled:true});a=h.app;quote(h,.90);
  I.tick(a,a.getSettings(),h.now(),true);await h.drain();equal(a.injectionRuntime.active,true);
  quote(h,.70);await h.drain();equal(I.locked(a),false); // exact .20 margin rejects
  h.setNow(Math.ceil(h.now()/900000)*900000);refresh(h);quote(h,.90);
  I.tick(a,a.getSettings(),h.now(),true);await h.drain();equal(a.injectionRuntime.active,true);
  I.stop(a);await h.drain();quote(h,1.20);I.tick(a,a.getSettings(),h.now(),true);await h.drain();
  equal(I.locked(a),false,'price/solar gates do not bypass a manual stop latch');

  for (const [key,value] of [['injectionMinimumPriceDifference',-1],['injectionMinimumPriceDifference',NaN],['injectionMinimumPriceDifference',101],['injectionMinimumSolarSharePercent',-1],['injectionMinimumSolarSharePercent',101]]) {
    h=await fresh({injectionSolarOverrideEnabled:true,[key]:value});quote(h);
    await rejected(()=>I.start(h.app),/Ongeldige injectie/);
  }
  const code=fs.readFileSync(require.resolve('../lib/injection-economics'),'utf8');
  equal(/setInterval\s*\(|setTimeout\s*\(|\.on\s*\(|homey\.settings\.set/.test(code),false,'no new timer, listener, ledger write or polling');
  console.log(`Injection economics 1.3.1: ${checks} checks passed.`);
} finally { Date.now=originalNow;restore();restoreDate(); } })().catch(error=>{console.error(error.stack);process.exitCode=1;});
