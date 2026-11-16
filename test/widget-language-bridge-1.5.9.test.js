'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'widgets/status/public/index.html'),'utf8');
const profile={name:'medium',configured:true,...require('../lib/visual-widget-profiles').defaults().medium};
(async()=>{
 for(const language of ['nl','en','fr','de','es']){
  const errors=[],logs=new VirtualConsole();logs.on('jsdomError',e=>{if(e.type!=='css-parsing')errors.push(e.message)});
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://widget.test/',virtualConsole:logs});
  const w=dom.window,frame=w.document.getElementById('visualView'),messages=[],requests=[];
  frame.contentWindow.postMessage=data=>messages.push(data);
  const locale=JSON.parse(fs.readFileSync(path.join(root,'locales',language+'.json'),'utf8'));
  const socRow={at:Date.now()-300000,cursorAt:Date.now()-1000,soc:63.7,socAt:Date.now()-2000};
  const homey={getSettings:()=>({visualLook:true,visualProfile:'medium'}),
   __:key=>key.split('.').reduce((o,k)=>o?.[k],locale)??key,
   on:()=>{},off:()=>{},ready:async()=>{},setHeight:async()=>{},
   api:async(method,url)=>{
    requests.push(url);
    if(url.startsWith('/visual-profile?'))return structuredClone(profile);
    if(url==='/house-load-history')return {date:'2026-11-16',intervalSeconds:300,rows:[socRow]};
    if(url.startsWith('/status'))return {version:'1.5.9',decisionText:'SERVER STATUS',settings:{evCount:0,hvacCount:0},visualSavings:{evPeriods:{day:{}}}};
    if(url.startsWith('/savings'))return {period:'day',periodSavings:0,actualCost:0};
    throw Error('Unexpected widget request: '+url);
   }};
  const ready=w.onHomeyReady(homey);
  // Setting iframe.src replaces its Window in jsdom, just as navigation does.
  frame.contentWindow.postMessage=data=>messages.push(data);
  await new Promise(resolve=>setTimeout(resolve,0));
  w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,data:{type:'homeflux.visual.height',height:400}}));
  await ready;
  w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,data:{type:'homeflux.visual.ready'}}));
  const configurations=messages.filter(message=>message.type==='homeflux.visual.widgetConfig');
  assert(configurations.length>0,'iframe receives configuration');
  assert(configurations.every(message=>message.translations?.language===language),'Homey language is forwarded automatically');
  assert(messages.some(message=>Array.isArray(message.rows)&&message.rows[0]?.soc===63.7)
   ||messages.some(message=>message.houseHistory?.[0]?.soc===63.7),'SOC-only points cross the parent bridge');
  assert.equal(requests.filter(url=>url==='/house-load-history').length,1,'history opens once');
  assert.equal(requests.filter(url=>url.startsWith('/status')).length,1,'language does not request another status');
  assert.equal(requests.filter(url=>url.startsWith('/visual-profile?')).length,1,'profile cache remains in use');
  assert.equal(errors.length,0,errors.join('\n'));
  w.dispatchEvent(new w.Event('unload'));dom.window.close();
  console.log('PASS automatic Homey-to-iframe language, SOC-only transport and existing request counts: '+language);
 }
})().catch(error=>{console.error(error);process.exitCode=1});
