'use strict';
const assert=require('node:assert/strict'),{page}=require('./helpers/settings-page-1.2.37.cjs');
(async()=>{
 const h=await page('nl',{snapshot:{nightHysteresisEnabled:true,nightForecastHoldEnabled:true,nightHysteresisSoc:10}}),q=id=>h.doc.getElementById(id);
 for(const id of ['nightHysteresisEnabled','nightForecastHoldEnabled']){assert(q(id).checked);q(id).click();assert(!q(id).checked);}
 q('nightHysteresisSoc').value='11.5';q('save').click();for(let n=0;n<10;n++)await Promise.resolve();assert.deepEqual(h.alerts,[]);
 assert.equal(h.snapshot.nightHysteresisEnabled,false);assert.equal(h.snapshot.nightForecastHoldEnabled,false);assert.equal(h.snapshot.nightHysteresisSoc,11.5);assert.equal(typeof h.snapshot.nightHysteresisSoc,'number');
 assert.deepEqual(h.writes.map(x=>x.key).sort(),['nightForecastHoldEnabled','nightHysteresisEnabled','nightHysteresisSoc'].sort());
 const reopened=await page('nl',{snapshot:h.snapshot}),r=id=>reopened.doc.getElementById(id);assert(!r('nightHysteresisEnabled').checked);assert(!r('nightForecastHoldEnabled').checked);assert.equal(r('nightHysteresisSoc').value,'11.5');
 for(const id of ['nightHysteresisEnabled','nightForecastHoldEnabled'])r(id).click();r('save').click();for(let n=0;n<10;n++)await Promise.resolve();assert.deepEqual(reopened.alerts,[]);assert.equal(reopened.snapshot.nightHysteresisEnabled,true);assert.equal(reopened.snapshot.nightForecastHoldEnabled,true);assert(reopened.writes.every(x=>typeof x.value==='boolean'));
 const final=await page('nl',{snapshot:reopened.snapshot});assert(final.doc.getElementById('nightHysteresisEnabled').checked);assert(final.doc.getElementById('nightForecastHoldEnabled').checked);const legacy=await page('nl',{snapshot:{nightHysteresisEnabled:'false',nightForecastHoldEnabled:'false'}});assert(!legacy.doc.getElementById('nightHysteresisEnabled').checked);assert(!legacy.doc.getElementById('nightForecastHoldEnabled').checked);assert.equal(legacy.writes.length,0);legacy.doc.getElementById('save').click();for(let n=0;n<10;n++)await Promise.resolve();assert.deepEqual(legacy.alerts,[]);assert.equal(legacy.snapshot.nightHysteresisEnabled,false);assert.equal(legacy.snapshot.nightForecastHoldEnabled,false);h.close();reopened.close();final.close();legacy.close();
 console.log('Night options UI 1.2.37: real load/save/reopen passed for both checkboxes in both directions; margin remains numeric and unchanged fields are not saved.');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
