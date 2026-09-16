'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const manifest = require('../../app.json');
const { DEFAULTS } = require('../../lib/ems-engine');
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class App {} };
  if (request === 'homey-api') return { HomeyAPI: {} };
  return originalLoad.call(this, request, parent, isMain);
};
let HomeFluxEmsApp;
try { HomeFluxEmsApp = require('../../app'); } finally { Module._load = originalLoad; }

function makeFlow() {
  const cards = { actions: new Map(), triggers: new Map(), conditions: new Map() };
  const executions = [];
  const get = (kind, id) => {
    if (cards[kind].has(id)) return cards[kind].get(id);
    const definition = manifest.flow[kind].find(c => c.id === id);
    assert(definition, `Runtime registered unknown ${kind} card: ${id}`);
    const card = {
      id, definition, calls: [], subscribers: [], listener: null, beforeTrigger: null,
      autocomplete: {},
      registerArgumentAutocompleteListener(name, listener) {
        assert.equal(this.autocomplete[name], undefined, `Duplicate autocomplete: ${id}.${name}`);
        this.autocomplete[name] = listener;
        return this;
      },
      registerRunListener(listener) {
        assert.equal(this.listener, null, `Duplicate listener: ${id}`);
        this.listener = listener;
        return this;
      },
      async trigger(tokens, state) {
        this.calls.push({ tokens, state });
        if (this.beforeTrigger) await this.beforeTrigger(tokens, state);
        for (const token of definition.tokens || []) {
          assert.equal(typeof tokens?.[token.name], token.type, `Token ${id}.${token.name} changed type`);
        }
        for (const subscriber of this.subscribers) {
          if (!this.listener || await this.listener(subscriber.args, state)) {
            executions.push({ id, subscriber: subscriber.id, tokens, state });
          }
        }
        return true;
      },
    };
    cards[kind].set(id, card);
    return card;
  };
  return {
    cards, executions,
    getActionCard: id => get('actions', id),
    getTriggerCard: id => get('triggers', id),
    getConditionCard: id => get('conditions', id),
  };
}
function tokensFor(card) {
  return Object.freeze(Object.fromEntries((card.definition.tokens || []).map(t => [t.name,
    t.type === 'number' ? -420 : t.type === 'boolean' ? true : `sample:${t.name}`])));
}

function makeApp(count = 4) {
  const app = Object.create(HomeFluxEmsApp.prototype);
  const flow = makeFlow();
  const settings = { ...DEFAULTS, batteryCount: 8, evCount: count, hvacCount: count, timezone: 'UTC' };
  const calls = [];
  for (let i = 0; i < 4; i += 1) {
    const prefix = i === 0 ? 'ev' : `ev${i + 1}`;
    settings[`${prefix}Enabled`] = true;
    settings[`${prefix}SocEnabled`] = true;
    settings[`${prefix}Phases`] = 3;
    settings[`${prefix}TargetSoc`] = 80;
  }
  const evSeen = () => ({ soc: false, connected: false, chargeCurrent: false });
  const hvacSeen = () => ({ roomTemperature: false, outdoorTemperature: false, mode: false, setpoint: false, fanSpeed: false });
  app.state = { batterySoc: Array(8).fill(50), evSoc: null, evConnected: false, evChargeCurrentA: 0,
    hvacRoomTemperatureC: null, hvacMode: 'off', hvacSetpointC: null, hvacFanSpeed: null };
  app.inputSeen = { batterySoc: Array(8).fill(false), ev: evSeen(), hvac: hvacSeen() };
  app.inputUpdatedAt = { batterySoc: Array(8).fill(0), ev: {}, hvac: {} };
  app.extraEvInstances = Array.from({ length: 3 }, () => ({
    state: { soc: null, connected: false, chargeCurrentA: 0 }, seen: evSeen(), updatedAt: {},
  }));
  app.extraHvacInstances = Array.from({ length: 3 }, () => ({
    state: { roomTemperatureC: null, mode: 'off', setpointC: null, fanSpeed: null }, seen: hvacSeen(), updatedAt: {},
  }));
  app.evSocPlans = Array.from({ length: 4 }, () => ({ active: false }));
  app.evEnergyPlans = Array.from({ length: 4 }, () => ({ active: false }));
  app.evTargetWarningState = ['', '', '', ''];
  app.inputRequestTimers = [];
  app.getSettings = () => settings;
  app.homey = { flow, settings: { get: key => settings[key], set: (key, value) => { settings[key] = value; } }, clock: { getTimezone: () => 'UTC' } };
  for (const method of ['requestContextEvaluate', 'requestEvaluate', 'invalidatePlanningCache',
    'persistEvSocPlanOverrides', 'persistEvEnergyPlanOverrides', 'noteAutoTuneEvFeedback',
    'handleEvSessionConnectionTransition', 'handleEvSessionConnectionTransitionFor',
    'handleEvDetectionConnectionTransition', 'updateEvSessionFromCurrent',
    'setEvSessionOverride', 'setEvSessionOverrideFor', 'markEvSessionEnded']) {
    app[method] = (...args) => { calls.push([method, ...args]); return true; };
  }
  app.setSetting = (key, value) => { settings[key] = value; calls.push(['setSetting', key, value]); };
  app.isNightPlanningPhase = () => false;
  app.error = (...args) => { throw new Error(`Unexpected app error: ${args.join(' ')}`); };
  app.registerFlowCards();
  return { app, flow, settings, calls };
}
function snapshot(ctx) {
  return JSON.parse(JSON.stringify({ state: ctx.app.state, seen: ctx.app.inputSeen, updated: ctx.app.inputUpdatedAt,
    ev: ctx.app.extraEvInstances, hvac: ctx.app.extraHvacInstances, socPlans: ctx.app.evSocPlans,
    energyPlans: ctx.app.evEnergyPlans, settings: ctx.settings, calls: ctx.calls }));
}

module.exports = { makeFlow, makeApp, snapshot, tokensFor };
