'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const manifest = require(path.join(ROOT, 'app.json'));
const { setup, installVirtualClearTimeout } = require(path.join(ROOT, 'test/pv-source-harness'));
const RealDate = Date;
const START = RealDate.parse(process.env.AUDIT_NIGHT ? '2026-10-22T00:00:00Z' : '2026-10-22T10:00:00Z');
class VirtualDate extends RealDate { constructor(...args) { super(...(args.length ? args : [VirtualDate.now()])); } }
global.Date = VirtualDate;
const restore = installVirtualClearTimeout();
const seconds = Number(process.env.AUDIT_SECONDS || 150), runs = Number(process.env.AUDIT_RUNS || 1);
const filter = process.env.AUDIT_FILTER ? new RegExp(process.env.AUDIT_FILTER) : null;
const list = manifest.flow.actions.filter(c => !filter || filter.test(c.id));
const numeric = JSON.stringify(Array.from({length:96},(_,i)=>Number((.2+(i%24)*.001).toFixed(3))));
const timestamped = JSON.stringify(Array.from({length:96},(_,i)=>({timestamp:START-10*3600000+i*900000,price:.2+(i%24)*.001})));
function selected(card, kind) {
 const arg=(card.args||[]).find(x=>x.name===kind);
 if (arg) return kind==='battery'?8:4;
 return Number((card.id.match(new RegExp(kind+'([1-4])_'))||[])[1])||null;
}
function family(card) {
 const id=card.id;
 if (/set_battery_soc/.test(id)) return `battery:${selected(card,'battery')}`;
 const ev=selected(card,'ev'), hvac=selected(card,'hvac');
 if (/^set_ev(?:[1-4])?_status(?:_|$)/.test(id)) return `ev_status:${ev}`;
 if (/^set_ev(?:[1-4])?_soc(?:_for|$)/.test(id)) return `ev_soc:${ev}`;
 for (const key of ['room_temperature','mode','setpoint','fan_speed','automatic_control'])
  if (new RegExp('^set_hvac(?:[1-4])?_'+key+'(?:_|$)').test(id)) return `hvac_${key}:${hvac}`;
 return id;
}
function kind(card) {
 const id=card.id;
 return /^(clear_|end_|get_|recalculate_|refresh_|set_forced_mode)/.test(id)||/_deadline|_session_override|_automatic_control/.test(id) ? 'opdracht' : 'meetinput';
}
function argsFor(card, controlType='current') {
 const args={};
 for (const arg of card.args||[]) {
  const name=arg.name;
  if (['ev','hvac','battery'].includes(name)) {
   const index=selected(card,name);
   args[name]=arg.type==='autocomplete'?{kind:name,id:String(index),name:`${name} ${index}`}:String(index);
  } else if(name==='source') args[name]=arg.type==='autocomplete'?{id:'external',name:'PBTH'}:'external';
  else if(name==='curve') args[name]=card.id==='set_external_electricity_price_curve'?timestamped:numeric;
  else if(name==='period') args[name]='this_day';
  else if(name==='soc')args[name]=50;
  else if(name==='energy')args[name]=card.id==='set_imported_energy_today'?3:card.id==='set_exported_energy_today'?1:1;
  else if(name==='power')args[name]=card.id==='set_grid_power'?700:0;
  else if(name==='today'||name==='tomorrow')args[name]=50;
  else if(name==='connected')args[name]='yes';
  else if(name==='charge_current')args[name]=10;
  else if(name==='temperature')args[name]=card.id==='set_hvac_outdoor_temperature'?12:22;
  else if(name==='mode')args[name]=card.id==='set_forced_mode'?'standby':card.id.includes('hvac')?'heat':'smart';
  else if(name==='setpoint')args[name]=21;
  else if(name==='speed')args[name]=30;
  else if(name==='enabled')args[name]='yes';
  else if(name==='price')args[name]=card.id==='set_external_export_price'?.03:.2;
  else if(name==='time')args[name]='12:30';
  else if(name==='target_soc')args[name]=55;
  else if(name==='guarantee')args[name]='no';
  else throw new Error('Unmapped argument '+card.id+'.'+name);
 }
 return args;
}
const cpuMs=mark=>{const c=process.cpuUsage(mark);return (c.user+c.system)/1000;};
async function replay(card, interval, controlType='current') {
 const targetFamily=family(card), targetEv=selected(card,'ev');
 const prices=/price|prices/.test(card.id);
 const overrides={batteryCount:8,totalCapacityKwh:43.2,forcedMode:'standby',peakShaveEnabled:false,exportLimitEnabled:false,
  evCount:4,hvacCount:4,boilerCount:1,boilerEnabled:true,boilerStartSoc:95,boilerStopSoc:90,
  contractType:prices?'dynamic_quarter':'fixed',fixedChargeWindowStart:'00:00',fixedChargeWindowEnd:'23:59',
  evFixedChargeWindowEnabled:true,evFixedMaxGridImportW:40000,dynamicPriceSources:['external'],
  dynamicPriceSource:'external',evDynamicCheapEnabled:true,evDynamicNormalEnabled:true,evDynamicExpensiveEnabled:true};
 for(let i=0;i<4;i++) {
  const ev=i?`ev${i+1}`:'ev', hvac=i?`hvac${i+1}`:'hvac';
  for(const [suffix,value] of Object.entries({Enabled:true,SocEnabled:true,ControlType:controlType,Mode:'smart',
   Phases:1,Voltage:230,VoltageReference:'phase',MinCurrentA:6,MaxCurrentA:16,StandardCurrentA:10,
   ModeStandardCurrentA:10,ModeSmartCurrentA:6,FixedChargeWindowEnabled:true,
   DynamicCheapEnabled:true,DynamicNormalEnabled:true,DynamicExpensiveEnabled:true,
   GuaranteeTarget:false,TargetSoc:80,PeakGuardBatteryAssistNormal:false,PeakGuardBatteryAssistEmergency:false,NightSurplusChargeEnabled:false})) overrides[ev+suffix]=value;
  overrides[hvac+'Enabled']=true;overrides[hvac+'AutomaticControlEnabled']=true;
 }
 if(process.env.AUDIT_BATTERY_ACTIVE) overrides.forcedMode='self_consumption';
 if(process.env.AUDIT_HYBRID) Object.assign(overrides,{hybridEmsEnabled:true,forcedMode:'self_consumption',lowForecastMode:'self_consumption',peakReserveEnabled:false});
 const h=await setup(ROOT,overrides,START,0), a=h.app;
 a.state.batterySoc=Array(8).fill(50);a.inputSeen.batterySoc=Array(8).fill(true);a.inputUpdatedAt.batterySoc=Array(8).fill(START);
 a.state.pvProducingDate=a.getLocalDateKey(new Date(START));a.state.pvSeenProducingToday=true;
 if(process.env.AUDIT_NIGHT){a.state.pvSeenProducingToday=false;a.state.pvProducingDate='';a.state.nightPlanningActive=true;a.state.nightPlanningStartedDate=a.getLocalDateKey(new Date(START-(process.env.AUDIT_NIGHT==='today'?86400000:0)));}
 a.diagnostics=a.createDiagnosticsRuntime();
 // Mock only external Homey I/O. The price retrieval/parser/control remain real.
 a.homeyApi={energy:{getElectricityPriceType:async()=> 'dynamic',getDynamicPricesElectricityZone:async()=> 'BE',
  getOptionElectricityPriceDynamicPreferredInterval:async()=>15,getDynamicElectricityPriceUserCosts:async()=>null,
  fetchDynamicElectricityPrices:async({date})=>Array.from({length:96},(_,i)=>({timestamp:RealDate.parse(date+'T00:00:00Z')+i*900000,price:.2+(i%24)*.001}))}};
 const background=[];
 function bg(id,args,key=id){background.push({id,args,key});}
 for(let i=1;i<=8;i++)bg('set_battery_soc',{battery:String(i),soc:50},'battery:'+i);
 bg('set_pv_power',{power:0});bg('set_forecast_remaining',{energy:1});bg('set_forecast_tomorrow',{energy:1});
 bg('set_sun_chance_forecast',{today:50,tomorrow:50});
 bg('set_hvac_outdoor_temperature',{temperature:12});
 for(let i=1;i<=4;i++) {
  bg(`set_ev${i}_status`,{connected:i===targetEv?'yes':'no',charge_current:i===targetEv?10:0},'ev_status:'+i);
  bg(`set_ev${i}_soc`,{soc:50},'ev_soc:'+i);
  for(const [field,args] of Object.entries({room_temperature:{temperature:22},mode:{mode:'heat'},setpoint:{setpoint:21},fan_speed:{speed:30}})) bg(`set_hvac${i}_${field}`,args,'hvac_'+field+':'+i);
 }
 const gridValue=()=>process.env.AUDIT_BATTERY_ACTIVE ? 700 + Array.from({length:4},(_,i)=>{const x=a.getEvInputSnapshot(i);return x?.connected?(Number(x.chargeCurrentA)||0)*230:0;}).reduce((s,v)=>s+v,0)-(Number(a.state.pvPowerW)||0)-(Number(a.state.lastTotalCommandW)||0) : 700;
 const targetArgs=argsFor(card,controlType);
 if(card.id==='set_grid_power')targetArgs.power=process.env.AUDIT_P1_ZERO?0:700;
 const invoke=async(id,args)=>{
  const handler=h.cards.get(id)?.listener;assert.equal(typeof handler,'function',id+' not registered');
  const value=await handler(args);assert.notEqual(value,false,id+' rejected valid input');return value;
 };
 for(const input of background) await invoke(input.id,input.args);
 if(prices)await invoke('read_external_prices_json',{source:'external',period:'this_day',curve:numeric});
 await invoke(card.id,targetArgs);
 if(process.env.AUDIT_BATTERY_ACTIVE||process.env.AUDIT_HYBRID){h.store.set('_chargeTestSignature',a.getChargeTestSignature(a.getSettings()));await h.setExternalSetting('controlEnabled',true);assert(a.getSettings().controlEnabled&&a.isChargeTestValid());}
 await h.grid(gridValue());await h.start();await h.flush();
 h.setNow(START+10000);await h.flush();await h.grid(gridValue());await h.start();await h.flush();
 if(process.env.AUDIT_HYBRID) assert(a.hybridEmsRuntime.delegated,'Hybrid profile must actually delegate');
 const origin=h.now();
 let active=false, targetCalls=0, handlerCpu=0, handlerWall=0, writes=0, triggers=0, noOpReturns=0;
 const counters={},requests={},functionCalls={};
 const initialNightSamples=a.nightForecastMedian?.samples?.length||0;
 const record=a.recordDiagnosticCounter.bind(a);a.recordDiagnosticCounter=(name,amount=1)=>{if(active)counters[name]=(counters[name]||0)+amount;return record(name,amount);};
 const request=a.requestContextEvaluate.bind(a);a.requestContextEvaluate=(...args)=>{if(active)requests[args[1]]=(requests[args[1]]||0)+1;return request(...args);};
 const set=a.homey.settings.set;a.homey.settings.set=(k,v)=>{if(active)writes++;return set(k,v);};
 for(const name of ['getEvInstanceSettings','getRuntimeSettings','readExternalPrices']){const f=a[name].bind(a);a[name]=(...args)=>{if(active)functionCalls[name]=(functionCalls[name]||0)+1;return f(...args);};}
 for(const item of h.cards.values()){const trigger=item.trigger;item.trigger=async(...args)=>{if(active)triggers++;return trigger(...args);};}
 assert.deepEqual(h.errors,[],card.id+' setup errors');
 if(process.env.MONITOR_ON) a.startInputMonitor();
 active=true;const cpuStart=process.cpuUsage(),wallStart=performance.now();
 for(let second=1;second<=seconds;second++) {
  h.setNow(origin+second*1000);
  if((second-1)%interval===0) {
   const cpu=process.cpuUsage(), wall=performance.now();
   const p=h.cards.get(card.id).listener(targetArgs);
   handlerCpu+=cpuMs(cpu);handlerWall+=performance.now()-wall;
   const value=await p;if(value===false && /^end_ev/.test(card.id)){assert(a.getEvSessionDetectionRuntime(targetEv-1)?.endedLatched);noOpReturns++;}else assert.notEqual(value,false,card.id+' rejected repeat');targetCalls++;
  }
  if((second-1)%50===0) for(const input of background) if(input.key!==targetFamily)await invoke(input.id,input.args);
  if(card.id!=='set_grid_power')await h.grid(gridValue());
  if(second%60===0){a.runContextHeartbeat();await a.runEvHeartbeat();await h.drain();}
  await h.flush();
 }
 await h.drain();active=false;
 const used=cpuMs(cpuStart),wall=performance.now()-wallStart;
 assert.deepEqual(h.errors,[],card.id+' runtime errors');
 if(card.id.includes('curve')||/^read_external_prices/.test(card.id))assert(a.externalEnergy.slots.length>=96,'price import actually used');
 return {id:card.id,testArguments:targetArgs,title:card.title?.nl,kind:kind(card),controlType,interval,seconds,targetCalls,cpuMs:used,wallMs:wall,
  nightProfile:process.env.AUDIT_NIGHT||null,batteryActiveProfile:Boolean(process.env.AUDIT_BATTERY_ACTIVE),hybridProfile:Boolean(process.env.AUDIT_HYBRID),nightSamplesAdded:(a.nightForecastMedian?.samples?.length||0)-initialNightSamples,handlerSyncCpuMs:handlerCpu,handlerSyncWallMs:handlerWall,noOpReturns,settingsWrites:writes,flowTriggers:triggers,
  monitor:process.env.MONITOR_ON?a.stopInputMonitor():null,contextRequests:Object.values(requests).reduce((s,v)=>s+v,0),requestReasons:requests,counters,functionCalls,
  final:{controlEnabled:Boolean(a.getSettings().controlEnabled),chargeTestValid:a.isChargeTestValid(),batteryW:a.state.lastTotalCommandW,EV:a.latestEvDecision?.desiredCurrentA,gridFresh:a.getGridFreshness().fresh,hybridDelegated:Boolean(a.hybridEmsRuntime?.delegated)},errors:h.errors.length};
}
(async()=>{try {
 const result={version:manifest.version,node:process.version,seconds,runs,profile:'8 batteries, 4 EVs, 4 HVACs configured; fixed tariff (dynamic quarter for price cards), battery standby, constant P1 at 1s except P1 target. Other telemetry at 50s. All control/handlers/schedulers real; Homey I/O and clock simulated.',results:[]};
 for(let run=0;run<runs;run++) {
  for(let i=0;i<list.length;i++) {
   const card=list[(i+run*13)%list.length];
   for(const interval of run%2?[1,50]:[50,1])result.results.push({run:run+1,...await replay(card,interval,process.env.AUDIT_EV_CONTROL_TYPE || 'current')});
   if((i+1)%10===0){process.stderr.write(`run ${run+1}: ${i+1}/${list.length} cards\n`);fs.writeFileSync(process.env.AUDIT_OUTPUT||path.join(__dirname,'results.json'),JSON.stringify(result,null,2)+'\n');}
  }
 }
 const out=process.env.AUDIT_OUTPUT||path.join(__dirname,'results.json');fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({output:out,cards:list.length,cases:result.results.length,allPassed:true}));
} finally {global.Date=RealDate;restore();}})().catch(e=>{console.error(e);process.exitCode=1;});
