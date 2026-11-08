'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const W=require('../lib/waf-presentation'),E=require('../lib/ems-engine'),{localDateTimeUtcMs}=require('../lib/homey-energy');
const {boot}=require('./startup-harness');
const now=Date.parse('2026-11-08T11:00:00Z'),MIN=60000;
const base={...E.DEFAULTS,timezone:'Europe/Brussels',wafBatterySavingEnabled:true,wafMinCheapMinutes:90,peakShaveEnabled:true,peakLimitW:2650,peakSoftMarginW:100};
const tariff={kind:'fixed',className:'cheap',price:0.25,nextAt:new Date(now+4*3600000)};
let checks=0;
function check(name,fn){fn();checks++;}
function mock(){return {planningCache:{energyBudget:{ready:true,calculatedAt:now,valueKwh:-8}},displayLanguage:()=> 'en',getEmsWidgetTokens:()=>({emsdecision:'Saving battery'}),getGridFreshness:()=>({fresh:true,updatedAt:now,value:500}),latestResult:{},state:{},inputUpdatedAt:{grid:now}};}
function active(saving=true,cls='cheap',settings={},extra={}){const app=mock();app.getEmsWidgetTokens=()=>({emsdecision:saving?'Saving battery':'Discharging battery'});const result={tariff:{...tariff,className:cls},...extra};W.refresh(app,result,{...base,...settings},now);return app.planningCache.wafPresentation;}
for(const [saving,cls,expected]of [[true,'cheap',true],[true,'normal',false],[true,'expensive',false],[false,'cheap',false],[false,'expensive',false],[true,'unknown',false]])check('saving/price matrix '+saving+'/'+cls,()=>assert.equal(active(saving,cls).active,expected));
check('setting, strict boundary, configurable duration, unknown price/time',()=>{
 assert(!active(true,'cheap',{wafBatterySavingEnabled:false}).active);
 for(const minutes of [89,90])assert(!active(true,'cheap',{}, {tariff:{...tariff,nextAt:new Date(now+minutes*MIN)}}).active);
 assert(active(true,'cheap',{}, {tariff:{...tariff,nextAt:new Date(now+91*MIN)}}).active);
 assert(!active(true,'cheap',{wafMinCheapMinutes:300}).active);
 for(const price of [null,undefined,'',false,NaN])assert(!active(true,'cheap',{}, {tariff:{...tariff,price}}).active);
 for(const nextAt of [null,undefined,'bad',new Date(now)])assert(!active(true,'cheap',{}, {tariff:{...tariff,nextAt}}).active);
 assert(active(true,'cheap',{}, {tariff:{...tariff,price:-0.1}}).active);
});
check('TOU adjacent equal-price blocks, higher segment and missing block',()=>{
 const settings={...base,contractType:'tou',touRates:[{id:'low',name:'Low',importPrice:0.2},{id:'same',name:'Same',importPrice:0.2},{id:'high',name:'High',importPrice:0.5}],touSchedule:[{rateId:'low',start:'00:00',end:'13:00',days:[1,2,3,4,5,6,7]},{rateId:'same',start:'13:00',end:'16:00',days:[1,2,3,4,5,6,7]},{rateId:'high',start:'16:00',end:'00:00',days:[1,2,3,4,5,6,7]}]};
 const t=E.findCurrentTariff(new Date(now),settings);assert.equal(t.className,'cheap');assert.equal(Number(t.nextAt),now+60*MIN);
 assert(W.cheapWindow(settings,t,null,null,now));assert(!W.cheapWindow({...settings,wafMinCheapMinutes:240},t,null,null,now));
 const gap={...settings,touSchedule:settings.touSchedule.filter(row=>row.rateId!=='same')};assert(!W.cheapWindow(gap,E.findCurrentTariff(new Date(now),gap),null,null,now));
});
check('normalized dynamic segment and trusted continuous coverage',()=>{
 const slots=Array.from({length:8},(_,i)=>({dateKey:'2026-11-08',minute:720+i*15,startMs:now+i*15*MIN,price:0.15+i*.001}));
 const selection={source:'external',sources:[{source:'external',ready:true}],slots};
 const prices={available:true,isCheapNow:true,source:'external',currentPrice:.15,slotIntervalMinutes:15};
 const t={...tariff,kind:'dynamic',nextAt:new Date(now+120*MIN)};
 assert(W.cheapWindow(base,t,prices,selection,now));assert(!W.cheapWindow(base,{...t,nextAt:new Date(now+90*MIN)},prices,selection,now));
 assert(!W.cheapWindow(base,t,{...prices,available:false},selection,now));assert(!W.cheapWindow(base,t,{...prices,currentPrice:null},selection,now));
 assert(!W.cheapWindow(base,t,prices,{...selection,sources:[{source:'external',ready:false}]},now));
 assert(!W.cheapWindow(base,t,prices,{...selection,slots:slots.filter((_,i)=>i!==3)},now));
 const midnight=localDateTimeUtcMs('2026-11-09','00:00','Europe/Brussels');assert(!W.cheapWindow(base,{...t,nextAt:new Date(midnight+120*MIN)},prices,selection,midnight-60*MIN));
});
check('Peak Guard total, export, soft margin, reserve and stale inputs',()=>{
 for(const [grid,expected] of [[0,2500],[500,2000],[-500,3000],[2500,0],[3000,0]]){
  const app=mock();app.getGridFreshness=()=>({fresh:true,value:grid,updatedAt:now});assert.equal(W.gridRoom(app,base,now),expected);
 }
 const app=mock();app.latestResult.peakGuardExtraLoadW=800;assert.equal(W.gridRoom(app,base,now),1200);
 assert.equal(W.gridRoom(app,{...base,peakShaveEnabled:false},now),null);assert.equal(W.gridRoom(app,{...base,peakLimitW:null},now),null);
 for(const grid of [{fresh:false,value:500,updatedAt:now-61000},{fresh:true,value:null,updatedAt:now},{fresh:true,value:0,updatedAt:now+1}]){app.getGridFreshness=()=>grid;assert.equal(W.gridRoom(app,base,now),null);}
});
check('phase margins, idle guard and stale/uncertain feedback',()=>{
 const s={...base,phaseGuard:{phases:3,enabled:true,voltage:230,amps:20,safetyPercent:80,limitW:3000}};
 const app=mock();app.lastEmittedCommands=[0];app.gridPhases=[500,2800,-100].map(watts=>({watts,at:now}));
 assert.equal(W.gridRoom(app,s,now),200);app.gridPhases[1].watts=3100;assert.equal(W.gridRoom(app,s,now),0);
 app.gridPhases[1]={watts:500,at:now-15001};assert.equal(W.gridRoom(app,s,now),null);app.gridPhases[1]={watts:500,at:now};
 app.phaseGuardRuntime={publicationUncertain:true};assert.equal(W.gridRoom(app,s,now),null);
});
check('unchanged category retains snapshot; no history or control work',()=>{
 const app=mock();let grid=500;app.getGridFreshness=()=>({fresh:true,value:grid,updatedAt:now});W.refresh(app,{tariff},base,now);
 const view=app.planningCache.wafPresentation,budget=JSON.stringify(app.planningCache.energyBudget);assert.equal(view.gridRoomW,2000);
 grid=540;assert.equal(W.updateRoom(app,base,now),false);assert.strictEqual(app.planningCache.wafPresentation,view);
 grid=551;assert.equal(W.updateRoom(app,base,now+MIN),true);assert.equal(view.gridRoomW,1900);assert.equal(view.roomUpdatedAt,now+MIN);
 app.getGridFreshness=()=>({fresh:false});assert(W.updateRoom(app,base,now+2*MIN));assert.equal(view.gridRoomW,null);assert.equal(W.updateRoom(app,base,now+3*MIN),false);
 assert.equal(JSON.stringify(app.planningCache.energyBudget),budget);
 const source=fs.readFileSync(path.join(__dirname,'../lib/waf-presentation.js'),'utf8');assert(!/setInterval|setTimeout|\.trigger\(|\.emit\(|settings\.set|evaluate\(/.test(source));
});
(async()=>{
 const h=await boot();const app=h.app;
 const label=require('../locales/en.json').widget.status.decisionSaveBattery;
 assert.equal(label,'Saving battery');assert.equal(app.getSettingsSnapshot().wafBatterySavingEnabled,true);assert.equal(app.getSettingsSnapshot().wafMinCheapMinutes,90);
 const baseResult={controlEnabled:true,inputReady:true,canPublishCommands:true,candidateTotalCommandW:0,baseMode:'charge',action:'idle'};
 app.state.lastTotalCommandW=0;app.planningCache={energyBudget:{ready:true,calculatedAt:now,valueKwh:-8}};
 const projected={...baseResult,tariff};app.latestResult=projected;app.inputSeen.grid=true;app.inputUpdatedAt.grid=now;app.state.gridPowerW=500;
 W.refresh(app,projected,base,now);assert(app.planningCache.wafPresentation.active);checks++;
 for(const change of [{inputReady:false},{controlEnabled:false},{action:'grid_charge'},{action:'pv_charge'},{action:'discharge'},{safetySocRecoveryActive:true},{baseMode:'standby'},{hybridEms:{owner:'external'}}]){
  W.refresh(app,{...projected,...change},base,now);assert(!app.planningCache.wafPresentation.active,JSON.stringify(change));checks++;
 }
 const memo={unchanged:true};app.batteryFeedbackMemo=memo;const generation=app.planningCache.generation,dirty=app.contextDirty,flexDirty=app.flexibleLoadsDirty;
 await h.setExternalSetting('wafBatterySavingEnabled',false);await h.setExternalSetting('wafMinCheapMinutes',135);
 assert.strictEqual(app.batteryFeedbackMemo,memo);assert.equal(app.contextDirty,dirty);assert.equal(app.flexibleLoadsDirty,flexDirty);assert.equal(app.planningCache.generation,generation);assert.equal(app.planningCache.wafPresentation,null);assert.equal(app.wafPreferences.wafBatterySavingEnabled,false);assert.equal(app.wafPreferences.wafMinCheapMinutes,135);checks++;
 const start=performance.now();const m=mock();W.refresh(m,{tariff},base,now);const serialized=JSON.stringify(m.planningCache.wafPresentation).length;
 for(let i=0;i<10000;i++)W.updateRoom(m,base,now);const elapsed=performance.now()-start;
 assert(serialized<250);assert.equal(Object.keys(m).length,7);checks++;
 assert.deepEqual(h.errors,[]);
 console.log(`WAF presentation: ${checks} checks passed; 10,000 room checks ${elapsed.toFixed(1)} ms; snapshot ${serialized} JSON bytes (no history).`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
