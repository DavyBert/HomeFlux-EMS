'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const api = require('../widgets/status/api');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'widgets/status/public/index.html'), 'utf8');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this._text = ''; }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
}
const ctx = vm.createContext({ document: { createElement: tag => new Element(tag) }, Date, console });
vm.runInContext([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n'), ctx);
for (const language of ['en', 'nl']) {
  const locale = require('../locales/' + language + '.json');
  const Homey = { __: key => key.split('.').reduce((value, part) => value?.[part], locale) || key };
  const warnings = Array.from({ length: 5 }, (_, i) => ({ id: 'battery' + i,
    key: 'batterySocOld', params: { device: i + 1, minutes: 11 } }));
  const node = ctx.renderInputWarnings(warnings, Homey, true);
  assert.equal(node.className, 'input-warnings'); assert.equal(node.attributes.role, 'status');
  assert.equal(node.children.length, 4); assert.equal(node.children[3].tag, 'details');
  assert.equal(node.children[3].open, true); assert.equal(node.children[3].children.length, 3);
  assert(node.textContent.includes(language === 'nl' ? 'Batterij 2' : 'Battery 2'));
  assert(node.textContent.includes('11 min')); assert(!node.textContent.includes('{'));
  assert(!node.textContent.includes('widget.status.')); assert(!/invalid|ongeldig/.test(node.textContent));
  assert.equal(ctx.renderInputWarnings([], Homey), null);
}
assert(html.includes('color: var(--hf-attention)'));
assert(html.indexOf('copy.appendChild(reasonEl)') < html.indexOf('copy.appendChild(inputWarnings)'));
assert(html.indexOf('copy.appendChild(inputWarnings)') < html.indexOf('decision.appendChild(copy)'));
assert(html.includes("status.criticalAlert?.id === 'input' && enabled(settings, 'showCriticalAlerts')"));

const NativeDate = Date, originalNow = Date.now;
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
const restore = installVirtualClearTimeout();
async function main() {
  try {
    const start = NativeDate.parse('2026-11-01T10:00:00Z');
    const h = await setup(undefined, { evCount: 0, hvacCount: 0, boilerCount: 0 }, start, 0);
    const a = h.app;
    let status = null;
    // Real unchanged Flow receipts must move timestamps, not request counters.
    for (let sec = 0; sec <= 12 * 60; sec += 15) {
      h.setNow(start + sec * 1000);
      await h.grid(600 - a.state.lastTotalCommandW); await h.pv(0);
      if (sec % 180 === 0) for (let battery = 1; battery <= 4; battery++) {
        await h.cards.get('set_battery_soc').listener({ battery: String(battery), soc: 50 });
      }
      await h.flush(); status = await api.getStatus({ homey: { app: a } });
      assert(!status.inputWarnings.some(w => w.id === 'pv' || w.id.includes(':soc')));
      assert.equal(a.inputUpdatedAt.pv, h.now());
    }
    const pvAt = a.inputUpdatedAt.pv;
    const socAt = a.inputUpdatedAt.batterySoc[1];
    h.setNow(h.now() + 6 * 60000);
    status = await api.getStatus({ homey: { app: a } });
    assert(status.inputWarnings.some(w => w.id === 'pv' && w.ageMinutes === 6));
    assert.equal(status.criticalAlert.id, 'input', 'existing critical P1 alert remains authoritative');
    assert.equal(a.inputUpdatedAt.pv, pvAt, 'reading the widget cannot refresh a receipt');
    await h.pv(0); assert.equal(a.inputUpdatedAt.pv, h.now());
    status = await api.getStatus({ homey: { app: a } });
    assert(!status.inputWarnings.some(w => w.id === 'pv'));
    h.setNow(socAt + 11 * 60000);
    for (const battery of [1, 3, 4]) await h.cards.get('set_battery_soc').listener({ battery: String(battery), soc: 50 });
    status = await api.getStatus({ homey: { app: a } });
    assert.deepEqual(status.inputWarnings.filter(w => w.id.includes(':soc')).map(w => w.id), ['battery2:soc']);
    // Invalid messages do not extend a valid receipt timestamp.
    assert.equal(await h.cards.get('set_pv_power').listener({ power: 'invalid' }), false);
    assert.equal(a.inputUpdatedAt.pv, pvAt + 6 * 60000);
    await h.cards.get('set_battery_soc').listener({ battery: '2', soc: 50 });
    status = await api.getStatus({ homey: { app: a } });
    assert(!status.inputWarnings.some(w => w.id.includes(':soc')));

    const baseline = a.getPublicStatus();
    const before = JSON.stringify([a.state, a.latestResult, a.planningCache?.energyBudget]);
    const timerCount = h.timers.length;
    let forbiddenCalls = 0;
    for (const key of ['evaluateFastNow', 'refreshControlContext', 'requestContextEvaluate']) {
      a[key] = () => { forbiddenCalls++; throw Error('Widget read requested control work: ' + key); };
    }
    const response = await api.getStatus({ homey: { app: a } });
    const { inputWarnings, priceCurves, ...unchanged } = response;
    assert.deepEqual(unchanged, baseline, 'WAF, decision reasons, critical alerts and all existing fields are unchanged');
    assert.equal(JSON.stringify([a.state, a.latestResult, a.planningCache?.energyBudget]), before);
    assert.equal(h.timers.length, timerCount); assert.equal(forbiddenCalls, 0);
    assert.deepEqual(h.errors, []);
    fs.writeFileSync(path.join(root, 'validation/input-warnings-widget-1.2.12.json'), JSON.stringify({ passed: true,
      realFlowReceipts: true, sameValueRecovery: true, invalidReceiptRejected: true,
      localizedRendering: ['nl', 'en'], accessibleOverflow: true, unchangedStatusAndWaf: true,
      additionalTimers: 0, additionalControlOrPlanningCalls: forbiddenCalls }, null, 2) + '\n');
    console.log('PASS input warning widget: real Flow receipts/recovery, NL/EN, overflow, critical priority, unchanged WAF/status, no control work or timers');
  } finally { Date.now = originalNow; global.Date = NativeDate; restore(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
