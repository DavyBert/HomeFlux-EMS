'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { calculateBudget, householdDaily } = require('../lib/widget-energy-budget');
const { DEFAULTS, buildSocPlan } = require('../lib/ems-engine');
const { localDateTimeUtcMs } = require('../lib/homey-energy');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const { fixture } = require('./ev-work-harness');
const { boot } = require('./startup-harness');
const cases = [];
const runtimeMetrics = {};
function check(name, fn) { fn(); cases.push(name); console.log('PASS', name); }
const HOUR = 3600000;
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const now = Date.parse('2026-10-25T06:00:00Z'); // 07:00 CET, after the DST transition
const base = { now, settings: { ...DEFAULTS, batteryCount: 1, totalCapacityKwh: 10,
  expectedEnergyNeedKwh: 16.8, minSoc: 12, safetySoc: 14, controlEnabled: true },
  state: { batterySoc: [80] },
  plan: { ready: true, currentSoc: 80, targetSoc: 50, safetySoc: 14,
    planningPhase: 'day', planningChargeDeadlineAt: now + 10 * HOUR,
    forecastReady: true, forecastUsedSource: 'today_remaining', forecastUsedKwh: 12 } };
const calc = overrides => calculateBudget({ ...base, ...overrides });
check('16.8 kWh/day = 0.7 kW; 10h household need = 7 kWh; positive budget = 3 after filling to maximum', () => {
  const b = calc(); near(b.householdKwh, 7); assert.equal(b.batteryBalanceKwh, -2); near(b.valueKwh, 3);
});
check('Negative budget and signed battery deficit reserve target only once', () => {
  const b = calc({ state: { batterySoc: [20] }, plan: { ...base.plan, forecastUsedKwh: 2 } });
  assert.equal(b.batteryBalanceKwh, -8); near(b.valueKwh, -13);
});
check('Screenshot regression: fill 21.6 kWh from 37.5% to 100%, independently of the 60% grid goal', () => {
  const settings = { ...base.settings, batteryCount: 4, totalCapacityKwh: 21.6,
    maxSoc: 100, expectedEnergyNeedKwh: 5.73 * 24 / 7 };
  const state = { batterySoc: [37.5,37.5,37.5,37.5] };
  const plan = { ...base.plan, currentSoc: 37.5, targetSoc: 60,
    planningChargeDeadlineAt: now + 7 * HOUR, forecastUsedKwh: 20.65 };
  const b = calc({ settings, state, plan });
  near(b.batteryGoalNeedKwh, 13.5); near(b.householdKwh, 5.73); near(b.valueKwh, 1.42);
  assert.equal(plan.targetSoc, 60, 'WAF never mutates the actual grid plan');
  for (const goal of [40,60,80]) {
    near(calc({ settings, state, plan: { ...plan, targetSoc: goal,
      calculatedTargetSoc: goal, planningMaxSoc: goal, gridPlannedKwh: 999,
      rows: [{ plannedNetCharge: true, plannedEnergyKwh: 999 }] } }).valueKwh, 1.42);
  }
  const limited = calc({ settings: { ...settings, maxSoc: 90 }, state, plan });
  near(limited.batteryGoalNeedKwh, 11.34); near(limited.valueKwh, 3.58);
  const missingMaximum = calc({ settings: { ...settings, maxSoc: null }, state, plan });
  assert.equal(missingMaximum.ready, false);
});
check('A stronger day PV forecast is credited once even when the computed grid target drops', () => {
  const settings = { ...base.settings, batteryCount: 4, totalCapacityKwh: 21.6,
    timezone: 'Europe/Brussels', maxSoc: 100, expectedEnergyNeedKwh: 16.8 };
  const state = { batterySoc: [80,80,80,80], forecastRemainingKwh: 12, forecastDailyMaxKwh: 12,
    planningForecastDay: 'today', nightPlanningActive: false };
  const first = buildSocPlan(state, settings, new Date(now));
  const moreSolar = { ...state, forecastRemainingKwh: 13, forecastDailyMaxKwh: 13 };
  const second = buildSocPlan(moreSolar, settings, new Date(now));
  assert(second.targetSoc < first.targetSoc);
  const a = calc({ settings, state, plan: first });
  const b = calc({ settings, state: moreSolar, plan: second });
  near(b.valueKwh - a.valueKwh, 1);
});
check('Existing normalized non-EV daily median; partial days excluded; zero fallback preserved', () => {
  const learning = { days: [{ sampleHours: 24, estimatedDemandKwh: 16.8 },
    { sampleHours: 18, estimatedDemandKwh: 12.6 }, { sampleHours: 4, estimatedDemandKwh: 50 }] };
  near(householdDaily(learning, 99).kwh, 16.8);
  near(calc({ learning }).householdKwh, 7);
  assert.equal(householdDaily({}, 0).kwh, 0);
  assert.equal(householdDaily({}, null), null);
});
check('Minimum, safety, sun reserve and planning goal protect the largest reserve', () => {
  const b = calc({ reserveSoc: 90, plan: { ...base.plan, planningPhase: 'night' } }); assert.equal(b.targetSoc, 50); assert.equal(b.dischargeFloorSoc, 90); assert.equal(b.batteryBalanceKwh, 0);
  assert.equal(calc({ plan: { ...base.plan, planningPhase: 'night', targetSoc: 5 } }).targetSoc, 14);
  assert.equal(calc({ plan: { ...base.plan, planningPhase: 'night', peakReserveActive: true, peakReserveTargetSoc: 95 } }).targetSoc, 95);
  near(calc({ reserveSoc: 90, plan: { ...base.plan, planningPhase: 'night' } }).batteryBalanceKwh, 0);
});
check('WAF ignores known and unknown EV reservations and horizons', () => {
  const expected = calc();
  for (const ev of [
    { reserved: true, needKwh: 3, deadlineAt: now + HOUR },
    { reserved: true, needKwh: 3, deadlineAt: now + 12 * HOUR,
      slots: [{ startAt: now + 9 * HOUR, endAt: now + 11 * HOUR, powerW: 1000 }] },
    { reserved: true, needKwh: 3, deadlineAt: now + HOUR, nightReservedKwh: 2 },
    { reserved: true, needKwh: null, deadlineAt: now + HOUR },
    { reserved: true, needKwh: 3, deadlineAt: now + 12 * HOUR },
  ]) assert.deepEqual(calc({ evs: [ev] }), expected);
  assert.equal(expected.evReservedKwh, 0);
});
check('Night never credits a full next-day forecast before morning; target still uses night median', () => {
  const plan = { ...base.plan, planningPhase: 'night', forecastUsedSource: 'tomorrow', forecastUsedKwh: 50 };
  const b = calc({ plan }); assert.equal(b.solarKwh, 0); near(b.valueKwh, -4);
});
check('Missing forecast, missing battery, disabled output and expired planning stay unknown', () => {
  assert.equal(calc({ plan: { ...base.plan, forecastReady: false } }).ready, false);
  assert.equal(calc({ state: { batterySoc: [null] } }).ready, false);
  assert.equal(calc({ batteryAvailable: false }).ready, false);
  assert.equal(calc({ now: base.plan.planningChargeDeadlineAt }).ready, false);
  assert.equal(calc({ plan: { ...base.plan, forecastUsedSource: 'today_full_fallback' } }).ready, false);
});
check('Actual production plan resolves Brussels DST/midnight horizon in elapsed hours', () => {
  const at = localDateTimeUtcMs('2026-10-24', '23:00', 'Europe/Brussels');
  const settings = { ...base.settings, timezone: 'Europe/Brussels', contractType: 'fixed', nightTargetTime: '07:00' };
  const state = { ...base.state, nightPlanningActive: true, planningForecastDay: 'tomorrow', forecastTomorrowKwh: 20 };
  const plan = buildSocPlan(state, settings, new Date(at));
  assert.equal(plan.planningChargeDeadlineAt, localDateTimeUtcMs('2026-10-25', '07:00', 'Europe/Brussels'));
  assert.equal(calculateBudget({ now: at, settings, state, plan }).remainingHours, 9);
});

const html = fs.readFileSync(path.join(__dirname, '../widgets/status/public/index.html'), 'utf8');
const script = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
const dom = {};
const ui = vm.createContext({ console, Date, document: { getElementById: id => dom[id] || null } });
vm.runInContext(script, ui);
const Homey = { __: key => key };
function view(budget, colors, at) { ui.budget = budget; ui.colors = colors; ui.at = at; return vm.runInContext('budgetView(budget, colors, at)', ui); }
check('UI budget expiry, unknowns, neutral mode and continuous scale', () => {
  const b = { ready: true, valueKwh: .8, calculatedAt: now, validUntil: now + HOUR };
  assert(view(b, true, now).text.startsWith('+')); assert(view({ ...b, valueKwh: -4.2 }, true, now).text.startsWith('-'));
  assert.equal(view(null, true, now).text, '--'); assert.equal(view(b, true, now - 1).text, '--');
  assert.equal(view(b, true, now + HOUR).text, '--'); assert.equal(view(b, false, now).background, '');
  assert.notEqual(view(b, true, now).background, view({ ...b, valueKwh: .81 }, true, now).background);
});
check('Default options enabled and explicit false choices retained independently', () => {
  const manifest = require('../widgets/status/widget.compose.json');
  for (const id of ['showEnergyBudget', 'showCriticalAlerts', 'statusColors']) {
    assert.equal(manifest.settings.find(s => s.id === id).value, true);
    ui.id = id;
    assert.equal(vm.runInContext('enabled({}, id)', ui), true);
    assert.equal(vm.runInContext('enabled({[id]:false}, id)', ui), false);
  }
});
check('Five-second warning alternation survives refresh; recovery and color-off retain text', () => {
  dom['decision-value'] = { style: {} }; dom['decision-reason'] = { style: {} };
  ui.Homey = Homey; ui.status = { action: 'discharge', criticalAlert: { id: 'input' } }; ui.settings = {};
  const update = at => { ui.at = at; vm.runInContext('updateDecisionDisplay(status, settings, Homey, at)', ui); return dom['decision-value'].textContent; };
  assert.equal(update(now), 'Discharging battery');
  assert(update(now + 5000).startsWith('Warning:'));
  assert.equal(update(now + 10000), 'Discharging battery');
  assert(update(now + 15000).startsWith('Warning:'));
  ui.settings = { statusColors: false }; assert(update(now + 15001).startsWith('Warning:'));
  assert.equal(dom['decision-value'].className, 'decision-value');
  ui.settings = { showCriticalAlerts: false }; assert.equal(update(now + 15002), 'Discharging battery');
  ui.settings = {}; ui.status.criticalAlert = null; assert.equal(update(now + 15003), 'Discharging battery');
});
check('Colors use real bounds, explicit direction and never mark ordinary planned waiting red', () => {
  ui.status = { avgSoc: 30, targetSoc: 80, settings: { minSoc: 12, safetySoc: 14 } };
  assert.equal(vm.runInContext("metricTone('soc', status)", ui), '');
  ui.status.avgSoc = 12; assert.equal(vm.runInContext("metricTone('soc', status)", ui), 'critical');
  ui.status.avgSoc = 14; assert.equal(vm.runInContext("metricTone('soc', status)", ui), 'attention');
  ui.status.avgSoc = null; assert.equal(vm.runInContext("metricTone('soc', status)", ui), '');
  ui.status.outputCommandModes = ['charge']; ui.status.outputTotalCommandW = 1000;
  assert.equal(vm.runInContext("metricTone('output', status)", ui), 'positive');
});

check('Production DOM: independent options, neutral colors, NL/EN text and persistent circle', () => {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.attributes = {}; this.className = ''; this.textContent = ''; }
    set id(id) { this._id = id; dom[id] = this; }
    get id() { return this._id; }
    set innerHTML(text) { this.children = []; }
    get firstChild() { return this.children[0]; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); return node; }
    setAttribute(key, value) { this.attributes[key] = value; }
  }
  ui.document.createElement = tag => new Element(tag);
  dom.content = new Element('div');
  const all = root => [root, ...root.children.flatMap(all)];
  const en = require('../locales/en.json'), nl = require('../locales/nl.json');
  for (const locale of [en, nl]) for (const colors of [true, false]) {
    ui.Homey = { __: key => key.split('.').reduce((obj, k) => obj?.[k], locale) || key };
    ui.status = { action: 'discharge', avgSoc: 80, targetSoc: 50, outputCommandModes: ['discharge'],
      settings: { minSoc: 12, safetySoc: 14 }, criticalAlert: { id: 'balance' },
      energyBudget: { ready: true, valueKwh: 7, calculatedAt: now, targetAt: now + HOUR, validUntil: now + HOUR } };
    ui.settings = { statusColors: colors };
    ui.at = now;
    vm.runInContext('renderStatus(status, settings, Homey); updateDecisionDisplay(status, settings, Homey, at)', ui);
    const circle = dom['energy-budget']; assert(circle); assert(circle.firstChild.textContent.startsWith('+'));
    assert.equal(Boolean(circle.style.background), colors);
    assert.equal(all(dom.content).some(el => el.className.includes('tone-')), colors);
    const reserves = all(dom.content).filter(el => el.className.includes('decision-reserve'));
    assert.equal(reserves.length, 2); assert(reserves.every(el => el.attributes['aria-hidden'] === 'true'));
    ui.at = now + 5000;
    vm.runInContext('updateDecisionDisplay(status, settings, Homey, at)', ui);
    assert.equal(dom['energy-budget'], circle, 'rotation must not rebuild or hide WAF');
    assert(dom['decision-value'].textContent.includes(locale === nl ? 'Waarschuwing' : 'Warning'));
    ui.settings = { statusColors: colors, showEnergyBudget: false };
    vm.runInContext('renderStatus(status, settings, Homey)', ui);
    assert(!all(dom.content).some(el => el.id === 'energy-budget'));
    ui.settings = { statusColors: colors, showDecision: false };
    vm.runInContext('renderStatus(status, settings, Homey)', ui);
    assert(all(dom.content).some(el => el.id === 'energy-budget'));
    assert(all(dom.content).find(el => el.className === 'decision-copy').hidden);
  }
});

async function integration() {
  const realNow = Date.now;
  const restoreClear = installVirtualClearTimeout();
  try {
    const h = await setup(undefined, { planningMinIntervalMinutes: 5, expectedEnergyNeedKwh: 16.8 }, now, 1500);
    const a = h.app;
    const counts = {};
    const count = a.recordDiagnosticCounter.bind(a);
    a.recordDiagnosticCounter = (key, ...args) => { counts[key] = (counts[key] || 0) + 1; return count(key, ...args); };
    a.setInput({ gridPowerW: 600, pvPowerW: 1500, forecastRemainingKwh: 12, batterySoc: [80,80,80,80] });
    await h.start(); await h.flush();
    // Isolate one forced actual calculation from the normal input-triggered startup.
    for (const key of Object.keys(counts)) counts[key] = 0;
    a.invalidatePlanningCache(true); await h.start();
    assert.equal(counts.widgetEnergyBudgetCalculations, 1);
    assert.equal(counts.planningCalculations, 1);
    let budget = a.getPlanningStatus().energyBudget;
    assert(budget.ready);
    // Battery Save may hold discharge at 90% without planning a charge to 90%.
    // Its actual current floor must not be advertised as freely spendable.
    await h.setExternalSetting('lowForecastFixedEnabled', true);
    await h.setExternalSetting('lowForecastSelfConsumptionMinKwh', 50);
    await h.setExternalSetting('batterySaveDischargeAboveSoc', 90);
    a.invalidatePlanningCache(true); await h.start(); await h.flush();
    const savingBudget = a.getPlanningStatus().energyBudget;
    assert.equal(a.latestResult.ordinaryDischargeFloorSoc, 90);
    assert.equal(savingBudget.dischargeFloorSoc, 100);
    near(savingBudget.batteryAvailableKwh, 0);
    assert.equal(savingBudget.targetSoc, 100);
    assert.equal(savingBudget.planningTargetSoc, 80);
    near(savingBudget.batteryGoalNeedKwh, 4.32);
    budget = savingBudget;
    const recorded = counts.widgetEnergyBudgetCalculations;
    for (let i = 0; i < 300; i++) {
      h.setNow(now + i * 10); await h.grid(600 + i % 2); await h.flush();
    }
    for (let i = 0; i < 100; i++) a.getPublicStatus();
    for (let i = 0; i < 10; i++) { await a.publishEvPortfolio(a.latestResult, 0, 0, { heartbeatEv: true }); }
    assert.equal(counts.widgetEnergyBudgetCalculations, recorded, 'P1/status/EV heartbeat must not compute WAF');
    const settings = a.getSettings();
    const state = a.getEvaluationState(settings, h.now());
    a.refreshPlanningInContext(settings, a.controlRuntimeSettings, state, h.now());
    assert.equal(counts.widgetEnergyBudgetCalculations, recorded, 'unchanged cache reused');
    Object.assign(runtimeMetrics, { p1Inputs: 300, statusReads: 100, heartbeatPortfolioCalls: 10,
      extraWafCalculations: counts.widgetEnergyBudgetCalculations - recorded,
      oneActualPlanWafCalculations: 1, cachedBudgetSerializedBytes: Buffer.byteLength(JSON.stringify(budget)) });
    const status = a.getPublicStatus();
    assert.deepEqual(status.energyBudget, budget);
    a.balanceMonitor.warningActive = true; a.balanceMonitor.warningText = 'existing balance warning';
    assert.equal(a.getPublicStatus().criticalAlert.id, 'balance');
    a.latestResult.safetySocRecoveryActive = true; assert.equal(a.getPublicStatus().criticalAlert.id, 'safety_soc');
    h.setNow(now + 1000000); assert.equal(a.getPublicStatus().criticalAlert.id, 'input');
    a.latestResult.safetySocRecoveryActive = false; a.balanceMonitor.warningActive = false;
    a.inputUpdatedAt.grid = h.now(); assert.equal(a.getPublicStatus().criticalAlert, null);
    h.setNow(budget.validUntil); assert.equal(a.getPublicStatus().energyBudget, null);
    // Planning is an in-memory cache; a fresh instance cannot restore a stale
    // WAF number. Any first result comes only from its normal startup plan.
    a.planningCache.value = null; assert.equal(a.getPublicStatus().energyBudget, null);
    assert.deepEqual(h.errors, []);
    const reboot = await boot(new Map(h.store));
    assert.equal(reboot.app.getPublicStatus().energyBudget, null, 'no restored stale WAF number and no status-triggered plan');
    cases.push('300 real P1 inputs, 100 status reads, EV heartbeat/portfolio and cache reuses: zero additional WAF calculations; existing alerts and expiry verified');
    console.log('PASS', cases.at(-1));
    const e = await fixture({ evs: 1, chargeAllowed: true, pv: 1500 });
    await e.cards.get('set_ev1_energy_deadline').listener({ energy: 3, time: '16:00', guarantee: 'yes' });
    e.app.setInput({ forecastRemainingKwh: 12 });
    e.app.invalidatePlanningCache(true); await e.start(); await e.flush();
    assert(e.app.getPlanningStatus().energyBudget.ready);
    near(e.app.getPlanningStatus().energyBudget.evReservedKwh, 0);
    await e.cards.get('set_ev1_soc_deadline').listener({ target_soc: 75, time: '16:00', guarantee: 'yes' });
    e.app.invalidatePlanningCache(true); await e.start(); await e.flush();
    const socBudget = e.app.getPlanningStatus().energyBudget;
    assert(socBudget.ready); near(socBudget.evReservedKwh, 0);
    assert.deepEqual(e.errors, []);
    cases.push('Real Flow kWh and SoC targets never reserve or gate the household WAF; actual app reboot keeps unknown until normal planning');
    console.log('PASS', cases.at(-1));
  } finally { Date.now = realNow; restoreClear(); }
}

integration().then(() => {
  for (let i = 0; i < 1000; i++) calc();
  if (global.gc) global.gc();
  const memoryBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage(); const started = performance.now();
  for (let i = 0; i < 10000; i++) calc();
  const elapsedMs = performance.now() - started, cpu = process.cpuUsage(cpuBefore);
  const allocatedHeapDeltaBytes = process.memoryUsage().heapUsed - memoryBefore;
  if (global.gc) global.gc();
  const retainedHeapDeltaBytes = global.gc ? process.memoryUsage().heapUsed - memoryBefore : null;
  const result = { cases, runtimeMetrics, microbenchmark: { iterations: 10000, elapsedMs,
    cpuMs: (cpu.user + cpu.system) / 1000, allocatedHeapDeltaBytes, retainedHeapDeltaBytes,
    note: 'Node container microbenchmark; heap delta includes temporary allocations/GC, not retained Homey memory or device CPU percentage.' } };
  fs.writeFileSync(path.join(__dirname, '../validation/widget-insights-1.2.1.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.microbenchmark));
}).catch(error => { console.error(error); process.exitCode = 1; });
