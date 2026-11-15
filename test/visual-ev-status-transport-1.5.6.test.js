'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),mode='fixed';
const {JSDOM,VirtualConsole}=require('jsdom');
const {boot,DEFAULTS}=require(root+'/test/startup-harness');
const {emptyDay,emptyInventory}=require(root+'/lib/savings');
const {empty}=require(root+'/lib/ev-energy-breakdown');
(async()=>{
 const {app}=await boot(new Map(Object.entries({...DEFAULTS,controlEnabled:false,evCount:1,evEnabled:true,
  evName:'BMW',evConsumptionKwhPer100Km:18,batteryCount:0,hvacCount:0,boilerCount:0,contractType:'fixed',timezone:'Europe/Brussels'})));
 const m={...empty(),kwh:361.3,pvKwh:12.8,gridKwh:343.9,unknownKwh:4.6,gridCost:94.41,solarSavings:3.58};
 app.savings={today:emptyDay('2026-11-15'),history:{'2026-11-14':{...emptyDay('2026-11-14'),directPvValue:355.02,directPvKwh:1000,directGridCost:1252.07,directGridKwh:4000,
  ev:{version:1,seconds:3600,sharedKwh:0,total:{...m},byId:{'1':{...m}}}}},inventory:emptyInventory(),total:0};
 app.getSavingsDateKey=()=>'2026-11-15';app.recordSavingsSample=()=>{};
 app.getPublicStatus=()=>({version:'1.5.6',settings:{...app.getSettings(),batteryCount:0,evCount:1,hvacCount:0,boilerCount:0,currencySymbol:'€'},
  evs:[{instance:1,name:'BMW',enabled:true,connected:false,mode:'smart',measuredPowerW:0}],hvacs:[],
  controlEnabled:false,inputReady:true,avgSoc:null,tariff:{kind:'fixed',className:'normal',price:.3},
  priceData:{sources:[]},inputs:{forecastRemainingKwh:0,forecastDailyMaxKwh:0,forecastTomorrowKwh:0,batterySoc:[]},
  decisionText:'Batterij sparen',energyBudget:{ready:false},evGridControl:{physicalSiteLoadW:300},planningSummary:{ready:false}});
 app.homey.app=app;
 const api=require(root+'/widgets/status/api');const calls=[],errors=[];
 const outerHtml=fs.readFileSync(root+'/widgets/status/public/index.html','utf8');
 const innerHtml=fs.readFileSync(root+'/widgets/status/public/visual.html','utf8');
 const consoleSink=new VirtualConsole();consoleSink.on('jsdomError',e=>{if(/Uncaught/.test(e.message))errors.push(e.message)});
 const outer=new JSDOM(outerHtml,{url:'http://homey.local/index.html',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:consoleSink});
 const inner=new JSDOM(innerHtml,{url:'http://homey.local/visual.html',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:consoleSink});
 try{
  for(const d of [outer,inner]){
   d.window.requestAnimationFrame=fn=>d.window.setTimeout(()=>fn(Date.now()),0);
   d.window.cancelAnimationFrame=id=>d.window.clearTimeout(id);
   d.window.setInterval=()=>0;d.window.clearInterval=()=>{};
  }
  const iframe=outer.window.document.getElementById('visualView');
  Object.defineProperty(iframe,'contentWindow',{value:inner.window});
  Object.defineProperty(iframe,'contentDocument',{value:inner.window.document});
  Object.defineProperty(inner.window,'parent',{value:outer.window});
  outer.window.postMessage=data=>{
   if(data?.type==='homeflux.visual.savingsRequest')return;
   outer.window.dispatchEvent(new outer.window.MessageEvent('message',{data,source:inner.window}));
  };
  inner.window.postMessage=data=>inner.window.dispatchEvent(new inner.window.MessageEvent('message',{data,source:outer.window}));
  function evaluate(dom){for(const script of dom.window.document.querySelectorAll('script:not([src])'))dom.window.eval(script.textContent);}
  evaluate(outer);
  const H={getSettings:()=>({visualLook:true,visualProfile:'medium'}),getWidgetInstanceId:()=> 'test',__:k=>k,
   on:()=>{},off:()=>{},ready:async()=>{},setHeight:async()=>{},api:async(method,p)=>{
    calls.push(p);const u=new URL(p,'http://local'),query=Object.fromEntries(u.searchParams);let value;
    if(u.pathname==='/status')value=await api.getStatus({homey:app.homey,query});
    else if(u.pathname==='/visual-profile')value=await api.getVisualWidgetProfile({homey:app.homey,query});
    else if(u.pathname==='/house-load-history')value={rows:[]};
    else if(u.pathname==='/savings')value=await api.getSavings({homey:app.homey,query});
    else if(u.pathname==='/ev-savings')throw new Error('Separate EV route disabled to test the house/status path');
    else throw new Error('Unknown route '+p);
    return JSON.parse(JSON.stringify(value));
   }};
  const ready=outer.window.onHomeyReady(H);
  for(let i=0;i<50;i++)await Promise.resolve();
  evaluate(inner);
  await ready;
  for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,1));
  inner.window.document.querySelector('[data-speriod="month"]').click();
  const values=Object.fromEntries(['houseSavingsValue','evSavingsValue','evCostValue','evSavingsBreakdown'].map(id=>[id,inner.window.document.getElementById(id).textContent]));
  console.log(JSON.stringify({mode,values,errors,evRequests:calls.filter(x=>x.includes('/ev-savings')).length,statusPaths:calls.filter(x=>x.startsWith('/status'))}));
  if(mode!=='old'){
   for(const period of ['week','year','total','month']){
    inner.window.document.querySelector('[data-speriod="'+period+'"]').click();
    assert.equal(inner.window.document.getElementById('evSavingsValue').textContent,'€ 3,58',period);
   }
   const selector=inner.window.document.getElementById('savingsEvSelect');selector.value='1';
   selector.dispatchEvent(new inner.window.Event('change',{bubbles:true}));
   assert.equal(inner.window.document.getElementById('evCostValue').textContent,'€ 94,41');
   selector.value='all';selector.dispatchEvent(new inner.window.Event('change',{bubbles:true}));
   inner.window.postMessage({type:'homeflux.visual.savings',period:'month',ev:'all',
    solar:{ev_data_available:true,value:999,kwh:999}});
   assert.equal(inner.window.document.getElementById('evSavingsValue').textContent,'€ 3,58','late optional response cannot overwrite status');
  }
  if(mode==='old'){assert.equal(values.evSavingsValue,'—');assert.notEqual(values.houseSavingsValue,'—');}
  else{assert.equal(values.evSavingsValue,'€ 3,58');assert.equal(values.evCostValue,'€ 94,41');assert(values.evSavingsBreakdown.includes('343,9 kWh'));assert.equal(calls.filter(x=>x.includes('/ev-savings')).length,0);assert.deepEqual(errors,[]);}
 }finally{outer.window.close();inner.window.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
