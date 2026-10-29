'use strict';
// Usage: node test/parity-defaults-1.2.6.cjs /path/to/extracted/1.2.5/HomeFlux-EMS
const assert = require('node:assert/strict'), path = require('node:path');
if (!process.argv[2]) throw new Error('Pass the extracted uploaded 1.2.5 project root.');
const old = require(path.resolve(process.argv[2], 'lib/ems-engine'));
const next = require('../lib/ems-engine');
let seed = 126;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
for (let n = 0; n < 1500; n++) {
  const count = 1 + Math.floor(random() * 4);
  const settings = { ...old.DEFAULTS, batteryCount: count,
    contractType: n % 2 ? 'fixed' : 'dynamic_quarter', timezone: 'Europe/Brussels',
    controlProfile: ['exact', 'normal', 'calm'][n % 3], peakLimitW: 2000 + random() * 15000,
    gridZeroMinW: -random() * 600, gridZeroMaxW: random() * 200,
    dynamicPriceDataReady: n % 5 !== 0, forcedMode: ['auto','auto','solar_capture','standby','manual_charge'][n % 5] };
  const state = { gridPowerW: (random() - .3) * 16000, pvPowerW: random() * 9000,
    batterySoc: Array.from({ length: count }, () => random() * 100),
    lastTotalCommandW: (random() - .5) * 6000, forecastRemainingKwh: random() * 25,
    forecastDailyMaxKwh: random() * 40, forecastTomorrowKwh: random() * 40,
    nightPlanningActive: n % 3 === 0, planningForecastDay: n % 2 ? 'today' : 'tomorrow',
    chargeRestartState: { phase: n % 3 === 0 ? 'night' : 'day',
      planned: { target: 50, reached: n % 2 === 0 }, normal: { target: 40, reached: false } } };
  const at = new Date(Date.UTC(2026, 9, 29, Math.floor(random() * 24), Math.floor(random() * 60)));
  const a = old.evaluate(state, settings, at), b = next.evaluate(state, settings, at);
  delete b.nightChargeHold; // New diagnostic flag only; every existing result field must match.
  assert.deepEqual(b, a, 'Default-off parity case ' + n);
}
console.log('1500 default-off engine cases match uploaded 1.2.5 exactly.');
