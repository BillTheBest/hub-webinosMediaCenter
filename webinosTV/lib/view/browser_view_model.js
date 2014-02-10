var _ = require('underscore');

var Promise = require('promise');

var Bacon = require('baconjs');
var bjq = require('bacon.jquery');

var payment = require('../util/payment.coffee');

var ControlsViewModel = require('./controls_view_model.js');

function BrowserViewModel(manager, input, mainMenuViewModel) {
  input = input.filter(function () {
    return $('.pt-page-current').attr('id') === 'browser' && !$('.menu').is(":visible");
  });

  this.input = function () {
    return input;
  };

  var sources = manager.toProperty().map(function (devices) {
    return _.filter(devices, function (device) {
      return device.isSource();
    });
  });

  this.sources = function () {
    return sources;
  };

  var selectedSources = bjq.Model([]);
  this.selectedSources = function () {
    return selectedSources;
  };

  var categories = Bacon.constant([
    {id: 'movies', type: 'Video', title: 'Movies', image: 'images/movie.svg'},
    {id: 'music', type: 'Audio', title: 'Music', image: 'images/music.svg'},
    {id: 'images', type: 'Image', title: 'Images', image: 'images/image.svg'},
    {id: 'channels', type: 'Channel', title: 'Channels', image: 'images/tv_channels.svg'}
  ]);

  this.categories = function () {
    return categories;
  };

  var selectedCategories = bjq.Model([]);
  this.selectedCategories = function () {
    return selectedCategories;
  };

  var search = bjq.Model('');
  this.search = function () {
    return search;
  };

  var content = Bacon.combineTemplate({
    sources: sources, selectedSources: selectedSources,
    categories: categories, selectedCategories: selectedCategories,
    search: search
  }).map(function (state) {
    var types = _.map(state.selectedCategories, function (id) {
      return id ? _.findWhere(state.categories, {id: id}).type : id;
    });

    return _.chain(state.sources).filter(function (source) {
      return !state.selectedSources.length || _.contains(state.selectedSources, source.address());
    }).map(function (source) {
      return _.chain(source.content()).values().flatten().filter(function (item) {
        return !types.length || _.find(types, function(type) {
          return item.type.toLowerCase().indexOf(type.toLowerCase()) != -1;
        });
      }).filter(function (item) {
        return !state.search.length || item.title.toLowerCase().indexOf(state.search.toLowerCase()) != -1;
      }).filter(function (item) {
        return !payment.decrypted(item.title);
      }).value();
    }).flatten().value();
  });

  this.content = function () {
    return content;
  };

  var selectedContent = bjq.Model([]);
  this.selectedContent = function () {
    return selectedContent;
  };

  var targets = manager.toProperty().map(function (devices) {
    return _.chain(devices).filter(function (device) {
      return device.isTarget();
    }).map(function (device) {
      return (device.isLocal() ? _.map(device.upnp(), function (service) {
        return {device: device, service: service, type: 'upnp'};
      }) : []).concat(_.map(device.peers(), function (service) {
        return {device: device, service: service, type: 'peer'};
      }));
    }).flatten().value();
  });

  this.targets = function () {
    return targets;
  };

  var selectedTargets = bjq.Model([]);
  this.selectedTargets = function () {
    return selectedTargets;
  };

  var queuing = new Bacon.Bus();

  Bacon.combineTemplate({
    devices: manager.toProperty(),
    selectedContent: selectedContent,
    selectedTargets: selectedTargets
  }).sampledBy(queuing, function (current, command) {
    return {
      devices: current.devices,
      selectedContent: current.selectedContent,
      selectedTargets: current.selectedTargets,
      command: command
    };
  }).filter(function (operation) {
    return operation.selectedContent.length && operation.selectedTargets.length;
  }).doAction(function () {
    selectedContent.set([]);
  }).onValue(function (operation) {
    var items = _.map(operation.selectedContent, function (selectedItem) {
      var device = operation.devices[selectedItem.device];
      var item   = _.chain(device.content()).values().flatten().findWhere({
        id: selectedItem.item.id,
        title: selectedItem.item.title
      }).value();

      var decryptedItem = undefined;
      if (payment.encrypted(item.title)) {
        decryptedItem = _.chain(device.content()).values().flatten().findWhere({
          // id: ???,
          title: payment.decrypt(selectedItem.item.title)
        }).value();
      }

      return _.extend(item, {device: device, service: device.services()[selectedItem.service], decryptedItem: decryptedItem});
    });

    var targets = _.map(operation.selectedTargets, function (selectedTarget) {
      var device = operation.devices[selectedTarget.device];
      return {
        device: device,
        service: device.services()[selectedTarget.service],
        type: selectedTarget.type
      };
    });

    var promises = _.map(items, function (item) {
      if (item.type === 'Channel') {
        return Promise.fulfill({item: item, link: item.link})
      }

      var link = item.service.getLink({
        folderId: item.id,
        fileName: item.title
      });

      var decryptedLink = Promise.fulfill(undefined);
      if (typeof item.decryptedItem !== 'undefined') {
        decryptedLink = item.service.getLink({
          folderId: item.decryptedItem.id,
          fileName: item.decryptedItem.title
        });
      }

      return Promise.every(link, decryptedLink).then(function (links) {
        return {item: item, link: links[0], decryptedLink: links[1]};
      });
    });

    Promise.every.apply(Promise, promises).then(function (values) {
      _.each(targets, function (target) {
        if (target.type === 'upnp') {
          target.service.play(values[0].link);
        } else if (target.type === 'peer') {
          switch (operation.command.type) {
            case 'prepend':
              target.service.prepend(values);
              break;
            case 'append':
              target.service.append(values);
              break;
          }
        }
      });
    });
  });

  var prepend = new Bacon.Bus();
  queuing.plug(prepend.map({type: 'prepend'}));

  this.prepend = function () {
    return prepend;
  };

  var append = new Bacon.Bus();
  queuing.plug(append.map({type: 'append'}));

  this.append = function () {
    return append;
  };

  var selectedPeer = manager.toProperty().sampledBy(selectedTargets, function (devices, selectedTargets) {
    if (!selectedTargets.length || selectedTargets.length > 1) return '<no-peer>';
    var device = devices[selectedTargets[0].device];
    return {
      device: device,
      service: device.services()[selectedTargets[0].service],
      type: selectedTargets[0].type
    };
  });

  this.selectedPeer = function () {
    return selectedPeer;
  };

  var controls = new ControlsViewModel(manager, selectedPeer, mainMenuViewModel);
  this.controls = function () {
    return controls;
  };

  var queue = selectedPeer.flatMapLatest(function (selectedPeer) {
    if (selectedPeer === '<no-peer>' || selectedPeer.type !== 'peer') return Bacon.once([]);
    return selectedPeer.service.state().map(function (state) {
      if (state.index < state.queue.length) {
        var queue = _.clone(state.queue);
        queue[state.index] = _.chain(queue[state.index]).clone().extend({current: true}).value();
        return queue;
      } else {
        return state.queue;
      }
    }).skipDuplicates(_.isEqual);
  }).toProperty([]);

  this.queue = function () {
    return queue;
  };

  var selectedQueue = bjq.Model([]);
  this.selectedQueue = function () {
    return selectedQueue;
  };

  Bacon.combineTemplate({
    selectedPeer: selectedPeer,
    queue: queue, selectedQueue: selectedQueue
  }).sampledBy(controls.remove()).filter(function (state) {

    return state.selectedPeer !== '<no-peer>' && state.selectedPeer.type === 'peer';
  }).onValue(function (state) {
    var indexes = [];

    if(state.selectedQueue.length){
      _.each(state.selectedQueue, function (link) {
        _.each(state.queue, function (item, index) {
          if (link === item.link) indexes.push(index);
        });
      });
    }else{
      _.each(state.queue, function (item, index) {indexes.push(index)});
    }

    state.selectedPeer.service.remove(indexes);
  });
}

module.exports = BrowserViewModel;
