'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./ev-feedback-1.0.11.test');
async function main() {
  if (!process.argv[2]) throw Error('Usage: node test/ev-feedback-comparison-1.0.11.js /path/to/original-1.0.10');
  const baseline = await run(path.resolve(process.argv[2]),false);
  const current = await run();
  const comparisons = current.map((r,index) => {
    const old = baseline[index]; assert.equal(old.name,r.name);
    return { name:r.name,
      before:old.final, after:r.final,
      beforeBatteryPublications:old.batteryPublishes.length, afterBatteryPublications:r.batteryPublishes.length,
      individualBatteryTraceIdentical:JSON.stringify(old.batteryPublishes)===JSON.stringify(r.batteryPublishes),
      evTraceIdentical:JSON.stringify(old.evPublishes)===JSON.stringify(r.evPublishes),
      beforeFastEvaluations:old.fastEvaluations,afterFastEvaluations:r.fastEvaluations,
      beforeStatusPublishes:old.statusPublishes,afterStatusPublishes:r.statusPublishes };
  });
  for (const name of ['three-phase-16A','tariff-disabled','mode-only-detection']) {
    const r=comparisons.find(x=>x.name===name);
    assert(r.individualBatteryTraceIdentical && r.evTraceIdentical, `${name}: unaffected full output traces must remain identical`);
  }
  const report = { version:'1.0.11', baselineVersion:'1.0.10', scenarioCount:current.length,
    measurement:'Real application scheduler and I/O routes; virtual clock and mocked Homey I/O/car/site. No hardware CPU claim.',
    comparisons, traces:{baseline,current} };
  const output = path.join(__dirname,'../docs/EV-FEEDBACK-COMPARISON-1.0.11.json');
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.table(comparisons.map(r=>({scenario:r.name,oldEVgridW:r.before.active,newEVgridW:r.after.active,oldBatteryW:r.before.batteryW,newBatteryW:r.after.batteryW,sameBatteryTrace:r.individualBatteryTraceIdentical})));
  console.log(`${current.length} scheduler comparisons passed; complete individual battery, EV, Split and context traces saved.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
