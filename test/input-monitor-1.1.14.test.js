'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { InputMonitor, MAX_DURATION_MS } = require('../lib/input-monitor');
const manifest = require('../app.json');
const { makeFlow } = require('./helpers/flow-cards');

function clock() {
  let now = 100000;
  const timers = new Set();
  return { now: () => now, timers,
    schedule(fn, ms) { const t = { fn, at: now + ms }; timers.add(t); return t; },
    cancel(t) { timers.delete(t); },
    advance(at) {
      for (;;) {
        const t = [...timers].filter(t => t.at <= at).sort((a,b) => a.at - b.at)[0];
        if (!t) break;
        now = t.at; timers.delete(t); t.fn();
      }
      now = at;
    } };
}
function fixture() {
  const time = clock(), flow = makeFlow();
  const m = new InputMonitor({ definitions: manifest.flow.actions, version: manifest.version,
    now: time.now, setTimeout: time.schedule, clearTimeout: time.cancel });
  const observed = m.observeFlow(flow);
  return { m, time, flow, register(id, listener = () => true) {
    observed.getActionCard(id).registerRunListener(listener);
    return args => flow.cards.actions.get(id).listener(args);
  } };
}
let cases = 0;
function pass() { cases++; }
function repeat(h, fn, rate, seconds, args) {
  const start = h.time.now();
  for (let second = 0; second < seconds; second++) {
    for (let i = 0; i < rate; i++) {
      h.time.advance(start + second * 1000 + (i + 1) * (900 / rate));
      fn(args);
    }
    h.time.advance(start + (second + 1) * 1000);
  }
}

async function main() {
  {
    const h = fixture(), input = h.register('set_grid_power');
    input({ power: 600 });
    assert.equal(h.m.session, null); assert.equal(h.time.timers.size, 0);
    const s = h.m.start().session;
    assert.equal(s.expiresAt - s.startedAt, MAX_DURATION_MS);
    h.time.advance(s.startedAt + 5000);
    assert.equal(h.m.start().session.expiresAt, s.expiresAt, 'duplicate start cannot extend session');
    input({ power: 601 });
    assert.equal(h.m.stop().totalReceived, 1);
    assert.equal(h.time.timers.size, 0);
    input({ power: 602 }); assert.equal(h.m.snapshot().totalReceived, 1);
    assert.equal(h.m.clear().session, null); pass();
  }
  {
    const h = fixture(), fn = h.register('set_grid_power');
    const s = h.m.start().session;
    // No interface or requests at all while recording.
    h.time.advance(s.expiresAt - 1); assert(h.m.active);
    fn({ power: 12 });
    h.time.advance(s.expiresAt);
    const out = h.m.snapshot(); assert.equal(out.active, false);
    assert.equal(out.session.durationMs, 900000);
    assert.equal(out.session.endedAt, s.expiresAt);
    assert.equal(h.time.timers.size, 0); fn({ power: 13 });
    assert.equal(h.m.snapshot().totalReceived, 1); pass(); pass();
    h.m.start(); h.m.destroy(); assert.equal(h.m.session, null); assert.equal(h.time.timers.size, 0); pass();
  }
  for (const [id, rate] of [['set_grid_power',1],['set_ev1_status',1],['set_ev1_status',2],['set_ev1_status',5]]) {
    const h = fixture(), fn = h.register(id);
    h.m.start();
    repeat(h, fn, rate, 4, id === 'set_grid_power' ? { power: 700 } : { connected: 'yes', charge_current: 10 });
    assert.equal(h.m.snapshot().activePossibleLoops, 0, 'four seconds cannot trigger loop warning');
    repeat(h, fn, rate, 1, id === 'set_grid_power' ? { power: 700 } : { connected: 'yes', charge_current: 10 });
    let out = h.m.snapshot(), row = out.inputs[0];
    assert.equal(row.received, rate * 5); assert.equal(row.identical, rate * 5 - 1);
    assert.equal(row.peakPerSecond, rate);
    assert.equal(row.status, rate > 1 ? 'possible_loop' : 'normal');
    assert.equal(row.secondsAboveThreshold, rate > 1 ? 5 : 0);
    if (rate > 1) {
      assert(row.firstWarningAt); assert.equal(row.possibleLoopEpisodes, 1);
      h.time.advance(h.time.now() + 2000); out = h.m.snapshot();
      assert.equal(out.activePossibleLoops, 0); assert.equal(out.possibleLoopInputs, 1);
      assert.equal(out.inputs[0].status, 'normal');
      assert(out.events.some(e => e.type === 'possible_loop_ended'));
      repeat(h, fn, rate, 5, { connected: 'yes', charge_current: 10 });
      assert.equal(h.m.snapshot().possibleLoopEpisodes, 2);
    }
    h.m.stop(); pass();
  }
  {
    const h = fixture(), p1 = h.register('set_grid_power'), pv = h.register('set_pv_power');
    h.m.start();
    for (let i = 0; i < 12; i++) {
      h.time.advance(100000 + i * 1000 + 100); p1({ power:i }); pv({ power:i * 2 });
    }
    const out = h.m.stop();
    assert.equal(out.totalReceived,24); assert.equal(out.inputs.length,2);
    assert(out.inputs.every(r => r.identical === 0 && r.changed === 11 && r.status === 'normal'));
    assert.equal(out.requests.context,0); pass();
  }
  {
    const h = fixture(), fn = h.register('set_ev_status_for_configured'); h.m.start();
    repeat(h, () => { fn({ ev:{id:'1',kind:'ev',name:'private EV'},connected:'yes',charge_current:10 });
      fn({ ev:{id:'2',kind:'ev'},connected:'yes',charge_current:11 }); }, 1, 10);
    const out = h.m.stop(); assert.equal(out.totalReceived,20); assert.equal(out.inputs.length,2);
    assert(out.inputs.every(r => r.status === 'normal' && r.identical === 9));
    assert(!JSON.stringify(out).includes('private EV')); pass();
  }
  {
    const h = fixture(); h.m.start();
    for (const card of manifest.flow.actions) h.register(card.id)({});
    assert.equal(h.m.snapshot().totalReceived,manifest.flow.actions.length);
    assert.equal(h.m.snapshot().inputs.length,manifest.flow.actions.length); h.m.stop(); pass();
  }
  {
    const h = fixture(); let called = 0;
    const error = new Error('original handler');
    const sync = h.register('set_grid_power', args => { called++; assert.equal(args.power,5); h.m.noteRequest('fast'); return 42; });
    const asyncInput = h.register('set_pv_power', async () => {
      h.m.noteRequest('context'); await Promise.resolve(); h.m.noteRequest('context'); return 'ok';
    });
    const fail = h.register('set_ev1_soc', () => { throw error; });
    h.m.start(); assert.equal(sync({power:5}),42); assert.equal(called,1);
    assert.equal(await asyncInput({power:9}),'ok'); assert.throws(() => fail({soc:5}),e => e === error);
    let out = h.m.stop();
    assert.equal(out.requests.context,2);
    assert.equal(out.inputs.find(r=>r.cardId==='set_pv_power').requests.context,1,'async continuation is not falsely attributed');
    assert.equal(out.inputs.find(r=>r.cardId==='set_grid_power').requests.fast,1);
    // Observer failure must never suppress or alter the original handler.
    h.m.start(); h.m.receive=()=>{throw new Error('observer failure');};
    assert.equal(sync({power:5}),42); assert.equal(called,2);
    assert.equal(h.m.snapshot().limits.observerErrors,1); h.m.stop(); pass();
  }
  {
    const h = fixture(), fn=h.register('read_external_prices_json_named'); h.m.start();
    const args={source:{id:'external',name:'secret source name'},period:'this_day',curve:'{"token":"secretAPIkey"}'};
    fn(args); fn({...args,source:{...args.source}});
    assert.equal(h.m.snapshot().inputs[0].identical,1);
    fn({...args,curve:'s'.repeat(20000)}); fn({...args,curve:'t'.repeat(20000)});
    let out=h.m.stop(), text=JSON.stringify(out);
    assert(!text.includes('secretAPIkey')); assert(!text.includes('secret source name'));
    assert(!text.includes('ssssss')); assert.equal(out.inputs[0].uncomparable,2);
    assert.equal(h.m.session.rows.values().next().value.previous,null,'comparison text is released');
    out=JSON.parse(text); assert(out.homeFluxVersion); assert(out.cpu.scope==='whole_app_process');
    for(const k of ['startedAt','endedAt','durationMs']) assert.notEqual(out.session[k],undefined);
    for(const k of ['received','identical','averagePerSecond','peakPerSecond','secondsAboveThreshold','requests']) assert.notEqual(out.inputs[0][k],undefined);
    pass();
  }
  {
    const h=fixture(),fn=h.register('set_pv_power'); h.m.start();
    for(let i=0;i<300;i++) { repeat(h,fn,2,1,{power:1}); h.time.advance(h.time.now()+1000); }
    const out=h.m.stop(); assert(out.limits.eventsDropped>0); assert.equal(out.events.length,256);
    assert.equal(out.inputs[0].received,600); assert.equal(out.inputs[0].secondsAboveThreshold,300); pass();
    const defs=Array.from({length:300},(_,i)=>({id:`input_${i}`})); const time=clock();
    const m=new InputMonitor({definitions:defs,now:time.now,setTimeout:time.schedule,clearTimeout:time.cancel});m.start();
    for(const d of m.definitions.values())m.receive(d,{});
    assert.equal(m.snapshot().totalReceived,300);assert.equal(m.snapshot().inputs.length,256);
    assert.equal(m.snapshot().limits.droppedRows,44);m.destroy();pass();
  }
  {
    const h=fixture();h.m.start();const stale=[...h.time.timers].map(t=>t.fn);h.m.clear();
    h.time.advance(h.time.now()+10000);h.m.start();for(const fn of stale)fn();
    assert(h.m.active);assert.equal(h.time.timers.size,2);h.m.destroy();pass();
  }
  {
    const api=require('../api');
    for(const [name,method] of [['getInputMonitor','getInputMonitorReport'],['startInputMonitor','startInputMonitor'],['stopInputMonitor','stopInputMonitor'],['clearInputMonitor','clearInputMonitor']]) {
      const out={name};assert.equal(await api[name]({homey:{app:{[method]:()=>out}}}),out);
      assert(manifest.api[name]);
    }
    const html=fs.readFileSync(path.join(__dirname,'../settings/index.html'),'utf8');
    assert(html.includes('inputMonitorUi.setVisible'));assert(html.includes('input-monitor.js'));
    assert(!html.includes('inputMonitorUi.stop'));pass();
  }
  {
    const h=fixture();let calls=0;const fn=h.register('set_grid_power',()=>++calls);
    h.m.cpuUsage=()=>{throw new Error('unavailable');};h.m.memoryUsage=h.m.cpuUsage;
    h.m.start();const end=h.m.session.expiresAt;
    // Even if the event loop has not dispatched the expiry timer yet, an input
    // at/after the deadline cannot extend the recording or lose its handler.
    h.m.now=()=>end+100;assert.equal(fn({power:5}),1);
    const out=h.m.snapshot();assert(!out.active);assert.equal(out.totalReceived,0);
    assert.equal(out.session.endedAt,end);assert.equal(out.cpu.cpuMs,null);
    assert.equal(out.memory.start,null);assert.equal(h.time.timers.size,0);pass();
  }
  {
    const {boot}=require('./startup-harness');const first=await boot();
    first.app.startInputMonitor();assert(first.app.inputMonitor.active);
    await first.app.onUninit();assert.equal(first.app.inputMonitor.session,null);
    assert.equal(first.app.inputMonitor.tickTimer,null);assert.equal(first.app.inputMonitor.expiryTimer,null);
    const restarted=await boot(first.store);assert.equal(restarted.app.getInputMonitorReport().session,null);
    assert(!restarted.app.inputMonitor.active);assert.deepEqual(first.errors,[]);assert.deepEqual(restarted.errors,[]);pass();
  }
  console.log(`1.1.14 Input Monitor: ${cases} scenarios passed.`);
}
main().catch(err=>{console.error(err);process.exitCode=1;});
