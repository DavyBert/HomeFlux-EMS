'use strict';
// Optional, user-initiated diagnostic. Raw P1 events drive the bounded state
// machine; there is no polling loop and no timer while the test is inactive.
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const maxCharge=(s,i)=>Math.max(0,s.individualBatteryPowerLimitsEnabled?finite(s[`battery${i+1}MaxChargeW`],Math.max(0,finite(s.maxChargePerBatteryW,2300))):finite(s.maxChargePerBatteryW,2300));
const KEY='_batteryResponseTest', WATTS=400, TOLERANCE=40, PHASE_TIMEOUT=60000;
const median=xs=>{const a=xs.slice().sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:null;};
const active=app=>Boolean(app.batteryResponseTest?.running);
function runtime(app){
 if(!app.batteryResponseTest){const saved=app.homey.settings.get(KEY)||{};app.batteryResponseTest={running:false,stage:'idle',lastResult:saved.lastResult||null,message:saved.message||'',completed:0};}
 return app.batteryResponseTest;
}
const guidance=require('../settings/battery-response-guidance');
function status(app,settings=app.getSettings()){
 const r=runtime(app);
 return {running:r.running,stage:r.stage,completed:r.completed||0,total:5,message:r.message||'',lastResult:r.lastResult||null,guidance:guidance(r.lastResult,settings)};
}
function persist(app,r){app.homey.settings.set(KEY,{running:r.running,stage:r.stage,count:r.count||0,signature:r.signature||'',lastResult:r.lastResult||null,message:r.message||''});}
function clearWatch(r){if(r.timer){clearTimeout(r.timer);r.timer=null;}}
function watch(app,r){
 clearWatch(r);
 const remaining=Math.min(PHASE_TIMEOUT,r.startedAt+600000-Date.now());
 r.phaseDeadline=Date.now()+remaining;
 r.timer=app.homey.setTimeout(()=>{r.timer=null;stop(app,'Geen betrouwbare reactie binnen de testtijd.').catch(error=>app.error('Battery response timeout',error));},Math.max(1,remaining));
}
function fingerprint(app){
 const first=[app.lastPublishedHvacPower,app.lastPublishedHvacMode,app.lastPublishedHvacSetpoint,app.lastPublishedHvacFanAction,app.lastPublishedHvacFanSpeed];
 return JSON.stringify([first,(app.extraHvacInstances||[]).map(x=>[x.lastPublishedPower,x.lastPublishedMode,x.lastPublishedSetpoint,x.lastPublishedFanAction,x.lastPublishedFanSpeed]),app.boilerState?.outputOn,app.lastPublishedPvLimitPercent]);
}
function unsafe(app,s,r=null){
 if(app.chargeTestRunning)return 'De bestaande batterijtest is actief.';
 if(!s.controlEnabled||!app.isChargeTestValid(s))return 'Schakel EMS-uitvoer in na een geslaagde bestaande batterijtest.';
 if(s.hybridEmsEnabled||app.isHybridExternalControlActive(s))return 'Schakel Hybrid EMS uit voordat je de reactietest start.';
 if(app.getBatteryCommandPauseInfo(Date.now(),s).active)return 'De batterijpauze is actief.';
 if(!app.getGridFreshness(s,Date.now()).fresh)return 'Een actuele P1-meting is nodig.';
 if(r&&r.commands&&r.commands.some((v,i)=>v<0&&(-v>maxCharge(s,i)||Number(app.state.batterySoc[i])>=Math.min(100,Number(s.maxSoc)||100))))return 'De batterij kan het testvermogen niet meer veilig opnemen.';
 if(r&&r.commands&&-r.commands.reduce((a,b)=>a+b,0)>Number(s.maxTotalChargeW))return 'Het toegestane laadvermogen is gewijzigd.';
 if(r&&app.getChargeTestSignature(s)!==r.signature)return 'De batterijconfiguratie is gewijzigd.';
 for(let i=0;i<app.getEvCount(s);i++){
  const input=app.getEvInputSnapshot(i),decision=i?app.getExtraEv(i)?.latestDecision:app.latestEvDecision;
  if(Number(input?.chargeCurrentA)>0||Number(decision?.currentA)>0||decision?.allowed||['smart','standard'].includes(String(i?app.getExtraEv(i)?.lastPublishedChargeMode:app.lastPublishedEvChargeMode)))return 'Stop het EV-laden voordat je de reactietest start.';
 }
 const peak=Math.max(0,Number(s.peakLimitW)||0),grid=Number(app.state.gridPowerW);
 if(peak>0&&grid>=peak)return 'Peak Guard onderbreekt de reactietest.';
 if(r&&fingerprint(app)!==r.loadFingerprint)return 'HVAC, boiler of PV-sturing is gewijzigd tijdens de test.';
 if(r&&Math.abs(Number(app.state.pvPowerW)-r.pvAtStart)>TOLERANCE)return 'Het PV-vermogen is niet stabiel genoeg voor een betrouwbare meting.';
 return '';
}
function lowCommands(app,s,count=app.getBatteryCount(s)){
 return Array.from({length:count},(_,i)=>{const c=app.getSplitBatteryConfig(i,s);return c.enabled?-Math.max(100,c.minimumPowerW):0;});
}
function allocation(app,s){
 const count=app.getBatteryCount(s),limits=[],low=lowCommands(app,s);const lowTotal=-low.reduce((a,b)=>a+b,0);
 for(let i=0;i<count;i++){
  const soc=app.state.batterySoc[i];
  if(!app.inputSeen.batterySoc[i]||soc===null||!Number.isFinite(Number(soc)))throw new Error('Een geldige SoC van elke batterij is nodig.');
  if(Number(soc)<Math.max(Number(s.minSoc)||0,Number(s.safetySoc)||0))throw new Error('Herstel eerst de veiligheidsreserve van de batterij.');
  limits.push(Number(soc)>=Math.min(100,Number(s.maxSoc)||100)-0.5?0:Math.floor(maxCharge(s,i)));
 }
 if(!count||low.some((v,i)=>-v>limits[i])||Number(s.maxTotalChargeW)<lowTotal+WATTS||limits.reduce((n,x)=>n+x,0)<lowTotal+WATTS)throw new Error('Er is onvoldoende veilig laadvermogen voor de reactietest van 400 W.');
 const commands=low.slice();let left=WATTS;
 for(let pass=0;pass<WATTS&&left;pass++)for(let i=0;i<count&&left;i++)if(-commands[i]<limits[i]){commands[i]--;left--;}
 return {commands,low};
}
async function publish(app,r,commands){
 if(app.commandPublishing)throw new Error('Er wordt momenteel al een batterijcommando gepubliceerd.');
 const s=r.settings,count=r.count,values=commands.map(x=>app.toPublishedCommand(x,s));
 app.commandPublishing=true;let first=null;
 try{
  for(let i=0;i<count;i++)try{await app.tokens.get(`battery${i+1}command`)?.setValue(values[i]);}catch(e){first||=e;}
  try{await app.tokens.get('emstotalcommand')?.setValue(values.reduce((a,b)=>a+b,0));}catch(e){first||=e;}
  const tokens={battery_count:count,total_command:values.reduce((a,b)=>a+b,0),mode:'Reactietest batterij',override:'',status:'Reactietest batterij',next_change:''};
  for(let i=0;i<8;i++)tokens[`battery${i+1}command`]=values[i]||0;
  try{await app.commandTrigger.trigger(app.localizeDisplayTokens(tokens),{mode:'battery_response_test',override:''});}catch(e){first||=e;}
  // Explicit manual diagnostic, using the existing Split publication surface.
  // Do not change any saved Split settings or the existing direction test.
  try{await app.publishSplitBatteryCommands(commands,s,{bypassSwitchLock:true});}catch(e){first||=e;}
  if(first)throw first;
  app.recordSavingsSample(Date.now());
  app.lastEmittedCommands=commands.slice();app.state.lastTotalCommandW=commands.reduce((a,b)=>a+b,0);
  app.lastEmitAt=Date.now();app.nextCommandAllowedAt=app.lastEmitAt+Math.max(1,Number(app.getSettings().commandIntervalSeconds)||7)*1000;
 }finally{app.commandPublishing=false;}
}
async function send(app,r,commands,stage){
 if(r.stopping)return;
 r.stage=stage;r.commandAt=Date.now();r.busy=true;watch(app,r);
 const operation=publish(app,r,commands);r.operation=operation;
 try{await operation;}finally{r.busy=false;if(r.operation===operation)r.operation=null;}
}
async function start(app){
 const old=runtime(app),s=app.getSettings();
 if(old.running)throw new Error('De reactietest is al actief.');
 const reason=unsafe(app,s);if(reason)throw new Error(reason);
 if(app.commandPublishing)throw new Error('Wacht tot het huidige batterijcommando is gepubliceerd.');
 const {commands,low}=allocation(app,s),peak=Number(s.peakLimitW)||0;
 const zeroGrid=Number(app.state.gridPowerW)+Number(app.state.lastTotalCommandW||0);
 if(peak>0&&Math.max(zeroGrid-low.reduce((a,b)=>a+b,0),Number(app.state.gridPowerW))+WATTS+Math.max(100,Number(s.peakSoftMarginW)||0)>peak)throw new Error('Er is onvoldoende Peak Guard-marge voor 0 W en 400 W laden.');
 const r={running:true,stage:'baseline',startedAt:Date.now(),count:commands.length,settings:{...s},signature:app.getChargeTestSignature(s),
  commands,low,completed:0,rises:[],falls:[],gaps:[],lastAt:0,window:[],lastResult:old.lastResult||null,message:'',pvAtStart:Number(app.state.pvPowerW)||0,loadFingerprint:fingerprint(app)};
 app.batteryResponseTest=r;app.pendingResult=null;app.pendingCommandBypassInterval=false;
 persist(app,r);
 try{await send(app,r,(r.low||lowCommands(app,r.settings,r.count)),'baseline');}catch(e){await stop(app,'Het testcommando kon niet veilig worden gepubliceerd.');throw e;}
 return status(app);
}
async function stop(app,message='Reactietest gestopt.',completed=false,resume=true){
 const r=runtime(app);if(r.kind==='phase')return require('./phase-detection').stop(app,message,resume);if(!r.running)return status(app);
 if(r.stopping)return r.stopping;
 clearWatch(r);r.message=message;r.stage='stopping';
 const operation=Promise.resolve().then(async()=>{
  if(r.operation)try{await r.operation;}catch(_){}
  let zeroOkay=true;
  try{if(!completed||r.falls?.length!==5||app.lastEmittedCommands?.some((x,i)=>x!==(r.low?.[i]||0)))await publish(app,r,(r.low||lowCommands(app,r.settings,r.count)));}catch(e){zeroOkay=false;app.error('Battery response zero command failed',e);r.message='Het terugkeercommando is niet bevestigd. Controleer de batterij en de Flow.';}
  r.running=false;r.stage=completed&&zeroOkay?'completed':'stopped';
  if(completed&&zeroOkay)r.lastResult={measuredAt:Date.now(),cycles:5,watts:WATTS,baselineWatts:-(r.low||[]).reduce((a,b)=>a+b,0),actions:10,responseMs:[...r.rises,...r.falls].reduce((a,b)=>a+b,0)/10,maxResponseMs:Math.max(...r.rises,...r.falls),riseMs:r.rises.slice(),fallMs:r.falls.slice(),cadenceMs:median(r.gaps)||1000};
  persist(app,r);r.stopping=null;
  if(message==='Peak Guard onderbreekt de reactietest.'){app.lastEmitAt=0;app.nextCommandAllowedAt=0;}
  if(resume)app.requestContextEvaluate(true,'battery_response_test_finished');
  return status(app);
 });r.stopping=operation;return operation;
}
async function observe(app,now=Date.now(),settings=app.getSettings()){
 const r=app.batteryResponseTest;if(r?.kind==='phase')return require('./phase-detection').observe(app,now,settings);if(!r?.running||r.stopping)return;
 if(now>=r.phaseDeadline)return stop(app,'Geen betrouwbare reactie binnen de testtijd.');
 const reason=unsafe(app,settings,r);if(reason)return stop(app,reason);
 if(r.lastAt&&now>r.lastAt){r.gaps.push(now-r.lastAt);if(r.gaps.length>100)r.gaps.shift();}else if(r.lastAt)return;
 r.lastAt=now;if(r.busy)return;
 const grid=Number(app.state.gridPowerW);
 if(r.stage==='baseline'){
  // A 300 W fall confirms the timed response, but the remaining power may
  // still be settling. Start the next pulse only at the original zero baseline.
  // Waiting here does not contribute to either measured command reaction.
  if(r.reference!==undefined&&Math.abs(grid-r.reference)>TOLERANCE){
   r.window=[];r.stableSince=now;return;
  }
  if(!r.window.length||Math.max(r.stableMax,grid)-Math.min(r.stableMin,grid)>TOLERANCE){
   r.window=[{at:now,value:grid}];r.stableSince=now;r.stableMin=grid;r.stableMax=grid;
  }else{
   r.window.push({at:now,value:grid});if(r.window.length>8)r.window.shift();
   r.stableMin=Math.min(r.stableMin,grid);r.stableMax=Math.max(r.stableMax,grid);
  }
  if(r.window.length<4||now-r.stableSince<3000)return;
  const values=r.window.map(x=>x.value);
  const baseline=median(values);
  if(r.reference!==undefined&&Math.abs(baseline-r.reference)>TOLERANCE)return stop(app,'Het huisverbruik is veranderd. De meting is niet betrouwbaar.');
  r.reference??=baseline;r.baseline=baseline;
  const peak=Number(settings.peakLimitW)||0;
  if(peak>0&&baseline+WATTS+Math.max(100,Number(settings.peakSoftMarginW)||0)>peak)return stop(app,'Er is onvoldoende Peak Guard-marge voor 0 W en 400 W laden.');
  try{await send(app,r,r.commands,'rising');}catch(e){await stop(app,'Het testcommando kon niet veilig worden gepubliceerd.');}
 }else{
  const delta=grid-r.baseline;
  if(delta>WATTS+2*TOLERANCE||delta< -2*TOLERANCE)return stop(app,'Het huisverbruik is veranderd. De meting is niet betrouwbaar.');
  if(r.stage==='rising'&&Math.abs(delta-WATTS)<=TOLERANCE){
   r.rises.push(Math.max(0,now-r.commandAt));r.chargedGrid=grid;
   try{await send(app,r,(r.low||lowCommands(app,r.settings,r.count)),'falling');}catch(e){await stop(app,'Het testcommando kon niet veilig worden gepubliceerd.');}
  }else if(r.stage==='falling'&&r.chargedGrid-grid>=300){
   r.falls.push(Math.max(0,now-r.commandAt));r.completed++;
   if(r.completed===5)return stop(app,'Reactietest voltooid.',true);
   r.stage='baseline';r.window=[{at:now,value:grid}];r.stableSince=now;r.stableMin=grid;r.stableMax=grid;watch(app,r);
  }
 }
}
async function restore(app){
 const saved=app.homey.settings.get(KEY)||{};runtime(app);
 if(saved.running){
  const s=app.getSettings(),count=Math.max(app.getBatteryCount(s),Math.min(8,Number(saved.count)||0));
  const r=app.batteryResponseTest;Object.assign(r,{running:true,count,settings:{...s,batteryCount:count},startedAt:Date.now()});
  await stop(app,'Reactietest afgebroken door een herstart.',false,false);
 }
}
module.exports={active,start,stop,observe,restore,status,guidance,tools:{unsafe,publish,lowCommands,fingerprint,persist}};
