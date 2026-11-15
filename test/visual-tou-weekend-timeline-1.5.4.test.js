'use strict';
const assert = require('node:assert/strict');
const {buildWidgetTouTimeline} = require('../lib/widget-tou-timeline');
const statusWidget = require('../widgets/status/api');
const HOURS = 3600000;
const dateMs = iso => Date.parse(iso);
const brussels = {
  contractType:'tou', timezone:'Europe/Brussels',
  touRates:[
    {id:'superdal',name:'Superdal',importPrice:0.23},
    {id:'dal',name:'Dal',importPrice:0.28},
    {id:'piek',name:'Piek',importPrice:0.36},
  ],
  touSchedule:[
    {rateId:'superdal',start:'01:00',end:'07:00',days:[1,2,3,4,5,6,7]},
    {rateId:'piek',start:'07:00',end:'11:00',days:[1,2,3,4,5]},
    {rateId:'dal',start:'07:00',end:'11:00',days:[6,7]},
    {rateId:'dal',start:'11:00',end:'17:00',days:[1,2,3,4,5]},
    {rateId:'piek',start:'17:00',end:'22:00',days:[1,2,3,4,5]},
    {rateId:'dal',start:'17:00',end:'22:00',days:[6,7]},
    {rateId:'dal',start:'22:00',end:'01:00',days:[1,2,3,4,5,6,7]},
    {rateId:'superdal',start:'11:00',end:'17:00',days:[6,7]},
  ],
};
function trimmed(rows, start) {
  const end = start+24*HOURS;
  return rows.filter(r => r.endAt>start && r.startAt<end)
    .map(r=>({type:r.className, at:r.startAt, end:Math.min(r.endAt,end),name:r.label}));
}
function testWeekend() {
  const start=dateMs('2026-11-15T02:39:00Z'); // Sunday 03:39 in Brussels
  const rows=trimmed(buildWidgetTouTimeline(brussels,start), start);
  assert.deepEqual(rows.map(r=>r.type), ['cheap','normal','cheap','normal','cheap']);
  assert.deepEqual(rows.slice(0,-1).map(r=>new Date(r.end).toISOString()), [
    '2026-11-15T06:00:00.000Z', '2026-11-15T10:00:00.000Z',
    '2026-11-15T16:00:00.000Z', '2026-11-16T00:00:00.000Z']);
  assert.equal(rows[2].name,'Superdal');
  assert.equal(rows[2].end-rows[2].at,6*HOURS);
  assert.equal(rows.at(-1).end,start+24*HOURS);
  console.log('PASS Sunday: 03:39-07 Superdal, 07-11 Dal, 11-17 Superdal, 17-01 Dal, 01-03:39 Superdal');
}
function testWeekdayAndEdits() {
  const start=dateMs('2026-11-12T02:39:00Z'); // Thursday 03:39
  const rows=trimmed(buildWidgetTouTimeline(brussels,start),start);
  assert.deepEqual(rows.map(r=>r.type),['cheap','expensive','normal','expensive','normal','cheap']);
  const customized={...brussels,touSchedule:brussels.touSchedule.map(r=>
    r.start==='11:00' && r.end==='17:00' && r.days.length===2 ? {...r,rateId:'piek'} : r)};
  const custom=trimmed(buildWidgetTouTimeline(customized,dateMs('2026-11-15T02:39:00Z')),dateMs('2026-11-15T02:39:00Z'));
  assert.equal(custom[2].type,'expensive','Custom weekend rate is not derived from the built-in scheme');
  console.log('PASS Weekday peak periods and user-defined weekend tariff overrides');
}
function testDst() {
  const start=dateMs('2027-03-28T00:30:00Z'); // spring DST forward
  const rows=trimmed(buildWidgetTouTimeline(brussels,start),start);
  assert.ok(rows.length>=4);
  for(let i=0;i<rows.length;i++){
    assert.ok(rows[i].end>rows[i].at);
    if(i)assert.equal(rows[i].at,rows[i-1].end,'DST timeline has no gap');
  }
  assert.equal(rows.at(-1).end,start+24*HOURS);
  console.log('PASS 24 real hours across Europe/Brussels spring DST');
}
async function testStatusApi() {
  const app={
    getSettings:()=>brussels,
    getPublicStatus:()=>({priceData:{sources:[]},tariff:{className:'cheap',label:'Superdal'},settings:{contractType:'tou'}}),
  };
  const old=Date.now;
  try{
    Date.now=()=>dateMs('2026-11-15T02:39:00Z');
    const homey={app};
    const response=await statusWidget.getStatus({homey,query:{visualSavings:'1'}});
    assert.equal(response.tariffTimelineSource,'configured-tou');
    assert.deepEqual(trimmed(response.tariffTimeline,Date.now()).map(r=>r.type),['cheap','normal','cheap','normal','cheap']);
    const classic=await statusWidget.getStatus({homey});
    assert.equal(classic.tariffTimeline,undefined,'Do not add payload to classic status');
    const second=await statusWidget.getStatus({homey,query:{visualSavings:'1'}});
    assert.strictEqual(second.tariffTimeline,response.tariffTimeline,'One-minute shared in-memory cache');
    brussels.touSchedule[7].rateId='piek';
    const changed=await statusWidget.getStatus({homey,query:{visualSavings:'1'}});
    assert.notStrictEqual(changed.tariffTimeline,response.tariffTimeline,'Config edit invalidates cache immediately');
    assert.equal(changed.tariffTimeline[2].className,'expensive');
    brussels.touSchedule[7].rateId='superdal';
    console.log('PASS API, classic unchanged, 1min cache and immediate schedule edit invalidation');
  } finally {Date.now=old;}
}
(async()=>{testWeekend();testWeekdayAndEdits();testDst();await testStatusApi();})()
  .catch(err=>{console.error(err.stack||err);process.exitCode=1});
