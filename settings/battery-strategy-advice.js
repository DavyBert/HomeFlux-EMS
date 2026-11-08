/* Shared configuration/AutoTune advice only; never called by control loops. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomeFluxBatteryStrategyAdvice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const keys = ['batteryCount','forcedMode','minSoc','safetySoc','maxSoc','dayPlanningMaxSoc',
    'batterySaveDischargeAboveSoc','lowForecastAutoSunnyEnabled','lowForecastAutoSunnySoc',
    'lowForecastSelfConsumptionMinKwh','contractType','lowForecastFixedEnabled',
    'lowForecastDynamicCheapEnabled','lowForecastDynamicNormalEnabled','lowForecastDynamicExpensiveEnabled',
    'dynamicUseBatteryNormalHours','touRates','touSchedule','touTariffs',
    'maxTotalChargeW','maxTotalDischargeW','maxChargePerBatteryW','maxDischargePerBatteryW',
    'individualBatteryPowerLimitsEnabled'];
  for (let i = 1; i <= 8; i++) keys.push(`battery${i}MaxChargeW`, `battery${i}MaxDischargeW`);
  const keySet = new Set(keys);
  const number = value => value === null || value === undefined || value === '' || typeof value === 'boolean'
    ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const clampSoc = value => Math.max(0, Math.min(100, value));
  const time = value => /^\d{1,2}:\d{2}$/.test(String(value))
    && Number(String(value).split(':')[0]) < 24 && Number(String(value).split(':')[1]) < 60
    ? Number(String(value).split(':')[0]) * 60 + Number(String(value).split(':')[1]) : null;
  function dayCharge(rate, weekend, cheap) {
    const mode = String((weekend ? rate.weekendChargeMode : rate.weekdayChargeMode) || '').toLowerCase();
    if (['never','night','day','always'].includes(mode)) return mode === 'day' || mode === 'always';
    if (rate.dayChargeAllowed != null || rate.nightChargeAllowed != null) return Boolean(rate.dayChargeAllowed);
    return cheap;
  }
  function touPolicy(settings) {
    const rates = settings.touRates || [], schedule = settings.touSchedule || [];
    const lookup = new Map(rates.map((r, i) => [String(r.id || `rate-${i + 1}`), r]));
    const rows = (rates.length && schedule.length ? schedule.map(block => ({ ...lookup.get(String(block.rateId)),
      start: block.start, end: block.end, days: block.days, validRate: lookup.has(String(block.rateId)) })) : (settings.touTariffs || []).map(rate => ({ ...rate, validRate: true })))
      .map(rate => ({ ...rate, startMinute: time(rate.start), endMinute: time(rate.end),
        days: Array.isArray(rate.days) ? rate.days.map(Number).filter(d => d >= 1 && d <= 7) : [1,2,3,4,5,6,7] }))
      .filter(rate => rate.validRate && rate.startMinute !== null && rate.endMinute !== null && rate.days.length);
    const prices = rows.map(rate => number(rate.importPrice) ?? 0), low = Math.min(...prices), high = Math.max(...prices);
    const boundaries = [...new Set([0, 1440, ...rows.flatMap(rate => [rate.startMinute, rate.endMinute])])].sort((a,b) => a-b);
    let saving = false, charging = false;
    // Inspect actual scheduled coverage, including overnight blocks and overlaps.
    for (let day = 1; day <= 7; day++) for (let i = 0; i < boundaries.length - 1; i++) {
      const minute = boundaries[i], previous = day === 1 ? 7 : day - 1;
      const rate = rows.find(r => r.startMinute === r.endMinute ? r.days.includes(day)
        : r.startMinute < r.endMinute ? r.days.includes(day) && minute >= r.startMinute && minute < r.endMinute
          : minute >= r.startMinute && r.days.includes(day) || minute < r.endMinute && r.days.includes(previous));
      if (!rate || rate.avoidGridImport) continue;
      saving ||= Boolean(rate.lowForecastBatterySave);
      charging ||= dayCharge(rate, day >= 6, high > low && (number(rate.importPrice) ?? 0) === low);
    }
    return saving && charging;
  }
  function risk(settings) {
    if (!settings.lowForecastAutoSunnyEnabled || !(Number(settings.batteryCount) > 0)
      || String(settings.forcedMode || 'auto') !== 'auto' || !(Number(settings.lowForecastSelfConsumptionMinKwh) > 0)
      || !(Number(settings.maxTotalChargeW) > 0) || !(Number(settings.maxTotalDischargeW) > 0)) return false;
    const values = ['dayPlanningMaxSoc','lowForecastAutoSunnySoc','batterySaveDischargeAboveSoc','minSoc','safetySoc','maxSoc'].map(key => number(settings[key]));
    if (values.some(value => value === null)) return false;
    const [day, sunny, save, minimum, safety, maximum] = values.map(clampSoc);
    const hard = Math.max(minimum, Math.min(maximum, safety));
    // Promotion removes the save floor whether it is below, equal to or above
    // the sunny threshold. Reaching the threshold already permits promotion.
    if (!(Math.min(day, maximum) >= sunny && save > hard)) return false;
    for (const kind of ['Charge','Discharge']) {
      const possible = settings.individualBatteryPowerLimitsEnabled
        ? Array.from({ length: Math.min(8, Number(settings.batteryCount)) }, (_, i) =>
          number(settings[`battery${i + 1}Max${kind}W`]) ?? Number(settings[`max${kind}PerBatteryW`])).some(watts => watts > 0)
        : Number(settings[`max${kind}PerBatteryW`]) > 0;
      if (!possible) return false;
    }
    if (String(settings.contractType).startsWith('dynamic')) return Boolean(settings.lowForecastDynamicCheapEnabled
      || settings.lowForecastDynamicExpensiveEnabled
      || settings.lowForecastDynamicNormalEnabled && settings.dynamicUseBatteryNormalHours);
    if (settings.contractType === 'tou') return touPolicy(settings);
    return Boolean(settings.lowForecastFixedEnabled);
  }
  function project(settings, changes) {
    const result = Object.fromEntries(keys.map(key => [key, settings[key]]));
    return Object.assign(result, changes);
  }
  function review(settings, recommendations, automatic = []) {
    const conflicts = rows => {
      const future = project(settings, Object.fromEntries(rows.map(row => [row.settingKey, row.recommended])));
      if (risk(future)) return true;
      const active = new Set(rows.map(row => row.settingKey));
      return automatic.length > 0 && risk(project(settings, Object.fromEntries(automatic
        .filter(row => active.has(row.settingKey)).map(row => [row.settingKey, row.recommended]))));
    };
    if (!conflicts(recommendations)) return { recommendations, blocked: [] };
    const candidates = recommendations.filter(row => keySet.has(row.settingKey));
    // Prefer withholding a conflicting sunny-threshold recommendation; do not
    // invent day-cap authority or raise the save floor as a purported repair.
    candidates.sort((a,b) => Number(b.settingKey === 'lowForecastAutoSunnySoc') - Number(a.settingKey === 'lowForecastAutoSunnySoc'));
    for (const candidate of candidates) {
      const remaining = recommendations.filter(row => row !== candidate);
      if (!conflicts(remaining)) return { recommendations: remaining, blocked: [candidate] };
    }
    return { recommendations: recommendations.filter(row => !keySet.has(row.settingKey)), blocked: candidates };
  }
  return { keys, risk, project, review, isRelevant: key => keySet.has(key) };
});
