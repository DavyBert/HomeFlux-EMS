'use strict';

// Persistence only. No control decisions, raw measurements or integration
// across a restart. Completed-day summaries retain their existing format.
const { localParts, localDateTimeUtcMs, shiftDateKey } = require('./homey-energy');
const evidenceFields = ['configurationChanged','protectedFloorSoc','evidenceVersion','season','goalSoc','pvProductionKwh','exportKwh','directPvEstimateKwh','pvBatteryEstimateKwh','uncoveredDemandKwh','expensiveUncoveredKwh','expensiveReliableHours','expensiveHours','expensiveMinSoc','goalLimitedHours','storageFullHours','powerLimitedHours','curtailmentHours','reliableHours'];
const fields = ['dateKey','lastAt','sampleMillis','estimatedDemandKwh','forecastKwh','peakSoc','solarTargetSoc','nightTargetSoc','minObservedSoc','maxSocLimit','lowForecastPromoted','configurationSignature',...evidenceFields];
const socFields = new Set(['peakSoc','solarTargetSoc','nightTargetSoc','minObservedSoc','maxSocLimit','protectedFloorSoc','goalSoc','expensiveMinSoc']);
const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function snapshot(day) {
  if (!day) return null;
  return Object.fromEntries(fields.filter(key => day[key] !== undefined).map(key => [key,day[key]]));
}

function fingerprint(payload) {
  // Advancing an observation anchor without new learning is not a reason to
  // write storage. Its actual watermark is still included in every checkpoint.
  return JSON.stringify({...payload,currentDay:payload.currentDay?{...payload.currentDay,lastAt:0}:null});
}

function restoreDay(raw, today, now, timezone) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || typeof raw.dateKey !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(raw.dateKey) || raw.dateKey > today) return null;
  const start = localDateTimeUtcMs(raw.dateKey,'00:00',timezone);
  const end = localDateTimeUtcMs(shiftDateKey(raw.dateKey,1),'00:00',timezone);
  if (!Number.isFinite(start) || localParts(new Date(start),timezone).dateKey !== raw.dateKey
    || !validNumber(raw.sampleMillis) || raw.sampleMillis > end-start
    || !validNumber(raw.estimatedDemandKwh) || !validNumber(raw.lastAt)
    || localParts(new Date(raw.lastAt),timezone).dateKey !== raw.dateKey) return null;
  const value = snapshot(raw), hours = raw.sampleMillis/3600000;
  for (const [key,item] of Object.entries(value)) {
    if (['dateKey','lastAt','sampleMillis','estimatedDemandKwh'].includes(key) || item === null) continue;
    if (key === 'configurationSignature') { if (typeof item !== 'string' || item.length > 4096) return null; }
    else if (key === 'season') { if (!['winter','spring','summer','autumn'].includes(item)) return null; }
    else if (['configurationChanged','lowForecastPromoted'].includes(key)) { if (typeof item !== 'boolean') return null; }
    else if (!validNumber(item) || (socFields.has(key) && item > 100)
      || (key.endsWith('Hours') && item > hours+1e-9)) return null;
  }
  if (Number(value.expensiveReliableHours || 0) > Math.min(Number(value.reliableHours || 0),Number(value.expensiveHours || 0))+1e-9) return null;
  return {
    forecastKwh:null,peakSoc:null,solarTargetSoc:null,nightTargetSoc:null,minObservedSoc:null,maxSocLimit:null,lowForecastPromoted:false,
    ...value,
    // A new session must establish stability again. Keep a future watermark
    // after a backwards clock correction so already measured time is not reused.
    lastAt:Math.max(now,raw.lastAt),
  };
}

function restore(raw, today, now, timezone) {
  // Malformed dates/timestamps can also make Intl reject a date. Only discard
  // the active checkpoint; corrupt storage must never prevent app startup.
  try { return restoreDay(raw,today,now,timezone); } catch { return null; }
}

module.exports = { snapshot, restore, fingerprint };
