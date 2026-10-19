'use strict';

// Passive, bounded recorder. It never evaluates a strategy or publishes output.
// Format 2: one settings baseline followed by per-key changes/removals.
const SENSITIVE = /(token|secret|password|credential|api[_-]?key|authorization|cookie)/i;
const excluded = key => key === 'dynamicSlots' || key.startsWith('_diagnostics')
  || /^diagnostics(Planning|Cpu|Errors|Memory)Enabled$/.test(key);
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const clean = (key, value) => SENSITIVE.test(key) ? '[redacted]' : copy(value);
const watts = value => Math.round((Number(value) || 0) / 100);
const reasonClass = reason => String(reason || '').replace(/-?\d+(?:[.,]\d+)?/g, '#');

class CompactDiagnostics {
  constructor(app, runtime) {
    this.app = app;
    this.runtime = runtime;
    this.values = null;
    this.serialized = new Map();
    this.sequence = 0;
    this.eventSequence = 0;
    this.memos = new Map();
    this.requests = new Map();
    this.events = [];
    this.evControl = null;
    this.droppedEvents = 0;
    this.droppedPlanningEvents = 0;
    this.droppedConfigurations = 0;
  }

  config(settings, at = Date.now()) {
    if (!this.values) {
      this.values = this.app.getDiagnosticConfigurationSnapshot(settings);
      for (const [key, value] of Object.entries(this.values)) this.serialized.set(key, JSON.stringify(value));
      const record = { id: `cfg-${++this.sequence}`, at, kind: 'snapshot', previousId: null, settings: copy(this.values) };
      this.runtime.planningConfigurations.push(record);
      this.id = record.id;
    }
    // Homey's timezone is not a persisted HomeFlux setting. Check this scalar
    // at an existing diagnostic boundary; never scan/serialize all settings.
    if (settings?.timezone !== undefined) this.setting('timezone', settings.timezone, at);
    return this.id;
  }

  setting(key, value, at = Date.now()) {
    if (!this.values || excluded(key)) return;
    const removed = value === undefined;
    const sanitized = removed ? undefined : clean(key, value);
    const json = removed ? undefined : JSON.stringify(sanitized);
    if (this.serialized.get(key) === json && this.serialized.has(key) !== removed) return;
    if (removed) { delete this.values[key]; this.serialized.delete(key); }
    else { this.values[key] = sanitized; this.serialized.set(key, json); }
    const record = { id: `cfg-${++this.sequence}`, at, kind: 'changes', previousId: this.id,
      changes: removed ? {} : { [key]: sanitized }, removed: removed ? [key] : [] };
    this.runtime.planningConfigurations.push(record);
    this.id = record.id;
    this.trimConfigurations();
  }

  trimConfigurations() {
    const configs = this.runtime.planningConfigurations;
    while (configs.length > 50) {
      const first = configs.shift();
      const next = configs[0];
      const settings = { ...first.settings, ...next.changes };
      for (const key of next.removed || []) delete settings[key];
      next.kind = 'snapshot'; next.previousId = null; next.settings = settings;
      delete next.changes; delete next.removed;
      const keep = event => event.configId !== first.id;
      const oldPlanning = this.runtime.planningEvents.length;
      this.runtime.planningEvents = this.runtime.planningEvents.filter(keep);
      const oldEv = this.events.length;
      this.events = this.events.filter(keep);
      if (this.portfolioId && !this.events.some(event => event.id === this.portfolioId)) this.portfolioId = null;
      this.droppedPlanningEvents += oldPlanning - this.runtime.planningEvents.length;
      this.droppedEvents += oldEv - this.events.length;
      this.droppedConfigurations += 1;
      // A retained request carries its command, not a dependency on a removed
      // config/decision record. Publication outcomes reference their own config.
      for (const [key, memo] of this.memos) if (memo.event?.configId === first.id) this.memos.delete(key);
    }
  }

  event(kind, data, at = Date.now()) {
    const configId = this.config(this.app.getSettings(), at);
    const event = { id: `evt-${++this.eventSequence}`, at, configId, kind, ...data };
    this.events.push(event);
    if (this.events.length > 600) {
      const removed = this.events.shift();
      this.droppedEvents += 1;
      for (const [key, memo] of this.memos) if (memo.event.id === removed.id) this.memos.delete(key);
      if (this.portfolioId === removed.id) this.portfolioId = null;
    }
    return event;
  }

  observe(key, signature, kind, makeData, at = Date.now()) {
    const last = this.memos.get(key);
    if (last?.signature === signature) {
      last.event.repeats = (last.event.repeats || 0) + 1;
      last.event.lastObservedAt = at;
      return last.event.id;
    }
    const event = this.event(kind, makeData(), at);
    this.memos.set(key, { signature, event });
    return event.id;
  }

  outputs(index) {
    const a = this.app, r = index === 0 ? null : a.getExtraEv(index);
    return { currentA: index === 0 ? a.lastPublishedEvCurrentA ?? null : r?.lastPublishedCurrentA ?? null,
      mode: index === 0 ? a.lastPublishedEvChargeMode ?? null : r?.lastPublishedChargeMode ?? null,
      allowed: index === 0 ? Boolean(a.lastPublishedEvAllowed) : Boolean(r?.lastPublishedAllowed),
      publishedAt: index === 0 ? a.lastEvPublishedAt || 0 : r?.lastPublishedAt || 0 };
  }

  battery() {
    const a = this.app;
    return { lastPublishedCommandsW: a.lastEmittedCommands?.slice() || [],
      lastPublishedTotalW: Number(a.state?.lastTotalCommandW) || 0,
      pendingCommandsW: a.pendingResult?.candidateCommands?.slice() || null,
      inFlightCommandsW: a.inFlightBatteryCommands?.slice() || null,
      // Internal sign convention: positive discharge, negative charge.
      valuesAreCommands: true };
  }

  allowance(control, settings, now, selectedGridW, controlGridSource) {
    // Called only where the existing battery regulation already obtained this
    // status. No second EV-control calculation, and no numeric P1 trace.
    this.evControl = control;
    this.evControlAt = now;
    this.evSelectedGridW = selectedGridW;
    this.evControlSource = controlGridSource;
    if (this.app.getEvCount(settings) <= 0 && !this.memos.has('allowance')) return;
    const signature = [control.state, control.requestedTargetW > 0, control.activeTargetW > 0,
      (control.waitingInstances || []).join(','), Boolean(control.houseLoadHold),
      watts(control.confirmedEvPowerW), watts(control.requestedTargetW)].join('|');
    this.observe('allowance', signature, 'ev_grid_allowance_transition', () => ({
      cause: 'battery_meter_selection', control: this.meterSelection(),
      gridPowerW: this.app.state.gridPowerW, pvPowerW: this.app.state.pvPowerW,
      battery: this.battery(),
    }), now);
  }

  meterSelection() {
    return this.evControl ? { at: this.evControlAt, ...copy(this.evControl),
      selectedGridW: this.evSelectedGridW,
      controlGridPowerW: this.evSelectedGridW - this.evControl.activeTargetW,
      controlGridSource: this.evControlSource } : null;
  }

  portfolio(data) {
    const signature = [data.tariffId, data.gridImportLimitW, data.peakLimitW,
      watts(data.pvPoolW), watts(data.gridTargetW), watts(data.guaranteedGridW)].join('|');
    this.portfolioId = this.observe('portfolio', signature, 'ev_portfolio_budget', () => data);
  }

  decision(index, decision, settings, command, now = Date.now()) {
    const a = this.app, input = a.getEvInputSnapshot(index) || {};
    const measured = a.getEvMeasuredCurrent(index, input, now);
    const grid = a.getGridFreshness(settings, now);
    const session = a.getEvSessionDetectionRuntime(index);
    const signature = [settings.evMode, settings.evEnabled, settings.evControlType,
      decision.connected, decision.allowed, decision.source, decision.selectedTariff,
      decision.tariffRateId, decision.guaranteeActive, decision.targetSoc, decision.targetTime || settings.evTargetTime,
      command.currentA, command.mode, command.allowed, decision.requestedCurrentA,
      decision.peakLimited, decision.priorityLimited, decision.minimumTargetReached, decision.targetCompleted,
      watts(decision.pvAllocatedW), watts(decision.gridAllocatedW), watts(decision.batterySupportAllocatedW),
      watts(decision.nightSurplusAllocatedW), decision.batterySupportEnabled, decision.nightSurplusActive,
      reasonClass(decision.reason), grid.fresh, Boolean(input.seen?.chargeCurrent), measured.fresh,
      session?.endedLatched, session?.loadAbsent,
      this.evControl?.state, watts(this.evControl?.requestedTargetW), watts(this.evControl?.activeTargetW),
    ].join('|');
    return this.observe(`decision:${index}`, signature, 'ev_decision', () => ({
      instance: index + 1,
      cause: a.evHeartbeatRunning ? 'heartbeat' : (a.activeContextDiagnosticReasons || []).slice(),
      mode: settings.evMode, controlType: settings.evControlType,
      targetSoc: decision.targetSoc ?? settings.evTargetSoc, targetTime: decision.targetTime || settings.evTargetTime,
      guaranteeAllowed: Boolean(settings.evGuaranteeTarget && settings.evAllowUnselectedTariffForDeadline),
      connected: Boolean(decision.connected), ended: Boolean(session?.endedLatched),
      soc: input.soc ?? null, socUpdatedAt: input.updatedAt?.soc || 0,
      allowed: Boolean(decision.allowed), reason: decision.reason, source: decision.source,
      tariff: { id: decision.tariffRateId, label: decision.tariffLabel, selected: Boolean(decision.selectedTariff),
        guaranteeActive: Boolean(decision.guaranteeActive) },
      requested: { currentA: decision.requestedCurrentA, powerW: decision.requestedPowerW },
      calculated: { currentA: decision.desiredCurrentA, powerW: decision.desiredPowerW,
        mode: decision.effectiveChargeMode, allowed: decision.allowed },
      outputRequest: { ...command }, published: this.outputs(index),
      allocationW: { pv: decision.pvAllocatedW || 0, grid: decision.gridAllocatedW || 0,
        batterySupport: decision.batterySupportAllocatedW || 0, nightSurplus: decision.nightSurplusAllocatedW || 0 },
      feedback: { received: Boolean(input.seen?.chargeCurrent), currentA: input.chargeCurrentA ?? null,
        updatedAt: measured.updatedAt, ageMs: measured.updatedAt ? now - measured.updatedAt : null, fresh: measured.fresh },
      inputs: { gridPowerW: a.state.gridPowerW, pvPowerW: a.state.pvPowerW, gridFresh: grid.fresh,
        gridUpdatedAt: grid.updatedAt },
      limits: { peakGuardEnabled: settings.peakShaveEnabled, peakW: settings.peakLimitW,
        peakSoftMarginW: settings.peakSoftMarginW, minCurrentA: settings.evMinCurrentA,
        maxCurrentA: settings.evMaxCurrentA, phases: settings.evPhases, voltage: settings.evVoltage,
        voltageReference: settings.evVoltageReference },
      // The last actual meter-target application is timestamped separately;
      // it is not presented as a new preview for this decision.
      lastBatteryMeterSelection: this.meterSelection(),
      portfolioGridImportTargetW: decision.portfolioGridImportTargetW || 0,
      portfolioEventId: this.portfolioId || null,
      battery: this.battery(),
    }), now);
  }

  output(index, decision, command, phase, detail = {}, boundRequest = null) {
    const now = Date.now(), previous = this.requests.get(index);
    const signature = [command.currentA, command.mode, command.allowed].join('|');
    let request = boundRequest || previous;
    if (phase === 'requested' && (!request || request.signature !== signature || request.complete)) {
      const decisionId = this.memos.get(`decision:${index}`)?.event.id || null;
      const event = this.event('ev_command_request', { instance: index + 1, decisionId, command: { ...command } }, now);
      request = { id: event.id, signature, command: { ...command }, attempt: 0, complete: false };
      this.requests.set(index, request);
    }
    if (!request) return;
    if (phase === 'requested') return request;
    if (phase === 'publishing') request.attempt += 1;
    const key = `output:${index}:${phase}`;
    const stateSignature = [request.id, phase, detail.component, detail.value,
      detail.error || '', phase === 'waiting' ? detail.reason : phase === 'failed' ? '' : request.attempt].join('|');
    this.observe(key, stateSignature, 'ev_command_' + phase, () => ({
      instance: index + 1, requestId: request.id, attempt: request.attempt,
      requestRetained: this.events.some(event => event.id === request.id),
      command: { ...request.command }, ...detail, published: this.outputs(index),
    }), now);
    if (phase === 'published') request.complete = true;
  }

  batteryOutput(result, phase, commandsW, error = null) {
    this.event('battery_command_' + phase, {
      commandsW: commandsW?.slice() || null, mode: result.baseMode, override: result.override || '',
      reason: result.reason || result.statusText, gridPowerW: result.gridPowerW,
      controlGridPowerW: result.controlGridPowerW, controlGridSource: result.controlGridSource,
      error: error ? String(error.message || error).slice(0, 1000) : undefined,
      lastBatteryMeterSelection: this.meterSelection(),
      battery: this.battery(),
    });
  }
}

module.exports = { CompactDiagnostics };
