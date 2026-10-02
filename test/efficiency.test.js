'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { distributeCommand, evaluate } = require('../lib/ems-engine');

const settings = (extra = {}) => ({
  batteryCount: 4, minSoc: 10, safetySoc: 15, maxSoc: 90,
  maxChargePerBatteryW: 2400, maxDischargePerBatteryW: 2400,
  maxTotalChargeW: 8000, maxTotalDischargeW: 8000,
  balanceEnabled: true, balanceDeadbandPct: 2, balanceStrength: 0.2,
  optimizeMultiBatteryEfficiency: true, optimalBatteryPowerW: 1000,
  peakShaveEnabled: false, forcedMode: 'solar_capture',
  contractType: 'fixed', timezone: 'Europe/Brussels',
  ...extra,
});
const state = (soc = [50, 50, 50, 50], previous = []) => ({
  batterySoc: soc, lastBatteryCommands: previous,
  gridPowerW: 0, pvPowerW: 0, forecastRemainingKwh: 10,
  lastTotalCommandW: 0,
});
const active = commands => commands.filter(value => value !== 0).length;
const total = commands => commands.reduce((sum, value) => sum + value, 0);

for (const [watts, count] of [[300, 1], [800, 1], [1000, 1], [1500, 2], [2000, 2], [3000, 3], [3500, 4], [4000, 4]]) {
  for (const sign of [1, -1]) {
    const commands = distributeCommand(sign * watts, state(), settings());
    assert.equal(total(commands), sign * watts, `${sign * watts} W total`);
    assert.equal(active(commands), count, `${sign * watts} W active count`);
  }
}

// Old allocations are preserved with the feature off or fewer than two batteries.
for (const batteryCount of [0, 1, 4]) {
  const soc = Array(batteryCount).fill(50);
  const legacy = distributeCommand(800, state(soc), settings({ batteryCount, optimizeMultiBatteryEfficiency: false }));
  const disabled = distributeCommand(800, state(soc), settings({ batteryCount, optimizeMultiBatteryEfficiency: true }));
  if (batteryCount < 2) assert.deepEqual(disabled, legacy);
  else assert.deepEqual(legacy, [200, 200, 200, 200]);
}

// A previous choice persists within two percentage points and rotates beyond it.
assert.deepEqual(distributeCommand(800, state([50, 51], [800, 0]), settings({ batteryCount: 2 })), [800, 0]);
assert.deepEqual(distributeCommand(800, state([50, 52.1], [800, 0]), settings({ batteryCount: 2 })), [0, 800]);
assert.deepEqual(distributeCommand(-800, state([50, 47.9], [-800, 0]), settings({ batteryCount: 2 })), [0, -800]);
assert.deepEqual(distributeCommand(2000, state([60, 55, 50, 45]), settings()), [1000, 1000, 0, 0]);
assert.deepEqual(distributeCommand(-2000, state([60, 55, 50, 45]), settings()), [0, 0, -1000, -1000]);

// At the 1-to-2 threshold, a small demand fluctuation keeps the current selection.
assert.equal(active(distributeCommand(1520, state([50, 50], [1400, 0]), settings({ batteryCount: 2 }))), 1);
assert.equal(active(distributeCommand(1480, state([50, 50], [750, 750]), settings({ batteryCount: 2 }))), 2);
assert.equal(active(distributeCommand(1700, state([50, 50], [1400, 0]), settings({ batteryCount: 2 }))), 2);
assert.equal(active(distributeCommand(1300, state([50, 50], [750, 750]), settings({ batteryCount: 2 }))), 1);

// SoC exclusion, missing feedback, individual maxima and full feasible power.
assert.deepEqual(distributeCommand(800, state([10, 50], [0, 0]), settings({ batteryCount: 2 })), [0, 800]);
assert.deepEqual(distributeCommand(-800, state([90, 50], [0, 0]), settings({ batteryCount: 2 })), [0, -800]);
assert.deepEqual(distributeCommand(800, state([null, 50], [0, 0]), settings({ batteryCount: 2 })), [0, 800]);
const limits = settings({ batteryCount: 2, individualBatteryPowerLimitsEnabled: true,
  battery1MaxDischargeW: 500, battery2MaxDischargeW: 900,
  battery1MaxChargeW: 500, battery2MaxChargeW: 900 });
assert.deepEqual(distributeCommand(1200, state([55, 50]), limits), [500, 700]);
assert.deepEqual(distributeCommand(-1200, state([45, 50]), limits), [-500, -700]);
assert.equal(total(distributeCommand(3500, state(), settings())), 3500);
assert.equal(total(distributeCommand(1373, state(), settings())), 1373);

// Peak Guard keeps authority over the ordinary discharge reserve.
const peakSettings = settings({ batteryCount: 2, safetySoc: 30,
  peakShaveEnabled: true, peakLimitW: 2500, peakSoftMarginW: 100 });
const peakState = { ...state([20, 50]), gridPowerW: 3500 };
const peak = evaluate(peakState, peakSettings, new Date('2026-08-22T12:00:00+02:00'));
assert.equal(peak.predictedGridW, 2400);
assert.equal(total(peak.commands), peak.totalCommandW);
assert.ok(peak.commands[0] >= 0 && peak.commands[1] >= 0);
assert.equal(peak.efficiencyOptimization.targetsW.length, 2);

// The ordinary planner output still determines the total command.
for (const demand of [-300, -2500]) {
  const input = { ...state(), gridPowerW: demand };
  const optimized = evaluate(input, settings(), new Date('2026-08-22T12:00:00+02:00'));
  const baseline = evaluate(input, settings({ optimizeMultiBatteryEfficiency: false }), new Date('2026-08-22T12:00:00+02:00'));
  assert.ok(Math.abs(optimized.totalCommandW - baseline.totalCommandW) <= 4);
  const requested = optimized.efficiencyOptimization.requestedTotalW;
  assert.equal(optimized.totalCommandW, Math.sign(requested) * Math.round(Math.abs(requested)));
}

// Same-total SoC rotation must pass duplicate suppression through existing timers.
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class App {} };
  if (request === 'homey-api') return { HomeyAPI: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const App = require('../app');
Module._load = originalLoad;
const app = Object.create(App.prototype);
app.getSettings = () => settings({ batteryCount: 2, commandDeadbandW: 25 });
app.getBatteryCount = () => 2;
app.splitModeChangeNeeded = () => false;
app.lastEmittedCommands = [800, 0];
app.lastEmittedMode = 'solar_capture';
app.lastEmittedOverride = '';
app.state = { gridPowerW: 0 };
assert.equal(app.commandChangedEnough({ candidateCommands: [0, 800], baseMode: 'solar_capture', override: null }), true);

console.log('Multi-battery efficiency tests passed.');
