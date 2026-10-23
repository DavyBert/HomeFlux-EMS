'use strict';
// Research-only instrumentation. No production hooks or permanent logging.
const path = require('node:path'), fs = require('node:fs'), Module = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const profile = process.argv[3] || 'soc-active', seconds = Number(process.argv[4] || 300);
const timed = process.env.EV_PLAN_TIMED === '1';
const clean = process.env.EV_PLAN_CLEAN === '1';
const m = { calls:{}, cpuMs:{}, byPhase:{}, calendar:{}, phase:'setup', stack:[], writes:{} };
function measure(name, fn, self, args) {
  m.calls[name]=(m.calls[name]||0)+1;
  const bucket=m.byPhase[m.phase]||=( {} ); bucket[name]=(bucket[name]||0)+1;
  const cpu=timed?process.cpuUsage():null;
  m.stack.push(name);
  try{return fn.apply(self,args);}finally{
    m.stack.pop();if(cpu){const d=process.cpuUsage(cpu);m.cpuMs[name]=(m.cpuMs[name]||0)+(d.user+d.system)/1000;}
  }
}
const extension=Module._extensions['.js'];
global.__evPlanProbe={m,measure};
Module._extensions['.js']=(mod,filename)=>{
  if(clean)return extension(mod,filename);
  if(filename!==path.join(root,'lib/flexible-loads.js'))return extension(mod,filename);
  let s=fs.readFileSync(filename,'utf8');
  for(const name of ['findNextLocalTime','countEvTariffMinutes','calculateEvDecision']){
    s=s.replace(`function ${name}(`,`function __probe_${name}(`);
    s+=`\nfunction ${name}(...args){return global.__evPlanProbe.measure('${name}',__probe_${name},null,args);}\n`;
  }
  s=s.replace('if (localParts(candidate, timezone).minuteOfDay === targetMinute)',
    'if ((__probeCalendarConversion(),localParts(candidate, timezone)).minuteOfDay === targetMinute)');
  s+=`\nfunction __probeCalendarConversion(){const p=global.__evPlanProbe.m;const caller=p.stack.at(-2)||'other';const k=p.phase+':'+caller;p.calendar[k]=(p.calendar[k]||0)+1;}\n`;
  mod._compile(s,filename);
};
const RealDate=Date;
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
const {fixture}=require('./ev-work-harness');
const {installVirtualClearTimeout}=require('./pv-source-harness');

(async()=>{
 const restore=installVirtualClearTimeout();
 try{
  const energy=profile.includes('energy'), soc=profile.includes('soc'), active=energy||soc;
  const connected=!profile.includes('disconnected'), charging=profile.includes('charging')||profile.includes('guarantee');
  const dynamic=profile.includes('dynamic');
  const extra=dynamic?{contractType:'dynamic_quarter',dynamicPriceSource:'external',dynamicPriceSources:['external'],
    evDynamicCheapEnabled:true,evDynamicNormalEnabled:false,evDynamicExpensiveEnabled:false,
    evDynamicCheapMaxGridImportW:40000,evDynamicNormalMaxGridImportW:40000,evDynamicExpensiveMaxGridImportW:40000}:{};
  const h=await fixture({root,type:profile.includes('mode')?'mode':'current',connected,chargeAllowed:charging,extra}),a=h.app;
  if(profile.includes('imminent')){
    h.setNow(h.now()+14*60000);
    await h.cards.get('set_ev1_soc').listener({soc:50});await h.drain();
  }
  if(dynamic){
    const date=a.getLocalDateKey(new Date(h.now()));
    const start=Date.parse(date+'T00:00:00Z')-2*3600000;
    const payload=Array.from({length:192},(_,i)=>({timestamp:start+i*15*60000,price:(profile.includes('imminent')?i%96===48:i%96>=48&&i%96<56)?.1:.4}));
    await h.cards.get('read_external_prices_json').listener({source:'external',curve:JSON.stringify(payload)});
    await h.drain();await h.start();await h.flush();
  }
  for(const name of clean?[]:['setEvSocPlan','setEvEnergyPlan','clearEvSocPlan','getEvInstanceSettings',
    'tickEvEnergyPlan','getEvGridImportControlStatus','getEvaluationState','getFastControlSnapshot',
    'evaluateContextNow','evaluateFastNow','calculateEvPortfolioDecisions','publishEvPortfolioNow',
    'getEvSocFreshness','requestContextEvaluate','setEvContextRefreshRequest','getPublicStatus']){
    const f=a[name];assert.equal(typeof f,'function',name);
    a[name]=function(...args){return measure(name,f,this,args);};
  }
  if(!clean){const setter=a.homey.settings.set;
    a.homey.settings.set=(key,v)=>{m.writes[key]=(m.writes[key]||0)+1;return setter(key,v);};}
  if(profile.includes('settings-events')){
    // Model Homey's asynchronous callbacks for changed persisted EV plans.
    // JSON comparison belongs only to this simulated device/event adapter.
    const setter=a.homey.settings.set;
    a.homey.settings.set=(key,value)=>{
      const emit=['evSocDeadlineOverrides','evEnergyDeadlineOverrides'].includes(key)
        && JSON.stringify(h.store.get(key))!==JSON.stringify(value);
      const result=setter(key,value);
      if(emit)Promise.resolve().then(()=>h.setExternalSetting(key,value)).catch(e=>h.errors.push(String(e)));
      return result;
    };
  }
  const card=energy?'set_ev1_energy_deadline':'set_ev1_soc_deadline';
  const targetTime=profile.includes('imminent')?'12:20':'07:00';
  const args=()=>energy?{energy:15,time:targetTime,guarantee:charging?'yes':'no'}:{target_soc:80,time:targetTime,guarantee:charging?'yes':'no'};
  if(active){await h.cards.get(card).listener(args());await h.drain();await h.flush();}
  if(profile.includes('soc-feedback'))await h.cards.get('set_ev1_soc').listener({soc:50});
  await h.grid(2500-a.state.lastTotalCommandW);await h.start();await h.flush();
  h.setNow(h.now()+10000);await h.flush();await h.grid(2500-a.state.lastTotalCommandW);await h.start();await h.flush();
  m.calls={};m.cpuMs={};m.byPhase={};m.calendar={};m.writes={};
  const counters={}, record=a.recordDiagnosticCounter,beforeCounters={...a.diagnostics.counters};
  if(!clean)a.recordDiagnosticCounter=function(k,n=1){counters[k]=(counters[k]||0)+n;return record.call(this,k,n);};
  const origin=h.now(),traceStart=h.traces.length,evStart=h.flexible.length,contexts=h.contexts.length;
  const snapshots=[];
  if(global.gc)global.gc();const heapStart=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),wall=performance.now();
  for(let n=1;n<=seconds;n++){
    h.setNow(origin+n*1000);
    if(profile.includes('repeat')&&(n%(profile.includes('50')?50:1)===0)){
      m.phase='target-input';await h.cards.get(card).listener(args());await h.drain();await h.flush();
    }
    if(profile.includes('soc-feedback')){m.phase='soc-feedback';await h.cards.get('set_ev1_soc').listener({soc:50});await h.flush();}
    if(profile.includes('change')&&[30,60,90].includes(n)){
      m.phase='target-change';const v=args();if(n===30){if(energy)v.energy=14;else v.target_soc=85;}if(n===60)v.time='08:00';if(n===90)v.guarantee='yes';
      await h.cards.get(card).listener(v);await h.drain();await h.flush();
    }
    const amps=connected&&a.lastPublishedEvAllowed?(profile.includes('mode')
      ?a.lastPublishedEvChargeMode==='standard'?16:a.lastPublishedEvChargeMode==='smart'?6:0
      :Number(a.lastPublishedEvCurrentA)||0):0;
    if(n%50===1||profile.includes('feedback1')){m.phase='status-input';await h.cards.get('set_ev1_status').listener({connected:connected?'yes':'no',charge_current:amps});await h.flush();}
    m.phase='p1';await h.grid(2500+amps*Math.sqrt(3)*400-a.state.lastTotalCommandW);await h.flush();
    if(n%60===0){m.phase='heartbeat';a.runContextHeartbeat();await a.runEvHeartbeat();await h.drain();await h.flush();}
    if(profile.includes('live')){m.phase='live-status';JSON.stringify(a.getPublicStatus());}
    if(n%30===0)snapshots.push({second:n,allowed:a.lastPublishedEvAllowed,current:a.lastPublishedEvCurrentA,
      mode:a.lastPublishedEvChargeMode,guaranteeActive:a.latestEvDecision?.guaranteeActive,
      battery:a.state.lastTotalCommandW,remaining:a.evEnergyPlans[0].remainingKwh,deadline:a.evSocPlans[0].deadlineAt});
  }
  m.phase='drain';await h.drain();await h.flush();
  const used=process.cpuUsage(cpu),wallMs=performance.now()-wall;
  if(global.gc)global.gc();
  assert.deepEqual(h.errors,[]);
  if(clean)for(const[k,v]of Object.entries(a.diagnostics.counters))counters[k]=v-(beforeCounters[k]||0);
  const output={profile,seconds,timed,clean,node:process.version,cpuMs:(used.user+used.system)/1000,wallMs,
    retainedHeapBytes:process.memoryUsage().heapUsed-heapStart,metrics:m,counters,
    contexts:h.contexts.length-contexts,battery:h.traces.slice(traceStart),ev:h.flexible.slice(evStart),snapshots,
    plan:{soc:a.evSocPlans[0],energy:a.evEnergyPlans[0]},errors:h.errors};
  if(process.env.EV_PLAN_OUTPUT)fs.writeFileSync(process.env.EV_PLAN_OUTPUT,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(output));
 }finally{restore();Module._extensions['.js']=extension;global.Date=RealDate;delete global.__evPlanProbe;}
})().catch(e=>{console.error(e);process.exitCode=1;});
