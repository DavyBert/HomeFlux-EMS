'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {setup,tick,at,cleanup}=require('./ev-deadline-integration-1.1.17.test');
const beforeRoot=path.resolve(process.argv[2]);
const afterRoot=path.join(__dirname,'..');
async function run(root){
 const h=await setup({root,begin:at('2026-10-23','23:58'),kind:'continuous'}),a=h.app;
 let scans=0,fastBuilds=0;const phases={};
 const originalDecision=a.measureEvPlanningDecision;
 a.measureEvPlanningDecision=function(i,origin,input){return originalDecision.call(this,i,origin,{...input,observeTariffScan:f=>{scans++;return f();}});};
 for(const name of ['evaluateFastNow','evaluateContextNow','calculateEvPortfolioDecisions']){
  const original=a[name];phases[name]={calls:0,cpuMs:0};
  a[name]=function(...args){const c=process.cpuUsage(),before=a.evDeadlinePlanner?.builds||0;try{return original.apply(this,args);}finally{const use=process.cpuUsage(c);phases[name].calls++;phases[name].cpuMs+=(use.user+use.system)/1000;if(name==='evaluateFastNow')fastBuilds+=(a.evDeadlinePlanner?.builds||0)-before;}};
 }
 const n=k=>a.diagnostics?.counters?.[k]||0;
 const before={builds:n('evDeadlinePlanBuilds'),physical:n('evPhysicalConfigCacheHits'),settings:n('evInstanceSettingsBuilds')};
 const begin=h.now(),cpu=process.cpuUsage(),wall=performance.now(),outputs=h.flexible.length;
 for(let s=1;s<=180;s++)await tick(h,begin+s*1000);
 const use=process.cpuUsage(cpu);
 assert.equal(a.lastPublishedEvCurrentA,20);assert.deepEqual(h.errors,[]);assert.equal(fastBuilds,0);
 return {root,seconds:180,cpuMs:(use.user+use.system)/1000,wallMs:performance.now()-wall,phases,
  tariffScans:scans,deadlinePlanBuilds:n('evDeadlinePlanBuilds')-before.builds,fastPathPlanBuilds:fastBuilds,
  physicalConfigHits:n('evPhysicalConfigCacheHits')-before.physical,settingsBuilds:n('evInstanceSettingsBuilds')-before.settings,
  publications:h.flexible.slice(outputs)};
}
(async()=>{try{
 const results=[];for(let i=0;i<3;i++){
  const roots=i%2?[afterRoot,beforeRoot]:[beforeRoot,afterRoot];
  for(const root of roots)results.push({variant:root===beforeRoot?'1.1.16':'1.1.17',run:i+1,...await run(root)});
 }
 const median=list=>list.sort((a,b)=>a-b)[Math.floor(list.length/2)];
 const summary={};for(const variant of ['1.1.16','1.1.17']){
  const group=results.filter(x=>x.variant===variant);summary[variant]={medianCpuMs:median(group.map(x=>x.cpuMs)),
   medianFastCpuMs:median(group.map(x=>x.phases.evaluateFastNow.cpuMs)),medianPortfolioCpuMs:median(group.map(x=>x.phases.calculateEvPortfolioDecisions.cpuMs)),
   portfolioCalls:group.map(x=>x.phases.calculateEvPortfolioDecisions.calls),tariffScans:group.map(x=>x.tariffScans),
   planBuildsDuringReplay:group.map(x=>x.deadlinePlanBuilds),fastPathPlanBuilds:group.map(x=>x.fastPathPlanBuilds)};
 }
 const report={assumptions:'Three paired 180s production replays; identical continuous charging, P1 and feedback at 1Hz, real 60s heartbeat. Host CPU is not Homey CPU.',summary,results};
 fs.mkdirSync(path.join(afterRoot,'validation'),{recursive:true});
 fs.writeFileSync(path.join(afterRoot,'validation/ev-deadline-benchmark.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(summary,null,2));
}finally{cleanup();}})().catch(e=>{console.error(e);process.exitCode=1;});
