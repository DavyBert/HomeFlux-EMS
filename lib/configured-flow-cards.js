'use strict';

const { SLOT_ACTIONS, SLOT_TRIGGERS, parseSlot } = require('./flow-slot-cards');

// Do not change dropdown arguments in already-distributed cards. Keep their
// original schema/listeners and give the autocomplete replacements new IDs.
const CONFIGURED_CARDS = Object.freeze([
  ...SLOT_ACTIONS.map(d => ({ kind: 'actions', legacy: d.id, argument: d.argument, count: d.count })),
  { kind: 'actions', legacy: 'set_battery_soc', argument: 'battery', count: 8 },
  ...SLOT_TRIGGERS.map(d => ({ kind: 'triggers', legacy: d.id, argument: d.argument, count: d.count })),
  ...['ev_is_connected', 'ev_is_charging', 'ev_charging_is_allowed', 'ev_mode_is'].map(legacy =>
    ({ kind: 'conditions', legacy, argument: 'ev', count: 4 })),
  { kind: 'conditions', legacy: 'hvac_is_active', argument: 'hvac', count: 4 },
].map(d => Object.freeze({ ...d, id: `${d.legacy}_configured` })));

const GETTERS = Object.freeze({
  actions: 'getActionCard', triggers: 'getTriggerCard', conditions: 'getConditionCard',
});

function parseConfiguredSelection(value, definition) {
  // Autocomplete arguments are the full result object saved by Homey. Never
  // coerce an invalid/missing object to device 1, or use the name as identity.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kind !== definition.argument) return null;
  return parseSlot(value.id, definition.count);
}

class ConfiguredFlowCards {
  constructor(flow, { getSlots, getLanguage = () => 'en' }) {
    if (typeof getSlots !== 'function') throw new TypeError('Configured Flow cards need a slot provider.');
    this.flow = flow;
    this.getSlots = getSlots;
    this.getLanguage = getLanguage;
    this.cards = new Map();
    this.definitions = new Map(CONFIGURED_CARDS.map(d => [`${d.kind}:${d.legacy}`, d]));
  }

  suggestions(definition, query) {
    // Read current configuration on every query. No timers, device discovery,
    // telemetry dependency or growing query cache is needed (at most 8 slots).
    const text = String(query ?? '').trim().toLocaleLowerCase();
    const slots = this.getSlots(definition.argument);
    if (!Array.isArray(slots)) return [];
    return slots.filter(item => parseConfiguredSelection(item, definition) !== null
      && typeof item.name === 'string'
      && item.name.toLocaleLowerCase().includes(text)).map(item => ({ ...item }));
  }

  selectionError(definition, slot) {
    const nl = String(this.getLanguage()).toLowerCase().startsWith('nl');
    const label = definition.argument === 'battery' ? (nl ? 'Batterij' : 'Battery') : definition.argument.toUpperCase();
    return new Error(slot === null
      ? (nl ? `Kies een geconfigureerde ${label} uit de lijst.` : `Select a configured ${label} from the list.`)
      : (nl
        ? `${label} ${slot} is niet meer geconfigureerd. Controleer het aantal in HomeFlux en kies opnieuw.`
        : `${label} ${slot} is no longer configured. Check the count in HomeFlux and select an available slot.`));
  }

  getCard(kind, id) {
    const getter = GETTERS[kind];
    const key = `${kind}:${id}`;
    const definition = this.definitions.get(key);
    if (!definition) return this.flow[getter](id);
    if (this.cards.has(key)) return this.cards.get(key);

    const legacy = this.flow[getter](id);
    const configured = this.flow[getter](definition.id);
    configured.registerArgumentAutocompleteListener(definition.argument,
      async query => this.suggestions(definition, query));

    const bridge = {
      id,
      registerRunListener: listener => {
        legacy.registerRunListener(listener);
        configured.registerRunListener(async (args, state) => {
          const slot = parseConfiguredSelection(args?.[definition.argument], definition);
          if (slot === null) {
            if (kind !== 'actions') return false;
            throw this.selectionError(definition, null);
          }
          if (kind !== 'triggers') {
            const exists = this.suggestions(definition, '')
              .some(item => parseSlot(item.id, definition.count) === slot);
            if (!exists) {
              if (kind === 'conditions') return false;
              throw this.selectionError(definition, slot);
            }
          }
          // Keep selected trigger routes alive after a count reduction: a final
          // STOP/0 W event must still reach a previously configured device.
          // The existing trigger listener filters the exact emitted slot.
          return listener({ ...args, [definition.argument]: String(slot) }, state);
        });
        return bridge;
      },
    };
    if (kind === 'triggers') {
      bridge.trigger = async (tokens, state) => {
        // One failed compatibility route must not prevent the other route.
        // Await both to preserve the existing mode-before-power sequencing.
        const results = await Promise.allSettled([
          Promise.resolve().then(() => legacy.trigger(tokens, state)),
          Promise.resolve().then(() => configured.trigger(tokens, state)),
        ]);
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
        return results[0].value;
      };
    }
    this.cards.set(key, bridge);
    return bridge;
  }

  getActionCard(id) { return this.getCard('actions', id); }
  getConditionCard(id) { return this.getCard('conditions', id); }
  getTriggerCard(id) { return this.getCard('triggers', id); }
}

module.exports = { CONFIGURED_CARDS, ConfiguredFlowCards, parseConfiguredSelection };
