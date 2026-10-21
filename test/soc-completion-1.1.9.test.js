'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const req = createRequire(path.join(root, 'package.json'));
const { calculateEvDecision } = req('./lib/flexible-loads');
const { DEFAULTS } = req('./lib/ems-engine');
const start = Date.parse('2026-10-21T10:00:00Z');
const days = [1, 2, 3, 4, 5, 6, 7];
const stem = index => index ? `ev${index + 1}` : 'ev';
let cases = 0;

function pureTests() {
  for (const type of ['current', 'mode', 'hybrid']) {
    for (const selected of [false, true]) for (const pv of [0, 7000]) {
      const tariff = { kind: 'tou', rateId: 'test', label: 'Test' };
      const settings = { ...DEFAULTS, evEnabled: true, evSocEnabled: true,
        evMode: 'soc_target', evControlType: type, evTargetSoc: 80, evAfterSocTarget: 'preferences',
        evPhases: 1, evVoltage: 230, evVoltageReference: 'phase', evMinCurrentA: 6,
        evMaxCurrentA: 16, evStandardCurrentA: 10, evModeSmartCurrentA: 6, evModeStandardCurrentA: 10,
        evGuaranteeTarget: true, evAllowUnselectedTariffForDeadline: true, evPvStartSurplusW: 1000,
        contractType: 'tou', peakShaveEnabled: false,
        touRates: [{ id: 'test', evChargeAllowed: selected, evPvChargeAllowed: true, evPvMinSurplusW: 1000 }],
      };
      const input = { settings, connected: true, soc: 80, socSeen: true, socFresh: true,
        actualCurrentA: 0, gridPowerW: 623 - pv, pvAvailableWOverride: pv, now: new Date(start), tariff };
      const d = calculateEvDecision(input);
      assert.equal(d.socTargetReached, true);
      assert.equal(d.targetCompleted, undefined);
      assert.equal(d.mode, 'smart');
      assert.equal(d.guaranteeActive, false);
      assert.equal(d.deadlineAt, null);
      assert.equal(d.allowed, selected || pv > 0, `${type}/${selected}/${pv}`);
      assert(d.desiredCurrentA <= 16);
      const stop = calculateEvDecision({ ...input, settings: { ...settings, evAfterSocTarget: 'stop' } });
      assert.equal(stop.targetCompleted, 'soc_target');
      assert.equal(stop.desiredCurrentA, 0);
      const legacy = { ...settings }; delete legacy.evAfterSocTarget;
      assert.equal(calculateEvDecision({ ...input, settings: legacy }).targetCompleted, 'soc_target');
      assert.equal(calculateEvDecision({ ...input, settings: { ...settings, evAfterSocTarget: 'invalid' } }).targetCompleted, 'soc_target');
      // A completed SoC preference must not change the established kWh completion policy.
      const energy = calculateEvDecision({ ...input, settings: { ...settings,
        evEnergyPlanActive: true, evEnergyNeedKwh: 0, evSocTargetReached: true } });
      assert.equal(energy.targetCompleted, 'energy_target');
      const stale = calculateEvDecision({ ...input, soc: NaN, socFresh: false });
      assert.equal(stale.socTargetReached, false, 'stale SoC cannot newly complete a goal');
      const remembered = calculateEvDecision({ ...input, soc: NaN, socFresh: false,
        settings: { ...settings, evSocTargetReached: true } });
      assert.equal(remembered.socTargetReached, true);
      assert.equal(remembered.guaranteeActive, false);
      assert.equal(remembered.mode, 'smart');
      cases++;
    }
  }
  for (const contractType of ['fixed', 'dynamic_quarter']) for (const selected of [false, true]) {
    const settings = { ...DEFAULTS, contractType, evEnabled: true, evSocEnabled: true,
      evMode: 'soc_target', evAfterSocTarget: 'preferences', evTargetSoc: 80,
      peakShaveEnabled: false, evMinCurrentA: 6, evMaxCurrentA: 16, evStandardCurrentA: 10,
      evPhases: 3, evVoltage: 400, evVoltageReference: 'line',
      evFixedChargeWindowEnabled: selected, evDynamicCheapEnabled: selected,
      evGuaranteeTarget: true, evAllowUnselectedTariffForDeadline: true };
    const d = calculateEvDecision({ settings, connected: true, soc: 80, socSeen: true, socFresh: true,
      now: new Date(start), gridPowerW: 623, actualCurrentA: 0, pvAvailableWOverride: 0,
      tariff: contractType === 'fixed' ? { kind: 'fixed', className: 'cheap', label: 'Fixed' }
        : { kind: 'dynamic', className: 'cheap', label: 'Cheap' } });
    assert.equal(d.mode, 'smart'); assert.equal(d.socTargetReached, true);
    assert.equal(d.allowed, selected, `${contractType}/${selected}`);
    assert.equal(d.guaranteeActive, false);
    cases++;
  }
}

async function fixture(type, count, policy, scenario) {
  const rate = { id: 'test', name: 'Test', importPrice: .2, feedInPrice: .03,
    weekdayChargeMode: 'never', weekendChargeMode: 'never', evMaxGridImportW: 15000 };
  const fields = { Enabled: true, SocEnabled: true, SocFreshnessMinutes: 15, Mode: 'soc_target',
    TargetSoc: 80, AfterSocTarget: policy, TargetTime: '23:00', ControlType: type,
    Phases: 1, Voltage: 230, VoltageReference: 'phase', MinCurrentA: 6, MaxCurrentA: 16,
    StandardCurrentA: 10, ModeSmartCurrentA: 6, ModeStandardCurrentA: 10,
    CommandIntervalSeconds: 7, PeakGuardStopHoldSeconds: 0, SmartGridPriority: 'ev_first',
    GuaranteeTarget: false, PvStartSurplusW: 1000, PvStopSurplusW: 0, PvStopDelaySeconds: 0,
    PeakGuardBatteryAssistNormal: false, PeakGuardBatteryAssistEmergency: false, NightSurplusChargeEnabled: false };
  const settings = { batteryCount: 0, controlEnabled: false, forcedMode: 'standby',
    contractType: 'tou', evCount: count, evPvSharePercent: 100, peakShaveEnabled: true,
    peakLimitW: 17250, peakSoftMarginW: 100, exportLimitEnabled: false,
    touRates: [rate], touSchedule: [{ rateId: 'test', start: '00:00', end: '00:00', days }] };
  for (let i = 0; i < count; i++) {
    for (const [key, value] of Object.entries(fields)) settings[`${stem(i)}${key}`] = value;
    rate[`${stem(i)}ChargeAllowed`] = scenario === 'tariff';
    rate[`${stem(i)}PvChargeAllowed`] = true;
    rate[`${stem(i)}PvMinSurplusW`] = 1000;
  }
  const pv = scenario === 'pv' ? 14000 : 0;
  const h = await setup(root, settings, start, pv);
  for (const [id, card] of h.cards) if (/^ev[1-4]_(charge_current|charging_allowed|charge_mode)_updated$/.test(id)) {
    card.trigger = async tokens => h.flexible.push({ at: h.now(), id, tokens });
  }
  for (let i = 0; i < count; i++) {
    await h.cards.get(`set_ev${i + 1}_status`).listener({ connected: 'yes', charge_current: 0 });
    await h.cards.get(`set_ev${i + 1}_soc`).listener({ soc: 50 });
  }
  await h.drain(); await h.start(); await h.drain();
  h.setNow(h.now() + 10000); await h.flush();
  return h;
}

const decision = (a, i = 0) => i ? a.getExtraEv(i).latestDecision : a.latestEvDecision;
const permitted = (a, i = 0) => i ? Boolean(a.getExtraEv(i).lastPublishedAllowed) : Boolean(a.lastPublishedEvAllowed);
async function pass(h) {
  h.app.requestContextEvaluate(true, 'soc_completion_test');
  await h.drain(); await h.flush(); await h.app.runEvHeartbeat(); await h.drain(); await h.flush();
}
async function soc(h, index, value) {
  await h.cards.get(`set_ev${index + 1}_soc`).listener({ soc: value }); await h.drain();
}

async function productionTests() {
  if (!process.env.SOC_COMPLETION_LIFECYCLE_ONLY) for (const type of ['current', 'mode', 'hybrid']) for (const count of [1, 4]) {
    for (const policy of ['stop', 'preferences']) for (const scenario of ['tariff', 'pv', 'none']) {
      const h = await fixture(type, count, policy, scenario), a = h.app;
      h.setNow(h.now() + 10000);
      for (let i = 0; i < count; i++) await soc(h, i, 80);
      await pass(h); h.setNow(h.now() + 10000); await h.flush(); await pass(h);
      for (let i = 0; i < count; i++) {
        const d = decision(a, i), s = a.getEvSessionDetectionRuntime(i);
        const expected = policy === 'preferences' && scenario !== 'none';
        assert.equal(permitted(a, i), expected, `${type}/${count}/${policy}/${scenario}/EV${i + 1}`);
        assert.equal(s.endedLatched, policy === 'stop');
        assert.equal(Boolean(s.socTargetReached), policy === 'preferences');
        assert.equal(d.guaranteeActive, false);
        if (policy === 'preferences') assert.equal(d.mode, 'smart');
        if (policy === 'stop') {
          if (type !== 'mode') assert.equal(i ? a.getExtraEv(i).lastPublishedCurrentA : a.lastPublishedEvCurrentA, 0);
          if (type !== 'current') assert.equal(i ? a.getExtraEv(i).lastPublishedChargeMode : a.lastPublishedEvChargeMode, 'stop');
        }
      }
      // Repeated above-target input cannot repeatedly complete/restart/publish the session.
      const outputCount = h.flexible.length;
      for (let repeat = 0; repeat < 3; repeat++) {
        h.setNow(h.now() + 10000);
        await h.grid(scenario === 'pv' ? -13377 : 623);
        for (let i = 0; i < count; i++) await soc(h, i, 81);
        await pass(h);
      }
      assert.equal(h.flexible.length, outputCount, 'unchanged completed policy must not republish');
      // Explicit completion Flow remains a hard stop, including while preferences allow charging.
      await h.cards.get('end_ev1_charging_session').listener({}); await h.drain(); await pass(h);
      assert.equal(permitted(a), false);
      assert.equal(a.getEvSessionDetectionRuntime(0).endedReason, policy === 'preferences' ? 'flow' : 'soc_target');
      await pass(h); assert.equal(permitted(a), false);
      assert.deepEqual(h.errors, []);
      cases++;
    }
  }

  for (const type of ['current', 'mode', 'hybrid']) {
    const h = await fixture(type, 1, 'preferences', 'tariff'), a = h.app;
    // A Flow target completes into Smart even if a temporary Emergency override was active.
    a.setEvSessionOverride('soc_target'); a.setEvSocPlan(0, 60, '23:00', 'yes'); await h.drain();
    h.setNow(h.now() + 10000); await soc(h, 0, 60); await pass(h);
    assert.equal(a.getEvSessionDetectionRuntime(0).socTargetReached, true);
    assert.equal(a.getEvSessionOverrideFor(0).mode, null);
    assert.equal(a.getEffectiveEvModeFor(0), 'smart');
    assert.equal(a.getEvInstanceSettings(0).evGuaranteeTarget, false);
    assert.equal(decision(a).guaranteeActive, false);
    const recorded = a.getDiagnosticsReport().ev.events.filter(e => e.kind === 'ev_decision' && e.instance === 1).at(-1);
    assert.equal(recorded.socTargetReached, true);
    assert.equal(recorded.mode, 'smart');
    assert.equal(recorded.guaranteeAllowed, false);
    // Saving the same target must not rearm a completed goal.
    await h.setExternalSetting('evTargetSoc', a.getSettings().evTargetSoc); await h.drain(); await pass(h);
    assert.equal(a.getEvSessionDetectionRuntime(0).socTargetReached, true);
    // Target completion stays remembered if subsequent SoC becomes stale or is temporarily lower.
    h.setNow(h.now() + 16 * 60000); await h.grid(623); await pass(h);
    assert.equal(decision(a).socTargetReached, true);
    assert.equal(permitted(a), true);
    await soc(h, 0, 59); await pass(h); assert.equal(a.getEffectiveEvModeFor(0), 'smart');
    // A new Flow target explicitly rearms goal-driven operation.
    a.setEvSocPlan(0, 90, '23:00', 'yes'); await h.drain(); await pass(h);
    assert.equal(a.getEvSessionDetectionRuntime(0).socTargetReached, false);
    assert(decision(a).energyNeedKwh > 0);
    // Settings-based mode changes rearm completion, just like a new Flow mode.
    await h.setExternalSetting('evMode', 'smart'); await h.drain(); await pass(h);
    assert.equal(a.getEvSessionDetectionRuntime(0).socTargetReached, false);
    // Switching an already-reached goal from stop to preferences and back is immediate.
    h.setNow(h.now() + 10000); await soc(h, 0, 90); await pass(h);
    assert.equal(a.getEvSessionDetectionRuntime(0).socTargetReached, true);
    await h.setExternalSetting('evAfterSocTarget', 'stop'); await h.drain(); await pass(h);
    assert.equal(a.getEvSessionDetectionRuntime(0).endedLatched, true);
    assert.equal(permitted(a), false);
    await h.setExternalSetting('evAfterSocTarget', 'preferences'); await h.drain();
    h.setNow(h.now() + 10000); await pass(h);
    assert.equal(a.getEvSessionDetectionRuntime(0).endedLatched, false);
    assert.equal(a.getEvSessionDetectionRuntime(0).socTargetReached, true);
    assert.equal(permitted(a), true);
    // A new mode override is also explicit rearming; Emergency keeps its established 100% goal.
    a.setEvSessionOverride('emergency'); await h.drain(); await pass(h);
    assert.equal(decision(a).mode, 'emergency'); assert.equal(decision(a).targetSoc, 100);
    h.setNow(h.now() + 10000); await soc(h, 0, 100); await pass(h);
    assert.equal(decision(a).mode, 'smart'); assert.equal(a.getEffectiveEvModeFor(0), 'smart');
    assert.equal(a.getEvSessionOverrideFor(0).mode, null);
    // Real net peak must still stop or limit ordinary post-target charging.
    h.setNow(h.now() + 10000); await h.grid(25000); await pass(h);
    assert.equal(permitted(a), false, `${type}: Peak Guard ${JSON.stringify(decision(a))}`);
    // Disconnect/reconnect resets completion and arms the persistent Flow target.
    await h.cards.get('set_ev1_status').listener({ connected: 'no', charge_current: 0 }); await h.drain();
    assert.equal(a.getEvSessionDetectionRuntime(0).socTargetReached, false);
    await h.grid(623);
    await h.cards.get('set_ev1_status').listener({ connected: 'yes', charge_current: 0 }); await h.drain();
    await soc(h, 0, 50); h.setNow(h.now() + 10000); await pass(h);
    assert.equal(a.getEvSessionDetectionRuntime(0).socTargetReached, false);
    assert(decision(a).energyNeedKwh > 0);
    assert.deepEqual(h.errors, []);
    cases++;
  }
}

async function run() {
  const original = Date.now, restore = installVirtualClearTimeout();
  try { pureTests(); await productionTests(); console.log(`1.1.9 SoC completion: ${cases} decision/scheduler scenarios passed.`); }
  finally { Date.now = original; restore(); }
}
run().catch(err => { console.error(err); process.exitCode = 1; });
