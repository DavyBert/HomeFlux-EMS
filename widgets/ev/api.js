'use strict';
module.exports = {
  async getDashboard({ homey, query }) {
    return homey.app.getEvDashboard(['day','week','month','all'].includes(query?.period) ? query.period : 'day');
  },
  async setSchedule({ homey, body }) { return homey.app.setEvDashboard(body || {}); },
};
