'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{page}=require('./helpers/settings-page-1.2.37.cjs');
const {createTranslator}=require('../settings/display-language');let checks=0;
const snapshot=doc=>[...doc.querySelectorAll('input,select,textarea')].map(n=>[n,n.value,n.checked]);
const sameValues=(before)=>{for(const [n,value,checked]of before){assert(n.isConnected);assert.equal(n.value,value,n.id);assert.equal(n.checked,checked,n.id);}checks++;};
(async()=>{
 for(const lang of ['nl','en','fr','de','es']){
  const h=await page(lang,{autoTune:{recommendations:[{settingKey:'expectedEnergyNeedKwh',titleNl:'Verwachte energiebehoefte',titleEn:'Expected energy demand',reasonNl:'Actuele aanbeveling',reasonEn:'Current recommendation',current:24,recommended:25,confidence:99,autoManaged:true,allowedRange:{min:10,max:50,targetSoc:95,targetSocMin:80,targetSocMax:100}}]}}),{w,doc}=h,t=createTranslator(JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json','utf8')));
  const buttons=[...doc.querySelectorAll('.hf-help-toggle')];assert(buttons.length>200);assert.equal(doc.querySelectorAll('.hf-help-panel').length,buttons.length);checks++;
  const initial=snapshot(doc),initialWrites=h.writes.length,initialRequests=h.requests.length;
  let changes=0;doc.addEventListener('change',()=>changes++);doc.addEventListener('input',()=>changes++);
  // Every disclosure starts closed, has a translated name and retains its content.
  for(const button of buttons){const panel=doc.getElementById(button.getAttribute('aria-controls'));assert(panel);assert.equal(button.type,'button');assert.equal(button.tabIndex,0);assert(!button.closest('label'),'info controls must not be inside labels');assert.equal(button.getAttribute('aria-expanded'),'false');assert(panel.hidden);assert(button.getAttribute('aria-label').startsWith(t('Toelichting bij {0}').split('{0}')[0]));if(!button.hidden){button.click();assert(!panel.hidden);assert.equal(button.getAttribute('aria-expanded'),'true');button.click();assert(panel.hidden);}checks++;}
  const available=buttons.filter(n=>!n.hidden);available[0].click();available[1].click();assert.equal(available[0].getAttribute('aria-expanded'),'true');assert.equal(available[1].getAttribute('aria-expanded'),'true');sameValues(initial);assert.equal(changes,0);assert.equal(h.writes.length,initialWrites);assert.equal(h.requests.length,initialRequests);checks++;
  const count=buttons.length;for(let n=0;n<4;n++){w.HomeFluxSettingsHelp.initialize(doc,w.HomeFluxDisplayLanguage.createTranslator(JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json','utf8'))));w.HomeFluxSettingsHelp.refresh(doc);}assert.equal(doc.querySelectorAll('.hf-help-toggle').length,count);
  const chosen=available[0],was=chosen.getAttribute('aria-expanded');chosen.click();assert.notEqual(chosen.getAttribute('aria-expanded'),was,'one click must toggle exactly once');checks++;
  // Source controls, conditional parents and status/warning content retain identity.
  for(let i=1;i<=10;i++){
   const stem='hvac'+(i>1?i:''),panel=doc.getElementById('hvacInstancePanel'+i);
   assert(panel.querySelector('.hf-help-toggle'));assert(panel.querySelector('.hf-help-scope'));assert(!panel.querySelector('.hf-help-scope').closest('.hf-help-panel'));
   assert.equal(panel.querySelector('.hf-help-scope').textContent,t('Verwarmings- en koeltemperatuur gelden alleen als doel bij niet-tariefgestuurde permanente comfortsturing.'));
   const keepOnCondition=[...panel.querySelectorAll('[data-hf-help-keep]')].find(n=>n.textContent===t('Zonder de extra temperatuurgrens schakelt HomeFlux niet uit omdat het doel bereikt is. Veiligheidsingrepen en de uit-Flow blijven gelden.'));assert(keepOnCondition);assert(keepOnCondition.closest('[data-hvac-group="goal"]'));assert(!keepOnCondition.closest('.hf-help-panel'));
   assert(!panel.querySelector('.hvac-behavior').closest('.hf-help-panel'));assert(!doc.getElementById(stem+'LearnStatus').closest('.hf-help-panel'));checks++;
  }
  for(const n of doc.querySelectorAll('.warning,.danger-note,[role=alert],[id*=Warning]'))assert(!n.closest('.hf-help-panel'),n.id+' warning collapsed');
  const field=doc.getElementById('splitCommandBattery1Enabled'),before=field.checked,card=field.closest('[data-split-battery]'),button=card.querySelector('.hf-help-toggle');button.click();assert.equal(field.checked,before,'info must not activate a checkbox');checks++;
  assert.equal(card.querySelector('.split-enable-label').textContent,t('Batterij gebruikt afzonderlijke laad- en ontlaadmodi.'));assert.equal(doc.querySelectorAll('.split-enable-label').length,8);for(const label of doc.querySelectorAll('.split-enable-label'))assert.equal(label.textContent,t('Batterij gebruikt afzonderlijke laad- en ontlaadmodi.'));checks++;
  // Rebuilding rates and Help uses the same delegated listener; new blocks close.
  doc.querySelector('.tab[data-tab="help"]').click();const catalog=doc.getElementById('helpCatalog');assert(catalog.querySelector('.help-item .hf-help-toggle'));assert([...catalog.querySelectorAll('.hf-help-panel')].every(p=>p.hidden));const summaryInfo=catalog.querySelector('summary .hf-help-toggle');if(summaryInfo){const details=summaryInfo.closest('details'),wasOpen=details.open;summaryInfo.click();assert.equal(details.open,wasOpen,'info must not toggle its native summary');}checks++;
  doc.querySelector('.tab[data-tab="contract"]').click();doc.getElementById('contractType').value='tou';doc.getElementById('contractType').dispatchEvent(new w.Event('change',{bubbles:true}));
  const rates=doc.getElementById('rateRows');assert(rates.querySelector('.rate-policy-note[data-hf-help]'));assert(rates.querySelector('.hf-help-toggle'));
  const avoid=rates.querySelector('[data-rate-k="avoidGridImport"]');avoid.checked=true;avoid.dispatchEvent(new w.Event('change',{bubbles:true}));const note=rates.querySelector('.rate-policy-note');assert(note.hasAttribute('data-hf-help-keep'));assert(!note.closest('.hf-help-panel'));checks++;
  doc.querySelector('.tab[data-tab="finetuning"]').click();for(let n=0;n<10;n++)await Promise.resolve();const targetSoc=doc.querySelector('[data-auto-tune-target-soc]');assert(targetSoc);assert(targetSoc.closest('.homey-form-group').querySelector('.hf-help-toggle'));assert(!doc.querySelector('.autotune-note').closest('.hf-help-panel'));checks++;
  // Closed conditional fields have no remaining usable icon outside their parent.
  const strategy=doc.getElementById('chargeStrategyEditor'),monthNote=strategy.querySelector('[data-strategy-months][data-hf-help]');assert(monthNote);const monthPanel=monthNote.closest('.hf-help-panel'),monthButton=doc.querySelector('[aria-controls="'+monthPanel.id+'"]');assert(monthButton.hidden);
  const seasonal=strategy.querySelector('[name="chargeStrategySeason"][value="seasonal"]');seasonal.checked=true;seasonal.dispatchEvent(new w.Event('change',{bubbles:true}));assert(!monthButton.hidden);checks++;
  assert.equal(h.alerts.length,0,h.alerts.join(';'));assert.equal(h.errors.length,0,h.errors.join(';'));h.close();
 }
 const source=fs.readFileSync('settings/settings-help.js','utf8');assert(!/\b(?:setTimeout|setInterval|MutationObserver|fetch|Homey\.(?:set|api))\s*\(/.test(source));checks++;
 console.log(`Settings disclosures 1.2.37: ${checks} checks passed across all tabs, 10 HVAC channels, five languages, dynamic Help/rates/strategy, conditions, unchanged controls, no writes/requests and repeated initialization.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
