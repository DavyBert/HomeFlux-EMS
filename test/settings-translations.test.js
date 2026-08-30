'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const en = JSON.parse(fs.readFileSync(path.join(root, 'settings', 'translations', 'en.json'), 'utf8'));
const nl = JSON.parse(fs.readFileSync(path.join(root, 'settings', 'translations', 'nl.json'), 'utf8'));
assert.equal(en.language, 'en');
assert.equal(nl.language, 'nl');
assert(Object.keys(en.exact || {}).length >= 500, 'English static UI translation map unexpectedly small');
assert(Object.keys(en.phrases || {}).length >= 200, 'English dynamic phrase translation map unexpectedly small');
for (const key of ['planning.forecastDecisionTomorrow','planning.forecastDecisionToday']) {
  assert.equal(typeof en.strings?.[key], 'string', 'English translation missing: ' + key);
  assert.equal(typeof nl.strings?.[key], 'string', 'Dutch translation missing: ' + key);
}
console.log('settings translation bundle tests passed');
