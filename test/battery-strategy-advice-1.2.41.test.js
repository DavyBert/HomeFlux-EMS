'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const A=require('../settings/battery-strategy-advice'),E=require('../lib/ems-engine'),{boot}=require('./startup-harness');
const base={...E.DEFAULTS,batteryCount:1,contractType:'fixed',dayPlanningMaxSoc:95,lowForecastAutoSunnyEnabled:true,lowForecastAutoSunnySoc:90,batterySaveDischargeAboveSoc:30,lowForecastFixedEnabled:true,lowForecastSelfConsumptionMinKwh:10,minSoc:10,safetySoc:14};
let checks=0;function check(name,fn){fn();checks++;}
check('95/90/30 and all effective save-floor positions',()=>{for(const floor of [30,90,95,100])assert(A.risk({...base,batterySaveDischargeAboveSoc:floor}));assert(A.risk({...base,dayPlanningMaxSoc:90}),'reaching the threshold already permits promotion');});
for(const change of [{dayPlanningMaxSoc:80},{lowForecastAutoSunnyEnabled:false},{lowForecastFixedEnabled:false},{batteryCount:0},{lowForecastSelfConsumptionMinKwh:0},{batterySaveDischargeAboveSoc:14},{safetySoc:40},{maxSoc:80},{forcedMode:'standby'},{maxTotalChargeW:0},{maxTotalDischargeW:0},{maxChargePerBatteryW:0},{maxDischargePerBatteryW:0}])check('no real configured risk '+JSON.stringify(change),()=>assert(!A.risk({...base,...change})));
check('dynamic class relevance and unchanged normal-hours saving floor',()=>{
 const s={...base,contractType:'dynamic_quarter',lowForecastFixedEnabled:false,lowForecastDynamicNormalEnabled:true,lowForecastDynamicCheapEnabled:false,lowForecastDynamicExpensiveEnabled:false};
 assert(!A.risk(s));assert(A.risk({...s,dynamicUseBatteryNormalHours:true}));assert(A.risk({...s,lowForecastDynamicCheapEnabled:true}));assert(A.risk({...s,lowForecastDynamicExpensiveEnabled:true}));
});
const rate={id:'low',importPrice:.1,lowForecastBatterySave:true,avoidGridImport:false,weekdayChargeMode:'always',weekendChargeMode:'always'};
const block={rateId:'low',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]};
check('TOU uses scheduled, effective save/charge policy, including overlaps',()=>{
 const s={...base,contractType:'tou',touRates:[rate],touSchedule:[block]};assert(A.risk(s));
 assert(!A.risk({...s,touSchedule:[]}));assert(!A.risk({...s,touRates:[{...rate,avoidGridImport:true}]}));assert(!A.risk({...s,touRates:[{...rate,weekdayChargeMode:'night',weekendChargeMode:'never'}]}));
 const first={id:'first',importPrice:.2,weekdayChargeMode:'always',weekendChargeMode:'always',lowForecastBatterySave:false};
 assert(!A.risk({...s,touRates:[first,rate],touSchedule:[{...block,rateId:'first'},block]}),'fully shadowed save rate is not used');
 assert(A.risk({...s,touRates:[{...rate,weekdayChargeMode:'night',weekendChargeMode:'day'}],touSchedule:[{...block,days:[6]}]}));
 assert(!A.risk({...s,touSchedule:[{...block,days:[]}]}));
});
check('individual power limits are respected',()=>assert(!A.risk({...base,individualBatteryPowerLimitsEnabled:true,battery1MaxChargeW:0})));
check('full future configuration catches a conflict that individual changes miss',()=>{
 const current={...base,dayPlanningMaxSoc:80,lowForecastAutoSunnySoc:100};
 const rows=[{settingKey:'dayPlanningMaxSoc',recommended:95},{settingKey:'lowForecastAutoSunnySoc',recommended:90},{settingKey:'commandDeadbandW',recommended:75}];
 assert(!A.risk(A.project(current,{dayPlanningMaxSoc:95})));assert(!A.risk(A.project(current,{lowForecastAutoSunnySoc:90})));
 assert(A.risk(A.project(current,{dayPlanningMaxSoc:95,lowForecastAutoSunnySoc:90})));
 const result=A.review(current,rows);assert(result.blocked.some(row=>row.settingKey==='lowForecastAutoSunnySoc'));assert(result.recommendations.some(row=>row.settingKey==='commandDeadbandW'));assert(!A.risk(A.project(current,Object.fromEntries(result.recommendations.map(row=>[row.settingKey,row.recommended])))));
});
check('automatic subset and range clamp cannot introduce a hidden conflict',()=>{
 const current={...base,dayPlanningMaxSoc:80,lowForecastAutoSunnySoc:100};const rows=[{settingKey:'lowForecastAutoSunnySoc',recommended:90}];
 assert.equal(A.review(current,rows).blocked.length,0);assert.equal(A.review(current,rows,[{settingKey:'lowForecastAutoSunnySoc',recommended:70}]).blocked.length,1);
 const before=JSON.stringify(current);A.review(current,rows);assert.equal(JSON.stringify(current),before);
});
check('engine confirms that a high save floor does not survive sunny promotion',()=>{
 const state={gridPowerW:500,pvPowerW:0,lastTotalCommandW:0,batterySoc:[50],forecastRemainingKwh:1,forecastDailyMaxKwh:1,forecastTomorrowKwh:1,nightPlanningActive:false};
 const s={...base,forecastDataReady:true,forecastDailyDataReady:true,fixedChargeWindowStart:'00:00',fixedChargeWindowEnd:'01:00',batterySaveDischargeAboveSoc:95,peakShaveEnabled:false,sunChanceReserveEnabled:false};
 const before=E.evaluate({...state,lowForecastSunnyOverrideActive:false},s,new Date('2026-11-08T12:00:00Z')),after=E.evaluate({...state,lowForecastSunnyOverrideActive:true},s,new Date('2026-11-08T12:00:00Z'));
 assert.equal(before.totalCommandW,0);assert(after.totalCommandW>0);assert.equal(before.ordinaryDischargeFloorSoc,95);assert.equal(after.ordinaryDischargeFloorSoc,14);
});
(async()=>{
 const h=await boot(new Map(Object.entries({...base,settingsSchemaVersion:71,lowForecastAutoSunnySoc:100,evCount:0,hvacCount:0}))),a=h.app;
 a.autoTuneRuntime.planning.days=[{dateKey:'2026-11-06',forecastKwh:2,solarTargetSoc:95},{dateKey:'2026-11-07',forecastKwh:3,solarTargetSoc:95}];
 a.autoTuneRuntime.grid={samples:200,ewmaAbsDelta:400};const learning=JSON.stringify(a.autoTuneRuntime.planning);
 const originalSettings=JSON.stringify(a.getSettings()),history=JSON.stringify(a.getAutoTuneHistory());
 const recs=a.getAutoTuneRecommendations();assert(!recs.some(r=>r.settingKey==='lowForecastAutoSunnySoc'));assert(recs.some(r=>r.settingKey==='commandDeadbandW'));assert(a.getAutoTuneStatus().strategyConflicts.some(r=>r.settingKey==='lowForecastAutoSunnySoc'));
 assert.equal(JSON.stringify(a.autoTuneRuntime.planning),learning);assert.equal(JSON.stringify(a.getSettings()),originalSettings);assert.equal(JSON.stringify(a.getAutoTuneHistory()),history);assert.equal(a.getAutoTuneSettingDescriptor('dayPlanningMaxSoc'),null);checks++;
 // The apply paths still verify actual values, even if a formerly valid recommendation is now stale.
 a.getAutoTuneRecommendations=()=>[{settingKey:'lowForecastAutoSunnySoc',recommended:90,canAutoManage:true,confidence:100,scope:'Planning'}];
 await assert.rejects(a.applyAutoTuneRecommendationOnce({settingKey:'lowForecastAutoSunnySoc'}),/ongewenste batterijontlading|unwanted battery discharge/);
 a.getAutoTunePermissions=()=>({lowForecastAutoSunnySoc:true});a.getAutoTuneLastApplied=()=>({});await a.applyAutoTuneRecommendations({force:true});assert.equal(a.getSettings().lowForecastAutoSunnySoc,100);checks++;
 assert.deepEqual(h.errors,[]);
 const begin=performance.now();for(let i=0;i<10000;i++)A.risk(base);console.log(`Strategy advice: ${checks} checks passed; 10,000 fixed-policy checks ${(performance.now()-begin).toFixed(1)} ms; learning/settings/history retained.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
