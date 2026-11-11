'use strict';
// Exercise the real settings-change listener, status endpoint and renderer.
// Homey I/O is mocked; no browser or physical battery is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = require('../lib/active-injection');
const api = require('../api');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const { boot } = require('./startup-harness');
const { createTranslator } = require('../settings/display-language');
const originalNow = Date.now, restore = installVirtualClearTimeout();
let checks = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const yes = (value, label) => { assert(value, label); checks++; };
const html = fs.readFileSync(require.resolve('../settings/index.html'), 'utf8');
const uiCode = html.slice(html.indexOf('  function updateInjectionUi()'), html.indexOf("  for(const action of ['start','stop'])"));
async function fresh(extra = {}) {
  const h = await setup(undefined, { injectionEnabled: true, injectionTargetW: 3000,
    exportLimitEnabled: true, minimumExportW: 2000, fixedImportPrice: 1,
    peakShaveEnabled: false, ...extra }, Date.parse('2026-11-09T16:46:00Z'), 0);
  await h.drain();
  h.app.requestContextEvaluate = () => {};
  h.app.requestEvaluate = () => {};
  equal(h.errors, [], 'startup without errors');
  return h;
}
(async () => { try {
  const h = await fresh(), a = h.app;
  let s = I.status(a);
  equal([s.requestedTargetW, s.targetW, s.exportLimitW, s.targetLimitedByExportLimit], [3000, 2000, 2000, true]);
  equal(a.getSettings().injectionTargetW, 3000, 'status does not replace the saved request');
  await h.setExternalSetting('injectionTargetW', 5000);
  s = await api.getStatus({ homey: { app: a } });
  equal(a.getSettings().injectionTargetW, 5000, 'real save listener persists 5000 W');
  equal([s.injection.requestedTargetW, s.injection.targetW], [5000, 2000], 'live endpoint separates request and bounded target');
  equal(s.injection.active, false, 'a target in the status does not start injection');
  const limitedStatus = structuredClone(s.injection);

  for (const [requested, enabled, limit, permission, expected, limited] of [
    [1000, true, 2000, true, 1000, false], [2000, true, 2000, true, 2000, false],
    [3000, true, 2000, true, 2000, true], [5000, true, 2000, true, 2000, true],
    [5000, false, 2000, true, 5000, false], [5000, true, 0, true, 0, true],
    [5000, true, 6000, true, 5000, false], [5000, true, 2000, false, 2000, true],
  ]) {
    for (const [key, value] of Object.entries({ injectionTargetW: requested, exportLimitEnabled: enabled,
      minimumExportW: limit, injectionEnabled: permission })) await h.setExternalSetting(key, value);
    s = I.status(a);
    equal(s.requestedTargetW, requested, 'saved request');
    equal(s.targetW, expected, 'existing export limit is retained');
    equal(s.exportLimitW, enabled ? limit : null, 'disabled limits are not reported as active');
    equal(s.targetLimitedByExportLimit, limited, 'warning appears only if the goal is reduced');
    equal(I.target(a, a.getSettings()), expected, 'control-target calculation unchanged');
    equal(I.engineState(a, a.getSettings()).injectionTargetW, 0, 'inactive status cannot activate a target');
    equal(s.active, false);
  }
  const before = JSON.stringify([...h.store]), timers = h.timers.length;
  const runtime = JSON.stringify(a.injectionRuntime), outputs = h.traces.length;
  for (let i = 0; i < 50; i++) I.status(a);
  equal(JSON.stringify([...h.store]), before, 'status reads never save settings');
  equal(JSON.stringify(a.injectionRuntime), runtime, 'status reads do not change injection state');
  equal(h.timers.length, timers, 'no additional timers');
  equal(h.traces.length, outputs, 'no output commands from status reads');

  const restarted = await boot(new Map(h.store));
  equal(restarted.app.getSettings().injectionTargetW, 5000, 'saved goal survives restart');
  equal(I.status(restarted.app).requestedTargetW, 5000);
  equal(I.status(restarted.app).targetW, 2000);

  // A live session must still pass the bounded goal to the existing regulator.
  const live = await fresh({ injectionTargetW: 5000 });
  await I.start(live.app);
  equal(I.status(live.app).active, true);
  equal(I.engineState(live.app, live.app.getSettings()).injectionTargetW, 2000);
  equal(I.status(live.app).requestedTargetW, 5000);
  I.stop(live.app); await live.drain();
  equal(I.status(live.app).active, false);
  equal(I.status(live.app).requestedTargetW, 5000);
  equal(I.locked(live.app), false);

  const ids = vm.runInNewContext(html.match(/const ids = (\[[\s\S]*?\]);/)[1]);
  const numeric = vm.runInNewContext(html.match(/const numeric = new Set\((\[[\s\S]*?\])\);/)[1]);
  equal(ids.filter(id => id === 'injectionTargetW').length, 1, 'field bound once for load/save');
  yes(numeric.includes('injectionTargetW'), 'power is saved as a number');
  const notes = JSON.parse(fs.readFileSync('.homeychangelog.json', 'utf8'))['1.3.1'];
  const readme = fs.readFileSync('README.md', 'utf8');
  for (const lang of ['nl', 'en', 'fr', 'de', 'es']) {
    const dictionary = JSON.parse(fs.readFileSync('settings/translations/' + lang + '.json', 'utf8'));
    const t = createTranslator(dictionary), nodes = new Map();
    function q(id) {
      if (!nodes.has(id)) nodes.set(id, { checked: false, value: '', textContent: '',
        addEventListener() {}, classList: { toggle() {} } });
      return nodes.get(id);
    }
    q('injectionTargetW').value = '5000';
    const context = vm.createContext({ q, translateUiText: t,
      window: { HomeFluxSettingsHelp: { refresh() {} } }, document: {} });
    vm.runInContext(uiCode, context);
    for (const label of ['Netinjectiedoel na exportbegrenzing (W)', 'Begrensd door', 'Minimum export behouden (W)']) {
      if (lang !== 'nl' || label !== 'Minimum export behouden (W)')
        yes(typeof dictionary.exact[label] === 'string', lang + ': translation present: ' + label);
      if (lang !== 'nl') yes(t(label) !== label, lang + ': translated');
    }
    context.renderInjectionStatus(limitedStatus);
    yes(q('injectionStatus').textContent.includes(t('Gewenste netinjectie (W)') + ': 5000'), lang + ': saved request displayed');
    yes(q('injectionStatus').textContent.includes(t('Netinjectiedoel na exportbegrenzing (W)') + ': 2000'), lang + ': bounded target displayed');
    yes(q('injectionStatus').textContent.includes(t('Begrensd door') + ': ' + t('Minimum export behouden (W)')), lang + ': limiting setting named');
    equal(q('injectionTargetW').value, '5000', 'render does not overwrite form');
    // Drafts do not pretend to be saved settings or silently change control.
    q('injectionTargetW').value = '7000';
    context.renderInjectionStatus(limitedStatus);
    yes(q('injectionStatus').textContent.includes(t('Gewenste netinjectie (W)') + ': 5000'));
    equal(q('injectionTargetW').value, '7000');
    context.renderInjectionStatus({ ...limitedStatus, targetW: 5000, exportLimitW: null, targetLimitedByExportLimit: false });
    yes(q('injectionStatus').textContent.includes(t('Gewenste netinjectie (W)') + ': 5000'));
    equal(q('injectionStatus').textContent.includes(t('Netinjectiedoel na exportbegrenzing (W)')), false);
    // Be tolerant of an old backend payload during an app update.
    const legacy = { ...limitedStatus }; delete legacy.requestedTargetW; delete legacy.targetLimitedByExportLimit;
    context.renderInjectionStatus(legacy);
    yes(q('injectionStatus').textContent.includes(t('Gewenste netinjectie (W)') + ': 2000'));
    context.renderInjectionStatus({});
    equal(q('injectionStatus').textContent.includes('NaN'), false);
    equal(q('injectionStatus').textContent.includes('undefined'), false);
    yes(readme.includes(notes[lang]), lang + ': release notes consistent');
  }
  console.log(`Injection target status 1.3.1: ${checks} checks passed (real settings/status, restart, active control and five-language renderer; no browser).`);
} finally { Date.now = originalNow; restore(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
