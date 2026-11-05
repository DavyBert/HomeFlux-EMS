'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{boot,DEFAULTS}=require('./startup-harness');
(async()=>{
 const h=await boot(new Map(Object.entries({...DEFAULTS,batteryCount:2,controlEnabled:false,chargeTestPassed:false,settingsSchemaVersion:70}))),a=h.app;a.homey.app=a;a.waitSplitPowerDelay=async()=>{};
 let writes=0,resumes=0;a.commandTrigger.trigger=async()=>{writes++;};a.requestContextEvaluate=()=>{resumes++;};const api=require('../api');
 await assert.rejects(()=>api.approveChargeTestWithoutTest({homey:a.homey,body:{}}),/declaration|verklaring/);assert.equal(a.isChargeTestValid(),false);
 const result=await api.approveChargeTestWithoutTest({homey:a.homey,body:{confirmed:true}});assert.equal(result.approvalMethod,'declaration');assert.equal(writes,0,'idle approval must send no physical test command');assert.equal(a.isChargeTestValid(),true);assert.equal(a.getSettings().controlEnabled,true);assert.equal(a.getPublicStatus().chargeTest.approvalMethod,'declaration');assert.equal(resumes,1);
 const restarted=await boot(new Map(h.store));assert.equal(restarted.app.isChargeTestValid(),true);assert.equal(restarted.app.getPublicStatus().chargeTest.approvalMethod,'declaration');
 await h.setExternalSetting('batteryCount',3);assert.equal(a.isChargeTestValid(),false);assert.equal(a.chargeTestManualApproval,null);
 a.commandPublishing=true;await assert.rejects(()=>a.approveChargeTestWithoutTest({confirmed:true}),/gepubliceerd/);a.commandPublishing=false;
 a.batteryResponseTest={running:true};await assert.rejects(()=>a.approveChargeTestWithoutTest({confirmed:true}),/reactietest/);a.batteryResponseTest.running=false;
 await a.startChargeTest();assert.equal(a.chargeTestRunning,true);const before=writes;await a.approveChargeTestWithoutTest({confirmed:true});assert.equal(writes,before+1,'active manual test receives its normal zero cleanup only');assert.equal(a.chargeTestRunning,false);assert(a.isChargeTestValid());
 const html=fs.readFileSync('settings/index.html','utf8'),start=html.indexOf('  async function approveChargeTestFromUi('),end=html.indexOf("  q('approveChargeTest').addEventListener",start),code=html.slice(start,end);
 for(const accepted of [false,true]){let calls=0;const ctx=vm.createContext({q:()=>({disabled:false}),Homey:{confirm:(_,cb)=>cb(null,accepted),alert:()=>{}},translateUiText:x=>x,api:async(method,path,body)=>{calls++;assert.equal(path,'/charge-test/approve');assert.equal(body.confirmed,true);},refreshStatus:()=>{}});vm.runInContext(code,ctx);await ctx.approveChargeTestFromUi();assert.equal(calls,accepted?1:0);}
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/src=/.test(m[1]))new vm.Script(m[2]);
 console.log('Manual approval: explicit declaration, cancel, no pulse, safe active-test cleanup, output resume, restart persistence, re-invalidation and busy/other-test guards passed.');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
