'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { replay, cases } = require('./active-charge-1.1.2.test');

(async () => {
  const beforeRoot = path.resolve(process.argv[2]);
  const afterRoot = path.resolve(process.argv[3] || path.join(__dirname, '..'));
  const results = {};
  for (const scenario of cases) {
    const before = await replay(beforeRoot, scenario);
    const after = await replay(afterRoot, scenario);
    for (const key of ['traces', 'contexts', 'flexible', 'samples']) {
      assert.deepEqual(after[key], before[key], `${scenario}: ${key}`);
    }
    results[scenario] = { before, after, exactOutputAndTimingMatch: true };
  }
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
