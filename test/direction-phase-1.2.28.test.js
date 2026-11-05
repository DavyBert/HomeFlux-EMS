'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{boot,DEFAULTS}=require('./startup-harness');
(async()=>{
 const h=await boot(new Map(Object.entries({...DEFAULTS,batteryCount:1,controlEnabled:false,settingsSchemaVersion:70}))),a=h.app;a.homey.app=a;a.waitSplitPowerDelay=async()=>{};
 const api=require('../api');await api.startChargeTest({homey:a.homey});await api.confirmChargeTest({homey:a.homey,body:{ok:true}});await api.confirmChargeTest({homey:a.homey,body:{ok:true}});a.setSetting('controlEnabled',true);
 for(const [key,value]of [['phaseGuard',{...a.getSettings().phaseGuard,phases:3,batteries:['balanced3']}],['batteryCount',1],['invertBatteryCommand',false],['splitCommandBattery1Enabled',false]]){await h.setExternalSetting(key,value);assert(a.isChargeTestValid(),key);assert.equal(a.getSettings().controlEnabled,true);}
 await h.setExternalSetting('invertBatteryCommand',true);assert.equal(a.isChargeTestValid(),false);assert.equal(a.getSettings().controlEnabled,false);
 await api.startChargeTest({homey:a.homey});await h.setExternalSetting('batteryCount',1);assert.equal(a.chargeTestAwaitingConfirmation,true);await api.confirmChargeTest({homey:a.homey,body:{ok:false}});assert.equal(a.chargeTestRunning,false);
 const html=fs.readFileSync('settings/index.html','utf8');for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/src=/.test(m[1]))new vm.Script(m[2]);
 const start=html.indexOf('  async function directionTestRequest('),end=html.indexOf("  q('startChargeTest').addEventListener",start);const code=html.slice(start,end);
 for(const test of [{running:true,stage:'charge',commandPerBatteryW:-100},{running:true,stage:'discharge',commandPerBatteryW:100},{passed:true,stage:'passed'},{stage:'failed'}]){let posts=0,gets=0;const ctx=vm.createContext({translateUiText:x=>x,api:async method=>{if(method==='POST'){posts++;return undefined;}gets++;return{chargeTest:test};}});vm.runInContext(code,ctx);assert.equal(await ctx.directionTestRequest(test.stage==='charge'?'/charge-test/start':'/charge-test/confirm',{}),test);assert.equal(posts,1);assert.equal(gets,1);}
 const stale=vm.createContext({translateUiText:x=>x,api:async method=>method==='GET'?{chargeTest:{passed:true,stage:'passed'}}:undefined});vm.runInContext(code,stale);await assert.rejects(()=>stale.directionTestRequest('/charge-test/start',{}),/Start eerst/);
 const ctx=vm.createContext({translateUiText:x=>x,api:async()=>undefined});vm.runInContext(code,ctx);await assert.rejects(()=>ctx.directionTestRequest('/test',{}),/Start eerst/);
 await h.setExternalSetting('batteryCount',0);await h.setExternalSetting('batteryCount',1);assert.equal(a.isChargeTestValid(),false,'battery count changes still require validation');
 console.log('Direction/phase regression: phase and identical writes retain validation; real direction changes invalidate; real API start/stop and missing-response fallback passed.');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
