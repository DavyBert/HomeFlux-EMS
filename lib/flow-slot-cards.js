'use strict';

// Public card IDs are deliberately new: older app releases also used some
// unnumbered IDs without a selector. Never reuse one with different arguments.
// Each legacy listener and each legacy token schema is kept intact.
const SLOT_ACTIONS = Object.freeze([
  ['ev', 4, 'set_ev{slot}_status', 'set_ev_status_for'],
  ['ev', 4, 'set_ev{slot}_soc', 'set_ev_soc_for'],
  ['ev', 4, 'set_ev{slot}_session_override', 'set_ev_session_override_for'],
  ['ev', 4, 'set_ev{slot}_energy_deadline', 'set_ev_energy_deadline_for'],
  ['ev', 4, 'set_ev{slot}_soc_deadline', 'set_ev_soc_deadline_for'],
  ['ev', 4, 'clear_ev{slot}_soc_deadline_override', 'clear_ev_soc_deadline_override_for'],
  ['ev', 4, 'end_ev{slot}_charging_session', 'end_ev_charging_session_for'],
  ['hvac', 4, 'set_hvac{slot}_room_temperature', 'set_hvac_room_temperature_for'],
  ['hvac', 4, 'set_hvac{slot}_mode', 'set_hvac_mode_for'],
  ['hvac', 4, 'set_hvac{slot}_setpoint', 'set_hvac_setpoint_for'],
  ['hvac', 4, 'set_hvac{slot}_fan_speed', 'set_hvac_fan_speed_for'],
  ['hvac', 4, 'set_hvac{slot}_automatic_control', 'set_hvac_automatic_control_for'],
].map(([argument, count, legacy, id]) => Object.freeze({ argument, count, legacy, id })));

const SLOT_TRIGGERS = Object.freeze([
  ['ev', 4, 'ev{slot}_charge_current_updated', 'ev_charge_current_updated_for'],
  ['ev', 4, 'ev{slot}_charging_allowed_updated', 'ev_charging_allowed_updated_for'],
  ['ev', 4, 'ev{slot}_charge_mode_updated', 'ev_charge_mode_updated_for'],
  ['ev', 4, 'request_ev{slot}_soc_needed', 'request_ev_soc_needed_for'],
  ['hvac', 4, 'hvac{slot}_power_updated', 'hvac_power_updated_for'],
  ['hvac', 4, 'hvac{slot}_mode_updated', 'hvac_mode_updated_for'],
  ['hvac', 4, 'hvac{slot}_setpoint_updated', 'hvac_setpoint_updated_for'],
  ['hvac', 4, 'hvac{slot}_fan_updated', 'hvac_fan_updated_for'],
  ['battery', 8, 'request_battery{slot}_soc_needed', 'request_battery_soc_needed_for'],
  ['battery', 8, 'split_command_battery{slot}_charge_mode', 'split_command_battery_charge_mode_for'],
  ['battery', 8, 'split_command_battery{slot}_discharge_mode', 'split_command_battery_discharge_mode_for'],
  ['battery', 8, 'split_command_battery{slot}_charge_power', 'split_command_battery_charge_power_for'],
  ['battery', 8, 'split_command_battery{slot}_discharge_power', 'split_command_battery_discharge_power_for'],
].map(([argument, count, legacy, id]) => Object.freeze({ argument, count, legacy, id })));

function legacyId(definition, slot) {
  return definition.legacy.replace('{slot}', String(slot));
}

function parseSlot(value, maximum) {
  // A missing or malformed selection must NEVER fall back to the first device.
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !/^[1-8]$/.test(value)) return null;
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 1 && slot <= maximum ? slot : null;
}

class SlotFlowCards {
  constructor(flow) {
    this.flow = flow;
    this.actions = new Map();
    this.triggerRoutes = new Map();
    this.triggerWrappers = new Map();
    this.actionIds = new Set();

    for (const definition of SLOT_ACTIONS) {
      for (let slot = 1; slot <= definition.count; slot += 1) {
        this.actionIds.add(legacyId(definition, slot));
      }
      flow.getActionCard(definition.id).registerRunListener(async (args, state) => {
        const slot = parseSlot(args?.[definition.argument], definition.count);
        if (slot === null) throw new Error(`Select a valid ${definition.argument.toUpperCase()} (1-${definition.count}).`);
        const listener = this.actions.get(legacyId(definition, slot));
        if (!listener) throw new Error(`Flow input is not registered: ${definition.id}`);
        // Call the SAME application listener as the numbered card. No Flow/API
        // round trip, duplicate evaluation or second device write is introduced.
        const legacyArgs = { ...args };
        delete legacyArgs[definition.argument];
        return listener(legacyArgs, state);
      });
    }

    for (const definition of SLOT_TRIGGERS) {
      const card = flow.getTriggerCard(definition.id);
      card.registerRunListener(async (args, state) => {
        const selected = parseSlot(args?.[definition.argument], definition.count);
        const emitted = parseSlot(state?.[definition.argument], definition.count);
        return selected !== null && emitted !== null && selected === emitted;
      });
      for (let slot = 1; slot <= definition.count; slot += 1) {
        this.triggerRoutes.set(legacyId(definition, slot), {
          card, argument: definition.argument, slot,
        });
      }
    }
  }

  registerAction(id, listener) {
    if (!this.actionIds.has(id)) throw new Error(`Unknown legacy Flow action: ${id}`);
    if (this.actions.has(id)) throw new Error(`Legacy Flow action already registered: ${id}`);
    this.actions.set(id, listener);
    return this.flow.getActionCard(id).registerRunListener(listener);
  }

  getTriggerCard(id) {
    if (this.triggerWrappers.has(id)) return this.triggerWrappers.get(id);
    const route = this.triggerRoutes.get(id);
    if (!route) throw new Error(`Unknown legacy Flow trigger: ${id}`);
    const legacy = this.flow.getTriggerCard(id);
    const wrapper = {
      trigger: async (tokens, state) => {
        // Start both routes even if one throws/rejects. Wait for BOTH before
        // returning, preserving mode-before-power sequencing and the existing
        // serialized HVAC output path. Buffers/maps remain bounded by slot count.
        const results = await Promise.allSettled([
          Promise.resolve().then(() => legacy.trigger(tokens, state)),
          Promise.resolve().then(() => route.card.trigger(
            tokens, { ...state, [route.argument]: route.slot },
          )),
        ]);
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
        return results[0].value;
      },
    };
    this.triggerWrappers.set(id, wrapper);
    return wrapper;
  }
}

module.exports = { SLOT_ACTIONS, SLOT_TRIGGERS, legacyId, parseSlot, SlotFlowCards };
