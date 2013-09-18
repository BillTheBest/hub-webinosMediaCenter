var _ = require('underscore');

var Bacon = require('baconjs');
var bjq = require('bacon.jquery');

var ControlsViewModel = require('./controls_view_model.js');

function BrowserViewModel(manager, input) {
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
      }).map(function (item) {
        return {source: source, item: item};
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
    return _.filter(devices, function (device) {
      return device.isTarget();
    });
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
      var source = operation.devices[selectedItem.source];
      var item   = _.chain(source.content()).values().flatten().findWhere({
        id: selectedItem.item.id,
        title: selectedItem.item.title
      }).value();
      return {source: source, item: item};
    });

    var targets = _.map(operation.selectedTargets, function (selectedTarget) {
      return operation.devices[selectedTarget];
    });

    var promises = _.map(items, function (item) {
      if (item.item.type === 'Channel') {
        return Promise.fulfill({item: item.item, link: item.item.link})
      }

      return item.source.mediacontent().getLink({
        folderId: item.item.id,
        fileName: item.item.title
      }).then(function (link) {
        return {item: item.item, link: link};
      });
    });

    Promise.every.apply(Promise, promises).then(function (values) {
      _.each(targets, function (target) {
        // Assumption: Only devices with a peer service are recognized as targets.
        var peer = target.peers()[0];
        switch (operation.command.type) {
          case 'prepend':
            peer.prepend(values);
            break;
          case 'append':
            peer.append(values);
            break;
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
    // Assumption: Only devices with a peer service are recognized as targets.
    return devices[selectedTargets[0]].peers()[0];
  });

  this.selectedPeer = function () {
    return selectedPeer;
  };

  var controls = new ControlsViewModel(selectedPeer);
  this.controls = function () {
    return controls;
  };

  var queue = selectedPeer.flatMapLatest(function (selectedPeer) {
    if (selectedPeer === '<no-peer>') return Bacon.once([]);
    return selectedPeer.state().map('.queue').skipDuplicates(_.isEqual);
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
    return state.selectedPeer !== '<no-peer>' && state.selectedQueue.length
  }).onValue(function (state) {
    var indexes = [];

    _.each(state.selectedQueue, function (link) {
      _.each(state.queue, function (item, index) {
        if (link === item.link) indexes.push(index);
      });
    });

    state.selectedPeer.remove(indexes);
  });
}

module.exports = BrowserViewModel;
