'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./ev-work-harness');
const { boot } = require('./startup-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const { emptyDay, emptyInventory } = require('../lib/savings');
const { evPowerPerAmp } = require('../lib/flexible-loads');

const NativeDate = Date, nativeNow = Date.now;
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
const restore = installVirtualClearTimeout(), rows = [];
const close = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const metric = h => h.app.savings.today.ev.total;
async function check(name, run) { const result = await run(); rows.push({ name, ...result }); console.log('PASS', name); }
function reset(h) {
  const a = h.app;
  a.savings.today = emptyDay(a.getSavingsDateKey()); a.savings.history = {};
  a.savings.inventory = emptyInventory(); a.savings.total = 0; a.savings.lastSampleAt = h.now();
}
async function frame(h, { amps = 8, flow = null, pv = 0, battery = 0 } = {}) {
  h.setNow(h.now() + 1000);
  const a = h.app, powers = Array.isArray(amps) ? amps : Array(h.evs).fill(amps);
  if (flow !== null) for (let i = 0; i < h.evs; i++) {
    await h.cards.get(`set_ev${i + 1}_status`).listener({ connected: 'yes', charge_current: flow });
  }
  a.state.lastTotalCommandW = battery;
  await h.pv(pv);
  await h.grid(4000 + powers.reduce((sum, value, i) => sum + value * evPowerPerAmp(a.getEvElectricalSettingsFor(i)), 0) - pv - battery);
  a.runContextHeartbeat(); await a.runEvHeartbeat(); await h.flush();
  assert.deepEqual(h.errors, []);
}
async function make({ evs = 1, scope = 'individual', pv = 0, amps = 8, type = 'mode' } = {}) {
  const h = await fixture({ type, evs, batteries: 0, batteryEnabled: false, chargeAllowed: true,
    extra: { peakShaveEnabled: true, peakLimitW: 100000, peakSoftMarginW: 100, evIdleHouseLoadW: 4000 } });
  h.evs = evs;
  for (let i = 0; i < evs; i++) {
    await h.setExternalSetting(h.app.getEvSettingKey(i, 'EnergyFeedbackScope'), scope);
    h.app.setEvSessionOverrideFor(i, 'emergency', 'flow');
  }
  h.app.evSessionDetection.portfolioBaselineW = 4000; h.app.evBatteryHouseReferenceW = 4000;
  await h.start(); await h.flush();
  for (let s = 0; s < 12; s++) await frame(h, { amps, pv, flow: type === 'mode' ? null : amps });
  reset(h); return h;
}
async function steady(h, seconds, options = {}) { for (let t = 0; t < seconds; t++) await frame(h, options); }
function csv(h) {
  const rows = h.app.getSavingsCsv().split('\r\n').map(x => x.split(','));
  return Object.fromEntries(rows[0].map((key, i) => [key, rows.at(-1)[i]]));
}
(async () => { try {
  for (const feedback of [null, 0, 30]) await check(`Mode uses P1 with ${feedback === null ? 'missing' : feedback + ' A'} Flow feedback`, async () => {
    const h = await make(), w = 8 * evPowerPerAmp(h.app.getEvElectricalSettingsFor(0));
    await steady(h, 600, { flow: feedback });
    close(metric(h).kwh, w / 6000); close(metric(h).estimatedKwh, metric(h).kwh);
    close(metric(h).missingSeconds, 0); close(metric(h).gridKwh, metric(h).kwh);
    assert.equal(h.app.getEvSessionDetectionRuntime(0).state, 'charging');
    close(Number(csv(h).ev_kwh), metric(h).kwh);
    return { seconds: 600, observedW: w, kwh: metric(h).kwh };
  });
  await check('Positive Flow current cannot fabricate Mode energy when P1 confirms zero', async () => {
    const h = await make({ amps: 0 }); await steady(h, 120, { amps: 0, flow: 16 });
    close(metric(h).kwh, 0); close(metric(h).missingSeconds, 0);
  });
  for (const scope of ['unavailable', 'shared']) await check(`Mode reuses the divided P1 estimate with Flow scope ${scope}`, async () => {
    const h = await make({ evs: 2, scope, amps: [6, 8] });
    await steady(h, 120, { amps: [6, 8] });
    const m = metric(h), ev = h.app.savings.today.ev, w = 14 * evPowerPerAmp(h.app.getEvElectricalSettingsFor(0));
    close(m.kwh, w / 30000); close(ev.byId['1'].kwh + ev.byId['2'].kwh, m.kwh);
    close(m.pvKwh + m.gridKwh + m.batteryKwh + m.unknownKwh, m.kwh);
    assert.equal(ev.sharedKwh, 0); return { totalKwh: m.kwh, allocatedOnce: true };
  });
  for (const [pv, battery] of [[9000, 0], [5000, -1000], [0, 6000], [12000, 0]]) {
    await check(`Site source allocation: PV ${pv} W, signed battery ${battery} W`, async () => {
      const h = await make({ pv }); await frame(h, { pv, battery }); reset(h);
      await steady(h, 120, { pv, battery }); const a = h.app, m = metric(h);
      close(m.kwh, 8 * evPowerPerAmp(a.getEvElectricalSettingsFor(0)) / 30000);
      close(m.pvKwh + m.gridKwh + m.batteryKwh + m.unknownKwh, m.kwh);
      assert(m.pvKwh <= a.savings.today.directPvKwh + 1e-8);
      if (pv === 0) { close(m.pvKwh, 0); assert(m.unknownKwh > 0); }
      return { kwh: m.kwh, pvKwh: m.pvKwh, gridKwh: m.gridKwh, unknownKwh: m.unknownKwh };
    });
  }
  await check('Expired P1/PV observation integrates its valid overlap only; no stale backfill', async () => {
    const h = await make(), a = h.app, reading = a.evSessionDetection.modePowerSnapshot;
    const expiry = reading.validUntil, start = h.now(), w = reading.watts[0];
    for (let i = 0; i < 180; i++) { h.setNow(h.now() + 1000); a.recordSavingsSample(h.now()); }
    close(metric(h).kwh, w * Math.max(0, expiry - start) / 3600000000);
    close(metric(h).missingSeconds, 180 - (expiry - start) / 1000);
    const before = metric(h).kwh; await frame(h); close(metric(h).kwh, before);
    await frame(h); assert(metric(h).kwh > before);
  });
  await check('Unknown competing Current EV cannot turn a zero-filled cache into valid Mode coverage', async () => {
    const h = await make({ evs: 2 }); await h.setExternalSetting('ev2ControlType', 'current');
    h.setNow(h.now() + 61000); await frame(h, { amps: [8, 8] }); reset(h);
    await steady(h, 10, { amps: [8, 8] });
    close(metric(h).kwh, 0); close(h.app.savings.today.ev.byId['1'].missingSeconds, 10);
    assert.equal(h.app.evSessionDetection.modePowerSnapshot.usable, false);
  });
  await check('Mixed Mode/Current source coverage expires with the competing Flow measurement', async () => {
    const h = await make({ evs: 2 }), a = h.app;
    await h.setExternalSetting('ev2ControlType', 'current');
    await h.cards.get('set_ev2_status').listener({ connected: 'yes', charge_current: 8 });
    const flowAt = h.now(); await frame(h, { amps: [8, 8] }); reset(h);
    const reading = a.evSessionDetection.modePowerSnapshot;
    assert(reading.usable); assert.equal(reading.recordingValidUntil, flowAt + 60000);
    const start = h.now(), w = reading.watts[0];
    h.setNow(h.now() + 90000); a.recordSavingsSample(h.now());
    close(a.savings.today.ev.byId['1'].kwh, w * (flowAt + 60000 - start) / 3600000000);
    close(a.savings.today.ev.byId['1'].missingSeconds, 31);
  });
  await check('No house baseline means unknown, not nominal charger energy', async () => {
    const h = await make(); h.app.evSessionDetection.portfolioBaselineW = null;
    await frame(h); reset(h); await steady(h, 10);
    close(metric(h).kwh, 0); close(metric(h).missingSeconds, 10);
  });
  await check('Midnight splits the same observed interval; repeated widget/CSV reads add nothing', async () => {
    const h = await make(), a = h.app, end = Date.parse('2026-10-27T22:59:30Z');
    h.setNow(end); await frame(h); reset(h); await steady(h, 60);
    const prior = a.savings.history['2026-10-27'].ev.total.kwh;
    close(prior + metric(h).kwh, 8 * evPowerPerAmp(a.getEvElectricalSettingsFor(0)) / 60000);
    const before = JSON.stringify(a.savings.today);
    for (let i = 0; i < 20; i++) { a.getEvDashboard(); a.getSavingsCsv(); a.recordSavingsSample(h.now()); }
    assert.equal(JSON.stringify(a.savings.today), before);
  });
  await check('Confirmed disconnect records zero; reboot preserves totals without resurrecting observations', async () => {
    const h = await make(); await steady(h, 60); const before = metric(h).kwh;
    await h.cards.get('set_ev1_status').listener({ connected: 'no', charge_current: 0 }); await h.flush();
    await steady(h, 60, { amps: 0 }); close(metric(h).kwh, before);
    h.app.persistSavingsState(h.now(), true); h.setNow(h.now() + 120000);
    const next = await boot(new Map(h.store)); close(next.app.savings.today.ev.total.kwh, before);
    assert(!next.app.evSessionDetection.modePowerSnapshot);
    close(next.app.getEvSavingsReadings(h.now(), h.now() + 1000)[0].powerW, 0);
  });
  fs.writeFileSync(path.join(__dirname, '../validation/ev-mode-recording-1.2.5.json'), JSON.stringify({
    simulatedHomey: true, physicalHardwareTested: false, passed: rows.length, results: rows }, null, 2) + '\n');
  console.log('Mode recording:', rows.length, 'groups passed');
} finally { restore(); global.Date = NativeDate; Date.now = nativeNow; } })().catch(e => { console.error(e); process.exitCode = 1; });
