'use strict';
const assert = require('node:assert/strict');
const { fixture } = require('./ev-work-harness');
const { isEvTariffSelected, getEvPvTariffPolicy, evPowerPerAmp, evModeEstimatedCurrents } = require('../lib/flexible-loads');
const { installVirtualClearTimeout } = require('./pv-source-harness');
const restore = installVirtualClearTimeout();
const types = ['current','mode','hybrid'];
const contracts = ['tou','fixed','dynamic','dynamic_quarter'];
let comparisons = 0;
(async () => { try {
  for (const type of types) for (const contractType of contracts) {
    const h = await fixture({ type, evs: 2, chargeAllowed: true, batteries: 0, batteryEnabled: false });
    const a = h.app, stored = { ...a.getSettings(), contractType };
    stored.touRates = [
      { id:'a', avoidGridImport:false, evChargeAllowed: true, ev2ChargeAllowed:false,
        evPvChargeAllowed:false, ev2PvChargeAllowed:true, evPvGridTopUpAllowed:true,
        ev2PvGridTopUpAllowed:false, evPvMinSurplusW:1800, ev2PvStopGridImportW:1200 },
      { id:'b', avoidGridImport:true, evChargeAllowed:false, ev2ChargeAllowed:true,
        evPvGridTopUpAllowed:true, ev2PvGridTopUpAllowed:true },
    ];
    for (let index=0;index<2;index++) {
      stored[index ? 'ev2FeedbackTolerancePercent' : 'evFeedbackTolerancePercent'] = 20;
      stored[`_ev${index+1}ModeLoadTolerancePercent`] = 10;
      const old = a.getEvInstanceSettings(index, stored);
      const lite = a.getEvPhysicalAccountingSettingsFor(index, stored, 'parity_test');
      for (const key of ['evEnabled','evControlType','evModeLoadTolerancePercent','evPhases',
        'evVoltage','evVoltageReference','evMinCurrentA','evStandardCurrentA',
        'evModeSmartCurrentA','evModeStandardCurrentA','evWeight','evSmartGridPriority',
        'evDynamicCheapEnabled','evDynamicNormalEnabled','evDynamicExpensiveEnabled',
        'evFixedChargeWindowEnabled','evPvStartSurplusW','evPvStopSurplusW','evPvStopDelaySeconds']) {
        assert.deepEqual(lite[key],old[key], `${type}/${contractType}/ev${index+1}/${key}`);comparisons++;
      }
      assert.equal(evPowerPerAmp(lite),evPowerPerAmp(old));comparisons++;
      assert.deepEqual(evModeEstimatedCurrents(lite),evModeEstimatedCurrents(old));comparisons++;
      for (const tariff of [
        {rateId:'a',className:'cheap'}, {rateId:'b',className:'normal'},
        {rateId:'missing',className:'expensive'},
      ]) {
        assert.equal(isEvTariffSelected(lite,tariff),isEvTariffSelected(old,tariff));comparisons++;
        assert.deepEqual(getEvPvTariffPolicy(lite,tariff),getEvPvTariffPolicy(old,tariff));comparisons++;
      }
    }
  }
  // Physical accounting must be fresh per call and must not resolve any
  // SoC deadline even when a persistent 07:00 Flow goal is active.
  const h=await fixture({type:'mode',chargeAllowed:true,batteries:0,batteryEnabled:false}),a=h.app;
  await h.cards.get('set_ev1_soc_deadline').listener({target_soc:100,time:'07:00',guarantee:'yes'});
  let full=0,deadlines=0;
  const originalFull=a.getEvInstanceSettings, originalDeadline=a.getEvSocPlanDeadlineAt;
  a.getEvInstanceSettings=function(...args){full++;return originalFull.apply(this,args);};
  a.getEvSocPlanDeadlineAt=function(...args){deadlines++;return originalDeadline.apply(this,args);};
  const snapshot=a.getSettings();
  for(let n=0;n<180;n++) {
    a.getEvGridImportControlStatus(snapshot,h.now()+n*1000);
    a.getPlannedBatteryGridLimitW(snapshot,h.now()+n*1000);
  }
  assert.equal(full,0,'physical accounting must not build complete target/deadline settings');
  assert.equal(deadlines,0,'physical accounting must never expand SoC plan');
  a.inputMonitor.start();
  a.getEvGridImportControlStatus(snapshot,h.now());
  const report=a.inputMonitor.stop();
  assert(report.calculations.some(row=>row.kind==='evPhysicalSettingsRead'&&row.origin==='grid_import_control'));
  assert(!report.calculations.some(row=>row.kind==='evSettingsBuild'&&row.origin==='grid_import_control'));
  console.log(`1.1.16 physical settings: ${comparisons} tariff/electrical parity checks and 180 active-SoC accounting passes.`);
} finally {restore();} })().catch(error => {console.error(error);process.exitCode=1;});
