'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const {InputMonitor}=require(root+'/lib/input-monitor');
const manifest=require(root+'/app.json');
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
const used=start=>{const c=process.cpuUsage(start);return(c.user+c.system)/1000;};
function micro(){
 let listener;const raw={registerRunListener:fn=>{listener=fn;return raw;}};
 let marker=0;const direct=args=>{marker+=args.charge_current;return true;};
 const m=new InputMonitor({definitions:manifest.flow.actions,setTimeout:()=>0,clearTimeout:()=>{},now:()=>100000});
 m.observeFlow({getActionCard:()=>raw}).getActionCard('set_ev1_status').registerRunListener(direct);
 const args={connected:'yes',charge_current:10};const n=500000;
 for(let i=0;i<50000;i++)listener(args);
 const samples={direct:[],off:[],on:[]};
 for(let rep=0;rep<7;rep++)for(const mode of rep%2?['on','off','direct']:['direct','off','on']){
  if(mode==='on')m.start();else if(m.active)m.stop();
  const fn=mode==='direct'?direct:listener;const start=process.cpuUsage();for(let i=0;i<n;i++)fn(args);
  samples[mode].push(used(start));
 }
 m.destroy();global.gc();const base=process.memoryUsage().heapUsed;m.start();
 for(let i=0;i<100000;i++)listener(args);global.gc();const first=process.memoryUsage().heapUsed;
 for(let i=0;i<1000000;i++)listener(args);global.gc();const last=process.memoryUsage().heapUsed;
 const snapshot=m.stop();assert.equal(snapshot.inputs.length,1);assert(snapshot.events.length<=256);global.gc();
 return{callsPerSample:n,samples,medianCpuMs:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,median(v)])),
  memory:{baselineHeapBytes:base,after100kBytes:first,after1100kBytes:last,retainedGrowthAfterMillionMoreBytes:last-first,rows:snapshot.inputs.length,events:snapshot.events.length},marker};
}
const originalDate=Date;
class VirtualDate extends originalDate{constructor(...args){super(...(args.length?args:[VirtualDate.now()]));}}
async function realReplays(){
 global.Date=VirtualDate;
 const {setup,installVirtualClearTimeout}=require(root+'/test/pv-source-harness');const restore=installVirtualClearTimeout();
 const START=originalDate.parse('2026-10-22T10:00:00Z');const seconds=300;const results=[];
 const cfg={forcedMode:'self_consumption',peakShaveEnabled:true,peakLimitW:40000,exportLimitEnabled:false,
  evCount:2,hvacCount:2,boilerCount:1,boilerEnabled:true,boilerStartSoc:95,boilerStopSoc:90,
  contractType:'fixed',fixedChargeWindowStart:'00:00',fixedChargeWindowEnd:'23:59',
  evFixedChargeWindowEnabled:true,evFixedMaxGridImportW:40000};
 for(let i=1;i<=2;i++){const ev=i===1?'ev':`ev${i}`,hvac=i===1?'hvac':`hvac${i}`;Object.assign(cfg,{[ev+'Enabled']:true,[ev+'SocEnabled']:true,[ev+'ControlType']:'mode',[ev+'Mode']:'smart',[ev+'Phases']:1,[ev+'Voltage']:230,[ev+'VoltageReference']:'phase',[ev+'MinCurrentA']:6,[ev+'MaxCurrentA']:16,[ev+'TargetSoc']:80,[hvac+'Enabled']:true,[hvac+'AutomaticControlEnabled']:true});}
 try{
 for(let run=0;run<8;run++)for(const mode of run%2?['on','off','baseline']:['baseline','off','on']){
  const which=mode==='baseline'?path.resolve(process.env.HOMEFLUX_BASELINE || path.join(__dirname,'baseline')):root;
  const h=await setup(which,cfg,START,0),a=h.app;
  // Let valid startup I/O finish and enable a real tested battery configuration.
  h.store.set('_chargeTestSignature',a.getChargeTestSignature(a.getSettings()));await h.setExternalSetting('controlEnabled',true);
  const invoke=async(id,args)=>{await h.cards.get(id).listener(args);};
  for(let i=1;i<=2;i++){await invoke(`set_ev${i}_status`,{connected:'yes',charge_current:0});await invoke(`set_ev${i}_soc`,{soc:50});}
  await h.start();await h.flush();a.diagnostics=a.createDiagnosticsRuntime();
  const origin=h.now();const counts={};const record=a.recordDiagnosticCounter.bind(a);a.recordDiagnosticCounter=(key,n=1)=>{counts[key]=(counts[key]||0)+n;return record(key,n);};
  const beforeTrace=h.traces.length,beforeFlex=h.flexible.length;
  if(mode==='on')a.startInputMonitor();
  global.gc();const heapBefore=process.memoryUsage().heapUsed,cpu=process.cpuUsage();let updates=0;
  for(let step=1;step<=seconds*5;step++){
   h.setNow(origin+step*200);const pv=step%150<75?800:1600;
   for(let ev=1;ev<=2;ev++){await invoke(`set_ev${ev}_status`,{connected:'yes',charge_current:10});updates++;}
   if(step%5===0){
    await invoke('set_pv_power',{power:pv});updates++;
    await h.grid(623+4600-pv-a.state.lastTotalCommandW);updates++;
    await invoke('set_battery_soc',{battery:'1',soc:50});updates++;
    await invoke('set_hvac1_room_temperature',{temperature:22});updates++;
    await invoke('set_hvac2_room_temperature',{temperature:23});updates++;
    if(step%300===0){a.runContextHeartbeat();await a.runEvHeartbeat();await h.drain();}
   }
   await h.flush();
   if(mode==='on'&&step%5===0)JSON.stringify(a.getInputMonitorReport()); // Include visible UI serialization at 1 Hz.
  }
  const cpuMs=used(cpu);const report=mode==='on'?a.stopInputMonitor():null;
  global.gc();const heapAfter=process.memoryUsage().heapUsed;
  assert.deepEqual(h.errors,[]);
  if(report){assert.equal(report.totalReceived,updates);assert.equal(report.inputs.length,7);assert.equal(report.limits.observerErrors,0);}
  const state={batteryW:a.state.lastTotalCommandW,evCurrents:[a.state.evChargeCurrentA,a.getExtraEv(1).state.chargeCurrentA],contexts:counts.contextEvaluations||0,fastEvaluations:counts.fastEvaluations||0,portfolios:counts.evPortfolioCalculations||0,
   traces:h.traces.slice(beforeTrace),flexible:h.flexible.slice(beforeFlex)};
  results.push({run:run+1,mode,seconds,updates,cpuMs,retainedHeapBytes:heapAfter-heapBefore,state,report});
  if(mode!=='baseline')a.inputMonitor.destroy();
 }
 }finally{restore();global.Date=originalDate;}
 for(let run=1;run<=8;run++){
  const rows=results.filter(r=>r.run===run);for(const r of rows.slice(1))assert.deepEqual(r.state,rows[0].state,'all control outputs, timing and calculations must be identical');
 }
 const summary={};for(const mode of ['baseline','off','on']){const rows=results.filter(r=>r.mode===mode&&r.run>3);summary[mode]={medianCpuMs:median(rows.map(r=>r.cpuMs)),medianRetainedHeapBytes:median(rows.map(r=>r.retainedHeapBytes)),updates:rows[0].updates,seconds,contexts:rows[0].state.contexts,fastEvaluations:rows[0].state.fastEvaluations,portfolios:rows[0].state.portfolios};}
 return{summary,results:results.map(({state,report,...r})=>({...r,counts:{context:state.contexts,fast:state.fastEvaluations,evPortfolio:state.portfolios},report})),outputsIdentical:true};
}
(async()=>{const out={node:process.version,scope:'Host CPU; Homey I/O and time simulated. Not a real Homey CPU reading.',micro:micro(),replay:await realReplays()};fs.writeFileSync(path.join(__dirname,'benchmark.json'),JSON.stringify(out,null,2));console.log(JSON.stringify({micro:out.micro,replay:out.replay.summary,outputsIdentical:true},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
