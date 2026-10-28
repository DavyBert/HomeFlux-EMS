'use strict';
// Input metadata and lifecycle for the existing central SoC/kWh plans.
// There are no charging decisions, device reads, timers or parallel plans here.
const { localParts, localDateTimeUtcMs, shiftDateKey } = require('./homey-energy');
const { findNextLocalTime } = require('./flexible-loads');
const current = (app, i) => app.evEnergyPlans?.[i]?.active ? app.evEnergyPlans[i]
  : app.evSocPlans?.[i]?.active ? app.evSocPlans[i] : null;
const widget = (app, i) => current(app, i)?.widgetPlan || null;
const serialized = p => p?.widgetPlan ? { widgetPlan: { ...p.widgetPlan }, deadlineAt: p.deadlineAt } : {};
function resolve(app, i, time, options) {
  if (!options) return null;
  if (options.owner !== 'widget' || typeof options !== 'object') return false;
  const old = current(app, i), meta = old?.widgetPlan;
  const now = Date.now(), timezone = app.homey.clock.getTimezone() || 'UTC';
  const today = localParts(new Date(now), timezone).dateKey;
  const days = options.days ?? meta?.days ?? 0;
  const maxPv = options.maxPv ?? meta?.maxPv ?? false;
  if (!Number.isInteger(days) || days < 0 || days > 7 || typeof maxPv !== 'boolean') return false;
  let anchorDate = meta?.anchorDate || today, dateKey = meta?.dateKey;
  let deadlineAt;
  if (Object.hasOwn(options, 'days')) {
    anchorDate = today;
    dateKey = days ? shiftDateKey(today, days) : localParts(findNextLocalTime(new Date(now), time, timezone), timezone).dateKey;
  } else if (!dateKey) {
    dateKey = days ? shiftDateKey(today, days) : localParts(findNextLocalTime(new Date(now), time, timezone), timezone).dateKey;
  }
  if (options.dateKey !== undefined) {
    if (!days || !/^\d{4}-\d\d-\d\d$/.test(options.dateKey) || options.dateKey < today
      || options.dateKey > shiftDateKey(anchorDate, days)) return false;
    dateKey = options.dateKey;
  }
  if (meta && options.days === undefined && options.dateKey === undefined && old.targetTime === time) deadlineAt = old.deadlineAt;
  else deadlineAt = localDateTimeUtcMs(dateKey, time, timezone);
  if (!Number.isFinite(deadlineAt) || deadlineAt <= now) return false;
  const local = localParts(new Date(deadlineAt), timezone);
  if (local.dateKey !== dateKey || `${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}` !== time) return false;
  return { days, maxPv, dateKey, anchorDate, deadlineAt, createdAt: meta?.createdAt || now,
    completed: Boolean(options.preserveProgress && meta?.completed),
    connectedEver: Boolean(meta?.connectedEver || app.getEvInputSnapshot(i)?.connected),
    preserveProgress: Boolean(options.preserveProgress) };
}
function runtime(app) { return app.evWidgetPlanRuntime ||= Array.from({ length:4 },()=>({})); }
function persist(app) {
  const value = runtime(app), text = JSON.stringify(value);
  if (text === app.evWidgetPlanRuntimeSerialized) return;
  app.evWidgetPlanRuntimeSerialized = text;
  app.setSetting('_evWidgetPlanRuntime', JSON.parse(text));
}
function restore(app) {
  const raw = app.homey.settings.get('_evWidgetPlanRuntime');
  app.evWidgetPlanRuntime = Array.from({length:4},(_,i)=>raw?.[i] && typeof raw[i]==='object' ? raw[i] : {});
  for (const r of app.evWidgetPlanRuntime) if (r.feedback) r.feedback.restored = true;
  app.evWidgetPlanRuntimeSerialized = JSON.stringify(app.evWidgetPlanRuntime);
}
function captureFlowPlan(app, i) {
  // Remember input parameters only, not a second live plan or its progress.
  // Called before the first widget goal replaces the central Flow goal.
  const p = current(app, i);
  const energy = Boolean(app.evEnergyPlans?.[i]?.active);
  runtime(app)[i].resumePlan = p && !p.widgetPlan ? {
    type: energy ? 'kwh' : 'soc', value: energy ? p.targetKwh : p.targetSoc,
    time: p.targetTime, guaranteed: Boolean(p.guarantee),
  } : null;
}
function install(app, i, plan, meta, previousWidget) {
  if (meta) {
    const r = runtime(app)[i];
    if (!previousWidget) r.resumeMode = { ...app.getEvSessionOverrideFor(i) };
    plan.widgetPlan = { ...meta }; delete plan.widgetPlan.preserveProgress;
    plan.deadlineAt = meta.deadlineAt; plan.targetOccurrenceAt = meta.deadlineAt;
    capture(app, i, Date.now(), true);
    persist(app);
  } else {
    delete plan.widgetPlan;
    if (previousWidget) resume(app, i, 'flow_plan_replaced_widget');
  }
}
function resume(app, i, reason) {
  const r = runtime(app)[i], pending = r.resumeMode;
  const pendingPlan = reason === 'confirmed_disconnect' ? r.resumePlan : null;
  r.resumePlan = null;
  r.resumeMode = null; r.notice = null; r.endedReason = reason; r.endedAt = Date.now();
  persist(app);
  if (app.isDiagnosticEnabled('planning')) app.getCompactDiagnostics().event('ev_widget_plan_ended',
    {instance:i+1,reason,resumeMode:pending?.mode || null},Date.now());
  if (pending?.mode) app.setEvSessionOverrideFor(i, pending.mode, pending.source || 'flow');
  else app.clearEvSessionOverrideFor(i);
  app.notifyEvDashboard();
  // Explicit clear and Emergency keep their existing clear semantics. Only a
  // confirmed disconnect resubmits the saved Flow input to the central handler.
  if (pendingPlan?.type === 'soc') return app.setEvSocPlan(i, pendingPlan.value,
    pendingPlan.time, pendingPlan.guaranteed ? 'yes' : 'no');
  if (pendingPlan?.type === 'kwh') return app.setEvEnergyPlan(i, pendingPlan.value,
    pendingPlan.time, pendingPlan.guaranteed ? 'yes' : 'no');
  return false;
}
function deferMode(app, i, mode, source) {
  if (!widget(app,i) || !String(source || 'flow').startsWith('flow')) return false;
  const r=runtime(app)[i], normalized=app.normalizeEvOperatingMode(mode), now=Date.now();
  r.resumeMode={mode:normalized,source:String(source||'flow'),requestedAt:now};
  const input=app.getEvInputSnapshot(i), connected=input?.seen?.connected ? input.connected : r.feedback?.connected;
  if (connected) {
    if (r.notice?.mode!==normalized || now-Number(r.notice?.at||0)>=30000) {
      r.notice={mode:normalized,at:now,until:now+10000,kind:'mode_override'};
      persist(app);app.notifyEvDashboard();
      if (app.isDiagnosticEnabled('planning')) app.getCompactDiagnostics().event('ev_widget_flow_deferred',
        {instance:i+1,command:'mode_override',mode:normalized,reason:'widget_plan_active'},now);
    }
    return true;
  }
  persist(app); return false;
}
function capture(app,i,now=Date.now(),force=false) {
  const meta=widget(app,i);if(!meta)return;
  const r=runtime(app)[i], input=app.getEvInputSnapshot(i), session=app.getEvSessionDetectionRuntime(i);
  const connected=input?.seen?.connected ? Boolean(input.connected) : null;
  const state=String(session?.state||'unknown');
  if(!force && r.feedback?.connected===connected && r.feedback?.state===state && now-Number(r.feedback?.at||0)<300000)return;
  const feedbackAt = Math.max(Number(input?.updatedAt?.connected)||0,Number(input?.updatedAt?.chargeCurrent)||0);
  if (!feedbackAt && r.feedback?.restored) return;
  r.feedback={connected,state,at:feedbackAt || 0};persist(app);
}
function feedback(app,i,hasConnection,connected,now) {
  const meta=widget(app,i);if(!meta)return;
  if(hasConnection && connected && !meta.connectedEver) {
    meta.connectedEver=true;app.persistEvSocPlanOverrides();app.persistEvEnergyPlanOverrides(true,now);
  }
  if(hasConnection && !connected && meta.connectedEver) {
    app.clearEvSocPlan(i, 'confirmed_disconnect');return;
  }
  capture(app,i,now);
}
function complete(app,i,source) {
  const meta=widget(app,i);if(!meta || !['soc_target','energy_target'].includes(source) || meta.completed)return;
  meta.completed=true;app.persistEvSocPlanOverrides();app.persistEvEnergyPlanOverrides(true);capture(app,i,Date.now(),true);
}
function label(deadlineAt,timezone) {
  if(!(deadlineAt>0))return null;
  const p=localParts(new Date(deadlineAt),timezone), time=`${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`;
  const day=new Date(Date.UTC(p.year,p.month-1,p.day)).getUTCDay();
  return {dateKey:p.dateKey,time,nl:`${['zo','ma','di','wo','do','vr','za'][day]} ${String(p.day).padStart(2,'0')}/${String(p.month).padStart(2,'0')}/${p.year} · ${time}`,
    en:`${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]} ${String(p.day).padStart(2,'0')}/${String(p.month).padStart(2,'0')}/${p.year} · ${time}`};
}
module.exports={current,widget,serialized,resolve,install,restore,persist,runtime,captureFlowPlan,resume,deferMode,capture,feedback,complete,label};
