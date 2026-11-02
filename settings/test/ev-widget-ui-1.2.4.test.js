'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../widgets/ev/public/index.html'),'utf8');
const script=source.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const controller=require('../widgets/ev/public/controller');
const drain=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
const reports=[];
async function session({status=false,scheduler=true,insights=true,switching=false,count=2,language='en',instanceId=null,storage=new Map()}={}){
 let clock=10000,timeout=0;const timers=new Map(),listeners={},documentListeners={},windowListeners={},calls=[];
 const host={innerHTML:'',textContent:'',scrollHeight:600,addEventListener:(k,v)=>listeners[k]=v};
 const dictionary=require('../locales/'+language+'.json');
 let data={currency:'€',evs:Array.from({length:count},(_,i)=>({id:String(i+1),name:i?'City EV':'Family EV',connected:true,soc:62,state:'scheduled',
  plan:{type:'soc',value:80,time:'07:00',guaranteed:false},schedule:{mode:'smart',source:'flow',target:{type:'soc',value:80},time:'07:00',guaranteed:false},presets:{mode:'soc',soc:[60,80,100],kwh:[5,10,20],times:['07:00','12:00','17:00']},
  insights:{kwh:12,pvKwh:8.4,gridKwh:3.6,batteryKwh:0,unknownKwh:0,gridCost:1.08,solarValue:.252,solarSavings:2.268,solarKm:46.66667},incomplete:false})),sharedKwh:0};
 const H={getWidgetInstanceId:()=>instanceId,getSettings:()=>({...status===null?{}:{showStatus:status},showScheduler:scheduler,showInsights:insights,switchSections:switching}),ready(){},setHeight(){},on:(k,cb)=>{listeners[k]=cb;},
  __:key=>key.split('.').reduce((v,k)=>v?.[k],dictionary)||key,
  api:async(method,url,body)=>{calls.push({method,url,body});if(method==='GET')return structuredClone(data);return {accepted:true,plan:{...data.evs.find(e=>e.id===body.evId).plan,time:body.change.time||'07:00'}};}};
 const RealDate=Date;class FakeDate extends RealDate{static now(){return clock;}}
 const ctx=vm.createContext({localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},Date:FakeDate,Math,JSON,console,HomeFluxEvController:controller,
  document:{hidden:false,getElementById:()=>host,addEventListener:(k,v)=>documentListeners[k]=v},
  window:{addEventListener:(k,v)=>windowListeners[k]=v},
  setTimeout:(fn,ms)=>{const id=++timeout;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(script,ctx);ctx.HMock=H;vm.runInContext('onHomeyReady(HMock)',ctx);await drain();
 const button=dataset=>({dataset,closest(){return this;}});
 async function click(dataset,{drag=false}={}){
  const b=button(dataset),e={target:b,pointerId:1,clientX:0,clientY:0,detail:1};
  listeners.pointerdown(e);if(drag)listeners.pointermove({...e,clientX:30});listeners.click(e);await drain();
 }
 return {ctx,host,calls,timers,listeners,documentListeners,windowListeners,click,H,
  data:()=>data,setData:v=>{data=v;},tick:ms=>{clock+=ms;for(const[id,t]of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}},drain};
}
(async()=>{
 for(const language of ['en','nl'])for(const [scheduler,insights]of [[true,true],[true,false],[false,true],[false,false]]){
  const h=await session({language,scheduler,insights});
  assert.equal(h.host.innerHTML.includes('data-key="goal0"'),scheduler);
  assert.equal(h.host.innerHTML.includes('class="km"'),insights);
  assert(h.host.innerHTML.includes('data-ev="2"'),'EV selector exists in every display mode');
  assert(!h.host.innerHTML.includes('evWidget.'),'all user-facing translations resolved');
  assert.equal(h.timers.size,0,'no polling or local interval');
  reports.push(language+': independent visibility '+scheduler+'/'+insights);
 }
 for(const language of ['en','nl']){
  const h=await session({language,scheduler:false,insights:true,count:1});
  const html=h.host.innerHTML;
  assert(/class="ev-status-row">[\s\S]*?<h1[^>]*>Family EV<\/h1>[\s\S]*?class="ev-charge-state">[\s\S]*?class="pill">/.test(html));
  assert(html.includes('class="ev-active-plan"'));assert(html.includes('80%'));
  assert(html.includes(language==='nl'?'tegen 07:00':'by 07:00'));
  const data=h.data();data.evs[0].schedule={mode:'emergency',source:'emergency',target:null};
  h.setData(data);h.listeners['homeflux.ev.changed']();await h.drain();
  const planLine=h.host.innerHTML.match(/class="ev-active-plan">([\s\S]*?)<\/div>/)[1];
  assert(planLine.includes(language==='nl'?'Emergency charge tot 100%':'Emergency charge to 100%'));
  assert(!planLine.includes('80%'));assert(!planLine.includes('07:00'));assert(!h.host.innerHTML.includes('evWidget.'));
  assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
  data.evs[0].schedule={mode:'smart',source:'flow',target:{type:'kwh',value:20},time:'17:00',guaranteed:true};
  h.listeners['homeflux.ev.changed']();await h.drain();
  assert(h.host.innerHTML.includes('20 kWh'));assert(h.host.innerHTML.includes(language==='nl'?'gegarandeerd':'guaranteed'));
  assert.equal(h.timers.size,0);
  reports.push(language+': one-line EV/state/connection header and active schedule in Insights; Emergency hides saved goal; no POST or timer');
 }
 const one=await session({count:1});assert(!one.host.innerHTML.includes('data-ev='));reports.push('Single EV automatically selected, selector hidden');
 const none=await session({count:0});assert(none.host.innerHTML.includes('No EV configured'));reports.push('No EV empty state');
 const h=await session(), target={key:'goal0',change:JSON.stringify({target:{type:'soc',value:60}})};
 await h.click(target);assert.equal(h.calls.filter(c=>c.method==='POST').length,0);assert(h.host.innerHTML.includes('Confirm'));
 await h.click(target,{drag:true});assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
 reports.push('Touch first tap and dragged/swiped second tap do not submit');
 await h.click(target);h.tick(5000);await h.click(target);assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
 await h.click(target);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
 reports.push('Exact five-second expiry, second deliberate confirmation and acknowledged success');
 await h.click(target);await h.click({ev:'2'});assert(!h.host.innerHTML.includes('Tap the same'));reports.push('EV selection cancels pending confirmation');
 let resolves=[];const realApi=h.H.api;
 h.H.api=(method,url,body)=>method==='GET'?new Promise(r=>resolves.push(r)):realApi(method,url,body);
 h.listeners['homeflux.ev.changed']();await h.click({period:'week'});
 // Do not await an unresolved activate() promise: browser click callback is fire-and-forget.
 const data=h.data();resolves[1](structuredClone(data));await h.drain();resolves[0]({...structuredClone(data),evs:[{...data.evs[0],name:'STALE EV'}]});await h.drain();
 assert(!h.host.innerHTML.includes('STALE EV'));assert(h.host.innerHTML.includes('City EV'));reports.push('Delayed old refresh cannot overwrite newly selected EV/period');
 h.H.api=realApi;await h.click(target);h.windowListeners.pagehide();assert.equal(h.timers.size,0);
 const before=h.calls.length;h.listeners['homeflux.ev.changed']();await h.drain();assert.equal(h.calls.length,before);
 h.windowListeners.pageshow();await h.drain();assert(h.calls.length>before);reports.push('Hide/unload cancellation, dormant subscription and single resume fetch');
 const storage=new Map(),first=await session({instanceId:'dashboard_A',storage});
 await first.click({ev:'2'});const reopened=await session({instanceId:'dashboard_A',storage});
 assert(reopened.host.innerHTML.includes('data-ev="2" class="active"'));
 const other=await session({instanceId:'dashboard_B',storage});
 assert(other.host.innerHTML.includes('data-ev="1" class="active"'));
 reports.push('EV selection survives reload per widget instance, without affecting another Dashboard');
 const draft=await session({count:1});const draftData=draft.data();draftData.evs[0].plan=null;draft.setData(draftData);
 draft.listeners['homeflux.ev.changed']();await draft.drain();
 const targetDraft={key:'goal0',change:JSON.stringify({target:{type:'soc',value:60}})};
 await draft.click(targetDraft);await draft.click(targetDraft);
 assert(draft.host.innerHTML.includes('Draft'));assert(draft.host.innerHTML.includes('60%'));
 assert.equal(draft.calls.filter(c=>c.method==='POST').length,0);
 reports.push('Incomplete selected target is visibly a local Draft, never a submitted or fictitious plan');
 // Exercise the actual widget script and existing controller; changing views is local.
 for(const language of ['en','nl']){
  const status=await session({status:true,switching:true,language});
  let html=status.host.innerHTML;
  assert(html.indexOf('data-section="status"')<html.indexOf('data-section="scheduler"'));
  assert(html.indexOf('data-section="scheduler"')<html.indexOf('data-section="insights"'));
  assert(html.includes('data-section="status" class="active"'));
  assert(html.includes('status-summary'));assert(html.includes('80%'));assert(html.includes('07:00'));
  assert(!html.includes('data-key='));assert(!html.includes('class="km"'));assert(!html.includes('evWidget.'));
  const before=status.calls.length;
  // Even a stale click object from a removed Planning button cannot edit a plan.
  await status.click(target);await status.click(target);assert.equal(status.calls.length,before);
  await status.click({section:'scheduler'});assert(status.host.innerHTML.includes('data-key="goal0"'));
  await status.click(target);assert.equal(status.timers.size,1);
  await status.click({section:'status'});assert.equal(status.timers.size,0);assert(!status.host.innerHTML.includes('data-key='));
  await status.click(target);await status.click(target);assert.equal(status.calls.length,before);
  await status.click({section:'insights'});assert(status.host.innerHTML.includes('class="km"'));
  await status.click({section:'status'});assert.equal(status.calls.length,before);
  await status.click({ev:'2'});assert(status.host.innerHTML.includes('City EV'));assert(status.host.innerHTML.includes('status-summary'));
  assert.equal(status.calls.filter(c=>c.method==='POST').length,0);assert.equal(status.timers.size,0);
  reports.push(language+': Status is first/default, central goal/deadline only; tabs are local, stale Planning clicks blocked and EV selection preserved');
 }
 for(const language of ['en','nl'])for(const switching of [false,true]){
  const compact=await session({status:true,scheduler:false,insights:false,switching,language,count:1});
  assert(compact.host.innerHTML.includes('status-summary'));assert(!compact.host.innerHTML.includes('data-section='));
  assert(!compact.host.innerHTML.includes('data-key='));assert(!compact.host.innerHTML.includes('class="km"'));
  assert(!compact.host.innerHTML.includes(language==='nl'?'Schakel Status':'Enable Status'));
  const data=compact.data();data.evs[0].plan=null;data.evs[0].schedule={mode:'emergency',target:null,time:'07:00'};
  compact.listeners['homeflux.ev.changed']();await compact.drain();
  assert(compact.host.innerHTML.includes('100%'));
  const summary=compact.host.innerHTML.split('status-summary')[1];assert(!summary.includes('07:00'));
  data.evs[0].schedule=null;compact.listeners['homeflux.ev.changed']();await compact.drain();
  assert(!compact.host.innerHTML.includes('100%'));assert(compact.host.innerHTML.includes('—'));
  assert.equal(compact.calls.filter(c=>c.method==='POST').length,0);assert.equal(compact.timers.size,0);
  reports.push(language+': compact Status-only with switch '+switching+'; Emergency is 100% without standard deadline, missing schedule remains unknown');
 }
 const legacyPrefs=await session({status:null,switching:true,count:1});
 assert(legacyPrefs.host.innerHTML.includes('data-section="status" class="active"'));
 reports.push('Existing preferences without showStatus gain the first Status tab');
 const savedStatus=new Map(),statusA=await session({status:true,switching:true,instanceId:'status_A',storage:savedStatus});
 await statusA.click({section:'scheduler'});await statusA.click(target);await statusA.click(target);
 const statusDraftData=statusA.data();statusDraftData.evs[0].plan=null;statusDraftData.evs[0].schedule=null;
 statusA.setData(statusDraftData);statusA.listeners['homeflux.ev.changed']();await statusA.drain();
 await statusA.click(target);await statusA.click(target);await statusA.click({section:'status'});
 const readonly=statusA.host.innerHTML.split('status-summary')[1];assert(!readonly.includes('60%'));assert(readonly.includes('—'));
 const statusReopen=await session({status:true,switching:true,instanceId:'status_A',storage:savedStatus});
 assert(statusReopen.host.innerHTML.includes('data-section="status" class="active"'));
 await statusReopen.click({section:'insights'});
 const preserved=await session({status:true,switching:true,instanceId:'status_A',storage:savedStatus});assert(preserved.host.innerHTML.includes('class="km"'));
 const independent=await session({status:true,switching:true,instanceId:'status_B',storage:savedStatus});assert(independent.host.innerHTML.includes('status-summary'));
 reports.push('Status never displays a local draft as active; saved Status/Insights selection stays per instance and older saved tabs remain valid');
 for(const language of ['en','nl']){
  const status=await session({status:true,switching:true,language,count:1}),data=status.data();
  Object.assign(data.evs[0].plan,{type:'kwh',value:20,time:'17:00',owner:'widget',days:3,deadlineLabel:{nl:'za 31/10/2026 · 17:00',en:'Sat 31/10/2026 · 17:00'}});
  status.listeners['homeflux.ev.changed']();await status.drain();
  assert(status.host.innerHTML.includes('20 kWh'));assert(status.host.innerHTML.includes('31/10/2026'));
  assert(!status.host.innerHTML.includes('id="endDate"'));assert(!status.host.innerHTML.includes('data-key='));
  data.evs[0].plan=null;data.evs[0].schedule={mode:'smart',target:null,time:'07:00'};
  status.listeners['homeflux.ev.changed']();await status.drain();assert(!status.host.innerHTML.split('status-summary')[1].includes('07:00'));
  assert.equal(status.calls.filter(c=>c.method==='POST').length,0);
  reports.push(language+': Status shows central kWh/multiday target and absolute date without inputs; no target invents no deadline');
 }
 const compose=JSON.parse(fs.readFileSync(path.join(__dirname,'../widgets/ev/widget.compose.json')));
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../app.json')));
 assert.deepEqual(manifest.widgets.ev,{...compose,id:'ev'});
 assert.equal(compose.settings.find(s=>s.id==='switchSections').value,false);
 assert.equal(compose.settings.find(s=>s.id==='showStatus').value,true);
 reports.push('Switching is opt-in; generated widget manifest matches Compose');
 for(const language of ['en','nl']){
  const tabs=await session({switching:true,language});
  assert(tabs.host.innerHTML.includes('data-section="scheduler"'));
  assert(tabs.host.innerHTML.includes('data-section="insights"'));
  assert(tabs.host.innerHTML.includes('data-key="goal0"'));
  assert(!tabs.host.innerHTML.includes('class="km"'));
  const before=tabs.calls.length;
  await tabs.click(target);assert(tabs.host.innerHTML.includes(language==='nl'?'Bevestig':'Confirm'));
  await tabs.click({section:'insights'});
  assert(!tabs.host.innerHTML.includes('data-key="goal0"'));
  assert(tabs.host.innerHTML.includes('class="km"'));
  assert(tabs.host.innerHTML.includes('data-ev="2"'));
  assert.equal(tabs.timers.size,0,'view switch cancels five-second confirmation');
  await tabs.click({section:'scheduler'});
  assert(tabs.host.innerHTML.includes('data-key="goal0"'));
  assert(!tabs.host.innerHTML.includes('class="km"'));
  assert(!tabs.host.innerHTML.includes(language==='nl'?'Bevestig':'Confirm'));
  assert.equal(tabs.calls.length,before,'view switching makes no GET or POST call');
  assert(!tabs.host.innerHTML.includes('evWidget.'));
  reports.push(language+': header switch shows only one section, cancels confirmation and sends no API calls');
 }
 for(const [scheduler,insights]of [[true,false],[false,true],[false,false]]){
  const tabs=await session({switching:true,scheduler,insights});
  assert(!tabs.host.innerHTML.includes('data-section='));
  assert.equal(tabs.host.innerHTML.includes('data-key="goal0"'),scheduler);
  assert.equal(tabs.host.innerHTML.includes('class="km"'),insights);
  reports.push('Switch option respects single/disabled sections '+scheduler+'/'+insights);
 }
 const tabStorage=new Map(),tabs=await session({switching:true,instanceId:'tabs_A',storage:tabStorage});
 await tabs.click({section:'insights'});await tabs.click({ev:'2'});
 assert(tabs.host.innerHTML.includes('City EV'));assert(tabs.host.innerHTML.includes('class="km"'));
 const tabReopen=await session({switching:true,instanceId:'tabs_A',storage:tabStorage});
 assert(tabReopen.host.innerHTML.includes('data-ev="2" class="active"'));
 assert(tabReopen.host.innerHTML.includes('class="km"'));assert(!tabReopen.host.innerHTML.includes('data-key="goal0"'));
 const tabOther=await session({switching:true,instanceId:'tabs_B',storage:tabStorage});
 assert(tabOther.host.innerHTML.includes('data-key="goal0"'));assert(!tabOther.host.innerHTML.includes('class="km"'));
 reports.push('View and EV persist per widget instance; switching EV preserves Insights');
 const tabDraft=await session({switching:true,count:1}),tabDraftData=tabDraft.data();
 tabDraftData.evs[0].plan=null;tabDraft.setData(tabDraftData);tabDraft.listeners['homeflux.ev.changed']();await tabDraft.drain();
 await tabDraft.click(targetDraft);await tabDraft.click(targetDraft);
 await tabDraft.click({section:'insights'});await tabDraft.click({section:'scheduler'});
 assert(tabDraft.host.innerHTML.includes('Draft'));assert(tabDraft.host.innerHTML.includes('60%'));
 assert.equal(tabDraft.calls.filter(c=>c.method==='POST').length,0);
 reports.push('Local draft survives view switching without submitting a planning command');
 for(const language of ['en','nl']){
  const central=await session({count:1,language}), dictionary=require('../locales/'+language+'.json');
  for(const state of ['charging','paused','waiting','idle','ended','unknown']){
   const data=central.data();data.evs[0].state=state;central.setData(data);
   central.listeners['homeflux.ev.changed']();await central.drain();
   assert(central.host.innerHTML.includes(dictionary.evWidget.states[state]));
   assert(!central.host.innerHTML.includes('evWidget.states.'));
  }
  assert.equal(central.calls.filter(c=>c.method==='POST').length,0);
  reports.push(language+': central charging, paused, waiting, idle, ended and unknown states render without commands');
 }
 for(const language of ['en','nl']){
  const advanced=await session({count:1,language});
  const day={key:'days3',change:JSON.stringify({days:3})};
  await advanced.click(day);assert.equal(advanced.calls.filter(c=>c.method==='POST').length,0);
  await advanced.click(day);assert.equal(advanced.calls.filter(c=>c.method==='POST').length,1);assert.equal(advanced.calls.find(c=>c.method==='POST').body.change.days,3);
  const maxPv={key:'maxPv',change:JSON.stringify({maxPv:true})};
  await advanced.click(day);await advanced.click(maxPv);assert.equal(advanced.calls.filter(c=>c.method==='POST').length,1);
  await advanced.click(maxPv);assert.equal(advanced.calls.filter(c=>c.method==='POST').length,2);
  const data=advanced.data();Object.assign(data.evs[0].plan,{owner:'widget',days:3,maxPv:true,deadlineLabel:{nl:'vr 30/10/2026 · 07:00',en:'Fri 30/10/2026 · 07:00'},provisional:true});
  advanced.setData(data);advanced.listeners['homeflux.ev.changed']();await advanced.drain();
  assert(advanced.host.innerHTML.includes(language==='nl'?'vr 30/10/2026':'Fri 30/10/2026'));assert(advanced.host.innerHTML.includes('id="endDate"'));assert(advanced.host.innerHTML.includes('data-key="clear"'));assert(!advanced.host.innerHTML.includes('evWidget.'));
  const manual={key:'deadline',change:JSON.stringify({deadline:{dateKey:'2026-10-29',time:'12:00'}})};
  await advanced.click(manual);await advanced.click(manual);assert.equal(advanced.calls.filter(c=>c.method==='POST').length,3);
  const clear={key:'clear',change:JSON.stringify({clear:true})};await advanced.click(clear);assert.equal(advanced.calls.filter(c=>c.method==='POST').length,3);await advanced.click(clear);assert.equal(advanced.calls.filter(c=>c.method==='POST').length,4);
  reports.push(language+': days, Max PV, manual deadline and clear all double-confirm; central absolute date and provisional state translated');
 }
 for(const language of ['en','nl']){
  const emergency=await session({count:1,language}),data=emergency.data();
  data.evs[0].plan=null;data.evs[0].schedule.mode='smart';emergency.setData(data);emergency.listeners['homeflux.ev.changed']();await emergency.drain();
  const on={key:'emergency',change:JSON.stringify({mode:'emergency'})};
  await emergency.click(on);assert.equal(emergency.calls.filter(c=>c.method==='POST').length,0);
  await emergency.click(on,{drag:true});assert.equal(emergency.calls.filter(c=>c.method==='POST').length,0);
  await emergency.click(on);await emergency.click(on);assert.equal(emergency.calls.filter(c=>c.method==='POST').length,1);
  data.evs[0].schedule.mode='emergency';emergency.setData(data);emergency.listeners['homeflux.ev.changed']();await emergency.drain();
  assert(emergency.host.innerHTML.includes('100%'));assert(emergency.host.innerHTML.includes('data-key="emergency"'));assert(!emergency.host.innerHTML.includes('evWidget.'));
  const off={key:'emergency',change:JSON.stringify({mode:'smart'})};await emergency.click(off);await emergency.click(off);assert.equal(emergency.calls.filter(c=>c.method==='POST').length,2);
  reports.push(language+': Emergency double-confirmation without a goal; swipe ignored; active 100% target; off uses Smart');
 }
 const htmlCases=[];
 for(const [name,settings]of [['combined',{scheduler:true,insights:true}],['scheduler',{scheduler:true,insights:false}],['insights',{scheduler:false,insights:true}],['switch-planning',{switching:true}],['switch-insights',{switching:true}],['switch-planning-nl',{switching:true,language:'nl'}],['switch-insights-nl',{switching:true,language:'nl'}]]){
  const s=await session({...settings,count:1});if(name.startsWith('switch-insights'))await s.click({section:'insights'});htmlCases.push({name,body:s.host.innerHTML});
 }
 if(process.env.HEMS_EV_PREVIEW_DIR){
  fs.mkdirSync(process.env.HEMS_EV_PREVIEW_DIR,{recursive:true});
  for(const row of htmlCases){const html=source.replace(/<main id="app"><\/main>/,`<main id="app">${row.body}</main>`).replace(/<script[\s\S]*?<\/script>/g,'');fs.writeFileSync(path.join(process.env.HEMS_EV_PREVIEW_DIR,row.name+'.html'),html);}
 }
 fs.writeFileSync(path.join(__dirname,'../validation/ev-widget-ui-1.2.4.json'),JSON.stringify({passed:reports.length,cases:reports,simulatedDOM:true,browserTested:false},null,2)+'\n');
 console.log('EV widget UI:',reports.length,'cases passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
