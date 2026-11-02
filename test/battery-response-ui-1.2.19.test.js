'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../settings/index.html'),'utf8');
const elements=new Map(),listeners={};let refreshes=0;
const q=id=>{if(!elements.has(id)){const classes=new Set();elements.set(id,{value:'7',classList:{toggle:(k,v)=>v?classes.add(k):classes.delete(k),contains:k=>classes.has(k)}});}return elements.get(id);};
const context={q,Homey:{on:(event,callback)=>listeners[event]=callback},refreshStatus:()=>refreshes++,responseText:key=>key,HomeFluxBatteryResponseGuidance:()=>null,Intl,localeFor:()=> 'nl'};
vm.createContext(context);
vm.runInContext('let lastBatteryResponseStatus=null;'+html.slice(html.indexOf('  function renderBatteryResponse('),html.indexOf("  q('batteryResponseStart').addEventListener")),context);
const event=html.match(/  Homey.on\('settings.set', key => \{[\s\S]*?\n  \}\);/)[0];vm.runInContext(event,context);
listeners['settings.set']('unrelated');assert.equal(refreshes,0);
listeners['settings.set']('_batteryResponseTest');assert.equal(refreshes,1);
context.renderBatteryResponse({running:true});assert(!q('batteryResponseStop').classList.contains('hidden'));assert(q('batteryResponseStart').disabled);
for(const stage of ['completed','stopped']){context.renderBatteryResponse({running:false,stage,message:'done'});assert(q('batteryResponseStop').classList.contains('hidden'));assert(!q('batteryResponseStart').disabled);}
for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
console.log('UI: completion/cancellation hides Stop and enables Start; settings event refreshes only test status; inline syntax valid.');
