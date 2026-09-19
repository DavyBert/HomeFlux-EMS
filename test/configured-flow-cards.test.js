'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIGURED_CARDS, parseConfiguredSelection } = require('../lib/configured-flow-cards');
const { SLOT_ACTIONS, SLOT_TRIGGERS, legacyId } = require('../lib/flow-slot-cards');
const { makeApp, snapshot, tokensFor } = require('./helpers/flow-cards');
const manifest = require('../app.json');
const baseline = require('./fixtures/flow-0.7.12-dropdown.json');
const getters = { actions: 'getActionCard', triggers: 'getTriggerCard', conditions: 'getConditionCard' };
const selected = (kind, slot, name = `${kind.toUpperCase()} ${slot}`) => ({ id: String(slot), kind, name });
const replaced = new Set(CONFIGURED_CARDS.map(d => d.legacy));
const displayMetadataChangeIds = new Set(['set_external_ems_setpoint']);
const withoutDisplayMetadata = card => {
  if (!card) return card;
  const { title, hint, titleFormatted, args = [], ...rest } = card;
  return {
    ...rest,
    args: args.map(arg => {
      const { title: argTitle, ...argRest } = arg;
      return argRest;
    }),
  };
};
const cardFor = (flow, d) => flow[getters[d.kind]](d.id);
const selection = (d, slot) => ({ [d.argument]: selected(d.argument, slot) });

assert.equal(CONFIGURED_CARDS.length, 31);
assert.equal(new Set(CONFIGURED_CARDS.map(d => d.id)).size, 31);
for (const kind of Object.keys(getters)) {
  const current = new Map(manifest.flow[kind].map(c => [c.id, c]));
  for (const old of baseline[kind]) {
    const card = current.get(old.id);
    const expected = replaced.has(old.id) ? { ...old, deprecated: true } : old;
    if (displayMetadataChangeIds.has(old.id)) {
      assert.deepEqual(withoutDisplayMetadata(card), withoutDisplayMetadata(expected),
        `Original 0.7.12 functional schema changed: ${old.id}`);
    } else {
      assert.deepEqual(card, expected, `Original 0.7.12 card/schema changed: ${old.id}`);
    }
  }
  for (const card of current.values()) {
    const composed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.homeycompose/flow', kind, `${card.id}.json`), 'utf8'));
    assert.deepEqual(card, { id: card.id, ...composed }, `Compose mismatch: ${card.id}`);
    if (!card.deprecated) for (const arg of card.args || []) {
      if (['battery', 'ev', 'hvac'].includes(arg.name)) assert.equal(arg.type, 'autocomplete', `Unfiltered visible card: ${card.id}`);
    }
  }
  assert.equal(manifest.flow[kind].filter(c => !c.deprecated).length,
    baseline[kind].filter(c => !c.deprecated).length, 'The new-card list must not grow');
}
for (const d of CONFIGURED_CARDS) {
  const old = baseline[d.kind].find(c => c.id === d.legacy);
  const card = manifest.flow[d.kind].find(c => c.id === d.id);
  assert(old && card && !card.deprecated);
  assert(!baseline[d.kind].some(c => c.id === d.id), 'Never reuse an existing schema ID');
  assert.deepEqual(card.tokens, old.tokens);
  assert.deepEqual(card.title, old.title);
  assert.deepEqual(card.titleFormatted, old.titleFormatted);
  assert.deepEqual(card.args.filter(a => a.name !== d.argument), old.args.filter(a => a.name !== d.argument));
  const arg = card.args.find(a => a.name === d.argument);
  assert.equal(arg.type, 'autocomplete');
  assert.equal(arg.values, undefined);
  assert(arg.placeholder.en && arg.placeholder.nl);
}

(async () => {
  const ctx = makeApp();
  const { app, flow, settings } = ctx;
  let language = 'en';
  app.homey.i18n = { getLanguage: () => language };
  assert.equal(app.configuredFlowCards.cards.size, 31, 'One cached adapter per replaced card');
  let queries = 0;
  for (const d of CONFIGURED_CARDS) {
    const card = cardFor(flow, d);
    assert.equal(typeof card.autocomplete[d.argument], 'function', `Missing autocomplete: ${d.id}`);
    assert.equal(Object.keys(card.autocomplete).length, 1);
    for (let count = 0; count <= d.count; count += 1) {
      settings[`${d.argument}Count`] = count;
      const options = await card.autocomplete[d.argument]('');
      assert.deepEqual(options.map(v => v.id), Array.from({ length: count }, (_, i) => String(i + 1)));
      for (const item of options) assert.equal(item.kind, d.argument);
      const expected = options.filter(v => v.id === '2');
      assert.deepEqual(await card.autocomplete[d.argument](' 2 '), expected, 'Query must filter the offered options');
      assert.deepEqual(await card.autocomplete[d.argument]('not-present'), []);
      assert.deepEqual(await card.autocomplete[d.argument](null), options);
      queries += 4;
    }
    const definition = manifest.flow[d.kind].find(c => c.id === d.id);
    assert.equal(card.listener !== null, true, `Missing run listener: ${definition.id}`);
  }
  assert.equal(app.configuredFlowCards.cards.size, 31, 'Queries must not add adapters');
  assert.equal(flow.cards.actions.size, manifest.flow.actions.length);
  assert.equal(flow.cards.conditions.size, manifest.flow.conditions.length);
  assert.equal(flow.cards.triggers.size, manifest.flow.triggers.length);

  // Live changes, stable slot identities, and an initial installation with no telemetry.
  settings.evCount = 2; settings.hvacCount = 2; settings.batteryCount = 2;
  settings.evEnabled = false; settings.ev2Enabled = false;
  settings.hvacEnabled = false; settings.hvac2Enabled = false;
  settings.evName = 'Smappee'; settings.ev2Name = 'Visitor'; settings.hvac2Name = 'Office';
  const evCard = flow.getActionCard('set_ev_soc_for_configured');
  assert.deepEqual((await evCard.autocomplete.ev('SMAPPEE')).map(v => v.id), ['1']);
  assert.deepEqual((await evCard.autocomplete.ev('visitor')).map(v => v.id), ['2']);
  assert.equal((await evCard.autocomplete.ev('')).length, 2, 'Configured but disabled/offline is still selectable');
  assert.equal((await flow.getActionCard('set_hvac_automatic_control_for_configured').autocomplete.hvac('')).length, 2);
  assert.equal((await flow.getActionCard('set_battery_soc_configured').autocomplete.battery('')).length, 2,
    'The first SoC must be feedable before battery telemetry exists');
  const previousSelection = (await evCard.autocomplete.ev('visitor'))[0];
  settings.ev2Name = 'Changed name';
  assert.equal((await evCard.autocomplete.ev('changed'))[0].id, previousSelection.id);
  settings.evCount = 0;
  assert.deepEqual(await evCard.autocomplete.ev(''), []);
  settings.evCount = 3;
  assert.deepEqual((await evCard.autocomplete.ev('')).map(v => v.id), ['1', '2', '3']);
  settings.evCount = 1;
  assert.deepEqual((await evCard.autocomplete.ev('')).map(v => v.id), ['1']);
  settings.evCount = 4;
  settings.hvacCount = 4;
  settings.batteryCount = 8;
  language = 'nl';
  assert.equal((await flow.getActionCard('set_battery_soc_configured').autocomplete.battery('batterij 2'))[0].name, 'Batterij 2');
  language = 'en';
  assert.equal((await flow.getActionCard('set_battery_soc_configured').autocomplete.battery('battery 2'))[0].name, 'Battery 2');
  for (const kind of ['battery', 'ev', 'hvac']) {
    settings[`${kind}Count`] = '0';
    assert.deepEqual(app.getConfiguredFlowSlots(kind), []);
    settings[`${kind}Count`] = 99;
    assert.equal(app.getConfiguredFlowSlots(kind).length, kind === 'battery' ? 8 : 4);
    settings[`${kind}Count`] = -1;
    assert.deepEqual(app.getConfiguredFlowSlots(kind), []);
  }

  // Invalid or old selections must never be remapped to the first device.
  for (const d of CONFIGURED_CARDS) {
    settings[`${d.argument}Count`] = d.count;
    const card = cardFor(flow, d);
    const invalid = [undefined, null, false, true, '', '1', 1, [], {}, { id: '1' },
      selected('wrong', 1), selected(d.argument, 0), selected(d.argument, d.count + 1),
      selected(d.argument, '01'), selected(d.argument, '1.0'), selected(d.argument, '1x'),
      { id: NaN, kind: d.argument }, { id: 1.5, kind: d.argument }];
    for (const value of invalid) {
      assert.equal(parseConfiguredSelection(value, d), null);
      const before = snapshot(ctx);
      if (d.kind === 'actions') await assert.rejects(() => card.listener({ [d.argument]: value }), /Select a configured/);
      else assert.equal(await card.listener({ [d.argument]: value }, { [d.argument]: 1 }), false);
      assert.deepEqual(snapshot(ctx), before, 'Invalid selection must not alter settings or measurements');
    }
    settings[`${d.argument}Count`] = 0;
    const before = snapshot(ctx);
    if (d.kind === 'actions') await assert.rejects(() => card.listener(selection(d, 1)), /no longer configured/);
    else if (d.kind === 'conditions') assert.equal(await card.listener(selection(d, 1)), false);
    assert.deepEqual(snapshot(ctx), before);
  }
  language = 'nl';
  settings.evCount = 1;
  await assert.rejects(() => evCard.listener({ ev: previousSelection, soc: 60 }), /niet meer geconfigureerd/);
  await assert.rejects(() => evCard.listener({ ev: null, soc: 60 }), /Kies een geconfigureerde/);
  language = 'en';

  // New autocomplete input routes execute the exact legacy handler once, for
  // every configured slot and both valid/invalid measurement/planning values.
  const argsByOperation = {
    set_ev_status_for: [{ connected: 'yes', charge_current: 7 }, { connected: 'no', charge_current: 'invalid' }],
    set_ev_soc_for: [{ soc: 67 }, { soc: 'invalid' }],
    set_ev_session_override_for: [{ mode: 'smart' }],
    set_ev_energy_deadline_for: [{ energy: 12, time: '06:30', guarantee: 'yes' }, { energy: 8, time: '12:00', guarantee: 'no' }, { energy: 12, time: '25:00', guarantee: 'yes' }],
    set_ev_soc_deadline_for: [{ target_soc: 30, time: '06:30', guarantee: 'yes' }, { target_soc: 80, time: '12:00', guarantee: 'no' }, { target_soc: 101, time: '06:30', guarantee: 'yes' }],
    clear_ev_soc_deadline_override_for: [{}], end_ev_charging_session_for: [{}],
    set_hvac_room_temperature_for: [{ temperature: 24 }, { temperature: 'invalid' }],
    set_hvac_mode_for: [{ mode: 'heat' }],
    set_hvac_setpoint_for: [{ setpoint: 22.5 }, { setpoint: 'invalid' }],
    set_hvac_fan_speed_for: [{ speed: 200 }, { speed: 'invalid' }],
    set_hvac_automatic_control_for: [{ enabled: 'no' }, { enabled: 'yes' }],
  };
  let actionScenarios = 0; let conditionScenarios = 0;
  const RealDate = Date;
  const frozenTime = RealDate.UTC(2026, 8, 16, 1, 0, 0);
  global.Date = class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [frozenTime])); }
    static now() { return frozenTime; }
  };
  try {
    for (const count of [1, 2, 3, 4]) for (const d of SLOT_ACTIONS) {
      for (let slot = 1; slot <= count; slot += 1) {
        const old = makeApp(count); const fresh = makeApp(count);
        for (const args of argsByOperation[d.id]) {
          const frozen = Object.freeze({ ...args, [d.argument]: Object.freeze(selected(d.argument, slot)) });
          const oldResult = await old.flow.getActionCard(legacyId(d, slot)).listener(args);
          const newResult = await fresh.flow.getActionCard(`${d.id}_configured`).listener(frozen);
          assert.deepEqual(newResult, oldResult, `Result mismatch: ${d.id}/${slot}`);
          assert.deepEqual(snapshot(fresh), snapshot(old), `Handler mismatch: ${d.id}/${slot}`);
          actionScenarios += 1;
        }
      }
    }
    for (let count = 1; count <= 8; count += 1) for (let slot = 1; slot <= count; slot += 1) {
      const old = makeApp(); const fresh = makeApp();
      old.settings.batteryCount = fresh.settings.batteryCount = count;
      for (const soc of [0, 63.5, 100, 'invalid']) {
        assert.deepEqual(await fresh.flow.getActionCard('set_battery_soc_configured').listener({ battery: selected('battery', slot), soc }),
          await old.flow.getActionCard('set_battery_soc').listener({ battery: String(slot), soc }));
        assert.deepEqual(snapshot(fresh), snapshot(old));
        actionScenarios += 1;
      }
    }
    const c = makeApp(4);
    c.app.latestEvDecision = { allowed: true };
    c.app.state.evConnected = true; c.app.inputSeen.ev.connected = true;
    c.app.state.evChargeCurrentA = 7; c.app.inputSeen.ev.chargeCurrent = true;
    for (let index = 0; index < 3; index += 1) {
      const ev = c.app.extraEvInstances[index];
      ev.state.connected = index % 2 === 0; ev.seen.connected = true;
      ev.state.chargeCurrentA = index % 2 === 0 ? 6 : 0; ev.seen.chargeCurrent = true;
      ev.latestDecision = { allowed: index % 2 === 0 };
    }
    c.app.isHvacManagedActiveFor = index => index % 2 === 0;
    for (const d of CONFIGURED_CARDS.filter(d => d.kind === 'conditions')) {
      for (const count of [0, 1, 2, 3, 4]) for (let slot = 1; slot <= 4; slot += 1) {
        c.settings[`${d.argument}Count`] = count;
        for (const mode of ['smart', 'soc', 'emergency']) {
          const result = await cardFor(c.flow, d).listener({ ...selection(d, slot), mode });
          const old = await c.flow.getConditionCard(d.legacy).listener({ [d.argument]: String(slot), mode });
          assert.equal(result, old, `${d.id}/${slot}/${count}`);
          conditionScenarios += 1;
        }
      }
    }
  } finally { global.Date = RealDate; }

  // All numbered, former dropdown, and new autocomplete subscribers are
  // isolated by the selected slot and receive the same original tokens.
  const out = makeApp(4);
  let outputRoutes = 0;
  for (const d of SLOT_TRIGGERS) {
    const oldDropdown = out.flow.getTriggerCard(d.id);
    const configured = out.flow.getTriggerCard(`${d.id}_configured`);
    for (let slot = 1; slot <= d.count; slot += 1) {
      oldDropdown.subscribers.push({ id: `dropdown-${slot}`, args: { [d.argument]: String(slot) } });
      configured.subscribers.push({ id: `configured-${slot}`, args: selection(d, slot) });
    }
    configured.subscribers.push({ id: 'wrong-kind', args: { [d.argument]: selected('wrong', 1) } });
    for (let slot = 1; slot <= d.count; slot += 1) {
      const id = legacyId(d, slot);
      const old = out.flow.getTriggerCard(id);
      old.subscribers.push({ id: 'original-flow', args: {} });
      const wrapper = out.app.slotFlowCards.getTriggerCard(id);
      const tokens = tokensFor(old);
      const state = Object.freeze({ source: 'test' });
      const before = out.flow.executions.length;
      await wrapper.trigger(tokens, state);
      const executed = out.flow.executions.slice(before);
      assert.equal(executed.length, 3, `${id} should reach exactly one subscriber per generation`);
      assert.equal(executed.find(e => e.id === `${d.id}_configured`).subscriber, `configured-${slot}`);
      for (const event of executed) assert.deepEqual(event.tokens, tokens);
      assert.deepEqual(old.calls.at(-1).state, state);
      assert.deepEqual(configured.calls.at(-1).state, { ...state, [d.argument]: slot });
      outputRoutes += 1;
    }
  }
  assert.equal(outputRoutes, 72);
  assert.equal(out.app.configuredFlowCards.cards.size, 31);
  assert.equal(out.app.slotFlowCards.triggerWrappers.size, 72);

  // Count reductions hide future selections, but must NOT suppress a final
  // safety STOP routed to a saved output Flow. It never targets another slot.
  out.settings.evCount = 0;
  const stopCard = out.flow.getTriggerCard('ev_charge_current_updated_for_configured');
  assert.deepEqual(await stopCard.autocomplete.ev(''), []);
  const beforeStop = out.flow.executions.length;
  const oldCurrent = out.flow.getTriggerCard('ev1_charge_current_updated');
  await out.app.slotFlowCards.getTriggerCard(oldCurrent.id).trigger({ ...tokensFor(oldCurrent), current: 0 });
  const stopped = out.flow.executions.slice(beforeStop);
  assert.equal(stopped.length, 3);
  assert.equal(stopped.find(e => e.id === stopCard.id).subscriber, 'configured-1');

  // All three generations are attempted even when any individual route fails.
  const routes = [oldCurrent, out.flow.getTriggerCard('ev_charge_current_updated_for'), stopCard];
  for (const failing of routes) {
    const finished = [];
    for (const route of routes) route.beforeTrigger = async () => {
      if (route === failing) throw new Error(`failure:${route.id}`);
      await new Promise(resolve => setTimeout(resolve, 2));
      finished.push(route.id);
    };
    await assert.rejects(() => out.app.slotFlowCards.getTriggerCard(oldCurrent.id).trigger(tokensFor(oldCurrent)), /failure:/);
    assert.deepEqual(finished.sort(), routes.filter(r => r !== failing).map(r => r.id).sort());
  }
  for (const route of routes) route.beforeTrigger = null;

  console.log(`configured Flow selectors passed (31 dynamic cards, ${queries} queries, ${actionScenarios} input comparisons, ${conditionScenarios} condition comparisons, ${outputRoutes} three-generation output routes)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
