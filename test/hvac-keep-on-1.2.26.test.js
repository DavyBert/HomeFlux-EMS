'use strict';
const assert=require('node:assert/strict');
const native=Date.now;
const {setup,cycle,clock}=require('./hvac-coordination-1.2.15.test');
const H=require('../lib/hvac-permanent');
async function config(a,index,enabled,margin){const s=a.getSettings().hvacCoordination;a.setSetting('hvacCoordination',s.map((v,i)=>i===index?{...v,KeepOnEnabled:enabled,KeepOnMarginC:margin}:v));}
function room(a,index,value){if(!index)a.state.hvacRoomTemperatureC=value;else a.getExtraHvac(index).state.roomTemperatureC=value;}
function prime(a,index,mode,target){const u=H.unit(a,index);Object.assign(u,{mode,setpoint:target,comfortMode:mode,powerOff:false,heat:300,cool:300});if(!index){a.lastPublishedHvacSetpoint=target;a.lastPublishedHvacMode=mode;a.lastPublishedHvacPower=true;a.state.hvacMode=mode;}else{const r=a.getExtraHvac(index);Object.assign(r,{lastPublishedSetpoint:target,lastPublishedMode:mode,lastPublishedPower:true});r.state.mode=mode;}}
function tick(a){clock.set(clock.now()+360000);a.inputUpdatedAt.grid=clock.now();a.inputUpdatedAt.pv=clock.now();a.flexiblePriorityState.nextEvaluationAt=0;}
(async()=>{
 let checks=0;
 for(const mode of ['heat','cool'])for(const margin of [0,1]){
  const h=await setup(1,{hvacTariffEnabled:false,hvacDirection:mode,hvacComfortMinC:20,hvacComfortMaxC:24}),a=h.app,target=mode==='heat'?20:24;
  await config(a,0,true,margin);prime(a,0,mode,target);
  room(a,0,target);await cycle(h);assert.equal(a.lastPublishedHvacPower,margin>0);
  if(margin){room(a,0,mode==='heat'?20.5:23.5);await cycle(h);assert.equal(a.lastPublishedHvacPower,true);room(a,0,mode==='heat'?21:23);await cycle(h);assert.equal(a.lastPublishedHvacPower,false);room(a,0,mode==='heat'?19.5:24.5);tick(a);await cycle(h);assert.equal(a.lastPublishedHvacPower,false);room(a,0,mode==='heat'?19:25);tick(a);await cycle(h);assert.equal(a.lastPublishedHvacPower,true);}
  checks++;
 }
 for(const mode of ['heat','cool']){
  const h=await setup(1,{hvacDirection:mode,hvacCheapTargetC:mode==='heat'?23:21}),a=h.app,target=mode==='heat'?23:21;
  await config(a,0,true,1);prime(a,0,mode,target);room(a,0,target);await cycle(h);assert.equal(a.lastPublishedHvacPower,true);
  room(a,0,target+(mode==='heat'?1:-1));await cycle(h);assert.equal(a.lastPublishedHvacPower,false);
  const before=h.events.length;await cycle(h);assert.equal(h.events.length,before);
  room(a,0,target+(mode==='heat'?.5:-.5));tick(a);await cycle(h);assert.equal(a.lastPublishedHvacPower,false);
  room(a,0,target+(mode==='heat'?-1:1));tick(a);await cycle(h);assert.equal(a.lastPublishedHvacPower,true);assert.equal(a.lastPublishedHvacSetpoint,target);checks++;
 }
 const h=await setup(2,{hvacTariffEnabled:false,hvac2TariffEnabled:false}),a=h.app;await config(a,0,true,1);prime(a,0,'heat',20);prime(a,1,'heat',20);room(a,0,20);room(a,1,20);await cycle(h);assert.equal(a.lastPublishedHvacPower,true);assert.equal(a.getExtraHvac(1).lastPublishedPower,false);checks++;
 a.setSetting('peakShaveEnabled',true);a.setSetting('peakLimitW',1000);a.state.gridPowerW=2000;await cycle(h);assert.equal(a.lastPublishedHvacPower,false);checks++;
 for(const reason of ['stale','flow','permission']){
  const h=await setup(1,{hvacTariffEnabled:false}),a=h.app;await config(a,0,true,1);prime(a,0,'heat',20);room(a,0,20);await cycle(h);
  if(reason==='stale'){clock.set(clock.now()+120000);await cycle(h);assert.equal(a.lastPublishedHvacPower,false);}
  if(reason==='flow'){await a.setHvacAutomaticControlFor(0,{enabled:'no'});assert.equal(a.lastPublishedHvacPower,false);}
  if(reason==='permission'){a.setSetting('hvacAllowPowerControl',false);room(a,0,21);await cycle(h);assert.equal(a.lastPublishedHvacPower,true);assert.match(a.latestHvacDecision.reason,/niet toegestaan/);}
  checks++;
 }
 const saved=await setup(10);for(let i=0;i<10;i++){await config(saved.app,i,true,i/2);assert.equal(saved.app.getHvacInstanceSettings(i).hvacCoordination.KeepOnMarginC,i/2);}
 const {boot}=require('./startup-harness');const restarted=await boot(new Map(saved.store));for(let i=0;i<10;i++){assert.equal(restarted.app.getHvacInstanceSettings(i).hvacCoordination.KeepOnEnabled,true);assert.equal(restarted.app.getHvacInstanceSettings(i).hvacCoordination.KeepOnMarginC,i/2);}checks++;
 const ui=require('node:fs').readFileSync('settings/index.html','utf8');for(let i=1;i<=10;i++)assert(ui.includes(`id="hvac${i===1?'':i}KeepOnEnabled"`));assert(ui.includes('KeepOnMarginC:Math.max'));
 const widget=require('node:fs').readFileSync('widgets/status/public/index.html','utf8');assert(widget.includes("hvacSummaryIcon('permanent')"));assert(widget.includes('h.permanentControlEnabled&&h.enabled&&h.automaticControlEnabled!==false'));checks++;
 console.log(`HVAC keep-on 1.2.26: ${checks} scenario groups passed.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{Date.now=native;});
