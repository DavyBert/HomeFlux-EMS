'use strict';
const { createTranslator } = require('../settings/display-language');
const translators = new Map([['en', createTranslator(require('../settings/translations/en.json'))]]);
function normalizeLanguage(value='en') { const code=String(value||'en').toLowerCase().split(/[-_]/)[0]; return ['nl','en','fr','es','de'].includes(code)?code:'en'; }
function translate(value, language='en') {const code=normalizeLanguage(language); if(code==='nl')return String(value??''); if(!translators.has(code))translators.set(code,createTranslator(require(`../settings/translations/${code}.json`))); return translators.get(code)(value);}

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
      else if (typeof item === 'string' && (textKeys.has(key) || /(?:Text|Label|Reason|Summary)$/.test(key))) copy[key] = translate(item,language);
      else if (item && typeof item === 'object') copy[key] = walk(item);
      else copy[key] = item;
    }
    if (object.kind && object.kind !== 'tou' && typeof object.label === 'string') copy.label = translate(object.label,language);
    return copy;
  };
  return walk(value);
}
function localizeTokens(tokens, language) {
  if (isDutch(language) || !tokens || typeof tokens !== 'object') return tokens;
  const copy = { ...tokens };
  const keys = ['message', 'plan', 'next_change', 'reason', 'mode', 'override', 'status', 'action', 'state', 'allowed', 'publish_allowed',
    'emsmode', 'emsoverride', 'emsstatus', 'emsnextchange', 'emswarning', 'emserrors', 'emslasterror', 'emsaction',
    'emspriceclass', 'emscheapesthours', 'emsexpensivehours', 'emscheapestblock'];
  for (const key of keys) if (typeof copy[key] === 'string') copy[key] = translate(copy[key],language);
  return copy;
}
module.exports = { translate, localizeDisplay, localizeTokens, isDutch, normalizeLanguage };
