'use strict';
const assert=require('node:assert/strict');
const {fitCalibration,validCalibration,calibrationAgrees,normalizeSecondary,MAX_AGE_MS}=require('../lib/price-normalization');
const {boot,DEFAULTS}=require('./startup-harness');
const start=Date.parse('2026-10-04T00:00:00Z'),now=new Date('2026-10-04T12:00:00Z');
const close=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
function curve(n=96,interval=15,transform=x=>x) {
  return Array.from({length:n},(_,i)=>{
    const minute=i*interval,raw=0.12+0.10*Math.sin(i*2*Math.PI/n)
      +0.025*Math.sin(i*2*Math.PI/(n/6));
    return {startMs:start+minute*60000,dateKey:'2026-10-04',minute,price:transform(raw,i)};
  });
}
function pureCases(n,interval) {
  const source=curve(n,interval),at=now.getTime();
  const before=JSON.stringify(source);
  const largeOffset=curve(n,interval,p=>p+0.75);
  const offsetFit=fitCalibration(largeOffset,source,at);
  assert.equal(offsetFit.reason,'ready');
  assert.equal(offsetFit.details.method,'weighted_linear','the original precise fit remains preferred');
  close(offsetFit.model.offset,.75);

  const unitScale=curve(n,interval,p=>100*p+1.5);
  const unitFit=fitCalibration(unitScale,source,at);
  assert.equal(unitFit.reason,'ready','a 100x difference must not block the same price trend');
  assert.equal(unitFit.details.method,'trend_weighted_linear');
  close(unitFit.model.scale,100);close(unitFit.model.offset,1.5);
  assert(validCalibration(unitFit.model,at));
  assert(!validCalibration(unitFit.model,at+MAX_AGE_MS+1));
  close(normalizeSecondary(source,unitFit.model)[3].price,unitScale[3].price);

  const invertedUnits=curve(n,interval,p=>.01*p+.2);
  const invertedFit=fitCalibration(invertedUnits,source,at);
  assert.equal(invertedFit.reason,'ready','a 0.01x scaling must also be accepted');
  assert.equal(invertedFit.details.method,'trend_weighted_linear');
  close(invertedFit.model.scale,.01);

  const nearby=curve(n,interval,(p,i)=>.27+1.45*p+.004*Math.sin(i*2*Math.PI/(n/3)));
  const trendFit=fitCalibration(nearby,source,at);
  assert.equal(trendFit.reason,'ready','similar up/down trends with slight nonlinear cost differences qualify');
  assert.equal(trendFit.details.method,'trend_weighted_linear');
  assert(trendFit.details.trendRSquared>=.99);
  assert(validCalibration(trendFit.model,at));
  assert(calibrationAgrees(trendFit.model,nearby,source,trendFit.details,'UTC'));
  const incompatible=curve(n,interval,p=>.8-p);
  assert.equal(fitCalibration(incompatible,source,at).reason,'incompatible_curves','opposite price trends are unsafe');
  const unrelated=curve(n,interval,(p,i)=>.2+.08*Math.sin(i*2*Math.PI/(n/9)));
  assert.equal(fitCalibration(unrelated,source,at).reason,'incompatible_curves','unrelated peaks must remain blocked');
  const flat=curve(n,interval,()=>.15);
  assert.equal(fitCalibration(flat,source,at).reason,'incompatible_curves','flat reference data must not prove a trend');
  assert.equal(fitCalibration(largeOffset.slice(0,3),source.slice(0,3),at).reason,'insufficient_overlap');
  assert.equal(JSON.stringify(source),before,'normalization must not mutate imported curves');
  return {source,unitScale};
}
// Regression based on the PBTH/HEF display pattern: a noisy quarter-hour
// primary and a smoother hourly secondary share an hourly market shape, but
// the former strict >=99% fit rejected them. Different forecast horizons must
// not invalidate the time interval that both sources actually share.
function sharedHourlyTrendCases() {
  const start=Date.parse('2026-11-13T12:00:00Z'); // 13:00 in Belgium
  const at=Date.parse('2026-11-13T12:02:00Z');
  const row=(time,price)=>{
    const local=new Date(time+3600000); // Europe/Brussels, standard time
    return {startMs:time,dateKey:local.toISOString().slice(0,10),
      minute:local.getUTCHours()*60+local.getUTCMinutes(),price};
  };
  const market=h=>.18+.04*Math.exp(-(((h-5)/3.5)**2))
    +.035*Math.exp(-(((h-30)/3.5)**2))+.014*Math.sin(h/2.4)-.0008*h;
  const primary=Array.from({length:192},(_,i)=>row(start+i*900000,
    .10+market(i/4)+.004*Math.sin(i*2.7)+.002*Math.sin(i*.51)));
  const secondary=Array.from({length:48},(_,h)=>row(start+h*3600000,market(h)));
  const opts={timezone:'Europe/Brussels'};
  const full=fitCalibration(primary,secondary,at,opts);
  assert.equal(full.reason,'ready','similar broad trends must work across quarter/hour resolution');
  assert.equal(full.details.method,'trend_weighted_linear');
  assert(full.details.trendRSquared>=.90 && full.details.trendRSquared<.99,
    'the new fallback must really exercise a trend below the former 99% requirement');
  close(full.model.offset,.10,.02);
  assert(validCalibration(full.model,at));
  const short=fitCalibration(primary,secondary.slice(0,24),at,opts);
  assert.equal(short.reason,'ready','a shorter secondary horizon must not prevent a common-day fit');
  close(short.model.scale,full.model.scale);
  close(short.model.offset,full.model.offset);
  const forecastChange=secondary.map((p,h)=>h<11?p:{...p,price:.8-market(h)});
  assert.equal(fitCalibration(primary,forecastChange,at,opts).reason,'ready',
    'future prices do not overwrite the reliable shared current-day calibration');
  const opposite=secondary.map((p,h)=>({...p,price:.8-market(h)}));
  assert.equal(fitCalibration(primary,opposite,at,opts).reason,'incompatible_curves',
    'opposite hourly trends remain unusable');
  const shifted=secondary.map((p,h)=>({...p,price:market(h+5)}));
  assert.equal(fitCalibration(primary,shifted,at,opts).reason,'incompatible_curves',
    'prices that rise and fall at different hours remain incompatible');
  const insufficient=secondary.slice(0,3);
  assert.equal(fitCalibration(primary,insufficient,at,opts).reason,'insufficient_overlap',
    'insufficient common time must still be rejected');
  // Rejection must not retain a stale fallback calibration when the new
  // current-day curve contradicts the previously accepted trend.
  assert.equal(calibrationAgrees(full.model,primary,opposite,full.details,opts.timezone),false);
  return {primary,secondary,at};
}
async function sharedHourlyTrendAppCase({primary,secondary,at}) {
  const {app}=await boot();
  app.homey.clock.getTimezone=()=> 'Europe/Brussels';
  const settings={...DEFAULTS,timezone:'Europe/Brussels',contractType:'dynamic_quarter',
    dynamicPriceSources:['external','external2']};
  app.externalEnergy={slots:primary,curveUpdatedAt:at};
  app.externalEnergy2={slots:secondary,curveUpdatedAt:at};
  let selection=app.getDynamicPriceSelection(settings,new Date(at));
  assert.equal(selection.source,'external');
  assert.equal(selection.secondary.calibrationState,'ready');
  assert(selection.secondary.ready,'actual source selection should accept the shared trend');
  app.externalEnergy.slots=[];
  selection=app.getDynamicPriceSelection(settings,new Date(at));
  assert.equal(selection.source,'external2','normalized hourly source remains usable as fallback');
  assert(selection.analysis.currentPrice!==null);
}
async function appCases(source,primary,contractType) {
  const {app}=await boot();
  app.homey.clock.getTimezone=()=> 'UTC';
  const settings={...DEFAULTS,timezone:'UTC',contractType,dynamicPriceSources:['external','external2']};
  app.externalEnergy={slots:primary,curveUpdatedAt:now.getTime()};
  app.externalEnergy2={slots:source,curveUpdatedAt:now.getTime()};
  let selection=app.getDynamicPriceSelection(settings,now);
  assert.equal(selection.source,'external');
  assert(selection.secondary.ready,'trend-normalized reserve is available');
  assert(validCalibration(selection.secondary.calibration,now.getTime()),'other consumers must also validate a normalized reserve');
  const persisted=app.dynamicPriceCalibrations['external:external2'];
  assert(validCalibration(persisted,now.getTime()));
  const attempt=app.priceCalibrationAttempts['external:external2'];
  selection=app.getDynamicPriceSelection(settings,now);
  assert.equal(app.priceCalibrationAttempts['external:external2'],attempt,'unchanged curves do not trigger recalibration');
  app.externalEnergy.slots=[];
  selection=app.getDynamicPriceSelection(settings,now);
  assert.equal(selection.source,'external2','a calibrated fallback is actually selected');
  close(selection.analysis.currentPrice,selection.secondary.price);
  app.evDeadlinePriceSelection={selection,at:now.getTime()};
  const feed=require('../lib/active-injection').getEffectiveFeedInPrice(app,
    {...settings,injectionExportCost:0,currencySymbol:'€'},now.getTime());
  assert(feed,'injection must also accept the trend-calibrated fallback');
  close(feed.comparisonPrice,selection.analysis.currentPrice);
  app.externalEnergy.slots=primary;
  app.externalEnergy2.slots=curve(source.length,contractType==='dynamic_hour'?60:15,p=>.65-p);
  app.externalEnergy2.curveUpdatedAt=now.getTime()+1;
  selection=app.getDynamicPriceSelection(settings,now);
  assert.equal(selection.secondary.ready,false,'opposing updated curve revokes stale calibration immediately');
  assert.equal(selection.source,'external');
}
(async()=>{
  for(const [n,minutes,type] of [[96,15,'dynamic_quarter'],[24,60,'dynamic_hour']]) {
    const {source,unitScale}=pureCases(n,minutes);
    await appCases(source,unitScale,type);
  }
  await sharedHourlyTrendAppCase(sharedHourlyTrendCases());
  console.log('1.3.2 price trend normalization passed: 15/60-minute, large offsets/unit ratios, nonlinear trends, incompatible/flat data, calibration validity, source fallback and fresh-data rejection');
})().catch(error=>{console.error(error);process.exitCode=1});
