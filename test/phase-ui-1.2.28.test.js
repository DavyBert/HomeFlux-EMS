'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('settings/index.html','utf8'),calc=require('../settings/phase-guard');
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/src=/.test(match[1]))new vm.Script(match[2]);
const nodes=new Map();
function node(){const n={value:'',checked:false,disabled:false,dataset:{},children:[],classList:{toggle(){}},appendChild(x){this.children.push(x);},querySelectorAll(){return this.children.flatMap(x=>[...x.querySelectorAll(),...(x.dataset.phaseDetect?[x]:[])]);}};Object.defineProperty(n,'id',{set(id){nodes.set(id,n);},get(){return [...nodes].find(([,v])=>v===n)?.[0];}});Object.defineProperty(n,'innerHTML',{set(){n.children=[];}});return n;}
for(const id of ['phaseEmergencyPriorityRow','phaseGuard','gridConnectionPhases','phaseGuardOptions','phaseGuardEnabled','phaseVoltage','phaseAmps','phaseSafety','phaseProposed','phaseLimit','batteryCount','phaseBatteryRows','stopPhaseDetection'])nodes.set(id,node());
nodes.get('stopPhaseDetection').classList.toggle=(name,hidden)=>{nodes.get('stopPhaseDetection').hiddenByClass=hidden;};
const q=id=>nodes.get(id),ctx=vm.createContext({q,HomeFluxPhaseCalculator:calc,translateUiText:x=>x,document:{createElement:()=>node()},boolean:new Set(),numeric:new Set(),jsonArray:new Set()});
const read=html.slice(html.indexOf('  function currentSettingValue('),html.indexOf('  function captureSettingsBaseline('));vm.runInContext(read,ctx);
const update=html.slice(html.indexOf('  function updatePhaseUi('),html.indexOf('  async function refreshStatus('));vm.runInContext(update,ctx);
q('gridConnectionPhases').value='3';q('phaseVoltage').value='';q('phaseAmps').value='25';q('phaseSafety').value='80';q('batteryCount').value='4';q('phaseGuard').value=JSON.stringify({batteries:['L1','L2','balanced3','unknown','L3']});
ctx.updatePhaseUi();assert(q('phaseLimit').disabled);assert.equal(q('phaseProposed').textContent,'—');assert.equal(q('phaseBatteryRows').querySelectorAll().length,4);
q('phaseVoltage').value='230';q('phaseLimit').value='4300';ctx.updatePhaseUi();assert.equal(q('phaseLimit').disabled,false);assert.equal(q('phaseProposed').textContent,'4600');assert.equal(q('phaseLimit').value,'4300');
q('phaseBattery1').value='L3';q('phaseGuardEnabled').checked=true;
let saved=JSON.parse(JSON.stringify(ctx.currentSettingValue('phaseGuard')));assert.equal(saved.limitW,4300);assert.deepEqual(saved.batteries.slice(0,5),['L1','L3','balanced3','unknown','L3']);assert.equal(saved.enabled,true);
q('phaseVoltage').value='120';q('phaseAmps').value='20';ctx.updatePhaseUi();assert.equal(q('phaseProposed').textContent,'1920');assert.equal(q('phaseLimit').value,'4300','opening/changing calculator must not overwrite manual limit');
const start=html.indexOf("        if(id==='phaseGuard'){");const end=html.indexOf("        if(id==='hvacCoordination'){",start);vm.runInContext('function loadPhase(value){const id="phaseGuard";'+html.slice(start,end)+'}',ctx);
vm.runInContext('loadPhase({phases:3,enabled:true,voltage:230,amps:25,safetyPercent:80,limitW:4200,batteries:["L2","balanced3"]})',ctx);assert.equal(q('phaseLimit').value,4200);assert.equal(q('phaseBattery0').value,'L2');assert.equal(q('phaseBattery1').value,'balanced3');
q('batteryCount').value='1';ctx.updatePhaseUi();assert.equal(q('phaseBatteryRows').querySelectorAll().length,0,'single-battery configuration has no multi-battery detection buttons');
assert.equal(q('stopPhaseDetection').hiddenByClass,true);for(const count of [0,1,2,4]){q('batteryCount').value=String(count);ctx.updatePhaseUi();assert.equal(q('stopPhaseDetection').hiddenByClass,count<2);}
// All new controls/messages have translations; placeholders and schema remain valid.
const required=['Fasebewaking batterij laden','Detecteer batterijfase','Fasedetectie voltooid.','Fasedetectie: fase-instellingen gewijzigd.','Alleen na beoordeling toepassen'];
for(const lang of ['nl','en','fr','es','de']){const b=JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json'));for(const k of required)assert.equal(typeof b.exact[k],'string');}
const manifest=JSON.parse(fs.readFileSync('app.json')),c=manifest.flow.actions.find(c=>c.id==='set_grid_power_phases');assert(manifest.flow.actions.find(c=>c.id==='set_grid_power').deprecated);
assert.deepEqual(c.args.map(x=>x.name),['power','l1','l2','l3']);assert(c.args.slice(1).every(x=>x.required===false));
for(const lang of ['nl','en','fr','es','de'])for(const arg of c.args)assert(c.titleFormatted[lang].includes('[['+arg.name+']]'));
assert.equal(manifest.version,JSON.parse(fs.readFileSync('package.json')).version);assert(fs.readFileSync('.homeyignore','utf8').includes('/test/**'));
console.log('Phase settings UI: calculator gating, defaults, per-battery persistence, manual limits, source-test exclusion and five-language Flow metadata passed.');
