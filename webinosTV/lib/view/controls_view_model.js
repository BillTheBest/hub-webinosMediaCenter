var Bacon = require('baconjs');

function ControlsViewModel(peer) {
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
