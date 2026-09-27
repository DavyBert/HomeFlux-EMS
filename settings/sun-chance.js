/* Date-bound sunshine forecasts and optional ordinary-discharge reserve. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HomeFluxSunChance = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const number = value => value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
  const defaults = { sunChanceReserveEnabled: false, sunChanceFixedEnabled: true,
    sunChanceDynamicCheapEnabled: true, sunChanceDynamicNormalEnabled: true, sunChanceDynamicExpensiveEnabled: false };
  [[0,10],[10,30],[30,50],[50,100]].forEach(([start,end], i) => {
    defaults[`sunChanceBand${i+1}Start`] = start;
    defaults[`sunChanceBand${i+1}End`] = end;
    defaults[`sunChanceBand${i+1}MinSoc`] = null;
  });
  function bands(settings) {
    const safety = Math.max(Number(settings.minSoc) || 0, Number(settings.safetySoc) || 0);
    return [1,2,3,4].map(i => ({
      start: number(settings[`sunChanceBand${i}Start`] ?? defaults[`sunChanceBand${i}Start`]),
      end: number(settings[`sunChanceBand${i}End`] ?? defaults[`sunChanceBand${i}End`]),
      minSoc: number(settings[`sunChanceBand${i}MinSoc`]) ?? Math.min(100, safety + (4-i)*10),
    }));
  }
  function validBands(rows) {
    return rows.length === 4 && rows[0].start === 0 && rows[3].end === 100 && rows.every((b,i) =>
      [b.start,b.end,b.minSoc].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)
      && b.start < b.end && (!i || b.start === rows[i-1].end));
  }
  function tariffAllowed(settings, tariff) {
    if (tariff?.kind === 'tou') {
      if (!tariff.rateId) return false;
      if (typeof tariff.sunChanceReserveAllowed === 'boolean') return tariff.sunChanceReserveAllowed;
      return tariff.className !== 'expensive' && !tariff.avoidGridImport;
    }
    if (tariff?.kind === 'dynamic' || String(settings.contractType || '').startsWith('dynamic')) {
      if (!tariff || tariff.price === null || tariff.price === undefined) return false;
      const key = tariff.className === 'cheap' ? 'sunChanceDynamicCheapEnabled'
        : tariff.className === 'expensive' ? 'sunChanceDynamicExpensiveEnabled' : 'sunChanceDynamicNormalEnabled';
      return Boolean(settings[key] ?? defaults[key]);
    }
    if (tariff?.kind === 'fixed' || settings.contractType === 'fixed') return Boolean(settings.sunChanceFixedEnabled ?? defaults.sunChanceFixedEnabled);
    return false;
  }
  function touDefaultAllowed(rate, rates) {
    const prices = rates.map(r => Number(r.importPrice) || 0);
    const expensive = prices.length > 0 && Math.max(...prices) > Math.min(...prices)
      && (Number(rate.importPrice) || 0) === Math.max(...prices);
    return !expensive && !rate.avoidGridImport;
  }
  function reserve(state, settings, today, tariff = null) {
    const day = state.nightPlanningActive && state.planningForecastDay === 'tomorrow' ? 'tomorrow' : 'today';
    const d = new Date(today + 'T12:00:00Z');
    if (day === 'tomorrow') d.setUTCDate(d.getUTCDate()+1);
    const date = d.toISOString().slice(0,10);
    const chance = number(state.sunChanceForecasts?.[date]);
    const rows = bands(settings);
    const enabled = Boolean(settings.sunChanceReserveEnabled);
    const ready = chance !== null && chance >= 0 && chance <= 100;
    const valid = validBands(rows);
    const row = ready && valid ? rows.find((b,i) => (i === 0 ? chance >= b.start : chance > b.start) && chance <= b.end) : null;
    const appliesToTariff = tariffAllowed(settings, tariff);
    const active = enabled && appliesToTariff && Boolean(row);
    const max = Math.min(100, Math.max(Number(settings.minSoc)||0, Number(settings.maxSoc) || 100));
    const floorSoc = active ? Math.min(max, Math.max(Number(settings.minSoc)||0, Number(settings.safetySoc)||0, row.minSoc)) : 0;
    return { enabled, ready, active, appliesToTariff, day, date, chance, floorSoc,
      statusText: !enabled ? 'Zonkansreserve uit' : !appliesToTariff ? 'Zonkansreserve uit voor dit tarief' : !valid ? 'Ongeldige zonkansbereiken' : !ready ? 'Geen zonkans voor de planningsdag' : 'Zonkansreserve actief' };
  }
  return { defaults, bands, validBands, reserve, number, tariffAllowed, touDefaultAllowed };
});
