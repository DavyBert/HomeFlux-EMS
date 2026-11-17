'use strict';
process.env.TZ='Europe/Brussels';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom'),{setup,installVirtualClearTimeout}=require('./pv-source-harness');
const strategy=require('../lib/charge-strategy'),tou=require('../lib/widget-tou-timeline');
const originalBuild=tou.buildWidgetTouTimeline;let builds=0;tou.buildWidgetTouTimeline=(...args)=>{builds++;return originalBuild(...args);};
const api=require('../widgets/status/api'),NativeDate=Date;
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[Date.now()]))}};
const restore=installVirtualClearTimeout(),root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'widgets/status/public/visual.html'),'utf8').replace('initLiveWidget();\n})();','window.__activeTest={get chart(){return lastChartData}};\ninitLiveWidget();\n})();');
const keys=['avoidGridImport','nightChargeAllowed','dayChargeAllowed','lowForecastBatterySave','lowForecastDischargeToTarget','highForecastBatterySave','highForecastDischargeToTarget'];
async function run(maximum){
 const config=strategy.normalize();for(const phase of ['day','night'])config.year[phase]={mode:maximum?'maximum':'standard',position:'early',extraPercent:0,planningMarginPercent:12};
 const now=Date.parse('2026-11-17T16:25:00+01:00'),deadline=Date.parse('2026-11-17T17:00:00+01:00');
 const h=await setup(root,{contractType:'tou',chargeStrategy:config,forcedMode:'auto',peakShaveEnabled:true,peakLimitW:2650,peakSoftMarginW:100,
  exportLimitEnabled:false,optimizeMultiBatteryEfficiency:false,minSoc:12,safetySoc:14,maxSoc:100,
  expectedEnergyNeedKwh:28,peakReserveTargetSoc:95,peakReserveNightEnabled:true,dayPlanningMaxSoc:90,nightPlanningMaxSoc:95},now,10);
 const a=h.app;a.homey.app=a;
 Object.assign(a.state,{batterySoc:[87.8,87.8,87.8,87.8],targetSocOverride:null,lastTotalCommandW:0,lastBatteryCommands:[0,0,0,0],nightPlanningActive:false,pvSeenProducingToday:true,pvProducingDate:'2026-11-17'});
 a.updateForecastInput(4.4,now);a.updateForecastInput(0,now);a.updateForecastTomorrowInput(4.4,now);
 await h.grid(590);await h.start();await h.flush();
 h.setNow(now+8000);a.inputUpdatedAt.grid=now+8000;a.inputUpdatedAt.pv=now+8000;a.inputUpdatedAt.batterySoc.fill(now+8000);await h.flush();
 const before={store:JSON.stringify([...h.store]),plan:a.planningCache.value.plan,commands:JSON.stringify(a.lastEmittedCommands),timers:h.timers.length,builds};
 const status=await api.getStatus({homey:a.homey,query:{visualSavings:1}}),next=await api.getStatus({homey:a.homey,query:{visualSavings:1}});
 assert.equal(status.baseMode,'charge');assert(['grid_charge','grid_and_pv_charge'].includes(status.action));assert(!status.decisionOutputPending);assert.equal(status.batteryTiming.direction,'charge');
 assert.strictEqual(status.visualPlanner.tariffPolicies,next.visualPlanner.tariffPolicies,'same existing minute cache');
 assert.equal(builds-before.builds,1,'one tariff resolution for both reads');
 const classic=await api.getStatus({homey:a.homey,query:{}});assert.equal(classic.visualPlanner,undefined);assert.equal(builds-before.builds,1,'classic status does not build presentation tariff context');
 for(const row of status.tariffTimeline){const policy=status.visualPlanner.tariffPolicies.find(p=>p.startAt===row.startAt&&p.endAt===row.endAt);assert(policy);for(const key of keys)assert.equal(policy[key],row[key]);}
 // Simulate optional display metadata dropping in transport. The actual API
 // still carries its independent, exact cached forecast policy context.
 status.tariffTimeline=status.tariffTimeline.map(row=>{const copy={...row};for(const key of keys)delete copy[key];return copy;});
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(e.type!=='css-parsing')errors.push(e.message)});vc.on('error',(...args)=>errors.push(args.join(' ')));
 const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://widget.test/',virtualConsole:vc,beforeParse(w){w.Date=global.Date}});
 try{
  const w=dom.window,send=data=>w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data}));send({type:'homeflux.visual.widgetConfig',configured:true});send({type:'homeflux.visual.status',status});
  const p=w.__activeTest.chart.prediction;assert(p.pts[1].soc>87.8);assert(p.pts.find(v=>v.at===deadline).soc>89.7);assert(p.pts.some(v=>v.at>deadline&&v.lossKwh>0));
  assert(w.document.querySelector('#energyChart path[stroke="#3af3ad"]'));assert.deepEqual(errors,[]);assert.deepEqual(h.errors,[]);
  assert.equal(JSON.stringify([...h.store]),before.store);assert.strictEqual(a.planningCache.value.plan,before.plan);assert.equal(JSON.stringify(a.lastEmittedCommands),before.commands);assert.equal(h.timers.length,before.timers);
 }finally{dom.window.close();}
 console.log('PASS real active '+(maximum?'maximum':'standard')+' charge -> API -> iframe; missing display flags recovered; same cached context; no settings/commands/planning/timer changes');
}
(async()=>{try{await run(false);await run(true);}finally{restore();global.Date=NativeDate;tou.buildWidgetTouTimeline=originalBuild;}})().catch(e=>{console.error(e);process.exitCode=1});
