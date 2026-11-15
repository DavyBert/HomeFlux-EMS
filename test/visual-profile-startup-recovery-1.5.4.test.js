'use strict';
// The Visual Look configuration is stored outside the EMS settings cache. On a
// cold app start an unavailable widget endpoint must not replace a saved color
// profile with defaults or block re-applying it when the app becomes ready.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const store=require('../lib/visual-widget-profiles');
const html=fs.readFileSync(path.join(__dirname,'../widgets/status/public/index.html'),'utf8');

function extract(begin,end){
 const start=html.indexOf(begin),stop=html.indexOf(end,start);
 assert(start>=0&&stop>start,`missing UI routine: ${begin}`);
 return html.slice(start,stop);
}
const routines=[
 extract('function sendVisualAppearance(force = false) {','const visualMedia ='),
 extract('function sendVisualWidgetConfiguration(){','async function requestPersistedVisualProfile(){'),
 extract('async function requestPersistedVisualProfile(){','if(visualLook)refreshVisualWidgetProfile(true).catch'),
].join('\n');
const profileKey=store.STORAGE_KEY;
const savedData=new Map();
const homey={settings:{get:key=>savedData.has(key)?structuredClone(savedData.get(key)):null,
 set:(key,value)=>savedData.set(key,structuredClone(value))}};
const custom=store.get(homey,'medium');
custom.dayInfoScale=125;
custom.themes.dark.background='#35224D';
custom.themes.dark.cardBackground='#446688';
custom.themes.dark.backgroundBrightness=37;
custom.themes.dark.cardBrightness=45;
custom.themes.dark.graphTransparent=true;
custom.themes.dark.sections.energyDayPanel='#224466';
custom.themes.light.background='#EEE5F2';
custom.themes.light.cardBackground='#CEDFEA';
custom.themes.light.graphTransparent=false;
store.save(homey,'medium',custom);

function harness(resultMode){
 const state={clock:100000,mode:'dark',calls:[],messages:[],timers:new Map(),nextTimer:1,
   action:resultMode||'success'};
 const api=async (verb,url) => {
   assert.equal(verb,'GET');assert.equal(url,'/visual-profile?name=medium');
   state.calls.push({verb,url});
   if(state.action==='reject')throw new Error('Homey app is restarting');
   if(state.action==='invalid')return null;
   if(state.action==='hang')return new Promise(()=>{});
   return store.get(homey,'medium');
 };
 const context=vm.createContext({
  Homey:{api},selectedVisualProfile:'medium',visualLook:true,console:{warn:()=>{},error:console.error},
  document:{body:{style:{setProperty:()=>{}}}},
  Date:class extends Date {static now(){return state.clock;}},
  setTimeout:(fn,delay)=>{const id=state.nextTimer++;state.timers.set(id,{fn,delay});return id;},
  clearTimeout:id=>state.timers.delete(id),
  encodeURIComponent,JSON,Promise,
  state,
 });
 const script=`
 let visualProfile={name:'medium',...${JSON.stringify(store.defaults().medium)}};
 let visualProfileLastFetched=0,visualProfilePending=null,visualProfileRetryAfter=0;
 let appliedVisualProfileSignature=null,appliedVisualMode=null,widgetConfigurationReady=false;
 function activeHomeyMode(){return state.mode;}
 function activeVisualTheme(){return visualProfile?.themes?.[activeHomeyMode()]||{};}
 function sendVisual(type,payload){state.messages.push({type,payload});}
 ${routines}
 globalThis.test={
  get:()=>({ready:widgetConfigurationReady,retry:visualProfileRetryAfter,last:visualProfileLastFetched,
   background:visualProfile.themes.dark.background,pending:Boolean(visualProfilePending)}),
  load:force=>refreshVisualWidgetProfile(force),
  async tick(){
   if ((!widgetConfigurationReady||visualProfileRetryAfter>0) && !visualProfilePending && Date.now()>=visualProfileRetryAfter)
     await refreshVisualWidgetProfile();
   if(widgetConfigurationReady)sendVisualAppearance();
  },
  repaint:()=>sendVisualAppearance(true),
  mode(){sendVisualAppearance();},
 };
 `;
 vm.runInContext(script,context);
 return {state,ui:context.test};
}

(async()=>{
 // After a restart the stored profile is applied without 'Profiel opslaan'.
 const normal=harness();
 assert.equal(await normal.ui.load(true),true);
 assert.equal(normal.ui.get().ready,true);
 let appearance=normal.state.messages.find(x=>x.type==='homeflux.visual.appearance');
 let layout=normal.state.messages.find(x=>x.type==='homeflux.visual.widgetConfig');
 assert(appearance);assert(layout);
 assert.equal(appearance.payload.background,'#35224D');
 assert.equal(appearance.payload.backgroundBrightness,37);
 assert.equal(appearance.payload.cardBackground,'#446688');
 assert.equal(appearance.payload.cardBrightness,45);
 assert.equal(appearance.payload.graphTransparent,true);
 assert.equal(layout.payload.colors.energyDayPanel,'#224466');
 assert.equal(layout.payload.dayInfoScale,125);
 normal.state.mode='light';normal.ui.mode();
 appearance=normal.state.messages.filter(x=>x.type==='homeflux.visual.appearance').at(-1);
 assert.equal(appearance.payload.background,'#EEE5F2');
 assert.equal(appearance.payload.cardBackground,'#CEDFEA');
 assert.equal(appearance.payload.graphTransparent,false);
 const requestsBefore=normal.state.calls.length;
 normal.state.clock+=10000;await normal.ui.tick();
 assert.equal(normal.state.calls.length,requestsBefore,'normal status cycle must not refetch a successfully loaded profile');
 assert.equal(normal.state.messages.filter(x=>x.type==='homeflux.visual.recalculate').length,0);
 // Iframe reload re-pushes the already loaded theme (no profile save).
 normal.ui.repaint();
 assert.equal(normal.state.messages.filter(x=>x.type==='homeflux.visual.appearance').at(-1).payload.background,'#EEE5F2');

 for(const failure of ['reject','invalid','hang']){
  const restored=harness(failure);
  const pending=restored.ui.load(true);
  if(failure==='hang'){
   await Promise.resolve();await Promise.resolve();
   assert.equal(restored.state.timers.size,1,'a stuck request has a bounded timeout');
   for(const timer of [...restored.state.timers.values()])timer.fn();
  }
  assert.equal(await pending,false,`initial ${failure} must not cache the default profile`);
  assert.equal(restored.ui.get().ready,false);
  assert.equal(restored.ui.get().last,0);
  assert.equal(restored.ui.get().retry,115000);
  assert(!restored.state.messages.some(x=>x.type==='homeflux.visual.widgetConfig'));
  restored.state.action='success';
  restored.state.clock=110000;await restored.ui.tick();
  assert.equal(restored.state.calls.length,1,'retry backoff should suppress immediate requests');
  restored.state.clock=120000;await restored.ui.tick();
  assert.equal(restored.state.calls.length,2);
  assert.equal(restored.ui.get().ready,true);
  assert.equal(restored.ui.get().background,'#35224D');
  assert.equal(restored.state.messages.filter(x=>x.type==='homeflux.visual.appearance').at(-1).payload.background,'#35224D');
  assert.equal(restored.state.messages.filter(x=>x.type==='homeflux.visual.widgetConfig').at(-1).payload.colors.energyDayPanel,'#224466');
  assert(!restored.state.messages.some(x=>x.type==='homeflux.visual.recalculate'),'startup restoration must not trigger chart recalculation');
 }
 // A failure after a previously successful read must preserve the old profile
 // until the saved version is available, not destroy user colors.
 const subsequent=harness();
 await subsequent.ui.load(true);
 subsequent.state.action='reject';
 assert.equal(await subsequent.ui.load(true),false);
 assert.equal(subsequent.ui.get().background,'#35224D');
 subsequent.state.action='success';
 subsequent.state.clock+=20000;
 await subsequent.ui.tick();
 assert.equal(subsequent.state.calls.length,3);
 assert.equal(subsequent.ui.get().retry,0);
 console.log('PASS Visual Look: restart persistence, light/dark restore, transient failures, stalled request timeout, no extra recalculation');
})().catch(e=>{console.error(e);process.exitCode=1;});
