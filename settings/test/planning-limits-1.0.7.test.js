'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { evaluate, buildSocPlan, prepareControlContext, DEFAULTS } = require('../lib/ems-engine');
const { boot } = require('./startup-harness');

const base = {
  timezone: 'UTC', batteryCount: 1, totalCapacityKwh: 20, minSoc: 10,
  safetySoc: 14, maxSoc: 100, maxTotalChargeW: 12000, maxChargePerBatteryW: 12000,
  maxTotalDischargeW: 4000, maxDischargePerBatteryW: 4000,
  forcedMode: 'auto', controlProfile: 'exact', gridZeroMinW: -20, gridZeroMaxW: 20,
  peakShaveEnabled: false, expectedEnergyNeedKwh: 18,
  peakReserveTargetSoc: 0, lowForecastFixedEnabled: false,
};
function scenario(contractType, night) {
  const now = new Date(night ? '2026-10-09T01:00:00Z' : '2026-10-09T12:00:00Z');
  const hour = night ? 1 : 12;
  const interval = contractType === 'dynamic_quarter' ? 15 : 60;
  const slots = Array.from({length: 1440 / interval}, (_, i) => ({
    time: `${String(Math.floor(i * interval / 60)).padStart(2, '0')}:${String(i * interval % 60).padStart(2, '0')}`,
    price: Math.floor(i * interval / 60) === hour ? 0.05 : 0.3,
  }));
  const settings = {...base, contractType, fixedChargeWindowStart: night ? '00:00' : '11:00',
    fixedChargeWindowEnd: night ? '07:00' : '17:00', dynamicPriceDataReady: true,
    dynamicSlots: slots, cheapHours: 1, expensiveHours: 1,
    touRates: [{id:'low',name:'Low',importPrice:0.2,weekdayChargeMode:'always',weekendChargeMode:'always'}],
    touSchedule:[{rateId:'low',start:'00:00',end:'23:59',days:[1,2,3,4,5,6,7]}],
  };
  const state = {batterySoc:[40], gridPowerW:0, pvPowerW:0,
    forecastRemainingKwh:0, forecastDailyMaxKwh:0, forecastTomorrowKwh:0,
    lastTotalCommandW:0, nightPlanningActive:night, planningForecastDay:'today'};
  return {now, settings, state};
}
let scenarios = 0;
for (const contract of ['fixed','tou','dynamic_hour','dynamic_quarter']) {
  for (const night of [false,true]) {
    const {now, settings, state} = scenario(contract, night);
    const limits = {...settings, dayPlanningMaxSoc:60, nightPlanningMaxSoc:70};
    const cap = night ? 70 : 60;
    const implicit = evaluate(state, settings, now);
    const defaults = evaluate(state, {...settings, dayPlanningMaxSoc:100, nightPlanningMaxSoc:100}, now);
    assert.deepEqual(defaults, implicit, `${contract}: 100% must preserve all existing decisions`);
    assert.deepEqual(buildSocPlan(state, settings, now), buildSocPlan(state, {...settings, dayPlanningMaxSoc:100, nightPlanningMaxSoc:100}, now));
    assert.equal(implicit.targetSoc, 100);
    assert.equal(implicit.baseMode, 'charge');
    const result = evaluate(state, limits, now);
    assert.equal(result.targetSoc, 100, 'calculated need must remain available to existing strategies');
    assert.equal(result.planningChargeTargetSoc, cap);
    assert.equal(result.planningSocLimitActive, true);
    assert.equal(result.baseMode, 'charge');
    assert(result.plannedChargeW > 0 && result.plannedChargeW < implicit.plannedChargeW);
    const plan = buildSocPlan(state, limits, now);
    assert.equal(plan.targetSoc, cap);
    assert.equal(plan.calculatedTargetSoc, 100);
    assert.equal(plan.energyNeedKwh, night ? 6 : 4, '20 kWh capacity: only the gap to the phase cap is scheduled');
    assert(plan.rows.filter(row=>row.plannedNetCharge).reduce((sum,row)=>sum+row.plannedEnergyKwh,0) <= plan.energyNeedKwh + 0.01);
    // The fast path with cached context must stop at the same cap as a full pass.
    const cached = prepareControlContext(state, limits, now);
    const reached = {...state,batterySoc:[cap],lastTotalCommandW:result.totalCommandW,
      gridPowerW:-result.totalCommandW,chargeRestartState:result.chargeRestartState};
    for (const context of [null,cached]) {
      const stopped = evaluate(reached, limits, now, context);
      assert.notEqual(stopped.baseMode, 'charge');
      assert.equal(stopped.plannedChargeW, 0);
      assert.equal(stopped.totalCommandW, 0, 'previous grid charge must be removed at the cap');
      const sunny = evaluate({...reached,batterySoc:[cap+5],pvPowerW:3500,
        lastTotalCommandW:0,gridPowerW:-2000}, limits, now, context);
      assert.equal(sunny.totalCommandW, -2000, 'measured PV export is captured above the planning cap');
      assert.equal(sunny.plannedChargeW, 0);
      const cloud = evaluate({...reached,batterySoc:[cap+5],pvPowerW:500,
        lastTotalCommandW:-2000,gridPowerW:1800}, limits, now, context);
      assert.equal(cloud.totalCommandW, -200, 'clouds reduce PV charging through unchanged P1 feedback');
    }
    const lowered = evaluate(state, {...limits,[night?'nightPlanningMaxSoc':'dayPlanningMaxSoc']:50}, now,cached);
    assert.equal(lowered.planningChargeTargetSoc,50,'cap applies again even with prepared forecast context');
    const newForecast = {...state,forecastRemainingKwh:16,forecastTomorrowKwh:16};
    assert.equal(evaluate(newForecast, limits, now).planningChargeTargetSoc,20,'a lower computed need must not be raised to the cap');
    const nextPhase = evaluate({...state,nightPlanningActive:!night}, limits, now);
    assert.equal(nextPhase.planningChargeTargetSoc,night?60:70,'day and night limits are independent');
    const manual = evaluate(state,{...limits,forcedMode:'manual_charge'},now);
    assert.equal(manual.totalCommandW,-12000,'manual charging ignores planned charging limits');
    const safety = evaluate({...state,batterySoc:[12]}, {...limits,dayPlanningMaxSoc:5,nightPlanningMaxSoc:5},now);
    assert.equal(safety.safetySocRecoveryActive,true);
    assert(safety.totalCommandW<0,'safety recovery remains independent of the cap');
    const full = evaluate({...state,batterySoc:[100],gridPowerW:-3000,pvPowerW:4000},limits,now);
    assert.equal(full.totalCommandW,0,'global battery max remains effective');
    const peak = evaluate({...state,batterySoc:[50],gridPowerW:4000}, {...limits,peakShaveEnabled:true,peakLimitW:2500,peakSoftMarginW:0},now);
    assert.equal(peak.override,'peak_shave');
    assert(peak.totalCommandW>=1500,'Peak Guard retains its authority');
    scenarios++;
  }
}
// Normal-price charging has its existing extra limit; new limits can only lower it.
{
  const {now,state,settings} = scenario('dynamic_hour',false);
  settings.dynamicSlots.find(s=>s.time==='12:00').price=.2;
  settings.dynamicSlots.find(s=>s.time==='13:00').price=.05;
  Object.assign(settings,{dynamicNormalChargeEnabled:true,dynamicNormalChargeMaxSoc:50,dayPlanningMaxSoc:60});
  assert.equal(evaluate({...state,batterySoc:[50]},settings,now).plannedChargeW,0);
  assert(evaluate(state,{...settings,dayPlanningMaxSoc:45},now).plannedChargeW < evaluate(state,settings,now).plannedChargeW);
}
// Restart hysteresis and existing discharge floors remain independent.
{
  const {now,state,settings} = scenario('fixed',false);
  const capped = {...settings,dayPlanningMaxSoc:60};
  for (const value of [null,undefined,'',NaN,'invalid']) {
    assert.equal(evaluate(state,{...capped,dayPlanningMaxSoc:value},now).planningMaxSoc,100,'missing/invalid values must preserve conservative defaults');
  }
  assert.equal(evaluate(state,{...capped,dayPlanningMaxSoc:0},now).plannedChargeW,0,'zero disables planned grid top-ups, not PV capture');
  assert.equal(evaluate({...state,gridPowerW:-1800},{...capped,dayPlanningMaxSoc:0},now).totalCommandW,-1800);
  const done = evaluate({...state,batterySoc:[60]},capped,now);
  assert.equal(evaluate({...state,batterySoc:[59],chargeRestartState:done.chargeRestartState},capped,now).plannedChargeW,0);
  assert(evaluate({...state,batterySoc:[58],chargeRestartState:done.chargeRestartState},capped,now).plannedChargeW>0);
  const protectedSettings={...capped,peakReserveTargetSoc:75};
  const protectedResult=evaluate({...state,batterySoc:[70],gridPowerW:900},protectedSettings,now);
  assert.equal(protectedResult.planningChargeTargetSoc,60);
  assert.equal(protectedResult.ordinaryDischargeFloorSoc,75);
  assert.equal(protectedResult.totalCommandW,0,'lower planned maximum cannot lower the protected discharge floor');
  const save={...capped,lowForecastFixedEnabled:true,lowForecastFixedDischargeToTarget:true,fixedChargeWindowStart:'01:00',fixedChargeWindowEnd:'07:00'};
  const current={...state,batterySoc:[80],forecastRemainingKwh:4,forecastDailyMaxKwh:4,gridPowerW:600};
  const old=evaluate(current,{...save,dayPlanningMaxSoc:100},now),reduced=evaluate(current,save,now);
  assert.equal(reduced.ordinaryDischargeFloorSoc,old.ordinaryDischargeFloorSoc);
  assert.deepEqual(reduced.commands,old.commands,'Battery Save discharge-to-target behaviour is unchanged');
  const globalMax=evaluate({...state,batterySoc:[85],gridPowerW:-1800,pvPowerW:2500},{...capped,maxSoc:85},now);
  assert.equal(globalMax.totalCommandW,0,'planning limits never bypass the configured global maximum');
}

// Execute the actual widget functions, including NL/EN EV reasons and timing.
const widget = fs.readFileSync(require.resolve('../widgets/status/public/index.html'),'utf8');
const ui = fs.readFileSync(require.resolve('../settings/index.html'),'utf8');
new vm.Script(widget.match(/<script type="text\/javascript">\s*([\s\S]*?)<\/script>/)[1]);
new vm.Script(ui.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
const ctx={formatSoc:value=>`${Number(value).toFixed(1)}%`,formatDurationMs:()=> '1 h',
  tr:(homey,key,fallback)=>homey?.__(key)||fallback};
vm.createContext(ctx);
vm.runInContext(widget.slice(widget.indexOf('    function batteryTargetText'),widget.indexOf('    function evBatteryCoordinationText')),ctx);
for (const language of ['nl','en']) {
  const locale=require(`../locales/${language}.json`);
  const homey={__:key=>key.split('.').reduce((obj,k)=>obj?.[k],locale)};
  const status={planningPhase:'day',planningSocLimitActive:true,planningMaxSoc:60,planningChargeTargetSoc:60,
    ordinaryDischargeFloorSoc:40,sunChanceReserve:{active:true,floorSoc:40},forcedMode:'auto',targetSoc:95};
  assert.equal(ctx.batteryTargetText(status),'60.0%');
  assert(ctx.batteryBoundaryText(status,homey).includes(locale.widget.status.dayPlanningMaximum));
  assert(ctx.batteryBoundaryText({...status,planningPhase:'night'},homey).includes(locale.widget.status.nightPlanningMaximum));
  assert(ctx.batteryBoundaryText(status,homey).includes(locale.widget.status.sunChanceFloor));
  assert.equal(ctx.batteryBoundaryText({...status,forcedMode:'manual_charge'},homey),'');
  const timing=ctx.batteryTimingText({batteryTiming:{direction:'discharge',hours:1,targetSoc:40}},homey);
  assert.equal(timing.label,locale.widget.status.batteryFloorIn);
  assert(timing.value.includes('40.0%'));
}
for (const reason of ['Slim laden via tarief · PV-verdeling EV 50% / batterij 50% · gewicht 2',
  'Smart charging via tariff · PV allocation EV 50% / battery 50% · weight 2',
  'Charging · PV distribution EV 50% / battery 50%']) {
  for (const mode of ['smart','standard','emergency','soc_target']) {
    const noPv={mode,pvPoolBudgetW:0,pvAllocatedW:0,gridAllocatedW:3000};
    const before=JSON.stringify(noPv);
    assert(!ctx.evReasonForWidget(reason,noPv).match(/PV-verdeling|PV allocation|PV distribution/));
    assert.equal(JSON.stringify(noPv),before,'widget must not change EV decisions');
    assert(!ctx.evReasonForWidget(reason,{...noPv,pvPoolBudgetW:2000,pvAllocatedW:0}).match(/PV-verdeling|PV allocation|PV distribution/),'available PV with no EV PV contribution must not show a split');
    assert.equal(ctx.evReasonForWidget(reason,{...noPv,pvPoolBudgetW:2000,pvAllocatedW:1500}),reason,'actual PV contribution retains the existing split');
  }
}
const planningStart=ui.indexOf('id="energyPlanningSettings"');
assert(ui.indexOf('id="expectedEnergyNeedKwh"')>planningStart);
assert(ui.indexOf('id="lowForecastSelfConsumptionMinKwh"')>ui.indexOf('id="expectedEnergyNeedKwh"'));
assert(ui.indexOf('id="lowForecastSelfConsumptionMinKwh"')<ui.indexOf('data-setting-id="planningTargetTimes"'));
for (const key of ['dayPlanningMaxSoc','nightPlanningMaxSoc']) {
  assert.equal((ui.match(new RegExp(`\\sid="${key}"`,'g'))||[]).length,1);
  assert(ui.slice(ui.indexOf('const numeric ='),ui.indexOf('const boolean =')).includes(`'${key}'`));
}

async function integration() {
  const {app,store,errors}=await boot(new Map([['contractType','fixed'],['expectedEnergyNeedKwh',18],['peakReserveTargetSoc',75]]));
  assert.equal(store.get('dayPlanningMaxSoc'),100);
  assert.equal(store.get('nightPlanningMaxSoc'),100);
  assert.equal(store.get('peakReserveTargetSoc'),75,'upgrade must preserve existing configuration');
  app.setSetting('dayPlanningMaxSoc',60);app.setSetting('nightPlanningMaxSoc',70);
  assert.equal(app.getSettingsSnapshot().dayPlanningMaxSoc,60);
  const restarted=await boot(store);
  assert.equal(restarted.app.getSettings().dayPlanningMaxSoc,60);
  assert.equal(restarted.app.getSettings().nightPlanningMaxSoc,70);
  assert.equal(errors.length,0);assert.equal(restarted.errors.length,0);
  // Status polling must remain read-only. Its timing uses the real output and
  // the engine's existing floor, rather than labelling every floor Safety SoC.
  app.latestResult={avgSoc:70,targetSoc:95,planningChargeTargetSoc:60,planningMaxSoc:60,
    planningSocLimitActive:true,planningPhase:'day',ordinaryDischargeFloorSoc:40,safetySoc:14,
    effectiveCapacityKwh:20,baseMode:'self_consumption'};
  app.lastEmittedCommands=[1000,0,0,0];
  const before=JSON.stringify(app.latestResult);
  const status=app.getPublicStatus();
  assert.equal(status.batteryTiming.targetSoc,40);
  assert.equal(status.batteryTiming.hours,6);
  assert.equal(JSON.stringify(app.latestResult),before);
  app.setSetting('contractType','dynamic_hour');
  app.setSetting('dynamicNormalChargeMaxSoc',50);
  app.lastEmittedCommands=[-1000,0,0,0];
  app.latestResult={...app.latestResult,avgSoc:40,baseMode:'charge',tariff:{className:'normal'}};
  assert.equal(app.getPublicStatus().batteryTiming.targetSoc,50,'timing identifies the existing normal-price charging bound');
  app.latestResult={...app.latestResult,baseMode:'manual_charge'};
  assert.equal(app.getPublicStatus().batteryTiming.targetSoc,100,'manual charge timing retains the global maximum');
  app.latestResult={...app.latestResult,baseMode:'self_consumption',action:'pv_charge'};
  assert.equal(app.getPublicStatus().batteryTiming.targetSoc,100,'PV timing does not claim that charging stops at the planning cap');
  console.log(`1.0.7 regression tests passed: ${scenarios} contract/phase combinations, 100% defaults, grid limits, recalculation, cached/full control, PV/clouds, safety/manual/Peak Guard, hysteresis, unchanged floors, NL/EN widget, EV display and upgrade/restart.`);
}
integration().catch(err=>{console.error(err);process.exitCode=1;});
