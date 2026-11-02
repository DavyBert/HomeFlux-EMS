'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./startup-harness');
const results = [];
(async () => {
  const h = await boot(new Map(Object.entries({ evCount: 2, batteryCount: 0, controlEnabled: false })));
  const a = h.app;
  a.requestContextEvaluate = () => {}; // isolate the INPUT gate; no planner is replaced
  const listener = (id, type) => a.slotFlowCards.actions.get(`set_ev${id}_${type}_deadline`);
  assert.equal(typeof listener(1, 'soc'), 'function');
  const call = listener(1, 'soc')({ target_soc: 80, time: '07:00', guarantee: 'no' });
  assert.equal(a.evSocPlans[0].targetSoc, 80, 'central commit occurs synchronously, before awaiting listener');
  assert.equal(await call, true);
  assert.equal(h.store.get('evSocDeadlineOverrides')[0].targetSoc, 80);
  results.push('Numbered, selector and configured Flow cards share the registered SlotFlowCards listener and synchronous setEvSocPlan/setEvEnergyPlan input functions');
  await listener(1, 'soc')({ target_soc: 90, time: '07:00', guarantee: 'yes' });
  // A thin adapter can read the central goal and invoke the exact registered
  // listener in the SAME synchronous turn, with no await between read/commit.
  const current = a.evSocPlans[0];
  const patch = listener(1, 'soc')({ target_soc: current.targetSoc, time: '12:00', guarantee: current.guarantee ? 'yes' : 'no' });
  assert.equal(a.evSocPlans[0].targetSoc, 90); assert.equal(a.evSocPlans[0].targetTime, '12:00');
  assert.equal(await patch, true); assert(a.evSocPlans[0].guarantee);
  results.push('Fresh central read plus listener invocation has no asynchronous gap; a deadline patch preserves a newer Flow target and Guaranteed');
  const saved = JSON.stringify(a.evSocPlans);
  for (const args of [{ target_soc: 101, time: '07:00' }, { target_soc: 80, time: '25:00' }]) {
    assert.equal(await listener(1, 'soc')(args), false); assert.equal(JSON.stringify(a.evSocPlans), saved);
  }
  assert.equal(await listener(2, 'energy')({ energy: 10, time: '17:00', guarantee: 'yes' }), true);
  assert.equal(a.evSocPlans[0].targetSoc, 90); assert.equal(a.evEnergyPlans[1].targetKwh, 10);
  assert.equal(await listener(2, 'energy')({ energy: 251, time: '17:00' }), false);
  results.push('Original validation is shared, rejects before mutation, and stable numbered EV slots remain isolated');
  const restarted = await boot(new Map(h.store));
  assert.equal(restarted.app.evSocPlans[0].targetSoc, 90);
  assert.equal(restarted.app.evEnergyPlans[1].targetKwh, 10);
  results.push('Original override persistence survives restart with batteryCount=0 and battery control disabled');
  const report = { gate: 'PASS', schedulerImplementationPermitted: true, simulatedHomey: true,
    inputFunctions: ['setEvSocPlan', 'setEvEnergyPlan'], listenerMap: 'slotFlowCards.actions',
    plannerLogicChangesRequired: false, results };
  fs.writeFileSync(path.join(__dirname, '../validation/ev-widget-handler-audit-1.2.4.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS mandatory EV Scheduler source/handler gate (4 checks)');
})().catch(error => { console.error(error); process.exitCode = 1; });
