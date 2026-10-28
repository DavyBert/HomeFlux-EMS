'use strict';
const { parseSlot } = require('./flow-slot-cards');
const { addDays, calibrateEnergy } = require('./savings');
const { localDateTimeUtcMs, shiftDateKey } = require('./homey-energy');

const planOptions = require('./ev-plan-options');
const DEFAULTS = require('./ev-dashboard-config');
const isSetting = key => /^ev([2-4])?(Widget(PresetMode|Soc[1-3]|Kwh[1-3]|Time[1-3])|ConsumptionKwhPer100Km|EnergyFeedbackScope)$/.test(key);
function plan(app, index) {
  const energy = app.evEnergyPlans?.[index], soc = app.evSocPlans?.[index];
  const p = energy?.active ? energy : soc?.active ? soc : null;
  return p ? { type: energy?.active ? 'kwh' : 'soc', value: energy?.active ? p.targetKwh : p.targetSoc,
    time: p.targetTime, deadlineAt: p.deadlineAt, guaranteed: Boolean(p.guarantee),
    deadlineLabel: planOptions.label(p.deadlineAt, app.homey.clock.getTimezone() || 'UTC'),
    owner: p.widgetPlan ? 'widget' : 'flow', days: p.widgetPlan?.days || 0, maxPv: Boolean(p.widgetPlan?.maxPv),
    completed: Boolean(p.widgetPlan?.completed), expired: p.deadlineAt <= Date.now(),
    provisional: Boolean(p.widgetPlan?.maxPv || ((index === 0 ? app.latestEvDecision : app.getExtraEv(index)?.latestDecision)?.deadlinePlanning
      ? (index === 0 ? app.latestEvDecision : app.getExtraEv(index)?.latestDecision).deadlinePlanProvisional : p.widgetPlan?.days > 0)),
    ...(energy?.active ? { remainingKwh: p.remainingKwh } : {}) } : null;
}
function activeSchedule(app, index, settings, current, session) {
  // Read-only display projection. Do not expand runtime settings here: that
  // would resolve deadlines and mutate planner metadata during a widget read.
  const key = suffix => app.getEvSettingKey(index, suffix);
  const mode = app.getEffectiveEvModeFor(index, settings);
  if (mode === 'emergency') return { mode, source: 'emergency', target: null };
  const usable = current && (current.type === 'kwh' || settings[key('SocEnabled')] !== false) ? current : null;
  const energy = usable?.type === 'kwh';
  const continuing = !energy && settings[key('AfterSocTarget')] === 'preferences' && Boolean(session?.socTargetReached);
  return { mode, source: usable ? usable.owner : 'settings',
    deadlineLabel: usable?.deadlineLabel || null, days: usable?.days || 0, maxPv: Boolean(usable?.maxPv),
    expired: Boolean(usable?.expired), provisional: Boolean(usable?.provisional),
    target: usable ? { type: usable.type, value: usable.value }
      : settings[key('SocEnabled')] !== false ? { type: 'soc', value: Number(settings[key('TargetSoc')]) || 0 } : null,
    time: usable?.time || String(settings[key('TargetTime')] || '07:00'),
    guaranteed: !continuing && (usable ? usable.guaranteed
      : Boolean(settings[key('GuaranteeTarget')]) && Boolean(settings[key('AllowUnselectedTariffForDeadline')])),
    completed: usable?.completed || (energy ? Number(usable.remainingKwh) <= .001 : Boolean(session?.socTargetReached)), continuing };
}
function submit(app, body) {
  const slot = parseSlot(body?.evId, 4);
  if (!slot || slot > app.getEvCount()) throw new Error('evWidget.errors.ev');
  const change = body.change;
  if (!change || typeof change !== 'object' || Array.isArray(change)
    || !Object.keys(change).length || Object.keys(change).some(k => !['target','time','guaranteed','days','dateKey','deadline','maxPv','clear','mode'].includes(k))) throw new Error('evWidget.errors.input');
  if ('guaranteed' in change && typeof change.guaranteed !== 'boolean') throw new Error('evWidget.errors.input');
  const id = String(body.requestId || '');
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(id)) throw new Error('evWidget.errors.input');
  app.evWidgetRequests ||= new Map();
  const fingerprint = JSON.stringify([slot, change, Boolean(body.createOnly)]);
  const old = app.evWidgetRequests.get(id);
  if (old) { if (old.fingerprint !== fingerprint) throw new Error('evWidget.errors.input'); return old.result; }
  // No await between this fresh central read and invoking the original listener.
  const current = plan(app, slot - 1);
  if (body.createOnly && current) throw new Error('evWidget.errors.changed');
  if (current && Object.keys(change).length !== 1) throw new Error('evWidget.errors.changed');
  if ('mode' in change) {
    if (Object.keys(change).length !== 1 || !['emergency', 'smart'].includes(change.mode)) throw new Error('evWidget.errors.input');
    const modeListener = app.slotFlowCards.actions.get(`set_ev${slot}_session_override`);
    if (!modeListener) throw new Error('evWidget.errors.ev');
    if (current?.owner === 'widget') {
      if (change.mode !== 'emergency') throw new Error('evWidget.errors.changed');
      // Explicitly confirmed by the user: Emergency ends a widget goal. The
      // existing central clear and mode handlers commit in this same JS turn.
      if (!app.clearEvSocPlan(slot - 1, 'widget_emergency')) throw new Error('evWidget.errors.changed');
    }
    return completeRequest(app, slot, id, fingerprint, modeListener({ mode: change.mode }));
  }
  if (change.clear !== undefined && (change.clear !== true || Object.keys(change).length !== 1)) throw new Error('evWidget.errors.input');
  const target = change.target || (current && { type: current.type, value: current.value });
  const time = change.deadline?.time ?? ('time' in change ? change.time : current?.time);
  const guaranteed = 'guaranteed' in change ? change.guaranteed : current?.guaranteed ?? false;
  if (!change.clear && (!target || !time || !['soc','kwh'].includes(target.type))) throw new Error('evWidget.errors.incomplete');
  const listener = app.slotFlowCards.actions.get(change.clear ? `clear_ev${slot}_soc_deadline_override`
    : `set_ev${slot}_${target.type === 'soc' ? 'soc' : 'energy'}_deadline`);
  if (!listener) throw new Error('evWidget.errors.ev');
  if ('deadline' in change && (!change.deadline || typeof change.deadline !== 'object' || Array.isArray(change.deadline)
    || typeof change.deadline.dateKey !== 'string' || typeof change.deadline.time !== 'string'
    || Object.keys(change.deadline).some(k=>!['dateKey','time'].includes(k)))) throw new Error('evWidget.errors.input');
  const options = { owner:'widget', preserveProgress: !change.target,
    ...('days' in change ? {days:change.days} : {}),
    ...('maxPv' in change ? {maxPv:change.maxPv} : {}),
    ...('dateKey' in change ? {dateKey:change.dateKey} : {}),
    ...(change.deadline ? {dateKey:change.deadline.dateKey} : {}) };
  const pending = change.clear ? listener({}) : listener({ [target.type === 'soc' ? 'target_soc' : 'energy']: target.value,
    time, guarantee: guaranteed ? 'yes' : 'no', _widgetPlan:options });
  return completeRequest(app, slot, id, fingerprint, pending);
}
function completeRequest(app, slot, id, fingerprint, pending) {
  const result = Promise.resolve(pending).then(accepted => {
    if (accepted !== true) throw new Error('evWidget.errors.input');
    app.notifyEvDashboard();
    return { accepted: true, evId: String(slot), plan: plan(app, slot - 1),
      mode: app.getEffectiveEvModeFor(slot - 1, app.getSettings()) };
  });
  app.evWidgetRequests.set(id, { fingerprint, result });
  if (app.evWidgetRequests.size > 128) app.evWidgetRequests.delete(app.evWidgetRequests.keys().next().value);
  return result;
}

function insights(app, period) {
  const today = app.getSavingsDateKey(), now = Date.now(), timezone = app.homey.clock.getTimezone() || 'UTC';
  const range = period === 'all' ? { startKey: '0000-01-01', endKey: shiftDateKey(today, 1) }
    : app.getSavingsPeriodRange(['day','week','month'].includes(period) ? period : 'day', now);
  // The existing shared closed-day cache serves Savings AND EV Insights.
  app.savingsHistoryCache ||= require('./savings-history').createHistoryCache();
  const total = app.savingsHistoryCache.sum(app.savings.history, range, today);
  if (today >= range.startKey && today < range.endKey) addDays(total, calibrateEnergy(app.savings.today));
  const start = period === 'all' ? app.savingsHistoryCache.oldest(app.savings.history, today) : range.startKey;
  const expectedSeconds = Math.max(0, (now - localDateTimeUtcMs(start, '00:00', timezone)) / 1000);
  const ev = total.ev;
  return { total: ev?.total || null, byId: ev?.byId || {},
    incomplete: !ev || ev.seconds + 5 < expectedSeconds, sharedKwh: ev?.sharedKwh || 0,
    period, date: today, currency: app.getSettings().currencySymbol || '€' };
}
function status(app, period = 'day') {
  const settings = app.getSettings(), history = insights(app, period), evs = [];
  for (let index = 0; index < app.getEvCount(settings); index++) {
    const input = app.getEvInputSnapshot(index), key = suffix => app.getEvSettingKey(index, suffix);
    // Read the SAME central session as EMS status. Detection is owned by the
    // existing input/control path, including mode-only house-load detection.
    // A widget refresh must never infer charging from amps, commands or slots.
    const session = app.getEvSessionDetectionRuntime(index);
    const p = plan(app, index);
    const metric = history.byId[String(index + 1)] || null;
    const consumption = Number(settings[key('ConsumptionKwhPer100Km')]);
    const savedFeedback=planOptions.runtime(app)[index]?.feedback;
    const liveConnection=Boolean(input?.seen?.connected);
    const notice=planOptions.runtime(app)[index]?.notice;
    evs.push({ id: String(index + 1), name: app.getEvInstanceName(index, settings),
      connected: liveConnection ? Boolean(input.connected) : savedFeedback?.connected ?? null,
      feedbackStale: !liveConnection && Boolean(savedFeedback?.restored),
      flowDeferred: Boolean(p?.owner==='widget' && notice?.until>Date.now()), flowDeferredUntil: notice?.until || 0,
      soc: input?.seen?.soc && app.getEvSocFreshness(index, { evSocEnabled: settings[key('SocEnabled')],
        evSocFreshnessMinutes: settings[key('SocFreshnessMinutes')] }).fresh ? input.soc : null,
      state: !liveConnection && savedFeedback?.restored ? savedFeedback.state : ['idle','waiting','charging','paused','ended'].includes(session?.state) ? session.state : 'unknown',
      plan: p, schedule: activeSchedule(app, index, settings, p, session),
      presets: { mode: settings[key('WidgetPresetMode')] === 'kwh' ? 'kwh' : 'soc',
        soc: [1,2,3].map(n => settings[key(`WidgetSoc${n}`)]),
        kwh: [1,2,3].map(n => settings[key(`WidgetKwh${n}`)]),
        times: [1,2,3].map(n => settings[key(`WidgetTime${n}`)]) },
      insights: metric && (metric.kwh > 0 || metric.missingSeconds === 0)
        ? { ...metric, solarKm: consumption > 0 ? metric.pvKwh / consumption * 100 : null } : null,
      consumption, incomplete: history.incomplete || !metric || metric.missingSeconds > 0
        || metric.unknownKwh > 1e-9 || metric.unpricedKwh > 1e-9 || history.sharedKwh > 0 });
  }
  return { evs, period, currency: history.currency, sharedKwh: history.sharedKwh, at: Date.now() };
}
module.exports = { DEFAULTS, isSetting, plan, submit, status, insights };
