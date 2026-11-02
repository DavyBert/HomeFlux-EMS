'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const tags = require('../lib/ems-status-tags');
const { localizeDisplay } = require('../lib/display-language');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const html = fs.readFileSync(require('node:path').join(__dirname, '../widgets/status/public/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this._text = ''; this.attributes = {}; }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  get firstChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
  set innerHTML(value) { this.children = []; this._text = value; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(x => x.textContent).join(''); }
}
const content = new Element('div');
const document = { createElement: tag => new Element(tag), getElementById: id => id === 'content' ? content : null };
const ctx = vm.createContext({ Date, Number, String, Math, console, document }); vm.runInContext(scripts, ctx);
const base = { inputReady: true, controlEnabled: true, canPublishCommands: true, baseMode: 'charge', action: 'idle',
  modeLabel: 'Laadstrategie · netladen uitgesteld, PV-opvang actief',
  tariff: { chargeStrategy: { mode: 'maximum', active: false, missingKwh: 0, reserveMissed: false } } };
const cases = [
  ['deferred grid charge', {}, 'decisionSaveBattery', 'reasonChargeDeferred'],
  ['solar takes precedence over future charging plan', { action: 'pv_charge' }, 'decisionPvCharge', 'reasonPvCharge'],
  ['active grid charging', { action: 'grid_charge' }, 'decisionGridCharge', 'reasonGridCharge'],
  ['mixed charging', { action: 'grid_and_pv_charge' }, 'decisionGridPvCharge', 'reasonGridCharge'],
  ['Peak Guard takes precedence over plan reason', { action: 'peak_shave', override: 'peak_shave' }, 'decisionPeakShave', 'reasonPeakGuard'],
  ['Peak Guard without available watts', { override: 'peak_shave' }, 'decisionPeakLimited', 'reasonPeakLimited'],
  ['discharging during save policy', { baseMode: 'solar_capture', action: 'discharge' }, 'decisionDischarge', 'reasonDischarge'],
  ['missing live input beats cached charging action', { inputReady: false, action: 'grid_charge' }, 'decisionWaitingInput', 'alertInput'],
  ['missing-input base mode', { baseMode: 'waiting_input' }, 'decisionWaitingInput', 'alertInput'],
  ['disabled battery beats simulated action', { controlEnabled: false, action: 'grid_charge' }, 'decisionBatteryOff', 'reasonBatteryOff'],
  ['pause retains old setpoint', { batteryCommandPauseActive: true, action: 'grid_charge' }, 'decisionPaused', 'reasonPaused'],
  ['external ownership beats candidate action', { hybridEms: { owner: 'external', delegated: true }, action: 'discharge' }, 'decisionExternal', 'reasonExternal'],
  ['pending publication does not claim active charging', { decisionOutputPending: true, action: 'grid_charge' }, 'decisionPending', 'reasonPending'],
  ['safe stop', { baseMode: 'safety_stop', action: 'grid_charge' }, 'decisionSafetyStop', 'reasonSafetyStop'],
  ['EV block during idle', { batteryDischargeBlockedByEv: true }, 'decisionSaveBattery', 'reasonEvDischargeBlocked'],
  ['active PV still wins over discharge block', { batteryDischargeBlockedByEv: true, action: 'pv_charge' }, 'decisionPvCharge', 'reasonPvCharge'],
];
let checks = 0;
for (const language of ['nl', 'en']) {
  const locale = require('../locales/' + language + '.json');
  const Homey = { __: key => key.split('.').reduce((v, k) => v?.[k], locale) || key };
  for (const [name, change, title, reason] of cases) {
    const status = { ...base, ...change }, before = JSON.stringify(status), out = tags.values(status, null, language);
    assert.equal(out.emsdecision, locale.widget.status[title], language + '/' + name);
    assert.equal(out.emsdecisionreasons, locale.widget.status[reason], language + '/' + name);
    const fallback = localizeDisplay(status, language);
    assert.equal(ctx.emsDecision(fallback, Homey), out.emsdecision);
    assert.equal(ctx.emsDecisionReason(fallback, Homey), out.emsdecisionreasons);
    assert.equal(ctx.emsDecision({ ...fallback, decisionText: out.emsdecision }, Homey), out.emsdecision);
    assert.equal(JSON.stringify(status), before, 'presentation cannot modify control facts'); checks++;
  }
  const floor = tags.values({ ...base, baseMode: 'self_consumption', batteryPauseCode: 'minimum_soc',
    batteryDischargeFloorSoc: 14, modeLabel: 'Zelfconsumptie' }, null, language);
  assert.equal(floor.emsdecision, locale.widget.status.decisionSaveBattery);
  assert(floor.emsdecisionreasons.endsWith('14.0%'));
  const ev = { enabled: true, connected: true, controlType: 'current', source: 'tariff', mode: 'smart',
    allowed: true, desiredCurrentA: 16, outputCurrentA: 0, outputAllowed: false, actualCurrentA: 0, actualCurrentFresh: true };
  assert.equal(ctx.evState(ev, Homey), locale.widget.status.evWaitingPvTariff);
  assert.equal(ctx.evState({ ...ev, peakLimited: true }, Homey), locale.widget.status.evPeakGuard);
  assert.equal(ctx.evState({ ...ev, outputCurrentA: 13, outputAllowed: true, actualCurrentA: 13, peakLimited: true }, Homey), locale.widget.status.evPeakGuardLimited);
  assert.equal(ctx.evState({ ...ev, actualCurrentA: 16, actualCurrentFresh: false }, Homey), locale.widget.status.evWaitingPvTariff);
  assert.equal(ctx.evState({ ...ev, controlType: 'mode', actualCurrentA: 16, measuredPowerW: 0 }, Homey), locale.widget.status.evWaitingPvTariff);
  assert.equal(ctx.boilerState({ enabled: true, outputOn: false, running: true, reason: 'Peak Guard' }, Homey), locale.widget.status.boilerPeakGuard);
  const settingIds = require('../widgets/status/widget.compose.json').settings.map(x => x.id);
  const settings = Object.fromEntries(settingIds.map(id => [id, false]));
  settings.showEvs = true; settings.showEvDetails = true;
  ctx.renderStatus({ evs: [ev] }, settings, Homey);
  assert(!content.textContent.includes('16 A'), 'rendered current command cannot replace a published 0 A with desired 16 A');
  ctx.renderStatus({ evs: [{ ...ev, outputCurrentA: 13, outputAllowed: true, actualCurrentA: 13, peakLimited: true }] }, settings, Homey);
  assert(content.textContent.includes(locale.widget.status.evPeakGuardLimited));
  const safety = tags.values({ ...base, safetySocRecoveryActive: true, batteryCommandPauseActive: true }, null, language);
  assert.equal(safety.emscriticalalert, locale.widget.status.alertSafetySoc);
  assert.equal(ctx.criticalAlertText({ id: 'safety_soc' }, Homey), safety.emscriticalalert);

}
const NativeDate = Date, originalNow = Date.now;
global.Date = class extends NativeDate { constructor(...a) { super(...(a.length ? a : [Date.now()])); } };
const restore = installVirtualClearTimeout();
(async () => { try {
  const strategy = require('../lib/charge-strategy').normalize(); strategy.year.night = { mode: 'maximum', position: 'latest', extraPercent: 0 };
  const at = NativeDate.parse('2026-11-01T20:46:00Z');
  const h = await setup(undefined, { contractType: 'fixed', fixedChargeWindowStart: '01:00', fixedChargeWindowEnd: '07:00',
    chargeStrategy: strategy, exportLimitEnabled: false, peakLimitW: 2650, peakSoftMarginW: 100 }, at, 0);
  const a = h.app; a.homey.i18n.getLanguage = () => 'nl';
  Object.assign(a.state, { gridPowerW: 1183, batterySoc: [78.5, 78.5, 78.5, 78.5], targetSocOverride: 90,
    nightPlanningActive: true, nightPlanningStartedDate: '2026-11-01', pvSeenProducingToday: false });
  await h.start(); await h.flush();
  const status = a.getPublicStatus();
  assert.equal(status.baseMode, 'charge'); assert.equal(status.action, 'idle');
  assert.equal(status.outputTotalCommandW, 0); assert.equal(status.decisionText, 'Batterij sparen');
  assert(status.nextCharge.startAt > at, 'future plan remains present');
  assert.equal(status.planningChargeTargetSoc, 90);
  const before = JSON.stringify([a.state, a.latestResult, a.planningCache]); const timers = h.timers.length;
  for (const key of ['evaluateFastNow', 'refreshControlContext', 'requestContextEvaluate']) a[key] = () => { throw Error('Display invoked ' + key); };
  for (let n = 0; n < 20; n++) a.getPublicStatus();
  assert.equal(JSON.stringify([a.state, a.latestResult, a.planningCache]), before); assert.equal(h.timers.length, timers);
  // The actual published direction remains separate from the requested one.
  a.latestResult = { ...a.latestResult, action: 'grid_charge', candidateTotalCommandW: -1416 };
  assert.equal(a.getPublicStatus().decisionText, 'Wachten op batterij-uitsturing');
  a.state.lastTotalCommandW = -1416; a.lastEmittedCommands = [-354, -354, -354, -354];
  assert.equal(a.getPublicStatus().decisionText, 'Laden uit net');
  a.setSetting('batteryCommandPauseEnabled', true); a.setSetting('batteryCommandPauseStart', '00:00'); a.setSetting('batteryCommandPauseEnd', '23:59');
  assert.equal(a.getPublicStatus().decisionText, 'Batterijsturing gepauzeerd');
  assert.equal(a.getEmsWidgetTokens(a.latestResult).emsdecision, 'Batterijsturing gepauzeerd');
  assert.equal(a.getPublicStatus().outputTotalCommandW, -1416, 'pause keeps the actual old output visible');
  a.inputUpdatedAt.grid = at - 600000;
  assert.equal(a.getPublicStatus().decisionText, 'Wachten op data');
  assert.deepEqual(h.errors, []);
  console.log(`PASS 1.2.14 widget decisions: ${checks} NL/EN action/reason/fallback cases, EV/boiler contradictions, real night plan, pending output, pause, stale input and read-only status.`);
} finally { restore(); global.Date = NativeDate; Date.now = originalNow; } })().catch(e => { console.error(e.stack); process.exitCode = 1; });
