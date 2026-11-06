'use strict';
// Actual widget + controller + central app storage, with only Homey I/O, DOM
// event dispatch and time mocked. No browser or native date-picker claim.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {boot}=require('./startup-harness'),controller=require('../widgets/ev/public/controller');
const source=fs.readFileSync('widgets/ev/public/index.html','utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const RealDate=Date,now=RealDate.parse('2026-11-06T10:00:00Z');let checks=0;
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const drain=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
async function session(language='en',missingText=false){
 const h=await boot(new Map(Object.entries({evCount:1,evEnabled:true,evSocEnabled:true,batteryCount:0,controlEnabled:false,
  evWidgetSoc1:60,evWidgetSoc2:80,evWidgetSoc3:100,evWidgetTime1:'07:00',evWidgetTime2:'12:00',evWidgetTime3:'17:00'}))),a=h.app;
 a.requestContextEvaluate=()=>{};
 await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:0});
 await h.cards.get('set_ev1_soc').listener({soc:50});
 const dictionary=JSON.parse(fs.readFileSync('locales/'+language+'.json','utf8'));
 if(missingText){dictionary.evWidget.confirmSchedule='';dictionary.evWidget.confirm='';}
 const events={},documentListeners={},windowListeners={},calls=[],timers=new Map(),fields=new Map();let text='',serial=0,postFailure=false,holdGet=false,releaseGet;
 const document={hidden:false,activeElement:null,addEventListener:(k,v)=>documentListeners[k]=v};
 const actions={set innerHTML(value){text=text.replace(/(<div id="deadlineActions">)[\s\S]*?(<\/div>)/,(_,open,close)=>open+value+close);},get innerHTML(){return text.match(/<div id="deadlineActions">([\s\S]*?)<\/div>/)?.[1]||'';}};
 const host={scrollHeight:700,textContent:'',addEventListener:(k,v)=>events[k]=v,
  querySelector(selector){return selector==='#deadlineActions'?actions:fields.get(selector.slice(1))||null;},
  set innerHTML(value){text=value;fields.clear();for(const m of value.matchAll(/<input\b[^>]*id="(endDate|endTime)"[^>]*value="([^"]*)"[^>]*>/g))fields.set(m[1],{id:m[1],value:decode(m[2])});document.activeElement=null;},get innerHTML(){return text;}};
 document.getElementById=()=>host;
 const H={getSettings:()=>({showStatus:false,showScheduler:true,showInsights:false}),__:key=>key.split('.').reduce((v,k)=>v?.[k],dictionary),ready(){},setHeight(){},on:(k,v)=>events[k]=v,off(){},
  api:async(method,url,body)=>{
   calls.push({method,url,body});
   if(method==='GET'){const data=structuredClone(a.getEvDashboard());if(holdGet){holdGet=false;return new Promise(resolve=>{releaseGet=()=>resolve(data);});}return data;}
   if(postFailure)throw Error('evWidget.errors.save');
   return structuredClone(await a.setEvDashboard(body));
  }};
 const context=vm.createContext({Date,Math,JSON,console,HomeFluxEvController:controller,document,window:{addEventListener:(k,v)=>windowListeners[k]=v},
  setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(source,context);context.QA_H=H;vm.runInContext('onHomeyReady(QA_H)',context);await drain();
 function node(key){const tag=[...text.matchAll(/<button\b[^>]*>/g)].map(m=>m[0]).find(s=>s.includes('data-key="'+key+'"'));if(!tag)return null;const dataset={};for(const m of tag.matchAll(/data-([\w-]+)="([^"]*)"/g))dataset[m[1]]=decode(m[2]);return {dataset,closest(){return this;}};}
 async function click(key,existing){const target=existing||node(key);if(!target)return false;document.activeElement=target;const event={target,pointerId:1,clientX:0,clientY:0,detail:1};events.pointerdown(event);events.click(event);await drain();return true;}
 async function input(id,value,event='input'){const field=fields.get(id);assert(field,id+' exists');field.value=value;document.activeElement=field;events[event]({target:field});await drain();return field;}
 const confirm=async key=>{await click(key);await click(key);};
 return {h,a,host,node,click,input,confirm,events,timers,calls,context,document,fields,dictionary,
  posts:()=>calls.filter(c=>c.method==='POST'),plan:()=>a.getEvDashboard().evs[0].plan,
  fault:value=>{postFailure=value;},hold:()=>{holdGet=true;},release:()=>releaseGet()};
}
(async()=>{try{
 // A calendar is usable immediately; no +X day preselection is required.
 for(const language of ['nl','en','fr','es','de']){
  const u=await session(language);assert(u.fields.has('endDate'));assert(!u.node('deadline'));
  await u.confirm('goal1');assert.equal(u.posts().length,0);
  const date=u.fields.get('endDate');await u.input('endDate','2026-12-06','input');await u.input('endTime','17:00','change');
  assert.equal(u.fields.get('endDate'),date,'editing must not destroy native input nodes');
  assert(u.host.innerHTML.includes(u.dictionary.evWidget.confirmSchedule));assert(u.node('deadline'));
  assert.equal(u.posts().length,0);await u.click('deadline');
  // Browsers may emit both events for one committed picker value. Repeated
  // identical events must not cancel the deliberate second confirmation.
  await u.input('endDate','2026-12-06','change');await u.input('endTime','17:00','input');
  await u.click('deadline');assert.equal(u.posts().length,1);
  assert.equal(u.plan().deadlineLabel.dateKey,'2026-12-06');assert.equal(u.plan().time,'17:00');assert(u.plan().manualDate);
  assert(!u.node('deadline'));assert(u.host.innerHTML.includes(u.dictionary.evWidget.saved));
  assert.equal(u.h.store.get('evSocDeadlineOverrides')[0].deadlineAt,u.plan().deadlineAt);
  assert(!/<button\b[^>]*>\s*<\/button>/.test(u.host.innerHTML));assert(!u.host.innerHTML.includes('evWidget.'));
  assert.equal(u.timers.size,0);checks++;
 }
 const u=await session();await u.confirm('goal1');await u.confirm('days3');assert.equal(u.posts().length,0);
 await u.confirm('time2');assert.equal(u.posts().length,1);assert.equal(u.plan().days,3);assert.equal(u.plan().deadlineLabel.dateKey,'2026-11-09');checks++;
 await u.input('endDate','2026-12-06','change');await u.input('endTime','17:00','input');await u.confirm('deadline');
 assert.equal(u.posts().length,2);assert(u.plan().manualDate);assert.equal(u.plan().days,0);checks++;
 await u.input('endTime','12:00','change');await u.confirm('deadline');assert.equal(u.plan().time,'12:00');assert.equal(u.plan().deadlineLabel.dateKey,'2026-12-06');checks++;
 await u.input('endDate','2026-12-20','change');await u.confirm('deadline');assert.equal(u.plan().time,'12:00');assert.equal(u.plan().deadlineLabel.dateKey,'2026-12-20');checks++;
 // Reopening or editing back to the stored values creates no command/button.
 const count=u.posts().length;u.document.activeElement=null;u.events['homeflux.ev.changed']();await drain();assert(!u.node('deadline'));
 await u.input('endTime','12:00','input');await u.input('endDate','2026-12-20','change');assert(!u.node('deadline'));assert.equal(u.posts().length,count);checks++;
 await u.confirm('days1');assert(!u.plan().manualDate);assert.equal(u.plan().days,1);
 await u.input('endDate','2026-12-06','change');await u.confirm('deadline');assert(u.plan().manualDate);checks++;
 // Failed validation keeps the real saved plan and a retryable edit visible.
 const previous=u.plan().deadlineAt;await u.input('endDate','2026-11-01','change');await u.confirm('deadline');
 assert.equal(u.plan().deadlineAt,previous);assert(u.node('deadline'));assert(u.host.innerHTML.includes(u.dictionary.evWidget.errors.schedule));checks++;
 // Failed actual persistence, not just a rejected network request.
 const write=u.a.homey.settings.set;u.a.homey.settings.set=(key,value)=>{if(key==='evSocDeadlineOverrides')throw Error('UI storage failure');return write(key,value);};
 await u.input('endDate','2026-12-25','change');await u.confirm('deadline');u.a.homey.settings.set=write;
 assert.equal(u.plan().deadlineAt,previous);assert(u.node('deadline'));assert(u.host.innerHTML.includes(u.dictionary.evWidget.errors.save));checks++;
 await u.confirm('deadline');assert.equal(u.plan().deadlineLabel.dateKey,'2026-12-25');assert(!u.node('deadline'));checks++;
 // A delayed GET started before the save cannot replace the saved projection.
 u.document.activeElement=null;u.hold();u.events['homeflux.ev.changed']();await drain();
 await u.input('endDate','2026-12-30','change');const stale=u.node('deadline');await u.confirm('deadline');u.release();await drain();
 assert.equal(u.plan().deadlineLabel.dateKey,'2026-12-30');assert(u.host.innerHTML.includes(u.plan().deadlineLabel.en));assert(!u.node('deadline'));
 const writes=u.posts().length;await u.click('deadline',stale);await u.click('deadline',stale);assert.equal(u.posts().length,writes);checks++;
 // Focused native calendar controls survive status refreshes while editing.
 await u.input('endDate','2027-01-02','input');const field=u.fields.get('endDate');u.events['homeflux.ev.changed']();await drain();assert.equal(u.fields.get('endDate'),field);checks++;
 const fallback=await session('en',true);await fallback.confirm('goal1');await fallback.input('endDate','2026-12-06','change');await fallback.input('endTime','17:00','change');
 assert(fallback.host.innerHTML.includes('Confirm schedule'));await fallback.click('deadline');assert(!/<button\b[^>]*>\s*<\/button>/.test(fallback.host.innerHTML));checks++;
 console.log(`EV calendar UI 1.2.32: ${checks} widget/event-to-central-storage scenarios passed (simulated DOM; five languages).`);
}finally{global.Date=RealDate;}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
