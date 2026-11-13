'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const phaseGuard = require('../lib/phase-guard');
const settingsHtml = fs.readFileSync('settings/index.html', 'utf8');
const widgetHtml = fs.readFileSync('widgets/status/public/index.html', 'utf8');
const { createTranslator } = require('../settings/display-language');
const now = 1800000000000;
const settings = { phaseGuard: { ...phaseGuard.defaults, enabled: true, phases: 3, voltage: 230, amps: 25, limitW: 4600 } };
const app = { lastEmittedCommands: [0] };

const nodes = new Map();
const q = id => {
  if (!nodes.has(id)) nodes.set(id, {
    value: '', checked: false, classList: { toggle(name, active) { this[name] = active; } },
  });
  return nodes.get(id);
};
q('gridConnectionPhases').value = '3';
q('phaseGuardEnabled').checked = true;
const settingsContext = vm.createContext({ q, translateUiText: text => text, Date });
const settingsStart = settingsHtml.indexOf('  function renderLivePhases(');
const settingsEnd = settingsHtml.indexOf('  function notifyChargeTestRequirement(', settingsStart);
assert(settingsStart >= 0 && settingsEnd > settingsStart);
vm.runInContext(settingsHtml.slice(settingsStart, settingsEnd), settingsContext);

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this._text = ''; }
  appendChild(el) { this.children.push(el); return el; }
  append(...els) { els.forEach(el => this.appendChild(el)); }
  setAttribute(name, value) { this.attributes[name] = value; }
  set textContent(text) { this._text = String(text); this.children = []; }
  get textContent() { return this._text + this.children.map(el => el.textContent).join(''); }
  set innerHTML(text) { this._text = String(text); this.children = []; }
}
let widgetNow = now;
class WidgetDate extends Date { static now() { return widgetNow; } }
const content = new Element('div');
const document = {
  createElement: tag => new Element(tag),
  getElementById: id => id === 'content' ? content : null,
};
const widgetContext = vm.createContext({ document, Date: WidgetDate, console });
vm.runInContext([...widgetHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n'), widgetContext);
const flags = new Proxy({ showDecision: false, showEnergyBudget: false }, {
  get(target, prop) { return String(prop).startsWith('show') ? target[prop] ?? false : target[prop]; },
});
const locale = lang => {
  const bundle = require('../locales/' + lang + '.json');
  return { __: key => key.split('.').reduce((item, part) => item?.[part], bundle) || key };
};
const display = (date = now) => {
  widgetNow = date;
  const phase = phaseGuard.status(app, settings, date);
  settingsContext.renderLivePhases(phase, date);
  widgetContext.renderStatus({ phaseGuard: phase }, flags, locale('nl'));
  return phase;
};

// Enabling phase guard before a single phase Flow value has arrived.
let phase = display();
assert.equal(phase.state, 'unavailable');
assert.equal(content.children[0]?.id, 'phase-reception-warning');
assert.match(content.textContent, /L1: niet ontvangen.*L2: niet ontvangen.*L3: niet ontvangen/);
assert.match(q('phaseGuardReception').textContent, /L1: Fasemeting niet ontvangen/);
assert.equal(q('phaseGuardReceptionStatus').classList['phase-reception-alert'], true);
assert.equal(q('phaseGuardReception').classList.hidden, false);

// Partial receipts and measured zero W are distinguished from missing data.
phaseGuard.ingest(app, { l1: 0, l2: 1100 }, now + 1000);
phase = display(now + 1000);
assert.match(content.textContent, /L1: ontvangen.*L2: ontvangen.*L3: niet ontvangen/);
assert.match(q('phaseGuardReception').textContent, /L1: Fasemeting ontvangen.*L3: Fasemeting niet ontvangen/);

// One valid complete snapshot clears the warning in both UIs.
phaseGuard.ingest(app, { l1: 0, l2: 1200, l3: -300 }, now + 2000);
phase = display(now + 2000);
assert.equal(content.children.length, 0, 'warning must disappear after all three phases are current');
assert.match(q('phaseGuardReception').textContent, /Fasemetingen L1, L2 en L3 worden ontvangen/);
assert.equal(q('phaseGuardReception').classList['phase-reception-alert'], false);
assert.equal(q('livePhase1Power').textContent, '0 W');

// A stale snapshot becomes unsafe after the original 15-second horizon.
phase = display(now + 17001);
assert.equal(phase.state, 'unavailable');
assert.match(content.textContent, /L1: verouderd.*L2: verouderd.*L3: verouderd/);
assert.match(q('phaseGuardReceptionStatus').textContent, /L2: Fasemeting verouderd/);

// Display-only cached values cannot falsely confirm a missing Flow input.
phaseGuard.ingest(app, { l1: 150, l3: 220 }, now + 18000);
phase = display(now + 18000);
assert.equal(phase.values[1].watts, null);
assert(phase.displayValues[1].at > 0, 'fixture has a retained L2 display sample');
assert.match(content.textContent, /L2: niet ontvangen/);
assert.match(q('phaseGuardReception').textContent, /L2: Fasemeting niet ontvangen/);

// Disabled phase monitoring never produces this warning.
settings.phaseGuard.enabled = false;
display(now + 18001);
assert.equal(content.children.length, 0);
q('phaseGuardEnabled').checked = false;
display(now + 18002);
assert.equal(q('phaseGuardReception').classList.hidden, true);

// Localized widget warning and presentation strings are available in all languages.
settings.phaseGuard.enabled = true;
for (const lang of ['nl', 'en', 'fr', 'de', 'es']) {
  const widgetLabels = require('../locales/' + lang + '.json').widget.status;
  const bundle = require('../settings/translations/' + lang + '.json');
  for (const label of ['Fasemetingen ontbreken of zijn verouderd. Controleer de Flow-kaart met L1, L2 en L3.',
    'Fasemetingen L1, L2 en L3 worden ontvangen.', 'Fasemeting ontvangen', 'Fasemeting verouderd', 'Fasemeting niet ontvangen']) {
    assert.equal(typeof bundle.exact[label], 'string', lang + '/' + label);
    assert(bundle.exact[label]);
  }
  for (const key of ['phaseGuardReceptionWarning', 'phaseReceptionReceived', 'phaseReceptionMissing', 'phaseReceptionStale']) {
    assert.equal(typeof widgetLabels[key], 'string', lang + '/' + key);
    assert(widgetLabels[key]);
  }
  widgetContext.renderStatus({ phaseGuard: phaseGuard.status(app, settings, now + 18000) }, flags, locale(lang));
  assert.equal(content.children[0]?.id, 'phase-reception-warning');
  assert(content.textContent.includes(widgetLabels.phaseGuardReceptionWarning));
  assert(content.textContent.includes('L2: ' + widgetLabels.phaseReceptionMissing));
  assert(!content.textContent.includes('widget.status.phase'), lang + ': untranslated key');
  // Lightweight per-language Settings UI smoke test (no browser dependency).
  q('phaseGuardEnabled').checked = true;
  settingsContext.translateUiText = createTranslator(bundle);
  settingsContext.renderLivePhases(phaseGuard.status(app, settings, now + 18000), now + 18000);
  assert(q('phaseGuardReception').textContent.includes(bundle.exact['Fasemeting niet ontvangen']), lang + ': phase text');
  assert(q('phaseGuardReception').textContent.includes(bundle.exact['Fasemetingen ontbreken of zijn verouderd. Controleer de Flow-kaart met L1, L2 en L3.']), lang + ': warning text');
  assert.equal(q('phaseGuardReception').classList['phase-reception-alert'], true);
}
assert(widgetHtml.includes('if(phaseWarning)content.appendChild(phaseWarning)'), 'phase warning must be outside optional decision section');
assert(settingsHtml.includes("const phaseMonitoringOpen=q('panel-ems')"), 'reuse existing status timer on phase settings tab');
assert.equal(require('../package.json').version, '1.3.3');
console.log('PASS phase reception: no/partial/complete/stale/invalid samples, disabled guard, persistent widget, NL/EN/FR/DE/ES');
