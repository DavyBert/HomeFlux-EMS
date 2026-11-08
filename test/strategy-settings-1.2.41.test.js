'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{page}=require('./helpers/settings-page-1.2.37.cjs');
const intro='Mogelijk ongewenste batterijontlading',notice='AutoTune heeft tegenstrijdige aanbevelingen overgeslagen om ongewenste batterijontlading te voorkomen. De zonnedagdrempel en je gebruikersinstellingen zijn niet aangepast.';
(async()=>{let checks=0;
 for(const lang of ['nl','en','fr','de','es']){
  const snapshot={contractType:'fixed',dayPlanningMaxSoc:95,lowForecastAutoSunnyEnabled:true,lowForecastAutoSunnySoc:90,batterySaveDischargeAboveSoc:30,lowForecastSelfConsumptionMinKwh:10,lowForecastFixedEnabled:true,hvacPhysicalGroup:'legacy',hvac2PhysicalGroup:'legacy'};
  const h=await page(lang,{snapshot,autoTune:{strategyConflicts:[{settingKey:'lowForecastAutoSunnySoc'}]}}),q=id=>h.doc.getElementById(id),translations=JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json')).exact;
  const warning=q('batteryStrategyWarning'),node=q('hvacName');assert(!warning.classList.contains('hidden'));assert(warning.textContent.includes(translations[intro]));assert(!warning.closest('.hf-help-panel'));assert.equal(warning.getAttribute('role'),'status');
  function input(id,value){q(id).value=String(value);q(id).dispatchEvent(new h.w.Event('input',{bubbles:true}));}
  function change(id,value){if(q(id).type==='checkbox')q(id).checked=value;else q(id).value=value;q(id).dispatchEvent(new h.w.Event('change',{bubbles:true}));}
  input('dayPlanningMaxSoc',80);assert(warning.classList.contains('hidden'));input('dayPlanningMaxSoc',90);assert(!warning.classList.contains('hidden'));
  change('lowForecastAutoSunnyEnabled',false);assert(warning.classList.contains('hidden'));change('lowForecastAutoSunnyEnabled',true);assert(!warning.classList.contains('hidden'));
  for(const floor of [90,95,100]){input('batterySaveDischargeAboveSoc',floor);assert(!warning.classList.contains('hidden'));}
  input('batterySaveDischargeAboveSoc',30);change('lowForecastFixedEnabled',false);assert(warning.classList.contains('hidden'));change('lowForecastFixedEnabled',true);assert(!warning.classList.contains('hidden'));
  change('contractType','dynamic_quarter');change('lowForecastDynamicCheapEnabled',false);change('lowForecastDynamicExpensiveEnabled',false);change('lowForecastDynamicNormalEnabled',true);change('dynamicUseBatteryNormalHours',false);assert(warning.classList.contains('hidden'));change('dynamicUseBatteryNormalHours',true);assert(!warning.classList.contains('hidden'));
  change('contractType','fixed');input('dayPlanningMaxSoc',96);assert.strictEqual(q('hvacName'),node);assert.equal(h.writes.length,0,'advice never saves or rebuilds settings');
  for(let i=1;i<=10;i++){const stem='hvac'+(i===1?'':i);assert.equal(q(stem+'PhysicalGroup'),null);assert(q(stem+'SharedPowerEnabled'));assert(q(stem+'SharedPowerWith'));checks++;}
  h.doc.querySelector('[data-tab="finetuning"]').click();for(let i=0;i<40;i++)await Promise.resolve();assert(!q('autoTuneStrategyAdvice').classList.contains('hidden'));assert(q('autoTuneStrategyAdvice').textContent.includes(translations[notice]));
  q('save').click();for(let i=0;i<40;i++)await Promise.resolve();assert.deepEqual(h.alerts,[]);assert(h.writes.some(write=>write.key==='dayPlanningMaxSoc'&&write.value===96),'warning is non-blocking');assert(!h.writes.some(write=>/PhysicalGroup/.test(write.key)));assert.equal(h.snapshot.hvacPhysicalGroup,'legacy');checks+=16;
  assert.deepEqual(h.errors,[]);h.close();
 }
 console.log(`Strategy UI: ${checks} checks passed in five languages; reactive non-blocking warnings, no implicit writes/rerender, retained power links and legacy values, AutoTune explanation.`);
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
