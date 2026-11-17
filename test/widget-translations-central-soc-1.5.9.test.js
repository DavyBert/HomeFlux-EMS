'use strict';
process.env.TZ='Europe/Brussels';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'widgets/status/public/visual.html'),'utf8');
const parent=fs.readFileSync(path.join(root,'widgets/status/public/index.html'),'utf8');
const {createSampler,historyCursor}=require('../lib/visual-house-history');
const {emptyDay,emptyInventory}=require('../lib/savings');
const old=Module._load;
Module._load=function(request,parent,main){if(request==='homey')return {App:class{}};if(request==='homey-api')return {HomeyAPI:{}};return old.call(this,request,parent,main)};
let App;try{App=require('../app')}finally{Module._load=old}
const T=Date.parse('2026-11-16T10:00:00+01:00'),STEP=300000;
// The app fixtures belong to 16 November; keep their API day query on that date.
const originalDateNow=Date.now;Date.now=()=>T;
const dateKey=at=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
function appAt(at=T){
 const db=new Map(),writes=[];const app=Object.create(App.prototype);
 app.homey={clock:{getTimezone:()=> 'Europe/Brussels'},settings:{get:key=>db.get(key),set:(key,value)=>{db.set(key,structuredClone(value));writes.push(key)}}};
 app.getSettings=()=>({batteryCount:2,timezone:'Europe/Brussels'});app.settingsCache=app.getSettings();
 app.getSavingsDateKey=(value=at)=>dateKey(value);app.syncEmsDevices=()=>Promise.resolve();
 app.savings={today:emptyDay(dateKey(at)),history:{},inventory:emptyInventory(),total:0,lastSampleAt:at};
 app.state={pvPowerW:0,batterySoc:[60,80]};app.inputSeen={pv:true,batterySoc:[true,true]};
 app.inputUpdatedAt={pv:at,batterySoc:[at,at]};app.evSessionDetection={physicalSiteLoadW:1200};
 return {app,db,writes};
}
function tick(app,at,{soc=true,house=true}={}){
 app.inputSeen.pv=house;app.inputUpdatedAt.pv=at;
 if(soc)app.inputUpdatedAt.batterySoc=[at-2000,at-1000];
 app.recordVisualHouseLoadSample(at);
}
// One optional SOC read per original bucket, with the unchanged integration.
let reads=0;const sampler=createSampler();let rows=[];
for(let at=T;at<=T+2*STEP;at+=1000)rows.push(...sampler.sample(at,1200,()=>{reads++;return {soc:67.25,at:at-1234}}));
assert.equal(reads,2);assert.equal(rows.length,2);
for(const row of rows){assert.equal(row[1],1200);assert.equal(row[3],STEP);assert.equal(row[4],67.25);assert.equal(row[5],row[6]-1234)}
const {app,db,writes}=appAt();
for(let at=T;at<=T+STEP;at+=10000)tick(app,at);
assert.equal(writes.length,0,'history observer never writes Settings');
assert.equal(app.savings.today.houseLoadHistory.length,1);
const shared=app.getVisualHouseLoadHistory(),point=shared.rows[0];
assert.equal(point.powerW,1200);assert.equal(point.soc,70);
assert.equal(point.at,T);assert.equal(point.socAt,T+STEP-1000,'receipt timestamp is not the house average timestamp');
assert.equal(point.cursorAt,T+STEP);
assert.equal(app.getVisualHouseLoadHistory({date:shared.date,after:point.cursorAt}).rows.length,0);
// No house data: still one genuine SOC, with no fabricated power field.
for(let at=T+STEP+10000;at<=T+2*STEP;at+=10000)tick(app,at,{house:false});
const onlySoc=app.getVisualHouseLoadHistory({date:shared.date,after:point.cursorAt}).rows;
assert.equal(onlySoc.length,1);assert.equal(onlySoc[0].soc,70);assert(!Object.hasOwn(onlySoc[0],'powerW'));
// Unknown, out-of-range, zero and stale readings are handled independently.
app.state.batterySoc=[null,200];
for(let at=T+2*STEP+10000;at<=T+3*STEP;at+=10000)tick(app,at,{house:false});
assert.equal(app.savings.today.houseLoadHistory.length,2);
app.state.batterySoc=[0,0];
for(let at=T+3*STEP+10000;at<=T+4*STEP;at+=10000)tick(app,at,{house:false});
assert.equal(app.savings.today.houseLoadHistory.at(-1)[4],0,'real zero SOC is retained');
for(let at=T+4*STEP+10000;at<=T+6*STEP;at+=10000)tick(app,at,{house:false,soc:false});
assert.equal(app.savings.today.houseLoadHistory.length,3,'old SOC is not repeated as a new observation');
// The ordinary Savings save path persists both sources in the same value.
app.persistSavingsState(T+6*STEP,true);
const saved=structuredClone(db.get('_savingsToday').houseLoadHistory);
const restarted=appAt().app;restarted.homey=app.homey;restarted.restoreSavingsState();
assert.deepEqual(restarted.savings.today.houseLoadHistory,saved);
const oldRows=[[T-STEP,400],[T,500,T+STEP,STEP]];
db.set('_savingsToday',{...emptyDay(dateKey(T)),houseLoadHistory:oldRows});restarted.restoreSavingsState();
assert.deepEqual(restarted.getVisualHouseLoadHistory().rows.map(row=>row.powerW),[400,500]);
assert(!restarted.getVisualHouseLoadHistory().rows.some(row=>Object.hasOwn(row,'soc')));
// Midnight splits sources by their real timestamps, not by the cursor.
for(const midnight of ['2026-11-17T00:00:00+01:00','2026-03-30T00:00:00+02:00','2026-10-26T00:00:00+01:00']){
 const end=Date.parse(midnight),a=appAt(end-STEP).app;
 const realNow=Date.now;Date.now=()=>end;
 for(let at=end-STEP;at<end;at+=10000)tick(a,at);
 a.savings.today=emptyDay(dateKey(end));a.getSavingsDateKey=(value=end)=>dateKey(value);
 a.inputUpdatedAt.batterySoc=[end,end];a.recordVisualHouseLoadSample(end);
 const history=a.getVisualHouseLoadHistory();assert.equal(history.date,dateKey(end));assert.equal(history.rows.length,1);
 assert.equal(history.rows[0].socAt,end);assert(!Object.hasOwn(history.rows[0],'powerW'),'yesterday house power never becomes today power');
 for(let at=end+10000;at<=end+STEP;at+=10000)tick(a,at);
 assert.equal(a.getVisualHouseLoadHistory({date:history.date,after:end}).rows.length,1,'cursor preserves next house bucket after SOC-only midnight');
 Date.now=realNow;
}
// Enforce the existing limit with a long, bounded synthetic day.
const limited=appAt().app;limited.savings.today.houseLoadHistory=Array.from({length:720},(_,i)=>[T-720+i,500]);
tick(limited,T);for(let at=T+10000;at<=T+STEP;at+=10000)tick(limited,at);
assert.equal(limited.savings.today.houseLoadHistory.length,720);
assert(historyCursor(limited.savings.today.houseLoadHistory.at(-1))>T);
assert(!html.includes('SOC_OBSERVATIONS_KEY'));assert(!html.includes('localStorage'));
assert(parent.includes('row?.cursorAt ?? row?.at'));assert(parent.includes("tr(Homey,'widget.visual.catalog'"));

function domFor(language){
 const errors=[],logs=new VirtualConsole();logs.on('jsdomError',error=>{if(error.type!=='css-parsing')errors.push(error.message)});logs.on('error',(...a)=>errors.push(a.join(' ')));
 const exposed=html.replace('initLiveWidget();','window.__test={readCentralSocHistory,observedSocPoints,uiText,rowSpecs,getState:()=>s,history:()=>centralSocObservations};initLiveWidget();');
 const dom=new JSDOM(exposed,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://widget.test/',virtualConsole:logs});
 const send=data=>dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:dom.window.parent,data}));
 const catalog=JSON.parse(JSON.parse(fs.readFileSync(path.join(root,'locales',language+'.json'),'utf8')).widget.visual.catalog);
 send({type:'homeflux.visual.widgetConfig',translations:catalog,order:[],hidden:[],folded:[],dayTimelineFolded:false,dayInfoScale:100,configured:true});
 return {dom,send,catalog,errors};
}
Date.now=originalDateNow;
const now=Date.now(),start=new Date();start.setHours(0,0,0,0);
const status={version:'1.5.10',avgSoc:70,decisionText:'BACKEND STATUS',decisionReason:'BACKEND REASON',
 effectiveCapacityKwh:21.6,planningChargeTargetSoc:80,controlEnabled:true,
 settings:{contractType:'dynamic_quarter',batteryCount:2,evCount:1,hvacCount:1,boilerCount:1,minSoc:12,safetySoc:14},
 inputs:{gridPowerW:800,pvPowerW:200,forecastDailyMaxKwh:8,forecastRemainingKwh:3,batterySoc:[60,80]},
 visualPlanner:{solarTargetTime:'17:00',nightTargetTime:'07:00',dayPlanningMaxSoc:80,nightPlanningMaxSoc:95,maxSoc:100,maxTotalChargeW:6000,maxTotalDischargeW:6000},
 energyBudget:{householdDailyKwh:20},planningSummary:{ready:true,targetAt:now+6*3600000,gridPlannedKwh:2,energyNeedKwh:3},
 nextCharge:{state:'waiting'},evs:[{name:'Batterij',enabled:true,connected:true,outputAllowed:true,outputCurrentA:10,reason:'EV BACKEND'}],
 hvacs:[{name:'Huisverbruik',enabled:true,outputMode:'heat',roomTemperatureC:20,outputSetpointC:21,reason:'HVAC BACKEND'}],boiler:{enabled:true,outputOn:false,reason:'BOILER BACKEND'},
 tariff:{className:'normal',label:'CUSTOM TARIFF',price:.3},tariffTimeline:[]};
const expected={nl:'Dagoverzicht energie',en:'Daily energy overview',fr:'Bilan énergétique journalier',de:'Tägliche Energieübersicht',es:'Resumen energético diario'};
const historyRows=[{at:now-600000,endAt:now-300000,coveredMs:300000,powerW:1000,soc:60.5,socAt:now-301000,cursorAt:now-300000},
 {at:now-100000,soc:61.7,socAt:now-101000,cursorAt:now-100000}];
const centralResults=[];
for(const language of Object.keys(expected)){
 const {dom,send,catalog,errors}=domFor(language),w=dom.window,doc=w.document;
 const auditText=()=>{
  if(language==='nl')return;
  const protectedSelector='script,style,code,.ev-name,.hvac-title,.detail-copy,.detail-header h3,.val,.field-val,.field-name,#rawFocus,#savingsEvSelect option:not([value=all]),.tariff-legend,#tariffTimeline';
  const walker=doc.createTreeWalker(doc.body,w.NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){
   if(node.parentElement.closest(protectedSelector))continue;
   const text=node.nodeValue.trim(),translation=catalog.exact[text];
   assert(!translation||translation===text,'untranslated '+language+' text: '+text);
  }
 };
 send({type:'homeflux.visual.status',status:structuredClone(status)});
 send({type:'homeflux.visual.houseHistory',rows:historyRows,initial:true});
 assert.equal(doc.documentElement.lang,language);
 assert.equal(doc.querySelector('#energyDayPanel > .section-top h2').textContent,expected[language]);
 assert.equal(doc.querySelector('#decision').textContent,'BACKEND STATUS');assert.equal(doc.querySelector('#reason').textContent,'BACKEND REASON');
 assert.equal(doc.querySelector('.ev-name').textContent,'Batterij');assert.equal(doc.querySelector('.hvac-title').textContent,'Huisverbruik');
 assert.equal(w.__test.getState().historyRows.length,1,'SOC-only row is not house power');
 centralResults.push(JSON.stringify(w.__test.observedSocPoints(now)));
 assert.equal(w.__test.observedSocPoints(now).length,2);
 const before=JSON.stringify(w.__test.history());send({type:'homeflux.visual.status',status:{...status,avgSoc:12}});
 assert.equal(JSON.stringify(w.__test.history()),before,'live statuses do not register widget-local SOC');
 doc.querySelector('[data-ev="0"]').click();assert(doc.querySelector('#evDetail').textContent.includes('EV BACKEND'));
 doc.querySelector('[data-hvac="0"]').click();assert(doc.querySelector('#hvacDetail').textContent.includes('HVAC BACKEND'));
 doc.querySelector('#infoExplorer').open=true;
 for(const tab of ['decision','battery','energy','planning','tariff','ev','hvac','boiler','safety','injection','savings','all']){
  doc.querySelector('[data-info="'+tab+'"]').click();
  if(language!=='nl')assert(!/Dagoverzicht|Ontbrekende|Gemiddelde|Veiligheids|Geen veld|Niet beschikbaar|Kies een|Laadvenster|Prijsdata|Geconfigureerd|Stroomprijs/.test(doc.querySelector('#infoArea').textContent),language+' '+tab);
  auditText();
 }
 if(language!=='nl'){
  for(const id of ['houseTodayLabel','socForecastEndLabel','pvRemain','footerLabel','dayType','loadCount','houseSavingsSubtitle','evSavingsSubtitle'])
   assert(!/Huisverbruik|Rest |Tegen|GEEN|ALLEEN|Besparing|Volgens|DYNAMISCH|KWARTIER/.test(doc.getElementById(id).textContent),language+' '+id);
  assert(!doc.querySelector('#energyChart').getAttribute('aria-description').includes('Gele PV'));
 }
 send({type:'homeflux.visual.savingsError',period:'day',ev:'all',detail:'Geen antwoord'});
 if(language!=='nl')assert(!/Historische|mislukt|Geen antwoord|Controleer/.test(doc.querySelector('#savingsFoot').textContent));
 auditText();
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS widget DOM, labels, details, all 12 Explorer tabs, backend/name preservation, central SOC: '+language);
 dom.window.close();
}
assert(centralResults.every(value=>value===centralResults[0]),'separate widgets and languages use identical measured SOC');
console.log('PASS central five-minute SOC, actual receipt time, no house dependency, no fictitious/stale points, delta cursor, restart, legacy rows, midnight/DST and 720-point limit');

// Tariff preprocessing remains frozen. The forecast hash includes the
// authorized active/forced-charge presentation fixes, covered by the engine
// comparisons in widget-active-charge-forecast-1.5.10.test.js and
// widget-forced-charge-forecast-1.5.9.test.js.
// PV display hash includes the authorized per-day reset and scale UI.
const {createHash}=require("node:crypto");
for(const [start,end,expected] of [["let normalizedTariffCache=null;", "function buildRollingTimelineFromRows(", "9c06353606a08ab0fde8d3ec8a6753b07839f0603cad02b79f131173a913894f"], ["function readHouseSamples(", "// Cumulative PV forecast", "5e3712d0fb9a4afe95bcd985724525324b5c2568e7369ec8d9bd80bc383ff582"], ["// Cumulative PV forecast", "function renderEnergyDay(", "656d37ff0f103a9768e23ea287b9739086f0b16fedd6fcb8f8ef0a985c61ff8b"]]){
 const at=html.indexOf(start);assert(at>=0);const region=html.slice(at,html.indexOf(end,at+start.length));
 assert.equal(createHash("sha256").update(region).digest("hex"),expected,start+" must match the validated source");
}
for(const name of ["app.json",".homeycompose/app.json","package.json","package-lock.json"])assert.equal(JSON.parse(fs.readFileSync(path.join(root,name))).version,"1.5.10");
console.log("PASS validated forced-charge forecast, frozen tariff preprocessing, PV display and release versions");
