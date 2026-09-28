'use strict';

module.exports = {
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

  async getPlanning({ homey, query }) {
    return String(query?.force || '') === 'true'
      ? homey.app.refreshChargePlanning()
      : homey.app.getPlanningStatus();
  },

  async getSavings({ homey, query }) {
    return homey.app.getSavingsStatus({ period: String(query?.period || 'day') });
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

  async startChargeTest({ homey }) {
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
  if (name === 'getSettingsSnapshot' || name === 'getDiagnostics' || name === 'resetDiagnostics') continue;
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
