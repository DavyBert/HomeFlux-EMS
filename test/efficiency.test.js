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

// A previous choice persists within two percentage points. Beyond it, a full
// battery-to-battery handover is spread over four publications while keeping
// the requested total exactly constant.
assert.deepEqual(distributeCommand(800, state([50, 51], [800, 0]), settings({ batteryCount: 2 })), [800, 0]);
let rotation = [800, 0];
for (const expected of [[600, 200], [400, 400], [200, 600], [0, 800]]) {
  rotation = distributeCommand(800, state([50, 52.1], rotation), settings({ batteryCount: 2 }));
  assert.deepEqual(rotation, expected);
  assert.equal(total(rotation), 800);
}

// The normal TOTAL command deadband must never enlarge an efficiency handover
// step. Even an intentionally huge deadband still produces the same quarter
// transfer because the total setpoint itself is unchanged.
assert.deepEqual(distributeCommand(800, state([50, 52.1], [800, 0]), settings({
  batteryCount: 2,
  commandDeadbandW: 1000,
})), [600, 200]);
let chargeRotation = [-800, 0];
for (const expected of [[-600, -200], [-400, -400], [-200, -600], [0, -800]]) {
  chargeRotation = distributeCommand(-800, state([50, 47.9], chargeRotation), settings({ batteryCount: 2 }));
  assert.deepEqual(chargeRotation, expected);
  assert.equal(total(chargeRotation), -800);
}
assert.deepEqual(distributeCommand(2000, state([60, 55, 50, 45]), settings()), [1000, 1000, 0, 0]);
assert.deepEqual(distributeCommand(-2000, state([60, 55, 50, 45]), settings()), [0, 0, -1000, -1000]);

// Total EMS power remains authoritative during a handover: a P1/Peak Guard
// change is applied immediately, and only the distribution between batteries
// is ramped.
assert.equal(total(distributeCommand(1200, state([50, 52.1], [800, 0]), settings({ batteryCount: 2 }))), 1200);
assert.equal(total(distributeCommand(500, state([50, 52.1], [800, 0]), settings({ batteryCount: 2 }))), 500);

// Safety eligibility always wins over smoothing. An old active battery that
// reaches the discharge floor is removed immediately.
assert.deepEqual(distributeCommand(800, state([10, 50], [800, 0]), settings({ batteryCount: 2 })), [0, 800]);

const transitionDiagnostics = {};
assert.deepEqual(distributeCommand(800, state([50, 52.1], [800, 0]), settings({ batteryCount: 2 }), { diagnostics: transitionDiagnostics }), [600, 200]);
assert.equal(transitionDiagnostics.transitionPending, true);
assert.equal(transitionDiagnostics.transitionStepW, 200);
assert.deepEqual(transitionDiagnostics.idealTargetsW, [0, 800]);

// At the 1-to-2 threshold, a small demand fluctuation keeps the current selection.
assert.equal(active(distributeCommand(1520, state([50, 50], [1400, 0]), settings({ batteryCount: 2 }))), 1);
assert.equal(active(distributeCommand(1480, state([50, 50], [750, 750]), settings({ batteryCount: 2 }))), 2);
assert.equal(active(distributeCommand(1700, state([50, 50], [1400, 0]), settings({ batteryCount: 2 }))), 2);
const reducingActiveCount = distributeCommand(1300, state([50, 50], [750, 750]), settings({ batteryCount: 2 }));
assert.equal(active(reducingActiveCount), 2);
assert.equal(active(distributeCommand(1300, state([50, 50], reducingActiveCount), settings({ batteryCount: 2 }))), 1);

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
app.getSettings = () => settings({ batteryCount: 2, commandDeadbandW: 1000 });
app.getBatteryCount = () => 2;
app.splitModeChangeNeeded = () => false;
app.lastEmittedCommands = [800, 0];
app.lastEmittedMode = 'solar_capture';
app.lastEmittedOverride = '';
app.state = { gridPowerW: 0 };
assert.equal(app.commandChangedEnough({ candidateCommands: [0, 800], baseMode: 'solar_capture', override: null }), true);

// Intermediate handover steps also bypass the TOTAL deadband; otherwise the
// first 200 W step could publish and the remaining transition would stall.
app.lastEmittedCommands = [600, 200];
assert.equal(app.commandChangedEnough({ candidateCommands: [400, 400], baseMode: 'solar_capture', override: null }), true);

// A genuine small TOTAL setpoint change still obeys the configured total
// deadband; the special bypass is only for same-total redistribution.
assert.equal(app.commandChangedEnough({ candidateCommands: [405, 400], candidateTotalCommandW: 805, baseMode: 'solar_capture', override: null }), false);

// Final output boundary: even if a future engine path were to request the full
// [0, 800] rotation at once, the physical Flow output is still forced through
// four handover steps based on the last actually emitted commands.
const outputResult = {
  efficiencyOptimization: {
    enabled: true,
    availableSoc: [{ battery: 1, soc: 50 }, { battery: 2, soc: 52.1 }],
  },
};
app.lastEmittedCommands = [800, 0];
let outputRotation = app.limitEfficiencyHandoverAtOutput(outputResult, [0, 800], app.getSettings());
assert.deepEqual(outputRotation.commands, [600, 200]);
assert.equal(outputRotation.pending, true);
app.lastEmittedCommands = outputRotation.commands;
outputRotation = app.limitEfficiencyHandoverAtOutput(outputResult, [0, 800], app.getSettings());
assert.deepEqual(outputRotation.commands, [400, 400]);
app.lastEmittedCommands = outputRotation.commands;
outputRotation = app.limitEfficiencyHandoverAtOutput(outputResult, [0, 800], app.getSettings());
assert.deepEqual(outputRotation.commands, [200, 600]);
app.lastEmittedCommands = outputRotation.commands;
outputRotation = app.limitEfficiencyHandoverAtOutput(outputResult, [0, 800], app.getSettings());
assert.deepEqual(outputRotation.commands, [0, 800]);
assert.equal(outputRotation.pending, false);

// P1/Peak Guard total-power changes stay immediate while only the battery mix
// is ramped: 800 W -> 1200 W total is applied in the first output step.
app.lastEmittedCommands = [800, 0];
const raisedTotal = app.limitEfficiencyHandoverAtOutput(outputResult, [0, 1200], app.getSettings());
assert.equal(raisedTotal.commands.reduce((sum, value) => sum + value, 0), 1200);
assert.deepEqual(raisedTotal.commands, [900, 300]);

// If the outgoing battery is no longer eligible, its stop remains immediate.
app.lastEmittedCommands = [800, 0];
const safetyResult = {
  efficiencyOptimization: {
    enabled: true,
    availableSoc: [{ battery: 2, soc: 50 }],
  },
};
assert.deepEqual(app.limitEfficiencyHandoverAtOutput(safetyResult, [0, 800], app.getSettings()).commands, [0, 800]);

console.log('Multi-battery efficiency tests passed.');
