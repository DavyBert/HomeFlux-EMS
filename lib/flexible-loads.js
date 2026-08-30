'use strict';

const { localParts } = require('./homey-energy');
const { findCurrentTariff, isDynamicContract } = require('./ems-engine');

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return (hour * 60) + minute;
}

function evPowerPerAmp(settings = {}) {
  const phases = Number(settings.evPhases) === 1 ? 1 : 3;
  return 230 * phases;
}

function evCurrentLimits(settings = {}) {
  const minA = clamp(Math.round(Number(settings.evMinCurrentA) || 6), 1, 64);
  const maxA = clamp(Math.round(Number(settings.evMaxCurrentA) || 32), minA, 64);
  const standardA = clamp(Math.round(Number(settings.evStandardCurrentA) || 16), minA, maxA);
  return { minA, maxA, standardA };
}

function findNextLocalTime(nowInput, timeValue, timezone = 'UTC') {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const targetMinute = parseTime(timeValue);
  if (targetMinute === null) return new Date(now.getTime() + (24 * 60 * 60 * 1000));

  // Scan absolute minutes and compare in Homey's timezone. This stays correct
  // across DST transitions without manually constructing zoned Date objects.
  for (let offset = 1; offset <= (26 * 60); offset += 1) {
    const candidate = new Date(now.getTime() + (offset * 60000));
    if (localParts(candidate, timezone).minuteOfDay === targetMinute) return candidate;
  }
  return new Date(now.getTime() + (24 * 60 * 60 * 1000));
}

function isEvTariffSelected(settings = {}, tariff = null) {
  if (!tariff) return false;
  const type = String(settings.contractType || '');
  if (type === 'tou') {
    const rateId = String(tariff.rateId || '');
    const rate = (Array.isArray(settings.touRates) ? settings.touRates : []).find(item => String(item?.id || '') === rateId);
    if (Boolean(rate?.avoidGridImport)) return false;
    return Boolean(rate?.evChargeAllowed);
  }
  if (isDynamicContract(settings)) {
    if (tariff.className === 'cheap') return Boolean(settings.evDynamicCheapEnabled);
    if (tariff.className === 'expensive') return Boolean(settings.evDynamicExpensiveEnabled);
    return Boolean(settings.evDynamicNormalEnabled);
  }
  // Fixed contract reuses the existing fixed charge window when requested.
  return Boolean(settings.evFixedChargeWindowEnabled) && tariff.className === 'cheap';
}

function isTouAvoidGridImport(settings = {}, tariff = null) {
  if (String(settings.contractType || '') !== 'tou' || !tariff) return false;
  const rateId = String(tariff.rateId || '');
  const rate = (Array.isArray(settings.touRates) ? settings.touRates : []).find(item => String(item?.id || '') === rateId);
  return Boolean(rate?.avoidGridImport);
}

function getEvPvTariffPolicy(settings = {}, tariff = null) {
  const type = String(settings.contractType || '');
  if (type !== 'tou' || !tariff) return { allowed: true, minSurplusW: 0, stopGridImportW: 1000, stopDelaySeconds: 60, hysteresisEnabled: false };
  const rateId = String(tariff.rateId || '');
  const rate = (Array.isArray(settings.touRates) ? settings.touRates : []).find(item => String(item?.id || '') === rateId);
  if (!rate) return { allowed: true, minSurplusW: 0, stopGridImportW: 1000, stopDelaySeconds: 60, hysteresisEnabled: false };
  return {
    // Missing fields mean pre-v0.3.36 settings and must preserve the old
    // behaviour where PV charging was eligible in every TOU category.
    allowed: rate.evPvChargeAllowed !== false,
    minSurplusW: Math.max(0, Number(rate.evPvMinSurplusW) || 0),
    stopGridImportW: Math.max(0, Number(rate.evPvStopGridImportW ?? 1000) || 0),
    stopDelaySeconds: 60,
    hysteresisEnabled: true,
  };
}

function countEvTariffMinutes(nowInput, deadlineInput, settings = {}, stepMinutes = 5) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const deadline = deadlineInput instanceof Date ? deadlineInput : new Date(deadlineInput);
  const step = Math.max(1, Math.round(Number(stepMinutes) || 5));
  let selectedMinutes = 0;
  let otherMinutes = 0;
  const timezone = settings.timezone || 'UTC';
  const baseDateKey = localParts(now, timezone).dateKey;
  const dynamic = isDynamicContract(settings);
  for (let at = now.getTime(); at < deadline.getTime(); at += step * 60000) {
    const end = Math.min(deadline.getTime(), at + (step * 60000));
    const minutes = Math.max(0, (end - at) / 60000);
    const candidate = new Date(at);
    // Dynamic engine slots are intentionally day-local. Never fabricate
    // tomorrow's cheap hours from today's price pattern; unknown future slots
    // count as non-selected until Homey supplies the new day.
    const knownDynamicDay = !dynamic || localParts(candidate, timezone).dateKey === baseDateKey;
    const tariff = knownDynamicDay ? findCurrentTariff(candidate, settings) : null;
    if (knownDynamicDay && isEvTariffSelected(settings, tariff)) selectedMinutes += minutes;
    else otherMinutes += minutes;
  }
  return { selectedMinutes, otherMinutes };
}

function quantizeCurrent(powerW, settings = {}, rounding = 'floor') {
  const { minA, maxA } = evCurrentLimits(settings);
  const perAmpW = evPowerPerAmp(settings);
  if (!Number.isFinite(Number(powerW)) || Number(powerW) <= 0 || perAmpW <= 0) return 0;
  const raw = Number(powerW) / perAmpW;
  const amps = rounding === 'ceil' ? Math.ceil(raw) : Math.floor(raw);
  if (amps < minA) return 0;
  return clamp(amps, minA, maxA);
}

function calculateEvDecision(input = {}) {
  const settings = input.settings || {};
  const enabled = Boolean(settings.evEnabled);
  const connected = Boolean(input.connected);
  const mode = ['emergency', 'soc_target', 'smart'].includes(String(settings.evMode || 'smart'))
    ? String(settings.evMode || 'smart')
    : 'smart';
  const socEnabled = settings.evSocEnabled !== false;
  const soc = Number(input.soc);
  const actualCurrentA = Math.max(0, Number(input.actualCurrentA) || 0);
  const perAmpW = evPowerPerAmp(settings);
  const actualPowerW = actualCurrentA * perAmpW;
  const { minA, maxA, standardA } = evCurrentLimits(settings);
  const maxPowerW = maxA * perAmpW;
  const targetSoc = clamp(Number(settings.evTargetSoc) || 80, 0, 100);
  const batteryKwh = Math.max(1, Number(settings.evBatteryCapacityKwh) || 60);
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const timezone = settings.timezone || 'UTC';
  const deadline = findNextLocalTime(now, settings.evTargetTime || '07:00', timezone);
  const usableSoc = socEnabled && Number.isFinite(soc) ? soc : null;
  const energyNeedKwh = usableSoc !== null ? Math.max(0, batteryKwh * ((targetSoc - usableSoc) / 100)) : null;
  const tariff = input.tariff || findCurrentTariff(now, settings);
  const selectedTariff = isEvTariffSelected(settings, tariff);
  const avoidGridImportTariff = isTouAvoidGridImport(settings, tariff);
  const guarantee = socEnabled && Boolean(settings.evGuaranteeTarget) && !avoidGridImportTariff;
  const pvTariffPolicy = getEvPvTariffPolicy(settings, tariff);
  const pvHeadroomW = Math.max(0, Number(input.pvHeadroomW) || 0);
  const rawGridW = Number(input.gridPowerW) || 0;
  const currentBatteryW = Number(input.currentBatteryCommandW) || 0;
  const nextBatteryW = Number(input.nextBatteryCommandW) || 0;

  const predictedGridAfterBatteryW = rawGridW + currentBatteryW - nextBatteryW;
  const baseGridWithoutEvW = predictedGridAfterBatteryW - actualPowerW;
  const exportBufferW = Boolean(settings.exportLimitEnabled) ? Math.max(0, Number(settings.minimumExportW) || 0) : 0;
  const calculatedPvSurplusW = Math.max(0, -baseGridWithoutEvW - exportBufferW);
  const calculatedPvAvailableW = Math.max(0, calculatedPvSurplusW + pvHeadroomW);
  const overridePv = Number(input.pvAvailableWOverride);
  const pvAvailableW = Number.isFinite(overridePv) ? Math.max(0, overridePv) : calculatedPvAvailableW;

  const base = {
    enabled,
    connected,
    mode,
    socEnabled,
    soc: usableSoc,
    targetSoc,
    deadlineAt: socEnabled ? deadline.getTime() : null,
    energyNeedKwh,
    actualCurrentA,
    actualPowerW: Math.round(actualPowerW),
    selectedTariff,
    avoidGridImportTariff,
    tariffLabel: String(tariff?.label || ''),
    pvAvailableW: Math.round(pvAvailableW),
    pvTariffAllowed: Boolean(pvTariffPolicy.allowed),
    pvTariffMinSurplusW: Math.round(pvTariffPolicy.minSurplusW),
    pvTariffStopGridImportW: Math.round(pvTariffPolicy.stopGridImportW),
    pvTariffStopDelaySeconds: Math.round(pvTariffPolicy.stopDelaySeconds),
    pvTariffHysteresisEnabled: Boolean(pvTariffPolicy.hysteresisEnabled),
    tariffRateId: String(tariff?.rateId || ''),
    baseGridWithoutEvW: Math.round(baseGridWithoutEvW),
    desiredCurrentA: 0,
    desiredPowerW: 0,
    requestedCurrentA: 0,
    requestedPowerW: 0,
    pvRequestPowerW: 0,
    gridRequestPowerW: 0,
    allowed: false,
    source: 'off',
    reason: '',
    guaranteeActive: false,
    peakLimited: false,
  };

  if (!enabled) return { ...base, reason: 'EV-module uit' };
  if (!connected) return { ...base, reason: 'EV niet aangesloten/beschikbaar' };

  if (mode === 'soc_target' && !socEnabled) {
    return { ...base, reason: 'SoC-doelmodus niet beschikbaar: EV-SoC is uitgeschakeld' };
  }
  if (socEnabled && !Number.isFinite(soc)) {
    return { ...base, reason: 'EV-SoC ontbreekt' };
  }
  if (socEnabled && energyNeedKwh !== null && energyNeedKwh <= 0.001 && mode !== 'emergency') {
    return { ...base, reason: 'EV-laaddoel bereikt' };
  }

  let desiredA = 0;
  let source = 'off';
  let guaranteeActive = false;
  const rawPvA = quantizeCurrent(pvAvailableW, settings, 'floor');
  const pvThresholdMet = pvAvailableW >= pvTariffPolicy.minSurplusW;
  // v0.3.37: the configured PV threshold is a START threshold. Once a TOU PV
  // charging session is active, lower PV may continue to modulate the EV; the
  // app-level net-import hysteresis decides when the session is actually stopped.
  const pvSessionActive = Boolean(input.pvSessionActive) && Boolean(pvTariffPolicy.hysteresisEnabled);
  const smartPvA = pvTariffPolicy.allowed && (pvThresholdMet || pvSessionActive) ? rawPvA : 0;
  let pvRequestPowerW = 0;
  let gridRequestPowerW = 0;

  if (mode === 'emergency') {
    desiredA = maxA;
    source = 'emergency';
    pvRequestPowerW = Math.min(maxPowerW, rawPvA * perAmpW);
    gridRequestPowerW = Math.max(0, maxPowerW - pvRequestPowerW);
  } else if (mode === 'soc_target') {
    desiredA = maxA;
    source = 'soc_target';
    pvRequestPowerW = Math.min(maxPowerW, rawPvA * perAmpW);
    gridRequestPowerW = Math.max(0, maxPowerW - pvRequestPowerW);
  } else {
    // Smart mode: PV eligibility may be configured per TOU tariff. Grid charging is only eligible during
    // selected tariffs, or when the optional SoC/deadline guarantee says waiting
    // any longer would make the target impossible.
    // Per TOU tariff the user can decide whether PV surplus by itself may
    // start Smart EV charging, and from which surplus threshold. This does not
    // block PV from being consumed when another valid reason (selected tariff
    // or target guarantee) already allows charging.
    desiredA = smartPvA;
    source = desiredA > 0 ? 'pv' : 'off';
    pvRequestPowerW = desiredA * perAmpW;

    if (selectedTariff) {
      const beforeTariffA = desiredA;
      desiredA = Math.max(desiredA, standardA);
      source = desiredA > beforeTariffA ? (beforeTariffA > 0 ? 'pv+tariff' : 'tariff') : source;

      if (guarantee && energyNeedKwh !== null) {
        const minutes = countEvTariffMinutes(now, deadline, settings, 5).selectedMinutes;
        if (minutes > 0) {
          const requiredSelectedPowerW = (energyNeedKwh * 1000) / (minutes / 60);
          desiredA = Math.max(desiredA, quantizeCurrent(requiredSelectedPowerW, settings, 'ceil'));
        }
      }
      gridRequestPowerW = Math.max(0, (desiredA * perAmpW) - pvRequestPowerW);
    } else if (guarantee && energyNeedKwh !== null) {
      const stepMs = 5 * 60000;
      const futureStart = new Date(Math.min(deadline.getTime(), now.getTime() + stepMs));
      const future = countEvTariffMinutes(futureStart, deadline, settings, 5);
      const selectedFutureKwh = (future.selectedMinutes / 60) * (maxPowerW / 1000);
      const deficitKwh = Math.max(0, energyNeedKwh - selectedFutureKwh);
      const otherHoursNeeded = maxPowerW > 0 ? deficitKwh / (maxPowerW / 1000) : Infinity;
      const otherHoursFuture = future.otherMinutes / 60;
      if (deficitKwh > 0.001 && otherHoursNeeded >= Math.max(0, otherHoursFuture - (5 / 60))) {
        desiredA = maxA;
        source = 'guarantee';
        guaranteeActive = true;
        gridRequestPowerW = Math.max(0, (desiredA * perAmpW) - pvRequestPowerW);
      }
    }

    // Once Smart charging is allowed for any reason, available PV should still
    // offset grid demand even if PV itself was not eligible to START charging
    // in the current tariff category.
    if (desiredA > 0) {
      pvRequestPowerW = Math.min(desiredA * perAmpW, rawPvA * perAmpW);
      gridRequestPowerW = Math.max(0, (desiredA * perAmpW) - pvRequestPowerW);
    }
  }

  desiredA = clamp(Math.round(desiredA), 0, maxA);
  if (desiredA > 0 && desiredA < minA) desiredA = 0;
  const requestedA = desiredA;
  const requestedPowerW = requestedA * perAmpW;
  pvRequestPowerW = Math.min(requestedPowerW, Math.max(0, pvRequestPowerW));
  gridRequestPowerW = Math.max(0, requestedPowerW - pvRequestPowerW);

  // Direct use of this helper still gets an absolute Peak Guard. The app-level
  // coordinator may set skipPeakLimit=true while it allocates the same peak room
  // between EV and planned home-battery charging according to the user's priority.
  if (!Boolean(input.skipPeakLimit) && Boolean(settings.peakShaveEnabled)) {
    const softTargetW = Math.max(0, (Number(settings.peakLimitW) || 0) - Math.max(0, Number(settings.peakSoftMarginW) || 0));
    const maxEvPowerByPeakW = Math.max(0, softTargetW - baseGridWithoutEvW);
    const peakA = quantizeCurrent(maxEvPowerByPeakW, settings, 'floor');
    if (desiredA > peakA) {
      desiredA = peakA;
      base.peakLimited = true;
    }
  }

  const desiredPowerW = desiredA * perAmpW;
  let reason = '';
  if (desiredA <= 0) {
    if (base.peakLimited) reason = 'Peak Guard laat geen EV-laadvermogen toe';
    else if (mode === 'smart' && selectedTariff) reason = 'Tarief geselecteerd, maar laadvermogen past niet binnen Peak Guard';
    else if (mode === 'smart' && pvAvailableW > 0 && !pvTariffPolicy.allowed) reason = 'PV-laden uit voor huidig tarief';
    else if (mode === 'smart' && pvAvailableW > 0 && pvTariffPolicy.minSurplusW > 0 && !pvThresholdMet) reason = `PV-overschot onder tariefdrempel ${Math.round(pvTariffPolicy.minSurplusW)} W`;
    else if (mode === 'smart' && pvAvailableW > 0 && pvAvailableW < minA * perAmpW) reason = `PV-overschot onder minimum ${minA} A`;
    else if (mode === 'smart') reason = 'Wachten op PV-overschot of geselecteerd tarief';
    else reason = 'Geen laadvermogen beschikbaar';
  } else if (mode === 'emergency') reason = 'Emergency charge · maximaal vermogen';
  else if (mode === 'soc_target') reason = `Laden tot ${Math.round(targetSoc)}% SoC`;
  else if (source === 'guarantee') reason = 'Doelgarantie: ook buiten geselecteerd tarief laden';
  else if (source.includes('tariff')) reason = `Standaard laden tijdens ${tariff?.label || 'geselecteerd tarief'}`;
  else reason = 'Laden met PV-overschot';
  if (base.peakLimited && desiredA > 0) reason += ' · begrensd door Peak Guard';

  return {
    ...base,
    desiredCurrentA: desiredA,
    desiredPowerW: Math.round(desiredPowerW),
    requestedCurrentA: requestedA,
    requestedPowerW: Math.round(requestedPowerW),
    pvRequestPowerW: Math.round(pvRequestPowerW),
    gridRequestPowerW: Math.round(gridRequestPowerW),
    allowed: desiredA > 0,
    source,
    reason,
    guaranteeActive,
  };
}

module.exports = {
  evPowerPerAmp,
  evCurrentLimits,
  findNextLocalTime,
  isEvTariffSelected,
  countEvTariffMinutes,
  calculateEvDecision,
};
