'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const {page}=require('./helpers/settings-page-1.2.37.cjs');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'widgets/status/public/index.html'),'utf8');
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n');
(async()=>{let checks=0;
 for(const language of ['nl','en','fr','de','es']){
  const h=await page(language),q=id=>h.doc.getElementById(id),translations=JSON.parse(fs.readFileSync(path.join(root,'settings/translations',language+'.json'))).exact;
  assert(q('panel-ems').contains(q('wafPresentationSection')));assert.equal(q('wafBatterySavingEnabled').checked,true);assert.equal(q('wafMinCheapMinutes').value,'90');assert.equal(q('wafMinCheapMinutes').min,'0');assert.equal(q('wafMinCheapMinutes').max,'1440');
  const section=q('wafPresentationSection');assert(section.textContent.includes(translations['Groene WAF bij batterijsparen in het goedkoopste tarief']));
  const buttons=[...section.querySelectorAll('.hf-help-toggle')];assert(buttons.length>0);for(const button of buttons){assert(!button.closest('label'));const writes=h.writes.length;button.click();assert.equal(h.writes.length,writes);assert(q('wafBatterySavingEnabled').checked);button.click();}
  q('wafMinCheapMinutes').value='135';q('wafBatterySavingEnabled').click();assert(q('wafMinCheapMinutesGroup').classList.contains('hidden'));assert(q('wafMinCheapMinutes').disabled);
  q('save').click();for(let i=0;i<30;i++)await Promise.resolve();assert.deepEqual(h.alerts,[]);
  assert.deepEqual(h.writes.map(write=>write.key).sort(),['wafBatterySavingEnabled','wafMinCheapMinutes'].sort());
  const reopened=await page(language,{snapshot:h.snapshot});assert.equal(reopened.doc.getElementById('wafBatterySavingEnabled').checked,false);assert.equal(reopened.doc.getElementById('wafMinCheapMinutes').value,'135');assert(reopened.doc.getElementById('wafMinCheapMinutes').disabled);
  reopened.doc.getElementById('wafBatterySavingEnabled').click();assert(!reopened.doc.getElementById('wafMinCheapMinutes').disabled);checks+=6;h.close();reopened.close();
  const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;w.eval(script);
  const locale=JSON.parse(fs.readFileSync(path.join(root,'locales',language+'.json')));w.HomeyMock={__:key=>key.split('.').reduce((value,part)=>value?.[part],locale)||key};
  const now=Date.now(),budget={ready:true,valueKwh:-4,calculatedAt:now-1000,validUntil:now+3600000,targetAt:now+3600000,targetSoc:80};
  w.statusMock={inputReady:true,controlEnabled:true,baseMode:'charge',action:'idle',energyBudget:budget,wafPresentation:{active:true,gridRoomW:2100},settings:{}};
  w.nowMock=now;
  w.eval("renderStatus(statusMock, {}, HomeyMock); updateDecisionDisplay(statusMock, {}, HomeyMock, nowMock)");
  const circle=w.document.getElementById('energy-budget');assert(circle);assert.equal(circle.querySelector('small').textContent,locale.widget.status.wafGridRoom);assert(circle.textContent.includes('kW'));assert(circle.title.includes(locale.widget.status.decisionSaveBattery));assert.equal(circle.getAttribute('aria-label'),circle.title);assert.equal(circle.style.background,'rgb(3, 130, 3)');
  assert.equal(JSON.stringify(w.statusMock.energyBudget),JSON.stringify(budget));
  for(const room of [0,100,900,1000,2200,null]){w.statusMock.wafPresentation.gridRoomW=room;w.eval('updateDecisionDisplay(statusMock, {}, HomeyMock, nowMock)');assert(circle.textContent.includes(room===null?'—':room>=1000?'kW':'W'));checks++;}
  w.statusMock.wafPresentation.active=false;w.eval('updateDecisionDisplay(statusMock, {}, HomeyMock, nowMock)');assert.equal(circle.querySelector('small').textContent,'kWh');assert(circle.textContent.includes('-4'));assert.notEqual(circle.style.background,'rgb(3, 130, 3)');
  w.statusMock.wafPresentation.active=true;w.statusMock.criticalAlert={id:'input'};w.eval('updateDecisionDisplay(statusMock, {}, HomeyMock, nowMock)');assert.equal(circle.querySelector('small').textContent,'kWh');
  w.statusMock.criticalAlert=null;w.eval('updateDecisionDisplay(statusMock, {statusColors:false}, HomeyMock, nowMock)');assert.equal(circle.style.background,'');checks+=8;dom.window.close();
 }
 console.log(`WAF UI: ${checks} checks passed in five languages; real settings save/reopen, checkbox-safe help, neutral/zero/W/kW display, critical alerts and restoration to original kWh.`);
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
