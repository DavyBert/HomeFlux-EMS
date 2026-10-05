'use strict';
const DEFAULT_NAMES = Object.freeze({homey:'Homey Energy',external:'External Price 1',external2:'External Price 2'});
const NAME_SETTINGS = Object.freeze({external:'externalPrice1Name',external2:'externalPrice2Name'});
function sourceName(source, settings = {}) {
  const value = settings[NAME_SETTINGS[source]];
  return (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,80) : '') || DEFAULT_NAMES[source] || 'None';
}
module.exports = { DEFAULT_NAMES, NAME_SETTINGS, sourceName };
