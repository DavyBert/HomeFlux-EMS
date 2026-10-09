'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {boot,DEFAULTS}=require('./startup-harness');
const {fitCalibration,normalizeSecondary,MAX_AGE_MS}=require('../lib/price-normalization');
const {sourceName}=require('../lib/price-source-names');
const {localParts}=require('../lib/homey-energy');
const {parseExternalPrices}=require('../lib/external-prices');
const repeatedHourFixture=require('./fixtures/repeated-hour-prices-1.0.6.json');
const now=new Date('2026-10-04T12:00:00Z'),start=Date.parse('2026-10-04T00:00:00Z');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function rows(transform=p=>p,count=480,interval=15,at=start,timezone='UTC') {
 return Array.from({length:count},(_,i)=>{const startMs=at+i*interval*60000,lp=localParts(new Date(startMs),timezone);return {startMs,dateKey:lp.dateKey,minute:lp.minuteOfDay,price:transform(-.05+(i%96)*.003,i)};});
}
function pureTests() {
 const original=rows(),primary=rows(p=>1.21*p+.12),before=JSON.stringify(original);
 const divergentFuture=original.map((r,i)=>({...r,price:i<96?r.price:r.price+Math.sin(i)*.03}));
 const fit=fitCalibration(primary,divergentFuture,now.getTime());
 assert.equal(fit.reason,'ready');close(fit.model.scale,1.21);close(fit.model.offset,.12);
 assert.equal(fit.details.samples,96);assert.equal(fit.details.totalOverlapSamples,480);
 assert.equal(JSON.stringify(original),before);
 const oneOutlier=original.map((r,i)=>({...r,price:i===20?r.price+.5:r.price}));
 const robust=fitCalibration(primary,oneOutlier,now.getTime());
 assert.equal(robust.reason,'ready');close(robust.model.scale,1.21);assert.equal(robust.details.outliers,1);
 assert.equal(normalizeSecondary(oneOutlier,robust.model).length,479,'known outlier is excluded only from internal planning rows');
 assert.equal(oneOutlier.length,480);assert.equal(oneOutlier[20].price,original[20].price+.5);
 const unrelated=rows((p,i)=>.1+((i*37)%96)*.006);
 assert.equal(fitCalibration(primary,unrelated,now.getTime()).reason,'incompatible_curves');
 assert.equal(fitCalibration(primary.slice(0,3),original.slice(0,3),now.getTime()).reason,'insufficient_overlap');
 assert.equal(fitCalibration(rows(()=>.2),rows(()=>.1),now.getTime()).reason,'insufficient_variation');
 // Hourly values represent the average of changing quarters, not each quarter.
 const hourly=Array.from({length:24},(_,h)=>{const group=original.slice(h*4,h*4+4);return {...group[0],price:group.reduce((s,r)=>s+r.price,0)/4};});
 const mixed=fitCalibration(hourly.map(r=>({...r,price:r.price*1.21+.12})),original,now.getTime());
 assert.equal(mixed.reason,'ready');close(mixed.model.scale,1.21);assert.equal(mixed.model.samples,24);
 const reverse=fitCalibration(original,hourly.map(r=>({...r,price:r.price*1.21+.12})),now.getTime());
 assert.equal(reverse.reason,'ready');close(reverse.model.scale,1/1.21);
 // Local date/time-only inputs use Brussels time; explicit timestamps win.
 const belgian=rows(p=>p,96,15,Date.parse('2026-10-03T22:00:00Z'),'Europe/Brussels');
 const localOnly=belgian.map(({startMs,...r})=>r);
 const localFit=fitCalibration(belgian.map(r=>({...r,price:r.price*1.1+.03})),localOnly,now.getTime(),{timezone:'Europe/Brussels'});
 assert.equal(localFit.reason,'ready');close(localFit.model.scale,1.1);
 for(const [at,count] of [['2026-03-28T23:00:00Z',92],['2026-10-24T22:00:00Z',100]]) {
  const local=rows(p=>p,count,15,Date.parse(at),'Europe/Brussels');
  const dstFit=fitCalibration(local.map(r=>({...r,price:1.2*r.price+.1})),local,Date.parse(at)+12*3600000,{timezone:'Europe/Brussels'});
  assert.equal(dstFit.reason,'ready');assert.equal(dstFit.details.samples,count);close(dstFit.model.scale,1.2);
 }
 assert.equal(sourceName('external',{externalPrice1Name:'  Energy Price Forecast  '}),'Energy Price Forecast');
 assert.equal(sourceName('external2',{externalPrice2Name:' '}),'External Price 2');
 assert.equal(sourceName('external',{externalPrice1Name:'a'.repeat(90)}).length,80);
}
function repeatedHourTests() {
 const fixture=repeatedHourFixture,at=new Date(fixture.startAt);
 const options={period:'next_hours',intervalMinutes:15,timezone:fixture.timezone,now:at};
 const primary=parseExternalPrices(JSON.stringify(fixture.external),options).slots;
 const secondary=parseExternalPrices(JSON.stringify(fixture.external2),options).slots;
 const before=JSON.stringify([primary,secondary]);
 const fit=fitCalibration(primary,secondary,at.getTime(),{timezone:fixture.timezone});
 assert.equal(fit.reason,'ready','actual hour prices repeated four times must compare to complete hourly means');
 assert.equal(fit.details.primaryResolutionMinutes,15);assert.equal(fit.details.secondaryResolutionMinutes,60);
 assert.equal(fit.details.secondaryRepeatedHourly,true);assert.equal(fit.details.comparisonResolutionMinutes,60);
 assert.equal(fit.details.samples,10,'skip the partial first hour and calibrate only today');
 assert(fit.model.rmse<.00005);assert(Math.abs(fit.model.scale-1)<.0002);assert(Math.abs(fit.model.offset-.1)<.00005);
 const reverse=fitCalibration(secondary,primary,at.getTime(),{timezone:fixture.timezone});
 assert.equal(reverse.reason,'ready');assert.equal(reverse.details.primaryRepeatedHourly,true);
 // Tomorrow's forecast differences must not disprove today's exact +0.10 relation.
 assert(fit.details.totalOverlapSamples>fit.details.samples);
 // A single flat hour in real quarter data is insufficient evidence to coarsen.
 const quarters=rows((p,i)=>i<4?.1:p,96);
 const genuine=fitCalibration(quarters.map(r=>({...r,price:r.price+.1})),quarters,now.getTime());
 assert.equal(genuine.reason,'ready');assert.equal(genuine.details.comparisonResolutionMinutes,15);
 assert.equal(genuine.details.secondaryRepeatedHourly,false);assert.equal(genuine.details.samples,96);
 for(const [startAt,count] of [['2026-03-28T23:00:00Z',92],['2026-10-24T22:00:00Z',100]]) {
  const repeated=rows((p,i)=>-.03+Math.floor(i/4)*.004,count,15,Date.parse(startAt),'Europe/Brussels');
  const realQuarters=repeated.map((r,i)=>({...r,price:r.price+.1+[-.015,-.005,.005,.015][i%4]}));
  const dst=fitCalibration(realQuarters,repeated,Date.parse(startAt)+12*3600000,{timezone:'Europe/Brussels'});
  assert.equal(dst.reason,'ready');assert.equal(dst.details.samples,count/4);close(dst.model.offset,.1);
 }
 const misaligned=rows((p,i)=>.1+Math.floor((i+2)/4)*.01,96);
 const misalignedFit=fitCalibration(misaligned.map(r=>({...r,price:r.price+.1})),misaligned,now.getTime());
 assert.equal(misalignedFit.details.secondaryRepeatedHourly,false,'four repeats starting on the half hour are not clock-hour data');
 // Missing quarters cannot manufacture complete hours or reliable overlap.
 const sparse=secondary.filter((r,i)=>i%4===0);
 const sparseFit=fitCalibration(primary,sparse,at.getTime(),{timezone:fixture.timezone});
 assert.equal(sparseFit.reason,'incompatible_curves');
 assert.equal(JSON.stringify([primary,secondary]),before,'calibration must preserve original imported prices');
 return {at,primary,secondary,fit};
}
async function run() {
 pureTests();
 const repeated=repeatedHourTests();
 const {app,store,cards}=await boot();app.homey.clock.getTimezone=()=> 'UTC';
 const cfg={...DEFAULTS,timezone:'UTC',contractType:'dynamic_quarter',externalPrice1Name:'Energy Price Forecast',externalPrice2Name:'Power by the Hour'};
 const makeStates=()=>{
  app.homeyEnergy={available:true,slots:rows(p=>1.21*p+.12),lastUpdatedAt:now.getTime(),formulaKnown:false,formulaKey:''};
  app.externalEnergy={slots:rows(),curveUpdatedAt:now.getTime()};
  app.externalEnergy2={slots:rows(p=>2*p+.03),curveUpdatedAt:now.getTime()};
  app.homeyEnergyResampleCache=null;app.externalEnergyResampleCache=null;app.externalEnergy2ResampleCache=null;
  app.dynamicPriceCalibrations={};app.dynamicPriceCalibration=null;app.priceCalibrationAttempts={};
 };
 makeStates();app.externalEnergy={slots:repeated.primary,curveUpdatedAt:repeated.at.getTime()};
 app.externalEnergy2={slots:repeated.secondary,curveUpdatedAt:repeated.at.getTime()};
 app.homey.clock.getTimezone=()=>repeatedHourFixture.timezone;
 const repeatedSettings={...cfg,timezone:repeatedHourFixture.timezone,dynamicPriceSources:['external','external2']};
 const repeatedSelection=app.getDynamicPriceSelection(repeatedSettings,repeated.at);
 assert.equal(repeatedSelection.source,'external');assert.equal(repeatedSelection.secondary.ready,true);
 assert.equal(repeatedSelection.secondary.alignment.comparisonResolutionMinutes,60,'resolution evidence is exposed to planning diagnostics');
 app.externalEnergy.slots=[];
 assert.equal(app.getDynamicPriceSelection(repeatedSettings,repeated.at).source,'external2','aligned repeated hourly data can actually serve as fallback');
 app.homey.clock.getTimezone=()=> 'UTC';
 const orders=[['external','external2','homey'],['external2','homey','external'],['homey','external','external2']];
 for(const order of orders) {
  makeStates();const settings={...cfg,dynamicPriceSources:order};
  const rawBefore=JSON.stringify([app.homeyEnergy.slots,app.externalEnergy.slots,app.externalEnergy2.slots]);
  let selection=app.getDynamicPriceSelection(settings,now);
  assert.equal(selection.source,order[0]);assert(selection.sources.every(s=>s.ready));
  selection.sources.forEach(s=>close(s.price,selection.primary.price));
  assert.equal(selection.sources.find(s=>s.source==='external').name,'Energy Price Forecast');
  assert.equal(selection.sources.find(s=>s.source==='external2').name,'Power by the Hour');
  const states={homey:app.homeyEnergy,external:app.externalEnergy,external2:app.externalEnergy2};
  const primarySlots=states[order[0]].slots;states[order[0]].slots=[];
  selection=app.getDynamicPriceSelection(settings,now);assert.equal(selection.source,order[1]);close(selection.analysis.currentPrice,selection.sources[1].price);
  // Actual restart restores external curves + names + per-pair model while
  // reference data is absent. Neither the Homey formula nor custom names gate fit.
  if(order[0]==='external') {
   app.setSetting('dynamicPriceSources',order);app.setSetting('contractType','dynamic_quarter');
   app.setSetting('externalPrice1Name',cfg.externalPrice1Name);app.setSetting('externalPrice2Name',cfg.externalPrice2Name);
   store.set('_externalPriceCurves',{external:{slots:[],curveUpdatedAt:now.getTime()},external2:structuredClone(app.externalEnergy2)});
   // Startup prunes expired curves using the real clock. Keep this fixture's
   // restart at its simulated timestamp, regardless of the test execution date.
   const RealDate=Date;
   let restarted;
   try {
    global.Date=class extends RealDate {
     constructor(...args){super(...(args.length?args:[now.getTime()]));}
     static now(){return now.getTime();}
    };
    restarted=await boot(store);
   } finally { global.Date=RealDate; }
   restarted.app.homey.clock.getTimezone=()=> 'UTC';
   const resumed=restarted.app.getDynamicPriceSelection({...restarted.app.getSettings(),timezone:'UTC'},now);
   assert.equal(resumed.source,'external2');close(resumed.analysis.currentPrice,selection.analysis.currentPrice);
   assert.equal(resumed.sources[1].name,'Power by the Hour');
  }
  states[order[0]].slots=primarySlots;
  selection=app.getDynamicPriceSelection(settings,now);assert.equal(selection.source,order[0]);
  const thirdSlots=states[order[2]].slots;states[order[2]].slots=[];
  selection=app.getDynamicPriceSelection(settings,now);assert.equal(selection.source,order[0]);assert.equal(selection.sources[2].available,false);
  states[order[2]].slots=thirdSlots;
  assert.equal(JSON.stringify([app.homeyEnergy.slots,app.externalEnergy.slots,app.externalEnergy2.slots]),rawBefore);
 }
 makeStates();let settings={...cfg,dynamicPriceSources:orders[2]};
 let selection=app.getDynamicPriceSelection(settings,now);const learned=selection.secondary.calibration;
 // Repeating status calls reuse the same successful or failed attempt.
 const attempt=app.priceCalibrationAttempts['homey:external'];app.getDynamicPriceSelection(settings,now);
 assert.equal(app.priceCalibrationAttempts['homey:external'],attempt);
 // Replacement in the same millisecond still recalibrates and invalidates resampling.
 app.externalEnergy.slots=rows(p=>p+.02);
 selection=app.getDynamicPriceSelection(settings,now);close(selection.secondary.calibration.offset,.12-.02*1.21);
 assert.notEqual(app.priceCalibrationAttempts['homey:external'],attempt);
 assert.equal(selection.secondary.calibration.learnedAt,learned.learnedAt);
 // Data can arrive later; a failed attempt is not permanently stuck.
 app.externalEnergy2.slots=[];selection=app.getDynamicPriceSelection(settings,now);assert(!selection.tertiary.ready);
 app.externalEnergy2.slots=rows(p=>p*2+.03);selection=app.getDynamicPriceSelection(settings,now);assert(selection.tertiary.ready);
 app.homeyEnergy.slots=rows(p=>p*1.21+.15);selection=app.getDynamicPriceSelection(settings,now);close(selection.secondary.calibration.offset,.15-.02*1.21);
 // A one-point correction is never accepted, and failed attempts are cached.
 app.externalEnergy.slots=rows().slice(48,49);selection=app.getDynamicPriceSelection(settings,now);
 assert.equal(selection.secondary.ready,false,'a sparse new update may not retain a contradicted cached correction');
 const failedAttempt=app.priceCalibrationAttempts['homey:external'];
 app.getDynamicPriceSelection(settings,now);assert.equal(app.priceCalibrationAttempts['homey:external'],failedAttempt);
 // Expired cached alignment does not activate a reserve with the reference gone.
 app.homeyEnergy.available=false;
 const expired=new Date(now.getTime()+MAX_AGE_MS+1);
 assert.equal(app.getDynamicPriceSelection(settings,expired).source,'none');
 // The new picker uses live labels but never labels as identifiers.
 app.setSetting('externalPrice1Name','Energy Price Forecast');app.setSetting('externalPrice2Name','Power by the Hour');
 const named=cards.get('read_external_prices_json_named');
 let suggestions=await named.autocomplete.source('');assert.deepEqual(suggestions.map(s=>s.id),['external','external2']);
 assert.deepEqual(suggestions.map(s=>s.name),['Energy Price Forecast','Power by the Hour']);
 assert.deepEqual((await named.autocomplete.source('power')).map(s=>s.id),['external2']);
 const saved=structuredClone(suggestions[1]);app.setSetting('externalPrice2Name','Changed provider name');
 assert.equal((await named.autocomplete.source(''))[1].name,'Changed provider name');
 app.setSetting('contractType','dynamic_hour');app.requestContextEvaluate=()=>{};
 app.externalEnergy2.slots=[];
 await named.listener({source:saved,curve:JSON.stringify(Array(120).fill(.2))});
 assert.equal(app.externalEnergy2.slots.length,120);assert.equal(app.externalEnergy2.slots[0].price,.2);
 await assert.rejects(()=>named.listener({source:{name:'Energy Price Forecast'},curve:'[]'}),/Select/);
 await cards.get('read_external_prices_json').listener({source:'external2',curve:JSON.stringify(Array(120).fill(.3))});
 assert.equal(app.externalEnergy2.slots[0].price,.3,'legacy generic selector still routes by its original string ID');
 app.setSetting('externalPrice2Name',' ');assert.equal(app.getSettings().externalPrice2Name,'External Price 2');
 // Raw quarter-hour values must survive an hourly contract's graph endpoint.
 const live=new Date(),liveStart=Math.floor(live.getTime()/3600000)*3600000;
 app.externalEnergy.slots=rows(p=>p,96,15,liveStart);app.externalEnergy.curveUpdatedAt=live.getTime();
 app.externalEnergy2.slots=[];app.setSetting('dynamicPriceSources',['external']);
 const rawBefore=JSON.stringify(app.externalEnergy.slots);
 const status=await require('../widgets/status/api').getStatus({homey:{app}});
 const curve=status.priceCurves[0];assert.equal(curve.intervalMinutes,15);assert(curve.points.length>24);
 curve.points.forEach(([at,p])=>close(p,app.externalEnergy.slots.find(r=>r.startMs===at).price));
 assert.equal(curve.name,'Energy Price Forecast');assert.equal(JSON.stringify(app.externalEnergy.slots),rawBefore);
 const manifest=require('../app.json'),old=manifest.flow.actions.find(c=>c.id==='read_external_prices_json'),replacement=manifest.flow.actions.find(c=>c.id==='read_external_prices_json_named');
 assert(old.deprecated);assert.equal(old.args[0].type,'dropdown');assert.equal(replacement.args[0].type,'autocomplete');
 console.log('1.0.6 alignment/name tests passed: current-day calibration, robust outliers, insufficient overlap/variation, mixed resolutions, actual repeated-hour arrays and fallback, genuine quarters, incomplete hours, Brussels timestamps/DST, A/B/C failover/recovery, cache/restart, formula-free fitting, live Flow names/stable IDs and original widget curves');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
