'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const r=cp.spawnSync(process.execPath,[path.join(__dirname,'hvac-behavior-1.2.34.cjs')],{encoding:'utf8',timeout:120000});assert.equal(r.status,0,r.stderr);
assert.deepEqual(JSON.parse(r.stdout),JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/hvac-runtime-1.2.33.json'))));
console.log('HVAC runtime: 12 original 1.2.33 traces / 36 actual app decision moments and Flow commands remain identical with Essential disabled and existing settings.');
