'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../widgets/status/public/visual.html'),'utf8');
function slice(begin,end){
 const a=html.indexOf(begin),b=html.indexOf(end,a+begin.length);
 assert(a>=0&&b>a,`Missing renderer boundaries: ${begin}`);
 return html.slice(a,b);
}
let writes=0,formats=0,priceScans=0;
class FakeDate extends Date {
 static now(){return 1794747600000;}
 toLocaleString(...args){formats++;return super.toLocaleString(...args);}
}
function node(tag){
 const children=[],properties=new Map();let content='';
 const n={tag,children,dataset:{},hidden:false,id:'',className:'',
  style:{getPropertyValue:k=>properties.get(k)||'',setProperty(k,v){if(properties.get(k)!==v){writes++;properties.set(k,v)}},removeProperty(k){if(properties.has(k)){writes++;properties.delete(k)}}},
  append(...parts){children.push(...parts);writes++},
  appendChild(part){children.push(part);writes++},
  querySelector(selector){if(selector==='strong')return children.find(x=>x.tag==='strong')||null;
    if(selector==='#nextTariffLive')return children.find(x=>x.id==='nextTariffLive')||null;return null;},
  get textContent(){return content},set textContent(v){content=String(v);writes++},
  set innerHTML(_){throw Error('The upcoming tariff row must never replace innerHTML')},
 };
 return n;
}
const panel=node('section'),charge=node('section');
const ctx={
 Date:FakeDate,Number,String,Array,Boolean,console,uiText:value=>String(value),visualLocale:'nl-BE',
 document:{createElement:node},
 $:id=>id==='tariffSection'?panel:id==='dayChargePlan'?charge:null,
};
const code=slice('function updateChargingTariffColors(status,','function wafTariffClass(value,bounds){')
 +slice('function syncNextTariffRow(status,','function updateLiveLabels(status){');
const renderer=vm.runInNewContext(code+'\n({tariff:syncNextTariffRow,charge:updateChargingTariffColors})',ctx);
const t=FakeDate.now(),future=t+3600000;
const rows=[{startAt:t,endAt:future,className:'cheap'},{startAt:future,endAt:future+3600000,className:'expensive'}];
const status={nextEventAt:future,nextEventLabel:'Piek',nextCharge:{state:'planned',startAt:future+5000},get tariffTimeline(){priceScans++;return rows;}};
renderer.tariff(status);renderer.charge(status);
const row=panel.querySelector('#nextTariffLive');
assert(row,'creates one upcoming-tariff line');
assert.equal(row.querySelector('strong').textContent.includes('Piek'),true);
assert.equal(row.children[0].textContent,'Volgende tariefwisseling');
assert.equal(row.dataset.tariffClass,'expensive');
assert.equal(row.style.getPropertyValue('--hf-next-tariff-accent'),'var(--hf-tariff-expensive)');
assert.equal(charge.dataset.tariffClass,'expensive');
const before={writes,formats,priceScans};
for(let i=0;i<25;i++){renderer.tariff(status);renderer.charge(status);}
assert.deepEqual({writes,formats,priceScans},before,'10-second ticks must not rewrite or rescan unchanged events');
assert.strictEqual(panel.querySelector('#nextTariffLive'),row,'the same row element remains mounted');
assert(!html.includes("const note=panel.querySelector('.timeline-note > span')"),'do not rename next tariff as charge window');
const labelWrites=writes;
rows[1].className='normal';
renderer.tariff(status,true);renderer.charge(status,true);
assert.equal(row.dataset.tariffClass,'normal','minute refresh tracks price-class changes');
assert.equal(charge.dataset.tariffClass,'normal','charge-window class tracks price-class changes');
assert.equal(formats,1,'minute class refresh does not reformat date');
assert(writes>labelWrites,'only actual color-class changes should write');
const updated={...status,nextEventAt:future+3600000,nextEventLabel:'Dal'};
renderer.tariff(updated);assert.equal(formats,2,'new event formats once, immediately');
assert.equal(row.querySelector('strong').textContent.includes('Dal'),true);
renderer.tariff({nextEventAt:t-1,nextEventLabel:'old',tariffTimeline:[]});
assert.equal(row.hidden,true,'expired event disappears');
assert.equal(html.includes('const LIVE_CALC_INTERVAL_MS=60000;'),true,'heavy calculations remain every minute');
console.log('PASS Visual Look 1.5.4: no 10-second tariff flicker, no redundant scans/DOM writes, event and minute updates remain accurate');
