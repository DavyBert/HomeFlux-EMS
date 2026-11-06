'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {boot}=require('./startup-harness');
const {createTranslator}=require('../settings/display-language');
(async()=>{
 const h=await boot(new Map([['batteryCount',1],['hybridEmsEnabled',true],['peakShaveEnabled',false],['minSoc',7],['safetySoc',7]])),a=h.app;
 const s=a.getSettings();let checks=0,requests=0;
 a.externalEmsSelfConsumptionTrigger={trigger:async()=>{requests++;}};
 const pure={baseMode:'self_consumption',inputReady:true,controlEnabled:true,avgSoc:50,batteryDischargeFloorSoc:7,plannedChargeW:0,override:null,statusText:'Self consumption',liveGridPowerW:0};
 for(const importW of [50,200,0,50,200,0]){
  a.state.gridPowerW=importW;a.inputSeen.grid=true;
  const r=a.refreshBatteryPresentationAfterCoordination({...pure},s,-1000);
  assert.equal(r.gridChargeAssistW,importW);assert(a.updateHybridEmsDelegation(r,s));checks++;
 }
 assert.equal(requests,1,'incidental import must not hand ownership back and forth');checks++;
 for(const change of [{baseMode:'charge',plannedChargeW:500},{baseMode:'manual_charge'},{plannedChargeW:500},{safetySocRecoveryActive:true},{override:'peak_shave'},{lowForecastBatterySaveActive:true},{lowForecastDischargeToTargetActive:true},{peakReserveProtected:true},{evIntentionalGridImportW:1000},{batteryDischargeBlockedByEv:true},{batteryPauseCode:'pause'},{inputReady:false},{controlEnabled:false}]){
  assert(!a.updateHybridEmsDelegation({...pure,...change},s));checks++;
 }
 assert(!a.updateHybridEmsDelegation({...pure,liveGridPowerW:2600},{...s,peakShaveEnabled:true,peakLimitW:2650,peakSoftMarginW:100}));assert(!a.hybridEmsRuntime.delegated);checks++;
 a.resetHybridEmsRuntime();
 assert(!a.updateHybridEmsDelegation({...pure},{...s,hybridEmsEnabled:false}));checks++;
 assert.equal(s.hybridHandoverMinSocEnabled,false);assert.equal(s.hybridHandoverMinSoc,11);checks++;
 assert(a.isHybridExternalControlEligible({...pure,avgSoc:9},s));checks++;
 assert(!a.isHybridExternalControlEligible({...pure,avgSoc:7},s));checks++;
 const gated={...s,hybridHandoverMinSocEnabled:true,hybridHandoverMinSoc:11};
 // Isolate the SoC boundary checks from the preceding real Peak Guard event.
 a.resetHybridEmsRuntime();a.hybridEmsRuntime.peakGuardWasActive=false;a.hybridEmsRuntime.peakGuardCooldownUntil=0;
 for(const [soc,expected] of [[9,false],[10.9,false],[11,true],[10.5,true],[10.1,true],[10,false],[10.5,false],[10.9,false],[11,true]]){
  assert.equal(a.updateHybridEmsDelegation({...pure,avgSoc:soc},gated),expected,'handover SoC '+soc);checks++;
 }
 assert(!a.updateHybridEmsDelegation({...pure,avgSoc:10.5,safetySocRecoveryActive:true},gated));checks++;
 a.resetHybridEmsRuntime();assert(a.updateHybridEmsDelegation({...pure,avgSoc:11},gated));
 assert(!a.updateHybridEmsDelegation({...pure,avgSoc:10.5,liveGridPowerW:2600},{...gated,peakShaveEnabled:true,peakLimitW:2650,peakSoftMarginW:100}));checks++;
 a.resetHybridEmsRuntime();
 for(const value of [null,'',-1,101,NaN]){assert(!a.isHybridExternalControlEligible(pure,{...gated,hybridHandoverMinSoc:value}));checks++;}
 for(const soc of [null,undefined,NaN]){assert(!a.isHybridExternalControlEligible({...pure,avgSoc:soc},gated));checks++;}
 assert(!a.isHybridExternalControlEligible({...pure,avgSoc:100},{...s,maxSoc:100}));checks++;
 assert.equal(a.getSettings().safetySoc,7);assert.equal(a.getSettings().minSoc,7);checks++;
 // Exercise existing settings callback/cache, without a new listener/timer.
 const timers=h.timers.length;let contexts=0;a.requestContextEvaluate=()=>{contexts++;};
 await h.setExternalSetting('hybridHandoverMinSocEnabled',true);await h.setExternalSetting('hybridHandoverMinSoc',13);
 assert.equal(a.getSettingsSnapshot().hybridHandoverMinSoc,13);assert(a.getSettingsSnapshot().hybridHandoverMinSocEnabled);assert.equal(contexts,2);assert.equal(h.timers.length,timers);checks++;
 await h.setExternalSetting('_autoTuneLearning',{days:[]});assert.equal(contexts,2,'checkpoint writes must not force an EMS evaluation');checks++;
 // The two new options use existing settings snapshot/save lists and types.
 const html=fs.readFileSync('settings/index.html','utf8');
 const ids=vm.runInNewContext(html.match(/const ids = (\[[\s\S]*?\]);/)[1]);
 const numeric=vm.runInNewContext(html.match(/const numeric = new Set\((\[[\s\S]*?\])\);/)[1]);
 const boolean=vm.runInNewContext(html.match(/const boolean = new Set\((\[[\s\S]*?\])\);/)[1]);
 assert(ids.includes('hybridHandoverMinSocEnabled')&&ids.includes('hybridHandoverMinSoc'));assert(numeric.includes('hybridHandoverMinSoc'));assert(boolean.includes('hybridHandoverMinSocEnabled'));checks++;
 const panel=html.slice(html.indexOf('<section class="panel" id="panel-hybrid-ems">'),html.indexOf('<section class="panel" id="panel-contract">'));
 assert(panel.includes('id="hybridHandoverMinSoc"'));assert.equal((html.match(/id="hybridHandoverMinSoc"/g)||[]).length,1);checks++;
 // Run the actual conditional UI statements with minimal field objects.
 const fragment=html.slice(html.indexOf('    const handoverEnabled='),html.indexOf('    updateSplitBatteryUi();',html.indexOf('    const handoverEnabled=')));
 for(const [enabled,optIn,count,wanted] of [[true,true,1,true],[true,false,1,false],[false,true,1,false],[true,true,0,false]]){
  const fields={hybridHandoverMinSocEnabled:{checked:optIn},hybridHandoverMinSoc:{},hybridHandoverMinSocGroup:{classList:{toggle:(cls,hidden)=>{fields.hidden=hidden;}}}};
  vm.runInNewContext(fragment,{hybrid:{checked:enabled},count,q:id=>fields[id]});assert.equal(fields.hidden,!wanted);assert.equal(fields.hybridHandoverMinSoc.disabled,!wanted);checks++;
 }
 const label='Minimale SoC voor externe overdracht';
 for(const lang of ['nl','en','fr','es','de']){
  const bundle=JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json'));
  assert(bundle.exact[label]);const translated=createTranslator(bundle)(label);assert.equal(translated,bundle.exact[label]);checks++;
 }
 console.log(`Hybrid handover 1.2.33: ${checks} ownership, priority, hysteresis, settings and translation checks passed.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
