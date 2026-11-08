'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{page}=require('./helpers/settings-page-1.2.37.cjs');
(async()=>{let checks=0;
 for(const lang of ['nl','en','fr','de','es']){
  const h=await page(lang,{snapshot:{hybridEmsEnabled:false}}),q=id=>h.doc.getElementById(id);
  const panel=q('panel-hybrid-ems'),labels=JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json')).exact;
  assert(panel.contains(q('batteryFlowKeepaliveEnabled')));assert(panel.contains(q('externalEmsFlowKeepaliveEnabled')));
  assert(q('flowOutputKeepaliveSection').textContent.includes(labels['Flow-output keepalive']));
  for(const prefix of ['batteryFlowKeepalive','externalEmsFlowKeepalive']){
   assert.equal(q(prefix+'Enabled').checked,false);assert.equal(q(prefix+'Minutes').value,'5');assert.equal(q(prefix+'Minutes').min,'1');assert.equal(q(prefix+'Minutes').max,'60');
   assert(q(prefix+'MinutesGroup').classList.contains('hidden'));assert(q(prefix+'Minutes').disabled);q(prefix+'Enabled').click();assert(q(prefix+'Enabled').checked);assert(!q(prefix+'MinutesGroup').classList.contains('hidden'));assert(!q(prefix+'Minutes').disabled);checks++;
  }
  assert.equal(q('hybridEmsEnabled').checked,false,'battery keepalive can be configured without Hybrid ownership');q('batteryFlowKeepaliveMinutes').value='6';q('externalEmsFlowKeepaliveMinutes').value='9';q('save').click();for(let n=0;n<20;n++)await Promise.resolve();assert.deepEqual(h.alerts,[]);
  assert.deepEqual(h.writes.map(x=>x.key).sort(),['batteryFlowKeepaliveEnabled','batteryFlowKeepaliveMinutes','externalEmsFlowKeepaliveEnabled','externalEmsFlowKeepaliveMinutes'].sort());
  const r=await page(lang,{snapshot:h.snapshot}),get=id=>r.doc.getElementById(id);assert(get('batteryFlowKeepaliveEnabled').checked);assert(get('externalEmsFlowKeepaliveEnabled').checked);assert.equal(get('batteryFlowKeepaliveMinutes').value,'6');assert.equal(get('externalEmsFlowKeepaliveMinutes').value,'9');
  get('externalEmsFlowKeepaliveEnabled').click();assert(get('externalEmsFlowKeepaliveMinutesGroup').classList.contains('hidden'));assert(get('externalEmsFlowKeepaliveMinutes').disabled);assert(!get('batteryFlowKeepaliveMinutes').disabled);checks++;
  for(const button of r.doc.querySelectorAll('#flowOutputKeepaliveSection .hf-help-toggle'))assert(!button.closest('label'));
  h.close();r.close();
 }
 console.log(`Flow keepalive UI: ${checks} language/conditional checks, real save/reopen and checkbox-safe info controls passed.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
