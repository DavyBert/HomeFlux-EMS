'use strict';
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const statusDir = path.join(root,'widgets/status');
const compose = JSON.parse(readFileSync(path.join(statusDir,'widget.compose.json'),'utf8'));
const manifest = JSON.parse(readFileSync(path.join(root,'app.json'),'utf8'));
const statusHtml = readFileSync(path.join(statusDir,'public/index.html'),'utf8');
const visualHtml = readFileSync(path.join(statusDir,'public/visual.html'),'utf8');
const api = require('../widgets/status/api');

assert.equal(manifest.version,require('../package.json').version);
assert.deepEqual(manifest.widgets.status, {...compose, id:'status'});
const setting=compose.settings.find(x=>x.id==='visualLook');
assert(setting,'Visual Look option missing');
assert.equal(setting.value,false,'Existing installations must keep classic view by default');
assert.equal(setting.type,'checkbox');
for(const l of ['nl','en','fr','es','de'])assert(setting.title[l]);
assert.equal(compose.api.getStatus.path,'/status');
assert.equal(compose.api.getSavings.path,'/savings');
assert.equal(compose.api.getEvSavings.path,'/ev-savings');
assert(statusHtml.includes("enabled(settings, 'visualLook', false)"));
assert(statusHtml.includes('if (visualLook) {'));
assert(statusHtml.includes('renderStatus(latestStatus, settings, Homey)'));
assert(statusHtml.includes("'/status'"));
assert(!statusHtml.includes("collectHouseSample(latestStatus)"));
assert(statusHtml.includes("mergeHouseHistory(status.visualHouseHistory)"));
assert(statusHtml.includes("period === 'day' ? 60000 : 300000"),'Live day Savings must refresh within 1 minute; historical periods may retain 5 minute cache');
assert(statusHtml.includes('event.source !== visualView.contentWindow'),'Child messages must be authenticated');
assert(visualHtml.includes('homeflux.visual.status'));
assert(visualHtml.includes('initLiveWidget();'));
assert(!visualHtml.includes('setInterval(step,1000)'), 'Live Visual Look must not run 1s demo timer');
assert(visualHtml.includes('De woningbesparing en het PV-laadvoordeel'), 'Savings must not be double counted');

(async()=>{
 const calls=[];
 const homey={app:{
  localizeDisplay:x=>x,
  getSavingsStatus:x=>{calls.push(['house',x]);return {periodSavings:3.55,actualCost:2.23};},
  getSavingsCategory:x=>{calls.push(['ev',x]);return {ev_data_available:true,value:1.23};},
 }};
 assert.equal((await api.getSavings({homey,query:{days:'7'}})).periodSavings,3.55);
 assert.deepEqual(calls.at(-1),['house',{period:'rolling',days:7}]);
 assert.equal((await api.getSavings({homey,query:{days:'1'}})).actualCost,2.23);
 assert.deepEqual(calls.at(-1),['house',{period:'day',days:1}]);
 assert.equal((await api.getEvSavings({homey,query:{days:'30',ev:'2',category:'ev_grid'}})).value,1.23);
 assert.deepEqual(calls.at(-1),['ev',{category:'ev_grid',ev:'2',count:30,unit:'days',format:'kwh_price'}]);
 await api.getEvSavings({homey,query:{days:100000,ev:'abc',category:'other'}});
 assert.deepEqual(calls.at(-1),['ev',{category:'ev_savings',ev:'all',count:1,unit:'days',format:'kwh_price'}]);
 console.log('Visual Look 1.5.3 manifest, presentation and read-only API checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
