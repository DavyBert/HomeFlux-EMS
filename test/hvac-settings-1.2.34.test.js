'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),ui=require('../settings/hvac-settings'),{createTranslator}=require('../settings/display-language');
const html=fs.readFileSync('settings/index.html','utf8');let checks=0;
function extract(name){const start=html.indexOf('  function '+name+'(');assert(start>=0,name);const next=html.indexOf('\n  function ',start+1);return html.slice(start,next<0?html.indexOf('</script>',start):next);}
function array(name){return vm.runInNewContext(html.match(new RegExp('const '+name+' = (?:new Set\\()?((?:\\[)[\\s\\S]*?\\])\\)?;'))[1]);}
const numeric=new Set(array('numeric')),boolean=new Set(array('boolean'));
function setup(lang='nl',layout=true){
 const dom=new JSDOM(html),doc=dom.window.document;doc.documentElement.lang=lang;let listeners=0;
 const add=dom.window.Element.prototype.addEventListener;
 dom.window.Element.prototype.addEventListener=function(...args){listeners++;return add.apply(this,args);};
 const t=createTranslator(JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json')));
 const q=id=>doc.getElementById(id),ctx=vm.createContext({document:doc,q,rates:[{},{},{}],uiLanguage:lang==='nl'?'nl':'en',translateUiText:t,instanceStem:(kind,i)=>kind+(i===1?'':i),numeric,boolean,jsonArray:new Set()});
 if(layout)ctx.HomeFluxHvacSettings={update:(i,translate)=>ui.update(i,translate,doc)};
 vm.runInContext(extract('updateHvacInstanceUi'),ctx);vm.runInContext(extract('currentSettingValue'),ctx);
 const start=html.indexOf("        if(id==='hvacCoordination'){");const end=html.indexOf('        if (value === undefined',start);
 vm.runInContext("function loadCoordination(value){const id='hvacCoordination';"+html.slice(start,end)+'}',ctx);
 q('hvacCount').value='10';
 return {dom,doc,q,ctx,t,listeners:()=>listeners,update:i=>ctx.updateHvacInstanceUi(i)};
}
function masked(n){for(let p=n;p;p=p.parentElement)if(p.classList.contains('hidden'))return true;return false;}
function value(n){return n.type==='checkbox'?n.checked:n.value;}
const allIds=doc=>[...doc.querySelectorAll('[id]')].map(n=>n.id);
const old=setup('nl',false),current=setup(),refs=new Map();
for(const n of current.doc.querySelectorAll('#panel-hvac input,#panel-hvac select,#panel-hvac button'))refs.set(n.id||n,n);
let click=0;const learn=current.q('hvacLearnNow');learn.addEventListener('click',()=>click++);
for(let i=1;i<=10;i++)current.update(i);
assert.equal(new Set(allIds(current.doc)).size,allIds(current.doc).length);checks++;
for(const [id,n]of refs){if(typeof id==='string')assert.equal(current.q(id),n);}
assert.equal(current.q('hvacLearnNow'),learn);learn.dispatchEvent(new current.dom.window.MouseEvent('click'));assert.equal(click,1);checks++;
assert.equal(current.doc.querySelectorAll('.hvac-original-anchors input:not([type=hidden]),.hvac-original-anchors select,.hvac-original-anchors button').length,0);checks++;
const listenerCount=current.listeners();for(let round=0;round<5;round++)for(let i=1;i<=10;i++)current.update(i);assert.equal(current.listeners(),listenerCount);checks++;
// Every original field keeps its type, range, step, options and defaults while
// moved; only the explicitly requested EssentialEnabled field is new.
for(const [id,n]of refs){if(typeof id!=='string')continue;const before=old.q(id);assert(before,id);for(const attr of ['type','min','max','step','maxlength','name','value'])assert.equal(n.getAttribute(attr),before.getAttribute(attr),id+' '+attr);checks++;}
for(let i=1;i<=10;i++){
 const stem='hvac'+(i===1?'':i),panel=current.q('hvacInstancePanel'+i);
 assert.equal(panel.querySelectorAll('[data-hvac-behavior]').length,4);assert.equal(panel.querySelectorAll('[data-hvac-group]').length,7);checks++;
 for(const permanent of [false,true])for(const tariff of [false,true])for(const pv of [false,true])for(const keep of [false,true])for(const limit of [false,true]){
  for(const h of [old,current]){
   for(const [suffix,v]of Object.entries({Enabled:true,AutomaticControlEnabled:true,PermanentEnabled:permanent,TariffEnabled:tariff,PvEnabled:pv,KeepOnEnabled:keep,KeepOnLimitEnabled:limit,PeriodicHeatEnabled:pv,OutdoorOffEnabled:tariff,OutdoorOffAboveEnabled:pv,OutdoorNoIncreaseEnabled:tariff}))h.q(stem+suffix).checked=v;
   h.q(stem+'Direction').value='auto';h.q(stem+'DirectionTemperatureSource').value='indoor';h.update(i);
  }
  for(const n of old.q('hvacInstancePanel'+i).querySelectorAll('input,select'))assert.equal(masked(current.q(n.id)),masked(n),n.id+' inherited visibility '+JSON.stringify({permanent,tariff,pv,keep,limit}));checks++;
 }
 const advanced=panel.querySelector('details');advanced.open=false;const field=current.q(stem+'ControlIntervalMinutes');field.value='7';ui.reveal(field);assert(advanced.open);assert.equal(field.value,'7');advanced.open=false;advanced.open=true;assert.equal(field.value,'7');checks++;
}
// The original two-rate labels and hidden Normal/COP group survive relocation.
for(const h of [old,current]){h.ctx.rates=[{},{}];h.q('contractType').value='tou';h.update(1);}
assert.equal(current.q('hvacCheapTargetCGroup').querySelector('label').textContent,old.q('hvacCheapTargetCGroup').querySelector('label').textContent);assert.equal(masked(current.q('hvacNormalTargetC')),masked(old.q('hvacNormalTargetC')));checks++;
for(const h of [old,current])h.ctx.rates=[{},{},{}];
// All structured options and scalar HVAC fields survive edit/serialization and
// reload through the original serializer and its actual coordination-load branch.
const before=current.ctx.currentSettingValue('hvacCoordination');before.forEach((r,i)=>{r.EssentialEnabled=i%2===0;r.AutomaticOffAction=i%2?'standby':'off';r.StandbyTemperatureC=16+i*.5;r.KeepOnEnabled=true;r.KeepOnLimitEnabled=true;r.KeepOnMarginC=i/10;});
current.ctx.loadCoordination(before);for(let i=1;i<=10;i++)current.update(i);
const saved=JSON.parse(JSON.stringify(current.ctx.currentSettingValue('hvacCoordination'))),reopened=setup();reopened.ctx.loadCoordination(saved);
for(let i=1;i<=10;i++){const stem='hvac'+(i===1?'':i);for(const suffix of ['CheapTargetC','NormalTargetC','ExpensiveTargetC','ComfortMinC','ComfortMaxC','ControlIntervalMinutes','OutdoorOffAboveHysteresisC']){const id=stem+suffix;current.q(id).value=String(suffix==='OutdoorOffAboveHysteresisC'?.5:20+i/2);const stored=current.ctx.currentSettingValue(id);reopened.q(id).value=stored;assert.equal(reopened.ctx.currentSettingValue(id),stored);checks++;}reopened.update(i);}
assert.deepEqual(JSON.parse(JSON.stringify(reopened.ctx.currentSettingValue('hvacCoordination'))),saved);checks++;
// Four-part descriptions cover all requested combinations without predicting
// physical state. Rendering touches text only and reacts before saving.
for(const lang of ['nl','en','fr','de','es']){
 const h=setup(lang);const c={enabled:true,automatic:true,permanent:true,tariff:false,pv:false,legacyPv:true,periodic:false,keep:false,limit:false,power:true,setpoint:true,budget:false,outdoor:false};
 const cases=[{enabled:false},{automatic:false},{permanent:false},{},{tariff:true},{pv:true},{tariff:true,pv:true},{keep:true},{keep:true,limit:true},{periodic:true},{outdoor:true},{power:false},{setpoint:false},{essential:true}];
 for(const options of cases){const result=ui.describe({...c,...options});assert.equal(Object.keys(result).length,4);for(const value of Object.values(result).flat())assert(h.t(value).trim());checks++;}
 for(const [suffix,v]of Object.entries({Enabled:true,AutomaticControlEnabled:true,PermanentEnabled:true,TariffEnabled:true,PvEnabled:true,KeepOnEnabled:true,KeepOnLimitEnabled:true}))h.q('hvac'+suffix).checked=v;
 h.q('hvacKeepOnMarginC').value='1';h.update(1);const summary=h.q('hvacInstancePanel1').querySelector('.hvac-behavior');assert(summary.textContent.includes(h.t('Permanent: tariefsturing en PV-doelen.')));checks++;
 h.q('hvacKeepOnEnabled').checked=false;h.q('hvacKeepOnEnabled').dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));assert(summary.textContent.includes(h.t('Geen automatisch UIT uitsluitend doordat het doel bereikt is.')));checks++;
 h.q('hvacKeepOnEnabled').checked=true;h.q('hvacKeepOnMarginC').value='0';h.q('hvacKeepOnMarginC').dispatchEvent(new h.dom.window.Event('input',{bubbles:true}));assert(h.q('hvacInstancePanel1').querySelector('.hvac-limit-example').textContent.includes(h.t('Bij 0 °C vallen de grenzen samen: op de grens blijft UIT leidend; herstart gebeurt pas aan de vraagzijde.')));checks++;
 const dictionary=JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json'));
 for(const key of ['Activering en basisregeling','Ingesteld regelgedrag','Essentieel toestel: niet afbouwen door Peak Guard of HVAC-budget'])assert(dictionary.exact[key]);checks++;
}
assert(!/\b(?:setTimeout|setInterval|fetch|MutationObserver|Homey\.api)\s*\(/.test(fs.readFileSync('settings/hvac-settings.js','utf8')));checks++;
console.log(`HVAC settings 1.2.34: ${checks} DOM identity, visibility, storage, summary, language and event checks passed.`);
