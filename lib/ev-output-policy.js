'use strict';

const STANDARD_SOURCES = new Set(['tariff', 'guarantee', 'pv+tariff', 'pv+topup']);

// One read-only projection of the existing allocator/policy result onto the
// physical outputs. No planning, meter inference, timers or device access.
function resolveEvOutput({ decision: d, settings: s = {}, holdUntil = 0, now = Date.now(),
  gridW = null, includeNightSurplus = true }) {
  const type = ['current', 'mode', 'hybrid'].includes(s.evControlType) ? s.evControlType : 'current';
  const currentA = Math.max(0, Math.round(Number(d?.desiredCurrentA) || 0));
  let mode = type === 'current' ? null : 'stop', stopReason = null;
  if (!d || !s.evEnabled) stopReason = 'disabled';
  else if (!d.connected) stopReason = 'disconnected';
  else if (!d.allowed) {
    if (d.targetCompleted || d.socTargetReached || d.targetReached) stopReason = 'target_or_session';
    else if (d.peakLimited) {
      const peak = Math.max(0, Number(s.peakLimitW) - Math.max(0, Number(s.peakSoftMarginW) || 0));
      stopReason = s.peakShaveEnabled && gridW !== null && Number(gridW) >= peak
        ? 'peak_guard' : 'insufficient_safe_budget';
    } else stopReason = 'policy_or_measurement';
  } else if (type !== 'current' && holdUntil > now) stopReason = 'restart_hold';
  else if (type === 'mode' && ['smart', 'standard'].includes(d.effectiveChargeMode)) mode = d.effectiveChargeMode;
  else if (type === 'mode' && d.peakLimited) stopReason = 'insufficient_safe_budget';
  else if (type !== 'current') {
    const operating = ['emergency', 'soc_target', 'smart'].includes(String(d.mode || s.evMode || 'smart'))
      ? String(d.mode || s.evMode || 'smart') : 'smart';
    const source = String(d.source || 'off');
    mode = ['emergency', 'soc_target'].includes(operating) || STANDARD_SOURCES.has(source)
      || (includeNightSurplus && source === 'night_surplus')
      ? 'standard' : 'smart';
  }
  const allowed = !stopReason && (type === 'mode' || currentA > 0);
  if (!allowed && !stopReason) stopReason = 'no_valid_charge_step';
  // Current limits may remain positive during a Hybrid STOP, as before. The
  // mode/permission is authoritative; an ampere limit is not proof of charging.
  return { currentA, mode,
    allowed: Boolean(allowed), stopReason };
}
module.exports = { resolveEvOutput };
