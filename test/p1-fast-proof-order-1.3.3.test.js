'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');

async function run() {
  const restore = installVirtualClearTimeout();
  try {
    const h = await setup(path.join(__dirname, '..'), {
      gridControlWindowSeconds: 0, maxTotalChargeW: 1000,
      adaptiveLiveControlEnabled: false,
    }, Date.parse('2026-10-13T11:32:10Z'), 1550);
    await h.start();
    h.setNow(h.now() + 10000);
    await h.grid(50);
    h.app.requestEvaluate(true);
    await h.drain();
    const a = h.app, settings = a.getSettings(), memo = a.batteryFeedbackMemo;
    assert.equal(a.latestResult.baseMode, 'charge');
    assert(memo?.chargingInputs?.length > 0);
    assert(h.now() < memo.validUntil);
    const original = a.getChargingInputSignature.bind(a);
    let reads = 0;
    a.getChargingInputSignature = (...args) => { reads += 1; return original(...args); };
    const known = memo.chargingInputs[0];
    const unseen = { rawGridW: known.rawGridW + 12345,
      controlGridW: known.controlGridW + 12345, adaptiveLive: known.adaptiveLive };
    assert.equal(a.canSkipUnchangedChargingInput(settings, h.now(), unseen), false);
    assert.equal(reads, 0, 'unseen P1 pair must not serialize a charging signature');
    assert.equal(a.canSkipUnchangedChargingInput(settings, h.now(), known), true);
    assert.equal(reads, 1, 'known pair must still validate the full signature');
    assert.deepEqual(h.errors, []);
    process.stdout.write('P1 charging proof ordering: unseen meter bypasses serialization; known meter validates all dependencies.\n');
  } finally { restore(); }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
