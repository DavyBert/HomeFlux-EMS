'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {page}=require('./helpers/settings-page-1.2.37.cjs'),{boot}=require('./startup-harness');
const langs=['nl','en','fr','de','es'];
const newKeys=['Cheap','Normal'].flatMap(c=>['BatterySave','DischargeToTarget'].map(k=>'highForecastDynamic'+c+k));
const html=fs.readFileSync('settings/index.html','utf8');
const rate={id:'r',name:'My tariff',importPrice:.3,feedInPrice:.04,weekdayChargeMode:'never',weekendChargeMode:'never',avoidGridImport:false};
let checks=0;
(async()=>{
 const dicts=langs.map(lang=>JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json')));
 const expected=Object.keys(dicts[0].strings).filter(k=>k.startsWith('contractBehavior.')).sort();
 for(let i=0;i<langs.length;i++) {
  const lang=langs[i],dict=dicts[i];
  assert.deepEqual(Object.keys(dict.strings).filter(k=>k.startsWith('contractBehavior.')).sort(),expected);
  for(const key of expected) assert.deepEqual([...dict.strings[key].matchAll(/\{[^}]+\}/g)].map(m=>m[0]),[...dicts[0].strings[key].matchAll(/\{[^}]+\}/g)].map(m=>m[0]));
  for(const key of ['Ingesteld gedrag','Bij hoge PV batterij sparen op dit tarief','Tijdens batterij sparen bij hoge PV toch ontladen tot plannings-/forecastdoel'])assert(dict.exact[key]);
  const h=await page(lang,{snapshot:{contractType:'dynamic_hour',...Object.fromEntries(newKeys.map(k=>[k,undefined])),dynamicUseBatteryNormalHours:false,touRates:[rate],touSchedule:[{rateId:'r',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]}]}}),q=id=>h.doc.getElementById(id);
  assert.deepEqual(h.errors,[]);assert(!q('dynamicUseBatteryNormalHours'));
  for(const key of newKeys) {assert(q(key));assert(q(key).checked);assert(q(key).closest('#contract-dynamic'));checks++;}
  assert(!q('highForecastDynamicCheapDischargeToTarget').disabled);assert(!q('highForecastDynamicNormalDischargeToTarget').disabled);
  for(const kind of ['fixed','tou','dynamic']) {
   const summary=q('configuredBehavior-'+kind);assert(summary.textContent.includes(dict.strings['contractBehavior.low']));assert(summary.textContent.includes(dict.strings['contractBehavior.high']));assert(summary.parentElement.textContent.includes(dict.exact['Ingesteld gedrag']));
   assert(summary.compareDocumentPosition(kind==='tou'?q('rateRows'):kind==='dynamic'?q('cheapHours'):q('fixedImportPrice'))&h.w.Node.DOCUMENT_POSITION_FOLLOWING);checks++;
  }
  assert.equal(q('contract-fixed').querySelectorAll('[id^="highForecast"]').length,0);
  assert(q('highForecastDynamicCheapBatterySave').parentElement.textContent.includes(dict.exact['Bij hoge PV batterij sparen op dit tarief']));
  if(lang==='nl') {
   const req=h.requests.length;
   for(const category of ['Cheap','Normal']) {
    const first=q('highForecastDynamic'+category+'BatterySave'),second=q('highForecastDynamic'+category+'DischargeToTarget');
    if(first.checked)first.click();
    first.click();assert(!second.disabled);if(second.checked)second.click();second.click();assert(q('configuredBehavior-dynamic').textContent.includes(dict.strings['contractBehavior.saveForecast']));
    first.click();assert(second.checked);assert(second.disabled);
    const line=[...q('configuredBehavior-dynamic').children][category==='Cheap'?0:1].textContent;assert(line.endsWith(dict.strings['contractBehavior.selfConsumption']));
    if(first.checked)first.click();
    first.click();assert(!second.disabled);
   }
   q('lowForecastDynamicNormalEnabled').click();q('lowForecastDynamicNormalDischargeToTarget').click();
   assert([...q('configuredBehavior-dynamic').children][1].textContent.includes(dict.strings['contractBehavior.saveForecast']));
   const field=k=>h.doc.querySelector(`[data-rate-k="${k}"]`);
   field('highForecastBatterySave').click();assert(!field('highForecastDischargeToTarget').disabled);field('highForecastDischargeToTarget').click();
   assert(q('configuredBehavior-tou').textContent.includes(dict.strings['contractBehavior.saveForecast']));assert.equal(h.requests.length,req,'UI changes must not add API/evaluation requests');
   q('save').click();for(let n=0;n<25;n++)await Promise.resolve();assert.deepEqual(h.alerts,[]);
   assert(newKeys.every(k=>h.snapshot.highForecastDynamicPolicy[k]===true));assert(h.snapshot.touRates[0].highForecastBatterySave);assert(h.snapshot.touRates[0].highForecastDischargeToTarget);assert(!h.writes.some(w=>w.key==='dynamicUseBatteryNormalHours'));
   const restored=await page('nl',{snapshot:h.snapshot}),rq=id=>restored.doc.getElementById(id);
   for(const key of newKeys)assert(rq(key).checked);assert(!rq('highForecastDynamicNormalDischargeToTarget').disabled);assert(restored.doc.querySelector('[data-rate-k="highForecastDischargeToTarget"]').checked);assert.deepEqual(restored.errors,[]);
   restored.doc.querySelector('[data-rate-k="avoidGridImport"]').click();assert(restored.doc.querySelector('[data-rate-k="highForecastBatterySave"]').disabled);assert(restored.doc.querySelector('[data-rate-k="highForecastDischargeToTarget"]').disabled);
   const restoredText=rq('configuredBehavior-tou').children[0].textContent;assert(!restoredText.includes(dict.strings['contractBehavior.saveForecast']));assert(restoredText.endsWith(dict.strings['contractBehavior.avoidImport']));
   restored.close();
   const explicit=await page('nl',{snapshot:{...h.snapshot,highForecastDynamicPolicy:{...h.snapshot.highForecastDynamicPolicy,highForecastDynamicCheapDischargeToTarget:false,highForecastDynamicNormalDischargeToTarget:false}}});
   for(const c of ['Cheap','Normal']){const field=explicit.doc.getElementById('highForecastDynamic'+c+'DischargeToTarget');assert.equal(field.checked,false);field.click();}
   explicit.doc.getElementById('save').click();for(let n=0;n<25;n++)await Promise.resolve();
   for(const c of ['Cheap','Normal'])assert.equal(explicit.snapshot.highForecastDynamicPolicy['highForecastDynamic'+c+'DischargeToTarget'],true);
   assert.deepEqual(explicit.errors,[]);explicit.close();checks+=22;
  }
  h.close();
 }
 for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
 const fresh=await boot(new Map());assert.deepEqual(fresh.errors,[]);assert.equal(fresh.app.getSettings().highForecastDynamicPolicy.highForecastDynamicNormalBatterySave,true);for(const key of newKeys)assert.equal(fresh.app.getSettings().highForecastDynamicPolicy[key],true);
 const seeded=new Map(Object.entries({...Object.fromEntries(fresh.store),contractType:'dynamic_hour',batteryCount:1,highForecastDynamicNormalBatterySave:true,highForecastDynamicNormalDischargeToTarget:true,dynamicUseBatteryNormalHours:false,touRates:[{...rate,highForecastBatterySave:true,highForecastDischargeToTarget:true}]}));
 const before=await boot(seeded);assert.deepEqual(before.errors,[]);const after=await boot(new Map(before.store));assert.deepEqual(after.errors,[]);
 assert.equal(after.app.getSettings().highForecastDynamicPolicy.highForecastDynamicNormalBatterySave,true);assert.equal(after.app.getSettings().highForecastDynamicPolicy.highForecastDynamicNormalDischargeToTarget,true);assert.equal(after.app.getSettings().touRates[0].highForecastBatterySave,true);
 after.store.set('highForecastDynamicPolicy',{...after.store.get('highForecastDynamicPolicy'),highForecastDynamicCheapDischargeToTarget:false,highForecastDynamicNormalDischargeToTarget:false});
 const explicitOff=await boot(new Map(after.store));assert.deepEqual(explicitOff.errors,[]);for(const c of ['Cheap','Normal'])assert.equal(explicitOff.app.getSettings().highForecastDynamicPolicy['highForecastDynamic'+c+'DischargeToTarget'],false);
 assert.equal(after.timers.filter(t=>t.type==='interval').length,fresh.timers.filter(t=>t.type==='interval').length);checks+=7;
 console.log(`High-PV settings 1.3.2: ${checks} checks; five-language startup/summaries, NL save/reopen and app restart passed.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
