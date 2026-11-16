'use strict';
process.env.TZ='Europe/Brussels';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..'),store=require('../lib/visual-widget-profiles');
const old={dayChartFullWidth:false};assert.equal(store.normalizeProfile(old,'medium').dayChartFullWidth,true,'upgrade old profiles to wide chart');
const current=store.normalizeProfile(old,'medium');current.dayChartFullWidth=false;current.chartHourFormat='12h';
const db=new Map(),homey={settings:{get:k=>db.get(k),set:(k,v)=>db.set(k,structuredClone(v))}};
store.save(homey,'medium',current);assert.equal(store.get(homey,'medium').dayChartFullWidth,false,'explicit choice after upgrade survives');
assert.equal(store.get(homey,'medium').chartHourFormat,'12h');assert.equal(store.get(homey,'full').dayChartFullWidth,true);
assert.equal(store.normalizeProfile({chartHourFormat:'invalid'},'medium').chartHourFormat,'24h');
const fixture=fs.readFileSync(path.join(root,'test/widget-render-1.5.7.test.js'),'utf8');
const status=Function(fixture.slice(fixture.indexOf('const now='),fixture.indexOf("send({type:'homeflux.visual.widgetConfig'"))+';return status')();
let html=fs.readFileSync(path.join(root,'widgets/status/public/visual.html'),'utf8');
html=html.replace('initLiveWidget();',`let calls=0;const original=projectedSoc;projectedSoc=(...args)=>{calls++;return original(...args)};window.clockQa={axisHour,chartHourLabels,setTimelineHourLabels,state:()=>({data:lastChartData,calls})};initLiveWidget();`);
for(const lang of ['nl','en','fr','de','es']){
 const errors=[],logs=new VirtualConsole();logs.on('jsdomError',e=>{if(e.type!=='css-parsing')errors.push(e.message)});
 const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://widget.test/',virtualConsole:logs});
 const w=dom.window,d=w.document,send=data=>w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data}));
 const config={type:'homeflux.visual.widgetConfig',configured:true,order:[],hidden:[],folded:[],translations:JSON.parse(JSON.parse(fs.readFileSync(path.join(root,'locales',lang+'.json'))).widget.visual.catalog)};
 send(config);send({type:'homeflux.visual.status',status:structuredClone(status)});
 assert.equal(d.getElementById('chartScaleBadges').hidden,false);
 const api=w.clockQa,initial=api.state(),prediction=JSON.stringify(initial.data.prediction),before=initial.calls;
 const hours=[...d.querySelectorAll('#energyChart [data-chart-hour]')];
 assert(hours.length>=3&&hours.length<=9);
 for(const el of hours){assert.match(el.textContent,/^\d{1,2}h(?:\d{2})?$/);assert(!/[M+:]/.test(el.textContent));}
 for(let i=0;i<hours.length-1;i++)assert.equal(Number(hours[i].dataset.chartHour)%(initial.data.prediction.horizon<=24?3:6),0,'adaptive regular hour labels');
 for(const hour of hours)assert.equal(hour.getAttribute('font-size'),'14');
 for(const format of ['24h','12h'])for(const end of [7,17,24,31,41,48]){
  send({...config,chartHourFormat:format});const labels=api.chartHourLabels(end,api.state().data.geometry);
  assert.equal(labels[0].hour,0);assert.equal(labels.at(-1).hour,end);
  assert(labels.every((label,i)=>label.left>=0&&label.left+label.width<=422.001&&(!i||label.left>=labels[i-1].left+labels[i-1].width+3.99)));
  assert(labels.slice(0,-1).every(label=>label.hour%(end<=24?3:6)===0));
 }
 send({...config,chartHourFormat:'24h'});
 assert.equal(hours.at(-1).textContent,api.axisHour(initial.data.prediction?.horizon||24));
 send({...config,chartHourFormat:'12h'});
 assert.equal(api.state().calls,before,'changing clock format never calls forecast');assert.equal(JSON.stringify(api.state().data.prediction),prediction);
 for(const el of d.querySelectorAll('#energyChart [data-chart-hour]'))assert.match(el.textContent,/^\d{1,2}(?::\d{2})?(AM|PM)$/);
 assert.equal(api.axisHour(0),'12AM');assert.equal(api.axisHour(1),'1AM');assert.equal(api.axisHour(12),'12PM');assert.equal(api.axisHour(13),'1PM');assert.equal(api.axisHour(23),'11PM');assert.equal(api.axisHour(24),'12AM');
 assert.equal(api.axisHour(7.5,'24h'),'7h30');assert.equal(api.axisHour(7.5,'12h'),'7:30AM','custom target minutes stay accurate');
 for(const at of ['2026-11-16T23:35:00+01:00','2026-03-29T00:00:00+01:00','2026-10-25T00:00:00+02:00']){
  api.setTimelineHourLabels(Date.parse(at));const labels=[...d.querySelectorAll('#timelineHours span')];
  assert(labels.length>=4&&labels.length<=5);assert(labels.every(el=>/^(12AM|6AM|12PM|6PM)$/.test(el.textContent)));
  const left=labels.map(el=>parseFloat(el.style.left));assert(left.every((v,i)=>v>=0&&v<=100&&(!i||v>left[i-1])));
 }
 send({...config,chartHourFormat:'24h'});assert([...d.querySelectorAll('#energyChart [data-chart-hour]')].every(el=>!el.textContent.includes(':')));
 assert.equal(errors.length,0,errors.join('\n'));dom.window.close();console.log('PASS adaptive 3/6-hour labels, fixed 14-unit font, bounded label positions, midnight/noon, upgrade, preference, DST and unchanged forecast: '+lang);
}
