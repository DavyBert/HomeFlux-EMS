'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{boot,DEFAULTS}=require('./startup-harness');
(async()=>{
 const h=await boot(new Map(Object.entries({...DEFAULTS,batteryCount:1,controlEnabled:false,settingsSchemaVersion:70}))),a=h.app;a.waitSplitPowerDelay=async()=>{};
 async function pass(){await a.startChargeTest();await a.confirmChargeTest({ok:true});await a.confirmChargeTest({ok:true});}
 await pass();assert(a.isChargeTestValid());await h.setExternalSetting('phaseGuard',{...a.getSettings().phaseGuard,phases:3,batteries:['balanced3']});assert(a.isChargeTestValid());assert.notEqual(a.getPublicStatus().chargeTest.invalidationCode,'configuration_changed');
 await h.setExternalSetting('batteryCount',2);assert.equal(a.isChargeTestValid(),false);assert.equal(a.getPublicStatus().chargeTest.invalidationCode,'configuration_changed');
 const html=fs.readFileSync('settings/index.html','utf8'),start=html.indexOf('  function notifyChargeTestRequirement('),end=html.indexOf('  async function refreshStatus()',start),alerts=[];
 const ctx=vm.createContext({directionTestRequest:{pending:false},translateUiText:x=>x,Homey:{alert:x=>alerts.push(x)}});vm.runInContext(html.slice(start,end),ctx);
 for(let i=0;i<5;i++)ctx.notifyChargeTestRequirement(a.getPublicStatus().chargeTest);assert.equal(alerts.length,1,'one popup only across status refreshes');
 await pass();ctx.notifyChargeTestRequirement(a.getPublicStatus().chargeTest);assert.equal(a.getPublicStatus().chargeTest.invalidationCode,'');assert.equal(alerts.length,1);
 await h.setExternalSetting('invertBatteryCommand',true);ctx.notifyChargeTestRequirement(a.getPublicStatus().chargeTest);assert.equal(alerts.length,2,'a later genuine invalidation gets its own popup');
 ctx.notifyChargeTestRequirement({passed:true,batteryCount:0});ctx.notifyChargeTestRequirement({passed:false,batteryCount:0,invalidationCode:'configuration_changed'});assert.equal(alerts.length,2,'no popup without a battery');
 await a.startChargeTest();assert.equal(a.getPublicStatus().chargeTest.invalidationCode,'');await a.confirmChargeTest({ok:false});
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/src=/.test(m[1]))new vm.Script(m[2]);
 console.log('Direction notice: real count/inversion changes require test and popup once; phase changes, no-battery and explicit test starts do not warn.');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
