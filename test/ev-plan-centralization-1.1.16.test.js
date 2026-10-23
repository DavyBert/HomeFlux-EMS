'use strict';
// Exact original/optimized EV decisions and live revision/monitor boundaries.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const baseline = process.env.HOMEFLUX_BASELINE_DIR
  ? require(path.resolve(process.env.HOMEFLUX_BASELINE_DIR, 'lib/flexible-loads.js'))
  : null;
const goldenPath = path.join(__dirname, 'fixtures/ev-plan-decisions-1.1.16.json');
const golden = fs.existsSync(goldenPath) ? JSON.parse(fs.readFileSync(goldenPath)) : [];
const { calculateEvDecision, findNextLocalTime } = require('../lib/flexible-loads');
const { fixture } = require('./ev-work-harness');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const DateOriginal = Date;
class VirtualDate extends DateOriginal { constructor(...xs) { super(...(xs.length ? xs : [VirtualDate.now()])); } }
async function main() {
 const dates = [
   '2026-10-22T22:05:30.155Z', '2026-10-25T00:55:03.321Z',
   '2027-03-28T01:55:35.999Z', '2027-01-07T05:59:59.999Z',
 ];
 let compared=0; const outputs=[];
 for(const iso of dates)for(const allowed of [false,true])for(const guarantee of [false,true])for(const kind of ['soc','energy']) {
   const now = new DateOriginal(iso), target = findNextLocalTime(now,'07:00','Europe/Brussels');
   const settings = {contractType:'tou', timezone:'Europe/Brussels', evEnabled:true,
     evSocEnabled:true, evMode:'soc_target', evBatteryCapacityKwh:50, evTargetSoc:82,
     evTargetTime:'07:00', evSocDeadlineAt:target.getTime(), evSocPlanActive:kind==='soc',
     evEnergyPlanActive:kind==='energy', evEnergyNeedKwh:12.1,
     evEnergyDeadlineAt:target.getTime(), evGuaranteeTarget:true,
     evAllowUnselectedTariffForDeadline:guarantee,
     evControlType:'hybrid', evMinCurrentA:6, evMaxCurrentA:16, evStandardCurrentA:16,
     evPhases:3, evVoltage:400, evVoltageReference:'line',
     evPvStartSurplusW:1500, evPvStopSurplusW:600, peakShaveEnabled:true,
     peakLimitW:14000, peakSoftMarginW:500,
     touRates:[{id:'a',evChargeAllowed:allowed,evPvChargeAllowed:true}],
     touSchedule:[{rateId:'a',start:'00:00',end:'00:00',days:[1,2,3,4,5,6,7]}]};
   const input={settings,now,tariff:{kind:'tou',rateId:'a',className:'normal'},connected:true,
     soc:22,socSeen:true,socFresh:true,actualCurrentA:6,gridPowerW:2350,
     currentBatteryCommandW:-500,nextBatteryCommandW:-500};
   const expected = baseline ? baseline.calculateEvDecision(input) : golden[compared];
   if(!expected) throw new Error('Missing baseline decision fixture '+compared);
   assert.deepEqual(calculateEvDecision(input),expected,`decision parity ${iso}/${allowed}/${guarantee}/${kind}`);
   outputs.push(expected);
   compared++;
 }
 if(baseline && process.env.EV_PLAN_WRITE_GOLDEN === '1'){fs.mkdirSync(path.dirname(goldenPath),{recursive:true});fs.writeFileSync(goldenPath,JSON.stringify(outputs,null,2)+'\n');}
 global.Date=VirtualDate;
 const restore=installVirtualClearTimeout();
 try{
   const h=await fixture({connected:true,chargeAllowed:true}), a=h.app;
   const rev=Number(a.evPlanRevision[0]);
   const targets = h.cards.get('set_ev1_soc_deadline');
   const goal={target_soc:82,time:'07:00',guarantee:'yes'};
   await targets.listener(goal);
   assert.equal(a.evPlanRevision[0],rev+1,'real goal increments revision');
   const next=a.evPlanRevision[0];
   for(let i=0;i<30;i++)await targets.listener(goal);
   assert.equal(a.evPlanRevision[0],next,'identical Flow goals do not require new planning');
   a.inputMonitor.start();
   const statusBefore=a.inputMonitor.snapshot().calculationSummary.total;
   for(let i=0;i<10;i++){
     a.getEvPlanningDeviceStatus();a.getEvDeviceStatus();a.getEvInstanceDeviceStatus(0);
   }
   assert.equal(a.inputMonitor.snapshot().calculationSummary.total,statusBefore,'status does not cause plan calculation');
   const minute=Math.floor(h.now()/60000);
   const settings=a.getSettings();
   a.evSocPlans[0]._deadlineMinuteMemo = null;
   let lookups=0;const resolver=a.getEvSocPlanDeadlineAt;
   a.getEvSocPlanDeadlineAt=function(...args){lookups++;return resolver.apply(this,args);};
   for(let j=0;j<40;j++){
     h.setNow(minute*60000+500+j*1000);
     const instance=a.getEvInstanceSettings(0,settings);
     const at=h.now();const remainder=at%60000;
     const expected=findNextLocalTime(new DateOriginal(at-remainder),'07:00',settings.timezone).getTime()+remainder;
     assert.equal(instance.evSocDeadlineAt,expected,'millisecond-exact deadline projection');
   }
   assert.equal(lookups,1,'minute resolver executes once across forty settings reads');
   const report=a.inputMonitor.snapshot();
   assert.equal(report.calculations.filter(x=>x.kind==='evSocDeadline').reduce((n,x)=>n+x.executions,0),1);
   assert.equal(report.planningEvents['soc_deadline_reused:ev1'],39);
   a.inputMonitor.stop();
 }finally{restore();global.Date=DateOriginal;}
 console.log(`1.1.16 EV planning centralization: ${compared} exact decision comparisons, Flow revision, Live status and 40 deadline projections passed.`);
}
main().catch(err=>{console.error(err);process.exitCode=1;});
