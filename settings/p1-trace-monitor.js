/* Lightweight presentation for the opt-in P1 trace; no background poll when hidden. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HomeFluxP1TraceMonitor = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create({ document, api, getLanguage, schedule = setTimeout, cancel = clearTimeout,
    url = URL, BlobClass = Blob, now = Date.now }) {
    const q = id => document.getElementById(id);
    const t = (nl, en) => getLanguage() === 'nl' ? nl : en;
    let visible = false, timer = null, busy = false, lastFetch = -Infinity, report = null;
    let downloadUrl = null, releaseTimer = null;
    const labels = {
      get_input_settings: ['P1-instellingen ophalen','Read P1 settings'],
      grid_readiness: ['Input gereedheid','Grid input readiness'],
      savings_sample: ['Savings verwerken','Savings accounting'],
      phase_guard_meter: ['Phase Guard meetwaarden','Phase Guard meter input'],
      grid_sample_window: ['P1-meetvenster','Grid sampling window'],
      ev_house_baseline: ['EV-huisverbruik leren','EV house-load baseline'],
      hvac_observer: ['HVAC-observatie','HVAC observation'],
      ev_battery_reference: ['EV/batterij-referentie','EV/battery reference'],
      ev_load_detection: ['EV-belastingdetectie','EV load detection'],
      adaptive_feedback: ['Batterijfeedback','Adaptive battery feedback'],
      flexible_safety: ['Veiligheid flexibele lasten','Flexible-load safety'],
      hybrid_watchdog: ['Hybrid-watchdog','Hybrid watchdog'],
      slow_context_gate: ['Trage context beslissen','Slow-context gating'],
      ev_context_gate: ['EV-contextaanvraag','EV context gate'],
      grid_recovery_request: ['Herstel netinput','Grid recovery request'],
      ev_protection_request: ['EV-bescherming','EV protection request'],
      fast_request: ['Snelle regeling aanvragen','Fast-control request'],
      battery_fast_evaluation: ['Snelle batterijberekening','Fast battery evaluation'],
      slow_context_inline: ['Trage context direct uit P1','Inline slow context from P1'],
      slow_context_unattributed: ['Trage context later / andere bron','Later slow context / other origin'],
      unclassified: ['Overige instellingenlezingen','Other settings reads'],
    };
    const label = name => (labels[name] || [name.replace(/_/g, ' '), name.replace(/_/g, ' ')])[getLanguage() === 'nl' ? 0 : 1];
    const number = (v, decimals = 2) => (Number(v) || 0).toFixed(decimals);
    const time = at => Number.isFinite(Number(at)) && at ? new Date(at).toLocaleTimeString(getLanguage() === 'nl' ? 'nl-BE' : 'en-GB') : '—';
    function clearPoll() { if (timer !== null) cancel(timer); timer = null; }
    function plan() { clearPoll(); if (visible && report?.active) timer = schedule(() => { timer = null; refresh(); }, 1000); }
    function cell(row, value) { const e = document.createElement('td'); e.textContent = String(value); row.appendChild(e); return e; }
    function releaseDownload() {
      if (releaseTimer !== null) cancel(releaseTimer);
      releaseTimer = null;
      if (downloadUrl) url.revokeObjectURL(downloadUrl);
      downloadUrl = null;
    }
    function status(data) {
      const seconds = Math.ceil((data.session?.remainingMs || 0) / 1000);
      q('p1TraceCountdown').textContent = data.session ? `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}` : '15:00';
      q('p1TraceState').textContent = data.active ? t('P1-trace actief','P1 trace active') : data.session
        ? t('Opname gestopt','Recording stopped') + (data.session.stopReason === '15m_expired' ? t(' · 15 minuten',' · 15 minutes') : '')
        : t('Klaar om te starten','Ready to start');
      q('p1TraceStart').disabled = busy || Boolean(data.active);
      q('p1TraceStop').disabled = busy || !data.active;
      q('p1TraceClear').disabled = busy || Boolean(data.active) || !data.session;
      q('p1TraceExportButton').disabled = busy || !data.session;
    }
    function render(data) {
      report = data;
      status(data);
      q('p1TraceTotal').textContent = String(data.totalP1 || 0);
      q('p1TraceSettings').textContent = `${data.settingsReads || 0} (${number(data.averageSettingsReads)} ${t('per P1','per P1')})`;
      q('p1TraceFast').textContent = `${data.outcomes?.fast_requested || 0} / ${data.outcomes?.fast_immediate || 0} / ${data.outcomes?.fast_timer_scheduled || 0}`;
      q('p1TraceContext').textContent = String(Object.values(data.contextReasons || {}).reduce((sum,n) => sum + (Number(n) || 0),0));
      q('p1TracePhase').textContent = `${data.withPhases || 0} / ${data.withoutPhases || 0}`;
      q('p1TraceProcessCpu').textContent = data.cpu?.cpuMs == null ? '—' : `${number(data.cpu.cpuMs)} ms (${number(data.cpu.averagePercentOneCore,3)}% ${t('kern','core')})`;
      const sections = q('p1TraceStageRows'); sections.replaceChildren();
      for (const stage of data.stages || []) {
        const row = document.createElement('tr');
        cell(row, label(stage.name)); cell(row, stage.calls); cell(row, stage.settingsReads);
        cell(row, number(stage.wallMs)); cell(row, number(stage.averageWallMs)); cell(row, number(stage.maxWallMs));
        cell(row, number(stage.cpuMs)); sections.appendChild(row);
      }
      q('p1TraceStagesEmpty').hidden = Boolean(data.stages?.length);
      const events = q('p1TraceOutcomeRows'); events.replaceChildren();
      for (const [key, count] of Object.entries(data.outcomes || {}).sort((a,b)=>b[1]-a[1])) {
        const row = document.createElement('tr'); cell(row, key.replace(/_/g,' ')); cell(row, count); events.appendChild(row);
      }
      for (const [key, count] of Object.entries(data.contextReasons || {}).sort((a,b)=>b[1]-a[1])) {
        const row = document.createElement('tr'); cell(row, `${t('Contextaanvraag','Context request')}: ${key}`); cell(row, count); events.appendChild(row);
      }
      for (const [key, count] of Object.entries(data.deferredEvents || {}).sort((a,b)=>b[1]-a[1])) {
        const row = document.createElement('tr'); cell(row, `${t('Uitgesteld (niet aan P1 gekoppeld)','Deferred (not linked to one P1)')}: ${key.replace(/_/g, ' ')}`); cell(row, count); events.appendChild(row);
      }
      const cycles = q('p1TraceCycleRows'); cycles.replaceChildren();
      for (const cycle of data.cycles || []) {
        const row = document.createElement('tr');
        cell(row, cycle.sequence); cell(row, time(cycle.at));
        cell(row, cycle.source === 'set_grid_power_phases' ? t('Met fasen','With phases') : t('Enkel totaal','Total only'));
        cell(row, `${cycle.gridPowerW} W`); cell(row, cycle.settingsReads);
        cell(row, number(cycle.wallMs)); cell(row, number(cycle.cpuMs));
        const detail = Object.entries(cycle.stages || {}).sort((a,b)=>b[1].cpuMs-a[1].cpuMs).slice(0,4)
          .map(([name,v])=>`${label(name)}: ${number(v.wallMs)} ms`).join(' · ');
        const request = Object.entries(cycle.outcomes || {}).map(([k,v])=>`${k}: ${v}`).join(', ');
        const contexts = (cycle.contextRequests || []).map(c=>`${c.reason}${c.immediate?'!':''}`).join(', ');
        cell(row, [detail, request, contexts ? `context: ${contexts}` : '', cycle.interruptedForAwait ? t('Async reactietest','Async response test') : ''].filter(Boolean).join(' | '));
        cycles.appendChild(row);
      }
      q('p1TraceCyclesEmpty').hidden = Boolean(data.cycles?.length);
    }
    function showError(err) { q('p1TraceState').textContent = err?.message || String(err); }
    async function refresh() {
      if (!visible || busy) return;
      const wait = 1000 - (now() - lastFetch);
      if (wait > 0) { clearPoll(); timer = schedule(()=> { timer = null; refresh(); },wait); return; }
      busy = true; let error = null;
      try { report = await api('GET','/p1-trace',{}); } catch (err) { error=err; }
      finally { busy = false; lastFetch = now(); if (report) render(report); if (error) showError(error); plan(); }
    }
    async function action(name) {
      if (busy) return;
      clearPoll(); busy = true; let error = null;
      try { report = await api('POST',`/p1-trace/${name}`,{}); }
      catch (err) { error=err; }
      finally { busy=false; lastFetch=now(); if(report) render(report); if(error) showError(error); plan(); }
    }
    async function exportJson() {
      if (busy || !report?.session) return;
      clearPoll(); busy=true; let error=null;
      try {
        const data=await api('GET','/p1-trace',{}); report=data;
        const json=JSON.stringify(data,null,2), area=q('p1TraceExport');
        area.value=json; area.hidden=false; releaseDownload();
        downloadUrl=url.createObjectURL(new BlobClass([json],{type:'application/json'}));
        const anchor=document.createElement('a'); anchor.href=downloadUrl;
        anchor.download=`HomeFlux-EMS-${data.homeFluxVersion}-P1-trace-${new Date(data.session.startedAt).toISOString().replace(/[:.]/g,'-')}.json`;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        releaseTimer=schedule(releaseDownload,30000);
      } catch(err) { error=err; }
      finally { busy=false; lastFetch=now(); if(report) render(report); if(error) showError(error); plan(); }
    }
    q('p1TraceStart').addEventListener('click',()=>action('start'));
    q('p1TraceStop').addEventListener('click',()=>action('stop'));
    q('p1TraceClear').addEventListener('click',()=>action('clear'));
    q('p1TraceExportButton').addEventListener('click',exportJson);
    render({ active: false, session: null, stages: [], cycles: [] });
    return { setVisible(flag) { visible=Boolean(flag); clearPoll(); if(visible)refresh(); },
      destroy() { visible=false; clearPoll(); releaseDownload(); } };
  }
  return { create };
});
