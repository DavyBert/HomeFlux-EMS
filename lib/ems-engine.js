'use strict';

const DEFAULTS = {
  batteryCount: 4,
  totalCapacityKwh: 21.6,
  minSoc: 10,
  safetySoc: 10,
  maxSoc: 100,
  maxTotalChargeW: 7500,
  maxTotalDischargeW: 8000,
  maxChargePerBatteryW: 2300,
  maxDischargePerBatteryW: 2400,
  balanceEnabled: true,
  balanceDeadbandPct: 1,
  balanceStrength: 0.2,
  balanceWarningEnabled: true,
  balanceWarningSpreadPct: 4,
  balanceWarningGrowthPct: 1.5,
  balanceWarningDelayMinutes: 15,
  balanceWarningMinCommandW: 400,
  controlEnabled: false,
  chargeTestPassed: false,
  invertBatteryCommand: false,
  batteryCommandStepW: 1,
  peakShaveEnabled: true,
  peakLimitW: 2500,
  peakSoftMarginW: 100,
  commandIntervalSeconds: 10,
  slowControlIntervalSeconds: 60,
  batteryCommandPauseEnabled: false,
  batteryCommandPauseStart: '23:59',
  batteryCommandPauseEnd: '00:00',
  pvCommandIntervalSeconds: 10,
  commandDeadbandW: 25,
  gridZeroMinW: -5,
  gridZeroMaxW: 25,
  exportLimitEnabled: false,
  minimumExportW: 50,
  pvCurtailMinBatterySoc: 95,
  contractType: 'tou',
  dynamicPriceSource: 'homey',
  dynamicUseBatteryNormalHours: false,
  batterySaveDischargeAboveSoc: 100,
  lowForecastMode: 'self_consumption', // legacy compatibility; category flags are authoritative from v0.2.20
  lowForecastSelfConsumptionMinKwh: 5,
  lowForecastFixedEnabled: false,
  lowForecastFixedDischargeToTarget: false,
  lowForecastDynamicCheapEnabled: false,
  lowForecastDynamicCheapDischargeToTarget: false,
  lowForecastDynamicNormalEnabled: false,
  lowForecastDynamicNormalDischargeToTarget: false,
  lowForecastDynamicExpensiveEnabled: false,
  lowForecastDynamicExpensiveDischargeToTarget: false,
  dynamicPriceDataReady: true,
  fixedImportPrice: 0.30,
  fixedFeedInPrice: 0.03,
  fixedChargeWindowStart: '01:00',
  fixedChargeWindowEnd: '07:00',
  cheapHours: 3,
  expensiveHours: 3,
  expectedEnergyNeedKwh: 20,
  planningMinIntervalMinutes: 5,
  // Legacy reserve fields are retained for migration/backward-compatible raw engine calls.
  peakReserveKwh: 0,
  peakReservePercent: 0,
  // Absolute minimum SoC requested for selected months. The UI exposes only
  // this value from v0.3.88 onward; the engine converts it to kWh internally.
  peakReserveTargetSoc: null,
  peakReserveSeasonWinter: true,
  peakReserveSeasonSpring: true,
  peakReserveSeasonSummer: false,
  peakReserveSeasonAutumn: true,
  peakReserveMonth1: true,
  peakReserveMonth2: true,
  peakReserveMonth3: true,
  peakReserveMonth4: true,
  peakReserveMonth5: true,
  peakReserveMonth6: false,
  peakReserveMonth7: false,
  peakReserveMonth8: false,
  peakReserveMonth9: true,
  peakReserveMonth10: true,
  peakReserveMonth11: true,
  peakReserveMonth12: true,
  // Optional PV-first minimum for months that are not selected above. This is
  // deliberately disabled on upgrade so existing installations keep exactly
  // the same daytime reserve behaviour until the user opts in.
  sunnyMonthsMinSocEnabled: false,
  sunnyMonthsMinSoc: 20,
  // Optional v0.3.84 behaviour: apply the configured monthly minimum/reserve
  // during night planning as well. Disabled on upgrade to preserve behaviour.
  peakReserveNightEnabled: false,
  chargeDeadline: '07:00',
  solarTargetTime: '17:00',
  touRates: [
    { id: 'superdal', name: 'Superdal', importPrice: 0, feedInPrice: 0, weekdayChargeMode: 'night', weekendChargeMode: 'night', nightChargeAllowed: true, dayChargeAllowed: false, avoidGridImport: false, lowForecastDischargeToTarget: false, evChargeAllowed: true, evPvChargeAllowed: true, evPvMinSurplusW: 0, evPvStopGridImportW: 1000 },
    { id: 'dal', name: 'Dal', importPrice: 0, feedInPrice: 0, weekdayChargeMode: 'day', weekendChargeMode: 'day', nightChargeAllowed: false, dayChargeAllowed: true, avoidGridImport: false, lowForecastDischargeToTarget: false, evChargeAllowed: false, evPvChargeAllowed: true, evPvMinSurplusW: 0, evPvStopGridImportW: 1000 },
    { id: 'piek', name: 'Piek', importPrice: 0, feedInPrice: 0, weekdayChargeMode: 'never', weekendChargeMode: 'never', nightChargeAllowed: false, dayChargeAllowed: false, avoidGridImport: true, lowForecastDischargeToTarget: false, evChargeAllowed: false, evPvChargeAllowed: true, evPvMinSurplusW: 0, evPvStopGridImportW: 1000 },
  ],
  touSchedule: [
    { rateId: 'superdal', start: '01:00', end: '07:00', days: [1, 2, 3, 4, 5, 6, 7] },
    { rateId: 'piek', start: '07:00', end: '11:00', days: [1, 2, 3, 4, 5] },
    { rateId: 'dal', start: '07:00', end: '11:00', days: [6, 7] },
    { rateId: 'dal', start: '11:00', end: '17:00', days: [1, 2, 3, 4, 5, 6, 7] },
    { rateId: 'piek', start: '17:00', end: '22:00', days: [1, 2, 3, 4, 5] },
    { rateId: 'dal', start: '17:00', end: '22:00', days: [6, 7] },
    { rateId: 'dal', start: '22:00', end: '01:00', days: [1, 2, 3, 4, 5, 6, 7] },
  ],
  dynamicSlots: [],
  forcedMode: 'auto',
  forcedModeResumeAt: 0,
  overrideResumeOnTariffChange: true,
  controlProfile: 'normal',
  pvDeltaThresholdW: 100,
  // Legacy read compatibility only. Forced manual charging no longer uses a
  // separate power limit; it requests the configured EMS charging maximum.
  manualChargeW: 1500,

  // Optional EV flexible-load module. Disabled by default so existing installs
  // require no extra inputs and Live status stays unchanged until enabled.
  evCount: 0,
  evName: '',
  evEnabled: false,
  evSocEnabled: true,
  evMode: 'smart',
  evControlType: 'current', // current = ampere setpoint, mode = stop/smart/standard (e.g. Smappee)
  evSmartPvPriority: 'battery_first',
  evSmartPvExportTargetW: 500,
  evSmartGridPriority: 'battery_first',
  evBatteryCapacityKwh: 60,
  evTargetSoc: 80,
  evTargetTime: '07:00',
  evGuaranteeTarget: true,
  evPhases: 3,
  evMinCurrentA: 6,
  evMaxCurrentA: 32,
  evStandardCurrentA: 16,
  evCommandIntervalSeconds: 10,
  evPeakGuardStopHoldSeconds: 60,
  evFixedChargeWindowEnabled: true,
  evDynamicCheapEnabled: true,
  evDynamicNormalEnabled: false,
  evDynamicExpensiveEnabled: false,

  // Optional HVAC flexible-load module. The default PV thresholds mirror the
  // field-tested -800/-200 W strategy and a five-minute control cadence.
  hvacCount: 0,
  hvacName: '',
  hvacEnabled: false,
  hvacAutomaticControlEnabled: true,
  hvacAllowOnBattery: false,
  hvacUsePvSurplus: true,
  // v0.3.48: room temperature selects heat/cool. Outdoor temperature is no
  // longer a mode gate; it only shapes fan speed while a PV HVAC session runs.
  hvacComfortMinC: 21,
  hvacComfortMaxC: 23,
  hvacEnergyDeviationC: 2,
  hvacHeatingActivationBelowC: 20,
  hvacCoolingActivationAboveC: 24,
  hvacPriority: 'comfort',
  hvacCoolingFanProfile: 'normal',
  hvacHeatingFanProfile: 'normal',
  // Legacy settings are kept in defaults for upgrade/read compatibility only.
  hvacCoolingOutdoorThresholdC: 25,
  hvacHeatingOutdoorThresholdC: 18,
  hvacCoolingMinC: 19,
  hvacCoolingMaxC: 24,
  hvacHeatingMinC: 20,
  hvacHeatingMaxC: 23,
  hvacControlIntervalMinutes: 5,
  hvacSurplusStartW: 800,
  hvacSurplusStopW: 200,
  hvacMinBatterySoc: 90,
  hvacStopBatterySoc: 50,
  hvacFastResetImportW: 1000,
  hvacAllowPowerControl: false,
  hvacAllowModeControl: false,
  hvacAllowSetpointControl: true,
  hvacAllowFanControl: false,
  // Generic fan output scale. Mitsubishi installations can use 100/500/100.
  hvacFanMinValue: 0,
  hvacFanMaxValue: 100,
  hvacFanStepValue: 10,

  // Boiler: one cumulative heating cycle per day. The output itself is a simple
  // boolean Flow trigger; HomeFlux only decides when it may be on.
  boilerCount: 0,
  boilerEnabled: false,
  boilerName: 'Boiler',
  boilerStartSoc: 90,
  boilerStopSoc: 70,
  boilerPowerW: 1800,
  boilerCycleMinutes: 90,
  boilerColdResetTime: '07:00',
  boilerFallbackDays: 3,
  boilerTariffMinBatterySoc: 40,
  boilerTariffStopBatterySoc: 30,
  boilerFixedChargeWindowEnabled: false,
  boilerDynamicCheapEnabled: false,
  boilerDynamicNormalEnabled: false,
  boilerDynamicExpensiveEnabled: false,
  priorityEvaluationMinutes: 5,
  flexibleLoadPriorityOrder: ['boiler', 'hvac1', 'hvac2', 'hvac3', 'hvac4'],

  timezone: 'Europe/Brussels',
};


// Additional EV/HVAC instances use the exact same setting model as instance 1.
// Instance 1 deliberately keeps the historical unnumbered keys so every
// existing installation and Flow remains compatible.
const EV_INSTANCE_DEFAULT_KEYS = [
  'Enabled','Name','SocEnabled','Mode','ControlType','SmartPvPriority','SmartPvExportTargetW',
  'SmartGridPriority','BatteryCapacityKwh','TargetSoc','TargetTime','GuaranteeTarget','Phases',
  'MinCurrentA','MaxCurrentA','StandardCurrentA','CommandIntervalSeconds','PeakGuardStopHoldSeconds',
  'FixedChargeWindowEnabled','DynamicCheapEnabled','DynamicNormalEnabled','DynamicExpensiveEnabled',
];
const EV_INSTANCE_DEFAULT_SOURCE = {
  Enabled: DEFAULTS.evEnabled,
  Name: '',
  SocEnabled: DEFAULTS.evSocEnabled,
  Mode: DEFAULTS.evMode,
  ControlType: DEFAULTS.evControlType,
  SmartPvPriority: DEFAULTS.evSmartPvPriority,
  SmartPvExportTargetW: DEFAULTS.evSmartPvExportTargetW,
  SmartGridPriority: DEFAULTS.evSmartGridPriority,
  BatteryCapacityKwh: DEFAULTS.evBatteryCapacityKwh,
  TargetSoc: DEFAULTS.evTargetSoc,
  TargetTime: DEFAULTS.evTargetTime,
  GuaranteeTarget: DEFAULTS.evGuaranteeTarget,
  Phases: DEFAULTS.evPhases,
  MinCurrentA: DEFAULTS.evMinCurrentA,
  MaxCurrentA: DEFAULTS.evMaxCurrentA,
  StandardCurrentA: DEFAULTS.evStandardCurrentA,
  CommandIntervalSeconds: DEFAULTS.evCommandIntervalSeconds,
  PeakGuardStopHoldSeconds: DEFAULTS.evPeakGuardStopHoldSeconds,
  FixedChargeWindowEnabled: DEFAULTS.evFixedChargeWindowEnabled,
  DynamicCheapEnabled: DEFAULTS.evDynamicCheapEnabled,
  DynamicNormalEnabled: DEFAULTS.evDynamicNormalEnabled,
  DynamicExpensiveEnabled: DEFAULTS.evDynamicExpensiveEnabled,
};
for (let instance = 2; instance <= 4; instance += 1) {
  for (const suffix of EV_INSTANCE_DEFAULT_KEYS) DEFAULTS[`ev${instance}${suffix}`] = EV_INSTANCE_DEFAULT_SOURCE[suffix];
}

const HVAC_INSTANCE_DEFAULT_KEYS = [
  'Enabled','Name','AutomaticControlEnabled','AllowOnBattery','UsePvSurplus','ComfortMinC','ComfortMaxC','EnergyDeviationC',
  'HeatingActivationBelowC','CoolingActivationAboveC','Priority','CoolingFanProfile','HeatingFanProfile',
  'ControlIntervalMinutes','SurplusStartW','SurplusStopW','MinBatterySoc','StopBatterySoc','FastResetImportW',
  'AllowPowerControl','AllowModeControl','AllowSetpointControl','AllowFanControl','FanMinValue','FanMaxValue','FanStepValue',
];
const HVAC_INSTANCE_DEFAULT_SOURCE = {
  Enabled: DEFAULTS.hvacEnabled,
  Name: '',
  AutomaticControlEnabled: DEFAULTS.hvacAutomaticControlEnabled,
  AllowOnBattery: DEFAULTS.hvacAllowOnBattery,
  UsePvSurplus: DEFAULTS.hvacUsePvSurplus,
  ComfortMinC: DEFAULTS.hvacComfortMinC,
  ComfortMaxC: DEFAULTS.hvacComfortMaxC,
  EnergyDeviationC: DEFAULTS.hvacEnergyDeviationC,
  HeatingActivationBelowC: DEFAULTS.hvacHeatingActivationBelowC,
  CoolingActivationAboveC: DEFAULTS.hvacCoolingActivationAboveC,
  Priority: DEFAULTS.hvacPriority,
  CoolingFanProfile: DEFAULTS.hvacCoolingFanProfile,
  HeatingFanProfile: DEFAULTS.hvacHeatingFanProfile,
  ControlIntervalMinutes: DEFAULTS.hvacControlIntervalMinutes,
  SurplusStartW: DEFAULTS.hvacSurplusStartW,
  SurplusStopW: DEFAULTS.hvacSurplusStopW,
  MinBatterySoc: DEFAULTS.hvacMinBatterySoc,
  StopBatterySoc: DEFAULTS.hvacStopBatterySoc,
  FastResetImportW: DEFAULTS.hvacFastResetImportW,
  AllowPowerControl: DEFAULTS.hvacAllowPowerControl,
  AllowModeControl: DEFAULTS.hvacAllowModeControl,
  AllowSetpointControl: DEFAULTS.hvacAllowSetpointControl,
  AllowFanControl: DEFAULTS.hvacAllowFanControl,
  FanMinValue: DEFAULTS.hvacFanMinValue,
  FanMaxValue: DEFAULTS.hvacFanMaxValue,
  FanStepValue: DEFAULTS.hvacFanStepValue,
};
for (let instance = 2; instance <= 4; instance += 1) {
  for (const suffix of HVAC_INSTANCE_DEFAULT_KEYS) DEFAULTS[`hvac${instance}${suffix}`] = HVAC_INSTANCE_DEFAULT_SOURCE[suffix];
}

for (const rate of DEFAULTS.touRates) {
  rate.boilerChargeAllowed = false;
  for (let instance = 2; instance <= 4; instance += 1) {
    rate[`ev${instance}ChargeAllowed`] = false;
    rate[`ev${instance}PvChargeAllowed`] = true;
    rate[`ev${instance}PvMinSurplusW`] = 0;
    rate[`ev${instance}PvStopGridImportW`] = 1000;
  }
}

// Per-battery split command output for batteries that require separate working
// modes and power registers (for example Huawei LUNA). Disabled by default so
// existing installations keep the original single-command behaviour.
for (let battery = 1; battery <= 8; battery += 1) {
  DEFAULTS[`splitCommandBattery${battery}Enabled`] = false;
  DEFAULTS[`splitCommandBattery${battery}ChargePowerPositive`] = false;
  DEFAULTS[`splitCommandBattery${battery}KeepMinimumPower`] = true;
  DEFAULTS[`splitCommandBattery${battery}MinimumPowerW`] = 100;
  DEFAULTS[`splitCommandBattery${battery}ZeroMode`] = 'discharge';
  DEFAULTS[`splitCommandBattery${battery}ChargeMinSwitchSeconds`] = 60;
  DEFAULTS[`splitCommandBattery${battery}DischargeMinSwitchSeconds`] = 60;
  DEFAULTS[`splitCommandBattery${battery}MinBetweenSwitchSeconds`] = 60;
  DEFAULTS[`splitCommandBattery${battery}DirectionConfirmSeconds`] = 15;
  DEFAULTS[`splitCommandBattery${battery}SafetyModeResendEnabled`] = false;
  DEFAULTS[`splitCommandBattery${battery}SafetyModeResendMinutes`] = 10;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function batteryCommandStep(settings) {
  const configured = Math.round(asNumber(settings.batteryCommandStepW, 1));
  return [1, 10, 100].includes(configured) ? configured : 1;
}

function roundBatteryCommand(value, settings) {
  const step = batteryCommandStep(settings);
  if (step <= 1) return Math.round(asNumber(value, 0));
  const numeric = asNumber(value, 0);
  if (numeric === 0) return 0;
  return Math.sign(numeric) * Math.floor(Math.abs(numeric) / step) * step;
}


function gridZeroBand(settings) {
  let min = asNumber(settings.gridZeroMinW, -5);
  let max = asNumber(settings.gridZeroMaxW, 25);
  if (min > max) [min, max] = [max, min];
  return { min, max };
}

function gridControlErrorW(gridPowerW, settings, averageBatterySoc = null) {
  const grid = asNumber(gridPowerW, 0);
  const band = gridZeroBand(settings);
  const target = (band.min + band.max) / 2;

  // With zero-export/PV control enabled, keep the configured export buffer
  // ONLY once the battery is above the same SoC threshold that allows PV
  // curtailment. Below that threshold all available solar should first remain
  // available to charge the home battery, so normal regulation aims at the
  // configured zero-band centre instead of deliberately holding export.
  if (Boolean(settings.exportLimitEnabled)) {
    const minimumExportW = Math.max(0, asNumber(settings.minimumExportW, 50));
    const configuredCurtailSoc = asNumber(settings.pvCurtailMinBatterySoc, 95);
    const minCurtailSoc = clamp(configuredCurtailSoc, 0, 100);
    const exportBufferAllowed = averageBatterySoc !== null
      && Number.isFinite(Number(averageBatterySoc))
      && Number(averageBatterySoc) >= minCurtailSoc;
    if (exportBufferAllowed && grid <= -minimumExportW) return grid + minimumExportW;
  }

  // Inside the configured zero band we keep the last real battery setpoint.
  // Once regulation is needed again, aim for the CENTER of that band instead
  // of 0 W. Example: a 5..25 W band targets 15 W. This creates equal room on
  // both sides before another correction is needed and therefore reduces
  // needless setpoint chatter.
  return grid >= band.min && grid <= band.max ? 0 : grid - target;
}

function isDynamicContract(settingsOrType) {
  const type = typeof settingsOrType === 'string'
    ? settingsOrType
    : String(settingsOrType?.contractType || '');
  return type === 'dynamic' || type === 'dynamic_quarter' || type === 'dynamic_hour';
}

function tariffClassLabel(className) {
  if (className === 'cheap') return 'Goedkoop';
  if (className === 'expensive') return 'Duur';
  return 'Normaal';
}

function controlGain(settings) {
  const profile = String(settings.controlProfile || 'normal');
  const profiles = {
    quiet: 0.65,
    normal: 0.85,
    exact: 1.00,
    // Legacy alias from <= v0.2.26. migrateSettings() converts saved values,
    // but keeping this alias makes the engine safe for previews/tests during upgrade.
    aggressive: 1.00,
  };
  // PV delta is a signal to select LIVE grid input in app.js. It must never
  // multiply the correction itself; measured grid power remains authoritative.
  return profiles[profile] || profiles.normal;
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return (hour * 60) + minute;
}

const ZONED_FORMATTERS = new Map();

function getZonedFormatter(timezone = 'UTC') {
  const key = String(timezone || 'UTC');
  let formatter = ZONED_FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: key,
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    ZONED_FORMATTERS.set(key, formatter);
  }
  return formatter;
}

function zonedParts(date, timezone = 'UTC') {
  const parts = getZonedFormatter(timezone).formatToParts(date);
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let weekday = 1;
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value) || 1970;
    else if (part.type === 'month') month = Number(part.value) || 1;
    else if (part.type === 'day') day = Number(part.value) || 1;
    else if (part.type === 'hour') hour = Number(part.value) || 0;
    else if (part.type === 'minute') minute = Number(part.value) || 0;
    else if (part.type === 'weekday') weekday = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[part.value] || 1;
  }
  return {
    year,
    month,
    day,
    hour,
    minute,
    minuteOfDay: (hour * 60) + minute,
    weekday,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}


function seasonForDate(date, timezone = 'UTC') {
  const month = zonedParts(date, timezone).month;
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

function peakReserveMonthEnabled(settings, month) {
  const normalizedMonth = Math.max(1, Math.min(12, Math.round(Number(month) || 1)));
  return Boolean(settings[`peakReserveMonth${normalizedMonth}`]);
}

function minuteOfDay(date, timezone = 'UTC') {
  return zonedParts(date, timezone).minuteOfDay;
}

function inWindow(nowMinute, startMinute, endMinute) {
  if (startMinute === null || endMinute === null) return false;
  if (startMinute === endMinute) return true;
  if (startMinute < endMinute) return nowMinute >= startMinute && nowMinute < endMinute;
  return nowMinute >= startMinute || nowMinute < endMinute;
}

function localDateAfterMinutes(now, deltaMinutes, targetMinute, timezone = 'UTC') {
  const base = Math.floor(now.getTime() / 60000) * 60000;
  let candidate = new Date(base + (deltaMinutes * 60000));
  // Normally local minutes map 1:1 to elapsed minutes. Around DST switches they
  // can differ by an hour; correct that with at most one extra formatter call.
  const actualMinute = minuteOfDay(candidate, timezone);
  if (actualMinute !== targetMinute) {
    let correction = targetMinute - actualMinute;
    if (correction > 720) correction -= 1440;
    if (correction < -720) correction += 1440;
    candidate = new Date(candidate.getTime() + (correction * 60000));
  }
  return candidate;
}

function nextOccurrence(now, minute, timezone = 'UTC') {
  const local = zonedParts(now, timezone);
  let delta = minute - local.minuteOfDay;
  if (delta <= 0) delta += 1440;
  return localDateAfterMinutes(now, delta, minute, timezone);
}

function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}u ${String(mins).padStart(2, '0')}m`;
  if (hours > 0) return `${hours}u`;
  return `${mins}m`;
}

function formatHours(hours) {
  if (!Number.isFinite(hours) || hours < 0) return '';
  return formatDuration(hours * 60 * 60 * 1000);
}

function zonedWeekday(date, timezone = 'UTC') {
  return zonedParts(date, timezone).weekday;
}

function normalizeDays(days) {
  if (!Array.isArray(days)) return [1, 2, 3, 4, 5, 6, 7];
  return [...new Set(days.map(Number).filter(day => day >= 1 && day <= 7))].sort((a, b) => a - b);
}

function legacyTouChargeMode(nightValue, dayValue) {
  if (nightValue === null || nightValue === undefined) {
    if (dayValue === null || dayValue === undefined) return null;
  }
  const night = Boolean(nightValue);
  const day = Boolean(dayValue);
  if (night && day) return 'always';
  if (night) return 'night';
  if (day) return 'day';
  return 'never';
}

function normalizeTouChargeMode(value, nightValue, dayValue) {
  const normalized = String(value || '').toLowerCase();
  if (['never', 'night', 'day', 'always'].includes(normalized)) return normalized;
  return legacyTouChargeMode(nightValue, dayValue);
}

function touChargeModeForWeekday(tariff, weekday) {
  if (!tariff) return null;
  const weekend = Number(weekday) === 6 || Number(weekday) === 7;
  const explicit = weekend ? tariff.weekendChargeMode : tariff.weekdayChargeMode;
  return normalizeTouChargeMode(explicit, tariff.nightChargeAllowed, tariff.dayChargeAllowed);
}

function sanitizeTariffs(settings) {
  const rates = Array.isArray(settings.touRates) ? settings.touRates : [];
  const schedule = Array.isArray(settings.touSchedule) ? settings.touSchedule : [];

  if (rates.length > 0 && schedule.length > 0) {
    const rateMap = new Map(rates.map((rate, index) => {
      const id = String(rate.id || `rate-${index + 1}`);
      return [id, {
        id,
        name: String(rate.name || `Tarief ${index + 1}`),
        importPrice: asNumber(rate.importPrice, 0),
        feedInPrice: asNumber(rate.feedInPrice, 0),
        weekdayChargeMode: normalizeTouChargeMode(rate.weekdayChargeMode, rate.nightChargeAllowed, rate.dayChargeAllowed),
        weekendChargeMode: normalizeTouChargeMode(rate.weekendChargeMode, rate.nightChargeAllowed, rate.dayChargeAllowed),
        nightChargeAllowed: rate.nightChargeAllowed === undefined ? null : Boolean(rate.nightChargeAllowed),
        dayChargeAllowed: rate.dayChargeAllowed === undefined ? null : Boolean(rate.dayChargeAllowed),
        avoidGridImport: rate.avoidGridImport === undefined ? null : Boolean(rate.avoidGridImport),
        lowForecastBatterySave: Boolean(rate.lowForecastBatterySave),
        lowForecastDischargeToTarget: Boolean(rate.lowForecastDischargeToTarget),
      }];
    }));

    return schedule
      .map((block, index) => {
        const rate = rateMap.get(String(block.rateId || ''));
        return {
          id: `schedule-${index + 1}`,
          rateId: rate ? rate.id : '',
          name: rate ? rate.name : 'Onbekend tarief',
          start: String(block.start || '00:00'),
          end: String(block.end || '00:00'),
          days: normalizeDays(block.days),
          importPrice: rate ? rate.importPrice : 0,
          feedInPrice: rate ? rate.feedInPrice : 0,
          weekdayChargeMode: rate ? rate.weekdayChargeMode : null,
          weekendChargeMode: rate ? rate.weekendChargeMode : null,
          nightChargeAllowed: rate ? rate.nightChargeAllowed : null,
          dayChargeAllowed: rate ? rate.dayChargeAllowed : null,
          avoidGridImport: rate ? rate.avoidGridImport : null,
          lowForecastBatterySave: rate ? Boolean(rate.lowForecastBatterySave) : false,
          lowForecastDischargeToTarget: rate ? Boolean(rate.lowForecastDischargeToTarget) : false,
          startMinute: parseTime(block.start),
          endMinute: parseTime(block.end),
        };
      })
      .filter(t => t.rateId && t.startMinute !== null && t.endMinute !== null && t.days.length > 0);
  }

  // Backward compatibility with the earliest v0.1.0 test build.
  const legacy = Array.isArray(settings.touTariffs) ? settings.touTariffs : [];
  return legacy
    .map((t, index) => ({
      id: `legacy-${index + 1}`,
      rateId: `legacy-${index + 1}`,
      name: String(t.name || `Tarief ${index + 1}`),
      start: String(t.start || '00:00'),
      end: String(t.end || '00:00'),
      days: normalizeDays(t.days),
      importPrice: asNumber(t.importPrice, 0),
      feedInPrice: asNumber(t.feedInPrice, 0),
      weekdayChargeMode: normalizeTouChargeMode(t.weekdayChargeMode, t.nightChargeAllowed, t.dayChargeAllowed),
      weekendChargeMode: normalizeTouChargeMode(t.weekendChargeMode, t.nightChargeAllowed, t.dayChargeAllowed),
      nightChargeAllowed: t.nightChargeAllowed === undefined ? null : Boolean(t.nightChargeAllowed),
      dayChargeAllowed: t.dayChargeAllowed === undefined ? null : Boolean(t.dayChargeAllowed),
      avoidGridImport: t.avoidGridImport === undefined ? null : Boolean(t.avoidGridImport),
      lowForecastBatterySave: Boolean(t.lowForecastBatterySave),
      lowForecastDischargeToTarget: Boolean(t.lowForecastDischargeToTarget),
      startMinute: parseTime(t.start),
      endMinute: parseTime(t.end),
    }))
    .filter(t => t.startMinute !== null && t.endMinute !== null && t.days.length > 0);
}

function tariffMatchesLocal(tariff, minute, today) {
  if (tariff.startMinute === tariff.endMinute) return tariff.days.includes(today);
  if (tariff.startMinute < tariff.endMinute) {
    return tariff.days.includes(today) && minute >= tariff.startMinute && minute < tariff.endMinute;
  }
  if (minute >= tariff.startMinute) return tariff.days.includes(today);
  if (minute < tariff.endMinute) {
    const previousLocalDay = today === 1 ? 7 : today - 1;
    return tariff.days.includes(previousLocalDay);
  }
  return false;
}

function tariffMatchesAt(tariff, date, timezone) {
  const local = zonedParts(date, timezone);
  return tariffMatchesLocal(tariff, local.minuteOfDay, local.weekday);
}

function tariffClass(tariff, tariffs) {
  if (!tariff || tariffs.length === 0) return 'normal';
  const prices = tariffs.map(t => t.importPrice);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  if (maxPrice <= minPrice) return 'normal';
  if (tariff.importPrice === minPrice) return 'cheap';
  if (tariff.importPrice === maxPrice) return 'expensive';
  return 'normal';
}

function touAvoidGridImport(tariff, className = 'normal') {
  if (!tariff) return false;
  // Missing fields mean pre-v0.3.85 settings/test fixtures. Explicit
  // import-avoidance is then considered unset; determineBaseMode preserves the
  // legacy expensive-price behaviour after Battery Save has had its old priority.
  if (tariff.avoidGridImport === null || tariff.avoidGridImport === undefined) return false;
  return Boolean(tariff.avoidGridImport);
}

function touChargeAllowed(tariff, className = 'normal', nightPlanning = false, weekday = null) {
  if (!tariff || touAvoidGridImport(tariff, className)) return false;
  const mode = weekday === null || weekday === undefined ? null : touChargeModeForWeekday(tariff, weekday);
  if (mode !== null) {
    if (mode === 'always') return true;
    if (mode === 'night') return Boolean(nightPlanning);
    if (mode === 'day') return !nightPlanning;
    return false;
  }
  const value = nightPlanning ? tariff.nightChargeAllowed : tariff.dayChargeAllowed;
  if (value === null || value === undefined) return className === 'cheap';
  return Boolean(value);
}

function remainingCurrentTariffMinutes(now, tariff, timezone = 'UTC') {
  if (!tariff) return 0;
  const local = zonedParts(now, timezone);
  const start = Number(tariff.startMinute);
  const end = Number(tariff.endMinute);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (start === end) return 1440;
  let delta;
  if (start < end) delta = end - local.minuteOfDay;
  else if (local.minuteOfDay >= start) delta = (1440 - local.minuteOfDay) + end;
  else delta = end - local.minuteOfDay;
  return Math.max(1, Math.ceil(delta));
}

function findTouBlockAt(date, tariffs, timezone) {
  const local = zonedParts(date, timezone);
  return tariffs.find(tariff => tariffMatchesLocal(tariff, local.minuteOfDay, local.weekday)) || null;
}

function sameTariffState(a, b, weekdayA = null, weekdayB = null) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const policyA = weekdayA === null ? null : touChargeModeForWeekday(a, weekdayA);
  const policyB = weekdayB === null ? null : touChargeModeForWeekday(b, weekdayB);
  return String(a.rateId || a.id || '') === String(b.rateId || b.id || '')
    && a.importPrice === b.importPrice
    && a.feedInPrice === b.feedInPrice
    && (weekdayA === null || weekdayB === null ? (
      a.nightChargeAllowed === b.nightChargeAllowed
      && a.dayChargeAllowed === b.dayChargeAllowed
      && a.weekdayChargeMode === b.weekdayChargeMode
      && a.weekendChargeMode === b.weekendChargeMode
    ) : policyA === policyB)
    && a.avoidGridImport === b.avoidGridImport;
}

function findNextTouTransition(now, current, tariffs, timezone) {
  if (!tariffs.length) return { at: null, tariff: null };
  const local = zonedParts(now, timezone);
  const boundaries = [...new Set([0, ...tariffs.flatMap(t => [t.startMinute, t.endMinute])])]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  let best = null;
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const weekday = ((local.weekday - 1 + dayOffset) % 7) + 1;
    for (const minute of boundaries) {
      const delta = (dayOffset * 1440) + minute - local.minuteOfDay;
      if (delta <= 0) continue;
      if (best && delta >= best.delta) continue;
      const candidate = tariffs.find(tariff => tariffMatchesLocal(tariff, minute, weekday)) || null;
      if (!sameTariffState(candidate, current, weekday, local.weekday)) {
        best = {
          delta,
          at: localDateAfterMinutes(now, delta, minute, timezone),
          tariff: candidate,
        };
      }
    }
    if (best && best.delta < ((dayOffset + 1) * 1440)) break;
  }
  return best ? { at: best.at, tariff: best.tariff } : { at: null, tariff: null };
}

function countRemainingCheapMinutes(now, currentClass, tariffs, timezone) {
  if (currentClass !== 'cheap') return 0;
  const current = findTouBlockAt(now, tariffs, timezone);
  const transition = findNextTouTransition(now, current, tariffs, timezone);
  if (!transition.at) return 0;
  return Math.max(1, Math.ceil((transition.at.getTime() - now.getTime()) / 60000));
}

function sanitizeDynamicSlots(settings) {
  const slots = Array.isArray(settings.dynamicSlots) ? settings.dynamicSlots : [];
  return slots
    .map(s => ({
      time: String(s.time || ''),
      minute: parseTime(s.time),
      price: asNumber(s.price, NaN),
    }))
    .filter(s => s.minute !== null && Number.isFinite(s.price))
    .sort((a, b) => a.minute - b.minute);
}

function inferDynamicInterval(slots) {
  if (!Array.isArray(slots) || slots.length < 2) return 15;
  const diffs = [];
  for (let i = 1; i < slots.length; i += 1) {
    const diff = slots[i].minute - slots[i - 1].minute;
    if (diff > 0 && diff <= 180) diffs.push(diff);
  }
  if (!diffs.length) return 15;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 15;
}


function addCalendarDays(parts, dayOffset) {
  const date = new Date(Date.UTC(
    Number(parts.year) || 1970,
    Math.max(0, (Number(parts.month) || 1) - 1),
    (Number(parts.day) || 1) + Number(dayOffset || 0),
    12,
    0,
    0,
    0,
  ));
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday,
    dateKey: `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
  };
}

function localDateAtMinute(dateParts, minuteInput, timezone = 'UTC') {
  const rawMinute = Number(minuteInput) || 0;
  const dayOffset = Math.floor(rawMinute / 1440);
  const minute = ((rawMinute % 1440) + 1440) % 1440;
  const target = addCalendarDays(dateParts, dayOffset);
  const targetHour = Math.floor(minute / 60);
  const targetMinute = minute % 60;
  const desiredPseudo = Date.UTC(target.year, target.month - 1, target.day, targetHour, targetMinute, 0, 0);
  let timestamp = desiredPseudo;

  // Convert a local calendar minute to UTC without assuming a fixed offset.
  // Iterating on the formatted local calendar value is DST-safe for ordinary
  // and fall-back days. The bounded scan handles an ambiguous/non-existent
  // boundary as predictably as possible without adding a timezone dependency.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = zonedParts(new Date(timestamp), timezone);
    const actualPseudo = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const delta = desiredPseudo - actualPseudo;
    if (Math.abs(delta) < 60000) return new Date(timestamp);
    timestamp += delta;
  }

  for (let offset = -180; offset <= 180; offset += 1) {
    const candidate = new Date(timestamp + (offset * 60000));
    const actual = zonedParts(candidate, timezone);
    if (actual.dateKey === target.dateKey && actual.minuteOfDay === minute) return candidate;
  }
  return new Date(timestamp);
}

function mergePlanningBlocks(blocks) {
  const sorted = (Array.isArray(blocks) ? blocks : [])
    .filter(block => Number(block?.endAt) > Number(block?.startAt))
    .sort((a, b) => Number(a.startAt) - Number(b.startAt));
  const merged = [];
  for (const block of sorted) {
    const previous = merged[merged.length - 1];
    const sameLabel = previous
      && String(previous.tariffLabel || '') === String(block.tariffLabel || '')
      && Number(previous.price) === Number(block.price);
    if (sameLabel && Number(block.startAt) <= Number(previous.endAt) + 1000) {
      previous.endAt = Math.max(Number(previous.endAt), Number(block.endAt));
    } else {
      merged.push({ ...block, startAt: Number(block.startAt), endAt: Number(block.endAt) });
    }
  }
  return merged;
}

function buildTouPlanningOccurrences(settings, targetDate, timezone) {
  const tariffs = sanitizeTariffs(settings);
  const occurrences = [];
  for (let dateOffset = -2; dateOffset <= 1; dateOffset += 1) {
    const date = addCalendarDays(targetDate, dateOffset);
    for (const tariff of tariffs) {
      if (!tariff.days.includes(date.weekday)) continue;
      const crossesMidnight = tariff.startMinute === tariff.endMinute || tariff.endMinute < tariff.startMinute;
      const startAt = localDateAtMinute(date, tariff.startMinute, timezone).getTime();
      const endAt = localDateAtMinute(addCalendarDays(date, crossesMidnight ? 1 : 0), tariff.endMinute, timezone).getTime();
      if (endAt <= startAt) continue;
      const className = tariffClass(tariff, tariffs);
      let segmentStartAt = startAt;
      while (segmentStartAt < endAt) {
        const segmentLocal = zonedParts(new Date(segmentStartAt), timezone);
        const nextLocalMidnight = localDateAtMinute(addCalendarDays(segmentLocal, 1), 0, timezone).getTime();
        const segmentEndAt = Math.min(endAt, nextLocalMidnight);
        occurrences.push({
          startAt: segmentStartAt,
          endAt: segmentEndAt,
          tariffLabel: tariff.name,
          price: tariff.importPrice,
          className,
          weekdayChargeMode: tariff.weekdayChargeMode,
          weekendChargeMode: tariff.weekendChargeMode,
          nightChargeAllowed: touChargeAllowed(tariff, className, true, segmentLocal.weekday),
          dayChargeAllowed: touChargeAllowed(tariff, className, false, segmentLocal.weekday),
          avoidGridImport: touAvoidGridImport(tariff, className),
        });
        segmentStartAt = segmentEndAt;
      }
    }
  }
  return occurrences.sort((a, b) => a.startAt - b.startAt);
}

function findAnchoredPeak(occurrences, dateParts, anchorMinute, timezone) {
  const anchorAt = localDateAtMinute(dateParts, anchorMinute, timezone).getTime();
  const targetEnd = localDateAtMinute(addCalendarDays(dateParts, 1), 0, timezone).getTime();
  const peaks = occurrences
    .filter(item => item.className === 'expensive' && item.endAt > anchorAt - 1 && item.startAt < targetEnd + (12 * 60 * 60 * 1000))
    .sort((a, b) => a.startAt - b.startAt);
  const containing = peaks.find(item => item.startAt <= anchorAt && item.endAt > anchorAt);
  const following = peaks.find(item => item.startAt >= anchorAt);
  return {
    anchorAt,
    peak: containing || following || null,
  };
}

function buildFixedPlanningOccurrences(settings, targetDate, timezone) {
  const startMinute = parseTime(settings.fixedChargeWindowStart);
  const endMinute = parseTime(settings.fixedChargeWindowEnd);
  if (startMinute === null || endMinute === null) return [];
  const blocks = [];
  for (let dateOffset = -2; dateOffset <= 1; dateOffset += 1) {
    const date = addCalendarDays(targetDate, dateOffset);
    const crossesMidnight = startMinute === endMinute || endMinute < startMinute;
    const startAt = localDateAtMinute(date, startMinute, timezone).getTime();
    const endAt = localDateAtMinute(addCalendarDays(date, crossesMidnight ? 1 : 0), endMinute, timezone).getTime();
    if (endAt > startAt) {
      blocks.push({
        startAt,
        endAt,
        tariffLabel: 'Laadvenster',
        price: asNumber(settings.fixedImportPrice, 0),
        className: 'cheap',
      });
    }
  }
  return blocks.sort((a, b) => a.startAt - b.startAt);
}

function resolvePlanningCycle(inputState = {}, settings = {}, nowInput = new Date()) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const timezone = settings.timezone || 'UTC';
  const targetDayOffset = String(inputState.planningForecastDay || 'today') === 'tomorrow' ? 1 : 0;
  const targetDate = addCalendarDays(zonedParts(now, timezone), targetDayOffset);
  const previousDate = addCalendarDays(targetDate, -1);
  const targetAnchorMinute = parseTime(settings.solarTargetTime);
  const anchorMinute = targetAnchorMinute === null ? 17 * 60 : targetAnchorMinute;

  if (settings.contractType === 'tou') {
    const occurrences = buildTouPlanningOccurrences(settings, targetDate, timezone);
    const targetPeakInfo = findAnchoredPeak(occurrences, targetDate, anchorMinute, timezone);
    const previousPeakInfo = findAnchoredPeak(occurrences, previousDate, anchorMinute, timezone);
    const peakStartAt = targetPeakInfo.peak ? targetPeakInfo.peak.startAt : targetPeakInfo.anchorAt;
    const peakEndAt = targetPeakInfo.peak ? targetPeakInfo.peak.endAt : targetPeakInfo.anchorAt;
    const previousBoundaryAt = previousPeakInfo.peak ? previousPeakInfo.peak.endAt : previousPeakInfo.anchorAt;
    const nightPlanning = Boolean(inputState.nightPlanningActive);
    const cheapBlocks = mergePlanningBlocks(occurrences
      .filter(item => (nightPlanning ? item.nightChargeAllowed : item.dayChargeAllowed) && item.endAt > previousBoundaryAt && item.startAt < peakStartAt)
      .map(item => ({
        startAt: Math.max(item.startAt, previousBoundaryAt),
        endAt: Math.min(item.endAt, peakStartAt),
        tariffLabel: item.tariffLabel,
        price: item.price,
      })));
    return {
      type: 'tou',
      targetDateKey: targetDate.dateKey,
      startAt: cheapBlocks.length ? cheapBlocks[0].startAt : previousBoundaryAt,
      chargeDeadlineAt: peakStartAt,
      peakStartAt,
      peakEndAt,
      peakLabel: targetPeakInfo.peak?.tariffLabel || 'Doelpiek',
      endAt: Math.max(peakStartAt, peakEndAt),
      cheapBlocks,
    };
  }

  if (!isDynamicContract(settings)) {
    const anchorAt = localDateAtMinute(targetDate, anchorMinute, timezone).getTime();
    const previousAnchorAt = localDateAtMinute(previousDate, anchorMinute, timezone).getTime();
    const cheapBlocks = mergePlanningBlocks(buildFixedPlanningOccurrences(settings, targetDate, timezone)
      .filter(item => item.endAt > previousAnchorAt && item.startAt < anchorAt)
      .map(item => ({
        startAt: Math.max(item.startAt, previousAnchorAt),
        endAt: Math.min(item.endAt, anchorAt),
        tariffLabel: item.tariffLabel,
        price: item.price,
      })));
    return {
      type: 'fixed',
      targetDateKey: targetDate.dateKey,
      startAt: cheapBlocks.length ? cheapBlocks[0].startAt : previousAnchorAt,
      chargeDeadlineAt: anchorAt,
      peakStartAt: anchorAt,
      peakEndAt: anchorAt,
      peakLabel: 'Dagdoel',
      endAt: anchorAt,
      cheapBlocks,
    };
  }

  return null;
}

function planningChargeAvailability(cycle, nowInput = new Date()) {
  if (!cycle || !Array.isArray(cycle.cheapBlocks)) return { eligibleNow: false, minutes: 0 };
  const now = nowInput instanceof Date ? nowInput.getTime() : Number(nowInput);
  const eligibleNow = cycle.cheapBlocks.some(block => now >= block.startAt && now < block.endAt);
  if (!eligibleNow) return { eligibleNow: false, minutes: 0 };
  const deadline = Number(cycle.chargeDeadlineAt) || Number.MAX_SAFE_INTEGER;
  const milliseconds = cycle.cheapBlocks.reduce((total, block) => {
    const startAt = Math.max(now, Number(block.startAt));
    const endAt = Math.min(deadline, Number(block.endAt));
    return total + Math.max(0, endAt - startAt);
  }, 0);
  return { eligibleNow: true, minutes: Math.max(0, Math.ceil(milliseconds / 60000)) };
}

function findCurrentTariff(now, settings, planningState = null) {
  const timezone = settings.timezone || 'UTC';
  const nowMinute = minuteOfDay(now, timezone);
  const planningCycle = planningState && !isDynamicContract(settings)
    ? resolvePlanningCycle(planningState, settings, now)
    : null;

  if (settings.contractType === 'tou') {
    const tariffs = sanitizeTariffs(settings);
    const current = findTouBlockAt(now, tariffs, timezone);
    if (!current || tariffs.length === 0) {
      const next = findNextTouTransition(now, null, tariffs, timezone);
      return {
        kind: 'tou',
        label: 'Geen tarief',
        price: null,
        className: 'normal',
        nextAt: next.at,
        nextLabel: next.tariff ? next.tariff.name : null,
        selectedChargeMinutes: 0,
        rateId: null,
        nightChargeAllowed: false,
        dayChargeAllowed: false,
        avoidGridImport: false,
        lowForecastBatterySave: false,
        lowForecastDischargeToTarget: false,
      };
    }

    const className = tariffClass(current, tariffs);
    const transition = findNextTouTransition(now, current, tariffs, timezone);
    const nightPlanning = Boolean(planningState?.nightPlanningActive);
    const currentWeekday = zonedParts(now, timezone).weekday;
    const avoidGridImportConfigured = current.avoidGridImport !== null && current.avoidGridImport !== undefined;
    const avoidGridImport = touAvoidGridImport(current, className);
    const nightChargeAllowed = touChargeAllowed(current, className, true, currentWeekday);
    const dayChargeAllowed = touChargeAllowed(current, className, false, currentWeekday);
    const currentChargeAllowed = nightPlanning ? nightChargeAllowed : dayChargeAllowed;
    const cycleAvailability = planningCycle
      ? planningChargeAvailability(planningCycle, now)
      : null;
    const selectedChargeMinutes = cycleAvailability
      ? cycleAvailability.minutes
      : (currentChargeAllowed ? remainingCurrentTariffMinutes(now, current, timezone) : 0);

    return {
      kind: 'tou',
      label: current.name,
      price: current.importPrice,
      className,
      nextAt: transition.at,
      nextLabel: transition.tariff ? transition.tariff.name : 'Geen tarief',
      selectedChargeMinutes,
      planningWindowEligibleNow: cycleAvailability ? cycleAvailability.eligibleNow : currentChargeAllowed,
      planningScopeStartAt: planningCycle?.startAt || null,
      planningChargeDeadlineAt: planningCycle?.chargeDeadlineAt || null,
      planningPeakStartAt: planningCycle?.peakStartAt || null,
      planningPeakEndAt: planningCycle?.peakEndAt || null,
      days: current.days,
      rateId: current.rateId,
      weekdayChargeMode: current.weekdayChargeMode,
      weekendChargeMode: current.weekendChargeMode,
      activeChargeMode: touChargeModeForWeekday(current, currentWeekday),
      nightChargeAllowed,
      dayChargeAllowed,
      avoidGridImport,
      legacyPriceClassPolicy: !avoidGridImportConfigured,
      lowForecastBatterySave: avoidGridImport ? false : Boolean(current.lowForecastBatterySave),
      lowForecastDischargeToTarget: avoidGridImport ? false : Boolean(current.lowForecastDischargeToTarget),
    };
  }

  if (isDynamicContract(settings)) {
    const slots = sanitizeDynamicSlots(settings);
    if (slots.length === 0) {
      return {
        kind: 'dynamic',
        label: 'Dynamisch',
        price: null,
        className: 'normal',
        nextAt: null,
        nextLabel: null,
        selectedChargeMinutes: 0,
        lowForecastBatterySave: Boolean(settings.lowForecastDynamicNormalEnabled),
        lowForecastDischargeToTarget: Boolean(settings.lowForecastDynamicNormalDischargeToTarget),
      };
    }

    const intervalMinutes = inferDynamicInterval(slots);
    let current = slots.find(s => nowMinute >= s.minute && nowMinute < s.minute + intervalMinutes);
    if (!current) {
      current = slots.filter(s => s.minute <= nowMinute).slice(-1)[0] || slots[0];
    }

    const cheapCount = Math.max(1, Math.round((clamp(settings.cheapHours, 0.25, 12) * 60) / intervalMinutes));
    const expensiveCount = Math.max(1, Math.round((clamp(settings.expensiveHours, 0.25, 12) * 60) / intervalMinutes));
    const byPrice = slots.slice().sort((a, b) => a.price - b.price || a.minute - b.minute);
    const cheap = new Set(byPrice.slice(0, cheapCount).map(s => s.minute));
    const expensive = new Set(byPrice.slice(-expensiveCount).map(s => s.minute));

    const className = cheap.has(current.minute)
      ? 'cheap'
      : expensive.has(current.minute)
        ? 'expensive'
        : 'normal';

    // The next event is a real trend change, not every quarter/hour price tick.
    // This keeps the status meaningful: Goedkoop -> Normaal -> Duur, etc.
    const currentIndex = slots.findIndex(s => s.minute === current.minute);
    let next = null;
    for (let step = 1; step <= slots.length; step += 1) {
      const candidate = slots[(currentIndex + step) % slots.length];
      const candidateClass = cheap.has(candidate.minute)
        ? 'cheap'
        : expensive.has(candidate.minute)
          ? 'expensive'
          : 'normal';
      if (candidateClass !== className) {
        next = { ...candidate, className: candidateClass };
        break;
      }
    }

    let nextAt = null;
    let nextLabel = null;
    if (next) {
      nextAt = nextOccurrence(now, next.minute, timezone);
      nextLabel = `${tariffClassLabel(next.className)} €${next.price.toFixed(3)}/kWh`;
    }

    let selectedChargeMinutes = 0;
    for (const slot of slots) {
      if (!cheap.has(slot.minute)) continue;
      let delta = slot.minute - nowMinute;
      if (delta < 0) delta += 1440;
      if (delta < 12 * 60) selectedChargeMinutes += intervalMinutes;
    }

    return {
      kind: 'dynamic',
      label: `${tariffClassLabel(className)} €${current.price.toFixed(3)}/kWh`,
      price: current.price,
      className,
      nextAt,
      nextLabel,
      selectedChargeMinutes,
      intervalMinutes,
      lowForecastBatterySave: className === 'cheap'
        ? Boolean(settings.lowForecastDynamicCheapEnabled)
        : className === 'expensive'
          ? Boolean(settings.lowForecastDynamicExpensiveEnabled)
          : Boolean(settings.lowForecastDynamicNormalEnabled),
      lowForecastDischargeToTarget: className === 'cheap'
        ? Boolean(settings.lowForecastDynamicCheapDischargeToTarget)
        : className === 'expensive'
          ? Boolean(settings.lowForecastDynamicExpensiveDischargeToTarget)
          : Boolean(settings.lowForecastDynamicNormalDischargeToTarget),
    };
  }

  const start = parseTime(settings.fixedChargeWindowStart);
  const end = parseTime(settings.fixedChargeWindowEnd);
  const cheap = inWindow(nowMinute, start, end);
  let selectedChargeMinutes = 0;
  let planningWindowEligibleNow = cheap;
  if (cheap && start !== null && end !== null) {
    if (planningCycle) {
      const availability = planningChargeAvailability(planningCycle, now);
      selectedChargeMinutes = availability.minutes;
      planningWindowEligibleNow = availability.eligibleNow;
    } else {
      selectedChargeMinutes = end > nowMinute ? end - nowMinute : (1440 - nowMinute) + end;
    }
  }

  return {
    kind: 'fixed',
    label: 'Vast tarief',
    price: asNumber(settings.fixedImportPrice, 0),
    className: cheap ? 'cheap' : 'normal',
    nextAt: nextOccurrence(now, cheap ? end : start, timezone),
    nextLabel: cheap ? 'Einde laadvenster' : 'Laadvenster',
    selectedChargeMinutes,
    planningWindowEligibleNow,
    planningScopeStartAt: planningCycle?.startAt || null,
    planningChargeDeadlineAt: planningCycle?.chargeDeadlineAt || null,
    planningPeakStartAt: planningCycle?.peakStartAt || null,
    planningPeakEndAt: planningCycle?.peakEndAt || null,
    lowForecastBatterySave: Boolean(settings.lowForecastFixedEnabled),
    lowForecastDischargeToTarget: Boolean(settings.lowForecastFixedDischargeToTarget),
  };
}

function validBatterySocValues(state, settings) {
  const count = Math.round(clamp(settings.batteryCount, 1, 8));
  const values = Array.isArray(state.batterySoc) ? state.batterySoc.slice(0, count) : [];
  return values
    .filter(v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)))
    .map(Number);
}

function computeAverageSoc(state, settings) {
  const valid = validBatterySocValues(state, settings);
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function computeEffectiveCapacityKwh(state, settings) {
  const count = Math.round(clamp(settings.batteryCount, 1, 8));
  const validCount = validBatterySocValues(state, settings).length;
  const configuredCapacity = Math.max(0, asNumber(settings.totalCapacityKwh, 21.6));
  return count > 0 ? configuredCapacity * (validCount / count) : 0;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getForecastPlanningContext(state, settings, now = new Date()) {
  const todayRemainingForecast = optionalNumber(state.forecastRemainingKwh);
  const todayFullForecast = optionalNumber(state.forecastDailyMaxKwh);
  const tomorrowForecast = optionalNumber(state.forecastTomorrowKwh);
  const remainingAllowed = settings.forecastDataReady !== false;
  const todayFullAllowed = settings.forecastDailyDataReady === undefined ? settings.forecastDataReady !== false : settings.forecastDailyDataReady !== false;
  const tomorrowAllowed = settings.forecastTomorrowDataReady !== false;
  const todayRemainingReady = remainingAllowed && todayRemainingForecast !== null;
  const todayFullReady = todayFullAllowed && todayFullForecast !== null;
  const tomorrowReady = tomorrowAllowed && tomorrowForecast !== null;

  // Forward energy planning uses only energy that can still arrive from NOW.
  // During the solar day that is the remaining-today forecast. Once PV has
  // ended, planning switches to tomorrow. The full-day forecast is retained as
  // a fallback only when no remaining forecast has been received.
  const wantsTomorrow = String(state.planningForecastDay || 'today') === 'tomorrow';
  if (wantsTomorrow) {
    return {
      day: 'tomorrow',
      source: tomorrowReady ? 'tomorrow' : 'none',
      ready: tomorrowReady,
      forecastKwh: tomorrowReady ? Math.max(0, tomorrowForecast) : null,
      todayForecastKwh: todayFullReady ? Math.max(0, todayFullForecast) : null,
      todayRemainingForecastKwh: todayRemainingReady ? Math.max(0, todayRemainingForecast) : null,
      tomorrowForecastKwh: tomorrowReady ? Math.max(0, tomorrowForecast) : null,
    };
  }

  const todayEnergyForecast = todayRemainingReady ? todayRemainingForecast : (todayFullReady ? todayFullForecast : null);
  return {
    day: 'today',
    source: todayRemainingReady ? 'today_remaining' : (todayFullReady ? 'today_full_fallback' : 'none'),
    ready: todayEnergyForecast !== null,
    forecastKwh: todayEnergyForecast === null ? null : Math.max(0, todayEnergyForecast),
    todayForecastKwh: todayFullReady ? Math.max(0, todayFullForecast) : null,
    todayRemainingForecastKwh: todayRemainingReady ? Math.max(0, todayRemainingForecast) : null,
    tomorrowForecastKwh: tomorrowReady ? Math.max(0, tomorrowForecast) : null,
  };
}

function getForecastStrategyContext(state, settings, now = new Date()) {
  const todayFullForecast = optionalNumber(state.forecastDailyMaxKwh);
  const todayRemainingForecast = optionalNumber(state.forecastRemainingKwh);
  const tomorrowForecast = optionalNumber(state.forecastTomorrowKwh);
  const todayFullAllowed = settings.forecastDailyDataReady === undefined ? settings.forecastDataReady !== false : settings.forecastDailyDataReady !== false;
  const remainingAllowed = settings.forecastDataReady !== false;
  const tomorrowAllowed = settings.forecastTomorrowDataReady !== false;
  const todayFullReady = todayFullAllowed && todayFullForecast !== null;
  const todayRemainingReady = remainingAllowed && todayRemainingForecast !== null;
  const tomorrowReady = tomorrowAllowed && tomorrowForecast !== null;
  const wantsTomorrow = String(state.planningForecastDay || 'today') === 'tomorrow';

  // Day classification / Battery Save must not become more pessimistic merely
  // because the day advances. It therefore uses the full-day forecast for the
  // active solar day, and tomorrow's full forecast once night planning starts.
  if (wantsTomorrow) {
    return {
      day: 'tomorrow',
      source: tomorrowReady ? 'tomorrow' : 'none',
      ready: tomorrowReady,
      forecastKwh: tomorrowReady ? Math.max(0, tomorrowForecast) : null,
    };
  }

  const strategyForecast = todayFullReady ? todayFullForecast : (todayRemainingReady ? todayRemainingForecast : null);
  return {
    day: 'today',
    source: todayFullReady ? 'today_full' : (todayRemainingReady ? 'today_remaining_fallback' : 'none'),
    ready: strategyForecast !== null,
    forecastKwh: strategyForecast === null ? null : Math.max(0, strategyForecast),
  };
}

function computePeakReserveDetails(state, settings, forecastContext = null, now = new Date()) {
  const capacity = computeEffectiveCapacityKwh(state, settings);
  const minSoc = clamp(settings.minSoc, 0, 100);
  const maxSoc = clamp(settings.maxSoc, minSoc, 100);
  const safetySoc = clamp(settings.safetySoc, minSoc, maxSoc);

  // v0.3.88: selected months use one absolute SoC setting. Legacy kWh/%
  // settings remain supported when the new key is absent, which keeps direct
  // engine callers and pre-migration data backward compatible.
  const configuredSelectedTargetRaw = optionalNumber(settings.peakReserveTargetSoc);
  const legacyConfiguredReserveKwh = Math.max(0, asNumber(settings.peakReserveKwh, 0));
  const maxUsableReserveKwh = capacity > 0 ? capacity * ((maxSoc - minSoc) / 100) : 0;
  const legacyReserveKwh = capacity > 0 ? Math.min(legacyConfiguredReserveKwh, maxUsableReserveKwh) : 0;
  const legacyReservePercent = capacity > 0
    ? (legacyReserveKwh / capacity) * 100
    : Math.max(0, asNumber(settings.peakReservePercent, 0));
  const legacyTargetSoc = capacity > 0
    ? clamp(minSoc + ((legacyReserveKwh / capacity) * 100), minSoc, maxSoc)
    : clamp(minSoc + legacyReservePercent, minSoc, maxSoc);

  const selectedConfiguredTargetSoc = configuredSelectedTargetRaw === null
    ? legacyTargetSoc
    : clamp(configuredSelectedTargetRaw, 0, 100);
  const selectedOperationalTargetSoc = clamp(selectedConfiguredTargetSoc, minSoc, maxSoc);
  const selectedReserveKwh = capacity > 0
    ? Math.max(0, capacity * ((selectedOperationalTargetSoc - minSoc) / 100))
    : 0;
  const selectedReservePercent = capacity > 0
    ? (selectedReserveKwh / capacity) * 100
    : Math.max(0, selectedOperationalTargetSoc - minSoc);

  // Non-selected months may use their own absolute minimum SoC. During the
  // solar day both monthly strategies stay PV-first. The optional night switch
  // can extend that same minimum to the night plan for the next solar day/peak.
  const context = forecastContext || getForecastPlanningContext(state, settings, now);
  const timezone = settings.timezone || 'UTC';
  const currentParts = zonedParts(now, timezone);
  const reserveDateParts = String(context?.day || 'today') === 'tomorrow'
    ? addCalendarDays(currentParts, 1)
    : currentParts;
  const month = reserveDateParts.month;
  const season = month === 12 || month <= 2 ? 'winter' : month <= 5 ? 'spring' : month <= 8 ? 'summer' : 'autumn';
  const monthEnabled = peakReserveMonthEnabled(settings, month);
  const sunnyMonthsMinSocEnabled = Boolean(settings.sunnyMonthsMinSocEnabled);
  const sunnyMonthsMinSoc = clamp(settings.sunnyMonthsMinSoc, 0, 100);
  const sunnyOperationalTargetSoc = clamp(sunnyMonthsMinSoc, minSoc, maxSoc);
  const sunnyConfiguredTargetSoc = Math.max(safetySoc, sunnyOperationalTargetSoc);
  const sunnyReserveKwh = capacity > 0
    ? Math.max(0, capacity * ((sunnyOperationalTargetSoc - minSoc) / 100))
    : 0;
  const strategy = monthEnabled
    ? 'selected_month_min_soc'
    : (sunnyMonthsMinSocEnabled ? 'sunny_month_min_soc' : 'none');
  const strategyReserveKwh = strategy === 'selected_month_min_soc' ? selectedReserveKwh
    : strategy === 'sunny_month_min_soc' ? sunnyReserveKwh
      : 0;
  const strategyConfiguredTargetSoc = strategy === 'selected_month_min_soc'
    ? Math.max(safetySoc, selectedOperationalTargetSoc)
    : strategy === 'sunny_month_min_soc' ? sunnyConfiguredTargetSoc
      : safetySoc;

  const nightPlanningPhase = Boolean(state.nightPlanningActive);
  const solarDayPhase = !nightPlanningPhase && String(context?.day || 'today') === 'today';
  const nightMinimumsEnabled = Boolean(settings.peakReserveNightEnabled);
  const nightReservePhase = nightPlanningPhase && nightMinimumsEnabled;
  const strategyConfigured = strategy === 'selected_month_min_soc'
    ? selectedOperationalTargetSoc > safetySoc + 0.001
    : strategy === 'sunny_month_min_soc'
      ? sunnyOperationalTargetSoc > safetySoc + 0.001
      : false;
  const active = strategyConfigured && (solarDayPhase || nightReservePhase);
  const forecastKwh = context && context.ready && context.forecastKwh !== null
    ? Math.max(0, Number(context.forecastKwh))
    : null;
  const expectedEnergyNeedKwh = Math.max(0, asNumber(settings.expectedEnergyNeedKwh, 0));

  // Day: remaining PV can directly supply the energy needed to reach the
  // configured absolute minimum SoC by the target peak. Night: tomorrow's PV
  // first covers expected forward demand; only the remainder can fill that
  // requested minimum. Forecast energy is therefore never counted twice.
  const pvAvailableForReserveKwh = active && forecastKwh !== null
    ? (nightReservePhase ? Math.max(0, forecastKwh - expectedEnergyNeedKwh) : forecastKwh)
    : 0;
  const pvCreditKwh = active ? Math.min(strategyReserveKwh, pvAvailableForReserveKwh) : 0;
  const reserveShortfallAfterPvKwh = active ? Math.max(0, strategyReserveKwh - pvCreditKwh) : 0;
  const daytimeReserveTargetSoc = active && capacity > 0
    ? clamp(minSoc + ((reserveShortfallAfterPvKwh / capacity) * 100), minSoc, maxSoc)
    : safetySoc;

  // In night mode the charging target must cover BOTH expected demand and the
  // requested minimum at the next peak, minus the PV forecast. The ordinary
  // forecast target already covers demand alone, but taking max(demand,reserve)
  // would undercount whenever both are needed.
  const nightCombinedGapKwh = active && nightReservePhase && capacity > 0
    ? (forecastKwh === null
      ? strategyReserveKwh
      : Math.max(0, expectedEnergyNeedKwh + strategyReserveKwh - forecastKwh))
    : 0;
  const nightReserveTargetSoc = active && nightReservePhase && capacity > 0
    ? clamp(minSoc + ((nightCombinedGapKwh / capacity) * 100), minSoc, maxSoc)
    : safetySoc;
  const effectiveReserveTargetSoc = nightReservePhase ? nightReserveTargetSoc : daytimeReserveTargetSoc;

  let inactiveReason = '';
  if (nightPlanningPhase && !nightMinimumsEnabled) inactiveReason = 'night_planning';
  else if (!solarDayPhase && !nightReservePhase) inactiveReason = 'night_planning';
  else if (strategy === 'none') inactiveReason = 'month_disabled';
  else if (strategy === 'selected_month_min_soc' && selectedOperationalTargetSoc <= safetySoc + 0.001) inactiveReason = 'not_configured';
  else if (strategy === 'sunny_month_min_soc' && sunnyOperationalTargetSoc <= safetySoc + 0.001) inactiveReason = 'sunny_min_soc_not_configured';

  return {
    active,
    strategy,
    month,
    monthEnabled,
    season,
    seasonEnabled: monthEnabled,
    solarDayPhase,
    nightPlanningPhase,
    nightMinimumsEnabled,
    nightReservePhase: active && nightReservePhase,
    inactiveReason,
    // Legacy-compatible reporting: these now describe the internally derived
    // energy above Minimum SoC for the selected-month absolute SoC target.
    reserveKwh: selectedReserveKwh,
    reservePercent: selectedReservePercent,
    selectedMonthsMinSoc: selectedConfiguredTargetSoc,
    strategyReserveKwh,
    strategyReservePercent: capacity > 0 ? (strategyReserveKwh / capacity) * 100 : 0,
    configuredReserveTargetSoc: strategyConfiguredTargetSoc,
    reserveTargetSoc: Math.max(safetySoc, effectiveReserveTargetSoc),
    sunnyMonthsMinSocEnabled,
    sunnyMonthsMinSoc,
    sunnyMonthsMinSocActive: active && strategy === 'sunny_month_min_soc',
    forecastKwh,
    expectedEnergyNeedKwh,
    pvAvailableForReserveKwh,
    pvCreditKwh,
    reserveShortfallAfterPvKwh,
    nightCombinedGapKwh,
    nightReserveTargetSoc: Math.max(safetySoc, nightReserveTargetSoc),
    pvFullyCoversReserve: active && forecastKwh !== null && reserveShortfallAfterPvKwh <= 0.001,
  };
}

function computeForecastTargetDetails(state, settings, now = new Date()) {
  const expected = Math.max(0, asNumber(settings.expectedEnergyNeedKwh, 20));
  const capacity = computeEffectiveCapacityKwh(state, settings);
  const minSoc = clamp(settings.minSoc, 0, 100);
  const maxSoc = clamp(settings.maxSoc, minSoc, 100);
  const safetySoc = clamp(settings.safetySoc, minSoc, maxSoc);
  const context = getForecastPlanningContext(state, settings, now);
  const peakReserve = computePeakReserveDetails(state, settings, context, now);
  const explicitTargetSoc = optionalNumber(state.targetSocOverride);
  let gapKwh = null;
  let forecastTargetSoc = safetySoc;

  if (explicitTargetSoc !== null) {
    // Read-only planning simulations may provide the final target directly.
    // Real EMS operation never sets this field and therefore remains entirely
    // forecast-driven. The hard Safety/Min/Max boundaries still apply.
    forecastTargetSoc = clamp(explicitTargetSoc, minSoc, maxSoc);
  } else if (context.ready && capacity > 0) {
    const usable = capacity * ((maxSoc - minSoc) / 100);
    if (usable > 0) {
      gapKwh = Math.max(0, expected - Math.max(0, context.forecastKwh));
      forecastTargetSoc = clamp(minSoc + ((gapKwh / usable) * (maxSoc - minSoc)), minSoc, maxSoc);
    }
  }

  const targetSoc = explicitTargetSoc !== null
    ? Math.max(safetySoc, forecastTargetSoc)
    : Math.max(safetySoc, forecastTargetSoc, peakReserve.reserveTargetSoc);
  return {
    targetSoc,
    forecastTargetSoc: Math.max(safetySoc, forecastTargetSoc),
    safetySoc,
    gapKwh,
    targetOverridden: explicitTargetSoc !== null,
    context,
    peakReserve,
  };
}

function computeForecastTargetSoc(state, settings, now = new Date()) {
  return computeForecastTargetDetails(state, settings, now).targetSoc;
}

function lowForecastBatterySaveApplies(state, settings, tariff, forecastContext = null) {
  if (String(settings.forcedMode || 'auto') !== 'auto') return false;
  if (!Boolean(tariff?.lowForecastBatterySave)) return false;
  const thresholdKwh = Math.max(0, asNumber(settings.lowForecastSelfConsumptionMinKwh, 5));
  if (thresholdKwh <= 0) return false;

  // Strategy classification deliberately differs from forward energy planning.
  // During the active solar day Battery Save uses today's full-day forecast so
  // the day does not become 'poor' merely because time has passed. Night
  // planning uses tomorrow. Missing strategy data never activates Battery Save.
  const context = forecastContext || getForecastStrategyContext(state, settings);
  if (!context.ready || context.forecastKwh === null) return false;
  return Math.max(0, Number(context.forecastKwh)) < thresholdKwh;
}

function determineBaseMode(state, settings, tariff, avgSoc, targetSoc, forecastContext = null) {
  const forced = String(settings.forcedMode || 'auto');
  if (forced !== 'auto') return forced;
  if (avgSoc === null) return 'standby';

  // Missing dynamic price data must never cause grid charging or price-driven
  // discharge. Battery-save remains safe: PV export may still be captured and
  // Peak Guard can still override when required.
  if (isDynamicContract(settings) && settings.dynamicPriceDataReady === false) return 'solar_capture';

  // Planned cheap-window charging keeps priority. Once charging is no longer
  // needed, the low-forecast choice for the CURRENT price category may preserve
  // the battery. This works for any number of TOU tariff categories and for the
  // dynamic Low/Normal/High classes.
  const chargeWindowAvailable = tariff?.planningWindowEligibleNow !== false;
  const plannedChargeTariff = tariff?.kind === 'tou'
    ? Boolean(tariff?.planningWindowEligibleNow)
    : tariff.className === 'cheap' && chargeWindowAvailable;
  if (plannedChargeTariff && avgSoc + 0.25 < targetSoc) return 'charge';
  if (tariff?.kind === 'tou' && Boolean(tariff?.avoidGridImport)) return 'avoid_import';
  if (lowForecastBatterySaveApplies(state, settings, tariff, forecastContext)) return 'solar_capture';
  if (tariff.className === 'expensive'
    && (tariff?.kind !== 'tou' || Boolean(tariff?.legacyPriceClassPolicy))
    && avgSoc > settings.minSoc + 1) return 'avoid_import';

  if (isDynamicContract(settings) && tariff.className === 'normal') {
    if (!Boolean(settings.dynamicUseBatteryNormalHours)) return 'solar_capture';
    return 'self_consumption';
  }

  return 'self_consumption';
}

function computeChargePlanW(state, settings, tariff, avgSoc, targetSoc) {
  if (avgSoc === null || avgSoc >= targetSoc) return 0;
  const capacity = computeEffectiveCapacityKwh(state, settings);
  if (capacity <= 0) return 0;
  const energyNeed = capacity * ((targetSoc - avgSoc) / 100);
  if (tariff?.planningWindowEligibleNow === false) return 0;
  const selectedMinutes = Number(tariff?.selectedChargeMinutes);
  let hours = Number.isFinite(selectedMinutes) ? selectedMinutes / 60 : 1;
  if (!Number.isFinite(hours) || hours <= 0.05) hours = 1;
  const validCount = validBatterySocValues(state, settings).length;
  const perBatteryMax = validCount * Math.max(0, asNumber(settings.maxChargePerBatteryW, 2300));
  const configuredTotalMax = Math.max(0, asNumber(settings.maxTotalChargeW, perBatteryMax));
  const totalMaxCharge = Math.min(perBatteryMax, configuredTotalMax);
  return clamp((energyNeed * 1000) / hours, 0, totalMaxCharge);
}

function buildSocPlan(inputState = {}, rawSettings = {}, now = new Date()) {
  const settings = { ...DEFAULTS, ...rawSettings };
  const rawForecastRemainingKwh = optionalNumber(inputState.forecastRemainingKwh);
  const rawForecastDailyMaxKwh = optionalNumber(inputState.forecastDailyMaxKwh);
  const rawForecastTomorrowKwh = optionalNumber(inputState.forecastTomorrowKwh);
  const state = {
    forecastRemainingKwh: rawForecastRemainingKwh === null ? 0 : Math.max(0, rawForecastRemainingKwh),
    forecastDailyMaxKwh: optionalNumber(inputState.forecastDailyMaxKwh),
    forecastTomorrowKwh: optionalNumber(inputState.forecastTomorrowKwh),
    batterySoc: Array.isArray(inputState.batterySoc) ? inputState.batterySoc : [],
    planningForecastDay: String(inputState.planningForecastDay || 'today') === 'tomorrow' ? 'tomorrow' : 'today',
    planningDecisionSource: String(inputState.planningDecisionSource || ''),
    nightPlanningActive: Boolean(inputState.nightPlanningActive),
    targetSocOverride: optionalNumber(inputState.targetSocOverride),
  };
  const avgSoc = computeAverageSoc(state, settings);
  const forecastContext = getForecastPlanningContext(state, settings, now);
  const strategyForecastContext = getForecastStrategyContext(state, settings, now);
  const forecastUsedSource = forecastContext.source || 'none';
  const forecastDisplay = {
    forecastTodayFullKwh: rawForecastDailyMaxKwh === null ? null : Math.max(0, rawForecastDailyMaxKwh),
    forecastRemainingTodayKwh: rawForecastRemainingKwh === null ? null : Math.max(0, rawForecastRemainingKwh),
    forecastTomorrowKwh: rawForecastTomorrowKwh === null ? null : Math.max(0, rawForecastTomorrowKwh),
    forecastUsedSource,
    forecastUsedKwh: forecastContext.forecastKwh,
    strategyForecastSource: strategyForecastContext.source || 'none',
    strategyForecastKwh: strategyForecastContext.forecastKwh,
  };
  const targetDetails = computeForecastTargetDetails(state, settings, now);
  const targetSoc = targetDetails.targetSoc;
  const safetySoc = clamp(settings.safetySoc, clamp(settings.minSoc, 0, 100), clamp(settings.maxSoc, clamp(settings.minSoc, 0, 100), 100));
  const capacityKwh = computeEffectiveCapacityKwh(state, settings);
  const forecastReady = forecastContext.ready;
  const dynamicReady = !isDynamicContract(settings) || settings.dynamicPriceDataReady !== false;
  const validCount = validBatterySocValues(state, settings).length;
  const perBatteryMax = validCount * Math.max(0, asNumber(settings.maxChargePerBatteryW, 2300));
  const maxChargeW = Math.min(perBatteryMax, Math.max(0, asNumber(settings.maxTotalChargeW, perBatteryMax)));
  const energyNeedKwh = avgSoc === null || capacityKwh <= 0
    ? null
    : Math.max(0, capacityKwh * ((targetSoc - avgSoc) / 100));
  const timezone = settings.timezone || 'UTC';
  const dynamic = isDynamicContract(settings);
  const nowMinute = minuteOfDay(now, timezone);
  const horizonMinutes = Math.max(1, 1440 - nowMinute);
  // v0.3.81: fixed/TOU planning is no longer a rolling 24-hour slice. Both the
  // production plan and the simulator use the same tariff cycle: from the first
  // usable charge window after the previous peak through the end of the target
  // peak. The charge deadline remains the START of that peak.
  const planningCycle = dynamic ? null : resolvePlanningCycle(state, settings, now);
  const dynamicScopeEndAt = now.getTime() + (horizonMinutes * 60000);
  const planningScope = {
    planningReferenceAt: now.getTime(),
    planningTargetDateKey: planningCycle?.targetDateKey || zonedParts(now, timezone).dateKey,
    planningScopeStartAt: planningCycle?.startAt || now.getTime(),
    planningChargeDeadlineAt: planningCycle?.chargeDeadlineAt || dynamicScopeEndAt,
    planningPeakStartAt: planningCycle?.peakStartAt || null,
    planningPeakEndAt: planningCycle?.peakEndAt || null,
    planningPeakLabel: planningCycle?.peakLabel || '',
    planningScopeEndAt: planningCycle?.endAt || dynamicScopeEndAt,
  };
  const scopeLabel = dynamic
    ? 'Resterende dynamische prijsdata vandaag'
    : 'Van eerste bruikbare laadvenster tot einde doelpiek';
  const rows = [];

  if (avgSoc === null) {
    return {
      ready: false,
      forecastReady,
      forecastDay: forecastContext.day,
      ...forecastDisplay,
      forecastKwh: forecastContext.forecastKwh,
      forecastTodayKwh: forecastContext.todayForecastKwh,
      forecastTomorrowKwh: forecastContext.tomorrowForecastKwh,
      safetySoc: Math.round(safetySoc * 10) / 10,
      forecastEnergyTargetSoc: Math.round(targetDetails.forecastTargetSoc * 10) / 10,
      targetOverridden: Boolean(targetDetails.targetOverridden),
      peakReserveTargetSoc: Math.round(targetDetails.peakReserve.reserveTargetSoc * 10) / 10,
      peakReserveConfiguredTargetSoc: Math.round(targetDetails.peakReserve.configuredReserveTargetSoc * 10) / 10,
      selectedMonthsMinSoc: Math.round(targetDetails.peakReserve.selectedMonthsMinSoc * 10) / 10,
      peakReserveKwh: Math.round(targetDetails.peakReserve.reserveKwh * 100) / 100,
      peakReservePercent: Math.round(targetDetails.peakReserve.reservePercent * 10) / 10,
      peakReserveStrategy: targetDetails.peakReserve.strategy,
      peakReserveStrategyKwh: Math.round(targetDetails.peakReserve.strategyReserveKwh * 100) / 100,
      peakReserveStrategyPercent: Math.round(targetDetails.peakReserve.strategyReservePercent * 10) / 10,
      sunnyMonthsMinSocEnabled: Boolean(targetDetails.peakReserve.sunnyMonthsMinSocEnabled),
      sunnyMonthsMinSoc: Math.round(targetDetails.peakReserve.sunnyMonthsMinSoc * 10) / 10,
      sunnyMonthsMinSocActive: Boolean(targetDetails.peakReserve.sunnyMonthsMinSocActive),
      peakReserveNightEnabled: Boolean(targetDetails.peakReserve.nightMinimumsEnabled),
      peakReserveNightActive: Boolean(targetDetails.peakReserve.nightReservePhase),
      peakReserveNightTargetSoc: Math.round(targetDetails.peakReserve.nightReserveTargetSoc * 10) / 10,
      peakReserveNightCombinedGapKwh: Math.round(targetDetails.peakReserve.nightCombinedGapKwh * 100) / 100,
      peakReservePvCreditKwh: Math.round(targetDetails.peakReserve.pvCreditKwh * 100) / 100,
      peakReserveShortfallAfterPvKwh: Math.round(targetDetails.peakReserve.reserveShortfallAfterPvKwh * 100) / 100,
      peakReservePvFullyCovers: Boolean(targetDetails.peakReserve.pvFullyCoversReserve),
      peakReserveActive: Boolean(targetDetails.peakReserve.active),
      peakReserveMonth: targetDetails.peakReserve.month,
      peakReserveSeason: targetDetails.peakReserve.season,
      peakReserveInactiveReason: targetDetails.peakReserve.inactiveReason,
      forecastEnergyGapKwh: targetDetails.gapKwh === null ? null : Math.round(targetDetails.gapKwh * 100) / 100,
      dynamicPriceReady: dynamicReady,
      currentSoc: null,
      targetSoc: Math.round(targetSoc * 10) / 10,
      energyNeedKwh: null,
      maxChargeW: Math.round(maxChargeW),
      ...planningScope,
      rows,
      nextNetChargeAt: null,
      scopeLabel,
      message: 'Wachten op minstens één geldige batterij-SoC.',
    };
  }

  if (!dynamicReady) {
    return {
      ready: true,
      forecastReady,
      forecastDay: forecastContext.day,
      ...forecastDisplay,
      forecastKwh: forecastContext.forecastKwh,
      forecastTodayKwh: forecastContext.todayForecastKwh,
      forecastTomorrowKwh: forecastContext.tomorrowForecastKwh,
      safetySoc: Math.round(safetySoc * 10) / 10,
      forecastEnergyTargetSoc: Math.round(targetDetails.forecastTargetSoc * 10) / 10,
      targetOverridden: Boolean(targetDetails.targetOverridden),
      peakReserveTargetSoc: Math.round(targetDetails.peakReserve.reserveTargetSoc * 10) / 10,
      peakReserveConfiguredTargetSoc: Math.round(targetDetails.peakReserve.configuredReserveTargetSoc * 10) / 10,
      selectedMonthsMinSoc: Math.round(targetDetails.peakReserve.selectedMonthsMinSoc * 10) / 10,
      peakReserveKwh: Math.round(targetDetails.peakReserve.reserveKwh * 100) / 100,
      peakReservePercent: Math.round(targetDetails.peakReserve.reservePercent * 10) / 10,
      peakReserveStrategy: targetDetails.peakReserve.strategy,
      peakReserveStrategyKwh: Math.round(targetDetails.peakReserve.strategyReserveKwh * 100) / 100,
      peakReserveStrategyPercent: Math.round(targetDetails.peakReserve.strategyReservePercent * 10) / 10,
      sunnyMonthsMinSocEnabled: Boolean(targetDetails.peakReserve.sunnyMonthsMinSocEnabled),
      sunnyMonthsMinSoc: Math.round(targetDetails.peakReserve.sunnyMonthsMinSoc * 10) / 10,
      sunnyMonthsMinSocActive: Boolean(targetDetails.peakReserve.sunnyMonthsMinSocActive),
      peakReserveNightEnabled: Boolean(targetDetails.peakReserve.nightMinimumsEnabled),
      peakReserveNightActive: Boolean(targetDetails.peakReserve.nightReservePhase),
      peakReserveNightTargetSoc: Math.round(targetDetails.peakReserve.nightReserveTargetSoc * 10) / 10,
      peakReserveNightCombinedGapKwh: Math.round(targetDetails.peakReserve.nightCombinedGapKwh * 100) / 100,
      peakReservePvCreditKwh: Math.round(targetDetails.peakReserve.pvCreditKwh * 100) / 100,
      peakReserveShortfallAfterPvKwh: Math.round(targetDetails.peakReserve.reserveShortfallAfterPvKwh * 100) / 100,
      peakReservePvFullyCovers: Boolean(targetDetails.peakReserve.pvFullyCoversReserve),
      peakReserveActive: Boolean(targetDetails.peakReserve.active),
      peakReserveMonth: targetDetails.peakReserve.month,
      peakReserveSeason: targetDetails.peakReserve.season,
      peakReserveInactiveReason: targetDetails.peakReserve.inactiveReason,
      forecastEnergyGapKwh: targetDetails.gapKwh === null ? null : Math.round(targetDetails.gapKwh * 100) / 100,
      dynamicPriceReady: false,
      currentSoc: Math.round(avgSoc * 10) / 10,
      targetSoc: Math.round(targetSoc * 10) / 10,
      energyNeedKwh: energyNeedKwh === null ? null : Math.round(energyNeedKwh * 100) / 100,
      maxChargeW: Math.round(maxChargeW),
      ...planningScope,
      rows,
      nextNetChargeAt: null,
      scopeLabel,
      message: 'Geen bruikbare dynamische prijsdata: netladen wordt niet gepland.',
    };
  }

  // Planning is only requested explicitly by the settings page. It never polls
  // devices. Dynamic plans are built directly from the known price slots.
  // Fixed/TOU plans reuse the same peak-aligned tariff cycle as production, so
  // the display and real charging calculation cannot drift apart.
  const cheapBlocks = [];
  if (dynamic) {
    const slots = sanitizeDynamicSlots(settings);
    const intervalMinutes = inferDynamicInterval(slots);
    const cheapCount = Math.max(1, Math.round((clamp(settings.cheapHours, 0.25, 12) * 60) / intervalMinutes));
    const byPrice = slots.slice().sort((a, b) => a.price - b.price || a.minute - b.minute);
    const cheapMinutes = new Set(byPrice.slice(0, cheapCount).map(slot => slot.minute));
    let active = null;
    for (const slot of slots) {
      if (!cheapMinutes.has(slot.minute)) continue;
      const slotEndMinute = slot.minute + intervalMinutes;
      if (slotEndMinute <= nowMinute) continue;
      const startMinute = Math.max(slot.minute, nowMinute);
      const startDelta = Math.max(0, startMinute - nowMinute);
      const endDelta = Math.max(startDelta + 1, Math.min(1440, slotEndMinute) - nowMinute);
      const startAt = now.getTime() + (startDelta * 60000);
      const endAt = now.getTime() + (endDelta * 60000);
      const label = `Goedkoop €${slot.price.toFixed(3)}/kWh`;
      if (active && startAt <= active.endAt + 1000) {
        active.endAt = Math.max(active.endAt, endAt);
        active.prices.push(slot.price);
      } else {
        if (active) cheapBlocks.push(active);
        active = { startAt, endAt, tariffLabel: 'Goedkoop', price: slot.price, prices: [slot.price] };
      }
    }
    if (active) cheapBlocks.push(active);
    cheapBlocks.forEach(block => {
      if (block.prices.length > 1) block.price = block.prices.reduce((a, b) => a + b, 0) / block.prices.length;
      delete block.prices;
    });
  } else {
    cheapBlocks.push(...(planningCycle?.cheapBlocks || []));
  }

  const targetReady = forecastReady || targetSoc > clamp(settings.minSoc, 0, 100);
  let remainingKwh = targetReady && energyNeedKwh !== null ? energyNeedKwh : 0;
  const nowAt = now.getTime();
  const deadlineAt = Number(planningScope.planningChargeDeadlineAt) || Number.MAX_SAFE_INTEGER;
  const planBlocks = cheapBlocks.slice(0, 12).map(block => {
    const startAt = Number(block.startAt);
    const endAt = Number(block.endAt);
    const availableStartAt = Math.max(nowAt, startAt);
    const availableEndAt = Math.min(deadlineAt, endAt);
    const availableMilliseconds = Math.max(0, availableEndAt - availableStartAt);
    const windowState = endAt <= nowAt ? 'past' : (startAt <= nowAt ? 'active' : 'future');
    return {
      ...block,
      startAt,
      endAt,
      availableStartAt: availableMilliseconds > 0 ? availableStartAt : null,
      availableEndAt: availableMilliseconds > 0 ? availableEndAt : null,
      availableMilliseconds,
      availableHours: availableMilliseconds / 3600000,
      availableMinutes: Math.round(availableMilliseconds / 60000),
      elapsedMinutes: windowState === 'active' ? Math.max(0, Math.round((nowAt - startAt) / 60000)) : (windowState === 'past' ? Math.max(0, Math.round((endAt - startAt) / 60000)) : 0),
      windowState,
    };
  });
  const totalAvailableHours = planBlocks.reduce((sum, block) => sum + block.availableHours, 0);
  const cycleChargeW = !dynamic && targetReady && remainingKwh > 0.001 && totalAvailableHours > 0 && maxChargeW > 0
    ? clamp((remainingKwh * 1000) / totalAvailableHours, 0, maxChargeW)
    : 0;

  for (const block of planBlocks) {
    const durationHours = block.availableHours;
    let plannedChargeW = 0;
    let chargeKwh = 0;
    let plannedEndAt = null;
    if (targetReady && remainingKwh > 0.001 && durationHours > 0 && maxChargeW > 0) {
      if (dynamic) {
        const planUntil = Number(block.availableStartAt) + (12 * 60 * 60 * 1000);
        const availableHours = planBlocks.reduce((sum, candidate) => {
          if (!candidate.availableStartAt || !candidate.availableEndAt) return sum;
          const overlapStart = Math.max(Number(block.availableStartAt), Number(candidate.availableStartAt));
          const overlapEnd = Math.min(planUntil, Number(candidate.availableEndAt));
          return sum + Math.max(0, overlapEnd - overlapStart) / 3600000;
        }, 0);
        plannedChargeW = availableHours > 0
          ? clamp((remainingKwh * 1000) / availableHours, 0, maxChargeW)
          : 0;
      } else {
        plannedChargeW = cycleChargeW;
      }
      chargeKwh = Math.min(remainingKwh, (plannedChargeW / 1000) * durationHours);
      remainingKwh = Math.max(0, remainingKwh - chargeKwh);
      if (plannedChargeW > 0 && block.availableStartAt) {
        plannedEndAt = Math.min(
          Number(block.availableEndAt),
          Number(block.availableStartAt) + ((chargeKwh / (plannedChargeW / 1000)) * 3600000),
        );
      }
    }

    rows.push({
      startAt: block.startAt,
      endAt: block.endAt,
      availableStartAt: block.availableStartAt,
      availableEndAt: block.availableEndAt,
      availableMinutes: block.availableMinutes,
      elapsedMinutes: block.elapsedMinutes,
      windowState: block.windowState,
      plannedStartAt: chargeKwh > 0.001 ? block.availableStartAt : null,
      plannedEndAt: chargeKwh > 0.001 ? plannedEndAt : null,
      tariffLabel: block.tariffLabel,
      price: block.price,
      plannedNetCharge: chargeKwh > 0.001,
      plannedChargeW: Math.round(plannedChargeW),
      plannedEnergyKwh: Math.round(chargeKwh * 100) / 100,
      // This is the required SoC goal for the window, not a projection of the
      // current SoC. Past windows remain visible for context, but their elapsed
      // time is never counted as still available charging time.
      socTarget: Math.round(targetSoc * 10) / 10,
    });
  }

  const next = rows.find(row => row.plannedNetCharge && row.availableStartAt);
  const hasRemainingChargeWindow = rows.some(row => Number(row.availableMinutes) > 0);
  let message = '';
  if (!forecastReady && targetSoc > clamp(settings.minSoc, 0, 100)) {
    const activeReserveKwh = Math.max(0, Number(targetDetails.peakReserve.strategyReserveKwh) || 0);
    const reserveText = targetDetails.peakReserve.active && activeReserveKwh > 0.001
      ? ` en de actieve minimumreserve van ${activeReserveKwh.toFixed(1)} kWh omdat geen PV kan worden meegerekend`
      : '';
    message = `${forecastContext.day === 'tomorrow' ? 'PV-voorspelling morgen' : 'Resterende PV-voorspelling vandaag'} ontbreekt: planning gebruikt de Veiligheids-SoC van ${safetySoc.toFixed(1)}%${reserveText}.`;
  } else if (!forecastReady) message = `${forecastContext.day === 'tomorrow' ? 'PV-voorspelling morgen' : 'Resterende PV-voorspelling vandaag'} ontbreekt: er wordt geen forecast-netladen gepland.`;
  else if ((energyNeedKwh || 0) <= 0.001) message = 'Forecast-doel is al bereikt; momenteel geen netladen nodig.';
  else if (!rows.length) message = 'Geen goedkoop laadvenster gevonden vóór de doelpiek.';
  else if (!hasRemainingChargeWindow) message = 'Alle laadvensters vóór de doelpiek zijn al voorbij; er is geen resterende laadtijd.';
  else if (!next) message = 'Geen netladen nodig in de resterende goedkope laadvensters.';
  else if (remainingKwh > 0.01) message = `Doel kan met de huidige laadlimieten niet volledig binnen de getoonde laadvensters worden gehaald; nog ${remainingKwh.toFixed(2)} kWh tekort.`;
  else message = 'Geplande SoC-doelen zijn indicatief en worden opnieuw berekend zodra SoC, forecast of prijzen wijzigen.';

  return {
    ready: true,
    forecastReady,
    forecastDay: forecastContext.day,
    ...forecastDisplay,
    forecastKwh: forecastContext.forecastKwh,
    forecastTodayKwh: forecastContext.todayForecastKwh,
    forecastTomorrowKwh: forecastContext.tomorrowForecastKwh,
    planningDecisionSource: state.planningDecisionSource,
    safetySoc: Math.round(safetySoc * 10) / 10,
    forecastEnergyTargetSoc: Math.round(targetDetails.forecastTargetSoc * 10) / 10,
    targetOverridden: Boolean(targetDetails.targetOverridden),
    peakReserveTargetSoc: Math.round(targetDetails.peakReserve.reserveTargetSoc * 10) / 10,
    peakReserveConfiguredTargetSoc: Math.round(targetDetails.peakReserve.configuredReserveTargetSoc * 10) / 10,
    selectedMonthsMinSoc: Math.round(targetDetails.peakReserve.selectedMonthsMinSoc * 10) / 10,
    peakReserveKwh: Math.round(targetDetails.peakReserve.reserveKwh * 100) / 100,
    peakReservePercent: Math.round(targetDetails.peakReserve.reservePercent * 10) / 10,
    peakReserveStrategy: targetDetails.peakReserve.strategy,
    peakReserveStrategyKwh: Math.round(targetDetails.peakReserve.strategyReserveKwh * 100) / 100,
    peakReserveStrategyPercent: Math.round(targetDetails.peakReserve.strategyReservePercent * 10) / 10,
    sunnyMonthsMinSocEnabled: Boolean(targetDetails.peakReserve.sunnyMonthsMinSocEnabled),
    sunnyMonthsMinSoc: Math.round(targetDetails.peakReserve.sunnyMonthsMinSoc * 10) / 10,
    sunnyMonthsMinSocActive: Boolean(targetDetails.peakReserve.sunnyMonthsMinSocActive),
    peakReserveNightEnabled: Boolean(targetDetails.peakReserve.nightMinimumsEnabled),
    peakReserveNightActive: Boolean(targetDetails.peakReserve.nightReservePhase),
    peakReserveNightTargetSoc: Math.round(targetDetails.peakReserve.nightReserveTargetSoc * 10) / 10,
    peakReserveNightCombinedGapKwh: Math.round(targetDetails.peakReserve.nightCombinedGapKwh * 100) / 100,
    peakReservePvCreditKwh: Math.round(targetDetails.peakReserve.pvCreditKwh * 100) / 100,
    peakReserveShortfallAfterPvKwh: Math.round(targetDetails.peakReserve.reserveShortfallAfterPvKwh * 100) / 100,
    peakReservePvFullyCovers: Boolean(targetDetails.peakReserve.pvFullyCoversReserve),
    peakReserveActive: Boolean(targetDetails.peakReserve.active),
    peakReserveMonth: targetDetails.peakReserve.month,
    peakReserveSeason: targetDetails.peakReserve.season,
    peakReserveInactiveReason: targetDetails.peakReserve.inactiveReason,
    forecastEnergyGapKwh: targetDetails.gapKwh === null ? null : Math.round(targetDetails.gapKwh * 100) / 100,
    dynamicPriceReady: dynamicReady,
    currentSoc: Math.round(avgSoc * 10) / 10,
    targetSoc: Math.round(targetSoc * 10) / 10,
    energyNeedKwh: energyNeedKwh === null ? null : Math.round(energyNeedKwh * 100) / 100,
    remainingUnplannedKwh: Math.round(remainingKwh * 100) / 100,
    maxChargeW: Math.round(maxChargeW),
    ...planningScope,
    rows,
    nextNetChargeAt: next ? (next.plannedStartAt || next.availableStartAt || next.startAt) : null,
    scopeLabel,
    message,
  };
}

function applySocLimits(commandW, avgSoc, settings) {
  if (avgSoc === null) return 0;
  const minSoc = clamp(settings.minSoc, 0, 100);
  const maxSoc = clamp(settings.maxSoc, minSoc, 100);
  if (avgSoc <= minSoc && commandW > 0) return 0;
  if (avgSoc >= maxSoc && commandW < 0) return 0;
  return commandW;
}

function applyPeakGuard(desiredW, state, settings, lastTotalCommandW) {
  if (!settings.peakShaveEnabled) return { commandW: desiredW, active: false, predictedGridW: null };

  const grid = asNumber(state.gridPowerW, 0);
  const softTarget = Math.max(0, asNumber(settings.peakLimitW, 2500) - Math.max(0, asNumber(settings.peakSoftMarginW, 100)));
  const predicted = grid + asNumber(lastTotalCommandW, 0) - desiredW;
  if (predicted <= softTarget) return { commandW: desiredW, active: false, predictedGridW: predicted };

  const correction = predicted - softTarget;
  return {
    commandW: desiredW + correction,
    active: true,
    predictedGridW: softTarget,
  };
}

function distributeCommand(totalCommandW, state, settings, options = {}) {
  const count = Math.round(clamp(settings.batteryCount, 1, 8));
  const soc = Array.from({ length: count }, (_, i) => {
    const raw = Array.isArray(state.batterySoc) ? state.batterySoc[i] : null;
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  });
  const valid = soc.filter(v => v !== null);
  const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  const deadband = Math.max(0, asNumber(settings.balanceDeadbandPct, 1));
  const strength = clamp(settings.balanceStrength, 0, 0.5);
  const minSoc = clamp(settings.minSoc, 0, 100);
  const maxSoc = clamp(settings.maxSoc, minSoc, 100);
  const dischargeFloorSoc = Math.max(minSoc, clamp(
    options.dischargeFloorSoc === undefined ? minSoc : options.dischargeFloorSoc,
    minSoc,
    100,
  ));

  const weights = soc.map(value => {
    // Missing SoC is excluded completely. A received SoC value does not expire by age. Min/max SoC and the optional
    // battery-save floor are enforced PER battery, never via the park average.
    if (value === null) return 0;
    if (totalCommandW > 0 && value <= dischargeFloorSoc) return 0;
    if (totalCommandW < 0 && value >= maxSoc) return 0;
    if (!settings.balanceEnabled || avg === null) return 1;
    const delta = value - avg;
    if (Math.abs(delta) <= deadband) return 1;
    if (totalCommandW < 0) return delta < 0 ? 1 + strength : 1 - strength;
    if (totalCommandW > 0) return delta > 0 ? 1 + strength : 1 - strength;
    return 1;
  });

  const sumWeights = weights.reduce((a, b) => a + b, 0);
  if (sumWeights <= 0) return Array(count).fill(0);
  const maxCharge = Math.max(0, asNumber(settings.maxChargePerBatteryW, 2300));
  const maxDischarge = Math.max(0, asNumber(settings.maxDischargePerBatteryW, 2400));

  let commands = weights.map(weight => totalCommandW * (weight / sumWeights));
  commands = commands.map(value => clamp(value, -maxCharge, maxDischarge));

  // Redistribute remaining command over batteries that still have headroom.
  for (let pass = 0; pass < 4; pass += 1) {
    const actual = commands.reduce((a, b) => a + b, 0);
    const residual = totalCommandW - actual;
    if (Math.abs(residual) < 1) break;
    const eligible = commands
      .map((value, index) => ({ value, index }))
      .filter(item => weights[item.index] > 0)
      .filter(item => residual > 0 ? item.value < maxDischarge - 1 : item.value > -maxCharge + 1);
    if (!eligible.length) break;
    const share = residual / eligible.length;
    for (const item of eligible) {
      commands[item.index] = clamp(commands[item.index] + share, -maxCharge, maxDischarge);
    }
  }

  return commands.map(value => Math.round(value));
}

function prepareControlContext(inputState = {}, inputSettings = {}, nowInput = new Date()) {
  const settings = { ...DEFAULTS, ...inputSettings };
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const liveGridPowerW = asNumber(inputState.gridPowerW, 0);
  const state = {
    gridPowerW: liveGridPowerW,
    controlGridPowerW: asNumber(inputState.controlGridPowerW, liveGridPowerW),
    gridAverage5sW: asNumber(inputState.gridAverage5sW, liveGridPowerW),
    controlGridSource: String(inputState.controlGridSource || 'live'),
    pvPowerW: Math.max(0, asNumber(inputState.pvPowerW, 0)),
    forecastRemainingKwh: Math.max(0, asNumber(inputState.forecastRemainingKwh, 0)),
    forecastDailyMaxKwh: optionalNumber(inputState.forecastDailyMaxKwh),
    forecastTomorrowKwh: optionalNumber(inputState.forecastTomorrowKwh),
    batterySoc: Array.isArray(inputState.batterySoc) ? inputState.batterySoc : [],
    lastTotalCommandW: asNumber(inputState.lastTotalCommandW, 0),
    pvDeltaW: asNumber(inputState.pvDeltaW, 0),
    planningForecastDay: String(inputState.planningForecastDay || 'today') === 'tomorrow' ? 'tomorrow' : 'today',
    planningDecisionSource: String(inputState.planningDecisionSource || ''),
    nightPlanningActive: Boolean(inputState.nightPlanningActive),
    targetSocOverride: optionalNumber(inputState.targetSocOverride),
  };
  const forecastContext = getForecastPlanningContext(state, settings, now);
  const strategyForecastContext = getForecastStrategyContext(state, settings, now);
  const targetDetails = computeForecastTargetDetails(state, settings, now);
  const tariff = findCurrentTariff(now, settings, state);
  return {
    createdAt: now.getTime(),
    forecastContext,
    strategyForecastContext,
    targetDetails,
    tariff,
    tariffValidUntil: tariff?.nextAt ? tariff.nextAt.getTime() : 0,
  };
}

function evaluate(inputState = {}, inputSettings = {}, nowInput = new Date(), preparedContext = null) {
  const settings = { ...DEFAULTS, ...inputSettings };
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const liveGridPowerW = asNumber(inputState.gridPowerW, 0);
  const state = {
    gridPowerW: liveGridPowerW,
    controlGridPowerW: asNumber(inputState.controlGridPowerW, liveGridPowerW),
    gridAverage5sW: asNumber(inputState.gridAverage5sW, liveGridPowerW),
    controlGridSource: String(inputState.controlGridSource || 'live'),
    pvPowerW: Math.max(0, asNumber(inputState.pvPowerW, 0)),
    forecastRemainingKwh: Math.max(0, asNumber(inputState.forecastRemainingKwh, 0)),
    forecastDailyMaxKwh: optionalNumber(inputState.forecastDailyMaxKwh),
    forecastTomorrowKwh: optionalNumber(inputState.forecastTomorrowKwh),
    batterySoc: Array.isArray(inputState.batterySoc) ? inputState.batterySoc : [],
    lastTotalCommandW: asNumber(inputState.lastTotalCommandW, 0),
    pvDeltaW: asNumber(inputState.pvDeltaW, 0),
    planningForecastDay: String(inputState.planningForecastDay || 'today') === 'tomorrow' ? 'tomorrow' : 'today',
    planningDecisionSource: String(inputState.planningDecisionSource || ''),
    nightPlanningActive: Boolean(inputState.nightPlanningActive),
    targetSocOverride: optionalNumber(inputState.targetSocOverride),
  };

  const avgSoc = computeAverageSoc(state, settings);
  // v0.3.57: forecast/target/tariff context can be prepared by the slow loop.
  // The fast battery path still uses the newest meter, SoC, PV and last-command
  // values, but avoids re-sorting tariffs and rebuilding forecast targets on
  // every meter-driven control pass.
  const contextUsable = preparedContext && typeof preparedContext === 'object'
    && (!Number(preparedContext.tariffValidUntil) || now.getTime() < Number(preparedContext.tariffValidUntil) + 1000);
  const forecastContext = contextUsable && preparedContext.forecastContext
    ? preparedContext.forecastContext
    : getForecastPlanningContext(state, settings, now);
  const strategyForecastContext = contextUsable && preparedContext.strategyForecastContext
    ? preparedContext.strategyForecastContext
    : getForecastStrategyContext(state, settings, now);
  const targetDetails = contextUsable && preparedContext.targetDetails
    ? preparedContext.targetDetails
    : computeForecastTargetDetails(state, settings, now);
  const targetSoc = targetDetails.targetSoc;
  const tariff = contextUsable && preparedContext.tariff
    ? preparedContext.tariff
    : findCurrentTariff(now, settings, state);
  const baseMode = determineBaseMode(state, settings, tariff, avgSoc, targetSoc, strategyForecastContext);
  const lowForecastBatterySaveActive = baseMode === 'solar_capture'
    && lowForecastBatterySaveApplies(state, settings, tariff, strategyForecastContext)
    && !(isDynamicContract(settings) && settings.dynamicPriceDataReady === false)
    && !(isDynamicContract(settings) && tariff.className === 'normal' && !Boolean(settings.dynamicUseBatteryNormalHours));
  const count = Math.round(clamp(settings.batteryCount, 1, 8));
  const perBatteryTotalCharge = count * Math.max(0, asNumber(settings.maxChargePerBatteryW, 2300));
  const perBatteryTotalDischarge = count * Math.max(0, asNumber(settings.maxDischargePerBatteryW, 2400));
  const totalMaxCharge = Math.min(perBatteryTotalCharge, Math.max(0, asNumber(settings.maxTotalChargeW, perBatteryTotalCharge)));
  const totalMaxDischarge = Math.min(perBatteryTotalDischarge, Math.max(0, asNumber(settings.maxTotalDischargeW, perBatteryTotalDischarge)));
  const last = state.lastTotalCommandW;
  const responseGain = controlGain(settings);
  const gridErrorW = gridControlErrorW(state.controlGridPowerW, settings, avgSoc);
  const zeroBand = gridZeroBand(settings);

  let desired = 0;
  let plannedChargeW = 0;
  let gridChargeAssistW = 0;

  if (baseMode === 'solar_capture') {
    // Battery-save is enforced later PER battery. The normal controller still
    // calculates from the measured grid; batteries at/below the save floor are
    // simply not eligible to discharge unless Peak Guard really needs them.
    desired = last + (gridErrorW * responseGain);
  } else if (baseMode === 'self_consumption' || baseMode === 'avoid_import') {
    // Target ~0 W grid import/export.
    desired = last + (gridErrorW * responseGain);
  } else if (baseMode === 'charge') {
    plannedChargeW = computeChargePlanW(state, settings, tariff, avgSoc, targetSoc);
    const estimatedHouseLoadW = Math.max(0, state.gridPowerW + state.pvPowerW + last);
    const pvSurplusW = Math.max(0, state.pvPowerW - estimatedHouseLoadW);
    gridChargeAssistW = Math.max(0, plannedChargeW - pvSurplusW);
    desired = -plannedChargeW;
  } else if (baseMode === 'manual_charge') {
    // v0.3.80: a forced charge override means full available EMS charging
    // power. The configured group/per-battery limits and Peak Guard below are
    // still authoritative, so this can never bypass the installation limits.
    plannedChargeW = totalMaxCharge;
    desired = -plannedChargeW;
  } else if (baseMode === 'standby') {
    desired = 0;
  } else {
    desired = last + (gridErrorW * responseGain);
  }

  // Universal export-capture rule: in every ACTIVE operating mode a negative
  // grid meter is proof of real export. Never throw that energy away merely
  // because a price/save strategy would otherwise hold the battery. Stand-by
  // remains a true zero-output mode. Forced/planned charging may charge harder,
  // but never less than required to absorb the measured export.
  if (baseMode !== 'standby' && state.controlGridPowerW < zeroBand.min) {
    const exportCaptureTargetW = last + (gridErrorW * responseGain);
    desired = Math.min(desired, exportCaptureTargetW);
  }

  desired = clamp(desired, -totalMaxCharge, totalMaxDischarge);

  const minSoc = clamp(settings.minSoc, 0, 100);
  const safetySoc = clamp(settings.safetySoc, minSoc, clamp(settings.maxSoc, minSoc, 100));
  const saveFloor = Math.max(safetySoc, clamp(settings.batterySaveDischargeAboveSoc, 0, 100));
  // v0.3.11: a tariff can explicitly allow use of stored energy down to the
  // forecast target even while low-PV Battery Save is active. This lets e.g.
  // Dal consume only the reserve that planning says is not needed tomorrow.
  const lowForecastDischargeToTargetActive = lowForecastBatterySaveActive
    && Boolean(tariff?.lowForecastDischargeToTarget)
    && avgSoc !== null
    && avgSoc > targetSoc + 0.05;
  const forecastDischargeFloor = Math.max(safetySoc, targetSoc);
  // The PV-adjusted peak reserve is protected before/after expensive periods,
  // but becomes usable during the expensive price category itself. Remaining
  // PV is credited first, so this floor only protects the part that forecast PV
  // can no longer be expected to supply before the upcoming peak.
  const peakReserveProtected = Boolean(targetDetails.peakReserve.active)
    && targetDetails.peakReserve.reserveShortfallAfterPvKwh > 0.001
    && tariff.className !== 'expensive'
    && !Boolean(tariff?.avoidGridImport);
  const peakReserveDischargeFloor = peakReserveProtected
    ? Math.max(safetySoc, targetDetails.peakReserve.reserveTargetSoc)
    : safetySoc;
  const ordinaryDischargeFloor = baseMode === 'solar_capture'
    ? (lowForecastDischargeToTargetActive ? forecastDischargeFloor : Math.max(saveFloor, peakReserveDischargeFloor))
    : peakReserveDischargeFloor;

  // First apply all per-battery limits to the ordinary strategy. Peak Guard is
  // then calculated from what those batteries can REALLY deliver. If the peak
  // still needs help, it may use batteries below the save floor down to minSoc.
  const ordinaryCommands = distributeCommand(desired, state, settings, { dischargeFloorSoc: ordinaryDischargeFloor });
  const ordinaryTotalW = ordinaryCommands.reduce((sum, value) => sum + value, 0);
  const peak = applyPeakGuard(ordinaryTotalW, state, settings, last);

  let commands = ordinaryCommands;
  if (peak.active) {
    const peakDesired = clamp(peak.commandW, -totalMaxCharge, totalMaxDischarge);
    commands = distributeCommand(peakDesired, state, settings, { dischargeFloorSoc: minSoc });
  }

  // Some battery APIs (for example certain LUNA control paths) only accept
  // coarse power steps. Quantize the FINAL per-battery command so every other
  // safety, SoC and balancing decision has already been applied. The controller
  // feeds back the actually published rounded total on the next cycle.
  const commandStepW = batteryCommandStep(settings);
  commands = commands.map(value => {
    const rounded = roundBatteryCommand(value, settings);
    if (rounded < 0) {
      const quantizedMaxCharge = Math.floor(Math.max(0, asNumber(settings.maxChargePerBatteryW, 2300)) / commandStepW) * commandStepW;
      return -Math.min(Math.abs(rounded), quantizedMaxCharge);
    }
    const quantizedMaxDischarge = Math.floor(Math.max(0, asNumber(settings.maxDischargePerBatteryW, 2400)) / commandStepW) * commandStepW;
    return Math.min(rounded, quantizedMaxDischarge);
  });
  const totalCommandW = commands.reduce((sum, value) => sum + value, 0);

  let modeLabel = baseMode === 'solar_capture'
    ? (lowForecastDischargeToTargetActive
      ? `Batterij sparen · ontladen tot forecast-doel ${targetSoc.toFixed(1)}%`
      : (lowForecastBatterySaveActive ? 'Batterij sparen · lage PV-voorspelling' : 'Batterij sparen'))
    : 'Zelfconsumptie';
  if (baseMode === 'charge') modeLabel = 'Netladen';
  if (baseMode === 'manual_charge') modeLabel = 'Handmatig laden';
  if (baseMode === 'avoid_import') modeLabel = 'Netimport vermijden';
  if (baseMode === 'standby') modeLabel = 'Stand-by';

  const override = peak.active ? 'peak_shave' : null;
  const overrideLabel = peak.active ? `Peak shave ${Math.round(settings.peakLimitW)} W` : '';

  const finalChargeW = Math.max(0, -totalCommandW);
  const finalDischargeW = Math.max(0, totalCommandW);
  let gridChargeW = 0;
  let pvChargeW = 0;
  if (finalChargeW > 0) {
    if (baseMode === 'charge') {
      gridChargeW = Math.min(finalChargeW, Math.max(0, gridChargeAssistW));
      pvChargeW = Math.max(0, finalChargeW - gridChargeW);
    } else if (baseMode === 'manual_charge') {
      gridChargeW = finalChargeW;
    } else {
      pvChargeW = finalChargeW;
    }
  }

  const actionThresholdW = Math.max(25, Math.max(0, asNumber(settings.commandDeadbandW, 25)));
  let action = 'idle';
  let actionLabel = 'Rust';
  if (peak.active && finalDischargeW > 0) {
    action = 'peak_shave';
    actionLabel = `Afvlakken ${Math.round(finalDischargeW)} W`;
  } else if (gridChargeW > actionThresholdW && pvChargeW > actionThresholdW) {
    action = 'grid_and_pv_charge';
    actionLabel = `Netladen ${Math.round(gridChargeW)} W + Laden uit zon ${Math.round(pvChargeW)} W`;
  } else if (gridChargeW > actionThresholdW) {
    action = 'grid_charge';
    actionLabel = `Netladen ${Math.round(gridChargeW)} W`;
  } else if (pvChargeW > actionThresholdW) {
    action = 'pv_charge';
    actionLabel = `Laden uit zon ${Math.round(pvChargeW)} W`;
  } else if (finalDischargeW > actionThresholdW) {
    action = baseMode === 'avoid_import' ? 'avoid_grid_import' : 'discharge';
    actionLabel = baseMode === 'avoid_import'
      ? `Netimport vermijden ${Math.round(finalDischargeW)} W`
      : `Ontladen ${Math.round(finalDischargeW)} W`;
  }

  let nextEventLabel = tariff.nextLabel;
  let nextEventAt = tariff.nextAt;
  let nextEventText = '';
  if (nextEventAt && nextEventLabel) {
    nextEventText = `${nextEventLabel} over ${formatDuration(nextEventAt - now)}`;
  }

  const workingModeLabel = actionLabel === 'Rust' ? modeLabel : actionLabel;
  const statusParts = [tariff.label || 'Geen tarief', workingModeLabel];
  if (nextEventText) statusParts.push(nextEventText);

  const capacityKwh = computeEffectiveCapacityKwh(state, settings);
  const saveFloorSoc = baseMode === 'solar_capture' ? ordinaryDischargeFloor : saveFloor;
  const energyToMinKwh = avgSoc === null ? null : Math.max(0, capacityKwh * ((avgSoc - minSoc) / 100));
  const energyToSaveFloorKwh = avgSoc === null ? null : Math.max(0, capacityKwh * ((avgSoc - saveFloorSoc) / 100));
  const energyToTargetKwh = avgSoc === null ? null : Math.max(0, capacityKwh * ((targetSoc - avgSoc) / 100));

  // Residual demand after PV: the power the battery would need to supply to hold
  // the grid around zero, based on the actual output setpoint used as feedback.
  const residualDemandW = Math.max(0, state.gridPowerW + last);
  const dischargeHoursToMin = energyToMinKwh !== null && residualDemandW > actionThresholdW
    ? energyToMinKwh / (residualDemandW / 1000)
    : null;
  const dischargeHoursToSaveFloor = energyToSaveFloorKwh !== null && residualDemandW > actionThresholdW
    ? energyToSaveFloorKwh / (residualDemandW / 1000)
    : null;
  const chargeReferenceW = plannedChargeW > actionThresholdW ? plannedChargeW : totalMaxCharge;
  const chargeHoursToTarget = energyToTargetKwh !== null && energyToTargetKwh > 0 && chargeReferenceW > actionThresholdW
    ? energyToTargetKwh / (chargeReferenceW / 1000)
    : 0;

  return {
    now: now.toISOString(),
    baseMode,
    modeLabel,
    action,
    actionLabel,
    workingModeLabel,
    override,
    overrideLabel,
    statusText: statusParts.join(' · '),
    nextEventLabel: nextEventLabel || '',
    nextEventAt: nextEventAt ? nextEventAt.getTime() : null,
    nextEventText,
    tariff,
    avgSoc: avgSoc === null ? null : Math.round(avgSoc * 10) / 10,
    targetSoc: Math.round(targetSoc * 10) / 10,
    forecastEnergyTargetSoc: Math.round(targetDetails.forecastTargetSoc * 10) / 10,
    targetOverridden: Boolean(targetDetails.targetOverridden),
    peakReserveTargetSoc: Math.round(targetDetails.peakReserve.reserveTargetSoc * 10) / 10,
    peakReserveConfiguredTargetSoc: Math.round(targetDetails.peakReserve.configuredReserveTargetSoc * 10) / 10,
    selectedMonthsMinSoc: Math.round(targetDetails.peakReserve.selectedMonthsMinSoc * 10) / 10,
    peakReserveKwh: Math.round(targetDetails.peakReserve.reserveKwh * 100) / 100,
    peakReservePercent: Math.round(targetDetails.peakReserve.reservePercent * 10) / 10,
    peakReserveStrategy: targetDetails.peakReserve.strategy,
    peakReserveStrategyKwh: Math.round(targetDetails.peakReserve.strategyReserveKwh * 100) / 100,
    peakReserveStrategyPercent: Math.round(targetDetails.peakReserve.strategyReservePercent * 10) / 10,
    sunnyMonthsMinSocEnabled: Boolean(targetDetails.peakReserve.sunnyMonthsMinSocEnabled),
    sunnyMonthsMinSoc: Math.round(targetDetails.peakReserve.sunnyMonthsMinSoc * 10) / 10,
    sunnyMonthsMinSocActive: Boolean(targetDetails.peakReserve.sunnyMonthsMinSocActive),
    peakReserveNightEnabled: Boolean(targetDetails.peakReserve.nightMinimumsEnabled),
    peakReserveNightActive: Boolean(targetDetails.peakReserve.nightReservePhase),
    peakReserveNightTargetSoc: Math.round(targetDetails.peakReserve.nightReserveTargetSoc * 10) / 10,
    peakReserveNightCombinedGapKwh: Math.round(targetDetails.peakReserve.nightCombinedGapKwh * 100) / 100,
    peakReservePvCreditKwh: Math.round(targetDetails.peakReserve.pvCreditKwh * 100) / 100,
    peakReserveShortfallAfterPvKwh: Math.round(targetDetails.peakReserve.reserveShortfallAfterPvKwh * 100) / 100,
    peakReservePvFullyCovers: Boolean(targetDetails.peakReserve.pvFullyCoversReserve),
    peakReserveActive: Boolean(targetDetails.peakReserve.active),
    peakReserveMonth: targetDetails.peakReserve.month,
    peakReserveSeason: targetDetails.peakReserve.season,
    peakReserveInactiveReason: targetDetails.peakReserve.inactiveReason,
    peakReserveProtected,
    forecastEnergyGapKwh: targetDetails.gapKwh === null ? null : Math.round(targetDetails.gapKwh * 100) / 100,
    safetySoc: Math.round(safetySoc * 10) / 10,
    forecastPlanningDay: forecastContext.day,
    forecastPlanningKwh: forecastContext.forecastKwh === null ? null : Math.round(forecastContext.forecastKwh * 100) / 100,
    forecastTomorrowKwh: forecastContext.tomorrowForecastKwh === null ? null : Math.round(forecastContext.tomorrowForecastKwh * 100) / 100,
    plannedChargeW: Math.round(plannedChargeW),
    gridChargeAssistW: Math.round(gridChargeW),
    pvChargeW: Math.round(pvChargeW),
    totalCommandW,
    commands,
    predictedGridW: peak.predictedGridW === null ? null : Math.round(peak.predictedGridW),
    batterySaveFloorSoc: Math.round(saveFloorSoc * 10) / 10,
    lowForecastBatterySaveActive,
    lowForecastDischargeToTargetActive,
    lowForecastSelfConsumptionMinKwh: Math.max(0, asNumber(settings.lowForecastSelfConsumptionMinKwh, 5)),
    lowForecastReferenceDay: strategyForecastContext.day,
    lowForecastReferenceKwh: strategyForecastContext.forecastKwh === null ? null : Math.round(strategyForecastContext.forecastKwh * 100) / 100,
    lowForecastReferenceSource: strategyForecastContext.source,
    forecastDailyMaxKwh: state.forecastDailyMaxKwh === null ? null : Math.round(state.forecastDailyMaxKwh * 100) / 100,
    effectiveCapacityKwh: Math.round(capacityKwh * 100) / 100,
    validBatteryCount: validBatterySocValues(state, settings).length,
    energyToMinKwh: energyToMinKwh === null ? null : Math.round(energyToMinKwh * 100) / 100,
    energyToSaveFloorKwh: energyToSaveFloorKwh === null ? null : Math.round(energyToSaveFloorKwh * 100) / 100,
    energyToTargetKwh: energyToTargetKwh === null ? null : Math.round(energyToTargetKwh * 100) / 100,
    residualDemandW: Math.round(residualDemandW),
    dischargeHoursToMin: dischargeHoursToMin === null ? null : Math.round(dischargeHoursToMin * 100) / 100,
    dischargeHoursToSaveFloor: dischargeHoursToSaveFloor === null ? null : Math.round(dischargeHoursToSaveFloor * 100) / 100,
    chargeHoursToTarget: Math.round(chargeHoursToTarget * 100) / 100,
    dischargeTimeToMinText: dischargeHoursToMin === null ? '' : formatHours(dischargeHoursToMin),
    dischargeTimeToSaveFloorText: dischargeHoursToSaveFloor === null ? '' : formatHours(dischargeHoursToSaveFloor),
    chargeTimeToTargetText: energyToTargetKwh !== null && energyToTargetKwh > 0 ? formatHours(chargeHoursToTarget) : 'doel bereikt',
    responseGain: Math.round(responseGain * 100) / 100,
    pvDeltaW: Math.round(state.pvDeltaW),
    liveGridPowerW: Math.round(state.gridPowerW),
    controlGridPowerW: Math.round(state.controlGridPowerW),
    gridAverage5sW: Math.round(state.gridAverage5sW),
    controlGridSource: state.controlGridSource,
    gridControlErrorW: Math.round(gridErrorW),
    gridZeroMinW: zeroBand.min,
    gridZeroMaxW: zeroBand.max,
    batteryCommandStepW: commandStepW,
  };
}

module.exports = {
  DEFAULTS,
  evaluate,
  prepareControlContext,
  findCurrentTariff,
  computeForecastTargetSoc,
  computeForecastTargetDetails,
  getForecastPlanningContext,
  getForecastStrategyContext,
  distributeCommand,
  roundBatteryCommand,
  parseTime,
  inWindow,
  inferDynamicInterval,
  isDynamicContract,
  tariffClassLabel,
  buildSocPlan,
};
