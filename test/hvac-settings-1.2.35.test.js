'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const ui=require('../settings/hvac-settings'),{createTranslator}=require('../settings/display-language');
const html=fs.readFileSync('settings/index.html','utf8');let checks=0;
function extract(name){const start=html.indexOf('  function '+name+'('),end=html.indexOf('\n  function ',start+1);assert(start>=0);return html.slice(start,end<0?html.indexOf('</script>',start):end);}
function array(name){return vm.runInNewContext(html.match(new RegExp('const '+name+' = (?:new Set\\()?((?:\\[)[\\s\\S]*?\\])\\)?;'))[1]);}
for(const lang of ['nl','en','fr','de','es']){
 const dom=new JSDOM(html),document=dom.window.document,q=id=>document.getElementById(id),dict=JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json')),t=createTranslator(dict);
 const numeric=new Set(array('numeric')),boolean=new Set(array('boolean'));
 for(let i=1;i<=10;i++){const stem='hvac'+(i>1?i:'');for(const suffix of array('hvacNumericSuffixes'))numeric.add(stem+suffix);for(const suffix of array('hvacBooleanSuffixes'))boolean.add(stem+suffix);}
 const ctx=vm.createContext({document,q,rates:[{},{},{}],uiLanguage:lang==='nl'?'nl':'en',translateUiText:t,instanceStem:(k,i)=>k+(i===1?'':i),numeric,boolean,jsonArray:new Set(),HomeFluxHvacSettings:{update:(i,tr)=>ui.update(i,tr,document)}});
 vm.runInContext(extract('updateHvacInstanceUi'),ctx);vm.runInContext(extract('currentSettingValue'),ctx);q('hvacCount').value=10;
 const start=html.indexOf("        if(id==='hvacCoordination'){"),end=html.indexOf('        if (value === undefined',start);vm.runInContext("function loadCoordination(value){const id='hvacCoordination';"+html.slice(start,end)+'}',ctx);
 const masked=node=>{for(let p=node;p;p=p.parentElement)if(p.classList.contains('hidden'))return true;return false;};
 for(let i=1;i<=10;i++){
  const stem='hvac'+(i>1?i:''),panel=q('hvacInstancePanel'+i);
  assert(!array('hvacSuffixes').includes('TariffAutoModeEnabled'));assert(!array('hvacSuffixes').includes('CoolingOffsetC'));
  assert.equal(ctx.currentSettingValue('hvacCoordination')[i-1].CoolingOffsetC,2);assert.equal(ctx.currentSettingValue('hvacCoordination')[i-1].TariffAutoModeEnabled,true);checks++;
  q(stem+'Enabled').checked=true;q(stem+'AutomaticControlEnabled').checked=true;
  for(const permanent of [false,true])for(const tariff of [false,true])for(const pv of [false,true])for(const direction of ['auto','heat','cool']){
   q(stem+'PermanentEnabled').checked=permanent;q(stem+'TariffEnabled').checked=tariff;q(stem+'PvEnabled').checked=pv;q(stem+'UsePvSurplus').checked=true;q(stem+'Direction').value=direction;
   ctx.updateHvacInstanceUi(i);
   assert(!masked(q(stem+'UsePvSurplus')),'fallback PV checkbox must stay visible');assert(q(stem+'UsePvSurplus').checked,'permanent PV must not clear fallback PV');
   assert.equal(masked(q(stem+'TariffAutoModeEnabled')),!(permanent&&tariff&&direction==='auto'));
   for(const suffix of ['ComfortMinC','ComfortMaxC','DirectionTemperatureSource'])assert(!masked(q(stem+suffix)),stem+suffix+' must remain editable');
   for(const source of ['indoor','outdoor']){q(stem+'DirectionTemperatureSource').value=source;ctx.updateHvacInstanceUi(i);for(const suffix of ['HeatingActivationBelowC','CoolingActivationAboveC'])assert.equal(masked(q(stem+suffix)),source==='outdoor');for(const suffix of ['OutdoorHeatingBelowC','OutdoorCoolingAboveC'])assert.equal(masked(q(stem+suffix)),source!=='outdoor');}
   assert.equal(q(stem+'ComfortActivationHelp').textContent,t("Verwarmings- en koeltemperatuur zijn alleen doelen voor permanente comfortsturing zonder tariefsturing. Tariefdoelen, COP-correcties en koeloffset blijven bij tariefsturing gelden. Warmen onder en koelen boven bepalen de automatische keuze tussen verwarmen en koelen volgens de gekozen kamer- of buitentemperatuur."));
   assert(q(stem+'PvEnabled').closest('.hvac-permanent-block'));assert(!q(stem+'UsePvSurplus').closest('.hvac-permanent-block'));
   const fan=q(stem+'FanMinValue').closest('.setting-cluster');assert(fan.querySelector('h4'));assert.equal(fan.querySelector('h4').textContent,'Ventilatorschaal');assert(!masked(fan));checks++;
  }
  q(stem+'PermanentEnabled').checked=true;q(stem+'TariffEnabled').checked=true;q(stem+'Direction').value='auto';q(stem+'TariffAutoModeEnabled').checked=false;ctx.updateHvacInstanceUi(i);assert(masked(q(stem+'CoolingOffsetC')));
  assert.equal(ctx.currentSettingValue('hvacCoordination')[i-1].TariffAutoModeEnabled,false);q(stem+'TariffAutoModeEnabled').checked=true;ctx.updateHvacInstanceUi(i);assert(!masked(q(stem+'CoolingOffsetC')));
  for(const offset of [-2,0,2]){q(stem+'CoolingOffsetC').value=offset;assert.equal(ctx.currentSettingValue('hvacCoordination')[i-1].CoolingOffsetC,offset);}
  assert(panel.querySelector('.hvac-permanent-legend').textContent.includes(t('Alle blokken met een groene achtergrond gelden uitsluitend tijdens permanent sturen.')));checks++;
 }
 const saved=JSON.parse(JSON.stringify(ctx.currentSettingValue('hvacCoordination')));ctx.loadCoordination(saved);assert.deepEqual(JSON.parse(JSON.stringify(ctx.currentSettingValue('hvacCoordination'))),saved);checks++;
 q('hvacCoolingOffsetC').value='21';assert.throws(()=>ctx.currentSettingValue('hvacCoordination'));q('hvacCoolingOffsetC').value='';assert.throws(()=>ctx.currentSettingValue('hvacCoordination'));q('hvacCoolingOffsetC').value='2';checks++;
 const sources=fs.readFileSync('settings/hvac-settings.js','utf8')+html;
 for(const key of ['Bij tariefsturing automatisch wisselen tussen verwarmen en koelen','Koeloffset bij tariefsturing (°C)','PV-overschot gebruiken tijdens permanent sturen','PV-overschot opvangen buiten permanent sturen','PV-doelen tijdens permanent sturen','PV-opvang buiten permanent sturen','Alle blokken met een groene achtergrond gelden uitsluitend tijdens permanent sturen.']){assert(sources.includes(key));assert(dict.exact[key]);if(lang!=='nl')assert.notEqual(t(key),key);checks++;}
 assert(html.includes('--hvac-permanent-bg:#f7fcf4'));assert(html.includes('@media(prefers-color-scheme:dark)'));assert(html.includes('color-scheme:only dark'));assert(html.includes('color-scheme:only light'));assert.equal(new Set([...document.querySelectorAll('[id]')].map(n=>n.id)).size,document.querySelectorAll('[id]').length);checks++;
}
// Check both browser theme palettes for readable text and usable form borders.
const styleDoc=new JSDOM(html).window.document;
const rules=[...styleDoc.styleSheets[0].cssRules];
const light=rules.find(r=>r.selectorText==='#panel-hvac .hvac-permanent-block,#panel-hvac .hvac-permanent-legend');
const media=rules.find(r=>r.conditionText==='(prefers-color-scheme:dark)');
assert(light&&media);const dark=[...media.cssRules].find(r=>r.selectorText===light.selectorText);assert(dark);
const rgb=hex=>hex.replace('#','').match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
const luminance=hex=>rgb(hex).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
for(const theme of [light,dark]){
 const color=k=>theme.style.getPropertyValue('--hvac-permanent-'+k).trim();
 for(const [fg,bg,min]of [['text','bg',4.5],['muted','bg',4.5],['text','input',4.5],['input-border','input',3]])assert(contrast(color(fg),color(bg))>=min,`${fg}/${bg} needs ${min}:1 contrast`);
 checks++;
}
assert.equal(light.style.getPropertyValue('background-image').includes('linear-gradient'),true);
assert(html.includes('background:var(--hvac-permanent-bg)!important'));assert(html.includes('color:var(--hvac-permanent-text)!important'));checks++;
console.log(`HVAC settings 1.2.35: ${checks} checks passed (10 channels, five languages, PV visibility, mode/offset controls, serialization, fan heading and permanent-block styling).`);
