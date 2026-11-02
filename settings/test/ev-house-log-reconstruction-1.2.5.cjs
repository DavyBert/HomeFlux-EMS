'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = process.env.HEMS_REPLAY_ROOT || path.resolve(__dirname, '..');
const inputDir = process.argv[2] || process.env.HEMS_LOG_INPUT;
assert(inputDir, 'Supply the directory containing the two original uploaded log files');
const outputFile = process.argv[3] || path.join(root, 'validation/ev-house-log-reconstruction-1.2.5.json');
const { boot } = require(root + '/test/startup-harness');
const NativeDate = Date, nativeNow = Date.now;
let clock = 0;
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };
function configurations(log) {
  const map = new Map(); let value = {};
  for (const c of log.planning.configurations) {
    value = c.kind === 'snapshot' ? structuredClone(c.settings) : { ...value, ...structuredClone(c.changes || {}) };
    for (const key of c.removed || c.removedKeys || []) delete value[key];
    map.set(c.id, structuredClone(value));
  }
  return map;
}
async function snapshot(log, event, settings, { baselineOverride = null } = {}) {
  clock = event.at;
  const storedSettings = { ...settings, settingsSchemaVersion: 70, controlEnabled: false };
  // Diagnostic snapshots expose this legacy stored setting under a derived
  // private key. Map it back to the original Homey setting before startup.
  for (let i = 0; i < 4; i++) if (settings[`_ev${i + 1}ModeLoadTolerancePercent`] != null) {
    storedSettings[`${i ? 'ev' + (i + 1) : 'ev'}FeedbackTolerancePercent`] = settings[`_ev${i + 1}ModeLoadTolerancePercent`];
  }
  const h = await boot(new Map(Object.entries(storedSettings)));
  const a = h.app;
  // No scheduling or device I/O: reconstruct ONE recorded decision at a time.
  // The recorded physical situation is held fixed; this is not a closed-loop
  // plant simulation or a claim that the complete input stream was recorded.
  a.requestContextEvaluate = () => {}; a.requestEvaluate = () => {};
  h.store.set('_chargeTestSignature', a.getChargeTestSignature(a.getSettings()));
  await h.setExternalSetting('controlEnabled', settings.controlEnabled);
  for (let i = 0; i < 200; i++) await Promise.resolve();
  const latestPlan = log.planning.events.filter(x => x.at <= event.at).at(-1);
  if (latestPlan?.inputs) {
    Object.assign(a.state, { forecastRemainingKwh: latestPlan.inputs.forecastRemainingKwh,
      forecastDailyMaxKwh: latestPlan.inputs.forecastDailyMaxKwh,
      forecastTomorrowKwh: latestPlan.inputs.forecastTomorrowKwh,
      batterySoc: latestPlan.inputs.batterySoc, nightPlanningActive: latestPlan.inputs.nightPlanningActive });
    a.inputSeen.batterySoc = latestPlan.inputs.batterySoc.map(x => x !== null);
    a.inputUpdatedAt.batterySoc = latestPlan.inputs.batterySoc.map(x => x !== null ? latestPlan.at : 0);
  }
  const gridW = event.inputs.gridPowerW, pvW = event.inputs.pvPowerW;
  a.state.gridPowerW = gridW; a.state.pvPowerW = pvW;
  a.state.lastTotalCommandW = event.battery.lastPublishedTotalW;
  a.inputSeen.grid = true; a.inputSeen.pv = true;
  a.inputUpdatedAt.grid = event.inputs.gridUpdatedAt || event.at;
  // The diagnostics do not contain PV receipt timestamps. Freshness is an
  // explicit assumption for this conditional reconstruction, never a fake log.
  a.inputUpdatedAt.pv = event.at;
  a.updateEvStatusInput(0, event.connected, event.feedback?.currentA || 0,
    event.feedback?.updatedAt || event.at);
  const session = a.getEvSessionDetectionRuntime(0);
  session.endedLatched = Boolean(event.ended);
  a.evSessionDetection.portfolioBaselineW = baselineOverride ?? event.peakGuardAccounting.houseBaselineW;
  a.evBatteryHouseReferenceW = event.lastBatteryMeterSelection?.houseReferenceW ?? event.peakGuardAccounting.houseBaselineW;
  a.evSessionDetection.lastSampleAt = 0;
  a.lastPublishedEvChargeMode = event.published.mode;
  a.lastPublishedEvAllowed = Boolean(event.published.allowed);
  a.lastPublishedEvCurrentA = event.published.currentA;
  a.lastEvPublishedAt = event.published.publishedAt;
  if (a.evModeHouseCommands) {
    // The log already records a published Mode output. Restore that command
    // receipt for a conditional snapshot, not a guessed new publication.
    a.evModeHouseCommands[0] = { mode: event.published.mode || null, at: event.published.publishedAt || 0 };
    a.evModeHouseConfirmedThisRun[0] = true;
    a.evModeHouseSavedReferenceW = event.peakGuardAccounting.houseBaselineW;
  }
  // The logged published state is stable at these decision snapshots. Do not
  // inherit an unrelated asynchronous mock-startup publication mutex.
  a.evPublishing = false;
  const remaining = String(event.reason).match(/herstart opnieuw beoordelen over (\d+) s/);
  a.evPeakGuardStopHoldUntil = remaining ? event.at + Number(remaining[1]) * 1000 : 0;
  // cfg-9 of 27 October was captured between explicit widget-clear writes:
  // its persisted goal still has widget metadata, while the recorded runtime
  // decision already uses Emergency. Restore that explicitly logged runtime
  // branch rather than treating a cold-boot of a transient write as a replay.
  const transientWidgetGoal = Boolean(a.evEnergyPlans?.[0]?.widgetPlan || a.evSocPlans?.[0]?.widgetPlan);
  if (transientWidgetGoal) a.clearEvSocPlan(0);
  a.setEvSessionOverrideFor(0, 'emergency', 'flow');
  a.updateEvPortfolioLoadDetection(gridW, event.at, a.getSettings());
  const originalBaseline = a.evSessionDetection.portfolioBaselineW;
  const observedW = a.getEvModeObservedPowerW(0, a.getSettings(), event.at);
  const d = a.calculateEvPortfolioDecisions(null, a.state.lastTotalCommandW,
    a.state.lastTotalCommandW, a.getSettings(), { physicalOnly: true })[0];
  assert.equal(d.source, 'emergency', JSON.stringify({ event: event.id, decision: d,
    mode: a.getEffectiveEvModeFor(0), widget: a.evWidgetPlans, session: a.evSessionOverrides }));
  const output = a.getEvOutputFor(0, d, a.getSettings());
  assert.deepEqual(h.errors, []);
  let publicationProof = null;
  if (event.id === 'evt-79' && event.at < Date.parse('2026-10-28T00:00:00Z') && baselineOverride === null) {
    const sent = [];
    a.evModeTrigger.trigger = async tokens => sent.push({ component: 'mode', tokens });
    a.evAllowedTrigger.trigger = async tokens => sent.push({ component: 'allowed', tokens });
    await a.publishEvDecision(d);
    assert(sent.some(x => x.component === 'mode' && String(x.tokens.charge_mode).toLowerCase() === 'stop'),
      JSON.stringify({ sent, mode: a.lastPublishedEvChargeMode, allowed: a.lastPublishedEvAllowed, publishing: a.evPublishing }));
    assert.equal(a.lastPublishedEvChargeMode, 'stop'); assert.equal(a.lastPublishedEvAllowed, false);
    publicationProof = { simulatedHomeyIo: true, sent, resultingMode: a.lastPublishedEvChargeMode,
      resultingAllowed: a.lastPublishedEvAllowed, stopHoldUntil: a.evPeakGuardStopHoldUntil };
  }
  return { eventId: event.id, at: event.at, gridW, pvW, batteryW: a.state.lastTotalCommandW,
    baselineW: originalBaseline, source: d.source, transientWidgetGoal, publicationProof, published: event.published,
    originalCalculated: event.calculated, originalOutput: event.outputRequest,
    originalReason: event.reason, originalCurrentEvW: event.peakGuardAccounting.currentEvPowerW,
    observedEvW: observedW, newCalculated: { currentA: d.desiredCurrentA, mode: d.effectiveChargeMode, allowed: d.allowed },
    output, reason: d.reason, accounting: d.peakGuardAccounting,
    batterySupportW: d.batterySupportAllocatedW, importedAllowanceW: d.portfolioGridImportTargetW,
    sourceValid: a.evSessionDetection.modePowerSnapshot?.usable ?? false,
    siteW: a.getEvPhysicalSiteLoadW(), detectedW: a.evSessionDetection.detectedEvLoadW,
    minPlausibleEvW: Number(a.getEvElectricalSettingsFor(0).evMinCurrentA) * Math.sqrt(3) * 400
      * (1 - a.getEvModeLoadTolerancePercent({ evModeLoadTolerancePercent:
        a.getSettings()._ev1ModeLoadTolerancePercent }) / 100) };
}
(async () => { try {
  const logs = [];
  for (const name of ['Geplakte tekst(20261027-150928).txt', 'Geplakte tekst(20261028-151211).txt']) {
    const log = JSON.parse(fs.readFileSync(path.join(inputDir, name), 'utf8'));
    const configs = configurations(log), results = [];
    for (const e of log.ev.events) {
      if (e.kind !== 'ev_decision' || e.source !== 'emergency' || !e.peakGuardAccounting
        || e.inputs?.gridPowerW === null || e.inputs?.pvPowerW === null) continue;
      results.push(await snapshot(log, e, configs.get(e.configId)));
    }
    let sensitivity = null;
    if (name.includes('20261027')) {
      const e = log.ev.events.find(e => e.id === 'evt-79');
      sensitivity = await snapshot(log, e, configs.get(e.configId), { baselineOverride: 5500 });
      assert(sensitivity.output.allowed, 'An explicitly hypothetical lower baseline must account for the observed residual');
    }
    logs.push({ name, generatedAt: log.generatedAt, totalRecordedDecisions: log.ev.events.filter(e => e.kind === 'ev_decision').length,
      originalPublishedStops: log.ev.events.filter(e => e.kind === 'ev_command_published' && e.command?.mode === 'stop').map(e => ({ at: e.at, id: e.id })),
      testedEmergencyDecisions: results.length, newStopDecisions: results.filter(r => r.output.mode === 'stop').length,
      budgetStops: results.filter(r => r.output.stopReason === 'insufficient_safe_budget').length,
      restartHolds: results.filter(r => r.output.stopReason === 'restart_hold').length,
      activeToStop: results.filter(r => r.published.allowed && ['smart', 'standard'].includes(r.published.mode) && r.output.mode === 'stop').map(r => r.eventId),
      sensitivity, results });
    console.log(name, results.length, 'snapshots;', logs.at(-1).newStopDecisions, 'STOP outputs');
  }
  fs.writeFileSync(outputFile, JSON.stringify({ version: '1.2.5-house-publication-fix', inputBaselineZipSha256:
    '3cf65de95d6d9378fa3d5eff0f088169077999f39a09bfa5da868995b1297599',
    method: 'independent logged Emergency decision snapshots; real detector, allocator and output policy',
    exactContinuousInputReplay: false, physicalHardwareTested: false,
    assumptions: ['PV receipt timestamps absent: PV assumed fresh at each decision',
      'Recorded house baseline and published EV state restored per snapshot; omitted prehistory is not invented',
      'Only existing physical battery command is allowed; no unrecorded pending candidate grants support',
      'Recorded restart hold is restored when its remaining duration is explicitly logged',
      'The transient cfg-9 persisted widget goal contradicts the recorded Emergency runtime branch; the logged explicit-clear branch is restored for those snapshots',
      'The 5,500-W baseline sensitivity is hypothetical only and is not substituted for any historical measurement',
      'No between-snapshot P1 interpolation; new decisions are not propagated into a fictional physical plant'], logs }, null, 2) + '\n');
} finally { global.Date = NativeDate; Date.now = nativeNow; } })().catch(e => { console.error(e); process.exitCode = 1; });
