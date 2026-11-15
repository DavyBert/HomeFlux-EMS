'use strict';
const assert = require('node:assert/strict');
const statusWidget = require('../widgets/status/api');
const base = Date.now();
const QUARTER = 15*60000, HOUR = 60*60000;
const makeRows = (interval, count) => Array.from({length: count}, (_,index) => ({
  startMs: base + index*interval,
  endMs: base + (index+1)*interval,
  className: index < 4 ? 'cheap' : index < 8 ? 'normal' : 'expensive',
  price: [0.15,0.18,0.20,0.25,0.27,0.30,0.33,0.36,0.40,0.43,0.48,0.50][index % 12],
  intervalMinutes: interval/60000,
}));
(async () => {
  for (const [contractType,interval] of [['dynamic_quarter',QUARTER],['dynamic_hour',HOUR]]) {
    const settings = {contractType,evCount:0,batteryCount:0,hvacCount:0,boilerCount:0};
    const rows = makeRows(interval,12);
    let timelineCalls = 0;
    const app = {
      getPublicStatus:()=>({statusText:'Ready',settings:{contractType},priceData:{sources:[]},evs:[],hvacs:[]}),
      getSettings:()=>settings,
      getHomeyEngineTariffTimeline:()=>{timelineCalls++;return rows;},
      getPriceSelectionSnapshot:()=>({selection:{source:'external'}}),
    };
    const visual = await statusWidget.getStatus({homey:{app},query:{visualSavings:'1'}});
    assert.equal(timelineCalls,1);
    assert.equal(visual.tariffTimeline.length,12);
    assert.deepEqual(visual.tariffTimeline[0], {
      startAt:rows[0].startMs,endAt:rows[0].endMs,className:'cheap',price:0.15,intervalMinutes:interval/60000,
    });
    assert.equal(visual.tariffTimelineSource,'external');
    assert.equal(visual.tariffTimeline[8].className,'expensive');
    const classic = await statusWidget.getStatus({homey:{app}});
    assert.equal(classic.tariffTimeline,undefined,'Classic status does not allocate tariff rows');
    assert.equal(timelineCalls,1,'Classic view should not request expensive chart data');
  }
  // A missing curve never fabricates a period or changes the engine.
  const settings={contractType:'dynamic_hour',batteryCount:0};
  const missing=await statusWidget.getStatus({homey:{app:{getSettings:()=>settings,
    getPublicStatus:()=>({settings,priceData:{sources:[]}}),
    getHomeyEngineTariffTimeline:()=>[], getPriceSelectionSnapshot:()=>({selection:{source:'none'}}),
  }},query:{visualSavings:'1'}});
  assert.deepEqual(missing.tariffTimeline,[]);
  console.log('PASS Visual Look 1.5.4: cached planner tariff classes per quarter/hour, original prices, no classic overhead, missing curve');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
