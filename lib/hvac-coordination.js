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
function prepare(app, stored, result, now = Date.now(), watchPv = true) {
  const settings = Array.from({ length: app.getHvacCount(stored) }, (_, i) => app.getHvacInstanceSettings(i, stored));
  const roots = settings.map((_, i) => rootFor(settings, i));
  const groups = new Map();
  roots.forEach((root, i) => { if (root !== null) { if (!groups.has(root)) groups.set(root, []); groups.get(root).push(i); } });
  const watch=[];
  if (watchPv) settings.forEach((s,i)=>{if(s.hvacEnabled&&s.hvacAutomaticControlEnabled!==false&&s.hvacCoordination?.DirectPvEnabled&&(s.hvacPermanentEnabled?s.hvacPvEnabled:s.hvacUsePvSurplus)){
    const u=H().unit(app,i);const start=Math.max(0,Number(s.hvacSurplusStartW)||800);
    watch.push({index:i,start,stop:Math.min(start,Math.max(0,Number(s.hvacSurplusStopW)||200))});
  }});
  if(watchPv&&(watch.length||app.hvacPermanentRuntime?.pvWatch))H().runtime(app).pvWatch=watch;
  const p = { settings, roots, groups, now, tariff: tariffKey(result), revision: app.hvacConfigRevision || 0,
    sampleGridW: Number(app.state.gridPowerW), samplePvW: Number(app.state.pvPowerW),
    batteryW: Number(app.state.lastTotalCommandW) || 0, approved: new Set(), reserved: new Map(), siteReservedW: 0 };
  p.loads = loads(app, p);
  p.reserved = reservations(p.loads);
  p.totalReservedW = total(p.reserved);
  return p;
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
// A bounded snapshot of the existing output receipts and room feedback. Only
// physical HVAC sources are summed; household/P1/PV/battery power never enters
// this administration. Shared zones reserve the largest source estimate once.
function loads(app, p) {
  const entries = [];
  for (let i = 0; i < p.settings.length; i++) {
    const s = p.settings[i], root = p.roots[i];
    if (root === null) continue;
    const u = H().unit(app, i), input = app.getHvacInputSnapshot(i);
    const published = i === 0 ? { setpoint: app.lastPublishedHvacSetpoint, mode: app.lastPublishedHvacMode, power: app.lastPublishedHvacPower }
      : { setpoint: app.getExtraHvac(i)?.lastPublishedSetpoint, mode: app.getExtraHvac(i)?.lastPublishedMode, power: app.getExtraHvac(i)?.lastPublishedPower };
    const newerMode = input?.seen?.mode && Number(input.updatedAt?.mode) > (Number(u.outputAt) || 0);
    if (newerMode ? input.mode === 'off' : u.powerOff || u.outdoorStopped || published.power === false
      || input?.mode === 'off' && published.power !== true && !finite(u.setpoint)) continue;
    const mode = newerMode ? input.mode : u.mode || published.mode || input?.mode || s.hvacDirection;
    if (!['heat', 'cool'].includes(mode)) continue;
    const target = finite(u.setpoint) ? Number(u.setpoint) : finite(published.setpoint) ? Number(published.setpoint) : input?.setpointC;
    if (!finite(target)) continue;
    const room = input?.seen?.roomTemperature && finite(input.roomTemperatureC) ? Number(input.roomTemperatureC) : null;
    if (room !== null && (mode === 'cool' ? room <= target + .25 : room >= target - .25)) continue;
    const comfort = mode === 'cool' ? Number(s.hvacComfortMaxC) : Number(s.hvacComfortMinC);
    entries.push({ index: i, root, mode, target: Number(target), room, watts: estimate(app, p, i, mode).watts,
      optional: room !== null && (mode === 'cool' ? room <= comfort : room >= comfort) });
  }
  return entries;
}
function reservations(entries) {
  const result = new Map();
  for (const e of entries) result.set(e.root, Math.max(result.get(e.root) || 0, e.watts));
  return result;
}
function total(reserved) { let watts = 0; for (const value of reserved.values()) watts += value; return watts; }
function admission(app, p, index, d) {
  const s = p.settings[index], e = estimate(app, p, index, d.direction);
  const additional = Math.max(0, e.watts - (p.reserved.get(p.roots[index]) || 0));
  const watts = p.totalReservedW + additional;
  const predicted = d.predictedGridW + Math.max(0, p.batteryW) + (p.externalReservedW || 0) + p.siteReservedW + additional;
  const pvOkay = d.energySource !== 'pv' || d.periodicHeating
    || d.virtualGridW + Math.max(0, p.batteryW) + (p.externalReservedW || 0) + p.siteReservedW + additional <= 0;
  const peakOkay = !s.peakShaveEnabled || predicted <= Number(s.peakLimitW) - Math.max(0, Number(s.peakSoftMarginW) || 0);
  const budgetOkay = !s.hvacExtraGridBudgetEnabled || watts <= Math.max(0, Number(s.hvacExtraGridBudgetW) || 0);
  const reason = !Number.isFinite(additional) ? 'HVAC wacht op geldige gedeelde installatie'
    : !peakOkay ? 'HVAC wacht op Peak Guard'
      : !budgetOkay ? 'HVAC wacht op gezamenlijk vermogensbudget'
        : !pvOkay ? 'HVAC wacht op voldoende PV-overschot' : '';
  return { allowed: !reason, reason, additional, watts, estimate: e };
}
function reduceBudget(app, p, previews, order, comfortReserveW = 0) {
  const s = p.settings[0];
  if (!s?.hvacExtraGridBudgetEnabled || p.totalReservedW + comfortReserveW <= Math.max(0, Number(s.hvacExtraGridBudgetW) || 0)) return;
  const limit = Math.max(0, Number(s.hvacExtraGridBudgetW) || 0) - comfortReserveW;
  const groups = [...p.reserved].map(([root, watts]) => {
    const entries = p.loads.filter(e => e.root === root);
    return { root, watts, entries, optional: entries.every(e => e.optional), priority: Math.min(...entries.map(e => order.indexOf(e.index))) };
  }).sort((a, b) => Number(b.optional) - Number(a.optional) || b.priority - a.priority);
  const canStep = e => previews[e.index]?.permanent && previews[e.index]?.comfortControl
    && !p.settings[e.index].hvacTariffEnabled && p.settings[e.index].hvacAllowSetpointControl && e.room !== null;
  let remaining = p.totalReservedW;
  for (const group of groups) {
    if (remaining <= limit) break;
    if (comfortReserveW && !group.optional) continue;
    // Never pretend a shared source has stopped while an uncontrolled zone is
    // still requesting it. A reduction must be permitted for every active zone.
    if (!group.entries.every(e => {
      const d = previews[e.index], cfg = p.settings[e.index];
      return d?.enabled && d.automaticControlEnabled && (cfg.hvacAllowPowerControl || canStep(e));
    })) {
      for (const e of group.entries) if(previews[e.index]) { previews[e.index].waiting=true; previews[e.index].reason='HVAC-vermogensbudget overschreden · afbouw niet toegestaan'; }
      continue;
    }
    let released = true;
    for (const e of group.entries) {
      const d = previews[e.index], cfg = p.settings[e.index], u = H().unit(app, e.index);
      d.increase = false; d.hvacCandidate = false; d.startEligible = false; d.waiting = true;
      if (!d.permanent) { d.legacyCoordinated = true; d.direction = e.mode; }
      d.setpointCommand = null; d.modeCommand = null; d.powerCommand = null;
      d.reason = 'HVAC-vermogensbudget overschreden · wachten op afbouw';
      if (canStep(e)) {
        if (p.now < (Number(u.budgetNextAt) || 0)) { released = false; continue; }
        // Reuse the existing control interval and half-degree resolution. Do
        // not equate a half-degree step with an unmeasured watt reduction.
        const target = Math.round((e.target + (e.mode === 'cool' ? .5 : -.5)) * 2) / 2;
        const next = Math.max(5, Math.min(99, target));
        if (Math.abs(next - e.target) >= .1) {
          d.setpointCommand = next; d.hvacBudgetReduction = true;
          d.reason = 'HVAC-vermogensbudget · comfortsturing 0,5 °C afbouwen';
          if (e.mode === 'cool' ? e.room > next + .25 : e.room < next - .25) released = false;
          continue;
        }
      }
      if (cfg.hvacAllowPowerControl) {
        d.powerCommand = false; d.hvacBudgetReduction = true;
        d.reason = 'HVAC-vermogensbudget overschreden · HVAC uitschakelen';
      } else released = false;
    }
    // This forecast only selects the minimum number of reductions. Admission
    // keeps the original reservations until outputs succeed and a next regular
    // pass confirms demand has disappeared.
    if (released) remaining -= group.watts;
    else break;
  }
}
function authorize(d, s) {
  if (d.legacyCoordinated) {
    if(d.hvacLegacyCommands)Object.assign(d,d.hvacLegacyCommands);
    d.waiting=false;d.coordinated = true; return d;
  }
  d.setpointCommand = d.desiredSetpointC;
  d.modeCommand = d.hvacChangingMode && s.hvacAllowModeControl ? d.direction : null;
  if ((d.currentMode === 'off' || d.hvacWasStopped) && s.hvacAllowPowerControl) d.powerCommand = true;
  d.waiting = false;
  d.reason = (d.hvacDirect ? 'HVAC direct' : 'HVAC parallel') + ' · ' + (d.manualLearning ? 'handmatig leren' : d.periodicHeating ? 'periodiek opwarmen' : d.energySource === 'pv' ? 'PV-overschot' : d.comfortControl ? 'comfortdoel' : 'tariefdoel');
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
    const published=i===0?app.lastPublishedHvacSetpoint:app.getExtraHvac(i)?.lastPublishedSetpoint;
    const previous=finite(published)?Number(published):d.currentSetpointC;
    const raising=finite(d.setpointCommand)&&finite(previous)&&(mode==='cool'?d.setpointCommand<previous:d.setpointCommand>previous);
    if(d.boostActive&&(raising||d.powerCommand===true||d.modeCommand)){
      d.startEligible=true;d.hvacContinuing=true;
      d.hvacLegacyCommands={setpointCommand:d.setpointCommand,powerCommand:d.powerCommand,modeCommand:d.modeCommand,fanTarget:d.fanTarget,fanAction:d.fanAction};
      d.setpointCommand=null;d.powerCommand=null;d.modeCommand=null;d.fanTarget=null;d.fanAction=null;
    }
    if(!d.startEligible){
      if(d.virtualGridW>=-Math.max(0,Number(s.hvacSurplusStopW)||200)&&app.hvacPermanentRuntime?.units[i])app.hvacPermanentRuntime.units[i].pvSince=0;
      if(d.boostActive&&e.known)Object.assign(d,{legacyCoordinated:true,direction:mode,hvacCandidate:false,hvacKnown:true});
      continue;
    }
    const u=H().unit(app,i);
    d.legacyCoordinated=true;
    if(s.hvacCoordination?.DirectPvEnabled){u.pvSince ||= p.now;if(p.now-u.pvSince<15000){d.startEligible=false;d.waiting=true;d.reason='HVAC wacht op stabiel PV-overschot';continue;}}
    Object.assign(d,{legacyCoordinated:true,hvacCandidate:true,direction:mode,increase:true,hvacExtraDemand:true,
      hvacDirect:Boolean(s.hvacCoordination?.DirectPvEnabled),hvacKnown:e.known,hvacEstimateW:e.watts});
  }
  const peakExceeded = previews.some(d => d?.permanent && p.settings[d.instance - 1]?.peakShaveEnabled
    && d.predictedGridW >= Number(p.settings[d.instance - 1].peakLimitW));
  const order = (p.priorityOrder||app.getFlexibleLoadPriorityOrder()).filter(id => /^hvac\d+$/.test(id)).map(id => Number(id.slice(4)) - 1);
  const staleGrid=previews.some(d => d?.permanent && !d.gridFresh);
  if (peakExceeded || staleGrid) {
    // The exception concerns Peak Guard OFF only, never the HVAC watt budget.
    if(!staleGrid&&previews.some((d,i)=>d&&H().protectsFromPeakStop(app,i,d)))reduceBudget(app,p,previews,order);
    // Existing Peak Guard/stale-input safety remains independent of HVAC watts.
    for (let i = 0; i < previews.length; i++) {
      const d = previews[i], s = p.settings[i], u = H().unit(app, i);
      if (!d?.permanent || !finite(u.setpoint) || u.powerOff) continue;
      // Only a published standard comfort start may finish its first target
      // while batteries are charging. Stale input and every other stop retain
      // their existing priority; new HVAC starts still use normal admission.
      if(!staleGrid&&H().protectsFromPeakStop(app,i,d))continue;
      const room = d.roomTemperatureC;
      d.increase = false; d.startEligible = false; d.waiting = true;
      d.setpointCommand = s.hvacAllowSetpointControl
        ? d.direction === 'cool' ? Math.max(Number(s.hvacComfortMaxC), Number(room) || 0) : Math.min(Number(s.hvacComfortMinC), Number(room) || Number(s.hvacComfortMinC)) : null;
      d.powerCommand = s.hvacAllowPowerControl ? false : null;
      d.modeCommand = null; d.safetyReduction = true;
      d.reason = !d.gridFresh ? 'Netmeting verouderd · HVAC veilig afbouwen' : 'Peak Guard · HVAC direct afbouwen';
    }
    return previews;
  }
  const comfort = order.map(i => ({ i, d: previews[i] })).find(({ d }) => d?.hvacReadyWithoutBudget && !d.hvacExtraDemand && d.hvacBudgetBlocked);
  const comfortReserveW = comfort ? admission(app, p, comfort.i, comfort.d).additional : 0;
  reduceBudget(app, p, previews, order, Number.isFinite(comfortReserveW)
    && comfortReserveW <= Math.max(0, Number(p.settings[0]?.hvacExtraGridBudgetW) || 0) ? comfortReserveW : 0);
  // Necessary comfort precedes optional storage, with the existing device
  // order retained within each class. Unknown sources still use one start slot.
  order.sort((a, b) => Number(Boolean(previews[a]?.hvacExtraDemand)) - Number(Boolean(previews[b]?.hvacExtraDemand)));
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
    const check = admission(app, p, i, d);
    if (!check.allowed) { d.startEligible=false; d.waiting = true; d.reason = check.reason; continue; }
    const manual = H().runtime(app).manualQueue?.[0];
    const observing = H().runtime(app).observation;
    const canParallel = d.hvacDirect || e.known || d.hvacContinuing && p.reserved.has(root);
    if (observing && observing.index !== i && !d.hvacDirect) { d.waiting=true; d.reason='HVAC wacht op lopende leermeting'; continue; }
    if (manual && manual.index !== i && !d.hvacDirect && !e.known) { d.waiting=true; d.reason='HVAC wacht op handmatige leermeting'; continue; }
    if (!canParallel && (evStarted || grantedId !== `hvac${i + 1}`)) continue;
    // At most one unknown source may start via the staggered fallback. Known
    // sources can use the same pass, without starting unreliable observations.
    p.reserved.set(root, Math.max(p.reserved.get(root) || 0, e.watts));
    p.totalReservedW = check.watts;
    p.siteReservedW += check.additional;
    p.approved.add(i);
    groupModes.set(root, d.direction);
    authorize(d, s);
    d.hvacEstimatedPowerW = check.watts;
    d.hvacEstimatedExtraImportW = check.watts; // Retain the existing diagnostic field.
    // Parallel batches must not accidentally launch an automatic measurement.
    d.suppressAutoLearning = Boolean(canParallel || p.approved.size > 1);
    if (p.approved.size > 1) for (const j of p.approved) previews[j].suppressAutoLearning = true;
  }
  for (const i of p.approved) previews[i].hvacAdmission={index:i,revision:p.revision,tariff:p.tariff,batteryW:p.batteryW,siteReservedW:p.siteReservedW};
  return previews;
}
function budgetAlarm(app, now = Date.now(), settings = app.getSettings()) {
  const watts = app.hvacPermanentRuntime?.budgetGuard?.watts;
  // Cached arithmetic only on the existing meter safety path. Old household
  // baseline records are intentionally ignored. P1/PV/battery never affect it.
  return settings.hvacExtraGridBudgetEnabled && finite(watts)
    && Number(watts) > Math.max(0, Number(settings.hvacExtraGridBudgetW) || 0);
}
function commit(app, p) {
  if (!p.settings.length && !app.hvacPermanentRuntime) return;
  H().runtime(app).budgetGuard = { watts: total(reservations(loads(app, p))) };
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
module.exports = { UNKNOWN_POWER_W, tariffKey, rootFor, prepare, estimate, admission, plan, authorize, validPublication, manualRequest, manualTarget, trusted, budgetAlarm, commit, observeSurplus };
