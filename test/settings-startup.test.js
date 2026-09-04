'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'settings', 'index.html'), 'utf8');
const apiJs = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const composeJson = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose', 'app.json'), 'utf8'));
const localeNl = JSON.parse(fs.readFileSync(path.join(root, 'locales', 'nl.json'), 'utf8'));
const localeEn = JSON.parse(fs.readFileSync(path.join(root, 'locales', 'en.json'), 'utf8'));
const settingsTranslationEn = fs.readFileSync(path.join(root, 'settings', 'translations', 'en.json'), 'utf8');

for (const manifest of [appJson, composeJson]) {
  assert.equal(manifest.version, '0.4.14');
  assert.deepStrictEqual(manifest.api.getSettingsSnapshot, { method: 'GET', path: '/settings-snapshot' });
  assert.deepStrictEqual(manifest.api.simulatePlanning, { method: 'POST', path: '/planning/simulate' });
  assert.deepStrictEqual(manifest.api.getSavings, { method: 'GET', path: '/savings' });
}
assert.equal(localeNl.settings.subtitle, 'v0.4.14 — HomeFlux, jouw energie, anders geregeld');
assert.equal(localeEn.settings.subtitle, 'v0.4.14 — HomeFlux, your energy, managed differently');
assert(apiJs.includes('async getSettingsSnapshot({ homey })'));
assert(apiJs.includes('homey.app.getSettingsSnapshot()'));
assert(appJs.includes('getSettingsSnapshot()'));
assert(appJs.includes('return this.getSettings();'));
const importedEnergyCompose = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose', 'flow', 'actions', 'set_imported_energy_today.json'), 'utf8'));
const importedEnergyManifest = appJson.flow.actions.find(card => card.id === 'set_imported_energy_today');
assert.deepStrictEqual(importedEnergyManifest, { id: 'set_imported_energy_today', ...importedEnergyCompose }, 'generated imported-energy Flow card must match Compose');
assert(appJs.includes("getActionCard('set_imported_energy_today')"), 'imported energy today Flow listener missing');
assert(html.includes("await api('GET', '/settings-snapshot')"));
assert(html.includes('const snapshot = await loadSettingsSnapshot();'));
assert(html.includes('let savedSettingsBaseline = new Map();'), 'settings saved baseline missing');
assert(html.includes('function captureSettingsBaseline()'), 'settings baseline capture missing');
assert(html.includes('const value = currentSettingValue(id);'), 'changed-only settings reader missing');
assert(html.includes('if (settingsBaselineReady && settingValuesEqual(value, previous)) continue;'), 'unchanged settings must be skipped');
assert(html.includes("if (!settingsBaselineReady || !settingValuesEqual(rates, savedRatesBaseline))"), 'tariffs must be change-detected');
assert(html.includes("'Geen wijzigingen'"), 'no-change save feedback missing');
assert(html.includes('await loadUiTranslations();'), 'settings translation bundle must load before rendering');
assert(html.includes("'planning.forecastDecisionTomorrow'"), 'planning forecast text must use translation key');
assert(!html.includes('const UI_EXACT_EN = {'), 'large translation dictionary must not remain embedded in index.html');
assert(html.includes("if (name === 'help') ensureHelpCatalogRendered();"));
assert(!html.includes('\n  renderHelpCatalog();\n\n  function switchTab(name)'));

for (let month = 1; month <= 12; month += 1) {
  assert(html.includes(`id="peakReserveMonth${month}"`), `month ${month} checkbox missing`);
  assert(html.includes(`'peakReserveMonth${month}'`), `month ${month} missing from settings wiring`);
}
assert(!html.includes('id="peakReserveSeasonWinter"'));
assert(!html.includes('id="battery1MinChargeW"'), 'general individual battery minimum charge field must stay out of the UI');
assert(!html.includes('id="battery1MinDischargeW"'), 'general individual battery minimum discharge field must stay out of the UI');
assert(html.includes('id="battery1MaxChargeW"'), 'individual maximum charge field missing');
assert(html.includes('id="battery1MaxDischargeW"'), 'individual maximum discharge field missing');
assert(html.includes('id="splitCommandBattery1MinimumPowerW"'), 'Split Command minimum power field must remain available');
assert(html.includes('Actief tijdens maanden') || settingsTranslationEn.includes('Actief tijdens maanden'));
assert(appJs.includes('if (schema < 32)'));
assert(appJs.includes("settingsSchemaVersion', 49"));
assert(html.includes('id="slowControlIntervalSeconds"'), 'slow context interval setting missing');
for (const id of ['evPeakGuardBatteryAssistNormal','evPeakGuardBatteryAssistEmergency','ev2PeakGuardBatteryAssistNormal','ev2PeakGuardBatteryAssistEmergency','ev3PeakGuardBatteryAssistNormal','ev3PeakGuardBatteryAssistEmergency','ev4PeakGuardBatteryAssistNormal','ev4PeakGuardBatteryAssistEmergency']) {
  assert(html.includes(`id="${id}"`), `${id} EV Peak Guard battery-assist setting missing`);
  assert(html.includes(`'${id.replace(/^ev(?:[2-4])?/, '')}'`) || html.includes(`'PeakGuardBatteryAssistNormal'`) || html.includes(`'PeakGuardBatteryAssistEmergency'`), `${id} missing from EV settings wiring`);
}
assert(appJs.includes('if (schema < 49)'), 'v0.4.10 EV Peak Guard battery-assist migration missing');
assert(html.includes('id="planningMinIntervalMinutes"'), 'planning throttle setting missing');
assert(apiJs.includes('async refreshPlanning({ homey })'), 'forced planning refresh API missing');
assert(apiJs.includes('async simulatePlanning({ homey, body })'), 'planning simulation API handler missing');
assert(apiJs.includes('homey.app.simulatePlanning(body || {})'), 'planning simulation must route to the app');
assert(appJs.includes('simulatePlanning(body = {})'), 'pure planning simulator missing');
assert(appJs.includes('targetSocOverride: targetSoc'), 'simulation target override missing');

for (const id of ['sunnyMonthsMinSocEnabled','sunnyMonthsMinSoc']) {
  assert(html.includes(`id="${id}"`), `${id} setting missing`);
  assert(html.includes(`'${id}'`), `${id} missing from settings wiring`);
}
assert(appJs.includes("if (schema < 41)"), 'v0.3.80 settings migration missing');
assert(appJs.includes("this.setSetting('sunnyMonthsMinSocEnabled', false)"), 'sunny-month option must default off on upgrade');

for (const id of ['lowForecastAutoSunnyEnabled','lowForecastAutoSunnySoc','lowForecastAutoSunnyMinutes']) {
  assert(html.includes(`id="${id}"`), `${id} low-PV sunny-day setting missing`);
  assert(html.includes(`'${id}'`), `${id} missing from settings wiring`);
}
assert(appJs.includes("if (schema < 46)"), 'v0.4.0 low-PV sunny-day migration missing');
assert(appJs.includes("this.setSetting('lowForecastAutoSunnyEnabled', false)"), 'low-PV sunny-day promotion must default off on upgrade');
assert.equal(composeJson.homepage, 'https://github.com/DavyBert/HomeFlux-EMS');
assert.equal(composeJson.support, 'https://github.com/DavyBert/HomeFlux-EMS/issues');
assert.equal(appJson.homepage, composeJson.homepage);
assert.equal(appJson.support, composeJson.support);
assert.equal(composeJson.description.en, 'HomeFlux, your energy, managed differently');
assert.equal(composeJson.description.nl, 'HomeFlux, jouw energie, anders geregeld');
assert.deepEqual(appJson.description, composeJson.description);

assert(html.includes('id="peakReserveNightEnabled"'), 'night minimum setting missing');
assert(html.includes("'peakReserveNightEnabled'"), 'night minimum setting missing from settings wiring');
assert(appJs.includes("if (schema < 42)"), 'v0.3.84 settings migration missing');
assert(appJs.includes("if (schema < 43)"), 'v0.3.85 tariff-policy migration missing');
assert(appJs.includes("if (schema < 44)"), 'v0.3.86 weekday/weekend tariff-policy migration missing');
assert(appJs.includes("if (schema < 45)"), 'v0.3.88 absolute minimum-SoC migration missing');
assert(appJs.includes("this.setSetting('peakReserveNightEnabled', false)"), 'night minimum option must default off on upgrade');

assert(html.includes('id="peakReserveTargetSoc"'), 'selected-month absolute minimum SoC setting missing');
assert(!html.includes('id="peakReserveKwh"'), 'legacy selected-month kWh input must be removed from UI');
assert(!html.includes('id="peakReservePercent"'), 'legacy coupled reserve percentage input must be removed from UI');
assert(html.includes('Minimum-SoC voor dagplanning in geselecteerde maanden (%)'), 'day-planning wording missing');
assert(html.includes("Dit minimum geldt standaard niet 's nachts."), 'sunny-month night limitation must be explicit');
assert(html.includes('function validateNumericSettings()'), 'numeric save validation missing');
assert(html.includes('Number.isFinite(value)'), 'numeric save validation must reject NaN/Infinity');
assert(/id=\"lowForecastSelfConsumptionMinKwh\"(?![^>]*\bmax=)/.test(html), 'self-consumption PV threshold must not have a hard maximum');
assert(appJs.includes("this.setSetting('peakReserveTargetSoc'"), 'legacy reserve migration to absolute SoC missing');
assert(!html.includes('id="manualChargeW"'), 'legacy manual charge watt limit must no longer be configurable');
assert(html.includes('data-rate-k=\"weekdayChargeMode\"'), 'weekday tariff charging selector missing');
assert(html.includes('data-rate-k=\"weekendChargeMode\"'), 'weekend tariff charging selector missing');
assert(html.includes("['never',uiLanguage==='nl'?'Niet gebruiken':'Do not use']"), 'tariff charging selector must offer do-not-use');
assert(html.includes("['always',uiLanguage==='nl'?'Altijd':'Always']"), 'tariff charging selector must offer always');
assert(html.includes('data-rate-k=\"avoidGridImport\"'), 'avoid-grid-import tariff option missing');
assert(html.includes('EV-laden op werkelijk PV-overschot blijft beschikbaar'), 'avoid-grid conflict explanation missing');

for (const id of ['nightTargetTime','solarTargetTime']) {
  assert(html.includes(`id=\"${id}\"`) || html.includes(`id="${id}"`), `missing planning target setting ${id}`);
}

for (const id of ['panel-planning-simulation','planningSimulationBatterySoc','planningSimulationTargetSoc','planningSimulationPvTodayKwh','planningSimulationPvLiveW','planningSimulationTime','runPlanningSimulation','planningSimulationResult']) {
  assert(html.includes(`id="${id}"`), `${id} simulation UI element missing`);
}
assert(html.includes('data-tab="planning-simulation"'), 'planning simulation tab missing');
assert(html.includes("await api('POST', '/planning/simulate'"), 'planning simulation endpoint call missing');
assert(html.includes("activeMainTab === 'planning-simulation' && name !== 'planning-simulation'"), 'simulation results must be discarded when leaving the tab');
const clearSimulationBlock = html.slice(html.indexOf('function clearPlanningSimulationResult()'), html.indexOf('function formatSimulationCommand'));
assert(clearSimulationBlock.includes("planningSimulationResult"), 'simulation result clearing function missing');
assert(!clearSimulationBlock.includes("planningSimulationBatterySoc"), 'simulation input values must survive tab switches');

// v0.3.81: production Planning and Planning simulation must render the same
// complete charge-to-peak cycle instead of maintaining a simulator-only view.
assert(html.includes('function appendPlanningWindowCard(host, row, plan, options = {})'), 'shared planning-window renderer missing');
assert(html.includes('function appendPlanningPeakCard(host, plan)'), 'target peak renderer missing');
const productionPlanningRender = html.slice(html.indexOf('function renderPlanning(plan)'), html.indexOf('function refreshPlanning(force = false)'));
const simulationPlanningRender = html.slice(html.indexOf('function renderPlanningSimulation(simulation)'), html.indexOf('async function runPlanningSimulation()'));
for (const block of [productionPlanningRender, simulationPlanningRender]) {
  assert(block.includes('appendPlanningPeakCard(host, plan)'), 'complete planning cycle must show the target peak');
  assert(block.includes('appendPlanningWindowCard(host, row, plan'), 'complete planning cycle must use the shared window renderer');
}
assert(html.includes("windowState"), 'past/active/future planning-window state missing');
assert(html.includes("availableMinutes"), 'remaining production planning time must be shown');


assert(html.includes('id="slowControlIntervalSeconds"'), 'slow context interval setting missing');
assert(html.includes('id="planningMinIntervalMinutes"'), 'planning block setting missing');
assert.deepStrictEqual(appJson.api.refreshPlanning, { method: 'POST', path: '/planning/refresh' });
assert(apiJs.includes('async refreshPlanning({ homey })'));
assert(appJs.includes('evaluateFastNow(forceStatus = false)'));
assert(appJs.includes('evaluateContextNow(forceStatus = false)'));

for (const id of ['evCount','hvacCount','boilerCount','boilerEnabled','boilerColdResetTime','boilerTariffMinBatterySoc','boilerTariffStopBatterySoc','priorityEvaluationMinutes','flexibleLoadPriorityOrder']) {
  assert(html.includes(`id="${id}"`), `${id} setting missing`);
}
for (let instance = 2; instance <= 4; instance += 1) {
  assert(html.includes(`id="ev${instance}Enabled"`), `EV ${instance} settings missing`);
  assert(html.includes(`id="hvac${instance}Enabled"`), `HVAC ${instance} settings missing`);
}

for (let instance = 1; instance <= 4; instance += 1) {
  const stem = instance === 1 ? 'hvac' : `hvac${instance}`;
  assert(html.includes(`id="${stem}EnergyDeviationC"`), `HVAC ${instance} energy deviation setting missing`);
}
assert(html.includes('Verwarmingstemperatuur (°C)'), 'heating target label missing');
assert(html.includes('Koelingstemperatuur (°C)'), 'cooling target label missing');
assert(html.includes('renderPriorityList()'));
assert(html.includes('test-ev-output'));
assert(html.includes('test-hvac-output'));

for (const cardId of ['ev1_charge_current_updated','ev1_charging_allowed_updated','ev1_charge_mode_updated','request_ev1_soc_needed','hvac1_power_updated','hvac1_mode_updated','hvac1_setpoint_updated','hvac1_fan_updated']) {
  assert(appJson.flow.triggers.some(card => card.id === cardId), `${cardId} output card missing`);
}
for (const oldCardId of ['ev_charge_current_updated','ev_charging_allowed_updated','ev_charge_mode_updated','request_ev_soc_needed','hvac_power_updated','hvac_mode_updated','hvac_setpoint_updated','hvac_fan_updated']) {
  assert(!appJson.flow.triggers.some(card => card.id === oldCardId), `${oldCardId} legacy output card should be removed`);
}
assert(html.includes('<option value="0">0</option><option value="1">1</option>'), 'zero-count module option missing');

for (const oldCardId of ['set_hvac_room_temperature','set_hvac_setpoint','set_hvac_fan_speed','set_hvac_mode','set_hvac_automatic_control']) {
  assert(!appJson.flow.actions.some(item => item.id === oldCardId), `${oldCardId} legacy input card must be removed`);
  assert(!fs.existsSync(path.join(root, '.homeycompose', 'flow', 'actions', `${oldCardId}.json`)), `${oldCardId} legacy Compose source must be removed`);
}
const outdoorCard = appJson.flow.actions.find(item => item.id === 'set_hvac_outdoor_temperature');
assert(outdoorCard && outdoorCard.deprecated !== true, 'shared HVAC outdoor temperature must remain visible');
assert(appJs.includes('currentRaw === null || currentRaw === undefined ? NaN : Number(currentRaw)'), 'HVAC device status must not coerce null setpoint to zero');
assert(appJs.includes('this.lastPublishedHvacSetpoint !== null && this.lastPublishedHvacSetpoint !== undefined'), 'HVAC live status must preserve null unpublished setpoint');
assert(html.includes("uiLanguage==='nl'?'Actuele modus':'Current mode'"), 'HVAC live status must label the received/current mode explicitly');
assert(html.includes("uiLanguage==='nl'?'Actueel setpoint':'Current setpoint'"), 'HVAC live status must label the received/current setpoint explicitly');
assert(html.includes("uiLanguage==='nl'?'Laatste HomeFlux-uitgang':'Last HomeFlux output'"), 'HVAC live status must separate the last HomeFlux output from received HVAC values');

console.log('settings startup tests passed');
