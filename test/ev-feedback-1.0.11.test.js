'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { setup, installVirtualClearTimeout } = require('./context-refresh-harness');

// All scheduler/input/control/output methods are real. Only Homey I/O, clock,
// physical meter values and the car's measured response are simulated.
const cases = [
  ...[16,14,8,6].map(amps => ({ name: `three-phase-${amps}A`, amps })),
  { name: 'single-phase-8A', amps: 8, phases: 1 },
  { name: 'hybrid-8A', amps: 8, type: 'hybrid' },
  { name: 'above-command-20A', amps: 20, independent: true, gridLimit: 20000, peakLimit: 22000 },
  { name: 'above-grid-budget', amps: 16, independent: true, gridLimit: 5000 },
  { name: 'new-command-with-existing-feedback', amps: 8, event: 'command' },
  { name: 'zero-current', amps: 8, event: 'zero' },
  { name: 'disconnect', amps: 8, event: 'disconnect' },
  { name: 'session-end', amps: 8, event: 'end' },
  { name: 'missing-feedback', amps: 8, missing: true, independent: true },
  { name: 'expired-and-restored-feedback', amps: 8, event: 'stale' },
  { name: 'tariff-disabled', amps: 8, tariffAllowed: false },
  { name: 'tariff-permission-change', amps: 8, event: 'tariff' },
  { name: 'scheduled-tariff-boundary', amps: 8, boundary: true },
  { name: 'grid-budget-change', amps: 8, event: 'budget' },
  { name: 'pv-and-house-variation', amps: 8, event: 'pv' },
  { name: 'planned-battery-charge', amps: 8, planned: true },
  { name: 'peak-guard', amps: 8, event: 'peak', peakLimit: 9000 },
  { name: 'explicit-battery-support', amps: 8, support: true, gridLimit: 3000 },
  { name: 'legacy-bypass-ignored', amps: 8, legacy: true },
  { name: 'mode-only-detection', type: 'mode', amps: 16 },
  { name: 'split-battery-outputs', amps: 8, split: true },
  { name: 'hybrid-battery-control', amps: 8, hybridBattery: true },
  { name: 'two-EVs-partial-feedback', amps: 8, multi: true },
  { name: 'pending-ev-publication', amps: 8, independent: true, pending: true },
];

async function replay(root, options) {
  const { evPowerPerAmp } = require(path.join(root, 'lib/flexible-loads'));
  const start = Date.parse(options.boundary ? '2026-10-14T20:59:00Z' : options.planned ? '2026-10-14T10:46:00Z' : '2026-10-14T20:45:00Z');
  const rate = { id: 'dal', name: 'Dal', importPrice: .2, feedInPrice: .03,
    weekdayChargeMode: options.planned ? 'always' : 'never', weekendChargeMode: options.planned ? 'always' : 'never',
    evChargeAllowed: options.tariffAllowed !== false, evPvChargeAllowed: true,
    ev2ChargeAllowed: true, ev2PvChargeAllowed: true, evMaxGridImportW: options.gridLimit ?? 15000 };
  const cfg = { forcedMode: options.planned ? 'auto' : 'self_consumption',
    evCount: options.multi ? 2 : 1, evEnabled: true, evSocEnabled: false, evControlType: options.type || 'current', evMode: 'smart',
    evPhases: options.phases || 3, evVoltage: options.phases === 1 ? 230 : 400,
    evVoltageReference: options.phases === 1 ? 'phase' : 'line',
    evMinCurrentA: 6, evMaxCurrentA: 16, evStandardCurrentA: 16, evCommandIntervalSeconds: 7,
    evSmartGridPriority: 'ev_first', evPeakGuardBatteryAssistNormal: Boolean(options.support),
    evPeakGuardBatteryAssistEmergency: false, evNightSurplusChargeEnabled: false, evGuaranteeTarget: false,
    evPvGridTopUpMode: 'off', contractType: options.planned ? 'fixed' : 'tou',
    fixedChargeWindowStart:'11:00', fixedChargeWindowEnd:'17:00', evFixedChargeWindowEnabled:true, evFixedMaxGridImportW:15000, peakLimitW: options.peakLimit || 16000, peakSoftMarginW: 0,
    exportLimitEnabled: false, touRates: [rate],
    touSchedule: [{ rateId: 'dal', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    hybridEmsEnabled: Boolean(options.hybridBattery) };
  if (options.boundary) {
    cfg.touRates.push({ ...rate, id: 'piek', evChargeAllowed: false });
    cfg.touSchedule = [{ rateId: 'dal', start: '00:00', end: '23:00', days:[1,2,3,4,5,6,7] },
      { rateId: 'piek', start: '23:00', end: '00:00', days:[1,2,3,4,5,6,7] }];
  }
  if (options.multi) Object.assign(cfg, { ev2Enabled: true, ev2SocEnabled: false, ev2ControlType: 'current', ev2Mode: 'smart',
    ev2Phases: 1, ev2Voltage: 230, ev2VoltageReference: 'phase', ev2MinCurrentA: 6, ev2MaxCurrentA: 16, ev2StandardCurrentA:16 });
  if (options.split) Object.assign(cfg, { splitCommandBattery1Enabled: true, splitCommandBattery2Enabled: true });
  if (options.legacy) Object.assign(cfg, { evSkipFeedbackValidation: true, evFeedbackTolerancePercent: 5 });
  const h = await setup(root, cfg, start, 0), a = h.app;
  // Remove the old harness conveniences: these guards/budgets must run for real.
  delete a.getPlannedBatteryGridLimitW;
  delete a.isChargeTestValid;
  h.store.set('_chargeTestSignature', a.getChargeTestSignature(h.settings));
  a.state.pvProducingDate = '2026-10-14';
  if (options.planned) a.state.targetSocOverride = 80;
  const perAmp = evPowerPerAmp(h.settings), status = h.cards.get('set_ev1_status');
  const requests = [], samples = [], splitTraces = [];
  const request = a.requestContextEvaluate.bind(a);
  a.requestContextEvaluate = (...args) => { const result = request(...args);
    requests.push({ at: h.now(), reason: args[1], due: a.contextTimerAt }); return result; };
  for (const [id, card] of h.cards) if (/^split_command_battery[1-8]_(charge|discharge)/.test(id)) {
    card.trigger = async tokens => { splitTraces.push({ at:h.now(), id, tokens }); };
  }
  let releaseEv = null;
  if (options.pending) {
    const evTrigger = a.evCurrentTrigger.trigger;
    a.evCurrentTrigger.trigger = async tokens => {
      await evTrigger(tokens);
      if (tokens.charge_current > 0 && !releaseEv) await new Promise(resolve => { releaseEv = resolve; });
    };
  }
  await h.start();
  if (!options.missing) { await status.listener({ connected: 'yes', charge_current: 0 }); await h.drain(); }
  if (options.missing) { a.state.evConnected = true; a.inputSeen.ev.connected = true; a.inputUpdatedAt.ev.connected = start; a.requestContextEvaluate(true, 'test_connection'); }
  if (options.multi) { await h.cards.get('set_ev2_status').listener({connected:'yes',charge_current:0}); await h.drain(); }
  let commandFeedbackCheck = null;
  for (let i = 1; i <= 240; i++) {
    h.setNow(start + i * 1000);
    if (options.pending && i === 15 && releaseEv) { const done = releaseEv; releaseEv = () => {}; done(); await h.drain(); }
    if (i === 90 && ['command','tariff','budget'].includes(options.event)) {
      if (options.event === 'command') h.settings.evStandardCurrentA = 10;
      if (options.event === 'tariff') rate.evChargeAllowed = false;
      if (options.event === 'budget') rate.evMaxGridImportW = 0;
      a.requestContextEvaluate(true, `setting:${options.event}`); await h.drain();
      if (options.event === 'command') commandFeedbackCheck = {
        measurementAt:a.inputUpdatedAt.ev.chargeCurrent, publicationAt:a.lastEvPublishedAt,
        active:a.getEvGridImportControlStatus(h.settings,h.now()).activeTargetW };
    }
    if (i === 90 && options.event === 'end') { await h.cards.get('end_ev1_charging_session').listener({}); await h.drain(); }
    let requested = options.type === 'mode'
      ? a.getEvModeEstimatedCurrentA(a.lastPublishedEvChargeMode, h.settings) * (a.lastPublishedEvChargeMode === 'stop' ? 0 : 1)
      : Number(a.lastPublishedEvCurrentA) || 0;
    const independent = options.independent && (options.name !== 'above-grid-budget' || i >= 90);
    let actualA = independent ? options.amps : Math.min(requested, options.amps);
    if (i >= 90 && ['zero','disconnect','end'].includes(options.event)) actualA = 0;
    const house = options.event === 'peak' && i >= 90 ? 7500 : options.event === 'pv' && i >= 120 ? 1600 : 623;
    const pv = options.event === 'pv' ? (i < 80 ? 0 : i < 160 ? 9000 : 4000) : 0;
    const extraA = options.multi ? Math.min(Number(a.getExtraEv(1)?.lastPublishedCurrentA)||0, 6) : 0;
    await h.grid(house + actualA * perAmp + extraA * 230 - pv - a.state.lastTotalCommandW);
    if (pv !== a.state.pvPowerW) await h.pv(pv);
    const send = !options.missing && !(options.event === 'stale' && i > 30 && i < 180);
    if (send && i % 5 === 0) {
      await status.listener({ connected: options.event === 'disconnect' && i >= 90 ? 'no' : 'yes', charge_current: options.type === 'mode' ? 0 : actualA });
      await h.drain();
    }
    // EV2 deliberately stops returning current feedback after 30 s.
    if (options.multi && i % 5 === 0 && i <= 30) { await h.cards.get('set_ev2_status').listener({connected:'yes',charge_current:extraA}); await h.drain(); }
    if (i % 60 === 0) { await a.runEvHeartbeat(); a.runContextHeartbeat(); await h.drain(); }
    await h.flush();
    const state = a.getEvGridImportControlStatus(h.settings, h.now());
    if (i % 5 === 0) samples.push({ second:i, actualA, actualEvW:Math.round(actualA*perAmp), house, pv,
      publishedA:a.lastPublishedEvCurrentA, desiredA:a.latestEvDecision?.desiredCurrentA,
      active:state.activeTargetW, requested:state.requestedTargetW, controlState:state.state,
      batteryW:a.state.lastTotalCommandW, commands:[...a.lastEmittedCommands],
      mode:a.latestResult?.baseMode, override:a.latestResult?.override || '', targetSoc:a.latestResult?.targetSoc,
      planningEligible:a.latestResult?.tariff?.planningWindowEligibleNow, nextPlan:a.latestResult?.planningNextChargeStartAt,
      physicalGridW:Math.round(house + actualA*perAmp + extraA*230 - pv - a.state.lastTotalCommandW),
      feedbackAt:a.inputUpdatedAt.ev?.chargeCurrent, publicationAt:a.lastEvPublishedAt });
    assert(state.activeTargetW <= Math.max(0, a.state.gridPowerW + a.state.lastTotalCommandW) + 2,
      `${options.name}: allowance must exclude signed battery charging/discharge`);
  }
  assert.equal(h.errors.length, 0, h.errors.join('\n'));
  assert(h.contexts.length > 1 && requests.length > 1, 'real context requests and execution must occur');
  for (const trace of h.traces) assert.equal(trace.total, trace.commands.reduce((sum,w) => sum+w,0));
  return { name:options.name, final:samples.at(-1), commandFeedbackCheck, samples,
    batteryPublishes:h.traces, evPublishes:h.flexible.filter(x=>/^ev/.test(x.id)),
    splitPublishes:splitTraces, contexts:h.contexts, requests,
    fastEvaluations:a.diagnostics.counters.fastEvaluations || 0, statusPublishes:a.diagnostics.counters.statusPublishes || 0 };
}

function verify(results) {
  const byName = name => results.find(r=>r.name===name);
  for (const name of ['three-phase-16A','three-phase-14A','three-phase-8A','three-phase-6A','single-phase-8A','hybrid-8A','above-command-20A','legacy-bypass-ignored']) {
    const r = byName(name); assert(Math.abs(r.final.batteryW-623)<30, `${name}: EV must stay on grid, house on battery: ${JSON.stringify(r.final)}`);
    assert(Math.abs(r.final.active-r.final.actualEvW)<2, `${name}: allowance must be measured EV watts`);
  }
  for (const name of ['zero-current','disconnect','session-end','missing-feedback','tariff-disabled','tariff-permission-change','scheduled-tariff-boundary','grid-budget-change']) {
    assert.equal(byName(name).final.active,0,`${name}: no obsolete EV allowance`);
  }
  const changed = byName('new-command-with-existing-feedback');
  assert(changed.commandFeedbackCheck.measurementAt < changed.commandFeedbackCheck.publicationAt);
  assert(changed.commandFeedbackCheck.active > 0, 'new command must not invalidate earlier fresh feedback');
  assert(Math.abs(changed.final.batteryW-623)<30);
  const stale = byName('expired-and-restored-feedback');
  assert.equal(stale.samples.find(s=>s.second===95).active,0);
  assert(stale.final.active>0 && Math.abs(stale.final.batteryW-623)<30);
  assert(byName('above-grid-budget').samples.every(s=>s.active<=5000));
  assert.equal(byName('above-grid-budget').samples.find(s=>s.second===90).active,5000, 'above-command feedback is valid but capped to the net budget while context refresh waits');
  assert(byName('pv-and-house-variation').samples.some(s=>s.batteryW < -1000),'PV surplus must still charge batteries');
  assert(byName('planned-battery-charge').samples.some(s=>s.batteryW < -500),'planned battery charge must still publish');
  assert(byName('peak-guard').samples.filter(s=>s.second>=180).every(s=>s.physicalGridW<=9010),'Peak Guard sees raw physical grid');
  assert(byName('pending-ev-publication').samples.find(s=>s.second===10).active>0, 'real measured load can release permitted import while an EV publication waits');
  assert(byName('two-EVs-partial-feedback').final.active>0,'missing EV2 feedback must not hide measured EV1 power');
  assert(byName('split-battery-outputs').batteryPublishes.length>0);
  assert(byName('split-battery-outputs').splitPublishes.length>0, 'real Split Command mode/power outputs must be captured');
  assert(byName('explicit-battery-support').final.batteryW > 3000, 'explicit EV battery support must remain active');
}

async function verifyInputContracts(root) {
  const start = Date.parse('2026-10-14T20:45:00Z');
  const h = await setup(root, {evCount:4}, start, 0), a=h.app;
  for (let index=0; index<4; index++) {
    const flow = h.cards.get(`set_ev${index+1}_status`);
    assert.equal(await flow.listener({connected:'yes',charge_current:8}),true);
    const at=a.getEvInputSnapshot(index).updatedAt.chargeCurrent;
    h.setNow(start+1000);
    for (const value of [null,undefined,'',false,NaN,Infinity,-1,'invalid']) {
      assert.equal(await flow.listener({connected:'yes',charge_current:value}),false);
      assert.equal(a.getEvInputSnapshot(index).updatedAt.chargeCurrent,at);
    }
    assert.equal(a.getEvMeasuredCurrent(index,undefined,start+60000).fresh,true);
    assert.equal(a.getEvMeasuredCurrent(index,undefined,start+60001).fresh,false);
    assert.equal(await flow.listener({connected:'yes',charge_current:0}),true);
    assert.equal(a.getEvMeasuredCurrent(index).currentA,0);
    h.setNow(start);
  }
  // A malformed API field must not refresh an old measurement either.
  await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:8});
  const at=a.inputUpdatedAt.ev.chargeCurrent;
  h.setNow(start+1000);
  for (const chargeCurrentA of [null,'',false,-1,'invalid']) {
    await a.setInput({ev:{chargeCurrentA}});
    assert.equal(a.inputUpdatedAt.ev.chargeCurrent,at);
    assert.equal(a.state.evChargeCurrentA,8);
  }
}

async function run(root = path.join(__dirname,'..'), validate = true) {
  const realNow = Date.now, restore = installVirtualClearTimeout();
  try { const results=[]; for (const options of cases) results.push(await replay(root,options)); if (validate) { verify(results); await verifyInputContracts(root); } return results; }
  finally { Date.now=realNow; restore(); }
}
if (require.main===module) run().then(results => {
  console.log(`1.0.11 measured EV feedback: ${results.length} real-scheduler scenarios passed.`);
  console.table(results.map(r=>({scenario:r.name,measuredA:r.final.actualA,EVgridW:r.final.active,batteryW:r.final.batteryW,batteryPublishes:r.batteryPublishes.length})));
}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports = { run, cases, verify, replay };
