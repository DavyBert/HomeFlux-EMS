'use strict';
// A temporary goal for the existing battery feedback controller. No scheduler,
// price curve, meter history or device settings are owned by this module.
const { computeAverageSoc, findCurrentTariff, isDynamicContract } = require('./ems-engine');
const { localParts } = require('./homey-energy');
const { sourceOrder, validCalibration } = require('./price-normalization');
const economics = require('./injection-economics');
const defaults = Object.freeze({ ...economics.defaults, injectionEnabled:false, injectionAutomaticEnabled:false,
  injectionMinimumPrice:0.70, injectionExportCost:0, injectionStopSoc:40, injectionTargetW:3000, injectionLimitOptionalLoads:false });
const KEY='_injectionLatch';
const PRICE_STOPS=new Set([...economics.priceStopReasons,'Terugleverprijs onder minimum','Wachten op geldige actuele terugleverprijs','Onbekende of afwijkende valuta']);
const finite=x=>x!==null&&x!==undefined&&x!==''&&typeof x!=='boolean'&&Number.isFinite(Number(x));
const CURRENCIES=Object.freeze({'€':'EUR','£':'GBP','EUR':'EUR','GBP':'GBP','USD':'USD','CHF':'CHF','SEK':'SEK','NOK':'NOK','DKK':'DKK','PLN':'PLN','CZK':'CZK'});
const currency=s=>CURRENCIES[String(s.currencySymbol||'€').trim()]||null;
function runtime(app) {
 if(!app.injectionRuntime){
  const saved=app.homey.settings.get(KEY);
  app.injectionRuntime={active:false,preparing:false,source:'',reason:String(saved?.reason||'Injectie niet actief'),
   latch:saved&&typeof saved==='object'?saved:null,pendingStop:Boolean(saved?.needsStop),loadGeneration:0,price:null,feed:null};
 }
 return app.injectionRuntime;
}
function locked(app) {return Boolean(app.injectionRuntime?.active||app.injectionRuntime?.preparing||app.injectionRuntime?.pendingStop);}
function currentDynamicSelection(app,s,now) {
 // Reuse the existing validated, normalized source selection. No source
 // analysis, price alignment or planning work is started by this reader.
 const snapshot=app.evDeadlinePriceSelection,selection=snapshot?.selection;
 const order=sourceOrder(s.dynamicPriceSource,s.dynamicPriceSources).filter(Boolean);
 if(!selection||selection.source==='none'||!order.includes(selection.source)
  ||JSON.stringify(order)!==JSON.stringify(selection.sourceOrder))return null;
 const chosen=selection.sources?.find(item=>item.source===selection.source);
 if(!chosen?.ready)return null;
 if(order.indexOf(selection.source)>0&&!validCalibration(chosen.calibration,Math.max(now,Number(snapshot.at)||0)))return null;
 const input=selection.source==='homey'?app.homeyEnergy:selection.source==='external2'?app.externalEnergy2:app.externalEnergy;
 if(!input?.slots?.length)return null;
 if(selection.source==='homey'&&(input.available===false||!Number(input.lastUpdatedAt)
  ||Math.max(0,now-Number(input.lastUpdatedAt))>20*60000))return null;
 return selection;
}
function currentDynamicImport(app,s,now) {
 const selection=currentDynamicSelection(app,s,now);
 if(!selection)return null;
 const timezone=app.homey?.clock?.getTimezone?.()||s.timezone||'UTC';
 const local=localParts(new Date(now),timezone),interval=Number(selection.analysis?.intervalMinutes);
 if(!(interval>0))return null;
 const row=selection.slots?.find(item=>item.dateKey===local.dateKey
  &&local.minuteOfDay>=Number(item.minute)&&local.minuteOfDay<Number(item.minute)+interval);
 return row&&finite(row.price)?Number(row.price):null;
}
function getEffectiveFeedInPrice(app,s,now=Date.now()) {
 const f=app.injectionRuntime?.feed,code=currency(s),cost=Number(s.injectionExportCost??0);
 if(!code)return null;
 // A supplied export price is already net. Its interval is always the
 // current quarter; after that the import-minus-cost rule applies again.
 if(f&&f.startAt<=now&&now<f.endAt)return f.currency===code?{...f}:null;
 if(!finite(s.injectionExportCost??0)||cost<0)return null;
 const startAt=Math.floor(now/900000)*900000;let endAt=startAt+900000,price=null,rate='';
 if(isDynamicContract(s))price=currentDynamicImport(app,s,now);
 else if(s.contractType==='tou'){
  const tariff=findCurrentTariff(new Date(now),s);price=tariff.price;rate=tariff.rateId||'';
  if(tariff.nextAt instanceof Date)endAt=Math.min(endAt,tariff.nextAt.getTime());
 }else if(s.contractType==='fixed')price=s.fixedImportPrice;
 if(!finite(price)||endAt<=now)return null;
 const comparisonPrice=Number(price);
 return {price:comparisonPrice-cost,comparisonPrice,cost,currency:code,startAt,endAt,
  key:`import:${s.contractType}:${rate}:${startAt}`,source:'import'};
}
function refreshPrice(app,s,now=Date.now()) {
 const r=runtime(app);r.price=getEffectiveFeedInPrice(app,s,now);return r.price;
}
function normalizeFeed({price,currency:code='EUR',unit='kWh',minutes=15},now=Date.now()) {
 if(!finite(price)||!['EUR','GBP','USD','CHF','SEK','NOK','DKK','PLN','CZK'].includes(code)
  ||!['kWh','cent/kWh','MWh'].includes(unit)||![15,60].includes(Number(minutes)))throw Error('Ongeldige terugleverprijs, valuta, eenheid of prijsinterval');
 const value=Number(price)/(unit==='cent/kWh'?100:unit==='MWh'?1000:1);
 if(!Number.isFinite(value)||Math.abs(value)>100)throw Error('Ongeldige terugleverprijs, valuta, eenheid of prijsinterval');
 const span=900000,startAt=Math.floor(now/span)*span;
 return {price:value,comparisonPrice:value,cost:0,currency:code,startAt,endAt:startAt+span,key:`feed:${startAt}:${span}`,source:'flow'};
}
function feed(app,args,now=Date.now()) {
 const value=normalizeFeed(args,now),r=runtime(app);r.feed=value;
 const s=app.getSettings();refreshPrice(app,s,now);
 rearmPriceStop(app,s,now);
 if(s.injectionEnabled||locked(app)) {tick(app,s,now,false);app.requestContextEvaluate(true,'injection_price');}
 return {...value};
}
function economicCondition(app,s,price,now=Date.now()) {
 // No curve scan, inventory read or memo is created while the option is off.
 const selection=s.injectionPriceDifferenceEnabled&&isDynamicContract(s)?currentDynamicSelection(app,s,now):null;
 return economics.evaluate(app,s,price,now,selection);
}
function reason(app,s,now=Date.now(),automatic=false) {
 const r=runtime(app);
 if(r.pendingStop)return 'Wachten op veilige injectiestop';
 if(!s.injectionEnabled)return 'Actieve injectie niet toegestaan';
 const p=refreshPrice(app,s,now);
 if(!currency(s)||r.feed&&r.feed.startAt<=now&&now<r.feed.endAt&&r.feed.currency!==currency(s))return 'Onbekende of afwijkende valuta';
 if(!finite(s.injectionMinimumPrice)||!finite(s.injectionTargetW)||Number(s.injectionTargetW)<=0
  ||!finite(s.injectionExportCost??0)||Number(s.injectionExportCost??0)<0
  ||!finite(s.injectionStopSoc)||Number(s.injectionStopSoc)<0||Number(s.injectionStopSoc)>100
  ||!economics.validSettings(s))return 'Ongeldige injectie-instellingen';
 if(!p||now<p.startAt||now>=p.endAt||p.currency!==currency(s))return 'Wachten op geldige actuele terugleverprijs';
 if(p.comparisonPrice<Number(s.injectionMinimumPrice))return 'Terugleverprijs onder minimum';
 if(s.exportLimitEnabled&&Number(s.minimumExportW)<=0)return 'Exportlimiet laat geen injectie toe';
 if(!s.controlEnabled||!app.isChargeTestValid(s)||app.getBatteryCount(s)<1)return 'Batterijsturing niet beschikbaar';
 const forced=String(s.forcedMode||'auto');
 if(!['auto','solar_capture','self_consumption','avoid_import'].includes(forced)
   ||(r.active||r.preparing)&&r.initialForcedMode!==forced)return 'Handmatige batterijmodus actief';
 if(app.chargeTestOperationRunning||app.chargeTestRunning||app.chargeTestAwaitingConfirmation||app.batteryResponseTest?.running||app.getBatteryCommandPauseInfo(now,s).active)return 'Batterijtest of stuurpauze actief';
 if(app.isHybridExternalControlActive(s)||app.hybridEmsRuntime?.takeover||['handover_wait','takeover_wait'].includes(String(app.hybridEmsRuntime?.status||'')))return 'Externe EMS of overdracht actief';
 if(!app.getGridFreshness(s,now).fresh)return 'Wachten op verse netmeting';
 if(!app.getInputReadiness(s).ready)return 'Wachten op geldige EMS-invoer';
 const count=app.getBatteryCount(s);
 for(let i=0;i<count;i++){
  const at=Number(app.inputUpdatedAt?.batterySoc?.[i]);
  if(!app.inputSeen.batterySoc[i]||!finite(app.state.batterySoc[i])||!(at>0)||now<at||now-at>600000)return 'Wachten op batterij-SoC';
 }
 const avg=computeAverageSoc(app.state,s),floor=Math.max(Number(s.injectionStopSoc),Number(s.safetySoc)||0,Number(s.minSoc)||0);
 if(avg===null||avg<=floor||automatic&&!r.active&&avg<floor+1)return 'Injectie beëindigd op SoC-grens';
 if(s.peakShaveEnabled&&Number(app.state.gridPowerW)>Math.max(0,Number(s.peakLimitW)-Math.max(0,Number(s.peakSoftMarginW)||0)))return 'Peak Guard heeft voorrang';
 return economicCondition(app,s,p,now).reason;
}
function latch(app,why,now) {
 const r=runtime(app),p=r.price;
 const value={key:p?.key||'',until:p?.endAt||(Math.floor(now/900000)+1)*900000,reason:why,
  needsStop:Boolean(r.active||r.preparing||r.pendingStop||r.latch?.needsStop)};
 if(JSON.stringify(r.latch)!==JSON.stringify(value)){r.latch=value;app.setSetting(KEY,value);}
}
function transition(app,active,why,source) {
 const r=runtime(app),wasActive=r.active;r.active=active;r.preparing=false;r.reason=why;r.source=source||r.source;
 r.loadGeneration=(Number(r.loadGeneration)||0)+1;
 app.batteryFeedbackMemo=null;app.lastFastControlSnapshot=null;
 require('./flow-output-keepalive').invalidate(app);
 if(active){r.latch={key:'',until:0,reason:'',...r.latch,needsStop:true};app.setSetting(KEY,r.latch);}
 app.markContextDirty?.('injection_transition');
 // Reuse the paired-device sync on transitions, not a new timer or listener.
 app.syncEmsDevices?.().catch(e=>app.error('EMS device sync after injection transition failed',e));
 const card=active?app.injectionStartedTrigger:app.injectionStoppedTrigger;
 if(card&&(active||wasActive))card.trigger(app.localizeDisplayTokens({reason:why,source:r.source}),{}).catch(e=>app.error('Injection transition Flow',e));
}
function stop(app,why='Injectie handmatig gestopt',block=true,now=Date.now()) {
 const r=runtime(app),was=r.active||r.preparing||r.pendingStop;
 if(!PRICE_STOPS.has(why)&&r.resumeAfterPriceStop)r.resumeAfterPriceStop=false;
 if(why==='Injectie handmatig gestopt')refreshPrice(app,app.getSettings(),now);
 if(block)latch(app,why,now);
 if(!was||r.pendingStop&&!r.active&&!r.preparing){r.reason=why;return status(app);}
 r.pendingStop=true;r.returningToControl=why==='Peak Guard heeft voorrang';
 transition(app,false,why);
 // Reuse the single battery publication mutex, including the existing safe
 // zero command. A queued/in-flight export must not survive a failed gate.
 if(!r.returningToControl)app.queueCommandEmit({...app.latestResult,injectionActive:false,injectionTargetW:0,canPublishCommands:false,controlEnabled:true,
   injectionStop:true,missingInputs:[],statusText:why});
 app.requestContextEvaluate(true,'injection_stopped');
 return status(app);
}
function rearmPriceStop(app,s,now) {
 const r=app.injectionRuntime,f=r?.feed;
 if(!s.injectionEnabled||!r?.latch||!PRICE_STOPS.has(r.latch.reason)
  ||!f||f.startAt>now||now>=f.endAt||f.currency!==currency(s)
  ||f.comparisonPrice<Number(s.injectionMinimumPrice)
  ||economicCondition(app,s,r.price,now).reason)return;
 // Only a new valid price can release a price-related hold. A physical stop
 // already in flight must still complete before automatic export resumes.
 r.latch={...r.latch,key:'',until:0,reason:'',needsStop:Boolean(r.pendingStop||r.latch.needsStop)};
 if(r.pendingStop)r.resumeAfterPriceStop=true;
 app.setSetting(KEY,r.latch);
}
function resumeAfterPriceStop(app) {
 const r=app.injectionRuntime;
 if(!r?.resumeAfterPriceStop)return;
 if(r.active||r.preparing){r.resumeAfterPriceStop=false;return;}
 if(r.pendingStop||app.commandPublishing||app.pendingResult)return;
 r.resumeAfterPriceStop=false;
 const s=app.getSettings();
 if(s.injectionEnabled&&s.injectionAutomaticEnabled)app.requestContextEvaluate(true,'injection_price_stop_completed');
}
function evStopped(app,s,now) {
 if(app.evPublishing)return false;
 for(let i=0;i<app.getEvCount(s);i++) {
  const stem='ev'+(i?i+1:'');if(!s[stem+'Enabled'])continue;
  const other=i?app.getExtraEv(i):null;if(other?.publishing)return false;
  const type=s[stem+'ControlType']||'current';
  if(i?other?.lastPublishedAllowed:app.lastPublishedEvAllowed)return false;
  if((type==='mode'||type==='hybrid')&&(i?other?.lastPublishedChargeMode:app.lastPublishedEvChargeMode)!=='stop')return false;
  if((type==='current'||type==='hybrid')&&Number(i?other?.lastPublishedCurrentA:app.lastPublishedEvCurrentA)!==0)return false;
  const seen=i?other?.seen:app.inputSeen.ev,current=i?other?.state.chargeCurrentA:app.state.evChargeCurrentA;
  // A real positive measurement remains authoritative after a STOP request.
  if(seen?.chargeCurrent&&Number(current)>0.1)return false;
 }
 return true;
}
async function start(app,source='manual') {
 const r=runtime(app),s=app.getSettings(),now=Date.now();refreshPrice(app,s,now);
 const why=reason(app,s,now,source==='automatic');if(why){r.reason=why;throw Error(why);}
 if(r.active||r.preparing){
  if(source==='manual'&&r.source==='automatic'){
   r.source='manual';app.markContextDirty?.('injection_manual_takeover');
   app.requestContextEvaluate(true,'injection_manual_takeover');
  }
  return status(app);
 }
 if(app.commandPublishing||app.evPublishing||[1,2,3].some(i=>app.getExtraEv(i)?.publishing))throw Error('Wachten op lopende publicatie');
 r.initialForcedMode=String(s.forcedMode||'auto');r.preparing=true;r.source=source;r.reason='Wachten tot beheerde EV’s gestopt zijn';
 if(source==='manual'&&r.latch){r.latch=null;app.setSetting(KEY,null);}
 app.batteryFeedbackMemo=null;
 try {
  // The physical output projection checks locked() too, including manual EV
  // tests and a later continuation of an existing asynchronous publication.
  app.forceEvOutput=true;
  for(let i=1;i<4;i++){const e=app.getExtraEv(i);if(e)e.forceOutput=true;}
  await app.publishEvPortfolioNow(app.latestResult,app.state.lastTotalCommandW,app.state.lastTotalCommandW,{evOnly:true});
  const gate=reason(app,app.getSettings(),Date.now(),r.source==='automatic');
  if(gate){stop(app,gate,true);throw Error(gate);}
  if(r.preparing&&evStopped(app,app.getSettings(),Date.now()))transition(app,true,'Actieve injectie',r.source);
  app.requestContextEvaluate(true,'injection_started');
 }catch(e){if(r.preparing)stop(app,'EV-stop niet bevestigd',true);throw e;}
 return status(app);
}
function tick(app,s,now=Date.now(),context=false) {
 if(!s.injectionEnabled&&!locked(app))return;
 const r=runtime(app);
 if(r.pendingStop&&!r.active&&!r.preparing){
  if(r.returningToControl)return;
  if(!app.commandPublishing&&app.commandTrigger)app.queueCommandEmit({...app.latestResult,injectionActive:false,canPublishCommands:false,injectionStop:true,controlEnabled:true,missingInputs:[]});
  return;
 }
 if(context)refreshPrice(app,s,now);
 if(locked(app)) {
  const why=r.source==='automatic'&&!s.injectionAutomaticEnabled?'Automatische injectie uitgeschakeld':reason(app,s,now,false);
  if(why){stop(app,why,true,now);return;}
  if(r.preparing&&context&&evStopped(app,s,now))transition(app,true,'Actieve injectie',r.source);
  if(r.active&&!evStopped(app,s,now)){stop(app,'EV-laadactiviteit tijdens injectie',true,now);return;}
 }else if(context&&s.injectionEnabled&&s.injectionAutomaticEnabled) {
  const why=reason(app,s,now,true);r.reason=why||r.reason;
  if(!why&&!(r.latch&&(r.latch.until>now||r.latch.key&&r.latch.key===r.price?.key)))
   start(app,'automatic').catch(e=>{r.reason=e.message;});
 }
}
function target(app,s) {
 let watts=Math.max(0,Number(s.injectionTargetW??defaults.injectionTargetW)||0);
 // The existing PV export limit is also a ceiling for intentional export.
 if(s.exportLimitEnabled)watts=Math.min(watts,Math.max(0,Number(s.minimumExportW)||0));
 return watts;
}
function engineState(app,s) {
 const r=app.injectionRuntime;
 return {injectionActive:Boolean(r?.active),injectionTargetW:r?.active?target(app,s):0,
  injectionStopSoc:Number(s.injectionStopSoc)||0};
}
function validPublication(app,result,s) {
 if(!result?.injectionActive)return !app.injectionRuntime?.active||result?.injectionStop||!result?.canPublishCommands;
 const r=app.injectionRuntime;
 if(!r?.active||reason(app,s,Date.now(),false)||!evStopped(app,s,Date.now()))return false;
 return Number(result.injectionTargetW)===target(app,s);
}
function limitLoads(app,s) {return Boolean(app.injectionRuntime?.active&&s.injectionLimitOptionalLoads);}
function status(app) {
 const s=app.getSettings(),r=app.injectionRuntime,now=Date.now(),lastReason=String(r?.latch?.reason||'');
 const p=s.injectionEnabled||r?.feed?getEffectiveFeedInPrice(app,s,now):r?.price;
 const economic=s.injectionEnabled?economicCondition(app,s,p,now):null;
 // Keep the saved request separate from the bounded control target. Status
 // reads must never rewrite settings or relax the existing export ceiling.
 const requestedTargetW=Math.max(0,Number(s.injectionTargetW??defaults.injectionTargetW)||0);
 const targetW=target(app,s),exportLimitW=s.exportLimitEnabled?Math.max(0,Number(s.minimumExportW)||0):null;
 return {economic,allowed:Boolean(s.injectionEnabled),automatic:Boolean(s.injectionAutomaticEnabled),active:Boolean(r?.active),
  state:r?.active?'active':r?.preparing||r?.pendingStop?'waiting':lastReason?(lastReason.includes('SoC')?'ended_soc':lastReason.includes('prijs')?'ended_price':lastReason.includes('handmatig')?'ended_manual':'blocked'):'inactive',source:r?.source||'',reason:r?.reason||'Injectie niet actief',
  price:p&&p.endAt>now?p.price:null,comparisonPrice:p?.comparisonPrice??null,
  priceSource:p?.source||'',exportCost:p?.cost??Number(s.injectionExportCost??0),
  currency:currency(s),minimumPrice:Number(s.injectionMinimumPrice??.7),
  requestedTargetW,targetW,exportLimitW,targetLimitedByExportLimit:exportLimitW!==null&&targetW<requestedTargetW,
  gridW:app.getGridFreshness(s,now).fresh?app.state.gridPowerW:null,
  soc:computeAverageSoc(app.state,s),stopSoc:Number(s.injectionStopSoc??40),priceValidUntil:p?.endAt||null};
}
function published(app,result) {
 const r=app.injectionRuntime;if(!r||(!result.injectionStop&&!(r.returningToControl&&!result.injectionActive)))return;
 r.pendingStop=false;r.returningToControl=false;
 if(r.latch?.needsStop){r.latch={...r.latch,needsStop:false};app.setSetting(KEY,r.latch);}
}
module.exports={economicCondition,target,published,defaults,runtime,locked,getEffectiveFeedInPrice,refreshPrice,normalizeFeed,feed,reason,start,stop,tick,resumeAfterPriceStop,engineState,validPublication,limitLoads,status,currency};
