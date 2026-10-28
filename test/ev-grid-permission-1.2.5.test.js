'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { fixture } = require('./ev-work-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const { localParts } = require('../lib/homey-energy');
const NativeDate = Date, nativeNow = Date.now;
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
const restore = installVirtualClearTimeout(), perAmp = Math.sqrt(3) * 400, rows = [];
const close = (a, b) => assert(Math.abs(a - b) < 1, `${a} != ${b}`);
const decision = (h, i = 0) => i ? h.app.getExtraEv(i).latestDecision : h.app.latestEvDecision;
function actual(h, i = 0) {
  const a = h.app, r = i ? a.getExtraEv(i) : null;
  if (!a.isEvOutputPermittedFor(i)) return 0;
  const mode = i ? r.lastPublishedChargeMode : a.lastPublishedEvChargeMode;
  if (h.type === 'mode') return mode === 'standard' ? 16 : mode === 'smart' ? 6 : 0;
  if (h.type === 'hybrid' && mode === 'stop') return 0;
  return Number(i ? r.lastPublishedCurrentA : a.lastPublishedEvCurrentA) || 0;
}
async function frame(h, { pv = 0, house = 700, battery = 0 } = {}) {
  h.setNow(h.now() + 1000); const a = h.app;
  const amps = Array.from({ length: h.evs }, (_, i) => actual(h, i));
  if (h.type !== 'mode') for (let i = 0; i < h.evs; i++) {
    await h.cards.get(`set_ev${i + 1}_status`).listener({ connected: 'yes', charge_current: amps[i] });
  }
  a.state.lastTotalCommandW = battery;
  await h.pv(pv); await h.grid(house + amps.reduce((sum, v) => sum + v * perAmp, 0) - pv - battery);
  a.runContextHeartbeat(); await a.runEvHeartbeat(); await h.flush(); assert.deepEqual(h.errors, []);
}
async function make(type, evs = 1, contract = 'tou') {
  const h = await fixture({ type, evs, connected: false, batteries: 0, batteryEnabled: false, chargeAllowed: false,
    extra: { peakShaveEnabled: true, peakLimitW: 17500, peakSoftMarginW: 100, evIdleHouseLoadW: 4000 } });
  h.type = type; h.evs = evs;
  const rates = h.app.getSettings().touRates.map(r => ({ ...r, evMaxGridImportW: 0,
    evEmergencyChargeAllowed: true, evPvHysteresisEnabled: true, evPvStopDelaySeconds: 0,
    evPvStopGridImportW: 100, evPvGridTopUpAllowed: false }));
  await h.setExternalSetting('touRates', rates);
  if (contract === 'fixed') {
    for (const [key, value] of Object.entries({ contractType: 'fixed', evFixedChargeWindowEnabled: false,
      evFixedMaxGridImportW: 0, evEmergencyFixedWindowEnabled: true, evEmergencyFixedOutsideWindowEnabled: true })) {
      await h.setExternalSetting(key, value);
    }
  }
  for (let n = 0; n < 90; n++) await frame(h);
  for (let i = 0; i < evs; i++) await h.cards.get(`set_ev${i + 1}_status`).listener({ connected: 'yes', charge_current: 0 });
  await h.flush(); return h;
}
async function policy(h, policyName, i = 0) {
  if (policyName === 'emergency') await h.cards.get(`set_ev${i + 1}_session_override`).listener({ mode: 'emergency' });
  else {
    const p = localParts(new Date(h.now() + 30 * 60000), h.app.getSettings().timezone);
    const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    await h.cards.get(`set_ev${i + 1}_energy_deadline`).listener({ energy: 20, time, guarantee: 'yes' });
  }
  await h.start(); await h.flush();
}
async function check(name, run) { const evidence = await run(); rows.push({ name, ...evidence }); console.log('PASS', name); }
(async () => { try {
  for (const type of ['mode', 'current', 'hybrid']) for (const name of ['emergency', 'guarantee']) {
    await check(`${type}: ${name} uses P1 room with 0 W tariff allowance and no PV`, async () => {
      const h = await make(type); await policy(h, name);
      for (let n = 0; n < 20; n++) await frame(h);
      assert(actual(h) > 0); assert(decision(h).intentionalGridImport); assert(decision(h).gridAllocatedW > 0);
      if (name === 'guarantee') assert(decision(h).guaranteeActive);
      let stops = 0;
      for (let n = 0; n < 180; n++) { await frame(h); if (!actual(h)) stops++; }
      assert.equal(stops, 0); assert(h.app.state.gridPowerW < 17400);
      const status = h.app.getEvGridImportControlStatus(); assert(status.activeTargetW > 10000);
      return { seconds: 180, stops, gridW: Math.round(h.app.state.gridPowerW),
        netAllowanceW: status.activeTargetW, pvBudgetW: decision(h).pvPoolBudgetW };
    });
    await check(`${type}: PV-only -> ${name}, then clouds, retains grid permission`, async () => {
      const h = await make(type);
      for (let n = 0; n < 25; n++) await frame(h, { pv: 5200 });
      assert(actual(h) > 0); await policy(h, name);
      for (let n = 0; n < 20; n++) await frame(h, { pv: 5200 });
      for (let n = 0; n < 120; n++) {
        await frame(h, { pv: n % 20 < 10 ? 0 : 3807 });
        assert(actual(h) > 0, `${name} stopped on a PV change: ${decision(h).reason}`);
      }
      assert(!h.app.evPvSession.active); assert(decision(h).intentionalGridImport);
    });
  }
  for (const name of ['emergency', 'guarantee']) await check(`Fixed contract ${name} is not constrained by the 0 W regular tariff cap`, async () => {
    const h = await make('mode', 1, 'fixed'); await policy(h, name);
    for (let n = 0; n < 30; n++) await frame(h);
    assert(actual(h) > 0); assert(decision(h).gridAllocatedW > 10000);
  });
  for (const type of ['mode', 'current', 'hybrid']) await check(`${type}: actual P1 overload still stops/reduces EV safely`, async () => {
    const h = await make(type); await policy(h, 'emergency');
    for (let n = 0; n < 20; n++) await frame(h);
    await frame(h, { house: 17000 });
    assert.equal(actual(h), 0); assert(decision(h).peakLimited);
  });
  await check('Reported example: P1 8,287 W + existing EV 4,416 W gives 13,529 W after the 100-W margin, without adding PV twice', async () => {
    const h = await make('current'), a = h.app;
    await h.setExternalSetting('evMaxCurrentA', 32); await h.setExternalSetting('evStandardCurrentA', 32);
    await policy(h, 'emergency');
    await h.cards.get('set_ev1_status').listener({ connected: 'yes', charge_current: 4416 / perAmp });
    await h.pv(3807); await h.grid(8287);
    const d = a.calculateEvPortfolioDecisions(a.latestResult, 0, 0, a.getSettings())[0];
    assert.equal(d.peakGuardAccounting.gridPowerW, 8287);
    assert.equal(d.peakGuardAccounting.currentEvPowerW, 4416);
    assert.equal(d.peakGuardAccounting.peakBudgetW, 13529);
    assert.equal(d.desiredCurrentA, 19); assert(d.allowed);
    return { peakGuardW: 17500, marginW: 100, p1W: 8287, pvW: 3807,
      currentEvW: 4416, peakBudgetW: 13529, allocatedA: 19 };
  });
  await check('All four Mode slots share Peak Guard once; guaranteed and Emergency coexist', async () => {
    const h = await make('mode', 4);
    for (let i = 0; i < 4; i++) await policy(h, i % 2 ? 'guarantee' : 'emergency', i);
    for (let n = 0; n < 120; n++) await frame(h);
    const total = Array.from({ length: 4 }, (_, i) => actual(h, i) * perAmp).reduce((s, v) => s + v, 0);
    assert(total > 0); assert(total + 700 <= 17400 + 1);
    return { totalEvW: Math.round(total), limitW: 17400 };
  });
  await check('Plain PV-only Smart still stops when solar disappears', async () => {
    const h = await make('mode'); for (let n = 0; n < 25; n++) await frame(h, { pv: 5200 });
    assert(actual(h) > 0); for (let n = 0; n < 10; n++) await frame(h);
    assert.equal(actual(h), 0);
  });
  fs.writeFileSync(path.join(__dirname, '../validation/ev-grid-permission-1.2.5.json'), JSON.stringify({
    simulatedHomey: true, physicalHardwareTested: false, passed: rows.length, results: rows }, null, 2) + '\n');
  console.log('Grid permission:', rows.length, 'groups passed');
} finally { restore(); global.Date = NativeDate; Date.now = nativeNow; } })().catch(e => { console.error(e); process.exitCode = 1; });
