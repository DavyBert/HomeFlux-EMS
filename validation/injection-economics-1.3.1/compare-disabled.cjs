'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const baseline=process.argv[2],modified=process.argv[3];
const harness=require(path.join(modified,'test/pv-source-harness'));
const restore=harness.installVirtualClearTimeout(),originalNow=Date.now;
const start=Date.parse('2026-11-09T14:05:00Z');
const scenarios=[];
for(const forcedMode of ['auto','self_consumption','solar_capture','avoid_import'])
 for(const pv of [0,3500])scenarios.push({forcedMode,pv});
for(const injectionEnabled of [false,true])
 for(const evEnabled of [false,true])scenarios.push({injectionEnabled,evEnabled,pv:1500});
async function run(root,scenario,opts={}){
 const h=await harness.setup(root,{fixedImportPrice:.87,injectionAutomaticEnabled:false,
   ...scenario,...opts,evCount:scenario.evEnabled?1:0,hvacCount:1,hvacEnabled:true,boilerCount:1,boilerEnabled:true},start,scenario.pv);
 const a=h.app,results=[];
 await h.start();await h.flush();
 for(let step=0;step<16;step++){
  h.setNow(start+(step+1)*7000);a.inputUpdatedAt.batterySoc.fill(h.now());
  a.state.batterySoc=[58,60,62,64].map(x=>x-step*.03);
  await h.grid([500,1200,-800,-3500,2600,3200,150,-200][step%8]);await h.flush();
  if(step%4===3){await h.pv(scenario.pv+200*(step%3));await h.flush();}
  results.push(JSON.parse(JSON.stringify(a.latestResult)));
 }
 assert.deepEqual(h.errors,[]);
 return {results,traces:h.traces,flexible:h.flexible,contexts:h.contexts,timers:h.timers.map(({ms,due,done,type})=>({ms,due,done,type}))};
}
(async()=>{try{
 let cases=0,steps=0;
 for(const scenario of scenarios){
  const before=await run(baseline,scenario);
  const after=await run(modified,scenario,{injectionPriceDifferenceEnabled:false,injectionSolarOverrideEnabled:true,injectionMinimumPriceDifference:99});
  assert.deepEqual(after,before,JSON.stringify(scenario));cases++;steps+=16;
 }
 // Even configured gates cannot affect standard EMS when injection permission is off.
 for(const scenario of scenarios.slice(0,8)){
  const before=await run(baseline,{...scenario,injectionEnabled:false});
  const after=await run(modified,{...scenario,injectionEnabled:false},{injectionPriceDifferenceEnabled:true,injectionSolarOverrideEnabled:true});
  assert.deepEqual(after,before,'permission off '+JSON.stringify(scenario));cases++;steps+=16;
 }
 console.log(`Disabled comparison: ${cases} scenarios / ${steps} steps identical against original ZIP (complete engine results, battery/flexible-load publications, context runs and timers).`);
}finally{Date.now=originalNow;restore();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
