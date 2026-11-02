'use strict';

const assert = require('assert');
const {
  powerPerAmp,
  calculateScenario,
  calculateCapability,
} = require('../settings/ev-headroom');

assert.equal(powerPerAmp(1), 230);
assert.equal(powerPerAmp(3), 690);

// 3-phase current control: 8.6 kW Peak Guard - 0.1 kW margin - 0.22 kW
// idle load leaves 8.28 kW, i.e. exactly 12 A of physical EV room.
{
  const result = calculateCapability({
    peakEnabled: true,
    peakLimitW: 8600,
    peakSoftMarginW: 100,
    idleHouseLoadW: 220,
    batterySupportW: 0,
    ev: { controlType: 'current', phases: 3, minCurrentA: 6, maxCurrentA: 32, standardCurrentA: 16 },
  });
  assert.equal(result.softPeakW, 8500);
  assert.equal(result.baseBudgetW, 8280);
  assert.equal(result.batterySaving.canCharge, true);
  assert.equal(result.batterySaving.usableMaxA, 12);
  assert.equal(result.batterySaving.standardFits, false);
}

// Mode-only control must step down from Standard to Smart when only the Smart
// estimate fits below Peak Guard.
{
  const scenario = calculateScenario({
    controlType: 'mode', phases: 3, modeSmartCurrentA: 6, modeStandardCurrentA: 16,
  }, 5000);
  assert.equal(scenario.smartFits, true);
  assert.equal(scenario.standardFits, false);
  assert.equal(scenario.highestMode, 'smart');
}

// If not even minimum current fits, Settings must clearly say the EV cannot
// start without PV/battery reserve rather than showing an unusable ampere value.
{
  const scenario = calculateScenario({
    controlType: 'hybrid', phases: 3, minCurrentA: 6, maxCurrentA: 32, standardCurrentA: 16,
  }, 3000);
  assert.equal(scenario.theoreticalAvailableA, 4);
  assert.equal(scenario.canCharge, false);
  assert.equal(scenario.usableMaxA, 0);
}

// Optional battery support may make Smart/Standard physically possible in
// self-consumption, but Battery Save/no-reserve remains the conservative basis.
{
  const result = calculateCapability({
    peakEnabled: true,
    peakLimitW: 8000,
    peakSoftMarginW: 100,
    idleHouseLoadW: 3000,
    batterySupportW: 7000,
    ev: { controlType: 'mode', phases: 3, modeSmartCurrentA: 6, modeStandardCurrentA: 16 },
  });
  assert.equal(result.baseBudgetW, 4900);
  assert.equal(result.batterySaving.highestMode, 'smart');
  assert.equal(result.selfConsumption.highestMode, 'standard');
}

// One-phase installations use the same Peak Guard power budget but convert it
// to the correct 230 W/A current ceiling.
{
  const scenario = calculateScenario({
    controlType: 'current', phases: 1, minCurrentA: 6, maxCurrentA: 32, standardCurrentA: 16,
  }, 2760);
  assert.equal(scenario.usableMaxA, 12);
}

// With Peak Guard disabled the helper deliberately returns no artificial cap.
{
  const result = calculateCapability({ peakEnabled: false, peakLimitW: 2500, idleHouseLoadW: 500, ev: {} });
  assert.equal(result.peakEnabled, false);
  assert.equal(result.batterySaving, null);
  assert.equal(result.selfConsumption, null);
}

console.log('EV Peak Guard headroom preview tests passed');
