'use strict';
process.env.TZ='Europe/Brussels';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const {setup,installVirtualClearTimeout}=require('./pv-source-harness');
const strategy=require('../lib/charge-strategy'),api=require('../widgets/status/api');
const NativeDate=Date;
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]))}};
const restore=installVirtualClearTimeout(),root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'widgets/status/public/visual.html'),'utf8').replace('initLiveWidget();\n})();',
 'window.__forecastTest={get chart(){return lastChartData}};\ninitLiveWidget();\n})();');
async function run(maximum){
 const cfg=strategy.normalize();for(const phase of ['day','night'])cfg.year[phase]={mode:maximum?'maximum':'standard',position:'latest',extraPercent:0,planningMarginPercent:12};
 const now=Date.parse('2026-11-16T13:00:00+01:00');
 const h=await setup(root,{contractType:'tou',chargeStrategy:cfg,forcedMode:'auto',overrideResumeOnTariffChange:true,
  peakShaveEnabled:false,exportLimitEnabled:false,optimizeMultiBatteryEfficiency:false,
  maxTotalChargeW:6000,maxTotalDischargeW:6000,expectedEnergyNeedKwh:20,peakReserveTargetSoc:95,
  dayPlanningMaxSoc:95,nightPlanningMaxSoc:95},now,500);
 const a=h.app;a.homey.app=a;
 Object.assign(a.state,{batterySoc:[35,35,35,35],targetSocOverride:null,lastTotalCommandW:0,lastBatteryCommands:[0,0,0,0],
  nightPlanningActive:false,pvSeenProducingToday:true,pvProducingDate:'2026-11-16'});
 a.updateForecastInput(0,now);a.updateForecastTomorrowInput(0,now);
 await h.grid(500);await h.start();await h.flush();
 assert.equal(a.getSettings().forcedMode,'auto','maximum-power strategy cannot select a forced mode');
 await a.setForcedMode('manual_charge','device');await h.start();await h.flush();
 assert.equal(a.getSettings().forcedMode,'manual_charge');
 const before={store:JSON.stringify([...h.store]),plan:a.planningCache.value.plan,commands:JSON.stringify(a.lastEmittedCommands),timers:h.timers.length};
 const status=await api.getStatus({homey:a.homey,query:{visualSavings:1}});
 assert.equal(status.forcedMode,'manual_charge');assert.equal(status.visualPlanner.forcedMode,'manual_charge');
 assert.equal(status.forcedModeResumeAt,Date.parse('2026-11-16T17:00:00+01:00'),'published production resume boundary');
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(e.type!=='css-parsing')errors.push(e.message)});vc.on('error',(...args)=>errors.push(args.join(' ')));
 const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://widget.test/',virtualConsole:vc,beforeParse(w){w.Date=global.Date}});
 try{
  const w=dom.window,send=data=>w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data}));
  send({type:'homeflux.visual.widgetConfig',configured:true});send({type:'homeflux.visual.status',status});
  const p=w.__forecastTest.chart.prediction;
  assert(p.pts[1].soc>p.pts[0].soc,'actual forced status must render a rising forecast');
  assert(p.pts.some(x=>x.at>status.forcedModeResumeAt&&x.lossKwh>0),'actual status must forecast later discharge');
  assert(w.document.querySelector('#energyChart path[stroke="#3af3ad"]'),'SOC forecast remains rendered');
  assert.deepEqual(errors,[]);assert.deepEqual(h.errors,[]);
  assert.equal(JSON.stringify([...h.store]),before.store,'API/widget cannot write Homey settings');
  assert.strictEqual(a.planningCache.value.plan,before.plan,'API/widget cannot replace actual plan');
  assert.equal(JSON.stringify(a.lastEmittedCommands),before.commands,'API/widget cannot change commands');
  assert.equal(h.timers.length,before.timers,'API/widget cannot schedule extra control work');
 }finally{dom.window.close();}
 console.log('PASS actual app/device mode -> widget API -> embedded renderer; '+(maximum?'maximum/latest':'standard'));
}
(async()=>{try{await run(false);await run(true);}finally{restore();global.Date=NativeDate;}})().catch(e=>{console.error(e);process.exitCode=1});
