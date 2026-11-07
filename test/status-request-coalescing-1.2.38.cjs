'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function extract(source,start){const at=source.indexOf(start);assert(at>=0);const brace=source.indexOf('{',at);let depth=1,i=brace+1;for(;depth&&i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}')depth--;}return source.slice(at,i);}
async function run(){
 const settings=fs.readFileSync('settings/index.html','utf8'),requests=[];
 const ctx=vm.createContext({Homey:{api:(...args)=>requests.push(args)},renderHybridLiveStatus:()=>{}});
 vm.runInContext('let statusRefreshBusy=false,hybridRefreshBusy=false;'+extract(settings,'async function refreshStatus()')+extract(settings,'function refreshHybridStatus()'),ctx);
 for(let i=0;i<100;i++)vm.runInContext('refreshStatus();refreshHybridStatus()',ctx);
 assert.equal(requests.length,2);for(const row of requests)row[3](new Error('network'));
 vm.runInContext('refreshStatus();refreshHybridStatus()',ctx);assert.equal(requests.length,4);
 const ev=fs.readFileSync('widgets/ev/public/index.html','utf8'),pending=[];
 const ectx=vm.createContext({active:true,generation:0,selected:'1',period:'day',inFlight:null,refreshAgain:false,H:{api:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))},feedback:'',error:false,payload:null,host:{},t:()=>'',render:()=>{},controller:{select:()=>{},update:()=>{}}});
 vm.runInContext(extract(ev,'async function refresh()'),ectx);
 const task=vm.runInContext('refresh()',ectx);
 for(let i=0;i<100;i++)vm.runInContext('refresh()',ectx);
 assert.equal(pending.length,1);pending[0].resolve({evs:[{id:'1',plan:null}]});await task;
 assert.equal(pending.length,2,'one combined trailing refresh');
 pending[1].reject(new Error('network'));for(let i=0;i<5;i++)await Promise.resolve();
 vm.runInContext('refresh()',ectx);assert.equal(pending.length,3,'a failed request releases the lock');
 vm.runInContext('active=false;refresh()',ectx);pending[2].resolve({evs:[]});for(let i=0;i<5;i++)await Promise.resolve();assert.equal(pending.length,3,'hidden widgets do not restart fetching');
 console.log('Status request coalescing 1.2.38: settings/hybrid/EV pending bursts, trailing refresh, network recovery and hidden-widget checks passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
