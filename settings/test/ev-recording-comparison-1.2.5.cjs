'use strict';
// Optional before/after audit: node --expose-gc this-file.cjs BASELINE_ROOT
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const { createRequire } = require('node:module'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function worker(source) {
  const req = createRequire(path.join(source, 'package.json'));
  const { fixture } = req('./test/ev-work-harness');
  const { installVirtualClearTimeout } = req('./test/pv-source-harness');
  const { emptyDay, emptyInventory } = req('./lib/savings');
  const NativeDate = Date, nativeNow = Date.now, restore = installVirtualClearTimeout();
  global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
  const results = [];
  try {
    for (const contract of ['fixed', 'tou', 'dynamic_quarter']) for (const [pv, battery] of [[0, 0], [9000, 0], [5000, -1000], [0, 6000]]) {
      const h = await fixture({ type: 'mode', evs: 1, batteries: 0, batteryEnabled: false, chargeAllowed: true,
        extra: { evIdleHouseLoadW: 4000, peakShaveEnabled: true, peakLimitW: 100000,
          dynamicPriceSource: 'external', dynamicPriceSources: ['external'] } });
      const a = h.app;
      await h.setExternalSetting('contractType', contract);
      if (contract === 'dynamic_quarter') {
        const start = Math.floor(h.now() / 900000) * 900000;
        const pricesPerInterval = Array.from({ length: 96 }, (_, i) => ({
          periodStart: new Date(start + i * 900000).toISOString(),
          periodEnd: new Date(start + (i + 1) * 900000).toISOString(), value: i % 2 ? .4 : .2 }));
        await h.cards.get('read_external_prices_json').listener({ source: 'external',
          curve: JSON.stringify({ pricesPerInterval }), period: 'next_hours' });
      }
      a.evSessionDetection.portfolioBaselineW = 4000; a.evBatteryHouseReferenceW = 4000;
      a.setEvSessionOverrideFor(0, 'emergency', 'flow'); await h.start(); await h.flush();
      const frame = async () => {
        h.setNow(h.now() + 1000); a.state.lastTotalCommandW = battery;
        await h.pv(pv); await h.grid(4000 + 8 * Math.sqrt(3) * 400 - pv - battery);
        a.runContextHeartbeat(); await a.runEvHeartbeat(); await h.flush();
      };
      for (let i = 0; i < 12; i++) await frame();
      a.savings.today = emptyDay(a.getSavingsDateKey()); a.savings.history = {};
      a.savings.inventory = emptyInventory(); a.savings.total = 0; a.savings.lastSampleAt = h.now();
      const commands = h.flexible.length;
      for (let i = 0; i < 120; i++) await frame();
      const { ev, ...siteDay } = a.savings.today;
      assert.deepEqual(h.errors, []);
      results.push({ contract, pv, battery, siteDay, inventory: a.savings.inventory, savingsTotal: a.savings.total,
        commands: h.flexible.slice(commands), mode: a.lastPublishedEvChargeMode, ev: ev.total });
    }
  } finally { restore(); global.Date = NativeDate; Date.now = nativeNow; }
  return results;
}
function run(source) {
  const p = spawnSync(process.execPath, [__filename, '--worker', source], { encoding: 'utf8', timeout: 120000 });
  assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout);
}
function methods(source) {
  const rows = [...source.matchAll(/^  (?:async )?([A-Za-z_]\w*)\([^\n]*/gm)];
  return Object.fromEntries(rows.map((r, i) => [r[1], source.slice(r.index, rows[i + 1]?.index ?? source.length).trimEnd()]));
}
if (process.argv[2] === '--worker') worker(path.resolve(process.argv[3])).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e); process.exitCode = 1; });
else {
  assert(process.argv[2], 'Supply the exact 1.2.4 baseline root');
  const baseline = path.resolve(process.argv[2]), before = run(baseline), after = run(root);
  for (let i = 0; i < before.length; i++) {
    const { ev: oldEv, ...oldSite } = before[i], { ev: newEv, ...newSite } = after[i];
    assert.deepEqual(newSite, oldSite, 'Site Savings, inventory, total, commands and mode must be identical');
    assert.equal(oldEv.kwh, 0); assert(newEv.kwh > 0);
    assert(Math.abs(newEv.pvKwh + newEv.gridKwh + newEv.batteryKwh + newEv.unknownKwh - newEv.kwh) < 1e-8);
  }
  const oldMethods = methods(fs.readFileSync(path.join(baseline, 'app.js'), 'utf8'));
  const newMethods = methods(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
  const changed = Object.keys(oldMethods).filter(name => oldMethods[name] !== newMethods[name]);
  // The optional baseline is still the exact pre-registration 1.2.4 source.
  // The same-version follow-up additionally changes house publication guards;
  // scheduling, allocation, source attribution and physical policy stay exact.
  const permitted = new Set(['getEvSavingsReadings', 'updateEvPortfolioLoadDetection', 'onInit',
    'recordEvHouseLoadSample', 'recordRecentEvHouseLoadSample', 'getEvStartHouseReference',
    'applyEvStartHouseReference', 'handleEvDetectionConnectionTransition', 'recordEvBatteryHouseReference',
    'publishEvDecision', 'publishAdditionalEvDecision', 'testEvOutput']);
  assert(changed.every(name => permitted.has(name)), JSON.stringify(changed));
  assert(changed.includes('getEvSavingsReadings') && changed.includes('updateEvPortfolioLoadDetection'));
  const unchangedModules = ['lib/flexible-loads.js', 'lib/ev-deadline-planner.js', 'lib/ev-session.js',
    'lib/ev-output-policy.js', 'lib/savings.js', 'lib/ev-energy-breakdown.js', 'lib/ev-dashboard.js'];
  for (const file of unchangedModules) assert(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(baseline, file))), file);
  const report = { simulatedHomey: true, physicalHardwareTested: false, financialScenarios: before.length,
    siteSavingsAndCommandsIdentical: true, changedAppMethods: changed, unchangedModules, before, after };
  fs.writeFileSync(path.join(root, 'validation/ev-recording-comparison-1.2.5.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Source, actuation and financial comparison:', before.length, 'scenarios passed');
}
