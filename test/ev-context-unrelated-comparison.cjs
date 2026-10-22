'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const before = path.resolve(process.argv[2]);
const after = path.join(__dirname, '..');
const originalNow = Date.now, restore = installVirtualClearTimeout();
const start = Date.parse('2026-10-21T10:00:00Z');
async function replay(root, overrides) {
  const h = await setup(root, { evCount: 0, forcedMode: 'self_consumption', peakShaveEnabled: true,
    exportLimitEnabled: false, priorityEvaluationMinutes: 1, hvacCount: 0, boilerCount: 0, ...overrides }, start, 5000);
  const a = h.app;
  if (overrides.hvacCount || overrides.boilerCount) a.state.batterySoc = [100,100,100,100];
  a.state.pvProducingDate = a.getLocalDateKey(new Date(start));
  a.state.hvacMode = 'cool'; a.state.hvacSetpointC = 25;
  a.inputSeen.hvac.mode = true; a.inputSeen.hvac.setpoint = true;
  a.inputUpdatedAt.hvac.mode = start; a.inputUpdatedAt.hvac.setpoint = start;
  a.state.hvacRoomTemperatureC = 26; a.inputSeen.hvac.roomTemperature = true; a.inputUpdatedAt.hvac.roomTemperature = start;
  await h.start(); await h.flush();
  for (let second = 1; second <= 180; second++) {
    h.setNow(start + second * 1000);
    const pv = second < 40 ? 5000 : second < 60 ? 1400 : second < 130 ? 6000 : 300;
    const house = second < 90 ? 623 : 3200;
    await h.pv(pv); await h.grid(house - pv - a.state.lastTotalCommandW); await h.flush();
    if (second % 60 === 0) { a.runContextHeartbeat(); await a.runEvHeartbeat(); await h.drain(); await h.flush(); }
  }
  assert.deepEqual(h.errors, []);
  if (overrides.boilerCount) assert(h.flexible.some(x => x.id === 'boiler_power_updated' && x.tokens.on), 'boiler must actually heat in the comparison');
  if (overrides.hvacCount) assert(h.flexible.some(x => /^hvac/.test(x.id)), 'HVAC must actually publish in the comparison: '+JSON.stringify(a.latestHvacDecision));
  return { battery: h.traces, flexible: h.flexible, contexts: h.contexts,
    finalBatteryW: a.state.lastTotalCommandW, pvPercent: a.lastPublishedPvLimitPercent,
    hvac: a.hvacManagedPowerOn, boiler: a.boilerState.outputOn };
}
(async () => { try {
  const results = [];
  for (const [name, overrides] of Object.entries({
    battery: {}, pvExport: { exportLimitEnabled: true, minimumExportW: 1000, pvCurtailMinBatterySoc: 50 },
    hvac: { forcedMode: 'standby', hvacCount: 1, hvacEnabled: true, hvacMode: 'cool', hvacMinBatterySoc: 20, hvacStopBatterySoc: 10 },
    boiler: { forcedMode: 'standby', boilerCount: 1, boilerEnabled: true, boilerStartSoc: 20, boilerStopSoc: 10 },
    combined: { forcedMode: 'standby', exportLimitEnabled: true, minimumExportW: 1000, hvacCount: 1, hvacEnabled: true,
      boilerCount: 1, boilerEnabled: true, boilerStartSoc: 20, boilerStopSoc: 10 } })) {
    const old = await replay(before, overrides), current = await replay(after, overrides);
    assert.deepEqual(current, old, `${name}: non-EV outputs and context schedule must be byte-for-byte equal`);
    results.push({ name, identical: true, contexts: old.contexts.length, batteryPublications: old.battery.length, flexiblePublications: old.flexible.length });
  }
  console.log(JSON.stringify(results, null, 2));
} finally { Date.now = originalNow; restore(); } })().catch(e => { console.error(e); process.exitCode = 1; });
