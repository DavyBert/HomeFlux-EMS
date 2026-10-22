/* Presentation only. The app owns recording and expiry, independently of this page. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HomeFluxInputMonitor = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create({ document, api, getLanguage, schedule = setTimeout, cancel = clearTimeout,
    url = URL, BlobClass = Blob, now = Date.now }) {
    const q = id => document.getElementById(id);
    const t = (nl, en) => getLanguage() === 'nl' ? nl : en;
    let visible = false, timer = null, busy = false, report = null, lastFetch = -Infinity;
    let downloadUrl = null, downloadTimer = null;

    function clearPoll() { if (timer !== null) cancel(timer); timer = null; }
    function plan() {
      clearPoll();
      if (visible && report?.active) timer = schedule(() => { timer = null; refresh(); }, 1000);
    }
    function error(err) { q('inputMonitorState').textContent = err.message || String(err); }
    function buttons(data) {
      q('startInputMonitoring').disabled = busy || data.active;
      q('stopInputMonitoring').disabled = busy || !data.active;
      q('clearInputMonitoring').disabled = busy || data.active || !data.session;
      q('exportInputMonitoring').disabled = busy || !data.session;
    }
    function cell(row, text, className = '') {
      const element = document.createElement('td');
      element.textContent = text;
      if (className) element.className = className;
      row.appendChild(element);
      return element;
    }
    function date(at) { return at == null ? '—' : new Date(at).toLocaleTimeString(getLanguage() === 'nl' ? 'nl-BE' : 'en-GB'); }
    function value(data) {
      const parts = Object.entries(data || {}).map(([key, v]) => `${key}: ${v && typeof v === 'object'
        ? t('afgeschermd', 'redacted') + (v.characters == null ? '' : ` (${v.characters} ${t('tekens', 'characters')})`) : String(v)}`);
      return parts.length ? parts.join(' · ') : t('Opdracht zonder waarde', 'Command without value');
    }
    function render(data) {
      report = data;
      const s = data.session;
      const seconds = Math.ceil((s?.remainingMs || 0) / 1000);
      q('inputMonitorCountdown').textContent = s ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : '15:00';
      q('inputMonitorState').textContent = data.active
        ? t('Monitoring actief', 'Monitoring active')
        : s ? t('Monitoring gestopt', 'Monitoring stopped') + (s.stopReason === '15m_expired' ? t(' · 15 minuten bereikt', ' · 15-minute limit reached') : '')
          : t('Klaar om te starten', 'Ready to start');
      q('inputMonitorTotal').textContent = String(data.totalReceived || 0);
      q('inputMonitorLoops').textContent = String(data.possibleLoopEpisodes || 0);
      q('inputMonitorActiveLoops').textContent = String(data.activePossibleLoops || 0);
      buttons(data);
      const body = q('inputMonitorRows');
      body.replaceChildren();
      for (const input of data.inputs || []) {
        const row = document.createElement('tr');
        row.className = `input-monitor-${input.status}`;
        const name = cell(row, input.name?.[getLanguage()] || input.name?.en || input.cardId);
        const id = document.createElement('small');
        id.textContent = input.cardId + (Object.keys(input.selectors || {}).length ? ` · ${Object.entries(input.selectors).map(([k,v]) => `${k} ${v}`).join(', ')}` : '');
        name.appendChild(id);
        cell(row, value(input.latestValue));
        cell(row, String(input.received));
        cell(row, String(input.updatesPerSecond));
        cell(row, String(input.peakPerSecond));
        cell(row, `${input.identical} (${input.received > 1 ? Math.round(input.identical / (input.received - 1) * 100) : 0}%)`);
        cell(row, date(input.lastReceivedAt));
        const status = cell(row, input.status === 'possible_loop'
          ? t('⚠ Mogelijke loop – hoge inputfrequentie', '⚠ Possible loop – high input frequency')
          : input.status === 'high_frequency' ? t('Verhoogde frequentie', 'High frequency') : t('Normaal', 'Normal'));
        if (input.possibleLoopEpisodes) {
          const history = document.createElement('small');
          history.textContent = `${t('Eerste waarschuwing', 'First warning')}: ${date(input.firstWarningAt)} · ${input.possibleLoopEpisodes}×`;
          status.appendChild(history);
        }
        cell(row, `C ${input.requests.context} · F ${input.requests.fast} · EV ${input.requests.evDeferred}`);
        body.appendChild(row);
      }
      q('inputMonitorEmpty').hidden = Boolean(data.inputs?.length);
    }

    async function refresh() {
      if (busy || !visible) return;
      const wait = 1000 - (now() - lastFetch);
      if (wait > 0) { clearPoll(); timer = schedule(() => { timer = null; refresh(); }, wait); return; }
      busy = true;
      lastFetch = now();
      let failure;
      try { report = await api('GET', '/input-monitor', {}); }
      catch (err) { failure = err; }
      finally { busy = false; if (report) render(report); if (failure) error(failure); plan(); }
    }
    async function action(path) {
      if (busy) return;
      clearPoll();
      busy = true;
      if (report) buttons(report);
      let failure;
      try {
        report = await api('POST', `/input-monitor/${path}`, {});
        q('inputMonitorExport').hidden = true;
        q('inputMonitorExport').value = '';
        releaseDownload();
      } catch (err) { failure = err; }
      finally { busy = false; if (report) render(report); if (failure) error(failure); lastFetch = now(); plan(); }
    }
    function releaseDownload() {
      if (downloadTimer !== null) cancel(downloadTimer);
      downloadTimer = null;
      if (downloadUrl) url.revokeObjectURL(downloadUrl);
      downloadUrl = null;
    }
    async function exportJson() {
      if (busy || !report?.session) return;
      clearPoll();
      busy = true;
      let failure;
      try {
        const data = await api('GET', '/input-monitor', {});
        report = data;
        const json = JSON.stringify(data, null, 2);
        const area = q('inputMonitorExport');
        area.value = json;
        area.hidden = false; // Also usable in mobile clients that restrict downloads.
        releaseDownload();
        downloadUrl = url.createObjectURL(new BlobClass([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `HomeFlux-EMS-${data.homeFluxVersion}-inputs-${new Date(data.session.startedAt).toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        downloadTimer = schedule(releaseDownload, 30000);
      } catch (err) { failure = err; }
      finally { busy = false; if (report) render(report); if (failure) error(failure); lastFetch = now(); plan(); }
    }
    q('startInputMonitoring').addEventListener('click', () => action('start'));
    q('stopInputMonitoring').addEventListener('click', () => action('stop'));
    q('clearInputMonitoring').addEventListener('click', () => action('clear'));
    q('exportInputMonitoring').addEventListener('click', exportJson);
    render({ active: false, session: null, inputs: [] });
    return {
      setVisible(value) { visible = Boolean(value); clearPoll(); if (visible) refresh(); },
      destroy() { visible = false; clearPoll(); releaseDownload(); },
    };
  }
  return { create };
});
