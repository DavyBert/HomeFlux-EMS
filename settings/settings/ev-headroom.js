'use strict';

(function initHomeFluxEvHeadroom(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomeFluxEvHeadroom = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, toNumber(value, min)));

  const SINGLE_PHASE_VOLTAGES = [100, 110, 115, 120, 127, 200, 208, 220, 230, 240, 254];
  const THREE_PHASE_VOLTAGES = [200, 208, 220, 230, 240, 380, 400, 415, 440, 460, 480, 600];

  function voltageOptions(phases) {
    return (Number(phases) === 1 ? SINGLE_PHASE_VOLTAGES : THREE_PHASE_VOLTAGES).slice();
  }

  function defaultVoltage(phases) {
    return 230;
  }

  function migrateVoltage(phases, voltage, reference = 'phase') {
    const raw = Number(voltage);
    if (!Number.isFinite(raw) || raw < 100 || raw > 600) return defaultVoltage(phases);
    const supply = Number(phases) === 1 || reference === 'line' ? raw : raw * Math.sqrt(3);
    // Match nominal supply values, e.g. 230 V L-N -> 400 V L-L.
    return voltageOptions(phases).reduce((nearest, value) =>
      Math.abs(value - supply) < Math.abs(nearest - supply) ? value : nearest);
  }

  function normalizeVoltage(value) {
    const voltage = Number(value);
    return Number.isFinite(voltage) && voltage >= 100 && voltage <= 600 ? voltage : 230;
  }

  function powerPerAmp(phases, voltage = 230, voltageReference = 'phase') {
    const volts = normalizeVoltage(voltage);
    if (Number(phases) === 1) return volts;
    // Current is line current. At three phases use either L-N or L-L voltage.
    return volts * (voltageReference === 'line' ? Math.sqrt(3) : 3);
  }

  function normalizeEv(ev = {}) {
    const minCurrentA = clamp(Math.round(toNumber(ev.minCurrentA, 6)), 1, 64);
    const maxCurrentA = clamp(Math.round(toNumber(ev.maxCurrentA, 32)), minCurrentA, 64);
    const standardCurrentA = clamp(Math.round(toNumber(ev.standardCurrentA, 16)), minCurrentA, maxCurrentA);
    const modeSmartCurrentA = clamp(Math.round(toNumber(ev.modeSmartCurrentA, minCurrentA)), 1, 64);
    const modeStandardCurrentA = Math.max(
      modeSmartCurrentA,
      clamp(Math.round(toNumber(ev.modeStandardCurrentA, standardCurrentA)), 1, 64),
    );
    const controlType = ['current', 'mode', 'hybrid'].includes(String(ev.controlType || 'current'))
      ? String(ev.controlType || 'current')
      : 'current';
    return {
      controlType,
      phases: Number(ev.phases) === 1 ? 1 : 3,
      voltage: normalizeVoltage(ev.voltage),
      voltageReference: ev.voltageReference === 'line' ? 'line' : 'phase',
      minCurrentA,
      maxCurrentA,
      standardCurrentA,
      modeSmartCurrentA,
      modeStandardCurrentA,
    };
  }

  function calculateScenario(evInput = {}, budgetW = 0) {
    const ev = normalizeEv(evInput);
    const perAmpW = powerPerAmp(ev.phases, ev.voltage, ev.voltageReference);
    const safeBudgetW = Math.max(0, toNumber(budgetW, 0));
    const theoreticalAvailableA = Math.max(0, Math.floor((safeBudgetW + 1e-9) / perAmpW));

    if (ev.controlType === 'mode') {
      const smartPowerW = ev.modeSmartCurrentA * perAmpW;
      const standardPowerW = ev.modeStandardCurrentA * perAmpW;
      const smartFits = smartPowerW <= safeBudgetW + 0.5;
      const standardFits = standardPowerW <= safeBudgetW + 0.5;
      const highestMode = standardFits ? 'standard' : (smartFits ? 'smart' : 'stop');
      return {
        controlType: ev.controlType,
        perAmpW,
        budgetW: safeBudgetW,
        theoreticalAvailableA,
        canCharge: smartFits,
        smartFits,
        standardFits,
        highestMode,
        smartCurrentA: ev.modeSmartCurrentA,
        standardCurrentA: ev.modeStandardCurrentA,
        smartPowerW,
        standardPowerW,
      };
    }

    const maxUsableA = Math.min(ev.maxCurrentA, theoreticalAvailableA);
    const canCharge = maxUsableA >= ev.minCurrentA;
    const usableMaxA = canCharge ? maxUsableA : 0;
    return {
      controlType: ev.controlType,
      perAmpW,
      budgetW: safeBudgetW,
      theoreticalAvailableA,
      canCharge,
      usableMaxA,
      minCurrentA: ev.minCurrentA,
      maxCurrentA: ev.maxCurrentA,
      standardCurrentA: ev.standardCurrentA,
      standardFits: canCharge && ev.standardCurrentA <= maxUsableA,
      fullFits: canCharge && ev.maxCurrentA <= maxUsableA,
      usablePowerW: usableMaxA * perAmpW,
    };
  }

  function calculateCapability(input = {}) {
    const peakEnabled = input.peakEnabled !== false;
    const peakLimitW = Math.max(0, toNumber(input.peakLimitW, 0));
    const softMarginW = Math.max(0, toNumber(input.peakSoftMarginW, 0));
    const softPeakW = Math.max(0, peakLimitW - softMarginW);
    const idleHouseLoadW = Math.max(0, toNumber(input.idleHouseLoadW, 0));
    const batterySupportW = Math.max(0, toNumber(input.batterySupportW, 0));
    const baseBudgetW = peakEnabled ? Math.max(0, softPeakW - idleHouseLoadW) : Number.POSITIVE_INFINITY;
    const selfConsumptionBudgetW = peakEnabled ? baseBudgetW + batterySupportW : Number.POSITIVE_INFINITY;

    if (!peakEnabled) {
      return {
        peakEnabled: false,
        peakLimitW,
        softMarginW,
        softPeakW,
        idleHouseLoadW,
        batterySupportW,
        baseBudgetW,
        selfConsumptionBudgetW,
        batterySaving: null,
        selfConsumption: null,
      };
    }

    return {
      peakEnabled: true,
      peakLimitW,
      softMarginW,
      softPeakW,
      idleHouseLoadW,
      batterySupportW,
      baseBudgetW,
      selfConsumptionBudgetW,
      batterySaving: calculateScenario(input.ev || {}, baseBudgetW),
      selfConsumption: calculateScenario(input.ev || {}, selfConsumptionBudgetW),
    };
  }

  return {
    voltageOptions,
    defaultVoltage,
    migrateVoltage,
    normalizeVoltage,
    powerPerAmp,
    normalizeEv,
    calculateScenario,
    calculateCapability,
  };
}));
