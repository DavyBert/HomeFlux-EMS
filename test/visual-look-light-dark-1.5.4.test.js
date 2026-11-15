'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const spec=JSON.parse(fs.readFileSync(path.join(root,'widgets/status/widget.compose.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
const index=fs.readFileSync(path.join(root,'widgets/status/public/index.html'),'utf8');
const visual=fs.readFileSync(path.join(root,'widgets/status/public/visual.html'),'utf8');
const changes=JSON.parse(fs.readFileSync(path.join(root,'.homeychangelog.json'),'utf8'));
assert.equal(manifest.version,'1.5.4');
assert.deepEqual(manifest.widgets.status,{...spec,id:'status'});
assert.equal(spec.settings[0].id,'visualLook');
assert.equal(spec.settings[0].value,false);
const choice=id=>spec.settings.find(x=>x.id===id);
assert(choice('visualProfile')&&choice('visualProfile').value==='medium');
assert(!choice('visualBackground')&&!choice('visualLightBackground'));
const profiles=require('../lib/visual-widget-profiles');
const defaults=profiles.defaults();
for(const p of ['compact','medium','full']){
 assert(defaults[p].themes.dark&&defaults[p].themes.light);
 assert.equal(defaults[p].themes.dark.background,null);
 assert.equal(defaults[p].themes.light.background,null);
}
const settingsUi=fs.readFileSync(path.join(root,'settings/visual-widget-profiles-ui.js'),'utf8');
assert(settingsUi.includes('type')&&settingsUi.includes("colorPicker"));
assert(settingsUi.includes('cardBackground'));
assert(settingsUi.includes('theme'));
for(const x of ['activeHomeyMode','homey-dark-mode','--homey-background-color','prefers-color-scheme: dark',
 'MutationObserver','activeVisualTheme','sendVisualAppearance(true)','homeflux.visual.appearance'])assert(index.includes(x),x);
for(const x of ['homeflux.visual.ready','homeflux.visual.status','homeflux.visual.height','applyVisualAppearance'])assert(visual.includes(x),x);
for(const lang of ['en','nl','fr','es','de'])assert(changes['1.5.4'][lang].length>100);
console.log('PASS Light/Dark backgrounds and card colors now come from three separate profiles, theme detection and styling unchanged');
