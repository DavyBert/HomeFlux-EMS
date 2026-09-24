'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boot, DEFAULTS } = require('./startup-harness');
const html = fs.readFileSync(path.join(__dirname, '../settings/index.html'), 'utf8');
const en = require('../settings/translations/en.json');

function translationRegression() {
  let observer;
  const queue = [];
  function textNode(value) {
    return { nodeType: 3, get nodeValue() { return value; }, set nodeValue(next) {
      value = next;
      if (observer) queue.push({ type: 'characterData', target: this });
    } };
  }
  const blank = textNode('\n   '), label = textNode('Instellingen opslaan');
  const attrs = { title: 'Instellingen opslaan' };
  const body = { nodeType: 1, tagName: 'BODY', childNodes: [blank, label],
    hasAttribute: key => key in attrs, getAttribute: key => attrs[key],
    setAttribute(key, value) { attrs[key] = value; if (observer) queue.push({ type: 'attributes', target: this }); } };
  const context = { uiLanguage: 'en', UI_PHRASES_EN: en.phrases, UI_EXACT_EN: en.exact,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 }, document: { body },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() { observer = this.fn; } } };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('  const uiPhrasePairs ='), html.indexOf('  const ids =')), context);
  const flush = () => {
    let batches = 0;
    while (queue.length) {
      assert(++batches < 10, 'translation observer must settle, not translate itself forever');
      observer(queue.splice(0));
    }
  };
  assert.equal(blank.nodeValue, '\n   ');
  assert.equal(label.nodeValue, en.exact['Instellingen opslaan']);
  for (const value of [' ', '\n', '\t\r\n  ', '', '\u00a0']) {
    blank.nodeValue = value; flush(); assert.equal(blank.nodeValue, value);
  }
  // Translate real external updates and moved nodes, but leave our own output stable.
  label.nodeValue = 'Instellingen opslaan';
  body.setAttribute('title', 'Instellingen opslaan');
  flush();
  const translated = label.nodeValue;
  queue.push({ type: 'childList', target: body, addedNodes: [label, blank] });
  flush();
  assert.equal(label.nodeValue, translated);
  assert.equal(attrs.title, en.exact['Instellingen opslaan']);
}

async function timeoutRegressions() {
  const pending = new Map(); let id = 0;
  const context = { uiLanguage: 'en', setTimeout: fn => { pending.set(++id, fn); return id; },
    clearTimeout: key => pending.delete(key) };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('  function withStartupTimeout('), html.indexOf('  async function loadUiTranslations()')), context);
  const call = context.withStartupTimeout;
  assert.equal(await call(() => 42, 'settings'), 42);
  assert.equal(pending.size, 0);
  await assert.rejects(call(() => { throw Error('failed'); }, 'settings'), /failed/);
  assert.equal(pending.size, 0);
  let lateResolve, aborts = 0;
  const stalled = call(() => new Promise(resolve => { lateResolve = resolve; }), 'settings', 10000, () => aborts++);
  await Promise.resolve();
  const rejected = assert.rejects(stalled, /Loading timed out/);
  [...pending.values()][0]();
  await rejected;
  lateResolve('too late');
  await Promise.resolve();
  assert.equal(aborts, 1);
  assert.equal(pending.size, 0);
}

async function defaultRegressions() {
  const first = await boot();
  assert.deepEqual(first.errors, []);
  const settings = first.app.getSettingsSnapshot();
  assert.equal(settings.controlEnabled, false);
  const keys = ['maxTotalChargeW','maxTotalDischargeW'];
  for (let i = 1; i <= 8; i++) keys.push(`battery${i}MaxChargeW`, `battery${i}MaxDischargeW`);
  for (let i = 1; i <= 4; i++) keys.push(`${i === 1 ? 'hvac' : `hvac${i}`}EnergyDeviationC`);
  for (const key of keys) assert.equal(settings[key], DEFAULTS[key], key);
  const restart = await boot(first.store);
  assert.deepEqual(restart.app.getSettingsSnapshot(), settings);
  // Existing intentional zeros must survive both old migrations and current upgrades.
  for (const schema of [0, 68]) {
    const store = new Map([['settingsSchemaVersion', schema], ['maxChargePerBatteryW', 0], ['maxDischargePerBatteryW', 0],
      ...keys.map(key => [key, 0])]);
    const upgraded = await boot(store);
    for (const key of keys) assert.equal(upgraded.app.getSettingsSnapshot()[key], 0, `${schema}: ${key}`);
  }
  // Preserve the legacy conversion for actual stored group power values.
  const old = await boot(new Map([['settingsSchemaVersion', 2], ['maxChargePerBatteryW', 6000], ['maxDischargePerBatteryW', 7000]]));
  assert.equal(old.app.getSettingsSnapshot().maxTotalChargeW, 6000);
  assert.equal(old.app.getSettingsSnapshot().maxTotalDischargeW, 7000);
}
(async () => {
  translationRegression();
  await timeoutRegressions();
  await defaultRegressions();
  console.log('0.8.3 startup regressions passed: finite translation mutations, read time-outs, fresh defaults and preserved upgrades');
})().catch(error => { console.error(error); process.exitCode = 1; });
