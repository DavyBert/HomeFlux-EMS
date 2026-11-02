'use strict';
const path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const beforeRoot=path.resolve(process.argv[2]);
const afterRoot=path.resolve(process.argv[3]||path.join(__dirname,'..'));
const median=xs=>xs.slice().sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const results={node:process.version,method:'process.cpuUsage user+system; 600 virtual seconds warmup, 1800 measured; 5 separate processes/version/scenario; sequential, alternating order',scenarios:{}};
for(const scenario of (process.argv[4]?[process.argv[4]]:['grid_only','stable','noise'])){
 const cpu={before:[],after:[]};let pair;
 for(let iteration=0;iteration<5;iteration++){
  pair={};
  for(const label of iteration%2?['after','before']:['before','after']){
   const child=spawnSync(process.execPath,[path.join(__dirname,'active-charge-1.1.2.test.js'),
    label==='before'?beforeRoot:afterRoot,scenario,'1800','600'],{encoding:'utf8',maxBuffer:16*1024*1024});
   assert.equal(child.status,0,child.stderr);
   pair[label]=JSON.parse(child.stdout);cpu[label].push(pair[label].cpuMs);
  }
  for(const key of ['traces','contexts','flexible','samples'])assert.deepEqual(pair.after[key],pair.before[key],scenario+': '+key);
 }
 results.scenarios[scenario]={cpuMs:cpu,medianCpuMs:{before:median(cpu.before),after:median(cpu.after)},
  commandsAndTimingIdentical:true,contextTimingIdentical:true,flexibleOutputsIdentical:true,
  bothSourcesSamples:pair.after.bothSourcesSamples,
  before:{counters:pair.before.counters,counts:pair.before.counts,previewCalls:pair.before.previewCalls},
  after:{counters:pair.after.counters,counts:pair.after.counts,previewCalls:pair.after.previewCalls},
  commands:pair.after.traces.length,contexts:pair.after.contexts.length};
}
console.log(JSON.stringify(results,null,2));
