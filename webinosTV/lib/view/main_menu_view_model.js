var _ = require('underscore');

var bjq = require('bacon.jquery');

function MainMenuViewModel(manager, input) {
  input = input.filter(function () {
    return $('.pt-page-current').attr('id') === 'startscreen' || $('.menu').is(':visible');
  });

  this.input = function () {
    return input;
  };

  var type = bjq.Model('remote'); // remote, input, payment
  this.type = function () {
    return type;
  };

  var devices = type.combine(manager.toProperty(), function (type, devices) {
    return _.chain(devices).filter(function (device) {
      switch (type) {
        case 'remote':
          return device.isTarget() && !device.isLocal();
        case 'input':
          return false; // TODO: Define 'input' device.
        case 'payment':
          return device.isPayment();
        default:
          return false;
      }
    }).map(function (device) {
      switch (type) {
        case 'remote':
          return _.map(device.peers(), function (service) {
            return {device: device, service: service, type: 'peer'};
          });
        case 'input':
          return [];
        case 'payment':
          return [{device: device, service: device.payment(), type: 'payment'}];
        default:
          return [];
      }
    }).flatten().value();
  });

  this.devices = function () {
    return devices;
  };

  var selectedDevice = bjq.Model('<no-device>');
  this.selectedDevice = function () {
    return selectedDevice;
  };
}

module.exports = MainMenuViewModel;
