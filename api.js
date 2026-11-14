'use strict';

const injection=require('./lib/active-injection');
module.exports = {
  async startInjection({homey}) {return injection.start(homey.app,'manual');},
  async stopInjection({homey}) {return injection.stop(homey.app);},
  async approveChargeTestWithoutTest({homey,body}) {return homey.app.approveChargeTestWithoutTest(body||{});},
  async startBatteryPhaseDetection({homey,body}) { return require('./lib/phase-detection').start(homey.app,Number(body.instance)-1); },
  async stopBatteryPhaseDetection({homey}) { return require('./lib/phase-detection').stop(homey.app); },
  async recheckHvac({ homey, body }) { return homey.app.recheckHvac(body); },
  async getStatus({ homey }) {
    return homey.app.getPublicStatus();
  },

  async getHybridStatus({ homey }) {
    return homey.app.getHybridEmsStatus();
  },

  async getSettingsSnapshot({ homey }) {
    return homey.app.getSettingsSnapshot();
  },

  async getDiagnostics({ homey }) {
    return homey.app.getDiagnosticsReport();
  },

  async resetDiagnostics({ homey }) {
    return homey.app.resetDiagnosticsReport();
  },

  async getP1Trace({ homey }) { return homey.app.getP1TraceReport(); },
  async startP1Trace({ homey }) { return homey.app.startP1Trace(); },
  async stopP1Trace({ homey }) { return homey.app.stopP1Trace(); },
  async clearP1Trace({ homey }) { return homey.app.clearP1Trace(); },
  async getInputMonitor({ homey }) { return homey.app.getInputMonitorReport(); },
  async startInputMonitor({ homey }) { return homey.app.startInputMonitor(); },
  async stopInputMonitor({ homey }) { return homey.app.stopInputMonitor(); },
  async clearInputMonitor({ homey }) { return homey.app.clearInputMonitor(); },

  async getPlanning({ homey, query }) {
    return String(query?.force || '') === 'true'
      ? homey.app.refreshChargePlanning()
      : homey.app.getPlanningStatus();
  },

  async getSavings({ homey, query }) {
    return homey.app.getSavingsStatus({ period: String(query?.period || 'day'), days: query?.days, selected: String(query?.selected || '') });
  },

  async getSavingsHistory({ homey }) {
    return homey.app.getSavingsHistoryInfo();
  },

  async getSavingsExport({ homey }) {
    return { csv: homey.app.getSavingsCsv() };
  },

  async getAutoTune({ homey }) {
    return homey.app.getAutoTuneStatus();
  },

  async refreshAutoTune({ homey }) {
    return homey.app.getAutoTuneStatus({ force: true });
  },

  async setAutoTunePermission({ homey, body }) {
    return homey.app.setAutoTunePermission(body || {});
  },

  async setAutoTuneLimits({ homey, body }) {
    return homey.app.setAutoTuneLimits(body || {});
  },

  async applyAutoTuneRecommendation({ homey, body }) {
    return homey.app.applyAutoTuneRecommendationOnce(body || {});
  },

  async setAutoTuneIgnored({ homey, body }) {
    return homey.app.setAutoTuneIgnored(body || {});
  },

  async refreshPlanning({ homey }) {
    return homey.app.refreshChargePlanning();
  },

  async simulatePlanning({ homey, body }) {
    return homey.app.simulatePlanning(body || {});
  },

  async setInput({ homey, body }) {
    return homey.app.setInput(body || {});
  },

  async refreshHomeyEnergy({ homey }) {
    return homey.app.refreshHomeyEnergyPrices(true);
  },

  async startBatteryResponseTest({ homey }) { return homey.app.startBatteryResponseTest(); },
  async stopBatteryResponseTest({ homey }) { return homey.app.stopBatteryResponseTest(); },

  async startChargeTest({ homey }) {
    if (homey.app.batteryResponseTest?.running) throw new Error('Stop eerst de reactietest.');
    return homey.app.startChargeTest();
  },

  async confirmChargeTest({ homey, body }) {
    return homey.app.confirmChargeTest(body || {});
  },

  async testEvOutput({ homey, body }) {
    return homey.app.testEvOutput(body || {});
  },

  async testHvacOutput({ homey, body }) {
    return homey.app.testHvacOutput(body || {});
  },
};

// Translate only presentation fields at the API boundary. Stored settings and
// internal controller decisions retain their original values and identifiers.
for (const [name, operation] of Object.entries(module.exports)) {
  if (['getP1Trace', 'startP1Trace', 'stopP1Trace', 'clearP1Trace', 'getInputMonitor', 'startInputMonitor', 'stopInputMonitor', 'clearInputMonitor'].includes(name) || name === 'getSettingsSnapshot' || name === 'getDiagnostics' || name === 'resetDiagnostics') continue;
  module.exports[name] = async function localizedOperation(args) {
    try {
      const result = await operation(args);
      return args.homey.app.localizeDisplay(result);
    } catch (error) {
      if (error && typeof error.message === 'string') error.message = args.homey.app.translateDisplay(error.message);
      throw error;
    }
  };
}
