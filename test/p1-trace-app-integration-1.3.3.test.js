'use strict';
const assert = require('node:assert/strict');
const { boot, DEFAULTS } = require('./startup-harness');
(async () => {
  const store = new Map(Object.entries({ ...DEFAULTS,
    evCount: 0, hvacCount: 0, boilerCount: 0, batteryCount: 4, controlEnabled: true, contractType: 'tou' }));
  const h = await boot(store);
  assert.equal(h.app.p1TraceMonitor, undefined, 'no P1 instrumentation instance at idle');
  const started = h.app.startP1Trace();
  assert.equal(started.active, true);
  await h.cards.get('set_grid_power').listener({ power: 432 });
  await h.cards.get('set_grid_power_phases').listener({ power: 500, l1: 200, l2: 150, l3: 150 });
  const result = h.app.stopP1Trace();
  assert.equal(result.totalP1,2);
  assert.equal(result.withPhases,1);
  assert.equal(result.withoutPhases,1);
  assert.ok(result.stages.some(s=>s.name==='savings_sample'));
  assert.ok(result.stages.some(s=>s.name==='phase_guard_meter'));
  assert.ok(result.stages.some(s=>s.name==='fast_request' || s.name==='grid_recovery_request'));
  assert.ok(result.settingsReads>=2, 'real getSettings snapshots are counted');
  assert.ok(result.cycles[0].settingsReads>=1);
  assert.equal(h.errors.length,0,h.errors.join('\n'));
  assert.equal(h.app.clearP1Trace().session,null);
  console.log('P1 trace app integration: genuine Flow cards, both grid input modes, stage attribution and export validated');
})().catch(e=>{ console.error(e.stack||e); process.exitCode=1; });
