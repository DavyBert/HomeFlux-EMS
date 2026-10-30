'use strict';
const assert = require('node:assert/strict');
const { InputMonitor, MAX_DURATION_MS } = require('../lib/input-monitor');
const { fixture } = require('./ev-work-harness');
const { DEFAULTS, previewBatteryFeedback } = require('../lib/ems-engine');
const { installVirtualClearTimeout } = require('./pv-source-harness');
let scenarios = 0;

function isolatedMonitor() {
  let now = 100000;
  const m = new InputMonitor({ now: () => now, setTimeout: () => 1, clearTimeout: () => {} });
  return { m, time: at => { now = at; } };
}

async function main() {
  {
    const { m, time } = isolatedMonitor();
    assert.equal(m.snapshot().calculations, undefined, 'no session requires no data');
    m.noteCalculation('evDecision', 'heartbeat', 1, 12, 7);
    m.start();
    for (let second = 0; second < 5; second++) {
      time(100000 + second * 1000 + 100);
      m.noteCalculation('evDecision', 'heartbeat', 1, 2, 1);
      time(100000 + second * 1000 + 400);
      m.noteCalculation('evDecision', 'heartbeat', 1, 4, 2);
      m.noteCalculation('evDecision', 'heartbeat', 2, 3, 1);
      m.noteCalculation('evTariffScan', 'heartbeat', 1, .2, .1);
    }
    time(105000);
    let r = m.snapshot();
    assert.equal(r.calculationSummary.total, 20);
    const first = r.calculations.find(c => c.key === 'evDecision:heartbeat:1');
    assert.equal(first.executions, 10);
    assert.equal(first.peakPerSecond, 2);
    assert.equal(first.possibleRepeats, 1);
    assert.equal(first.totalWallMs, 30);
    assert.equal(first.totalCpuMs, 15);
    assert.equal(first.status, 'possible_repetition');
    assert(r.calculations.filter(c => c.status === 'possible_repetition').length === 1,
      'separate EVs and nested scans must not amplify the same-route repetition');
    assert.equal(r.possibleLoopEpisodes, 0, 'calculate frequency must not become a Flow loop');
    assert(r.events.some(e => e.type === 'calculation_repetition_started'));
    time(108000);
    r = m.stop();
    assert.equal(r.calculationSummary.activePossibleRepeats, 0);
    assert.equal(r.calculationSummary.possibleRepeats, 1);
    assert.equal(r.calculationSummary.total, 20);
    const frozen = JSON.stringify(r.calculations);
    m.noteCalculation('evDecision','heartbeat',1,1,1);
    assert.equal(JSON.stringify(m.snapshot().calculations), frozen);
    scenarios++;
    const x = isolatedMonitor(); x.m.start();
    x.time(100000 + MAX_DURATION_MS);
    x.m.noteCalculation('batterySocPlan', 'context', 0, 1, 1);
    assert.equal(x.m.snapshot().active, false);
    assert.equal(x.m.snapshot().calculationSummary.total, 0);
    scenarios++;
  }
  {
    const h = await fixture({ evs: 2, type: 'current', chargeAllowed: true, batteries: 0, batteryEnabled: false });
    const a = h.app;
    const before = { flexible: h.flexible.length, battery: h.traces.length };
    assert.equal(a.getInputMonitorReport().session, null);
    a.startInputMonitor();
    a.invalidatePlanningCache(true);
    a.refreshPlanningInContext(a.getSettings(), a.getRuntimeSettings(a.getSettings()),
      a.getEvaluationState(a.getSettings(), h.now(), 0), h.now());
    const afterPlan = a.getInputMonitorReport();
    assert.equal(afterPlan.calculations.filter(c => c.kind === 'batterySocPlan' && c.origin === 'context').length, 1);
    const countBefore = afterPlan.calculationSummary.total;
    a.getPlanningStatus(); a.getPlanningStatus();
    for (let i = 0; i < 10; i++) a.getPublicStatus();
    const afterStatus = a.getInputMonitorReport();
    const countedPlans = data => (data.calculations || []).filter(c => ['batterySocPlan','batteryChargeTarget','evDecision','evTariffScan'].includes(c.kind)).reduce((sum,c)=>sum+c.executions,0);
    assert.equal(countedPlans(afterStatus), countedPlans(afterPlan),
      'reading cached status must not execute new charging plans, decisions or tariff scans');
    assert(afterStatus.calculationSummary.total > countBefore,
      'settings expansion during Live status should now be visible separately');
    await a.refreshEvOnlyContext();
    assert.equal(countedPlans(a.getInputMonitorReport()),countedPlans(afterStatus),'EV-only request cannot scan tariffs or calculate decisions');
    await a.runContextEvaluation(true);
    await h.flush();
    const report = a.stopInputMonitor();
    const evDecisions = report.calculations.filter(c => c.kind === 'evDecision');
    const scans = report.calculations.filter(c => c.kind === 'evTariffScan');
    assert(evDecisions.some(c => c.instance === 1));
    assert(evDecisions.some(c => c.instance === 2));
    assert(scans.some(c => c.instance === 1));
    assert(scans.some(c => c.instance === 2));
    assert(scans.every(c => c.executions >= 1));
    assert(report.calculationSummary.total >= 5);
    assert.equal(report.homeFluxVersion, '1.2.9');
    a.startInputMonitor();
    await h.cards.get('set_ev1_soc_deadline').listener({ target_soc: 80, time: '07:00', guarantee: 'no' });
    a.getEvInstanceSettings(0);
    a.getEvInstanceSettings(0);
    const socRows = a.getInputMonitorReport().calculations;
    assert(socRows.filter(c => c.kind === 'evSocDeadline' && c.instance === 1)
      .reduce((count, row) => count + row.executions, 0) <= 1,
      'minute-valid SoC deadlines must not be recalculated twice');
    assert((a.getInputMonitorReport().planningEvents['soc_deadline_reused:ev1'] || 0) >= 1,
      'the monitor must show reuse instead of silently hiding the skipped deadline lookup');
    assert(socRows.some(c => c.kind === 'evSettingsBuild' && c.instance === 1),
      'settings rebuilding must be counted independently');
    a.stopInputMonitor();
    scenarios++;
    const state = { gridPowerW: 250, controlGridPowerW: 250, batterySoc: [40],
      lastTotalCommandW: -500, plannedBatteryGridLimitW: null };
    const settings = { ...DEFAULTS, batteryCount: 1, totalCapacityKwh: 5.4 };
    const charge = { tariff: { planningWindowEligibleNow: true, selectedChargeMinutes: 180 },
      planningChargeTargetSoc: 90 };
    const withoutObserver = previewBatteryFeedback(state, settings, 12, charge);
    a.startInputMonitor();
    const withObserver = previewBatteryFeedback(state, settings, 12, charge,
      task => a.measurePlanningCalculation('batteryChargeTarget', 'fastPreview', 0, task));
    assert.deepEqual(withObserver, withoutObserver, 'observer must not modify battery planning feedback');
    assert.equal(a.getInputMonitorReport().calculations.find(c => c.kind === 'batteryChargeTarget').executions, 1);
    a.stopInputMonitor();
    scenarios++;
    assert.deepEqual(h.errors, []);
    assert(h.flexible.length >= before.flexible);
    assert(h.traces.length >= before.battery);
    scenarios++;
    const count = a.getInputMonitorReport().calculationSummary.total;
    a.getInputMonitorReport();
    assert.equal(a.getInputMonitorReport().calculationSummary.total, count);
    scenarios++;
  }
  console.log(`1.1.16 planning monitor: ${scenarios} frequency, attribution, real planner, freeze and status scenarios passed.`);
}
const restore = installVirtualClearTimeout();
main().finally(restore).catch(e => { console.error(e); process.exitCode = 1; });
