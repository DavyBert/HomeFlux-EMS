'use strict';

const Homey = require('homey');

class HomeFluxEmsDevice extends Homey.Device {
  async onInit() {
    // Keep already-paired EMS devices in sync with capabilities added in newer app versions.
    const addedCapabilities = [
      'ems_battery_command',
      'ems_charge_plan',
      'ems_ev_status',
      'ems_ev_override',
      'ems_hvac_status',
    ];
    for (const capability of addedCapabilities) {
      if (this.hasCapability(capability)) continue;
      await this.addCapability(capability).catch(err => this.error(`Could not add ${capability}`, err));
    }

    this.registerCapabilityListener('ems_control_mode', async value => {
      await this.homey.app.setForcedMode(String(value || 'auto'), 'device');
      return true;
    });

    this.homey.app.registerEmsDevice(this);
    await this.syncFromApp();
  }

  onDeleted() {
    this.homey.app.unregisterEmsDevice(this);
  }

  async syncFromApp(snapshot = null) {
    const values = snapshot || this.homey.app.getEmsDeviceSnapshot();
    const updates = [
      ['ems_control_mode', values.mode],
      ['ems_status', values.status],
      ['ems_tariff', values.tariff],
      ['ems_action', values.action],
      ['ems_battery_command', values.batteryCommand],
      ['ems_charge_plan', values.chargePlan],
      ['ems_ev_status', values.evStatus],
      ['ems_ev_override', values.evOverride],
      ['ems_hvac_status', values.hvacStatus],
      ['ems_override_active', Boolean(values.overrideActive)],
      ['alarm_ems_input', Boolean(values.inputAlarm)],
      ['alarm_ems_balance', Boolean(values.balanceAlarm)],
    ];

    for (const [capability, value] of updates) {
      if (!this.hasCapability(capability)) continue;
      if (Object.is(this.getCapabilityValue(capability), value)) continue;
      await this.setCapabilityValue(capability, value).catch(err => this.error(`Could not update ${capability}`, err));
    }
  }
}

module.exports = HomeFluxEmsDevice;
