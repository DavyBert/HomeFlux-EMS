'use strict';
const {boot,DEFAULTS}=require('./startup-harness');
(async()=>{const originalNow=Date.now;let clock=Date.parse('2026-11-13T12:00:00Z');Date.now=()=>clock;try{
const {app,cards}=await boot(new Map(Object.entries({...DEFAULTS,evCount:0,hvacCount:0,boilerCount:0,controlEnabled:true,batteryCount:4,contractType:'tou'})));
const oldSettings=app.getSettings.bind(app),oldFast=app.evaluateFastNow.bind(app);let trace=[];
app.getSettings=()=>{trace.push(new Error().stack.split('\n')[2].trim());return oldSettings();};
app.evaluateFastNow=(...args)=>{clock+=1;return oldFast(...args);};
clock+=2000;await cards.get('set_grid_power').listener({power:500});
console.log('count',trace.length);trace.forEach((s,i)=>console.log(i+1,s));
}finally{Date.now=originalNow;}})().catch(console.error);
