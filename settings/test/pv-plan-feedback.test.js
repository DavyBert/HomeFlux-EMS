'use strict';
const assert = require('node:assert/strict');
const { evaluate, prepareControlContext } = require(process.env.HOMEFLUX_TEST_ENGINE || '../lib/ems-engine');
const now = new Date('2026-09-25T12:07:00Z');
const base = {
  timezone: 'UTC', batteryCount: 1, totalCapacityKwh: 20,
  minSoc: 10, maxSoc: 100, maxTotalChargeW: 4000, maxChargePerBatteryW: 4000,
  forcedMode: 'auto', controlProfile: 'exact', gridZeroMinW: -20, gridZeroMaxW: 20,
  peakShaveEnabled: false, fixedChargeWindowStart: '11:00', fixedChargeWindowEnd: '17:00',
};
const input = {
  batterySoc: [38], targetSocOverride: 50, lastTotalCommandW: -528,
  pvPowerW: 3111, gridPowerW: -1817, forecastRemainingKwh: 0,
};
const slots = Array.from({length:24}, (_,h) => ({time:`${String(h).padStart(2,'0')}:00`,price:h===12?.05:h===18?.5:.2}));
const contracts = [
  { contractType: 'fixed' },
  { contractType: 'tou', touRates: [
    {id:'day',name:'Dal',importPrice:.2,weekdayChargeMode:'day',weekendChargeMode:'day'},
    {id:'peak',name:'Piek',importPrice:.4,weekdayChargeMode:'never',weekendChargeMode:'never'},
  ], touSchedule:[
    {rateId:'day',start:'11:00',end:'17:00',days:[1,2,3,4,5,6,7]},
    {rateId:'peak',start:'17:00',end:'23:00',days:[1,2,3,4,5,6,7]},
  ] },
  { totalCapacityKwh:4, contractType: 'dynamic_hour', dynamicPriceDataReady: true, dynamicSlots: slots, cheapHours:1, expensiveHours:1 },
  { totalCapacityKwh:4, contractType: 'dynamic_hour', dynamicPriceDataReady: true,
    dynamicSlots: slots.map(s=>({...s,price:s.time==='12:00'?.2:s.time==='13:00'?.05:s.price})),
    cheapHours:1, expensiveHours:1, dynamicNormalChargeEnabled:true, dynamicNormalChargeMaxSoc:50 },
];
for (const contract of contracts) {
  const settings = {...base,...contract};
  let state = {...input};
  const cached = prepareControlContext(state,settings,now);
  const first = evaluate(state,settings,now);
  assert.equal(first.baseMode,'charge');
  assert.equal(first.totalCommandW,-2345,'P1 export must increase charging above plan');
  state = {...state,lastTotalCommandW:first.totalCommandW,gridPowerW:0};
  for(let tick=0; tick<40; tick++) {
    const time = new Date(now.getTime()+tick*1000);
    const result = evaluate(state,settings,time,tick%2?cached:null);
    assert.equal(result.totalCommandW,-2345,'P1 at zero must retain PV charging through full/fast evaluations');
    state.lastTotalCommandW = result.totalCommandW;
  }
  for (const gridPowerW of [-19,19]) {
    assert.equal(evaluate({...state,gridPowerW},settings,now).totalCommandW,-2345,'P1 inside zero band must not reset to plan');
  }
  // The inverter can report a delayed or zero PV value; P1 still sees surplus.
  for (const pvPowerW of [0,300,9000]) {
    const r = evaluate({...state,pvPowerW},settings,now);
    assert.equal(r.totalCommandW,-2345);
    assert.equal(r.gridChargeAssistW,0);
  }
  const cloud = evaluate({...state,gridPowerW:1800,pvPowerW:3111},settings,now);
  assert(cloud.totalCommandW>-2345,'Import caused by a cloud must reduce capture');
  assert.equal(cloud.totalCommandW,Math.round(Math.min(-cloud.plannedChargeW,-545)));
  const night = evaluate({...state,gridPowerW:2745,pvPowerW:3111},settings,now);
  assert.equal(night.totalCommandW,Math.round(-night.plannedChargeW),'Without surplus only planned charging remains');
  assert(night.gridChargeAssistW>0,'P1 import must be labelled as grid charging despite stale high PV');
  const limit = evaluate(input,{...settings,maxTotalChargeW:1000},now);
  assert.equal(limit.totalCommandW,-1000);
  const peak = evaluate({...state,gridPowerW:3400},{...settings,peakShaveEnabled:true,peakLimitW:2650,peakSoftMarginW:100},now);
  assert(peak.predictedGridW<=2550,'Peak Guard retains priority');
  const full = evaluate({...state,batterySoc:[100],gridPowerW:-100},settings,now);
  assert.equal(full.totalCommandW,0,'Full battery cannot absorb surplus');
  const reached = evaluate({...state,batterySoc:[51]},settings,now);
  assert.notEqual(reached.baseMode,'charge');
  assert.equal(reached.totalCommandW,-2345,'PV capture continues beyond the grid-charge target');
}
// With a gradual profile, repeated P1 feedback converges without restarting the plan.
let command=-528;
for(let tick=0;tick<40;tick++) {
  const r=evaluate({...input,lastTotalCommandW:command,gridPowerW:-2345-command},{...base,contractType:'fixed',controlProfile:'normal'},now);
  assert(r.totalCommandW<=command,'Stable sun must not create a repeating reset to the plan');
  command=r.totalCommandW;
}
assert(Math.abs(command+2345)<=20);
console.log('PV-plan feedback passed: fixed/TOU/dynamic, stable zero, fast/full paths, stale PV, cloud, grid charging, SoC and power limits');
