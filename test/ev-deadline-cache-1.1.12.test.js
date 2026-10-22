'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const req = createRequire(path.join(root, 'package.json'));
const { localParts } = req('./lib/homey-energy');
// Original algorithm is the behavioural oracle, including its 26-hour fallback.
function reference(nowInput, timeValue, timezone = 'UTC') {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeValue || '').trim());
  const hour = match ? Number(match[1]) : -1, minute = match ? Number(match[2]) : -1;
  if (!match || hour > 23 || minute > 59) return new Date(now.getTime() + 86400000);
  for (let offset = 1; offset <= 1560; offset++) {
    const candidate = new Date(now.getTime() + offset * 60000);
    if (localParts(candidate, timezone).minuteOfDay === hour * 60 + minute) return candidate;
  }
  return new Date(now.getTime() + 86400000);
}
let conversions = 0;
const source = fs.readFileSync(path.join(root, 'lib/flexible-loads.js'), 'utf8');
const mod = { exports: {} };
vm.runInNewContext(source + '\nmodule.exports.cacheSizeForTest = () => nextLocalTimeCache.size;', {
  module: mod, exports: mod.exports, Date,
  require: id => id === './homey-energy' ? { localParts: (...args) => { conversions++; return localParts(...args); } }
    : createRequire(path.join(root, 'lib/flexible-loads.js'))(id),
});
const find = mod.exports.findNextLocalTime;
let cases = 0;
function same(now, target, zone) {
  const a = () => find(now, target, zone).getTime(), b = () => reference(now, target, zone).getTime();
  let expected, error;
  try { expected = b(); } catch (e) { error = e; }
  if (error) assert.throws(a, e => e.name === error.name && e.message === error.message);
  else assert(Object.is(a(), expected), `${now}/${target}/${zone}`);
  cases++;
}
for (const zone of ['UTC', 'Europe/Brussels', 'America/New_York', 'Asia/Kathmandu', 'Australia/Lord_Howe']) {
  for (const instant of [
    '2026-10-22T04:59:59.999Z', '2026-10-22T05:00:00.000Z', '2026-10-22T05:00:00.001Z',
    '2026-10-22T05:00:40.123Z', '2026-10-22T23:59:59.999Z',
    '2026-03-29T00:59:30.456Z', '2026-03-29T01:00:00.000Z',
    '2026-10-25T00:29:30.123Z', '2026-10-25T01:29:30.123Z',
  ]) for (const target of ['00:00', '02:30', '07:00', '23:59']) same(new Date(instant), target, zone);
}
for (const target of ['', null, undefined, '24:00', '07:60', 'oops', '7:00', ' 07:00 ']) same(new Date('2026-10-22T00:00:00Z'), target, 'Europe/Brussels');
for (const zone of ['Bad/Zone', '', null, {}]) same(new Date('2026-10-22T00:00:00Z'), '07:00', zone);
same(new Date(NaN), '07:00', 'UTC'); same('invalid', '07:00', 'UTC');
const at = new Date('2026-11-01T00:00:12.345Z');
const first = find(at, '07:00', 'Europe/Brussels'), value = first.getTime(), count = conversions;
first.setFullYear(1999);
for (let n = 0; n < 100; n++) {
  const result = find(new Date(at), '07:00', 'Europe/Brussels');
  assert.equal(result.getTime(), value); assert.notEqual(result, first);
}
assert.equal(conversions, count, 'identical calls must perform no timezone scans'); cases++;
for (let n = 1; n <= 40; n++) same(new Date(at.getTime() + n), '07:00', 'Europe/Brussels');
assert.equal(mod.exports.cacheSizeForTest(), 32, 'cache size is strictly bounded');
const beforeEvicted = conversions; find(at, '07:00', 'Europe/Brussels');
assert(conversions > beforeEvicted, 'evicted entry must be safely recomputed'); cases++;
// Changing either target or zone cannot reuse a different deadline.
same(at, '08:00', 'Europe/Brussels'); same(at, '07:00', 'UTC');
console.log(`1.1.12 EV deadline cache: ${cases} reference/boundary checks passed.`);
