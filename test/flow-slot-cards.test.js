'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SLOT_ACTIONS, SLOT_TRIGGERS, legacyId, parseSlot, SlotFlowCards } = require('../lib/flow-slot-cards');
const manifest = require('../app.json');
const baseline = require('./fixtures/flow-0.7.11.json');
const { CONFIGURED_CARDS } = require('../lib/configured-flow-cards');

const definitions = { actions: SLOT_ACTIONS, triggers: SLOT_TRIGGERS };
const legacyIds = new Set(Object.values(definitions).flatMap(items => items.flatMap(d =>
  Array.from({ length: d.count }, (_, i) => legacyId(d, i + 1)))));

// Every 0.7.11 public card is preserved byte-for-value, apart from deprecated.
// This also protects already-generic selectors, shared inputs, group outputs,
// conditions, token names/types and translated titles from accidental changes.
assert.equal(legacyIds.size, 120);
const dropdownIds = new Set(CONFIGURED_CARDS.map(d => d.legacy));
for (const kind of ['actions', 'triggers', 'conditions']) {
  const current = new Map(manifest.flow[kind].map(c => [c.id, c]));
  assert.equal(current.size, manifest.flow[kind].length, 'No duplicate card IDs');
  for (const previous of baseline[kind]) {
    const card = current.get(previous.id);
    assert.ok(card, `Old card removed: ${previous.id}`);
    assert.deepEqual(card, (legacyIds.has(card.id) || dropdownIds.has(card.id)) ? { ...previous, deprecated: true } : previous,
      `Old schema changed: ${previous.id}`);
  }
  for (const card of current.values()) {
    const composed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.homeycompose', 'flow', kind, `${card.id}.json`), 'utf8'));
    assert.deepEqual(card, { id: card.id, ...composed }, `Manifest/Compose mismatch: ${card.id}`);
  }
}
assert.equal(manifest.flow.actions.filter(c => !c.deprecated).length, 29);
assert.equal(manifest.flow.triggers.filter(c => !c.deprecated).length, 26);
assert.equal(manifest.flow.conditions.filter(c => !c.deprecated).length, 20);
for (const [kind, items] of Object.entries(definitions)) {
  for (const d of items) {
    const card = manifest.flow[kind].find(c => c.id === d.id);
    const old = baseline[kind].find(c => c.id === legacyId(d, 1));
    assert(card && card.deprecated === true);
    assert(!baseline[kind].some(c => c.id === d.id), 'Do not reuse an old ID with changed arguments');
    assert.equal(card.args[0].name, d.argument);
    assert.equal(card.args[0].type, 'dropdown');
    assert.deepEqual(card.args[0].values.map(v => v.id), Array.from({ length: d.count }, (_, i) => String(i + 1)));
    assert.deepEqual(card.args.slice(1), old.args || [], `Input semantics must stay intact: ${d.id}`);
    assert.deepEqual((card.tokens || []).map(t => [t.name, t.type]), (old.tokens || []).map(t => [t.name, t.type]));
    for (const language of ['en', 'nl']) {
      assert(card.title[language] && card.titleFormatted[language].includes(`[[${d.argument}]]`));
      assert(!/\b(?:EV|HVAC|Battery|Batterij) [1-8]\b/i.test(card.title[language]), `Numbered title: ${d.id}`);
    }
  }
}
for (const value of [null, undefined, false, true, '', ' ', '01', '1.0', '1x', '0', '-1', '5', '8', '9', 0, -1, 1.5, NaN, Infinity, {}, []]) {
  assert.equal(parseSlot(value, 4), null, `Bad selection accepted: ${String(value)}`);
}
assert.equal(parseSlot('8', 8), 8);
assert.equal(parseSlot(1, 4), 1);

const { makeFlow, makeApp, snapshot, tokensFor } = require('./helpers/flow-cards');

(async () => {
  const flow = makeFlow();
  const router = new SlotFlowCards(flow);
  for (const d of SLOT_TRIGGERS) {
    const generic = flow.getTriggerCard(d.id);
    for (let slot = 1; slot <= d.count; slot += 1) generic.subscribers.push({ id: `slot-${slot}`, args: { [d.argument]: String(slot) } });
    for (const invalid of [null, undefined, 0, '9', {}, '']) {
      assert.equal(await generic.listener({ [d.argument]: invalid }, { [d.argument]: 1 }), false);
      assert.equal(await generic.listener({ [d.argument]: '1' }, { [d.argument]: invalid }), false);
    }
    for (let slot = 1; slot <= d.count; slot += 1) {
      const id = legacyId(d, slot);
      const old = flow.getTriggerCard(id);
      old.subscribers.push({ id: 'existing-flow', args: {} });
      const wrapper = router.getTriggerCard(id);
      assert.equal(router.getTriggerCard(id), wrapper, 'Wrappers are cached, not accumulated');
      const tokens = tokensFor(old);
      const state = Object.freeze({ source: 'baseline', mode: 'charge' });
      const start = flow.executions.length;
      await wrapper.trigger(tokens, state);
      const executed = flow.executions.slice(start);
      assert.equal(executed.length, 2, `Exactly one old and one selected new Flow: ${id}`);
      assert.equal(executed.filter(e => e.id === id).length, 1);
      const fresh = executed.find(e => e.id === d.id);
      assert.equal(fresh.subscriber, `slot-${slot}`);
      assert.deepEqual(fresh.tokens, tokens);
      assert.deepEqual(fresh.state, { ...state, [d.argument]: slot });
      assert.deepEqual(old.calls.at(-1).state, state, 'Legacy state must not acquire a new selector');
    }
  }
  assert.equal(router.triggerWrappers.size, 72);

  // Input routes preserve the original listener, arguments, state and result.
  for (const d of SLOT_ACTIONS) {
    for (let slot = 1; slot <= d.count; slot += 1) {
      const id = legacyId(d, slot);
      const received = [];
      const listener = async (args, state) => { received.push({ args, state }); return { value: slot }; };
      router.registerAction(id, listener);
      assert.equal(flow.getActionCard(id).listener, listener);
      const args = Object.freeze({ [d.argument]: String(slot), value: 42 });
      const state = Object.freeze({ source: 'flow' });
      assert.deepEqual(await flow.getActionCard(d.id).listener(args, state), { value: slot });
      assert.deepEqual(received, [{ args: { value: 42 }, state }]);
      assert.equal(args[d.argument], String(slot), 'Saved args must not be mutated');
    }
    for (const invalid of [null, undefined, false, '', 0, 5, '1x', {}, []]) {
      await assert.rejects(() => flow.getActionCard(d.id).listener({ [d.argument]: invalid }), /Select a valid/);
    }
  }
  assert.equal(router.actions.size, 48);

  // A failing old route must not starve the new route, or the reverse. Both
  // routes must finish before the next output can be published.
  {
    const definition = SLOT_TRIGGERS[0];
    const legacy = flow.getTriggerCard(legacyId(definition, 1));
    const generic = flow.getTriggerCard(definition.id);
    const wrapper = router.getTriggerCard(legacy.id);
    const events = [];
    legacy.beforeTrigger = () => { events.push('legacy-failed'); throw new Error('legacy failure'); };
    generic.beforeTrigger = async () => { await new Promise(resolve => setTimeout(resolve, 5)); events.push('generic-finished'); };
    await assert.rejects(() => wrapper.trigger(tokensFor(legacy)), /legacy failure/);
    assert.deepEqual(events, ['legacy-failed', 'generic-finished']);
    events.length = 0;
    legacy.beforeTrigger = async () => { await new Promise(resolve => setTimeout(resolve, 5)); events.push('legacy-finished'); };
    generic.beforeTrigger = () => { events.push('generic-failed'); throw new Error('generic failure'); };
    await assert.rejects(() => wrapper.trigger(tokensFor(legacy)), /generic failure/);
    assert.deepEqual(events, ['generic-failed', 'legacy-finished']);
    legacy.beforeTrigger = null; generic.beforeTrigger = null;
  }

  // Real application input handlers: compare old and new cards for all 48
  // routes, with invalid values and with zero configured devices as well.
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
  let actionScenarios = 0;
  const RealDate = Date;
  const frozenTime = RealDate.UTC(2026, 8, 16, 1, 0, 0);
  global.Date = class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [frozenTime])); }
    static now() { return frozenTime; }
  };
  try {
    for (const count of [0, 1, 2, 3, 4]) for (const d of SLOT_ACTIONS) {
      for (let slot = 1; slot <= d.count; slot += 1) {
        const old = makeApp(count); const fresh = makeApp(count);
        for (const args of argsByOperation[d.id]) {
          const oldResult = await old.flow.getActionCard(legacyId(d, slot)).listener(args);
          const newResult = await fresh.flow.getActionCard(d.id).listener({ [d.argument]: String(slot), ...args });
          assert.deepEqual(newResult, oldResult, `Result mismatch: ${d.id}/${slot}`);
          assert.deepEqual(snapshot(fresh), snapshot(old), `Handler behaviour mismatch: ${d.id}/${slot}`);
          actionScenarios += 1;
        }
      }
    }
    // The deprecated Battery dropdown retains its behaviour. Confirm each of the
    // eight slots updates only its own SoC and preserves a fresh timestamp.
    const ctx = makeApp();
    for (let slot = 1; slot <= 8; slot += 1) {
      const before = ctx.app.state.batterySoc.slice();
      await ctx.flow.getActionCard('set_battery_soc').listener({ battery: String(slot), soc: slot * 10 });
      assert.equal(ctx.app.state.batterySoc[slot - 1], slot * 10);
      assert.equal(ctx.app.inputUpdatedAt.batterySoc[slot - 1], Date.now());
      for (let other = 0; other < 8; other += 1) if (other !== slot - 1) assert.equal(ctx.app.state.batterySoc[other], before[other]);
    }
  } finally { global.Date = RealDate; }

  // Exercise the actual public output-test entry points, not just the router.
  {
    const { app, flow } = makeApp();
    assert.equal(app.slotFlowCards.actions.size, 48);
    assert.equal(app.slotFlowCards.triggerWrappers.size, 72);
    for (let slot = 1; slot <= 4; slot += 1) {
      for (const body of [{ output: 'current', currentA: 6 }, { output: 'current', currentA: 0 },
        { output: 'allowed', allowed: true }, { output: 'allowed', allowed: false },
        { output: 'mode', mode: 'standard' }, { output: 'mode', mode: 'stop' }]) {
        const before = Array.from(flow.cards.triggers.values()).reduce((n, c) => n + c.calls.length, 0);
        await app.testEvOutput({ instance: slot, ...body });
        const after = Array.from(flow.cards.triggers.values()).reduce((n, c) => n + c.calls.length, 0);
        assert.equal(after - before, 3, 'Each command reaches numbered + dropdown + configured output');
      }
      for (const body of [{ output: 'power', on: true }, { output: 'power', on: false },
        { output: 'mode', mode: 'heat' }, { output: 'setpoint', setpoint: 21.5 },
        { output: 'fan', currentSpeed: 200, targetSpeed: 300 }]) await app.testHvacOutput({ instance: slot, ...body });
      const old = flow.getTriggerCard(`hvac${slot}_setpoint_updated`).calls.at(-1);
      const fresh = flow.getTriggerCard('hvac_setpoint_updated_for').calls.at(-1);
      assert.deepEqual(fresh.tokens, old.tokens);
      assert.equal(fresh.state.hvac, slot);
    }
    // Original input request timers still reach both routes, with no added
    // timers for the new cards and with the original count/freshness gates.
    const timeouts = []; const intervals = [];
    app.homey.setTimeout = fn => { timeouts.push(fn); return { unref() {} }; };
    app.homey.setInterval = fn => { intervals.push(fn); return { unref() {} }; };
    app.setupInputRequestSchedule(); app.syncEvSocRequestSchedule();
    assert.equal(timeouts.length, 5);
    assert.equal(intervals.length, 7);
    for (const fn of timeouts) fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(flow.getTriggerCard('request_battery_soc_needed_for').calls.length, 8);
    assert.equal(flow.getTriggerCard('request_ev_soc_needed_for').calls.length, 4);
    for (let slot = 1; slot <= 8; slot += 1) assert.equal(flow.getTriggerCard(`request_battery${slot}_soc_needed`).calls.length, 1);
    for (let slot = 1; slot <= 4; slot += 1) assert.equal(flow.getTriggerCard(`request_ev${slot}_soc_needed`).calls.length, 1);
  }
  console.log(`v0.7.12 Flow migration tests passed (120 preserved cards, 25 generic cards, 72 isolated output routes, ${actionScenarios} real input scenarios)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
