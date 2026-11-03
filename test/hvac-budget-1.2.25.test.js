'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nativeNow = Date.now;
const { setup, cycle, known, baseline, clock } = require('./hvac-coordination-1.2.15.test');
const H = require('../lib/hvac-permanent');
const C = require('../lib/hvac-coordination');
const passed = [];
async function check(name, fn) { await fn(); passed.push(name); }
function inputs(a, i, values) {
  if (!i) for (const [key, value] of Object.entries(values)) a.state['hvac' + key[0].toUpperCase() + key.slice(1)] = value;
  else Object.assign(a.getExtraHvac(i).state, values);
}
function receipt(a, i, target, mode = 'heat', power = true) {
  if (!i) Object.assign(a, { lastPublishedHvacSetpoint: target, lastPublishedHvacMode: mode, lastPublishedHvacPower: power });
  else Object.assign(a.getExtraHvac(i), { lastPublishedSetpoint: target, lastPublishedMode: mode, lastPublishedPower: power });
}
function stopped(a, count, room = 19) {
  for (let i = 0; i < count; i++) {
    inputs(a, i, { roomTemperatureC: room, mode: 'off', setpointC: 20 });
    receipt(a, i, null, '', null);
    Object.assign(H.unit(a, i), { setpoint: null, mode: '', powerOff: false });
  }
}
function active(a, i, watts, room = 19, target = 23, mode = 'heat') {
  inputs(a, i, { roomTemperatureC: room, mode, setpointC: target });
  receipt(a, i, target, mode);
  Object.assign(H.unit(a, i), { setpoint: target, mode, powerOff: false, [mode]: watts / 1.2 - 1e-9, [mode + 'Review']: false, outputAt: clock.now() });
}
function direct(count, extra = {}) {
  const s = { hvacExtraGridBudgetEnabled: true, hvacExtraGridBudgetW: 2000, ...extra };
  for (let i = 0; i < count; i++) s[`hvac${i ? i + 1 : ''}DirectTariffEnabled`] = true;
  return s;
}
function tick(h, ms = 300000) {
  clock.set(clock.now() + ms);
  h.app.inputUpdatedAt.grid = clock.now(); h.app.inputUpdatedAt.pv = clock.now();
  h.app.flexiblePriorityState.nextEvaluationAt = 0;
}
const starts = h => h.events.filter(e => e.kind === 'power' && e.state_value === 1);
async function main() {
  for (const [count, budget] of [[1, 3600], [4, 2000], [4, 3600], [4, 3800]]) {
    await check(`${count} unknown independent HVACs reserve ${count * 360} W under ${budget} W`, async () => {
      const h = await setup(count, direct(count, { hvacExtraGridBudgetW: budget })); stopped(h.app, count);
      const timers = h.timers.length;
      await cycle(h); assert.equal(starts(h).length, count);
      assert.equal(H.runtime(h.app).budgetGuard.watts, count * 360);
      assert.equal(H.runtime(h.app).observation, null); assert.equal(h.timers.length, timers);
      const before = h.events.length; await cycle(h); assert.equal(h.events.length, before);
    });
  }
  await check('1900 W existing plus 600 W waits under 2000 W; regular pass retries after demand disappears', async () => {
    const h = await setup(4, direct(4)), a = h.app; stopped(a, 4);
    [750, 650, 500].forEach((w, i) => active(a, i, w));
    Object.assign(H.unit(a, 3), { heat: 500, heatReview: false });
    await cycle(h); assert.equal(H.runtime(a).budgetGuard.watts, 1900);
    assert.equal(starts(h).length, 0); assert.match(a.getExtraHvac(3).latestDecision.reason, /gezamenlijk vermogensbudget/);
    inputs(a, 0, { roomTemperatureC: 24 }); tick(h); await cycle(h);
    assert.equal(starts(h).length, 1); assert.equal(starts(h)[0].instance, 4);
    assert.equal(H.runtime(a).budgetGuard.watts, 1750);
  });
  await check('Household import, PV and battery changes cannot change HVAC budget or create budget alarm', async () => {
    const h = await setup(4, direct(4)), a = h.app; stopped(a, 4); await cycle(h);
    for (const [grid, pv, battery] of [[12000, 0, 0], [-8000, 14000, 0], [4000, 1000, -3000], [500, 0, 4000]]) {
      Object.assign(a.state, { gridPowerW: grid, pvPowerW: pv, lastTotalCommandW: battery });
      assert.equal(C.budgetAlarm(a, clock.now(), a.getSettings()), false);
      await cycle(h); assert.equal(H.runtime(a).budgetGuard.watts, 1440);
    }
    assert.equal(h.events.filter(e => e.kind === 'power' && e.state_value === 0).length, 0);
    H.runtime(a).budgetGuard = { houseW: 0, evW: 0 }; assert.equal(C.budgetAlarm(a), false);
  });
  for (const hour of [2, 14]) await check(`Permanent comfort starts without PV or tariff optimization at ${hour}:00`, async () => {
    clock.set(Date.UTC(2026, 10, 2, hour));
    const h = await setup(1, { hvacExtraGridBudgetEnabled: true, hvacExtraGridBudgetW: 3600, hvacTariffEnabled: false, hvacPvEnabled: false, hvacHeatingActivationBelowC: 16 }), a = h.app;
    stopped(a, 1, 12); await cycle(h); assert.equal(starts(h).length, 1);
    assert.equal(a.latestHvacDecision.energySource, 'comfort'); assert.equal(a.latestHvacDecision.setpointCommand, 20);
  });
  await check('PV-dependent extra demand cannot use a joint budget as a replacement for PV', async () => {
    const h = await setup(1, { hvacPermanentEnabled: false, hvacExtraGridBudgetEnabled: true, hvacExtraGridBudgetW: 3800 }), a = h.app;
    stopped(a, 1, 12); await cycle(h); assert.equal(starts(h).length, 0);
    assert.match(a.latestHvacDecision.reason, /PV/);
  });
  await check('No double reservation when an active source changes target or heating/cooling mode', async () => {
    const h = await setup(1, direct(1, { hvacExtraGridBudgetW: 1200 })), a = h.app;
    active(a, 0, 1200, 19, 22); await cycle(h);
    assert.equal(a.latestHvacDecision.setpointCommand, 23); assert.equal(a.latestHvacDecision.hvacAdmission.siteReservedW, 0);
    tick(h); a.setSetting('hvacDirection', 'cool'); a.setSetting('hvacCheapTargetC', 18);
    Object.assign(H.unit(a, 0), { cool: 1000, coolReview: false });
    await cycle(h); assert.equal(a.latestHvacDecision.setpointCommand, 18);
    assert.equal(a.latestHvacDecision.hvacAdmission.siteReservedW, 0); assert.equal(H.runtime(a).budgetGuard.watts, 1200);
  });
  await check('Budget disabled does not block; Peak Guard independently still limits new starts', async () => {
    const h = await setup(2, direct(2, { hvacExtraGridBudgetEnabled: false, hvacExtraGridBudgetW: 0 })), a = h.app;
    stopped(a, 2); await cycle(h); assert.equal(starts(h).length, 2);
    const p = await setup(1, direct(1, { peakShaveEnabled: true, peakLimitW: 1000, peakSoftMarginW: 100 }));
    stopped(p.app, 1); p.app.state.gridPowerW = 700; await cycle(p);
    assert.equal(starts(p).length, 0); assert.match(p.app.latestHvacDecision.reason, /Peak Guard/);
  });
  await check('Necessary comfort outranks higher-device-priority optional storage', async () => {
    const h = await setup(2, direct(2, { hvacExtraGridBudgetW: 400 })), a = h.app;
    stopped(a, 2); inputs(a, 0, { roomTemperatureC: 21 });
    await cycle(h); assert.deepEqual(starts(h).map(e => e.instance), [2]);
    assert.match(a.latestHvacDecision.reason, /vermogensbudget/);
  });
  await check('An oversized first request does not collectively block a smaller unknown source', async () => {
    const h = await setup(2, { hvacExtraGridBudgetEnabled: true, hvacExtraGridBudgetW: 400 }), a = h.app;
    stopped(a, 2); H.unit(a, 0).heat = 1000;
    await cycle(h); assert.deepEqual(starts(h).map(e => e.instance), [2]);
  });
  await check('Unknown devices retain staggered starts and existing intervals without direct settings', async () => {
    const h = await setup(4, { hvacExtraGridBudgetEnabled: true, hvacExtraGridBudgetW: 2000 }), a = h.app; stopped(a, 4);
    for (let i = 1; i <= 4; i++) { await cycle(h); assert.equal(starts(h).length, i); const before = h.events.length; await cycle(h); assert.equal(h.events.length, before); tick(h); }
    assert.equal(H.runtime(a).budgetGuard.watts, 1440);
  });
  await check('One shared heat pump with four thermostats reserves 360 W, not four independent loads', async () => {
    const extra = direct(4, { hvacExtraGridBudgetW: 400 });
    for (let i = 2; i <= 4; i++) { extra[`hvac${i}SharedPowerEnabled`] = true; extra[`hvac${i}SharedPowerWith`] = 1; }
    const h = await setup(4, extra); stopped(h.app, 4); await cycle(h);
    assert.equal(starts(h).length, 4); assert.equal(H.runtime(h.app).budgetGuard.watts, 360);
  });
  await check('True overload sheds only the lowest-priority necessary source and preserves the other', async () => {
    const h = await setup(2, direct(2, { hvacExtraGridBudgetW: 400 })), a = h.app;
    active(a, 0, 360); active(a, 1, 360);
    await cycle(h); assert.deepEqual(h.events.filter(e => e.kind === 'power' && e.state_value === 0).map(e => e.instance), [2]);
    assert.equal(H.runtime(a).budgetGuard.watts, 360); assert.equal(H.unit(a, 0).powerOff, false);
  });
  for (const mode of ['heat', 'cool']) await check(`Normal permanent ${mode} control reduces by 0.5 degrees, preserving the other source`, async () => {
    const extra = direct(2, { hvacExtraGridBudgetW: 400, hvacTariffEnabled: false, hvac2TariffEnabled: false });
    const h = await setup(2, extra), a = h.app;
    active(a, 0, 360, mode === 'heat' ? 20 : 24, mode === 'heat' ? 20.5 : 23.5, mode);
    Object.assign(H.unit(a, 0), { comfortMode: mode });
    a.setSetting('hvacDirection', mode);
    active(a, 1, 360, 19); Object.assign(H.unit(a, 1), { comfortMode: 'heat' });
    await cycle(h); assert.equal(a.latestHvacDecision.setpointCommand, mode === 'heat' ? 20 : 24);
    assert.equal(h.events.filter(e => e.kind === 'power' && e.state_value === 0).length, 0);
    assert.equal(H.runtime(a).budgetGuard.watts, 360);
  });
  await check('Pending comfort reclaims optional tariff storage without changing the configured tariff temperature', async () => {
    const h = await setup(2, direct(2, { hvacExtraGridBudgetW: 1200 })), a = h.app; stopped(a, 2);
    active(a, 0, 1200, 21, 23);
    await cycle(h); assert.equal(a.latestHvacDecision.powerCommand, false); assert.equal(starts(h).length, 0);
    assert.equal(a.lastPublishedHvacSetpoint, 23); assert.equal(a.getSettings().hvacCheapTargetC, 23);
    tick(h); await cycle(h); assert.deepEqual(starts(h).map(e => e.instance), [2]);
    assert.equal(H.runtime(a).budgetGuard.watts, 360);
  });
  await check('Normal permanent half-degree reductions respect the existing interval and never assume freed watts', async () => {
    const h = await setup(1, { hvacExtraGridBudgetEnabled: true, hvacExtraGridBudgetW: 100, hvacTariffEnabled: false }), a = h.app;
    active(a, 0, 360, 19, 20); H.unit(a, 0).comfortMode = 'heat';
    await cycle(h); assert.equal(a.lastPublishedHvacSetpoint, 19.5); assert.equal(H.runtime(a).budgetGuard.watts, 360);
    const before = h.events.length; await cycle(h); assert.equal(h.events.length, before);
    tick(h); await cycle(h); assert.equal(a.lastPublishedHvacSetpoint, 19); assert.equal(H.runtime(a).budgetGuard.watts, 0);
    tick(h); await cycle(h); assert.equal(starts(h).length, 0); assert.match(a.latestHvacDecision.reason, /vermogensbudget/);
  });
  await check('A new real OFF feedback can restart the requested HVAC once, while stale OFF feedback cannot repeat ON', async () => {
    const h = await setup(2, direct(2)), a = h.app; stopped(a, 2); await cycle(h);
    for (const index of [0, 1]) {
      tick(h); inputs(a, index, { mode: 'off' });
      (index === 0 ? a.inputUpdatedAt.hvac : a.getExtraHvac(index).updatedAt).mode = clock.now();
      const before = starts(h).length; await cycle(h); assert.equal(starts(h).length, before + 1);
      await cycle(h); assert.equal(starts(h).length, before + 1);
    }
    assert.equal(H.runtime(a).budgetGuard.watts, 720);
  });
  await check('An ongoing legacy PV session cannot restart thermal demand outside the HVAC budget', async () => {
    const h = await setup(2, { hvacPermanentEnabled: false, hvacComfortMinC: 24, hvacExtraGridBudgetEnabled: true, hvacExtraGridBudgetW: 360 }), a = h.app;
    active(a, 0, 360, 21.2, 21); active(a, 1, 360, 19, 23);
    Object.assign(a, { hvacBaselineSetpoint: 20, hvacBoostMode: 'heat', hvacManagedPowerOn: true, lastHvacControlAt: clock.now() - 300000 });
    Object.assign(H.unit(a, 0), { legacyCoordinated: true });
    Object.assign(a.state, { gridPowerW: -5000, pvPowerW: 6500 });
    await cycle(h); assert.equal(a.lastPublishedHvacSetpoint, 21); assert.match(a.latestHvacDecision.reason, /vermogensbudget/);
    assert.equal(H.runtime(a).budgetGuard.watts, 360);
    inputs(a, 1, { roomTemperatureC: 24 }); tick(h); await cycle(h);
    assert.equal(a.lastPublishedHvacSetpoint, 21.5); assert.equal(H.runtime(a).budgetGuard.watts, 360);
  });
  await check('Budget reduction remains possible for a physically active normal permanent device without a comfort session', async () => {
    const h = await setup(1, { hvacTariffEnabled: false, hvacExtraGridBudgetEnabled: true, hvacExtraGridBudgetW: 100 }), a = h.app;
    active(a, 0, 360, 21, 23); assert.equal(H.unit(a, 0).comfortMode, undefined);
    await cycle(h); assert.equal(a.lastPublishedHvacSetpoint, 22.5);
    assert.equal(H.runtime(a).budgetGuard.watts, 360);
  });
  await check('Cooling tariff targets remain unchanged during a real joint-budget reduction', async () => {
    const h = await setup(2, direct(2, { hvacDirection: 'cool', hvacCheapTargetC: 21, hvacExtraGridBudgetW: 400 })), a = h.app;
    active(a, 0, 360, 23, 21, 'cool'); active(a, 1, 360);
    await cycle(h); assert.equal(a.lastPublishedHvacPower, false); assert.equal(a.lastPublishedHvacSetpoint, 21);
    assert.equal(a.getSettings().hvacCheapTargetC, 21); assert.equal(H.runtime(a).budgetGuard.watts, 360);
  });
  await check('A single staggered unknown legacy PV source retains automatic learning under the same safety conditions', async () => {
    const h = await setup(1, { hvacPermanentEnabled: false, hvacComfortMinC: 22, hvacExtraGridBudgetEnabled: true, hvacExtraGridBudgetW: 400 }), a = h.app;
    baseline(a); inputs(a, 0, { roomTemperatureC: 19 });
    Object.assign(a.state, { gridPowerW: -5000, pvPowerW: 6500 });
    await cycle(h); assert(H.runtime(a).observation); assert.equal(H.runtime(a).observation.manual, false);
    assert.equal(H.runtime(a).observation.index, 0); assert.equal(H.runtime(a).budgetGuard.watts, 360);
  });
  await check('Actual overload does not pretend an uncontrollable shared zone was stopped', async () => {
    const h = await setup(2, direct(2, { hvac2SharedPowerEnabled: true, hvac2SharedPowerWith: 1, hvacExtraGridBudgetW: 100, hvac2AllowPowerControl: false, hvac2AllowSetpointControl: false })), a = h.app;
    active(a, 0, 360); active(a, 1, 360); await cycle(h);
    assert.equal(H.runtime(a).budgetGuard.watts, 360); assert.equal(h.events.filter(e => e.kind === 'power').length, 0);
    assert.equal(C.budgetAlarm(a), true);
  });
  fs.writeFileSync('validation/hvac-budget-1.2.25.json', JSON.stringify({ version: '1.2.25', environment: 'Node host; real application/engine and Flow publication; mocked Homey transport, not hardware measurements', passed }, null, 2) + '\n');
  console.log(`HVAC budget 1.2.25: ${passed.length} scenario groups passed.`);
}
main().catch(e => { console.error('After:', passed.at(-1) || 'setup'); console.error(e.stack); process.exitCode = 1; }).finally(() => { Date.now = nativeNow; });
