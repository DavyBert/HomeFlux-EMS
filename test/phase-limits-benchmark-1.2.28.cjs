'use strict';
// Host-only comparison. Pass the original full1.2.28 source directory.
const path=require('node:path'),assert=require('node:assert/strict');
const oldRoot=path.resolve(process.argv[2]),newRoot=path.resolve(__dirname,'..');
const variants=[oldRoot,newRoot].map(root=>({root,P:require(path.join(root,'lib/phase-guard')),E:require(path.join(root,'lib/ems-engine'))}));
function fixture(v){return {state:{batterySoc:[20,45,70,99]},lastEmittedCommands:[-1000,-1000,-1000,0],gridPhases:[2000,5000,1000].map(watts=>({watts,at:100000})),settings:{...v.E.DEFAULTS,batteryCount:4,phaseGuard:{...v.P.defaults,enabled:true,phases:3,voltage:230,amps:25,limitW:4500,batteries:['L1','L2','L3','balanced3']}}};}
assert.deepEqual(...variants.map(v=>{const f=fixture(v);return v.P.limit(f,[-1000,-1000,-1000,0],f.settings,100000,false);}));
let calls=[0,0];variants.forEach((v,i)=>{const fn=v.E.distributeCommand;v.E.distributeCommand=(...args)=>{calls[i]++;return fn(...args);};});
function run(v,n){const f=fixture(v),start=process.cpuUsage();for(let i=0;i<n;i++)v.P.limit(f,[-1000,-1000,-1000,0],f.settings,100000,false);const t=process.cpuUsage(start);return(t.user+t.system)/1000;}
variants.forEach(v=>run(v,3000));calls=[0,0];const rounds=[[],[]];for(let r=0;r<7;r++)for(const i of(r%2?[1,0]:[0,1]))rounds[i].push(run(variants[i],15000));
console.log(JSON.stringify({measurement:'host process CPU ms, phase envelope only;15000 calls per round,3000 warm-up, alternating order',rounds,fullAllocatorCalls:calls,homeyMeasurements:false},null,2));
