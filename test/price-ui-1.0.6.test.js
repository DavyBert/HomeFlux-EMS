'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag) {this.tag=tag;this.children=[];this.value='';this.events={};this.dataset={};this.classList={toggle(){}};this.style={};this.attributes={};}
  append(...children){this.children.push(...children);}
  appendChild(child){this.children.push(child);return child;}
  addEventListener(type,callback){this.events[type]=callback;}
  setAttribute(key,value){this.attributes[key]=value;}
  set innerHTML(value){this.children=[];}
  get innerHTML(){return '';}
}
const settings=fs.readFileSync(require.resolve('../settings/index.html'),'utf8');
// Parse the whole inline script, including its embedded help definitions.
new vm.Script(settings.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
assert(!settings.includes('id="dynamicPriceSource"'), 'obsolete source dropdown must be removed, not merely hidden');
assert(!settings.includes("q('dynamicPriceSource')"), 'no event listener may reference the removed dropdown');
const fields=new Map();
const q=id=>{if(!fields.has(id))fields.set(id,new Element('div'));return fields.get(id);};
q('dynamicPriceSources').value='["homey"]';q('contractType').value='dynamic_quarter';
const checkboxes=['homey','external','external2'].map(id=>{const element=new Element('input');element.dataset.priceSource=id;return element;});
const sourceLabels=['homey','external','external2'].map(id=>{const element=new Element('span');element.dataset.priceSourceLabel=id;return element;});
const document={createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag),querySelectorAll:selector=>selector==='[data-price-source-label]'?sourceLabels:checkboxes};
const ctx={q,document,uiLanguage:'en'};vm.createContext(ctx);
vm.runInContext(settings.slice(settings.indexOf('  const priceSourceNames ='),settings.indexOf('  function renderEvContractUi()')),ctx);
ctx.renderPriceSourceControls();
assert.equal(q('dynamicSourcePriorities').children.length,1);
checkboxes[1].checked=true;checkboxes[1].events.change();
checkboxes[2].checked=true;checkboxes[2].events.change();
assert.deepEqual(JSON.parse(q('dynamicPriceSources').value),['homey','external','external2']);
let priorities=q('dynamicSourcePriorities').children;
assert.equal(priorities.length,3);assert.equal(priorities[0].children[1].children.length,3);
priorities[0].children[1].value='external2';priorities[0].children[1].events.change();
assert.deepEqual(JSON.parse(q('dynamicPriceSources').value),['external2','external','homey']);
checkboxes[1].checked=false;checkboxes[1].events.change();
assert.deepEqual(JSON.parse(q('dynamicPriceSources').value),['external2','homey']);
assert.equal(q('dynamicSourcePriorities').children.length,2);
checkboxes[0].checked=false;checkboxes[0].events.change();
checkboxes[2].checked=false;checkboxes[2].events.change();
assert.deepEqual(JSON.parse(q('dynamicPriceSources').value),['external2']);assert.equal(checkboxes[2].checked,true);
assert.equal(q('refreshHomeyEnergyDynamic').disabled,true);
q('externalPrice2Name').value='Power by the Hour';q('externalPrice2Name').events.input();
assert.equal(sourceLabels[2].textContent,'Power by the Hour');
assert.equal(q('dynamicSourcePriorities').children[0].children[1].children[0].textContent,'Power by the Hour');
q('externalPrice2Name').value=' ';q('externalPrice2Name').events.input();
assert.equal(sourceLabels[2].textContent,'External Price 2');

const widget=fs.readFileSync(require.resolve('../widgets/status/public/index.html'),'utf8');
new vm.Script(widget.match(/<script type="text\/javascript">\s*([\s\S]*?)<\/script>/)[1]);
const widgetCtx={document,tr:(_homey,_key,fallback)=>fallback};vm.createContext(widgetCtx);
vm.runInContext(widget.slice(widget.indexOf('    function enabled'),widget.indexOf('    function formatW')),widgetCtx);
vm.runInContext(widget.slice(widget.indexOf('    function addMetric'),widget.indexOf('    function section')),widgetCtx);
vm.runInContext(widget.slice(widget.indexOf('    function priceSourceName'),widget.indexOf('    function nextChargeText')),widgetCtx);
const grid=new Element('div');const now=Date.now();
const curves=['external2','external','homey'].map((source,index)=>({source,points:[[now,.2+index*.1],[now+3600000,.3+index*.1]]}));
widgetCtx.renderPriceCurves(grid,{settings:{currencySymbol:'$'},priceCurves:curves},null);
const card=grid.children[0];const svg=card.children.find(element=>element.tag==='svg');
assert.equal(svg.children.filter(element=>element.tag==='path').length,3);
assert.deepEqual(card.children.slice(-3).map(element=>element.textContent),['Price 1 · External Price 2 · $/kWh','Price 2 · External Price 1 · $/kWh','Price 3 · Homey Energy · $/kWh']);
const emptyGrid=new Element('div');widgetCtx.renderPriceCurves(emptyGrid,{priceCurves:[]},null);assert.equal(emptyGrid.children.length,0);
const selectedSources=[
  {source:'external',available:true,ready:true,sourcePrice:.2,price:.2},
  {source:'external2',available:false,ready:false,sourcePrice:null,price:null,reason:'no_price_slots'},
];
const priceStatus={settings:{currencySymbol:'€'},priceData:{required:true,source:'external',sources:selectedSources}};
let priceGrid=new Element('div');widgetCtx.renderSourcePrices(priceGrid,priceStatus,{},null);
assert.deepEqual(priceGrid.children.map(row=>row.children[0].textContent),['Price 1','Price 2']);
assert.match(priceGrid.children[1].children[1].textContent,/External Price 2 · — · No price data received/);
assert(!priceGrid.children[1].children[1].textContent.includes('0.0000'), 'missing price must not be represented as zero');
selectedSources[1]={source:'external2',available:true,ready:true,normalized:true,sourcePrice:.3,price:.2};
priceGrid=new Element('div');widgetCtx.renderSourcePrices(priceGrid,priceStatus,{},null);
assert.match(priceGrid.children[1].children[1].textContent,/External Price 2 · € 0.3000\/kWh · → € 0.2000\/kWh/);
selectedSources[0]={source:'external',available:false,ready:false,sourcePrice:null,reason:'no_current_price_slot'};
priceStatus.priceData.source='external2';
priceGrid=new Element('div');widgetCtx.renderSourcePrices(priceGrid,priceStatus,{showPrimaryPrice:false},null);
assert.equal(priceGrid.children.length,1);assert.equal(priceGrid.children[0].children[0].textContent,'Price 2');
assert.match(priceGrid.children[0].children[1].textContent,/External Price 2.*✓/);
const partialCurveGrid=new Element('div');
widgetCtx.renderPriceCurves(partialCurveGrid,{...priceStatus,priceCurves:[curves[0]]},null);
assert.equal(partialCurveGrid.children[0].children.at(-1).textContent,'Price 2 · External Price 2 · €/kWh');
const nl=require('../locales/nl.json').widget.status;
widgetCtx.tr=(_homey,key,fallback)=>nl[key.split('.').at(-1)] || fallback;
priceGrid=new Element('div');widgetCtx.renderSourcePrices(priceGrid,priceStatus,{},null);
assert.match(priceGrid.children[0].children[1].textContent,/Geen prijs voor het huidige tijdstip/);
selectedSources[0].reason='no_price_slots';
priceGrid=new Element('div');widgetCtx.renderSourcePrices(priceGrid,priceStatus,{},null);
assert.match(priceGrid.children[0].children[1].textContent,/Geen prijsdata ontvangen/);
priceStatus.priceData.required=false;
priceGrid=new Element('div');widgetCtx.renderSourcePrices(priceGrid,priceStatus,{},null);assert.equal(priceGrid.children.length,0);
priceStatus.priceData.required=true;selectedSources[0]={source:'external',name:'Energy Price Forecast',available:true,ready:true,sourcePrice:.2,price:.2};
selectedSources[1].name='Power by the Hour';
priceGrid=new Element('div');widgetCtx.renderSourcePrices(priceGrid,priceStatus,{},null);
assert.match(priceGrid.children[0].children[1].textContent,/Energy Price Forecast/);
assert.match(priceGrid.children[1].children[1].textContent,/Power by the Hour.*Prijsafstemming gereed/);
selectedSources[1].normalized=false;selectedSources[1].ready=false;selectedSources[1].calibrationState='insufficient_overlap';
priceGrid=new Element('div');widgetCtx.renderSourcePrices(priceGrid,priceStatus,{},null);
assert.match(priceGrid.children[1].children[1].textContent,/Onvoldoende overlap/);
const namedCurveGrid=new Element('div');widgetCtx.renderPriceCurves(namedCurveGrid,{...priceStatus,priceCurves:[curves[0]]},null);
assert.match(namedCurveGrid.children[0].children.at(-1).textContent,/Power by the Hour/);
console.log('1.0.6 UI tests passed: checkbox-only selection, dynamic priorities, unavailable source visibility, null prices, stable widget numbering, NL/EN reasons, three SVG curves and currency');
