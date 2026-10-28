'use strict';
const {createRequire}=require('node:module'),{performance}=require('node:perf_hooks');
const path=require('node:path');
const root=path.resolve(process.argv[2]),req=createRequire(path.join(root,'package.json'));
const OriginalDate=Date;
global.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[Date.now()]));}static now(){return OriginalDate.now();}};
const {fixture}=req('./test/ev-work-harness');
const {installVirtualClearTimeout}=req('./test/pv-source-harness');
const restore=installVirtualClearTimeout();
(async()=>{
 const h=await fixture({evs:2,batteries:0,batteryEnabled:false,chargeAllowed:true,type:'amps',pv:3500});
 const a=h.app,snapshots=[];
 for(const [id,kind,value,time,g]of [[1,'soc',80,'07:00','no'],[2,'energy',10,'17:00','yes'],[1,'soc',90,'12:00','yes'],[2,'energy',5,'07:00','no'],[1,'soc',101,'25:00','no']]){
  const accepted=await h.cards.get(`set_ev${id}_${kind}_deadline`).listener({[kind==='soc'?'target_soc':'energy']:value,time,guarantee:g});
  await h.start();await h.flush();
  snapshots.push({accepted,soc:a.evSocPlans,energy:a.evEnergyPlans,decisions:[a.latestEvDecision,a.getExtraEv(1)?.latestDecision]});
  snapshots[snapshots.length-1]=structuredClone(snapshots.at(-1));
 }
 for(const [name,args]of [['set_ev_soc_deadline_for',{ev:'1',target_soc:85,time:'17:00',guarantee:'yes'}],
   ['set_ev_energy_deadline_for_configured',{ev:{id:'2',kind:'ev',name:'EV 2'},energy:15,time:'07:00',guarantee:'no'}]]){
  const accepted=await h.cards.get(name).listener(args);await h.start();await h.flush();
  snapshots.push(structuredClone({accepted,soc:a.evSocPlans,energy:a.evEnergyPlans,decisions:[a.latestEvDecision,a.getExtraEv(1)?.latestDecision]}));
 }
 await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:10});
 await h.cards.get('set_ev2_status').listener({connected:'yes',charge_current:8});
 await h.grid(13000);await h.start();await h.flush();
 // Warm both implementations equally; measure steady-state accounting rather
 // than attributing different JIT compilation points to Homey device CPU.
 for(let i=0;i<1000;i++){h.setNow(h.now()+1);await h.grid(13000+i%2);await h.flush();}
 await h.cards.get('set_ev1_status').listener({connected:'yes',charge_current:10});
 await h.cards.get('set_ev2_status').listener({connected:'yes',charge_current:8});
 await h.start();await h.flush();
 if(global.gc)global.gc();const heap=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),start=performance.now();
 const before=h.contexts.length,writes=h.flexible.length;
 for(let i=0;i<600;i++){h.setNow(h.now()+100);await h.grid(13000+i%2);await h.flush();}
 const elapsed=performance.now()-start,used=process.cpuUsage(cpu);if(global.gc)global.gc();
 const keys=['gridInputs','fastEvaluations','contextEvaluations','planningCalculations','widgetEnergyBudgetCalculations'];
 const counts=Object.fromEntries(keys.map(k=>[k,a.diagnostics?.counters?.[k]||0]));
 console.log(JSON.stringify({snapshots,metrics:{iterations:600,warmupInputs:1000,positiveCurrentFeedbackA:[10,8],elapsedMs:elapsed,cpuMs:(used.user+used.system)/1000,
  retainedHeapDeltaBytes:global.gc?process.memoryUsage().heapUsed-heap:null,
  extraContexts:h.contexts.length-before,extraFlexibleWrites:h.flexible.length-writes,counts}}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(restore);
