'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('settings/index.html','utf8'),widget=fs.readFileSync('widgets/status/public/index.html','utf8');
const extract=(s,name)=>{const a=s.indexOf('function '+name+'(');assert(a>=0);const b=s.indexOf('\n  function ',a+12),c=s.indexOf('\n    function ',a+12);const end=Math.min(...[b,c].filter(x=>x>=0));return s.slice(a,end);};
const stateCtx=vm.createContext({tr:(h,k,f)=>f,reasonText:s=>s});vm.runInContext(extract(widget,'hvacState'),stateCtx);
const permanent={enabled:true,automaticControlEnabled:true,permanent:true,currentMode:'heat',reason:'HVAC direct · energievraag afbouwen'};
assert.equal(stateCtx.hvacState({...permanent,copTargetActive:true},{}),'COP temperature target');
assert.equal(stateCtx.hvacState(permanent,{}),'Permanent temperature control');
assert.equal(stateCtx.hvacState({...permanent,periodicHeating:true},{}),'Periodic heating');
assert.equal(stateCtx.hvacState({...permanent,waiting:true,reason:'HVAC-modusuitvoer niet toegestaan'},{}),'HVAC-modusuitvoer niet toegestaan');
assert.equal(stateCtx.hvacState({...permanent,permanent:false},{}),'Waiting for surplus','legacy presentation remains unchanged');
const ids=[...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'no duplicate form IDs');
for(let i=1;i<=10;i++)for(const suffix of ['PeriodicHeatTargetC','CheapTargetC','NormalTargetC','ExpensiveTargetC','PvTargetC','AfterPvTargetC','ComfortMinC','ComfortMaxC','HeatingActivationBelowC','CoolingActivationAboveC','TestSetpoint']) {
 const id=`hvac${i===1?'':i}${suffix}`,tag=[...html.matchAll(/<input\b[^>]*>/g)].map(m=>m[0]).find(t=>t.includes(`id="${id}"`));
 assert(tag,`missing ${id}`);assert.match(tag,/\bmax="99"/,`${id} must allow warm-water temperatures`);
}
for(let i=1;i<=10;i++)for(const suffix of ['DirectionTemperatureSource','OutdoorHeatingBelowC','OutdoorCoolingAboveC','PeriodicHeatEnabled','PeriodicHeatDays','PeriodicHeatHours','PeriodicHeatTargetC','OutdoorOffAboveEnabled','OutdoorOffAboveC','OutdoorOffAboveHysteresisC','OutdoorOffBelowHysteresisC','OutdoorNoIncreaseEnabled','OutdoorNoIncreaseAboveC','OutdoorOffEnabled','OutdoorOffBelowC','Name','PermanentEnabled','TariffEnabled','PvEnabled','Direction','CheapTargetC','NormalTargetC','ExpensiveTargetC','PvTargetC','AfterPvTargetC'])assert(ids.includes(`hvac${i===1?'':i}${suffix}`));
function node(){return {checked:false,value:'',textContent:'',querySelector(){return this.label ||= node();},classList:{set:new Set(),toggle(n,b){if(b)this.set.add(n);else this.set.delete(n);},contains(n){return this.set.has(n);}}};}
const nodes=new Map();const q=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
const ctx=vm.createContext({q,rates:[{},{},{}],uiLanguage:'nl',instanceStem:(kind,i)=>kind+(i===1?'':i)});vm.runInContext(extract(html,'updateHvacInstanceUi'),ctx);
Object.assign(ctx,{boolean:new Set(),numeric:new Set(),jsonArray:new Set()});vm.runInContext(extract(html,'currentSettingValue'),ctx);
for(let i=1;i<=10;i++) {
 const stem='hvac'+(i===1?'':i);assert(ids.includes(stem+'DirectionTemperature'));
 q(stem+'DirectionTemperatureSource').value='outdoor';q(stem+'OutdoorHeatingBelowC').value='16';q(stem+'OutdoorCoolingAboveC').value='25';
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.currentSettingValue(stem+'DirectionTemperature'))),{source:'outdoor',heatingBelowC:16,coolingAboveC:25});
 q(stem+'DirectionTemperatureSource').value='indoor';
 for(const rate of ['Cheap','Normal','Expensive'])for(const suffix of ['OutsideBelowC','TargetC'])assert(ids.includes(stem+rate+'Cop'+suffix));
 q(stem+'CheapCopOutsideBelowC').value='0';q(stem+'CheapCopTargetC').value='55';
 const cop=JSON.parse(JSON.stringify(ctx.currentSettingValue(stem+'DirectionTemperature')));assert.deepEqual(cop.tariffCop,{cheap:{outsideBelowC:0,targetC:55}});
 q(stem+'CheapCopOutsideBelowC').value='';q(stem+'CheapCopTargetC').value='';assert.equal(ctx.currentSettingValue(stem+'DirectionTemperature').tariffCop,undefined);
}
for(let i=1;i<=10;i++)for(const permanent of [false,true])for(const tariff of [false,true])for(const pv of [false,true]) {
 const stem='hvac'+(i===1?'':i);q(stem+'PermanentEnabled').checked=permanent;q(stem+'TariffEnabled').checked=tariff;q(stem+'PvEnabled').checked=pv;
 ctx.updateHvacInstanceUi(i);
 assert.equal(q(stem+'UsePvSurplusLegacyGroup').classList.contains('hidden'),permanent&&(tariff||pv));
 assert.equal(q(stem+'SurplusStartWGroup').classList.contains('hidden'),permanent&&tariff&&!pv);
 assert.equal(q(stem+'PermanentOptions').classList.contains('hidden'),!permanent);
 assert.equal(q(stem+'AfterPvTargetCGroup').classList.contains('hidden'),!pv||tariff);
 assert.equal(q(stem+'CheapTargetCGroup').classList.contains('hidden'),!tariff);
}
q('contractType').value='tou';ctx.rates=[{},{}];
for(let i=1;i<=10;i++) {
 const stem='hvac'+(i===1?'':i);q(stem+'TariffEnabled').checked=true;ctx.updateHvacInstanceUi(i);
 assert(q(stem+'NormalTargetCGroup').classList.contains('hidden'));
 assert(!q(stem+'ExpensiveTargetCGroup').classList.contains('hidden'));
 assert.equal(q(stem+'CheapTargetCGroup').querySelector('label').textContent,'Temperatuur laag tarief (°C)');
 ctx.rates=[{},{},{}];ctx.updateHvacInstanceUi(i);assert(!q(stem+'NormalTargetCGroup').classList.contains('hidden'));ctx.rates=[{},{}];
}
q('contractType').value='dynamic_hour';ctx.updateHvacInstanceUi(1);assert(!q('hvacNormalTargetCGroup').classList.contains('hidden'));
for(let i=1;i<=10;i++)for(const permanent of [false,true])for(const tariff of [false,true])for(const pv of [false,true])for(const periodic of [false,true])for(const budget of [false,true])for(const direction of ['auto','heat','cool'])for(const source of ['indoor','outdoor']) {
 const stem='hvac'+(i===1?'':i),active=permanent&&(tariff||pv||periodic);
 q(stem+'PermanentEnabled').checked=permanent;q(stem+'TariffEnabled').checked=tariff;q(stem+'PvEnabled').checked=pv;q(stem+'PeriodicHeatEnabled').checked=periodic;
 q('hvacExtraGridBudgetEnabled').checked=budget;q(stem+'Direction').value=direction;q(stem+'DirectionTemperatureSource').value=source;
 const showComfort=!active||budget||periodic,showActivation=(!active||direction==='auto')&&source==='indoor';
 for(const suffix of ['ComfortMinC','ComfortMaxC','HeatingActivationBelowC','CoolingActivationAboveC']) {
  assert(html.includes(`id="${stem}${suffix}Group"`));q(stem+suffix).value='21';
 }
 assert(html.includes(`id="${stem}ComfortActivationGroup"`));ctx.updateHvacInstanceUi(i);
 assert.equal(q(stem+'ComfortActivationGroup').classList.contains('hidden'),!showComfort&&!showActivation);
 assert.equal(q(stem+'DirectionTemperatureSourceGroup').classList.contains('hidden'),active&&direction!=='auto');
 assert.equal(q(stem+'OutdoorDirectionOptions').classList.contains('hidden'),active&&direction!=='auto'||source!=='outdoor');
 for(const suffix of ['ComfortMinC','ComfortMaxC'])assert.equal(q(stem+suffix+'Group').classList.contains('hidden'),!showComfort);
 for(const suffix of ['HeatingActivationBelowC','CoolingActivationAboveC'])assert.equal(q(stem+suffix+'Group').classList.contains('hidden'),!showActivation);
 for(const suffix of ['ComfortMinC','ComfortMaxC','HeatingActivationBelowC','CoolingActivationAboveC'])assert.equal(q(stem+suffix).value,'21','hiding must preserve stored form values');
 if(active&&showActivation)assert.match(q(stem+'ComfortActivationHelp').textContent,/automatische keuze/);
 if(!active)assert.equal(q(stem+'ComfortActivationTitle').textContent,'Comfort en activering');
}
q('hvacPermanentEnabled').checked=true;q('hvacTariffEnabled').checked=true;q('hvacDirection').value='auto';q('hvacDirectionTemperatureSource').value='indoor';ctx.uiLanguage='en';ctx.updateHvacInstanceUi(1);
assert.match(q('hvacComfortActivationHelp').textContent,/automatic choice/);ctx.uiLanguage='nl';
for(let i=1;i<=10;i++)for(const active of [false,true]) {
 const stem='hvac'+(i===1?'':i);q(stem+'OutdoorNoIncreaseEnabled').checked=active;q(stem+'OutdoorOffEnabled').checked=active;q(stem+'OutdoorOffAboveEnabled').checked=active;q(stem+'PeriodicHeatEnabled').checked=active;ctx.updateHvacInstanceUi(i);
 assert.equal(q(stem+'PeriodicHeatOptions').classList.contains('hidden'),!active);
 assert.equal(q(stem+'OutdoorOffAboveCGroup').classList.contains('hidden'),!active);
 assert.equal(q(stem+'OutdoorOffAboveHysteresisCGroup').classList.contains('hidden'),!active);
 assert.equal(q(stem+'OutdoorOffBelowHysteresisCGroup').classList.contains('hidden'),!active);
 assert.equal(q(stem+'OutdoorNoIncreaseAboveCGroup').classList.contains('hidden'),!active);
 assert.equal(q(stem+'OutdoorOffBelowCGroup').classList.contains('hidden'),!active);
}
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.attributes={};this._text='';}
 set innerHTML(s){this.children=[];this._text=s;}set textContent(s){this._text=String(s);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
 appendChild(x){this.children.push(x);return x;}get firstChild(){return this.children[0];}setAttribute(k,v){this.attributes[k]=v;}
}
const content=new Element('div'),dom={getElementById:()=>content,createElement:t=>new Element(t),createElementNS:(ns,t)=>new Element(t)};
const wctx=vm.createContext({document:dom,Date,Number,Math,String,tr:(h,k,f)=>f,enabled:()=>false,batteryTimingText:()=>null,formatC:v=>`${Number(v).toFixed(1)} °C`});
vm.runInContext(extract(widget,'section'),wctx);
const start=widget.indexOf('    function renderStatus('),end=widget.indexOf('    async function onHomeyReady(',start);vm.runInContext(widget.slice(start,end),wctx);
const hvacs=Array.from({length:10},(_,i)=>({instance:i+1,name:'A very long name '+i,enabled:true,mode:'heat',outputMode:'heat',direction:'auto',learning:{publishedSetpointC:i===9?null:21},outputSetpointC:null,roomTemperatureC:i===9?null:20,waiting:i===2,energySource:i===1?'pv':'tariff'}));
wctx.renderStatus({hvacs,tariff:{className:'cheap'}},{showHvacSummary:true},{});
const table=content.children[0].children.find(c=>c.tag==='table');assert.equal(table.children.length,11);assert(table.children.every(r=>r.children.length===3));
assert.equal(table.children[10].children[1].textContent,'—');assert.equal(table.children[10].children[2].textContent,'—');
assert.equal(table.children[2].children[0].style.color,'var(--green,#34a853)');assert.equal(table.children[3].children[0].style.color,undefined);
assert(table.children[3].children[0].children[0].children.some(c=>c.attributes['aria-label']==='wait'));
hvacs[1].permanent=true;hvacs[1].desiredSetpointC=23;
wctx.renderStatus({hvacs},{showHvacSummary:true},{});
const pending=content.children[0].children.find(c=>c.tag==='table').children[2];
assert.equal(pending.children[0].style.color,undefined,'unpublished PV target cannot turn green');
assert(pending.children[0].children[0].children.some(c=>c.attributes['aria-label']==='wait'));
assert.equal(pending.children[1].textContent,'21.0 °C','last successful goal remains visible');
wctx.renderStatus({hvacs},{showHvacSummary:false},{});assert.equal(content.children.length,0,'summary visibility is local, not control');
assert.equal(hvacs.length,10);console.log('HVAC UI: 80 conditional-field combinations plus 1920 comfort/activation/source combinations, 10-channel form schema and three-column widget DOM checks passed.');
