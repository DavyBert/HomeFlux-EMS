'use strict';

// Runtime-only P1 history. At most one point per second; no timer or polling.
const WINDOW_MS = 60000, MAX_POINTS = 64, MAX_GAP_MS = 10000;
function record(owner, at, valueW, reason = '', revision = 0) {
  const points = owner.recentHouseSamples ||= [];
  const last = points[points.length - 1];
  if (last && at < last.at) return;
  const invalid = reason || (!Number.isFinite(valueW) || valueW < 0 ? 'invalid_house_power' : '');
  if (last && Math.floor(last.at / 1000) === Math.floor(at / 1000)) {
    // Duplicate/high-rate input cannot manufacture time coverage or erase an
    // uncertain sample in the same second. Retain the first actual P1 point.
    if (invalid && !last.reason) last.reason = invalid;
    return;
  }
  points.push({ at, valueW, reason: invalid, revision });
  if (points.length > MAX_POINTS) points.shift();
}
function read(owner, now, revision = 0) {
  const points = owner?.recentHouseSamples || [], cutoff = now - WINDOW_MS;
  let weighted = 0, coveredMs = 0, count = 0, reason = '';
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.at >= cutoff && p.at <= now && !p.reason) count++;
    if (i === points.length - 1) continue;
    const next = points[i + 1], start = Math.max(cutoff, p.at), end = Math.min(now, next.at);
    if (end <= start) continue;
    const invalid = p.reason || next.reason || (p.revision !== revision || next.revision !== revision ? 'configuration_changed' : '')
      || (next.at - p.at > MAX_GAP_MS ? 'p1_gap' : '');
    if (invalid) { reason ||= invalid; continue; }
    weighted += p.valueW * (end - start); coveredMs += end - start;
  }
  const last = points[points.length - 1];
  if (!last || last.at > now || now - last.at > 5000) reason = 'p1_stale';
  else if (last.reason) reason = last.reason;
  else if (last.revision !== revision) reason = 'configuration_changed';
  if (!reason && count < 6) reason = 'insufficient_samples';
  if (!reason && coveredMs < 54000) reason = 'insufficient_coverage';
  return { averageW: coveredMs > 0 ? weighted / coveredMs : null, sampleCount: count,
    coverageSeconds: coveredMs / 1000, windowSeconds: 60, fallbackReason: reason,
    usable: !reason };
}
module.exports = { record, read, MAX_POINTS, WINDOW_MS };
