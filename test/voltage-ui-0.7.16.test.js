'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { voltageOptions, defaultVoltage, migrateVoltage } = require('../settings/ev-headroom');
const { evPowerPerAmp } = require('../lib/flexible-loads');
assert.deepEqual(voltageOptions(1), [100,110,115,120,127,200,208,220,230,240,254]);
assert.deepEqual(voltageOptions(3), [200,208,220,230,240,380,400,415,440,460,480,600]);
assert.equal(defaultVoltage(1), 230);
assert.equal(defaultVoltage(3), 230);
for (const [oldVoltage, newVoltage] of [[115,200],[120,208],[127,220],[220,380],[230,400],[240,415],[254,440],[277,480],[347,600]]) {
  assert.equal(migrateVoltage(3, oldVoltage, 'phase'), newVoltage);
  assert.equal(migrateVoltage(3, newVoltage, 'line'), newVoltage);
}
assert.equal(migrateVoltage(3,230,'line'),230); // Actual 3x230 V remains 3x230 V.
assert.equal(migrateVoltage(1,240,'phase'),240);
const html = fs.readFileSync(require.resolve('../settings/index.html'), 'utf8');
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
const fields = {};
for (let i=1;i<=4;i++) {
  const stem=i===1?'ev':`ev${i}`;
  fields[`${stem}Phases`] = {value:'3'};
  fields[`${stem}Voltage`] = {value:'400', dataset:{}, innerHTML:''};
  fields[`${stem}VoltageReference`] = {value:'line'};
  assert(html.includes(`type="hidden" id="${stem}VoltageReference"`));
  assert(!html.includes(`for="${stem}VoltageReference"`));
}
const context=vm.createContext({window:{HomeFluxEvHeadroom:{voltageOptions,defaultVoltage}},q:id=>fields[id],instanceStem:(kind,i)=>i===1?kind:`${kind}${i}`});
const source=html.match(/  function updateEvVoltageUi\([^\n]*\) \{[\s\S]*?\n  \}/)[0];
vm.runInContext(source,context);
for(let i=1;i<=4;i++) {
  const stem=i===1?'ev':`ev${i}`;
  context.updateEvVoltageUi(i);
  assert.equal(fields[`${stem}Voltage`].value,'400');
  assert.equal(fields[`${stem}VoltageReference`].value,'line');
  assert(!fields[`${stem}Voltage`].innerHTML.includes('value="120"'));
  const power=16*evPowerPerAmp({evPhases:3,evVoltage:400,evVoltageReference:fields[`${stem}VoltageReference`].value});
  assert(Math.abs(power-11085.1251684408)<0.001);
  assert(power<12000);
  fields[`${stem}Voltage`].value='208';context.updateEvVoltageUi(i);
  assert.equal(fields[`${stem}Voltage`].value,'208'); // Preview updates preserve choice.
  fields[`${stem}Phases`].value='1';context.updateEvVoltageUi(i);
  assert.equal(fields[`${stem}Voltage`].value,'230');
  assert.equal(fields[`${stem}VoltageReference`].value,'phase');
  assert(!fields[`${stem}Voltage`].innerHTML.includes('value="400"'));
  fields[`${stem}Voltage`].value='120';context.updateEvVoltageUi(i);
  assert.equal(fields[`${stem}Voltage`].value,'120');
  fields[`${stem}Phases`].value='3';context.updateEvVoltageUi(i);
  assert.equal(fields[`${stem}Voltage`].value,'230');
  context.updateEvVoltageUi(i,1,120); // Loading a stored single-phase selection.
  assert.equal(fields[`${stem}Voltage`].value,'120');
  context.updateEvVoltageUi(i,3,480); // Loading a stored three-phase selection.
  assert.equal(fields[`${stem}Voltage`].value,'480');
}
console.log('0.7.16 phase-specific voltage options, migration and UI switching passed');
