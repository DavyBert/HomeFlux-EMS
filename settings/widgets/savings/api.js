'use strict';

module.exports = {
  async getSavings({ homey, query }) {
    const requested = String(query?.period || 'day');
    const period = ['day', 'month', 'year', 'this_month', 'previous_month', 'rolling'].includes(requested) ? requested : 'day';
    return homey.app.localizeDisplay(homey.app.getSavingsStatus(period === 'rolling' ? { period, days: query?.days } : { period: period === 'this_month' ? 'month' : period }));
  },
};
