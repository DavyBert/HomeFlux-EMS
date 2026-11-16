'use strict';
// Display-only time-weighted averages. O(1) per P1 observation, bounded RAM,
// no timer, settings access or independent physical-load reconstruction.
const INTERVAL = 300000, MAX_GAP = 60000, EMPTY = Object.freeze([]);
function createSampler() {
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
module.exports = { createSampler, INTERVAL };
