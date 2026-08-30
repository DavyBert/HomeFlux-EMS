'use strict';

module.exports = {
  async getStatus({ homey }) {
    return homey.app.getPublicStatus();
  },

  async getSettingsSnapshot({ homey }) {
    return homey.app.getSettingsSnapshot();
  },

  async getPlanning({ homey, query }) {
    return homey.app.getPlanningStatus({ force: String(query?.force || '') === 'true' });
  },

  async refreshPlanning({ homey }) {
    return homey.app.getPlanningStatus({ force: true });
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

  async confirmChargeTest({ homey }) {
    return homey.app.confirmChargeTest();
  },

  async testEvOutput({ homey, body }) {
    return homey.app.testEvOutput(body || {});
  },

  async testHvacOutput({ homey, body }) {
    return homey.app.testHvacOutput(body || {});
  },
};
