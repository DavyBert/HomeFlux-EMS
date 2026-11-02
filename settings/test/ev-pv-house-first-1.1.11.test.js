'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.join(path.resolve(process.argv[2] || path.join(__dirname, '..')), 'package.json'));
const { evaluate } = req('./lib/ems-engine');
const { fixture, status, pass, warm, permitted, latest, perAmpW, start } = require('./ev-battery-transition-1.1.9.test');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const records = [];
async function sample(h, second, pv, house = 623, amps = [16], order = 'current_first') {
  h.setNow(start + second * 1000);
  await h.pv(pv);
  const grid = () => house + amps.reduce((s, a) => s + a * perAmpW, 0) - pv - h.app.state.lastTotalCommandW;
  if (order === 'grid_first') await h.grid(grid());
  for (let i = 0; i < amps.length; i++) await status(h, amps[i], i);
  if (order !== 'grid_first') await h.grid(grid());
  await h.flush();
}
async function plateau(h, from, pv, house = 623, amps = [16], seconds = 130) {
  const samples = [];
  for (let second = from; second < from + seconds; second++) {
    await sample(h, second, pv, house, amps);
    samples.push(h.app.state.lastTotalCommandW);
  }
  await pass(h);
  const a = h.app, decisions = amps.map((_, i) => latest(a, i));
  return { pv, house, batteryW: a.state.lastTotalCommandW,
    allowance: a.getEvGridImportControlStatus(),
    pvAttributedW: decisions.reduce((s, d) => s + (d?.pvAttributedW || 0), 0),
    samples: samples.slice(-20), publications: h.traces.slice(-3) };
}
async function portfolioCases() {
  for (const types of [['current','mode'],['hybrid','current']]) {
    const h=await fixture(types[0],7,2);
    await h.setExternalSetting('ev2ControlType',types[1]); await warm(h,2);
    let second=76;
    for (const pv of [5000,200,0,23000]) {
      const r=await plateau(h,second,pv,623,[16,16]);second+=130;
      assert(r.batteryW<=Math.max(0,623-pv)+40,'mixed portfolio must not discharge for EVs');
      assert(r.pvAttributedW<=Math.max(0,pv-623)+2,'portfolio may consume the solar surplus only once');
      assert(r.allowance.protectedPvW<=Math.max(0,pv-623)+2);
      records.push({scenario:'mixed-portfolio',types,...r});
    }
    await h.cards.get('end_ev1_charging_session').listener({});await pass(h);
    const r=await plateau(h,second,200,623,[0,16]);
    assert.equal(permitted(h.app),false);assert.equal(permitted(h.app,1),true);
    assert(Math.abs(r.batteryW-423)<40);
    records.push({scenario:'one-EV-stopped',types,...r});
  }
  // PV-only permissions and both priority splits: the feedback follows the
  // published charger output here, rather than holding the measured load at 16 A.
  for (const share of [20,80]) {
    const h=await fixture('hybrid',7,1,{evPvSharePercent:share});await warm(h);
    const rates=h.app.getSettings().touRates.map(rate=>({...rate,evChargeAllowed:false,evPvChargeAllowed:true}));
    await h.setExternalSetting('touRates',rates);
    for(let second=76;second<266;second++) {
      const current=permitted(h.app)?h.app.lastPublishedEvCurrentA:0;
      await sample(h,second,9000,623,[current]);
    }
    const d=latest(h.app);
    assert.equal(Number(d.gridAllocatedW)||0,0,`PV-only tariff must not grant grid energy: ${JSON.stringify(d)}`);
    assert((Number(d.pvAttributedW)||0)<=8377+2);assert(h.app.state.lastTotalCommandW<=40);
    if(share===80) assert(permitted(h.app),`sufficient PV may charge the EV: ${JSON.stringify(d)}`);
    else assert(h.app.state.lastTotalCommandW < -5000,'battery-first priority may absorb PV before the EV minimum step fits');
    records.push({scenario:'PV-only-priority',share,batteryW:h.app.state.lastTotalCommandW,
      pvAllocatedW:d.pvAllocatedW,pvAttributedW:d.pvAttributedW,gridAllocatedW:d.gridAllocatedW});
  }
  for(const extra of [{batteryCount:0,controlEnabled:false},{controlEnabled:false}]) {
    const h=await fixture('current',7,1,extra);await warm(h);
    const r=await plateau(h,76,5000);
    assert(permitted(h.app));assert(r.pvAttributedW<=4377+2);
    records.push({scenario:'independent-EV',extra,...r});
  }
}
async function delayedPvCases() {
  for (const order of ['p1_first','pv_first']) for (const [beforePv, afterPv] of [[5000,200],[200,5000]]) {
    const h=await fixture();await warm(h,1,beforePv);const a=h.app;
    const previousHouse=a.evBatteryHouseReferenceW;
    h.setNow(h.now()+1000);await status(h,16);
    const grid=()=>623+16*perAmpW-afterPv-a.state.lastTotalCommandW;
    if(order==='p1_first') {
      await h.grid(grid());
      assert(Math.abs(a.evBatteryHouseReferenceW-previousHouse)<1,
        'new P1 with old PV must not relearn a PV change as household demand');
      await h.pv(afterPv);
    } else { await h.pv(afterPv); await h.grid(grid()); }
    await pass(h);
    assert(a.state.lastTotalCommandW<=Math.max(0,623-Math.min(beforePv,afterPv))+70,
      'asynchronous PV/P1 must not publish EV-powered battery discharge');
    const from=(h.now()-start)/1000+1;
    const r=await plateau(h,from,afterPv);
    assert(Math.abs(a.evBatteryHouseReferenceW-623)<1);
    assert(Math.abs(r.batteryW-Math.max(0,623-afterPv))<40);
    records.push({scenario:'delayed-PV',order,beforePv,afterPv,...r});
  }
}
async function run() {
  const original = Date.now, restore = installVirtualClearTimeout();
  try {
    for (const type of ['current', 'mode', 'hybrid']) for (const interval of [7, 55]) {
      const h = await fixture(type, interval);
      await warm(h);
      let second = 76;
      for (const [house, pv] of [[623,5000],[623,200],[623,0],[263,1153],[623,600],[623,650],[623,200],[623,5000]]) {
        const r = await plateau(h, second, pv, house); second += 130;
        records.push({type, interval, ...r});
        const deficit = Math.max(0, house - pv);
        assert(r.batteryW <= deficit + 40,
          `${type}/${interval}: PV ${pv}, house ${house}: unwanted discharge ${r.batteryW}; deficit ${deficit}`);
        if (deficit > 100) assert(Math.abs(r.batteryW - deficit) < 40,
          `house support must return: ${JSON.stringify(r)}`);
        assert(r.pvAttributedW <= Math.max(0, pv-house) + 2,
          `house PV may not be assigned to the EV: ${r.pvAttributedW}`);
        assert(Math.max(...r.samples)-Math.min(...r.samples) < 55, 'settled cloud plateau must not oscillate');
        assert(permitted(h.app), 'selected tariff remains allowed');
        assert.deepEqual(h.errors, []);
      }
      // Stop through real Flow publication, retaining physical demand for 8 seconds.
      await h.cards.get('end_ev1_charging_session').listener({}); await pass(h);
      assert.equal(permitted(h.app), false);
      for (let n=0;n<70;n++) {
        const pv=n<4?5000:n<25?200:5000;
        await sample(h,second++,pv,623,[n<8?16:0],n%2?'grid_first':'current_first');
        const a=h.app, settings=a.getSettings();
        const candidate=evaluate(a.getEvaluationState(settings,h.now()),settings,new Date(h.now())).totalCommandW;
        assert(candidate<=Math.max(0,623-pv)+70, `PV/STOP candidate must exclude EV load: ${candidate}`);
        // Publication retains the configured interval: after a sudden rise in
        // PV the previous household-only command may remain until it elapses.
        assert(a.state.lastTotalCommandW<=493,'a delayed publication may only retain the earlier 423 W house deficit');
        assert.equal(permitted(h.app),false,'remaining measurements cannot restart EV');
      }
      records.push({scenario:'cloud-stop',type,interval,batteryW:h.app.state.lastTotalCommandW});
      if (process.env.HOUSE_FIRST_QUICK) break;
    }
    if (!process.env.HOUSE_FIRST_QUICK) {await portfolioCases();await delayedPvCases();}
    console.log(`1.1.11 PV first for household: ${records.length} cloud/STOP scenarios passed (production scheduler and Flow outputs).`);
  } finally {
    if(process.env.HOUSE_FIRST_JSON) fs.writeFileSync(process.env.HOUSE_FIRST_JSON, JSON.stringify(records,null,2));
    Date.now=original;restore();
  }
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run,sample,plateau};
