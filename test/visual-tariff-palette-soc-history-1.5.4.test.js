'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const store=require('../lib/visual-widget-profiles');
const visual=fs.readFileSync(path.join(root,'widgets/status/public/visual.html'),'utf8');
const parent=fs.readFileSync(path.join(root,'widgets/status/public/index.html'),'utf8');
const ui=fs.readFileSync(path.join(root,'settings/visual-widget-profiles-ui.js'),'utf8');
const settings=fs.readFileSync(path.join(root,'settings/index.html'),'utf8');

const db=new Map();
const homey={settings:{get:key=>structuredClone(db.get(key)||null),set:(key,val)=>db.set(key,structuredClone(val))}};
const medium=store.get(homey,'medium');
assert.equal(medium.themes.light.tariffColors.cheap,null);
assert.equal(medium.themes.dark.tariffColors.expensive,null);
medium.themes.dark.tariffColors={cheap:'#123456',normal:'#AbCdEf',expensive:'#FF6600',other:'#ffffff'};
medium.themes.light.tariffColors={cheap:'#09CC89',normal:'#00aacc',expensive:'invalid'};
store.save(homey,'medium',medium);
const got=store.get(homey,'medium');
assert.deepEqual(got.themes.dark.tariffColors,{cheap:'#123456',normal:'#ABCDEF',expensive:'#FF6600'});
assert.deepEqual(got.themes.light.tariffColors,{cheap:'#09CC89',normal:'#00AACC',expensive:null});
assert.equal(store.get(homey,'full').themes.dark.tariffColors.cheap,null);
assert.deepEqual([...db.keys()],[store.STORAGE_KEY]);
assert(ui.includes('const TARIFF_DEFAULT_COLORS'));
assert(ui.includes("'tariff:'+kind"));
assert(settings.includes('id="vwTariffColors"'));
assert(parent.includes('tariffColors:theme.tariffColors||{}'));
assert(visual.includes('applyTariffPalette(event.data.tariffColors)'));
assert(visual.includes('--hf-waf-brand'));
assert(visual.includes('--hf-charge-accent'));
assert(visual.includes('--hf-next-tariff-accent'));
assert(visual.includes('function tariffShadeColor(kind, price, stats)'));
assert(visual.includes('visualMix(base,ratio>'));

// The chart now consumes the central, measured SOC feed, never localStorage.
function between(text,start,end){
 const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
 assert(a>=0&&b>a);return text.slice(a,b);
}
const code=between(visual,'let centralSocObservations=[];','const LIVE_CALC_INTERVAL_MS=60000;');
const HOUR_MS=3600000;
const dayStartOf=at=>{const d=new Date(at);d.setHours(0,0,0,0);return d.getTime()};
const at=dayStartOf(Date.now())+10*HOUR_MS;
const context=vm.createContext({Date,Number,Math,Array,JSON,HOUR_MS,dayStartOf});
const observed=vm.runInContext(code+'\n({load:rows=>{centralSocObservations=readCentralSocHistory(rows)},points:observedSocPoints})',context);
observed.load([{soc:63.5,socAt:at},{soc:64.5,socAt:at+305000},{soc:300,socAt:at+350000},{soc:null,socAt:at+360000}]);
assert.equal(observed.points(at+310000).length,2);
assert.equal(observed.points(at+310000)[0].soc,63.5);
assert.equal(observed.points(at+310000)[1].at,at+305000);
assert.equal(observed.points(at-HOUR_MS).length,0,'no future observation is shown as history');
assert.equal(observed.points(dayStartOf(at)+24*HOUR_MS+3600000).length,0,'no previous-day mixture');
assert(!visual.includes('localStorage'),'central SOC has one storage source');
assert(visual.includes('h,soc:lookupSoc(h),estimated:true'), 'first goal shown from actual predicted curve');
assert(visual.includes('socObserved'), 'observed history is rendered separately');
assert(visual.includes('START ${clockText(first.h*60)}'), 'first real reading is visibly labeled');
assert(!visual.includes('soc0+(plannerGoal-soc0)*progress')||visual.includes('firstSoc=atFirst'));
console.log('PASS tariff palette per profile/theme, coordinated accents, central measured SOC history and first-goal forecast');
