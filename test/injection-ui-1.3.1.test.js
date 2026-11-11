'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { page } = require('./helpers/settings-page-1.2.37.cjs');
const { createTranslator } = require('../settings/display-language');

const drain = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };

(async () => {
  let checks = 0;
  for (const lang of ['nl', 'en', 'fr', 'de', 'es']) {
    const response = { active: true, reason: 'Actieve injectie', priceSource: 'import',
      comparisonPrice: 0.7, price: 0.7 - 0.1, exportCost: 0.1, currency: 'EUR',
      minimumPrice: 0.7, targetW: 3000, gridW: -3000, soc: 80, stopSoc: 40, source: 'manual' };
    const apiResponses = { '/injection/start': response,
      '/injection/stop': { ...response, active: false, reason: 'Injectie handmatig gestopt' } };
    const h = await page(lang, { apiResponses });
    try {
      const { doc, w } = h;
      const q = id => doc.getElementById(id);
      const t = createTranslator(JSON.parse(fs.readFileSync('settings/translations/' + lang + '.json')));
      assert.deepEqual(h.errors, []);
      const panel = q('panel-injection'), options = q('injectionOptions'), enable = q('injectionEnabled');
      assert.equal(enable.checked, false);
      assert(options.classList.contains('hidden'));
      assert.equal(q('injectionMinimumPrice').value, '0.7');
      assert.equal(q('injectionExportCost').value, '0');
      assert.equal(q('injectionStopSoc').value, '40');
      assert.equal(q('injectionTargetW').value, '3000');
      assert.equal(q('injectionPriceDifferenceEnabled').checked, false);
      assert.equal(q('injectionMinimumPriceDifference').value, '0.2');
      assert.equal(q('injectionSolarOverrideEnabled').checked, false);
      assert.equal(q('injectionMinimumSolarSharePercent').value, '50');
      assert(doc.querySelector('label[for="injectionExportCost"]').textContent.includes(t('Injectiekost (valuta/kWh)')));
      checks++;

      const controls = [...panel.querySelectorAll('input')];
      assert.equal(controls.length, 11);
      const values = () => controls.map(node => node.type === 'checkbox' ? node.checked : node.value);
      enable.checked = true;
      enable.dispatchEvent(new w.Event('change', { bubbles: true }));
      assert(!options.classList.contains('hidden'));
      checks++;

      const initial = values(), writes = h.writes.length, requests = h.requests.length;
      const buttons = [...panel.querySelectorAll('.hf-help-toggle')].filter(button => !button.hidden);
      assert(buttons.length >= 7);
      for (const button of buttons) {
        assert(!button.closest('label'));
        assert.equal(button.type, 'button');
        assert(button.getAttribute('aria-label').startsWith(t('Toelichting bij {0}').split('{0}')[0]));
        button.click(); assert.equal(button.getAttribute('aria-expanded'), 'true');
        button.click(); assert.equal(button.getAttribute('aria-expanded'), 'false');
      }
      checks++;
      assert.deepEqual(values(), initial);
      assert.equal(h.writes.length, writes);
      assert.equal(h.requests.length, requests);
      checks++;

      // Exercise contract-dependent advice and numeric persistence once; all
      // five languages retain the same controls and translated help.
      if (lang === 'nl') {
        const advice = q('injectionContractAdvice');
        for (const [contract, hidden] of [['fixed', false], ['tou', false], ['dynamic_hour', true], ['dynamic_quarter', true]]) {
          q('contractType').value = contract;
          q('contractType').dispatchEvent(new w.Event('change', { bubbles: true }));
          assert.equal(advice.classList.contains('hidden'), hidden, contract);
          checks++;
        }
        q('contractType').value = 'fixed';
        q('contractType').dispatchEvent(new w.Event('change', { bubbles: true }));
        q('injectionExportCost').value = '0.1';
        q('injectionExportCost').dispatchEvent(new w.Event('input', { bubbles: true }));
        q('save').click();
        await drain();
        assert.deepEqual(h.alerts, []);
        assert(h.writes.some(write => write.key === 'injectionExportCost' && write.value === 0.1));
        assert.equal(h.snapshot.injectionExportCost, 0.1);
        checks++;
      }

      q('startInjection').click();
      await drain();
      assert(h.requests.some(request => request.method === 'POST' && request.url === '/injection/start'));
      for (const [label, value] of [['Prijs voor startdrempel', '0.7'], ['Netto exportprijs', '0.6'], ['Toegepaste injectiekost', '0.1']]) {
        assert(q('injectionStatus').textContent.includes(t(label) + ': ' + value + ' EUR/kWh'));
      }
      q('stopInjection').click();
      await drain();
      assert(h.requests.some(request => request.method === 'POST' && request.url === '/injection/stop'));
      assert(q('injectionStatus').textContent.includes(t('Injectie handmatig gestopt')));
      checks += 2;

      enable.checked = false;
      enable.dispatchEvent(new w.Event('change', { bubbles: true }));
      assert(options.classList.contains('hidden'));
      for (const button of options.querySelectorAll('.hf-help-toggle')) assert(button.hidden);
      checks++;
      for (const card of ['start_injection', 'stop_injection', 'set_current_feed_in_price']) {
        const definition = JSON.parse(fs.readFileSync('.homeycompose/flow/actions/' + card + '.json'));
        assert(definition.title[lang]);
      }
      checks++;
      assert.equal(doc.querySelectorAll('[data-tab="injection"]').length, 1);
      assert.deepEqual(h.errors, []);
    } finally {
      h.close();
    }
  }
  // Saved cost must load without changing it or any unrelated setting.
  const restored = await page('nl', { snapshot: { injectionExportCost: 0.1 } });
  try {
    assert.equal(restored.doc.getElementById('injectionExportCost').value, '0.1');
    assert.equal(restored.writes.length, 0);
    checks++;
  } finally { restored.close(); }
  console.log('Injection UI 1.3.1:', checks, 'checks passed across five languages (DOM, no browser rendering).');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
