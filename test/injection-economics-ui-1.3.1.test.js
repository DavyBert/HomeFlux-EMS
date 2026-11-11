'use strict';
// Dependency-free tests of the actual added UI functions and form bindings.
// This is not a browser layout test; the full DOM suite also remains available.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createTranslator}=require('../settings/display-language');
const html=fs.readFileSync(require.resolve('../settings/index.html'),'utf8');
let checks=0;
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const yes=(a,label)=>{assert(a,label);checks++;};
const ids=vm.runInNewContext(html.match(/const ids = (\[[\s\S]*?\]);/)[1]);
const numeric=vm.runInNewContext(html.match(/const numeric = new Set\((\[[\s\S]*?\])\);/)[1]);
const booleans=vm.runInNewContext(html.match(/const boolean = new Set\((\[[\s\S]*?\])\);/)[1]);
const defaults=vm.runInNewContext('('+html.match(/const injectionDefaults=(\{[^\n]+\});/)[1]+')');
const expected={injectionPriceDifferenceEnabled:false,injectionMinimumPriceDifference:.2,injectionSolarOverrideEnabled:false,injectionMinimumSolarSharePercent:50};
for(const [id,value] of Object.entries(expected)){
 equal(defaults[id],value,id+' upgrade default');
 equal(ids.filter(x=>x===id).length,1,id+' load/save binding');
 yes((typeof value==='boolean'?booleans:numeric).includes(id),id+' correct serialization type');
 equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id+' unique field');
}
for(const [id,min,max,step] of [['injectionMinimumPriceDifference','0','100','0.001'],['injectionMinimumSolarSharePercent','0','100','1']]){
 const input=html.match(new RegExp('<input[^>]*id="'+id+'"[^>]*>'))[0];
 for(const [attr,value] of Object.entries({min,max,step}))yes(input.includes(`${attr}="${value}"`));
}
const section=html.slice(html.indexOf('<div class="homey-form-group"><label class="homey-form-checkbox"><input id="injectionPriceDifferenceEnabled"'),html.indexOf('<div class="homey-form-group"><label for="injectionStopSoc"'));
const labels=[...section.matchAll(/<(?:span|label|p)\b[^>]*>([^<]+)<\//g)].map(match=>match[1]);
const code=html.slice(html.indexOf('  function updateInjectionUi()'),html.indexOf("  for(const action of ['start','stop'])"));
for(const lang of ['nl','en','fr','de','es']){
 const dict=JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json','utf8')),t=createTranslator(dict);
 for(const label of [...labels,'Laagste inkoopprijs vandaag','Netto prijsverschil','vereist: meer dan','Zonne-aandeel resterende batterijvoorraad','Zonne-uitzondering op prijsverschil actief','Prijsverschilvoorwaarde voldaan','Onvoldoende prijsverschil voor injectie','Laagste inkoopprijs vandaag niet beschikbaar']){
  yes(typeof dict.exact[label]==='string',lang+' translation '+label);
  if(lang!=='nl')yes(t(label)!==label,lang+' translated text');
 }
 const nodes=new Map();
 function q(id){if(!nodes.has(id)){const classes=new Set();nodes.set(id,{checked:false,value:'',textContent:'',listeners:{},classList:{contains:x=>classes.has(x),toggle(x,hidden){if(hidden)classes.add(x);else classes.delete(x);}},addEventListener(type,handler){this.listeners[type]=handler;}});}return nodes.get(id);}
 q('contractType').value='fixed';
 const ctx=vm.createContext({q,translateUiText:t,window:{HomeFluxSettingsHelp:{refresh(){}}},document:{}});
 vm.runInContext(code,ctx);
 ctx.updateInjectionUi();
 equal(q('injectionOptions').classList.contains('hidden'),true);
 equal(q('injectionPriceDifferenceOptions').classList.contains('hidden'),true);
 equal(q('injectionSolarOverrideOptions').classList.contains('hidden'),true);
 q('injectionEnabled').checked=true;q('injectionEnabled').listeners.change();
 equal(q('injectionOptions').classList.contains('hidden'),false);
 q('injectionPriceDifferenceEnabled').checked=true;q('injectionPriceDifferenceEnabled').listeners.change();
 equal(q('injectionPriceDifferenceOptions').classList.contains('hidden'),false);
 q('injectionSolarOverrideEnabled').checked=true;q('injectionSolarOverrideEnabled').listeners.change();
 equal(q('injectionSolarOverrideOptions').classList.contains('hidden'),false);
 q('injectionMinimumPriceDifference').value='0.25';q('injectionMinimumSolarSharePercent').value='65';
 q('injectionPriceDifferenceEnabled').checked=false;q('injectionPriceDifferenceEnabled').listeners.change();
 equal(q('injectionMinimumPriceDifference').value,'0.25','hiding does not erase values');
 equal(q('injectionMinimumSolarSharePercent').value,'65');
 equal(q('injectionSolarOverrideEnabled').checked,true);
 const status={currency:'EUR',price:.90,comparisonPrice:.90,economic:{enabled:true,minimumImportPrice:.80,difference:.10,minimumDifference:.20,solarOverrideEnabled:true,minimumSolarSharePercent:50,solarSharePercent:66.6666666667,solarOverrideUsed:true,allowed:true}};
 ctx.renderInjectionStatus(status);
 for(const text of [t('Laagste inkoopprijs vandaag')+': 0.8 EUR/kWh',t('Netto prijsverschil')+': 0.1 EUR/kWh',t('Zonne-aandeel resterende batterijvoorraad')+': 66.666667%',t('Zonne-uitzondering op prijsverschil actief')])yes(q('injectionStatus').textContent.includes(text),lang+' status '+text);
 status.economic={...status.economic,minimumImportPrice:null,difference:null,solarSharePercent:null,solarOverrideUsed:false,allowed:false,reason:'Laagste inkoopprijs vandaag niet beschikbaar'};
 ctx.renderInjectionStatus(status);yes(q('injectionStatus').textContent.includes(t(status.economic.reason)));
 status.economic={enabled:false};ctx.renderInjectionStatus(status);
 equal(q('injectionStatus').textContent.includes(t('Netto prijsverschil')),false,'disabled gate does not clutter status');
 const notes=JSON.parse(fs.readFileSync('.homeychangelog.json','utf8'))['1.3.1'][lang];
 yes(notes.length>0);yes(fs.readFileSync('README.md','utf8').includes(notes),lang+' release note retained in README');
}
console.log(`Injection economics UI 1.3.1: ${checks} checks passed across five languages (bindings and production functions; no browser).`);
