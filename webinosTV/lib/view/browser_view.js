var $ = require('jquery');
//require('jquery.fittext');
var _ = require('../util/objectscore.coffee'); // require('underscore');
var address = require('../util/address.coffee')
var Bacon = require('baconjs');
var bjq = require('bacon.jquery');
var IScroll = require('iscroll');
var util = require('util');

var ControlsView = require('./controls_view.js');

var buttonHeight=0, tappedOn = 0, clickStartEvent=null;

function friendlyName(info) {
  if (info.type === 'upnp') {
    return info.service.displayName();
  } else {
    return address.friendlyName(info.device.address());
  }
}

function ListView(items, selection, list, wrapper, fadeout) {
  var self = this;
  this.scroll = undefined;

  this.refresh = function () {
    if ($(list).children().length > 0) {
      if (typeof self.scroll === 'undefined') {
        self.scroll = new IScroll(wrapper, {snap: list +' li', momentum: false});
      }
      self.scroll.options.snap = document.querySelectorAll(list +' li');
      self.scroll.refresh();

      //Fittext, currently to expensive.
      //$("li p").fitText(0.8);
    }
  };

  items.onValue(function (items) {
    var $list = $(list);
    $list.empty();

    _.each(items, function (item) {
      var $item = $(self.htmlify(item));
      var id = self.identify(item);
      $item.data('id', id);
      if(list === '#targetlist')
        $item.data('local', item.device.isLocal());
      $list.append($item);
    });
    self.refresh();
  });

  selection.apply(items.map(function (items) {
    return function (selection) {
      return _.ointersection(selection, _.map(items, function (item) {
        return self.identify(item);
      }));
    };
  }));

  $(list).asEventStream('mousedown').merge($(list).asEventStream('touchstart')).onValue(function(e){
    tappedOn=Date.now();
    clickStartEvent=e;
  });



  selection.apply($(list).asEventStream('click').merge($(list).asEventStream('touchend')).filter(function(e){
    var justClick = (Date.now()-tappedOn<250);
    var movedDelta = Math.max(e.screenY, clickStartEvent.screenY)-Math.min(e.screenY, clickStartEvent.screenY)+Math.max(e.screenX, clickStartEvent.screenX)-Math.min(e.screenX, clickStartEvent.screenX);
    return justClick && movedDelta<10;
  }).map(function (event) {
    return function (selection) {
      var $item = $(event.target).closest('li');
      if (!$item.length) return selection;
      var id = $item.data('id');
      return (_.ocontains(selection, id) ? _.odifference : _.ounion)(selection, [id]);
    };
  }));

  selection.onValue(function (selection) {
    $('li', list).each(function () {
      var $item = $(this);
      var id = $item.data('id');

      if($item.hasClass('textContent') || $item.hasClass('imageContent')){
        if(_.ocontains(selection, id)){
          if($item.parent().is('#contentlist')){
            $item.find('.selectIcon').attr('src', 'images/add_blue.svg');
          }else{
            $item.find('.selectIcon').attr('src', 'images/remove_blue.svg');
          }
        }else{
          if($item.parent().is('#contentlist')){
            $item.find('.selectIcon').attr('src', 'images/add.svg');
          }else{
            $item.find('.selectIcon').attr('src', 'images/remove.svg');
          }
        }
      }else{
        $item.toggleClass('selected', _.ocontains(selection, id));
      }
    });
  });
}

util.inherits(SourceListView, ListView);
function SourceListView(viewModel) {
  this.htmlify = function (device) {
    return '<li class="nav_sl" style="height:'+buttonHeight+'px"><img src="images/'+(device.type()?device.type():'all_devices')+'.svg"><p>' + address.friendlyName(device.address()) + '</p></li>';
  };

  this.identify = function (device) {
    return device.address();
  };

  ListView.call(this, viewModel.sources(), viewModel.selectedSources(), '#sourcelist', '#sourcewrapper', '#source');
}

util.inherits(CategoryListView, ListView);
function CategoryListView(viewModel) {
  this.htmlify = function (category) {
    return '<li class="nav_ca" style="height:'+buttonHeight+'px"><img src="' + category.image + '"><p>' + category.title + '</p></li>';
  };

  this.identify = function (category) {
    return category.id;
  };

  ListView.call(this, viewModel.categories(), viewModel.selectedCategories(), '#mediatyplist', '#mediatypwrapper', '#category');
}

util.inherits(ContentListView, ListView);
function ContentListView(viewModel) {
  this.htmlify = function (item) {
    var addSelectIcon = function() {
      return '<img class="selectIcon" src="images/add.svg">';
    };
    var html;
    if (typeof item.type === 'string' && item.type.toLowerCase().indexOf('image') === 0) {
      html = '<li class="imageContent nav_co"><div class="thumbnail" style="background-image:url(' + item.thumbnailURIs[0] + ')">' + addSelectIcon() + '</div></li>';
    } else {
      html = '<li class="textContent nav_co"><div><p>' + item.title + '</p>' + addSelectIcon() + '</div></li>';
    }
    return html;
  };

  this.identify = function (item) {
    return {
      device: item.device.address(),
      service: item.service.id(),
      item: {
        id: item.id,
        title: item.title
      }
    };
  };

  ListView.call(this, viewModel.content(), viewModel.selectedContent(), '#contentlist', '#contentwrapper', '#content');
}

util.inherits(TargetListView, ListView);
function TargetListView(viewModel) {
  this.htmlify = function (value) {
    var icon = 'all_devices';
    if (value.type === 'upnp') {
      icon = 'tv';
    } else if (value.device.type()) {
      icon = value.device.type();
    }
    return '<li class="nav_tl" style="height:'+buttonHeight+'px"><img src="images/'+icon+'.svg"><p>' + friendlyName(value) + '</p></li>';
  };

  this.identify = function (value) {
    return {
      device: value.device.address(),
      service: value.service.id(),
      type: value.type
    };
  };

  ListView.call(this, viewModel.targets(), viewModel.selectedTargets(), '#targetlist', '#targetwrapper', '#target');
}

util.inherits(QueueListView, ListView);
function QueueListView(viewModel) {
  this.htmlify = function (value) {
    var html;
    if (typeof value.item.type === 'string' && value.item.type.toLowerCase().indexOf('image') === 0) {
      html = '<li class="imageContent nav_qu"><img src="' + value.item.thumbnailURIs[0] + '">';
    } else {
      html = '<li class="textContent nav_qu"><p>' + value.item.title + '</p>';
    }
    html += '<img class="selectIcon" src="images/remove.svg"></li>';
    return html;
  };

  this.identify = function (value) {
    return value.link;
  };

  ListView.call(this, viewModel.queue(), viewModel.selectedQueue(), '#queuelist', '#queuewrapper', '#queue');
}

function NavigationView (viewModel, listViews, horizontalScroll) {
  var columns = [".nav_sl", ".nav_ca", ".nav_co", ".nav_tl", ".nav_pm", ".nav_qu"];
  var curCol = 0;
  var curRow = [0, 0, 0, 0, 0, 0];
  var navVisible = false;
  var timeoutHandle;

  viewModel.input().onValue(Navigate);

  function Navigate(direction) {
    window.clearTimeout(timeoutHandle);
    if(navVisible === false){
      navVisible = true;
    }else{
      if (direction !== 'enter') $(columns[curCol]+".focus").removeClass('focus');
      switch(direction){
        case 'down':
          if(curRow[curCol] < $(columns[curCol]).length-1){
            curRow[curCol]++;
            centerFocusedElement();
          }
          break;
        case 'up':
          if(curRow[curCol] > 0){
            curRow[curCol]--;
            centerFocusedElement();
          }
          break;
        case 'right':
          if(curCol < 5){
            curCol++;
            centerFocusedElement();
          }else if(curCol == 5 && curRow[5] < 5)
            curRow[5]++;
          break;
        case 'left':
          if(curCol == 5 && curRow[5] < 6 && curRow[5] > 0)
            curRow[5]--;
          else if(curCol > 0){
              curCol--;
              centerFocusedElement();
            }
          else if(curCol === 0){
            navVisible = false;
            $(columns[curCol]).eq(curRow[curCol]).removeClass('focus');
            window.openMainmenu();
          }
          break;
        case 'enter':
          if (navVisible) {
            tappedOn=Date.now();
            $(columns[curCol]+".focus").click();
          }
          break;
      }
    }
    if($(columns[curCol]).length-1 < curRow[curCol]){
      curRow[curCol] = 0;
    }
    $(columns[curCol]).eq(curRow[curCol]).addClass('focus');
    startNavVisibleTimeout();
  }

  function centerFocusedElement(){
    if(curCol != 4 && listViews[curCol].scroll != undefined && listViews[curCol].scroll.hasVerticalScroll){
      listViews[curCol].scroll.scrollToElement($(columns[curCol]).eq(curRow[curCol]).get(0), null, null, true);
    }
    if(horizontalScroll.hasHorizontalScroll){
      horizontalScroll.scrollToElement($(".listhead").eq(curCol).get(0), null, null, true);
    }
  }

  function startNavVisibleTimeout(){
    timeoutHandle = window.setTimeout(function(){
      navVisible=false;
      $(columns[curCol]).eq(curRow[curCol]).removeClass('focus');
    }, 5000);
  }

  function navlog(direction) {
    console.log(direction + "  col:" + curCol + " row:" + curRow);
  }
}

function BrowserView(viewModel) {
  var horizontalScroll = new IScroll('#horizontalwrapper', {snap: '.listhead', scrollX: true, scrollY: false, momentum: false});
      horizontalScroll.on('scrollEnd', function(){ checkFadeout(); });

  var sourceListView = new SourceListView(viewModel);
  var categoryListView = new CategoryListView(viewModel);
  var contentListView = new ContentListView(viewModel);
  var targetListView = new TargetListView(viewModel);
  var queueListView = new QueueListView(viewModel);

  var listViews = [sourceListView, categoryListView, contentListView, targetListView, null, queueListView];
  var navigationView = new NavigationView(viewModel, listViews, horizontalScroll);

  viewModel.search().bind(bjq.textFieldValue($('#searchfield')));

  viewModel.prepend().plug($('#prepend').asEventStream('click').merge($('#prepend').asEventStream('touchend')));
  viewModel.append().plug($('#append').asEventStream('click').merge($('#append').asEventStream('touchend')));

  viewModel.selectedPeer().onValue(function (selectedPeer) {
    $('#peer').text(selectedPeer === '<no-peer>' ? "Select a target" : friendlyName(selectedPeer));
  });

  var controlsViewModel = viewModel.controls();
  var controlsView = new ControlsView('.queuecontrols', null, controlsViewModel);

  function checkFadeout(){
    if(horizontalScroll.x >= 0){
      $('#leftfadeout').hide();
    }else{
      $('#leftfadeout').show();
    }
    if(horizontalScroll.x <= ($('#horizontalwrapper').width() - $('#horizontalscroller').width())){
      $('#rightfadeout').hide();
    }else{
      $('#rightfadeout').show();
    }
  }

  function calcSize() {
    var width = $(window).innerWidth();
    var height = $(window).innerHeight();
    var buttonWidth;
    if (width <= 400) {
      buttonWidth = width * 0.9 / 2;
      buttonHeight = buttonWidth / 1.6;
    } else if (width < 600) {
      buttonWidth = width * 0.9 / 3;
      buttonHeight = buttonWidth / 1.6;
    } else if (width < 960) {
      buttonWidth = width * 0.9 / 4;
      buttonHeight = buttonWidth / 1.6;
    } else if (width < 1200) {
      buttonWidth = width * 0.9 / 6;
      buttonHeight = buttonWidth / 1.6;
    } else {
      buttonWidth = width * 0.9 / 8;
      buttonHeight = buttonWidth / 1.6;
    }

    $('.buttonlist li').height(buttonHeight);
    $('#horizontalscroller').width(buttonWidth * 8);

    $('#horizontalwrapper').height(height * 0.9);
    $('#horizontalwrapper').css('margin-top', -(height * 0.45));

    $('#verticalwrapper').height(height * 0.9 - 20);
    $('#playmodewrapper li').height(((height-26) * 0.45));

    $('#queuewrapper').height( $('#verticalwrapper').height() - $('.queuecontrols').outerHeight());
    $('#queuetopfadeout').css('margin-top', $('.queuecontrols').outerHeight());

    $('.searchfield').width((buttonWidth*2)-6);
    $('.searchfield input').width($('.searchfield').width() - 60);
    $('#contentwrapper').height( $('#verticalwrapper').height() - ($('.searchfield').height() + 10));
    $('#contenttopfadeout').css('margin-top', $('.searchfield').height()+10);

    $('.textContent > p').outerWidth($('#contentlist').width() - 25);

    sourceListView.refresh();
    categoryListView.refresh();
    contentListView.refresh();
    targetListView.refresh();
    queueListView.refresh();
    horizontalScroll.refresh();

    checkFadeout();
  }

  calcSize();

  $(window).resize(function() {
    calcSize();
  });

  document.addEventListener('touchmove', function(e) {
    e.preventDefault();
  }, false);

  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(loaded, 800);
  }, false);
}


module.exports = BrowserView;
