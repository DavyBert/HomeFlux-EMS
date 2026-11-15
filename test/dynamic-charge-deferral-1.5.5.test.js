'use strict';
const assert = require('node:assert/strict');
const { planDynamicChargeDeferral } = require('../lib/dynamic-charge-deferral');
const engine = require('../lib/ems-engine');
const { preparePriceAnalysis, buildDynamicTariffTimeline, localParts } = require('../lib/homey-energy');
const H = 3600000;
const Q = 900000;
const ZONE = 'Europe/Brussels';
const start = Date.parse('2026-11-14T23:00:00Z');
const now = start + 1 * H; // 01:00 local on 15 November 2026
const morning = start + 7 * H;
const evening = start + 17 * H;
const nextMorning = start + 31 * H;
const fixtures = [];
function rows(step, prices) {
  return Array.from({length:48*H/step},(_,i)=>{
    const at=start+i*step, parts=localParts(new Date(at),ZONE);
    return {startMs:at,endMs:at+step,price:prices((at-start)/H),className:'normal'};
  });
}
function options(list, extra={}) {return {rows:list,now,targetAt:morning,nextTargetAt:evening,
  soc:20,targetSoc:80,safetySoc:14,capacityKwh:20,powerW:2500,expectedDailyKwh:24,...extra};}
function done(name,run){run();fixtures.push(name);console.log('PASS',name);}
for (const step of [H,Q]) {
  done(`Dynamic ${step===H?'hourly':'quarter-hour'}: future cheaper, no peak`,()=>{
    const price = h=>h>=8&&h<13?.09:h<7?.30:.35;
    const list=rows(step,price).map(r=>({...r,className:r.startMs>=start+8*H&&r.startMs<start+13*H?'cheap':r.startMs>=start+13*H?'expensive':'normal'}));
    const p=planDynamicChargeDeferral(options(list));
    assert(p?.active);assert(p.preloadTargetSoc<80);assert(p.preloadTargetSoc>=14);
    assert.equal(p.expensiveHours,0); assert.equal(p.cheaperAt,start+8*H);
  });
  done(`Dynamic ${step===H?'hourly':'quarter-hour'}: intermediate expensive period needs preload`,()=>{
    const list=rows(step,h=>h<7?.30:h<9?.75:h<13?.09:.36)
      .map(r=>({...r,className:r.startMs>=start+7*H&&r.startMs<start+9*H?'expensive':r.startMs>=start+9*H&&r.startMs<start+13*H?'cheap':'normal'}));
    const p=planDynamicChargeDeferral(options(list,{soc:60,targetSoc:80}));
    assert(p);assert(p.expensiveHours>=1.99);assert(p.peakReserveSoc>25);
    const drained=planDynamicChargeDeferral(options(list,{soc:18,targetSoc:55}));
    assert(drained);assert(drained.preloadTargetSoc>=drained.peakReserveSoc);
  });
  done(`Dynamic ${step===H?'hourly':'quarter-hour'}: evening goal can defer`,()=>{
    const list=rows(step,h=>h>=19&&h<24?.08:.35)
      .map(r=>({...r,className:r.startMs>=start+19*H&&r.startMs<start+24*H?'cheap':'normal'}));
    const p=planDynamicChargeDeferral(options(list,{now:start+15*H,targetAt:evening,nextTargetAt:nextMorning}));
    assert(p); assert.equal(p.cheaperAt,start+19*H);
  });
  done(`Dynamic ${step===H?'hourly':'quarter-hour'}: unknown interval forbids postponement`,()=>{
    const list=rows(step,h=>h>=8?.08:.35)
      .map(r=>({...r,className:r.startMs>=start+8*H?'cheap':'normal'}))
      .filter(r=>r.startMs<start+6*H ||r.startMs>=start+8*H);
    assert.equal(planDynamicChargeDeferral(options(list)),null);
  });
  done(`Dynamic ${step===H?'hourly':'quarter-hour'}: no cheaper eligible interval`,()=>{
    const list=rows(step,()=>.35).map(r=>({...r,className:'normal'}));
    assert.equal(planDynamicChargeDeferral(options(list)),null);
  });
  done(`Dynamic ${step===H?'hourly':'quarter-hour'}: insufficient future capacity retains target`,()=>{
    const list=rows(step,h=>h>=8&&h<9?.08:.35)
      .map(r=>({...r,className:r.startMs>=start+8*H&&r.startMs<start+9*H?'cheap':'normal'}));
    const p=planDynamicChargeDeferral(options(list,{soc:12,targetSoc:95,powerW:400,expectedDailyKwh:30}));
    assert(p && p.preloadTargetSoc >= 93 && p.preloadTargetSoc < 95); // Partial deferral only.
  });
}
done('Runtime: dynamic target capped during normal price; safety recovers; TOU/fixed and manual unchanged',()=>{
  const list=rows(Q,h=>h>=8&&h<13?.08:.32).map(r=>({...r,className:r.startMs>=start+8*H&&r.startMs<start+13*H?'cheap':'normal'}));
  const decision=planDynamicChargeDeferral(options(list,{soc:35}));
  const settings={...engine.DEFAULTS,contractType:'dynamic_quarter',dynamicPriceDataReady:true,
    timezone:ZONE,batteryCount:1,totalCapacityKwh:20,minSoc:10,safetySoc:14,
    expectedEnergyNeedKwh:20,peakShaveEnabled:false,forcedMode:'auto',
    maxTotalChargeW:2500,maxChargePerBatteryW:2500,dayPlanningMaxSoc:95,
    dynamicChargeDeferral:decision,cheapHours:6,expensiveHours:8,
    dynamicSlots:Array.from({length:96},(_,i)=>({time:`${String(Math.floor(i/4)).padStart(2,'0')}:${String((i%4)*15).padStart(2,'0')}`,price:.32}))};
  const state={batterySoc:[35],gridPowerW:250,controlGridPowerW:250,lastTotalCommandW:0,pvPowerW:0,
    nightPlanningActive:true,planningForecastDay:'today',targetSocOverride:80};
  const at=new Date(now);
  const result=engine.evaluate(state,settings,at);
  assert(result.planningChargeTargetSoc<80);assert(result.planningChargeTargetSoc>=14);
  assert.equal(engine.evaluate(state,{...settings,contractType:'tou'},at).planningChargeTargetSoc,80);
  assert.equal(engine.evaluate(state,{...settings,contractType:'fixed'},at).planningChargeTargetSoc,80);
  assert.equal(engine.evaluate(state,{...settings,forcedMode:'standby'},at).planningChargeTargetSoc,80);
  assert.equal(engine.evaluate({...state,batterySoc:[12]},settings,at).safetySocRecoveryActive,true);
});
done('Actual published daily classes: hour and quarter are usable without invented calendar slots',()=>{
  for(const resolution of [60,15]){
    const slots=rows(resolution*60000,h=>h>=8&&h<14?.09:h<7?.33:.55)
      .map(r=>({...r,dateKey:localParts(new Date(r.startMs),ZONE).dateKey,minute:localParts(new Date(r.startMs),ZONE).minuteOfDay}));
    const analysis=preparePriceAnalysis(slots,new Date(now),ZONE,6,8);
    const timeline=buildDynamicTariffTimeline(slots,analysis,new Date(now),ZONE);
    assert(timeline.some(r=>r.className==='cheap'&&r.startMs>=morning));
    assert(timeline.some(r=>r.className==='normal'&&r.startMs<=now&&r.endMs>now));
    const p=planDynamicChargeDeferral(options(timeline,{soc:35,targetSoc:80}));
    assert(p?.active,`${resolution}min curve should postpone when future prices are documented cheaper`);
  }
});
console.log(`Dynamic charge deferral 1.5.5: ${fixtures.length} groups passed`);

done('Slow engine night input and real night planner use only the preloaded reserve',()=>{
  const list=rows(Q,h=>h>=9&&h<14?.08:h>=7&&h<9?.75:.31).map(r=>({
    ...r,className:r.startMs>=start+9*H&&r.startMs<start+14*H?'cheap':r.startMs>=start+7*H&&r.startMs<start+9*H?'expensive':'normal'}));
  const base={...engine.DEFAULTS,contractType:'dynamic_quarter',dynamicPriceDataReady:true,timezone:ZONE,
    batteryCount:1,totalCapacityKwh:20,minSoc:10,safetySoc:14,maxTotalChargeW:2500,
    maxChargePerBatteryW:2500,peakShaveEnabled:false,expectedEnergyNeedKwh:24,
    cheapHours:6,expensiveHours:8,dynamicNormalChargeEnabled:true, dynamicNormalChargeMaxSoc:60,
    dynamicTariffTimeline:list, forcedMode:'auto'};
  const state={batterySoc:[18],gridPowerW:0,lastTotalCommandW:0,nightPlanningActive:true,
    targetSocOverride:70,planningForecastDay:'today',forecastTomorrowKwh:1,pvPowerW:0};
  const at=new Date(now);
  const decision=engine.prepareDynamicChargeDeferral(state,base,at);
  assert(decision?.active); assert(decision.expensiveHours>=2);
  const inputs=engine.getBatteryNightPlanningInputs(state,{...base,dynamicChargeDeferral:decision},at);
  assert(inputs.targetSoc>=decision.peakReserveSoc);
  assert(inputs.targetSoc<70,'reserve, not the full 07:00 target');
  assert.equal(engine.getBatteryNightPlanningInputs(state,base,at).targetSoc,70);
  const {BatteryNightPlanner}=require('../lib/battery-night-planner');
  const plan=new BatteryNightPlanner().evaluate({...inputs,curve:{intervals:list.map(r=>({startAt:r.startMs,endAt:r.endMs,price:r.price}))}});
  const selection=engine.evaluate(state,{...base,dynamicChargeDeferral:decision,batteryNightPlan:plan,
    dynamicSlots:Array.from({length:96},(_,i)=>({time:`${String(Math.floor(i/4)).padStart(2,'0')}:${String((i%4)*15).padStart(2,'0')}`,price:.31}))},at);
  assert(selection.planningChargeTargetSoc<70);
  assert(selection.planningChargeTargetSoc>=decision.peakReserveSoc);
  assert(selection.plannedChargeW>=0);
});
