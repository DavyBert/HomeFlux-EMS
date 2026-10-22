'use strict';
// Real Node process CPU; application/Flow/schedulers/outputs are real.
// Only Homey I/O, time and physical response use the existing replay harness.
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const cpuMs = mark => { const c = process.cpuUsage(mark); return (c.user + c.system) / 1000; };
(async () => {
  let metrics;
  const flexible = require(path.join(root, 'lib/flexible-loads'));
  const calculate = flexible.calculateEvDecision;
  flexible.calculateEvDecision = function (...args) {
    if (!metrics) return calculate.apply(this, args);
    const mark = process.cpuUsage(), bucket = metrics.calculateEvDecision ||= { calls: 0, cpuMs: 0 };
    bucket.calls++;
    try { return calculate.apply(this, args); } finally { bucket.cpuMs += cpuMs(mark); }
  };
  const { cases, replay } = require('./ev-feedback-1.0.11.test');
  const { app } = await require(path.join(root, 'test/startup-harness')).boot();
  const proto = Object.getPrototypeOf(app);
  const record = proto.recordDiagnosticCounter;
  proto.recordDiagnosticCounter = function (name, amount = 1) {
    if (metrics) { const counters = metrics.counters ||= {}; counters[name] = (counters[name] || 0) + amount; }
    return record.call(this, name, amount);
  };
  for (const name of ['evaluateContextNow', 'calculateEvPortfolioDecisions', 'getEvGridImportControlStatus', 'updateEvStatusInput']) {
    const original = proto[name];
    proto[name] = function (...args) {
      if (!metrics) return original.apply(this, args);
      const mark = process.cpuUsage();
      const bucket = metrics[name] ||= { calls: 0, cpuMs: 0 };
      bucket.calls++;
      try { return original.apply(this, args); } finally { bucket.cpuMs += cpuMs(mark); }
    };
  }
  const results = [];
  for (const scenario of cases) {
    metrics = {};
    const mark = process.cpuUsage();
    const r = await replay(root, scenario);
    results.push({ name: scenario.name, seconds: 240, cpuMs: cpuMs(mark), functions: metrics,
      fullContexts: r.contexts.length, fullRequests: r.requests.length,
      batteryPublications: r.batteryPublishes.length,
      evOutputs: r.evPublishes.map(x => ({ at: x.at, id: x.id, currentA: x.tokens.charge_current, allowed: x.tokens.allowed_value, mode: x.tokens.charge_mode })),
      final: { batteryW: r.final.batteryW, evPowerW: r.final.active, desiredA: r.final.desiredA, physicalGridW: r.final.physicalGridW } });
  }
  console.log(JSON.stringify({ node: process.version, root, instrumentation: 'Synchronous process.cpuUsage scopes; nested sections must not be summed. Includes startup of each replay.', results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
