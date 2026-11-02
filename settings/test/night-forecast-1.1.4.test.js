'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { setup, installVirtualClearTimeout } = require('./pv-source-harness');
const { boot } = require('./startup-harness');

async function night(start = '2026-10-12T18:10:00Z') {
  const h = await setup(path.join(__dirname, '..'), {
    fixedChargeWindowStart: '01:00', fixedChargeWindowEnd: '07:00',
    expectedEnergyNeedKwh: 20, peakReserveNightEnabled: false,
    sunChanceReserveEnabled: false, sunnyMonthsMinSocEnabled: false,
    adaptiveLiveControlEnabled: false,
  }, Date.parse(start), 0);
  const a = h.app, date = a.getLocalDateKey(new Date(h.now()));
  Object.assign(a.state, { targetSocOverride: null,
    forecastRemainingKwh: null, forecastDailyMaxKwh: null, forecastDailyMaxDate: date,
    forecastTomorrowKwh: null, forecastTomorrowDate: '',
    nightPlanningActive: true, nightPlanningStartedDate: date,
    pvProducingDate: date, pvSeenProducingToday: false });
  a.inputSeen.forecast = false; a.inputSeen.forecastTomorrow = false;
  a.nightForecastMedian = null;
  return h;
}
const send = async (h, value, day = 'tomorrow') => {
  const accepted = await h.cards.get(day === 'tomorrow' ? 'set_forecast_tomorrow' : 'set_forecast_remaining')
    .listener({ energy: value });
  await h.drain(); return accepted;
};
const selected = h => h.app.getEvaluationState(h.app.getSettings(), h.now());
async function run() {
  const realNow = Date.now, restore = installVirtualClearTimeout();
  try {
    // All actual observations count once. Both odd/even medians and zero are
    // valid; repeated identical forecasts can confirm a sustained correction.
    {
      const h = await night(), a = h.app;
      for (const [input, median] of [[8,8],[10,9],[2,8],[0,5]]) {
        await send(h,input); assert.equal(selected(h).forecastTomorrowKwh,median);
      }
      assert.equal(a.nightForecastMedian.samples.length,4);
      assert.equal(a.state.forecastTomorrowKwh,0,'raw input remains available');
      for (const bad of [null,undefined,'',false,true,NaN,Infinity,'invalid']) {
        assert.equal(await send(h,bad),false);
        await a.setInput({forecastTomorrowKwh:bad}); await h.drain();
      }
      assert.equal(a.nightForecastMedian.samples.length,4,'invalid forecasts never become zero observations');
      await a.setInput({forecastTomorrowKwh:8}); await h.drain();
      assert.equal(a.nightForecastMedian.samples.length,5,'API and Flow share one input path');
      assert.equal(selected(h).forecastTomorrowKwh,8);
      const samples = [...a.nightForecastMedian.samples];
      for (let i=0;i<100;i++) { selected(h); a.getPublicStatus(); a.getPlanningStatus(); }
      assert.deepEqual(a.nightForecastMedian.samples,samples,'reads and calculations never add observations');
      assert.deepEqual(h.errors,[]);
    }
    // Wrong forecast days are excluded; midnight preserves the same target day
    // and promotion of tomorrow's raw input does not duplicate an observation.
    {
      const h = await night(), a = h.app;
      for (const value of [8,10,2]) await send(h,value);
      await send(h,100,'today');
      assert.equal(a.nightForecastMedian.samples.length,3);
      const runtime = a.nightForecastMedian;
      h.setNow(Date.parse('2026-10-12T22:01:00Z'));
      a.ensureForecastDayCurrent(h.now());
      assert.equal(selected(h).planningForecastDay,'today');
      assert.equal(a.nightForecastMedian,runtime);
      assert.equal(runtime.samples.length,3);
      assert.equal(selected(h).forecastDailyMaxKwh,8);
      await send(h,100); // tomorrow now refers to a different future day
      assert.equal(runtime.samples.length,3);
      await send(h,4,'today');
      assert.equal(runtime.samples.length,4);
      assert.equal(selected(h).forecastRemainingKwh,6);
      assert.deepEqual(h.errors,[]);
    }
    // First real PV uses the existing 5 W boundary. The original remaining-
    // today input, not the median or daily maximum, immediately drives the plan.
    {
      const h = await night('2026-10-13T07:10:00Z'), a = h.app;
      a.state.nightPlanningStartedDate = '2026-10-12';
      for (const value of [8,14,2]) await send(h,value,'today');
      assert.equal(selected(h).forecastRemainingKwh,8);
      assert(a.isNightPlanningPhase(h.now()),'a deadline alone cannot end the median before PV starts');
      await h.pv(4); assert.equal(selected(h).forecastRemainingKwh,8);
      await h.pv(5); await h.flush();
      assert.equal(a.nightForecastMedian,null);
      assert.equal(a.isNightPlanningPhase(h.now()),false);
      assert.equal(selected(h).forecastRemainingKwh,2);
      assert.equal(selected(h).forecastDailyMaxKwh,14,'raw daily maximum is preserved');
      assert.equal(a.getPlanningStatus().forecastUsedKwh,2);
      assert.equal(a.getPlanningStatus().forecastUsedSource,'today_remaining');
      await send(h,3,'today');
      assert.equal(a.nightForecastMedian,null);
      assert.equal(selected(h).forecastRemainingKwh,3);
      // Next sunset: seed only the currently valid next-day forecast. Older
      // night observations and daytime forecast traffic must not be mixed in.
      await send(h,11);
      h.setNow(Date.parse('2026-10-13T17:00:00Z'));
      await h.pv(0);
      assert.equal(a.nightForecastMedian,null);
      h.setNow(h.now()+600000); await h.grid(600-a.state.lastTotalCommandW); await h.flush();
      assert(a.isNightPlanningPhase(h.now()));
      assert.equal(a.nightForecastMedian.targetDate,'2026-10-14');
      assert.deepEqual(a.nightForecastMedian.samples,[11]);
      assert.deepEqual(h.errors,[]);
    }
    // A genuinely revised forecast eventually moves the median. Repeating the
    // same new value can change the median even if the raw value is unchanged.
    {
      const h = await night(), a = h.app;
      for (const value of [8,8,8,1,1]) await send(h,value);
      assert.equal(selected(h).forecastTomorrowKwh,8);
      assert.equal(a.updateForecastTomorrowInput(1,h.now()),true,'even median changes to 4.5');
      assert.equal(selected(h).forecastTomorrowKwh,4.5);
      assert.equal(a.updateForecastTomorrowInput(1,h.now()),true,'majority changes median to 1');
      assert.equal(selected(h).forecastTomorrowKwh,1);
      assert.deepEqual(h.errors,[]);
    }
    // On a completely dark day the existing 20:00 fallback starts a new target
    // day. The old night's median must not survive that rollover either.
    {
      const h = await night('2026-10-13T10:00:00Z'), a = h.app;
      a.state.nightPlanningStartedDate='2026-10-12';
      for (const value of [2,3,4]) await send(h,value,'today');
      await send(h,12);
      h.setNow(Date.parse('2026-10-13T18:01:00Z'));
      assert.equal(a.checkNightPlanningFallback(h.now()),true); await h.drain();
      assert.equal(a.nightForecastMedian.targetDate,'2026-10-14');
      assert.deepEqual(a.nightForecastMedian.samples,[12]);
      a.activateNightPlanning('same_night_refresh',h.now());await h.drain();
      assert.deepEqual(a.nightForecastMedian.samples,[12],'same night is not reseeded');
      assert.deepEqual(h.errors,[]);
    }
    // Stabilize the forecast-derived target, not actual SoC or safety control.
    // New battery feedback still lowers the scheduled energy gap, and raw P1
    // can invoke Peak Guard while the night history stays unchanged.
    {
      const h = await night('2026-10-13T00:10:00Z'), a = h.app;
      a.state.nightPlanningStartedDate='2026-10-12';
      for (const value of [8,14,2]) await send(h,value,'today');
      const before=await a.refreshChargePlanning();
      await a.setInput({batterySoc:[60,60,60,60]});await h.drain();
      const after=await a.refreshChargePlanning();
      assert.equal(after.targetSoc,before.targetSoc);
      assert(after.energyNeedKwh<before.energyNeedKwh);
      const samples=[...a.nightForecastMedian.samples];
      h.setNow(h.now()+10000);
      await h.grid(4000);await h.flush();
      assert.equal(a.latestResult.override,'peak_shave');
      assert.deepEqual(a.nightForecastMedian.samples,samples);
      assert.deepEqual(h.errors,[]);
    }
    // A restart never restores an old-night history from settings. Existing
    // valid persisted forecasts seed one new runtime observation.
    {
      const h = await night(), a = h.app;
      for (const value of [8,10,2]) await send(h,value);
      const restarted = await boot(new Map(h.store));
      const r = restarted.app.getNightForecastRuntime(h.now());
      assert.equal(r.targetDate,'2026-10-13');
      assert.deepEqual(r.samples,[2]);
      assert(![...h.store.keys()].some(key=>/nightForecastMedian/i.test(key)));
      assert.deepEqual(restarted.errors,[]);
    }
    // The history belongs to a local forecast date across the winter-clock
    // transition, not to a fixed 24-hour duration or to the input card name.
    {
      const h = await night('2026-10-24T18:10:00Z'), a = h.app;
      for (const value of [8,12,2]) await send(h,value);
      const runtime=a.nightForecastMedian;
      h.setNow(Date.parse('2026-10-25T04:10:00Z'));
      a.ensureForecastDayCurrent(h.now());
      assert.equal(selected(h).forecastRemainingKwh,8);
      assert.equal(a.nightForecastMedian,runtime);
      assert.equal(runtime.targetDate,'2026-10-25');
      await send(h,4,'today');
      assert.equal(selected(h).forecastRemainingKwh,6);
      assert.deepEqual(h.errors,[]);
    }
    console.log('1.1.4 night median: Flow/API, odd/even/zero, invalid input, read-only sampling, midnight, PV/day remaining, sunset reset, sustained forecast, dark-day rollover, actual SoC, Peak Guard, DST and restart passed.');
  } finally { Date.now=realNow;restore(); }
}
if(require.main===module) run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
