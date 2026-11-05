'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const native=Date.now,{setup,cycle,clock}=require('./hvac-coordination-1.2.15.test');
const H=require('../lib/hvac-permanent');
function coord(a,flag,margin){const all=a.getSettings().hvacCoordination;a.setSetting('hvacCoordination',all.map((v,i)=>i===0?{...v,KeepOnEnabled:true,KeepOnLimitEnabled:flag,KeepOnMarginC:margin}:v));}
function prime(a,mode,target,room){Object.assign(H.unit(a,0),{mode,setpoint:target,comfortMode:mode,powerOff:false,heat:300,cool:300});Object.assign(a,{lastPublishedHvacMode:mode,lastPublishedHvacSetpoint:target,lastPublishedHvacPower:true});Object.assign(a.state,{hvacMode:mode,hvacRoomTemperatureC:room});}
function tick(a){clock.set(clock.now()+360000);a.inputUpdatedAt.grid=clock.now();a.inputUpdatedAt.pv=clock.now();a.flexiblePriorityState.nextEvaluationAt=0;}
(async()=>{
 let checks=0;
 assert.equal(H.fields.Coordination.KeepOnLimitEnabled,false);assert.equal(H.fields.Coordination.KeepOnMarginC,1);
 for(const mode of ['heat','cool'])for(const tariff of [false,true]){
  const target=mode==='heat'?20:24,h=await setup(1,{hvacTariffEnabled:tariff,hvacDirection:mode,hvacComfortMinC:20,hvacComfortMaxC:24,hvacCheapTargetC:target}),a=h.app;
  coord(a,false,0);prime(a,mode,target,mode==='heat'?23:21);const timers=h.timers.length;
  await cycle(h);assert.equal(a.lastPublishedHvacPower,true,'holding alone cannot apply a zero-degree cutoff');
  coord(a,true,0);await cycle(h);assert.equal(a.lastPublishedHvacPower,false,'zero cutoff only applies when explicitly enabled');
  coord(a,false,0);tick(a);await cycle(h);assert.equal(a.lastPublishedHvacPower,true,'disabling cutoff releases its previous latch');
  assert.equal(h.timers.length,timers);assert.equal(a.lastPublishedHvacSetpoint,target);checks++;
 }
 const h=await setup(1,{hvacTariffEnabled:false}),a=h.app;
 const all=a.getSettings().hvacCoordination;a.setSetting('hvacCoordination',all.map((v,i)=>{if(i)return v;const c={...v,KeepOnEnabled:true,KeepOnMarginC:0};delete c.KeepOnLimitEnabled;return c;}));
 prime(a,'heat',20,22);await cycle(h);assert.equal(a.lastPublishedHvacPower,true,'old zero value without new checkbox no longer turns off');checks++;
 coord(a,true,1);await cycle(h);assert.equal(a.lastPublishedHvacPower,false);
 a.state.hvacRoomTemperatureC=19.5;tick(a);await cycle(h);assert.equal(a.lastPublishedHvacPower,false);
 a.state.hvacRoomTemperatureC=19;tick(a);await cycle(h);assert.equal(a.lastPublishedHvacPower,true);checks++;
 // Exercise actual UI show/hide expressions for all combinations.
 const ui=fs.readFileSync('settings/index.html','utf8');
 const lines=ui.split('\n').filter(x=>x.includes("q(stem+'KeepOn")&&x.includes("classList.toggle('hidden'"));assert.equal(lines.length,2);
 for(const keep of [false,true])for(const limit of [false,true]){
  const hidden={},nodes={};for(const id of ['KeepOnEnabled','KeepOnLimitEnabled','KeepOnLimitOptions','KeepOnMarginCGroup'])nodes[id]={checked:id==='KeepOnEnabled'?keep:limit,classList:{toggle:(_c,v)=>{hidden[id]=v;}}};
  vm.runInNewContext(lines.join('\n'),{stem:'hvac',q:id=>nodes[id.slice(4)]});
  assert.equal(hidden.KeepOnLimitOptions,!keep);assert.equal(hidden.KeepOnMarginCGroup,!keep||!limit);checks++;
 }
 for(let i=1;i<=10;i++){const stem='hvac'+(i===1?'':i);assert(ui.includes(`id="${stem}KeepOnLimitEnabled"`));assert(ui.includes(`id="${stem}KeepOnMarginC" type="number" min="0" max="10" step="0.5" value="1"`));}
 console.log(`HVAC keep-on 1.2.27: ${checks} scenario groups passed.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{Date.now=native;});
