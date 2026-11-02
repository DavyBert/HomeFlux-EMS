'use strict';
const path = require('node:path');
const { setup } = require('./pv-source-harness');
const START = Date.parse('2026-10-23T10:00:00Z');
const ROOT = path.resolve(__dirname, '..');
const stem = i => i ? `ev${i + 1}` : 'ev';

async function fixture({ root = ROOT, type = 'mode', evs = 1, batteries = 1, batteryEnabled = true,
  connected = true, chargeAllowed = false, pv = 0, extra = {} } = {}) {
  const settings = { forcedMode: 'self_consumption', batteryCount: batteries,
    totalCapacityKwh: Math.max(1, batteries) * 5.4, controlEnabled: false,
    maxTotalDischargeW: 2000, maxDischargePerBatteryW: 2000,
    exportLimitEnabled: false, peakShaveEnabled: false, evCount: evs,
    contractType: 'tou', touRates: [{ id: 'test', name: 'Test', importPrice: .2, feedInPrice: .03,
      weekdayChargeMode: 'never', weekendChargeMode: 'never', evMaxGridImportW: 40000,
      ...Object.fromEntries(Array.from({ length: evs }, (_, i) => [stem(i) + 'ChargeAllowed', chargeAllowed])),
      ...Object.fromEntries(Array.from({ length: evs }, (_, i) => [stem(i) + 'PvChargeAllowed', true])) }],
    touSchedule: [{ rateId: 'test', start: '00:00', end: '00:00', days: [1,2,3,4,5,6,7] }],
    ...extra };
  for (let i = 0; i < evs; i++) for (const [key, value] of Object.entries({ Enabled: true, SocEnabled: true,
    Mode: 'smart', ControlType: type, Phases: 3, Voltage: 400, VoltageReference: 'line',
    MinCurrentA: 6, MaxCurrentA: 16, StandardCurrentA: 16, ModeStandardCurrentA: 16, ModeSmartCurrentA: 6,
    AfterSocTarget: 'stop', TargetSoc: 80, GuaranteeTarget: false, SmartGridPriority: 'ev_first',
    CommandIntervalSeconds: 7, PeakGuardStopHoldSeconds: 0, PeakGuardBatteryAssistNormal: false,
    PeakGuardBatteryAssistEmergency: false, NightSurplusChargeEnabled: false,
    PvGridTopUpMode: 'off', PvStartSurplusW: 1000, PvStopSurplusW: 0, PvStopDelaySeconds: 0 })) {
    settings[stem(i) + key] = value;
  }
  const h = await setup(root, settings, START, pv), a = h.app;
  a.state.pvProducingDate = a.getLocalDateKey(new Date(h.now()));
  a.state.pvSeenProducingToday = true;
  a.state.nightPlanningActive = false;
  for (const [id, card] of h.cards) if (/^ev[1-4]_(charge_current|charging_allowed|charge_mode)_updated$/.test(id)) {
    card.trigger = async tokens => h.flexible.push({ at: h.now(), id, tokens });
  }
  for (let i = 0; i < evs; i++) {
    await h.cards.get(`set_ev${i + 1}_status`).listener({ connected: connected ? 'yes' : 'no', charge_current: 0 });
    await h.cards.get(`set_ev${i + 1}_soc`).listener({ soc: 50 });
  }
  if (batteryEnabled && batteries > 0) {
    h.store.set('_chargeTestSignature', a.getChargeTestSignature(a.getSettings()));
    await h.setExternalSetting('controlEnabled', true);
  }
  await h.grid(623 - pv - a.state.lastTotalCommandW);
  await h.start(); await h.flush();
  h.setNow(h.now() + 8000); await h.flush();
  await h.grid(623 - pv - a.state.lastTotalCommandW);
  await h.start(); await h.flush();
  return h;
}
module.exports = { fixture, ROOT, START };
