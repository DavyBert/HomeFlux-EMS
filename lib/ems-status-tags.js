'use strict';
// Read-only projections of existing controller results and the cached WAF.
const { translate, normalizeLanguage } = require('./display-language');
const locales = { en: require('../locales/en.json'), nl: require('../locales/nl.json') };
const tr = (language,key,fallback) => {if(!locales[language])locales[language]=require(`../locales/${language}.json`);return key.split('.').reduce((v,k)=>v?.[k],locales[language])??fallback;};
    function decision(status, language) {
      const state = emsDecisionState(status);
      if (state === 'input') return tr(language, 'widget.status.decisionWaitingInput', 'Waiting for data');
      if (state === 'stop') return tr(language, 'widget.status.decisionSafetyStop', 'Safety stop');
      if (state === 'off') return tr(language, 'widget.status.decisionBatteryOff', 'Battery control off');
      if (state === 'pause') return tr(language, 'widget.status.decisionPaused', 'Battery control paused');
      if (state === 'external') return tr(language, 'widget.status.decisionExternal', 'External EMS control');
      if (state === 'pending') return tr(language, 'widget.status.decisionPending', 'Waiting for battery output');
      if (state === 'peak_limited') return tr(language, 'widget.status.decisionPeakLimited', 'Peak Guard limited');
      if (status.injectionActive === true) return tr(language, 'widget.status.modeInjection', 'Export to grid');
      const action = String(status.action || 'idle');
      const actionLabels = {
        peak_shave: tr(language, 'widget.status.decisionPeakShave', 'Peak Guard support'),
        grid_and_pv_charge: tr(language, 'widget.status.decisionGridPvCharge', 'Charging from grid and solar'),
        grid_charge: tr(language, 'widget.status.decisionGridCharge', 'Charging from grid'),
        pv_charge: tr(language, 'widget.status.decisionPvCharge', 'Charging from solar'),
        avoid_grid_import: tr(language, 'widget.status.decisionAvoidImport', 'Avoiding grid import'),
        discharge: tr(language, 'widget.status.decisionDischarge', 'Discharging battery'),
      };
      if (actionLabels[action]) return actionLabels[action];
      const base = String(status.baseMode || '');
      if (base === 'charge' && status.safetySocRecoveryActive) return tr(language, 'widget.status.decisionWaitingCharge', 'Waiting to charge');
      if (base === 'standby') return tr(language, 'widget.status.decisionStandby', 'Standby');
      if (base === 'charge' || base === 'solar_capture' || status.batteryPauseCode || status.batteryDischargeBlockedByEv)
        return tr(language, 'widget.status.decisionSaveBattery', 'Saving battery');
      if (base === 'manual_charge') return tr(language, 'widget.status.decisionWaitingCharge', 'Waiting to charge');
      if (base === 'avoid_import') return tr(language, 'widget.status.decisionAvoidImport', 'Avoiding grid import');
      return tr(language, 'widget.status.decisionSelfConsumption', 'Self-consumption');
    }

    function reason(status, language) {
      const state = emsDecisionState(status);
      if (state === 'input') return tr(language, 'widget.status.alertInput', 'Warning: grid measurement missing or outdated');
      if (state === 'stop') return tr(language, 'widget.status.reasonSafetyStop', 'Battery output is held at zero by the active safety stop');
      if (state === 'off') return tr(language, 'widget.status.reasonBatteryOff', 'HomeFlux battery output is disabled');
      if (state === 'pause') return tr(language, 'widget.status.reasonPaused', 'Battery control is paused; the last published setpoint is retained');
      if (state === 'external') return tr(language, 'widget.status.reasonExternal', 'Battery control has been handed over to the external EMS');
      if (state === 'pending') return tr(language, 'widget.status.reasonPending', 'The new battery command has not been published yet; the existing output still applies');
      if (state === 'peak_limited') return tr(language, 'widget.status.reasonPeakLimited', 'Peak Guard cannot request more battery support within the active limits');
      if (status.injectionActive === true) return tr(language, 'widget.status.reasonInjectionActive', 'Active export mode is controlling the battery for grid export');
      const action = String(status.action || 'idle');
      // Actual actions take precedence over reasons from a future charging plan.
      if (action === 'peak_shave') return tr(language, 'widget.status.reasonPeakGuard', 'Peak Guard is intervening above the configured grid limit');
      if (action === 'grid_charge' || action === 'grid_and_pv_charge') return tr(language, 'widget.status.reasonGridCharge', 'The battery needs charging to reach its target within the active charging window');
      if (action === 'pv_charge') return tr(language, 'widget.status.reasonPvCharge', 'Solar surplus is available to charge the battery');
      if (action === 'avoid_grid_import') return tr(language, 'widget.status.reasonAvoidImport', 'Grid import is being avoided by the active EMS/tariff rule');
      if (action === 'discharge') return tr(language, 'widget.status.reasonDischarge', 'The battery is supplying the current shortfall between consumption and solar');

      if (status.batteryDischargeBlockedByEv) return tr(language, 'widget.status.reasonEvDischargeBlocked', 'Battery discharge is blocked during EV charging');
      // Explain WHY battery saving is active, not only the SoC boundary at which
      // the already selected strategy happens to prevent further discharge.
      if (status.baseMode === 'solar_capture' && status.lowForecastBatterySaveActive) {
        return tr(language, status.lowForecastDischargeToTargetActive
          ? 'widget.status.reasonSaveLowPvTarget' : 'widget.status.reasonSaveLowPv',
          'Low PV forecast: battery energy is reserved for later use');
      }
      const strategy = status.tariff?.chargeStrategy;
      if (status.baseMode === 'charge' && !status.safetySocRecoveryActive
        && strategy?.mode === 'maximum' && !strategy.active
        && !(strategy.missingKwh > 0.000001) && !strategy.reserveMissed)
        return tr(language, 'widget.status.reasonChargeDeferred', 'Battery reserve preserved; charging scheduled for later.');
      const pauseReason = String(status.batteryPauseReason || '').trim();
      if (pauseReason) return pauseReason;
      const pauseCode = String(status.batteryPauseCode || '');
      const rawSoc = status.batteryDischargeFloorSoc ?? status.ordinaryDischargeFloorSoc;
      const pauseSocText = rawSoc !== null && rawSoc !== undefined && Number.isFinite(Number(rawSoc)) ? `${Number(rawSoc).toFixed(1)}%` : '';
      if (pauseCode === 'planning_floor') return `${tr(language, 'widget.status.reasonDischargePausedPlanning', 'Discharge paused at protected planning target')} ${pauseSocText}`.trim();
      if (pauseCode === 'discharge_floor') return `${tr(language, 'widget.status.reasonDischargePausedFloor', 'Discharge paused at configured discharge SoC')} ${pauseSocText}`.trim();
      if (pauseCode === 'minimum_soc') return `${tr(language, 'widget.status.reasonDischargePausedMinimum', 'Discharge paused at minimum SoC')} ${pauseSocText}`.trim();
      const mode = String(status.modeLabel || '').trim();
      const separator = mode.indexOf('·');
      if (separator >= 0) return mode.slice(separator + 1).trim();
      const warning = String(status.warningText || '').trim();
      if (warning) return warning;
      const base = String(status.baseMode || '');
      if (base === 'solar_capture') return tr(language, 'widget.status.reasonSaveBattery', 'Battery energy is being preserved for later use');
      if (base === 'charge') return tr(language, 'widget.status.reasonChargeDeferred', 'Battery reserve preserved; charging scheduled for later.');
      if (base === 'manual_charge') return tr(language, 'widget.status.reasonManualCharge', 'Manual charging mode is active');
      if (base === 'avoid_import') return tr(language, 'widget.status.reasonAvoidImport', 'Grid import is being avoided by the active EMS/tariff rule');
      if (base === 'standby') return tr(language, 'widget.status.reasonStandby', 'Standby mode is active');
      return tr(language, 'widget.status.reasonBalanced', 'Grid balance is around the configured target');
    }

    function emsDecisionState(status) {
      if (status.inputReady === false || status.baseMode === 'waiting_input') return 'input';
      if (status.baseMode === 'safety_stop') return 'stop';
      if (status.controlEnabled === false) return 'off';
      if (status.batteryCommandPauseActive) return 'pause';
      if (status.decisionExternalControl || status.hybridEms?.owner === 'external' || status.hybridEms?.delegated && !status.hybridEms?.takeover) return 'external';
      if (status.decisionOutputPending && status.injectionActive !== true) return 'pending';
      if ((status.action || 'idle') === 'idle' && status.override === 'peak_shave') return 'peak_limited';
      return '';
    }


function waf(budget, now) {
  const valid = Boolean(budget?.ready && budget.valueKwh !== null && budget.valueKwh !== undefined
    && budget.valueKwh !== '' && Number.isFinite(Number(budget.valueKwh))
    && now >= budget.calculatedAt && now < budget.validUntil);
  if (!valid) return { status: '', color: '' };
  const number = Number(budget.valueKwh);
  // Same continuous color as the widget. The nearest named color gives its
  // red/orange/green Logic status (hue midpoints 15 and 75 degrees).
  const hue = number <= 1 ? Math.max(0, Math.min(1, (number + 4) / 5)) * 30
    : 30 + Math.max(0, Math.min(1, (number - 1) / 6)) * 90;
  const lightness = hue <= 30 ? 42 - hue * .3
    : hue <= 60 ? 33 - (hue - 30) / 3 : 23 + (hue - 60) / 20;
  return { status: hue < 15 ? 'red' : hue < 75 ? 'orange' : 'green',
    color: `hsl(${hue}, 96%, ${lightness}%)` };
}
const definitions = [
  ['emsdecision', 'string', 'HomeFlux EMS - Current Decision', ''],
  ['emsdecisionreasons', 'string', 'HomeFlux EMS - Decision Reasons', ''],
  ['emswafstatus', 'string', 'HomeFlux EMS - WAF Status (red/orange/green)', ''],
  ['emswafcolor', 'string', 'HomeFlux EMS - WAF Color (HSL)', ''],
  ['emsbatterypausereason', 'string', 'HomeFlux EMS - Battery Pause Reason', ''],
  ['emsbatterypausecode', 'string', 'HomeFlux EMS - Battery Pause Code', ''],
  ['emsinputready', 'boolean', 'HomeFlux EMS - Inputs Ready', false],
  ['emsmissinginputs', 'string', 'HomeFlux EMS - Missing Inputs', ''],
  ['emscontrolenabled', 'boolean', 'HomeFlux EMS - Control Enabled', false],
  ['emstariff', 'string', 'HomeFlux EMS - Active Tariff', ''],
  ['emsplanningphase', 'string', 'HomeFlux EMS - Planning Phase', ''],
  ['emsbatterydischargeblocked', 'boolean', 'HomeFlux EMS - Battery Discharge Blocked By EV', false],
  ['emscriticalalert', 'string', 'HomeFlux EMS - Critical Alert', ''],
];
function values(result, budget, language = 'en', now = Date.now(), balance) {
  language = normalizeLanguage(language);
  const text = value => language === 'nl' ? String(value || '') : translate(String(value || ''),language);
  const color = waf(budget, now);
  const missing = (result.missingInputs || []).join(', ');
  const alert = result.inputReady === false ? tr(language, 'widget.status.alertInput', 'Warning: grid measurement missing or outdated')
    : result.safetySocRecoveryActive ? tr(language, 'widget.status.alertSafetySoc', 'Warning: battery safety reserve is being restored')
    : balance?.warningActive ? tr(language, 'widget.status.alertBalance', 'Warning: battery imbalance is worsening') : '';
  return {
    emsdecision: decision(result, language), emsdecisionreasons: text(reason(result, language)),
    emswafstatus: color.status, emswafcolor: color.color,
    emsbatterypausereason: text(result.batteryPauseReason), emsbatterypausecode: String(result.batteryPauseCode || ''),
    emsinputready: Boolean(result.inputReady), emsmissinginputs: text(missing),
    emscontrolenabled: Boolean(result.controlEnabled), emstariff: text(result.tariff?.label),
    emsplanningphase: String(result.planningPhase || ''),
    emsbatterydischargeblocked: Boolean(result.batteryDischargeBlockedByEv), emscriticalalert: alert,
  };
}
module.exports = { definitions, ids: new Set(definitions.map(([id]) => id)), values, waf };
