'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DEFAULTS, evaluate, buildSocPlan, distributeCommand } = require('../lib/ems-engine');
const { boot } = require('./startup-harness');
const sunChance = require('../settings/sun-chance');
const { drain, installVirtualClearTimeout } = require('./pv-source-harness');
const ROOT = path.resolve(__dirname, '..');
const OriginalDate = Date;
let clock = Date.parse('2026-10-26T10:00:00Z');
global.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
const restoreClear = installVirtualClearTimeout();
const results = [];
const sum = values => values.reduce((a,b) => a+b,0);

const html = fs.readFileSync(path.join(ROOT, 'settings/index.html'), 'utf8');
const maximumIds = ['maxTotalChargeW','maxTotalDischargeW','maxChargePerBatteryW','maxDischargePerBatteryW'];
for (let i = 1; i <= 8; i++) maximumIds.push(`battery${i}MaxChargeW`, `battery${i}MaxDischargeW`);
const elements = new Map();
const uiDefaults = { ...DEFAULTS, ...sunChance.defaults };
function element(id) {
  if (!elements.has(id)) {
    const tag = [...html.matchAll(/<input\b[^>]*>/g)].find(m => m[0].includes(`id="${id}"`))?.[0] || '';
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    elements.set(id, { id, value: uiDefaults[id] ?? 0, checked: false, disabled: false,
      getAttribute: key => attrs[key] ?? null, setAttribute: (key,value) => { attrs[key]=value; } });
  }
  return elements.get(id);
}
const rangeStart = html.indexOf('  const MAX_BATTERY_POWER_W');
const rangeEnd = html.indexOf('  applyBatteryPowerInputRanges();',rangeStart) + '  applyBatteryPowerInputRanges();'.length;
const validateStart = html.indexOf('  function validateNumericSettings()');
const validateEnd = html.indexOf("  q('save').addEventListener",validateStart);
const ui = vm.createContext({ q: element, numeric: new Set(), uiLanguage: 'en',
  document: { querySelector: () => null }, window: { HomeFluxSunChance: sunChance },
  configuredBatteryCount: () => 1, MAX_FLEX_INSTANCES: 4,
  instanceStem: (kind,i) => i===1 ? kind : kind+i });
vm.runInContext(html.slice(rangeStart,rangeEnd)+html.slice(validateStart,validateEnd),ui);
function validate(id, value) {
  ui.numeric = new Set([id]); element(id).value=value;
  return vm.runInContext('validateNumericSettings()',ui);
}

function settingsFor({ count=1, perCharge=15000, perDischarge=15000, totalCharge=count*perCharge,
  totalDischarge=count*perDischarge, individual=false, split=false, optimize=false, invert=false } = {}) {
  const settings = { ...DEFAULTS, settingsSchemaVersion:71, timezone:'Europe/Brussels', batteryCount:count,
    totalCapacityKwh:count*1000, maxChargePerBatteryW:perCharge, maxDischargePerBatteryW:perDischarge,
    maxTotalChargeW:totalCharge, maxTotalDischargeW:totalDischarge,
    individualBatteryPowerLimitsEnabled:individual, optimizeMultiBatteryEfficiency:optimize,
    controlEnabled:false, invertBatteryCommand:invert, controlProfile:'exact',
    gridControlWindowSeconds:0, gridZeroMinW:0, gridZeroMaxW:0, commandDeadbandW:0, batteryCommandStepW:1,
    peakShaveEnabled:false, exportLimitEnabled:false, batteryCommandPauseEnabled:false,
    contractType:'fixed', fixedChargeWindowStart:'00:00', fixedChargeWindowEnd:'23:59',
    dayPlanningMaxSoc:100, expectedEnergyNeedKwh:count*1000, forcedMode:'manual_charge',
    balanceEnabled:false, evCount:0, hvacCount:0, boilerCount:0, sunChanceReserveEnabled:false };
  for(let i=1;i<=8;i++) Object.assign(settings,{
    [`battery${i}MaxChargeW`]:perCharge, [`battery${i}MaxDischargeW`]:perDischarge,
    [`battery${i}CapacityKwh`]:1000, [`splitCommandBattery${i}Enabled`]:split,
    [`splitCommandBattery${i}MinimumPowerW`]:100, [`splitCommandBattery${i}KeepMinimumPower`]:true,
  });
  return settings;
}
function stateFor(count, direction='charge') {
  return { batterySoc:Array(count).fill(50), gridPowerW:direction==='charge'?0:200000,
    controlGridPowerW:direction==='charge'?0:200000, pvPowerW:0,
    forecastRemainingKwh:0, forecastDailyMaxKwh:0, forecastTomorrowKwh:0,
    lastTotalCommandW:0, lastBatteryCommands:Array(count).fill(0),
    nightPlanningActive:false, planningForecastDay:'today', targetSocOverride:100 };
}
async function publish(settings,direction) {
  const h=await boot(new Map(Object.entries(settings))), a=h.app, count=settings.batteryCount;
  a.setSetting('_chargeTestSignature',a.getChargeTestSignature(a.getSettings()));
  a.setSetting('chargeTestPassed',true);
  a.setSetting('controlEnabled',true);
  a.setSetting('forcedMode',direction==='charge'?'manual_charge':'self_consumption');
  const state=stateFor(count,direction);
  Object.assign(a.state,state);
  a.inputSeen.grid=true;a.inputSeen.pv=true;a.inputSeen.batterySoc=Array(8).fill(true);
  a.inputUpdatedAt.grid=clock;a.inputUpdatedAt.pv=clock;a.inputUpdatedAt.batterySoc=Array(8).fill(clock);
  const saved=a.getSettings();
  const calculated=evaluate(state,saved,new Date(clock));
  const result=a.createSafetyResult(calculated,saved,a.getInputReadiness(saved));
  assert(result.canPublishCommands, JSON.stringify({ready:a.getInputReadiness(saved),controlEnabled:saved.controlEnabled,valid:a.isChargeTestValid(saved),signature:a.getChargeTestSignature(saved),stored:h.store.get('_chargeTestSignature')}));
  a.latestResult=result;a.pendingResult=result;
  const writes=[],timerQueue=[];
  a.commandTrigger.trigger=async tokens=>writes.push({kind:'single',at:clock,tokens});
  for(let i=0;i<count;i++) for(const key of ['chargeMode','dischargeMode','chargePower','dischargePower']) {
    const trigger=a.splitCommandTriggers[i][key];
    assert(trigger);trigger.trigger=async tokens=>writes.push({kind:key,battery:i+1,at:clock,tokens});
  }
  a.homey.setTimeout=(fn,ms)=>{const timer={fn,due:clock+ms,done:false};timerQueue.push(timer);return timer;};
  const job=a.emitPending();await drain();
  for(let i=0;i<10 && a.commandPublishing;i++) {
    const next=timerQueue.filter(t=>!t.done).sort((x,y)=>x.due-y.due)[0];
    if(!next) {await drain();continue;}
    clock=next.due;next.done=true;next.fn();await drain();
  }
  assert(!a.commandPublishing,'publication must finish using simulated normal timers');await job;
  const expected=direction==='charge'?-Math.min(saved.maxTotalChargeW,count*saved.maxChargePerBatteryW)
    :Math.min(saved.maxTotalDischargeW,count*saved.maxDischargePerBatteryW);
  assert.equal(result.candidateTotalCommandW,expected);
  const single=writes.find(w=>w.kind==='single');assert(single);
  assert.equal(single.tokens.total_command,settings.invertBatteryCommand?-expected:expected);
  assert.equal(sum(a.lastEmittedCommands),expected);
  for(let i=0;i<count;i++) {
    assert(Math.abs(a.lastEmittedCommands[i]) <= (direction==='charge'?settings.maxChargePerBatteryW:settings.maxDischargePerBatteryW));
    if(settings[`splitCommandBattery${i+1}Enabled`]) {
      const mode=writes.find(w=>w.kind===(direction==='charge'?'chargeMode':'dischargeMode')&&w.battery===i+1);
      const power=writes.find(w=>w.kind===(direction==='charge'?'chargePower':'dischargePower')&&w.battery===i+1);
      assert(mode&&power);assert.equal(power.at-mode.at,1000,'keep production split 1-second handover delay');
      assert.equal(Math.abs(power.tokens.power),Math.abs(a.lastEmittedCommands[i]));
      if(direction==='charge') assert(power.tokens.power<0,'preserve signed charge power default');
    }
  }
  assert.deepEqual(h.errors,[]);
  return { expectedW:expected,publishedW:single.tokens.total_command,perBatteryW:a.lastEmittedCommands,
    splitPowerEvents:writes.filter(w=>w.kind.endsWith('Power')).length };
}

(async()=>{
  for(const id of maximumIds) {
    assert.equal(Number(element(id).getAttribute('max')),100000,id);
    for(const value of [0,15000,20000,60000,100000]) assert.equal(validate(id,value),null,`${id}=${value}`);
    assert(validate(id,100001)?.message.includes('100000'),`${id}: reject above max`);
    assert(validate(id,-1)?.message.includes('minimum'),`${id}: preserve minimum`);
    assert(validate(id,'not-a-number'),`${id}: preserve invalid numeric rejection`);
  }
  results.push({name:'All 20 real UI fields: 0..100000 accepted; 100001/negative/NaN rejected by existing validator',passed:true});
  const gridCard=require('../.homeycompose/flow/actions/set_grid_power.json');
  const generatedGridCard=require('../app.json').flow.actions.find(card=>card.id==='set_grid_power');
  assert.equal(gridCard.args[0].min,-200000);assert.equal(gridCard.args[0].max,200000);
  assert.deepEqual(generatedGridCard,{...gridCard,id:'set_grid_power'});
  const measured=await boot(new Map(Object.entries(settingsFor())));
  for(const power of [60000,100000,150000,-60000,-100000,-150000]) {
    assert(await measured.cards.get('set_grid_power').listener({power}));
    assert.equal(measured.app.state.gridPowerW,power,'real P1 handler preserves measured watts and sign');
  }
  assert.deepEqual(measured.errors,[]);
  results.push({name:'P1 Flow measurement range widened from +/-50000 to +/-200000; real handler preserves values above battery maximum plus other load',passed:true});
  // These are distinct preferences/minimums, not maxima or runtime output caps.
  for(const id of ['battery1OptimalPowerW','splitCommandBattery1MinimumPowerW']) assert.equal(Number(element(id).getAttribute('max')),10000);
  for(const split of [false,true]) for(const individual of [false,true]) {
    for(const scenario of [{count:1,perCharge:15000,perDischarge:15000},
      {count:1,perCharge:20000,perDischarge:15000},
      {count:4,perCharge:15000,perDischarge:15000},
      {count:4,perCharge:15000,perDischarge:15000,totalCharge:37000,totalDischarge:31000},
      {count:1,perCharge:100000,perDischarge:100000}]) {
      const settings=settingsFor({...scenario,split,individual});
      const first=await boot(new Map(Object.entries(settings)));
      // Exercise actual settings write/cache path and a new app with the same persistent store.
      for(const id of maximumIds) first.app.setSetting(id,settings[id]);
      const second=await boot(new Map(first.store));
      for(const id of maximumIds) assert.equal(second.app.getSettings()[id],settings[id],`${id} survives restart`);
      const charge=await publish(settings,'charge'),discharge=await publish(settings,'discharge');
      const plan=buildSocPlan(stateFor(scenario.count),{...settings,forcedMode:'auto'},new Date(clock));
      assert.equal(plan.maxChargeW,Math.min(settings.maxTotalChargeW,scenario.count*settings.maxChargePerBatteryW));
      assert(plan.rows.some(row=>row.plannedNetCharge));
      assert(plan.rows.every(row=>row.plannedChargeW<=plan.maxChargeW));
      results.push({name:`${split?'dual':'single'} / ${individual?'individual':'shared'} / ${JSON.stringify(scenario)}`,
        passed:true,persistence:true,planMaxChargeW:plan.maxChargeW,charge,discharge});
    }
  }
  for(const split of [false,true]) {
    const efficient=settingsFor({count:4,split,optimize:true});
    results.push({name:`${split?'dual':'single'} efficiency target is not a 10000-W command cap`,passed:true,
      charge:await publish(efficient,'charge'),discharge:await publish(efficient,'discharge')});
  }
  const low=settingsFor({count:4,perCharge:2400,perDischarge:2000,totalCharge:6000,totalDischarge:6000});
  const lowApp=await boot(new Map(Object.entries(low))),restarted=await boot(new Map(lowApp.store));
  for(const key of Object.keys(DEFAULTS)) if(maximumIds.includes(key)) assert.equal(restarted.app.getSettings()[key],low[key]);
  const legacy=process.env.HEMS_BATTERY_BASELINE ? require(path.join(process.env.HEMS_BATTERY_BASELINE,'lib/ems-engine')) : null;
  for(const direction of ['charge','discharge']) {
    const settings={...low,forcedMode:direction==='charge'?'manual_charge':'self_consumption'};
    const current=evaluate(stateFor(4,direction),settings,new Date(clock));
    assert.deepEqual(current.commands,Array(4).fill(direction==='charge'?-1500:1500));
    if(legacy) assert.deepEqual(current,legacy.evaluate(stateFor(4,direction),settings,new Date(clock)));
  }
  const zero=settingsFor({perCharge:0,perDischarge:0,totalCharge:0,totalDischarge:0});
  const zeroBoot=await boot(new Map(Object.entries(zero))),zeroRestart=await boot(new Map(zeroBoot.store));
  for(const id of maximumIds) assert.equal(zeroRestart.app.getSettings()[id],0);
  assert.deepEqual([DEFAULTS.maxTotalChargeW,DEFAULTS.maxTotalDischargeW,DEFAULTS.maxChargePerBatteryW,DEFAULTS.maxDischargePerBatteryW],[7500,8000,2300,2400]);
  for(const direction of ['charge','discharge']) {
    const settings={...zero,forcedMode:direction==='charge'?'manual_charge':'self_consumption'};
    assert.equal(evaluate(stateFor(1,direction),settings,new Date(clock)).totalCommandW,0);
  }
  const minimumApp=await boot(new Map(Object.entries(settingsFor({split:true}))));
  assert.equal(minimumApp.app.getSplitPowerValue('discharge',0,minimumApp.app.getSplitBatteryConfig(0)),100,
    'preserve technical dual 0-W/minimum behavior');
  results.push({name:'Lower legacy powers and exact engine results unchanged; numeric zero stays valid and dual technical minimum behavior preserved',passed:true});
  for(const direction of ['charge','discharge']) {
    const limits=settingsFor({count:4});
    const state=stateFor(4,direction);
    state.batterySoc=Array(4).fill(direction==='charge'?100:limits.minSoc);
    assert.equal(evaluate(state,{...limits,forcedMode:direction==='charge'?'manual_charge':'self_consumption'},new Date(clock)).totalCommandW,0);
  }
  const peakSettings={...settingsFor(),peakShaveEnabled:true,peakLimitW:4000,peakSoftMarginW:0};
  const peak=evaluate({...stateFor(1),gridPowerW:4000},peakSettings,new Date(clock));assert(peak.totalCommandW>=0);
  const pvSettings={...settingsFor(),forcedMode:'self_consumption',dayPlanningMaxSoc:20};
  const pv=evaluate({...stateFor(1),batterySoc:[80],gridPowerW:-200000,controlGridPowerW:-200000,pvPowerW:200000},pvSettings,new Date(clock));
  assert.equal(pv.totalCommandW,-15000,'PV capture above planned grid SoC cap retains full configured charge power');
  results.push({name:'SoC bounds, Peak Guard and PV capture above grid planning cap preserved at high power',passed:true});
  fs.writeFileSync(path.join(ROOT,'validation/battery-power-1.2.2.json'),JSON.stringify({simulatedHomey:true,hardwareTested:false,legacyComparison:Boolean(legacy),
    uiMaximumW:100000,results},null,2)+'\n');
  console.log(`Battery power 1.2.2: ${results.length} scenarios passed (real UI validator, startup/cache/restart, engine/planning and single/dual publications).`);
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(()=>{global.Date=OriginalDate;restoreClear();});
