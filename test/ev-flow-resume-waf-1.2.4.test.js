'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { boot } = require('./startup-harness');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const { localDateTimeUtcMs: at } = require('../lib/homey-energy');
const options = require('../lib/ev-plan-options');
const root = path.resolve(__dirname, '..'), zone = 'Europe/Brussels';
const RealDate = Date, realNow = Date.now;
let now = at('2026-10-27', '10:00', zone), sequence = 0;
global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [Date.now()])); } static now() { return now; } };
const restore = installVirtualClearTimeout(), results = [];
async function check(name, fn) { const evidence = await fn(); results.push({ name, ...evidence }); console.log('PASS', name); }
async function fixture(store) {
  const h = await boot(store || new Map(Object.entries({ evCount: 2, evEnabled: true, ev2Enabled: true, batteryCount: 0, controlEnabled: false })));
  h.app.requestContextEvaluate = () => {};
  return h;
}
const flow = (h, type, value, time = '07:00', guarantee = 'yes', id = 1) => h.cards.get(`set_ev${id}_${type === 'soc' ? 'soc' : 'energy'}_deadline`)
  .listener({ [type === 'soc' ? 'target_soc' : 'energy']: value, time, guarantee });
const change = (a, patch, id = 1) => a.setEvDashboard({ evId: String(id), change: patch, requestId: 'resume_waf_' + (++sequence) });
async function widget(a, type, value, id = 1) {
  if (options.current(a, id - 1)) {
    await change(a, { target: { type, value } }, id);
    await change(a, { days: 2 }, id); await change(a, { time: '17:00' }, id);
  } else await change(a, { target: { type, value }, time: '17:00', days: 2, guaranteed: false }, id);
  a.updateEvStatusInput(id - 1, true, 0, Date.now());
}
function expectFlow(a, type, value, time = '07:00', guarantee = true, id = 1) {
  const p = a.getEvDashboard().evs[id - 1].plan;
  assert(p); assert.equal(p.owner, 'flow'); assert.equal(p.type, type); assert.equal(p.value, value);
  assert.equal(p.time, time); assert.equal(p.guaranteed, guarantee); assert(p.deadlineAt > Date.now());
  assert.equal(options.widget(a, id - 1), null);
}
(async () => { try {
  for (const type of ['soc', 'kwh']) for (const widgetType of ['soc', 'kwh']) await check(`${type} Flow goal returns after ${widgetType} widget disconnect, including after edits`, async () => {
    const h = await fixture(), a = h.app, value = type === 'soc' ? 83 : 13;
    await flow(h, type, value); await widget(a, widgetType, widgetType === 'soc' ? 95 : 25);
    await change(a, { time: '12:00' }); await change(a, { guaranteed: true });
    a.updateEvStatusInput(0, false, 0, Date.now()); expectFlow(a, type, value);
    if (type === 'kwh') assert.equal(a.evEnergyPlans[0].remainingKwh, value);
    assert.equal(options.runtime(a)[0].resumePlan, null); assert.deepEqual(h.errors, []);
  });
  await check('Restart preserves saved Flow input; first explicit false restores it; second restart retains restored Flow', async () => {
    const h = await fixture(); await flow(h, 'kwh', 11, '06:30', 'no'); await widget(h.app, 'soc', 90);
    const restarted = await fixture(new Map(h.store)), b = restarted.app;
    assert.equal(b.getEvInputSnapshot(0).seen.connected, false);
    b.updateEvStatusInput(0, undefined, undefined, Date.now()); assert(options.widget(b, 0));
    b.updateEvStatusInput(0, false, 0, Date.now()); expectFlow(b, 'kwh', 11, '06:30', false);
    expectFlow((await fixture(new Map(restarted.store))).app, 'kwh', 11, '06:30', false);
  });
  await check('Manual widget clear stays empty, including after disconnect and restart', async () => {
    const h = await fixture(); await flow(h, 'soc', 81); await widget(h.app, 'kwh', 20);
    await change(h.app, { clear: true }); assert.equal(options.current(h.app, 0), null);
    h.app.updateEvStatusInput(0, false, 0, Date.now()); assert.equal(options.current(h.app, 0), null);
    assert.equal(options.current((await fixture(new Map(h.store))).app, 0), null);
  });
  await check('Emergency clear does not restore Flow goal on later disconnect', async () => {
    const h = await fixture(); await flow(h, 'soc', 80); await widget(h.app, 'kwh', 20);
    await change(h.app, { mode: 'emergency' }); assert.equal(options.current(h.app, 0), null);
    h.app.updateEvStatusInput(0, false, 0, Date.now()); assert.equal(options.current(h.app, 0), null);
  });
  await check('Latest explicit Flow goal wins; later widget restores that goal without changing another EV', async () => {
    const h = await fixture(), a = h.app;
    await flow(h, 'soc', 80); await widget(a, 'kwh', 20); await flow(h, 'kwh', 17, '12:00', 'no');
    expectFlow(a, 'kwh', 17, '12:00', false); await widget(a, 'soc', 99);
    await flow(h, 'soc', 65, '17:00', 'yes', 2); const other = JSON.stringify(a.getEvDashboard().evs[1].plan);
    assert.equal(await flow(h, 'soc', 120), false);
    a.updateEvStatusInput(0, false, 0, Date.now()); expectFlow(a, 'kwh', 17, '12:00', false);
    assert.equal(JSON.stringify(a.getEvDashboard().evs[1].plan), other);
  });
  await check('Pause/zero/unknown is not disconnect; ordinary Flow mode and underlying Flow goal both resume', async () => {
    const h = await fixture(), a = h.app; await flow(h, 'kwh', 9); await widget(a, 'soc', 90);
    await h.cards.get('set_ev1_session_override').listener({ mode: 'soc_target' });
    a.updateEvStatusInput(0, true, 0, Date.now()); a.updateEvStatusInput(0, null, 0, Date.now());
    assert(options.widget(a, 0)); a.updateEvStatusInput(0, false, 0, Date.now());
    expectFlow(a, 'kwh', 9); assert.equal(a.getEffectiveEvModeFor(0), 'soc_target');
  });
  await check('No remembered Flow goal invents no plan; zero kWh Flow remains a valid restored goal', async () => {
    const h = await fixture(), a = h.app; await widget(a, 'soc', 90);
    a.updateEvStatusInput(0, false, 0, Date.now()); assert.equal(options.current(a, 0), null);
    await flow(h, 'kwh', 0); await widget(a, 'soc', 95);
    a.updateEvStatusInput(0, false, 0, Date.now()); expectFlow(a, 'kwh', 0);
  });
  await check('Completed widget goal still restores Flow goal on disconnect; next connection rearms full Flow kWh', async () => {
    const h = await fixture(), a = h.app; await flow(h, 'kwh', 14); await widget(a, 'kwh', 20);
    a.evEnergyPlans[0].remainingKwh = 0; a.markEvSessionEnded(0, 'energy_target', Date.now());
    assert(options.widget(a, 0).completed); a.updateEvStatusInput(0, false, 0, Date.now());
    expectFlow(a, 'kwh', 14); assert.equal(a.evEnergyPlans[0].remainingKwh, 14);
    a.updateEvStatusInput(0, true, 0, Date.now()); assert.equal(a.evEnergyPlans[0].remainingKwh, 14);
    assert.equal(a.getEvSessionDetectionRuntime(0).endedLatched, false);
  });
  await check('Explicit Flow clear while widget active remains clear across disconnect', async () => {
    const h = await fixture(), a = h.app; await flow(h, 'soc', 85); await widget(a, 'soc', 99);
    await h.cards.get('clear_ev1_soc_deadline_override').listener({});
    a.updateEvStatusInput(0, false, 0, Date.now()); assert.equal(options.current(a, 0), null);
    assert.equal(options.runtime(a)[0].resumePlan, null);
  });
  await check('Widget created before first connection survives false; old widget without saved Flow invents no target', async () => {
    const h = await fixture(), a = h.app;
    await change(a, { target: { type: 'soc', value: 95 }, time: '17:00' });
    a.updateEvStatusInput(0, false, 0, Date.now()); assert(options.widget(a, 0));
    a.updateEvStatusInput(0, true, 0, Date.now()); delete options.runtime(a)[0].resumePlan;
    a.updateEvStatusInput(0, false, 0, Date.now()); assert.equal(options.current(a, 0), null);
  });
  for (const contractType of ['fixed', 'tou', 'dynamic_quarter']) await check(`${contractType}: real context refreshes WAF with unknown EV SoC/horizon every five minutes`, async () => {
    const h = await setup(root, { contractType, expectedEnergyNeedKwh: 16.8, evCount: 1, evEnabled: true,
      evSocEnabled: true, evMode: 'soc_target', evBatteryCapacityKwh: 60, planningMinIntervalMinutes: 60,
      peakReserveEnabled: false, sunChanceReserveEnabled: false }, now, 1500), a = h.app;
    a.setInput({ forecastRemainingKwh: 12, batterySoc: [100,100,100,100] });
    a.updateEvStatusInput(0, true, 0, Date.now());
    await h.cards.get('set_ev1_soc_deadline').listener({ target_soc: 90, time: '07:00', guarantee: 'yes' });
    a.invalidatePlanningCache(true); await h.start(); await h.flush();
    const first = a.getPublicStatus().energyBudget; assert(first?.ready, JSON.stringify(a.planningCache.energyBudget));
    assert.equal(first.evReservedKwh, 0); assert.equal(a.getEvSocFreshness(0).fresh, false);
    const oldPlan = a.getPlanningStatus(), counts = a.diagnostics.counters;
    const wafBefore = counts.widgetEnergyBudgetCalculations, plansBefore = counts.planningCalculations;
    h.setNow(first.calculatedAt + 300000); a.inputUpdatedAt.grid = h.now(); a.inputUpdatedAt.pv = h.now();
    await h.flush();
    const next = a.getPublicStatus().energyBudget; assert(next?.ready); assert.equal(next.calculatedAt, first.calculatedAt + 300000);
    assert.equal(counts.widgetEnergyBudgetCalculations - wafBefore, 1); assert.equal(counts.planningCalculations, plansBefore);
    assert.equal(a.getPlanningStatus(), oldPlan); assert.deepEqual(h.errors, []);
    // A forced WAF refresh itself must not even READ EV goals or run a planner.
    const evaluationState = a.getEvaluationState(a.getSettings(), h.now());
    const saved = new Map();
    for (const name of ['getEvCount', 'getEvInputSnapshot', 'getEvSocFreshness', 'planEvDeadline']) {
      saved.set(name, a[name]); a[name] = () => { throw new Error('WAF touched ' + name); };
    }
    try { a.planningCache.budgetNextAt = 0; a.refreshPlanningInContext(a.getSettings(), a.controlRuntimeSettings,
      evaluationState, h.now(), a.latestResult); assert(a.planningCache.energyBudget.ready); }
    finally { for (const [name, fn] of saved) a[name] = fn; }
    return { firstAt: first.calculatedAt, nextAt: next.calculatedAt, extraWafCalculations: 1, extraBatteryPlans: 0 };
  });
  fs.writeFileSync(path.join(root, 'validation/ev-flow-resume-waf-1.2.4.json'), JSON.stringify({
    simulatedHomey: true, physicalHomeyTested: false, passed: results.length, results }, null, 2) + '\n');
  console.log('Flow goal resume / independent WAF:', results.length, 'groups passed');
} finally { restore(); global.Date = RealDate; Date.now = realNow; } })().catch(e => { console.error('FAILED after', results.length, e); process.exitCode = 1; });
