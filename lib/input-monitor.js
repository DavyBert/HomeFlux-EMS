'use strict';

// Passive, app-owned diagnostic session. No payload logging, controller calls,
// persistent settings or timers while idle. Frequencies use complete, aligned
// one-second buckets; a single burst cannot count as five consecutive seconds.
const MAX_DURATION_MS = 15 * 60 * 1000;
const MAX_ROWS = 256;
const MAX_EVENTS = 256;
const MAX_CALCULATIONS = 64;
const MAX_TEXT = 16384;
const SELECTORS = new Set(['ev', 'hvac', 'battery', 'source']);
const COMMAND = /deadline|override|session$|automatic_control|forced_mode|recalculate|refresh_|get_ems_status/;

class InputMonitor {
  constructor({ definitions = [], version = '', now = Date.now, setTimeout: schedule = setTimeout,
    clearTimeout: cancel = clearTimeout, cpuUsage = () => process.cpuUsage(), memoryUsage = () => process.memoryUsage() } = {}) {
    this.definitions = new Map(definitions.map(d => [d.id, {
      id: d.id, name: d.title || { en: d.id, nl: d.id }, kind: COMMAND.test(d.id) ? 'command' : 'input',
      fields: (d.args || []).slice(0, 32).map(a => ({ name: a.name, type: a.type,
        values: a.values ? new Set(a.values.map(v => v.id)) : null })),
    }]));
    this.version = version;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.cpuUsage = cpuUsage;
    this.memoryUsage = memoryUsage;
    this.active = false;
    this.session = null;
    this.currentRow = null;
    this.tickTimer = null;
    this.expiryTimer = null;
  }

  observeFlow(flow) {
    const monitor = this, cards = new Map();
    return new Proxy(flow, { get(target, property) {
      if (property !== 'getActionCard') {
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return id => {
        if (cards.has(id)) return cards.get(id);
        const raw = target.getActionCard(id);
        const definition = monitor.definitions.get(id) || { id, name: { en: id, nl: id }, kind: 'input', fields: [] };
        const card = new Proxy(raw, { get(object, key) {
          if (key === 'registerRunListener') return listener => object.registerRunListener(function observedInput(...args) {
            if (!monitor.active) return listener.apply(this, args);
            return monitor.invoke(definition, listener, this, args);
          });
          const value = Reflect.get(object, key);
          return typeof value === 'function' ? value.bind(object) : value;
        } });
        cards.set(id, card);
        return card;
      };
    } });
  }

  safeRead(reader) { try { return reader(); } catch (_) { return null; } }

  start() {
    // Double-clicks and simultaneous settings clients must not extend a session.
    if (this.active) return this.snapshot();
    const now = this.now();
    this.session = { startedAt: now, expiresAt: now + MAX_DURATION_MS, endedAt: null, stopReason: '',
      totalReceived: 0, droppedRows: 0, observerErrors: 0, rows: new Map(),
      events: new Array(MAX_EVENTS), eventIndex: 0, eventCount: 0, eventsDropped: 0,
      requests: { context: 0, fast: 0, evDeferred: 0 },
      evaluations: { context: 0, fast: 0, evPortfolio: 0 },
      calculations: new Map(), droppedCalculations: 0, totalCalculations: 0,
      planningEvents: Object.create(null),
      cpuStart: this.safeRead(this.cpuUsage), cpuEnd: null,
      memoryStart: this.safeRead(this.memoryUsage), memoryEnd: null };
    this.active = true;
    this.event('started', now);
    const session = this.session;
    this.expiryTimer = this.schedule(() => {
      if (this.session === session && this.active) this.stop('15m_expired');
    }, MAX_DURATION_MS);
    this.scheduleTick();
    return this.snapshot();
  }

  scheduleTick() {
    if (!this.active) return;
    const s = this.session, now = this.now();
    const next = Math.min(s.expiresAt, s.startedAt + (Math.floor((now - s.startedAt) / 1000) + 1) * 1000);
    this.tickTimer = this.schedule(() => {
      this.tickTimer = null;
      if (!this.active || this.session !== s) return;
      if (this.now() >= s.expiresAt) { this.stop('15m_expired'); return; }
      this.advance(this.now());
      this.scheduleTick();
    }, Math.max(1, next - now));
  }

  stop(reason = 'manual') {
    if (!this.active) return this.snapshot();
    const s = this.session, now = Math.min(this.now(), s.expiresAt);
    this.advance(now);
    this.active = false;
    s.endedAt = now;
    s.stopReason = reason;
    s.cpuEnd = this.safeRead(this.cpuUsage);
    s.memoryEnd = this.safeRead(this.memoryUsage);
    this.clearTimers();
    this.currentRow = null;
    for (const row of s.rows.values()) row.previous = null; // Release comparison-only strings immediately.
    this.event('stopped', now, null, { reason });
    return this.snapshot();
  }

  clearTimers() {
    if (this.tickTimer !== null) this.cancel(this.tickTimer);
    if (this.expiryTimer !== null) this.cancel(this.expiryTimer);
    this.tickTimer = this.expiryTimer = null;
  }

  clear() {
    if (this.active) this.stop('cleared');
    this.clearTimers();
    this.session = null;
    return this.snapshot();
  }

  destroy() { this.clear(); this.currentRow = null; }

  event(type, at, row = null, extra = {}) {
    const s = this.session;
    if (!s) return;
    s.events[s.eventIndex] = { type, at, ...(row ? { inputKey: row.key, cardId: row.cardId } : {}), ...extra };
    s.eventIndex = (s.eventIndex + 1) % MAX_EVENTS;
    if (s.eventCount < MAX_EVENTS) s.eventCount++;
    else s.eventsDropped++;
  }

  selector(field, value) {
    const id = value && typeof value === 'object' ? value.id : value;
    if (field === 'source') return ['external', 'external2', 'homey'].includes(id) ? id : 'invalid';
    return /^[1-8]$/.test(String(id)) ? String(id) : 'invalid';
  }

  receive(definition, args = {}) {
    const now = this.now(), s = this.session;
    if (now >= s.expiresAt) { this.stop('15m_expired'); return null; }
    s.totalReceived++;
    let key = definition.id;
    const selectors = {};
    for (const f of definition.fields) if (SELECTORS.has(f.name)) {
      selectors[f.name] = this.selector(f.name, args[f.name]);
      key += `:${f.name}=${selectors[f.name]}`;
    }
    let row = s.rows.get(key);
    if (!row) {
      if (s.rows.size >= MAX_ROWS) { s.droppedRows++; return null; }
      row = { key, cardId: definition.id, name: definition.name, kind: definition.kind, selectors,
        received: 0, identical: 0, changed: 0, uncomparable: 0, previous: null, previousComparable: false, latestValue: {},
        lastReceivedAt: null, bucket: Math.floor((now - s.startedAt) / 1000), count: 0, lastCount: 0,
        peakPerSecond: 0, secondsAboveThreshold: 0, consecutiveHighSeconds: 0,
        loopActive: false, highActive: false, possibleLoopEpisodes: 0, firstWarningAt: null,
        lastWarningAt: null, requests: { context: 0, fast: 0, evDeferred: 0 } };
      s.rows.set(key, row);
    }
    this.advanceRow(row, Math.floor((now - s.startedAt) / 1000));
    let same = row.received > 0 && row.previousComparable, comparable = true;
    const previous = row.previous || (row.previous = []);
    for (let i = 0; i < definition.fields.length; i++) {
      const f = definition.fields[i], raw = args[f.name];
      let value = raw, display;
      if (SELECTORS.has(f.name)) value = display = selectors[f.name];
      else if (typeof raw === 'number' && Number.isFinite(raw)) display = raw;
      else if (typeof raw === 'boolean' || raw == null) display = raw ?? null;
      else if (typeof raw === 'string') {
        // Arbitrary text/JSON never appears in the report. Small strings can be
        // compared directly without parsing, hashing, cloning or serialization.
        display = (raw.length <= 64 && f.values?.has(raw)) || (f.name === 'time' && /^\d{1,2}:\d{2}$/.test(raw))
          ? raw : { redacted: true, characters: raw.length };
        if (raw.length > MAX_TEXT) { value = null; comparable = false; }
      } else { value = null; display = { redacted: true }; comparable = false; }
      if (previous[i] !== value) same = false;
      previous[i] = value;
      row.latestValue[f.name] = display;
    }
    if (!comparable) row.uncomparable++;
    else if (same) row.identical++;
    else if (row.received && row.previousComparable) row.changed++;
    row.previousComparable = comparable;
    row.received++;
    row.count++;
    row.peakPerSecond = Math.max(row.peakPerSecond, row.count);
    row.lastReceivedAt = now;
    return row;
  }

  invoke(definition, listener, receiver, args) {
    let row = null;
    try { row = this.receive(definition, args[0]); }
    catch (_) { if (this.session) this.session.observerErrors++; }
    const previous = this.currentRow;
    this.currentRow = row;
    try { return listener.apply(receiver, args); }
    finally { this.currentRow = previous; }
  }

  noteRequest(kind) {
    if (!this.active) return;
    this.session.requests[kind]++;
    if (this.currentRow) this.currentRow.requests[kind]++;
  }

  noteEvaluation(kind) { if (this.active) this.session.evaluations[kind]++; }

  notePlanningEvent(kind, instance = 0) {
    if (!this.active || !this.session) return;
    const key = `${kind}:ev${Number(instance) || 0}`;
    const events = this.session.planningEvents;
    events[key] = (events[key] || 0) + 1;
  }

  // Record actual synchronous planner/function invocations, NOT requests or
  // published commands. These fixed identifiers never include Flow payloads.
  // The calculation rows are separate from Flow-loop detection because one
  // heartbeat/portfolio may legitimately process several different EVs.
  noteCalculation(kind, origin, instance, wallMs = 0, cpuMs = 0, failed = false) {
    if (!this.active || !this.session) return;
    const s = this.session, now = this.now();
    if (now >= s.expiresAt) { this.stop('15m_expired'); return; }
    const key = `${kind}:${origin}:${instance || 0}`;
    let row = s.calculations.get(key);
    if (!row) {
      if (s.calculations.size >= MAX_CALCULATIONS) { s.droppedCalculations++; return; }
      row = { key, kind, origin, instance: Number(instance) || null,
        executions: 0, failed: 0, lastAt: null, totalWallMs: 0, maxWallMs: 0, totalCpuMs: 0,
        bucket: Math.floor((now - s.startedAt) / 1000), count: 0, lastCount: 0,
        peakPerSecond: 0, secondsAboveThreshold: 0, consecutiveHighSeconds: 0,
        repeatActive: false, highActive: false, possibleRepeats: 0,
        firstWarningAt: null, lastWarningAt: null };
      s.calculations.set(key, row);
    }
    this.advanceCalculation(row, Math.floor((now - s.startedAt) / 1000));
    row.executions++;
    s.totalCalculations++;
    if (failed) row.failed++;
    row.count++;
    row.lastAt = now;
    row.peakPerSecond = Math.max(row.peakPerSecond, row.count);
    const elapsed = Number(wallMs);
    const cpu = Number(cpuMs);
    if (Number.isFinite(elapsed) && elapsed >= 0) {
      row.totalWallMs += elapsed;
      row.maxWallMs = Math.max(row.maxWallMs, elapsed);
    }
    if (Number.isFinite(cpu) && cpu >= 0) row.totalCpuMs += cpu;
  }

  finishCalculationBucket(row, count, at) {
    row.lastCount = count;
    const high = count >= 2;
    if (high) row.secondsAboveThreshold++;
    row.consecutiveHighSeconds = high ? row.consecutiveHighSeconds + 1 : 0;
    if (high !== row.highActive) {
      row.highActive = high;
      this.event(high ? 'calculation_high_frequency_started' : 'calculation_high_frequency_ended', at,
        null, { calculationKey: row.key, frequency: count });
    }
    const repeat = row.consecutiveHighSeconds >= 5;
    if (repeat !== row.repeatActive) {
      row.repeatActive = repeat;
      if (repeat) {
        row.possibleRepeats++;
        row.firstWarningAt ??= at;
        row.lastWarningAt = at;
      }
      this.event(repeat ? 'calculation_repetition_started' : 'calculation_repetition_ended', at,
        null, { calculationKey: row.key, frequency: count, peakPerSecond: row.peakPerSecond });
    }
  }

  advanceCalculation(row, bucket) {
    if (bucket <= row.bucket) return;
    const at = this.session.startedAt + (row.bucket + 1) * 1000;
    this.finishCalculationBucket(row, row.count, at);
    if (bucket > row.bucket + 1) this.finishCalculationBucket(row, 0, at + 1000);
    row.bucket = bucket;
    row.count = 0;
  }

  finishBucket(row, count, at) {
    row.lastCount = count;
    const high = count > 1;
    if (high) row.secondsAboveThreshold++;
    row.consecutiveHighSeconds = count >= 2 ? row.consecutiveHighSeconds + 1 : 0;
    if (high !== row.highActive) {
      row.highActive = high;
      this.event(high ? 'high_frequency_started' : 'high_frequency_ended', at, row, { frequency: count });
    }
    const loop = row.consecutiveHighSeconds >= 5;
    if (loop !== row.loopActive) {
      row.loopActive = loop;
      if (loop) {
        row.possibleLoopEpisodes++;
        row.firstWarningAt ??= at;
        row.lastWarningAt = at;
      }
      this.event(loop ? 'possible_loop_started' : 'possible_loop_ended', at, row,
        { frequency: count, peakPerSecond: row.peakPerSecond });
    }
  }

  advanceRow(row, bucket) {
    if (bucket <= row.bucket) return;
    const at = this.session.startedAt + (row.bucket + 1) * 1000;
    this.finishBucket(row, row.count, at);
    if (bucket > row.bucket + 1) this.finishBucket(row, 0, at + 1000);
    row.bucket = bucket;
    row.count = 0;
  }

  advance(now) {
    const bucket = Math.floor((Math.min(now, this.session.expiresAt) - this.session.startedAt) / 1000);
    for (const row of this.session.rows.values()) this.advanceRow(row, bucket);
    for (const row of this.session.calculations.values()) this.advanceCalculation(row, bucket);
  }

  snapshot() {
    const s = this.session;
    if (!s) return { schemaVersion: 1, homeFluxVersion: this.version, active: false, session: null, inputs: [], events: [] };
    let now = this.active ? this.now() : s.endedAt;
    if (this.active && now >= s.expiresAt) return this.stop('15m_expired');
    if (this.active) this.advance(now);
    now = Math.min(now, s.expiresAt);
    const durationMs = Math.max(0, now - s.startedAt);
    const inputs = [...s.rows.values()].map(row => {
      const { previous, previousComparable, bucket, count, lastCount, highActive, ...data } = row;
      const updatesPerSecond = Math.max(count, lastCount);
      return { ...data, updatesPerSecond, averagePerSecond: durationMs ? row.received * 1000 / durationMs : 0,
        status: row.loopActive ? 'possible_loop' : updatesPerSecond > 1 ? 'high_frequency' : 'normal' };
    });
    const calculations = [...s.calculations.values()].map(row => {
      const { bucket, count, lastCount, highActive, repeatActive, ...data } = row;
      const updatesPerSecond = Math.max(count, lastCount);
      return { ...data, updatesPerSecond,
        averagePerSecond: durationMs ? row.executions * 1000 / durationMs : 0,
        averageWallMs: row.executions ? row.totalWallMs / row.executions : 0,
        status: row.repeatActive ? 'possible_repetition' : updatesPerSecond >= 2 ? 'high_frequency' : 'normal' };
    });
    calculations.sort((a, b) => b.executions - a.executions || a.key.localeCompare(b.key));
    const rank = { possible_loop: 2, high_frequency: 1, normal: 0 };
    inputs.sort((a, b) => rank[b.status] - rank[a.status] || b.updatesPerSecond - a.updatesPerSecond || b.received - a.received);
    const cpuEnd = this.active ? this.safeRead(this.cpuUsage) : s.cpuEnd;
    const cpuMs = s.cpuStart && cpuEnd ? Math.max(0, cpuEnd.user + cpuEnd.system - s.cpuStart.user - s.cpuStart.system) / 1000 : null;
    const events = [];
    const first = (s.eventIndex - s.eventCount + MAX_EVENTS) % MAX_EVENTS;
    for (let i = 0; i < s.eventCount; i++) events.push(s.events[(first + i) % MAX_EVENTS]);
    return { schemaVersion: 1, homeFluxVersion: this.version, active: this.active,
      session: { startedAt: s.startedAt, expiresAt: s.expiresAt, endedAt: s.endedAt,
        durationMs, remainingMs: this.active ? Math.max(0, s.expiresAt - now) : 0, stopReason: s.stopReason },
      thresholds: { normalMaxPerSecond: 1, possibleLoopMinPerSecond: 2, consecutiveSeconds: 5, bucketMs: 1000 },
      totalReceived: s.totalReceived, possibleLoopInputs: inputs.filter(r => r.possibleLoopEpisodes > 0).length,
      activePossibleLoops: inputs.filter(r => r.loopActive).length,
      possibleLoopEpisodes: inputs.reduce((sum, row) => sum + row.possibleLoopEpisodes, 0),
      requests: { ...s.requests }, evaluations: { ...s.evaluations },
      planningEvents: { ...s.planningEvents },
      calculationSummary: { total: s.totalCalculations,
        activePossibleRepeats: calculations.filter(r => r.status === 'possible_repetition').length,
        possibleRepeats: calculations.reduce((sum, r) => sum + r.possibleRepeats, 0),
        droppedRows: s.droppedCalculations },
      calculations,
      attribution: 'Per-input requests cover the synchronous handler only. Async continuations and timers are not attributed. Requests may be coalesced; they are not evaluations.',
      frequencyMethod: 'One-second buckets aligned to session start. Large or structured payloads are not deeply compared.',
      calculationAttribution: 'Counts are completed synchronous function calls, separately by planner, route and EV. Wall/CPU durations exclude waiting on Homey I/O; process CPU remains app-wide. Calculation repetition is not proof of a Flow loop.',
      cpu: { scope: 'whole_app_process', cpuMs, averagePercentOneCore: cpuMs !== null && durationMs > 0 ? cpuMs / durationMs * 100 : null },
      memory: { start: s.memoryStart, end: s.memoryEnd },
      limits: { maxRows: MAX_ROWS, maxEvents: MAX_EVENTS, droppedRows: s.droppedRows,
        eventsDropped: s.eventsDropped, maxComparableTextCharacters: MAX_TEXT, observerErrors: s.observerErrors },
      inputs, events };
  }
}

module.exports = { InputMonitor, MAX_DURATION_MS };
