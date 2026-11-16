'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../widgets/status/public/visual.html'),'utf8'),errors=[];
const logs=new VirtualConsole();logs.on('jsdomError',e=>{if(e.type!=='css-parsing')errors.push(e.message)});logs.on('error',(...a)=>errors.push(a.join(' ')));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://widget.test/',virtualConsole:logs});
const w=dom.window,doc=w.document;
const send=data=>w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data}));
const now=Date.now(),midnight=new Date();midnight.setHours(0,0,0,0);const start=midnight.getTime();
const status={avgSoc:72,effectiveCapacityKwh:21.6,targetSoc:78,planningChargeTargetSoc:78,
 decisionText:'Batterij sparen',settings:{contractType:'tou',evCount:1,hvacCount:1,boilerCount:1,minSoc:12,safetySoc:14},
 tariff:{className:'normal',label:'Dag & comfort',price:.3},inputs:{forecastDailyMaxKwh:8.2,forecastRemainingKwh:4.3,forecastTomorrowKwh:4},
 visualPlanner:{solarTargetTime:'17:00',nightTargetTime:'07:00',dayPlanningMaxSoc:90,nightPlanningMaxSoc:95,maxSoc:100,maxTotalChargeW:6000,maxTotalDischargeW:6000},
 energyBudget:{householdDailyKwh:20},planningSummary:{ready:true,targetAt:start+17*3600000,energyNeedKwh:1.2,gridPlannedKwh:.8},
 nextCharge:{state:'planned',startAt:now+3600000,endAt:now+7200000,powerW:1000,targetSoc:78},
 tariffTimeline:Array.from({length:96},(_,i)=>({startAt:start+i*900000,endAt:start+(i+1)*900000,className:i%3===0?'cheap':i%3===1?'normal':'expensive',label:i%3===0?'Nacht laag':i%3===1?'Dag & comfort':'Hoog',price:.2+i%3*.1,avoidGridImport:i%3===2,nightChargeAllowed:i%3===0,dayChargeAllowed:i%3===1})),
 evs:[{name:'Auto 1',enabled:true,connected:true,outputAllowed:true,outputCurrentA:10,measuredPowerW:2300}],hvacs:[{name:'Keuken',enabled:true,outputMode:'heat',roomTemperatureC:20,setpointC:21}],boiler:{enabled:true,outputOn:true}};
send({type:'homeflux.visual.widgetConfig',order:[],hidden:[],folded:[],dayTimelineFolded:false,dayInfoScale:100,configured:true});
send({type:'homeflux.visual.status',status});
send({type:'homeflux.visual.houseHistory',initial:true,rows:Array.from({length:Math.floor((now-start)/300000)},(_,i)=>({at:start+i*300000,endAt:start+(i+1)*300000,coveredMs:300000,powerW:1000}))});
assert.equal(errors.length,0,errors.join('\n'));
assert.ok(doc.querySelector('#energyChart path'),'real renderer draws energy/SOC paths');
assert.equal(doc.querySelector('#planStatsGrid').children.length,4);
assert.deepEqual([...doc.querySelectorAll('#planStatsGrid .top')].map(x=>x.textContent.trim()),['SOC nu','Nodig','Gepland','Doel-SOC']);
assert.equal(doc.querySelector('#planCurrentSoc').textContent,'72%');
assert.equal(doc.querySelector('#targetSoc').textContent,'78%');
assert.deepEqual([...doc.querySelectorAll('.tariff-legend span')].map(x=>x.textContent).sort(),['Nacht laag','Dag & comfort','Hoog'].sort());
assert.ok(doc.querySelector('#evSection').textContent.includes('Auto 1'),'EV display preserved');
assert.ok(doc.querySelector('#hvacSection').textContent.includes('Keuken'),'HVAC display preserved');
const keys=['dayPlanSoc','dayEnergyNeed','dayGridPlanned','dayTargetSoc'];
for(let mask=0;mask<16;mask++){
 const hidden=keys.filter((_,i)=>mask&(1<<i));
 send({type:'homeflux.visual.widgetConfig',order:[],hidden:[],folded:[],dayHidden:hidden,configured:true,dayInfoScale:100});
 keys.forEach((key,i)=>assert.equal(doc.querySelector(`[data-day-item="${key}"]`).hidden,Boolean(mask&(1<<i)),key));
}
assert.equal(errors.length,0,errors.join('\n'));
dom.window.close();console.log('PASS 1.5.7 production DOM: graph, contract legend escaping, four columns, 16 visibility combinations, EV and HVAC display');
