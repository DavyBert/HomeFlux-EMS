'use strict';
const assert = require('node:assert/strict');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const injection = require('../lib/active-injection');
const { emptyDay, emptyInventory } = require('../lib/savings');
const restore = installVirtualClearTimeout(), originalNow = Date.now;
const close = (a, b) => assert(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
async function fresh(extra = {}) {
  const h = await setup(undefined, { injectionEnabled: true, fixedImportPrice: .70,
    fixedFeedInPrice: .08, injectionMinimumPrice: .70, injectionExportCost: .10,
    peakShaveEnabled: false, exportLimitEnabled: false, ...extra },
  Date.parse('2026-11-09T14:05:00Z'), 0);
  await h.drain();
  h.app.requestEvaluate = () => {};
  h.app.requestContextEvaluate = () => {};
  return h;
}
(async () => {
  let groups = 0;
  try {
    {
      const h = await fresh(), a = h.app;
      await injection.start(a);
      assert(a.injectionRuntime.active, '0.70 gross meets 0.70 threshold before cost');
      close(a.getSavingsTariffSnapshot().feedInPrice, .60);
      const status = injection.status(a);
      close(status.comparisonPrice, .70); close(status.price, .60); close(status.exportCost, .10);
      await h.cards.get('set_current_feed_in_price').listener({ price: 87, currency: 'EUR', unit: 'cent/kWh', minutes: 60 });
      close(a.getSavingsTariffSnapshot().feedInPrice, .87);
      close(injection.status(a).exportCost, 0);
      assert.equal(a.injectionRuntime.feed.endAt, Date.parse('2026-11-09T14:15:00Z'));
      h.setNow(Date.parse('2026-11-09T14:15:00Z'));
      a.inputUpdatedAt.grid = h.now(); a.inputUpdatedAt.batterySoc.fill(h.now());
      injection.tick(a, a.getSettings(), h.now(), false); await h.drain();
      assert(a.injectionRuntime.active, 'eligible import fallback continues without a needless stop');
      close(a.getSavingsTariffSnapshot().feedInPrice, .60);
      assert.equal(injection.status(a).priceSource, 'import');
      groups++;
    }
    {
      const h = await fresh({ fixedImportPrice: .30 }), a = h.app;
      await h.cards.get('set_current_feed_in_price').listener({ price: .87, currency: 'EUR', unit: 'kWh', minutes: 15 });
      await injection.start(a);
      close(a.getSavingsTariffSnapshot().feedInPrice, .87);
      h.setNow(a.injectionRuntime.feed.endAt);
      a.inputUpdatedAt.grid = h.now(); a.inputUpdatedAt.batterySoc.fill(h.now());
      injection.tick(a, a.getSettings(), h.now(), false); await h.drain();
      assert.equal(injection.locked(a), false, 'ineligible fallback stops export');
      close(a.getSavingsTariffSnapshot().feedInPrice, .20);
      groups++;
    }
    {
      const h = await fresh(), a = h.app;
      await h.cards.get('set_current_feed_in_price').listener({ price: .87, currency: 'EUR', unit: 'kWh', minutes: 60 });
      a.savings.today = emptyDay('2026-11-09');
      a.savings.inventory = emptyInventory();
      a.savings.total = 0;
      a.savings.lastSampleAt = Date.parse('2026-11-09T14:14:00Z');
      h.setNow(Date.parse('2026-11-09T14:16:00Z'));
      a.state.gridPowerW = -1000; a.state.pvPowerW = 1000; a.state.lastTotalCommandW = 0;
      a.inputSeen.grid = true; a.inputSeen.pv = true;
      a.inputUpdatedAt.grid = h.now(); a.inputUpdatedAt.pv = h.now();
      a.recordSavingsSample(h.now());
      close(a.savings.today.directPvExportKwh, 2 / 60);
      close(a.savings.today.directPvExportValue, (.87 + .60) / 60);
      close(a.savings.total, (.87 + .60) / 60);
      groups++;
    }
    {
      const h = await fresh({ injectionEnabled: false }), a = h.app;
      close(a.getSavingsTariffSnapshot().feedInPrice, .08, 'ordinary fixed accounting is unchanged');
      for (const price of [.87, -.12, 101]) {
        assert.equal(await h.cards.get('set_external_export_price').listener({ price }), true);
        assert.equal(a.externalEnergy.exportPrice, price);
        assert.equal(injection.locked(a), false);
        close(a.getSavingsTariffSnapshot().feedInPrice, .08);
      }
      groups++;
    }
    {
      const h = await fresh({ injectionEnabled: false, contractType: 'dynamic' }), a = h.app;
      assert.equal(await h.cards.get('set_external_export_price').listener({ price: 101 }), true);
      close(a.getSavingsTariffSnapshot().feedInPrice, 101);
      await h.cards.get('set_current_feed_in_price').listener({ price: 870, currency: 'EUR', unit: 'MWh', minutes: 15 });
      close(a.getSavingsTariffSnapshot().feedInPrice, .87, 'new card updates the actual accounting price');
      assert.equal(injection.locked(a), false);
      await assert.rejects(() => h.cards.get('set_current_feed_in_price').listener({ price: NaN }), /Ongeldige/);
      close(a.getSavingsTariffSnapshot().feedInPrice, .87, 'invalid new input cannot corrupt the previous accounting interval');
      groups++;
    }
    console.log('Injection accounting 1.3.1:', groups, 'scenario groups passed');
  } finally { restore(); Date.now = originalNow; }
})().catch(error => { console.error(error); process.exitCode = 1; });
