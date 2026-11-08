'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const W=require('../lib/waf-presentation'),{page}=require('./helpers/settings-page-1.2.37.cjs');
const now=Date.parse('2026-11-08T12:00:00Z'),settings={peakShaveEnabled:true,peakLimitW:2650,peakSoftMarginW:100,timezone:'Europe/Brussels',...W.defaults};
const tariff={kind:'fixed',className:'cheap',price:.2,nextAt:new Date(now+4*3600000)};
function fixture(){const events=[],budget={ready:true,calculatedAt:now,valueKwh:7};const app={planningCache:{energyBudget:budget,wafPresentation:{active:true,eligible:true,calculatedAt:now,gridRoomW:2000,roomUpdatedAt:now}},latestResult:{tariff,inputReady:true},getGridFreshness:()=>({fresh:true,value:500,updatedAt:now}),getEmsWidgetTokens:()=>({emsdecision:'Saving battery'}),displayLanguage:()=> 'en',homey:{api:{realtime:(event,payload)=>events.push({event,payload})}}};return {app,events,budget};}
let checks=0;
for(const result of [{override:'peak_shave'},{action:'peak_shave'},{phaseChargeGuard:{enabled:true,limited:true}},{phaseChargeGuard:{enabled:true,limited:false,state:'inactive',limitW:3000,values:[{watts:3100,at:now}]}}]){
 const {app,events,budget}=fixture();W.observeGuard(app,result,settings,now);assert(!app.planningCache.wafPresentation.active);assert.equal(app.planningCache.wafPresentation.gridRoomW,null);assert(app.wafPeakGuard.blocked);assert.equal(events.length,1);assert(events[0].payload.wafPeakGuard.peakGuardBlocked);assert.strictEqual(app.planningCache.energyBudget,budget);W.observeGuard(app,result,settings,now+1);assert.equal(events.length,1,'no repeated events during an ongoing intervention');checks++;
}
{
 const {app,events}=fixture();W.observeGuard(app,{override:'peak_shave'},settings,now);
 W.observeGuard(app,{inputReady:true},settings,now+1000);
 assert.equal(app.wafPeakGuard.clearSince,now+1000);assert(!W.updateRoom(app,settings,now+60999));assert(!app.planningCache.wafPresentation.active);
 W.observeGuard(app,{override:'peak_shave'},settings,now+61000);assert.equal(app.wafPeakGuard.clearSince,0);assert(!W.updateRoom(app,settings,now+500000));
 W.observeGuard(app,{inputReady:true},settings,now+501000);
 assert(!W.updateRoom(app,settings,now+560999));assert(W.updateRoom(app,settings,now+561000));assert(app.planningCache.wafPresentation.active);assert(!app.wafPeakGuard.blocked);assert.equal(events.length,2);assert.equal(events[1].payload.wafPeakGuard.active,true);checks++;
}
{
 const {app}=fixture();W.observeGuard(app,{override:'peak_shave'},settings,now);W.observeGuard(app,{inputReady:false},settings,now+100000);assert(!W.updateRoom(app,settings,now+200000));
 W.observeGuard(app,{inputReady:true},settings,now+201000);app.getGridFreshness=()=>({fresh:false});assert(!W.updateRoom(app,settings,now+261000));assert(app.wafPeakGuard.blocked);checks++;
}
{
 const {app}=fixture();W.observeGuard(app,{override:'peak_shave'},settings,now);app.planningCache.energyBudget.calculatedAt=now+10000;app.getEmsWidgetTokens=()=>({emsdecision:'Peak Guard support'});W.refresh(app,{tariff,override:'peak_shave'},settings,now+10000);assert(app.planningCache.wafPresentation.eligible);assert(!app.planningCache.wafPresentation.active);
 W.observeGuard(app,{inputReady:true},settings,now+11000);app.getEmsWidgetTokens=()=>({emsdecision:'Discharging battery'});W.updateRoom(app,settings,now+71000);assert(!app.planningCache.wafPresentation.active,'do not restore when saving no longer applies');checks++;
}
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'widgets/status/public/index.html'),'utf8'),script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
(async()=>{
 for(const lang of ['nl','en','fr','de','es']){
  const h=await page(lang),q=id=>h.doc.getElementById(id);assert(q('panel-ems').contains(q('wafColorsEnabled')));assert(q('wafColorsEnabled').checked);
  for(const [key,value] of Object.entries(W.defaults))assert.equal(q(key).type==='checkbox'?q(key).checked:Number(q(key).value),value,key);
  q('wafReserveOrangeKwh').value='8';q('save').click();for(let i=0;i<20;i++)await Promise.resolve();assert(h.alerts.length);assert.equal(h.writes.length,0);
  q('wafReserveOrangeKwh').value='2';q('wafRoomGreenW').value='2500';q('wafColorsEnabled').click();q('save').click();for(let i=0;i<30;i++)await Promise.resolve();assert.deepEqual(h.writes.map(v=>v.key).sort(),['wafReserveOrangeKwh','wafRoomGreenW','wafColorsEnabled'].sort());h.close();checks++;
 }
 const {boot}=require('./startup-harness');const backend=await boot();const keep={active:true};backend.app.planningCache.wafPresentation=keep;await backend.setExternalSetting('wafRoomGreenW',2500);assert.strictEqual(backend.app.planningCache.wafPresentation,keep);assert.equal(backend.app.getSettingsSnapshot().wafRoomGreenW,2500);assert.deepEqual(backend.errors,[]);checks++;
 const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,events={},timers=[],locale=require('../locales/en.json');let calls=0,pending;
 w.eval(script);w.requestAnimationFrame=cb=>cb();w.setInterval=(fn,ms)=>{timers.push({fn,ms});return timers.length;};w.clearInterval=()=>{};
 const status={inputReady:true,controlEnabled:true,action:'idle',baseMode:'charge',energyBudget:{ready:true,valueKwh:7,calculatedAt:Date.now()-1000,validUntil:Date.now()+3600000,targetAt:Date.now()+3600000},wafPresentation:{active:true,eligible:true,gridRoomW:2200,guardRevision:0},wafAppearance:W.defaults};
 const Homey={getSettings:()=>({}),__:key=>key.split('.').reduce((value,part)=>value?.[part],locale)||key,on:(key,fn)=>events[key]=fn,off:()=>{},api:async()=>{calls++;if(pending)return new Promise(resolve=>pending=resolve);return structuredClone(status);},ready:async()=>{},setHeight:async()=>{}};
 await w.onHomeyReady(Homey);const circle=w.document.getElementById('energy-budget');assert.equal(circle.querySelector('small').textContent,'Grid room');assert.equal(timers.length,1);const before=calls;
 events['homeflux.ev.changed']({wafPeakGuard:{active:false,eligible:true,gridRoomW:null,peakGuardBlocked:true,guardRevision:1}});assert.equal(circle.querySelector('small').textContent,'kWh');assert.equal(circle.style.background,'rgb(176, 0, 32)');assert.equal(calls,before,'push updates DOM without another API request');assert.equal(timers.length,1);
 // A delayed response from before the intervention cannot revive the advice.
 pending=true;timers[0].fn();for(let i=0;i<5;i++)await Promise.resolve();const release=pending;pending=null;release(structuredClone(status));for(let i=0;i<20;i++)await Promise.resolve();assert.equal(w.document.getElementById('energy-budget').querySelector('small').textContent,'kWh');
 events['homeflux.ev.changed']({wafPeakGuard:{active:true,eligible:true,gridRoomW:2200,peakGuardBlocked:false,guardRevision:2}});assert.equal(w.document.getElementById('energy-budget').querySelector('small').textContent,'Grid room');checks+=3;
 const c=vm.createContext({Date});vm.runInContext(script,c);
 assert.equal(vm.runInContext('wafColor(0,true,0,1000,2000)',c),'hsl(0, 96%, 42%)');assert.equal(vm.runInContext('wafColor(1000,true,0,1000,2000)',c),'hsl(30, 96%, 33%)');assert.equal(vm.runInContext('wafColor(2000,true,0,1000,2000)',c),'hsl(120, 96%, 26%)');assert.equal(vm.runInContext('wafColor(2000,false,0,1000,2000)',c),'');checks++;
 assert.equal(vm.runInContext('wafThresholds({wafRoomRedW:0,wafRoomOrangeW:4000,wafRoomGreenW:2000},"wafRoom","W",[0,1000,2000]).join(",")',c),'0,1000,2000');checks++;
 const source=fs.readFileSync(path.join(root,'widgets/ev/public/index.html'),'utf8');let evCalls=0;const ev=vm.createContext({active:true,refresh:()=>evCalls++});vm.runInContext(source.match(/const changed=event=>[^;]+;if\(active\)refresh\(\);\};/)[0]+'changed({wafPeakGuard:{}});changed();',ev);assert.equal(evCalls,1);checks++;
 dom.window.close();console.log(`WAF Peak Guard/config: ${checks} checks passed; immediate push, stale-response protection, full-minute recovery/reset, five-language validation/save and separate colour scales.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
