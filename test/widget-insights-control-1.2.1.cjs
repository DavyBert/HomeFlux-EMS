'use strict';
// Optional A/B replay: node test/widget-insights-control-1.2.1.cjs /path/to/original/HomeFlux-EMS
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { fixture } = require('./ev-work-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const current = path.resolve(__dirname, '..'), original = process.argv[2];
if (!original) throw new Error('Supply original unmodified 1.1.20 source directory');
const OriginalDate = Date;
global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
const restore = installVirtualClearTimeout();
async function replay(root, config) {
  const h = await fixture({ root, ...config }), a = h.app;
  a.setInput({ forecastRemainingKwh: 12, forecastTomorrowKwh: 15 });
  if (config.goal) await h.cards.get('set_ev1_energy_deadline').listener({ energy: 3, time: '16:00', guarantee: 'yes' });
  await h.start(); await h.flush();
  const start = h.now();
  for (let second = 1; second <= 60; second++) {
    h.setNow(start + second * 1000); await h.grid(623 + (second % 10) * 50 - (config.pv || 0) - a.state.lastTotalCommandW); await h.flush();
  }
  const plan = { ...a.getPlanningStatus() }; delete plan.energyBudget; delete plan.version;
  return { traces: h.traces, flexible: h.flexible, plan,
    output: a.state.lastTotalCommandW, ev: a.latestEvDecision, errors: h.errors };
}
(async () => {
  const cases = [];
  for (const type of ['current', 'hybrid', 'mode']) for (const evs of [1, 4]) for (const pv of [0, 3000]) {
    const config = { type, evs, pv, chargeAllowed: true, goal: true, extra: { forcedMode: 'auto' } };
    const before = await replay(original, config), after = await replay(current, config);
    assert.deepEqual(after, before, JSON.stringify(config));
    cases.push({ type, evs, pv, identical: true });
    console.log('PASS identical battery/EV publications, decisions and plan', type, evs, pv);
  }
  fs.writeFileSync(path.join(current, 'validation/widget-insights-control-1.2.1.json'), JSON.stringify({ cases }, null, 2) + '\n');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { global.Date = OriginalDate; restore(); });
