'use strict';
const { localDateTimeUtcMs, inferIntervalMinutes } = require('../../lib/homey-energy');

module.exports = {
  async getStatus({ homey }) {
    const app = homey.app;
    const status = app.getPublicStatus();
    const settings = app.getSettings();
    const now = Date.now();
    // A selected source may contain future prices without covering the current
    // slot. Keep its available curve visible; planning readiness stays unchanged.
    status.priceCurves = (status.priceData?.sources || []).map(item => {
      // Graph the received rows, never resampled or aligned planning rows.
      const rows = (item.source === 'homey' ? app.homeyEnergy : item.source === 'external2' ? app.externalEnergy2 : app.externalEnergy)?.slots || [];
      const intervalMinutes = inferIntervalMinutes(rows, 15);
      const timedRows = rows.map(row => ({...row, startMs: row.startMs ?? localDateTimeUtcMs(row.dateKey, `${Math.floor(row.minute/60)}:${String(row.minute%60).padStart(2,'0')}`, settings.timezone || 'UTC')}));
      return { source: item.source, name: item.name, intervalMinutes, normalized: false, points: timedRows
        .filter(row => row.startMs != null && Number(row.startMs) + intervalMinutes * 60000 > now && Number(row.startMs) < now + 120 * 3600000)
        .map(row => [Number(row.startMs), Number(row.price)]) };
    }).filter(curve => curve.points.length);
    return status;
  },
};
