'use strict';
// Optional host-memory stress run; uses the same real handlers/controllers as
// the CPU replay. Completed fake timers/traces are removed from the harness so
// its unbounded recording arrays do not masquerade as application retention.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { fixture, ROOT } = require('./ev-work-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const RealDate = Date;
class VirtualDate extends RealDate { constructor(...args) { super(...(args.length ? args : [VirtualDate.now()])); } }

async function measure(root, connected, status) {
  const h = await fixture({ root, connected }), a = h.app;
  a.diagnostics = a.createDiagnosticsRuntime();
  const digest = createHash('sha256');
  let actuations = 0, reads = 0;
  function releaseHarnessRecords(record) {
    if (record) {
      for (const rows of [h.traces, h.flexible]) for (const row of rows) {
        digest.update(JSON.stringify(row)); actuations++;
      }
    }
    h.traces.length = h.flexible.length = h.contexts.length = 0;
    for (let i = h.timers.length - 1; i >= 0; i--) if (h.timers[i].done) h.timers.splice(i, 1);
  }
  async function chunk(record) {
    for (let second = 1; second <= 1000; second++) {
      h.setNow(h.now() + 1000);
      await h.cards.get('set_ev1_status').listener({ connected: connected ? 'yes' : 'no', charge_current: 0 });
      await h.grid(2500 - a.state.lastTotalCommandW);
      if (second % 60 === 0) { a.runContextHeartbeat(); await a.runEvHeartbeat(); await h.drain(); }
      await h.flush();
      if (status && second % 2 === 0) { JSON.stringify(a.getPublicStatus()); if (record) reads++; }
      if (second % 100 === 0) releaseHarnessRecords(record);
    }
    releaseHarnessRecords(record);
    global.gc();
    return { ...process.memoryUsage(), liveFakeTimers: h.timers.length };
  }
  await chunk(false);
  const start = { ...process.memoryUsage(), liveFakeTimers: h.timers.length }, samples = [];
  for (let i = 0; i < 5; i++) samples.push(await chunk(true));
  assert.deepEqual(h.errors, []);
  assert(samples.every(s => s.liveFakeTimers < 10), 'unexpected accumulating pending timers');
  return { connected, liveStatus: status, measuredInputs: 10000, statusReads: reads,
    start, samples, retainedHeapBytes: samples.at(-1).heapUsed - start.heapUsed,
    actuationCount: actuations, actuationDigest: digest.digest('hex') };
}

async function main() {
  assert(global.gc, 'Run with node --expose-gc');
  if (process.argv[2] === '--worker') {
    global.Date = VirtualDate;
    const restore = installVirtualClearTimeout();
    try { console.log(JSON.stringify(await measure(path.resolve(process.argv[3]), process.argv[4] === 'true', process.argv[5] === 'true'))); }
    finally { restore(); global.Date = RealDate; }
    return;
  }
  const beforeRoot = path.resolve(process.argv[2] || ROOT);
  const result = { node: process.version, scope: 'Separate host process per profile/version, diagnostics off; 2000 warm-up inputs, then 10000 inputs. GC between 2000-input chunks.', profiles: [] };
  function worker(root, connected, status) {
    const child = spawnSync(process.execPath, ['--expose-gc', __filename, '--worker', root, String(connected), String(status)], { encoding:'utf8' });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  for (const [connected, status] of [[true, false], [false, false], [true, true]]) {
    const before = worker(beforeRoot, connected, status), after = worker(ROOT, connected, status);
    assert.equal(after.actuationCount, before.actuationCount);
    assert.equal(after.actuationDigest, before.actuationDigest);
    result.profiles.push({ connected, liveStatus: status, before, after, outputsIdentical: true });
  }
  if (process.env.EV_WORK_MEMORY_OUTPUT) fs.writeFileSync(process.env.EV_WORK_MEMORY_OUTPUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
main().catch(err => { console.error(err); process.exitCode = 1; });
