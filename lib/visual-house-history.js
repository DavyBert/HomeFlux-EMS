'use strict';
// Display-only time-weighted averages. O(1) per P1 observation, bounded RAM,
// no timer, settings access or independent physical-load reconstruction.
const INTERVAL = 300000, MAX_GAP = 60000, EMPTY = Object.freeze([]);
function createHouseSampler() {
  let previous = null, bucket = null;
  return { sample(at, powerW) {
    let result = null;
    const valid = Number.isFinite(at) && typeof powerW === 'number'
      && Number.isFinite(powerW) && powerW >= 0 && powerW <= 100000;
    if (!valid) { previous = null; return result || EMPTY; }
    if (previous && at <= previous.at) return result || EMPTY;
    const add = (start, end, watts) => {
      const key = Math.floor(start / INTERVAL) * INTERVAL;
      if (bucket && bucket.start !== key) finish();
      bucket ||= { start: key, firstAt: start, area: 0, ms: 0 };
      bucket.area += watts * (end - start); bucket.ms += end - start;
    };
    const finish = () => {
      if (bucket?.ms > 0) (result ||= []).push([bucket.firstAt, Math.round(bucket.area / bucket.ms), bucket.start + INTERVAL, bucket.ms]);
      bucket = null;
    };
    if (previous && at - previous.at <= MAX_GAP) {
      let start = previous.at;
      while (start < at) {
        const end = Math.min(at, (Math.floor(start / INTERVAL) + 1) * INTERVAL);
        const fraction = ((start + end) / 2 - previous.at) / (at - previous.at);
        add(start, end, previous.powerW + (powerW - previous.powerW) * fraction);
        if (end % INTERVAL === 0) finish();
        start = end;
      }
    }
    if (bucket && at >= bucket.start + INTERVAL) finish();
    if(previous){previous.at=at;previous.powerW=powerW}else previous={at,powerW};
    return result || EMPTY;
  } };
}
// The original house integrator stays independent of SOC availability.
// The optional callback is read only when its existing five-minute bucket closes.
function createSampler() {
  const house = createHouseSampler();
  let boundary = null, lastSocAt = 0;
  return { sample(at, powerW, readSoc) {
    const rows = house.sample(at, powerW);
    if (!Number.isFinite(at) || typeof readSoc !== 'function') return rows;
    const next = Math.floor(at / INTERVAL) * INTERVAL;
    if (boundary === null) { boundary = next; return rows; }
    if (next <= boundary) return rows;
    boundary = next;
    const observation = readSoc();
    const valid = observation && typeof observation.soc === 'number'
      && Number.isFinite(observation.soc) && observation.soc >= 0 && observation.soc <= 100
      && Number.isFinite(observation.at) && observation.at > lastSocAt && observation.at <= at;
    if (!valid && (!rows.length || lastSocAt === 0)) return rows;
    const result = rows.length ? rows : [[next, null, null, null]];
    // Keep the house integration timestamp and the actual SOC receipt separate.
    const row = result[result.length - 1];
    if (valid) { row[4] = observation.soc; row[5] = observation.at; lastSocAt = observation.at; }
    // A monotonically increasing transport cursor also handles SOC-only buckets.
    for (const item of result) { item[4] ??= null; item[5] ??= null; item[6] = at; }
    return result;
  } };
}
function validHouse(row) {
  return typeof row?.[1] === 'number' && Number.isFinite(row[1]) && row[1] >= 0 && row[1] <= 100000;
}
function validSoc(row) {
  return typeof row?.[4] === 'number' && Number.isFinite(row[4]) && row[4] >= 0 && row[4] <= 100
    && Number.isFinite(row[5]) && row[5] > 0;
}
function historyCursor(row) { return Number.isFinite(row[6]) ? row[6] : row[0]; }
module.exports = { createSampler, INTERVAL, validHouse, validSoc, historyCursor };
