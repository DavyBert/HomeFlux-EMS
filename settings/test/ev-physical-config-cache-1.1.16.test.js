'use strict';
const assert = require('node:assert/strict');
const { fixture } = require('./ev-work-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const restore = installVirtualClearTimeout();

(async () => { try {
  const h = await fixture({type:'mode', evs:2, chargeAllowed:true, batteries:0, batteryEnabled:false});
  const a = h.app;
  const readFast = (index) => {
    const settings = a.getSettings(), now = h.now();
    const observation = { settings, at: now, instances: [], control: null, trustedPhysicalConfig: true };
    return a.getEvPhysicalObservationSettings(index, settings, now, observation, 'grid_import_control');
  };
  const initial = readFast(0);
  assert.strictEqual(readFast(0), initial, 'canonical fast P1 configuration is reused');
  assert.strictEqual(readFast(1), readFast(1), 'second EV has separate memo');

  // Direct callers and overridden snapshots must always use their own input,
  // never the app-level P1 memo.
  const override = { ...a.getSettings(), evPhases:1, evVoltage:230, evVoltageReference:'phase' };
  const projectedOverride = a.getEvPhysicalAccountingSettingsFor(0, override);
  assert.equal(projectedOverride.evPhases, 1);
  assert.equal(projectedOverride.evVoltage, 230);
  assert.notStrictEqual(projectedOverride, initial);
  assert.notStrictEqual(a.getEvPhysicalAccountingSettingsFor(0,a.getSettings()), initial);

  // Internal Homey setting writes must invalidate synchronously, even before
  // its separate asynchronous `set` event runs.
  a.setSetting('evPhases', 1);
  const changed = readFast(0);
  assert.equal(changed.evPhases, 1);
  assert.notStrictEqual(changed, initial);
  assert.strictEqual(readFast(0), changed);

  // External settings writes use the existing Homey `set` listener.
  await h.setExternalSetting('evVoltage', 230);
  const external = readFast(0);
  assert.equal(external.evVoltage, 230);
  assert.notStrictEqual(external, changed);

  // TOU policy changes must invalidate the memo synchronously; tariff
  // boundaries themselves are still evaluated fresh every P1.
  const old = readFast(0);
  const rates = a.getSettings().touRates;
  const originalAllowed = Boolean(rates[0].evChargeAllowed);
  a.setSetting('touRates', rates.map(rate=>({ ...rate, evChargeAllowed:!originalAllowed })));
  const mutated = readFast(0);
  assert.equal(mutated.touRates[0].evChargeAllowed, !originalAllowed);
  assert.notStrictEqual(mutated, old);
  a.setSetting('touRates', rates);
  assert.equal(readFast(0).touRates[0].evChargeAllowed, originalAllowed);

  // Do not invalidate physical config when a SoC plan changes; it contains no
  // target, deadline, session or tariff-time data.
  const beforePlan = readFast(0);
  await h.cards.get('set_ev1_soc_deadline').listener({target_soc:100,time:'07:00',guarantee:'yes'});
  assert.strictEqual(readFast(0), beforePlan);

  // Start the monitor after the memo was populated; reuse should be visible
  // without making it create a new physical or EV-planning calculation.
  a.inputMonitor.start();
  for (let i=0; i<20; i++) readFast(0);
  const report = a.inputMonitor.stop();
  assert.equal(report.planningEvents['physical_config_reused:ev1'],20);
  assert(!report.calculations.some(r=>r.kind==='evPhysicalSettingsRead' || r.kind==='evDecision'));
  console.log('1.1.16 EV physical config cache: stable reuse, internal/external invalidation, TOU change invalidation, override isolation, plan independence and passive monitoring passed.');
} finally { restore(); } })().catch(err => { console.error(err); process.exitCode=1; });
