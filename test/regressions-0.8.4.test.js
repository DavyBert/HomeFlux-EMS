'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { boot, DEFAULTS } = require('./startup-harness');
const { compilePriceFormula, applyHomeyUserCosts } = require('../lib/price-formula');
const { fitCalibration, validCalibration, overlapPairs, MAX_AGE_MS } = require('../lib/price-normalization');
const { normalizeDynamicPriceResponse, localParts } = require('../lib/homey-energy');
const { calculateEvDecision } = require('../lib/flexible-loads');
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
const now = new Date('2026-09-24T12:05:00Z');
const start = Date.parse('2026-09-24T00:00:00Z');
function rows(dayStart=start, transform=p=>p) {
  return Array.from({length:96},(_,i)=>({startMs:dayStart+i*900000,...(() => {const p=localParts(new Date(dayStart+i*900000),'UTC');return {dateKey:p.dateKey,minute:p.minuteOfDay};})(),price:transform(-.04+i*.003)}));
}
function configure(app, mode='homey_external_fallback') {
  const settings={...DEFAULTS,timezone:'UTC',contractType:'dynamic_quarter',dynamicPriceSource:mode};
  app.homey.clock.getTimezone=()=> 'UTC';
  app.homeyEnergy={available:true,slots:rows(start,p=>(p+.12)*1.21),lastUpdatedAt:now.getTime(),formulaKnown:true,formulaKey:'(p+.12)*1.21'};
  app.externalEnergy={slots:rows(),curveUpdatedAt:now.getTime(),currentPrice:9,currentUpdatedAt:now.getTime()};
  app.homeyEnergyResampleCache=null;app.externalEnergyResampleCache=null;
  app.dynamicPriceCalibration=null;app.priceCalibrationAttemptKey='';
  return settings;
}
function formulaTests() {
  for (const name of ['basisprijs','Basisprijs','basis prijs','basePrice','base_price','Base Price','price']) {
    for (const expression of [name, '['+name+']', '[['+name+']]', '{'+name+'}', '{{'+name+'}}']) {
      for (const price of [-.05,0,.035,.18]) close(compilePriceFormula(expression)(price),price);
      close(compilePriceFormula('('+expression+' + .12) * 1.21')(.035),.18755);
    }
  }
  close(compilePriceFormula('(p + 0.12) * 1.21')(-.04),.0968);
  close(compilePriceFormula('max(0, price) + 1e-2')(-.04),.01);
  close(compilePriceFormula('2^3^2')(0),512);
  close(compilePriceFormula('-2^2')(0),-4);
  close(compilePriceFormula('{{price}}/1000 + .10')(100),.2);
  for(const bad of ['p; process.exit()', 'globalThis.p', 'constructor(p)', 'p ? 1 : 2', 'p +', 'p % 2', '('.repeat(40)+'p'+')'.repeat(40)]) assert.throws(()=>compilePriceFormula(bad),bad);
  assert.throws(()=>compilePriceFormula('1/0')(.1));
  const raw=[{price:-.1},{price:.1},{price:.3}];
  const summary={lowestPriceWithUserCosts:0,highestPriceWithUserCosts:.484,averagePriceWithUserCosts:.242};
  const adjusted=applyHomeyUserCosts(summary,raw,{mathExpression:'(p+.1)*1.21'});
  close(adjusted[1].price,.242);assert.equal(adjusted[1].rawPrice,.1);
  for (const noFormula of [null, {}, {mathExpression:null}]) close(applyHomeyUserCosts(summary,raw,noFormula)[1].price,.242);
  const inferred=applyHomeyUserCosts(summary,raw,null);inferred.forEach((r,i)=>close(r.price,adjusted[i].price));
  const corrected=raw.map((r,i)=>({...r,raw:{valueWithUserCosts:adjusted[i].price}}));
  close(applyHomeyUserCosts(summary,corrected,{mathExpression:'(p+.1)*1.21'})[1].price,.242);
  assert.throws(()=>applyHomeyUserCosts(summary,raw,{mathExpression:'p+.1'}),/does not match/);
  assert.throws(()=>applyHomeyUserCosts({},raw,{mathExpression:'unknown + p'}),/Unsupported/);
  const payload={pricesPerInterval:rows().map(r=>({periodStart:new Date(r.startMs).toISOString(),value:r.price}))};
  const normalized=normalizeDynamicPriceResponse(payload,{timezone:'Europe/Amsterdam',userCosts:{mathExpression:'(p+.12)*1.21'}});
  close(normalized[0].price,.0968);assert.equal(normalized[0].minute,120);
}
function normalizationTests() {
  const fit=fitCalibration(rows(start,p=>(p+.12)*1.21),rows(),now.getTime());
  close(fit.model.scale,1.21);close(fit.model.offset,.1452);
  assert(validCalibration(fit.model,now.getTime()));assert(!validCalibration(fit.model,now.getTime()+MAX_AGE_MS+1));
  assert.equal(fitCalibration(rows(start+86400000),rows(),now.getTime()).reason,'insufficient_overlap');
  assert.equal(fitCalibration(rows(start,p=>p*p),rows(),now.getTime()).reason,'incompatible_curves');
  assert.equal(fitCalibration(rows(start,()=>.2),rows(start,()=>.1),now.getTime()).reason,'insufficient_variation');
  const hourly=rows().filter((r,i)=>i%4===0);
  const quarter=rows().map((r,i)=>({...r,price:hourly[Math.floor(i/4)].price*1.2+.15}));
  close(fitCalibration(quarter,hourly,now.getTime()).model.scale,1.2);
  assert.equal(overlapPairs(quarter,hourly).length,96);
  // Actual timestamps, not local clock labels, define comparable intervals.
  const shiftedLabels=quarter.map(r=>({...r,minute:(r.minute+120)%1440}));
  close(fitCalibration(shiftedLabels,hourly,now.getTime()).model.offset,.15);
}
async function sourceTests() {
  const {app,store}=await boot();
  let settings=configure(app);
  let selection=app.getDynamicPriceSelection(settings,now);
  assert.equal(selection.source,'homey');assert(selection.fallbackReady);close(selection.primary.price,selection.secondary.price);
  close(selection.secondary.sourcePrice,.104);close(selection.primary.price,.27104);
  assert(store.get('_dynamicPriceCalibration'));
  const persistent=structuredClone(store.get('_dynamicPriceCalibration'));
  app.homeyEnergy.lastUpdatedAt=now.getTime()-25*60000;
  selection=app.getDynamicPriceSelection(settings,now);assert.equal(selection.source,'external');assert(selection.fallbackActive);close(selection.analysis.currentPrice,.27104);
  close(app.getHomeyEnergyStatus(settings,now).currentPrice,.27104);
  // Restart retains a valid calibration without new primary data.
  app.dynamicPriceCalibration=undefined;app.priceCalibrationAttemptKey='';
  assert.equal(app.getDynamicPriceSelection(settings,now).source,'external');
  assert.deepEqual(store.get('_dynamicPriceCalibration'),persistent);
  assert.equal(app.getDynamicPriceSelection({...settings,dynamicPriceSource:'homey'},now).source,'none');
  assert.equal(app.getDynamicPriceSelection({...settings,dynamicPriceSource:'external'},now).source,'external');
  assert.equal(app.getDynamicPriceSelection({...settings,dynamicPriceSource:'external'},now).secondary,null);
  app.homeyEnergy.lastUpdatedAt=now.getTime()+1;
  assert.equal(app.getDynamicPriceSelection(settings,now).source,'homey');
  // Changing formula invalidates the old calibration while Homey is unavailable.
  app.homeyEnergy.available=false;app.homeyEnergy.formulaKey='p+.4';
  assert.equal(app.getDynamicPriceSelection(settings,now).source,'none');
  settings=configure(app,'external_homey_fallback');
  selection=app.getDynamicPriceSelection(settings,now);assert.equal(selection.source,'external');close(selection.secondary.price,.104);
  app.externalEnergy.slots=[];app.externalEnergy.curveUpdatedAt++;
  selection=app.getDynamicPriceSelection(settings,now);assert.equal(selection.source,'homey');assert(selection.fallbackActive);close(selection.analysis.currentPrice,.104);
  // A missing primary must never activate an uncalibrated reserve.
  settings=configure(app);app.homeyEnergy.available=false;
  assert.equal(app.getDynamicPriceSelection(settings,now).source,'none');
  settings=configure(app);app.externalEnergy.slots=rows(start,p=>p*p);
  selection=app.getDynamicPriceSelection(settings,now);assert.equal(selection.source,'homey');assert(!selection.fallbackReady);
  app.homeyEnergy.available=false;assert.equal(app.getDynamicPriceSelection(settings,now).source,'none');
  settings=configure(app);const before=JSON.stringify([...store]);
  app.getDynamicPriceSelection(settings,now,{readOnly:true});
  assert.equal(JSON.stringify([...store]),before);assert.equal(app.dynamicPriceCalibration,null);assert.equal(app.homeyEnergyResampleCache,null);
  assert.equal(app.usesHomeyEnergyPrices({...settings,dynamicPriceSource:'external'}),false);
}
async function importTests() {
  const {app}=await boot();const dates=[];let formulaCalls=0;
  app.homey.clock.getTimezone=()=> 'Europe/Amsterdam';
  app.homeyApi={energy:{
    getElectricityPriceType:async()=> 'dynamic',getDynamicPricesElectricityZone:async()=> 'NL',
    getDynamicElectricityPriceUserCosts:async()=>{formulaCalls++;return {mathExpression:'(p+.12)*1.21'};},
    fetchDynamicElectricityPrices:async({date})=>{dates.push(date);return {prices:Array.from({length:24},(_,h)=>({start:`${String(h).padStart(2,'0')}:00`,price:.1+h*.01}))};}
  }};
  app.requestContextEvaluate=()=>{};app.isNightPlanningPhase=()=>false;
  await app.refreshHomeyEnergyPrices(true);
  assert.equal(formulaCalls,1);assert.equal(new Set(dates).size,2);assert.equal(app.homeyEnergy.slots.length,48);
  close(app.homeyEnergy.slots[0].price,.2662);close(app.homeyEnergy.slots[24].price,.2662);
  app.homeyApi.energy.getDynamicElectricityPriceUserCosts=async()=>({mathExpression:'invalid(p)'});
  await app.refreshHomeyEnergyPrices(true);
  assert.equal(app.homeyEnergy.available,false);assert.match(app.homeyEnergy.error,/Unsupported/);
  const today=app.getLocalDateKey(new Date());
  const tomorrow=app.getNextLocalDateKey(Date.now());
  app.homeyApi.energy.fetchDynamicElectricityPrices=async({date})=> {
    if(date===tomorrow)throw Error('NotFoundError');
    return {prices:Array.from({length:24},(_,h)=>({start:`${String(h).padStart(2,'0')}:00`,price:(h-2)*.01}))};
  };
  for (const formula of ['basisprijs', 'basePrice', '[[base_price]]', '{price}']) {
    app.homeyApi.energy.getDynamicElectricityPriceUserCosts=async()=>({mathExpression:formula});
    await app.refreshHomeyEnergyPrices(true);
    assert.equal(app.homeyEnergy.available,true);assert.equal(app.homeyEnergy.error,'');
    assert.equal(app.homeyEnergy.slots.length,24);close(app.homeyEnergy.slots[0].price,-.02);close(app.homeyEnergy.slots[2].price,0);
    assert.match(app.homeyEnergy.responseShape,/NotFoundError/);
  }
  app.homeyApi.energy.getDynamicElectricityPriceUserCosts=async()=>({mathExpression:'unknown(p)'});
  await app.refreshHomeyEnergyPrices(true);
  assert.equal(app.homeyEnergy.available,false);
  assert(app.homeyEnergy.error.startsWith(today));
  assert.match(app.homeyEnergy.error,/Unsupported/);assert(!app.homeyEnergy.error.includes('NotFoundError'));

}
async function evTests() {
  const {app,store}=await boot();
  for(let i=0;i<4;i++) {
    const stem=i?'ev'+(i+1):'ev';
    assert.equal(store.get(stem+'EmergencyDynamicNormalEnabled'),true);
    if(i===0)app.evSessionOverride={mode:'emergency'};else app.extraEvInstances[i-1].sessionOverride={mode:'emergency'};
    for(const controlType of ['current','mode','hybrid']) {
      // Emergency and standard permissions vary independently for every EV/tariff.
      for(const emergency of [false,true]) for(const standard of [false,true]) {
        const rate={id:'dal',avoidGridImport:true,[stem+'ChargeAllowed']:standard,[stem+'EmergencyChargeAllowed']:emergency};
        const source={...DEFAULTS,contractType:'tou',touRates:[rate],[stem+'Enabled']:true,[stem+'Mode']:'smart',[stem+'ControlType']:controlType,peakShaveEnabled:false};
        const settings=app.getEvInstanceSettings(i,source);
        const input={settings,connected:true,soc:20,now,gridPowerW:0,tariff:{rateId:'dal',className:'normal'}};
        const result=calculateEvDecision(input);
        assert.equal(result.allowed,emergency,`${stem} ${controlType} emergency=${emergency} standard=${standard}`);
        if(!emergency){assert(result.emergencyTariffBlocked);assert.equal(result.requestedPowerW,0);}
        else assert.equal(calculateEvDecision({...input,settings:{...settings,peakShaveEnabled:true,peakLimitW:1000},gridPowerW:9000}).allowed,false);
      }
      const source={...DEFAULTS,contractType:'dynamic_quarter',[stem+'Enabled']:true,[stem+'ControlType']:controlType,[stem+'EmergencyDynamicCheapEnabled']:false,[stem+'EmergencyDynamicNormalEnabled']:true,[stem+'EmergencyDynamicExpensiveEnabled']:false,peakShaveEnabled:false};
      let settings=app.getEvInstanceSettings(i,source);
      const input={settings,connected:true,soc:20,now,gridPowerW:0};
      for(const className of ['cheap','normal','expensive']) assert.equal(calculateEvDecision({...input,tariff:{className}}).allowed,className==='normal');
      assert.equal(calculateEvDecision({...input,settings:{...settings,dynamicPriceDataReady:false}}).allowed,false);
      settings={...settings,evEmergencyDynamicCheapEnabled:true,evEmergencyDynamicExpensiveEnabled:true};
      for(const className of ['cheap','normal','expensive'])assert(calculateEvDecision({...input,settings,tariff:{className}}).allowed);
      assert(calculateEvDecision({...input,settings:{...settings,dynamicPriceDataReady:false}}).allowed,'all tariffs allows emergency even without prices');
      for(const inWindow of [false,true])for(const outside of [false,true])for(const className of ['cheap','normal']) {
        const fixed={...settings,contractType:'fixed',evEmergencyFixedWindowEnabled:inWindow,evEmergencyFixedOutsideWindowEnabled:outside};
        assert.equal(calculateEvDecision({...input,settings:fixed,tariff:{className}}).allowed,className==='cheap'?inWindow:outside);
      }
      // Standard charging keeps using its existing permission, independent of emergency.
      settings={...settings,evMode:'smart',evDynamicNormalEnabled:false,evGuaranteeTarget:false};
      assert.equal(calculateEvDecision({...input,settings,tariff:{className:'normal'}}).allowed,false);
    }
  }
  // Upgrade the first 0.8.4 implementation without widening a user's explicit restriction.
  const old=new Map([['settingsSchemaVersion',68],['evEmergencyUseTariff',true],['evDynamicCheapEnabled',true],['evDynamicNormalEnabled',false],['evFixedChargeWindowEnabled',true],['gridZeroMaxW',37],['touRates',[{id:'dal',evChargeAllowed:true},{id:'piek',evChargeAllowed:false}]]]);
  const migrated=await boot(old);
  assert.equal(migrated.store.get('evEmergencyDynamicCheapEnabled'),true);
  assert.equal(migrated.store.get('evEmergencyDynamicNormalEnabled'),false);
  assert.equal(migrated.store.get('evEmergencyFixedOutsideWindowEnabled'),false);
  assert.deepEqual(migrated.store.get('touRates').map(r=>r.evEmergencyChargeAllowed),[true,false]);
  assert(migrated.store.get('touRates').every(r=>r.ev2EmergencyChargeAllowed));
  assert.equal(migrated.store.get('gridZeroMaxW'),37);
  // Explicit false must survive migration/restart; unrelated saved settings remain intact.
  migrated.store.set('ev2EmergencyDynamicExpensiveEnabled',false);
  const previous=structuredClone([...migrated.store]);const restarted=await boot(migrated.store);
  for(const [key,value] of previous)assert.deepEqual(restarted.store.get(key),value,`restart preserved ${key}`);
}
function widgetTests() {
  const html=fs.readFileSync(require.resolve('../widgets/status/public/index.html'),'utf8');
  const fragment=html.slice(html.indexOf('    function priceSourceName'),html.indexOf('    function nextChargeText'));
  const ctx={tr:(_h,_key,fallback)=>fallback};vm.createContext(ctx);vm.runInContext(fragment,ctx);
  assert.equal(ctx.sourcePriceText({priceData:{secondary:null}},null,true),'No secondary source');
  const status={priceData:{required:true,ready:true,source:'homey',fallbackActive:true,primary:{source:'external',price:0,ready:true},secondary:{source:'homey',price:.2,sourcePrice:.1,ready:true,normalized:true}}};
  assert.match(ctx.sourcePriceText(status,null),/0.0000/);
  assert.match(ctx.sourcePriceText(status,null,true),/0.1000.*→.*0.2000/);
  assert.match(ctx.priceDataText(status,null),/Homey Energy.*Secondary source active/);
  status.priceData.secondary.normalized=false;assert.match(ctx.sourcePriceText(status,null,true),/Waiting for price alignment/);
}
(async()=>{formulaTests();normalizationTests();await sourceTests();await importTests();await evTests();widgetTests();console.log('0.8.4 regressions passed: formula import, four source modes, calibrated failover/recovery, persistence, EV tariff controls and widget prices');})().catch(e=>{console.error(e);process.exitCode=1;});
