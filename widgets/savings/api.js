'use strict';

module.exports = {
  async getSavings({ homey, query }) {
    const requested = String(query?.period || 'day');
    const period = ['day', 'month', 'year'].includes(requested) ? requested : 'day';
    return homey.app.getSavingsStatus({ period });
  },
};
