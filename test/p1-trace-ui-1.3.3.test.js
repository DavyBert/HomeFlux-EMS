'use strict';
const assert = require('node:assert/strict');
const { P1TraceMonitor } = require('../lib/p1-trace-monitor');
const { create } = require('../settings/p1-trace-monitor');
class Node {
  constructor() { this.children=[]; this.listeners={}; this.textContent=''; this.value=''; this.disabled=false; this.hidden=false; }
  appendChild(x) { this.children.push(x); x.parent=this; return x; }
  replaceChildren(...xs) { this.children=xs; }
  addEventListener(name,fn) { this.listeners[name]=fn; }
  click() { return this.listeners.click?.(); }
  remove() { if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this); }
}
(async()=>{
  let now=100000;
  const timers=new Set();
  const schedule=(fn,ms)=>{const x={fn,at:now+ms};timers.add(x);return x;};
  const cancel=x=>timers.delete(x);
  const monitor=new P1TraceMonitor({now:()=>now,schedule,cancel,clock:()=>BigInt(now)*1000000n,version:'1.3.3'});
  const nodes=new Map();
  const doc={body:new Node(),createElement:()=>new Node(),getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);}};
  const q=doc.getElementById;
  let requests=0;
  const api=async(method,path)=>{
    requests++;
    if(path.endsWith('/start')) return monitor.start();
    if(path.endsWith('/stop')) return monitor.stop();
    if(path.endsWith('/clear')) return monitor.clear();
    return monitor.snapshot();
  };
  const created=[];
  const ui=create({document:doc,api,getLanguage:()=> 'nl',schedule,cancel,now:()=>now,
    url:{createObjectURL:()=>{created.push('created');return 'blob:test';},revokeObjectURL:()=>{}},BlobClass:class {}});
  const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
  assert.equal(requests,0,'idle page no polling');
  ui.setVisible(true);await flush();assert.equal(requests,1);
  await q('p1TraceStart').click();await flush();
  assert(monitor.active);
  const cycle=monitor.begin('set_grid_power',500);
  monitor.measure(cycle,'get_input_settings',()=>monitor.noteSettingsRead());
  monitor.outcome('fast_requested');
  monitor.finish(cycle);
  // A refresh is requested only when the P1 tab remains visible.
  ui.setVisible(false);
  const after=requests;
  assert.equal(timers.size,1,'only server-side expiry timer remains');
  now += 1001;
  ui.setVisible(true);await flush();
  assert.equal(q('p1TraceTotal').textContent,'1');
  assert.equal(q('p1TraceStageRows').children.length,1);
  assert.equal(q('p1TraceCycleRows').children.length,1);
  await q('p1TraceStop').click();await flush();
  assert(!monitor.active);
  await q('p1TraceExportButton').click();await flush();
  assert(created.length>=1);
  assert(q('p1TraceExport').value.includes('fast_requested'));
  ui.setVisible(false);
  assert(requests>after);
  ui.destroy();
  monitor.destroy();
  console.log('P1 trace UI: start, visible-only refresh, stages, cycles, JSON export and stop passed');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
