'use strict';
const assert = require('node:assert/strict');
const { P1TraceMonitor } = require('../lib/p1-trace-monitor');
let at = 1_700_000_000_000;
let usage = 0;
let ticks = 0n;
const scheduled = [];
const monitor = new P1TraceMonitor({
  version: '1.3.3',
  now: () => at,
  schedule: (fn, ms) => { const token = {fn,ms}; scheduled.push(token); return token; },
  cancel: token => { token.cancelled = true; },
  cpuUsage: previous => previous ? {user: (usage - previous.user),system: 0} : {user: usage,system: 0},
  clock: () => ticks,
});
assert.equal(monitor.active,false);
assert.equal(scheduled.length,0);
assert.equal(monitor.snapshot().session,null);
monitor.start();
assert.equal(scheduled.length,1, 'only an expiry timer when active');
const c1=monitor.begin('set_grid_power', 431);
monitor.measure(c1,'get_input_settings',()=>{ ticks += 1000000n; usage += 800; monitor.noteSettingsRead(); });
monitor.measure(c1,'fast_request',()=>{
  ticks += 1000000n; usage+=300;
  monitor.noteSettingsRead();
  monitor.outcome('fast_requested');
  monitor.outcome('fast_immediate');
  monitor.measure(c1,'battery_fast_evaluation',()=>{
    ticks += 600000n; usage += 200; monitor.noteSettingsRead();
  });
});
monitor.context('grid_context',false);
monitor.finish(c1);
assert.equal(monitor.current,null);
assert.equal(c1.settingsReads,3);
let snap=monitor.snapshot();
assert.equal(snap.totalP1,1);
assert.equal(snap.settingsReads,3);
assert.equal(snap.contextReasons.grid_context,1);
assert.equal(snap.outcomes.fast_immediate,1);
assert.equal(snap.stages.find(x=>x.name==='battery_fast_evaluation').settingsReads,1);
assert.equal(snap.stages.find(x=>x.name==='fast_request').settingsReads,1);
assert.ok(snap.stages.find(x=>x.name==='fast_request').cpuMs >= snap.stages.find(x=>x.name==='battery_fast_evaluation').cpuMs,
  'nested measurements overlap');
const c2=monitor.begin('set_grid_power_phases',992);
monitor.noteSettingsRead();
monitor.suspend(c2);
monitor.noteSettingsRead();
monitor.detached('fast_timer_fired');
monitor.resume(c2);
monitor.noteSettingsRead();
monitor.finish(c2);
assert.equal(c2.settingsReads,2, 'no settings attribution during a real await');
snap=monitor.stop();
assert.equal(snap.withPhases,1);
assert.equal(snap.withoutPhases,1);
assert.equal(snap.settingsReads,5);
assert.equal(snap.deferredEvents.fast_timer_fired,1);
assert.equal(snap.active,false);
assert.ok(scheduled[0].cancelled);
assert.equal(monitor.snapshot().settingsReads,5);
monitor.clear();
assert.equal(monitor.snapshot().session,null);
assert.equal(monitor.active,false);
console.log('P1 trace monitor tests passed');
