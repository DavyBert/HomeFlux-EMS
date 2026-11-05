'use strict';
const assert=require('node:assert/strict'),P=require('../lib/phase-guard'),E=require('../lib/ev-phase-guard');
const {DEFAULTS}=require('../lib/ems-engine');
let now=100000,checks=0;
function fixture(type='current',values=[5680,5680,5680],batteries=[-6000],evs=1){
 const s={...DEFAULTS,batteryCount:batteries.length,maxTotalChargeW:10000,maxChargePerBatteryW:10000,maxSoc:100,
  evCount:evs,phaseGuard:{...P.defaults,phases:3,enabled:true,voltage:230,amps:25,limitW:4500,priority:'shared',batteries:Array(8).fill('balanced3')}};
 for(let i=0;i<evs;i++){const stem=i?'ev'+(i+1):'ev';Object.assign(s,{[stem+'Enabled']:true,[stem+'ControlType']:type,[stem+'Phases']:3,[stem+'Voltage']:230,[stem+'VoltageReference']:'phase',[stem+'MinCurrentA']:6});}
 const input=Array.from({length:evs},()=>({chargeCurrentA:16,updatedAt:{chargeCurrent:now},seen:{chargeCurrent:true,connected:true},connected:true}));
 const extra=Array.from({length:evs-1},()=>({lastPublishedCurrentA:16,lastPublishedAllowed:true,lastPublishedChargeMode:'standard'}));
 const a={state:{batterySoc:batteries.map(()=>50)},lastEmittedCommands:batteries,phaseGuardRuntime:{lastIncreaseAt:0},lastPublishedEvCurrentA:16,lastPublishedEvAllowed:true,lastPublishedEvChargeMode:'standard',
  getSettings:()=>s,getEvCount:s=>s.evCount,getEvSettingKey:(i,k)=>(i?'ev'+(i+1):'ev')+k,getEvInputSnapshot:i=>input[i],
  getExtraEv:i=>extra[i-1],getEvControlTypeFor:(i,source=s)=>source[(i?'ev'+(i+1):'ev')+'ControlType'],
  getEvElectricalSettingsFor:(i,source=s)=>Object.fromEntries(['Phases','Voltage','VoltageReference'].map(k=>['ev'+k,source[(i?'ev'+(i+1):'ev')+k]])),
  getEvMeasuredCurrent:(i,v,t)=>({fresh:t-v.updatedAt.chargeCurrent<=60000&&v.connected,currentA:v.chargeCurrentA,updatedAt:v.updatedAt.chargeCurrent})};
 P.ingest(a,Object.fromEntries(values.map((w,i)=>['l'+(i+1),w])),now);
 return {a,s,input,extra};
}
const decision=(amps=16)=>({allowed:true,connected:true,mode:'emergency',source:'tariff',desiredCurrentA:amps,desiredPowerW:amps*690,pvAllocatedW:0,gridAllocatedW:amps*690});
function check(name,fn){fn();checks++;}
check('Priority defaults to battery first and all three preferences preserve the phase boundary',()=>{
 assert.equal(P.defaults.priority,'battery_first');
 for(const [priority,expected] of [['battery_first',10],['shared',13],['ev_first',16]]){
  const {a,s}=fixture();s.phaseGuard.priority=priority;const d=E.cap(a,0,decision(),s,now);assert.equal(d.desiredCurrentA,expected);
  const input={candidateCommands:[-6000],candidateTotalCommandW:-6000};P.apply(a,input,s,now);
  const phaseBattery=Math.abs(input.candidateTotalCommandW)/3,phaseEv=expected*230;
  assert(phaseBattery+phaseEv<=4500,'combined planning may not exceed phase limit');
 }
});
check('Disabled and single-phase monitoring perform no EV phase work',()=>{
 for(const guard of [{enabled:false,phases:3},{enabled:true,phases:1}]){
  const s={phaseGuard:guard},a=new Proxy({},{get(){throw new Error('disabled phase arithmetic entered');}}),d=decision();
  assert.equal(E.reference(a,s,now),null);assert.equal(E.cap(a,0,d,s,now),d);assert.equal(E.adjustments(a,s,now),null);assert(!E.urgent(a,s,now));
 }
});
for(const type of ['current','hybrid'])check(type+': equal relief and delayed feedback avoid duplicate reductions',()=>{
 const {a,s,input}=fixture(type),r=E.reference(a,s,now),d=E.cap(a,0,decision(),s,now);
 assert.equal(d.desiredCurrentA,13);assert(d.phaseLimited);assert.equal(r.ev[0].cap,13);
 const candidate={candidateCommands:[-6000],candidateTotalCommandW:-6000};P.apply(a,candidate,s,now);
 assert.equal(candidate.candidateTotalCommandW,-4530,'EV 690 W and battery 490 W phase relief meet 1180 W overload');
 // A successful command alone still gives no physical credit at publication.
 E.begin(a,0,s,13,now);E.complete(a,0,s,13,true,now);
 a.lastPublishedEvCurrentA=13;
 assert.deepEqual(P.limit(a,candidate.candidateCommands,s,now,false),[-2460],'battery temporarily covers still-unconfirmed EV relief');
 for(let i=1;i<=4;i++){
  const t=now+i*10000;P.ingest(a,{l1:4500,l2:4500,l3:4500},t);a.lastEmittedCommands=[-2460];
  const next=E.cap(a,0,decision(),s,t);assert.equal(next.desiredCurrentA,13,'allow the EV time instead of repeated decreases or premature increases');
 }
 // The next fresh physical sample confirms the reduction; ordinary battery
 // recovery can use measured headroom, never the mere previous Flow receipt.
 input[0].chargeCurrentA=13;input[0].updatedAt.chargeCurrent=now+41000;
 P.ingest(a,{l1:3810,l2:3810,l3:3810},now+41000);
 E.reference(a,s,now+41000);assert.equal(a.evPhaseFeedback[0],undefined);
 assert(P.limit(a,[-6000],s,now+41000,false)[0]<-2460);
});
check('Feedback after a command releases only confirmed phase capacity',()=>{
 const {a,s,input}=fixture();const r=E.reference(a,s,now);E.begin(a,0,s,13,now);E.complete(a,0,s,13,true,now);
 assert.equal(E.adjustments(a,s,now).delta[0],0);
 input[0].chargeCurrentA=13;input[0].updatedAt.chargeCurrent=now+1000;
 assert.equal(E.adjustments(a,s,now+1000).delta[0],-690);
 const out=P.limit(a,[-6000],s,now+1000,false);assert.deepEqual(out,[-4530]);
 assert.equal(r.samples,a.gridPhases);
});
check('Failed and partial publications do not finance battery charging',()=>{
 const {a,s}=fixture();E.reference(a,s,now);E.begin(a,0,s,13,now);E.complete(a,0,s,13,false,now);
 assert.equal(E.adjustments(a,s,now).delta[0],0);assert.deepEqual(P.limit(a,[-6000],s,now,false),[-2460]);
});
check('No charging battery means EV takes the necessary phase reduction',()=>{
 const {a,s}=fixture('current',[5680,5600,5500],[0]);const d=E.cap(a,0,decision(),s,now);assert.equal(d.desiredCurrentA,10);
 const source={...s,evControlType:'mode'};assert.equal(E.cap(a,0,decision(),source,now).desiredCurrentA,16);
});
check('Missing or stale phases stop current/Hybrid without fictional headroom',()=>{
 for(const type of ['current','hybrid']){
  const {a,s}=fixture(type);a.gridPhases[1]={watts:null,at:0};assert.equal(E.cap(a,0,decision(),s,now).desiredCurrentA,0);
  P.ingest(a,{l1:0,l2:0,l3:0},now);assert.equal(E.cap(a,0,decision(),s,now+15001).desiredCurrentA,0);
 }
});
check('Unknown one-phase EV is constrained by the busiest phase without false credit',()=>{
 const {a,s}=fixture('current',[1000,2800,4000],[0]);s.evPhases=1;
 assert.equal(E.cap(a,0,decision(),s,now).desiredCurrentA,0,'400 W residual room is below 6 A');
 P.ingest(a,{l1:100,l2:100,l3:100},now);assert.equal(E.cap(a,0,decision(),s,now).desiredCurrentA,16);
});
check('Known voltage, negative export, multiple EVs and reserved increases',()=>{
 const {a,s,input}=fixture('current',[-500,-300,-100],[0],2);input.forEach(v=>{v.chargeCurrentA=0;});
 a.lastPublishedEvCurrentA=0;a.getExtraEv(1).lastPublishedCurrentA=0;
 const reserved=[0,0,0],one=E.cap(a,0,decision(16),s,now,reserved),two=E.cap(a,1,decision(16),s,now,reserved);
 assert.equal(one.desiredCurrentA,16);assert(two.desiredCurrentA<6||two.desiredCurrentA===0);
 const {a:b,s:t,input:bi}=fixture('current',[2000,2000,2000],[0]);bi[0].chargeCurrentA=0;b.lastPublishedEvCurrentA=0;t.evVoltage=120;
 assert.equal(E.cap(b,0,decision(32),t,now).desiredCurrentA,20);
});
check('In-flight increases are reserved; reductions do not create new-start room',()=>{
 const {a,s,input}=fixture('current',[2000,2000,2000],[0],2);input.forEach(v=>v.chargeCurrentA=0);a.lastPublishedEvCurrentA=0;a.getExtraEv(1).lastPublishedCurrentA=0;
 E.begin(a,0,s,10,now);assert.equal(E.cap(a,1,decision(),s,now).desiredCurrentA,0);
});
check('Stopped EV feedback cannot finance its own new start',()=>{
 const {a,s}=fixture('current',[4000,4000,4000],[0]);a.isEvOutputPermittedFor=()=>false;a.isEvOutputActiveFor=()=>false;
 assert.equal(E.cap(a,0,decision(),s,now).desiredCurrentA,0);
});
check('A further unavoidable overload can reduce EV before the feedback wait expires',()=>{
 const {a,s,input}=fixture();E.reference(a,s,now);E.complete(a,0,s,13,true,now);a.lastPublishedEvCurrentA=13;
 a.lastEmittedCommands=[0];P.ingest(a,{l1:6000,l2:6000,l3:6000},now+10000);input[0].updatedAt.chargeCurrent=now+10000;
 const d=E.cap(a,0,decision(),s,now+10000);assert(d.desiredCurrentA<13,'cannot wait when battery and pending EV relief cannot cover the overload');
});
check('Priority UI persists each selection and all supported languages cover it',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),html=fs.readFileSync('settings/index.html','utf8'),nodes={};
 const q=id=>nodes[id] ||= {value:'',checked:false};q('phaseGuard').value='{}';q('gridConnectionPhases').value='3';
 const context=vm.createContext({q,boolean:new Set(),numeric:new Set(),jsonArray:new Set()});
 const start=html.indexOf('  function currentSettingValue('),end=html.indexOf('  function captureSettingsBaseline(',start);vm.runInContext(html.slice(start,end),context);
 assert.equal(context.currentSettingValue('phaseGuard').priority,'battery_first');
 for(const priority of ['battery_first','shared','ev_first']){q('phaseChargePriority').value=priority;assert.equal(context.currentSettingValue('phaseGuard').priority,priority);assert(html.includes('value="'+priority+'"'));}
 for(const lang of ['nl','en','fr','es','de']){
  const bundle=JSON.parse(fs.readFileSync('settings/translations/'+lang+'.json','utf8'));
  for(const text of ['Batterij eerst laden','Verdelen','EV eerst laden','Bij fasebegrenzing voorrang geven aan','Fasebewaking begrenst EV-laadstroom','EV wacht op geldige fasegegevens'])assert(bundle.exact[text]?.trim(),lang+'/'+text);
 }
});
check('Runtime, Compose, package and lockfile metadata agree',()=>{
 const fs=require('node:fs'),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
 const manifest=read('app.json'),compose=read('.homeycompose/app.json'),pkg=read('package.json'),lock=read('package-lock.json');
 for(const d of [compose,pkg,lock,lock.packages['']])assert.equal(d.version,manifest.version);
 assert.equal(compose.homeyCommunityTopicId,158982);assert.equal(manifest.homeyCommunityTopicId,158982);
 assert.equal(compose.homepage,manifest.homepage);assert.equal(compose.support,manifest.support);
});
check('Live values use server time and retain separately received samples only for display',()=>{
 const {a,s}=fixture('current',[4400,5600,-200]);P.ingest(a,{l2:100},now+1000);
 const status=P.status(a,s,now+1000);assert.deepEqual(status.values.map(v=>v.watts),[null,100,null]);
 assert.deepEqual(status.displayValues.map(v=>v.watts),[4400,100,-200]);assert.equal(status.evaluatedAt,now+1000);
 const fs=require('node:fs'),vm=require('node:vm'),html=fs.readFileSync('settings/index.html','utf8'),start=html.indexOf('  function renderLivePhases('),end=html.indexOf('  function notifyChargeTestRequirement(',start),nodes={};
 const q=id=>nodes[id] ||= {value:'3',classList:{toggle(){}}};const ctx=vm.createContext({q,translateUiText:x=>x,Date:{now:()=>now+3600000}});vm.runInContext(html.slice(start,end),ctx);
 ctx.renderLivePhases(status);assert.equal(q('livePhase1Power').textContent,'4400 W');assert.equal(q('livePhase2Power').textContent,'100 W');
 ctx.renderLivePhases({...status,evaluatedAt:now+16000});assert.equal(q('livePhase1Power').textContent,'—');assert.equal(q('livePhase2Power').textContent,'100 W');
});
console.log(`EV phase arithmetic and live phases: ${checks} scenario groups passed.`);
