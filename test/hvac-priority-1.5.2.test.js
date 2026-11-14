'use strict';
const assert = require('node:assert/strict');
const { boot, DEFAULTS } = require('./startup-harness');
const H = require('../lib/hvac-permanent');
const originalNow = Date.now;
let now = Date.UTC(2026, 10, 14, 10, 0, 0);
Date.now = () => now;

async function setup(overrides = {}) {
  const config = {
    ...DEFAULTS, settingsSchemaVersion: 71, hvacCount: 2, evCount: 0, batteryCount: 0,
    boilerCount: 0, controlEnabled: false, peakShaveEnabled: false,
    priorityEvaluationMinutes: 5,
    hvacEnabled: true, hvac2Enabled: true,
    hvacAutomaticControlEnabled: true, hvac2AutomaticControlEnabled: true,
    hvacPermanentEnabled: true, hvac2PermanentEnabled: true,
    hvacTariffEnabled: true, hvac2TariffEnabled: true,
    hvacDirection: 'heat', hvac2Direction: 'heat',
    hvacAllowSetpointControl: true, hvac2AllowSetpointControl: true,
    hvacAllowModeControl: true, hvac2AllowModeControl: true,
    hvacAllowPowerControl: true, hvac2AllowPowerControl: true,
    hvacControlIntervalMinutes: 5, hvac2ControlIntervalMinutes: 5,
    hvacCheapTargetC: 23, hvac2CheapTargetC: 23,
    hvacNormalTargetC: 21, hvac2NormalTargetC: 21,
    hvacComfortMinC: 20, hvac2ComfortMinC: 20,
    hvacComfortMaxC: 24, hvac2ComfortMaxC: 24,
    ...overrides,
  };
  const h = await boot(new Map(Object.entries(config)));
  const a = h.app;
  assert.deepEqual(h.errors, []);
  a.requestContextEvaluate = () => {};
  a.requestEvaluate = () => {};
  for (let i = 0; i < 220; i++) await Promise.resolve();
  Object.assign(a.state, { gridPowerW: 300, pvPowerW: 0, lastTotalCommandW: 0, hvacRoomTemperatureC: 21, hvacSetpointC: 20, hvacMode: 'heat' });
  Object.assign(a.inputSeen, { grid: true, pv: true });
  Object.assign(a.inputSeen.hvac, { roomTemperature: true, setpoint: true, mode: true });
  a.inputUpdatedAt.grid = now;
  a.inputUpdatedAt.pv = now;
  a.lastPublishedHvacSetpoint = 20;
  a.lastPublishedHvacMode = 'heat';
  a.lastPublishedHvacPower = null;
  const other = a.getExtraHvac(1);
  Object.assign(other.state, { roomTemperatureC: 21, setpointC: 20, mode: 'heat' });
  Object.assign(other.seen, { roomTemperature: true, setpoint: true, mode: true });
  other.lastPublishedSetpoint = 20;
  other.lastPublishedMode = 'heat';
  other.lastPublishedPower = null;
  a.latestResult = { tariff: { className: 'cheap', id: 'low', importPrice: 0.10 } };
  a.publishEvPortfolio = async () => ({ evDecisions: [], adjustedGridW: a.state.gridPowerW,
    totalActualEvPowerW: 0, totalDesiredEvPowerW: 0, evStartedThisCycle: false });
  h.events = [];
  for (const kind of ['setpoint', 'power', 'mode']) {
    h.cards.get(`hvac_${kind}_updated_for_configured`).trigger = async (tokens, choice) => {
      h.events.push({ kind, index: Number(choice.hvac), ...tokens, at: now });
    };
  }
  return h;
}
async function cycle(h) { return h.app.publishFlexibleLoads(h.app.latestResult, 0, 0); }
function tick(app, ms) {
  now += ms;
  app.inputUpdatedAt.grid = now;
  app.inputUpdatedAt.pv = now;
}
const started = h => h.events.filter(x => x.kind === 'setpoint');

(async () => {
  // The periodic priority scanner runs even if it had no eligible starts;
  // this must not create a new start delay.
  {
    const h = await setup({ hvacPermanentEnabled: false, hvac2PermanentEnabled: false });
    const a = h.app;
    await cycle(h);
    assert.equal(started(h).length, 0);
    assert.equal(a.flexiblePriorityState.lastStartedAt, 0);
    assert(a.flexiblePriorityState.nextEvaluationAt > now);
    tick(a, 60_000);
    a.setSetting('hvacPermanentEnabled', true);
    const out = await cycle(h);
    assert.equal(out.priority.due, true, 'new request must trigger a priority decision inside idle-check interval');
    assert.deepEqual(started(h).map(x => x.index), [1]);
    assert.equal(a.flexiblePriorityState.lastStartedAt, now);
    assert.equal(a.flexiblePriorityState.lastStartedId, 'hvac1');

    // A newer HVAC request may not break the configured minimum spacing.
    tick(a, 60_000);
    a.setSetting('hvac2PermanentEnabled', true);
    H.runtime(a).nextAt = 0; // isolate the shared priority gate from per-device intervals
    a.flexiblePriorityState.nextEvaluationAt = 0; // even when a normal evaluation is due
    const during = await cycle(h);
    assert.equal(during.priority.grantedId, '');
    assert.deepEqual(started(h).map(x => x.index), [1]);
    assert.equal(a.flexiblePriorityState.lastStartedAt, now - 60_000);

    tick(a, 4 * 60_000);
    H.runtime(a).nextAt = 0;
    await cycle(h);
    assert.deepEqual(started(h).map(x => x.index), [1, 2], 'new HVAC starts when last actual start is five minutes old');
  }

  // A second HVAC must start immediately when PV surplus appears after an
  // idle periodic check, even though the first HVAC is already running.
  {
    now += 20 * 60_000;
    const h = await setup({ hvac2AutomaticControlEnabled: false,
      hvac2TariffEnabled: false, hvac2PvEnabled: true,
      hvac2PvTargetC: 25, hvac2ControlIntervalMinutes: 5 });
    const a = h.app;
    a.lastPublishedHvacSetpoint = 23;
    const u = H.unit(a, 0);
    Object.assign(u, { mode: 'heat', setpoint: 23, outputAt: now - 15 * 60_000, powerOff: false });
    a.flexiblePriorityState.lastStartedAt = now - 15 * 60_000;
    a.flexiblePriorityState.lastStartedId = 'hvac1';
    H.runtime(a).nextAt = 0;
    a.flexiblePriorityState.nextEvaluationAt = 0;
    const idle = await cycle(h);
    assert.equal(idle.priority.due, true);
    assert.equal(idle.priority.grantedId, '');
    assert.equal(started(h).length, 0);
    tick(a, 45_000);
    a.setSetting('hvac2AutomaticControlEnabled', true);
    a.state.gridPowerW = -2500;
    a.state.pvPowerW = 3500;
    const surplus = await cycle(h);
    assert.equal(surplus.priority.due, true, 'PV request must bypass the idle check schedule');
    assert.deepEqual(started(h).map(x => x.index), [2]);
    assert.equal(a.flexiblePriorityState.lastStartedId, 'hvac2');
  }

  // Empty priority checks never replace last-start diagnostics, nor do they
  // reset the start cooldown. No extra polling or Homey timers are installed.
  {
    const h = await setup({ hvacPermanentEnabled: false, hvac2PermanentEnabled: false });
    const a = h.app;
    const before = h.timers.length;
    a.recordFlexiblePriorityStart('hvac1', now - 360_000, a.getSettings());
    a.finishFlexiblePriorityEvaluation(now, a.getSettings());
    assert.equal(a.flexiblePriorityState.lastStartedId, 'hvac1');
    assert.equal(a.flexiblePriorityState.lastStartedAt, now - 360_000);
    assert(a.isFlexiblePriorityStartAllowed(now, a.getSettings()));
    assert(!a.isFlexiblePriorityEvaluationDue(now, a.getSettings()));
    await cycle(h);
    assert.equal(h.timers.length, before);
  }

  // High battery SoC and real PV export must not invent a heating request
  // when the configured PV target is already satisfied.
  {
    const h = await setup({ hvac2Enabled: false, batteryCount: 1,
      hvacTariffEnabled: false, hvacPvEnabled: true, hvacPvTargetC: 21,
      hvacComfortMinC: 20, hvacComfortMaxC: 24 });
    const a = h.app;
    a.state.hvacRoomTemperatureC = 22;
    a.state.hvacSetpointC = 21;
    a.lastPublishedHvacSetpoint = 21;
    a.state.gridPowerW = -2500;
    a.state.pvPowerW = 3500;
    a.state.batterySoc = [98];
    a.inputSeen.batterySoc = [true];
    a.flexiblePriorityState.nextEvaluationAt = now + 5 * 60_000;
    for (let index = 0; index < 4; index += 1) {
      const out = await cycle(h);
      assert.equal(out.priority.due, false, 'no priority pass just because of export/SoC');
      assert.equal(out.priority.grantedId, '');
      assert.equal(out.hvac?.startEligible, false);
      assert.equal(a.flexiblePriorityState.lastStartedAt, 0);
      assert.deepEqual(a.flexiblePriorityState.pendingHvacStartIds, []);
      tick(a, 60_000);
    }
    assert.equal(started(h).length, 0);
    assert.equal((await cycle(h)).priority.due, false);
    tick(a, 60_000);
    assert.equal((await cycle(h)).priority.due, true, 'ordinary priority timer remains active');
  }

  // A setpoint increase on an HVAC that is already heating may continue, but
  // it is not a new HVAC start and must not request/reset priority timing.
  {
    const h = await setup({ hvac2Enabled: false, hvacCheapTargetC: 24 });
    const a = h.app;
    const u = H.unit(a, 0);
    Object.assign(u, { setpoint: 23, mode: 'heat', powerOff: false, outputAt: now - 15 * 60_000, heat: 900 });
    a.state.hvacSetpointC = 23;
    a.lastPublishedHvacSetpoint = 23;
    a.state.hvacRoomTemperatureC = 21;
    a.flexiblePriorityState.lastStartedAt = now - 15 * 60_000;
    a.flexiblePriorityState.lastStartedId = 'hvac1';
    a.flexiblePriorityState.nextEvaluationAt = now + 5 * 60_000;
    H.runtime(a).nextAt = 0;
    const out = await cycle(h);
    assert.equal(out.priority.due, false);
    assert.equal(out.priority.grantedId, '');
    assert.equal(a.flexiblePriorityState.lastStartedAt, now - 15 * 60_000);
    assert.equal(a.flexiblePriorityState.nextEvaluationAt, now + 5 * 60_000);
    assert.equal(a.lastPublishedHvacSetpoint, 24, 'existing HVAC may still adjust setpoint');
    assert.equal(out.hvac?.priorityNewStart, undefined);
  }

  // A blocked request gets at most one exceptional priority assessment.
  // Its unchanged demand cannot retrigger one every slow context heartbeat.
  {
    const h = await setup({ hvacPermanentEnabled: false, hvac2PermanentEnabled: false });
    const a = h.app;
    await cycle(h); // scheduled idle check
    tick(a, 60_000);
    a.setSetting('hvacPermanentEnabled', true);
    a.publishHvacDecisionFor = async () => {}; // simulate blocked publication
    const first = await cycle(h);
    assert.equal(first.priority.due, true);
    assert.equal(a.flexiblePriorityState.lastStartedAt, 0);
    for (let i = 0; i < 3; i += 1) {
      tick(a, 60_000);
      const repeat = await cycle(h);
      assert.equal(repeat.priority.due, false, 'pending request is not a new request');
    }
    tick(a, 2 * 60_000);
    assert.equal((await cycle(h)).priority.due, true, 'normal timer still fires');
  }

  // A fast battery/P1 pass without an HVAC assessment must not consume the
  // scheduled thermal priority slot before the next slow HVAC pass.
  {
    const h = await setup({ hvacPermanentEnabled: false, hvac2PermanentEnabled: false });
    const a = h.app;
    a.flexiblePriorityState.nextEvaluationAt = now;
    const fast = await a.publishFlexibleLoads({ ...a.latestResult, _runHvacContextPass: false }, 0, 0);
    assert.equal(fast.priority.due, false);
    assert.equal(a.flexiblePriorityState.nextEvaluationAt, now);
    const slow = await cycle(h);
    assert.equal(slow.priority.due, true);
    assert.equal(a.flexiblePriorityState.nextEvaluationAt, now + 5 * 60_000);
  }

  // A running but currently non-demanding heat pump may request an actual
  // new heating cycle when a higher PV/tariff target crosses room temperature.
  {
    const h = await setup({ hvacPermanentEnabled: false, hvac2PermanentEnabled: false });
    const a = h.app;
    const u = H.unit(a, 0);
    Object.assign(u, { setpoint: 20, mode: 'heat', powerOff: false, outputAt: now - 15 * 60_000 });
    a.flexiblePriorityState.lastStartedAt = now - 15 * 60_000;
    a.flexiblePriorityState.lastStartedId = 'hvac1';
    await cycle(h); // idle scheduled check
    tick(a, 60_000);
    a.setSetting('hvacPermanentEnabled', true);
    const start = await cycle(h);
    assert.equal(start.priority.due, true, 'new physical heating demand bypasses idle timer');
    assert.deepEqual(started(h).map(x => x.index), [1]);
    assert.equal(a.flexiblePriorityState.lastStartedAt, now);
  }
  console.log('HVAC priority-on-demand 1.5.2: 8 integration groups passed');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { Date.now = originalNow; });
