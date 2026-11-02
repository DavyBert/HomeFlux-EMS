'use strict';
const assert=require('node:assert/strict');
const {InputMonitor}=require('../lib/input-monitor');
const {create}=require('../settings/input-monitor');
const manifest=require('../app.json');

class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.textContent='';this.value='';this.disabled=false;this.hidden=false;this.renders=0;}
  appendChild(child){this.children.push(child);child.parent=this;return child;}
  replaceChildren(...children){this.children=children;this.renders++;}
  addEventListener(type,fn){this.listeners[type]=fn;}
  click(){return this.listeners.click?.();}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
}
async function main(){
 let now=100000;const timers=new Set(),requests=[],blobs=[],revoked=[];
 const schedule=(fn,ms)=>{const timer={fn,due:now+ms};timers.add(timer);return timer;};
 const cancel=t=>timers.delete(t);
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 async function advance(at){for(;;){const next=[...timers].filter(t=>t.due<=at).sort((a,b)=>a.due-b.due)[0];if(!next)break;now=next.due;timers.delete(next);next.fn();await flush();}now=at;await flush();}
 const m=new InputMonitor({definitions:manifest.flow.actions,version:manifest.version,now:()=>now,setTimeout:schedule,clearTimeout:cancel});
 const nodes=new Map();const doc={body:new Element('body'),createElement:tag=>new Element(tag),getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}};
 const q=doc.getElementById;
 let language='nl',fail=false;
 const api=async(method,url)=>{
  requests.push({at:now,method,url});if(fail)throw new Error('API unavailable');
  return url.endsWith('/start')?m.start():url.endsWith('/stop')?m.stop():url.endsWith('/clear')?m.clear():m.snapshot();
 };
 const ui=create({document:doc,api,getLanguage:()=>language,schedule,cancel,now:()=>now,
  url:{createObjectURL:blob=>{blobs.push(blob);return 'blob:test';},revokeObjectURL:url=>revoked.push(url)}});
 ui.setVisible(true);await flush();assert.equal(requests.length,1);assert.equal(timers.size,0,'no polling when inactive');
 await q('startInputMonitoring').click();await flush();assert(m.active);assert(q('startInputMonitoring').disabled);
 const ev=m.definitions.get('set_ev1_status'),p1=m.definitions.get('set_grid_power');
 for(let second=0;second<6;second++){
  await advance(100000+second*1000+200);m.receive(ev,{connected:'yes',charge_current:10});m.receive(p1,{power:second});
  await advance(100000+second*1000+700);m.receive(ev,{connected:'yes',charge_current:10});
 }
 await advance(106000);
 const rows=q('inputMonitorRows').children;assert.equal(rows[0].className,'input-monitor-possible_loop');
 assert(rows[0].children[7].textContent.includes('Mogelijke loop'));
 assert.equal(rows[1].className,'input-monitor-normal');assert.equal(q('inputMonitorTotal').textContent,'18');
 const gets=requests.filter(r=>r.method==='GET');for(let i=1;i<gets.length;i++)assert(gets[i].at-gets[i-1].at>=1000);
 const renders=q('inputMonitorRows').renders;await advance(108000);
 assert.equal(q('inputMonitorRows').children[0].className,'input-monitor-normal');
 assert.equal(q('inputMonitorLoops').textContent,'1');assert.equal(q('inputMonitorActiveLoops').textContent,'0');
 assert(q('inputMonitorRows').renders-renders<=2,'one live table update per second');
 const expiry=m.session.expiresAt;
 ui.setVisible(false);const before=requests.length;await advance(expiry);
 assert.equal(requests.length,before,'closed page sends no polling requests');assert(!m.active);assert.equal(timers.size,0);
 ui.setVisible(true);await flush();assert(q('inputMonitorState').textContent.includes('15 minuten'));
 const frozen=requests.length;await advance(now+5000);assert.equal(requests.length,frozen,'stopped recording does not poll');
 await q('exportInputMonitoring').click();await flush();
 assert.equal(blobs.length,1);const out=JSON.parse(await blobs[0].text());
 assert.equal(out.session.durationMs,900000);assert.equal(out.inputs.length,2);assert(!q('inputMonitorExport').hidden);
 assert.equal(JSON.parse(q('inputMonitorExport').value).totalReceived,18);
 await q('clearInputMonitoring').click();assert.equal(m.session,null);assert(q('inputMonitorExport').hidden);
 language='en';await advance(now+1000);ui.setVisible(true);await flush();assert.equal(q('inputMonitorState').textContent,'Ready to start');
 await q('startInputMonitoring').click();await advance(now+1200);await q('stopInputMonitoring').click();assert(!m.active);
 await advance(now+1000);fail=true;ui.setVisible(true);await flush();assert.equal(q('inputMonitorState').textContent,'API unavailable');
 ui.destroy();m.destroy();assert.equal(timers.size,0);assert.deepEqual(revoked,['blob:test']);
 console.log('1.1.14 Input Monitor UI: polling, visibility, sorting, warning recovery, manual/auto stop, JSON download, errors and cleanup passed.');
}
main().catch(err=>{console.error(err);process.exitCode=1;});
