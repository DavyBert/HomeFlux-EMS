'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { boot, DEFAULTS } = require('./startup-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const key = (battery, unit) => `splitCommandBattery${battery}SafetyModeResend${unit}`;

async function migrationTests() {
  const minutes = [1, 5, 10, 1.5, 1440, 0, -2, 'invalid'];
  const store = new Map([['settingsSchemaVersion', 70]]);
  for (let i = 0; i < 8; i++) {
    store.set(key(i + 1, 'Minutes'), minutes[i]);
    store.set(key(i + 1, 'Enabled'), i % 2 === 0);
  }
  const h = await boot(store);
  const expected = [60, 300, 600, 90, 86400, 60, 60, 600];
  assert.equal(store.get('settingsSchemaVersion'), 71);
  for (let i = 0; i < 8; i++) {
    assert.equal(store.get(key(i + 1, 'Seconds')), expected[i], `battery ${i + 1} conversion`);
    assert.equal(h.app.getSplitBatteryConfig(i).safetyModeResendSeconds, expected[i]);
    assert.equal(store.get(key(i + 1, 'Enabled')), i % 2 === 0);
  }
  // Repeat the real migration and restart: the conversion must occur only once.
  await h.app.migrateSettings();
  const restarted = await boot(store);
  for (let i = 0; i < 8; i++) assert.equal(restarted.app.getSplitBatteryConfig(i).safetyModeResendSeconds, expected[i]);
  assert.deepEqual(h.errors, []);
  assert.deepEqual(restarted.errors, []);

  const partial = new Map([['settingsSchemaVersion', 70], [key(1, 'Minutes'), 10],
    [key(1, 'Seconds'), 1], [key(2, 'Minutes'), 5], [key(2, 'Seconds'), 7]]);
  await boot(partial);
  assert.equal(partial.get(key(1, 'Seconds')), 1, 'an already converted/edited seconds value wins');
  assert.equal(partial.get(key(2, 'Seconds')), 7);
  for (let b = 3; b <= 8; b++) assert.equal(partial.get(key(b, 'Seconds')), 600);

  const fresh = await boot(new Map());
  for (let b = 1; b <= 8; b++) {
    assert.equal(fresh.store.get(key(b, 'Seconds')), 600);
    assert.equal(DEFAULTS[key(b, 'Seconds')], 600);
    assert.equal(DEFAULTS[key(b, 'Minutes')], undefined);
    assert.equal(fresh.store.get(key(b, 'Enabled')), false);
  }
  for (const [value, expectedValue] of [[1,1],[0,1],[-5,1],[1.8,2],[86401,86400],['invalid',600],[null,600]]) {
    const config = h.app.getSplitBatteryConfig(0, { [key(1, 'Seconds')]: value });
    assert.equal(config.safetyModeResendSeconds, expectedValue);
  }
}

async function timerTests() {
  const h = await boot(new Map([['settingsSchemaVersion',71], ['batteryCount',8],
    ['controlEnabled',true]]));
  // Finish startup publications before isolating split-resend timers.
  // Otherwise unrelated PV/status timers also appear in this test capture.
  for (let pass = 0; pass < 40; pass++) await Promise.resolve();
  const a = h.app, timers = [], calls = [];
  let now = Date.parse('2026-10-21T10:00:00Z');
  const realNow = Date.now;
  Date.now = () => now;
  try {
    a.homey.setTimeout = (fn, ms) => {
      const timer = { fn, ms, due:now+ms, done:false };
      timers.push(timer); return timer;
    };
    a.isChargeTestValid = () => true;
    a.getBatteryCommandPauseInfo = () => ({ active:false });
    a.isHybridExternalControlActive = () => false;
    for (let i = 0; i < 8; i++) {
      h.store.set(`splitCommandBattery${i + 1}Enabled`,true);
      h.store.set(key(i + 1,'Enabled'),true);
      h.store.set(key(i + 1,'Seconds'),1);
      a.splitCommandState[i].currentMode = i % 2 ? 'discharge' : 'charge';
      Object.assign(a.splitCommandState[i], { lastModeSwitchAt:123, chargeHoldUntil:456,
        dischargeHoldUntil:789, pendingMode:'discharge', pendingModeSince:111, lastPower:500 });
      for (const mode of ['charge','discharge']) {
        a.splitCommandTriggers[i][`${mode}Mode`] = { trigger:async (tokens, state) => calls.push({i,mode,state}) };
        a.splitCommandTriggers[i][`${mode}Power`] = { trigger:async () => assert.fail('mode resend must never resend power') };
      }
    }
    h.store.set('controlEnabled',true);
    a.refreshSettingsCache();
    for (let i=0;i<8;i++) a.scheduleSplitSafetyModeResend(i);
    assert.equal(timers.length,8);
    assert(timers.every(t=>t.ms===1000), 'all eight batteries permit a 1-second timer');
    now+=1000;
    for (const timer of timers.slice(0,8)) await timer.fn();
    assert.equal(calls.length,8);
    assert.equal(timers.length,16,'each timer re-arms exactly once');
    for (let i=0;i<8;i++) {
      const s=a.splitCommandState[i];
      assert.equal(s.lastModeSwitchAt,123);assert.equal(s.chargeHoldUntil,456);
      assert.equal(s.dischargeHoldUntil,789);assert.equal(s.pendingModeSince,111);
      assert.equal(s.lastPower,500);
      assert.equal(calls[i].state.safety_resend,true);
    }
    // Read the currently active mode at firing, not the mode when scheduled.
    a.splitCommandState[0].currentMode='discharge';
    await timers[8].fn();
    assert.equal(calls.at(-1).mode,'discharge');
    const previousTimer=a.splitCommandState[0].safetyTimer;
    await h.setExternalSetting(key(1,'Seconds'),7);
    assert(previousTimer.done,'changing the interval cancels the old timer');
    assert.equal(a.splitCommandState[0].safetyTimer.ms,7000);
    await h.setExternalSetting(key(1,'Enabled'),false);
    assert.equal(a.splitCommandState[0].safetyTimer,null);
    // Existing output gates also apply at 1 second.
    for (const gate of ['disabled','pause','hybrid','test']) {
      const oldCount=calls.length;
      a.getBatteryCommandPauseInfo=()=>({active:gate==='pause'});
      a.isHybridExternalControlActive=()=>gate==='hybrid';
      a.isChargeTestValid=()=>gate!=='test';
      h.store.set('controlEnabled',gate!=='disabled');a.refreshSettingsCache();
      await a.splitCommandState[1].safetyTimer.fn();
      assert.equal(calls.length,oldCount,gate+' must suppress the mode output');
    }
    assert.deepEqual(h.errors,[]);
  } finally { Date.now=realNow; }
}

function uiTests() {
  const html=fs.readFileSync(require('node:path').join(__dirname,'../settings/index.html'),'utf8');
  for (let b=1;b<=8;b++) {
    const input=html.match(new RegExp('<input[^>]*id="'+key(b,'Seconds')+'"[^>]*>'))?.[0];
    assert(input,`seconds input for battery ${b}`);
    assert(input.includes('min="1"'));assert(input.includes('step="1"'));assert(input.includes('max="86400"'));
    assert(!html.includes(key(b,'Minutes')));
  }
  const en=require('../settings/translations/en.json');
  assert.equal(en.exact['Safety-herhaling elke (s)'],'Safety resend every (s)');
  assert(html.includes('Standaard 600 s (10 min). Minimum 1 seconde.'));
}

(async()=>{
 const restore=installVirtualClearTimeout();
 try { await migrationTests();await timerTests();uiTests();console.log('1.1.10 split resend: migration, restart, eight batteries, 1-second timer, interval edits, mode-only outputs and safety gates passed.'); }
 finally { restore(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
