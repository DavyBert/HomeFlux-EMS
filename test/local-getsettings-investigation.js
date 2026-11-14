'use strict';
const {boot,DEFAULTS}=require('./startup-harness');
(async()=>{
 const orig=Date.now;let now=Date.parse('2026-11-13T12:00:00Z');Date.now=()=>now;
 try {
  const store=new Map(Object.entries({...DEFAULTS,evCount:0,hvacCount:0,boilerCount:0,controlEnabled:true,batteryCount:4,contractType:'tou'}));
  const {app,cards,errors}=await boot(store);
  const get0=app.getSettings.bind(app);const stacks=[];
  app.getSettings=function(){stacks.push(new Error().stack.split('\n').slice(2,7).map(s=>s.trim()));return get0();};
  now+=2000;
  await cards.get('set_grid_power').listener({power:500});
  console.log('=== initial P1 (same Date.now per cycle) ===',stacks.length,errors.length);
  stacks.forEach((s,i)=>console.log(i+1,s.join(' | ')));
  stacks.length=0;now+=2000;
  await cards.get('set_grid_power').listener({power:650});
  console.log('=== second P1 (same Date.now per cycle) ===',stacks.length,errors.length);
  stacks.forEach((s,i)=>console.log(i+1,s.join(' | ')));
  stacks.length=0;now+=15000;
  await cards.get('set_grid_power').listener({power:700});
  console.log('=== third P1 after 15s ===',stacks.length,errors.length);
  stacks.forEach((s,i)=>console.log(i+1,s.join(' | ')));
  console.log('errors',errors.slice(-3));
 }finally{Date.now=orig;}
})().catch(console.error);
