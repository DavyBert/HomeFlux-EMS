'use strict';

const Homey = require('homey');
const { HomeyAPI } = require('homey-api');
const { DEFAULTS, evaluate, prepareControlContext, findCurrentTariff, isDynamicContract, buildSocPlan, distributeCommand, roundBatteryCommand } = require('./lib/ems-engine');
const { localParts, normalizeDynamicPriceResponse, analyzePriceSlots, currentMatches, resamplePriceSlots, inferIntervalMinutes } = require('./lib/homey-energy');
const { calculateEvDecision, evPowerPerAmp, findNextLocalTime } = require('./lib/flexible-loads');
const { emptyDay, normalizeDay, totalSavings, avoidedEnergyValue, rawImportedKwh, calibrateImportedEnergy, emptyInventory, normalizeInventory, inventoryKwh, integrateInterval, addDays } = require('./lib/savings');

class HomeFluxEmsApp extends Homey.App {
  async onInit() {
    this.state = {
      gridPowerW: null,
      pvPowerW: null,
      forecastRemainingKwh: null,
      forecastDailyMaxKwh: null,
      forecastDailyMaxDate: '',
      forecastTomorrowKwh: null,
      forecastTomorrowDate: '',
      batterySoc: Array(8).fill(null),
      lastTotalCommandW: 0,
      pvDeltaW: 0,
      nightPlanningActive: false,
      nightPlanningStartedDate: '',
      nightPlanningDecisionSource: '',
      pvProducingDate: '',
      pvSeenProducingToday: false,
      evSoc: null,
      evConnected: false,
      evChargeCurrentA: 0,
      hvacRoomTemperatureC: null,
      hvacOutdoorTemperatureC: null,
      hvacMode: 'off',
      hvacSetpointC: null,
      hvacFanSpeed: null,
    };
    this.inputSeen = {
      grid: false,
      pv: false,
      forecast: false,
      forecastTomorrow: false,
      batterySoc: Array(8).fill(false),
      ev: { soc: false, connected: false, chargeCurrent: false },
      hvac: { roomTemperature: false, outdoorTemperature: false, mode: false, setpoint: false, fanSpeed: false },
    };
    this.inputUpdatedAt = {
      grid: 0,
      pv: 0,
      forecast: 0,
      forecastTomorrow: 0,
      batterySoc: Array(8).fill(0),
      ev: { soc: 0, connected: 0, chargeCurrent: 0 },
      hvac: { roomTemperature: 0, outdoorTemperature: 0, mode: 0, setpoint: 0, fanSpeed: 0 },
    };
    this.balanceMonitor = {
      baselineSpread: null,
      worseningSince: null,
      warningActive: false,
      warningText: '',
      lastWarningAt: 0,
    };
    this.tokens = new Map();
    this.emsDevices = new Set();
    this.lastEmittedCommands = [];
    this.splitCommandTriggers = Array.from({ length: 8 }, () => ({ chargeMode: null, dischargeMode: null, chargePower: null, dischargePower: null }));
    this.splitCommandState = Array.from({ length: 8 }, () => ({ currentMode: null, chargeHoldUntil: 0, dischargeHoldUntil: 0, lastModeSwitchAt: 0, pendingMode: null, pendingModeSince: 0, recheckTimer: null, recheckAt: 0, safetyTimer: null, lastPower: null, lastSafetyModeResendAt: 0 }));
    this.lastEmittedMode = '';
    this.lastEmittedOverride = '';
    this.pendingResult = null;
    this.emitTimer = null;
    this.lastEmitAt = 0;
    this.nextCommandAllowedAt = 0;
    this.commandPublishing = false;
    this.pendingCommandBypassInterval = false;
    this.chargeTestRunning = false;
    this.chargeTestAwaitingConfirmation = false;
    this.chargeTestTimer = null;
    this.chargeTestLastRunAt = 0;
    this.chargeTestSignatureAtRun = '';
    this.controlTimer = null;
    // v0.3.57: the fast battery regulator is separated from slower context work.
    // P1/PV changes only run the battery path. EV, HVAC, boiler, tariffs, status
    // and other derived context are consolidated behind one slow scheduler.
    this.contextTimer = null;
    this.contextTimerAt = 0;
    this.contextDirty = true;
    this.contextDirtyReasons = new Set(['startup']);
    this.contextEvaluationRunning = false;
    this.contextEvaluationPending = false;
    this.lastContextEvalAt = 0;
    this.cachedRuntimeSettings = null;
    this.fastResultSignature = '';
    this.contextHeartbeatTimer = null;
    this.flexibleSafetySignature = '';
    this.controlContext = null;
    this.controlRuntimeSettings = null;
    this.controlContextDirty = true;
    this.controlContextUpdatedAt = 0;
    this.lastSlowEvaluationAt = 0;
    this.flexibleLoadsDirty = true;
    this.lastFlexibleLoadEvaluationAt = 0;
    this.evBatteryCoordinationCache = { maxChargeW: null, at: 0 };
    // v0.4.0: lightweight low-PV -> sunny-day promotion state. The completed
    // day latch is persisted once so an app restart cannot re-enable Battery
    // Save during the same solar day; the running timer itself stays in RAM.
    this.lowForecastSunnyRuntime = { date: '', aboveSince: 0 };
    this.lowForecastSunnyOverrideDate = '';
    this.lastQueuedStatusSignature = '';
    // Frequent P1 values first pass through a tiny signal gate. A full battery
    // evaluation is only scheduled when the control zone or effective meter
    // signal has changed enough to be capable of producing another setpoint.
    this.lastFastControlSnapshot = null;
    this.fastEvaluationSkipped = 0;
    this.lastContextGridInputW = null;
    this.lastContextPvInputW = null;
    this.batteryCommandPauseTimer = null;
    this.lastControlEvalAt = 0;
    this.pvAtLastControlW = null;
    this.gridInputHistory = [];
    this.overrideResumeTimer = null;
    this.statusTimer = null;
    this.statusPublishing = false;
    this.pendingStatusResult = null;
    this.lastStatusPublishAt = 0;
    this.lastStatusTokenValues = new Map();
    this.lastTriggeredStatusText = null;
    this.lastCalculatedSetpointSignature = null;
    this.lastPublishedPvLimitPercent = null;
    this.lastPublishedPvTargetPowerW = null;
    this.lastPvLimitPublishedAt = 0;
    this.pvLimitTimer = null;
    this.pvLimitPublishing = false;
    this.pvStopTimer = null;
    this.chargePlanTrigger = null;
    this.lastChargePlanSignature = '';
    this.lastChargePlanText = '';
    // v0.3.33: keep Homey settings in memory. The control loop used to rebuild
    // the complete settings object through hundreds of homey.settings.get()
    // calls from several nested helpers on every meter update/evaluation.
    this.settingsCache = null;
    this.planningCache = { generation: 0, value: null, dirty: true, lastCalculatedAt: 0, nextAllowedAt: 0, timer: null, timerAt: 0 };

    // v0.4.9: savings accounting piggybacks on the existing meter/command
    // updates and the existing one-minute heartbeat. Raw samples are never
    // stored; only one compact aggregate per day and a tiny battery-origin
    // inventory are persisted.
    this.savings = {
      lastSampleAt: 0,
      today: emptyDay(''),
      history: {},
      inventory: emptyInventory(),
      total: 0,
      lastPersistAt: 0,
      lastDeviceSyncAt: 0,
    };

    // Optional flexible-load modules. They have their own output cadence and
    // never make EV/HVAC inputs prerequisites for the battery EMS.
    this.lastPublishedEvCurrentA = 0;
    this.lastPublishedEvAllowed = false;
    this.lastPublishedEvChargeMode = '';
    this.forceEvOutput = false;
    this.lastEvPublishedAt = 0;
    this.evPublishing = false;
    this.evTimer = null;
    // v0.3.40: mode-controlled EV chargers are held in STOP for a configurable
    // minimum time after any HomeFlux STOP. The hold is timestamp-only: no extra
    // polling loop or per-second timer is created; normal EMS passes release it.
    this.evPeakGuardStopHoldUntil = 0;
    this.evPeakGuardStopHoldTimer = null;
    // v0.3.44: a Flow can temporarily override the EV operating mode for
    // exactly one connection session. This is runtime-only and never rewrites
    // the user's configured evMode setting.
    this.evSessionOverride = { mode: null, sessionStarted: false, requestedAt: 0, source: '' };
    // v0.3.38: TOU PV charging uses start/stop hysteresis. The start threshold
    // is evaluated from available PV, but an active session is only stopped
    // after sustained real grid import. No extra polling timer is required.
    this.evPvSession = { active: false, rateId: '', overImportSince: 0 };
    this.latestEvDecision = null;
    this.lastPublishedHvacPower = null;
    this.lastPublishedHvacMode = '';
    this.lastPublishedHvacSetpoint = null;
    this.lastPublishedHvacFanAction = '';
    this.lastPublishedHvacFanSpeed = null;
    this.latestHvacDecision = null;
    this.hvacBaselineSetpoint = null;
    this.hvacBaselineMode = null;
    this.hvacBoostMode = null;
    this.hvacManagedPowerOn = false;
    this.lastHvacControlAt = 0;

    // v0.3.49: EV 1 and HVAC 1 retain every historical setting, Flow ID and
    // runtime field. Instances 2-4 use isolated runtime objects so multiple
    // devices never share anti-chatter timers, deduplication state or baselines.
    this.extraEvInstances = Array.from({ length: 3 }, () => ({
      state: { soc: null, connected: false, chargeCurrentA: 0 },
      seen: { soc: false, connected: false, chargeCurrent: false },
      updatedAt: { soc: 0, connected: 0, chargeCurrent: 0 },
      lastPublishedCurrentA: 0,
      lastPublishedAllowed: false,
      lastPublishedChargeMode: '',
      forceOutput: false,
      lastPublishedAt: 0,
      publishing: false,
      timer: null,
      stopHoldUntil: 0,
      sessionOverride: { mode: null, sessionStarted: false, requestedAt: 0, source: '' },
      pvSession: { active: false, rateId: '', overImportSince: 0 },
      latestDecision: null,
    }));
    this.extraHvacInstances = Array.from({ length: 3 }, () => ({
      state: { roomTemperatureC: null, outdoorTemperatureC: null, mode: 'off', setpointC: null, fanSpeed: null },
      seen: { roomTemperature: false, outdoorTemperature: false, mode: false, setpoint: false, fanSpeed: false },
      updatedAt: { roomTemperature: 0, outdoorTemperature: 0, mode: 0, setpoint: 0, fanSpeed: 0 },
      lastPublishedPower: null,
      lastPublishedMode: '',
      lastPublishedSetpoint: null,
      lastPublishedFanAction: '',
      lastPublishedFanSpeed: null,
      latestDecision: null,
      baselineSetpoint: null,
      baselineMode: null,
      boostMode: null,
      managedPowerOn: false,
      lastControlAt: 0,
    }));
    this.extraEvTriggers = Array.from({ length: 3 }, () => ({ current: null, allowed: null, mode: null, requestSoc: null }));
    this.extraHvacTriggers = Array.from({ length: 3 }, () => ({ power: null, mode: null, setpoint: null, fan: null }));
    this.extraEvSocRequestTimers = [];
    this.extraEvSocRequestInitialTimers = [];

    // Boiler and flexible-load priority state are timestamp-driven. They add no
    // polling loop; the normal EMS pass checks whether the next 5-minute (by
    // default) priority decision is due.
    this.boilerTrigger = null;
    this.boilerWarmedTrigger = null;
    this.boilerState = {
      outputOn: false,
      cycleAccumulatedMs: 0,
      lastTickAt: 0,
      lastPersistAt: 0,
      lastCompletedAt: 0,
      lastCompletedDate: '',
      lastCompletedSource: '',
      activeSource: '',
      trackingStartedAt: Date.now(),
      latestDecision: null,
      lastPublishedOutput: null,
      lastPublishedWarmed: null,
    };
    this.flexiblePriorityState = { nextEvaluationAt: 0, lastStartedId: '', lastEvaluationAt: 0 };

    this.inputRequestTimers = [];
    this.inputRequestInitialTimer = null;
    this.inputRequestTriggers = { pv: null, forecast: null, forecastTomorrow: null, batterySoc: [], evSoc: null };
    this.evSocRequestTimer = null;
    this.evSocRequestInitialTimer = null;
    this.homeyApi = null;
    this.homeyApiPromise = null;
    this.ownerHomeyApi = null;
    this.ownerHomeyApiPromise = null;
    this.homeyEnergyAnalysisCache = { key: '', value: null };
    this.homeyEnergyResampleCache = { key: '', value: [] };
    this.homeyEnergy = {
      available: false,
      refreshing: false,
      priceType: null,
      zone: null,
      interval: null,
      slots: [],
      lastUpdatedAt: null,
      lastAttemptAt: 0,
      error: '',
    };

    await this.migrateSettings();
    await this.ensureDefaults();
    this.refreshSettingsCache();
    this.restoreBoilerRuntime();

    // v0.3.29: keep the stored operator switch in sync with the effective
    // safety state. A version update can invalidate an older charge-test
    // signature (for example when the tested output configuration expands).
    // In that situation output is effectively blocked, so persist that same
    // OFF state instead of leaving a stale controlEnabled=true behind.
    const startupSettings = this.getSettings();
    if (Boolean(startupSettings.controlEnabled) && !this.isChargeTestValid(startupSettings)) {
      this.setSetting('controlEnabled', false);
    }

    this.restoreForecastState();
    this.restoreLowForecastSunnyState();
    this.restoreSavingsState();
    await this.syncTokens();
    this.registerFlowCards();
    this.setupInputRequestSchedule();
    this.syncEvSocRequestSchedule();
    this.armOverrideResume();

    // Homey Energy is only polled automatically when it is actually selected as
    // the dynamic price source. Flow cards can still request a manual refresh.
    this.homey.setTimeout(() => {
      if (this.usesHomeyEnergyPrices()) {
        this.refreshHomeyEnergyPrices(true).catch(err => this.error('Initial Homey Energy refresh failed', err));
      }
    }, 1500);
    this.homey.setInterval(() => {
      if (this.usesHomeyEnergyPrices()) {
        this.refreshHomeyEnergyPrices(false).catch(err => this.error('Homey Energy refresh failed', err));
      }
    }, 15 * 60 * 1000);

    this.homey.settings.on('set', async key => {
      try {
        // Keep the RAM snapshot authoritative for all following calculations.
        // An external settings write costs one Homey read here, instead of a
        // complete settings scan in every nested helper.
        this.refreshCachedSetting(key);
        this.cachedRuntimeSettings = null;
        // Internal persistence is already accompanied by the explicit state
        // change that caused it. Never turn those bookkeeping writes into a
        // second context pass or charge-plan invalidation.
        if (key === '_forecastDailyMaxDate' || key === '_forecastDailyMaxKwh' || key === '_forecastTomorrowDate' || key === '_forecastTomorrowKwh' || key === '_chargeTestSignature' || key === '_lowForecastSunnyOverrideDate' || String(key).startsWith('_boiler') || String(key).startsWith('_savings')) return;
        this.markContextDirty(`setting:${key}`);
        this.invalidatePlanningCache();
        this.markFlexibleLoadsDirty();
        // A battery-mode override changes which flexible load owns the shared
        // Peak Guard headroom. Never let the fast loop reuse an EV allocation
        // that was calculated for the previous battery mode.
        if (key === 'forcedMode') this.evBatteryCoordinationCache = { maxChargeW: null, at: 0 };
        if (key === 'lowForecastAutoSunnyEnabled') {
          this.lowForecastSunnyRuntime.aboveSince = 0;
          if (!Boolean(this.getSettings().lowForecastAutoSunnyEnabled)) {
            this.lowForecastSunnyOverrideDate = '';
            this.setSetting('_lowForecastSunnyOverrideDate', '');
          }
        }
        if (key === 'lowForecastAutoSunnySoc' || key === 'lowForecastAutoSunnyMinutes' || key === 'lowForecastSelfConsumptionMinKwh') {
          this.lowForecastSunnyRuntime.aboveSince = 0;
        }
        if (key === 'batteryCount' || key === 'evCount' || key === 'hvacCount') await this.syncTokens();
        if (key === 'priorityEvaluationMinutes' || key === 'flexibleLoadPriorityOrder' || key === 'boilerEnabled' || key === 'boilerCount' || key === 'hvacCount' || /^hvac[2-4]?Enabled$/.test(String(key))) this.flexiblePriorityState.nextEvaluationAt = 0;
        if (key === 'evEnabled' || key === 'evSocEnabled' || key === 'evCount' || /^ev[2-4](Enabled|SocEnabled)$/.test(String(key))) this.syncEvSocRequestSchedule();
        if (key === 'evControlType') {
          // Force one fresh output when switching between ampere control and
          // charger-mode control so the newly selected Flow path is initialized.
          this.forceEvOutput = true;
          this.clearEvPeakGuardStopHold();
          this.clearEvPvSession();
        }
        if (key === 'touRates' || key === 'contractType' || key === 'evMode' || key === 'evEnabled') {
          this.clearEvPvSession();
        }
        if (key === 'evPeakGuardStopHoldSeconds' && Number(this.getSettings().evPeakGuardStopHoldSeconds) <= 0) {
          this.clearEvPeakGuardStopHold();
        }
        if (key === 'evSocEnabled') {
          // Require a fresh SoC after re-enabling support; never silently reuse a
          // value from before a charger/integration was configured without SoC.
          this.inputSeen.ev.soc = false;
          this.inputUpdatedAt.ev.soc = 0;
          if (!Boolean(this.homey.settings.get('evSocEnabled')) && String(this.homey.settings.get('evMode') || 'smart') === 'soc_target') {
            this.setSetting('evMode', 'smart');
          }
        }
        const extraEvSetting = /^ev([2-4])(ControlType|Mode|Enabled|SocEnabled|PeakGuardStopHoldSeconds)$/.exec(String(key));
        if (extraEvSetting) {
          const index = Number(extraEvSetting[1]) - 1;
          const runtime = this.getExtraEv(index);
          const field = extraEvSetting[2];
          if (runtime && field === 'ControlType') {
            runtime.forceOutput = true;
            runtime.stopHoldUntil = 0;
            this.clearEvPvSessionFor(index);
          }
          if (runtime && ['Mode', 'Enabled'].includes(field)) this.clearEvPvSessionFor(index);
          if (runtime && field === 'PeakGuardStopHoldSeconds' && Number(this.getSettings()[key]) <= 0) runtime.stopHoldUntil = 0;
          if (runtime && field === 'SocEnabled') {
            runtime.seen.soc = false;
            runtime.updatedAt.soc = 0;
            const current = this.getSettings();
            if (!Boolean(current[key]) && String(current[this.getEvSettingKey(index, 'Mode')] || 'smart') === 'soc_target') {
              this.setSetting(this.getEvSettingKey(index, 'Mode'), 'smart');
            }
          }
        }
        if (key === 'batteryCount' || key === 'invertBatteryCommand') {
          await this.invalidateChargeTest('Batterijconfiguratie gewijzigd');
        }
        const splitMatch = /^splitCommandBattery([1-8])(Enabled|ChargePowerPositive|KeepMinimumPower|MinimumPowerW|ZeroMode|ChargeMinSwitchSeconds|DischargeMinSwitchSeconds|MinBetweenSwitchSeconds|DirectionConfirmSeconds|SafetyModeResendEnabled|SafetyModeResendMinutes)$/.exec(String(key));
        if (splitMatch) {
          const splitIndex = Number(splitMatch[1]) - 1;
          const splitState = this.splitCommandState?.[splitIndex];
          if (splitState && splitMatch[2] === 'Enabled') {
            if (splitState.recheckTimer) clearTimeout(splitState.recheckTimer);
            if (splitState.safetyTimer) clearTimeout(splitState.safetyTimer);
            this.splitCommandState[splitIndex] = { currentMode: null, chargeHoldUntil: 0, dischargeHoldUntil: 0, lastModeSwitchAt: 0, pendingMode: null, pendingModeSince: 0, recheckTimer: null, recheckAt: 0, safetyTimer: null, lastPower: null, lastSafetyModeResendAt: 0 };
            if (!Boolean(this.homey.settings.get(key))) await this.setSplitOutputTokens(splitIndex, null, 0);
          }
          if (['Enabled', 'ChargePowerPositive', 'KeepMinimumPower', 'MinimumPowerW', 'ZeroMode'].includes(splitMatch[2])) {
            await this.invalidateChargeTest('Batterijconfiguratie gewijzigd');
          }
          if (['SafetyModeResendEnabled', 'SafetyModeResendMinutes'].includes(splitMatch[2])) {
            this.rescheduleSplitSafetyModeResend(splitIndex);
          }
        }
        if ((key === 'contractType' || key === 'dynamicPriceSource') && this.usesHomeyEnergyPrices()) {
          this.refreshHomeyEnergyPrices(true).catch(err => this.error('Homey Energy refresh after settings change failed', err));
        }
        if (['contractType', 'cheapHours', 'expensiveHours', 'overrideResumeOnTariffChange'].includes(key)) {
          this.armOverrideResume();
        }
        if (key === 'controlEnabled') {
          const settings = this.getSettings();
          if (Boolean(settings.controlEnabled) && !this.isChargeTestValid(settings)) {
            this.setSetting('controlEnabled', false);
            return;
          }
          // Recalculate immediately so the UI/status reflects the operator choice.
          // Battery output still respects the normal minimum command interval.
          // Disabling active output is handled as a safety stop to 0 W below.
          this.lastControlEvalAt = 0;
          if (this.controlTimer) {
            clearTimeout(this.controlTimer);
            this.controlTimer = null;
          }
          this.requestContextEvaluate(true, 'control_enabled');
          return;
        }
        this.requestContextEvaluate(true, `setting:${key}`);
        if (this.isNightPlanningPhase()) this.publishChargePlanIfChanged().catch(err => this.error('Charge plan update after settings change failed', err));
      } catch (err) {
        this.error('Settings update failed', err);
      }
    });

    // A one-minute heartbeat performs timestamp comparisons only. It does not
    // run the EMS engine unless a tariff boundary, planning phase, flexible-load
    // deadline or other slow context really became dirty.
    this.contextHeartbeatTimer = this.homey.setInterval(() => this.runContextHeartbeat(), 60000);
    this.checkNightPlanningFallback();
    await this.runContextEvaluation(true);
    this.log('HomeFlux EMS v0.4.14 initialized');
  }

  refreshSettingsCache() {
    const result = { ...DEFAULTS, timezone: this.homey.clock.getTimezone() || 'UTC' };
    for (const key of Object.keys(DEFAULTS)) {
      const value = this.homey.settings.get(key);
      if (value !== null && value !== undefined) result[key] = value;
    }
    this.settingsCache = result;
    return result;
  }

  refreshCachedSetting(key) {
    if (!this.settingsCache || !Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return;
    const value = this.homey.settings.get(key);
    this.settingsCache[key] = value !== null && value !== undefined ? value : DEFAULTS[key];
    this.settingsCache.timezone = this.homey.clock.getTimezone() || 'UTC';
  }

  setSetting(key, value) {
    this.homey.settings.set(key, value);
    if (this.settingsCache && Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      this.settingsCache[key] = value;
      this.settingsCache.timezone = this.homey.clock.getTimezone() || 'UTC';
    }
  }

  getSettings() {
    if (!this.settingsCache) return { ...this.refreshSettingsCache() };
    // Return a shallow snapshot so callers cannot mutate the shared cache.
    return { ...this.settingsCache, timezone: this.homey.clock.getTimezone() || 'UTC' };
  }

  getSavingsDateKey(at = Date.now()) {
    return localParts(new Date(Number(at) || Date.now()), this.homey.clock.getTimezone() || 'UTC').dateKey;
  }

  getSavingsTariffSnapshot(settings = this.getSettings()) {
    const type = String(settings.contractType || 'tou');
    const tariff = this.latestResult?.tariff || null;
    let importPrice = Number(tariff?.price);
    let feedInPrice = 0;
    let id = String(tariff?.rateId || tariff?.label || type || 'grid');
    let label = String(tariff?.label || (type === 'fixed' ? 'Fixed tariff' : 'Grid'));

    if (type === 'fixed') {
      importPrice = Number(settings.fixedImportPrice);
      feedInPrice = Number(settings.fixedFeedInPrice);
      id = 'fixed';
      label = 'Fixed tariff';
    } else if (type === 'tou') {
      const rateId = String(tariff?.rateId || '');
      const rate = (Array.isArray(settings.touRates) ? settings.touRates : [])
        .find(item => String(item?.id || '') === rateId);
      if (rate) {
        if (!Number.isFinite(importPrice)) importPrice = Number(rate.importPrice);
        feedInPrice = Number(rate.feedInPrice);
        id = String(rate.id || id);
        label = String(rate.name || label);
      }
    } else if (isDynamicContract(settings)) {
      const currentPrice = Number(this.latestResult?.homeyEnergy?.currentPrice);
      if (Number.isFinite(currentPrice)) importPrice = currentPrice;
      // Homey Energy currently supplies the purchase price used by HomeFlux,
      // not a separate dynamic feed-in price. Therefore battery export is not
      // credited unless HomeFlux has an explicit feed-in price source.
      feedInPrice = 0;
      id = String(tariff?.rateId || this.latestResult?.homeyEnergy?.priceClass || 'dynamic');
      label = String(tariff?.label || this.latestResult?.homeyEnergy?.priceClass || 'Dynamic');
    }

    return {
      id: id || 'grid',
      label: label || 'Grid',
      importPrice: Number.isFinite(importPrice) ? Math.max(0, importPrice) : 0,
      feedInPrice: Number.isFinite(feedInPrice) ? Math.max(0, feedInPrice) : 0,
    };
  }

  restoreSavingsState() {
    const storedHistory = this.homey.settings.get('_savingsHistory');
    const history = storedHistory && typeof storedHistory === 'object' && !Array.isArray(storedHistory)
      ? storedHistory : {};
    const normalizedHistory = {};
    for (const [date, day] of Object.entries(history)) normalizedHistory[date] = normalizeDay(day, date);

    const todayKey = this.getSavingsDateKey();
    const storedToday = normalizeDay(this.homey.settings.get('_savingsToday'), todayKey);
    if (storedToday.date && storedToday.date !== todayKey) {
      normalizedHistory[storedToday.date] = calibrateImportedEnergy(storedToday);
      this.savings.today = emptyDay(todayKey);
    } else {
      storedToday.date = todayKey;
      this.savings.today = storedToday;
    }
    this.savings.history = normalizedHistory;
    this.savings.inventory = normalizeInventory(this.homey.settings.get('_savingsInventory'));
    this.savings.total = Number(this.homey.settings.get('_savingsTotal')) || 0;
    this.savings.lastSampleAt = Date.now();
  }

  archiveSavingsDay(nextDateKey) {
    const current = this.savings.today;
    if (current?.date) this.savings.history[current.date] = calibrateImportedEnergy(current);
    const dates = Object.keys(this.savings.history).sort();
    while (dates.length > 4000) delete this.savings.history[dates.shift()];
    this.savings.today = emptyDay(nextDateKey);
  }

  recordSavingsSample(at = Date.now()) {
    if (!this.savings) return;
    const now = Number(at) || Date.now();
    const currentDate = this.getSavingsDateKey(now);
    if (!this.savings.today?.date) this.savings.today = emptyDay(currentDate);
    if (this.savings.today.date !== currentDate) this.archiveSavingsDay(currentDate);

    const previousAt = Number(this.savings.lastSampleAt) || now;
    this.savings.lastSampleAt = now;
    const seconds = Math.max(0, (now - previousAt) / 1000);
    if (seconds <= 0 || seconds > 300) return;
    if (!this.inputSeen?.grid || !this.inputSeen?.pv) return;
    if (!Number.isFinite(Number(this.state.gridPowerW)) || !Number.isFinite(Number(this.state.pvPowerW))) return;

    const tariff = this.getSavingsTariffSnapshot();
    const before = totalSavings(this.savings.today);
    integrateInterval({
      day: this.savings.today,
      inventory: this.savings.inventory,
      seconds,
      gridW: Number(this.state.gridPowerW),
      pvW: Number(this.state.pvPowerW),
      batteryW: Number(this.state.lastTotalCommandW) || 0,
      importPrice: tariff.importPrice,
      feedInPrice: tariff.feedInPrice,
      tariff,
      capacityKwh: Number(this.getSettings().totalCapacityKwh) || 0,
    });
    const delta = totalSavings(this.savings.today) - before;
    if (Number.isFinite(delta)) this.savings.total += delta;
  }

  persistSavingsState(at = Date.now(), alreadySampled = false) {
    if (!this.savings) return;
    if (!alreadySampled) this.recordSavingsSample(at);
    this.homey.settings.set('_savingsToday', this.savings.today);
    this.homey.settings.set('_savingsHistory', this.savings.history);
    this.homey.settings.set('_savingsInventory', this.savings.inventory);
    this.homey.settings.set('_savingsTotal', this.savings.total);
    this.savings.lastPersistAt = Number(at) || Date.now();
    this.syncEmsDevices().catch(err => this.error('EMS device savings sync failed', err));
  }

  getSavingsPeriodRange(period = 'day', at = Date.now()) {
    const timezone = this.homey.clock.getTimezone() || 'UTC';
    const parts = localParts(new Date(Number(at) || Date.now()), timezone);
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    let start;
    let end;
    if (period === 'year') {
      start = new Date(Date.UTC(parts.year, 0, 1));
      end = new Date(Date.UTC(parts.year + 1, 0, 1));
    } else if (period === 'month') {
      start = new Date(Date.UTC(parts.year, parts.month - 1, 1));
      end = new Date(Date.UTC(parts.year, parts.month, 1));
    } else if (period === 'week') {
      const weekday = parts.weekday || 1;
      start = new Date(date.getTime() - ((weekday - 1) * 86400000));
      end = new Date(start.getTime() + (7 * 86400000));
    } else {
      start = date;
      end = new Date(date.getTime() + 86400000);
    }
    return { startKey: start.toISOString().slice(0, 10), endKey: end.toISOString().slice(0, 10) };
  }

  getSavingsStatus({ period = 'day' } = {}) {
    this.recordSavingsSample(Date.now());
    const normalizedPeriod = ['day', 'week', 'month', 'year'].includes(String(period)) ? String(period) : 'day';
    const range = this.getSavingsPeriodRange(normalizedPeriod);
    const aggregate = emptyDay('');
    for (const [date, day] of Object.entries(this.savings.history || {})) {
      if (date >= range.startKey && date < range.endKey) addDays(aggregate, day);
    }
    if (this.savings.today?.date >= range.startKey && this.savings.today?.date < range.endKey) {
      addDays(aggregate, calibrateImportedEnergy(this.savings.today));
    }

    const actualCost = Math.max(0, Number(aggregate.directGridCost) || 0)
      + Math.max(0, Number(aggregate.gridChargeCost) || 0);
    const avoidedCost = avoidedEnergyValue(aggregate);
    const periodSavings = totalSavings(aggregate);
    // Both percentage bars intentionally use the same metric: the share of the
    // hypothetical total energy cost that was avoided. Using actual cost plus
    // net savings as the denominator keeps the value naturally within 0..100%.
    // Keep the legacy avoidedEnergyCostPercentage field for UI compatibility,
    // but make it identical to avoidedCostsPercentage so both charts agree.
    const positiveSavings = Math.max(0, Number(periodSavings) || 0);
    const hypotheticalCost = actualCost + positiveSavings;
    const avoidedCostsPercentage = hypotheticalCost > 0
      ? (positiveSavings / hypotheticalCost) * 100
      : 0;
    const avoidedEnergyCostPercentage = avoidedCostsPercentage;
    const chartKwh = Math.max(0, Number(aggregate.directGridKwh) || 0)
      + Math.max(0, Number(aggregate.gridChargeKwh) || 0)
      + Math.max(0, Number(aggregate.directPvKwh) || 0)
      + Math.max(0, Number(aggregate.pvChargeKwh) || 0);

    return {
      period: normalizedPeriod,
      startDate: range.startKey,
      endDate: range.endKey,
      todaySavings: totalSavings(this.savings.today),
      totalSavings: Number(this.savings.total) || 0,
      periodSavings,
      actualCost,
      avoidedEnergyCost: avoidedCost,
      avoidedEnergyCostPercentage,
      avoidedCostsPercentage,
      chartKwh,
      directGrid: { kwh: aggregate.directGridKwh, value: aggregate.directGridCost },
      directPv: { kwh: aggregate.directPvKwh, value: aggregate.directPvValue },
      pvBattery: { kwh: aggregate.pvBatteryKwh, value: aggregate.pvBatteryValue },
      pvBatteryHome: { kwh: aggregate.pvBatteryHomeKwh, value: aggregate.pvBatteryHomeValue },
      loadShift: { kwh: aggregate.shiftKwh, value: aggregate.shiftValue },
      batteryCharging: {
        kwh: aggregate.batteryChargeKwh,
        pvKwh: aggregate.pvChargeKwh,
        gridKwh: aggregate.gridChargeKwh,
        gridCost: aggregate.gridChargeCost,
        byTariff: Object.values(aggregate.chargeCostsByTariff || {}).sort((a, b) => b.cost - a.cost),
      },
      importedEnergyToday: {
        inputKwh: Number(this.savings.today?.importedEnergyKwh) || 0,
        known: Boolean(this.savings.today?.importedEnergyKnown),
        measuredKwh: rawImportedKwh(this.savings.today),
      },
      trackedBatteryKwh: inventoryKwh(this.savings.inventory),
    };
  }

  hasNumericInputChanged(previous, next, wasSeen = true, tolerance = 0.01) {
    const value = Number(next);
    if (!wasSeen || !Number.isFinite(Number(previous)) || !Number.isFinite(value)) return true;
    return Math.abs(Number(previous) - value) >= Math.max(0, Number(tolerance) || 0);
  }

  hasTextInputChanged(previous, next, wasSeen = true) {
    return !wasSeen || String(previous ?? '') !== String(next ?? '');
  }

  hasBooleanInputChanged(previous, next, wasSeen = true) {
    return !wasSeen || Boolean(previous) !== Boolean(next);
  }

  getSettingsSnapshot() {
    // v0.3.41: settings UI startup uses one local API call instead of roughly
    // 194 individual Homey.get bridge round-trips. This is a read-only copy of
    // the RAM cache and does not run the EMS engine or rebuild planning.
    return this.getSettings();
  }

  getSlowControlIntervalMs(settings = this.getSettings()) {
    const seconds = Math.max(15, Math.min(300, Number(settings.slowControlIntervalSeconds) || 60));
    return Math.round(seconds * 1000);
  }

  getPlanningMinIntervalMs(settings = this.getSettings()) {
    const minutes = Math.max(1, Math.min(60, Number(settings.planningMinIntervalMinutes) || 5));
    return Math.round(minutes * 60000);
  }

  markContextDirty(reason = 'input') {
    this.contextDirty = true;
    this.controlContextDirty = true;
    this.flexibleLoadsDirty = true;
    if (!this.contextDirtyReasons) this.contextDirtyReasons = new Set();
    if (reason) this.contextDirtyReasons.add(String(reason));
  }

  clearContextTimer() {
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.contextTimer = null;
    this.contextTimerAt = 0;
  }

  requestContextEvaluate(immediate = false, reason = 'context', requestedAt = 0, bypassInterval = false) {
    this.markContextDirty(reason);
    if (this.contextEvaluationRunning) {
      this.contextEvaluationPending = true;
      return;
    }

    const now = Date.now();
    const settings = this.getSettings();
    const normalAt = this.lastContextEvalAt > 0
      ? this.lastContextEvalAt + this.getSlowControlIntervalMs(settings)
      : now;
    let targetAt = immediate ? now : Math.max(now, normalAt);
    if (Number(requestedAt) > 0) {
      targetAt = bypassInterval
        ? Math.max(now, Number(requestedAt))
        : Math.max(targetAt, Number(requestedAt));
    }

    if (targetAt <= now) {
      this.clearContextTimer();
      this.runContextEvaluation(immediate).catch(err => this.error('Slow EMS context evaluation failed', err));
      return;
    }

    // One shared slow timer covers tariff boundaries, flexible-load safety,
    // priority checks and ordinary context refreshes. A newly requested earlier
    // deadline replaces a later one; duplicate/later requests add no timer.
    if (this.contextTimer && this.contextTimerAt > 0 && this.contextTimerAt <= targetAt) return;
    this.clearContextTimer();
    this.contextTimerAt = targetAt;
    this.contextTimer = this.homey.setTimeout(() => {
      this.contextTimer = null;
      this.contextTimerAt = 0;
      this.runContextEvaluation(false).catch(err => this.error('Scheduled slow EMS context evaluation failed', err));
    }, Math.max(1, targetAt - now));
  }

  async runContextEvaluation(forceStatus = false) {
    if (this.contextEvaluationRunning) {
      this.contextEvaluationPending = true;
      return this.latestResult;
    }
    this.contextEvaluationRunning = true;
    this.clearContextTimer();
    const reasons = this.contextDirtyReasons ? [...this.contextDirtyReasons] : [];
    this.contextDirty = false;
    if (this.contextDirtyReasons) this.contextDirtyReasons.clear();
    try {
      const result = this.evaluateContextNow(forceStatus);
      this.lastContextEvalAt = Date.now();
      return result;
    } finally {
      this.contextEvaluationRunning = false;
      if (this.contextEvaluationPending || this.contextDirty) {
        this.contextEvaluationPending = false;
        this.requestContextEvaluate(false, reasons.length ? `pending:${reasons.join(',')}` : 'pending');
      }
    }
  }

  hasConfiguredFlexibleLoad(settings = this.getSettings()) {
    for (let index = 0; index < this.getEvCount(settings); index += 1) {
      if (Boolean(this.getEvInstanceSettings(index, settings).evEnabled)) return true;
    }
    for (let index = 0; index < this.getHvacCount(settings); index += 1) {
      if (Boolean(this.getHvacInstanceSettings(index, settings).hvacEnabled)) return true;
    }
    return this.getBoilerCount(settings) > 0 && Boolean(settings.boilerEnabled);
  }

  needsSlowMeterContext(settings = this.getSettings()) {
    return Boolean(settings.exportLimitEnabled) || this.hasConfiguredFlexibleLoad(settings);
  }

  hasActiveFlexibleOutput(settings = this.getSettings()) {
    const evCount = this.getEvCount(settings);
    for (let index = 0; index < evCount; index += 1) {
      if (this.isEvOutputActiveFor(index, settings)) return true;
    }
    const hvacCount = this.getHvacCount(settings);
    for (let index = 0; index < hvacCount; index += 1) {
      if (this.isHvacManagedActiveFor(index)) return true;
    }
    return Boolean(this.boilerState?.outputOn);
  }

  updateEvPvImportSafety(now = Date.now(), settings = this.getSettings()) {
    const gridW = Number(this.state.gridPowerW);
    if (!Number.isFinite(gridW)) return;
    const evCount = this.getEvCount(settings);
    let earliestDue = 0;
    for (let index = 0; index < evCount; index += 1) {
      const runtime = index === 0 ? { pvSession: this.evPvSession, latestDecision: this.latestEvDecision } : this.getExtraEv(index);
      const session = runtime?.pvSession;
      if (!session?.active) continue;
      const decision = runtime?.latestDecision || null;
      const threshold = Math.max(0, Number(decision?.pvTariffStopGridImportW) || 0);
      const delaySeconds = Math.max(0, Number(decision?.pvTariffStopDelaySeconds) || 60);
      if (gridW >= threshold) {
        if (!Number(session.overImportSince)) session.overImportSince = now;
        const due = Number(session.overImportSince) + (delaySeconds * 1000);
        if (now >= due) {
          this.requestContextEvaluate(true, `ev${index + 1}_pv_import_stop`);
          return;
        }
        if (!earliestDue || due < earliestDue) earliestDue = due;
      } else {
        session.overImportSince = 0;
      }
    }
    if (earliestDue > now) this.requestContextEvaluate(false, 'ev_pv_import_timer', earliestDue, true);
  }

  checkFlexibleSafetyFromGrid(now = Date.now(), settings = this.getSettings()) {
    const gridW = Number(this.state.gridPowerW);
    if (!Number.isFinite(gridW)) return;
    this.updateEvPvImportSafety(now, settings);

    let reason = '';
    if (this.hasActiveFlexibleOutput(settings) && Boolean(settings.peakShaveEnabled)) {
      const peak = Math.max(0, Number(settings.peakLimitW) || 0);
      if (gridW >= peak) reason = 'peak_guard';
    }
    if (!reason) {
      const hvacCount = this.getHvacCount(settings);
      for (let index = 0; index < hvacCount; index += 1) {
        if (!this.isHvacManagedActiveFor(index)) continue;
        const hvacSettings = this.getHvacInstanceSettings(index, settings);
        const threshold = Math.max(0, Number(hvacSettings.hvacFastResetImportW) || 1000);
        if (gridW >= threshold) { reason = `hvac${index + 1}_fast_reset`; break; }
      }
    }

    // Only the transition into an urgent state requests an immediate slow pass.
    // Remaining above the same threshold does not recalculate on every P1 value.
    if (reason && reason !== this.flexibleSafetySignature) {
      this.flexibleSafetySignature = reason;
      this.requestContextEvaluate(true, reason);
    } else if (!reason) {
      this.flexibleSafetySignature = '';
    }
  }

  runContextHeartbeat() {
    const now = Date.now();
    const settings = this.getSettings();
    this.recordSavingsSample(now);
    if ((now - Number(this.savings?.lastPersistAt || 0)) >= 5 * 60 * 1000) this.persistSavingsState(now, true);
    else this.syncEmsDevices().catch(err => this.error('EMS device savings sync failed', err));
    const activated = this.checkNightPlanningFallback(now);
    if (activated) return;

    // Reuse the existing one-minute heartbeat for the low-PV -> sunny-day
    // timer. Until the deadline this is only a few comparisons; a full EMS
    // context pass is requested exactly once when the day is promoted.
    if (this.updateLowForecastSunnyPromotion(now, settings)) {
      this.invalidatePlanningCache();
      this.requestContextEvaluate(true, 'low_forecast_promoted_to_sunny');
      return;
    }

    // Grid freshness is a hard battery-safety condition. The ordinary fast loop
    // is meter-driven, so a stopped meter cannot trigger its own failsafe. This
    // lightweight one-minute check requests exactly one immediate safety pass
    // when the grid value becomes stale; it does not create a periodic full EMS
    // evaluation while the meter remains healthy.
    const readiness = this.getInputReadiness(settings);
    if (!readiness.gridFresh && Boolean(this.latestResult?.inputReady)) {
      this.requestContextEvaluate(true, 'grid_stale');
      return;
    }

    const nextEventAt = Number(this.latestResult?.nextEventAt) || 0;
    if (nextEventAt > 0 && now >= nextEventAt) this.markContextDirty('tariff_boundary');
    if ((this.getHvacCount(settings) > 0 || this.getBoilerCount(settings) > 0)
      && this.isFlexiblePriorityEvaluationDue(now, settings)) this.markContextDirty('flexible_priority_due');
    if (this.hasActiveFlexibleOutput(settings)
      && (now - Number(this.lastContextEvalAt || 0)) >= this.getSlowControlIntervalMs(settings)) {
      this.markContextDirty('active_flexible_load');
    }

    const warmNow = this.isBoilerCompletedToday(now, settings);
    if (this.boilerState?.latestDecision && Boolean(this.boilerState.latestDecision.warm) !== warmNow) {
      this.markContextDirty('boiler_reset_boundary');
    }

    this.updateEvPvImportSafety(now, settings);
    if (this.contextDirty && !this.contextTimer) this.requestContextEvaluate(false, 'heartbeat');
  }

  getEvCount(settings = this.getSettings()) {
    return Math.max(0, Math.min(4, Math.round(Number(settings.evCount) || 0)));
  }

  getHvacCount(settings = this.getSettings()) {
    return Math.max(0, Math.min(4, Math.round(Number(settings.hvacCount) || 0)));
  }

  getBoilerCount(settings = this.getSettings()) {
    return Math.max(0, Math.min(1, Math.round(Number(settings.boilerCount) || 0)));
  }


  getEvSettingKey(index, suffix) {
    return index === 0 ? `ev${suffix}` : `ev${index + 1}${suffix}`;
  }

  getHvacSettingKey(index, suffix) {
    return index === 0 ? `hvac${suffix}` : `hvac${index + 1}${suffix}`;
  }

  getEvInstanceName(index, settings = this.getSettings()) {
    const raw = String(settings[this.getEvSettingKey(index, 'Name')] || '').trim();
    return raw || `EV ${index + 1}`;
  }

  getHvacInstanceName(index, settings = this.getSettings()) {
    const raw = String(settings[this.getHvacSettingKey(index, 'Name')] || '').trim();
    return raw || `HVAC ${index + 1}`;
  }

  getEvInstanceSettings(index, source = this.getSettings()) {
    const fields = [
      'Enabled','SocEnabled','Mode','ControlType','SmartPvPriority','SmartPvExportTargetW','SmartGridPriority',
      'BatteryCapacityKwh','TargetSoc','TargetTime','GuaranteeTarget','Phases','MinCurrentA','MaxCurrentA',
      'StandardCurrentA','CommandIntervalSeconds','PeakGuardStopHoldSeconds','PeakGuardBatteryAssistNormal',
      'PeakGuardBatteryAssistEmergency','FixedChargeWindowEnabled','DynamicCheapEnabled','DynamicNormalEnabled','DynamicExpensiveEnabled',
    ];
    const settings = { ...source };
    for (const suffix of fields) settings[`ev${suffix}`] = source[this.getEvSettingKey(index, suffix)];
    const stem = index === 0 ? 'ev' : `ev${index + 1}`;
    settings.touRates = (Array.isArray(source.touRates) ? source.touRates : []).map(rate => ({
      ...rate,
      evChargeAllowed: Boolean(rate?.[`${stem}ChargeAllowed`]),
      evPvChargeAllowed: rate?.[`${stem}PvChargeAllowed`] !== false,
      evPvMinSurplusW: Math.max(0, Number(rate?.[`${stem}PvMinSurplusW`]) || 0),
      evPvStopGridImportW: Math.max(0, Number(rate?.[`${stem}PvStopGridImportW`] ?? 1000) || 0),
    }));
    const override = index === 0 ? this.evSessionOverride : this.extraEvInstances[index - 1]?.sessionOverride;
    if (override?.mode) settings.evMode = this.normalizeEvOperatingMode(override.mode);
    settings.evSessionOverrideActive = Boolean(override?.mode);
    return settings;
  }

  getHvacInstanceSettings(index, source = this.getSettings()) {
    const fields = [
      'Enabled','AutomaticControlEnabled','AllowOnBattery','UsePvSurplus','ComfortMinC','ComfortMaxC','EnergyDeviationC',
      'HeatingActivationBelowC','CoolingActivationAboveC','Priority','CoolingFanProfile','HeatingFanProfile',
      'ControlIntervalMinutes','SurplusStartW','SurplusStopW','MinBatterySoc','StopBatterySoc','FastResetImportW',
      'AllowPowerControl','AllowModeControl','AllowSetpointControl','AllowFanControl','FanMinValue','FanMaxValue','FanStepValue',
    ];
    const settings = { ...source };
    for (const suffix of fields) settings[`hvac${suffix}`] = source[this.getHvacSettingKey(index, suffix)];
    return settings;
  }

  getExtraEv(index) {
    return index > 0 && index <= 3 ? this.extraEvInstances[index - 1] : null;
  }

  getExtraHvac(index) {
    return index > 0 && index <= 3 ? this.extraHvacInstances[index - 1] : null;
  }

  getEvInputSnapshot(index) {
    if (index === 0) return {
      soc: this.state.evSoc,
      connected: this.state.evConnected,
      chargeCurrentA: this.state.evChargeCurrentA,
      seen: this.inputSeen.ev,
      updatedAt: this.inputUpdatedAt.ev,
    };
    const runtime = this.getExtraEv(index);
    return runtime ? { ...runtime.state, seen: runtime.seen, updatedAt: runtime.updatedAt } : null;
  }

  getHvacInputSnapshot(index) {
    if (index === 0) return {
      roomTemperatureC: this.state.hvacRoomTemperatureC,
      outdoorTemperatureC: this.state.hvacOutdoorTemperatureC,
      mode: this.state.hvacMode,
      setpointC: this.state.hvacSetpointC,
      fanSpeed: this.state.hvacFanSpeed,
      seen: this.inputSeen.hvac,
      updatedAt: this.inputUpdatedAt.hvac,
    };
    const runtime = this.getExtraHvac(index);
    if (!runtime) return null;
    return {
      ...runtime.state,
      // Outdoor temperature is global, not an HVAC-instance input.
      outdoorTemperatureC: this.state.hvacOutdoorTemperatureC,
      seen: { ...runtime.seen, outdoorTemperature: Boolean(this.inputSeen.hvac?.outdoorTemperature) },
      updatedAt: { ...runtime.updatedAt, outdoorTemperature: Number(this.inputUpdatedAt.hvac?.outdoorTemperature) || 0 },
    };
  }

  getFlexibleLoadPriorityOrder(settings = this.getSettings()) {
    const allowed = [];
    if (this.getBoilerCount(settings) > 0 && Boolean(settings.boilerEnabled)) allowed.push('boiler');
    const count = this.getHvacCount(settings);
    for (let index = 0; index < count; index += 1) {
      if (Boolean(this.getHvacInstanceSettings(index, settings).hvacEnabled)) allowed.push(`hvac${index + 1}`);
    }
    const configured = Array.isArray(settings.flexibleLoadPriorityOrder) ? settings.flexibleLoadPriorityOrder.map(String) : [];
    const result = configured.filter(id => allowed.includes(id));
    for (const id of allowed) if (!result.includes(id)) result.push(id);
    return result;
  }

  getPriorityEvaluationIntervalMs(settings = this.getSettings()) {
    const minutes = Math.max(1, Math.min(30, Number(settings.priorityEvaluationMinutes) || 5));
    return minutes * 60000;
  }

  isFlexiblePriorityEvaluationDue(now = Date.now(), settings = this.getSettings()) {
    return now >= Number(this.flexiblePriorityState?.nextEvaluationAt || 0);
  }

  finishFlexiblePriorityEvaluation(now = Date.now(), settings = this.getSettings(), startedId = '') {
    this.flexiblePriorityState.lastEvaluationAt = now;
    this.flexiblePriorityState.lastStartedId = String(startedId || '');
    this.flexiblePriorityState.nextEvaluationAt = now + this.getPriorityEvaluationIntervalMs(settings);
  }

  restoreBoilerRuntime() {
    const get = key => this.homey.settings.get(key);
    const now = Date.now();
    this.boilerState.outputOn = Boolean(get('_boilerOutputOn'));
    this.boilerState.cycleAccumulatedMs = Math.max(0, Number(get('_boilerCycleAccumulatedMs')) || 0);
    this.boilerState.lastTickAt = Math.max(0, Number(get('_boilerLastTickAt')) || now);
    this.boilerState.lastCompletedAt = Math.max(0, Number(get('_boilerLastCompletedAt')) || 0);
    this.boilerState.lastCompletedDate = String(get('_boilerLastCompletedDate') || '');
    this.boilerState.lastCompletedSource = String(get('_boilerLastCompletedSource') || '');
    this.boilerState.activeSource = String(get('_boilerActiveSource') || '');
    this.boilerState.trackingStartedAt = Math.max(0, Number(get('_boilerTrackingStartedAt')) || now);
    this.boilerState.lastPublishedOutput = null;
    if (!get('_boilerTrackingStartedAt')) this.homey.settings.set('_boilerTrackingStartedAt', this.boilerState.trackingStartedAt);
    // If Homey restarted while the boolean output was still ON, count that
    // elapsed time as part of the cumulative cycle. This mirrors the persisted
    // dashboard/control state instead of silently losing a long heat interval.
    if (this.boilerState.outputOn && this.boilerState.lastTickAt > 0 && now > this.boilerState.lastTickAt) {
      this.boilerState.cycleAccumulatedMs += now - this.boilerState.lastTickAt;
    }
    this.boilerState.lastTickAt = now;
    this.boilerState.lastPersistAt = now;
  }

  updateBoilerRuntimeClock(now = Date.now(), forcePersist = false) {
    if (!this.boilerState) return;
    const last = Number(this.boilerState.lastTickAt) || now;
    if (this.boilerState.outputOn && now > last) this.boilerState.cycleAccumulatedMs += now - last;
    this.boilerState.lastTickAt = now;
    if (forcePersist || now - Number(this.boilerState.lastPersistAt || 0) >= 60000) this.persistBoilerRuntime();
  }

  persistBoilerRuntime() {
    if (!this.boilerState) return;
    this.boilerState.lastPersistAt = Date.now();
    const values = {
      _boilerOutputOn: Boolean(this.boilerState.outputOn),
      _boilerCycleAccumulatedMs: Math.round(Number(this.boilerState.cycleAccumulatedMs) || 0),
      _boilerLastTickAt: Math.round(Number(this.boilerState.lastTickAt) || Date.now()),
      _boilerLastCompletedAt: Math.round(Number(this.boilerState.lastCompletedAt) || 0),
      _boilerLastCompletedDate: String(this.boilerState.lastCompletedDate || ''),
      _boilerLastCompletedSource: String(this.boilerState.lastCompletedSource || ''),
      _boilerActiveSource: String(this.boilerState.activeSource || ''),
      _boilerTrackingStartedAt: Math.round(Number(this.boilerState.trackingStartedAt) || Date.now()),
    };
    for (const [key, value] of Object.entries(values)) this.homey.settings.set(key, value);
  }

  getBoilerColdResetTime(settings = this.getSettings()) {
    const value = String(settings.boilerColdResetTime || '07:00').trim();
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '07:00';
  }

  getBoilerWarmUntil(settings = this.getSettings()) {
    const completedAt = Number(this.boilerState?.lastCompletedAt || 0);
    if (completedAt <= 0) return 0;
    const resetTime = this.getBoilerColdResetTime(settings);
    const timezone = this.homey.clock.getTimezone() || settings.timezone || 'UTC';
    const key = `${completedAt}|${resetTime}|${timezone}`;
    if (this.boilerState?.warmUntilCache?.key === key) return Number(this.boilerState.warmUntilCache.value) || 0;

    // Calculate this only when the completed cycle, reset time or timezone changes.
    // Starting at the beginning of the completion minute makes the returned
    // boundary exactly HH:MM:00 instead of preserving arbitrary seconds.
    const completedMinute = new Date(Math.floor(completedAt / 60000) * 60000);
    const warmUntil = findNextLocalTime(completedMinute, resetTime, timezone).getTime();
    if (this.boilerState) this.boilerState.warmUntilCache = { key, value: warmUntil };
    return warmUntil;
  }

  isBoilerCompletedToday(now = Date.now(), settings = this.getSettings()) {
    const completedAt = Number(this.boilerState?.lastCompletedAt || 0);
    if (completedAt <= 0 || completedAt > now) return false;
    // A boiler day runs from the configured daily cold-reset time to the next
    // reset, not from midnight to midnight. This also means a tariff cycle
    // completed before 07:00 may be followed by a new PV cycle after 07:00.
    return now < this.getBoilerWarmUntil(settings);
  }

  getBoilerDaysWithoutCycle(now = Date.now()) {
    const since = Number(this.boilerState?.lastCompletedAt || this.boilerState?.trackingStartedAt || now);
    return Math.max(0, (now - since) / 86400000);
  }

  isBoilerTariffSelected(settings = this.getSettings(), tariff = null) {
    if (!tariff) return false;
    const type = String(settings.contractType || '');
    if (type === 'tou') {
      const rate = (Array.isArray(settings.touRates) ? settings.touRates : []).find(item => String(item?.id || '') === String(tariff.rateId || ''));
      if (Boolean(rate?.avoidGridImport)) return false;
      return Boolean(rate?.boilerChargeAllowed);
    }
    if (isDynamicContract(settings)) {
      if (tariff.className === 'cheap') return Boolean(settings.boilerDynamicCheapEnabled);
      if (tariff.className === 'expensive') return Boolean(settings.boilerDynamicExpensiveEnabled);
      return Boolean(settings.boilerDynamicNormalEnabled);
    }
    return Boolean(settings.boilerFixedChargeWindowEnabled) && tariff.className === 'cheap';
  }

  getPlanningBlockMs(settings = this.getSettings()) {
    return this.getPlanningMinIntervalMs(settings);
  }

  markControlContextDirty() {
    this.controlContextDirty = true;
  }

  markFlexibleLoadsDirty() {
    this.flexibleLoadsDirty = true;
  }

  clearPlanningTimer() {
    if (this.planningCache?.timer) clearTimeout(this.planningCache.timer);
    if (this.planningCache) {
      this.planningCache.timer = null;
      this.planningCache.timerAt = 0;
    }
  }

  schedulePlanningRecalculation(at) {
    if (!this.planningCache?.dirty || !this.planningCache?.value || !this.isNightPlanningPhase()) return;
    const now = Date.now();
    const targetAt = Math.max(now, Number(at) || now);
    if (this.planningCache.timer && Number(this.planningCache.timerAt) > 0
      && Number(this.planningCache.timerAt) <= targetAt + 20) return;
    this.clearPlanningTimer();
    this.planningCache.timerAt = targetAt;
    this.planningCache.timer = this.homey.setTimeout(() => {
      this.planningCache.timer = null;
      this.planningCache.timerAt = 0;
      if (!this.planningCache?.dirty) return;
      this.publishChargePlanIfChanged().catch(err => this.error('Deferred charge plan update failed', err));
    }, Math.max(1, targetAt - now));
  }

  invalidatePlanningCache(force = false) {
    if (!this.planningCache) this.planningCache = { generation: 0, value: null, dirty: true, lastCalculatedAt: 0, nextAllowedAt: 0, timer: null, timerAt: 0 };
    this.planningCache.generation += 1;
    this.planningCache.dirty = true;
    this.markControlContextDirty();
    this.markContextDirty('planning');
    if (force) {
      this.planningCache.nextAllowedAt = 0;
      this.clearPlanningTimer();
      return;
    }

    // Throttle, do not debounce: keep the last valid plan available and rebuild
    // once at the first permitted moment. Repeated SoC/forecast updates never
    // push that moment further into the future.
    const now = Date.now();
    const dueAt = Number(this.planningCache.nextAllowedAt) || 0;
    if (this.planningCache.value && dueAt > now) this.schedulePlanningRecalculation(dueAt);
  }

  async migrateSettings() {
    const schema = Number(this.homey.settings.get('settingsSchemaVersion') || 0);

    if (schema < 3) {
      const count = Math.max(1, Math.min(8, Math.round(Number(this.homey.settings.get('batteryCount')) || 4)));
      const oldCharge = Number(this.homey.settings.get('maxChargePerBatteryW'));
      const oldDischarge = Number(this.homey.settings.get('maxDischargePerBatteryW'));

      if (Number.isFinite(oldCharge) && oldCharge > 3000) {
        this.setSetting('maxTotalChargeW', oldCharge);
        this.setSetting('maxChargePerBatteryW', 2300);
      } else if (Number.isFinite(oldCharge) && oldCharge >= 0) {
        this.setSetting('maxTotalChargeW', Math.round(oldCharge * count));
      }

      if (Number.isFinite(oldDischarge) && oldDischarge > 3000) {
        this.setSetting('maxTotalDischargeW', oldDischarge);
        this.setSetting('maxDischargePerBatteryW', 2400);
      } else if (Number.isFinite(oldDischarge) && oldDischarge >= 0) {
        this.setSetting('maxTotalDischargeW', Math.round(oldDischarge * count));
      }
      this.setSetting('dynamicPriceSource', this.homey.settings.get('dynamicPriceSource') || 'manual');
    }

    if (schema < 4) {
      // v0.2.0 splits dynamic quarter-hour and hourly control into two explicit choices.
      if (String(this.homey.settings.get('contractType') || '') === 'dynamic') {
        this.setSetting('contractType', 'dynamic_quarter');
      }
      if (this.homey.settings.get('dynamicUseBatteryNormalHours') === null) this.setSetting('dynamicUseBatteryNormalHours', false);
      if (this.homey.settings.get('overrideResumeOnTariffChange') === null) this.setSetting('overrideResumeOnTariffChange', true);
      if (this.homey.settings.get('forcedModeResumeAt') === null) this.setSetting('forcedModeResumeAt', 0);
      if (this.homey.settings.get('controlProfile') === null) this.setSetting('controlProfile', 'normal');
    }

    if (schema < 5) {
      // 100% preserves the original battery-save behaviour: capture PV but do
      // not use stored energy for normal self-consumption unless the user lowers it.
      if (this.homey.settings.get('batterySaveDischargeAboveSoc') === null) {
        this.setSetting('batterySaveDischargeAboveSoc', 100);
      }
    }

    if (schema < 6) {
      // v0.2.5: controlEnabled is a persistent user choice. A blank install still
      // starts disabled through DEFAULTS/ensureDefaults(), but upgrades and app
      // restarts must never silently switch an enabled EMS back off.
      if (this.homey.settings.get('controlEnabled') === null) {
        this.setSetting('controlEnabled', false);
      }
    }

    if (schema < 7) {
      if (this.homey.settings.get('gridZeroMinW') === null) this.setSetting('gridZeroMinW', -5);
      if (this.homey.settings.get('gridZeroMaxW') === null) this.setSetting('gridZeroMaxW', 25);
    }

    if (schema < 8) {
      // Preserve existing behaviour on upgrade. The user must explicitly choose
      // Battery Save for low-forecast moments before this strategy can activate.
      if (this.homey.settings.get('lowForecastMode') === null) this.setSetting('lowForecastMode', 'self_consumption');
      if (this.homey.settings.get('lowForecastSelfConsumptionMinKwh') === null) this.setSetting('lowForecastSelfConsumptionMinKwh', 5);
    }

    if (schema < 9) {
      if (this.homey.settings.get('pvDeltaThresholdW') === null) this.setSetting('pvDeltaThresholdW', 100);
      if (this.homey.settings.get('invertBatteryCommand') === null) this.setSetting('invertBatteryCommand', false);
      // v0.2.19 introduces an explicit direction test before real EMS output may
      // be enabled. Upgrades therefore start safely disabled until that one-time
      // test has been confirmed for the current battery count/sign convention.
      this.setSetting('chargeTestPassed', false);
      this.setSetting('_chargeTestSignature', '');
      this.setSetting('controlEnabled', false);
    }

    if (schema < 10) {
      // v0.2.20: low-forecast Battery Save is configured per price category.
      // Migrate the old global choice as closely as possible: all non-high TOU
      // categories were eligible before, while dynamic High/Duur was excluded.
      const oldEnabled = String(this.homey.settings.get('lowForecastMode') || 'self_consumption') === 'solar_capture';
      if (this.homey.settings.get('lowForecastFixedEnabled') === null) {
        this.setSetting('lowForecastFixedEnabled', oldEnabled);
      }
      if (this.homey.settings.get('lowForecastDynamicCheapEnabled') === null) {
        this.setSetting('lowForecastDynamicCheapEnabled', oldEnabled);
      }
      if (this.homey.settings.get('lowForecastDynamicNormalEnabled') === null) {
        this.setSetting('lowForecastDynamicNormalEnabled', oldEnabled);
      }
      if (this.homey.settings.get('lowForecastDynamicExpensiveEnabled') === null) {
        this.setSetting('lowForecastDynamicExpensiveEnabled', false);
      }

      const rates = this.homey.settings.get('touRates');
      if (Array.isArray(rates) && rates.length) {
        const prices = rates.map(rate => Number(rate.importPrice)).filter(Number.isFinite);
        const minPrice = prices.length ? Math.min(...prices) : 0;
        const maxPrice = prices.length ? Math.max(...prices) : 0;
        const migrated = rates.map(rate => {
          if (rate.lowForecastBatterySave !== undefined && rate.lowForecastBatterySave !== null) return rate;
          const price = Number(rate.importPrice);
          const isOnlyPrice = maxPrice <= minPrice;
          const wasEligible = oldEnabled && (isOnlyPrice || !Number.isFinite(price) || price < maxPrice);
          return { ...rate, lowForecastBatterySave: wasEligible };
        });
        this.setSetting('touRates', migrated);
      }
    }

    if (schema < 11) {
      if (this.homey.settings.get('safetySoc') === null) this.setSetting('safetySoc', this.homey.settings.get('minSoc') ?? 10);
    }

    if (schema < 12) {
      if (this.homey.settings.get('batteryCommandStepW') === null) this.setSetting('batteryCommandStepW', 1);
      if (this.homey.settings.get('exportLimitEnabled') === null) this.setSetting('exportLimitEnabled', false);
      if (this.homey.settings.get('minimumExportW') === null) this.setSetting('minimumExportW', 50);
    }

    if (schema < 13) {
      // Keep upgrade behaviour unchanged: the new PV output interval initially
      // follows the previously configured battery command interval. Users can
      // then slow only the inverter/PV Flow without slowing battery control.
      if (this.homey.settings.get('pvCommandIntervalSeconds') === null) {
        this.setSetting('pvCommandIntervalSeconds', this.homey.settings.get('commandIntervalSeconds') ?? 10);
      }
    }

    if (schema < 14) {
      // v0.2.26 changes only runtime planning behavior; no user setting needs migration.
    }

    if (schema < 15) {
      // v0.2.27 removes deliberate overshoot. The old 'aggressive' profile is
      // renamed to 'exact' and now means a 1.00 correction gain.
      if (String(this.homey.settings.get('controlProfile') || '') === 'aggressive') {
        this.setSetting('controlProfile', 'exact');
      }
    }

    if (schema < 16) {
      // v0.3.0 adds optional EV/HVAC modules. Both remain disabled on upgrade.
      // Existing TOU tariffs gain an explicit EV-standard-charge flag; only the
      // conventional Superdal rate is selected automatically when present.
      const rates = this.homey.settings.get('touRates');
      if (Array.isArray(rates) && rates.length) {
        this.setSetting('touRates', rates.map(rate => ({
          ...rate,
          evChargeAllowed: rate.evChargeAllowed !== undefined
            ? Boolean(rate.evChargeAllowed)
            : String(rate.id || '').toLowerCase() === 'superdal',
        })));
      }
    }

    if (schema < 17) {
      // v0.3.6 adds an optional daily battery-command pause. It is disabled by
      // default for existing users; Marstek users can enable 23:59–00:00.
      if (this.homey.settings.get('batteryCommandPauseEnabled') === null) this.setSetting('batteryCommandPauseEnabled', false);
      if (this.homey.settings.get('batteryCommandPauseStart') === null) this.setSetting('batteryCommandPauseStart', '23:59');
      if (this.homey.settings.get('batteryCommandPauseEnd') === null) this.setSetting('batteryCommandPauseEnd', '00:00');
    }

    if (schema < 18) {
      // v0.3.7: PV curtailment is only allowed once the configured average
      // battery SoC is reached. Dynamic contracts now always use Homey Energy
      // instead of the old manual test-price source.
      if (this.homey.settings.get('pvCurtailMinBatterySoc') === null) this.setSetting('pvCurtailMinBatterySoc', 95);
      this.setSetting('dynamicPriceSource', 'homey');
    }

    if (schema < 19) {
      // v0.3.8 separates EV SoC from the generic EV status input. Existing users
      // keep SoC support enabled and retain the previous smart/battery-first behaviour.
      if (this.homey.settings.get('evSocEnabled') === null) this.setSetting('evSocEnabled', true);
      if (this.homey.settings.get('evMode') === null) this.setSetting('evMode', 'smart');
      if (this.homey.settings.get('evSmartPvPriority') === null) this.setSetting('evSmartPvPriority', 'battery_first');
      if (this.homey.settings.get('evSmartGridPriority') === null) this.setSetting('evSmartGridPriority', 'battery_first');
    }

    if (schema < 20) {
      // v0.3.9 adds charger-mode control for integrations such as Smappee.
      // Existing users stay on the original ampere-setpoint output.
      if (this.homey.settings.get('evControlType') === null) this.setSetting('evControlType', 'current');
    }

    if (schema < 21) {
      // v0.3.11: Battery Save may be relaxed per tariff down to the calculated
      // forecast target SoC. Preserve existing behaviour by keeping it off.
      if (this.homey.settings.get('lowForecastFixedDischargeToTarget') === null) this.setSetting('lowForecastFixedDischargeToTarget', false);
      if (this.homey.settings.get('lowForecastDynamicCheapDischargeToTarget') === null) this.setSetting('lowForecastDynamicCheapDischargeToTarget', false);
      if (this.homey.settings.get('lowForecastDynamicNormalDischargeToTarget') === null) this.setSetting('lowForecastDynamicNormalDischargeToTarget', false);
      if (this.homey.settings.get('lowForecastDynamicExpensiveDischargeToTarget') === null) this.setSetting('lowForecastDynamicExpensiveDischargeToTarget', false);
      const rates = this.homey.settings.get('touRates');
      if (Array.isArray(rates) && rates.length) {
        this.setSetting('touRates', rates.map(rate => ({
          ...rate,
          lowForecastDischargeToTarget: Boolean(rate.lowForecastDischargeToTarget),
        })));
      }
    }

    if (schema < 22) {
      // v0.3.16: forward energy planning uses remaining PV today while day
      // classification keeps the full-day forecast. Peak-period reserve is an
      // optional extra target floor and defaults to 0 to preserve upgrades.
      if (this.homey.settings.get('peakReserveKwh') === null) this.setSetting('peakReserveKwh', 0);
      if (this.homey.settings.get('peakReservePercent') === null) this.setSetting('peakReservePercent', 0);
    }

    if (schema < 23) {
      // v0.3.18: the next-peak reserve becomes a solar-day protection layer
      // with selectable seasons. Summer defaults off; night planning remains
      // solely responsible for overnight / next-day energy planning.
      if (this.homey.settings.get('peakReserveSeasonWinter') === null) this.setSetting('peakReserveSeasonWinter', true);
      if (this.homey.settings.get('peakReserveSeasonSpring') === null) this.setSetting('peakReserveSeasonSpring', true);
      if (this.homey.settings.get('peakReserveSeasonSummer') === null) this.setSetting('peakReserveSeasonSummer', false);
      if (this.homey.settings.get('peakReserveSeasonAutumn') === null) this.setSetting('peakReserveSeasonAutumn', true);
    }

    if (schema < 24) {
      // v0.3.20 adds an opt-in split command path per battery. Defaults are
      // created by ensureDefaults(); no existing single-command output changes.
    }

    if (schema < 25) {
      // v0.3.26 removes the legacy manual dynamic-price test data completely.
      // Dynamic/variable contracts always use Homey Energy price slots.
      this.setSetting('dynamicPriceSource', 'homey');
      this.setSetting('dynamicSlots', []);
    }

    if (schema < 26) {
      // v0.3.31 adds optional per-battery split-mode safety resend. Defaults are
      // supplied by ensureDefaults(); existing installations remain disabled.
    }

    if (schema < 27) {
      // v0.3.34: when Smart PV priority is EV-first and the EV is already
      // charging, keep a small configurable export margin so a smart charger
      // can continue to see PV headroom instead of closing the home battery
      // completely. The margin is inactive while measured EV current is 0 A.
      if (this.homey.settings.get('evSmartPvExportTargetW') === null) this.setSetting('evSmartPvExportTargetW', 500);
    }

    if (schema < 28) {
      // v0.3.35: mode-controlled chargers get a minimum STOP hold after Peak
      // Guard intervenes, avoiding rapid stop/start cycling.
      if (this.homey.settings.get('evPeakGuardStopHoldSeconds') === null) this.setSetting('evPeakGuardStopHoldSeconds', 60);
    }


    if (schema < 29) {
      // v0.3.36: TOU tariff categories can independently allow Smart EV
      // charging from PV surplus and define the minimum surplus that may start
      // it. Preserve historical behaviour on upgrade: PV charging stays allowed
      // in every existing tariff and the threshold defaults to 0 W.
      const rates = this.homey.settings.get('touRates');
      if (Array.isArray(rates) && rates.length) {
        this.setSetting('touRates', rates.map(rate => ({
          ...rate,
          evPvChargeAllowed: rate.evPvChargeAllowed !== false,
          evPvMinSurplusW: Math.max(0, Number(rate.evPvMinSurplusW) || 0),
        })));
      }
    }

    if (schema < 30) {
      // v0.3.38: PV charging uses hysteresis per TOU tariff. Starting still
      // requires the PV-surplus threshold, while stopping requires sustained
      // measured grid import. Existing installs receive conservative defaults.
      const rates = this.homey.settings.get('touRates');
      if (Array.isArray(rates) && rates.length) {
        this.setSetting('touRates', rates.map(rate => ({
          ...rate,
          evPvStopGridImportW: Math.max(0, Number(rate.evPvStopGridImportW ?? 1000) || 0),
        })));
      }
    }

    if (schema < 31) {
      // v0.3.40: opposite split-battery directions must remain requested for a
      // configurable confirmation period before a real mode switch is allowed.
      // This adds only timestamp state and a single existing recheck, no polling.
      for (let battery = 1; battery <= 8; battery += 1) {
        const key = `splitCommandBattery${battery}DirectionConfirmSeconds`;
        if (this.homey.settings.get(key) === null) this.setSetting(key, 15);
      }
    }

    if (schema < 32) {
      // v0.3.43: daytime peak-reserve activation is selectable per calendar
      // month instead of per meteorological season. Preserve the user's exact
      // previous behavior by expanding each season choice to its three months.
      const winter = this.homey.settings.get('peakReserveSeasonWinter') !== false;
      const spring = this.homey.settings.get('peakReserveSeasonSpring') !== false;
      const summer = Boolean(this.homey.settings.get('peakReserveSeasonSummer'));
      const autumn = this.homey.settings.get('peakReserveSeasonAutumn') !== false;
      const monthDefaults = {
        1: winter, 2: winter,
        3: spring, 4: spring, 5: spring,
        6: summer, 7: summer, 8: summer,
        9: autumn, 10: autumn, 11: autumn,
        12: winter,
      };
      for (let month = 1; month <= 12; month += 1) {
        const key = `peakReserveMonth${month}`;
        if (this.homey.settings.get(key) === null) this.setSetting(key, monthDefaults[month]);
      }
    }

    if (schema < 33) {
      // v0.3.48: HVAC mode selection moves from outdoor temperature to a room
      // comfort/activation band. Keep the new controller conservative by
      // default: comfort first, normal fan response, automatic control enabled.
      if (this.homey.settings.get('hvacAutomaticControlEnabled') === null) this.setSetting('hvacAutomaticControlEnabled', true);
      if (this.homey.settings.get('hvacComfortMinC') === null) this.setSetting('hvacComfortMinC', 21);
      if (this.homey.settings.get('hvacComfortMaxC') === null) this.setSetting('hvacComfortMaxC', 23);
      if (this.homey.settings.get('hvacHeatingActivationBelowC') === null) this.setSetting('hvacHeatingActivationBelowC', 20);
      if (this.homey.settings.get('hvacCoolingActivationAboveC') === null) this.setSetting('hvacCoolingActivationAboveC', 24);
      if (this.homey.settings.get('hvacPriority') === null) this.setSetting('hvacPriority', 'comfort');
      if (this.homey.settings.get('hvacCoolingFanProfile') === null) this.setSetting('hvacCoolingFanProfile', 'normal');
      if (this.homey.settings.get('hvacHeatingFanProfile') === null) this.setSetting('hvacHeatingFanProfile', 'normal');
    }


    if (schema < 34) {
      // v0.3.49: multiple EV/HVAC instances, boiler cycles and a low-frequency
      // priority manager. Instance 1 keeps every legacy key; new instances are
      // disabled until the user raises the configured count.
      if (this.homey.settings.get('evCount') === null) this.setSetting('evCount', 1);
      if (this.homey.settings.get('hvacCount') === null) this.setSetting('hvacCount', 1);
      if (this.homey.settings.get('evName') === null) this.setSetting('evName', '');
      if (this.homey.settings.get('hvacName') === null) this.setSetting('hvacName', '');
      if (this.homey.settings.get('hvacStopBatterySoc') === null) this.setSetting('hvacStopBatterySoc', 50);
      if (this.homey.settings.get('priorityEvaluationMinutes') === null) this.setSetting('priorityEvaluationMinutes', 5);
      if (this.homey.settings.get('flexibleLoadPriorityOrder') === null) this.setSetting('flexibleLoadPriorityOrder', ['boiler', 'hvac1', 'hvac2', 'hvac3', 'hvac4']);
      const rates = this.homey.settings.get('touRates');
      if (Array.isArray(rates) && rates.length) {
        this.setSetting('touRates', rates.map(rate => {
          const next = { ...rate, boilerChargeAllowed: Boolean(rate.boilerChargeAllowed) };
          for (let instance = 2; instance <= 4; instance += 1) {
            if (next[`ev${instance}ChargeAllowed`] === undefined) next[`ev${instance}ChargeAllowed`] = false;
            if (next[`ev${instance}PvChargeAllowed`] === undefined) next[`ev${instance}PvChargeAllowed`] = true;
            if (next[`ev${instance}PvMinSurplusW`] === undefined) next[`ev${instance}PvMinSurplusW`] = 0;
            if (next[`ev${instance}PvStopGridImportW`] === undefined) next[`ev${instance}PvStopGridImportW`] = 1000;
          }
          return next;
        }));
      }
    }

    if (schema < 35) {
      // v0.3.50: optional flexible-load modules can be configured as zero.
      // Preserve configured/active modules, but collapse the default inactive
      // instance-1 placeholders from v0.3.49 to zero for a cleaner first setup.
      const currentEvCount = Math.max(0, Math.min(4, Math.round(Number(this.homey.settings.get('evCount')) || 0)));
      if (currentEvCount <= 1 && this.homey.settings.get('evEnabled') !== true) this.setSetting('evCount', 0);
      const currentHvacCount = Math.max(0, Math.min(4, Math.round(Number(this.homey.settings.get('hvacCount')) || 0)));
      if (currentHvacCount <= 1 && this.homey.settings.get('hvacEnabled') !== true) this.setSetting('hvacCount', 0);
      if (this.homey.settings.get('boilerCount') === null) this.setSetting('boilerCount', this.homey.settings.get('boilerEnabled') === true ? 1 : 0);
    }

    if (schema < 36) {
      // v0.3.56: the boiler warm state resets at a fixed local clock time,
      // rather than a duration measured from the last completed cycle.
      if (this.homey.settings.get('boilerColdResetTime') === null) this.setSetting('boilerColdResetTime', '07:00');
    }

    if (schema < 37) {
      // v0.3.56: tariff fallback may only use the boiler once the home
      // batteries have reached a configurable minimum reserve.
      if (this.homey.settings.get('boilerTariffMinBatterySoc') === null) this.setSetting('boilerTariffMinBatterySoc', 40);
    }

    if (schema < 38) {
      // v0.3.56: tariff-heating hysteresis. The boiler may start once the
      // battery reserve reaches 40% by default, but only stops again at 30%.
      if (this.homey.settings.get('boilerTariffStopBatterySoc') === null) this.setSetting('boilerTariffStopBatterySoc', 30);
    }

    if (schema < 39) {
      // v0.3.57: separate fast battery regulation from slow context work and
      // throttle charge-plan rebuilds without delaying the first valid plan.
      if (this.homey.settings.get('slowControlIntervalSeconds') === null) this.setSetting('slowControlIntervalSeconds', 60);
      if (this.homey.settings.get('planningMinIntervalMinutes') === null) this.setSetting('planningMinIntervalMinutes', 5);
    }

    if (schema < 40) {
      // v0.3.59: the former comfort minimum/maximum become independent heating
      // and cooling targets. Keep activation thresholds separate and derive the
      // new PV energy deviation from the old comfort-band width where possible.
      for (let instance = 1; instance <= 4; instance += 1) {
        const stem = instance === 1 ? 'hvac' : `hvac${instance}`;
        const key = `${stem}EnergyDeviationC`;
        if (this.homey.settings.get(key) === null) {
          const heatingTarget = Number(this.homey.settings.get(`${stem}ComfortMinC`));
          const coolingTarget = Number(this.homey.settings.get(`${stem}ComfortMaxC`));
          const legacyWidth = Number.isFinite(heatingTarget) && Number.isFinite(coolingTarget)
            ? Math.abs(coolingTarget - heatingTarget)
            : 2;
          this.setSetting(key, Math.max(0, Math.min(10, legacyWidth)));
        }
      }
    }

    if (schema < 41) {
      // v0.3.80: non-selected (typically sunny) months can optionally use a
      // separate PV-first minimum SoC. Keep it disabled on every upgrade so the
      // previously configured month strategy cannot change without user action.
      if (this.homey.settings.get('sunnyMonthsMinSocEnabled') === null) this.setSetting('sunnyMonthsMinSocEnabled', false);
      if (this.homey.settings.get('sunnyMonthsMinSoc') === null) this.setSetting('sunnyMonthsMinSoc', 20);
    }

    if (schema < 42) {
      // v0.3.84: monthly minimum/reserve values can optionally also influence
      // night planning. Keep disabled on upgrade to preserve existing charging.
      if (this.homey.settings.get('peakReserveNightEnabled') === null) this.setSetting('peakReserveNightEnabled', false);
    }

    if (schema < 43) {
      // v0.3.85: explicit per-tariff EMS policies replace implicit price-class
      // choices for TOU charging/import avoidance. Migration mirrors the old
      // behaviour: cheapest tariff(s) may charge day and night, most expensive
      // tariff(s) avoid import. The user can then independently refine both
      // charge planners without changing behaviour merely by upgrading.
      const rates = this.homey.settings.get('touRates');
      if (Array.isArray(rates) && rates.length) {
        const prices = rates.map(rate => Number(rate?.importPrice)).filter(Number.isFinite);
        const minPrice = prices.length ? Math.min(...prices) : null;
        const maxPrice = prices.length ? Math.max(...prices) : null;
        const distinctPrices = new Set(prices.map(value => String(value))).size > 1;
        this.setSetting('touRates', rates.map(rate => {
          const price = Number(rate?.importPrice);
          const oldCheap = distinctPrices && Number.isFinite(price) && price === minPrice;
          const oldExpensive = distinctPrices && Number.isFinite(price) && price === maxPrice;
          const avoidGridImport = rate.avoidGridImport !== undefined ? Boolean(rate.avoidGridImport) : oldExpensive;
          const next = {
            ...rate,
            nightChargeAllowed: rate.nightChargeAllowed !== undefined ? Boolean(rate.nightChargeAllowed) : oldCheap,
            dayChargeAllowed: rate.dayChargeAllowed !== undefined ? Boolean(rate.dayChargeAllowed) : oldCheap,
            avoidGridImport,
          };
          if (avoidGridImport) {
            next.nightChargeAllowed = false;
            next.dayChargeAllowed = false;
            next.lowForecastBatterySave = false;
            next.lowForecastDischargeToTarget = false;
            next.boilerChargeAllowed = false;
            for (let instance = 1; instance <= 4; instance += 1) {
              const stem = instance === 1 ? 'ev' : `ev${instance}`;
              next[`${stem}ChargeAllowed`] = false;
            }
          }
          return next;
        }));
      }
    }

    if (schema < 44) {
      // v0.3.86: TOU charging policy can differ between weekdays and weekends.
      // Derive both new selectors from the v0.3.85 day/night booleans so an
      // upgrade keeps the exact same charging behaviour until the user changes it.
      const rates = this.homey.settings.get('touRates');
      if (Array.isArray(rates) && rates.length) {
        const toMode = rate => {
          const night = Boolean(rate?.nightChargeAllowed);
          const day = Boolean(rate?.dayChargeAllowed);
          if (night && day) return 'always';
          if (night) return 'night';
          if (day) return 'day';
          return 'never';
        };
        this.setSetting('touRates', rates.map(rate => {
          const fallback = toMode(rate);
          const validModes = new Set(['never', 'night', 'day', 'always']);
          const next = {
            ...rate,
            weekdayChargeMode: validModes.has(String(rate?.weekdayChargeMode || '').toLowerCase()) ? String(rate.weekdayChargeMode).toLowerCase() : fallback,
            weekendChargeMode: validModes.has(String(rate?.weekendChargeMode || '').toLowerCase()) ? String(rate.weekendChargeMode).toLowerCase() : fallback,
          };
          if (Boolean(next.avoidGridImport)) {
            next.weekdayChargeMode = 'never';
            next.weekendChargeMode = 'never';
          }
          return next;
        }));
      }
    }


    if (schema < 45) {
      // v0.3.88: replace the coupled kWh / reserve-percentage setting with one
      // absolute selected-month minimum SoC. Convert the old reserve above
      // Minimum SoC into the equivalent absolute SoC so upgrades keep the same
      // effective target (e.g. 88% reserve above 12% Minimum SoC -> 100%).
      if (this.homey.settings.get('peakReserveTargetSoc') === null) {
        const capacityRaw = Number(this.homey.settings.get('totalCapacityKwh'));
        const minSocRaw = Number(this.homey.settings.get('minSoc'));
        const maxSocRaw = Number(this.homey.settings.get('maxSoc'));
        const capacity = Math.max(0, Number.isFinite(capacityRaw) ? capacityRaw : Number(DEFAULTS.totalCapacityKwh) || 0);
        const minSoc = Math.max(0, Math.min(100, Number.isFinite(minSocRaw) ? minSocRaw : Number(DEFAULTS.minSoc) || 0));
        const maxSoc = Math.max(minSoc, Math.min(100, Number.isFinite(maxSocRaw) ? maxSocRaw : Number(DEFAULTS.maxSoc) || 100));
        const legacyKwh = Math.max(0, Number(this.homey.settings.get('peakReserveKwh')) || 0);
        const legacyPercent = Math.max(0, Number(this.homey.settings.get('peakReservePercent')) || 0);
        let targetSoc = 0;
        if (capacity > 0 && legacyKwh > 0) targetSoc = minSoc + ((legacyKwh / capacity) * 100);
        else if (legacyPercent > 0) targetSoc = minSoc + legacyPercent;
        if (targetSoc > 0) targetSoc = Math.max(0, Math.min(maxSoc, targetSoc));
        this.setSetting('peakReserveTargetSoc', Math.round(targetSoc * 10) / 10);
      }
    }

    if (schema < 46) {
      // v0.4.0: optional low-PV day promotion. Disabled on every upgrade so
      // existing Battery Save behaviour cannot change without user action.
      if (this.homey.settings.get('lowForecastAutoSunnyEnabled') === null) this.setSetting('lowForecastAutoSunnyEnabled', false);
      if (this.homey.settings.get('lowForecastAutoSunnySoc') === null) this.setSetting('lowForecastAutoSunnySoc', 90);
      if (this.homey.settings.get('lowForecastAutoSunnyMinutes') === null) this.setSetting('lowForecastAutoSunnyMinutes', 10);
    }

    if (schema < 47) {
      // v0.4.2: split the former single planning horizon into a configurable
      // morning target for night planning and a configurable daytime target.
      // Existing users keep the familiar 07:00 / 17:00 defaults.
      if (this.homey.settings.get('nightTargetTime') === null) this.setSetting('nightTargetTime', '07:00');
      if (this.homey.settings.get('solarTargetTime') === null) this.setSetting('solarTargetTime', '17:00');
    }

    if (schema < 48) {
      // v0.4.4: optional heterogeneous battery power limits. Keep this off on
      // upgrade and seed each battery from the existing shared maxima so merely
      // enabling the option never changes a user's configured hardware ceiling.
      if (this.homey.settings.get('individualBatteryPowerLimitsEnabled') === null) this.setSetting('individualBatteryPowerLimitsEnabled', false);
      const sharedCharge = Math.max(0, Number(this.homey.settings.get('maxChargePerBatteryW')) || Number(DEFAULTS.maxChargePerBatteryW) || 2300);
      const sharedDischarge = Math.max(0, Number(this.homey.settings.get('maxDischargePerBatteryW')) || Number(DEFAULTS.maxDischargePerBatteryW) || 2400);
      for (let battery = 1; battery <= 8; battery += 1) {
        if (this.homey.settings.get(`battery${battery}MaxChargeW`) === null) this.setSetting(`battery${battery}MaxChargeW`, sharedCharge);
        if (this.homey.settings.get(`battery${battery}MaxDischargeW`) === null) this.setSetting(`battery${battery}MaxDischargeW`, sharedDischarge);
      }
    }

    if (schema < 49) {
      // v0.4.10: optional EV Peak Guard battery assistance. Disabled on upgrade
      // to preserve the former behaviour until the user explicitly enables it.
      for (let ev = 1; ev <= 4; ev += 1) {
        const stem = ev === 1 ? 'ev' : `ev${ev}`;
        if (this.homey.settings.get(`${stem}PeakGuardBatteryAssistNormal`) === null) this.setSetting(`${stem}PeakGuardBatteryAssistNormal`, false);
        if (this.homey.settings.get(`${stem}PeakGuardBatteryAssistEmergency`) === null) this.setSetting(`${stem}PeakGuardBatteryAssistEmergency`, false);
      }
    }

    this.setSetting('settingsSchemaVersion', 49);
  }

  async ensureDefaults() {
    for (const [key, value] of Object.entries(DEFAULTS)) {
      const existing = this.homey.settings.get(key);
      if (existing === null || existing === undefined) {
        this.setSetting(key, value);
      }
    }
  }

  async getOrCreateToken(id, opts) {
    if (this.tokens.has(id)) return this.tokens.get(id);
    let token = null;
    try {
      token = this.homey.flow.getToken(id);
    } catch (err) {
      token = null;
    }
    if (!token) token = await this.homey.flow.createToken(id, opts);
    this.tokens.set(id, token);
    return token;
  }

  async syncTokens() {
    const settings = this.getSettings();
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));

    for (let i = 1; i <= 8; i += 1) {
      const ids = [
        [`battery${i}command`, `HomeFlux EMS - Battery ${i} Command (W)`],
        [`splitbattery${i}chargepower`, `HomeFlux EMS - Battery ${i} Split Charge Power (W)`],
        [`splitbattery${i}dischargepower`, `HomeFlux EMS - Battery ${i} Split Discharge Power (W)`],
      ];
      if (i <= count) {
        for (const [id, title] of ids) {
          const token = await this.getOrCreateToken(id, { type: 'number', title });
          if (id === `battery${i}command`) {
            if (this.lastEmittedCommands[i - 1] === undefined) await token.setValue(0);
          } else {
            const splitState = this.splitCommandState?.[i - 1];
            if (!splitState?.currentMode) await token.setValue(0);
          }
        }
      } else {
        for (const [id] of ids) {
          if (!this.tokens.has(id)) continue;
          try {
            await this.tokens.get(id).unregister();
          } catch (err) {
            this.error(`Could not unregister ${id}`, err);
          }
          this.tokens.delete(id);
        }
      }
    }

    const fixedTokens = [
      ['emstotalcommand', 'number', 'HomeFlux EMS - Total Command (W)', 0],
      ['emsmode', 'string', 'HomeFlux EMS - Mode', 'Stand-by'],
      ['emsoverride', 'string', 'HomeFlux EMS - Override', ''],
      ['emsstatus', 'string', 'HomeFlux EMS - Status', 'Stand-by'],
      ['emsnextchange', 'string', 'HomeFlux EMS - Next Change', ''],
      ['emstargetsoc', 'number', 'HomeFlux EMS - Target SoC (%)', 0],
      ['emsgridchargeassist', 'number', 'HomeFlux EMS - Grid Charge Assist (W)', 0],
      ['emscalculatedcommand', 'number', 'HomeFlux EMS - Calculated Total Command (W)', 0],
      ['emswarning', 'string', 'HomeFlux EMS - Warning', ''],
      ['emsaction', 'string', 'HomeFlux EMS - Current Action', 'Rust'],
      ['emspvcharge', 'number', 'HomeFlux EMS - PV Charge (W)', 0],
      ['emspvlimit', 'number', 'HomeFlux EMS - PV Power Limit (%)', 100],
      ['emscurrentprice', 'number', 'HomeFlux EMS - Homey Energy Current Price', 0],
      ['emspriceclass', 'string', 'HomeFlux EMS - Homey Energy Price Class', ''],
      ['emscheapesthours', 'string', 'HomeFlux EMS - Cheapest Hours', ''],
      ['emsexpensivehours', 'string', 'HomeFlux EMS - Most Expensive Hours', ''],
      ['emscheapestblock', 'string', 'HomeFlux EMS - Cheapest Consecutive Block', ''],
      ['emshomeypricerank', 'number', 'HomeFlux EMS - Homey Energy Price Rank', 0],
      ['emshomeypriceinterval', 'number', 'HomeFlux EMS - Homey Energy Price Interval (min)', 0],
      ['emschargeplan', 'string', 'HomeFlux EMS - Charge Plan', ''],
      ['emsevcurrent', 'number', 'HomeFlux EMS - EV Charge Current (A)', 0],
      ['emsevallowed', 'string', 'HomeFlux EMS - EV Charging Allowed', 'Nee'],
      ['emsevmode', 'string', 'HomeFlux EMS - EV Charge Mode', 'stop'],
      ['emshvacsetpoint', 'number', 'HomeFlux EMS - HVAC Setpoint (C)', 0],
      ['emshvacmode', 'string', 'HomeFlux EMS - HVAC Mode', ''],
    ];
    for (const [id, type, title, value] of fixedTokens) {
      const token = await this.getOrCreateToken(id, { type, title });
      if (!this.latestResult) await token.setValue(value);
    }
  }

  registerEmsDevice(device) {
    if (!this.emsDevices) this.emsDevices = new Set();
    this.emsDevices.add(device);
  }

  unregisterEmsDevice(device) {
    if (this.emsDevices) this.emsDevices.delete(device);
  }

  getChargeTestSignature(settings = this.getSettings()) {
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const split = Array.from({ length: count }, (_, index) => {
      const battery = index + 1;
      if (!Boolean(settings[`splitCommandBattery${battery}Enabled`])) return 'single';
      return [
        'split',
        Boolean(settings[`splitCommandBattery${battery}ChargePowerPositive`]) ? 'pos' : 'signed',
        Boolean(settings[`splitCommandBattery${battery}KeepMinimumPower`]) ? 'min' : 'raw',
        Math.max(0, Math.round(Number(settings[`splitCommandBattery${battery}MinimumPowerW`]) || 0)),
        String(settings[`splitCommandBattery${battery}ZeroMode`] || 'discharge'),
      ].join('-');
    }).join('|');
    return `${count}:${Boolean(settings.invertBatteryCommand) ? 'inverted' : 'normal'}:${split}`;
  }

  isChargeTestValid(settings = this.getSettings()) {
    if (!Boolean(settings.chargeTestPassed)) return false;
    const storedSignature = String(this.homey.settings.get('_chargeTestSignature') || '');
    return storedSignature === this.getChargeTestSignature(settings);
  }

  toPublishedCommand(value, settings = this.getSettings()) {
    const numeric = Math.round(Number(value) || 0);
    return Boolean(settings.invertBatteryCommand) ? -numeric : numeric;
  }

  ensureSplitCommandState() {
    if (!Array.isArray(this.splitCommandState) || this.splitCommandState.length !== 8) {
      this.splitCommandState = Array.from({ length: 8 }, () => ({ currentMode: null, chargeHoldUntil: 0, dischargeHoldUntil: 0, lastModeSwitchAt: 0, pendingMode: null, pendingModeSince: 0, recheckTimer: null, recheckAt: 0, safetyTimer: null, lastPower: null, lastSafetyModeResendAt: 0 }));
    }
    if (!Array.isArray(this.splitCommandTriggers) || this.splitCommandTriggers.length !== 8) {
      this.splitCommandTriggers = Array.from({ length: 8 }, () => ({ chargeMode: null, dischargeMode: null, chargePower: null, dischargePower: null }));
    }
  }

  getSplitBatteryConfig(index, settings = this.getSettings()) {
    const battery = index + 1;
    return {
      battery,
      enabled: Boolean(settings[`splitCommandBattery${battery}Enabled`]),
      chargePowerPositive: Boolean(settings[`splitCommandBattery${battery}ChargePowerPositive`]),
      keepMinimumPower: settings[`splitCommandBattery${battery}KeepMinimumPower`] !== false,
      minimumPowerW: Number.isFinite(Number(settings[`splitCommandBattery${battery}MinimumPowerW`])) ? Math.max(0, Math.round(Number(settings[`splitCommandBattery${battery}MinimumPowerW`]))) : 100,
      zeroMode: String(settings[`splitCommandBattery${battery}ZeroMode`] || 'discharge') === 'charge' ? 'charge' : 'discharge',
      chargeMinSwitchSeconds: Number.isFinite(Number(settings[`splitCommandBattery${battery}ChargeMinSwitchSeconds`])) ? Math.max(0, Number(settings[`splitCommandBattery${battery}ChargeMinSwitchSeconds`])) : 60,
      dischargeMinSwitchSeconds: Number.isFinite(Number(settings[`splitCommandBattery${battery}DischargeMinSwitchSeconds`])) ? Math.max(0, Number(settings[`splitCommandBattery${battery}DischargeMinSwitchSeconds`])) : 60,
      minBetweenSwitchSeconds: Number.isFinite(Number(settings[`splitCommandBattery${battery}MinBetweenSwitchSeconds`])) ? Math.max(0, Number(settings[`splitCommandBattery${battery}MinBetweenSwitchSeconds`])) : 60,
      directionConfirmSeconds: Number.isFinite(Number(settings[`splitCommandBattery${battery}DirectionConfirmSeconds`])) ? Math.max(0, Number(settings[`splitCommandBattery${battery}DirectionConfirmSeconds`])) : 15,
      safetyModeResendEnabled: Boolean(settings[`splitCommandBattery${battery}SafetyModeResendEnabled`]),
      safetyModeResendMinutes: Number.isFinite(Number(settings[`splitCommandBattery${battery}SafetyModeResendMinutes`])) ? Math.max(1, Number(settings[`splitCommandBattery${battery}SafetyModeResendMinutes`])) : 10,
    };
  }

  getSplitDesiredMode(internalCommandW, config) {
    const value = Math.round(Number(internalCommandW) || 0);
    if (value < 0) return 'charge';
    if (value > 0) return 'discharge';
    return config.zeroMode;
  }

  getSplitPowerValue(mode, internalCommandW, config) {
    const requested = Math.abs(Math.round(Number(internalCommandW) || 0));
    let magnitude = requested;
    if (requested === 0) magnitude = config.minimumPowerW;
    else if (config.keepMinimumPower) magnitude = Math.max(config.minimumPowerW, requested);
    if (mode === 'charge') return config.chargePowerPositive ? magnitude : -magnitude;
    return magnitude;
  }

  getSplitModeHoldUntil(index) {
    this.ensureSplitCommandState();
    const state = this.splitCommandState[index];
    if (!state?.currentMode) return 0;
    return state.currentMode === 'charge' ? Number(state.chargeHoldUntil) || 0 : Number(state.dischargeHoldUntil) || 0;
  }

  getSplitNextModeSwitchAt(index, config) {
    this.ensureSplitCommandState();
    const state = this.splitCommandState[index];
    if (!state?.currentMode) return 0;
    const activeModeHoldUntil = this.getSplitModeHoldUntil(index);
    const betweenSwitchesUntil = (Number(state.lastModeSwitchAt) || 0) + ((Number(config?.minBetweenSwitchSeconds) || 0) * 1000);
    return Math.max(activeModeHoldUntil, betweenSwitchesUntil);
  }

  clearSplitPendingDirection(index) {
    this.ensureSplitCommandState();
    const state = this.splitCommandState[index];
    if (!state) return;
    state.pendingMode = null;
    state.pendingModeSince = 0;
  }

  getSplitConfirmedSwitchAt(index, desiredMode, config, now = Date.now()) {
    this.ensureSplitCommandState();
    const state = this.splitCommandState[index];
    if (!state?.currentMode || state.currentMode === desiredMode) {
      this.clearSplitPendingDirection(index);
      return 0;
    }

    // Start the confirmation window only when the opposite direction first
    // becomes desirable. If the request flips back, the caller clears it.
    if (state.pendingMode !== desiredMode || !(Number(state.pendingModeSince) > 0)) {
      state.pendingMode = desiredMode;
      state.pendingModeSince = now;
    }
    const confirmUntil = Number(state.pendingModeSince) + ((Number(config?.directionConfirmSeconds) || 0) * 1000);
    return Math.max(this.getSplitNextModeSwitchAt(index, config), confirmUntil);
  }

  scheduleSplitCommandRecheck(index, at) {
    this.ensureSplitCommandState();
    const state = this.splitCommandState[index];
    if (!state) return;
    const requestedAt = Math.max(Date.now(), Number(at) || Date.now());
    // Keep the already scheduled one-shot recheck when it fires at the same or
    // an earlier useful moment. Repeated P1/control passes must not churn timers.
    if (state.recheckTimer && Number(state.recheckAt) > 0 && Number(state.recheckAt) <= requestedAt + 20) return;
    if (state.recheckTimer) clearTimeout(state.recheckTimer);
    state.recheckAt = requestedAt;
    const wait = Math.max(0, requestedAt - Date.now()) + 10;
    state.recheckTimer = this.homey.setTimeout(() => {
      state.recheckTimer = null;
      state.recheckAt = 0;
      this.lastControlEvalAt = 0;
      this.requestEvaluate(true);
    }, wait);
  }

  splitModeChangeNeeded(result, settings = this.getSettings(), now = Date.now()) {
    this.ensureSplitCommandState();
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const commands = result?.candidateCommands || [];
    let switchNeededNow = false;

    for (let index = 0; index < count; index += 1) {
      const config = this.getSplitBatteryConfig(index, settings);
      if (!config.enabled) continue;
      const desiredMode = this.getSplitDesiredMode(commands[index] || 0, config);
      const state = this.splitCommandState[index];

      if (!state.currentMode) {
        switchNeededNow = true;
        continue;
      }

      if (state.currentMode === desiredMode) {
        // A previously requested opposite mode may have disappeared again before
        // its confirmation/lock window expired. Forget it immediately.
        this.clearSplitPendingDirection(index);
        if (state.recheckTimer) {
          clearTimeout(state.recheckTimer);
          state.recheckTimer = null;
          state.recheckAt = 0;
        }
        continue;
      }

      const switchAt = this.getSplitConfirmedSwitchAt(index, desiredMode, config, now);
      if (now >= switchAt) {
        // A mode transition is a control change in its own right. It must pass
        // even when the wattage delta is 0 W or below commandDeadbandW.
        switchNeededNow = true;
      } else {
        // v0.3.30: remember a BLOCKED mode transition independently from the
        // normal power deadband. When the lock expires, recalculate from the
        // newest grid/PV input instead of blindly replaying this old request.
        this.scheduleSplitCommandRecheck(index, switchAt);
      }
    }
    return switchNeededNow;
  }

  clearSplitSafetyModeResend(index) {
    this.ensureSplitCommandState();
    const state = this.splitCommandState[index];
    if (!state?.safetyTimer) return;
    clearTimeout(state.safetyTimer);
    state.safetyTimer = null;
  }

  scheduleSplitSafetyModeResend(index) {
    this.ensureSplitCommandState();
    const state = this.splitCommandState[index];
    const settings = this.getSettings();
    const config = this.getSplitBatteryConfig(index, settings);
    if (!state || state.safetyTimer || !config.enabled || !config.safetyModeResendEnabled || !state.currentMode) return;
    const intervalMs = Math.max(1, Number(config.safetyModeResendMinutes) || 10) * 60 * 1000;
    state.safetyTimer = this.homey.setTimeout(async () => {
      state.safetyTimer = null;
      try {
        const latestSettings = this.getSettings();
        const latestConfig = this.getSplitBatteryConfig(index, latestSettings);
        if (!latestConfig.enabled || !latestConfig.safetyModeResendEnabled || !state.currentMode) return;

        // Safety resend is deliberately mode-only. It never changes the active
        // mode, never resets anti-chatter timers and never replays an old power
        // value. It is only a periodic retry of the currently active mode Flow.
        const outputActive = Boolean(latestSettings.controlEnabled) && this.isChargeTestValid(latestSettings);
        const pauseInfo = this.getBatteryCommandPauseInfo(Date.now(), latestSettings);
        if (outputActive && !pauseInfo.active) {
          const triggers = this.splitCommandTriggers[index] || {};
          const modeTrigger = state.currentMode === 'charge' ? triggers.chargeMode : triggers.dischargeMode;
          if (modeTrigger) {
            await modeTrigger.trigger({}, {
              battery: latestConfig.battery,
              mode: state.currentMode,
              safety_resend: true,
            });
            state.lastSafetyModeResendAt = Date.now();
          }
        }
      } catch (err) {
        this.error(`Split battery ${index + 1} safety mode resend failed`, err);
      } finally {
        this.scheduleSplitSafetyModeResend(index);
      }
    }, intervalMs);
  }

  rescheduleSplitSafetyModeResend(index) {
    this.clearSplitSafetyModeResend(index);
    this.scheduleSplitSafetyModeResend(index);
  }

  async setSplitOutputTokens(index, mode, power) {
    const battery = index + 1;
    const chargeToken = this.tokens.get(`splitbattery${battery}chargepower`);
    const dischargeToken = this.tokens.get(`splitbattery${battery}dischargepower`);
    const numericPower = Math.round(Number(power) || 0);
    const chargeValue = mode === 'charge' ? numericPower : 0;
    const dischargeValue = mode === 'discharge' ? numericPower : 0;

    // Update the persistent Logic tags before the matching Flow trigger fires,
    // so any action card can safely consume the same value as the trigger token.
    if (chargeToken) await chargeToken.setValue(chargeValue);
    if (dischargeToken) await dischargeToken.setValue(dischargeValue);
  }

  getSplitPowerDelayMs() {
    return 1000;
  }

  async waitSplitPowerDelay() {
    const delay = Math.max(0, Number(this.getSplitPowerDelayMs()) || 0);
    if (delay <= 0) return;
    await new Promise(resolve => this.homey.setTimeout(resolve, delay));
  }

  async publishSplitBatteryCommands(internalCommands, settings = this.getSettings(), options = {}) {
    this.ensureSplitCommandState();
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const now = Date.now();
    const effectiveInternalCommands = internalCommands.slice(0, count);
    const publishJobs = [];

    for (let index = 0; index < count; index += 1) {
      const config = this.getSplitBatteryConfig(index, settings);
      if (!config.enabled) continue;
      const state = this.splitCommandState[index];
      const triggers = this.splitCommandTriggers[index] || {};
      const requestedInternal = Math.round(Number(internalCommands[index]) || 0);
      const desiredMode = this.getSplitDesiredMode(requestedInternal, config);
      let outputMode = desiredMode;
      let outputInternal = requestedInternal;

      if (state.currentMode === desiredMode) {
        this.clearSplitPendingDirection(index);
      } else if (state.currentMode && state.currentMode !== desiredMode && !options.bypassSwitchLock) {
        const switchAt = this.getSplitConfirmedSwitchAt(index, desiredMode, config, now);
        if (now < switchAt) {
          outputMode = state.currentMode;
          outputInternal = 0;
          this.scheduleSplitCommandRecheck(index, switchAt);
        }
      }

      const power = this.getSplitPowerValue(outputMode, outputInternal, config);
      // Split Command can deliberately turn an internal 0 W or a value below
      // its configured minimum into a real non-zero hardware command. Feed the
      // actual output back into HomeFlux in the controller's internal sign
      // convention, so Peak Guard, live status and Savings all see what the
      // battery is really being asked to do.
      effectiveInternalCommands[index] = outputMode === 'charge'
        ? -Math.abs(Number(power) || 0)
        : Math.abs(Number(power) || 0);
      const powerTrigger = outputMode === 'charge' ? triggers.chargePower : triggers.dischargePower;
      const modeNeedsSwitch = !state.currentMode || state.currentMode !== outputMode;

      if (modeNeedsSwitch) {
        // A real mode command is itself the latest successful refresh point.
        // Restart the optional safety interval from this transition, so the
        // safety resend never fires a few seconds after a fresh mode switch.
        this.clearSplitSafetyModeResend(index);
        const modeTrigger = outputMode === 'charge' ? triggers.chargeMode : triggers.dischargeMode;
        publishJobs.push((async () => {
          if (modeTrigger) await modeTrigger.trigger({}, { battery: config.battery, mode: outputMode });

          // Start the anti-chatter timer only after the mode Flow has actually
          // been triggered. The matching power Flow is then delayed by a fixed
          // one second from this exact handover point.
          const switchedAt = Date.now();
          state.currentMode = outputMode;
          state.lastModeSwitchAt = switchedAt;
          this.clearSplitPendingDirection(index);
          if (outputMode === 'charge') state.chargeHoldUntil = switchedAt + (config.chargeMinSwitchSeconds * 1000);
          else state.dischargeHoldUntil = switchedAt + (config.dischargeMinSwitchSeconds * 1000);

          await this.waitSplitPowerDelay();
          await this.setSplitOutputTokens(index, outputMode, power);
          if (powerTrigger) await powerTrigger.trigger({ power }, { battery: config.battery, mode: outputMode });
          state.lastPower = power;
          this.scheduleSplitSafetyModeResend(index);
        })());
      } else {
        publishJobs.push((async () => {
          await this.setSplitOutputTokens(index, outputMode, power);
          if (powerTrigger) await powerTrigger.trigger({ power }, { battery: config.battery, mode: outputMode });
          state.lastPower = power;
          this.scheduleSplitSafetyModeResend(index);
        })());
      }
    }

    await Promise.all(publishJobs);
    return effectiveInternalCommands;
  }

  async invalidateChargeTest() {
    this.chargeTestAwaitingConfirmation = false;
    if (Boolean(this.homey.settings.get('chargeTestPassed'))) this.setSetting('chargeTestPassed', false);
    if (String(this.homey.settings.get('_chargeTestSignature') || '')) this.setSetting('_chargeTestSignature', '');
    if (Boolean(this.homey.settings.get('controlEnabled'))) this.setSetting('controlEnabled', false);
  }

  async publishChargeTestCommands(internalCommands, statusText) {
    if (this.commandPublishing) throw new Error('Er wordt momenteel al een batterijcommando gepubliceerd.');
    const settings = this.getSettings();
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const internal = Array.from({ length: count }, (_, index) => Math.round(Number(internalCommands[index]) || 0));
    const commands = internal.map(value => this.toPublishedCommand(value, settings));
    const total = commands.reduce((sum, value) => sum + value, 0);

    this.commandPublishing = true;
    let firstError = null;
    try {
      // Best effort every output even when one Homey token write fails. This is
      // especially important for the automatic 0 W at the end of the test.
      for (let i = 1; i <= count; i += 1) {
        const token = this.tokens.get(`battery${i}command`);
        if (!token) continue;
        try {
          await token.setValue(commands[i - 1] || 0);
        } catch (err) {
          firstError = firstError || err;
          this.error(`Laadtest token batterij ${i} kon niet worden bijgewerkt`, err);
        }
      }
      const totalToken = this.tokens.get('emstotalcommand');
      if (totalToken) {
        try {
          await totalToken.setValue(total);
        } catch (err) {
          firstError = firstError || err;
          this.error('Laadtest totaal-token kon niet worden bijgewerkt', err);
        }
      }

      const triggerTokens = {
        battery_count: count,
        total_command: total,
        mode: 'Laadtest',
        override: '',
        status: statusText,
        next_change: '',
      };
      for (let i = 1; i <= 8; i += 1) triggerTokens[`battery${i}command`] = commands[i - 1] || 0;
      try {
        await this.commandTrigger.trigger(triggerTokens, { mode: 'charge_test', override: '' });
      } catch (err) {
        firstError = firstError || err;
        this.error('Laadtest Flow-trigger kon niet worden gepubliceerd', err);
      }
      try {
        await this.publishSplitBatteryCommands(internal, settings, { bypassSwitchLock: true });
      } catch (err) {
        firstError = firstError || err;
        this.error('Laadtest split-command Flow-trigger kon niet worden gepubliceerd', err);
      }
    } finally {
      this.commandPublishing = false;
    }

    if (firstError) throw firstError;
    return { commands, total };
  }

  async startChargeTest() {
    const settings = this.getSettings();
    if (Boolean(settings.controlEnabled)) {
      // Defensive self-heal for upgrades from versions that could leave the
      // stored switch ON while the charge-test signature had already become
      // invalid. Effective output is already blocked in that state, so make
      // the persisted value match reality and allow the required retest.
      if (!this.isChargeTestValid(settings)) {
        this.setSetting('controlEnabled', false);
        settings.controlEnabled = false;
      } else {
        throw new Error('Schakel EMS-uitvoer eerst uit voordat je de laadtest start.');
      }
    }
    if (this.chargeTestRunning) throw new Error('De laadtest is al actief.');
    if (this.commandPublishing) throw new Error('Er wordt momenteel al een batterijcommando gepubliceerd. Probeer opnieuw zodra dat klaar is.');

    await this.invalidateChargeTest();
    this.pendingResult = null;
    this.pendingCommandBypassInterval = false;
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    if (this.controlTimer) {
      clearTimeout(this.controlTimer);
      this.controlTimer = null;
    }
    if (this.chargeTestTimer) {
      clearTimeout(this.chargeTestTimer);
      this.chargeTestTimer = null;
    }

    await this.syncTokens();
    const current = this.getSettings();
    const count = Math.max(1, Math.min(8, Math.round(Number(current.batteryCount) || 1)));
    const testInternalCommands = Array(count).fill(-100); // Internal convention: negative = charge.
    this.chargeTestRunning = true;
    this.chargeTestAwaitingConfirmation = false;
    this.chargeTestLastRunAt = Date.now();
    this.chargeTestSignatureAtRun = this.getChargeTestSignature(current);
    let published;
    try {
      published = await this.publishChargeTestCommands(testInternalCommands, 'Laadtest · 100 W laden per batterij');
    } catch (err) {
      // If the start publication is only partially successful, immediately make
      // a best-effort attempt to put every output back at 0 W.
      try { await this.publishChargeTestCommands(Array(count).fill(0), 'Laadtest afgebroken · 0 W'); } catch (_) {}
      this.chargeTestRunning = false;
      this.chargeTestAwaitingConfirmation = false;
      throw err;
    }

    this.chargeTestTimer = this.homey.setTimeout(async () => {
      this.chargeTestTimer = null;
      try {
        await this.publishChargeTestCommands(Array(count).fill(0), 'Laadtest beëindigd · controleer of alle batterijen laadden');
        this.chargeTestRunning = false;
        this.chargeTestAwaitingConfirmation = this.chargeTestSignatureAtRun === this.getChargeTestSignature(this.getSettings());
      } catch (err) {
        this.chargeTestRunning = false;
        this.chargeTestAwaitingConfirmation = false;
        this.error('Laadtest kon niet veilig naar 0 W terugkeren', err);
      }
    }, 10000);

    return {
      ok: true,
      running: true,
      durationSeconds: 10,
      batteryCount: count,
      commandPerBatteryW: published.commands[0] || 0,
      inverted: Boolean(current.invertBatteryCommand),
    };
  }

  async confirmChargeTest() {
    if (this.chargeTestRunning) throw new Error('De laadtest is nog actief. Wacht tot de test automatisch op 0 W is teruggezet.');
    if (!this.chargeTestAwaitingConfirmation) throw new Error('Voer eerst de laadtest uit voordat je ze als geslaagd bevestigt.');
    const settings = this.getSettings();
    const currentSignature = this.getChargeTestSignature(settings);
    if (!this.chargeTestSignatureAtRun || this.chargeTestSignatureAtRun !== currentSignature) {
      this.chargeTestAwaitingConfirmation = false;
      throw new Error('De batterijconfiguratie of tekenrichting wijzigde sinds de laadtest. Voer de test opnieuw uit.');
    }
    this.setSetting('_chargeTestSignature', currentSignature);
    this.setSetting('chargeTestPassed', true);
    this.chargeTestAwaitingConfirmation = false;
    return { ok: true, passed: true };
  }

  normalizeForcedMode(mode) {
    const allowed = new Set([
      'auto',
      'self_consumption',
      'solar_capture',
      'avoid_import',
      'manual_charge',
      'standby',
    ]);
    const value = String(mode || 'auto');
    return allowed.has(value) ? value : 'auto';
  }

  async setForcedMode(mode, source = 'app') {
    const normalized = this.normalizeForcedMode(mode);
    // Clear this synchronously as well as in the settings event. A P1 update may
    // arrive before Homey dispatches that event, and must never reuse the EV
    // headroom allocation from the previous battery mode.
    this.evBatteryCoordinationCache = { maxChargeW: null, at: 0 };
    this.setSetting('forcedMode', normalized);
    if (normalized === 'auto') {
      this.setSetting('forcedModeResumeAt', 0);
      this.clearOverrideResumeTimer();
    } else {
      this.armOverrideResume();
    }
    this.requestContextEvaluate(true, `forced_mode:${source}`);
    await this.syncEmsDevices().catch(err => this.error(`EMS device sync after ${source} mode change failed`, err));
    return normalized;
  }

  getBatteryCommandDeviceStatus() {
    const total = Math.round(Number(this.state.lastTotalCommandW) || 0);
    if (total < 0) return `Laden ${Math.abs(total)} W`;
    if (total > 0) return `Ontladen ${total} W`;
    return 'Rust · 0 W';
  }

  getCompactChargePlanDeviceStatus() {
    let plan;
    try {
      plan = this.getPlanningStatus();
    } catch (err) {
      return this.lastChargePlanText ? String(this.lastChargePlanText) : 'Wachten op planning';
    }
    if (!plan || plan.currentSoc === null || plan.currentSoc === undefined) return 'Wachten op batterij-SoC';

    const target = Number(plan.targetSoc);
    const targetText = Number.isFinite(target) ? `${target.toFixed(1).replace('.0', '')}%` : '';
    const energyNeed = Number(plan.energyNeedKwh) || 0;
    if (!(energyNeed > 0.001)) return targetText ? `Geen netladen · doel ${targetText}` : 'Geen netladen gepland';

    const rows = Array.isArray(plan.rows) ? plan.rows.filter(row => row && row.plannedNetCharge) : [];
    if (!rows.length) {
      if (plan.dynamicPriceReady === false) return 'Laden nodig · geen prijsdata';
      return 'Laden nodig · geen laadvenster';
    }

    const now = Date.now();
    const row = rows.find(item => Number(item.endAt) > now) || rows[0];
    const start = this.formatPlanningTime(row.startAt);
    const end = this.formatPlanningTime(row.endAt);
    const power = Math.max(0, Math.round(Number(row.plannedChargeW) || 0));
    const parts = [`${start}–${end}`];
    if (power > 0) parts.push(`${power} W`);
    if (targetText) parts.push(`doel ${targetText}`);
    return parts.join(' · ');
  }

  getWidgetNextChargeStatus(now = Date.now()) {
    const plan = this.planningCache?.value?.plan || null;
    if (!plan || plan.currentSoc === null || plan.currentSoc === undefined) {
      return { state: 'waiting', startAt: 0, endAt: 0, powerW: 0, targetSoc: null };
    }

    const targetSoc = Number.isFinite(Number(plan.targetSoc)) ? Number(plan.targetSoc) : null;
    const energyNeed = Number(plan.energyNeedKwh) || 0;
    if (!(energyNeed > 0.001)) {
      return { state: 'not_needed', startAt: 0, endAt: 0, powerW: 0, targetSoc };
    }

    const rows = Array.isArray(plan.rows)
      ? plan.rows.filter(row => row && row.plannedNetCharge && Number(row.endAt) > Number(now))
      : [];
    if (!rows.length) {
      return {
        state: plan.dynamicPriceReady === false ? 'no_price_data' : 'no_window',
        startAt: 0, endAt: 0, powerW: 0, targetSoc,
      };
    }

    const row = rows[0];
    const startAt = Number(row.startAt) || 0;
    const endAt = Number(row.endAt) || 0;
    return {
      state: startAt > 0 && Number(now) >= startAt && Number(now) < endAt ? 'active' : 'planned',
      startAt,
      endAt,
      powerW: Math.max(0, Math.round(Number(row.plannedChargeW) || 0)),
      targetSoc,
    };
  }

  getWidgetPlanningSummary(now = Date.now()) {
    const plan = this.planningCache?.value?.plan || null;
    if (!plan || plan.currentSoc === null || plan.currentSoc === undefined) {
      return {
        ready: false,
        phase: '',
        forecastSource: 'none',
        forecastKwh: null,
        energyNeedKwh: null,
        gridPlannedKwh: null,
        targetAt: 0,
      };
    }

    const rows = Array.isArray(plan.rows) ? plan.rows : [];
    const gridPlannedKwh = rows
      .filter(row => row && row.plannedNetCharge && Number(row.endAt) > Number(now))
      .reduce((sum, row) => sum + Math.max(0, Number(row.plannedEnergyKwh) || 0), 0);
    const forecastRaw = plan.forecastUsedKwh ?? plan.forecastKwh;
    const forecastKwh = Number.isFinite(Number(forecastRaw)) ? Math.max(0, Number(forecastRaw)) : null;
    const energyNeedRaw = plan.energyNeedKwh;
    const energyNeedKwh = Number.isFinite(Number(energyNeedRaw)) ? Math.max(0, Number(energyNeedRaw)) : null;

    return {
      ready: true,
      phase: String(plan.planningPhase || (plan.forecastDay === 'tomorrow' ? 'night' : 'day')),
      forecastSource: String(plan.forecastUsedSource || (plan.forecastDay === 'tomorrow' ? 'tomorrow' : 'today_remaining')),
      forecastKwh: forecastKwh === null ? null : Math.round(forecastKwh * 100) / 100,
      energyNeedKwh: energyNeedKwh === null ? null : Math.round(energyNeedKwh * 100) / 100,
      gridPlannedKwh: Math.round(gridPlannedKwh * 100) / 100,
      targetAt: Number(plan.planningPeakStartAt) || Number(plan.planningChargeDeadlineAt) || 0,
    };
  }

  getEvInstanceDeviceStatus(index, settings = this.getSettings()) {
    const instanceSettings = this.getEvInstanceSettings(index, settings);
    const name = this.getEvInstanceName(index, settings);
    if (!Boolean(instanceSettings.evEnabled)) return `${name}: uit`;
    const input = this.getEvInputSnapshot(index);
    const decision = index === 0 ? this.latestEvDecision : this.getExtraEv(index)?.latestDecision;
    const mode = this.getEffectiveEvModeFor(index, settings);
    const override = this.getEvSessionOverrideFor(index);
    const modeLabel = `${mode === 'emergency' ? 'Emergency' : mode === 'soc_target' ? 'SoC' : 'Slim'}${override?.mode ? ' · Flow override' : ''}`;
    if (!Boolean(input?.seen?.connected)) return `${name}: ${modeLabel} · wacht op EV`;
    if (!Boolean(input?.connected)) return `${name}: ${modeLabel} · niet verbonden`;
    const runtime = index === 0 ? null : this.getExtraEv(index);
    const desiredA = Math.max(0, Math.round(Number(decision?.desiredCurrentA) || 0));
    const actualA = input?.seen?.chargeCurrent ? Math.max(0, Math.round(Number(input.chargeCurrentA) || 0)) : 0;
    const outputA = index === 0 ? Number(this.lastPublishedEvCurrentA || 0) : Number(runtime?.lastPublishedCurrentA || 0);
    const currentA = desiredA > 0 ? desiredA : outputA > 0 ? outputA : actualA;
    if (currentA > 0 && (Boolean(decision?.allowed) || actualA > 0)) return `${name}: ${modeLabel} · ${currentA} A`;
    return `${name}: ${modeLabel} · wacht`;
  }

  getEvDeviceStatus(settings = this.getSettings()) {
    const count = this.getEvCount(settings);
    const enabled = [];
    for (let index = 0; index < count; index += 1) {
      if (Boolean(this.getEvInstanceSettings(index, settings).evEnabled)) enabled.push(index);
    }
    if (!enabled.length) return 'Uit';
    if (enabled.length === 1) return this.getEvInstanceDeviceStatus(enabled[0], settings).replace(/^EV \d+: /, '');
    const active = enabled.filter(index => this.isEvOutputActiveFor(index, settings)).length;
    return `${active}/${enabled.length} actief · ${enabled.map(index => this.getEvInstanceName(index, settings)).join(', ')}`;
  }

  getEvOverrideDeviceStatus(settings = this.getSettings()) {
    const language = String(this.homey?.i18n?.getLanguage?.() || 'nl').toLowerCase();
    const isNl = language.startsWith('nl');
    const active = [];
    for (let index = 0; index < this.getEvCount(settings); index += 1) {
      const override = this.getEvSessionOverrideFor(index);
      if (!override?.mode) continue;
      const mode = this.normalizeEvOperatingMode(override.mode);
      const modeLabel = mode === 'emergency' ? 'Emergency' : mode === 'soc_target' ? (isNl ? 'SoC-doel' : 'SoC target') : (isNl ? 'Slim' : 'Smart');
      const phase = override.sessionStarted ? (isNl ? 'actief' : 'active') : (isNl ? 'wacht op EV' : 'waiting for EV');
      active.push(`${this.getEvInstanceName(index, settings)}: ${modeLabel} · ${phase}`);
    }
    if (active.length === 1 && this.getEvCount(settings) === 1) return active[0].replace(/^EV 1: /, '');
    return active.length ? active.join(' | ') : (isNl ? 'Geen' : 'None');
  }

  getHvacInstanceDeviceStatus(index, settings = this.getSettings()) {
    const instanceSettings = this.getHvacInstanceSettings(index, settings);
    const name = this.getHvacInstanceName(index, settings);
    if (!Boolean(instanceSettings.hvacEnabled)) return `${name}: uit`;
    const input = this.getHvacInputSnapshot(index);
    const runtime = index === 0 ? null : this.getExtraHvac(index);
    const decision = index === 0 ? this.latestHvacDecision : runtime?.latestDecision;
    const rawMode = String(decision?.modeCommand || input?.mode || (index === 0 ? this.lastPublishedHvacMode : runtime?.lastPublishedMode) || '');
    const modeLabels = { cool: 'Koelen', heat: 'Verwarmen', auto: 'Auto', fan: 'Ventileren', dry: 'Ontvochtigen', off: 'Uit' };
    const modeLabel = modeLabels[rawMode.toLowerCase()] || (rawMode || 'Wachten op data');
    const commanded = decision?.setpointCommand !== null && decision?.setpointCommand !== undefined ? Number(decision.setpointCommand) : NaN;
    const currentRaw = input?.setpointC;
    const publishedRaw = index === 0 ? this.lastPublishedHvacSetpoint : runtime?.lastPublishedSetpoint;
    const current = currentRaw === null || currentRaw === undefined ? NaN : Number(currentRaw);
    const published = publishedRaw === null || publishedRaw === undefined ? NaN : Number(publishedRaw);
    const setpoint = Number.isFinite(commanded) ? commanded : Number.isFinite(current) ? current : Number.isFinite(published) ? published : null;
    const boost = Boolean(decision?.boostActive || (index === 0 ? this.hvacBaselineSetpoint !== null : runtime?.baselineSetpoint !== null));
    const boostLabel = decision?.energySource === 'battery' ? 'Batterij-boost' : 'PV-boost';
    return `${name}: ${boost ? `${boostLabel} · ` : ''}${modeLabel}${setpoint !== null ? ` · ${setpoint.toFixed(1).replace('.0', '')} °C` : ''}`;
  }

  getHvacDeviceStatus(settings = this.getSettings()) {
    const count = this.getHvacCount(settings);
    const enabled = [];
    for (let index = 0; index < count; index += 1) {
      if (Boolean(this.getHvacInstanceSettings(index, settings).hvacEnabled)) enabled.push(index);
    }
    if (!enabled.length) return 'Uit';
    if (enabled.length === 1) return this.getHvacInstanceDeviceStatus(enabled[0], settings).replace(/^HVAC \d+: /, '');
    const active = enabled.filter(index => this.isHvacManagedActiveFor(index)).length;
    return `${active}/${enabled.length} actief · ${enabled.map(index => this.getHvacInstanceName(index, settings)).join(', ')}`;
  }

  getEmsDeviceSnapshot(result = this.latestResult) {
    const settings = this.getSettings();
    const readiness = this.getInputReadiness(settings);
    const forcedMode = this.normalizeForcedMode(settings.forcedMode);
    const tariff = result?.tariff?.label || 'Geen tarief';
    const action = result?.workingModeLabel || result?.modeLabel || 'Wachten op data';
    const status = result?.statusText || (readiness.ready ? 'HomeFlux EMS gereed' : `Wachten op data: ${readiness.missing.join(', ')}`);
    return {
      mode: forcedMode,
      status: String(status),
      tariff: String(tariff),
      action: String(action),
      batteryCommand: this.getBatteryCommandDeviceStatus(),
      chargePlan: this.getCompactChargePlanDeviceStatus(),
      evStatus: this.getEvDeviceStatus(settings),
      evOverride: this.getEvOverrideDeviceStatus(settings),
      hvacStatus: this.getHvacDeviceStatus(settings),
      savingsToday: Number(this.savings ? totalSavings(this.savings.today) : 0) || 0,
      savingsTotal: Number(this.savings?.total) || 0,
      overrideActive: forcedMode !== 'auto',
      inputAlarm: !readiness.ready,
      balanceAlarm: Boolean(this.balanceMonitor?.warningActive),
    };
  }

  async syncEmsDevices(result = this.latestResult) {
    if (!this.emsDevices || this.emsDevices.size === 0) return;
    const snapshot = this.getEmsDeviceSnapshot(result);
    await Promise.all([...this.emsDevices].map(async device => {
      try {
        await device.syncFromApp(snapshot);
      } catch (err) {
        this.error('Could not sync HomeFlux EMS device', err);
      }
    }));
  }

  registerFlowCards() {
    this.commandTrigger = this.homey.flow.getTriggerCard('battery_commands_updated');
    this.calculatedSetpointTrigger = this.homey.flow.getTriggerCard('battery_setpoint_calculated');
    this.balanceWarningTrigger = this.homey.flow.getTriggerCard('battery_balance_warning');
    this.statusChangedTrigger = this.homey.flow.getTriggerCard('ems_status_changed');
    this.pvLimitTrigger = this.homey.flow.getTriggerCard('pv_power_limit_updated');
    this.chargePlanTrigger = this.homey.flow.getTriggerCard('charge_plan_updated');
    this.evCurrentTrigger = this.homey.flow.getTriggerCard('ev1_charge_current_updated');
    this.evAllowedTrigger = this.homey.flow.getTriggerCard('ev1_charging_allowed_updated');
    this.evModeTrigger = this.homey.flow.getTriggerCard('ev1_charge_mode_updated');
    this.hvacPowerTrigger = this.homey.flow.getTriggerCard('hvac1_power_updated');
    this.hvacModeTrigger = this.homey.flow.getTriggerCard('hvac1_mode_updated');
    this.hvacSetpointTrigger = this.homey.flow.getTriggerCard('hvac1_setpoint_updated');
    this.hvacFanTrigger = this.homey.flow.getTriggerCard('hvac1_fan_updated');
    this.boilerTrigger = this.homey.flow.getTriggerCard('boiler_power_updated');
    this.boilerWarmedTrigger = this.homey.flow.getTriggerCard('boiler_warmed_updated');
    this.extraEvTriggers = Array.from({ length: 3 }, (_, offset) => {
      const instance = offset + 2;
      return {
        current: this.homey.flow.getTriggerCard(`ev${instance}_charge_current_updated`),
        allowed: this.homey.flow.getTriggerCard(`ev${instance}_charging_allowed_updated`),
        mode: this.homey.flow.getTriggerCard(`ev${instance}_charge_mode_updated`),
        requestSoc: this.homey.flow.getTriggerCard(`request_ev${instance}_soc_needed`),
      };
    });
    this.extraHvacTriggers = Array.from({ length: 3 }, (_, offset) => {
      const instance = offset + 2;
      return {
        power: this.homey.flow.getTriggerCard(`hvac${instance}_power_updated`),
        mode: this.homey.flow.getTriggerCard(`hvac${instance}_mode_updated`),
        setpoint: this.homey.flow.getTriggerCard(`hvac${instance}_setpoint_updated`),
        fan: this.homey.flow.getTriggerCard(`hvac${instance}_fan_updated`),
      };
    });
    this.splitCommandTriggers = Array.from({ length: 8 }, (_, index) => {
      const battery = index + 1;
      return {
        chargeMode: this.homey.flow.getTriggerCard(`split_command_battery${battery}_charge_mode`),
        dischargeMode: this.homey.flow.getTriggerCard(`split_command_battery${battery}_discharge_mode`),
        chargePower: this.homey.flow.getTriggerCard(`split_command_battery${battery}_charge_power`),
        dischargePower: this.homey.flow.getTriggerCard(`split_command_battery${battery}_discharge_power`),
      };
    });
    this.inputRequestTriggers = {
      pv: this.homey.flow.getTriggerCard('request_pv_power_needed'),
      forecast: this.homey.flow.getTriggerCard('request_forecast_needed'),
      forecastTomorrow: this.homey.flow.getTriggerCard('request_forecast_tomorrow_needed'),
      evSoc: this.homey.flow.getTriggerCard('request_ev1_soc_needed'),
      batterySoc: Array.from({ length: 8 }, (_, index) =>
        this.homey.flow.getTriggerCard(`request_battery${index + 1}_soc_needed`)),
    };

    this.homey.flow.getActionCard('set_grid_power').registerRunListener(async args => {
      const value = Number(args.power);
      if (!Number.isFinite(value)) return false;
      const inputSettings = this.getSettings();
      const wasGridReady = this.getInputReadiness(inputSettings).ready;
      const now = Date.now();
      this.recordSavingsSample(now);
      this.state.gridPowerW = value;
      this.inputSeen.grid = true;
      this.inputUpdatedAt.grid = now;
      this.recordGridSample(value, now);
      this.checkFlexibleSafetyFromGrid(now, inputSettings);
      const contextGridDelta = this.lastContextGridInputW === null ? Infinity : Math.abs(value - this.lastContextGridInputW);
      if (this.needsSlowMeterContext(inputSettings)
        && (contextGridDelta >= 100 || this.hasActiveFlexibleOutput(inputSettings))) {
        this.lastContextGridInputW = value;
        this.requestContextEvaluate(false, 'grid_context');
      }
      if (!wasGridReady && Boolean(inputSettings.controlEnabled)) {
        this.requestContextEvaluate(true, 'grid_recovered');
      } else {
        this.requestEvaluate();
      }
      return true;
    });

    this.homey.flow.getActionCard('set_imported_energy_today').registerRunListener(async args => {
      const value = Number(args.energy);
      if (!Number.isFinite(value) || value < 0) return false;
      const now = Date.now();
      this.recordSavingsSample(now);
      const todayKey = this.getSavingsDateKey(now);
      if (!this.savings.today?.date) this.savings.today = emptyDay(todayKey);
      if (this.savings.today.date !== todayKey) this.archiveSavingsDay(todayKey);
      this.savings.today.importedEnergyKwh = value;
      this.savings.today.importedEnergyKnown = true;
      return true;
    });

    this.homey.flow.getActionCard('set_pv_power').registerRunListener(async args => {
      const value = Number(args.power);
      if (!Number.isFinite(value)) return false;
      const now = Date.now();
      this.recordSavingsSample(now);
      this.state.pvPowerW = Math.max(0, value);
      this.inputSeen.pv = true;
      this.inputUpdatedAt.pv = now;
      this.updatePvPlanningState(this.state.pvPowerW, now);
      this.requestEvaluate();
      const contextPvDelta = this.lastContextPvInputW === null ? Infinity : Math.abs(this.state.pvPowerW - this.lastContextPvInputW);
      const pvSettings = this.getSettings();
      if (this.needsSlowMeterContext(pvSettings) && contextPvDelta >= 100) {
        this.lastContextPvInputW = this.state.pvPowerW;
        this.requestContextEvaluate(false, 'pv_context');
      }
      return true;
    });

    this.homey.flow.getActionCard('set_battery_soc').registerRunListener(async args => {
      const index = Math.max(1, Math.min(8, Number(args.battery))) - 1;
      const value = Number(args.soc);
      if (!Number.isFinite(value)) return false;
      const normalized = Math.max(0, Math.min(100, value));
      const changed = this.hasNumericInputChanged(
        this.state.batterySoc[index], normalized, Boolean(this.inputSeen.batterySoc[index]), 0.01,
      );
      this.state.batterySoc[index] = normalized;
      this.inputSeen.batterySoc[index] = true;
      this.inputUpdatedAt.batterySoc[index] = Date.now();
      if (!changed) return true;
      this.invalidatePlanningCache();
      this.requestEvaluate(true);
      this.requestContextEvaluate(false, `battery${index + 1}_soc`);
      if (this.isNightPlanningPhase()) this.publishChargePlanIfChanged().catch(err => this.error('Charge plan update after SoC failed', err));
      return true;
    });

    this.homey.flow.getActionCard('set_forecast_remaining').registerRunListener(async args => {
      const value = Number(args.energy);
      if (!Number.isFinite(value)) return false;
      if (!this.updateForecastInput(value)) return true;
      this.invalidatePlanningCache();
      this.requestContextEvaluate(false, 'forecast_remaining');
      if (this.isNightPlanningPhase()) this.publishChargePlanIfChanged().catch(err => this.error('Charge plan update after current forecast failed', err));
      return true;
    });

    this.homey.flow.getActionCard('set_forecast_tomorrow').registerRunListener(async args => {
      const value = Number(args.energy);
      if (!Number.isFinite(value)) return false;
      if (!this.updateForecastTomorrowInput(value)) return true;
      this.invalidatePlanningCache();
      this.requestContextEvaluate(false, 'forecast_tomorrow');
      if (this.isNightPlanningPhase()) this.publishChargePlanIfChanged().catch(err => this.error('Charge plan update after tomorrow forecast failed', err));
      return true;
    });

    this.homey.flow.getActionCard('set_ev1_status').registerRunListener(async args => {
      if (this.getEvCount() < 1) return true;
      const current = Number(args.charge_current);
      if (!Number.isFinite(current)) return false;
      const now = Date.now();
      const nextConnected = String(args.connected || 'no') === 'yes';
      const wasConnected = Boolean(this.inputSeen.ev?.connected) && Boolean(this.state.evConnected);
      const connectionChanged = this.hasBooleanInputChanged(
        this.state.evConnected, nextConnected, Boolean(this.inputSeen.ev?.connected),
      );
      const normalizedCurrent = Math.max(0, current);
      const currentChanged = this.hasNumericInputChanged(
        this.state.evChargeCurrentA, normalizedCurrent, Boolean(this.inputSeen.ev?.chargeCurrent), 0.05,
      );
      this.state.evConnected = nextConnected;
      this.state.evChargeCurrentA = normalizedCurrent;
      this.inputSeen.ev.connected = true;
      this.inputSeen.ev.chargeCurrent = true;
      this.inputUpdatedAt.ev.connected = now;
      this.inputUpdatedAt.ev.chargeCurrent = now;
      if (connectionChanged) this.handleEvSessionConnectionTransition(wasConnected, nextConnected);
      if (connectionChanged || currentChanged) this.requestContextEvaluate(connectionChanged, 'ev1_status');
      return true;
    });

    this.homey.flow.getActionCard('set_ev1_session_override').registerRunListener(async args => {
      if (this.getEvCount() < 1) return true;
      this.setEvSessionOverride(args.mode, 'flow');
      return true;
    });

    this.homey.flow.getActionCard('set_ev1_soc').registerRunListener(async args => {
      if (this.getEvCount() < 1) return true;
      const soc = Number(args.soc);
      if (!Number.isFinite(soc)) return false;
      if (!Boolean(this.getSettings().evSocEnabled)) return true;
      const normalized = Math.max(0, Math.min(100, soc));
      const changed = this.hasNumericInputChanged(this.state.evSoc, normalized, Boolean(this.inputSeen.ev?.soc), 0.01);
      this.state.evSoc = normalized;
      this.inputSeen.ev.soc = true;
      this.inputUpdatedAt.ev.soc = Date.now();
      if (changed) this.requestContextEvaluate(false, 'ev1_soc');
      return true;
    });

    this.homey.flow.getActionCard('set_hvac1_room_temperature').registerRunListener(async args => {
      if (this.getHvacCount() < 1) return true;
      const value = Number(args.temperature);
      if (!Number.isFinite(value)) return false;
      const changed = this.hasNumericInputChanged(
        this.state.hvacRoomTemperatureC, value, Boolean(this.inputSeen.hvac?.roomTemperature), 0.05,
      );
      this.state.hvacRoomTemperatureC = value;
      this.inputSeen.hvac.roomTemperature = true;
      this.inputUpdatedAt.hvac.roomTemperature = Date.now();
      if (changed) this.requestContextEvaluate(false, 'hvac1_room');
      return true;
    });

    this.homey.flow.getActionCard('set_hvac_outdoor_temperature').registerRunListener(async args => {
      if (this.getHvacCount() < 1) return true;
      const value = Number(args.temperature);
      if (!Number.isFinite(value)) return false;
      const now = Date.now();
      const changed = this.hasNumericInputChanged(
        this.state.hvacOutdoorTemperatureC, value, Boolean(this.inputSeen.hvac?.outdoorTemperature), 0.05,
      );
      // Outdoor temperature is a single shared HVAC input. Every configured
      // HVAC uses the same climate value for fan-speed decisions.
      this.state.hvacOutdoorTemperatureC = value;
      this.inputSeen.hvac.outdoorTemperature = true;
      this.inputUpdatedAt.hvac.outdoorTemperature = now;
      if (changed) this.requestContextEvaluate(false, 'hvac_outdoor');
      return true;
    });

    this.homey.flow.getActionCard('set_hvac1_mode').registerRunListener(async args => {
      if (this.getHvacCount() < 1) return true;
      const nextMode = String(args.mode || 'off');
      const changed = this.hasTextInputChanged(this.state.hvacMode, nextMode, Boolean(this.inputSeen.hvac?.mode));
      this.state.hvacMode = nextMode;
      this.inputSeen.hvac.mode = true;
      this.inputUpdatedAt.hvac.mode = Date.now();
      if (changed) this.requestContextEvaluate(false, 'hvac1_mode');
      return true;
    });

    this.homey.flow.getActionCard('set_hvac1_setpoint').registerRunListener(async args => {
      if (this.getHvacCount() < 1) return true;
      const value = Number(args.setpoint);
      if (!Number.isFinite(value)) return false;
      const changed = this.hasNumericInputChanged(
        this.state.hvacSetpointC, value, Boolean(this.inputSeen.hvac?.setpoint), 0.05,
      );
      this.state.hvacSetpointC = value;
      this.inputSeen.hvac.setpoint = true;
      this.inputUpdatedAt.hvac.setpoint = Date.now();
      // Once the physical device confirms the commanded setpoint, use that as
      // the new effective value for the next 0.5 C step.
      if (Number.isFinite(Number(this.lastPublishedHvacSetpoint))
        && Math.abs(value - Number(this.lastPublishedHvacSetpoint)) < 0.11) {
        this.lastPublishedHvacSetpoint = value;
      }
      if (changed) this.requestContextEvaluate(false, 'hvac1_setpoint');
      return true;
    });

    this.homey.flow.getActionCard('set_hvac1_fan_speed').registerRunListener(async args => {
      if (this.getHvacCount() < 1) return true;
      const value = Number(args.speed);
      if (!Number.isFinite(value)) return false;
      const normalized = Math.max(0, value);
      const changed = this.hasNumericInputChanged(
        this.state.hvacFanSpeed, normalized, Boolean(this.inputSeen.hvac?.fanSpeed), 0.5,
      );
      this.state.hvacFanSpeed = normalized;
      this.inputSeen.hvac.fanSpeed = true;
      this.inputUpdatedAt.hvac.fanSpeed = Date.now();
      if (changed) this.requestContextEvaluate(false, 'hvac1_fan');
      return true;
    });

    this.homey.flow.getActionCard('set_hvac1_automatic_control').registerRunListener(async args => {
      if (this.getHvacCount() < 1) return true;
      const enabled = String(args.enabled || 'yes') === 'yes';
      if ((this.getSettings().hvacAutomaticControlEnabled !== false) === enabled) return true;
      this.setSetting('hvacAutomaticControlEnabled', enabled);
      // The settings 'set' event requests one fresh EMS evaluation only when
      // the value actually changes; no extra timer or polling loop is needed.
      return true;
    });



    // HVAC instance inputs and outputs are uniformly numbered 1-4. Outdoor
    // temperature is the intentional exception: it is one shared HVAC climate
    // input used by every configured HVAC instance. EV 2-4 keep numbered inputs.
    for (let index = 1; index < 4; index += 1) {
      const instance = index + 1;
      this.homey.flow.getActionCard(`set_ev${instance}_status`).registerRunListener(async args => {
        if (index >= this.getEvCount()) return true;
        const runtime = this.getExtraEv(index);
        const current = Number(args.charge_current);
        if (!runtime || !Number.isFinite(current)) return false;
        const now = Date.now();
        const nextConnected = String(args.connected || 'no') === 'yes';
        const wasConnected = Boolean(runtime.seen.connected) && Boolean(runtime.state.connected);
        const connectionChanged = this.hasBooleanInputChanged(runtime.state.connected, nextConnected, Boolean(runtime.seen.connected));
        const normalizedCurrent = Math.max(0, current);
        const currentChanged = this.hasNumericInputChanged(
          runtime.state.chargeCurrentA, normalizedCurrent, Boolean(runtime.seen.chargeCurrent), 0.05,
        );
        runtime.state.connected = nextConnected;
        runtime.state.chargeCurrentA = normalizedCurrent;
        runtime.seen.connected = true;
        runtime.seen.chargeCurrent = true;
        runtime.updatedAt.connected = now;
        runtime.updatedAt.chargeCurrent = now;
        if (connectionChanged) this.handleEvSessionConnectionTransitionFor(index, wasConnected, nextConnected);
        if (connectionChanged || currentChanged) this.requestContextEvaluate(connectionChanged, `ev${instance}_status`);
        return true;
      });

      this.homey.flow.getActionCard(`set_ev${instance}_session_override`).registerRunListener(async args => {
        if (index >= this.getEvCount()) return true;
        this.setEvSessionOverrideFor(index, args.mode, 'flow');
        return true;
      });

      this.homey.flow.getActionCard(`set_ev${instance}_soc`).registerRunListener(async args => {
        if (index >= this.getEvCount()) return true;
        const runtime = this.getExtraEv(index);
        const soc = Number(args.soc);
        if (!runtime || !Number.isFinite(soc)) return false;
        const instanceSettings = this.getEvInstanceSettings(index);
        if (!Boolean(instanceSettings.evSocEnabled)) return true;
        const normalized = Math.max(0, Math.min(100, soc));
        const changed = this.hasNumericInputChanged(runtime.state.soc, normalized, Boolean(runtime.seen.soc), 0.01);
        runtime.state.soc = normalized;
        runtime.seen.soc = true;
        runtime.updatedAt.soc = Date.now();
        if (changed) this.requestContextEvaluate(false, `ev${instance}_soc`);
        return true;
      });

      this.homey.flow.getActionCard(`set_hvac${instance}_room_temperature`).registerRunListener(async args => {
        if (index >= this.getHvacCount()) return true;
        const runtime = this.getExtraHvac(index);
        const value = Number(args.temperature);
        if (!runtime || !Number.isFinite(value)) return false;
        const changed = this.hasNumericInputChanged(
          runtime.state.roomTemperatureC, value, Boolean(runtime.seen.roomTemperature), 0.05,
        );
        runtime.state.roomTemperatureC = value;
        runtime.seen.roomTemperature = true;
        runtime.updatedAt.roomTemperature = Date.now();
        if (changed) this.requestContextEvaluate(false, `hvac${instance}_room`);
        return true;
      });
      this.homey.flow.getActionCard(`set_hvac${instance}_mode`).registerRunListener(async args => {
        if (index >= this.getHvacCount()) return true;
        const runtime = this.getExtraHvac(index);
        if (!runtime) return false;
        const nextMode = String(args.mode || 'off');
        const changed = this.hasTextInputChanged(runtime.state.mode, nextMode, Boolean(runtime.seen.mode));
        runtime.state.mode = nextMode;
        runtime.seen.mode = true;
        runtime.updatedAt.mode = Date.now();
        if (changed) this.requestContextEvaluate(false, `hvac${instance}_mode`);
        return true;
      });
      this.homey.flow.getActionCard(`set_hvac${instance}_setpoint`).registerRunListener(async args => {
        if (index >= this.getHvacCount()) return true;
        const runtime = this.getExtraHvac(index);
        const value = Number(args.setpoint);
        if (!runtime || !Number.isFinite(value)) return false;
        const changed = this.hasNumericInputChanged(
          runtime.state.setpointC, value, Boolean(runtime.seen.setpoint), 0.05,
        );
        runtime.state.setpointC = value;
        runtime.seen.setpoint = true;
        runtime.updatedAt.setpoint = Date.now();
        if (Number.isFinite(Number(runtime.lastPublishedSetpoint)) && Math.abs(value - Number(runtime.lastPublishedSetpoint)) < 0.11) {
          runtime.lastPublishedSetpoint = value;
        }
        if (changed) this.requestContextEvaluate(false, `hvac${instance}_setpoint`);
        return true;
      });
      this.homey.flow.getActionCard(`set_hvac${instance}_fan_speed`).registerRunListener(async args => {
        if (index >= this.getHvacCount()) return true;
        const runtime = this.getExtraHvac(index);
        const value = Number(args.speed);
        if (!runtime || !Number.isFinite(value)) return false;
        const normalized = Math.max(0, value);
        const changed = this.hasNumericInputChanged(runtime.state.fanSpeed, normalized, Boolean(runtime.seen.fanSpeed), 0.5);
        runtime.state.fanSpeed = normalized;
        runtime.seen.fanSpeed = true;
        runtime.updatedAt.fanSpeed = Date.now();
        if (changed) this.requestContextEvaluate(false, `hvac${instance}_fan`);
        return true;
      });
      this.homey.flow.getActionCard(`set_hvac${instance}_automatic_control`).registerRunListener(async args => {
        if (index >= this.getHvacCount()) return true;
        const enabled = String(args.enabled || 'yes') === 'yes';
        const key = this.getHvacSettingKey(index, 'AutomaticControlEnabled');
        if ((this.getSettings()[key] !== false) === enabled) return true;
        this.setSetting(key, enabled);
        return true;
      });
    }

    this.homey.flow.getActionCard('set_forced_mode').registerRunListener(async args => {
      await this.setForcedMode(String(args.mode || 'auto'), 'flow');
      return true;
    });

    this.homey.flow.getActionCard('get_ems_status').registerRunListener(async () => {
      const result = this.latestResult || await this.runContextEvaluation(true);
      return {
        status: String(result?.statusText || 'Stand-by'),
        tariff: String(result?.tariff?.label || ''),
        action: String(result?.workingModeLabel || result?.actionLabel || result?.modeLabel || 'Rust'),
        next_change: String(result?.nextEventText || ''),
      };
    });

    this.homey.flow.getActionCard('refresh_homey_energy_prices').registerRunListener(async () => {
      await this.refreshHomeyEnergyPrices(true);
      return true;
    });

    this.homey.flow.getActionCard('recalculate_now').registerRunListener(async () => {
      await this.runContextEvaluation(true);
      return true;
    });

    this.homey.flow.getConditionCard('homey_energy_cheapest_now').registerRunListener(async args => {
      await this.ensureHomeyEnergyFresh();
      return currentMatches(this.getEffectiveHomeySlots(this.getSettings()), new Date(), this.homey.clock.getTimezone() || 'UTC', Number(args.hours) || 3, 'cheap');
    });
    this.homey.flow.getConditionCard('homey_energy_expensive_now').registerRunListener(async args => {
      await this.ensureHomeyEnergyFresh();
      return currentMatches(this.getEffectiveHomeySlots(this.getSettings()), new Date(), this.homey.clock.getTimezone() || 'UTC', Number(args.hours) || 3, 'expensive');
    });
    this.homey.flow.getConditionCard('homey_energy_cheapest_block_now').registerRunListener(async args => {
      await this.ensureHomeyEnergyFresh();
      return currentMatches(this.getEffectiveHomeySlots(this.getSettings()), new Date(), this.homey.clock.getTimezone() || 'UTC', Number(args.hours) || 3, 'cheapest_block');
    });
  }

  setupInputRequestSchedule() {
    // These triggers deliberately request source values from user-created Flows.
    // Grid power is excluded: it must be pushed from the user's own "power changed"
    // Flow so the control loop always follows the real meter event stream.
    const safeTrigger = (card, label) => {
      if (!card) return;
      card.trigger().catch(err => this.error(`${label} request trigger failed`, err));
    };

    const requestPv = () => safeTrigger(this.inputRequestTriggers?.pv, 'PV power');
    const requestForecast = () => safeTrigger(this.inputRequestTriggers?.forecast, 'Forecast');
    const requestForecastTomorrow = () => safeTrigger(this.inputRequestTriggers?.forecastTomorrow, 'Forecast tomorrow');
    const requestBatterySoc = () => {
      const count = Math.max(1, Math.min(8, Math.round(Number(this.getSettings().batteryCount) || 1)));
      for (let index = 0; index < count; index += 1) {
        safeTrigger(this.inputRequestTriggers?.batterySoc?.[index], `Battery ${index + 1} SoC`);
      }
    };

    // Initial request shortly after app start so values do not have to change first.
    this.inputRequestInitialTimer = this.homey.setTimeout(() => {
      requestPv();
      requestForecast();
      requestForecastTomorrow();
      requestBatterySoc();
    }, 1000);

    // Keep external source values fresh without polling devices directly from EMS.
    this.inputRequestTimers.push(this.homey.setInterval(requestPv, 15 * 1000));
    this.inputRequestTimers.push(this.homey.setInterval(requestBatterySoc, 3 * 60 * 1000));
    this.inputRequestTimers.push(this.homey.setInterval(() => { requestForecast(); requestForecastTomorrow(); }, 30 * 60 * 1000));
  }

  clearEvSocRequestSchedule() {
    if (this.evSocRequestInitialTimer) {
      clearTimeout(this.evSocRequestInitialTimer);
      this.evSocRequestInitialTimer = null;
    }
    if (this.evSocRequestTimer) {
      clearInterval(this.evSocRequestTimer);
      this.evSocRequestTimer = null;
    }
    for (const timer of this.extraEvSocRequestInitialTimers || []) if (timer) clearTimeout(timer);
    for (const timer of this.extraEvSocRequestTimers || []) if (timer) clearInterval(timer);
    this.extraEvSocRequestInitialTimers = [];
    this.extraEvSocRequestTimers = [];
  }

  syncEvSocRequestSchedule() {
    this.clearEvSocRequestSchedule();
    const stored = this.getSettings();
    const count = this.getEvCount(stored);
    for (let index = 0; index < count; index += 1) {
      const settings = this.getEvInstanceSettings(index, stored);
      if (!Boolean(settings.evEnabled) || !Boolean(settings.evSocEnabled)) continue;
      const card = index === 0 ? this.inputRequestTriggers?.evSoc : this.extraEvTriggers[index - 1]?.requestSoc;
      if (!card) continue;
      const request = () => {
        const currentStored = this.getSettings();
        if (index >= this.getEvCount(currentStored)) return;
        const current = this.getEvInstanceSettings(index, currentStored);
        if (!Boolean(current.evEnabled) || !Boolean(current.evSocEnabled)) return;
        card.trigger().catch(err => this.error(`EV ${index + 1} SoC request trigger failed`, err));
      };
      const initial = this.homey.setTimeout(request, 1000 + (index * 100));
      const timer = this.homey.setInterval(request, 3 * 60 * 1000);
      if (index === 0) {
        this.evSocRequestInitialTimer = initial;
        this.evSocRequestTimer = timer;
      } else {
        this.extraEvSocRequestInitialTimers[index - 1] = initial;
        this.extraEvSocRequestTimers[index - 1] = timer;
      }
    }
  }

  clearInputRequestSchedule() {
    if (this.inputRequestInitialTimer) {
      clearTimeout(this.inputRequestInitialTimer);
      this.inputRequestInitialTimer = null;
    }
    for (const timer of this.inputRequestTimers || []) clearInterval(timer);
    this.inputRequestTimers = [];
  }

  async onUninit() {
    this.persistSavingsState(Date.now());
    this.clearInputRequestSchedule();
    this.clearEvSocRequestSchedule();
    this.clearOverrideResumeTimer();
    this.clearContextTimer();
    this.clearPlanningTimer();
    if (this.contextHeartbeatTimer) {
      clearInterval(this.contextHeartbeatTimer);
      this.contextHeartbeatTimer = null;
    }
    if (this.controlTimer) {
      clearTimeout(this.controlTimer);
      this.controlTimer = null;
    }
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    if (this.batteryCommandPauseTimer) {
      clearTimeout(this.batteryCommandPauseTimer);
      this.batteryCommandPauseTimer = null;
    }
    if (this.pvLimitTimer) {
      clearTimeout(this.pvLimitTimer);
      this.pvLimitTimer = null;
    }
    if (this.pvStopTimer) {
      clearTimeout(this.pvStopTimer);
      this.pvStopTimer = null;
    }
    if (this.evTimer) {
      clearTimeout(this.evTimer);
      this.evTimer = null;
    }
    if (this.evPeakGuardStopHoldTimer) {
      clearTimeout(this.evPeakGuardStopHoldTimer);
      this.evPeakGuardStopHoldTimer = null;
    }
    for (const runtime of this.extraEvInstances || []) {
      if (runtime?.timer) clearTimeout(runtime.timer);
      runtime.timer = null;
    }
    this.updateBoilerRuntimeClock(Date.now(), true);
    for (const splitState of this.splitCommandState || []) {
      if (splitState?.recheckTimer) clearTimeout(splitState.recheckTimer);
      if (splitState?.safetyTimer) clearTimeout(splitState.safetyTimer);
    }
  }

  clearOverrideResumeTimer() {
    if (!this.overrideResumeTimer) return;
    clearTimeout(this.overrideResumeTimer);
    this.overrideResumeTimer = null;
  }

  armOverrideResume() {
    const settings = this.getSettings();
    this.clearOverrideResumeTimer();
    const forcedMode = String(settings.forcedMode || 'auto');
    if (forcedMode === 'auto' || !settings.overrideResumeOnTariffChange) {
      if (forcedMode === 'auto') this.setSetting('forcedModeResumeAt', 0);
      return;
    }

    const runtime = this.getRuntimeSettings({ ...settings, forcedMode: 'auto' });
    const tariff = findCurrentTariff(new Date(), runtime);
    const resumeAt = tariff && tariff.nextAt ? tariff.nextAt.getTime() : 0;
    this.setSetting('forcedModeResumeAt', resumeAt || 0);
    this.scheduleOverrideResume();
  }

  scheduleOverrideResume() {
    this.clearOverrideResumeTimer();
    const settings = this.getSettings();
    const forcedMode = String(settings.forcedMode || 'auto');
    const resumeAt = Number(settings.forcedModeResumeAt) || 0;
    if (forcedMode === 'auto' || !settings.overrideResumeOnTariffChange || !resumeAt) return;

    const delay = resumeAt - Date.now();
    if (delay <= 0) {
      this.setSetting('forcedMode', 'auto');
      this.setSetting('forcedModeResumeAt', 0);
      this.requestContextEvaluate(true, 'forced_mode_resume');
      return;
    }

    this.overrideResumeTimer = this.homey.setTimeout(() => {
      this.overrideResumeTimer = null;
      this.setSetting('forcedMode', 'auto');
      this.setSetting('forcedModeResumeAt', 0);
      this.requestContextEvaluate(true, 'forced_mode_resume');
    }, Math.min(delay, 24 * 60 * 60 * 1000));
  }

  getLocalMinuteOfDay(at = Date.now()) {
    return localParts(new Date(at), this.homey.clock.getTimezone() || 'UTC').minuteOfDay;
  }


  parseBatteryPauseTime(value, fallback = 0) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return fallback;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
    return (hour * 60) + minute;
  }

  getBatteryCommandPauseInfo(at = Date.now(), settings = this.getSettings()) {
    const enabled = Boolean(settings.batteryCommandPauseEnabled);
    const start = this.parseBatteryPauseTime(settings.batteryCommandPauseStart, (23 * 60) + 59);
    const end = this.parseBatteryPauseTime(settings.batteryCommandPauseEnd, 0);
    const minute = this.getLocalMinuteOfDay(at);
    // Equal start/end means a zero-length pause, never an all-day lockout.
    const active = enabled && start !== end && (start < end
      ? minute >= start && minute < end
      : minute >= start || minute < end);
    let remainingMs = 0;
    if (active) {
      const minuteDelta = (end - minute + 1440) % 1440;
      const now = new Date(at);
      const elapsedInMinuteMs = (now.getUTCSeconds() * 1000) + now.getUTCMilliseconds();
      remainingMs = Math.max(1, (minuteDelta * 60000) - elapsedInMinuteMs);
    }
    return {
      enabled,
      active,
      startMinute: start,
      endMinute: end,
      start: String(settings.batteryCommandPauseStart || '23:59'),
      end: String(settings.batteryCommandPauseEnd || '00:00'),
      remainingMs,
    };
  }

  scheduleBatteryCommandPauseResume(pauseInfo, at = Date.now()) {
    if (!pauseInfo?.active || this.batteryCommandPauseTimer) return;
    const wait = Math.max(50, Number(pauseInfo.remainingMs) || 1) + 75;
    this.batteryCommandPauseTimer = this.homey.setTimeout(() => {
      this.batteryCommandPauseTimer = null;
      this.requestContextEvaluate(true, 'battery_pause_ended');
    }, wait);
  }

  clearPvStopTimer() {
    if (!this.pvStopTimer) return;
    clearTimeout(this.pvStopTimer);
    this.pvStopTimer = null;
  }

  resetExpiredNightPlanning(at = Date.now()) {
    if (!this.state.nightPlanningActive) return false;
    // v0.3.80: a night plan deliberately survives midnight and the former
    // charge-deadline boundary. It is replaced only when real PV production
    // starts (or when a later PV-end decision starts the next night plan).
    // This prevents the daytime forecast from running underneath a stale night
    // phase and guarantees that exactly one planning phase is authoritative.
    void at;
    return false;
  }

  getPlanningForecastDay(at = Date.now()) {
    const today = this.getLocalDateKey(new Date(at));
    if (this.state.nightPlanningActive && String(this.state.nightPlanningStartedDate || '') === today) return 'tomorrow';
    return 'today';
  }

  isNightPlanningPhase(at = Date.now()) {
    if (this.state.nightPlanningActive) return true;
    const today = this.getLocalDateKey(new Date(at));
    const pvStartedToday = String(this.state.pvProducingDate || '') === today
      && Boolean(this.state.pvSeenProducingToday);
    // The solar-day phase starts on observed PV, not at a clock boundary. Until
    // then the continuing night plan remains authoritative, including after the
    // configured charging deadline on dark winter mornings.
    return !pvStartedToday;
  }

  updatePvPlanningState(pvPowerW, at = Date.now()) {
    const value = Math.max(0, Number(pvPowerW) || 0);
    this.resetExpiredNightPlanning(at);
    const today = this.getLocalDateKey(new Date(at));
    if (String(this.state.pvProducingDate || '') !== today) {
      this.state.pvProducingDate = today;
      this.state.pvSeenProducingToday = false;
    }
    const wasNightPlanning = this.isNightPlanningPhase(at);

    if (value >= 5) {
      this.state.pvSeenProducingToday = true;
      this.clearPvStopTimer();

      // Any observed PV start is the single authoritative transition to the
      // daytime plan. Clear an explicit night marker regardless of whether it
      // was created before or after midnight; the previous date check caused
      // the old overlap between remaining-PV day logic and night planning.
      this.state.nightPlanningActive = false;
      this.state.nightPlanningStartedDate = '';
      this.state.nightPlanningDecisionSource = '';
      if (wasNightPlanning) {
        this.invalidatePlanningCache(true);
        this.requestContextEvaluate(true, 'pv_started_day_planning');
      }
      return;
    }

    if (this.state.nightPlanningActive || this.pvStopTimer) return;
    // A 0 W value before HomeFlux has observed production on this local day is
    // not enough to declare PV ended (for example 02:00 after an app restart).
    // If no end can be observed, the 20:00 fallback below still makes the plan.
    if (!this.state.pvSeenProducingToday) return;
    // Never interpret pre-dawn 0 W as the end of the new solar day. From the
    // configured morning boundary onward, <5 W for 10 minutes is authoritative.
    const deadline = String(this.getSettings().chargeDeadline || '07:00');
    const match = /^(\d{1,2}):(\d{2})$/.exec(deadline);
    const earliestMinute = match ? (Number(match[1]) * 60) + Number(match[2]) : 7 * 60;
    if (this.getLocalMinuteOfDay(at) < earliestMinute) return;

    const pvEndCandidateDate = today;
    this.pvStopTimer = this.homey.setTimeout(() => {
      this.pvStopTimer = null;
      const latest = Number(this.state.pvPowerW);
      if (!this.inputSeen.pv || !Number.isFinite(latest) || latest >= 5) return;
      this.activateNightPlanning('pv_below_5w_10m', Date.now(), pvEndCandidateDate);
    }, 10 * 60 * 1000);
  }

  checkNightPlanningFallback(at = Date.now()) {
    this.resetExpiredNightPlanning(at);
    if (this.getLocalMinuteOfDay(at) < 20 * 60) return false;
    // Once a real PV end candidate has armed the 10-minute debounce, that
    // timer remains authoritative even if the last PV input becomes stale.
    if (!this.state.nightPlanningActive && this.pvStopTimer) return false;

    // If PV is still genuinely producing, wait for the normal <5 W / 10 min
    // boundary. Otherwise 20:00 is the safety fallback, including when no PV
    // Flow data exists at all or HomeFlux started after today's PV had ended.
    const pv = Number(this.state.pvPowerW);
    const lastPvAt = Number(this.inputUpdatedAt?.pv) || 0;
    const pvFresh = Boolean(this.inputSeen.pv) && lastPvAt > 0 && (Number(at) - lastPvAt) <= 5 * 60 * 1000;
    const today = this.getLocalDateKey(new Date(at));
    if (pvFresh && Number.isFinite(pv)) {
      if (pv >= 5) return false;
      const pvSeenToday = String(this.state.pvProducingDate || '') === today
        && Boolean(this.state.pvSeenProducingToday);
      // Fresh low PV after real production must always finish the normal
      // 10-minute stop debounce. The 20:00 safety fallback may not bypass it;
      // if the timer was lost, re-arm it from the latest fresh PV value.
      if (!this.state.nightPlanningActive && pvSeenToday) {
        if (!this.pvStopTimer) this.updatePvPlanningState(pv, at);
        return false;
      }
    }

    if (this.state.nightPlanningActive) {
      // v0.3.80: on a completely dark day the previous night's phase must stay
      // active (never fall through to daytime logic), but at 20:00 it still has
      // to roll forward so tomorrow's forecast becomes authoritative. Re-arm
      // the same night phase once per local day instead of creating overlap.
      if (String(this.state.nightPlanningStartedDate || '') === today) return false;
      this.activateNightPlanning(pvFresh ? '20h_pv_end_fallback' : '20h_no_pv_data', at, today);
      return true;
    }

    this.activateNightPlanning(pvFresh ? '20h_pv_end_fallback' : '20h_no_pv_data', at, today);
    return true;
  }

  activateNightPlanning(source, at = Date.now(), planningStartedDate = '') {
    const today = this.getLocalDateKey(new Date(at));
    this.state.nightPlanningActive = true;
    this.state.nightPlanningStartedDate = String(planningStartedDate || today);
    this.state.nightPlanningDecisionSource = String(source || 'pv_end');
    this.invalidatePlanningCache();
    this.clearPvStopTimer();
    this.requestContextEvaluate(true, `night_planning:${source}`);
    this.publishChargePlanIfChanged(true).catch(err => this.error('Charge plan trigger failed', err));
  }

  formatPlanningTime(at) {
    if (!at) return '';
    const lp = localParts(new Date(Number(at)), this.homey.clock.getTimezone() || 'UTC');
    return `${String(lp.hour).padStart(2, '0')}:${String(lp.minute).padStart(2, '0')}`;
  }

  buildChargePlanText(plan) {
    if (!plan || plan.currentSoc === null || plan.currentSoc === undefined) return 'Laadplan: wachten op batterij-SoC.';
    const target = Number(plan.targetSoc);
    const targetText = Number.isFinite(target) ? `${target.toFixed(1).replace('.0', '')}%` : '—';
    const rows = Array.isArray(plan.rows) ? plan.rows.filter(row => row && row.plannedNetCharge) : [];
    const energyNeed = Number(plan.energyNeedKwh) || 0;
    if (!(energyNeed > 0.001)) {
      return `SoC-doel ${targetText} · genoeg batterijreserve, er wordt niet geladen.`;
    }
    if (!rows.length) {
      if (plan.dynamicPriceReady === false) return `SoC-doel ${targetText} · laden is nodig, maar prijsdata ontbreekt.`;
      return `SoC-doel ${targetText} · laden is nodig, maar er is geen bruikbaar laadvenster.`;
    }
    const windows = rows.map(row => `${this.formatPlanningTime(row.startAt)}–${this.formatPlanningTime(row.endAt)}`).join(', ');
    const energy = rows.reduce((sum, row) => sum + Math.max(0, Number(row.plannedEnergyKwh) || 0), 0);
    const powers = rows.map(row => Math.max(0, Math.round(Number(row.plannedChargeW) || 0))).filter(value => value > 0);
    const powerText = powers.length ? ` · ca. ${Math.max(...powers)} W` : '';
    return `SoC-doel ${targetText} · laden tijdens ${windows}${powerText} · ${energy.toFixed(2)} kWh gepland.`;
  }

  async publishChargePlanIfChanged(force = false) {
    if (!this.chargePlanTrigger && !this.tokens.get('emschargeplan')) return null;
    const plan = this.getPlanningStatus({ force });
    if (plan.currentSoc === null || plan.currentSoc === undefined) return { plan, text: '', changed: false };
    const text = this.buildChargePlanText(plan);
    const windows = Array.isArray(plan.rows)
      ? plan.rows.filter(row => row && row.plannedNetCharge).map(row => `${this.formatPlanningTime(row.startAt)}–${this.formatPlanningTime(row.endAt)}`).join(', ')
      : '';
    // Only publish when the human-readable decision changes. SoC refreshes
    // every few minutes must not retrigger a Flow if the decided plan is still
    // exactly the same.
    const signature = text;
    if (!force && signature === this.lastChargePlanSignature) return { plan, text, changed: false };

    // Reserve the decision signature before the first asynchronous write. Several
    // inputs can arrive in the same second; without this reservation concurrent
    // calls all saw the old signature and fired duplicate notifications.
    const previousSignature = this.lastChargePlanSignature;
    const previousText = this.lastChargePlanText;
    this.lastChargePlanSignature = signature;
    this.lastChargePlanText = text;
    try {
      const token = this.tokens.get('emschargeplan');
      if (token) await token.setValue(text);
      if (this.chargePlanTrigger) {
        await this.chargePlanTrigger.trigger({
          plan: text,
          target_soc: Number(plan.targetSoc) || 0,
          current_soc: Number(plan.currentSoc) || 0,
          charge_window: windows,
          forecast_energy: Number(plan.forecastKwh) || 0,
        });
      }
    } catch (err) {
      // Allow a later retry if the actual publication failed.
      if (this.lastChargePlanSignature === signature) {
        this.lastChargePlanSignature = previousSignature;
        this.lastChargePlanText = previousText;
      }
      throw err;
    }
    return { plan, text, changed: true };
  }

  getLocalDateKey(date = new Date()) {
    return localParts(date, this.homey.clock.getTimezone() || 'UTC').dateKey;
  }

  describeApiValue(value) {
    if (Array.isArray(value)) return `array(${value.length})`;
    if (value && typeof value === 'object') return `object(${Object.keys(value).slice(0, 8).join(',')})`;
    return typeof value;
  }

  extractScalar(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'object') {
      for (const key of ['value', 'type', 'id', 'name', 'zoneId', 'interval', 'priceInterval']) {
        if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'object') return value[key];
      }
    }
    return value;
  }

  async ensureHomeyWebApi() {
    if (this.homeyApi) return this.homeyApi;
    if (!this.homeyApiPromise) {
      this.homeyApiPromise = HomeyAPI.createAppAPI({ homey: this.homey })
        .then(api => {
          this.homeyApi = api;
          return api;
        })
        .catch(err => {
          this.homeyApiPromise = null;
          throw err;
        });
    }
    return this.homeyApiPromise;
  }

  compactApiError(err) {
    const text = err && err.message ? err.message : String(err || 'Onbekende fout');
    return text.replace(/\s+/g, ' ').slice(0, 90);
  }

  async ensureHomeyEnergyFresh() {
    const age = Date.now() - (this.homeyEnergy.lastUpdatedAt || 0);
    if (!this.homeyEnergy.slots.length || age > 20 * 60 * 1000) {
      await this.refreshHomeyEnergyPrices(false);
    }
  }

  async refreshHomeyEnergyPrices(force = false) {
    if (this.homeyEnergy.refreshing) return this.getHomeyEnergyStatus();
    const nowMs = Date.now();
    if (!force && nowMs - (this.homeyEnergy.lastAttemptAt || 0) < 5 * 60 * 1000) {
      return this.getHomeyEnergyStatus();
    }

    this.homeyEnergy.refreshing = true;
    this.homeyEnergy.lastAttemptAt = nowMs;
    this.homeyEnergy.error = '';
    try {
      const timezone = this.homey.clock.getTimezone() || 'UTC';
      const homeyApi = await this.ensureHomeyWebApi();
      const energy = homeyApi.energy;
      let typeResponse = null;
      let zoneResponse = null;
      let intervalResponse = null;
      try { typeResponse = await energy.getElectricityPriceType(); } catch (err) { /* optional metadata */ }
      try { zoneResponse = await energy.getDynamicPricesElectricityZone(); } catch (err) { /* optional metadata */ }
      try {
        if (typeof energy.getOptionElectricityPriceDynamicPreferredInterval === 'function') {
          intervalResponse = await energy.getOptionElectricityPriceDynamicPreferredInterval();
        }
      } catch (err) { /* optional metadata */ }

      this.homeyEnergy.priceType = this.extractScalar(typeResponse);
      this.homeyEnergy.zone = this.extractScalar(zoneResponse);
      this.homeyEnergy.interval = this.extractScalar(intervalResponse);

      const today = this.getLocalDateKey(new Date());
      const tomorrow = this.getLocalDateKey(new Date(Date.now() + 30 * 60 * 60 * 1000));
      const dates = [...new Set([today, tomorrow])];
      const allSlots = [];
      const shapes = [];
      for (const date of dates) {
        try {
          const response = await energy.fetchDynamicElectricityPrices({ date });
          shapes.push(`${date}:${this.describeApiValue(response)}`);
          allSlots.push(...normalizeDynamicPriceResponse(response, { dateHint: date, timezone }));
        } catch (err) {
          shapes.push(`${date}:error(${this.compactApiError(err)})`);
        }
      }

      const unique = new Map();
      for (const slot of allSlots) {
        const key = slot.startMs !== null && slot.startMs !== undefined
          ? `ms:${slot.startMs}`
          : `local:${slot.dateKey}:${slot.minute}`;
        if (!unique.has(key)) unique.set(key, slot);
      }
      this.homeyEnergy.slots = [...unique.values()];
      this.homeyEnergy.available = true;
      this.homeyEnergy.lastUpdatedAt = Date.now();
      this.homeyEnergy.responseShape = shapes.join(' · ');
      if (!this.homeyEnergy.slots.length) {
        const typeText = this.homeyEnergy.priceType === null || this.homeyEnergy.priceType === undefined
          ? ''
          : String(this.homeyEnergy.priceType);
        if (typeText && !typeText.toLowerCase().includes('dynamic')) {
          this.homeyEnergy.error = `Homey Energy gebruikt prijstype “${typeText}”. De HomeFlux EMS-contractkeuze staat hier los van; zet Homey Energy zelf op Dynamisch om Homey's dynamische prijs-slots te gebruiken.`;
        } else if (typeText.toLowerCase().includes('dynamic')) {
          this.homeyEnergy.error = `Homey Energy staat op Dynamisch, maar HomeFlux EMS herkent nog geen prijs-slots. API-vorm: ${this.homeyEnergy.responseShape || 'onbekend'}.`;
        } else {
          this.homeyEnergy.error = `Homey Energy API bereikbaar, maar geen dynamische prijs-slots beschikbaar. API-vorm: ${this.homeyEnergy.responseShape || 'onbekend'}.`;
        }
      }
      this.homeyEnergyAnalysisCache = { key: '', value: null };
      this.homeyEnergyResampleCache = { key: '', value: [] };
      this.invalidatePlanningCache();
      this.armOverrideResume();
      this.requestContextEvaluate(true, 'homey_energy_prices');
      if (this.isNightPlanningPhase()) this.publishChargePlanIfChanged().catch(err => this.error('Charge plan update after Homey Energy refresh failed', err));
      return this.getHomeyEnergyStatus();
    } catch (err) {
      this.homeyEnergy.available = false;
      this.homeyEnergy.error = err && err.message ? err.message : String(err);
      this.error('Could not read Homey Energy prices', err);
      return this.getHomeyEnergyStatus();
    } finally {
      this.homeyEnergy.refreshing = false;
    }
  }

  getDynamicTargetInterval(settings = this.getSettings()) {
    return String(settings.contractType || '') === 'dynamic_hour' ? 60 : 15;
  }

  getEffectiveHomeySlots(settings = this.getSettings()) {
    const target = this.getDynamicTargetInterval(settings);
    const key = `${this.homeyEnergy.lastUpdatedAt || 0}|${target}`;
    if (this.homeyEnergyResampleCache.key === key) return this.homeyEnergyResampleCache.value;
    const value = resamplePriceSlots(this.homeyEnergy.slots || [], target);
    this.homeyEnergyResampleCache = { key, value };
    return value;
  }

  getHomeyEnergyStatus(settings = this.getSettings()) {
    const timezone = this.homey.clock.getTimezone() || 'UTC';
    const effectiveSlots = this.getEffectiveHomeySlots(settings);
    const now = new Date();
    const lp = localParts(now, timezone);
    const targetInterval = this.getDynamicTargetInterval(settings);
    const bucket = Math.floor(lp.minuteOfDay / targetInterval);
    const cacheKey = [
      this.homeyEnergy.lastUpdatedAt || 0,
      lp.dateKey, bucket, targetInterval,
      Number(settings.cheapHours) || 3, Number(settings.expensiveHours) || 3,
    ].join('|');

    let analysis = this.homeyEnergyAnalysisCache.key === cacheKey
      ? this.homeyEnergyAnalysisCache.value
      : null;
    if (!analysis) {
      analysis = analyzePriceSlots(
        effectiveSlots,
        now,
        timezone,
        Number(settings.cheapHours) || 3,
        Number(settings.expensiveHours) || 3,
      );
      this.homeyEnergyAnalysisCache = { key: cacheKey, value: analysis };
    }

    let priceClass = '';
    if (analysis.isCheapNow) priceClass = 'goedkoop';
    else if (analysis.isExpensiveNow) priceClass = 'duur';
    else if (analysis.currentPrice !== null) priceClass = 'normaal';

    return {
      available: this.homeyEnergy.available,
      refreshing: this.homeyEnergy.refreshing,
      priceType: this.homeyEnergy.priceType,
      zone: this.homeyEnergy.zone,
      preferredInterval: this.homeyEnergy.interval,
      sourceIntervalMinutes: inferIntervalMinutes(this.homeyEnergy.slots || [], Number(this.homeyEnergy.interval) || 15),
      slotIntervalMinutes: analysis.slotCount > 0 ? analysis.intervalMinutes : null,
      decisionIntervalMinutes: targetInterval,
      slotsToday: analysis.slotCount,
      totalSlotsLoaded: effectiveSlots.length,
      currentPrice: analysis.currentPrice,
      currentRawPrice: analysis.currentRawPrice,
      currentUserCostAdder: analysis.currentUserCostAdder,
      currentRank: analysis.currentRank,
      priceClass,
      isCheapNow: analysis.isCheapNow,
      isExpensiveNow: analysis.isExpensiveNow,
      cheapestSummary: analysis.cheapestSummary,
      expensiveSummary: analysis.expensiveSummary,
      cheapestBlockSummary: analysis.cheapestBlockSummary,
      cheapestBlockAveragePrice: analysis.cheapestBlockAveragePrice,
      cheapHours: Number(settings.cheapHours) || 3,
      expensiveHours: Number(settings.expensiveHours) || 3,
      lastUpdatedAt: this.homeyEnergy.lastUpdatedAt,
      error: this.homeyEnergy.error || '',
      responseShape: this.homeyEnergy.responseShape || '',
    };
  }

  usesHomeyEnergyPrices(settings = this.getSettings()) {
    // From v0.3.7 every dynamic contract uses Homey Energy as its authoritative
    // price source. The legacy manual source is intentionally ignored.
    return isDynamicContract(settings);
  }

  getHomeyEngineSlots(settings = this.getSettings(), now = new Date()) {
    const timezone = this.homey.clock.getTimezone() || settings.timezone || 'UTC';
    const today = localParts(now, timezone).dateKey;
    return this.getEffectiveHomeySlots(settings)
      .filter(slot => slot.dateKey === today && Number.isFinite(Number(slot.price)) && Number.isFinite(Number(slot.minute)))
      .sort((a, b) => a.minute - b.minute)
      .map(slot => ({
        time: `${String(Math.floor(slot.minute / 60)).padStart(2, '0')}:${String(slot.minute % 60).padStart(2, '0')}`,
        price: Number(slot.price),
      }));
  }

  restoreLowForecastSunnyState(at = Date.now()) {
    const stored = String(this.homey.settings.get('_lowForecastSunnyOverrideDate') || '');
    const today = this.getForecastDateKey(at);
    this.lowForecastSunnyOverrideDate = stored === today ? stored : '';
    this.lowForecastSunnyRuntime = { date: today, aboveSince: 0 };
  }

  getAverageBatterySocForLowForecastPromotion(settings = this.getSettings()) {
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const values = [];
    for (let index = 0; index < count; index += 1) {
      if (!this.inputSeen.batterySoc[index]) continue;
      const value = Number(this.state.batterySoc[index]);
      if (Number.isFinite(value)) values.push(value);
    }
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  getTodayStrategyForecastKwh() {
    const full = Number(this.state.forecastDailyMaxKwh);
    if (Number.isFinite(full) && full >= 0) return full;
    if (Boolean(this.inputSeen.forecast)) {
      const remaining = Number(this.state.forecastRemainingKwh);
      if (Number.isFinite(remaining) && remaining >= 0) return remaining;
    }
    return null;
  }

  isLowForecastSunnyOverrideActive(settings = this.getSettings(), at = Date.now()) {
    if (!Boolean(settings.lowForecastAutoSunnyEnabled)) return false;
    if (this.isNightPlanningPhase(at)) return false;
    const today = this.getForecastDateKey(at);
    return String(this.lowForecastSunnyOverrideDate || '') === today;
  }

  updateLowForecastSunnyPromotion(at = Date.now(), settings = this.getSettings()) {
    const runtime = this.lowForecastSunnyRuntime || (this.lowForecastSunnyRuntime = { date: '', aboveSince: 0 });
    const today = this.getForecastDateKey(at);
    if (runtime.date !== today) {
      runtime.date = today;
      runtime.aboveSince = 0;
      if (String(this.lowForecastSunnyOverrideDate || '') !== today) this.lowForecastSunnyOverrideDate = '';
    }

    if (!Boolean(settings.lowForecastAutoSunnyEnabled)
      || String(settings.forcedMode || 'auto') !== 'auto'
      || this.isNightPlanningPhase(at)
      || String(this.lowForecastSunnyOverrideDate || '') === today) {
      runtime.aboveSince = 0;
      return false;
    }

    const lowPvThresholdKwh = Math.max(0, Number(settings.lowForecastSelfConsumptionMinKwh) || 0);
    const forecastKwh = this.getTodayStrategyForecastKwh();
    if (lowPvThresholdKwh <= 0 || forecastKwh === null || forecastKwh >= lowPvThresholdKwh) {
      runtime.aboveSince = 0;
      return false;
    }

    const avgSoc = this.getAverageBatterySocForLowForecastPromotion(settings);
    const thresholdSoc = Math.max(0, Math.min(100, Number(settings.lowForecastAutoSunnySoc) || 0));
    if (avgSoc === null || avgSoc < thresholdSoc) {
      runtime.aboveSince = 0;
      return false;
    }

    if (!runtime.aboveSince) runtime.aboveSince = Number(at) || Date.now();
    const minutes = Math.max(1, Number(settings.lowForecastAutoSunnyMinutes) || 10);
    const dueAt = runtime.aboveSince + (minutes * 60000);
    if ((Number(at) || Date.now()) < dueAt) return false;

    this.lowForecastSunnyOverrideDate = today;
    runtime.aboveSince = 0;
    this.setSetting('_lowForecastSunnyOverrideDate', today);
    return true;
  }

  getForecastDateKey(at = Date.now()) {
    const settings = this.getSettings();
    const timezone = this.homey.clock.getTimezone() || settings.timezone || 'UTC';
    return localParts(new Date(at), timezone).dateKey;
  }

  restoreForecastState(at = Date.now()) {
    const today = this.getForecastDateKey(at);
    const storedDate = String(this.homey.settings.get('_forecastDailyMaxDate') || '');
    const storedMaxRaw = this.homey.settings.get('_forecastDailyMaxKwh');
    const storedMax = storedMaxRaw === null || storedMaxRaw === undefined ? null : Number(storedMaxRaw);
    const tomorrowDate = String(this.homey.settings.get('_forecastTomorrowDate') || '');
    const tomorrowRaw = this.homey.settings.get('_forecastTomorrowKwh');
    const tomorrow = tomorrowRaw === null || tomorrowRaw === undefined || tomorrowRaw === '' ? null : Number(tomorrowRaw);
    this.state.forecastDailyMaxDate = today;
    this.state.forecastDailyMaxKwh = storedDate === today && Number.isFinite(storedMax) && storedMax >= 0 ? storedMax : null;
    this.state.forecastTomorrowDate = tomorrowDate;
    this.state.forecastTomorrowKwh = Number.isFinite(tomorrow) && tomorrow >= 0 ? tomorrow : null;
    this.inputSeen.forecastTomorrow = Boolean(this.state.forecastTomorrowKwh !== null && tomorrowDate === this.getForecastDateKey(at + (24 * 60 * 60 * 1000)));
    if (tomorrowDate === today && this.state.forecastTomorrowKwh !== null) {
      this.state.forecastDailyMaxKwh = Math.max(this.state.forecastDailyMaxKwh ?? 0, this.state.forecastTomorrowKwh);
      this.state.forecastTomorrowKwh = null;
      this.state.forecastTomorrowDate = '';
      this.inputSeen.forecastTomorrow = false;
      this.setSetting('_forecastTomorrowDate', '');
      this.setSetting('_forecastTomorrowKwh', '');
    }
  }

  ensureForecastDayCurrent(at = Date.now()) {
    const dateKey = this.getForecastDateKey(at);
    if (String(this.state.forecastDailyMaxDate || '') === dateKey) return;

    const promotedTomorrow = String(this.state.forecastTomorrowDate || '') === dateKey
      && Number.isFinite(Number(this.state.forecastTomorrowKwh))
      ? Math.max(0, Number(this.state.forecastTomorrowKwh))
      : null;

    // A forecast supplied yesterday as 'tomorrow' becomes today's full-day forecast
    // at midnight. Remaining PV still waits for a fresh current-day value.
    this.state.forecastDailyMaxDate = dateKey;
    this.state.forecastDailyMaxKwh = promotedTomorrow;
    this.state.forecastRemainingKwh = null;
    this.inputSeen.forecast = false;
    this.inputUpdatedAt.forecast = 0;
    if (promotedTomorrow !== null) {
      this.setSetting('_forecastDailyMaxDate', dateKey);
      this.setSetting('_forecastDailyMaxKwh', promotedTomorrow);
    }
    this.state.forecastTomorrowKwh = null;
    this.state.forecastTomorrowDate = '';
    this.inputSeen.forecastTomorrow = false;
    this.inputUpdatedAt.forecastTomorrow = 0;
    this.setSetting('_forecastTomorrowDate', '');
    this.setSetting('_forecastTomorrowKwh', '');
  }

  updateForecastInput(value, at = Date.now()) {
    this.ensureForecastDayCurrent(at);
    const normalized = Math.max(0, Number(value));
    if (!Number.isFinite(normalized)) return false;

    const wasSeen = Boolean(this.inputSeen.forecast);
    const previousRemaining = Number(this.state.forecastRemainingKwh);
    const dateKey = this.getForecastDateKey(at);
    const previousDate = String(this.state.forecastDailyMaxDate || '');
    const previousMax = Number(this.state.forecastDailyMaxKwh);
    const newDay = previousDate !== dateKey;
    const nextMax = newDay || !Number.isFinite(previousMax)
      ? normalized
      : Math.max(previousMax, normalized);
    const changed = newDay
      || this.hasNumericInputChanged(previousRemaining, normalized, wasSeen, 0.01)
      || !Number.isFinite(previousMax)
      || nextMax > previousMax + 0.009;

    this.state.forecastRemainingKwh = normalized;
    this.state.forecastDailyMaxDate = dateKey;
    this.state.forecastDailyMaxKwh = nextMax;
    this.inputSeen.forecast = true;
    this.inputUpdatedAt.forecast = at;

    // Persist only when the day changes or a new daily maximum is observed.
    // Identical periodic forecast inputs only refresh freshness; they do not
    // write Homey settings or invalidate the five-minute planning throttle.
    if (newDay || !Number.isFinite(previousMax) || nextMax > previousMax + 0.009) {
      this.setSetting('_forecastDailyMaxDate', dateKey);
      this.setSetting('_forecastDailyMaxKwh', nextMax);
    }
    return changed;
  }

  updateForecastTomorrowInput(value, at = Date.now()) {
    const normalized = Math.max(0, Number(value));
    if (!Number.isFinite(normalized)) return false;
    this.ensureForecastDayCurrent(at);
    const targetDate = this.getForecastDateKey(at + (24 * 60 * 60 * 1000));
    const wasSeen = Boolean(this.inputSeen.forecastTomorrow);
    const previousValue = Number(this.state.forecastTomorrowKwh);
    const previousDate = String(this.state.forecastTomorrowDate || '');
    const changed = previousDate !== targetDate
      || this.hasNumericInputChanged(previousValue, normalized, wasSeen, 0.01);

    this.state.forecastTomorrowKwh = normalized;
    this.state.forecastTomorrowDate = targetDate;
    this.inputSeen.forecastTomorrow = true;
    this.inputUpdatedAt.forecastTomorrow = at;
    if (changed) {
      this.setSetting('_forecastTomorrowDate', targetDate);
      this.setSetting('_forecastTomorrowKwh', normalized);
    }
    return changed;
  }

  normalizeEvOperatingMode(mode) {
    const value = String(mode || 'smart');
    return ['smart', 'soc_target', 'emergency'].includes(value) ? value : 'smart';
  }

  getEffectiveEvMode(settings = this.getSettings()) {
    const overrideMode = this.normalizeEvOperatingMode(this.evSessionOverride?.mode || '');
    if (this.evSessionOverride?.mode && ['smart', 'soc_target', 'emergency'].includes(String(this.evSessionOverride.mode))) {
      return overrideMode;
    }
    return this.normalizeEvOperatingMode(settings.evMode || 'smart');
  }

  setEvSessionOverride(mode, source = 'flow') {
    const normalized = this.normalizeEvOperatingMode(mode);
    const connectedNow = Boolean(this.inputSeen.ev?.connected) && Boolean(this.state.evConnected);
    const alreadyStarted = Boolean(this.evSessionOverride?.mode) && Boolean(this.evSessionOverride?.sessionStarted);
    this.evSessionOverride = {
      mode: normalized,
      sessionStarted: alreadyStarted || connectedNow,
      requestedAt: Date.now(),
      source: String(source || 'flow'),
    };
    // A Smart PV-only latch belongs to the previous operating mode and must not
    // leak into an Emergency/SoC override. No polling or extra calculation loop
    // is created; the existing EMS pass publishes the new EV decision.
    this.clearEvPvSession();
    this.forceEvOutput = true;
    this.requestContextEvaluate(true, 'ev1_session_override');
    this.syncEmsDevices().catch(err => this.error('EMS device sync after EV session override failed', err));
    return normalized;
  }

  clearEvSessionOverride() {
    const wasActive = Boolean(this.evSessionOverride?.mode);
    this.evSessionOverride = { mode: null, sessionStarted: false, requestedAt: 0, source: '' };
    if (wasActive) {
      this.clearEvPvSession();
      this.forceEvOutput = true;
    }
    return wasActive;
  }

  handleEvSessionConnectionTransition(wasConnected, isConnected) {
    if (!this.evSessionOverride?.mode) return false;

    // If the override was requested while disconnected, the first connection
    // starts the one-session lifetime. If it was requested while already
    // connected, sessionStarted was set immediately in setEvSessionOverride().
    if (isConnected) {
      this.evSessionOverride.sessionStarted = true;
      return false;
    }

    // Repeated disconnected reports before a session has ever started do not
    // consume the override. Only connected -> disconnected ends the session.
    if (Boolean(wasConnected) && Boolean(this.evSessionOverride.sessionStarted)) {
      return this.clearEvSessionOverride();
    }
    return false;
  }


  getEvSessionOverrideFor(index) {
    if (index === 0) return this.evSessionOverride;
    return this.getExtraEv(index)?.sessionOverride || { mode: null, sessionStarted: false, requestedAt: 0, source: '' };
  }

  getEffectiveEvModeFor(index, settings = this.getSettings()) {
    const override = this.getEvSessionOverrideFor(index);
    if (override?.mode && ['smart', 'soc_target', 'emergency'].includes(String(override.mode))) {
      return this.normalizeEvOperatingMode(override.mode);
    }
    const instanceSettings = this.getEvInstanceSettings(index, settings);
    return this.normalizeEvOperatingMode(instanceSettings.evMode || 'smart');
  }

  setEvSessionOverrideFor(index, mode, source = 'flow') {
    if (index === 0) return this.setEvSessionOverride(mode, source);
    const runtime = this.getExtraEv(index);
    if (!runtime) return this.normalizeEvOperatingMode(mode);
    const normalized = this.normalizeEvOperatingMode(mode);
    const connectedNow = Boolean(runtime.seen.connected) && Boolean(runtime.state.connected);
    const alreadyStarted = Boolean(runtime.sessionOverride?.mode) && Boolean(runtime.sessionOverride?.sessionStarted);
    runtime.sessionOverride = {
      mode: normalized,
      sessionStarted: alreadyStarted || connectedNow,
      requestedAt: Date.now(),
      source: String(source || 'flow'),
    };
    this.clearEvPvSessionFor(index);
    runtime.forceOutput = true;
    this.requestContextEvaluate(true, `ev${index + 1}_session_override`);
    this.syncEmsDevices().catch(err => this.error(`EMS device sync after EV ${index + 1} session override failed`, err));
    return normalized;
  }

  clearEvSessionOverrideFor(index) {
    if (index === 0) return this.clearEvSessionOverride();
    const runtime = this.getExtraEv(index);
    if (!runtime) return false;
    const wasActive = Boolean(runtime.sessionOverride?.mode);
    runtime.sessionOverride = { mode: null, sessionStarted: false, requestedAt: 0, source: '' };
    if (wasActive) {
      this.clearEvPvSessionFor(index);
      runtime.forceOutput = true;
    }
    return wasActive;
  }

  handleEvSessionConnectionTransitionFor(index, wasConnected, isConnected) {
    if (index === 0) return this.handleEvSessionConnectionTransition(wasConnected, isConnected);
    const runtime = this.getExtraEv(index);
    if (!runtime?.sessionOverride?.mode) return false;
    if (isConnected) {
      runtime.sessionOverride.sessionStarted = true;
      return false;
    }
    if (Boolean(wasConnected) && Boolean(runtime.sessionOverride.sessionStarted)) {
      return this.clearEvSessionOverrideFor(index);
    }
    return false;
  }

  getRuntimeSettings(settings = this.getSettings()) {
    this.ensureForecastDayCurrent();
    const runtime = {
      ...settings,
      evMode: this.getEffectiveEvMode(settings),
      evSessionOverrideActive: Boolean(this.evSessionOverride?.mode),
      forecastDataReady: Boolean(this.inputSeen.forecast),
      forecastDailyDataReady: Number.isFinite(Number(this.state.forecastDailyMaxKwh)),
      forecastTomorrowDataReady: Boolean(this.inputSeen.forecastTomorrow) && Number.isFinite(Number(this.state.forecastTomorrowKwh)),
      pvDataReady: Boolean(this.inputSeen.pv),
    };
    if (!isDynamicContract(settings)) return runtime;
    const dynamicSlots = this.getHomeyEngineSlots(settings);
    return { ...runtime, dynamicSlots, dynamicPriceDataReady: dynamicSlots.length > 0 };
  }

  recordGridSample(value, at = Date.now()) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    this.gridInputHistory.push({ at: Number(at) || Date.now(), value: numeric });

    // Keep enough history for a time-weighted 5 s control average without
    // accumulating an ever-growing list when the meter publishes frequently.
    const cutoff = (Number(at) || Date.now()) - 15000;
    while (this.gridInputHistory.length > 2 && this.gridInputHistory[1].at < cutoff) {
      this.gridInputHistory.shift();
    }
  }

  getGridAverage(windowMs = 5000, now = Date.now()) {
    const live = Number(this.state.gridPowerW);
    if (!Number.isFinite(live)) return 0;
    const samples = this.gridInputHistory.filter(sample => sample.at <= now);
    if (!samples.length) return live;

    const start = now - Math.max(1, Number(windowMs) || 5000);
    let currentValue = samples[0].value;
    for (const sample of samples) {
      if (sample.at <= start) currentValue = sample.value;
      else break;
    }

    let cursor = start;
    let area = 0;
    for (const sample of samples) {
      if (sample.at <= start) continue;
      const sampleAt = Math.min(now, sample.at);
      if (sampleAt > cursor) area += currentValue * (sampleAt - cursor);
      currentValue = sample.value;
      cursor = sampleAt;
      if (cursor >= now) break;
    }
    if (cursor < now) area += currentValue * (now - cursor);
    return area / Math.max(1, now - start);
  }

  getEvaluationState(settings = this.getSettings(), now = Date.now(), pvDeltaW = 0) {
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    // SoC is value-based, not freshness-based. Once a battery has supplied a
    // valid SoC value, keep using the last known value until a newer one arrives.
    // A battery is unavailable only when no valid SoC has ever been received.
    const batterySoc = Array.from({ length: 8 }, (_, index) => {
      if (index >= count) return null;
      if (!this.inputSeen.batterySoc[index]) return null;
      const value = Number(this.state.batterySoc[index]);
      return Number.isFinite(value) ? value : null;
    });

    const liveGridPowerW = Number.isFinite(Number(this.state.gridPowerW)) ? Number(this.state.gridPowerW) : 0;
    const gridAverage5sW = this.getGridAverage(5000, now);
    const configuredPvDeltaThresholdW = Number(settings.pvDeltaThresholdW);
    const pvDeltaThresholdW = Number.isFinite(configuredPvDeltaThresholdW) ? Math.max(0, configuredPvDeltaThresholdW) : 100;
    const useLiveGrid = pvDeltaThresholdW > 0 && Math.abs(Number(pvDeltaW) || 0) >= pvDeltaThresholdW;
    const evActualPowerW = Boolean(settings.evEnabled) && Boolean(this.state.evConnected) && this.inputSeen.ev?.chargeCurrent
      ? Math.max(0, Number(this.state.evChargeCurrentA) || 0) * evPowerPerAmp(settings)
      : 0;
    const selectedGridW = useLiveGrid ? liveGridPowerW : gridAverage5sW;

    return {
      ...this.state,
      batterySoc,
      forecastDailyMaxKwh: this.state.forecastDailyMaxKwh === null ? null : (Number.isFinite(Number(this.state.forecastDailyMaxKwh)) ? Number(this.state.forecastDailyMaxKwh) : null),
      forecastTomorrowKwh: this.state.forecastTomorrowKwh === null ? null : (Number.isFinite(Number(this.state.forecastTomorrowKwh)) ? Number(this.state.forecastTomorrowKwh) : null),
      gridPowerW: liveGridPowerW,
      // EV is a HomeFlux-controlled flexible load. Remove its measured load from
      // the ordinary battery error so the home battery never discharges merely
      // to feed intentional EV charging. Peak Guard still sees raw gridPowerW.
      controlGridPowerW: selectedGridW - evActualPowerW,
      gridAverage5sW,
      evActualPowerW: Math.round(evActualPowerW),
      controlGridSource: `${useLiveGrid ? 'live_pv_delta' : 'average_5s'}${evActualPowerW > 0 ? '_ev_isolated' : ''}`,
      pvDeltaW: Number(pvDeltaW) || 0,
      planningForecastDay: this.getPlanningForecastDay(now),
      planningDecisionSource: this.state.nightPlanningDecisionSource || '',
      nightPlanningActive: this.isNightPlanningPhase(now),
      lowForecastSunnyOverrideActive: this.isLowForecastSunnyOverrideActive(settings, now),
    };
  }

  getInputReadiness(settings = this.getSettings()) {
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const missing = [];
    const degraded = [];
    const now = Date.now();
    // The grid meter is the only hard control prerequisite. If it is absent or
    // stale we cannot know import/export and therefore must not steer batteries.
    const gridTimeoutMs = Math.max(60000, Math.max(1, Number(settings.commandIntervalSeconds) || 10) * 6000);
    const gridFresh = Boolean(this.inputSeen.grid)
      && Number(this.inputUpdatedAt.grid || 0) > 0
      && (now - Number(this.inputUpdatedAt.grid)) <= gridTimeoutMs;
    if (!gridFresh) missing.push(this.inputSeen.grid ? 'netvermogen verouderd' : 'netvermogen');

    // PV and forecast improve planning but are not proof of actual grid flow.
    // The grid meter remains authoritative for self-consumption and export capture.
    if (!this.inputSeen.pv) degraded.push('PV-vermogen');
    if (!this.inputSeen.forecast) degraded.push('PV-voorspelling');
    if (!this.inputSeen.forecastTomorrow) degraded.push('PV-voorspelling morgen');

    const batterySocAvailable = Array.from({ length: count }, (_, index) => {
      if (!this.inputSeen.batterySoc[index]) return false;
      return Number.isFinite(Number(this.state.batterySoc[index]));
    });
    for (let i = 0; i < count; i += 1) {
      if (!batterySocAvailable[i]) degraded.push(`SoC batterij ${i + 1}`);
    }

    if (isDynamicContract(settings)) {
      const slots = this.getHomeyEngineSlots(settings);
      if (!slots.length) {
        degraded.push('Homey Energy prijs-slots');
      }
    }
    return {
      ready: missing.length === 0,
      missing,
      degraded,
      gridFresh,
      gridAgeSeconds: this.inputSeen.grid && this.inputUpdatedAt.grid
        ? Math.max(0, Math.round((now - this.inputUpdatedAt.grid) / 1000))
        : null,
      priceDataReady: !degraded.some(item => item.includes('prijs-slots')),
      forecastDataReady: Boolean(this.inputSeen.forecast),
      forecastTomorrowDataReady: Boolean(this.inputSeen.forecastTomorrow),
      batterySocAgeSeconds: Array.from({ length: count }, (_, index) => this.inputSeen.batterySoc[index] && this.inputUpdatedAt.batterySoc[index]
        ? Math.max(0, Math.round((now - this.inputUpdatedAt.batterySoc[index]) / 1000))
        : null),
      received: {
        grid: gridFresh,
        pv: this.inputSeen.pv,
        forecast: this.inputSeen.forecast,
        forecastTomorrow: this.inputSeen.forecastTomorrow,
        batterySoc: batterySocAvailable,
      },
    };
  }

  createSafetyResult(calculated, settings, readiness) {
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const calculatedCommands = calculated.commands.slice(0, count);
    const calculatedTotalCommandW = calculated.totalCommandW;
    const chargeTestPassed = this.isChargeTestValid(settings);
    const controlEnabled = Boolean(settings.controlEnabled) && chargeTestPassed;
    const canPublishCommands = readiness.ready && controlEnabled;
    const actualInternalCommands = Array.from({ length: count }, (_, index) => Number(this.lastEmittedCommands[index]) || 0);
    const actualCommands = actualInternalCommands.map(value => this.toPublishedCommand(value, settings));
    const actualTotal = actualCommands.reduce((sum, value) => sum + value, 0);

    if (!readiness.ready) {
      return {
        ...calculated,
        baseMode: 'waiting_input',
        modeLabel: 'Wachten op data',
        override: null,
        overrideLabel: '',
        statusText: `Wachten op data: ${readiness.missing.join(', ')}`,
        calculatedCommands,
        calculatedTotalCommandW,
        candidateCommands: Array(count).fill(0),
        candidateTotalCommandW: 0,
        outputCommands: actualCommands,
        outputTotalCommandW: actualTotal,
        commands: calculatedCommands,
        totalCommandW: calculatedTotalCommandW,
        plannedChargeW: 0,
        gridChargeAssistW: 0,
        inputReady: false,
        missingInputs: readiness.missing,
        degradedInputs: readiness.degraded || [],
        priceDataReady: readiness.priceDataReady !== false,
        inputsReceived: readiness.received,
        controlEnabled,
        canPublishCommands: false,
      };
    }

    let safeStatusText = calculated.statusText;
    const degraded = Array.isArray(readiness.degraded) ? readiness.degraded : [];
    const notes = [];
    if (degraded.some(item => item.includes('prijs-slots'))) notes.push('prijsdata ontbreekt');
    if (degraded.includes('PV-voorspelling')) notes.push('forecast vandaag/resterend ontbreekt');
    if (degraded.includes('PV-voorspelling morgen')) notes.push('forecast morgen ontbreekt: veiligheids-SoC blijft actief');
    if (degraded.includes('PV-vermogen')) notes.push('PV-meting ontbreekt: netmeting gebruikt');
    const missingSoc = degraded.filter(item => item.startsWith('SoC batterij'));
    if (missingSoc.length) notes.push(`${missingSoc.join(', ')} uitgesloten`);
    if (notes.length) safeStatusText = `${calculated.statusText} · ${notes.join(' · ')}`;
    return {
      ...calculated,
      statusText: controlEnabled ? safeStatusText : `SIMULATIE · ${safeStatusText}`,
      calculatedCommands,
      calculatedTotalCommandW,
      candidateCommands: canPublishCommands ? calculatedCommands : Array(count).fill(0),
      candidateTotalCommandW: canPublishCommands ? calculatedTotalCommandW : 0,
      outputCommands: controlEnabled ? actualCommands : Array(count).fill(0),
      outputTotalCommandW: controlEnabled ? actualTotal : 0,
      inputReady: true,
      missingInputs: [],
      degradedInputs: readiness.degraded || [],
      priceDataReady: readiness.priceDataReady !== false,
      inputsReceived: readiness.received,
      controlEnabled,
      canPublishCommands,
    };
  }

  updateBalanceHealth(result, settings) {
    const now = Date.now();
    const monitor = this.balanceMonitor;
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const values = Array.from({ length: count }, (_, index) => {
      if (!this.inputSeen.batterySoc[index]) return null;
      const value = Number(this.state.batterySoc[index]);
      return Number.isFinite(value) ? value : null;
    });
    const valid = values.length === count && values.every(value => value !== null);
    const active = Boolean(settings.balanceEnabled)
      && Boolean(settings.balanceWarningEnabled)
      && result.inputReady
      && result.controlEnabled
      && Math.abs(result.outputTotalCommandW || 0) >= Math.max(0, Number(settings.balanceWarningMinCommandW) || 0);

    if (!valid || !active) {
      monitor.baselineSpread = null;
      monitor.worseningSince = null;
      monitor.warningActive = false;
      monitor.warningText = '';
      return '';
    }

    const minSoc = Math.min(...values);
    const maxSoc = Math.max(...values);
    const lowIndex = values.indexOf(minSoc);
    const highIndex = values.indexOf(maxSoc);
    const spread = Math.round((maxSoc - minSoc) * 10) / 10;
    const growthLimit = Math.max(0.1, Number(settings.balanceWarningGrowthPct) || 1.5);
    const spreadLimit = Math.max(0.1, Number(settings.balanceWarningSpreadPct) || 4);
    const delayMs = Math.max(1, Number(settings.balanceWarningDelayMinutes) || 15) * 60000;

    if (monitor.baselineSpread === null || spread < monitor.baselineSpread) {
      monitor.baselineSpread = spread;
      monitor.worseningSince = null;
      monitor.warningActive = false;
      monitor.warningText = '';
      return '';
    }

    if (spread >= spreadLimit && spread >= monitor.baselineSpread + growthLimit) {
      if (!monitor.worseningSince) monitor.worseningSince = now;
      if ((now - monitor.worseningSince) >= delayMs) {
        const baseline = Math.round(monitor.baselineSpread * 10) / 10;
        const message = `Battery Balance wordt slechter: SoC-spreiding steeg van ${baseline}% naar ${spread}% (B${lowIndex + 1} ${minSoc}%, B${highIndex + 1} ${maxSoc}%). Controleer of iedere batterij-SoC aan dezelfde Battery X Command gekoppeld is.`;
        monitor.warningText = message;
        if (!monitor.warningActive) {
          monitor.warningActive = true;
          monitor.lastWarningAt = now;
          this.balanceWarningTrigger.trigger({
            message,
            spread,
            baseline_spread: baseline,
            lowest_battery: lowIndex + 1,
            highest_battery: highIndex + 1,
          }).catch(err => this.error('Battery Balance warning trigger failed', err));
        }
        return message;
      }
    } else {
      monitor.worseningSince = null;
      monitor.warningActive = false;
      monitor.warningText = '';
    }

    return monitor.warningText || '';
  }

  getAverageBatterySoc(settings = this.getSettings()) {
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const values = [];
    for (let index = 0; index < count; index += 1) {
      if (!this.inputSeen.batterySoc[index]) continue;
      const value = Number(this.state.batterySoc[index]);
      if (Number.isFinite(value)) values.push(value);
    }
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }


  isPvCurtailmentSocAllowed(settings = this.getSettings()) {
    const averageBatterySoc = this.getAverageBatterySoc(settings);
    const configured = Number(settings.pvCurtailMinBatterySoc);
    const minBatterySoc = Math.max(0, Math.min(100, Number.isFinite(configured) ? configured : 95));
    return averageBatterySoc !== null && averageBatterySoc >= minBatterySoc;
  }

  getPvCurtailmentHeadroomW(settings = this.getSettings()) {
    if (!this.inputSeen.pv || !this.isPvCurtailmentSocAllowed(settings)) return 0;
    const pv = Math.max(0, Number(this.state.pvPowerW) || 0);
    const limit = Number(this.lastPublishedPvLimitPercent);
    if (!Number.isFinite(limit) || limit >= 99.9 || limit <= 0 || pv <= 0) return 0;
    const estimatedFull = pv * (100 / Math.max(10, limit));
    return Math.max(0, estimatedFull - pv);
  }

  clearEvPvSession() {
    if (!this.evPvSession) this.evPvSession = { active: false, rateId: '', overImportSince: 0 };
    this.evPvSession.active = false;
    this.evPvSession.rateId = '';
    this.evPvSession.overImportSince = 0;
  }

  isEvPvSessionActiveForTariff(tariff = null, settings = this.getSettings()) {
    if (!this.evPvSession?.active || String(settings.contractType || '') !== 'tou') return false;
    const rateId = String(tariff?.rateId || '');
    return Boolean(rateId) && rateId === String(this.evPvSession.rateId || '');
  }

  syncEvPvSessionFromDecision(decision, chargeMode = null, settings = this.getSettings()) {
    if (!this.evPvSession) this.evPvSession = { active: false, rateId: '', overImportSince: 0 };
    const controlType = this.getEvControlType(settings);
    const outputActive = controlType === 'mode'
      ? chargeMode === 'smart'
      : Boolean(decision?.allowed && Number(decision?.desiredCurrentA || 0) > 0);
    const source = String(decision?.source || 'off');
    const rateId = String(decision?.tariffRateId || '');
    const pvOnly = outputActive && Boolean(decision?.pvTariffHysteresisEnabled) && source === 'pv' && Boolean(rateId);
    const pvHold = outputActive && source === 'pv_hold' && this.evPvSession.active;

    if (pvOnly) {
      if (!this.evPvSession.active || this.evPvSession.rateId !== rateId) {
        this.evPvSession.overImportSince = 0;
      }
      this.evPvSession.active = true;
      this.evPvSession.rateId = rateId;
      return;
    }
    if (pvHold) return;

    // Standard/tariff/guarantee charging has its own permission and therefore
    // must not inherit the PV-only stop timer. Only pure PV / PV-hold sessions
    // keep this latch.
    this.clearEvPvSession();
  }

  applyEvPvSessionHysteresis(request, result, settings, now = Date.now()) {
    if (!request || !this.isEvPvSessionActiveForTariff({ rateId: request.tariffRateId }, settings)) return request;
    if (String(settings.evMode || 'smart') !== 'smart' || !Boolean(settings.evEnabled) || !request.connected) {
      this.clearEvPvSession();
      return request;
    }

    // Peak Guard remains absolute and never waits for the PV stop timer.
    if (Boolean(settings.peakShaveEnabled) && String(result?.action || '') === 'peak_shave') {
      this.clearEvPvSession();
      return { ...request, allowed: false, desiredCurrentA: 0, desiredPowerW: 0, requestedCurrentA: 0, requestedPowerW: 0, pvRequestPowerW: 0, gridRequestPowerW: 0, peakLimited: true, source: 'off', reason: 'Peak Guard stopt EV onmiddellijk' };
    }

    // If another valid reason now permits charging, leave the PV-only session;
    // tariff/guarantee charging is governed by its own rules.
    if (request.allowed && !['pv', 'pv_hold'].includes(String(request.source || 'off'))) {
      this.clearEvPvSession();
      return request;
    }

    const stopGridImportW = Math.max(0, Number(request.pvTariffStopGridImportW) || 0);
    const stopDelaySeconds = 60;
    const gridW = Number(this.state.gridPowerW);
    const importingTooMuch = Number.isFinite(gridW) && gridW >= stopGridImportW;

    if (importingTooMuch) {
      if (!Number(this.evPvSession.overImportSince)) this.evPvSession.overImportSince = now;
      const elapsedMs = Math.max(0, now - Number(this.evPvSession.overImportSince));
      if (stopDelaySeconds <= 0 || elapsedMs >= stopDelaySeconds * 1000) {
        this.clearEvPvSession();
        return { ...request, allowed: false, desiredCurrentA: 0, desiredPowerW: 0, requestedCurrentA: 0, requestedPowerW: 0, pvRequestPowerW: 0, gridRequestPowerW: 0, source: 'off', reason: `EV PV-laden gestopt: netafname ${Math.round(gridW)} W gedurende ${Math.round(stopDelaySeconds)} s` };
      }
    } else {
      this.evPvSession.overImportSince = 0;
    }

    if (request.allowed && String(request.source || '') === 'pv') return request;

    const remainingSeconds = importingTooMuch
      ? Math.max(0, Math.ceil(stopDelaySeconds - ((now - Number(this.evPvSession.overImportSince || now)) / 1000)))
      : stopDelaySeconds;
    if (this.getEvControlType(settings) === 'current') {
      const minA = Math.max(1, Math.min(64, Math.round(Number(settings.evMinCurrentA) || 6)));
      const powerW = Math.round(minA * evPowerPerAmp(settings));
      return {
        ...request,
        allowed: true,
        desiredCurrentA: minA,
        desiredPowerW: powerW,
        requestedCurrentA: minA,
        requestedPowerW: powerW,
        pvRequestPowerW: Math.min(powerW, Math.max(0, Number(request.pvAvailableW) || 0)),
        gridRequestPowerW: Math.max(0, powerW - Math.max(0, Number(request.pvAvailableW) || 0)),
        source: 'pv_hold',
        pvSessionHoldActive: true,
        reason: importingTooMuch
          ? `PV-laadsessie actief · stop bij ${Math.round(stopGridImportW)} W netafname over ${remainingSeconds} s`
          : `PV-laadsessie actief · stop pas na ${Math.round(stopDelaySeconds)} s boven ${Math.round(stopGridImportW)} W netafname`,
      };
    }

    return {
      ...request,
      allowed: true,
      desiredCurrentA: 0,
      desiredPowerW: 0,
      requestedCurrentA: 0,
      requestedPowerW: 0,
      pvRequestPowerW: 0,
      gridRequestPowerW: 0,
      source: 'pv_hold',
      pvSessionHoldActive: true,
      reason: importingTooMuch
        ? `PV-laadsessie actief · stop bij ${Math.round(stopGridImportW)} W netafname over ${remainingSeconds} s`
        : `PV-laadsessie actief · stop pas na ${Math.round(stopDelaySeconds)} s boven ${Math.round(stopGridImportW)} W netafname`,
    };
  }


  clearEvPvSessionFor(index) {
    if (index === 0) return this.clearEvPvSession();
    const runtime = this.getExtraEv(index);
    if (!runtime) return;
    runtime.pvSession = { active: false, rateId: '', overImportSince: 0 };
  }

  isEvPvSessionActiveForTariffFor(index, tariff = null, settings = this.getSettings()) {
    if (index === 0) return this.isEvPvSessionActiveForTariff(tariff, settings);
    const runtime = this.getExtraEv(index);
    if (!runtime?.pvSession?.active || String(settings.contractType || '') !== 'tou') return false;
    const rateId = String(tariff?.rateId || '');
    return Boolean(rateId) && rateId === String(runtime.pvSession.rateId || '');
  }

  syncEvPvSessionFromDecisionFor(index, decision, chargeMode = null, settings = this.getSettings()) {
    if (index === 0) return this.syncEvPvSessionFromDecision(decision, chargeMode, settings);
    const runtime = this.getExtraEv(index);
    if (!runtime) return;
    if (!runtime.pvSession) runtime.pvSession = { active: false, rateId: '', overImportSince: 0 };
    const controlType = this.getEvControlType(settings);
    const outputActive = controlType === 'mode'
      ? chargeMode === 'smart'
      : Boolean(decision?.allowed && Number(decision?.desiredCurrentA || 0) > 0);
    const source = String(decision?.source || 'off');
    const rateId = String(decision?.tariffRateId || '');
    const pvOnly = outputActive && Boolean(decision?.pvTariffHysteresisEnabled) && source === 'pv' && Boolean(rateId);
    const pvHold = outputActive && source === 'pv_hold' && runtime.pvSession.active;
    if (pvOnly) {
      if (!runtime.pvSession.active || runtime.pvSession.rateId !== rateId) runtime.pvSession.overImportSince = 0;
      runtime.pvSession.active = true;
      runtime.pvSession.rateId = rateId;
      return;
    }
    if (pvHold) return;
    this.clearEvPvSessionFor(index);
  }

  applyEvPvSessionHysteresisFor(index, request, result, settings, gridPowerW = this.state.gridPowerW, now = Date.now()) {
    if (index === 0) return this.applyEvPvSessionHysteresis(request, result, settings, now);
    const runtime = this.getExtraEv(index);
    if (!runtime || !request || !this.isEvPvSessionActiveForTariffFor(index, { rateId: request.tariffRateId }, settings)) return request;
    if (String(settings.evMode || 'smart') !== 'smart' || !Boolean(settings.evEnabled) || !request.connected) {
      this.clearEvPvSessionFor(index);
      return request;
    }
    if (Boolean(settings.peakShaveEnabled) && String(result?.action || '') === 'peak_shave') {
      this.clearEvPvSessionFor(index);
      return { ...request, allowed: false, desiredCurrentA: 0, desiredPowerW: 0, requestedCurrentA: 0, requestedPowerW: 0, pvRequestPowerW: 0, gridRequestPowerW: 0, peakLimited: true, source: 'off', reason: 'Peak Guard stopt EV onmiddellijk' };
    }
    if (request.allowed && !['pv', 'pv_hold'].includes(String(request.source || 'off'))) {
      this.clearEvPvSessionFor(index);
      return request;
    }
    const stopGridImportW = Math.max(0, Number(request.pvTariffStopGridImportW) || 0);
    const stopDelaySeconds = Math.max(0, Number(request.pvTariffStopDelaySeconds) || 60);
    const gridW = Number(gridPowerW);
    const importingTooMuch = Number.isFinite(gridW) && gridW >= stopGridImportW;
    if (importingTooMuch) {
      if (!Number(runtime.pvSession.overImportSince)) runtime.pvSession.overImportSince = now;
      const elapsedMs = Math.max(0, now - Number(runtime.pvSession.overImportSince));
      if (stopDelaySeconds <= 0 || elapsedMs >= stopDelaySeconds * 1000) {
        this.clearEvPvSessionFor(index);
        return { ...request, allowed: false, desiredCurrentA: 0, desiredPowerW: 0, requestedCurrentA: 0, requestedPowerW: 0, pvRequestPowerW: 0, gridRequestPowerW: 0, source: 'off', reason: `EV PV-laden gestopt: netafname ${Math.round(gridW)} W gedurende ${Math.round(stopDelaySeconds)} s` };
      }
    } else runtime.pvSession.overImportSince = 0;
    if (request.allowed && String(request.source || '') === 'pv') return request;
    const remainingSeconds = importingTooMuch
      ? Math.max(0, Math.ceil(stopDelaySeconds - ((now - Number(runtime.pvSession.overImportSince || now)) / 1000)))
      : stopDelaySeconds;
    if (this.getEvControlType(settings) === 'current') {
      const minA = Math.max(1, Math.min(64, Math.round(Number(settings.evMinCurrentA) || 6)));
      const powerW = Math.round(minA * evPowerPerAmp(settings));
      return {
        ...request, allowed: true, desiredCurrentA: minA, desiredPowerW: powerW,
        requestedCurrentA: minA, requestedPowerW: powerW,
        pvRequestPowerW: Math.min(powerW, Math.max(0, Number(request.pvAvailableW) || 0)),
        gridRequestPowerW: Math.max(0, powerW - Math.max(0, Number(request.pvAvailableW) || 0)),
        source: 'pv_hold', pvSessionHoldActive: true,
        reason: importingTooMuch
          ? `PV-laadsessie actief · stop bij ${Math.round(stopGridImportW)} W netafname over ${remainingSeconds} s`
          : `PV-laadsessie actief · stop pas na ${Math.round(stopDelaySeconds)} s boven ${Math.round(stopGridImportW)} W netafname`,
      };
    }
    return {
      ...request, allowed: true, desiredCurrentA: 0, desiredPowerW: 0,
      requestedCurrentA: 0, requestedPowerW: 0, pvRequestPowerW: 0, gridRequestPowerW: 0,
      source: 'pv_hold', pvSessionHoldActive: true,
      reason: importingTooMuch
        ? `PV-laadsessie actief · stop bij ${Math.round(stopGridImportW)} W netafname over ${remainingSeconds} s`
        : `PV-laadsessie actief · stop pas na ${Math.round(stopDelaySeconds)} s boven ${Math.round(stopGridImportW)} W netafname`,
    };
  }

  calculateAdditionalEvControl(index, result = this.latestResult, nextBatteryCommandW = this.state.lastTotalCommandW, currentBatteryCommandW = this.state.lastTotalCommandW, adjustedGridPowerW = this.state.gridPowerW, options = {}) {
    const storedSettings = this.getSettings();
    const runtimeBase = this.getRuntimeSettings(storedSettings);
    const settings = this.getEvInstanceSettings(index, runtimeBase);
    settings.evMode = this.getEffectiveEvModeFor(index, storedSettings);
    const input = this.getEvInputSnapshot(index);
    const readiness = this.getInputReadiness(storedSettings);
    const connected = Boolean(input?.seen?.connected) && Boolean(input?.connected);
    const soc = input?.seen?.soc ? Number(input.soc) : NaN;
    const actualCurrentA = input?.seen?.chargeCurrent ? Math.max(0, Number(input.chargeCurrentA) || 0) : 0;
    if (!readiness.ready) {
      return {
        instance: index + 1, enabled: Boolean(settings.evEnabled), connected,
        soc: Number.isFinite(soc) ? soc : null, targetSoc: Number(settings.evTargetSoc) || 80,
        desiredCurrentA: 0, desiredPowerW: 0, actualCurrentA,
        actualPowerW: Math.round(actualCurrentA * evPowerPerAmp(settings)), allowed: false,
        source: 'off', reason: 'Wachten op geldige netmeting', peakLimited: true,
        tariffLabel: String(result?.tariff?.label || ''), pvAvailableW: 0,
        energyNeedKwh: null, deadlineAt: null, guaranteeActive: false,
      };
    }
    const tariff = result?.tariff || findCurrentTariff(new Date(), settings);
    let decision = calculateEvDecision({
      settings,
      now: new Date(),
      tariff,
      connected,
      soc,
      actualCurrentA,
      gridPowerW: Number(adjustedGridPowerW) || 0,
      currentBatteryCommandW,
      nextBatteryCommandW,
      pvHeadroomW: this.getPvCurtailmentHeadroomW(settings),
      pvSessionActive: this.isEvPvSessionActiveForTariffFor(index, tariff, settings),
      skipPeakLimit: Boolean(options.skipPeakLimit),
    });
    decision = this.applyEvPvSessionHysteresisFor(index, decision, result, settings, adjustedGridPowerW);
    return { ...decision, instance: index + 1 };
  }

  calculateEvControl(result = this.latestResult, nextBatteryCommandW = this.state.lastTotalCommandW, currentBatteryCommandW = this.state.lastTotalCommandW) {
    const storedSettings = this.getSettings();
    const settings = this.getRuntimeSettings(storedSettings);
    const readiness = this.getInputReadiness(storedSettings);
    const connected = Boolean(this.inputSeen.ev?.connected) && Boolean(this.state.evConnected);
    const soc = this.inputSeen.ev?.soc ? Number(this.state.evSoc) : NaN;
    const actualCurrentA = this.inputSeen.ev?.chargeCurrent ? Math.max(0, Number(this.state.evChargeCurrentA) || 0) : 0;

    if (!readiness.ready) {
      return {
        enabled: Boolean(settings.evEnabled), connected, soc: Number.isFinite(soc) ? soc : null,
        targetSoc: Number(settings.evTargetSoc) || 80, desiredCurrentA: 0, desiredPowerW: 0,
        actualCurrentA, actualPowerW: Math.round(actualCurrentA * evPowerPerAmp(settings)),
        allowed: false, source: 'off', reason: 'Wachten op geldige netmeting', peakLimited: true,
        tariffLabel: String(result?.tariff?.label || ''), pvAvailableW: 0, energyNeedKwh: null,
        deadlineAt: null, guaranteeActive: false,
      };
    }

    let decision = calculateEvDecision({
      settings,
      now: new Date(),
      tariff: result?.tariff || findCurrentTariff(new Date(), settings),
      connected,
      soc,
      actualCurrentA,
      gridPowerW: Number(this.state.gridPowerW) || 0,
      currentBatteryCommandW,
      nextBatteryCommandW,
      pvHeadroomW: this.getPvCurtailmentHeadroomW(settings),
      pvSessionActive: this.isEvPvSessionActiveForTariff(result?.tariff || findCurrentTariff(new Date(), settings), settings),
    });
    decision = this.applyEvPvSessionHysteresis(decision, result, settings);
    return decision;
  }

  shouldUseEvPeakGuardBatteryAssist(settings = this.getSettings(), mode = 'smart', source = '') {
    if (!Boolean(settings.peakShaveEnabled)) return false;
    if (String(mode) === 'emergency') return Boolean(settings.evPeakGuardBatteryAssistEmergency);
    // Pure PV charging must never drain the home battery merely to keep an EV
    // session alive. The normal option applies to Smart tariff/guarantee
    // charging and SoC-target charging.
    if (['pv', 'pv_hold'].includes(String(source || ''))) return false;
    return Boolean(settings.evPeakGuardBatteryAssistNormal);
  }

  getEvPeakGuardBatteryAssistAllocation(targetDischargeW, settings = this.getSettings()) {
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const configuredGroupMax = Math.max(0, Number(settings.maxTotalDischargeW) || Number(DEFAULTS.maxTotalDischargeW) || 0);
    const target = Math.max(0, Math.min(configuredGroupMax, Number(targetDischargeW) || 0));
    if (target <= 0) return { commands: Array(count).fill(0), totalW: 0 };

    const minSoc = Math.max(0, Math.min(100, Number(settings.minSoc) || 0));
    let commands = distributeCommand(target, { batterySoc: this.state.batterySoc }, settings, { dischargeFloorSoc: minSoc });
    commands = commands.slice(0, count).map(value => Math.max(0, roundBatteryCommand(value, settings)));
    const totalW = Math.min(configuredGroupMax, commands.reduce((sum, value) => sum + (Number(value) || 0), 0));
    return { commands, totalW };
  }

  applyEvPeakGuardBatteryAssist(result, allocation, settings = this.getSettings()) {
    if (!result || !allocation || !Boolean(result.canPublishCommands)) return 0;
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const commands = Array.from({ length: count }, (_, index) => Math.max(0, Number(allocation.commands?.[index]) || 0));
    const total = commands.reduce((sum, value) => sum + value, 0);

    // A 0 W assist request may still be meaningful: when the battery was
    // scheduled to charge, cancelling that charge can create enough Peak Guard
    // room for the EV without actually discharging the home battery. Never
    // replace an already-positive discharge command with 0 W.
    if (!(total > 0) && Number(result.candidateTotalCommandW) >= 0) return 0;

    result.candidateCommands = commands.slice();
    result.candidateTotalCommandW = total;
    result.calculatedCommands = commands.slice();
    result.calculatedTotalCommandW = total;
    result.commands = commands.slice();
    result.totalCommandW = total;
    result.gridChargeAssistW = 0;
    result.pvChargeW = 0;
    if (total > 0) {
      result.override = 'peak_shave';
      result.overrideLabel = 'Peak Guard';
    }
    this.refreshBatteryPresentationAfterCoordination(result, settings);
    return total;
  }

  coordinateAdditionalEvPeakGuardBatteryAssist(result, storedSettings = this.getSettings()) {
    if (!result || !Boolean(result.canPublishCommands)) return 0;
    const runtimeSettings = this.getRuntimeSettings(storedSettings);
    if (!Boolean(runtimeSettings.peakShaveEnabled)) return 0;
    const evCount = this.getEvCount(storedSettings);
    if (evCount <= 1) return 0;

    const softTargetW = Math.max(0, (Number(runtimeSettings.peakLimitW) || 0) - Math.max(0, Number(runtimeSettings.peakSoftMarginW) || 0));
    const currentBatteryW = Number(this.state.lastTotalCommandW) || 0;
    let nextBatteryW = Number(result.candidateTotalCommandW) || 0;
    let adjustedGridW = Number(this.state.gridPowerW) || 0;
    let startReserved = false;
    let highestAssistW = 0;

    // Mirror publishFlexibleLoads' sequential grid accounting so an additional
    // EV only receives battery-backed Peak Guard room that is still available
    // after the EVs ahead of it. At most one previously inactive EV may start in
    // a single slow control pass, exactly like the output publisher.
    if (evCount > 0 && result.evDecision) {
      const input = this.getEvInputSnapshot(0) || {};
      const settings = this.getEvInstanceSettings(0, storedSettings);
      const actualPowerW = Math.max(0, Number(input.chargeCurrentA) || 0) * evPowerPerAmp(settings);
      const previousActive = this.isEvOutputActiveFor(0, storedSettings);
      const desiredActive = this.isEvDecisionOutputActiveFor(0, result.evDecision, storedSettings);
      if (!previousActive && desiredActive) startReserved = true;
      const desiredPowerW = desiredActive
        ? (Math.max(0, Number(result.evDecision.desiredPowerW) || 0) || actualPowerW)
        : 0;
      adjustedGridW += desiredPowerW - actualPowerW;
    }

    for (let index = 1; index < evCount; index += 1) {
      const instanceSettings = this.getEvInstanceSettings(index, runtimeSettings);
      instanceSettings.evMode = this.getEffectiveEvModeFor(index, storedSettings);
      const input = this.getEvInputSnapshot(index) || {};
      const actualCurrentA = input?.seen?.chargeCurrent ? Math.max(0, Number(input.chargeCurrentA) || 0) : 0;
      const actualPowerW = actualCurrentA * evPowerPerAmp(instanceSettings);
      const previousActive = this.isEvOutputActiveFor(index, storedSettings);

      let decision = this.calculateAdditionalEvControl(index, result, nextBatteryW, currentBatteryW, adjustedGridW);
      const unbounded = this.calculateAdditionalEvControl(index, result, nextBatteryW, currentBatteryW, adjustedGridW, { skipPeakLimit: true });
      const mayStartThisPass = previousActive || !startReserved;
      const useAssist = mayStartThisPass
        && Boolean(unbounded?.allowed)
        && Number(unbounded?.requestedPowerW || unbounded?.desiredPowerW) > 0
        && this.shouldUseEvPeakGuardBatteryAssist(instanceSettings, instanceSettings.evMode, unbounded?.source);

      if (useAssist) {
        const baseGridWithoutBatteryEvW = adjustedGridW + currentBatteryW - actualPowerW;
        const maxAssist = this.getEvPeakGuardBatteryAssistAllocation(
          Number(runtimeSettings.maxTotalDischargeW) || Number(DEFAULTS.maxTotalDischargeW) || 0,
          runtimeSettings,
        );
        const requestedPowerW = Math.max(0, Number(unbounded.requestedPowerW || unbounded.desiredPowerW) || 0);
        const requestedCurrentA = Math.max(0, Number(unbounded.requestedCurrentA) || this.getEvCurrentForPower(requestedPowerW, instanceSettings));
        const maxSupportedEvPowerW = Math.max(0, softTargetW + maxAssist.totalW - baseGridWithoutBatteryEvW);
        let finalCurrentA = this.getEvCurrentForPower(Math.min(requestedPowerW, maxSupportedEvPowerW), instanceSettings);
        if (this.getEvControlType(instanceSettings) === 'mode' && finalCurrentA < requestedCurrentA) finalCurrentA = 0;

        const baselineCurrentA = Math.max(0, Number(decision?.desiredCurrentA) || 0);
        if (finalCurrentA > baselineCurrentA) {
          const finalPowerW = finalCurrentA * evPowerPerAmp(instanceSettings);
          const requiredDischargeW = Math.max(0, baseGridWithoutBatteryEvW + finalPowerW - softTargetW);
          const allocation = this.getEvPeakGuardBatteryAssistAllocation(requiredDischargeW, runtimeSettings);
          const appliedAssistW = this.applyEvPeakGuardBatteryAssist(result, allocation, runtimeSettings);
          if (appliedAssistW + 1 >= requiredDischargeW || requiredDischargeW <= 1) {
            nextBatteryW = Number(result.candidateTotalCommandW) || 0;
            highestAssistW = Math.max(highestAssistW, appliedAssistW);
            decision = this.calculateAdditionalEvControl(index, result, nextBatteryW, currentBatteryW, adjustedGridW);
          }
        }
      }

      let desiredActive = this.isEvDecisionOutputActiveFor(index, decision, storedSettings);
      if (!previousActive && desiredActive) {
        if (startReserved) desiredActive = false;
        else startReserved = true;
      }
      const desiredPowerW = desiredActive
        ? (Math.max(0, Number(decision?.desiredPowerW) || 0) || actualPowerW)
        : 0;
      adjustedGridW += desiredPowerW - actualPowerW;
    }

    return highestAssistW;
  }

  getEvCurrentForPower(powerW, settings = this.getSettings()) {
    const perAmpW = evPowerPerAmp(settings);
    const minA = Math.max(1, Math.min(64, Math.round(Number(settings.evMinCurrentA) || 6)));
    const maxA = Math.max(minA, Math.min(64, Math.round(Number(settings.evMaxCurrentA) || 32)));
    if (!Number.isFinite(Number(powerW)) || Number(powerW) <= 0 || perAmpW <= 0) return 0;
    const amps = Math.floor(Number(powerW) / perAmpW);
    if (amps < minA) return 0;
    return Math.max(minA, Math.min(maxA, amps));
  }

  allocateFlexiblePair(firstRequestW, secondRequestW, availableW, mode = 'first') {
    const firstReq = Math.max(0, Number(firstRequestW) || 0);
    const secondReq = Math.max(0, Number(secondRequestW) || 0);
    if (!Number.isFinite(Number(availableW))) return { first: firstReq, second: secondReq };
    const available = Math.max(0, Number(availableW) || 0);
    if (mode === 'second') {
      const second = Math.min(secondReq, available);
      const first = Math.min(firstReq, Math.max(0, available - second));
      return { first, second };
    }
    if (mode === 'share') {
      let first = Math.min(firstReq, available / 2);
      let second = Math.min(secondReq, available / 2);
      let left = Math.max(0, available - first - second);
      const firstNeed = Math.max(0, firstReq - first);
      const secondNeed = Math.max(0, secondReq - second);
      if (left > 0 && firstNeed > 0) {
        const add = Math.min(firstNeed, left);
        first += add;
        left -= add;
      }
      if (left > 0 && secondNeed > 0) second += Math.min(secondNeed, left);
      return { first, second };
    }
    const first = Math.min(firstReq, available);
    const second = Math.min(secondReq, Math.max(0, available - first));
    return { first, second };
  }

  refreshBatteryPresentationAfterCoordination(result, settings = this.getSettings(), totalCommandOverrideW = null) {
    if (!result) return result;
    const overrideProvided = totalCommandOverrideW !== null && totalCommandOverrideW !== undefined;
    const overrideW = Number(totalCommandOverrideW);
    const totalCommandW = overrideProvided && Number.isFinite(overrideW) ? overrideW : Number(result.candidateTotalCommandW);
    if (!Number.isFinite(totalCommandW)) return result;

    const previousWorkingModeLabel = String(result.workingModeLabel || result.actionLabel || result.modeLabel || '');
    const finalChargeW = Math.max(0, -totalCommandW);
    const finalDischargeW = Math.max(0, totalCommandW);
    let gridChargeW = 0;
    let pvChargeW = 0;

    if (finalChargeW > 0) {
      const measuredGridW = Number(this.state?.gridPowerW);
      if (overrideProvided && Boolean(this.inputSeen?.grid) && Number.isFinite(measuredGridW)) {
        // The meter is authoritative for the physical source of charging. Any
        // simultaneous net import can supply at most that much of the battery
        // charge; the remainder is PV surplus. This prevents a Split Command
        // minimum/hold remainder from being labelled as solar while importing.
        gridChargeW = Math.min(finalChargeW, Math.max(0, measuredGridW));
        pvChargeW = Math.max(0, finalChargeW - gridChargeW);
      } else if (String(result.baseMode || '') === 'manual_charge') {
        // Fallback only before a valid grid measurement has been received.
        gridChargeW = finalChargeW;
      } else if (String(result.baseMode || '') === 'charge' || Number(result.gridChargeAssistW) > 0) {
        gridChargeW = Math.min(finalChargeW, Math.max(0, Number(result.gridChargeAssistW) || 0));
        pvChargeW = Math.max(0, finalChargeW - gridChargeW);
      } else {
        pvChargeW = finalChargeW;
      }
    }

    result.gridChargeAssistW = Math.round(gridChargeW);
    result.pvChargeW = Math.round(pvChargeW);

    const actionThresholdW = Math.max(25, Math.max(0, Number(settings.commandDeadbandW) || 25));
    let action = 'idle';
    let actionLabel = 'Rust';
    if (String(result.override || '') === 'peak_shave' && finalDischargeW > 0) {
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
      action = String(result.baseMode || '') === 'avoid_import' ? 'avoid_grid_import' : 'discharge';
      actionLabel = action === 'avoid_grid_import'
        ? `Netimport vermijden ${Math.round(finalDischargeW)} W`
        : `Ontladen ${Math.round(finalDischargeW)} W`;
    }

    const workingModeLabel = actionLabel === 'Rust'
      ? String(result.modeLabel || 'Zelfconsumptie')
      : actionLabel;
    result.action = action;
    result.actionLabel = actionLabel;
    result.workingModeLabel = workingModeLabel;

    const statusText = String(result.statusText || '');
    if (statusText && previousWorkingModeLabel && statusText.includes(previousWorkingModeLabel)) {
      result.statusText = statusText.replace(previousWorkingModeLabel, workingModeLabel);
    }
    return result;
  }

  reduceBatteryChargeResult(result, targetChargeW, settings = this.getSettings()) {
    if (!result || !Boolean(result.canPublishCommands)) return result;
    const currentTotal = Number(result.candidateTotalCommandW);
    if (!Number.isFinite(currentTotal) || currentTotal >= 0) return result;
    const commands = Array.isArray(result.candidateCommands) ? result.candidateCommands.map(value => Number(value) || 0) : [];
    const currentCharge = commands.reduce((sum, value) => sum + Math.max(0, -value), 0);
    if (currentCharge <= 0) return result;
    const target = Math.max(0, Math.min(currentCharge, Number(targetChargeW) || 0));
    const factor = target / currentCharge;
    const step = Math.max(1, Math.round(Number(settings.batteryCommandStepW) || 1));
    const adjusted = commands.map((value, index) => {
      if (value >= 0) return value;
      const scaled = Math.abs(value) * factor;
      let magnitude = Math.floor(scaled / step) * step;

      // EV/battery coordination may reduce an already calculated charge command.
      // Keep the individual maximum intact. Any hardware-specific minimum is a
      // Split Command concern and is applied later when the command is published.
      if (Boolean(settings.individualBatteryPowerLimitsEnabled)) {
        const batteryNumber = index + 1;
        const sharedMax = Math.max(0, Number(settings.maxChargePerBatteryW) || 2300);
        const configuredMax = Number(settings[`battery${batteryNumber}MaxChargeW`]);
        const maxChargeW = Math.max(0, Number.isFinite(configuredMax) ? configuredMax : sharedMax);
        const quantizedMax = Math.floor(maxChargeW / step) * step;
        magnitude = Math.min(magnitude, quantizedMax);
      }

      return magnitude > 0 ? -magnitude : 0;
    });
    const total = adjusted.reduce((sum, value) => sum + value, 0);
    result.candidateCommands = adjusted;
    result.candidateTotalCommandW = total;
    result.calculatedCommands = adjusted.slice();
    result.calculatedTotalCommandW = total;
    result.commands = adjusted.slice();
    result.totalCommandW = total;
    return result;
  }

  coordinateEvBatteryPriority(result, storedSettings = this.getSettings()) {
    if (!result) return null;
    const settings = this.getRuntimeSettings(storedSettings);
    const forcedBatteryPriority = String(result.baseMode || '') === 'manual_charge';
    const initialBatteryCommandW = Number(result.candidateTotalCommandW);
    const connected = Boolean(this.inputSeen.ev?.connected) && Boolean(this.state.evConnected);
    if (!Boolean(settings.evEnabled) || !connected) {
      result.evDecision = this.calculateEvControl(result, result.candidateTotalCommandW, this.state.lastTotalCommandW);
      return result.evDecision;
    }

    const mode = ['emergency', 'soc_target', 'smart'].includes(String(settings.evMode || 'smart'))
      ? String(settings.evMode || 'smart')
      : 'smart';
    const actualEvPowerW = this.inputSeen.ev?.chargeCurrent
      ? Math.max(0, Number(this.state.evChargeCurrentA) || 0) * evPowerPerAmp(settings)
      : 0;
    const currentBatteryW = Number(this.state.lastTotalCommandW) || 0;
    const rawGridW = Number(this.state.gridPowerW) || 0;
    // Net position with both controlled flexible loads removed. This is the common
    // pool from which PV surplus and Peak Guard headroom can be allocated once.
    const baseGridWithoutBatteryEvW = rawGridW + currentBatteryW - actualEvPowerW;
    const exportBufferW = Boolean(settings.exportLimitEnabled) && this.isPvCurtailmentSocAllowed(settings)
      ? Math.max(0, Number(settings.minimumExportW) || 0)
      : 0;
    const pvPoolW = Math.max(0, -baseGridWithoutBatteryEvW - exportBufferW + this.getPvCurtailmentHeadroomW(settings));

    const evTariff = result?.tariff || findCurrentTariff(new Date(), settings);
    let request = calculateEvDecision({
      settings,
      now: new Date(),
      tariff: evTariff,
      connected,
      soc: this.inputSeen.ev?.soc ? Number(this.state.evSoc) : NaN,
      actualCurrentA: this.inputSeen.ev?.chargeCurrent ? Math.max(0, Number(this.state.evChargeCurrentA) || 0) : 0,
      gridPowerW: rawGridW,
      currentBatteryCommandW: currentBatteryW,
      nextBatteryCommandW: 0,
      pvHeadroomW: 0,
      pvAvailableWOverride: pvPoolW,
      pvSessionActive: this.isEvPvSessionActiveForTariff(evTariff, settings),
      skipPeakLimit: true,
    });
    request = this.applyEvPvSessionHysteresis(request, result, settings);

    // A mode-controlled PV hold intentionally has no synthetic power request:
    // the charger keeps SMART permission while the real P1 meter decides when
    // the stop delay expires. Preserve the EV-first export margin separately.
    if (Boolean(request.pvSessionHoldActive) && this.getEvControlType(settings) === 'mode') {
      const configuredSmartPvPriority = String(settings.evSmartPvPriority || 'battery_first') === 'ev_first' ? 'ev_first' : 'battery_first';
      const smartPvPriority = forcedBatteryPriority ? 'battery_first' : configuredSmartPvPriority;
      const actualEvCurrentA = this.inputSeen.ev?.chargeCurrent ? Math.max(0, Number(this.state.evChargeCurrentA) || 0) : 0;
      const exportTargetW = Math.max(0, Math.min(5000, Number(settings.evSmartPvExportTargetW) || 0));
      const candidateTotal = Number(result.candidateTotalCommandW) || 0;
      const batteryChargeRequestW = candidateTotal < 0 ? Math.max(0, -candidateTotal) : 0;
      const marginActive = !forcedBatteryPriority
        && smartPvPriority === 'ev_first'
        && actualEvCurrentA > 0
        && exportTargetW > 0
        && rawGridW < -exportTargetW
        && batteryChargeRequestW > 0;
      if (marginActive) {
        const targetBatteryCommandW = currentBatteryW + rawGridW + exportTargetW;
        const targetChargeW = Math.max(0, Math.min(batteryChargeRequestW, -targetBatteryCommandW));
        this.reduceBatteryChargeResult(result, targetChargeW, settings);
      }
      const heldDecision = {
        ...request,
        evFirstExportMarginActive: marginActive,
        evFirstExportTargetW: marginActive ? Math.round(exportTargetW) : 0,
        pvPriority: smartPvPriority,
        gridPriority: forcedBatteryPriority ? 'battery_first' : String(settings.evSmartGridPriority || 'battery_first'),
        forcedBatteryPriority,
      };
      result.evDecision = heldDecision;
      result.evPriority = { mode, pvPriority: smartPvPriority, gridPriority: heldDecision.gridPriority, forcedBatteryPriority };
      if (Number.isFinite(initialBatteryCommandW)
        && Math.abs((Number(result.candidateTotalCommandW) || 0) - initialBatteryCommandW) > 0.5) {
        this.refreshBatteryPresentationAfterCoordination(result, settings);
      }
      return heldDecision;
    }

    if (!request.allowed || Number(request.requestedPowerW || request.desiredPowerW) <= 0) {
      request.forcedBatteryPriority = forcedBatteryPriority;
      result.evDecision = request;
      return request;
    }

    const candidateTotal = Number(result.candidateTotalCommandW) || 0;
    const batteryChargeRequestW = candidateTotal < 0 ? Math.max(0, -candidateTotal) : 0;
    const batteryGridRequestW = Math.min(batteryChargeRequestW, Math.max(0, Number(result.gridChargeAssistW) || 0));
    const batteryPvRequestW = Math.max(0, batteryChargeRequestW - batteryGridRequestW);
    const evTotalRequestW = Math.max(0, Number(request.requestedPowerW || request.desiredPowerW) || 0);
    const evPvRequestW = Math.min(evTotalRequestW, Math.max(0, Number(request.pvRequestPowerW) || 0));
    const evGridRequestW = Math.max(0, evTotalRequestW - evPvRequestW);

    const smartPvPriority = String(settings.evSmartPvPriority || 'battery_first') === 'ev_first' ? 'ev_first' : 'battery_first';
    const smartGridPriority = ['battery_first', 'ev_first', 'share'].includes(String(settings.evSmartGridPriority || 'battery_first'))
      ? String(settings.evSmartGridPriority || 'battery_first')
      : 'battery_first';
    // Emergency and direct SoC-target charging intentionally get first access to
    // flexible charging room. Smart mode follows the explicit user priorities.
    // A forced home-battery charge is an explicit operator override. It owns
    // the available PV/Peak Guard room before every EV request; the EV may use
    // only the remainder. This keeps the override at the configured EMS maximum
    // and prevents an EV-first reservation below the charger's minimum current
    // from collapsing the battery command to 0 W.
    const pvPriority = forcedBatteryPriority ? 'battery_first' : (mode === 'smart' ? smartPvPriority : 'ev_first');
    const gridPriority = forcedBatteryPriority ? 'battery_first' : (mode === 'smart' ? smartGridPriority : 'ev_first');

    const pvAllocation = this.allocateFlexiblePair(
      batteryPvRequestW,
      evPvRequestW,
      pvPoolW,
      pvPriority === 'ev_first' ? 'second' : 'first',
    );

    let totalFlexibleCapW = Infinity;
    if (Boolean(settings.peakShaveEnabled)) {
      const softTargetW = Math.max(0, (Number(settings.peakLimitW) || 0) - Math.max(0, Number(settings.peakSoftMarginW) || 0));
      totalFlexibleCapW = Math.max(0, softTargetW - baseGridWithoutBatteryEvW);
    }
    const pvAllocatedW = pvAllocation.first + pvAllocation.second;
    const gridCapacityW = Number.isFinite(totalFlexibleCapW) ? Math.max(0, totalFlexibleCapW - pvAllocatedW) : Infinity;
    const gridAllocation = this.allocateFlexiblePair(
      batteryGridRequestW,
      evGridRequestW,
      gridCapacityW,
      gridPriority === 'ev_first' ? 'second' : gridPriority === 'share' ? 'share' : 'first',
    );

    let batteryAllocatedW = pvAllocation.first + gridAllocation.first;
    const evAllocatedRawW = pvAllocation.second + gridAllocation.second;

    // v0.3.34: a mode-controlled smart EV charger needs a small visible export
    // margin to regulate itself. EV-first used to reserve the whole calculated
    // EV request up front, which could squeeze home-battery charging to 0 W
    // while the charger was only consuming a fraction of that request. Once the
    // EV is demonstrably charging (> 0 A), keep only the configured export
    // target and let the home battery absorb the rest. At 0 A the old priority
    // behaviour is intentionally preserved, so HomeFlux never creates this
    // margin merely in anticipation of a charger starting. The margin may
    // only reduce export that already exceeds the configured target; it must
    // never create export when the P1 meter is near zero or importing.
    const actualEvCurrentA = this.inputSeen.ev?.chargeCurrent
      ? Math.max(0, Number(this.state.evChargeCurrentA) || 0)
      : 0;
    const evFirstExportTargetW = Math.max(0, Math.min(5000, Number(settings.evSmartPvExportTargetW) || 0));
    const evFirstExportMarginActive = mode === 'smart'
      && pvPriority === 'ev_first'
      && this.getEvControlType(settings) === 'mode'
      && actualEvCurrentA > 0
      && evFirstExportTargetW > 0
      && rawGridW < -evFirstExportTargetW
      && pvPoolW > 0
      && batteryChargeRequestW > 0;
    if (evFirstExportMarginActive) {
      // Grid convention: import positive, export negative. Battery command:
      // discharge positive, charge negative. With the current physical EV load
      // left untouched, this is the battery command that would move the measured
      // grid position towards -exportTargetW.
      const targetBatteryCommandW = currentBatteryW + rawGridW + evFirstExportTargetW;
      const batteryChargeForExportTargetW = Math.max(0, Math.min(batteryChargeRequestW, -targetBatteryCommandW));
      batteryAllocatedW = Math.max(batteryAllocatedW, batteryChargeForExportTargetW);
    }
    let evCurrentA = this.getEvCurrentForPower(evAllocatedRawW, settings);
    let evAllocatedW = evCurrentA * evPowerPerAmp(settings);
    let peakLimited = evAllocatedW + 1 < evTotalRequestW && Boolean(settings.peakShaveEnabled)
      && Number.isFinite(totalFlexibleCapW)
      && (batteryChargeRequestW + evTotalRequestW) > totalFlexibleCapW + 1;
    let priorityLimited = evAllocatedW + 1 < evTotalRequestW && !peakLimited;
    let peakGuardBatteryAssistW = 0;

    const usePeakGuardBatteryAssist = !forcedBatteryPriority
      && this.shouldUseEvPeakGuardBatteryAssist(settings, mode, request.source)
      && evTotalRequestW > 0;
    if (usePeakGuardBatteryAssist) {
      const softTargetW = Math.max(0, (Number(settings.peakLimitW) || 0) - Math.max(0, Number(settings.peakSoftMarginW) || 0));
      const maxAssist = this.getEvPeakGuardBatteryAssistAllocation(Number(settings.maxTotalDischargeW) || Number(DEFAULTS.maxTotalDischargeW) || 0, settings);
      const maxEvPowerWithAssistW = Math.max(0, softTargetW + maxAssist.totalW - baseGridWithoutBatteryEvW);
      const requestedCurrentA = Math.max(0, Number(request.requestedCurrentA) || this.getEvCurrentForPower(evTotalRequestW, settings));
      let assistedCurrentA = this.getEvCurrentForPower(Math.min(evTotalRequestW, maxEvPowerWithAssistW), settings);
      const controlType = this.getEvControlType(settings);

      // A mode-controlled charger cannot be partially reduced. Keep STANDARD
      // only when the batteries can support the complete requested mode;
      // otherwise retain the existing safe STOP decision. Ampere control may
      // use the maximum current that remains safe.
      if (controlType === 'mode' && assistedCurrentA < requestedCurrentA) assistedCurrentA = 0;
      if (assistedCurrentA > evCurrentA) {
        const assistedPowerW = assistedCurrentA * evPowerPerAmp(settings);
        const requiredDischargeW = Math.max(0, baseGridWithoutBatteryEvW + assistedPowerW - softTargetW);
        const assist = this.getEvPeakGuardBatteryAssistAllocation(requiredDischargeW, settings);
        const supportedEvPowerW = Math.max(0, softTargetW + assist.totalW - baseGridWithoutBatteryEvW);
        const safeCurrentA = this.getEvCurrentForPower(Math.min(evTotalRequestW, supportedEvPowerW), settings);
        const finalCurrentA = controlType === 'mode'
          ? (safeCurrentA >= requestedCurrentA ? requestedCurrentA : 0)
          : Math.max(evCurrentA, safeCurrentA);

        if (finalCurrentA > evCurrentA) {
          const finalPowerW = finalCurrentA * evPowerPerAmp(settings);
          const finalRequiredDischargeW = Math.max(0, baseGridWithoutBatteryEvW + finalPowerW - softTargetW);
          const finalAssist = this.getEvPeakGuardBatteryAssistAllocation(finalRequiredDischargeW, settings);
          const appliedAssistW = this.applyEvPeakGuardBatteryAssist(result, finalAssist, settings);
          if (appliedAssistW + 1 >= finalRequiredDischargeW || finalRequiredDischargeW <= 1) {
            evCurrentA = finalCurrentA;
            evAllocatedW = finalPowerW;
            peakGuardBatteryAssistW = appliedAssistW;
            peakLimited = evAllocatedW + 1 < evTotalRequestW;
            priorityLimited = false;
          }
        }
      }
    }

    if (batteryChargeRequestW > 0 && batteryAllocatedW + 1 < batteryChargeRequestW) {
      this.reduceBatteryChargeResult(result, batteryAllocatedW, settings);
      result.gridChargeAssistW = Math.min(Math.max(0, -Number(result.candidateTotalCommandW) || 0), Math.round(gridAllocation.first));
      result.pvChargeW = Math.max(0, Math.round((-Number(result.candidateTotalCommandW) || 0) - result.gridChargeAssistW));
    }

    const decision = {
      ...request,
      desiredCurrentA: evCurrentA,
      desiredPowerW: Math.round(evAllocatedW),
      allowed: evCurrentA > 0,
      peakLimited,
      priorityLimited,
      pvAllocatedW: Math.round(Math.min(evAllocatedW, pvAllocation.second)),
      gridAllocatedW: Math.round(Math.max(0, evAllocatedW - Math.min(evAllocatedW, pvAllocation.second))),
      pvPriority,
      gridPriority,
      evFirstExportMarginActive,
      evFirstExportTargetW: evFirstExportMarginActive ? Math.round(evFirstExportTargetW) : 0,
      peakGuardBatteryAssistActive: peakGuardBatteryAssistW > 0,
      peakGuardBatteryAssistW: Math.round(peakGuardBatteryAssistW),
      forcedBatteryPriority,
    };

    if (evCurrentA <= 0) {
      if (peakLimited) decision.reason = 'Peak Guard laat geen EV-laadvermogen toe';
      else if (priorityLimited && mode === 'smart') decision.reason = 'Wachten: thuisbatterij heeft momenteel voorrang';
    } else if (mode === 'emergency') {
      decision.reason = 'Emergency charge · maximaal mogelijk vermogen binnen Peak Guard';
    } else if (mode === 'soc_target') {
      decision.reason = `Laden tot ${Math.round(Number(settings.evTargetSoc) || 80)}% SoC · binnen Peak Guard`;
    } else {
      const pieces = [];
      if (decision.pvAllocatedW > 0) pieces.push('PV');
      if (decision.gridAllocatedW > 0) pieces.push(request.guaranteeActive ? 'doelgarantie' : 'geselecteerd tarief');
      decision.reason = pieces.length ? `Slim laden via ${pieces.join(' + ')}` : request.reason;
      if (priorityLimited) decision.reason += ' · beperkt door ingestelde energieprioriteit';
      if (evFirstExportMarginActive) decision.reason += ` · EV-eerst exportdoel ${Math.round(evFirstExportTargetW)} W`;
      if (peakLimited) decision.reason += ' · begrensd door Peak Guard';
    }
    if (peakGuardBatteryAssistW > 0) {
      decision.reason += ` · Peak Guard ondersteund door thuisbatterij ${Math.round(peakGuardBatteryAssistW)} W`;
      if (peakLimited) decision.reason += ' · resterend EV-vermogen begrensd';
    }

    result.evDecision = decision;
    result.evPriority = { mode, pvPriority, gridPriority, forcedBatteryPriority };
    if (Number.isFinite(initialBatteryCommandW)
      && Math.abs((Number(result.candidateTotalCommandW) || 0) - initialBatteryCommandW) > 0.5) {
      this.refreshBatteryPresentationAfterCoordination(result, settings);
    }
    return decision;
  }

  getEvControlType(settings = this.getSettings()) {
    return String(settings.evControlType || 'current') === 'mode' ? 'mode' : 'current';
  }

  getEvPeakGuardStopHoldMs(settings = this.getSettings()) {
    return Math.max(0, Math.min(3600, Number(settings.evPeakGuardStopHoldSeconds) || 0)) * 1000;
  }

  clearEvPeakGuardStopHold() {
    this.evPeakGuardStopHoldUntil = 0;
    if (this.evPeakGuardStopHoldTimer) {
      clearTimeout(this.evPeakGuardStopHoldTimer);
      this.evPeakGuardStopHoldTimer = null;
    }
  }

  armEvPeakGuardStopHold(settings = this.getSettings(), now = Date.now()) {
    const holdMs = this.getEvPeakGuardStopHoldMs(settings);
    if (holdMs <= 0) {
      this.clearEvPeakGuardStopHold();
      return;
    }
    // Compatibility note: the historical setting/key name mentions Peak Guard,
    // but from v0.3.40 this is the general mode-controlled EV restart hold after
    // any HomeFlux STOP. It is timestamp-only; regular EMS/P1 evaluations are
    // sufficient to release it, so no extra timer/evaluation is scheduled.
    this.evPeakGuardStopHoldUntil = now + holdMs;
    if (this.evPeakGuardStopHoldTimer) {
      clearTimeout(this.evPeakGuardStopHoldTimer);
      this.evPeakGuardStopHoldTimer = null;
    }
  }

  isEvPeakGuardStopHoldActive(now = Date.now()) {
    return Number(this.evPeakGuardStopHoldUntil) > now;
  }

  getEvChargeMode(decision, settings = this.getSettings()) {
    if (this.getEvControlType(settings) !== 'mode') return null;
    if (!decision || !Boolean(settings.evEnabled) || !decision.connected || !decision.allowed) return 'stop';

    // Peak Guard remains absolute. After any actually published HomeFlux STOP,
    // keep a mode-only charger stopped for the configured restart hold.
    if (Boolean(decision.peakLimited)) return 'stop';
    if (this.isEvPeakGuardStopHoldActive()) return 'stop';

    const operatingMode = ['emergency', 'soc_target', 'smart'].includes(String(decision.mode || settings.evMode || 'smart'))
      ? String(decision.mode || settings.evMode || 'smart')
      : 'smart';

    // Mode-only chargers cannot express a reduced current. Peak Guard handling
    // (including the restart hold) is applied above.
    if (operatingMode === 'emergency' || operatingMode === 'soc_target') return 'standard';
    const source = String(decision.source || 'off');
    if (['tariff', 'guarantee', 'pv+tariff'].includes(source)) return 'standard';
    return 'smart';
  }

  getEvCommandIntervalMs(settings = this.getSettings()) {
    return Math.max(1, Number(settings.evCommandIntervalSeconds) || 10) * 1000;
  }

  scheduleEvPublish(waitMs) {
    const delay = Math.max(1, Math.round(Number(waitMs) || 1));
    if (this.evTimer) return;
    this.evTimer = this.homey.setTimeout(() => {
      this.evTimer = null;
      const decision = this.calculateEvControl(this.latestResult, this.state.lastTotalCommandW, this.state.lastTotalCommandW);
      this.latestEvDecision = decision;
      this.publishEvDecision(decision).catch(err => this.error('Delayed EV publish failed', err));
    }, delay);
  }

  async publishEvDecision(decision) {
    if (!decision) return;
    const settings = this.getSettings();
    const controlType = this.getEvControlType(settings);
    const desiredA = Math.max(0, Math.round(Number(decision.desiredCurrentA) || 0));
    const chargeMode = controlType === 'mode' ? this.getEvChargeMode(decision, settings) : null;
    const peakGuardHoldActive = controlType === 'mode' && Boolean(decision.allowed) && !Boolean(decision.peakLimited) && this.isEvPeakGuardStopHoldActive();
    if (peakGuardHoldActive) {
      const remainingSeconds = Math.max(1, Math.ceil((Number(this.evPeakGuardStopHoldUntil) - Date.now()) / 1000));
      decision.peakGuardStopHoldActive = true;
      decision.peakGuardStopHoldRemainingSeconds = remainingSeconds;
      decision.reason = `EV stopwachttijd · herstart opnieuw beoordelen over ${remainingSeconds} s`;
    }
    const allowed = controlType === 'mode'
      ? chargeMode !== 'stop'
      : Boolean(decision.allowed && desiredA > 0);
    this.syncEvPvSessionFromDecision(decision, chargeMode, settings);

    const forceOutput = Boolean(this.forceEvOutput);
    const previousChargeMode = String(this.lastPublishedEvChargeMode || '');
    const currentChanged = controlType === 'current' && (forceOutput || desiredA !== Number(this.lastPublishedEvCurrentA || 0));
    const modeChanged = controlType === 'mode' && (forceOutput || chargeMode !== String(this.lastPublishedEvChargeMode || ''));
    const allowedChanged = forceOutput || allowed !== Boolean(this.lastPublishedEvAllowed);
    if (!currentChanged && !modeChanged && !allowedChanged) return;

    const intervalMs = this.getEvCommandIntervalMs(settings);
    const now = Date.now();
    const allowedAt = this.lastEvPublishedAt > 0 ? this.lastEvPublishedAt + intervalMs : 0;
    const isSafetyReduction = controlType === 'mode'
      ? chargeMode === 'stop' && String(this.lastPublishedEvChargeMode || '') !== 'stop'
      : desiredA < Number(this.lastPublishedEvCurrentA || 0)
        && (Boolean(decision.peakLimited) || !Boolean(settings.evEnabled) || !decision.connected);
    if (!isSafetyReduction && now < allowedAt) {
      this.scheduleEvPublish(allowedAt - now);
      return;
    }
    if (this.evPublishing) {
      this.scheduleEvPublish(Math.max(250, intervalMs));
      return;
    }

    this.evPublishing = true;
    try {
      if (currentChanged) {
        const token = this.tokens.get('emsevcurrent');
        if (token) await token.setValue(desiredA);
        if (this.evCurrentTrigger) {
          await this.evCurrentTrigger.trigger({
            charge_current: desiredA,
            charge_power: Math.round(Number(decision.desiredPowerW) || 0),
            source: String(decision.source || 'off'),
            reason: String(decision.reason || ''),
            target_soc: Number(decision.targetSoc) || 0,
          });
        }
        this.lastPublishedEvCurrentA = desiredA;
      }
      if (modeChanged) {
        const token = this.tokens.get('emsevmode');
        if (token) await token.setValue(chargeMode);
        if (this.evModeTrigger) {
          await this.evModeTrigger.trigger({
            charge_mode: chargeMode,
            reason: String(decision.reason || ''),
          }, { charge_mode: chargeMode });
        }
        this.lastPublishedEvChargeMode = chargeMode;
        if (chargeMode === 'stop' && previousChargeMode !== 'stop' && Boolean(settings.evEnabled) && Boolean(decision.connected)) {
          this.armEvPeakGuardStopHold(settings);
        }
      }
      if (allowedChanged) {
        const token = this.tokens.get('emsevallowed');
        if (token) await token.setValue(allowed ? 'Ja' : 'Nee');
        if (this.evAllowedTrigger) {
          await this.evAllowedTrigger.trigger({
            allowed: allowed ? 'Ja' : 'Nee',
            allowed_value: allowed ? 1 : 0,
            reason: String(decision.reason || ''),
          });
        }
        this.lastPublishedEvAllowed = allowed;
      }
      this.lastEvPublishedAt = Date.now();
      this.forceEvOutput = false;
    } finally {
      this.evPublishing = false;
    }
  }


  getEvChargeModeFor(index, decision, settings = this.getSettings()) {
    if (index === 0) return this.getEvChargeMode(decision, settings);
    const runtime = this.getExtraEv(index);
    if (this.getEvControlType(settings) !== 'mode') return null;
    if (!decision || !Boolean(settings.evEnabled) || !decision.connected || !decision.allowed) return 'stop';
    if (Boolean(decision.peakLimited)) return 'stop';
    if (Number(runtime?.stopHoldUntil || 0) > Date.now()) return 'stop';
    const operatingMode = ['emergency', 'soc_target', 'smart'].includes(String(decision.mode || settings.evMode || 'smart'))
      ? String(decision.mode || settings.evMode || 'smart') : 'smart';
    if (operatingMode === 'emergency' || operatingMode === 'soc_target') return 'standard';
    const source = String(decision.source || 'off');
    if (['tariff', 'guarantee', 'pv+tariff'].includes(source)) return 'standard';
    return 'smart';
  }

  armEvStopHoldFor(index, settings = this.getSettings(), now = Date.now()) {
    if (index === 0) return this.armEvPeakGuardStopHold(settings, now);
    const runtime = this.getExtraEv(index);
    if (!runtime) return;
    const holdMs = this.getEvPeakGuardStopHoldMs(settings);
    runtime.stopHoldUntil = holdMs > 0 ? now + holdMs : 0;
  }

  scheduleAdditionalEvPublish(index, waitMs) {
    const runtime = this.getExtraEv(index);
    if (!runtime || runtime.timer) return;
    const delay = Math.max(1, Math.round(Number(waitMs) || 1));
    runtime.timer = this.homey.setTimeout(() => {
      runtime.timer = null;
      this.requestContextEvaluate(true, `ev${index + 1}_output_timer`);
    }, delay);
  }

  isEvOutputActiveFor(index, settings = this.getSettings()) {
    if (index === 0) {
      const instanceSettings = this.getEvInstanceSettings(0, settings);
      return this.getEvControlType(instanceSettings) === 'mode'
        ? ['smart', 'standard'].includes(String(this.lastPublishedEvChargeMode || ''))
        : Number(this.lastPublishedEvCurrentA || 0) > 0;
    }
    const runtime = this.getExtraEv(index);
    const instanceSettings = this.getEvInstanceSettings(index, settings);
    if (!runtime) return false;
    return this.getEvControlType(instanceSettings) === 'mode'
      ? ['smart', 'standard'].includes(String(runtime.lastPublishedChargeMode || ''))
      : Number(runtime.lastPublishedCurrentA || 0) > 0;
  }

  async publishAdditionalEvDecision(index, decision) {
    const runtime = this.getExtraEv(index);
    if (!runtime || !decision) return;
    const settings = this.getEvInstanceSettings(index);
    settings.evMode = this.getEffectiveEvModeFor(index);
    const triggers = this.extraEvTriggers[index - 1] || {};
    const controlType = this.getEvControlType(settings);
    const desiredA = Math.max(0, Math.round(Number(decision.desiredCurrentA) || 0));
    const chargeMode = controlType === 'mode' ? this.getEvChargeModeFor(index, decision, settings) : null;
    const holdActive = controlType === 'mode' && Boolean(decision.allowed) && !Boolean(decision.peakLimited) && Number(runtime.stopHoldUntil || 0) > Date.now();
    if (holdActive) {
      const remainingSeconds = Math.max(1, Math.ceil((Number(runtime.stopHoldUntil) - Date.now()) / 1000));
      decision.peakGuardStopHoldActive = true;
      decision.peakGuardStopHoldRemainingSeconds = remainingSeconds;
      decision.reason = `EV stopwachttijd · herstart opnieuw beoordelen over ${remainingSeconds} s`;
    }
    const allowed = controlType === 'mode' ? chargeMode !== 'stop' : Boolean(decision.allowed && desiredA > 0);
    this.syncEvPvSessionFromDecisionFor(index, decision, chargeMode, settings);
    const forceOutput = Boolean(runtime.forceOutput);
    const previousChargeMode = String(runtime.lastPublishedChargeMode || '');
    const currentChanged = controlType === 'current' && (forceOutput || desiredA !== Number(runtime.lastPublishedCurrentA || 0));
    const modeChanged = controlType === 'mode' && (forceOutput || chargeMode !== String(runtime.lastPublishedChargeMode || ''));
    const allowedChanged = forceOutput || allowed !== Boolean(runtime.lastPublishedAllowed);
    if (!currentChanged && !modeChanged && !allowedChanged) return;
    const intervalMs = this.getEvCommandIntervalMs(settings);
    const now = Date.now();
    const allowedAt = runtime.lastPublishedAt > 0 ? runtime.lastPublishedAt + intervalMs : 0;
    const isSafetyReduction = controlType === 'mode'
      ? chargeMode === 'stop' && String(runtime.lastPublishedChargeMode || '') !== 'stop'
      : desiredA < Number(runtime.lastPublishedCurrentA || 0)
        && (Boolean(decision.peakLimited) || !Boolean(settings.evEnabled) || !decision.connected);
    if (!isSafetyReduction && now < allowedAt) {
      this.scheduleAdditionalEvPublish(index, allowedAt - now);
      return;
    }
    if (runtime.publishing) {
      this.scheduleAdditionalEvPublish(index, Math.max(250, intervalMs));
      return;
    }
    runtime.publishing = true;
    try {
      if (currentChanged && triggers.current) {
        await triggers.current.trigger({
          charge_current: desiredA,
          charge_power: Math.round(Number(decision.desiredPowerW) || 0),
          source: String(decision.source || 'off'),
          reason: String(decision.reason || ''),
          target_soc: Number(decision.targetSoc) || 0,
        });
        runtime.lastPublishedCurrentA = desiredA;
      }
      if (modeChanged && triggers.mode) {
        await triggers.mode.trigger({ charge_mode: chargeMode, reason: String(decision.reason || '') }, { charge_mode: chargeMode });
        runtime.lastPublishedChargeMode = chargeMode;
        if (chargeMode === 'stop' && previousChargeMode !== 'stop' && Boolean(settings.evEnabled) && Boolean(decision.connected)) {
          this.armEvStopHoldFor(index, settings);
        }
      }
      if (allowedChanged && triggers.allowed) {
        await triggers.allowed.trigger({
          allowed: allowed ? 'Ja' : 'Nee',
          allowed_value: allowed ? 1 : 0,
          reason: String(decision.reason || ''),
        });
        runtime.lastPublishedAllowed = allowed;
      }
      runtime.lastPublishedAt = Date.now();
      runtime.forceOutput = false;
    } finally {
      runtime.publishing = false;
    }
  }

  async testEvOutput(body = {}) {
    const output = String(body.output || '').trim().toLowerCase();
    const index = Math.max(0, Math.min(3, Math.round(Number(body.instance) || 1) - 1));
    const instance = index + 1;
    const reason = `Settings output test · EV ${instance}`;
    const settings = this.getEvInstanceSettings(index);
    const triggers = index === 0
      ? { current: this.evCurrentTrigger, allowed: this.evAllowedTrigger, mode: this.evModeTrigger }
      : this.extraEvTriggers[index - 1] || {};

    if (output === 'current') {
      const currentA = Math.max(0, Math.min(64, Number(body.currentA)));
      if (!Number.isFinite(currentA)) throw new Error('Ongeldige EV-testlaadstroom.');
      const phases = Math.max(1, Math.min(3, Math.round(Number(settings.evPhases) || 1)));
      const powerW = Math.round(currentA * 230 * phases);
      if (!triggers.current) throw new Error(`EV ${instance}-laadstroom Flow-trigger is niet beschikbaar.`);
      await triggers.current.trigger({
        charge_current: currentA,
        charge_power: powerW,
        source: 'test',
        reason,
        target_soc: Math.max(0, Math.min(100, Number(settings.evTargetSoc) || 0)),
      });
      return { ok: true, instance, output, value: currentA, detail: `${currentA} A` };
    }

    if (output === 'allowed') {
      const allowed = Boolean(body.allowed);
      if (!triggers.allowed) throw new Error(`EV ${instance}-toestemming Flow-trigger is niet beschikbaar.`);
      await triggers.allowed.trigger({ allowed: allowed ? 'Ja' : 'Nee', allowed_value: allowed ? 1 : 0, reason });
      return { ok: true, instance, output, value: allowed, detail: allowed ? 'Ja' : 'Nee' };
    }

    if (output === 'mode') {
      const mode = String(body.mode || '').trim().toLowerCase();
      if (!['stop', 'smart', 'standard'].includes(mode)) throw new Error('Ongeldige EV-testmodus.');
      if (!triggers.mode) throw new Error(`EV ${instance}-laadmodus Flow-trigger is niet beschikbaar.`);
      await triggers.mode.trigger({ charge_mode: mode, reason }, { charge_mode: mode });
      return { ok: true, instance, output, value: mode, detail: mode };
    }

    throw new Error('Onbekende EV-outputtest.');
  }

  async testHvacOutput(body = {}) {
    const output = String(body.output || '').trim().toLowerCase();
    const index = Math.max(0, Math.min(3, Math.round(Number(body.instance) || 1) - 1));
    const instance = index + 1;
    const reason = `Settings output test · HVAC ${instance}`;
    const triggers = index === 0
      ? { power: this.hvacPowerTrigger, mode: this.hvacModeTrigger, setpoint: this.hvacSetpointTrigger, fan: this.hvacFanTrigger }
      : this.extraHvacTriggers[index - 1] || {};

    if (output === 'power') {
      const on = Boolean(body.on);
      if (!triggers.power) throw new Error(`HVAC ${instance} aan/uit Flow-trigger is niet beschikbaar.`);
      await triggers.power.trigger({ state: on ? 'Aan' : 'Uit', state_value: on ? 1 : 0, reason });
      return { ok: true, instance, output, value: on, detail: on ? 'Aan' : 'Uit' };
    }
    if (output === 'mode') {
      const mode = String(body.mode || '').trim().toLowerCase();
      if (!['cool', 'heat'].includes(mode)) throw new Error('Ongeldige HVAC-testmodus.');
      if (!triggers.mode) throw new Error(`HVAC ${instance}-modus Flow-trigger is niet beschikbaar.`);
      await triggers.mode.trigger({ mode, reason });
      return { ok: true, instance, output, value: mode, detail: mode };
    }
    if (output === 'setpoint') {
      const setpoint = Math.round(Number(body.setpoint) * 2) / 2;
      if (!Number.isFinite(setpoint) || setpoint < 5 || setpoint > 40) throw new Error('Ongeldig HVAC-testsetpoint.');
      if (!triggers.setpoint) throw new Error(`HVAC ${instance}-setpoint Flow-trigger is niet beschikbaar.`);
      await triggers.setpoint.trigger({ setpoint, reason });
      return { ok: true, instance, output, value: setpoint, detail: `${setpoint} °C` };
    }
    if (output === 'fan') {
      const currentSpeed = Number(body.currentSpeed);
      const targetSpeed = Number(body.targetSpeed);
      if (!Number.isFinite(currentSpeed) || !Number.isFinite(targetSpeed)) throw new Error('Ongeldige HVAC-test ventilatorwaarde.');
      const action = targetSpeed > currentSpeed ? 'higher' : targetSpeed < currentSpeed ? 'lower' : 'same';
      if (!triggers.fan) throw new Error(`HVAC ${instance}-ventilator Flow-trigger is niet beschikbaar.`);
      await triggers.fan.trigger({ action, current_speed: currentSpeed, target_speed: targetSpeed, reason });
      return { ok: true, instance, output, value: targetSpeed, detail: `${currentSpeed} → ${targetSpeed}` };
    }
    throw new Error('Onbekende HVAC-outputtest.');
  }

  getHvacFanScale(settings = this.getSettings()) {
    let min = Number(settings.hvacFanMinValue);
    let max = Number(settings.hvacFanMaxValue);
    let step = Number(settings.hvacFanStepValue);
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 100;
    if (max < min) [min, max] = [max, min];
    if (!Number.isFinite(step) || step <= 0) step = 1;
    return { min, max, step };
  }

  getHvacFanTarget(action, currentValue, settings = this.getSettings()) {
    if (!action) return null;
    const { min, max, step } = this.getHvacFanScale(settings);
    const current = Number(currentValue);
    if (!Number.isFinite(current)) return null;
    const snapped = Math.max(min, Math.min(max, min + Math.round((current - min) / step) * step));
    const target = action === 'higher' ? snapped + step : action === 'lower' ? snapped - step : snapped;
    const clamped = Math.max(min, Math.min(max, target));
    return Math.round(clamped * 1000) / 1000;
  }

  getHvacComfortBand(settings = this.getSettings()) {
    // The legacy setting keys are retained for upgrade compatibility, but from
    // v0.3.59 onward they are independent mode targets rather than min/max
    // boundaries of one shared comfort band. They may therefore be equal or
    // even cross without being reordered.
    let heatingTarget = Number(settings.hvacComfortMinC);
    let coolingTarget = Number(settings.hvacComfortMaxC);
    if (!Number.isFinite(heatingTarget)) heatingTarget = 21;
    if (!Number.isFinite(coolingTarget)) coolingTarget = 23;
    let energyDeviation = Number(settings.hvacEnergyDeviationC);
    if (!Number.isFinite(energyDeviation)) energyDeviation = 2;
    energyDeviation = Math.max(0, Math.min(10, energyDeviation));
    let heatBelow = Number(settings.hvacHeatingActivationBelowC);
    let coolAbove = Number(settings.hvacCoolingActivationAboveC);
    if (!Number.isFinite(heatBelow)) heatBelow = 20;
    if (!Number.isFinite(coolAbove)) coolAbove = 24;
    return {
      heatingTarget,
      coolingTarget,
      energyDeviation,
      heatBelow,
      coolAbove,
      // Keep these aliases in status payloads for compatibility with existing
      // pre-release diagnostics while their meaning is now mode-specific.
      comfortMin: heatingTarget,
      comfortMax: coolingTarget,
    };
  }

  getHvacFanTargetFromClimate(mode, roomTemperatureC, outdoorTemperatureC, settings = this.getSettings()) {
    const room = Number(roomTemperatureC);
    const outdoor = Number(outdoorTemperatureC);
    if (!Number.isFinite(room) || !Number.isFinite(outdoor) || !['cool', 'heat'].includes(String(mode))) return null;
    const profile = String(mode === 'cool' ? settings.hvacCoolingFanProfile : settings.hvacHeatingFanProfile || 'normal');
    const degreesPerLevel = profile === 'slow' ? 2 : profile === 'fast' ? 0.5 : 1;
    const delta = mode === 'cool' ? outdoor - room : room - outdoor;
    const { min, max, step } = this.getHvacFanScale(settings);
    const levelCount = Math.max(1, Math.floor((max - min) / step) + 1);
    const level = Math.max(1, Math.min(levelCount, Math.ceil(Math.max(0, delta) / degreesPerLevel)));
    return Math.round(Math.max(min, Math.min(max, min + ((level - 1) * step))) * 1000) / 1000;
  }

  getHvacTargetSetpoint(mode, settings = this.getSettings()) {
    const { heatingTarget, coolingTarget, energyDeviation } = this.getHvacComfortBand(settings);
    const priority = String(settings.hvacPriority || 'comfort');
    if (mode === 'heat') {
      const target = priority === 'pv' ? heatingTarget + energyDeviation : heatingTarget;
      return Math.max(5, Math.min(40, Math.round(target * 2) / 2));
    }
    if (mode === 'cool') {
      const target = priority === 'pv' ? coolingTarget - energyDeviation : coolingTarget;
      return Math.max(5, Math.min(40, Math.round(target * 2) / 2));
    }
    return null;
  }

  calculateHvacControl(result = this.latestResult, evDecision = this.latestEvDecision, nextBatteryCommandW = this.state.lastTotalCommandW, currentBatteryCommandW = this.state.lastTotalCommandW, options = {}) {
    const settings = options.settings || this.getSettings();
    const allowStart = options.allowStart !== false;
    const instanceIndex = Math.max(0, Math.min(3, Number(options.instanceIndex) || 0));
    const enabled = Boolean(settings.hvacEnabled);
    const automaticControlEnabled = settings.hvacAutomaticControlEnabled !== false;
    const room = this.inputSeen.hvac?.roomTemperature ? Number(this.state.hvacRoomTemperatureC) : NaN;
    const outdoor = this.inputSeen.hvac?.outdoorTemperature ? Number(this.state.hvacOutdoorTemperatureC) : NaN;
    const actualSetpoint = this.inputSeen.hvac?.setpoint ? Number(this.state.hvacSetpointC) : NaN;
    const mode = this.inputSeen.hvac?.mode ? String(this.state.hvacMode || 'off') : '';
    const fanSpeed = this.inputSeen.hvac?.fanSpeed ? Number(this.state.hvacFanSpeed) : null;
    const avgSoc = this.getAverageBatterySoc(settings);
    const grid = Number(this.state.gridPowerW) || 0;
    const batteryAfterGrid = grid + (Number(currentBatteryCommandW) || 0) - (Number(nextBatteryCommandW) || 0);
    const actualEvPowerW = Number.isFinite(Number(options.totalActualEvPowerW))
      ? Math.max(0, Number(options.totalActualEvPowerW))
      : Boolean(settings.evEnabled) && Boolean(this.state.evConnected) && this.inputSeen.ev?.chargeCurrent
        ? Math.max(0, Number(this.state.evChargeCurrentA) || 0) * evPowerPerAmp(settings)
        : 0;
    const desiredEvPowerW = Number.isFinite(Number(options.totalDesiredEvPowerW))
      ? Math.max(0, Number(options.totalDesiredEvPowerW))
      : Boolean(settings.evEnabled) && evDecision
        ? Math.max(0, Number(evDecision.desiredPowerW) || 0)
        : 0;
    const predictedGridAfterEvW = batteryAfterGrid + desiredEvPowerW - actualEvPowerW;
    const pvHeadroomW = this.getPvCurtailmentHeadroomW(settings);
    const virtualGridW = predictedGridAfterEvW - pvHeadroomW;
    const band = this.getHvacComfortBand(settings);

    const decision = {
      enabled,
      automaticControlEnabled,
      priority: String(settings.hvacPriority || 'comfort'),
      roomTemperatureC: Number.isFinite(room) ? room : null,
      outdoorTemperatureC: Number.isFinite(outdoor) ? outdoor : null,
      currentMode: mode || null,
      currentSetpointC: Number.isFinite(actualSetpoint) ? actualSetpoint : null,
      fanSpeed: Number.isFinite(Number(fanSpeed)) ? Number(fanSpeed) : null,
      averageBatterySoc: avgSoc,
      predictedGridW: Math.round(predictedGridAfterEvW),
      virtualGridW: Math.round(virtualGridW),
      pvHeadroomW: Math.round(pvHeadroomW),
      comfortMinC: band.comfortMin,
      comfortMaxC: band.comfortMax,
      heatingTargetC: band.heatingTarget,
      coolingTargetC: band.coolingTarget,
      energyDeviationC: band.energyDeviation,
      heatingActivationBelowC: band.heatBelow,
      coolingActivationAboveC: band.coolAbove,
      powerCommand: null,
      modeCommand: null,
      setpointCommand: null,
      fanAction: null,
      fanTarget: null,
      reason: '',
      boostActive: this.hvacBaselineSetpoint !== null,
      boostMode: this.hvacBoostMode || null,
      instance: instanceIndex + 1,
      startEligible: false,
      startAllowedByPriority: allowStart,
      energySource: 'none',
    };

    const resetBoostState = () => {
      this.hvacBaselineSetpoint = null;
      this.hvacBaselineMode = null;
      this.hvacBoostMode = null;
      decision.boostActive = false;
      decision.boostMode = null;
    };

    const restoreImmediately = reason => {
      if (this.hvacBaselineSetpoint !== null && Boolean(settings.hvacAllowSetpointControl)) {
        decision.setpointCommand = Math.round(Number(this.hvacBaselineSetpoint) * 2) / 2;
      }
      if (Boolean(settings.hvacAllowFanControl)) decision.fanTarget = this.getHvacFanScale(settings).min;
      if (this.hvacManagedPowerOn && Boolean(settings.hvacAllowPowerControl)) {
        decision.powerCommand = false;
        this.hvacManagedPowerOn = false;
      }
      if (Boolean(settings.hvacAllowModeControl) && this.hvacBaselineMode && this.hvacBaselineMode !== mode) {
        decision.modeCommand = this.hvacBaselineMode;
      }
      decision.reason = reason;
      resetBoostState();
      return decision;
    };

    if (!enabled) {
      if (this.hvacBaselineSetpoint !== null || this.hvacManagedPowerOn) return restoreImmediately('HVAC-module uit · regeling terug naar normaal');
      decision.reason = 'HVAC-module uit';
      return decision;
    }

    if (!automaticControlEnabled) {
      if (this.hvacBaselineSetpoint !== null || this.hvacManagedPowerOn) return restoreImmediately('Automatische HVAC-sturing uit · regeling terug naar normaal');
      decision.reason = 'Automatische HVAC-sturing uit';
      return decision;
    }

    // Outdoor temperature is deliberately NOT a prerequisite anymore. It is
    // only used for fan-speed selection when that output is enabled.
    const requiredInputs = Number.isFinite(room) && Number.isFinite(actualSetpoint) && Boolean(mode);
    if (!requiredInputs) {
      decision.reason = 'Wachten op HVAC-ruimtetemperatuur/modus/setpoint';
      return decision;
    }

    const activationMode = room < band.heatBelow ? 'heat' : room > band.coolAbove ? 'cool' : null;
    const activeMode = this.hvacBoostMode && ['heat', 'cool'].includes(this.hvacBoostMode) ? this.hvacBoostMode : null;
    const controlMode = activeMode || activationMode;
    const minBatterySoc = Math.max(0, Math.min(100, Number(settings.hvacMinBatterySoc) || 90));
    const enoughBattery = avgSoc !== null && avgSoc >= minBatterySoc;
    const startW = Math.max(0, Number(settings.hvacSurplusStartW) || 800);
    const stopW = Math.max(0, Number(settings.hvacSurplusStopW) || 200);
    const intervalMs = Math.max(1, Number(settings.hvacControlIntervalMinutes) || 5) * 60000;
    const intervalReady = this.lastHvacControlAt <= 0 || (Date.now() - this.lastHvacControlAt) >= intervalMs;
    const hasPvBoost = Boolean(settings.hvacUsePvSurplus) && enoughBattery && virtualGridW <= -startW;
    const fastImportW = Math.max(0, Number(settings.hvacFastResetImportW) || 1000);
    const evStartsGridCharge = Boolean(evDecision)
      && ['tariff', 'guarantee', 'pv+tariff'].includes(String(evDecision.source || ''))
      && Number(evDecision.desiredCurrentA || 0) > Number(evDecision.actualCurrentA || 0) + 0.5;
    const fastReset = Boolean(result?.override === 'peak_shave') || predictedGridAfterEvW >= fastImportW || evStartsGridCharge;

    const hasPublishedHvacSetpoint = this.lastPublishedHvacSetpoint !== null && this.lastPublishedHvacSetpoint !== undefined
      && Number.isFinite(Number(this.lastPublishedHvacSetpoint));
    const effectiveSetpoint = hasPublishedHvacSetpoint ? Number(this.lastPublishedHvacSetpoint) : actualSetpoint;

    if (activeMode && fastReset) {
      return restoreImmediately(result?.override === 'peak_shave'
        ? 'Peak Guard · HVAC direct terug naar normaal'
        : evStartsGridCharge
          ? 'EV start netladen · HVAC direct terug naar normaal'
          : 'Grote netafname · HVAC direct terug naar normaal');
    }

    const stopBatterySoc = Math.max(0, Math.min(100, Number(settings.hvacStopBatterySoc) || 50));

    if (activeMode) {
      const targetSetpoint = this.getHvacTargetSetpoint(activeMode, settings);
      const targetReached = activeMode === 'heat' ? room >= targetSetpoint : room <= targetSetpoint;
      const pvStillAvailable = Boolean(settings.hvacUsePvSurplus) && enoughBattery && virtualGridW < -stopW;
      // Battery continuation is only allowed for a session that was already
      // started by PV. It never creates a new HVAC start on its own. A valid
      // battery SoC is required so the configured stop threshold can always
      // be enforced safely.
      const batteryContinuationActive = !pvStillAvailable
        && Boolean(settings.hvacAllowOnBattery)
        && avgSoc !== null
        && avgSoc > stopBatterySoc;

      if (!pvStillAvailable && Boolean(settings.hvacAllowOnBattery)
        && avgSoc !== null && avgSoc <= stopBatterySoc) {
        return restoreImmediately(`Batterij-SoC ${avgSoc.toFixed(1)}% · HVAC uit onder ${stopBatterySoc}%`);
      }

      const energyStillAvailable = pvStillAvailable || batteryContinuationActive;
      if (pvStillAvailable) decision.energySource = 'pv';
      else if (batteryContinuationActive) decision.energySource = 'battery';
      if (!energyStillAvailable || targetReached) {
        const baseline = Number(this.hvacBaselineSetpoint);
        const needsReturn = Number.isFinite(baseline) && Math.abs(effectiveSetpoint - baseline) >= 0.1;
        if (needsReturn && intervalReady && Boolean(settings.hvacAllowSetpointControl)) {
          const direction = baseline > effectiveSetpoint ? 0.5 : -0.5;
          let next = effectiveSetpoint + direction;
          if ((direction > 0 && next > baseline) || (direction < 0 && next < baseline)) next = baseline;
          decision.setpointCommand = Math.round(next * 2) / 2;
          if (Boolean(settings.hvacAllowFanControl)) decision.fanTarget = this.getHvacFanScale(settings).min;
          this.lastHvacControlAt = Date.now();
          decision.reason = targetReached
            ? `Comfortdoel bereikt · ${activeMode === 'heat' ? 'verwarmen' : 'koelen'} geleidelijk terug`
            : 'Geen PV/batterijdoorgang · HVAC-setpoint geleidelijk terug';
          return decision;
        }
        if (!needsReturn) {
          // A managed HVAC session is finished here. Restore the original
          // device state even when battery continuation was enabled: that
          // option only extends an active PV session while SoC permits it.
          if (this.hvacManagedPowerOn && Boolean(settings.hvacAllowPowerControl)) {
            decision.powerCommand = false;
            this.hvacManagedPowerOn = false;
          }
          if (Boolean(settings.hvacAllowModeControl) && this.hvacBaselineMode && this.hvacBaselineMode !== mode) {
            decision.modeCommand = this.hvacBaselineMode;
          }
          if (Boolean(settings.hvacAllowFanControl)) decision.fanTarget = this.getHvacFanScale(settings).min;
          decision.reason = targetReached ? 'Comfortdoel bereikt · HVAC-boost afgerond' : 'HVAC-boost afgerond';
          resetBoostState();
          return decision;
        }
        decision.reason = targetReached ? 'Comfortdoel bereikt · wachten op regelinterval' : 'Wachten op terugregel-marge';
        return decision;
      }

      if (batteryContinuationActive) {
        decision.reason = `HVAC verder op thuisbatterij · SoC ${avgSoc.toFixed(1)}% · stop onder ${stopBatterySoc}%`;
      }
    }

    if (!activeMode && !activationMode) {
      decision.reason = `Ruimtetemperatuur binnen activatiemarge ${band.heatBelow.toFixed(1)}–${band.coolAbove.toFixed(1)} °C · geen HVAC-start`;
      return decision;
    }

    if (!controlMode) {
      decision.reason = 'Geen HVAC-modus nodig';
      return decision;
    }

    if (!activeMode && !hasPvBoost) {
      decision.reason = enoughBattery
        ? 'Wachten op voldoende PV-overschot'
        : `HVAC PV-sturing pas boven ${minBatterySoc}% batterij`;
      return decision;
    }

    if (!intervalReady && !activeMode) {
      decision.reason = 'HVAC-start wacht op regelinterval';
      return decision;
    }

    if (!activeMode) {
      decision.energySource = 'pv';
      decision.startEligible = true;
      if (!allowStart) {
        decision.reason = 'Voldoende PV-overschot · wacht op prioriteitencheck';
        return decision;
      }
    }

    if (this.hvacBaselineSetpoint === null) {
      this.hvacBaselineSetpoint = actualSetpoint;
      this.hvacBaselineMode = mode;
      this.hvacBoostMode = controlMode;
    }
    decision.boostActive = true;
    decision.boostMode = this.hvacBoostMode || controlMode;

    if (Boolean(settings.hvacAllowPowerControl) && mode === 'off') {
      decision.powerCommand = true;
      this.hvacManagedPowerOn = true;
    }
    if (Boolean(settings.hvacAllowModeControl) && mode !== controlMode) decision.modeCommand = controlMode;

    const targetSetpoint = this.getHvacTargetSetpoint(controlMode, settings);
    if (Boolean(settings.hvacAllowSetpointControl) && intervalReady && Number.isFinite(targetSetpoint)) {
      let next = effectiveSetpoint;
      if (controlMode === 'cool' && effectiveSetpoint > targetSetpoint) next = Math.max(targetSetpoint, effectiveSetpoint - 0.5);
      if (controlMode === 'heat' && effectiveSetpoint < targetSetpoint) next = Math.min(targetSetpoint, effectiveSetpoint + 0.5);
      if (Math.abs(next - effectiveSetpoint) >= 0.1) decision.setpointCommand = Math.round(next * 2) / 2;
    }

    if (Boolean(settings.hvacAllowFanControl)) {
      decision.fanTarget = this.getHvacFanTargetFromClimate(controlMode, room, outdoor, settings);
      const referenceFan = Number.isFinite(Number(fanSpeed)) ? Number(fanSpeed) : Number(this.lastPublishedHvacFanSpeed);
      if (decision.fanTarget !== null && Number.isFinite(referenceFan)) {
        decision.fanAction = decision.fanTarget > referenceFan ? 'higher' : decision.fanTarget < referenceFan ? 'lower' : 'hold';
      } else if (decision.fanTarget !== null) {
        decision.fanAction = 'set';
      }
    }

    if (decision.setpointCommand !== null || decision.powerCommand !== null || decision.modeCommand) this.lastHvacControlAt = Date.now();
    const priorityLabel = String(settings.hvacPriority || 'comfort') === 'pv' ? 'PV-overschot minimaliseren' : 'Comfort eerst';
    if (!decision.reason) decision.reason = `${controlMode === 'cool' ? 'Koelen' : 'Verwarmen'} op ruimtetemperatuur · ${priorityLabel}`;
    return decision;
  }


  withHvacRuntime(index, callback) {
    if (index === 0) return callback();
    const runtime = this.getExtraHvac(index);
    if (!runtime) return callback();
    const saved = {
      state: {
        roomTemperatureC: this.state.hvacRoomTemperatureC,
        outdoorTemperatureC: this.state.hvacOutdoorTemperatureC,
        mode: this.state.hvacMode,
        setpointC: this.state.hvacSetpointC,
        fanSpeed: this.state.hvacFanSpeed,
      },
      seen: this.inputSeen.hvac,
      updatedAt: this.inputUpdatedAt.hvac,
      lastPublishedPower: this.lastPublishedHvacPower,
      lastPublishedMode: this.lastPublishedHvacMode,
      lastPublishedSetpoint: this.lastPublishedHvacSetpoint,
      lastPublishedFanAction: this.lastPublishedHvacFanAction,
      lastPublishedFanSpeed: this.lastPublishedHvacFanSpeed,
      latestDecision: this.latestHvacDecision,
      baselineSetpoint: this.hvacBaselineSetpoint,
      baselineMode: this.hvacBaselineMode,
      boostMode: this.hvacBoostMode,
      managedPowerOn: this.hvacManagedPowerOn,
      lastControlAt: this.lastHvacControlAt,
    };
    this.state.hvacRoomTemperatureC = runtime.state.roomTemperatureC;
    // Keep the global outdoor temperature while swapping only instance-specific HVAC inputs.
    this.state.hvacOutdoorTemperatureC = saved.state.outdoorTemperatureC;
    this.state.hvacMode = runtime.state.mode;
    this.state.hvacSetpointC = runtime.state.setpointC;
    this.state.hvacFanSpeed = runtime.state.fanSpeed;
    this.inputSeen.hvac = { ...runtime.seen, outdoorTemperature: Boolean(saved.seen?.outdoorTemperature) };
    this.inputUpdatedAt.hvac = { ...runtime.updatedAt, outdoorTemperature: Number(saved.updatedAt?.outdoorTemperature) || 0 };
    this.lastPublishedHvacPower = runtime.lastPublishedPower;
    this.lastPublishedHvacMode = runtime.lastPublishedMode;
    this.lastPublishedHvacSetpoint = runtime.lastPublishedSetpoint;
    this.lastPublishedHvacFanAction = runtime.lastPublishedFanAction;
    this.lastPublishedHvacFanSpeed = runtime.lastPublishedFanSpeed;
    this.latestHvacDecision = runtime.latestDecision;
    this.hvacBaselineSetpoint = runtime.baselineSetpoint;
    this.hvacBaselineMode = runtime.baselineMode;
    this.hvacBoostMode = runtime.boostMode;
    this.hvacManagedPowerOn = runtime.managedPowerOn;
    this.lastHvacControlAt = runtime.lastControlAt;
    try {
      return callback();
    } finally {
      runtime.state.roomTemperatureC = this.state.hvacRoomTemperatureC;
      runtime.state.mode = this.state.hvacMode;
      runtime.state.setpointC = this.state.hvacSetpointC;
      runtime.state.fanSpeed = this.state.hvacFanSpeed;
      // Persist only instance-specific received flags/timestamps. Outdoor remains global.
      runtime.seen = { ...this.inputSeen.hvac, outdoorTemperature: false };
      runtime.updatedAt = { ...this.inputUpdatedAt.hvac, outdoorTemperature: 0 };
      runtime.lastPublishedPower = this.lastPublishedHvacPower;
      runtime.lastPublishedMode = this.lastPublishedHvacMode;
      runtime.lastPublishedSetpoint = this.lastPublishedHvacSetpoint;
      runtime.lastPublishedFanAction = this.lastPublishedHvacFanAction;
      runtime.lastPublishedFanSpeed = this.lastPublishedHvacFanSpeed;
      runtime.latestDecision = this.latestHvacDecision;
      runtime.baselineSetpoint = this.hvacBaselineSetpoint;
      runtime.baselineMode = this.hvacBaselineMode;
      runtime.boostMode = this.hvacBoostMode;
      runtime.managedPowerOn = this.hvacManagedPowerOn;
      runtime.lastControlAt = this.lastHvacControlAt;
      this.state.hvacRoomTemperatureC = saved.state.roomTemperatureC;
      this.state.hvacOutdoorTemperatureC = saved.state.outdoorTemperatureC;
      this.state.hvacMode = saved.state.mode;
      this.state.hvacSetpointC = saved.state.setpointC;
      this.state.hvacFanSpeed = saved.state.fanSpeed;
      this.inputSeen.hvac = saved.seen;
      this.inputUpdatedAt.hvac = saved.updatedAt;
      this.lastPublishedHvacPower = saved.lastPublishedPower;
      this.lastPublishedHvacMode = saved.lastPublishedMode;
      this.lastPublishedHvacSetpoint = saved.lastPublishedSetpoint;
      this.lastPublishedHvacFanAction = saved.lastPublishedFanAction;
      this.lastPublishedHvacFanSpeed = saved.lastPublishedFanSpeed;
      this.latestHvacDecision = saved.latestDecision;
      this.hvacBaselineSetpoint = saved.baselineSetpoint;
      this.hvacBaselineMode = saved.baselineMode;
      this.hvacBoostMode = saved.boostMode;
      this.hvacManagedPowerOn = saved.managedPowerOn;
      this.lastHvacControlAt = saved.lastControlAt;
    }
  }

  calculateHvacControlFor(index, result = this.latestResult, evDecision = this.latestEvDecision, nextBatteryCommandW = this.state.lastTotalCommandW, currentBatteryCommandW = this.state.lastTotalCommandW, options = {}) {
    const settings = this.getHvacInstanceSettings(index, options.storedSettings || this.getSettings());
    return this.withHvacRuntime(index, () => this.calculateHvacControl(
      result,
      evDecision,
      nextBatteryCommandW,
      currentBatteryCommandW,
      { ...options, settings, instanceIndex: index },
    ));
  }

  async publishHvacDecisionFor(index, decision) {
    if (index === 0) return this.publishHvacDecision(decision);
    const runtime = this.getExtraHvac(index);
    if (!runtime || !decision) return;
    const settings = this.getHvacInstanceSettings(index);
    const triggers = this.extraHvacTriggers[index - 1] || {};
    if (decision.powerCommand !== null && Boolean(settings.hvacAllowPowerControl)) {
      const on = Boolean(decision.powerCommand);
      if (runtime.lastPublishedPower !== on) {
        if (triggers.power) await triggers.power.trigger({ state: on ? 'Aan' : 'Uit', state_value: on ? 1 : 0, reason: String(decision.reason || '') });
        runtime.lastPublishedPower = on;
        runtime.managedPowerOn = on;
      }
    }
    if (decision.modeCommand && Boolean(settings.hvacAllowModeControl) && decision.modeCommand !== runtime.lastPublishedMode) {
      if (triggers.mode) await triggers.mode.trigger({ mode: String(decision.modeCommand), reason: String(decision.reason || '') });
      runtime.lastPublishedMode = String(decision.modeCommand);
    }
    if (decision.setpointCommand !== null && Number.isFinite(Number(decision.setpointCommand)) && Boolean(settings.hvacAllowSetpointControl)) {
      const setpoint = Math.round(Number(decision.setpointCommand) * 2) / 2;
      if (runtime.lastPublishedSetpoint === null || !Number.isFinite(Number(runtime.lastPublishedSetpoint)) || Math.abs(setpoint - Number(runtime.lastPublishedSetpoint)) >= 0.1) {
        if (triggers.setpoint) await triggers.setpoint.trigger({ setpoint, reason: String(decision.reason || '') });
        runtime.lastPublishedSetpoint = setpoint;
        if (runtime.baselineSetpoint !== null && Math.abs(setpoint - Number(runtime.baselineSetpoint)) < 0.1) runtime.lastControlAt = 0;
      }
    }
    if (Boolean(settings.hvacAllowFanControl) && (decision.fanTarget !== null || decision.fanAction)) {
      const currentSpeed = runtime.seen?.fanSpeed ? Number(runtime.state.fanSpeed) : NaN;
      const targetSpeed = decision.fanTarget !== null && Number.isFinite(Number(decision.fanTarget))
        ? Number(decision.fanTarget)
        : this.getHvacFanTarget(decision.fanAction, currentSpeed, settings);
      decision.fanTarget = targetSpeed;
      if (targetSpeed !== null && Number.isFinite(Number(targetSpeed))
        && (runtime.lastPublishedFanSpeed === null || Math.abs(targetSpeed - Number(runtime.lastPublishedFanSpeed)) > 0.0001)) {
        const action = String(decision.fanAction || (Number.isFinite(currentSpeed)
          ? targetSpeed > currentSpeed ? 'higher' : targetSpeed < currentSpeed ? 'lower' : 'hold'
          : 'set'));
        if (triggers.fan) await triggers.fan.trigger({
          action,
          current_speed: Number.isFinite(currentSpeed) ? currentSpeed : 0,
          target_speed: targetSpeed,
          reason: String(decision.reason || ''),
        });
        runtime.lastPublishedFanAction = action;
        runtime.lastPublishedFanSpeed = targetSpeed;
      }
    }
    runtime.latestDecision = decision;
  }

  async publishHvacDecision(decision) {
    if (!decision) return;
    const settings = this.getSettings();
    if (decision.powerCommand !== null && Boolean(settings.hvacAllowPowerControl)) {
      const on = Boolean(decision.powerCommand);
      if (this.lastPublishedHvacPower !== on) {
        if (this.hvacPowerTrigger) await this.hvacPowerTrigger.trigger({ state: on ? 'Aan' : 'Uit', state_value: on ? 1 : 0, reason: String(decision.reason || '') });
        this.lastPublishedHvacPower = on;
        if (on) this.hvacManagedPowerOn = true;
        else this.hvacManagedPowerOn = false;
      }
    }
    if (decision.modeCommand && Boolean(settings.hvacAllowModeControl) && decision.modeCommand !== this.lastPublishedHvacMode) {
      if (this.hvacModeTrigger) await this.hvacModeTrigger.trigger({ mode: String(decision.modeCommand), reason: String(decision.reason || '') });
      this.lastPublishedHvacMode = String(decision.modeCommand);
      const token = this.tokens.get('emshvacmode');
      if (token) await token.setValue(String(decision.modeCommand));
    }
    if (decision.setpointCommand !== null && Number.isFinite(Number(decision.setpointCommand)) && Boolean(settings.hvacAllowSetpointControl)) {
      const setpoint = Math.round(Number(decision.setpointCommand) * 2) / 2;
      if (this.lastPublishedHvacSetpoint === null || this.lastPublishedHvacSetpoint === undefined || !Number.isFinite(Number(this.lastPublishedHvacSetpoint)) || Math.abs(setpoint - Number(this.lastPublishedHvacSetpoint)) >= 0.1) {
        if (this.hvacSetpointTrigger) await this.hvacSetpointTrigger.trigger({ setpoint, reason: String(decision.reason || '') });
        this.lastPublishedHvacSetpoint = setpoint;
        const token = this.tokens.get('emshvacsetpoint');
        if (token) await token.setValue(setpoint);
        if (this.hvacBaselineSetpoint !== null && Math.abs(setpoint - Number(this.hvacBaselineSetpoint)) < 0.1) {
          // The next evaluation may now finish the managed power-on session.
          this.lastHvacControlAt = 0;
          if (!Boolean(settings.hvacEnabled)) this.hvacBaselineSetpoint = null;
        }
      }
    }
    if (Boolean(settings.hvacAllowFanControl) && (decision.fanTarget !== null || decision.fanAction)) {
      const currentSpeed = this.inputSeen.hvac?.fanSpeed ? Number(this.state.hvacFanSpeed) : NaN;
      const targetSpeed = decision.fanTarget !== null && Number.isFinite(Number(decision.fanTarget))
        ? Number(decision.fanTarget)
        : this.getHvacFanTarget(decision.fanAction, currentSpeed, settings);
      decision.fanTarget = targetSpeed;
      if (targetSpeed !== null && Number.isFinite(Number(targetSpeed))
        && (this.lastPublishedHvacFanSpeed === null || Math.abs(targetSpeed - Number(this.lastPublishedHvacFanSpeed)) > 0.0001)) {
        const action = String(decision.fanAction || (Number.isFinite(currentSpeed)
          ? targetSpeed > currentSpeed ? 'higher' : targetSpeed < currentSpeed ? 'lower' : 'hold'
          : 'set'));
        if (this.hvacFanTrigger) await this.hvacFanTrigger.trigger({
          action,
          current_speed: Number.isFinite(currentSpeed) ? currentSpeed : 0,
          target_speed: targetSpeed,
          reason: String(decision.reason || ''),
        });
        this.lastPublishedHvacFanAction = action;
        this.lastPublishedHvacFanSpeed = targetSpeed;
      }
    } else if (!decision.fanAction && decision.fanTarget === null) {
      this.lastPublishedHvacFanAction = '';
      if (this.inputSeen.hvac?.fanSpeed && Number.isFinite(Number(this.state.hvacFanSpeed))
        && this.lastPublishedHvacFanSpeed !== null
        && Math.abs(Number(this.state.hvacFanSpeed) - Number(this.lastPublishedHvacFanSpeed)) < 0.0001) {
        this.lastPublishedHvacFanSpeed = Number(this.state.hvacFanSpeed);
      }
    }
  }


  getBoilerCycleDurationMs(settings = this.getSettings()) {
    return Math.max(1, Math.min(24 * 60, Number(settings.boilerCycleMinutes) || 90)) * 60000;
  }

  completeBoilerCycle(now = Date.now(), source = '') {
    this.boilerState.outputOn = false;
    this.boilerState.cycleAccumulatedMs = 0;
    this.boilerState.lastCompletedAt = now;
    this.boilerState.lastCompletedDate = this.getLocalDateKey(new Date(now));
    this.boilerState.lastCompletedSource = String(source || this.boilerState.activeSource || '');
    this.boilerState.activeSource = '';
    this.boilerState.lastTickAt = now;
    this.persistBoilerRuntime();
  }

  calculateBoilerDecision(result = this.latestResult, settings = this.getSettings(), options = {}) {
    const now = Number(options.now) || Date.now();
    this.updateBoilerRuntimeClock(now);
    const enabled = this.getBoilerCount(settings) > 0 && Boolean(settings.boilerEnabled);
    const avgSoc = this.getAverageBatterySoc(settings);
    const startSoc = Math.max(0, Math.min(100, Number(settings.boilerStartSoc) || 90));
    const stopSoc = Math.max(0, Math.min(100, Number(settings.boilerStopSoc) || 70));
    const powerW = Math.max(1, Math.min(20000, Number(settings.boilerPowerW) || 1800));
    const cycleMs = this.getBoilerCycleDurationMs(settings);
    const accumulatedMs = Math.max(0, Number(this.boilerState.cycleAccumulatedMs) || 0);
    const tariff = result?.tariff || findCurrentTariff(new Date(now), settings);
    const fallbackDays = Math.max(0, Math.min(30, Number(settings.boilerFallbackDays) || 0));
    const tariffMinBatterySoc = Math.max(0, Math.min(100, Number.isFinite(Number(settings.boilerTariffMinBatterySoc)) ? Number(settings.boilerTariffMinBatterySoc) : 40));
    const configuredTariffStopSoc = Math.max(0, Math.min(100, Number.isFinite(Number(settings.boilerTariffStopBatterySoc)) ? Number(settings.boilerTariffStopBatterySoc) : 30));
    // Never allow the stop threshold above the start threshold. This keeps the
    // tariff control hysteretic even if settings were imported incorrectly.
    const tariffStopBatterySoc = Math.min(tariffMinBatterySoc, configuredTariffStopSoc);
    const daysWithoutCycle = this.getBoilerDaysWithoutCycle(now);
    const fallbackDue = fallbackDays > 0 && daysWithoutCycle >= fallbackDays;
    const tariffSelected = fallbackDue && this.isBoilerTariffSelected(settings, tariff);
    const tariffBatteryReady = avgSoc !== null && avgSoc >= tariffMinBatterySoc;
    const tariffAllowed = tariffSelected && tariffBatteryReady;
    const gridW = Number.isFinite(Number(options.gridPowerW)) ? Number(options.gridPowerW) : Number(this.state.gridPowerW);
    const currentBatteryCommandW = Number.isFinite(Number(options.currentBatteryCommandW))
      ? Number(options.currentBatteryCommandW)
      : Number(this.state.lastTotalCommandW) || 0;
    const nextBatteryCommandW = Number.isFinite(Number(options.nextBatteryCommandW))
      ? Number(options.nextBatteryCommandW)
      : currentBatteryCommandW;
    const peakLimitW = Math.max(0, Number(settings.peakLimitW) || 2500);
    const peakGuardActive = Boolean(settings.peakShaveEnabled)
      && (String(result?.action || '') === 'peak_shave' || String(result?.override || '') === 'peak_shave');
    // gridW already contains the effect of the currently applied battery command.
    // Predict the meter value after the next battery command by removing the
    // old command contribution and applying the new one. This lets tariff boiler
    // heating continue while Peak Guard is successfully supported by the battery.
    const predictedGridAfterBatteryW = Number.isFinite(gridW)
      ? gridW + currentBatteryCommandW - nextBatteryCommandW
      : null;
    const pvPowerW = Math.max(0, Number(this.state.pvPowerW) || 0);
    const lastPvAt = Number(this.inputUpdatedAt?.pv) || 0;
    const pvFresh = Boolean(this.inputSeen.pv)
      && lastPvAt > 0
      && (now - lastPvAt) <= 5 * 60 * 1000
      && pvPowerW > 0;
    const headroomW = pvFresh ? this.getPvCurtailmentHeadroomW(settings) : 0;
    // Remove the currently applied battery command from the meter position before
    // treating export as solar surplus. Internal battery convention is positive
    // discharge / negative charge, so -(grid + battery) represents the solar
    // power that is actually left for battery charging and/or grid export. Clamp
    // it to the fresh PV input so battery-created export can never start the boiler.
    const measuredSolarSurplusW = pvFresh && Number.isFinite(gridW)
      ? Math.min(pvPowerW, Math.max(0, -(gridW + currentBatteryCommandW)))
      : 0;
    const pvSurplusW = measuredSolarSurplusW + Math.max(0, headroomW);
    const pvEligible = avgSoc !== null && avgSoc >= startSoc && pvSurplusW >= powerW;
    const warmUntil = this.getBoilerWarmUntil(settings);
    const warm = Number(this.boilerState.lastCompletedAt || 0) > 0 && now < warmUntil;
    const completedToday = this.isBoilerCompletedToday(now, settings);
    const running = Boolean(this.boilerState.outputOn);
    const decision = {
      enabled,
      on: running,
      outputCommand: null,
      running,
      activeSource: String(this.boilerState.activeSource || ''),
      startEligible: false,
      startAllowedByPriority: options.allowStart !== false,
      averageBatterySoc: avgSoc,
      startSoc,
      stopSoc,
      powerW,
      pvSurplusW: Math.round(pvSurplusW),
      cycleMinutes: Math.round(cycleMs / 60000),
      accumulatedMinutes: Math.min(cycleMs, accumulatedMs) / 60000,
      remainingMinutes: Math.max(0, cycleMs - accumulatedMs) / 60000,
      completedToday,
      warm,
      warmUntil,
      fallbackDays,
      tariffMinBatterySoc,
      tariffStopBatterySoc,
      daysWithoutCycle,
      fallbackDue,
      tariffSelected,
      tariffBatteryReady,
      tariffAllowed,
      peakGuardActive,
      peakLimitW,
      currentBatteryCommandW: Math.round(currentBatteryCommandW),
      nextBatteryCommandW: Math.round(nextBatteryCommandW),
      predictedGridAfterBatteryW: predictedGridAfterBatteryW === null ? null : Math.round(predictedGridAfterBatteryW),
      reason: '',
    };

    if (running && accumulatedMs >= cycleMs) {
      const completedSource = String(this.boilerState.activeSource || 'pv');
      this.completeBoilerCycle(now, completedSource);
      decision.on = false;
      decision.running = false;
      decision.outputCommand = false;
      decision.accumulatedMinutes = 0;
      decision.remainingMinutes = 0;
      decision.completedToday = true;
      decision.warm = true;
      decision.warmUntil = this.getBoilerWarmUntil(settings);
      decision.reason = 'Boiler-opwarmcyclus voltooid';
      this.boilerState.latestDecision = decision;
      return decision;
    }

    if (!enabled) {
      if (running) {
        decision.on = false;
        decision.outputCommand = false;
        this.boilerState.outputOn = false;
        this.boilerState.activeSource = '';
        this.persistBoilerRuntime();
      }
      decision.reason = 'Boiler-module uit';
      this.boilerState.latestDecision = decision;
      return decision;
    }

    if (running) {
      const source = String(this.boilerState.activeSource || 'pv');
      // PV-driven boiler heating remains the first flexible load to yield during
      // Peak Guard. Tariff fallback is different: grid use is intentional there,
      // so the battery may support the boiler as long as the predicted grid value
      // remains within the configured hard Peak Guard limit.
      if (source !== 'tariff' && peakGuardActive) {
        decision.on = false;
        decision.outputCommand = false;
        decision.reason = 'Peak Guard · boiler onmiddellijk uit';
      } else if (source === 'tariff' && peakGuardActive
        && (predictedGridAfterBatteryW === null || predictedGridAfterBatteryW > peakLimitW)) {
        decision.on = false;
        decision.outputCommand = false;
        decision.reason = predictedGridAfterBatteryW === null
          ? 'Peak Guard · onvoldoende meetdata · boilertariefladen gestopt'
          : `Peak Guard ${peakLimitW} W niet haalbaar (${Math.round(predictedGridAfterBatteryW)} W verwacht) · boilertariefladen gestopt`;
      } else if (source === 'pv' && avgSoc !== null && avgSoc <= stopSoc) {
        decision.on = false;
        decision.outputCommand = false;
        decision.reason = `Batterij-SoC ${avgSoc.toFixed(1)}% · boiler uit onder ${stopSoc}%`;
      } else if (source === 'tariff' && !this.isBoilerTariffSelected(settings, tariff)) {
        decision.on = false;
        decision.outputCommand = false;
        decision.reason = 'Boilertarief afgelopen · cyclus later verderzetten';
      } else if (source === 'tariff' && (avgSoc === null || avgSoc <= tariffStopBatterySoc)) {
        decision.on = false;
        decision.outputCommand = false;
        decision.reason = avgSoc === null
          ? 'Wachten op batterij-SoC voor boilertariefladen'
          : `Batterij-SoC ${avgSoc.toFixed(1)}% · boilertariefladen stopt op/onder ${tariffStopBatterySoc}%`;
      } else {
        decision.reason = source === 'tariff'
          ? (peakGuardActive
            ? `Boiler verwarmt tijdens geselecteerd tarief · Peak Guard ondersteund door batterij (${Math.round(predictedGridAfterBatteryW)} W verwacht)`
            : 'Boiler verwarmt tijdens geselecteerd tarief')
          : 'Boiler verwarmt met PV-overschot';
        this.boilerState.latestDecision = decision;
        return decision;
      }
      this.boilerState.outputOn = false;
      this.boilerState.activeSource = '';
      this.persistBoilerRuntime();
      this.boilerState.latestDecision = decision;
      return decision;
    }

    if (warm) {
      decision.reason = `Boiler opgewarmd · opnieuw koud om ${this.getBoilerColdResetTime(settings)}`;
      this.boilerState.latestDecision = decision;
      return decision;
    }

    const source = tariffAllowed ? 'tariff' : pvEligible ? 'pv' : '';
    if (!source) {
      if (tariffSelected && !tariffBatteryReady) {
        decision.reason = avgSoc === null
          ? 'Geselecteerd boilertarief · wachten op batterij-SoC'
          : `Geselecteerd boilertarief · batterij eerst naar ${tariffMinBatterySoc}% (nu ${avgSoc.toFixed(1)}%)`;
      } else if (avgSoc === null) decision.reason = 'Wachten op batterij-SoC';
      else if (avgSoc < startSoc) decision.reason = `Boiler start pas boven ${startSoc}% batterij`;
      else if (pvSurplusW < powerW) decision.reason = `Wachten op ${powerW} W resterend PV-overschot`;
      else decision.reason = 'Wachten op PV-overschot of geselecteerd boilertarief';
      this.boilerState.latestDecision = decision;
      return decision;
    }

    decision.startEligible = true;
    decision.activeSource = source;
    if (options.allowStart === false) {
      decision.reason = source === 'tariff'
        ? 'Boiler mag op tarief starten · wacht op prioriteitencheck'
        : 'Voldoende PV-overschot · boiler wacht op prioriteitencheck';
      this.boilerState.latestDecision = decision;
      return decision;
    }

    decision.on = true;
    decision.outputCommand = true;
    decision.running = true;
    decision.reason = source === 'tariff' ? 'Boiler gestart tijdens geselecteerd tarief' : 'Boiler gestart met PV-overschot';
    this.boilerState.outputOn = true;
    this.boilerState.activeSource = source;
    this.boilerState.lastTickAt = now;
    this.persistBoilerRuntime();
    this.boilerState.latestDecision = decision;
    return decision;
  }

  async publishBoilerDecision(decision) {
    if (!decision) return;

    // Warmed status is independent from the relay command. Publish it whenever
    // a completed cycle becomes warm, the warm-hold expires, or the boiler
    // module is disabled. This uses the existing EMS pass and adds no timer.
    const warmed = Boolean(decision.enabled && decision.warm);
    if (this.boilerState.lastPublishedWarmed !== warmed) {
      if (this.boilerWarmedTrigger) await this.boilerWarmedTrigger.trigger({ warmed });
      this.boilerState.lastPublishedWarmed = warmed;
    }

    const initialSync = this.boilerState.lastPublishedOutput === null || this.boilerState.lastPublishedOutput === undefined;
    if (!initialSync && (decision.outputCommand === null || decision.outputCommand === undefined)) return;
    const on = initialSync ? Boolean(decision.on) : Boolean(decision.outputCommand);
    if (this.boilerState.lastPublishedOutput === on) return;
    if (this.boilerTrigger) await this.boilerTrigger.trigger({ on });
    this.boilerState.lastPublishedOutput = on;
  }

  isHvacManagedActiveFor(index) {
    if (index === 0) return this.hvacBaselineSetpoint !== null || Boolean(this.hvacManagedPowerOn);
    const runtime = this.getExtraHvac(index);
    return Boolean(runtime && (runtime.baselineSetpoint !== null || runtime.managedPowerOn));
  }

  isEvDecisionOutputActiveFor(index, decision, settings = this.getSettings()) {
    const instanceSettings = this.getEvInstanceSettings(index, settings);
    instanceSettings.evMode = this.getEffectiveEvModeFor(index, settings);
    if (this.getEvControlType(instanceSettings) === 'mode') {
      return this.getEvChargeModeFor(index, decision, instanceSettings) !== 'stop';
    }
    return Boolean(decision?.allowed && Number(decision?.desiredCurrentA || 0) > 0);
  }

  getEvExpectedPowerFor(index, decision, settings = this.getSettings()) {
    if (!decision) return 0;
    const instanceSettings = this.getEvInstanceSettings(index, settings);
    const active = this.isEvDecisionOutputActiveFor(index, decision, settings);
    const desired = Math.max(0, Number(decision.desiredPowerW) || 0);
    if (desired > 0) return desired;
    if (active) return Math.max(0, Number(decision.actualPowerW) || 0);
    return 0;
  }

  async publishFlexibleLoads(result = this.latestResult, nextBatteryCommandW = this.state.lastTotalCommandW, currentBatteryCommandW = this.state.lastTotalCommandW, options = {}) {
    const storedSettings = this.getSettings();
    const evCount = this.getEvCount(storedSettings);
    const evDecisions = [];
    let adjustedGridW = Number(this.state.gridPowerW) || 0;
    let totalActualEvPowerW = 0;
    let totalDesiredEvPowerW = 0;
    let evStartedThisCycle = false;

    for (let index = 0; index < evCount; index += 1) {
      const instanceSettings = this.getEvInstanceSettings(index, storedSettings);
      instanceSettings.evMode = this.getEffectiveEvModeFor(index, storedSettings);
      let decision = index === 0
        ? (options.evDecision || this.calculateEvControl(result, nextBatteryCommandW, currentBatteryCommandW))
        : this.calculateAdditionalEvControl(index, result, nextBatteryCommandW, currentBatteryCommandW, adjustedGridW);
      decision = { ...(decision || {}), instance: index + 1 };
      const previousActive = this.isEvOutputActiveFor(index, storedSettings);
      const previousCurrentA = index === 0
        ? Number(this.lastPublishedEvCurrentA || 0)
        : Number(this.getExtraEv(index)?.lastPublishedCurrentA || 0);
      const controlType = this.getEvControlType(instanceSettings);
      const evIncreaseBlocked = options.allowEvIncrease === false && Number(decision.desiredCurrentA || 0) > 0
        && (controlType === 'current'
          ? Number(decision.desiredCurrentA || 0) > previousCurrentA
          : !previousActive);
      if (evIncreaseBlocked) {
        decision.desiredCurrentA = controlType === 'current' ? previousCurrentA : 0;
        decision.desiredPowerW = Math.round(decision.desiredCurrentA * evPowerPerAmp(instanceSettings));
        decision.allowed = controlType === 'current' ? decision.desiredCurrentA > 0 : previousActive;
        decision.reason = 'Wachten op eerstvolgende batterijopdracht · batterijsetpoint moet eerst veilig worden toegepast';
      }

      let desiredActive = this.isEvDecisionOutputActiveFor(index, decision, storedSettings);
      if (!previousActive && desiredActive && evStartedThisCycle) {
        decision.allowed = false;
        decision.desiredCurrentA = 0;
        decision.desiredPowerW = 0;
        decision.requestedCurrentA = 0;
        decision.requestedPowerW = 0;
        decision.pvRequestPowerW = 0;
        decision.gridRequestPowerW = 0;
        decision.source = 'off';
        decision.reason = 'Een andere EV start deze regelcyclus · opnieuw beoordelen bij de volgende EMS-cyclus';
        desiredActive = false;
      }
      if (!previousActive && desiredActive) evStartedThisCycle = true;

      const actualPowerW = Math.max(0, Number(decision.actualPowerW) || 0);
      const expectedPowerW = this.getEvExpectedPowerFor(index, decision, storedSettings);
      totalActualEvPowerW += actualPowerW;
      totalDesiredEvPowerW += expectedPowerW;
      adjustedGridW += expectedPowerW - actualPowerW;
      evDecisions.push(decision);

      if (index === 0) {
        this.latestEvDecision = decision;
        await this.publishEvDecision(decision);
      } else {
        const runtime = this.getExtraEv(index);
        if (runtime) runtime.latestDecision = decision;
        await this.publishAdditionalEvDecision(index, decision);
      }
    }

    // EV instances removed from the configured count are explicitly stopped
    // once if HomeFlux was still publishing an active output for them.
    for (let index = evCount; index < 4; index += 1) {
      if (!this.isEvOutputActiveFor(index, storedSettings)) continue;
      const settings = this.getEvInstanceSettings(index, storedSettings);
      const input = this.getEvInputSnapshot(index) || {};
      const actualCurrentA = Math.max(0, Number(input.chargeCurrentA) || 0);
      const stopDecision = {
        instance: index + 1, enabled: false, connected: Boolean(input.connected), allowed: false,
        desiredCurrentA: 0, desiredPowerW: 0, actualCurrentA,
        actualPowerW: Math.round(actualCurrentA * evPowerPerAmp(settings)),
        source: 'off', reason: `EV ${index + 1} niet actief in configuratie`, peakLimited: false,
      };
      if (index === 0) {
        this.latestEvDecision = stopDecision;
        await this.publishEvDecision(stopDecision);
      } else {
        const runtime = this.getExtraEv(index);
        if (runtime) runtime.latestDecision = stopDecision;
        await this.publishAdditionalEvDecision(index, stopDecision);
      }
    }

    const hvacCount = this.getHvacCount(storedSettings);
    const hvacDecisions = Array(hvacCount).fill(null);
    const hvacPreviews = Array(hvacCount).fill(null);
    const priorityDue = this.isFlexiblePriorityEvaluationDue(Date.now(), storedSettings);

    for (let index = 0; index < hvacCount; index += 1) {
      const active = this.isHvacManagedActiveFor(index);
      hvacPreviews[index] = this.calculateHvacControlFor(
        index,
        result,
        evDecisions[0] || null,
        nextBatteryCommandW,
        currentBatteryCommandW,
        {
          storedSettings,
          allowStart: active,
          totalActualEvPowerW,
          totalDesiredEvPowerW,
        },
      );
    }

    const boilerNextBatteryCommandW = Number.isFinite(Number(options.effectiveNextBatteryCommandW))
      ? Number(options.effectiveNextBatteryCommandW)
      : nextBatteryCommandW;
    let boilerDecision = this.calculateBoilerDecision(result, storedSettings, {
      allowStart: Boolean(this.boilerState.outputOn),
      gridPowerW: adjustedGridW,
      currentBatteryCommandW,
      nextBatteryCommandW: boilerNextBatteryCommandW,
    });

    let grantedId = '';
    if (priorityDue) {
      if (!evStartedThisCycle) {
        const eligible = new Map();
        if (Boolean(boilerDecision?.startEligible) && !Boolean(this.boilerState.outputOn)) eligible.set('boiler', true);
        for (let index = 0; index < hvacCount; index += 1) {
          if (Boolean(hvacPreviews[index]?.startEligible) && !this.isHvacManagedActiveFor(index)) eligible.set(`hvac${index + 1}`, true);
        }
        grantedId = this.getFlexibleLoadPriorityOrder(storedSettings).find(id => eligible.get(id)) || '';
      }
      this.finishFlexiblePriorityEvaluation(Date.now(), storedSettings, grantedId || (evStartedThisCycle ? 'ev' : ''));
    }

    for (let index = 0; index < hvacCount; index += 1) {
      const id = `hvac${index + 1}`;
      const active = this.isHvacManagedActiveFor(index);
      let decision = hvacPreviews[index];
      if (!active && grantedId === id) {
        decision = this.calculateHvacControlFor(
          index,
          result,
          evDecisions[0] || null,
          nextBatteryCommandW,
          currentBatteryCommandW,
          {
            storedSettings,
            allowStart: true,
            totalActualEvPowerW,
            totalDesiredEvPowerW,
          },
        );
      }
      hvacDecisions[index] = decision;
      if (index === 0) this.latestHvacDecision = decision;
      else {
        const runtime = this.getExtraHvac(index);
        if (runtime) runtime.latestDecision = decision;
      }
      await this.publishHvacDecisionFor(index, decision);
    }

    // HVAC instances removed from the configured count are restored once when
    // HomeFlux still owns an active session.
    for (let index = hvacCount; index < 4; index += 1) {
      if (!this.isHvacManagedActiveFor(index)) continue;
      const disabledSettings = { ...storedSettings, [this.getHvacSettingKey(index, 'Enabled')]: false };
      const decision = this.calculateHvacControlFor(index, result, evDecisions[0] || null, nextBatteryCommandW, currentBatteryCommandW, {
        storedSettings: disabledSettings,
        allowStart: false,
        totalActualEvPowerW,
        totalDesiredEvPowerW,
      });
      await this.publishHvacDecisionFor(index, decision);
    }

    if (!this.boilerState.outputOn && grantedId === 'boiler') {
      boilerDecision = this.calculateBoilerDecision(result, storedSettings, {
        allowStart: true,
        gridPowerW: adjustedGridW,
        currentBatteryCommandW,
        nextBatteryCommandW: boilerNextBatteryCommandW,
      });
    }
    await this.publishBoilerDecision(boilerDecision);

    return {
      ev: evDecisions[0] || null,
      evs: evDecisions,
      hvac: hvacDecisions[0] || null,
      hvacs: hvacDecisions,
      boiler: boilerDecision,
      priority: {
        due: priorityDue,
        grantedId,
        nextEvaluationAt: Number(this.flexiblePriorityState.nextEvaluationAt) || 0,
        order: this.getFlexibleLoadPriorityOrder(storedSettings),
      },
    };
  }

  calculatePvPowerLimit(settings = this.getSettings(), nextBatteryCommandW = this.state.lastTotalCommandW, currentBatteryCommandW = this.state.lastTotalCommandW) {
    const enabled = Boolean(settings.exportLimitEnabled);
    const minimumExportW = Math.max(0, Math.min(5000, Number(settings.minimumExportW) || 0));
    const pvPowerW = Number(this.state.pvPowerW);
    const gridPowerW = Number(this.state.gridPowerW);
    const currentLimitPercent = Number.isFinite(Number(this.lastPublishedPvLimitPercent))
      ? Math.max(10, Math.min(100, Number(this.lastPublishedPvLimitPercent)))
      : 100;
    const averageBatterySoc = this.getAverageBatterySoc(settings);
    const configuredCurtailSoc = Number(settings.pvCurtailMinBatterySoc);
    const minBatterySoc = Math.max(0, Math.min(100, Number.isFinite(configuredCurtailSoc) ? configuredCurtailSoc : 95));
    const batterySocAllowsCurtailment = averageBatterySoc !== null && averageBatterySoc >= minBatterySoc;

    const unrestricted = {
      enabled,
      averageBatterySoc,
      minBatterySoc,
      batterySocAllowsCurtailment,
      limitPercent: 100,
      targetPowerW: Number.isFinite(pvPowerW) ? Math.max(0, Math.round(pvPowerW)) : 0,
      curtailmentW: 0,
      minimumExportW,
      targetGridW: batterySocAllowsCurtailment ? -minimumExportW : 0,
      predictedGridBeforePvW: Number.isFinite(gridPowerW) ? Math.round(gridPowerW) : null,
      predictedGridAfterPvW: Number.isFinite(gridPowerW) ? Math.round(gridPowerW) : null,
    };

    // Below the configured battery SoC threshold, or when no valid battery
    // SoC exists yet, PV must remain unrestricted. If the inverter was already
    // curtailed this naturally publishes 100% again (subject to the PV command
    // interval), so available solar can continue charging the battery first.
    if (!enabled || !batterySocAllowsCurtailment || !this.inputSeen?.pv || !Number.isFinite(pvPowerW) || pvPowerW <= 0 || !Number.isFinite(gridPowerW)) return unrestricted;

    // The live grid value still reflects the CURRENT battery output. Predict what
    // the grid will do after the next real battery command before deciding how
    // much PV still needs to be curtailed. This prevents battery charging and PV
    // limiting from both correcting the same export at the same time.
    const currentBatteryW = Number(currentBatteryCommandW) || 0;
    const nextBatteryW = Number(nextBatteryCommandW) || 0;
    const evPerAmpW = evPowerPerAmp(settings);
    const actualEvPowerW = Boolean(settings.evEnabled) && Boolean(this.state.evConnected) && this.inputSeen.ev?.chargeCurrent
      ? Math.max(0, Number(this.state.evChargeCurrentA) || 0) * evPerAmpW
      : 0;
    const expectedEvPowerW = Boolean(settings.evEnabled)
      ? Math.max(0, Number(this.lastPublishedEvCurrentA) || 0) * evPerAmpW
      : 0;
    // EV is published before PV limiting. Reserve its newly requested power so
    // the inverter does not curtail the same surplus that was just allocated to
    // the car. Actual grid feedback remains authoritative on the next cycle.
    const predictedGridBeforePvW = gridPowerW + currentBatteryW - nextBatteryW + expectedEvPowerW - actualEvPowerW;
    const targetGridW = -minimumExportW;

    // When PV is already curtailed, pvPowerW is normally the ACTUAL reduced
    // production. Reconstruct the approximate 100% production so a stable
    // 50% limit stays near 50% instead of jumping back to 100% every cycle.
    const estimatedFullPvW = currentLimitPercent < 100
      ? Math.max(pvPowerW, pvPowerW * (100 / currentLimitPercent))
      : pvPowerW;
    const requiredGridIncreaseW = targetGridW - predictedGridBeforePvW;
    const desiredActualPvW = Math.max(0, pvPowerW - requiredGridIncreaseW);
    const rawPercent = estimatedFullPvW > 0 ? (desiredActualPvW / estimatedFullPvW) * 100 : 100;

    // Round UP to a whole percentage so HomeFlux never intentionally reduces PV
    // further than necessary. This deliberately leaves at least the configured
    // small export buffer whenever the inverter's 10..100% range can achieve it.
    const limitPercent = Math.max(10, Math.min(100, Math.ceil(rawPercent)));
    const targetPowerW = Math.round(estimatedFullPvW * (limitPercent / 100));
    const pvDeltaFromCurrentW = pvPowerW - targetPowerW;
    const curtailmentW = Math.max(0, Math.round(pvDeltaFromCurrentW));
    const predictedGridAfterPvW = predictedGridBeforePvW + pvDeltaFromCurrentW;

    return {
      enabled,
      averageBatterySoc,
      minBatterySoc,
      batterySocAllowsCurtailment,
      limitPercent,
      targetPowerW,
      curtailmentW,
      minimumExportW,
      targetGridW,
      predictedGridBeforePvW: Math.round(predictedGridBeforePvW),
      predictedGridAfterPvW: Math.round(predictedGridAfterPvW),
    };
  }

  getPvCommandIntervalMs(settings = this.getSettings()) {
    return Math.max(1, Number(settings.pvCommandIntervalSeconds) || DEFAULTS.pvCommandIntervalSeconds || 10) * 1000;
  }

  schedulePvPowerLimitPublish(waitMs) {
    const delay = Math.max(0, Math.round(Number(waitMs) || 0));
    if (this.pvLimitTimer) return;
    this.pvLimitTimer = this.homey.setTimeout(() => {
      this.pvLimitTimer = null;
      // Recalculate from the newest measurements and the last REAL battery
      // command. Never queue an old PV percentage while the inverter timer is
      // locked.
      this.publishPvPowerLimit(this.latestResult, this.state.lastTotalCommandW, this.state.lastTotalCommandW)
        .catch(err => this.error('Delayed PV power limit publish failed', err));
    }, delay);
  }

  async publishPvPowerLimit(result, nextBatteryCommandW = this.state.lastTotalCommandW, currentBatteryCommandW = this.state.lastTotalCommandW) {
    const settings = this.getSettings();
    const allowed = Boolean(result?.controlEnabled) && Boolean(result?.inputReady) && Boolean(settings.exportLimitEnabled);
    const calculated = allowed
      ? this.calculatePvPowerLimit(settings, nextBatteryCommandW, currentBatteryCommandW)
      : { ...this.calculatePvPowerLimit({ ...settings, exportLimitEnabled: false }, nextBatteryCommandW, currentBatteryCommandW), enabled: false };

    const percent = Math.max(10, Math.min(100, Math.round(Number(calculated.limitPercent) || 100)));
    const targetPowerW = Math.max(0, Math.round(Number(calculated.targetPowerW) || 0));
    const changed = this.lastPublishedPvLimitPercent !== percent;

    if (result) {
      result.pvLimitPercent = percent;
      result.pvLimitTargetPowerW = targetPowerW;
      result.pvLimitCurtailmentW = Math.max(0, Math.round(Number(calculated.curtailmentW) || 0));
      result.pvLimitTargetGridW = Math.round(Number(calculated.targetGridW) || 0);
      result.pvLimitPredictedGridW = calculated.predictedGridAfterPvW;
    }
    if (!changed) return calculated;

    const intervalMs = this.getPvCommandIntervalMs(settings);
    const now = Date.now();
    const allowedAt = this.lastPvLimitPublishedAt > 0 ? this.lastPvLimitPublishedAt + intervalMs : 0;
    if (now < allowedAt) {
      this.schedulePvPowerLimitPublish(allowedAt - now);
      return calculated;
    }
    if (this.pvLimitPublishing) {
      // An async Flow/token write is still in progress. Recalculate again after
      // it completes instead of starting a second inverter write in parallel.
      this.schedulePvPowerLimitPublish(Math.max(1, intervalMs));
      return calculated;
    }

    this.pvLimitPublishing = true;
    try {
      const token = this.tokens.get('emspvlimit');
      if (token) await token.setValue(percent);
      if (this.pvLimitTrigger) {
        await this.pvLimitTrigger.trigger({
          limit_percent: percent,
          target_power: targetPowerW,
          curtailed_power: Math.max(0, Math.round(Number(calculated.curtailmentW) || 0)),
          minimum_export: Math.max(0, Math.round(Number(calculated.minimumExportW) || 0)),
          predicted_grid: calculated.predictedGridAfterPvW === null ? 0 : Math.round(Number(calculated.predictedGridAfterPvW) || 0),
        });
      }
      // Only remember the limit after the Flow publication succeeded. A failed
      // trigger is retried from fresh measurements on a later control pass.
      this.lastPublishedPvLimitPercent = percent;
      this.lastPublishedPvTargetPowerW = targetPowerW;
      this.lastPvLimitPublishedAt = Date.now();
    } finally {
      this.pvLimitPublishing = false;
    }
    return calculated;
  }

  refreshControlContext(storedSettings, evaluationState, now = Date.now()) {
    const runtimeSettings = this.getRuntimeSettings(storedSettings);
    this.controlContext = prepareControlContext(evaluationState, runtimeSettings, new Date(now));
    this.controlRuntimeSettings = runtimeSettings;
    this.cachedRuntimeSettings = runtimeSettings;
    this.controlContextDirty = false;
    this.controlContextUpdatedAt = now;
    this.lastSlowEvaluationAt = now;
    return runtimeSettings;
  }

  cacheEvBatteryCoordination(rawCandidateTotalW, result, now = Date.now()) {
    const raw = Number(rawCandidateTotalW);
    const coordinated = Number(result?.candidateTotalCommandW);
    if (Number.isFinite(raw) && raw < 0 && Number.isFinite(coordinated) && coordinated > raw + 0.5) {
      this.evBatteryCoordinationCache = { maxChargeW: Math.max(0, -coordinated), at: now };
    } else {
      this.evBatteryCoordinationCache = { maxChargeW: null, at: now };
    }
  }

  applyCachedEvBatteryCoordination(result, storedSettings, now = Date.now()) {
    const cachedLimit = this.evBatteryCoordinationCache?.maxChargeW;
    const age = now - Number(this.evBatteryCoordinationCache?.at || 0);
    // null explicitly means that the slow EV/battery pass imposed no charge
    // limit. Do not coerce it with Number(null), because JavaScript converts
    // that sentinel to 0 and the fast P1 loop would then cancel every battery
    // charge request, even while the EV module is disabled. A numeric 0 remains
    // a valid explicit limit when coordination genuinely leaves no headroom.
    if (cachedLimit === null || cachedLimit === undefined
      || age > this.getSlowControlIntervalMs(storedSettings) * 2) {
      if (this.latestEvDecision) result.evDecision = this.latestEvDecision;
      return result;
    }
    const limit = Number(cachedLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      if (this.latestEvDecision) result.evDecision = this.latestEvDecision;
      return result;
    }
    const beforeCoordinationW = Number(result?.candidateTotalCommandW);
    if (beforeCoordinationW < 0) this.reduceBatteryChargeResult(result, limit, storedSettings);
    if (Number.isFinite(beforeCoordinationW)
      && Math.abs((Number(result?.candidateTotalCommandW) || 0) - beforeCoordinationW) > 0.5) {
      this.refreshBatteryPresentationAfterCoordination(result, storedSettings);
    }
    if (this.latestEvDecision) result.evDecision = this.latestEvDecision;
    return result;
  }

  getFastSignalThresholdW(settings = this.getSettings()) {
    const deadband = Math.max(0, Number(settings.commandDeadbandW) || 0);
    const step = Math.max(1, Number(settings.batteryCommandStepW) || 1);
    // 50 W filters ordinary P1 jitter while remaining far below the power step
    // of typical batteries. Crossing the configured zero band always bypasses
    // this delta threshold.
    return Math.max(50, deadband, step);
  }

  getFastControlSnapshot(settings = this.getSettings(), now = Date.now(), evaluationState = null) {
    const rawGridW = evaluationState && Number.isFinite(Number(evaluationState.gridPowerW))
      ? Number(evaluationState.gridPowerW)
      : Number(this.state.gridPowerW);
    if (!Number.isFinite(rawGridW)) return null;

    const pvW = evaluationState && Number.isFinite(Number(evaluationState.pvPowerW))
      ? Number(evaluationState.pvPowerW)
      : (Number.isFinite(Number(this.state.pvPowerW)) ? Number(this.state.pvPowerW) : 0);
    let controlGridW;
    if (evaluationState && Number.isFinite(Number(evaluationState.controlGridPowerW))) {
      controlGridW = Number(evaluationState.controlGridPowerW);
    } else {
      const averageGridW = this.getGridAverage(5000, now);
      const configuredPvDeltaThresholdW = Number(settings.pvDeltaThresholdW);
      const pvDeltaThresholdW = Number.isFinite(configuredPvDeltaThresholdW)
        ? Math.max(0, configuredPvDeltaThresholdW) : 100;
      const lastPvW = Number(this.pvAtLastControlW);
      const pvDeltaW = Number.isFinite(lastPvW) ? pvW - lastPvW : 0;
      const useLiveGrid = pvDeltaThresholdW > 0 && Math.abs(pvDeltaW) >= pvDeltaThresholdW;
      const evActualPowerW = Boolean(settings.evEnabled) && Boolean(this.state.evConnected) && this.inputSeen.ev?.chargeCurrent
        ? Math.max(0, Number(this.state.evChargeCurrentA) || 0) * evPowerPerAmp(settings)
        : 0;
      controlGridW = (useLiveGrid ? rawGridW : averageGridW) - evActualPowerW;
    }

    let zeroMin = Number(settings.gridZeroMinW);
    let zeroMax = Number(settings.gridZeroMaxW);
    if (!Number.isFinite(zeroMin)) zeroMin = -5;
    if (!Number.isFinite(zeroMax)) zeroMax = 25;
    if (zeroMin > zeroMax) [zeroMin, zeroMax] = [zeroMax, zeroMin];
    const zone = controlGridW < zeroMin ? 'export' : controlGridW > zeroMax ? 'import' : 'inside';
    const softPeakW = Math.max(0, Number(settings.peakLimitW) || 2500)
      - Math.max(0, Number(settings.peakSoftMarginW) || 0);
    const peak = Boolean(settings.peakShaveEnabled) && rawGridW >= softPeakW;
    return { at: now, rawGridW, controlGridW, pvW, zone, peak };
  }

  shouldRunFastEvaluation(force = false, settings = this.getSettings(), now = Date.now()) {
    if (force) return true;
    if (!this.controlContext || !this.controlRuntimeSettings || !this.latestResult) return false;
    const current = this.getFastControlSnapshot(settings, now);
    if (!current) return false;
    const previous = this.lastFastControlSnapshot;
    if (!previous) return true;
    if (current.peak !== previous.peak || current.zone !== previous.zone) return true;

    const baseMode = String(this.latestResult.baseMode || '');
    const feedbackMode = ['self_consumption', 'avoid_import', 'solar_capture'].includes(baseMode);
    if (!feedbackMode && !current.peak && String(this.latestResult.override || '') !== 'peak_shave') return false;

    const pvThreshold = Math.max(0, Number(settings.pvDeltaThresholdW) || 0);
    if (pvThreshold > 0 && Math.abs(current.pvW - previous.pvW) >= pvThreshold) return true;
    const signalThreshold = this.getFastSignalThresholdW(settings);
    if (Math.abs(current.controlGridW - previous.controlGridW) >= signalThreshold) return true;
    if ((current.peak || previous.peak || String(this.latestResult.override || '') === 'peak_shave')
      && Math.abs(current.rawGridW - previous.rawGridW) >= signalThreshold) return true;
    return false;
  }

  rememberFastControlSnapshot(settings, now, evaluationState) {
    const snapshot = this.getFastControlSnapshot(settings, now, evaluationState);
    if (snapshot) this.lastFastControlSnapshot = snapshot;
  }

  getPausedEvaluationResult(now, storedSettings, forceStatus = false) {
    const pauseInfo = this.getBatteryCommandPauseInfo(now, storedSettings);
    if (!pauseInfo.active) return null;
    this.pendingResult = null;
    this.pendingCommandBypassInterval = false;
    this.scheduleBatteryCommandPauseResume(pauseInfo, now);
    if (this.latestResult) {
      const held = {
        ...this.latestResult,
        batteryCommandPauseActive: true,
        batteryCommandPauseStart: pauseInfo.start,
        batteryCommandPauseEnd: pauseInfo.end,
        statusText: `Batterijsturing gepauzeerd · ${pauseInfo.start}–${pauseInfo.end} · laatste setpoint behouden`,
      };
      this.queueStatusUpdate(held, forceStatus);
    }
    return this.latestResult;
  }

  requestEvaluate(immediate = false) {
    const now = Date.now();
    const controlSettings = this.getSettings();
    const pauseInfo = this.getBatteryCommandPauseInfo(now, controlSettings);
    if (pauseInfo.active) {
      if (this.controlTimer) {
        clearTimeout(this.controlTimer);
        this.controlTimer = null;
      }
      this.scheduleBatteryCommandPauseResume(pauseInfo, now);
      return false;
    }

    // This predicate is intentionally tiny and runs on the latest in-memory P1
    // values only. Stable meter noise therefore creates no 10-second sawtooth.
    if (!this.shouldRunFastEvaluation(immediate, controlSettings, now)) {
      this.fastEvaluationSkipped += 1;
      return false;
    }

    const intervalMs = Math.max(1, Number(controlSettings.commandIntervalSeconds) || DEFAULTS.commandIntervalSeconds || 10) * 1000;
    const earliest = this.lastControlEvalAt > 0 ? this.lastControlEvalAt + intervalMs : now;
    const wait = immediate && now >= earliest ? 0 : Math.max(0, earliest - now);

    if (wait === 0) {
      if (this.controlTimer) {
        clearTimeout(this.controlTimer);
        this.controlTimer = null;
      }
      this.evaluateFastNow(immediate);
      return true;
    }

    // All meter updates inside the hard battery interval collapse into one
    // fresh calculation. No slow subsystem work is attached to this timer.
    if (this.controlTimer) return true;
    this.controlTimer = this.homey.setTimeout(() => {
      this.controlTimer = null;
      const latestSettings = this.getSettings();
      if (this.shouldRunFastEvaluation(false, latestSettings, Date.now())) this.evaluateFastNow(false);
      else this.fastEvaluationSkipped += 1;
    }, wait);
    return true;
  }

  evaluateFastNow(forceStatus = false) {
    try {
      const now = Date.now();
      const storedSettings = this.getSettings();
      const paused = this.getPausedEvaluationResult(now, storedSettings, forceStatus);
      if (paused) return paused;

      // Startup and a structural settings change are handled by the slow pass.
      // Never rebuild tariffs, forecasts or flexible loads in the P1 path.
      if (!this.controlContext || !this.controlRuntimeSettings) {
        this.requestContextEvaluate(true, 'fast_loop_needs_context');
        return this.latestResult;
      }

      const pvNow = Number.isFinite(Number(this.state.pvPowerW)) ? Number(this.state.pvPowerW) : 0;
      const pvDeltaW = this.pvAtLastControlW === null ? 0 : pvNow - this.pvAtLastControlW;
      const evaluationState = this.getEvaluationState(storedSettings, now, pvDeltaW);
      const settings = this.controlRuntimeSettings;
      const calculated = evaluate(evaluationState, settings, new Date(now), this.controlContext);
      this.lastControlEvalAt = now;
      this.pvAtLastControlW = pvNow;
      this.rememberFastControlSnapshot(storedSettings, now, evaluationState);

      const readiness = this.getInputReadiness(storedSettings);
      const result = this.createSafetyResult(calculated, settings, readiness);
      this.applyCachedEvBatteryCoordination(result, storedSettings, now);

      const previous = this.latestResult || {};
      result.warningText = String(previous.warningText || this.balanceMonitor?.warningText || '');
      if (result.warningText && !String(result.statusText || '').includes('WAARSCHUWING Battery Balance')) {
        result.statusText = `${result.statusText} · WAARSCHUWING Battery Balance`;
      }
      result.homeyEnergy = previous.homeyEnergy || this.getHomeyEnergyStatus(settings);
      result.controlProfile = String(settings.controlProfile || 'normal');
      result.forcedMode = String(settings.forcedMode || 'auto');
      result.forcedModeResumeAt = Number(settings.forcedModeResumeAt) || 0;
      result.fastLoop = true;
      result.slowContextAt = Number(this.controlContextUpdatedAt) || 0;
      result.flexibleLoadPass = false;
      result.pvLimitPercent = previous.pvLimitPercent ?? this.lastPublishedPvLimitPercent ?? 100;
      result.pvLimitTargetPowerW = previous.pvLimitTargetPowerW ?? this.lastPublishedPvTargetPowerW ?? 0;
      result.pvLimitCurtailmentW = previous.pvLimitCurtailmentW ?? 0;
      result.pvLimitTargetGridW = previous.pvLimitTargetGridW ?? 0;
      result.pvLimitPredictedGridW = previous.pvLimitPredictedGridW ?? 0;
      result._runFlexibleLoadPass = false;

      this.latestResult = result;
      this.triggerCalculatedSetpoint(result).catch(err => this.error('Calculated battery setpoint trigger failed', err));
      const batteryWantsChange = Boolean(result.canPublishCommands) && this.commandChangedEnough(result);
      this.queueCommandEmit(result, batteryWantsChange);
      // queueStatusUpdate has its own compact signature and therefore performs
      // no Homey writes when the visible outcome is unchanged.
      this.queueStatusUpdate(result, forceStatus);
      return result;
    } catch (err) {
      this.error('Fast HomeFlux EMS evaluation failed', err);
      return this.latestResult;
    }
  }

  evaluateContextNow(forceStatus = false) {
    try {
      const now = Date.now();
      const storedSettings = this.getSettings();
      const paused = this.getPausedEvaluationResult(now, storedSettings, forceStatus);
      if (paused) return paused;

      const pvNow = Number.isFinite(Number(this.state.pvPowerW)) ? Number(this.state.pvPowerW) : 0;
      const pvDeltaW = this.pvAtLastControlW === null ? 0 : pvNow - this.pvAtLastControlW;
      const evaluationState = this.getEvaluationState(storedSettings, now, pvDeltaW);
      const settings = this.refreshControlContext(storedSettings, evaluationState, now);
      const calculated = evaluate(evaluationState, settings, new Date(now), this.controlContext);
      this.lastControlEvalAt = now;
      this.pvAtLastControlW = pvNow;
      this.rememberFastControlSnapshot(storedSettings, now, evaluationState);

      const readiness = this.getInputReadiness(storedSettings);
      const result = this.createSafetyResult(calculated, settings, readiness);
      const rawCandidateTotalW = Number(result.candidateTotalCommandW) || 0;
      this.coordinateEvBatteryPriority(result, storedSettings);
      this.coordinateAdditionalEvPeakGuardBatteryAssist(result, storedSettings);
      this.cacheEvBatteryCoordination(rawCandidateTotalW, result, now);

      result.warningText = this.updateBalanceHealth(result, settings);
      if (result.warningText) result.statusText = `${result.statusText} · WAARSCHUWING Battery Balance`;
      result.homeyEnergy = this.getHomeyEnergyStatus(settings);
      result.controlProfile = String(settings.controlProfile || 'normal');
      result.forcedMode = String(settings.forcedMode || 'auto');
      result.forcedModeResumeAt = Number(settings.forcedModeResumeAt) || 0;
      result.fastLoop = false;
      result.slowContextAt = now;
      result.flexibleLoadPass = true;

      const pvPreview = this.calculatePvPowerLimit(settings, result.candidateTotalCommandW, this.state.lastTotalCommandW);
      result.pvLimitPercent = pvPreview.limitPercent;
      result.pvLimitTargetPowerW = pvPreview.targetPowerW;
      result.pvLimitCurtailmentW = pvPreview.curtailmentW;
      result.pvLimitTargetGridW = pvPreview.targetGridW;
      result.pvLimitPredictedGridW = pvPreview.predictedGridAfterPvW;
      result._runFlexibleLoadPass = true;

      this.latestResult = result;
      this.triggerCalculatedSetpoint(result).catch(err => this.error('Calculated battery setpoint trigger failed', err));
      this.queueStatusUpdate(result, forceStatus);
      const batteryWantsChange = Boolean(result.canPublishCommands) && this.commandChangedEnough(result);
      const batteryPublishQueued = this.queueCommandEmit(result, batteryWantsChange);
      if (!batteryPublishQueued) {
        const emergency = this.getEffectiveEvMode(storedSettings) === 'emergency';
        const ev1Settings = this.getEvInstanceSettings(0, storedSettings);
        ev1Settings.evMode = this.getEffectiveEvMode(storedSettings);
        const emergencyNeedsBatteryFirst = emergency && Boolean(ev1Settings.evPeakGuardBatteryAssistEmergency);
        this.publishFlexibleLoads(result, this.state.lastTotalCommandW, this.state.lastTotalCommandW, {
          allowEvIncrease: !batteryWantsChange || (emergency && !emergencyNeedsBatteryFirst),
          evDecision: result.evDecision,
        })
          .catch(err => this.error('Flexible-load publish failed', err))
          .finally(() => this.publishPvPowerLimit(result, this.state.lastTotalCommandW, this.state.lastTotalCommandW)
            .catch(err => this.error('PV power limit publish failed', err)));
        this.flexibleLoadsDirty = false;
        this.lastFlexibleLoadEvaluationAt = now;
      }
      return result;
    } catch (err) {
      this.error('Slow HomeFlux EMS context evaluation failed', err);
      return this.latestResult;
    }
  }

  // Backwards-compatible internal/manual entry point: explicit recalculation is
  // a full context pass. Meter-driven requests use evaluateFastNow().
  evaluateNow(forceStatus = false) {
    return this.evaluateContextNow(forceStatus);
  }

  async triggerCalculatedSetpoint(result) {
    if (!this.calculatedSetpointTrigger || !result) return;

    const settings = this.getSettings();
    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const calculatedInternal = (result.calculatedCommands || result.commands || []).slice(0, count).map(value => Math.round(Number(value) || 0));
    const calculated = calculatedInternal.map(value => this.toPublishedCommand(value, settings));
    const totalInternal = Math.round(Number(result.calculatedTotalCommandW ?? result.totalCommandW) || 0);
    const total = this.toPublishedCommand(totalInternal, settings);
    const outputTotal = Math.round(Number(result.outputTotalCommandW ?? this.toPublishedCommand(this.state.lastTotalCommandW, settings)) || 0);

    // This card represents a NEW calculated setpoint, not merely another pass
    // through the control loop with the same result. Mode/override are included
    // in the signature because they can change the meaning of an identical W value.
    const signature = JSON.stringify({ calculated, total, mode: result.baseMode || '', override: result.override || '' });
    if (signature === this.lastCalculatedSetpointSignature) return;
    this.lastCalculatedSetpointSignature = signature;

    const tokens = {
      battery_count: count,
      total_setpoint: total,
      output_total: outputTotal,
      difference_total: total - outputTotal,
      mode: String(result.modeLabel || ''),
      override: String(result.overrideLabel || ''),
      status: String(result.statusText || ''),
      publish_allowed: result.canPublishCommands ? 'Ja' : 'Nee',
    };
    for (let i = 1; i <= 8; i += 1) tokens[`battery${i}setpoint`] = calculated[i - 1] || 0;

    await this.calculatedSetpointTrigger.trigger(tokens, {
      mode: result.baseMode || '',
      override: result.override || '',
    });
  }

  getStatusResultSignature(result) {
    if (!result) return '';
    return JSON.stringify({
      baseMode: result.baseMode || '',
      action: result.action || '',
      override: result.override || '',
      statusText: result.statusText || '',
      nextEventText: result.nextEventText || '',
      targetSoc: result.targetSoc ?? null,
      candidateTotalCommandW: result.candidateTotalCommandW ?? null,
      outputTotalCommandW: result.outputTotalCommandW ?? null,
      warningText: result.warningText || '',
      pvLimitPercent: result.pvLimitPercent ?? null,
      controlEnabled: Boolean(result.controlEnabled),
      inputReady: Boolean(result.inputReady),
    });
  }

  queueStatusUpdate(result, force = false) {
    const signature = this.getStatusResultSignature(result);
    if (!force && signature && signature === this.lastQueuedStatusSignature) return;
    if (signature) this.lastQueuedStatusSignature = signature;
    this.pendingStatusResult = result;
    if (this.statusPublishing) return;

    const minIntervalMs = 1000;
    const wait = force ? 0 : Math.max(0, minIntervalMs - (Date.now() - this.lastStatusPublishAt));
    if (wait === 0) {
      if (this.statusTimer) {
        clearTimeout(this.statusTimer);
        this.statusTimer = null;
      }
      this.publishPendingStatus().catch(err => this.error('Status token update failed', err));
      return;
    }

    if (!this.statusTimer) {
      this.statusTimer = this.homey.setTimeout(() => {
        this.statusTimer = null;
        this.publishPendingStatus().catch(err => this.error('Status token update failed', err));
      }, wait);
    }
  }

  async publishPendingStatus() {
    if (this.statusPublishing) return;
    const result = this.pendingStatusResult;
    if (!result) return;
    this.pendingStatusResult = null;
    this.statusPublishing = true;

    try {
      const publishSettings = this.getSettings();
      const calculatedInternalTotal = result.calculatedTotalCommandW ?? result.totalCommandW;
      const values = {
        emstotalcommand: result.outputTotalCommandW ?? this.toPublishedCommand(result.totalCommandW, publishSettings),
        emscalculatedcommand: this.toPublishedCommand(calculatedInternalTotal, publishSettings),
        emsmode: result.modeLabel,
        emsoverride: result.overrideLabel || '',
        emsstatus: result.statusText,
        emsnextchange: result.nextEventText || '',
        emstargetsoc: result.targetSoc,
        emsgridchargeassist: result.gridChargeAssistW,
        emswarning: result.warningText || '',
        emsaction: result.actionLabel || 'Rust',
        emspvcharge: result.pvChargeW || 0,
        emspvlimit: this.lastPublishedPvLimitPercent ?? 100,
        emscurrentprice: result.homeyEnergy?.currentPrice ?? 0,
        emspriceclass: result.homeyEnergy?.priceClass || '',
        emscheapesthours: result.homeyEnergy?.cheapestSummary || '',
        emsexpensivehours: result.homeyEnergy?.expensiveSummary || '',
        emscheapestblock: result.homeyEnergy?.cheapestBlockSummary || '',
        emshomeypricerank: result.homeyEnergy?.currentRank || 0,
        emshomeypriceinterval: result.homeyEnergy?.slotIntervalMinutes || 0,
      };

      for (const [id, value] of Object.entries(values)) {
        if (Object.is(this.lastStatusTokenValues.get(id), value)) continue;
        const token = this.tokens.get(id);
        if (!token) continue;
        await token.setValue(value);
        this.lastStatusTokenValues.set(id, value);
      }

      // Do not fire a fake "changed" event on app startup. From the second
      // published status onward, fire whenever the compact status line really changes.
      const currentStatusText = String(result.statusText || '');
      if (this.lastTriggeredStatusText === null) {
        this.lastTriggeredStatusText = currentStatusText;
      } else if (currentStatusText !== this.lastTriggeredStatusText) {
        this.lastTriggeredStatusText = currentStatusText;
        if (this.statusChangedTrigger) {
          await this.statusChangedTrigger.trigger({
            status: currentStatusText,
            tariff: String(result.tariff?.label || ''),
            action: String(result.workingModeLabel || result.actionLabel || result.modeLabel || 'Rust'),
            next_change: String(result.nextEventText || ''),
          }).catch(err => this.error('EMS status changed trigger failed', err));
        }
      }

      await this.syncEmsDevices(result);
      this.lastStatusPublishAt = Date.now();
    } finally {
      this.statusPublishing = false;
      if (this.pendingStatusResult) this.queueStatusUpdate(this.pendingStatusResult);
    }
  }

  commandChangedEnough(result) {
    const settings = this.getSettings();
    const deadband = Math.max(0, Number(settings.commandDeadbandW) || 0);
    const commands = result.candidateCommands || [];

    // Always inspect split-mode intent before any ordinary early return. Besides
    // telling us whether a switch is due NOW, this schedules a fresh evaluation
    // for a switch that is currently blocked by its per-battery timers.
    const splitModeChangeNow = this.splitModeChangeNeeded(result, settings);

    if (this.lastEmittedCommands.length !== commands.length) return true;
    if (this.lastEmittedMode !== result.baseMode || this.lastEmittedOverride !== (result.override || '')) return true;
    if (splitModeChangeNow) return true;

    // commandDeadbandW applies to the TOTAL EMS setpoint, not to every battery.
    // Battery Balance may split a meaningful 50 W correction into only 12-13 W
    // per battery; that must not suppress the correction.
    const candidateTotal = Number.isFinite(Number(result.candidateTotalCommandW))
      ? Number(result.candidateTotalCommandW)
      : commands.reduce((sum, value) => sum + (Number(value) || 0), 0);
    const emittedTotal = this.lastEmittedCommands.reduce((sum, value) => sum + (Number(value) || 0), 0);
    const totalDelta = Math.abs(candidateTotal - emittedTotal);

    let zeroMin = Number(settings.gridZeroMinW);
    let zeroMax = Number(settings.gridZeroMaxW);
    if (!Number.isFinite(zeroMin)) zeroMin = -5;
    if (!Number.isFinite(zeroMax)) zeroMax = 25;
    if (zeroMin > zeroMax) [zeroMin, zeroMax] = [zeroMax, zeroMin];
    const grid = Number(this.state.gridPowerW);
    const outsideZeroBand = Number.isFinite(grid) && (grid < zeroMin || grid > zeroMax);

    // Outside the configured zero band, any real calculated correction may pass
    // on the next permitted command moment. Inside the band the total setpoint
    // deadband prevents needless writes caused by rounding/planning noise.
    if (outsideZeroBand && totalDelta >= 1) return true;
    return totalDelta >= deadband;
  }

  queueCommandEmit(result, precomputedChange = null) {
    if (!result.canPublishCommands) {
      const hadActiveOutput = this.lastEmittedCommands.some(value => Math.abs(value) > 0);
      if (hadActiveOutput) {
        const count = Math.max(1, Math.min(8, Math.round(Number(this.getSettings().batteryCount) || 1)));
        const safetyReason = !result.controlEnabled
          ? 'EMS-uitvoer uitgeschakeld'
          : (Array.isArray(result.missingInputs) && result.missingInputs.length
            ? `Ontbrekende invoer: ${result.missingInputs.join(', ')}`
            : 'Sturing niet veilig beschikbaar');
        this.pendingResult = {
          ...result,
          canPublishCommands: true,
          candidateCommands: Array(count).fill(0),
          candidateTotalCommandW: 0,
          baseMode: 'safety_stop',
          modeLabel: 'Veilige stop',
          statusText: `Veilige stop · ${safetyReason}`,
        };
        // A safety stop may bypass the interval, but the publishing mutex still
        // guarantees that two command writes can never run concurrently.
        this.pendingCommandBypassInterval = true;
        this.emitPending().catch(err => this.error('Safety stop failed', err));
        return true;
      }
      return false;
    }
    if (!(precomputedChange === null ? this.commandChangedEnough(result) : precomputedChange)) return false;

    const settings = this.getSettings();
    const intervalMs = Math.max(1, Number(settings.commandIntervalSeconds) || 10) * 1000;
    const now = Date.now();
    const allowedAt = Math.max(this.nextCommandAllowedAt || 0, this.lastEmitAt > 0 ? this.lastEmitAt + intervalMs : 0);
    const wait = Math.max(0, allowedAt - now);
    if (wait > 0) {
      // Never hold a stale command. Recalculate from the newest inputs at the
      // first moment a new battery setpoint is allowed.
      this.requestEvaluate(true);
      return false;
    }

    // Never allow a normal command to replace a queued safety stop while an
    // earlier command is still publishing. Safety always wins first.
    if (this.commandPublishing && this.pendingCommandBypassInterval) return false;
    this.pendingResult = result;
    this.pendingCommandBypassInterval = false;
    this.emitPending().catch(err => this.error('Battery command emit failed', err));
    return true;
  }

  async emitPending() {
    if (this.commandPublishing) return;
    const result = this.pendingResult;
    if (!result) return;

    const bypassInterval = Boolean(this.pendingCommandBypassInterval);
    const settings = this.getSettings();
    const intervalMs = Math.max(1, Number(settings.commandIntervalSeconds) || 10) * 1000;
    const now = Date.now();
    const pauseInfo = this.getBatteryCommandPauseInfo(now, settings);
    if (pauseInfo.active) {
      // Never release a stale pending command into the no-control window, not
      // even a Peak Guard/safety recalculation. Re-evaluate fresh after the end.
      this.pendingResult = null;
      this.pendingCommandBypassInterval = false;
      this.scheduleBatteryCommandPauseResume(pauseInfo, now);
      return;
    }
    const allowedAt = Math.max(this.nextCommandAllowedAt || 0, this.lastEmitAt > 0 ? this.lastEmitAt + intervalMs : 0);
    if (!bypassInterval && now < allowedAt) {
      this.pendingResult = null;
      this.pendingCommandBypassInterval = false;
      this.requestEvaluate(true);
      return;
    }

    this.pendingResult = null;
    this.pendingCommandBypassInterval = false;
    this.commandPublishing = true;

    // Reserve the complete minimum interval BEFORE the first async token/Flow
    // write. This closes the small race where another evaluation could otherwise
    // start while the previous command was still being published.
    this.lastEmitAt = now;
    this.nextCommandAllowedAt = now + intervalMs;

    try {
      const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
      const internalCommands = (result.candidateCommands || []).slice(0, count).map(value => Math.round(Number(value) || 0));
      const internalTotal = Number.isFinite(Number(result.candidateTotalCommandW))
        ? Math.round(Number(result.candidateTotalCommandW))
        : internalCommands.reduce((sum, value) => sum + value, 0);
      const commands = internalCommands.map(value => this.toPublishedCommand(value, settings));
      const publishedTotal = this.toPublishedCommand(internalTotal, settings);

      for (let i = 1; i <= count; i += 1) {
        const token = this.tokens.get(`battery${i}command`);
        if (token) await token.setValue(commands[i - 1] || 0);
      }
      const totalToken = this.tokens.get('emstotalcommand');
      if (totalToken) await totalToken.setValue(publishedTotal);

      const triggerTokens = {
        battery_count: count,
        total_command: publishedTotal,
        mode: result.modeLabel,
        override: result.overrideLabel || '',
        status: result.statusText,
        next_change: result.nextEventText || '',
      };
      for (let i = 1; i <= 8; i += 1) triggerTokens[`battery${i}command`] = commands[i - 1] || 0;

      await this.commandTrigger.trigger(triggerTokens, {
        mode: result.baseMode,
        override: result.override || '',
      });

      // Split-command batteries use dedicated mode/power Flow cards. A mode
      // transition is followed by its power card exactly one second later. If
      // the opposite direction is requested before that mode's minimum hold time
      // has elapsed, the current mode is kept at its configured minimum and a
      // fresh EMS calculation is scheduled for the first allowed switch moment.
      const effectiveInternalCommands = await this.publishSplitBatteryCommands(internalCommands, settings);
      const effectiveInternalTotal = effectiveInternalCommands.reduce((sum, value) => sum + (Number(value) || 0), 0);

      const previousInternalTotal = Number(this.state.lastTotalCommandW) || 0;
      // Flexible loads and PV limiting belong to the slow/output pass. A pure
      // fast battery correction publishes only the battery command.
      if (Boolean(result._runFlexibleLoadPass)) {
        await this.publishFlexibleLoads(result, internalTotal, previousInternalTotal, {
          evDecision: result.evDecision,
          effectiveNextBatteryCommandW: effectiveInternalTotal,
        })
          .catch(err => this.error('Flexible-load publish after battery command failed', err));
        await this.publishPvPowerLimit(result, internalTotal, previousInternalTotal)
          .catch(err => this.error('PV power limit publish after battery command failed', err));
        this.flexibleLoadsDirty = false;
        this.lastFlexibleLoadEvaluationAt = Date.now();
      }

      // Keep controller feedback in HomeFlux' internal sign convention
      // (positive discharge, negative charge). Only published values are inverted.
      this.lastEmittedCommands = effectiveInternalCommands;
      this.lastEmittedMode = result.baseMode;
      this.lastEmittedOverride = result.override || '';
      this.recordSavingsSample(Date.now());
      this.state.lastTotalCommandW = effectiveInternalTotal;
      if (this.latestResult) {
        const effectiveCommands = effectiveInternalCommands.map(value => this.toPublishedCommand(value, settings));
        this.latestResult.outputCommands = effectiveCommands;
        this.latestResult.outputTotalCommandW = this.toPublishedCommand(effectiveInternalTotal, settings);
        // A Split Command minimum or blocked direction change may make the real
        // output differ from the calculated candidate. Only then reclassify the
        // live source from the measured balance; for an unchanged command the
        // meter can still reflect the previous output for a moment.
        const candidateInternalTotal = Number(this.latestResult.candidateTotalCommandW);
        if (Number.isFinite(candidateInternalTotal) && Math.abs(effectiveInternalTotal - candidateInternalTotal) > 0.5) {
          this.refreshBatteryPresentationAfterCoordination(this.latestResult, settings, effectiveInternalTotal);
        }
        this.queueStatusUpdate(this.latestResult, true);
      }
      if (!Boolean(result._runFlexibleLoadPass)) {
        // EV/HVAC/boiler and PV limiting may react to the new real battery
        // output on the shared slow cadence. Repeated battery writes collapse
        // into the same pending context pass.
        this.requestContextEvaluate(false, 'battery_output_changed');
      }
    } finally {
      this.commandPublishing = false;
      if (this.pendingResult) {
        this.emitPending().catch(err => this.error('Queued battery command emit failed', err));
      }
    }
  }

  getPlanningSimulationDate(timeValue, baseAt = Date.now()) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeValue || '').trim());
    if (!match) throw new Error('Ongeldig simulatie-uur. Gebruik UU:MM.');
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error('Ongeldig simulatie-uur. Gebruik UU:MM.');

    const timezone = this.homey.clock.getTimezone() || 'UTC';
    const base = new Date(Number(baseAt) || Date.now());
    const baseParts = localParts(base, timezone);
    const targetMinute = (hour * 60) + minute;
    const minuteAlignedBase = base.getTime() - (base.getUTCSeconds() * 1000) - base.getUTCMilliseconds();
    const approximate = minuteAlignedBase + ((targetMinute - baseParts.minuteOfDay) * 60000);

    // The direct offset is correct on ordinary days. The bounded scan handles
    // DST transition days without constructing a local Date with a guessed UTC
    // offset. A non-existent spring-forward time is rejected explicitly.
    for (let offset = -180; offset <= 180; offset += 1) {
      const candidate = new Date(approximate + (offset * 60000));
      const parts = localParts(candidate, timezone);
      if (parts.dateKey === baseParts.dateKey && parts.minuteOfDay === targetMinute) return candidate;
    }
    throw new Error('Dit lokale uur bestaat niet op de gekozen dag door de zomer-/wintertijdomschakeling.');
  }

  simulatePlanning(body = {}) {
    const numberInRange = (value, fallback, min, max) => {
      const numeric = Number(value);
      return Math.max(min, Math.min(max, Number.isFinite(numeric) ? numeric : fallback));
    };
    const batterySoc = numberInRange(body.batterySoc, 50, 0, 100);
    const targetSoc = numberInRange(body.targetSoc, 80, 0, 100);
    const pvTodayKwh = numberInRange(body.pvTodayKwh, 10, 0, 250);
    const pvLiveW = numberInRange(body.pvLiveW, 0, 0, 100000);
    const timezone = this.homey.clock.getTimezone() || 'UTC';
    const currentParts = localParts(new Date(), timezone);
    const defaultTime = `${String(currentParts.hour).padStart(2, '0')}:${String(currentParts.minute).padStart(2, '0')}`;
    const simulatedAt = this.getPlanningSimulationDate(body.time || defaultTime);
    const simulatedParts = localParts(simulatedAt, timezone);

    // The simulator has no historical PV state by design. >=5 W means PV has
    // started and therefore selects the daytime plan. Below 5 W selects night;
    // before local noon it represents the night that crosses midnight into the
    // current solar day, from noon onward the night after today's PV production.
    const dayPlanningActive = pvLiveW >= 5;
    const nightPlanningActive = !dayPlanningActive;
    const planningForecastDay = dayPlanningActive
      ? 'today'
      : (simulatedParts.minuteOfDay < 12 * 60 ? 'today' : 'tomorrow');
    const planningDecisionSource = dayPlanningActive
      ? 'simulation_pv_started'
      : (planningForecastDay === 'today' ? 'simulation_overnight_before_pv' : 'simulation_after_pv');

    const storedSettings = this.getSettings();
    let settings = {
      ...storedSettings,
      timezone,
      forcedMode: 'auto',
      forcedModeResumeAt: 0,
      forecastDataReady: true,
      forecastDailyDataReady: true,
      forecastTomorrowDataReady: true,
      pvDataReady: true,
    };
    if (isDynamicContract(settings)) {
      const targetInterval = this.getDynamicTargetInterval(settings);
      const simulatedDateKey = localParts(simulatedAt, timezone).dateKey;
      const dynamicSlots = resamplePriceSlots(this.homeyEnergy.slots || [], targetInterval)
        .filter(slot => slot.dateKey === simulatedDateKey && Number.isFinite(Number(slot.price)) && Number.isFinite(Number(slot.minute)))
        .sort((a, b) => a.minute - b.minute)
        .map(slot => ({
          time: `${String(Math.floor(slot.minute / 60)).padStart(2, '0')}:${String(slot.minute % 60).padStart(2, '0')}`,
          price: Number(slot.price),
        }));
      settings = { ...settings, dynamicSlots, dynamicPriceDataReady: dynamicSlots.length > 0 };
    }

    const count = Math.max(1, Math.min(8, Math.round(Number(settings.batteryCount) || 1)));
    const simulationState = {
      gridPowerW: 0,
      controlGridPowerW: 0,
      gridAverage5sW: 0,
      controlGridSource: 'planning_simulation',
      pvPowerW: pvLiveW,
      // The one PV field intentionally feeds every possible forecast role. The
      // result identifies which role the selected planning phase actually used.
      forecastRemainingKwh: pvTodayKwh,
      forecastDailyMaxKwh: pvTodayKwh,
      forecastTomorrowKwh: pvTodayKwh,
      batterySoc: Array(count).fill(batterySoc),
      lastTotalCommandW: 0,
      pvDeltaW: 0,
      planningForecastDay,
      planningDecisionSource,
      nightPlanningActive,
      targetSocOverride: targetSoc,
    };

    // Both engine calls are pure calculations. No app state, setting, planning
    // cache, Flow token or output command is written by this endpoint.
    const plan = buildSocPlan(simulationState, settings, simulatedAt);
    const result = evaluate(simulationState, settings, simulatedAt);
    const tariff = result.tariff || {};
    return {
      version: '0.4.5',
      simulatedAt: simulatedAt.getTime(),
      simulatedLocalTime: `${String(simulatedParts.hour).padStart(2, '0')}:${String(simulatedParts.minute).padStart(2, '0')}`,
      timezone,
      phase: dayPlanningActive ? 'day' : 'night',
      planningForecastDay,
      planningDecisionSource,
      phaseAssumption: dayPlanningActive
        ? 'pv_live_at_least_5w'
        : (planningForecastDay === 'today' ? 'pv_below_5w_before_noon' : 'pv_below_5w_after_noon'),
      inputs: { batterySoc, targetSoc, pvTodayKwh, pvLiveW },
      plan,
      decision: {
        baseMode: result.baseMode,
        modeLabel: result.modeLabel,
        action: result.action,
        actionLabel: result.actionLabel,
        workingModeLabel: result.workingModeLabel,
        statusText: result.statusText,
        tariffLabel: String(tariff.label || tariff.name || tariff.rateName || tariff.className || ''),
        tariffClass: String(tariff.className || ''),
        avgSoc: result.avgSoc,
        targetSoc: result.targetSoc,
        plannedChargeW: result.plannedChargeW,
        gridChargeAssistW: result.gridChargeAssistW,
        pvChargeW: result.pvChargeW,
        totalCommandW: result.totalCommandW,
        commands: result.commands,
        predictedGridW: result.predictedGridW,
        forecastPlanningDay: result.forecastPlanningDay,
        forecastPlanningKwh: result.forecastPlanningKwh,
        forecastEnergyTargetSoc: result.forecastEnergyTargetSoc,
        targetOverridden: result.targetOverridden,
        peakReserveStrategy: result.peakReserveStrategy,
        peakReserveActive: result.peakReserveActive,
        peakReserveTargetSoc: result.peakReserveTargetSoc,
        peakReservePvCreditKwh: result.peakReservePvCreditKwh,
        peakReserveShortfallAfterPvKwh: result.peakReserveShortfallAfterPvKwh,
        sunnyMonthsMinSocActive: result.sunnyMonthsMinSocActive,
        lowForecastBatterySaveActive: result.lowForecastBatterySaveActive,
        lowForecastReferenceDay: result.lowForecastReferenceDay,
        lowForecastReferenceKwh: result.lowForecastReferenceKwh,
      },
    };
  }

  getPlanningStatus(options = {}) {
    const force = options === true || Boolean(options?.force);
    const now = Date.now();
    this.checkNightPlanningFallback(now);
    if (!this.planningCache) this.planningCache = { generation: 0, value: null, dirty: true, lastCalculatedAt: 0, nextAllowedAt: 0, timer: null, timerAt: 0 };

    const hasValue = Boolean(this.planningCache.value?.plan);
    const nextAllowedAt = Number(this.planningCache.nextAllowedAt) || 0;
    if (force) {
      this.clearPlanningTimer();
    } else if (hasValue && !this.planningCache.dirty) {
      return this.planningCache.value.plan;
    } else if (hasValue && now < nextAllowedAt) {
      this.schedulePlanningRecalculation(nextAllowedAt);
      return this.planningCache.value.plan;
    }

    const storedSettings = this.getSettings();
    const settings = this.getRuntimeSettings(storedSettings);
    const state = this.getEvaluationState(storedSettings, now, 0);
    const plan = {
      version: '0.4.5',
      nightPlanningActive: this.isNightPlanningPhase(now),
      planningDecisionSource: this.state.nightPlanningDecisionSource || (this.isNightPlanningPhase(now) ? 'overnight' : 'solar_day'),
      ...buildSocPlan(state, settings, new Date(now)),
    };
    this.planningCache.value = { at: now, plan };
    this.planningCache.dirty = false;
    this.planningCache.lastCalculatedAt = now;
    this.planningCache.nextAllowedAt = now + this.getPlanningMinIntervalMs(storedSettings);
    this.clearPlanningTimer();
    return plan;
  }

  getPublicStatus() {
    const storedSettings = this.getSettings();
    // /status is polled every two seconds while the settings page is visible.
    // Reuse the last slow-loop runtime snapshot instead of rebuilding dynamic
    // tariffs and derived settings on every read-only status request.
    const settings = this.controlRuntimeSettings || this.cachedRuntimeSettings || this.getRuntimeSettings(storedSettings);
    const readiness = this.getInputReadiness(storedSettings);

    // v0.3.28: /status is deliberately read-only and lightweight. The settings
    // page polls this endpoint every two seconds while visible, so it must never
    // run the EMS engine again. Derived values come from the most recent REAL
    // control calculation; raw inputs and actual published outputs are refreshed
    // from current state. This keeps the control cadence authoritative and avoids
    // up to 30 unnecessary preview evaluations per minute.
    const statusNow = Date.now();
    const pauseInfo = this.getBatteryCommandPauseInfo(statusNow, storedSettings);
    const count = Math.max(1, Math.min(8, Math.round(Number(storedSettings.batteryCount) || 1)));
    const chargeTestPassed = this.isChargeTestValid(storedSettings);
    const controlEnabled = Boolean(settings.controlEnabled) && chargeTestPassed;
    const actualInternalCommands = Array.from({ length: count }, (_, index) => Number(this.lastEmittedCommands[index]) || 0);
    const actualPublishedCommands = actualInternalCommands.map(value => this.toPublishedCommand(value, storedSettings));
    const actualPublishedTotal = actualPublishedCommands.reduce((sum, value) => sum + value, 0);

    // Live status reports direction explicitly. For normal batteries direction is
    // derived from HomeFlux' internal sign convention. For split batteries the
    // ACTUAL active mode/power is used, which is important while a requested
    // opposite mode is still waiting for its anti-chatter timer.
    this.ensureSplitCommandState();
    const outputCommandModes = [];
    const outputCommandPowerW = [];
    for (let index = 0; index < count; index += 1) {
      const config = this.getSplitBatteryConfig(index, storedSettings);
      const splitState = this.splitCommandState[index];
      if (!controlEnabled) {
        outputCommandModes.push('idle');
        outputCommandPowerW.push(0);
      } else if (config.enabled && splitState?.currentMode) {
        outputCommandModes.push(splitState.currentMode);
        const splitPower = Math.abs(Number(splitState.lastPower));
        outputCommandPowerW.push(Number.isFinite(splitPower) ? Math.round(splitPower) : Math.abs(Math.round(actualPublishedCommands[index] || 0)));
      } else {
        const internal = Math.round(Number(actualInternalCommands[index]) || 0);
        outputCommandModes.push(internal > 0 ? 'discharge' : internal < 0 ? 'charge' : 'idle');
        outputCommandPowerW.push(Math.abs(Math.round(actualPublishedCommands[index] || 0)));
      }
    }

    const preview = { ...(this.latestResult || {}) };
    const fallbackStatus = readiness.ready
      ? (controlEnabled ? 'HomeFlux EMS gereed' : 'SIMULATIE · HomeFlux EMS gereed')
      : `Wachten op data: ${(readiness.missing || []).join(', ')}`;

    preview.statusText = String(preview.statusText || fallbackStatus);
    preview.inputReady = Boolean(readiness.ready);
    preview.missingInputs = Array.isArray(readiness.missing) ? readiness.missing.slice() : [];
    preview.degradedInputs = Array.isArray(readiness.degraded) ? readiness.degraded.slice() : [];
    preview.priceDataReady = readiness.priceDataReady !== false;
    preview.inputsReceived = readiness.received || {};
    preview.controlEnabled = controlEnabled;
    preview.canPublishCommands = Boolean(readiness.ready) && controlEnabled;
    preview.calculatedCommands = Array.isArray(preview.calculatedCommands)
      ? preview.calculatedCommands.slice(0, count)
      : Array(count).fill(0);
    preview.calculatedTotalCommandW = Number.isFinite(Number(preview.calculatedTotalCommandW))
      ? Number(preview.calculatedTotalCommandW)
      : (Number(preview.totalCommandW) || 0);

    const calculatedInternalCommands = preview.calculatedCommands.slice(0, count).map(value => Math.round(Number(value) || 0));
    preview.calculatedCommandModes = calculatedInternalCommands.map((value, index) => {
      const config = this.getSplitBatteryConfig(index, storedSettings);
      if (config.enabled) return this.getSplitDesiredMode(value, config);
      return value > 0 ? 'discharge' : value < 0 ? 'charge' : 'idle';
    });
    preview.calculatedCommandPowerW = calculatedInternalCommands.map(value => Math.abs(value));
    preview.outputCommands = controlEnabled ? actualPublishedCommands : Array(count).fill(0);
    preview.outputTotalCommandW = controlEnabled ? actualPublishedTotal : 0;
    preview.outputCommandModes = outputCommandModes;
    preview.outputCommandPowerW = outputCommandPowerW;
    preview.splitModeSwitchPendingSeconds = Array.from({ length: count }, (_, index) => {
      if (!controlEnabled) return 0;
      const config = this.getSplitBatteryConfig(index, storedSettings);
      if (!config.enabled) return 0;
      const splitState = this.splitCommandState[index];
      const desiredMode = preview.calculatedCommandModes[index];
      if (!splitState?.currentMode || splitState.currentMode === desiredMode) return 0;
      const switchAt = this.getSplitNextModeSwitchAt(index, config);
      return switchAt > statusNow ? Math.max(1, Math.ceil((switchAt - statusNow) / 1000)) : 0;
    });
    preview.warningText = this.latestResult?.warningText || '';
    preview.homeyEnergy = this.getHomeyEnergyStatus(settings);
    preview.controlProfile = String(settings.controlProfile || 'normal');
    preview.forcedMode = String(settings.forcedMode || 'auto');
    preview.forcedModeResumeAt = Number(settings.forcedModeResumeAt) || 0;
    preview.outputPvLimitPercent = this.lastPublishedPvLimitPercent ?? 100;
    preview.pvLimitPercent = Number.isFinite(Number(preview.pvLimitPercent)) ? Number(preview.pvLimitPercent) : preview.outputPvLimitPercent;
    preview.pvLimitTargetPowerW = Number(preview.pvLimitTargetPowerW) || 0;
    preview.pvLimitCurtailmentW = Number(preview.pvLimitCurtailmentW) || 0;
    preview.pvLimitTargetGridW = Number(preview.pvLimitTargetGridW) || 0;
    preview.pvLimitPredictedGridW = Number(preview.pvLimitPredictedGridW) || 0;
    preview.lastControlEvaluationAt = Number(this.lastControlEvalAt) || 0;
    preview.nextCharge = this.getWidgetNextChargeStatus(statusNow);
    preview.planningSummary = this.getWidgetPlanningSummary(statusNow);

    const dynamicPriceRequired = isDynamicContract(storedSettings);
    const priceLastUpdatedAt = Number(this.homeyEnergy?.lastUpdatedAt) || 0;
    const priceAgeMs = priceLastUpdatedAt > 0 ? Math.max(0, statusNow - priceLastUpdatedAt) : null;
    preview.priceData = {
      required: dynamicPriceRequired,
      ready: dynamicPriceRequired ? readiness.priceDataReady !== false : true,
      fresh: dynamicPriceRequired
        ? readiness.priceDataReady !== false && priceLastUpdatedAt > 0 && priceAgeMs <= 20 * 60 * 1000
        : true,
      lastUpdatedAt: priceLastUpdatedAt,
      ageSeconds: priceAgeMs === null ? null : Math.round(priceAgeMs / 1000),
      refreshing: dynamicPriceRequired ? Boolean(this.homeyEnergy?.refreshing) : false,
    };

    if (pauseInfo.active) {
      preview.batteryCommandPauseActive = true;
      preview.batteryCommandPauseStart = pauseInfo.start;
      preview.batteryCommandPauseEnd = pauseInfo.end;
      preview.statusText = `Batterijsturing gepauzeerd · ${pauseInfo.start}–${pauseInfo.end} · laatste setpoint behouden`;
    } else {
      preview.batteryCommandPauseActive = false;
    }

    const evStatuses = Array.from({ length: this.getEvCount(storedSettings) }, (_, index) => {
      const instanceSettings = this.getEvInstanceSettings(index, storedSettings);
      const input = this.getEvInputSnapshot(index);
      const runtime = index === 0 ? null : this.getExtraEv(index);
      const decision = index === 0 ? this.latestEvDecision : runtime?.latestDecision;
      const override = this.getEvSessionOverrideFor(index);
      return {
        instance: index + 1,
        name: this.getEvInstanceName(index, storedSettings),
        enabled: Boolean(instanceSettings.evEnabled),
        socEnabled: instanceSettings.evSocEnabled !== false,
        mode: this.getEffectiveEvModeFor(index, storedSettings),
        configuredMode: String(instanceSettings.evMode || 'smart'),
        controlType: this.getEvControlType(instanceSettings),
        connected: Boolean(input?.connected),
        soc: instanceSettings.evSocEnabled !== false && input?.seen?.soc ? Number(input.soc) : null,
        actualCurrentA: input?.seen?.chargeCurrent ? Math.max(0, Number(input.chargeCurrentA) || 0) : 0,
        received: { ...(input?.seen || {}), soc: instanceSettings.evSocEnabled !== false ? Boolean(input?.seen?.soc) : false },
        override: {
          active: Boolean(override?.mode),
          mode: override?.mode ? String(override.mode) : '',
          sessionStarted: Boolean(override?.sessionStarted),
        },
        ...(decision || {}),
        outputCurrentA: index === 0 ? Math.max(0, Number(this.lastPublishedEvCurrentA) || 0) : Math.max(0, Number(runtime?.lastPublishedCurrentA) || 0),
        outputChargeMode: index === 0 ? String(this.lastPublishedEvChargeMode || 'stop') : String(runtime?.lastPublishedChargeMode || 'stop'),
        outputAllowed: index === 0 ? Boolean(this.lastPublishedEvAllowed) : Boolean(runtime?.lastPublishedAllowed),
        stopHoldRemainingSeconds: Math.max(0, Math.ceil(((index === 0 ? Number(this.evPeakGuardStopHoldUntil) : Number(runtime?.stopHoldUntil)) - statusNow) / 1000)),
      };
    });

    const hvacStatuses = Array.from({ length: this.getHvacCount(storedSettings) }, (_, index) => {
      const instanceSettings = this.getHvacInstanceSettings(index, storedSettings);
      const input = this.getHvacInputSnapshot(index);
      const runtime = index === 0 ? null : this.getExtraHvac(index);
      const decision = index === 0 ? this.latestHvacDecision : runtime?.latestDecision;
      return {
        instance: index + 1,
        name: this.getHvacInstanceName(index, storedSettings),
        enabled: Boolean(instanceSettings.hvacEnabled),
        automaticControlEnabled: instanceSettings.hvacAutomaticControlEnabled !== false,
        roomTemperatureC: input?.seen?.roomTemperature ? Number(input.roomTemperatureC) : null,
        outdoorTemperatureC: input?.seen?.outdoorTemperature ? Number(input.outdoorTemperatureC) : null,
        mode: input?.seen?.mode ? String(input.mode || 'off') : '',
        setpointC: input?.seen?.setpoint ? Number(input.setpointC) : null,
        fanSpeed: input?.seen?.fanSpeed ? Number(input.fanSpeed) : null,
        received: { ...(input?.seen || {}) },
        ...(decision || {}),
        baselineSetpointC: index === 0 ? this.hvacBaselineSetpoint : runtime?.baselineSetpoint,
        managedPowerOn: index === 0 ? Boolean(this.hvacManagedPowerOn) : Boolean(runtime?.managedPowerOn),
        outputSetpointC: index === 0
          ? (this.lastPublishedHvacSetpoint !== null && this.lastPublishedHvacSetpoint !== undefined && Number.isFinite(Number(this.lastPublishedHvacSetpoint)) ? Number(this.lastPublishedHvacSetpoint) : null)
          : (runtime?.lastPublishedSetpoint !== null && runtime?.lastPublishedSetpoint !== undefined && Number.isFinite(Number(runtime.lastPublishedSetpoint)) ? Number(runtime.lastPublishedSetpoint) : null),
        outputMode: index === 0 ? String(this.lastPublishedHvacMode || '') : String(runtime?.lastPublishedMode || ''),
        outputFanSpeed: index === 0 ? this.lastPublishedHvacFanSpeed : runtime?.lastPublishedFanSpeed,
        fanScale: this.getHvacFanScale(instanceSettings),
      };
    });

    const boilerRuntime = this.boilerState || {};
    const priorityRuntime = this.flexiblePriorityState || {};
    const boilerStatus = {
      enabled: this.getBoilerCount(storedSettings) > 0 && Boolean(storedSettings.boilerEnabled),
      name: String(storedSettings.boilerName || 'Boiler'),
      outputOn: Boolean(boilerRuntime.outputOn),
      accumulatedMinutes: Math.max(0, Number(boilerRuntime.cycleAccumulatedMs) || 0) / 60000,
      cycleMinutes: Math.max(1, Number(storedSettings.boilerCycleMinutes) || 90),
      lastCompletedAt: Number(boilerRuntime.lastCompletedAt) || 0,
      lastCompletedSource: String(boilerRuntime.lastCompletedSource || ''),
      warmUntil: this.boilerState ? this.getBoilerWarmUntil(storedSettings) : 0,
      ...(boilerRuntime.latestDecision || {}),
    };
    const priorityStatus = {
      order: this.getFlexibleLoadPriorityOrder(storedSettings),
      intervalMinutes: Math.max(1, Math.min(30, Number(storedSettings.priorityEvaluationMinutes) || 5)),
      lastEvaluationAt: Number(priorityRuntime.lastEvaluationAt) || 0,
      nextEvaluationAt: Number(priorityRuntime.nextEvaluationAt) || 0,
      lastStartedId: String(priorityRuntime.lastStartedId || ''),
    };

    return {
      version: '0.4.5',
      settings: {
        batteryCount: storedSettings.batteryCount,
        evCount: this.getEvCount(storedSettings),
        hvacCount: this.getHvacCount(storedSettings),
        boilerCount: this.getBoilerCount(storedSettings),
        boilerEnabled: this.getBoilerCount(storedSettings) > 0 && Boolean(storedSettings.boilerEnabled),
        priorityEvaluationMinutes: Math.max(1, Math.min(30, Number(storedSettings.priorityEvaluationMinutes) || 5)),
        contractType: storedSettings.contractType,
        dynamicPriceSource: 'homey',
        peakShaveEnabled: storedSettings.peakShaveEnabled,
        peakLimitW: storedSettings.peakLimitW,
        dynamicUseBatteryNormalHours: Boolean(storedSettings.dynamicUseBatteryNormalHours),
        batterySaveDischargeAboveSoc: storedSettings.batterySaveDischargeAboveSoc,
        safetySoc: storedSettings.safetySoc,
        lowForecastSelfConsumptionMinKwh: storedSettings.lowForecastSelfConsumptionMinKwh,
        lowForecastAutoSunnyEnabled: Boolean(storedSettings.lowForecastAutoSunnyEnabled),
        lowForecastAutoSunnySoc: storedSettings.lowForecastAutoSunnySoc,
        lowForecastAutoSunnyMinutes: storedSettings.lowForecastAutoSunnyMinutes,
        lowForecastFixedEnabled: Boolean(storedSettings.lowForecastFixedEnabled),
        lowForecastFixedDischargeToTarget: Boolean(storedSettings.lowForecastFixedDischargeToTarget),
        lowForecastDynamicCheapEnabled: Boolean(storedSettings.lowForecastDynamicCheapEnabled),
        lowForecastDynamicCheapDischargeToTarget: Boolean(storedSettings.lowForecastDynamicCheapDischargeToTarget),
        lowForecastDynamicNormalEnabled: Boolean(storedSettings.lowForecastDynamicNormalEnabled),
        lowForecastDynamicNormalDischargeToTarget: Boolean(storedSettings.lowForecastDynamicNormalDischargeToTarget),
        lowForecastDynamicExpensiveEnabled: Boolean(storedSettings.lowForecastDynamicExpensiveEnabled),
        lowForecastDynamicExpensiveDischargeToTarget: Boolean(storedSettings.lowForecastDynamicExpensiveDischargeToTarget),
        controlProfile: storedSettings.controlProfile || 'normal',
        pvDeltaThresholdW: storedSettings.pvDeltaThresholdW,
        invertBatteryCommand: Boolean(storedSettings.invertBatteryCommand),
        batteryCommandStepW: storedSettings.batteryCommandStepW,
        exportLimitEnabled: Boolean(storedSettings.exportLimitEnabled),
        minimumExportW: storedSettings.minimumExportW,
        pvCommandIntervalSeconds: storedSettings.pvCommandIntervalSeconds,
        chargeTestPassed: this.isChargeTestValid(storedSettings),
        overrideResumeOnTariffChange: Boolean(storedSettings.overrideResumeOnTariffChange),
        commandIntervalSeconds: storedSettings.commandIntervalSeconds,
        batteryCommandPauseEnabled: Boolean(storedSettings.batteryCommandPauseEnabled),
        batteryCommandPauseStart: storedSettings.batteryCommandPauseStart,
        batteryCommandPauseEnd: storedSettings.batteryCommandPauseEnd,
        exportLimitEnabled: Boolean(storedSettings.exportLimitEnabled),
        minimumExportW: storedSettings.minimumExportW,
        pvCurtailMinBatterySoc: storedSettings.pvCurtailMinBatterySoc,
        evEnabled: Boolean(storedSettings.evEnabled),
        evSocEnabled: storedSettings.evSocEnabled !== false,
        evMode: this.getEffectiveEvMode(storedSettings),
        evModeConfigured: String(storedSettings.evMode || 'smart'),
        evSessionOverrideActive: Boolean(this.evSessionOverride?.mode),
        evSessionOverrideMode: this.evSessionOverride?.mode ? String(this.evSessionOverride.mode) : '',
        evSessionOverrideSessionStarted: Boolean(this.evSessionOverride?.sessionStarted),
        evControlType: String(storedSettings.evControlType || 'current'),
        evSmartPvPriority: String(storedSettings.evSmartPvPriority || 'battery_first'),
        evSmartPvExportTargetW: Math.max(0, Number(storedSettings.evSmartPvExportTargetW) || 0),
        evPeakGuardStopHoldSeconds: Math.max(0, Number(storedSettings.evPeakGuardStopHoldSeconds) || 0),
        evPeakGuardStopHoldRemainingSeconds: Math.max(0, Math.ceil((Number(this.evPeakGuardStopHoldUntil) - Date.now()) / 1000)),
        evSmartGridPriority: String(storedSettings.evSmartGridPriority || 'battery_first'),
        hvacEnabled: Boolean(storedSettings.hvacEnabled),
        hvacAutomaticControlEnabled: storedSettings.hvacAutomaticControlEnabled !== false,
        hvacAllowFanControl: Boolean(storedSettings.hvacAllowFanControl),
        hvacPriority: String(storedSettings.hvacPriority || 'comfort'),
      },
      chargeTest: {
        passed: this.isChargeTestValid(storedSettings),
        running: Boolean(this.chargeTestRunning),
        awaitingConfirmation: Boolean(this.chargeTestAwaitingConfirmation),
        lastRunAt: Number(this.chargeTestLastRunAt) || 0,
        commandPerBatteryW: this.toPublishedCommand(-100, storedSettings),
        batteryCount: Math.max(1, Math.min(8, Math.round(Number(storedSettings.batteryCount) || 1))),
      },
      inputs: {
        gridPowerW: this.state.gridPowerW,
        pvPowerW: this.state.pvPowerW,
        forecastRemainingKwh: this.state.forecastRemainingKwh,
        forecastDailyMaxKwh: this.state.forecastDailyMaxKwh,
        forecastDailyMaxDate: this.state.forecastDailyMaxDate,
        forecastTomorrowKwh: this.state.forecastTomorrowKwh,
        forecastTomorrowDate: this.state.forecastTomorrowDate,
        batterySoc: this.state.batterySoc.slice(0, storedSettings.batteryCount),
        ev: Boolean(storedSettings.evEnabled) ? {
          soc: storedSettings.evSocEnabled !== false ? this.state.evSoc : null,
          connected: this.state.evConnected,
          chargeCurrentA: this.state.evChargeCurrentA,
          received: {
            ...this.inputSeen.ev,
            soc: storedSettings.evSocEnabled !== false ? Boolean(this.inputSeen.ev.soc) : false,
          },
        } : null,
        hvac: Boolean(storedSettings.hvacEnabled) ? {
          roomTemperatureC: this.state.hvacRoomTemperatureC,
          outdoorTemperatureC: this.state.hvacOutdoorTemperatureC,
          mode: this.state.hvacMode,
          setpointC: this.state.hvacSetpointC,
          fanSpeed: this.state.hvacFanSpeed,
          received: { ...this.inputSeen.hvac },
        } : null,
        evs: evStatuses.map(item => ({
          instance: item.instance, name: item.name, enabled: item.enabled, soc: item.soc,
          connected: item.connected, chargeCurrentA: item.actualCurrentA, received: item.received,
        })),
        hvacs: hvacStatuses.map(item => ({
          instance: item.instance, name: item.name, enabled: item.enabled,
          roomTemperatureC: item.roomTemperatureC, outdoorTemperatureC: item.outdoorTemperatureC,
          mode: item.mode, setpointC: item.setpointC, fanSpeed: item.fanSpeed, received: item.received,
        })),
      },
      evs: evStatuses,
      hvacs: hvacStatuses,
      boiler: boilerStatus,
      priority: priorityStatus,
      ev: Boolean(storedSettings.evEnabled) ? {
        ...(this.latestEvDecision || {}),
        outputCurrentA: Number(this.lastPublishedEvCurrentA) >= 0 ? Number(this.lastPublishedEvCurrentA) : 0,
        outputChargeMode: String(this.lastPublishedEvChargeMode || 'stop'),
        controlType: this.getEvControlType(storedSettings),
        outputAllowed: Boolean(this.lastPublishedEvAllowed),
      } : null,
      hvac: Boolean(storedSettings.hvacEnabled) ? {
        ...(this.latestHvacDecision || {}),
        baselineSetpointC: this.hvacBaselineSetpoint,
        managedPowerOn: Boolean(this.hvacManagedPowerOn),
        outputSetpointC: this.lastPublishedHvacSetpoint !== null && this.lastPublishedHvacSetpoint !== undefined && Number.isFinite(Number(this.lastPublishedHvacSetpoint)) ? Number(this.lastPublishedHvacSetpoint) : null,
        outputMode: this.lastPublishedHvacMode || '',
        outputFanSpeed: this.lastPublishedHvacFanSpeed,
        fanScale: this.getHvacFanScale(storedSettings),
      } : null,
      ...preview,
      // Status/API values follow the configured external sign convention, just
      // like the Flow tokens. The controller itself always keeps its internal
      // positive=discharge / negative=charge convention.
      calculatedCommands: (preview.calculatedCommands || []).map(value => this.toPublishedCommand(value, storedSettings)),
      calculatedTotalCommandW: this.toPublishedCommand(preview.calculatedTotalCommandW ?? preview.totalCommandW, storedSettings),
    };
  }

  setInput(body = {}) {
    const wasGridReady = this.getInputReadiness().ready;
    let fastInputChanged = false;
    let contextInputChanged = false;
    let planningInputChanged = false;
    let gridInputChanged = false;

    if (body.gridPowerW !== undefined && Number.isFinite(Number(body.gridPowerW))) {
      const now = Date.now();
      this.recordSavingsSample(now);
      this.state.gridPowerW = Number(body.gridPowerW);
      this.inputSeen.grid = true;
      this.inputUpdatedAt.grid = now;
      this.recordGridSample(this.state.gridPowerW, now);
      fastInputChanged = true;
      gridInputChanged = true;
      const inputSettings = this.getSettings();
      const contextGridDelta = this.lastContextGridInputW === null
        ? Infinity
        : Math.abs(this.state.gridPowerW - this.lastContextGridInputW);
      if (this.needsSlowMeterContext(inputSettings)
        && (contextGridDelta >= 100 || this.hasActiveFlexibleOutput(inputSettings))) {
        this.lastContextGridInputW = this.state.gridPowerW;
        contextInputChanged = true;
      }
    }
    if (body.pvPowerW !== undefined && Number.isFinite(Number(body.pvPowerW))) {
      const now = Date.now();
      this.recordSavingsSample(now);
      this.state.pvPowerW = Math.max(0, Number(body.pvPowerW));
      this.inputSeen.pv = true;
      this.inputUpdatedAt.pv = now;
      this.updatePvPlanningState(this.state.pvPowerW, now);
      fastInputChanged = true;
      const inputSettings = this.getSettings();
      const contextPvDelta = this.lastContextPvInputW === null
        ? Infinity
        : Math.abs(this.state.pvPowerW - this.lastContextPvInputW);
      if (this.needsSlowMeterContext(inputSettings) && contextPvDelta >= 100) {
        this.lastContextPvInputW = this.state.pvPowerW;
        contextInputChanged = true;
      }
    }
    if (body.forecastRemainingKwh !== undefined && Number.isFinite(Number(body.forecastRemainingKwh))) {
      this.updateForecastInput(Number(body.forecastRemainingKwh));
      contextInputChanged = true;
      planningInputChanged = true;
    }
    if (body.forecastTomorrowKwh !== undefined && Number.isFinite(Number(body.forecastTomorrowKwh))) {
      this.updateForecastTomorrowInput(Number(body.forecastTomorrowKwh));
      contextInputChanged = true;
      planningInputChanged = true;
    }
    if (Array.isArray(body.batterySoc)) {
      body.batterySoc.slice(0, 8).forEach((value, index) => {
        if (!Number.isFinite(Number(value))) return;
        this.state.batterySoc[index] = Math.max(0, Math.min(100, Number(value)));
        this.inputSeen.batterySoc[index] = true;
        this.inputUpdatedAt.batterySoc[index] = Date.now();
        fastInputChanged = true;
        contextInputChanged = true;
        planningInputChanged = true;
      });
    }
    if (body.ev && typeof body.ev === 'object') {
      const now = Date.now();
      const wasConnected = Boolean(this.inputSeen.ev?.connected) && Boolean(this.state.evConnected);
      if (Number.isFinite(Number(body.ev.soc))) { this.state.evSoc = Math.max(0, Math.min(100, Number(body.ev.soc))); this.inputSeen.ev.soc = true; this.inputUpdatedAt.ev.soc = now; contextInputChanged = true; }
      if (body.ev.connected !== undefined) { this.state.evConnected = Boolean(body.ev.connected); this.inputSeen.ev.connected = true; this.inputUpdatedAt.ev.connected = now; contextInputChanged = true; }
      if (Number.isFinite(Number(body.ev.chargeCurrentA))) { this.state.evChargeCurrentA = Math.max(0, Number(body.ev.chargeCurrentA)); this.inputSeen.ev.chargeCurrent = true; this.inputUpdatedAt.ev.chargeCurrent = now; contextInputChanged = true; }
      if (body.ev.connected !== undefined) this.handleEvSessionConnectionTransition(wasConnected, this.state.evConnected);
    }
    if (body.hvac && typeof body.hvac === 'object') {
      const now = Date.now();
      if (Number.isFinite(Number(body.hvac.roomTemperatureC))) { this.state.hvacRoomTemperatureC = Number(body.hvac.roomTemperatureC); this.inputSeen.hvac.roomTemperature = true; this.inputUpdatedAt.hvac.roomTemperature = now; contextInputChanged = true; }
      if (Number.isFinite(Number(body.hvac.outdoorTemperatureC))) { this.state.hvacOutdoorTemperatureC = Number(body.hvac.outdoorTemperatureC); this.inputSeen.hvac.outdoorTemperature = true; this.inputUpdatedAt.hvac.outdoorTemperature = now; contextInputChanged = true; }
      if (body.hvac.mode !== undefined) { this.state.hvacMode = String(body.hvac.mode || 'off'); this.inputSeen.hvac.mode = true; this.inputUpdatedAt.hvac.mode = now; contextInputChanged = true; }
      if (Number.isFinite(Number(body.hvac.setpointC))) { this.state.hvacSetpointC = Number(body.hvac.setpointC); this.inputSeen.hvac.setpoint = true; this.inputUpdatedAt.hvac.setpoint = now; contextInputChanged = true; }
      if (Number.isFinite(Number(body.hvac.fanSpeed))) { this.state.hvacFanSpeed = Math.max(0, Number(body.hvac.fanSpeed)); this.inputSeen.hvac.fanSpeed = true; this.inputUpdatedAt.hvac.fanSpeed = now; contextInputChanged = true; }
    }
    if (Array.isArray(body.evs)) {
      body.evs.slice(0, 4).forEach((value, index) => {
        if (!value || typeof value !== 'object' || index === 0) return;
        const runtime = this.getExtraEv(index);
        if (!runtime) return;
        const now = Date.now();
        const wasConnected = Boolean(runtime.seen.connected) && Boolean(runtime.state.connected);
        if (Number.isFinite(Number(value.soc))) { runtime.state.soc = Math.max(0, Math.min(100, Number(value.soc))); runtime.seen.soc = true; runtime.updatedAt.soc = now; contextInputChanged = true; }
        if (value.connected !== undefined) { runtime.state.connected = Boolean(value.connected); runtime.seen.connected = true; runtime.updatedAt.connected = now; contextInputChanged = true; }
        if (Number.isFinite(Number(value.chargeCurrentA))) { runtime.state.chargeCurrentA = Math.max(0, Number(value.chargeCurrentA)); runtime.seen.chargeCurrent = true; runtime.updatedAt.chargeCurrent = now; contextInputChanged = true; }
        if (value.connected !== undefined) this.handleEvSessionConnectionTransitionFor(index, wasConnected, runtime.state.connected);
      });
    }
    if (Array.isArray(body.hvacs)) {
      body.hvacs.slice(0, 4).forEach((value, index) => {
        if (!value || typeof value !== 'object' || index === 0) return;
        const runtime = this.getExtraHvac(index);
        if (!runtime) return;
        const now = Date.now();
        if (Number.isFinite(Number(value.roomTemperatureC))) { runtime.state.roomTemperatureC = Number(value.roomTemperatureC); runtime.seen.roomTemperature = true; runtime.updatedAt.roomTemperature = now; contextInputChanged = true; }
        if (value.mode !== undefined) { runtime.state.mode = String(value.mode || 'off'); runtime.seen.mode = true; runtime.updatedAt.mode = now; contextInputChanged = true; }
        if (Number.isFinite(Number(value.setpointC))) { runtime.state.setpointC = Number(value.setpointC); runtime.seen.setpoint = true; runtime.updatedAt.setpoint = now; contextInputChanged = true; }
        if (Number.isFinite(Number(value.fanSpeed))) { runtime.state.fanSpeed = Math.max(0, Number(value.fanSpeed)); runtime.seen.fanSpeed = true; runtime.updatedAt.fanSpeed = now; contextInputChanged = true; }
      });
    }

    if (planningInputChanged) this.invalidatePlanningCache();
    if (gridInputChanged) this.checkFlexibleSafetyFromGrid(Date.now(), this.getSettings());

    const gridRecovered = !wasGridReady && this.getInputReadiness().ready;
    if (gridRecovered && Boolean(this.getSettings().controlEnabled)) {
      this.requestContextEvaluate(true, 'api_grid_recovered');
    } else if (body.force) {
      this.requestContextEvaluate(true, 'api_force');
    } else {
      if (fastInputChanged) this.requestEvaluate();
      if (contextInputChanged) this.requestContextEvaluate(false, 'api_context_input');
    }
    return this.latestResult || null;
  }
}

module.exports = HomeFluxEmsApp;
