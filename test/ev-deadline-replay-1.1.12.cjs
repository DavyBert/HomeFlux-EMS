'use strict';
// Research runner: instruments the loaded module in memory; source is untouched.
const path = require('node:path'), fs = require('node:fs'), Module = require('node:module');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..')); process.argv[2] = root;
const scenario = process.argv[3] || 'flow', diagnostics = process.argv[4] !== 'off';
const type = process.argv[5] || 'current', interval = Number(process.argv[6]) || 7;
const metrics = { calls: 0, scans: 0, conversions: 0, cpuMs: 0, byCaller: {}, frames: [], caller: 'other' };
global.__deadlineProbe = metrics;
const extension = Module._extensions['.js'];
Module._extensions['.js'] = (mod, filename) => {
  if (filename !== path.join(root, 'lib/flexible-loads.js')) return extension(mod, filename);
  let source = fs.readFileSync(filename, 'utf8')
    .replace('function findNextLocalTime(', 'function measuredFindNextLocalTime(')
    .replace('if (localParts(candidate, timezone).minuteOfDay === targetMinute)',
      'if ((__deadlineConversion(), localParts(candidate, timezone)).minuteOfDay === targetMinute)')
    .replace('function calculateEvDecision(', 'function measuredCalculateEvDecision(');
  source += `
function __deadlineConversion() { const m=global.__deadlineProbe; m.conversions++; const f=m.frames[m.frames.length-1]; if(f&&!f.scanned){f.scanned=true;m.scans++;} }
function findNextLocalTime(...args) { const m=global.__deadlineProbe,at=process.cpuUsage(),f={scanned:false},caller=m.caller;
 m.calls++;m.frames.push(f);try{return measuredFindNextLocalTime(...args)}finally{m.frames.pop();const d=process.cpuUsage(at),cpu=(d.user+d.system)/1000;m.cpuMs+=cpu;const b=m.byCaller[caller]||={calls:0,scans:0,cpuMs:0};b.calls++;b.scans+=Number(f.scanned);b.cpuMs+=cpu;} }
function calculateEvDecision(...args){const m=global.__deadlineProbe,old=m.caller;m.caller='calculateEvDecision';try{return measuredCalculateEvDecision(...args)}finally{m.caller=old;} }
`;
  mod._compile(source, filename);
};
const NativeDate = Date;
// Freeze no-argument new Date() as well as Date.now() for cross-run trace equality.
global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [Date.now()])); } };
const { fixture, perAmpW } = require('./ev-battery-transition-1.1.9.test');
const { installVirtualClearTimeout } = require('./pv-source-harness');
(async () => { const restore = installVirtualClearTimeout(); try {
 const h = await fixture(type, interval, scenario === 'multi' ? 2 : 1, {
   forcedMode:'auto', contractType:'fixed', fixedChargeWindowStart:'11:00',fixedChargeWindowEnd:'17:00',
   evFixedMaxGridImportW:40000, peakShaveEnabled:scenario === 'safety', peakLimitW:25000,
 }); const a=h.app;
 a.diagnostics.options={cpu:diagnostics,planning:diagnostics,errors:true};
 const settings=a.getEvInstanceSettings.bind(a);
 a.getEvInstanceSettings=(...args)=>{const old=metrics.caller;metrics.caller='getEvInstanceSettings';try{return settings(...args)}finally{metrics.caller=old}};
 if(scenario!=='plain') {await h.cards.get('set_ev1_soc_deadline').listener({target_soc:80,time:'07:00',guarantee:'no'});await h.drain();await h.flush();}
 if(scenario==='multi'){await h.cards.get('set_ev2_soc_deadline').listener({target_soc:85,time:'08:00',guarantee:'no'});await h.drain();}
 const origin=h.now();const batteryStart=h.traces.length,evStart=h.flexible.length;
 metrics.calls=metrics.scans=metrics.conversions=metrics.cpuMs=0;metrics.byCaller={};
 const cpu=process.cpuUsage();const snapshots=[];
 for(let n=1;n<=300;n++){
  h.setNow(origin+n*1000);
  if(scenario==='transitions') {
   if(n===30)await h.cards.get('set_ev1_soc_deadline').listener({target_soc:85,time:'09:00',guarantee:'no'});
   if(n===60)await h.cards.get('clear_ev1_soc_deadline_override').listener({});
   if(n===90)await h.cards.get('set_ev1_energy_deadline').listener({energy:.01,time:'23:00',guarantee:'no'});
   if(n===150)await h.cards.get('end_ev1_charging_session').listener({});
  }
  if(scenario==='soc-stop'||scenario==='soc-continue'){
   if(n===20 && scenario==='soc-continue')await h.setExternalSetting('evAfterSocTarget','preferences');
   if(n===60)await h.cards.get('set_ev1_soc').listener({soc:80});
   if(n===150)await h.cards.get('end_ev1_charging_session').listener({});
  }
  if(n%10===1){
   let amps=n>150&&scenario!=='plain'&&scenario!=='flow'&&scenario!=='multi'?0:10;
   const connected=!(scenario==='transitions'&&n>=180&&n<210);
   await h.cards.get('set_ev1_status').listener({connected:connected?'yes':'no',charge_current:connected?amps:0});
   if(scenario==='multi')await h.cards.get('set_ev2_status').listener({connected:'yes',charge_current:5});
   await h.drain();
  }
  let pv=scenario==='safety'?(n<60?0:n<120?5000:n<180?200:0):0;
  if(scenario==='safety'&&[60,120,180].includes(n))await h.pv(pv);
  const input=a.getEvInputSnapshot(0),evW=(input.connected?Number(input.chargeCurrentA)||0:0)*perAmpW+(scenario==='multi'?5*perAmpW:0);
  await h.grid(623+evW-pv-a.state.lastTotalCommandW+(scenario==='safety'&&n>=210&&n<230?25000:0));
  await h.flush();
  if(n%60===0){a.runContextHeartbeat();await a.runEvHeartbeat();await h.drain();await h.flush();}
  if(n%30===0)snapshots.push({second:n,allowed:a.lastPublishedEvAllowed,mode:a.lastPublishedEvChargeMode,current:a.lastPublishedEvCurrentA,battery:a.state.lastTotalCommandW,ended:a.getEvSessionDetectionRuntime(0).endedLatched,deadline:a.evSocPlans[0]?.deadlineAt});
 }
 const used=process.cpuUsage(cpu);
 const clean=x=>x.map(t=>({...t,at:t.at-origin}));
 console.log(JSON.stringify({scenario,type,interval,diagnostics,cpuMs:(used.user+used.system)/1000,
  metrics:{calls:metrics.calls,scans:metrics.scans,hits:metrics.calls-metrics.scans,conversions:metrics.conversions,cpuMs:metrics.cpuMs,byCaller:metrics.byCaller},
  batteryTrace:clean(h.traces.slice(batteryStart)),evTrace:clean(h.flexible.slice(evStart)),snapshots,errors:h.errors}));
 } finally {restore();Module._extensions['.js']=extension;global.Date=NativeDate;delete global.__deadlineProbe;}
})().catch(e=>{console.error(e);process.exitCode=1});
