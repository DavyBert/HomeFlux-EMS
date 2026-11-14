'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { boot, DEFAULTS } = require('./startup-harness');
const learned = require('../lib/autotune-planning');

async function setup(overrides = {}) {
  const store = new Map(Object.entries({
    ...DEFAULTS,
    batteryCount: 1,
    totalCapacityKwh: 21.6,
    lowForecastFixedEnabled: true,
    autoTuneMinConfidencePercent: 100,
    ...overrides,
  }));
  return boot(store);
}

(async () => {
  let checks = 0;
  {
    const { app, store } = await setup({ commandDeadbandW: 25 });
    for (let i = 0; i < 45; i++) app.noteAutoTuneGridSample(i % 2 ? 500 : 0, 1_000_000 + i * 1000);
    const before = app.getAutoTuneStatus();
    assert(before.recommendations.some(row => row.settingKey === 'commandDeadbandW'));
    assert(!before.managed.some(row => row.settingKey === 'commandDeadbandW'));
    const after = await app.setAutoTunePermission({ settingKey: 'commandDeadbandW', allowed: true });
    assert.equal(store.get('_autoTunePermissions').commandDeadbandW, true, 'permission is persisted');
    assert(after.managed.some(row => row.settingKey === 'commandDeadbandW' && row.autoManaged === true));
    assert(!after.recommendations.some(row => row.settingKey === 'commandDeadbandW'), 'managed recommendation must leave proposals');
    assert.equal(store.get('commandDeadbandW'), 25, 'insufficient confidence must prevent applying a change');
    checks++;

    const restarted = await boot(new Map(store));
    const restartStatus = restarted.app.getAutoTuneStatus();
    assert(restartStatus.managed.some(row => row.settingKey === 'commandDeadbandW'), 'managed permission survives reboot');
    assert(!restartStatus.recommendations.some(row => row.settingKey === 'commandDeadbandW'));
    checks++;

    const revoked = await app.setAutoTunePermission({ settingKey: 'commandDeadbandW', allowed: false });
    assert(!revoked.managed.some(row => row.settingKey === 'commandDeadbandW'));
    assert(revoked.recommendations.some(row => row.settingKey === 'commandDeadbandW'), 'unchecking re-evaluates and restores a relevant proposal');
    assert(!store.get('_autoTunePermissions').commandDeadbandW);
    checks++;

    const ignored = await app.setAutoTuneIgnored({ settingKey: 'commandDeadbandW', ignored: true });
    assert(!ignored.recommendations.some(row => row.settingKey === 'commandDeadbandW'));
    assert(ignored.ignored.some(row => row.settingKey === 'commandDeadbandW'));
    const resumed = await app.setAutoTuneIgnored({ settingKey: 'commandDeadbandW', ignored: false });
    assert(resumed.recommendations.some(row => row.settingKey === 'commandDeadbandW'));
    checks++;

    await app.applyAutoTuneRecommendationOnce({ settingKey: 'commandDeadbandW' });
    assert(!store.get('_autoTunePermissions')?.commandDeadbandW, 'apply now grants no ongoing permission');
    assert(store.get('commandDeadbandW') > 25);
    checks++;
  }

  {
    const { app, store } = await setup({ autoTuneMinConfidencePercent: 0, commandDeadbandW: 25 });
    assert.equal(app.getDefaultAutoTuneLimit('commandDeadbandW').minConfidencePercent, 0);
    assert.equal(app.getAutoTuneStatus().minConfidencePercent, 0);
    await app.setAutoTunePermission({ settingKey: 'commandDeadbandW', allowed: true });
    assert.equal(store.get('_autoTuneLimits').commandDeadbandW.minConfidencePercent, 0);
    await app.setAutoTuneLimits({ settingKey: 'commandDeadbandW', min: 25, max: 250, minConfidencePercent: 0 });
    assert.equal(app.getAutoTuneLimitFor('commandDeadbandW').minConfidencePercent, 0);
    checks++;
  }

  {
    const { app, store } = await setup({
      expectedEnergyNeedKwh: 12,
      lowForecastSelfConsumptionMinKwh: 12,
      batterySaveDischargeAboveSoc: 50,
    });
    // Simulate only the outputs of the existing evidence calculator. This tests
    // permission processing without changing any of its planning arithmetic.
    const originalRecommendations = learned.recommendations;
    const keys = ['expectedEnergyNeedKwh', 'lowForecastSelfConsumptionMinKwh', 'batterySaveDischargeAboveSoc'];
    try {
      learned.recommendations = (_days, settings) => keys.map(key => ({
        key, current: settings[key],
        recommended: key === 'batterySaveDischargeAboveSoc' ? 48 : 13,
        confidence: 95, measurementPeriod: {from: '2026-10-25', to: '2026-11-03', days: 10},
        evidence: [], reason: 'Existing evidence logic',
      }));
      const recommendations = app.getAutoTuneRecommendations();
      for (const key of keys) {
        const proposal = recommendations.find(row => row.settingKey === key);
        assert(proposal, `${key} must be proposed`);
        assert.equal(proposal.canAutoManage, true, `${key} must allow permission`);
        assert.equal(proposal.reviewOnly, undefined, `${key} must not be review-only`);
        assert.equal(proposal.autoEligible, false, 'confidence 95 must respect configured 100');
        const status = await app.setAutoTunePermission({ settingKey: key, allowed: true });
        assert(status.managed.some(row => row.settingKey === key && row.autoManaged));
        assert(!status.recommendations.some(row => row.settingKey === key));
        assert.equal(store.get(key), proposal.current, 'permission alone must not bypass confidence');
        const afterRevoke = await app.setAutoTunePermission({ settingKey: key, allowed: false });
        assert(afterRevoke.recommendations.some(row => row.settingKey === key));
        checks++;
      }
    } finally {
      learned.recommendations = originalRecommendations;
    }
  }

  // All exposed recommendations use the stable setting key as their identity;
  // their title is canonical and is the same in the managed list.
  {
    const { app } = await setup();
    for (const key of ['commandDeadbandW','gridZeroMinW','gridZeroMaxW','gridControlWindowSeconds',
      'adaptiveSetpointDeltaW','adaptiveSetpointWindowSeconds','commandIntervalSeconds',
      'pvDeltaThresholdW','pvCommandIntervalSeconds','lowForecastSelfConsumptionMinKwh',
      'expectedEnergyNeedKwh','batterySaveDischargeAboveSoc','lowForecastAutoSunnySoc',
      'lowForecastAutoSunnyMinutes','balanceDeadbandPct','balanceStrength',
      'evCommandIntervalSeconds','ev2CommandIntervalSeconds','ev3ModeSmartCurrentA','ev4ModeStandardCurrentA']) {
      const descriptor = app.getAutoTuneSettingDescriptor(key);
      assert(descriptor?.settingKey === key, `${key} must resolve to a stable descriptor`);
    }
    checks++;
  }

  // Verify the UI no longer renders a disabled permission control for advice.
  {
    const html = fs.readFileSync(require('node:path').join(__dirname, '../settings/index.html'), 'utf8');
    const view = html.slice(html.indexOf('  function renderAutoTune('), html.indexOf('  async function refreshAutoTune('));
    assert(!view.includes('item.reviewOnly'));
    assert(!view.includes("item.canAutoManage===false?'disabled'"));
    assert(view.includes('data-auto-tune-permission='));
    assert(view.includes('data-auto-tune-apply='));
    assert(view.includes('data-auto-tune-ignore='));
    assert(view.includes("'/auto-tune/permission'"));
    checks++;
  }
  console.log(`AutoTune permissions 1.4.5: ${checks} acceptance cases passed.`);
})().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
