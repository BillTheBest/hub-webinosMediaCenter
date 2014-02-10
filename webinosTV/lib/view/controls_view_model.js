var Bacon = require('baconjs');

var payment = require('../util/payment.coffee');

function ControlsViewModel(manager, peer, mainMenuViewModel) {
  this.peer = function () {
    return peer;
  };

  var state = peer.flatMapLatest(function (peer) {
    if (peer === '<no-peer>') return Bacon.once('<no-state>');
    return peer.service.state();
  }).toProperty('<no-state>');

  this.state = function () {
    return state;
  };

  var encrypted = state.map(function (state) {
    if (state === '<no-state>') return false;
    if(typeof state.index === "undefined" || typeof state.queue === "undefined") return false;
    return state.playback.current && state.index < state.queue.length && payment.encrypted(state.queue[state.index].item.title);
  });

  this.encrypted = function () {
    return encrypted;
  };

  var commands = new Bacon.Bus();

  Bacon.combineTemplate({
    peer: peer, state: state
  }).sampledBy(commands, function (current, command) {
    return {peer: current.peer, state: current.state, command: command};
  }).filter(function (operation) {
    return operation.peer !== '<no-peer>' &&
          (operation.peer.type === 'peer' ||
            (operation.peer.type === 'upnp' &&
             operation.command.type === 'playOrPause')) &&
           operation.state !== '<no-state>';
  }).onValue(function (operation) {
    switch (operation.command.type) {
      case 'playOrPause':
        if (operation.peer.type === 'upnp') {
          operation.peer.service.playPause();
        } else if (operation.peer.type === 'peer') {
          operation.peer.service.playOrPause();
        }
        break;
      case 'previous':
        operation.peer.service.previous();
        break;
      case 'next':
        operation.peer.service.next();
        break;
      case 'seek':
        operation.peer.service.seek(operation.command.content.relative);
        break;
      case 'rewind':
        var relative = Math.max(0, operation.state.playback.relative - operation.command.content.subtract);
        operation.peer.service.seek(relative);
        break;
      case 'forward':
        var relative = Math.min(1, operation.state.playback.relative + operation.command.content.add);
        operation.peer.service.seek(relative);
        break;
    }
  });

  var pay = new Bacon.Bus();
  Bacon.combineTemplate({
    peer: peer, state: state
  }).sampledBy(pay).filter(function (operation) {
    return operation.peer !== '<no-peer>' && operation.peer.type === 'peer' && operation.state !== '<no-state>' && operation.state.playback.current;
  }).doAction(function (operation) {
    if (operation.state.playback.playing) {
      operation.peer.service.playOrPause();
    }
  }).onValue(function () {
    mainMenuViewModel.selectedDevice().set('<no-device>');
    mainMenuViewModel.type().set('payment');

    window.openSelectDevice();
  });

  this.pay = function () {
    return pay;
  };

  var mainMenu = Bacon.combineTemplate({
    type: mainMenuViewModel.type(),
    selectedDevice: mainMenuViewModel.selectedDevice()
  }).filter(function (mainMenu) {
    return mainMenu.type === 'payment' && mainMenu.selectedDevice !== '<no-device>';
  }).doAction(function (mainMenu) {
    window.closeSelectDevice();
  });

  var service = manager.toProperty().sampledBy(mainMenu, function (devices, mainMenu) {
    return devices[mainMenu.selectedDevice.device].services()[mainMenu.selectedDevice.service];
  });

  Bacon.combineTemplate({
    peer: peer, state: state
  }).sampledBy(service, function (current, service) {
    return {peer: current.peer, state: current.state, service: service};
  }).filter(function (operation) {
    return operation.peer !== '<no-peer>' && operation.peer.type === 'peer' && operation.state !== '<no-state>' && operation.state.playback.current;
  }).onValue(function (operation) {
    var item = operation.state.queue[operation.state.index];
    operation.service.pay(null, {
      description: payment.name(item.item.title),
      currency: 'EUR',
      itemPrice: payment.price(item.item.title)
    }, 0, 0, function (challengeType, challenge) {}).then(function (proofOfPurchase) {
      operation.peer.service.decrypted(item.decryptedLink);
    });
  });

  var playOrPause = new Bacon.Bus();
  commands.plug(playOrPause.map({type: 'playOrPause'}));

  this.playOrPause = function () {
    return playOrPause;
  };

  var previous = new Bacon.Bus();
  commands.plug(previous.map({type: 'previous'}));

  this.previous = function () {
    return previous;
  };

  var next = new Bacon.Bus();
  commands.plug(next.map({type: 'next'}));

  this.next = function () {
    return next;
  };

  var seek = new Bacon.Bus();
  commands.plug(seek.map(function (relative) {
    return {type: 'seek', content: {relative: relative}};
  }));

  this.seek = function () {
    return seek;
  };

  var rewind = new Bacon.Bus();
  commands.plug(rewind.map(function (subtract) {
    return {type: 'rewind', content: {subtract: subtract || 0.1}};
  }));

  this.rewind = function () {
    return rewind;
  };

  var forward = new Bacon.Bus();
  commands.plug(forward.map(function (add) {
    return {type: 'forward', content: {add: add || 0.1}};
  }));

  this.forward = function () {
    return forward;
  };

  var remove = new Bacon.Bus();
  this.remove = function () {
    return remove;
  };
}

module.exports = ControlsViewModel;
