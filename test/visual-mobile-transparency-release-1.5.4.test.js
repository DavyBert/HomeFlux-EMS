'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const settings=fs.readFileSync(path.join(root,'settings/index.html'),'utf8');
const ui=fs.readFileSync(path.join(root,'settings/visual-widget-profiles-ui.js'),'utf8');
const changes=require('../.homeychangelog.json');
const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
assert(ui.includes("choice.append(enable,create('span','vw-native-check-indicator'))"));
assert(ui.includes("choice.append(input,create('span','vw-native-check-indicator'))"));
assert(settings.includes('#vwBrightnessControls .vw-native-check-indicator'));
assert(settings.includes('input[type=checkbox]:checked + .vw-native-check-indicator::after'));
assert(settings.includes('input[type=checkbox]:focus-visible + .vw-native-check-indicator'));
assert(settings.includes('min-height:36px'));
for(const locale of ['nl','en','fr','de','es']){
 const note=changes['1.5.4'][locale];
 assert.equal(note.split('\n').length,2,`1.5.4 ${locale} release notes must have two lines`);
 assert(note.includes('Visual Look'),locale);
 assert(note.toLowerCase().includes('widget'),locale);
 assert(readme.includes(note),`README and changelog mismatch: ${locale}`);
}
assert.equal(require('../package.json').version,'1.5.4');
console.log('PASS mobile visibility for graph/brightness checkboxes and 2-line Visual Look release notes in 5 languages');
