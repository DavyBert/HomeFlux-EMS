'use strict';
// Compare the previous 1.0.8 with source-only presentation deferred to slow
// housekeeping. All Homey I/O is mocked; this is not a hardware CPU benchmark.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
if (!process.argv[2]) {
  console.error('Usage: node test/charge-source-cpu-comparison.js /path/to/previous-1.0.8');
  process.exit(1);
}
const roots = [path.resolve(process.argv[2]), path.join(__dirname, '..')];
const realNow = Date.now, realClear = global.clearTimeout;
global.clearTimeout = timer => {
  if (timer && typeof timer === 'object' && 'due' in timer) timer.done = true;
  else realClear(timer);
};
async function replay(root, scenario) {
  const filename = root + '/test/fast-control-audit-1.0.6.test.js';
  const prefix = fs.readFileSync(filename, 'utf8').split('async function run()')[0];
  const mod = { exports: {} };
  new Function('require', 'module', prefix + '\nmodule.exports={setup,drain,setNow:v=>now=v};')(createRequire(filename), mod);
  const { setup, drain, setNow } = mod.exports;
  let at = Date.parse('2026-10-13T10:46:00Z'); setNow(at);
  const pvBase = scenario === 'gridNoise' ? 0 : 1495;
  const tou = scenario === 'mixedTOU';
  const h = await setup({ optimizeMultiBatteryEfficiency: true, commandIntervalSeconds: 7, peakLimitW: 2650,
    fixedChargeWindowStart: '11:00', fixedChargeWindowEnd: '17:00', gridZeroMinW: -10, gridZeroMaxW: 20,
    pvDeltaThresholdW: 25, ...(tou ? { contractType: 'tou', touRates: [
      { id: 'low', name: 'Dal', importPrice: .2, feedInPrice: .03, weekdayChargeMode: 'always', weekendChargeMode: 'always' },
      { id: 'peak', name: 'Piek', importPrice: .3, feedInPrice: .03, weekdayChargeMode: 'never', weekendChargeMode: 'never' }],
    touSchedule: [
      { rateId: 'low', start: '11:00', end: '17:00', days: [1,2,3,4,5,6,7] },
      { rateId: 'peak', start: '17:00', end: '23:59', days: [1,2,3,4,5,6,7] }] } : {}) }, 623 - pvBase, 0);
  h.app.state.batterySoc = [57.8,57.8,57.8,57.8]; h.app.state.targetSocOverride = 80;
  h.app.state.pvProducingDate = '2026-10-13'; h.app.state.pvPowerW = pvBase;
  h.app.queueStatusUpdate = Object.getPrototypeOf(h.app).queueStatusUpdate.bind(h.app);
  const traces = [];
  h.app.commandTrigger.trigger = async tokens => traces.push({ at: Date.now(), total: tokens.total_command,
    batteries: [1,2,3,4].map(i => tokens[`battery${i}command`]),
    mode: h.app.latestResult.baseMode, override: h.app.latestResult.override });
  h.app.refreshControlContext(h.settings, h.app.getEvaluationState(h.settings, at), at);
  h.app.requestEvaluate(true); await drain();
  h.app.lastSlowHeartbeatAt = at;
  const cpuStart = process.cpuUsage();
  for (let i = 1; i <= 600; i++) {
    at += 1000; setNow(at);
    let pv = pvBase, house = 623;
    if (scenario === 'variablePV') pv += Math.floor(i/10)%2 ? 50 : -50;
    if (scenario === 'cloudsAndPeakGuard') {
      pv = [1495,4500,0,800,2500,1495][Math.floor(i/50)%6];
      house = [623,3600,900,200,623][Math.floor(i/75)%5];
    }
    if (scenario === 'socAndModes' && [120,240,360,480].includes(i)) {
      if (i === 120) h.app.state.batterySoc = [57.8,60,62,100];
      if (i === 240) h.app.inputSeen.batterySoc[1] = false;
      if (i === 360) { h.app.inputSeen.batterySoc[1] = true; h.settings.forcedMode = 'self_consumption'; }
      if (i === 480) h.settings.forcedMode = 'auto';
      h.app.refreshControlContext(h.settings, h.app.getEvaluationState(h.settings, at), at);
      h.app.requestEvaluate(true); await drain();
    }
    if (i%60 === 0) h.app.refreshControlContext(h.settings, h.app.getEvaluationState(h.settings, at), at);
    const grid = house - pv - h.app.state.lastTotalCommandW + (i%3 - 1)*3;
    if (pv !== h.app.state.pvPowerW) { await h.cards.get('set_pv_power').listener({ power: pv }); await drain(); }
    await h.cards.get('set_grid_power').listener({ power: grid }); await drain();
    if (i%60 === 0) { h.app.runSlowHeartbeatHousekeeping(at, h.settings); await drain(); }
    for (const timer of h.timers.slice()) if (!timer.done && timer.due <= at) { timer.done = true; timer.fn(); await drain(); }
  }
  const cpu = process.cpuUsage(cpuStart);
  assert.equal(h.errors.length, 0, h.errors.join('\n'));
  return { p1Updates: 600, counters: h.app.diagnostics.counters, sections: h.app.diagnostics.cpuSections,
    processCpuMs: (cpu.user + cpu.system)/1000, traces };
}
(async () => {
  const scenarios = {};
  for (const name of ['gridNoise','mixedNoise','mixedTOU','variablePV','cloudsAndPeakGuard','socAndModes']) {
    const before = await replay(roots[0], name), after = await replay(roots[1], name);
    assert.deepEqual(after.traces, before.traces, `${name}: every per-battery output, mode, override and publication time must match`);
    if (name === 'mixedNoise' || name === 'mixedTOU') {
      assert(after.counters.fastEvaluations < before.counters.fastEvaluations/5);
      assert(after.counters.statusPublishes < before.counters.statusPublishes/5);
      assert(after.counters.fastChargeSourceOnlySkipped > 0);
    }
    scenarios[name] = { before, after };
  }
  console.log(JSON.stringify({ identicalTimedBatteryTraces: true, scenarios }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Date.now = realNow; global.clearTimeout = realClear; });
