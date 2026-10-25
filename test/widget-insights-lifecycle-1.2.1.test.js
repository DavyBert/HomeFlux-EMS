'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../widgets/status/public/index.html'), 'utf8').match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
async function session(settings = {}) {
  let clock = 1000000, counter = 0, calls = 0;
  const timers = new Map(), nodes = {}, documentListeners = new Map(), windowListeners = new Map();
  class Element {
    constructor() { this.children = []; this.style = {}; this.scrollHeight = 500;
      this.classList = { add() {}, remove() {} }; }
    set id(id) { this._id = id; nodes[id] = this; }
    get id() { return this._id; }
    set innerHTML(value) { this.children = []; }
    get firstChild() { return this.children[0]; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); return node; }
    setAttribute() {}
  }
  for (const id of ['widget','content','error']) nodes[id] = new Element();
  const document = { hidden: false, getElementById: id => nodes[id], createElement: () => new Element(),
    addEventListener: (event, cb) => documentListeners.set(event, cb), removeEventListener: event => documentListeners.delete(event) };
  const window = { addEventListener: (event, cb) => windowListeners.set(event, cb), removeEventListener: event => windowListeners.delete(event) };
  const NativeDate = Date;
  class ClockDate extends NativeDate { static now() { return clock; } }
  let status = { action: 'discharge', settings: {} };
  const Homey = { getSettings: () => settings, __: key => key,
    api: async () => { calls++; return structuredClone(status); }, ready: async () => {}, setHeight: async () => {} };
  const ui = vm.createContext({ console, document, window, Homey, Date: ClockDate,
    requestAnimationFrame: cb => cb(),
    setInterval: (fn, ms) => { const id = ++counter; timers.set(id, { fn, ms, due: clock + ms }); return id; },
    clearInterval: id => timers.delete(id) });
  vm.runInContext(source, ui); await vm.runInContext('onHomeyReady(Homey)', ui);
  async function advance(ms) {
    const target = clock + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a,b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > target) break;
      clock = next[1].due; next[1].due += next[1].ms; next[1].fn(); await drain();
    }
    clock = target; await drain();
  }
  return { timers, nodes, advance, document, windowListeners, documentListeners,
    setStatus: value => { status = value; }, calls: () => calls };
}
(async () => {
  const h = await session(); assert.equal(h.calls(), 1); assert.equal(h.timers.size, 1);
  await h.advance(30000); assert.equal(h.calls(), 4); assert.equal(h.timers.size, 1, 'no clock without alerts');
  h.setStatus({ action: 'discharge', settings: {}, criticalAlert: { id: 'balance' } });
  await h.advance(10000); assert.equal(h.calls(), 5); assert.equal(h.timers.size, 2);
  assert.equal(h.nodes['decision-value'].textContent, 'Discharging battery');
  await h.advance(5000); assert.equal(h.calls(), 5, 'rotation must not poll');
  assert(h.nodes['decision-value'].textContent.startsWith('Warning:'));
  await h.advance(5000); assert.equal(h.calls(), 6);
  assert.equal(h.nodes['decision-value'].textContent, 'Discharging battery');
  h.setStatus({ action: 'discharge', settings: {} }); await h.advance(10000);
  assert.equal(h.nodes['decision-value'].textContent, 'Discharging battery'); assert.equal(h.timers.size, 1);
  h.document.hidden = true; h.documentListeners.get('visibilitychange')(); assert.equal(h.timers.size, 0);
  const paused = h.calls(); await h.advance(100000); assert.equal(h.calls(), paused);
  h.document.hidden = false; h.documentListeners.get('visibilitychange')();
  h.documentListeners.get('visibilitychange')(); assert.equal(h.timers.size, 1, 'resume never duplicates clocks');
  h.windowListeners.get('pagehide')(); assert.equal(h.timers.size, 0);
  h.windowListeners.get('pageshow')(); assert.equal(h.timers.size, 1);
  h.windowListeners.get('unload')(); assert.equal(h.timers.size, 0); assert.equal(h.documentListeners.size, 0);
  const disabled = await session({ showEnergyBudget: false, showCriticalAlerts: false, statusColors: false });
  disabled.setStatus({ criticalAlert: { id: 'input' }, settings: {} }); await disabled.advance(30000);
  assert.equal(disabled.timers.size, 1);
  console.log('PASS widget lifecycle: unchanged 10s polling, 5s local warning clock only when needed, recovery, visibility/page cleanup, independent disabled options');
})().catch(error => { console.error(error); process.exitCode = 1; });
