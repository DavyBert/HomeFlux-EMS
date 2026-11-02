'use strict';

// Bounded coordination inside the existing slow context/publication pipeline.
// No timers, histories or second control loop. One settings snapshot per slot.
const finite = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
const marginW = watts => Math.ceil(Math.max(0, Number(watts)) * 1.2);
const UNKNOWN_POWER_W = 300;
const H = () => require('./hvac-permanent');
function tariffKey(result) {
  const t = result?.tariff || {};
  return JSON.stringify([t.className || 'normal', t.id || t.rateId || '', t.importPrice ?? t.price ?? null]);
}
function rootFor(settings, index) {
  const seen = new Set();
  let root = index;
  while (settings[root]?.hvacCoordination?.SharedPowerEnabled) {
    if (seen.has(root)) return null;
    seen.add(root);
    const parent = Number(settings[root].hvacCoordination?.SharedPowerWith) - 1;
    if (!Number.isInteger(parent) || parent < 0 || parent >= settings.length || parent === root) return null;
    root = parent;
  }
  return root;
}
function trusted(app, index, mode) {
  const u = H().unit(app, index);
  return finite(u[mode]) && Number(u[mode]) >= 50 && !u[mode + 'Review'] ? Number(u[mode]) : null;
}
function prepare(app, stored, result, now = Date.now()) {
  const settings = Array.from({ length: app.getHvacCount(stored) }, (_, i) => app.getHvacInstanceSettings(i, stored));
  const roots = settings.map((_, i) => rootFor(settings, i));
  const groups = new Map();
  roots.forEach((root, i) => { if (root !== null) { if (!groups.has(root)) groups.set(root, []); groups.get(root).push(i); } });
  const watch=[];
  settings.forEach((s,i)=>{if(s.hvacEnabled&&s.hvacAutomaticControlEnabled!==false&&s.hvacCoordination?.DirectPvEnabled&&(s.hvacPermanentEnabled?s.hvacPvEnabled:s.hvacUsePvSurplus)){
    const u=H().unit(app,i);const start=Math.max(0,Number(s.hvacSurplusStartW)||800);
    watch.push({index:i,start,stop:Math.min(start,Math.max(0,Number(s.hvacSurplusStopW)||200))});
  }});
  if(watch.length||app.hvacPermanentRuntime?.pvWatch)H().runtime(app).pvWatch=watch;
  return { settings, roots, groups, now, tariff: tariffKey(result), revision: app.hvacConfigRevision || 0,
    sampleGridW: Number(app.state.gridPowerW), samplePvW: Number(app.state.pvPowerW),
    batteryW: Number(app.state.lastTotalCommandW) || 0, approved: new Set(), reserved: new Map(), siteReservedW: 0 };
}
function observeSurplus(app,now=Date.now()) {
  const r=app.hvacPermanentRuntime;if(!r?.pvWatch?.length)return;
  const fresh=app.inputSeen.pv&&now-Number(app.inputUpdatedAt.pv)<=60000;
  const available=-Number(app.state.gridPowerW)-Math.max(0,Number(app.state.lastTotalCommandW)||0);
  let request=false;
  for(const w of r.pvWatch){const u=r.units[w.index];if(!u)continue;
    if(!fresh||available<w.stop){u.pvSince=0;u.pvDirectRequested=false;continue;}
    if(available>=w.start){u.pvSince ||= now;if(!u.pvDirectRequested&&now-u.pvSince>=15000){u.pvDirectRequested=true;request=true;}}
  }
  return request;
}
function estimate(app, p, index, mode) {
  const root = p.roots[index];
  if (root === null) return { watts: Infinity, known: false };
  const known = trusted(app, root, mode);
  // Shared thermostats reserve the complete source capacity including a
  // modulation margin. Adding a zone is never treated as a zero-watt source.
  return { watts: marginW(known ?? UNKNOWN_POWER_W), known: known !== null };
}
function authorize(d, s) {
  if (d.legacyCoordinated) { d.coordinated = true; return d; }
  d.setpointCommand = d.desiredSetpointC;
  d.modeCommand = d.hvacChangingMode && s.hvacAllowModeControl ? d.direction : null;
  if ((d.currentMode === 'off' || d.hvacWasStopped) && s.hvacAllowPowerControl) d.powerCommand = true;
  d.waiting = false;
  d.reason = (d.hvacDirect ? 'HVAC direct' : 'HVAC parallel') + ' · ' + (d.manualLearning ? 'handmatig leren' : d.periodicHeating ? 'periodiek opwarmen' : d.energySource === 'pv' ? 'PV-overschot' : 'tariefdoel');
  d.coordinated = true;
  return d;
}
function plan(app, p, previews, grantedId, evStarted) {
  if (!previews.length) return previews;
  // Existing PV boost control retains its half-degree steps and restoration.
  // Only admission is coordinated; its original controller publishes the step.
  for (let i=0;i<previews.length;i++) {
    const d=previews[i],s=p.settings[i];
    if(!d||d.permanent)continue;
    const mode=d.boostMode||H().activationMode(s,d.roomTemperatureC,d.outdoorTemperatureC);
    const e=estimate(app,p,i,mode);
    if(!d.startEligible){
      if(d.virtualGridW>=-Math.max(0,Number(s.hvacSurplusStopW)||200)&&app.hvacPermanentRuntime?.units[i])app.hvacPermanentRuntime.units[i].pvSince=0;
      if(d.boostActive&&e.known)Object.assign(d,{legacyCoordinated:true,direction:mode,hvacCandidate:false,hvacKnown:true});
      continue;
    }
    if(!e.known&&!s.hvacCoordination?.DirectPvEnabled&&!s.hvacCoordination?.SharedPowerEnabled)continue;
    const u=H().unit(app,i);
    d.legacyCoordinated=true;
    if(s.hvacCoordination?.DirectPvEnabled){u.pvSince ||= p.now;if(p.now-u.pvSince<15000){d.startEligible=false;continue;}}
    Object.assign(d,{legacyCoordinated:true,hvacCandidate:true,direction:mode,increase:true,hvacExtraDemand:true,
      hvacDirect:Boolean(s.hvacCoordination?.DirectPvEnabled),hvacKnown:e.known,hvacEstimateW:e.watts});
  }
  const peakExceeded = previews.some(d => d?.permanent && p.settings[d.instance - 1]?.peakShaveEnabled
    && d.predictedGridW >= Number(p.settings[d.instance - 1].peakLimitW));
  const budgetExceeded = budgetAlarm(app);
  p.budgetSafety=budgetExceeded;
  if(!peakExceeded&&!budgetExceeded&&!previews.some(d=>d?.permanent&&!d.gridFresh)&&!previews.some(d=>d?.hvacCandidate&&d?.startEligible))return previews;
  const order = (p.priorityOrder||app.getFlexibleLoadPriorityOrder()).filter(id => /^hvac\d+$/.test(id)).map(id => Number(id.slice(4)) - 1);
  const active = new Map(), extra = new Map();
  for (let i = 0; i < previews.length; i++) {
    const d = previews[i], s = p.settings[i], root = p.roots[i];
    if ((!d?.permanent&&!d?.legacyCoordinated) || !d.enabled || !d.automaticControlEnabled || root === null) continue;
    const u = H().unit(app, i);
    if (!finite(u.setpoint) || u.powerOff) continue;
    const target = finite(d.setpointCommand) ? Number(d.setpointCommand) : Number(u.setpoint);
    const demanding = !finite(d.roomTemperatureC) || (d.direction === 'cool' ? d.roomTemperatureC > target + .25 : d.roomTemperatureC < target - .25);
    if (d.powerCommand === false || !demanding) continue;
    const e = estimate(app, p, i, d.direction).watts;
    active.set(root, Math.max(active.get(root) || 0, e));
    if (d.legacyCoordinated || (d.direction === 'cool' ? target < Number(s.hvacComfortMaxC) : target > Number(s.hvacComfortMinC))) extra.set(root, Math.max(extra.get(root) || 0, e));
  }
  p.existingExtra = extra;
  if (peakExceeded || budgetExceeded || previews.some(d => d?.permanent && !d.gridFresh)) {
    // Safety reductions never wait for priority, learning or the start timer.
    // Reduce every affected group to comfort; power OFF remains permissioned.
    for (let i = 0; i < previews.length; i++) {
      const d = previews[i], s = p.settings[i], u = H().unit(app, i);
      if (!d?.permanent || !finite(u.setpoint) || u.powerOff) continue;
      const room = d.roomTemperatureC;
      d.increase = false; d.startEligible = false; d.waiting = true;
      d.setpointCommand = s.hvacAllowSetpointControl
        ? d.direction === 'cool' ? Math.max(Number(s.hvacComfortMaxC), Number(room) || 0) : Math.min(Number(s.hvacComfortMinC), Number(room) || Number(s.hvacComfortMinC)) : null;
      d.powerCommand = s.hvacAllowPowerControl ? false : null;
      d.modeCommand = null; d.safetyReduction = true;
      d.reason = !d.gridFresh ? 'Netmeting verouderd · HVAC veilig afbouwen' : peakExceeded ? 'Peak Guard · HVAC direct afbouwen' : 'HVAC-netbudget overschreden · direct afbouwen';
    }
    return previews;
  }
  const groupModes = new Map();
  for (const [root, members] of p.groups) for (const i of members) {
    const u = app.hvacPermanentRuntime?.units?.[i];
    if (u && !u.powerOff && finite(u.setpoint) && ['heat','cool'].includes(u.mode)) groupModes.set(root, u.mode);
  }
  for (const [root,members] of p.groups) {
    if(members.length<2)continue;
    const desired=previews[members[0]]?.direction;
    if(['heat','cool'].includes(desired)&&members.every(i=>previews[i]?.enabled&&previews[i]?.automaticControlEnabled
      &&previews[i]?.direction===desired&&(!previews[i].increase||previews[i].startEligible)
      &&(!previews[i].hvacChangingMode||p.settings[i].hvacAllowModeControl)))groupModes.set(root,desired);
  }
  for (const i of order) {
    const d = previews[i], s = p.settings[i];
    if ((!d?.permanent&&!d?.legacyCoordinated) || !d.increase || !d.hvacCandidate || !d.startEligible) continue;
    const e = estimate(app, p, i, d.direction), root = p.roots[i];
    if (p.groups.get(root)?.length > 1 && groupModes.has(root) && groupModes.get(root) !== d.direction) { d.reason = 'Gedeelde warmtebron heeft een andere regelrichting'; continue; }
    const manual = H().runtime(app).manualQueue?.[0];
    const observing = H().runtime(app).observation;
    const canParallel = d.hvacDirect || e.known;
    if (observing && observing.index !== i && !d.hvacDirect) continue;
    if (manual && manual.index !== i && !d.hvacDirect && !e.known) continue;
    if (!canParallel && (evStarted || grantedId !== `hvac${i + 1}`)) continue;
    // At most one unknown source may start via the staggered fallback. Known
    // sources can use the same pass, without starting unreliable observations.
    const additional = Math.max(0, e.watts - (p.reserved.get(root) || 0));
    const predicted = d.predictedGridW + Math.max(0, p.batteryW) + (p.externalReservedW || 0) + p.siteReservedW + additional;
    const pvOkay = d.energySource !== 'pv' || d.periodicHeating || d.virtualGridW + Math.max(0, p.batteryW) + (p.externalReservedW || 0) + p.siteReservedW + additional <= 0;
    const peakOkay = !s.peakShaveEnabled || predicted <= Number(s.peakLimitW) - Math.max(0, Number(s.peakSoftMarginW) || 0);
    const nextExtra = new Map(extra);
    if (d.hvacExtraDemand) nextExtra.set(root, Math.max(nextExtra.get(root) || 0, e.watts));
    const extraW = [...nextExtra.values()].reduce((a, b) => a + b, 0);
    const surplus = Math.max(0, -d.virtualGridW - Math.max(0, p.batteryW));
    const budgetOkay = !s.hvacExtraGridBudgetEnabled || !d.hvacExtraDemand && !canParallel
      || Math.max(0, extraW - surplus) <= Math.max(0, Number(s.hvacExtraGridBudgetW) || 0);
    if (!pvOkay || !peakOkay || !budgetOkay || !Number.isFinite(additional)) { d.reason = 'HVAC wacht op gezamenlijke energiemarge'; continue; }
    p.reserved.set(root, Math.max(p.reserved.get(root) || 0, e.watts));
    p.siteReservedW += additional;
    extra.clear(); for (const pair of nextExtra) extra.set(...pair);
    p.approved.add(i);
    groupModes.set(root, d.direction);
    authorize(d, s);
    d.hvacEstimatedExtraImportW = Math.max(0, extraW - surplus);
    // Parallel batches must not accidentally launch an automatic measurement.
    d.suppressAutoLearning = Boolean(canParallel || p.approved.size > 1);
    if (p.approved.size > 1) for (const j of p.approved) previews[j].suppressAutoLearning = true;
  }
  for (const i of p.approved) previews[i].hvacAdmission={index:i,revision:p.revision,tariff:p.tariff,batteryW:p.batteryW,siteReservedW:p.siteReservedW};
  p.active = active;
  return previews;
}
function budgetAlarm(app, now = Date.now(), settings = app.getSettings()) {
  const guard = app.hvacPermanentRuntime?.budgetGuard;
  if (!guard || !settings.hvacExtraGridBudgetEnabled) return false;
  if (!app.inputSeen.pv || now - Number(app.inputUpdatedAt.pv) > 60000) return false;
  // Only arithmetic on cached context state on the meter path. Household
  // increases are conservatively treated as loss of thermal headroom.
  const baseGrid = guard.houseW - Math.max(0, Number(app.state.pvPowerW) || 0)
    - (Number(app.state.lastTotalCommandW) || 0) + guard.evW
    + (app.boilerState?.outputOn ? Math.max(0,Number(settings.boilerPowerW)||1800) : 0) - (guard.boilerW || 0);
  return Number(app.state.gridPowerW) > Math.max(0, baseGrid) + Math.max(0, Number(settings.hvacExtraGridBudgetW) || 0) + 100;
}
function commit(app, p, totalActualEvPowerW) {
  if (!p.settings.length && !app.hvacPermanentRuntime) return;
  const r = H().runtime(app);
  const active = Object.entries(r.units).some(([i,u]) => finite(u.setpoint) && !u.powerOff && !u.outdoorStopped && app.settingsCache?.[app.getHvacSettingKey(Number(i),'AutomaticControlEnabled')]!==false);
  if (!active) { r.budgetGuard = null; return; }
  if (!p.active?.size && p.approved.size && app.inputSeen.pv) {
    r.budgetGuard = { houseW: Number(p.sampleGridW) + Math.max(0, Number(p.samplePvW) || 0) + p.batteryW - totalActualEvPowerW, evW: totalActualEvPowerW,
      boilerW: app.boilerState?.outputOn ? Math.max(0,Number(app.getSettings().boilerPowerW)||1800) : 0 };
  } else if (r.budgetGuard) r.budgetGuard.evW = totalActualEvPowerW;
}
function validPublication(app, index, d) {
  const p = d.hvacAdmission;
  return !p || p.index === index && p.revision === (app.hvacConfigRevision || 0)
    && p.tariff === tariffKey(app.latestResult) && p.batteryW === (Number(app.state.lastTotalCommandW) || 0)
    && app.getGridFreshness(app.getSettings(), Date.now()).fresh;
}
function manualRequest(app, index) {
  if (!Number.isInteger(index) || index < 0 || index >= app.getHvacCount()) throw new Error('HVAC is niet geconfigureerd.');
  const s = app.getHvacInstanceSettings(index);
  const all = Array.from({ length: app.getHvacCount() }, (_, i) => app.getHvacInstanceSettings(i));
  if (s.hvacCoordination?.SharedPowerEnabled || all.some((_, i) => i !== index && rootFor(all, i) === index)) throw new Error('Een gedeelde installatie kan niet afzonderlijk worden geleerd.');
  if (!s.hvacEnabled || s.hvacAutomaticControlEnabled === false) throw new Error('Schakel automatische HVAC-sturing eerst in.');
  const r = H().runtime(app); r.manualQueue ||= [];
  if (!r.manualQueue.some(item => item.index === index)) r.manualQueue.push({ index, requestedAt: Date.now() });
  H().unit(app, index).status = 'Handmatig leren aangevraagd';
  H().persist(app);
  app.requestContextEvaluate(true, 'hvac_manual_learning');
  return H().status(app, index);
}
function manualTarget(app, index, s, mode, target, room) {
  const r = H().runtime(app), request = r.manualQueue?.[0];
  if (!request || request.index !== index || r.observation || s.hvacCoordination?.SharedPowerEnabled || !finite(room)) return null;
  // A real demand step is required: keep the request queued until a reliable
  // idle baseline exists. Never reset valid learned watts merely to retry.
  if (!H().canBegin(app, index, Date.now())) return null;
  const u = H().unit(app, index), input = app.getHvacInputSnapshot(index);
  const old = finite(u.setpoint) ? Number(u.setpoint) : input?.setpointC;
  if (!finite(old) || (mode === 'heat' ? room < old - .25 : room > old + .25)) return null;
  const probe = mode === 'heat' ? Math.max(Number(old) + 1, Number(room) + 1, target) : Math.min(Number(old) - 1, Number(room) - 1, target);
  return Math.round(Math.max(5, Math.min(99, probe)) * 2) / 2;
}
module.exports = { UNKNOWN_POWER_W, tariffKey, rootFor, prepare, estimate, plan, authorize, validPublication, manualRequest, manualTarget, trusted, budgetAlarm, commit, observeSurplus };
