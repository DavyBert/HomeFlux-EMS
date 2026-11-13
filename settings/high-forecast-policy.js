/* Compact storage for the four dynamic high-PV preferences. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomeFluxHighForecastPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const keys = Object.freeze([
    'highForecastDynamicCheapBatterySave', 'highForecastDynamicCheapDischargeToTarget',
    'highForecastDynamicNormalBatterySave', 'highForecastDynamicNormalDischargeToTarget',
  ]);
  const defaults = Object.freeze(Object.fromEntries(keys.map(key => [key, true])));
  function complete(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && keys.every(key => typeof value[key] === 'boolean'));
  }
  // Startup migration and UI load only. The control loops read the object directly.
  function normalize(value, legacy = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(keys.map(key => [key, Boolean(source[key] ?? legacy[key] ?? defaults[key])]));
  }
  return { keys, defaults, complete, normalize };
});
