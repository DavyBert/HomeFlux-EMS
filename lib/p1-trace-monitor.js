'use strict';

// Diagnostic-only observer for the real P1 Flow input path. The normal runtime
// has no sample timers, no polling, no settings writes and no output changes.
// A cycle only owns its synchronous work; timer/await continuations are tracked
// separately and are never falsely attributed to a particular P1 sample.
const MAX_DURATION_MS = 15 * 60 * 1000;
const MAX_CYCLES = 120;
const MAX_STAGES = 40;
const MAX_CONTEXT_REASONS = 24;
const MAX_NOTES_PER_CYCLE = 12;

class P1TraceMonitor {
  constructor({ version = '', now = Date.now, schedule = setTimeout, cancel = clearTimeout,
    cpuUsage = previous => process.cpuUsage(previous), clock = () => process.hrtime.bigint() } = {}) {
    this.version = version;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.cpuUsage = cpuUsage;
    this.clock = clock;
    this.active = false;
    this.session = null;
    this.current = null;
    this.stage = '';
    this.expiryTimer = null;
  }

  start() {
    if (this.active) return this.snapshot();
    this.clearTimer();
    const now = this.now();
    this.session = {
      startedAt: now, expiresAt: now + MAX_DURATION_MS, endedAt: null, stopReason: '',
      total: 0, withPhases: 0, withoutPhases: 0, settingsReads: 0,
      cycles: [], droppedCycles: 0, stages: Object.create(null),
      outcomes: Object.create(null), contextReasons: Object.create(null),
      deferredEvents: Object.create(null), highFrequencyPairs: 0,
      shortestIntervalMs: null, lastP1At: null, errors: 0,
      cpuStart: this.safe(this.cpuUsage), cpuEnd: null,
    };
    this.active = true;
    const session = this.session;
    this.expiryTimer = this.schedule(() => {
      this.expiryTimer = null;
      if (this.active && this.session === session) this.stop('15m_expired');
    }, MAX_DURATION_MS);
    return this.snapshot();
  }

  safe(fn) { try { return fn(); } catch (_) { return null; } }
  clearTimer() { if (this.expiryTimer !== null) this.cancel(this.expiryTimer); this.expiryTimer = null; }

  stop(reason = 'manual') {
    if (!this.active) return this.snapshot();
    const now = Math.min(this.now(), this.session.expiresAt);
    this.active = false;
    this.session.endedAt = now;
    this.session.stopReason = reason;
    this.session.cpuEnd = this.safe(this.cpuUsage);
    this.clearTimer();
    this.current = null;
    this.stage = '';
    return this.snapshot();
  }
  clear() { if (this.active) this.stop('cleared'); this.clearTimer(); this.session = null; this.current = null; this.stage = ''; return this.snapshot(); }
  destroy() { this.clear(); }

  begin(source, gridPowerW) {
    if (!this.active || !this.session) return null;
    const now = this.now();
    if (now >= this.session.expiresAt) { this.stop('15m_expired'); return null; }
    const s = this.session;
    if (s.lastP1At !== null) {
      const interval = Math.max(0, now - s.lastP1At);
      s.shortestIntervalMs = s.shortestIntervalMs === null ? interval : Math.min(s.shortestIntervalMs, interval);
      if (interval < 1000) s.highFrequencyPairs++;
    }
    s.lastP1At = now;
    s.total++;
    if (source === 'set_grid_power_phases') s.withPhases++;
    else s.withoutPhases++;
    const cycle = { sequence: s.total, at: now, source,
      gridPowerW: Math.round(Number(gridPowerW) || 0),
      stages: Object.create(null), notes: [], contextRequests: [],
      outcomes: Object.create(null), settingsReads: 0,
      wallMs: 0, cpuMs: 0, interruptedForAwait: false };
    // The previous P1 may have been suspended at an actual await. Its later
    // continuation will explicitly resume itself instead of inheriting ours.
    this.current = cycle;
    this.stage = '';
    cycle._started = this.safe(this.clock);
    cycle._cpu = this.safe(this.cpuUsage);
    return cycle;
  }

  noteSettingsRead() {
    const cycle = this.current;
    if (!this.active || !cycle || !this.session) return;
    cycle.settingsReads++;
    this.session.settingsReads++;
    const label = this.stage || 'unclassified';
    const stage = this.getStage(label);
    if (stage) stage.settingsReads++;
  }

  getStage(name) {
    const s = this.session;
    if (!s) return null;
    if (!s.stages[name]) {
      if (Object.keys(s.stages).length >= MAX_STAGES) return null;
      s.stages[name] = { name, calls: 0, wallMs: 0, cpuMs: 0, maxWallMs: 0,
        maxCpuMs: 0, settingsReads: 0, failures: 0 };
    }
    return s.stages[name];
  }

  measure(cycle, name, run) {
    if (!this.active || !cycle || this.current !== cycle) return run();
    const previousStage = this.stage;
    const started = this.safe(this.clock), cpuStart = this.safe(this.cpuUsage);
    this.stage = name;
    let failed = false;
    try { return run(); }
    catch (err) { failed = true; throw err; }
    finally {
      const ended = this.safe(this.clock), cpu = cpuStart ? this.safe(() => this.cpuUsage(cpuStart)) : null;
      const wallMs = started !== null && ended !== null ? Math.max(0, Number(ended - started) / 1e6) : 0;
      const cpuMs = cpu ? (cpu.user + cpu.system) / 1000 : 0;
      const row = this.getStage(name);
      if (row) {
        row.calls++;
        row.wallMs += wallMs;
        row.cpuMs += cpuMs;
        row.maxWallMs = Math.max(row.maxWallMs, wallMs);
        row.maxCpuMs = Math.max(row.maxCpuMs, cpuMs);
        if (failed) row.failures++;
      }
      const perCycle = cycle.stages[name] || (cycle.stages[name] = { calls: 0, wallMs: 0, cpuMs: 0 });
      perCycle.calls++;
      perCycle.wallMs += wallMs;
      perCycle.cpuMs += cpuMs;
      this.stage = previousStage;
    }
  }

  // Context calculations started from an already pending timer have no unique
  // P1 owner. Include their cost separately, without attributing settings
  // reads or controller work to the last observed grid sample.
  measureDetached(name, run) {
    if (!this.active || !this.session) return run();
    const started = this.safe(this.clock), cpuStart = this.safe(this.cpuUsage);
    let failed = false;
    try { return run(); }
    catch (err) { failed = true; throw err; }
    finally {
      const ended = this.safe(this.clock), cpu = cpuStart ? this.safe(() => this.cpuUsage(cpuStart)) : null;
      const wallMs = started !== null && ended !== null ? Math.max(0, Number(ended-started)/1e6) : 0;
      const cpuMs = cpu ? (cpu.user + cpu.system)/1000 : 0;
      const row = this.getStage(name);
      if (row) {
        row.calls++; row.wallMs += wallMs; row.cpuMs += cpuMs;
        row.maxWallMs = Math.max(row.maxWallMs, wallMs);
        row.maxCpuMs = Math.max(row.maxCpuMs, cpuMs);
        if (failed) row.failures++;
      }
    }
  }

  outcome(name) {
    const cycle = this.current, s = this.session;
    if (!this.active || !cycle || !s) return;
    const key = String(name || 'unknown').slice(0, 64);
    s.outcomes[key] = (s.outcomes[key] || 0) + 1;
    cycle.outcomes[key] = (cycle.outcomes[key] || 0) + 1;
  }
  note(name, detail = '') {
    const cycle = this.current;
    if (!this.active || !cycle || cycle.notes.length >= MAX_NOTES_PER_CYCLE) return;
    cycle.notes.push({ kind: String(name).slice(0, 60), detail: String(detail).slice(0, 100) });
  }
  context(reason, immediate) {
    const cycle = this.current, s = this.session;
    if (!this.active || !cycle || !s) return;
    const key = String(reason || 'context').slice(0, 70);
    if (!s.contextReasons[key] && Object.keys(s.contextReasons).length >= MAX_CONTEXT_REASONS) return;
    s.contextReasons[key] = (s.contextReasons[key] || 0) + 1;
    if (cycle.contextRequests.length < MAX_NOTES_PER_CYCLE) cycle.contextRequests.push({ reason: key, immediate: Boolean(immediate) });
  }
  // Timers may be the result of multiple P1 inputs or unrelated work. This
  // explicitly does NOT modify / resume the last P1 attribution context.
  detached(name) {
    if (!this.active || !this.session) return;
    const key = String(name).slice(0, 64);
    this.session.deferredEvents[key] = (this.session.deferredEvents[key] || 0) + 1;
  }
  closeSynchronousSegment(cycle) {
    if (!cycle || cycle._started === null) return;
    const end = this.safe(this.clock), cpu = cycle._cpu ? this.safe(() => this.cpuUsage(cycle._cpu)) : null;
    cycle.wallMs += end !== null ? Math.max(0, Number(end - cycle._started) / 1e6) : 0;
    cycle.cpuMs += cpu ? (cpu.user + cpu.system) / 1000 : 0;
    cycle._started = null;
    cycle._cpu = null;
  }
  suspend(cycle) {
    if (!cycle || this.current !== cycle) return;
    cycle.interruptedForAwait = true;
    this.closeSynchronousSegment(cycle);
    this.current = null;
    this.stage = '';
  }
  resume(cycle) {
    if (!cycle || !this.active || !this.session || cycle._finished) return;
    cycle._started = this.safe(this.clock);
    cycle._cpu = this.safe(this.cpuUsage);
    this.current = cycle;
    this.stage = '';
  }
  finish(cycle) {
    if (!cycle || cycle._finished) return;
    cycle._finished = true;
    const s = this.session;
    if (this.current === cycle) { this.current = null; this.stage = ''; }
    if (!s || !this.active) return;
    this.closeSynchronousSegment(cycle);
    delete cycle._started;
    delete cycle._cpu;
    if (s.cycles.length === MAX_CYCLES) { s.cycles.shift(); s.droppedCycles++; }
    s.cycles.push(cycle);
  }

  snapshot() {
    const s = this.session;
    if (!s) return { schemaVersion: 1, homeFluxVersion: this.version, active: false, session: null,
      totalP1: 0, stages: [], cycles: [], outcomes: {}, contextReasons: {}, deferredEvents: {} };
    if (this.active && this.now() >= s.expiresAt) return this.stop('15m_expired');
    const at = this.active ? this.now() : s.endedAt;
    const durationMs = Math.max(0, Math.min(at, s.expiresAt) - s.startedAt);
    const cpuEnd = this.active ? this.safe(this.cpuUsage) : s.cpuEnd;
    const cpuMs = s.cpuStart && cpuEnd
      ? Math.max(0, cpuEnd.user + cpuEnd.system - s.cpuStart.user - s.cpuStart.system) / 1000 : null;
    return {
      schemaVersion: 1, homeFluxVersion: this.version, active: this.active,
      session: { startedAt: s.startedAt, expiresAt: s.expiresAt, endedAt: s.endedAt,
        durationMs, remainingMs: this.active ? Math.max(0, s.expiresAt - at) : 0, stopReason: s.stopReason },
      totalP1: s.total, withPhases: s.withPhases, withoutPhases: s.withoutPhases,
      settingsReads: s.settingsReads, averageSettingsReads: s.total ? s.settingsReads / s.total : 0,
      highFrequencyPairs: s.highFrequencyPairs, shortestIntervalMs: s.shortestIntervalMs,
      stages: Object.values(s.stages).map(row => ({ ...row,
        averageWallMs: row.calls ? row.wallMs / row.calls : 0,
        averageCpuMs: row.calls ? row.cpuMs / row.calls : 0 })).sort((a, b) => b.cpuMs - a.cpuMs),
      outcomes: { ...s.outcomes }, contextReasons: { ...s.contextReasons },
      deferredEvents: { ...s.deferredEvents },
      cycles: s.cycles.slice().reverse(),
      cpu: { scope: 'whole_app_process', cpuMs,
        averagePercentOneCore: cpuMs !== null && durationMs ? cpuMs / durationMs * 100 : null },
      limits: { maxDurationMs: MAX_DURATION_MS, maxCycles: MAX_CYCLES,
        droppedCycles: s.droppedCycles, maxStages: MAX_STAGES, errors: s.errors },
      attribution: 'Stages and getSettings counts belong to synchronous P1 handler execution only. Timer work is counted separately without attributing it to a single P1. Async Homey/Flow completion is excluded. Stage timings can overlap when nested; do not sum stages or treat process-wide CPU as isolated P1 CPU.',
      impact: 'Monitoring is opt-in and can add small measurement overhead. No new P1 reads, controller actions or changes to scheduling/decisions.',
    };
  }
}
module.exports = { P1TraceMonitor, MAX_DURATION_MS };
