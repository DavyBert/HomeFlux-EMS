'use strict';

const Homey = require('homey');

class HomeFluxEmsDriver extends Homey.Driver {
  async onPairListDevices() {
    return [{
      name: 'HomeFlux EMS',
      data: { id: 'homeflux-ems-controller' },
    }];
  }
}

module.exports = HomeFluxEmsDriver;
