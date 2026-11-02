'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),baseline=process.env.HEMS_EV_BASELINE;
function methods(source){
 const re=/^  (?:async )?([A-Za-z_]\w*)\([^\n]*/gm,items=[...source.matchAll(re)],result={};
 for(let i=0;i<items.length;i++)result[items[i][1]]=source.slice(items[i].index,items[i+1]?.index??source.length).trimEnd();
 return result;
}
function run(root){const r=cp.spawnSync(process.execPath,['--expose-gc',path.join(__dirname,'ev-widget-comparison-worker.cjs'),root],{encoding:'utf8',timeout:120000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
const current=run(root),report={simulatedHomey:true,homeyCpuMeasured:false,baselineCompared:Boolean(baseline),current:current.metrics};
if(baseline){
 const old=run(baseline);assert.deepEqual(current.snapshots,old.snapshots,'Same actual Flow inputs must keep identical goal, persistence and EV planner decisions');
 assert.equal(current.metrics.extraContexts,old.metrics.extraContexts);assert.equal(current.metrics.extraFlexibleWrites,old.metrics.extraFlexibleWrites);
 assert.deepEqual(current.metrics.counts,old.metrics.counts);
 const before=methods(fs.readFileSync(path.join(baseline,'app.js'),'utf8')),after=methods(fs.readFileSync(path.join(root,'app.js'),'utf8'));
 const evMethods=Object.keys(before).filter(k=>/Ev/.test(k));
 // Explicitly authorised follow-up: widget-owned absolute goals/Max PV/lifecycle.
 // Ordinary Flow-only snapshots above must remain identical. Every changed
 // existing EV method is still listed and checked here, not silently skipped.
 const authorisedMethods=new Set(["getEvaluationState", "getEvBatterySupportAvailableW", "publishEvTargetWarning", "getEvBatteryDischargePolicy", "getEvChargeMode", "getEvChargeModeFor", "getEvOutputTimingStatus", "recordRecentEvHouseLoadSample", "recordEvBatteryHouseReference", "clearEvSocPlan", "getEffectiveEvMode", "getEffectiveEvModeFor", "getEvCommandedPowerW", "getEvControlCurrentA", "getEvDeadlinePolicy", "getEvDecisionGridImportLimitW", "getEvGridImportControlStatus", "getEvInstanceSettings", "handleEvEnergyPlanConnectionTransition", "markEvSessionEnded", "measureEvPlanningDecision", "persistEvEnergyPlanOverrides", "persistEvSocPlanOverrides", "planEvDeadline", "publishAdditionalEvDecision", "publishEvDecision", "recordEvHouseLoadSample", "restoreEvEnergyPlanOverrides", "restoreEvSocPlanOverrides", "setEvEnergyPlan", "setEvSessionOverride", "setEvSessionOverrideFor", "setEvSocPlan", "updateEvPortfolioLoadDetection", "updateEvStatusInput"]);
 const changedEvMethods=[];
 for(const name of evMethods)if(after[name]!==before[name]){
  assert(authorisedMethods.has(name),name+' changed outside the explicit widget planning/lifecycle extension');
  changedEvMethods.push(name);
 }
 for(const file of ['lib/ev-session.js','lib/battery-night-planner.js'])
  assert.equal(fs.readFileSync(path.join(root,file),'utf8'),fs.readFileSync(path.join(baseline,file),'utf8'),file);
 report.baseline=old.metrics;report.unchangedEvMethods=evMethods.filter(name=>!changedEvMethods.includes(name));
 report.changedEvMethods=changedEvMethods;
 report.changedPlannerModules=['lib/flexible-loads.js','lib/ev-deadline-planner.js'].filter(file=>!fs.readFileSync(path.join(root,file)).equals(fs.readFileSync(path.join(baseline,file))));
 report.scope='Widget options/lifecycle plus explicitly requested measurement-source correction: Mode uses shared P1 observation; Current/Hybrid use fresh Flow feedback. Legacy planner snapshots remain compared where physical feedback is identical.';report.identicalFlowSnapshots=current.snapshots.length;
 report.note='Node container measurements with mocked Homey I/O; elapsed/CPU/retained heap are not Homey device percentages. Counter/command equality is asserted; timing is reported without an improvement claim.';
}
fs.writeFileSync(path.join(root,'validation/ev-widget-regression-1.2.4.json'),JSON.stringify(report,null,2)+'\n');
console.log('EV source/Flow regression and performance comparison passed',report.identicalFlowSnapshots||'baseline not supplied');
