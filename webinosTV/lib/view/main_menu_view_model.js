var _ = require('underscore');

var bjq = require('bacon.jquery');

function MainMenuViewModel(manager, input) {
  input = input.filter(function () {
    return $('.pt-page-current').attr('id') === 'startscreen' || $('.menu').is(':visible');
  });

  this.input = function () {
    return input;
  };

  var targets = manager.toProperty().map(function (devices) {
    return _.chain(devices).filter(function (device) {
      return device.isTarget() && !device.isLocal();
    }).map(function (device) {
      return _.map(device.peers(), function (service) {
        return {device: device, service: service, type: 'peer'};
      });
    }).flatten().value();
  });

  this.targets = function () {
    return targets;
  };

  var selectedTarget = bjq.Model('<no-target>');
  this.selectedTarget = function () {
    return selectedTarget;
  };
}

module.exports = MainMenuViewModel;
