'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const { DEFAULTS, distributeCommand, computeAverageSoc, computeEffectiveCapacityKwh, configuredBatteryCapacityKwh, evaluate } = require('../lib/ems-engine');
const { evPowerPerAmp, calculateEvDecision } = require('../lib/flexible-loads');
const { calculateScenario } = require('../settings/ev-headroom');
const load = Module._load;
Module._load = function(request, parent, main) {
  if (request === 'homey') return { App: class {} };
  if (request === 'homey-api') return { HomeyAPI: {} };
  return load.call(this, request, parent, main);
};
const App = require('../app');
Module._load = load;
const near = (a, b, tolerance = 1e-8) => assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);

// Existing installations retain their current conversion; invalid voltage falls back safely.
for (const voltage of [undefined, null, '', 0, -240, NaN, Infinity, 601]) {
  assert.equal(evPowerPerAmp({ evPhases: 3, evVoltage: voltage }), 690);
}
for (const voltage of [100,110,115,120,127,200,208,220,230,240,254,277,347,380,400,415,440,460,480,600]) {
  for (const phases of [1, 3]) for (const reference of ['phase', 'line']) {
    const settings = { ...DEFAULTS, evEnabled: true, evMode: 'emergency', evPhases: phases, evVoltage: voltage, evVoltageReference: reference, evMaxCurrentA: 32, peakLimitW: 5000, peakSoftMarginW: 100 };
    const factor = voltage * (phases === 1 ? 1 : reference === 'line' ? Math.sqrt(3) : 3);
    near(evPowerPerAmp(settings), factor);
    // Inverse conversion must never request power above the 3900 W available budget.
    const preview = calculateScenario({ phases, voltage, voltageReference: reference, minCurrentA: 6, maxCurrentA: 32 }, 3900);
    const decision = calculateEvDecision({ settings, connected: true, soc: 20, gridPowerW: 1000, actualCurrentA: 0, now: new Date('2026-09-22T12:00:00Z') });
    assert.equal(decision.desiredPowerW, Math.round(decision.desiredCurrentA * factor));
    assert(decision.desiredPowerW <= 3900 + 1e-8);
    assert.equal(decision.desiredCurrentA, preview.usableMaxA);
  }
}
assert.equal(evPowerPerAmp({ evPhases: 1, evVoltage: 240 }) * 16, 3840);
near(evPowerPerAmp({ evPhases: 3, evVoltage: 400, evVoltageReference: 'line' }) * 16, Math.sqrt(3) * 400 * 16);
assert.equal(calculateScenario({ phases: 1, voltage: 120, controlType: 'mode', modeSmartCurrentA: 6, modeStandardCurrentA: 16 }, 2000).highestMode, 'standard');
assert.equal(calculateScenario({ phases: 1, voltage: 240, controlType: 'mode', modeSmartCurrentA: 6, modeStandardCurrentA: 16 }, 2000).highestMode, 'smart');

// Capacity weighting works even with Battery Balance disabled; percentage rates match.
const settings = { ...DEFAULTS, batteryCount: 2, totalCapacityKwh: 15, individualBatteryPowerLimitsEnabled: true, battery1CapacityKwh: 5, battery2CapacityKwh: 10, battery1MaxChargeW: 5000, battery2MaxChargeW: 5000, battery1MaxDischargeW: 5000, battery2MaxDischargeW: 5000, balanceEnabled: false };
for (const command of [-3000, 3000]) {
  const values = distributeCommand(command, { batterySoc: [50,50] }, settings);
  assert.deepEqual(values, [command / 3, command * 2 / 3]);
  near(values[0] / 5, values[1] / 10);
}
assert.deepEqual(distributeCommand(3000, { batterySoc: [50,50] }, { ...settings, individualBatteryPowerLimitsEnabled: false }), [1500,1500]);
// Balance operates on top of the capacity ratio, catching up in the right direction.
let commands = distributeCommand(3000, { batterySoc: [80,40] }, { ...settings, balanceEnabled: true });
assert(commands[0] / 5 > commands[1] / 10);
commands = distributeCommand(-3000, { batterySoc: [80,40] }, { ...settings, balanceEnabled: true });
assert(Math.abs(commands[0]) / 5 < Math.abs(commands[1]) / 10);
assert.deepEqual(distributeCommand(3000, { batterySoc: [50,50] }, { ...settings, battery2MaxDischargeW: 1000 }), [2000,1000]);
assert.deepEqual(distributeCommand(-3000, { batterySoc: [50,50] }, { ...settings, battery2MaxChargeW: 1000 }), [-2000,-1000]);
// Residual budget is shared proportionally among all remaining batteries after saturation.
assert.deepEqual(distributeCommand(6100, { batterySoc: [50,50,50] }, { ...settings, batteryCount: 3, battery3CapacityKwh: 20, battery1MaxDischargeW: 100, battery3MaxDischargeW: 10000 }), [100,2000,4000]);
assert.deepEqual(distributeCommand(3000, { batterySoc: [10,50] }, settings), [0,3000]);
assert.deepEqual(distributeCommand(-3000, { batterySoc: [100,50] }, settings), [0,-3000]);
assert.deepEqual(distributeCommand(3000, { batterySoc: [null,50] }, settings), [0,3000]);
assert.deepEqual(distributeCommand(3000, { batterySoc: [30,60] }, settings, { dischargeFloorSoc: 40 }), [0,3000]);
assert.equal(computeAverageSoc({ batterySoc: [80,20] }, settings), 40);
assert.equal(computeAverageSoc({ batterySoc: [80,20] }, { ...settings, individualBatteryPowerLimitsEnabled: false }), 50);
assert.equal(computeEffectiveCapacityKwh({ batterySoc: [null,20] }, settings), 10);
assert.equal(configuredBatteryCapacityKwh({ ...settings, totalCapacityKwh: 999 }), 15);
assert.equal(computeEffectiveCapacityKwh({ batterySoc: [80,null] }, settings), 5);
assert.equal(computeEffectiveCapacityKwh({ batterySoc: [null,null] }, settings), 0);
assert.equal(computeAverageSoc({ batterySoc: [null,null] }, settings), null);
const result = evaluate({ gridPowerW: 0, pvPowerW: 0, batterySoc: [80,20], forecastRemainingKwh: 0 }, { ...settings, totalCapacityKwh: 999 }, new Date('2026-09-22T12:00:00Z'));
assert.equal(result.avgSoc, 40);
assert.equal(result.effectiveCapacityKwh, 15);

(async () => {
  const app = Object.create(App.prototype);
  const stored = { settingsSchemaVersion: 66, batteryCount: 2, totalCapacityKwh: 15, individualBatteryPowerLimitsEnabled: true };
  app.homey = { settings: { get: key => stored[key] ?? null, set: (key, value) => { stored[key] = value; } }, clock: { getTimezone: () => 'UTC' } };
  await app.migrateSettings();
  await app.ensureDefaults();
  assert.equal(stored.settingsSchemaVersion, 69);
  for (let i = 1; i <= 4; i++) {
    const stem = i === 1 ? 'ev' : `ev${i}`;
    assert.equal(stored[`${stem}Voltage`], 230);
    assert.equal(stored[`${stem}VoltageReference`], 'line');
    stored[`${stem}Voltage`] = [120,208,240,400][i-1];
    stored[`${stem}VoltageReference`] = i === 4 ? 'line' : 'phase';
    app.extraEvInstances = [];
    const ev = app.getEvInstanceSettings(i-1, stored);
    assert.equal(ev.evVoltage, stored[`${stem}Voltage`]);
    assert.equal(ev.evVoltageReference, stored[`${stem}VoltageReference`]);
  }
  // Each actual Flow output test publishes power using that EV's own supply.
  stored.evCount = 4;
  app.getSettings = () => stored;
  const published = [];
  app.evCurrentTrigger = { trigger: async tokens => { published[0] = tokens; } };
  app.extraEvTriggers = Array.from({ length: 3 }, (_, i) => ({ current: { trigger: async tokens => { published[i + 1] = tokens; } } }));
  for (let i = 0; i < 4; i++) {
    await app.testEvOutput({ instance: i + 1, output: 'current', currentA: 16 });
    assert.equal(published[i].charge_current, 16);
    assert.equal(published[i].charge_power, Math.round(16 * evPowerPerAmp(app.getEvInstanceSettings(i, stored))));
  }
  assert.equal(stored.battery1CapacityKwh, 7.5);
  assert.equal(stored.battery2CapacityKwh, 7.5);
  assert.deepEqual(distributeCommand(2000, { batterySoc: [50,50] }, stored), [1000,1000]);
  stored.battery1CapacityKwh = 5;
  stored.battery2CapacityKwh = 10;
  await app.migrateSettings();
  assert.equal(stored.battery1CapacityKwh, 5);
  assert.equal(stored.evVoltage, 120);
  app.inputSeen = { batterySoc: [true,true] };
  app.state = { batterySoc: [80,20] };
  assert.equal(app.getAverageBatterySoc(stored), 40);
  assert.equal(app.getAverageBatterySocForLowForecastPromotion(stored), 40);
  // Upgrade the first 0.7.16 build: convert L-N once, preserve genuine L-L.
  stored.settingsSchemaVersion = 67;
  for (const [stem, phases, voltage, reference] of [
    ['ev',1,230,'phase'], ['ev2',3,230,'phase'],
    ['ev3',3,230,'line'], ['ev4',3,277,'phase'],
  ]) {
    stored[`${stem}Phases`] = phases;
    stored[`${stem}Voltage`] = voltage;
    stored[`${stem}VoltageReference`] = reference;
  }
  await app.migrateSettings();
  assert.deepEqual([stored.evVoltage,stored.ev2Voltage,stored.ev3Voltage,stored.ev4Voltage], [230,400,230,480]);
  assert.equal(stored.ev2VoltageReference, 'line');
  near(evPowerPerAmp(app.getEvInstanceSettings(1, stored)) * 16, 11085.125168440815);
  const migrated = JSON.stringify(stored);
  await app.migrateSettings();
  assert.equal(JSON.stringify(stored), migrated);
  assert.equal(stored.battery1CapacityKwh, 5);
  console.log('0.7.16 voltage, battery capacity, balancing and migration regressions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
