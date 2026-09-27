'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { translate, localizeDisplay, localizeTokens } = require('../lib/display-language');
const bundle = require('../settings/translations/en.json');
const { boot } = require('./startup-harness');
const examples = [
  ['Verdeling beschikbaar PV-vermogen', 'Available PV power allocation'],
  ['HVAC alsnog uitschakelen onder batterij-SoC (%)', 'Also stop HVAC below battery SoC (%)'],
  ['EV — laden koppelen aan tarieven', 'EV — link charging to tariffs'],
  ['Voeg eerst minstens één tarief toe.', 'Add at least one tariff first.'],
  ['Netladen · herstel Safety SoC 23.0%', 'Grid charging · restoring Safety SoC 23.0%'],
  ['Boiler opgewarmd · opnieuw koud om 07:00', 'Boiler warmed · marked cold again at 07:00'],
  ['Laden uit zon 2345 W', 'Solar charging 2345 W'],
  ['Batterij sparen · ontladen tot forecast-doel 23.2%', 'Battery Save · discharging to forecast target 23.2%'],
  ['January 2026', 'January 2026'],
];
for (const [input, expected] of examples) assert.equal(translate(input), expected);
const composite = 'Slim laden via tarief (netlimiet 7000 W totaal) · gewicht 1 · PV-verdeling EV 20% / batterij 80% · 200 W ongebruikt batterijbudget vrijgegeven aan EV';
assert.equal(translate(composite), 'Smart charging via tariff (total grid limit 7000 W) · weight 1 · PV allocation EV 20% / battery 80% · 200 W of unused battery budget released to the EV');
for (const output of [...Object.values(bundle.exact), ...Object.values(bundle.templates)]) {
  const concrete = output.replace(/\{\d+\}/g, '12');
  assert.equal(translate(concrete), concrete, 'Repeated translation must preserve English: ' + concrete);
}
for (const blank of ['', ' ', '\n  ', '\t']) assert.equal(translate(blank), blank);
const source = { baseMode: 'solar_capture', modeLabel: examples[7][0], targetSoc: 23.2,
  settings: { boilerName: 'Batterij', formula: 'prijs + 0.2' }, tariff: { kind: 'tou', label: 'Dal' },
  evs: [{ name: 'Laden', reason: composite, allowed: true, effectiveChargeMode: 'smart' }] };
const before = JSON.stringify(source);
const en = localizeDisplay(source, 'en');
assert.equal(en.modeLabel, examples[7][1]);
assert.equal(en.evs[0].reason, translate(composite));
assert.equal(en.evs[0].name, 'Laden');
assert.deepEqual(en.settings, source.settings);
assert.deepEqual(en.tariff, source.tariff);
assert.equal(en.baseMode, 'solar_capture');
assert.equal(JSON.stringify(source), before, 'Localization must not mutate controller state');
assert.deepEqual(localizeDisplay(en, 'en'), en);
assert.deepEqual(localizeDisplay(source, 'sv'), en, 'Unsupported language uses English');
assert.equal(localizeDisplay(source, 'nl'), source);
assert.deepEqual(localizeTokens({ mode: 'smart', reason: 'EV-module uit', publish_allowed: 'Ja', total_command: -123 }, 'en'),
  { mode: 'smart', reason: 'EV module off', publish_allowed: 'Yes', total_command: -123 });
// Exercise the actual UI translator and observer through the startup regression;
// this file also verifies every complete English catalog value is stable.
assert(fs.readFileSync(require.resolve('../settings/index.html'), 'utf8').includes('display-language.js'));
(async () => {
  const { app, cards } = await boot(); // English Homey
  app.homey.app = app;
  app.latestResult = { ...source, statusText: examples[4][0], workingModeLabel: examples[6][0] };
  const status = app.getPublicStatus();
  assert.equal(status.modeLabel, examples[7][1]);
  assert.equal(app.latestResult.modeLabel, examples[7][0], 'Internal decision remains unchanged');
  // The widget renders this API tariff label directly, without a second translation pass.
  for (const [nl, en, priceClass, englishClass] of [
    ['Normaal', 'Normal', 'normaal', 'normal'],
    ['Goedkoop', 'Cheap', 'goedkoop', 'cheap'],
    ['Duur', 'Expensive', 'duur', 'expensive'],
  ]) {
    for (const price of ['0.150', '-0.025']) {
      app.latestResult.tariff = { kind: 'dynamic', label: `${nl} €${price}/kWh`,
        nextLabel: `${nl} €${price}/kWh`, className: englishClass, price: Number(price) };
      const localized = app.getPublicStatus().tariff;
      assert.equal(localized.label, `${en} €${price}/kWh`);
      assert.equal(localized.nextLabel, `${en} €${price}/kWh`);
      assert.equal(localized.price, Number(price));
      assert.equal(app.latestResult.tariff.label, `${nl} €${price}/kWh`);
    }
    assert.equal(localizeDisplay({ homeyEnergy: { priceClass } }, 'en').homeyEnergy.priceClass, englishClass);
    assert.equal(localizeDisplay({ homeyEnergy: { priceClass } }, 'nl').homeyEnergy.priceClass, priceClass);
  }
  const tokens = await cards.get('get_ems_status').listener();
  assert.equal(tokens.status, examples[4][1]);
  assert.equal(tokens.action, examples[6][1]);
  app.homey.i18n.getLanguage = () => 'nl';
  assert.equal(app.getPublicStatus().modeLabel, examples[7][0]);
  const api = require('../api');
  app.homey.i18n.getLanguage = () => 'en';
  app.testEvOutput = async () => { throw Error('EV 2-laadstroom Flow-trigger is niet beschikbaar.'); };
  await assert.rejects(api.testEvOutput({ homey: app.homey, body: {} }), /EV 2 charging-current Flow trigger is unavailable/);
  console.log('0.9.3: English UI/runtime translations, composite reasons, idempotence, Dutch preservation, fallback language, Flow values and API errors passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
