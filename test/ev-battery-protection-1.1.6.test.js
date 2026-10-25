'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { replay } = require('./ev-feedback-1.0.11.test');
const { installVirtualClearTimeout } = require('./context-refresh-harness');
const { setup } = require('./pv-source-harness');

const start = Date.parse('2026-10-19T20:00:00Z');
const rate = { id: 'dal', name: 'Dal', importPrice: .2, feedInPrice: .03,
  weekdayChargeMode: 'never', weekendChargeMode: 'never', evChargeAllowed: true,
  evPvChargeAllowed: true, ev2ChargeAllowed: true, ev3ChargeAllowed: true,
  ev4ChargeAllowed: true, evMaxGridImportW: 7000 };

async function fixture(root, overrides = {}) {
  return setup(root, {
    forcedMode: 'self_consumption', peakShaveEnabled: false, exportLimitEnabled: false,
    evCount: 1, evEnabled: true, evSocEnabled: false, evMode: 'smart',
    evControlType: 'current', evPhases: 3, evVoltage: 400, evVoltageReference: 'line',
    evMinCurrentA: 6, evMaxCurrentA: 16, evStandardCurrentA: 16,
    evCommandIntervalSeconds: 7, evPeakGuardStopHoldSeconds: 0, evSmartGridPriority: 'ev_first',
    evPeakGuardBatteryAssistNormal: false, evPeakGuardBatteryAssistEmergency: false,
    evNightSurplusChargeEnabled: false, evGuaranteeTarget: false, evPvGridTopUpMode: 'off',
    contractType: 'tou', touRates: [{ ...rate }],
    touSchedule: [{ rateId: 'dal', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    ...overrides,
  }, start, 0);
}

async function verifyAttribution(root) {
  const h = await fixture(root, { evCount: 2, ev2Enabled: true, ev2SocEnabled: false,
    ev2ControlType: 'mode', ev2Mode: 'smart', ev2Phases: 1, ev2Voltage: 230 });
  const a = h.app, settings = a.getSettings(), perAmpW = Math.sqrt(3) * 400;
  Object.assign(a.state, { evConnected: true, evChargeCurrentA: 16,
    gridPowerW: 623 + 16 * perAmpW - 4700, lastTotalCommandW: 4700 });
  Object.assign(a.inputSeen.ev, { connected: true, chargeCurrent: true });
  Object.assign(a.inputUpdatedAt.ev, { connected: start, chargeCurrent: start });
  a.lastPublishedEvAllowed = true;
  a.lastPublishedEvCurrentA = 9;
  a.latestEvDecision = { connected: true, desiredCurrentA: 9, selectedTariff: true,
    intentionalGridImport: true, portfolioGridImportTargetW: 6000 };
  const status = () => a.getEvGridImportControlStatus(a.getSettings(), h.now());
  assert.equal(a.getEvCommandedPowerW(0, settings), 16 * perAmpW);
  assert.equal(status().activeTargetW, Math.round(16 * perAmpW));
  a.lastPublishedEvAllowed = false;
  assert.equal(a.getEvCommandedPowerW(0, settings), 16 * perAmpW,
    'a STOP output cannot erase still-measured consumption from physical headroom');
  a.lastPublishedEvAllowed = true;

  // Physical PV export and signed battery charging may not become EV demand.
  a.state.gridPowerW = -2000; a.state.lastTotalCommandW = -1000;
  assert.equal(status().activeTargetW, 0);
  a.state.gridPowerW = 4000;
  assert.equal(status().activeTargetW, 3000);
  a.state.gridPowerW = 20000; a.state.lastTotalCommandW = 0;

  a.latestEvDecision.batterySupportAllocatedW = 4000;
  a.latestEvDecision.nightSurplusAllocatedW = 1000;
  assert.equal(status().activeTargetW, Math.round(16 * perAmpW - 5000),
    'explicit battery support must not be protected as grid-funded EV energy');
  delete a.latestEvDecision.batterySupportAllocatedW;
  delete a.latestEvDecision.nightSurplusAllocatedW;

  // Deadline/Emergency requests also remain distinct from actual delivery.
  a.latestEvDecision.guaranteeActive = true;
  await h.setExternalSetting('touRates', [{ ...rate, evChargeAllowed: false }]);
  assert.equal(status().activeTargetW, Math.round(16 * perAmpW));
  a.latestEvDecision.guaranteeActive = false;
  await h.setExternalSetting('touRates', [{ ...rate }]);
  await h.setExternalSetting('evMode', 'emergency');
  assert.equal(status().activeTargetW, Math.round(16 * perAmpW));
  await h.setExternalSetting('evMode', 'smart');
  // Changing mode correctly clears the cached decision. Install the explicit
  // next decision for these attribution-level checks; replays test scheduling.
  a.latestEvDecision = { connected: true, desiredCurrentA: 9, selectedTariff: true,
    intentionalGridImport: true, portfolioGridImportTargetW: 6000 };

  // A legacy mode-only house-load hold must not suppress another EV's meter.
  const extra = a.getExtraEv(1);
  extra.state.connected = true;
  extra.latestDecision = { ...a.latestEvDecision, desiredCurrentA: 16 };
  a.evSessionDetection.portfolioBaselineW = 623;
  a.evSessionDetection.detectedEvLoadW = 0;
  a.evSessionDetection.gridReleaseBlocked = true;
  assert.equal(status().houseLoadHold, true);
  assert.equal(status().activeTargetW, Math.round(16 * perAmpW));
  a.state.evChargeCurrentA = 0;
  assert.equal(status().activeTargetW, 0, 'mode-only house-load hold stays intact');
  a.state.evChargeCurrentA = 16;
  extra.state.connected = false;

  // Existing revocation/freshness contracts remain authoritative.
  await h.setExternalSetting('touRates', [{ ...rate, evMaxGridImportW: 0 }]);
  assert.equal(status().activeTargetW, 0);
  await h.setExternalSetting('touRates', [{ ...rate, evChargeAllowed: false }]);
  assert.equal(status().activeTargetW, 0);
  await h.setExternalSetting('touRates', [{ ...rate }]);
  h.setNow(start + 60001);
  assert.equal(status().activeTargetW, 0);
  a.inputUpdatedAt.ev.chargeCurrent = h.now();
  assert.equal(status().activeTargetW, Math.round(16 * perAmpW));
  a.state.evChargeCurrentA = 0;
  assert.equal(status().activeTargetW, 0);
  assert.equal(a.getEvCommandedPowerW(0, a.getSettings()), 0,
    'fresh zero-current feedback must not reserve a published nonzero setpoint');
  assert.deepEqual(h.errors, []);
}

async function replayProduction(root, contract, type, count) {
  const overrides = { evControlType: type, evCount: count };
  for (let index = 1; index < count; index++) {
    for (const [suffix, value] of Object.entries({ Enabled: true, SocEnabled: false,
      ControlType: type, Mode: 'smart', Phases: 3, Voltage: 400, VoltageReference: 'line',
      MinCurrentA: 6, MaxCurrentA: 16, StandardCurrentA: 16, SmartGridPriority: 'ev_first',
      PeakGuardBatteryAssistNormal: false, NightSurplusChargeEnabled: false,
      GuaranteeTarget: false, CommandIntervalSeconds: 7, PeakGuardStopHoldSeconds: 0,
      FixedChargeWindowEnabled: true, DynamicCheapEnabled: true,
      DynamicNormalEnabled: true, DynamicExpensiveEnabled: true })) {
      overrides[`ev${index + 1}${suffix}`] = value;
    }
  }
  const budget = 7000 * count;
  overrides.touRates = [{ ...rate, evMaxGridImportW: budget }];
  if (contract === 'fixed') Object.assign(overrides, { contractType: 'fixed',
    fixedChargeWindowStart: '00:00', fixedChargeWindowEnd: '00:00',
    evFixedChargeWindowEnabled: true, evFixedMaxGridImportW: budget });
  if (contract === 'dynamic_quarter') Object.assign(overrides, { contractType: contract,
    dynamicPriceSource: 'external', dynamicPriceSources: ['external'],
    cheapHours: 4, expensiveHours: 3, evDynamicCheapEnabled: true,
    evDynamicNormalEnabled: true, evDynamicExpensiveEnabled: true,
    evDynamicCheapMaxGridImportW: budget, evDynamicNormalMaxGridImportW: budget,
    evDynamicExpensiveMaxGridImportW: budget });
  const h = await fixture(root, overrides), a = h.app, perAmpW = Math.sqrt(3) * 400;
  if (contract === 'dynamic_quarter') {
    const curve = Array.from({ length: 120 }, (_, i) => ({ timestamp: start + i * 3600000, price: .1 + i * .001 }));
    assert.equal(await h.cards.get('read_external_prices_json').listener({ source: 'external', curve: JSON.stringify(curve) }), true);
    await h.drain();
    assert.equal(a.getRuntimeSettings().dynamicPriceDataReady, true);
  }
  for (let index = 0; index < count; index++) {
    await h.cards.get(`set_ev${index + 1}_status`).listener({ connected: 'yes', charge_current: 0 });
  }
  await h.drain(); await h.start();
  for (let second = 1; second <= 240; second++) {
    h.setNow(start + second * 1000);
    // Simulate the charger ignoring a lower setpoint after the 90s mark.
    let actualPowerW = 0;
    for (let index = 0; index < count; index++) {
      const publishedA = index === 0 ? a.lastPublishedEvCurrentA : a.getExtraEv(index).lastPublishedCurrentA;
      const amps = second >= 90 ? 16 : Number(publishedA) || 0;
      actualPowerW += amps * perAmpW;
      if (second % 5 === 0) await h.cards.get(`set_ev${index + 1}_status`).listener({ connected: 'yes', charge_current: amps });
    }
    await h.grid(623 + actualPowerW - a.state.lastTotalCommandW);
    if (second % 60 === 0) { await a.runEvHeartbeat(); a.runContextHeartbeat(); await h.drain(); }
    await h.flush();
    // Allow the existing 60s context refresh plus the battery output interval
    // to settle after the independently changing charger telemetry.
    if (second >= 160) {
      assert(Math.abs(a.state.lastTotalCommandW - 623) < 30,
        `${contract}/${type}/${count} EVs: unexpected battery drain at ${second}s: ${JSON.stringify({ batteryW: a.state.lastTotalCommandW,
          status: a.getEvGridImportControlStatus(), decisions: [a.latestEvDecision, ...a.extraEvInstances.slice(0, count - 1).map(ev => ev.latestDecision)].map(d => ({
            desiredA: d.desiredCurrentA, actualA: d.actualCurrentA, controlA: d.controlCurrentA, grid: d.gridAllocatedW, intentional: d.intentionalGridImport, reason: d.reason,
          })) })}`);
      assert.equal(a.getEvGridImportControlStatus().activeTargetW, Math.round(actualPowerW));
      const decisions = [a.latestEvDecision, ...a.extraEvInstances.slice(0, count - 1).map(ev => ev.latestDecision)];
      assert(decisions.every(d => d.desiredCurrentA > 0 && d.desiredCurrentA < 16));
      assert(decisions.reduce((sum, d) => sum + d.desiredPowerW, 0) <= budget,
        'EV setpoints must still respect their shared grid budget');
    }
  }
  assert.deepEqual(h.errors, []);
  return { contract, type, count, batteryW: a.state.lastTotalCommandW,
    activeTargetW: a.getEvGridImportControlStatus().activeTargetW,
    fastEvaluations: a.diagnostics.counters.fastEvaluations || 0,
    batteryPublishes: h.traces.length, contexts: h.contexts.length };
}

// The charger keeps drawing its measured current despite a lower command.
// Real scheduler, controller, allocation and output gates; only Homey I/O,
// physical feedback and time use the existing replay harness.
async function run(root = path.join(__dirname, '..')) {
  const OriginalDate = Date;
  const originalNow = Date.now;
  // Both Date.now() and new Date() must use the replay clock. Otherwise
  // timestamped price fixtures silently refer to the host's calendar date.
  global.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [Date.now()])); }
  };
  const restore = installVirtualClearTimeout();
  try {
    await verifyAttribution(root);
    const results = [];
    for (const type of ['current', 'hybrid']) {
      const result = await replay(root, {
        name: 'above-grid-budget', type, amps: 16, independent: true, gridLimit: 7000,
      });
      const settled = result.samples.filter(sample => sample.second >= 105);
      assert(settled.every(sample => Math.abs(sample.batteryW - sample.house) < 30),
        `${type}: the home battery must supply the house only, even above the EV grid budget: ${JSON.stringify(result.final)}`);
      assert(settled.every(sample => Math.abs(sample.active - sample.actualEvW) < 2),
        `${type}: measured EV watts must remain protected through context refreshes`);
      assert(settled.every(sample => sample.desiredA > 0 && sample.desiredA < sample.actualA),
        `${type}: the EV controller must still reduce the requested current to its grid budget`);
      results.push({ type, ...result });
    }
    for (const contract of ['tou', 'fixed', 'dynamic_quarter']) {
      for (const type of ['current', 'hybrid']) {
        for (const count of [1, 4]) results.push(await replayProduction(root, contract, type, count));
      }
    }
    return results;
  } finally {
    global.Date = OriginalDate;
    Date.now = originalNow;
    restore();
  }
}

if (require.main === module) run().then(results => {
  console.log(`1.1.6 EV battery protection: ${results.length} scheduler scenarios passed.`);
}).catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { run };
