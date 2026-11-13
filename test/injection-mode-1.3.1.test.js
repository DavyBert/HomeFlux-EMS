'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I = require('../lib/active-injection');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const { boot } = require('./startup-harness');
const originalNow = Date.now;
const restore = installVirtualClearTimeout();
let checks = 0, stage = 'metadata';
const watchdog = setTimeout(() => { console.error(`Mode regression stalled at ${stage} (${checks} checks)`); process.exit(1); }, 30000);
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
async function fresh(extra = {}, scheduled = false) {
  const h = await setup(undefined, { injectionEnabled: true, fixedImportPrice: 1,
    exportLimitEnabled: false, peakShaveEnabled: false, ...extra }, undefined, 0);
  await h.drain();
  if (!scheduled) { h.app.requestContextEvaluate = () => {}; h.app.requestEvaluate = () => {}; }
  equal(h.errors, [], 'clean startup');
  return h;
}
const modeFlow = (h, mode) => h.cards.get('set_forced_mode').listener({ mode });
const condition = (h, mode) => h.cards.get('ems_mode_is').listener({ mode });
function display(app, expected) {
  equal(app.getEmsControlMode(), expected, 'effective mode');
  equal(app.getEmsDeviceSnapshot().mode, expected, 'paired device mode');
  equal(app.getPublicStatus().forcedMode, expected, 'public/widget mode');
}
(async () => {
  try {
    // The real Advanced Flow card, Compose source, compiled manifest, picker and
    // condition all use the same stable identifier and all five language labels.
    const root = path.resolve(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json')));
    const declaration = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/flow/actions/set_forced_mode.json')));
    const value = declaration.args[0].values.find(v => v.id === 'injection');
    equal(Boolean(value), true, 'Flow dropdown has Injection');
    equal(value.title.nl, 'Injecteren');
    for (const [kind, id] of [['actions', 'set_forced_mode'], ['conditions', 'ems_mode_is']]) {
      const source = JSON.parse(fs.readFileSync(path.join(root, `.homeycompose/flow/${kind}/${id}.json`)));
      equal(manifest.flow[kind].find(c => c.id === id).args, source.args, `${id} manifest equals Compose`);
    }
    const cap = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/capabilities/ems_control_mode.json')));
    equal(manifest.capabilities.ems_control_mode.values, cap.values, 'capability manifest equals Compose');
    for (const lang of ['nl', 'en', 'fr', 'de', 'es']) {
      equal(typeof value.title[lang], 'string', `Flow label ${lang}`);
      equal(JSON.parse(fs.readFileSync(path.join(root, `locales/${lang}.json`))).widget.status.modeInjection,
        value.title[lang], `widget label ${lang}`);
    }
    const widgetHtml = fs.readFileSync(path.join(root, 'widgets/status/public/index.html'), 'utf8');
    const widgetCode = [...widgetHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
    const widget = vm.createContext({ Date, Number, String, Math, console, document: {} });
    vm.runInContext(widgetCode, widget);
    for (const lang of ['nl', 'en', 'fr', 'de', 'es']) {
      const locale = JSON.parse(fs.readFileSync(path.join(root, `locales/${lang}.json`)));
      const Homey = { __: key => key.split('.').reduce((v, k) => v?.[k], locale) || key };
      equal(widget.emsMode({ forcedMode: 'injection' }, Homey), value.title[lang], 'widget shows translated injection');
      equal(widget.emsMode({ forcedMode: 'auto' }, Homey), locale.widget.status.modeAuto, 'widget shows Auto after stop');
    }
    equal(manifest.version, '1.3.3');
    for (const file of ['package.json', '.homeycompose/app.json', 'package-lock.json'])
      equal(JSON.parse(fs.readFileSync(path.join(root, file))).version, '1.3.3', file);

    stage = 'stage-0';
    // No implicit permission changes; a disabled selection succeeds as Auto,
    // even when the previous mode was Standby or manual charging.
    for (const previous of ['auto', 'self_consumption', 'solar_capture', 'avoid_import', 'manual_charge', 'standby']) {
      const h = await fresh({ injectionEnabled: false, forcedMode: previous });
      equal(await modeFlow(h, 'injection'), true, 'disabled Flow does not fail');
      display(h.app, 'auto');
      equal(h.app.getSettings().injectionEnabled, false, 'permission remains off');
      equal(h.app.getSettings().forcedMode, 'auto', 'stored strategy is auto');
      equal(I.locked(h.app), false, 'no export / EV lock');
      equal(h.app.overrideResumeTimer, null, 'no tariff resume timer for injection');
      equal(await condition(h, 'injection'), false);
    }

    stage = 'stage-1';
    // A mode request actually starts the existing controller, with permission
    // and normal gates. The underlying persisted strategy stays Auto.
    let h = await fresh({ forcedMode: 'standby', injectionAutomaticEnabled: true }), a = h.app;
    let starts = 0, stops = 0;
    a.injectionStartedTrigger.trigger = async () => { starts++; };
    a.injectionStoppedTrigger.trigger = async () => { stops++; };
    equal(await modeFlow(h, 'injection'), true);
    equal(a.injectionRuntime.active, true);
    equal(a.injectionRuntime.source, 'manual');
    equal(a.getSettings().forcedMode, 'auto');
    equal(a.getSettings().forcedModeResumeAt, 0);
    display(a, 'injection');
    // The fresh harness may still report missing inputs before its first full
    // evaluation. Exercise the live projected mode with explicitly ready inputs.
    const exportView = { inputReady: true, controlEnabled: true, canPublishCommands: true,
      baseMode: 'injection', action: 'discharge', injectionActive: true };
    equal(a.getEmsWidgetTokens(exportView).emsdecision, 'Export to grid',
      'EMS widget shows active injection mode rather than the battery discharge action');
    equal(a.getEmsWidgetTokens(exportView).emsdecisionreasons,
      require('../locales/en.json').widget.status.reasonInjectionActive,
      'active injection reason is explicit, not inferred from P1 export');
    equal(await condition(h, 'injection'), true, 'condition uses live start state');
    equal(await condition(h, 'self_consumption'), false, 'no stale normal mode during export');
    await modeFlow(h, 'injection');
    equal(starts, 1, 'duplicate mode selection does not restart injection');
    a.evaluateContextNow(true); await h.drain();
    equal(a.latestResult.baseMode, 'injection', 'actual engine uses the negative net goal');
    await modeFlow(h, 'auto'); await h.drain();
    display(a, 'auto');
    equal(I.locked(a), false);
    equal(a.getEmsWidgetTokens(exportView).emsdecision === 'Export to grid', false,
      'stale injection engine result cannot leave an injection label after a stop');
    equal(stops, 1);
    equal(a.lastEmittedCommands.every(x => x === 0), true, 'physical neutralisation');
    equal(await condition(h, 'injection'), false, 'stale engine result cannot show active');
    I.tick(a, a.getSettings(), h.now(), true); await h.drain();
    equal(a.injectionRuntime.active, false, 'manual Auto choice blocks automatic re-entry this quarter');

    stage = 'stage-2';
    // Permission withdrawn while running: immediate safe stop, paired-device
    // sync, Auto fallback, and no restoration of the old Standby mode.
    h = await fresh({ forcedMode: 'solar_capture' }); a = h.app;
    const snapshots = [];
    a.emsDevices = new Set([{ syncFromApp: async snapshot => { snapshots.push(snapshot.mode); } }]);
    await modeFlow(h, 'injection');
    await h.setExternalSetting('injectionEnabled', false); await h.drain();
    display(a, 'auto');
    equal(a.getSettings().forcedMode, 'auto');
    equal(I.locked(a), false);
    equal(snapshots.at(-1), 'auto', 'transition synchronizes device without polling');
    equal(a.lastEmittedCommands.every(x => x === 0), true);

    stage = 'stage-3';
    // Safety and economic stops use the existing stop state machine and each
    // leave the selected injection mode in Auto, never a dormant export choice.
    for (const stop of ['soc', 'price', 'stale_grid', 'control_off', 'manual']) {
      h = await fresh(); a = h.app; await modeFlow(h, 'injection');
      if (stop === 'soc') a.state.batterySoc.fill(40);
      if (stop === 'price') a.setSetting('fixedImportPrice', 0.1);
      if (stop === 'stale_grid') a.inputUpdatedAt.grid = h.now() - 3600000;
      if (stop === 'control_off') a.setSetting('controlEnabled', false);
      if (stop === 'manual') I.stop(a);
      else I.tick(a, a.getSettings(), h.now(), false);
      await h.drain(); display(a, 'auto'); equal(I.locked(a), false, stop);
    }

    stage = 'stage-4';
    // A rejected start reports the existing reason while leaving Auto selected.
    for (const [overrides, prepare, message] of [
      [{ fixedImportPrice: 0.1 }, () => {}, /minimum/],
      [{}, app => { app.state.batterySoc.fill(40); }, /SoC/],
      [{}, app => { app.inputUpdatedAt.grid = h.now() - 3600000; }, /netmeting/],
      [{ controlEnabled: false }, () => {}, /Batterijsturing/],
    ]) {
      h = await fresh({ forcedMode: 'solar_capture', ...overrides }); a = h.app; prepare(a);
      await assert.rejects(modeFlow(h, 'injection'), message); checks++;
      display(a, 'auto'); equal(I.locked(a), false);
    }

    stage = 'stage-5';
    // Re-selecting export cannot leave an old session active after a failed
    // price check; the error remains visible and the output is neutralised.
    h = await fresh(); a = h.app; await modeFlow(h, 'injection');
    a.setSetting('fixedImportPrice', 0.1);
    await assert.rejects(modeFlow(h, 'injection'), /minimum/); checks++;
    await h.drain(); display(a, 'auto'); equal(I.locked(a), false);

    // Changing mode stops BOTH manual and automatic sessions, and the chosen
    // ordinary mode survives the export shutdown with its normal timer policy.
    for (const next of ['auto', 'self_consumption', 'solar_capture', 'avoid_import', 'manual_charge', 'standby']) {
      h = await fresh({ injectionAutomaticEnabled: true }); a = h.app;
      await I.start(a, 'automatic');
      await modeFlow(h, next); await h.drain();
      display(a, next); equal(I.locked(a), false);
      I.tick(a, a.getSettings(), h.now(), true); await h.drain();
      equal(a.injectionRuntime.active, false, 'ordinary mode selection latches stop');
    }

    stage = 'stage-6';
    // Explicit injection selection can take over an existing automatic session
    // that started while Battery Saving was selected, without a duplicate start.
    h = await fresh({ forcedMode: 'solar_capture', injectionAutomaticEnabled: true }); a = h.app;
    await I.start(a, 'automatic');
    await modeFlow(h, 'injection');
    equal(a.injectionRuntime.source, 'manual');
    equal(a.injectionRuntime.initialForcedMode, 'auto');
    await h.setExternalSetting('injectionAutomaticEnabled', false); await h.drain();
    equal(a.injectionRuntime.active, true, 'manual takeover survives automatic opt-out');
    I.stop(a); await h.drain(); display(a, 'auto');

    stage = 'stage-7';
    // A mode change during the asynchronous EV-stop preparation cannot cause
    // the old request to restart export after the user chose Auto.
    h = await fresh(); a = h.app;
    let release, held = false;
    const publishEv = a.publishEvPortfolioNow.bind(a);
    a.publishEvPortfolioNow = async (...args) => {
      if (!held) { held = true; await new Promise(resolve => { release = resolve; }); }
      return publishEv(...args);
    };
    const pendingStart = modeFlow(h, 'injection').then(() => null, err => err);
    await h.drain(); equal(a.injectionRuntime.preparing, true); display(a, 'injection');
    equal(a.getEmsWidgetTokens({ inputReady: true, controlEnabled: true, baseMode: 'injection',
      action: 'discharge', injectionActive: true }).emsdecision === 'Export to grid', false,
      'preparing mode must not pretend injection is already active');
    await modeFlow(h, 'auto'); await h.drain();
    release(); await pendingStart; await h.drain();
    display(a, 'auto'); equal(I.locked(a), false);

    stage = 'stage-8';
    // The mode selection is deliberately not saved as 'injection'. A reboot
    // keeps the existing recovery-to-zero mechanism without replaying a mode.
    h = await fresh(); await modeFlow(h, 'injection');
    const reboot = await boot(new Map(h.store));
    await h.drain();
    equal(reboot.app.getSettings().forcedMode, 'auto');
    equal(reboot.app.injectionRuntime.active, false);
    equal(reboot.app.getEmsControlMode(), 'auto');

    stage = 'stage-9';
    // Existing ordinary-mode semantics do not depend on the new optional mode.
    for (const enabled of [false, true]) for (const mode of ['auto', 'self_consumption', 'solar_capture', 'avoid_import', 'manual_charge', 'standby']) {
      h = await fresh({ injectionEnabled: enabled }); a = h.app;
      equal(await a.setForcedMode(mode), mode);
      equal(a.getSettings().forcedMode, mode);
      display(a, mode); equal(I.locked(a), false);
    }

    stage = 'stage-10';
    // Real driver callback must not acknowledge a picker value which fell back.
    const source = fs.readFileSync(path.join(root, 'drivers/ems/device.js'), 'utf8');
    const sandbox = { module: { exports: {} }, require: id => {
      assert.equal(id, 'homey'); return { Device: class {} };
    } };
    vm.runInNewContext(source, sandbox, { filename: 'drivers/ems/device.js' });
    for (const enabled of [false, true]) {
      h = await fresh({ injectionEnabled: enabled }); a = h.app;
      const device = new sandbox.module.exports(), values = new Map(), listeners = new Map();
      Object.assign(device, { homey: { app: a }, hasCapability: () => true,
        registerCapabilityListener: (id, fn) => listeners.set(id, fn),
        getCapabilityValue: id => values.get(id),
        setCapabilityValue: async (id, value) => { values.set(id, value); }, error: () => {} });
      await device.onInit();
      const request = listeners.get('ems_control_mode')('injection');
      if (enabled) { await request; equal(values.get('ems_control_mode'), 'injection'); }
      else { await assert.rejects(request, /injectie|export/i); checks++; equal(values.get('ems_control_mode'), 'auto'); }
    }

    console.log(`Injection mode 1.3.1: ${checks} checks passed`);
  } finally { clearTimeout(watchdog); restore(); Date.now = originalNow; }
})().catch(error => { console.error(error); process.exitCode = 1; });
