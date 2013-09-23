var _ = require('underscore');

var Bacon = require('baconjs');

var ControlsViewModel = require('./controls_view_model.js');

var gotoPageById = require('./pagetransition.js');

function RendererViewModel(manager, input) {
  input = input.filter(function () {
    return $('.pt-page-current').attr('id') === 'renderer' && !$('.menu').is(":visible");;
  });

  this.input = function () {
    return input;
  };

  var device = manager.toProperty().map(function (devices) {
    var local = _.find(devices, function (device) {
      return device.isLocal();
    });

    if (typeof local === 'undefined' ) return '<no-device>';
    return local;
  });

  var peer = device.map(function (local) {
    if (local === '<no-device>' || !local.peers().length) return '<no-peer>';
    return {
      device: local,
      service: local.peers()[0],
      type: 'peer'
    };
  });

  var controls = new ControlsViewModel(peer);
  this.controls = function () {
    return controls;
  };

  var player = 'app';

  var events = peer.flatMapLatest(function (peer) {
    if (peer === '<no-peer>') return Bacon.never();
    return peer.service.events();
  }).map(function (event) {
    if (event.isPlay()) {
      if (event.item().link.indexOf('#live') !== -1) {
        player = 'api';
      } else {
        player = 'app';
      }
    }

    return {player: player, event: event};
  });

  this.events = function () {
    return events.filter(function (event) {
      return event.player === 'app';
    }).map('.event').doAction(function (event) {
      if (event.isPrepend() && event.items().length) {
        gotoPageById('#renderer');
        window.closeMainmenu();
      }
    });
  };

  device.sampledBy(events.filter(function (event) {
    return event.player === 'api';
  }).map('.event'), function (device, event) {
    return {device: device, event: event};
  }).filter(function (operation) {
    return operation.device !== '<no-device>' && operation.device.noupnp().length
  }).onValue(function (operation) {
    if (operation.event.isPlay()) {
      var link = operation.event.item().link;
      var index = link.indexOf('#');
      if (index !== -1) link = link.substr(0, index);

      var service = operation.device.noupnp()[0];
      service.play(link).then(function () {
        started.push();

        service.events().onValue(function (event) {
          if (event.isPlay()) {
            started.push();
          } else if (event.isPause()) {
            paused.push();
          } else if (event.isStop()) {
            stopped.push();
            return Bacon.noMore;
          } else if (event.isEnd()) {
            ended.push();
            return Bacon.noMore;
          }
        });
      });
    } else if (operation.event.isPause()) {
      service.playPause();
    } else if (operation.event.isResume()) {
      service.playPause();
    } else if (operation.event.isStop()) {
      service.stop();
    }
  });

  var updates = new Bacon.Bus();

  peer.sampledBy(updates, function (peer, update) {
    return {peer: peer, update: update};
  }).filter(function (operation) {
    return operation.peer !== '<no-peer>';
  }).onValue(function (operation) {
    operation.peer.service.apply().push(operation.update);
  });

  var started = new Bacon.Bus();
  updates.plug(started.map({type: 'playback:started'}));

  this.started = function () {
    return started;
  };

  var paused = new Bacon.Bus();
  updates.plug(paused.map({type: 'playback:paused'}));

  this.paused = function () {
    return paused;
  };

  var stopped = new Bacon.Bus();
  updates.plug(stopped.map({type: 'playback:stopped'}));

  this.stopped = function () {
    return stopped;
  };

  var ended = new Bacon.Bus();
  updates.plug(ended.map({type: 'playback:ended'}));

  this.ended = function () {
    return ended;
  };

  var state = new Bacon.Bus();
  updates.plug(state.map(function (state) {
    return {type: 'playback:state', content: {relative: state.relative}};
  }));

  this.state = function () {
    return state;
  };
}

module.exports = RendererViewModel;
