var _ = require('underscore');

var bjq = require('bacon.jquery');

function MainMenuViewModel(manager, input) {
  input = input.filter(function () {
    return $('.pt-page-current').attr('id') === 'startscreen' || $('.menu').is(':visible');
  });

  this.input = function () {
    return input;
  };

  var type = bjq.Model('remote'); // remote, input, payment, push, pull
  this.type = function () {
    return type;
  };

  var title = type.map(function (type) {
    switch (type) {
      case 'remote':
      case 'push':
        return 'Select a target';
      case 'input':
      case 'pull':
        return 'Select a source';
      case 'payment':
        return 'Select a wallet';
      default:
        return 'Nothing here';
    }
  });

  this.title = function () {
    return title;
  };

  var devices = type.combine(manager.toProperty(), function (type, devices) {
    return _.chain(devices).filter(function (device) {
      switch (type) {
        case 'remote':
          return !device.isLocal() && device.isTarget();
        case 'input':
          return false; // TODO: Define 'input' device.
        case 'payment':
          return device.isPayment();
        case 'push':
        case 'pull':
          return !device.isLocal() && device.peers().length > 0;
        default:
          return false;
      }
    }).map(function (device) {
      switch (type) {
        case 'remote':
        case 'push':
        case 'pull':
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
