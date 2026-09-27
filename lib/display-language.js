'use strict';
const { createTranslator } = require('../settings/display-language');
const translate = createTranslator(require('../settings/translations/en.json'));
const textKeys = new Set([
  'reason', 'lastError', 'error', 'nextReason', 'message', 'description', 'detail', 'explanation', 'recommendation',
  'modeLabel', 'actionLabel', 'workingModeLabel', 'overrideLabel', 'statusText', 'warningText',
  'nextEventLabel', 'nextEventText', 'batteryPauseReason', 'scopeLabel', 'text',
  'summary', 'cheapestSummary', 'expensiveSummary', 'cheapestBlockSummary', 'statusLabel', 'priceClass',
]);
function isDutch(language) { return String(language || 'nl').toLowerCase().startsWith('nl'); }
function localizeDisplay(value, language) {
  if (isDutch(language) || !value || typeof value !== 'object') return value;
  const walk = object => {
    if (Array.isArray(object)) return object.map(item => item && typeof item === 'object' ? walk(item) : item);
    if (object instanceof Date) return object;
    const copy = {};
    for (const [key, item] of Object.entries(object)) {
      // Names, IDs, settings, raw diagnostic payloads and machine enums are not translated.
      if (['settings', 'inputs', 'raw', 'formula', 'sourceData'].includes(key)) copy[key] = item;
      else if (typeof item === 'string' && (textKeys.has(key) || /(?:Text|Label|Reason|Summary)$/.test(key))) copy[key] = translate(item);
      else if (item && typeof item === 'object') copy[key] = walk(item);
      else copy[key] = item;
    }
    if (object.kind && object.kind !== 'tou' && typeof object.label === 'string') copy.label = translate(object.label);
    return copy;
  };
  return walk(value);
}
function localizeTokens(tokens, language) {
  if (isDutch(language) || !tokens || typeof tokens !== 'object') return tokens;
  const copy = { ...tokens };
  const keys = ['message', 'plan', 'next_change', 'reason', 'mode', 'override', 'status', 'action', 'state', 'allowed', 'publish_allowed',
    'emsmode', 'emsoverride', 'emsstatus', 'emsnextchange', 'emswarning', 'emsaction',
    'emspriceclass', 'emscheapesthours', 'emsexpensivehours', 'emscheapestblock'];
  for (const key of keys) if (typeof copy[key] === 'string') copy[key] = translate(copy[key]);
  return copy;
}
module.exports = { translate, localizeDisplay, localizeTokens, isDutch };
