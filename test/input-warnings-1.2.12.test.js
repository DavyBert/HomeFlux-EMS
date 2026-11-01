'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { collect } = require('../lib/input-warnings');
const T = Date.parse('2026-11-01T12:00:00Z'), M = 60000;
function fixture() {
  const settings = { batteryCount: 2, forcedMode: 'auto', commandIntervalSeconds: 7,
    peakShaveEnabled: true, timezone: 'UTC' };
  const app = { appStartedAt: T - 120 * M, state: { gridPowerW: 600, pvPowerW: 0,
    batterySoc: [50, 50], targetSocOverride: 80, forecastDailyMaxDate: '2026-11-01' },
    inputSeen: { grid: true, pv: true, batterySoc: [true, true], forecast: true, forecastTomorrow: true,
      ev: {}, hvac: {} }, inputUpdatedAt: { grid: T, pv: T, batterySoc: [T, T], forecast: T, forecastTomorrow: T, ev: {}, hvac: {} },
    extraEvInstances: [], extraHvacInstances: [] };
  const status = { controlEnabled: true, evs: [], hvacs: [], tariff: { className: 'cheap' }, forecastPlanningDay: 'today' };
  return { app, settings, status, warnings: (now = T) => collect(app, status, settings, now) };
}
let groups = 0;
function check(name, fn) { fn(); groups++; }
check('unchanged PV zero and 500 W receipts remain fresh', () => {
  for (const value of [0, 500]) {
    const h = fixture(); h.app.state.pvPowerW = value;
    for (let i = 0; i <= 6 * M; i += 15000) {
      h.app.inputUpdatedAt.pv = T + i; h.app.inputUpdatedAt.grid = T + i;
      assert.equal(h.warnings(T + i).length, 0);
    }
  }
});
check('PV stops and resumes unchanged; not labelled invalid', () => {
  const h = fixture(); assert(!h.warnings(T + 5 * M).some(w => w.id === 'pv'));
  let warning = h.warnings(T + 6 * M).find(w => w.id === 'pv');
  assert.equal(warning.ageMinutes, 6); assert.equal(warning.category, 'reliability');
  h.app.inputUpdatedAt.pv = T + 6 * M;
  assert(!h.warnings(T + 6 * M).some(w => w.id === 'pv'));
});
check('three-minute SoC receipts and per-battery ten-minute reliability', () => {
  const h = fixture();
  for (let i = 0; i <= 30; i += 3) {
    h.app.inputUpdatedAt.batterySoc = [T + i * M, T + i * M];
    assert(!h.warnings(T + (i + 2) * M).some(w => w.id.includes(':soc')));
  }
  h.app.inputUpdatedAt.batterySoc = [T + 11 * M, T];
  const warnings = h.warnings(T + 11 * M).filter(w => w.id.includes(':soc'));
  assert.deepEqual(warnings.map(w => w.id), ['battery2:soc']);
  assert.equal(warnings[0].ageMinutes, 11); assert.equal(warnings[0].category, 'reliability');
});
check('startup grace and missing inputs', () => {
  const h = fixture(); h.app.appStartedAt = T;
  h.app.inputSeen = {}; h.app.inputUpdatedAt = {};
  assert.equal(h.warnings(T).length, 0); assert.equal(h.warnings(T + 30000).length, 0);
  assert(!h.warnings(T + 4 * M).some(w => w.id === 'pv'));
  assert(h.warnings(T + 6 * M).some(w => w.key === 'pvMissing'));
  assert(!h.warnings(T + 9 * M).some(w => w.id.startsWith('battery')));
  assert(h.warnings(T + 11 * M).some(w => w.key === 'batterySocMissing'));
});
check('no diagnostics for unused functions or ordinary PV in standby', () => {
  const h = fixture(); h.status.controlEnabled = false;
  assert.deepEqual(h.warnings(T + 1000 * M), []);
  h.status.controlEnabled = true; h.settings.forcedMode = 'standby';
  assert(!h.warnings(T + 6 * M).some(w => w.id === 'pv'));
});
check('EV freshness uses its configured horizon; mode charging ignores current input', () => {
  const h = fixture(); h.status.controlEnabled = false;
  const ev = { instance: 1, enabled: true, connected: true, socEnabled: true, mode: 'smart',
    controlType: 'current', outputCurrentA: 6 };
  h.status.evs = [ev]; h.settings.evSocFreshnessMinutes = 15;
  h.app.inputSeen.ev = { soc: true, chargeCurrent: true };
  h.app.inputUpdatedAt.ev = { soc: T, chargeCurrent: T };
  assert(!h.warnings(T + 14 * M).some(w => w.id === 'ev1:soc'));
  assert(h.warnings(T + 16 * M).some(w => w.id === 'ev1:soc'));
  assert(h.warnings(T + 61000).some(w => w.id === 'ev1:current'));
  ev.controlType = 'mode'; assert(!h.warnings(T + 16 * M).some(w => w.id === 'ev1:current'));
  ev.socEnabled = false; assert(!h.warnings(T + 16 * M).some(w => w.id === 'ev1:soc'));
  ev.socEnabled = true; ev.mode = 'emergency'; assert(!h.warnings(T + 16 * M).some(w => w.id === 'ev1:soc'));
  ev.connected = false; ev.outputCurrentA = 0; assert.deepEqual(h.warnings(T + 16 * M), []);
  ev.connected = true; ev.mode = 'smart'; ev.session = { socTargetReached: true };
  assert.deepEqual(h.warnings(T + 16 * M), [], 'completed idle EV no longer needs active input diagnostics');
});
check('extra EV identity, session grace and no stale-to-fresh command inference', () => {
  const h = fixture(); h.status.controlEnabled = false;
  h.status.evs = [{ instance: 2, name: 'Auto 2', enabled: true, connected: true, socEnabled: true,
    mode: 'soc_target', controlType: 'hybrid', outputAllowed: true, session: { connectedAt: T } }];
  h.settings.ev2SocFreshnessMinutes = 10;
  h.app.extraEvInstances = [{ seen: {}, updatedAt: {} }];
  assert(!h.warnings(T + 30000).some(w => w.id.startsWith('ev')));
  assert(h.warnings(T + 11 * M).some(w => w.id === 'ev2:soc' && w.params.device === 'Auto 2'));
  h.app.extraEvInstances[0] = { seen: { soc: true, chargeCurrent: true }, updatedAt: { soc: T + 11 * M, chargeCurrent: T + 11 * M } };
  assert(!h.warnings(T + 11 * M).some(w => w.id.startsWith('ev')));
});
check('HVAC COP outdoor input and unused room/slots', () => {
  const h = fixture(); h.status.controlEnabled = false;
  Object.assign(h.settings, { hvacPermanentEnabled: true, hvacTariffEnabled: true,
    hvacAllowSetpointControl: true, hvacDirection: 'heat', hvacDirectionTemperature: { tariffCop: { cheap: { outsideBelowC: 6, targetC: 40 } } } });
  h.status.hvacs = [{ instance: 1, name: 'Warm water', enabled: true, automaticControlEnabled: true, copOutdoorDependent: true }];
  h.app.inputSeen.hvac = { outdoorTemperature: true }; h.app.inputUpdatedAt.hvac = { outdoorTemperature: T };
  assert(!h.warnings(T + 59 * M).some(w => w.id === 'hvac:outdoor'));
  let warnings = h.warnings(T + 61 * M);
  assert(warnings.some(w => w.key === 'outdoorCopOld')); assert(!warnings.some(w => w.id.includes(':room')));
  assert(!warnings.some(w => w.id === 'pv' || w.id.startsWith('battery')), 'fixed tariff-only water heating does not consume PV or battery SoC');
  h.status.hvacs[0].enabled = false; assert.deepEqual(h.warnings(T + 61 * M), []);
});
check('room updates and duplicate global outdoor warnings', () => {
  const h = fixture(); h.status.controlEnabled = false;
  h.status.hvacs = [1, 2].map(instance => ({ instance, name: 'HVAC ' + instance, enabled: true, automaticControlEnabled: true }));
  for (const stem of ['hvac', 'hvac2']) Object.assign(h.settings, { [stem + 'AllowSetpointControl']: true,
    [stem + 'Direction']: 'auto', [stem + 'DirectionTemperature']: { source: 'outdoor' } });
  h.app.inputSeen.hvac = { roomTemperature: true, mode: true, setpoint: true, outdoorTemperature: true };
  h.app.inputUpdatedAt.hvac = { roomTemperature: T, outdoorTemperature: T };
  h.app.extraHvacInstances = [{ seen: { roomTemperature: true, mode: true, setpoint: true }, updatedAt: { roomTemperature: T } }];
  const warnings = h.warnings(T + 61 * M);
  assert.equal(warnings.filter(w => w.id === 'hvac:outdoor').length, 1);
  assert.equal(warnings.filter(w => w.id.endsWith(':room')).length, 2);
});
check('only relevant forecast, 90-minute diagnostic, frozen median', () => {
  const h = fixture(); h.app.state.targetSocOverride = null;
  assert(!h.warnings(T + 89 * M).some(w => w.id === 'forecast'));
  assert(h.warnings(T + 91 * M).some(w => w.id === 'forecast'));
  h.status.forecastPlanningDay = 'tomorrow';
  assert.deepEqual(h.warnings(T + 91 * M).filter(w => w.id.startsWith('forecast')).map(w => w.id), ['forecastTomorrow']);
  h.settings.nightForecastHoldEnabled = true; h.app.state.nightPlanningActive = true;
  h.app.nightForecastMedian = { hold: { frozen: true, value: 5 } };
  assert(!h.warnings(T + 91 * M).some(w => w.id.startsWith('forecast')));
});
check('new calendar forecast gets a fresh request grace', () => {
  const h = fixture(); h.app.state.targetSocOverride = null; h.app.inputSeen.forecast = false; h.app.inputUpdatedAt.forecast = 0;
  h.app.appStartedAt = T - 24 * 60 * M;
  const midnight = Date.parse('2026-11-01T00:00:00Z');
  assert(!h.warnings(midnight + 30 * M).some(w => w.id === 'forecast'));
  assert(h.warnings(midnight + 91 * M).some(w => w.id === 'forecast'));
});
check('prices follow selected-source readiness, not curve age', () => {
  const h = fixture(); h.status.priceData = { required: true, ready: true, fresh: true, lastUpdatedAt: T - 24 * 60 * M };
  assert(!h.warnings().some(w => w.id === 'prices'));
  h.status.priceData.ready = false; assert(h.warnings().some(w => w.id === 'prices'));
  h.status.priceData.required = false; assert(!h.warnings().some(w => w.id === 'prices'));
  h.status.priceData.required = true; h.settings.forcedMode = 'manual_charge';
  assert(!h.warnings().some(w => w.id === 'prices'), 'manual battery charging does not need price selection');
});
check('read-only collection, stable sorting, no duplicates', () => {
  const h = fixture(); const before = JSON.stringify(h);
  h.status.criticalAlert = { id: 'input', detail: 'netvermogen verouderd' };
  const snapshot = JSON.stringify([h.app, h.status, h.settings]);
  const warnings = h.warnings(T + 120 * M);
  assert.equal(warnings[0].id, 'grid'); assert.equal(new Set(warnings.map(w => w.id)).size, warnings.length);
  assert.equal(JSON.stringify([h.app, h.status, h.settings]), snapshot); assert(before);
});
fs.mkdirSync(require('node:path').join(__dirname, '../validation'), { recursive: true });
fs.writeFileSync(require('node:path').join(__dirname, '../validation/input-warnings-1.2.12.json'), JSON.stringify({ passed: true, groups }, null, 2) + '\n');
console.log(`PASS input warnings: ${groups} targeted groups`);
