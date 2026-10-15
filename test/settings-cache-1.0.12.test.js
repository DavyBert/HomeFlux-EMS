'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

// Inspect the real startup cache in a separate test process. Replacing it with
// a fixture object would hide the performance regression this test guards.
if (!process.argv.includes('--cache-child')) {
  const child = spawnSync(process.execPath, ['--allow-natives-syntax', __filename,
    '--cache-child', process.argv[2] || path.join(__dirname, '..')], { encoding: 'utf8' });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  assert.equal(child.status, 0, 'production settings cache regression failed');
} else {
  const root = path.resolve(process.argv[3]);
  const req = createRequire(path.join(root, 'package.json'));
  const { boot, DEFAULTS } = req('./test/startup-harness');
  const hasFastProperties = new Function('value', 'return %HasFastProperties(value)');
  (async () => {
    for (const count of [0, 4]) {
      const values = { ...DEFAULTS, settingsSchemaVersion: 70, evCount: count,
        evEnabled: false, evControlType: 'mode', ev2ControlType: 'mode',
        ev3ControlType: 'mode', ev4ControlType: 'mode', batteryCount: 4,
        hvacCount: 2, boilerCount: 1, gridZeroMinW: -35,
        _chargeTestSignature: '4:normal:single|single|single|single',
        evFeedbackTolerancePercent: 5, ev2FeedbackTolerancePercent: 10,
        ev3FeedbackTolerancePercent: 15, ev4FeedbackTolerancePercent: 20 };
      const h = await boot(new Map(Object.entries(values))), app = h.app;
      assert.equal(h.errors.length, 0, h.errors.join('\n'));
      assert.equal(app.getEvCount(), count);
      assert.equal(hasFastProperties(app.settingsCache), true,
        'startup cache must retain fast properties for frequent snapshots');
      const snapshot = app.getSettings();
      for (let index = 0; index < 4; index += 1) {
        assert.equal(snapshot[`_ev${index + 1}ModeLoadTolerancePercent`], [5,10,15,20][index]);
        assert.equal(app.getEvInstanceSettings(index, snapshot).evModeLoadTolerancePercent, [5,10,15,20][index]);
      }
      snapshot.gridZeroMinW = -999;
      assert.equal(app.getSettings().gridZeroMinW, -35, 'snapshot must not mutate cache');
      app.setSetting('gridZeroMinW', -31);
      assert.equal(app.getSettings().gridZeroMinW, -31);
      assert.equal(hasFastProperties(app.settingsCache), true);
      const expected = app.getSettings();
      app.refreshSettingsCache();
      assert.deepEqual(app.getSettings(), expected, 'cache rebuild preserves all setting values');
      assert.equal(hasFastProperties(app.settingsCache), true);
    }
    console.log('1.0.12 settings cache passed: genuine startup, EV disabled/four slots, legacy mode tolerances, snapshots and cache rebuild.');
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
