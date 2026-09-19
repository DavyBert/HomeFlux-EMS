'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class App {} };
  if (request === 'homey-api') return { HomeyAPI: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const HomeFluxEmsApp = require('../app');
Module._load = originalLoad;

function modeOnlyApp({ mode = 'smart', smartA = 6, standardA = 16, gridAllowanceW = 20000, gridPowerW = 14000, detectedEvLoadW = 13000 } = {}) {
  const app = Object.create(HomeFluxEmsApp.prototype);
  const now = Date.now();
  const desiredA = mode === 'standard' ? standardA : smartA;
  app.state = { gridPowerW, pvPowerW: 0, lastTotalCommandW: 0, evConnected: true, evChargeCurrentA: 0 };
  app.inputSeen = { grid: true, pv: true, ev: { connected: true, chargeCurrent: false } };
  app.inputUpdatedAt = { grid: now, pv: now, ev: { connected: now, chargeCurrent: 0 } };
  app.lastPublishedEvAllowed = true;
  app.lastPublishedEvChargeMode = mode;
  app.lastPublishedEvCurrentA = 0;
  app.latestEvDecision = {
    connected: true,
    intentionalGridImport: true,
    portfolioGridImportTargetW: gridAllowanceW,
    desiredCurrentA: desiredA,
    desiredPowerW: desiredA * 3 * 230,
    requestedChargeMode: mode,
    effectiveChargeMode: mode,
    allowed: true,
  };
  app.extraEvInstances = [];
  app.evSessionDetection = {
    houseHistory: [],
    portfolioBaselineW: 1000,
    baselineCapturedAt: now - 60000,
    detectedEvLoadW,
    physicalSiteLoadW: detectedEvLoadW + 1000,
    noLoadSince: 0,
    gridReleaseBlocked: false,
    gridReleaseBlockedAt: 0,
    sessions: [{ state: 'charging', endedLatched: false }],
  };
  const settings = {
    evCount: 1,
    evEnabled: true,
    evControlType: 'mode',
    evPhases: 3,
    evModeSmartCurrentA: smartA,
    evModeStandardCurrentA: standardA,
  };
  app.getSettings = () => settings;
  return { app, settings, now };
}

// Smart 6 A, 3-phase: household loads may increase P1/detected load, but the
// intentional EV grid target can never exceed 6 * 3 * 230 = 4140 W.
{
  const { app, settings, now } = modeOnlyApp({ mode: 'smart', gridAllowanceW: 12000, gridPowerW: 14000, detectedEvLoadW: 13000 });
  const status = app.getEvGridImportControlStatus(settings, now);
  assert.equal(status.modeConfiguredPowerCeilingW, 4140);
  assert.equal(status.activeTargetW, 4140);

  app.state.gridPowerW = 18000; // e.g. oven/microwave/heat pump added on top.
  app.evSessionDetection.detectedEvLoadW = 17000;
  const withHouseLoad = app.getEvGridImportControlStatus(settings, now + 1000);
  assert.equal(withHouseLoad.activeTargetW, 4140);
}

// Standard 16 A, 3-phase is 11040 W, but the configured EV grid allowance
// remains an independent lower ceiling.
{
  const { app, settings, now } = modeOnlyApp({ mode: 'standard', gridAllowanceW: 5000, gridPowerW: 14000, detectedEvLoadW: 13000 });
  const status = app.getEvGridImportControlStatus(settings, now);
  assert.equal(status.modeConfiguredPowerCeilingW, 11040);
  assert.equal(status.activeTargetW, 5000);
}

// The Flow card is renamed only. Its stable ID and argument contract stay the same.
{
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
  const card = manifest.flow.actions.find(action => action.id === 'set_external_ems_setpoint');
  assert.ok(card);
  assert.equal(card.id, 'set_external_ems_setpoint');
  assert.equal(card.title.en, 'Report external EMS battery power');
  assert.equal(card.title.nl, 'Rapporteer batterijvermogen externe EMS');
  assert.equal(card.args.length, 1);
  assert.equal(card.args[0].name, 'power');
  assert.equal(card.args[0].type, 'number');
}

console.log('0.7.15 regressions OK');
