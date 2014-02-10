var gotoPageById = require('./pagetransition.js');
var IScroll = require('iscroll');
var _ = require('../util/objectscore.coffee');
var address = require('../util/address.coffee');


function SelectDeviceListView(items, selection) {
  var self = this;
  this.scroll = undefined;
  this.tappedOn = 0;

  this.refresh = function () {
    if ($('#selectDevicelist').children().length > 0) {
      if (typeof self.scroll === 'undefined') {
        self.scroll = new IScroll('#st_wrapper', {snap: '#selectDevicelist li', momentum: false});
      }
      self.scroll.options.snap = document.querySelectorAll('#selectDevicelist li');
      self.scroll.refresh();
    }
  };

  this.htmlify = function (value) {
    return '<li class="nav_st"><img src="images/'+(value.device.type()?value.device.type():'all_devices')+'.svg"><p>' + address.friendlyName(value.device.address()) + '</p></li>';
  };

  this.identify = function (value) {
    return {
      device: value.device.address(),
      service: value.service.id(),
      type: value.type
    };
  };

  items.onValue(function (items) {
    var $list = $('#selectDevicelist');
    $list.empty();

    _.each(items, function (item) {
      var $item = $(self.htmlify(item));
      var id = self.identify(item);
      $item.data('id', id);
      $list.append($item);
    });
    self.refresh();
  });

  selection.apply($('#selectDevicelist').asEventStream('click').merge($('#selectDevicelist').asEventStream('touchend')).debounceImmediate(500).filter(function(e){
    return !self.scroll.moved;
  }).map(function (event) {
    return function (selection) {
      var $item = $(event.target).closest('li');
      if (!$item.length) return selection;
      return $item.data('id');
    };
  }));
}

function NavigationView (viewModel) {
  var mmCurPos = 0;
  var stCurPos = 0;
  var mmNavVisible = false;
  var stNavVisible = false;
  var timeoutHandle;

  viewModel.input().onValue(Navigate);

  function Navigate(direction) {

    if($('#selectDevice').is(":visible")){
      window.clearTimeout(timeoutHandle);
      if(stNavVisible === false){
        stNavVisible = true;
      }else{
        if (direction !== 'enter') $(".nav_st.focus").removeClass('focus');
        switch(direction){
          case 'down':
            if(stCurPos < $('.nav_st').length-1)
              stCurPos++;
            break;
          case 'up':
            if(stCurPos > 0)
              stCurPos--;
            break;
          case 'left':
            window.closeSelectDevice();
            window.openMainmenu();
            break;
          case 'right':
            window.closeSelectDevice();
            break;
          case 'enter':
            $(".nav_st.focus").click();
            break;
        }
      }
      if($('.nav_st').length-1 < stCurPos){
        stCurPos = 0;
      }
      $(".nav_st").eq(stCurPos).addClass('focus');
      startNavVisibleTimeout();

    }else{
      window.clearTimeout(timeoutHandle);
      if(mmNavVisible === false){
        mmNavVisible = true;
      }else{
        if (direction !== 'enter') $(".nav_mm.focus").removeClass('focus');
        switch(direction){
          case 'down':
            if(mmCurPos < 3)
              mmCurPos++;
            break;
          case 'up':
            if(mmCurPos == 4)
              mmCurPos -= 2;
            else if(mmCurPos > 0)
              mmCurPos--;
            break;
          case 'left':
            if(mmCurPos == 4 && $(".menu").is(":visible")){
              mmCurPos--;
            }else{
              window.openMainmenu();
            }
            break;
          case 'right':
            if(mmCurPos == 3){
              mmCurPos++;
            }else{
              window.closeMainmenu();
            }
            break;
          case 'enter':
            $(".nav_mm.focus").click();
            break;
        }
      }
      $(".nav_mm").eq(mmCurPos).addClass('focus');
      startNavVisibleTimeout();
    }
  }

  function startNavVisibleTimeout(){
    timeoutHandle = window.setTimeout(function(){
      mmNavVisible = false;
      stNavVisible = false;
      $(".nav_mm.focus").removeClass('focus');
      $(".nav_st.focus").removeClass('focus');
    }, 5000);
  }

  function navlog(direction) {
    console.log(direction + "  pos:" + mmCurPos);
  }
}

function MainMenuView(viewModel){
  var navigationView = new NavigationView(viewModel);
  var selectDeviceListView = new SelectDeviceListView(viewModel.devices(), viewModel.selectedDevice());

  viewModel.title().assign($('#selectDeviceTag'), 'text');

  $('#toadvancedbrowserbutton').on('click', function() {
    setTimeout(function () {
      gotoPageById('#browser'); closeMainmenu();
    }, 0);
  });

  $('#torendererbutton').on('click', function() {
    setTimeout(function () {
      gotoPageById('#renderer'); closeMainmenu();
    }, 0);
  });

  $('#tocontrollerbutton').on('click', function() {
    setTimeout(function () {
      viewModel.selectedDevice().set('<no-device>');
      viewModel.type().set('remote');
      closeMainmenu(); openSelectDevice();
    }, 0);
  });

  $('#topushstatebutton').on('click', function() {
    setTimeout(function () {
      viewModel.selectedDevice().set('<no-device>');
      viewModel.type().set('push');
      closeMainmenu(); openSelectDevice();
    }, 0);
  });

  $('#topullstatebutton').on('click', function() {
    setTimeout(function () {
      viewModel.selectedDevice().set('<no-device>');
      viewModel.type().set('pull');
      closeMainmenu(); openSelectDevice();
    }, 0);
  });

  $('.overlay').on('click', function() {
    setTimeout(function () {
      closeMenus();
    }, 0);
  });

  $('#startscreen').on('click', function() {
    setTimeout(function () {
      openMainmenu();
    }, 0);
  })

  closeSelectDevice();

  $('.webinoslogo').fadeOut();
  setInterval(function(){
    if($('.webinoslogo').is(":visible")){
      $('.webinoslogo').fadeOut(1000);
      $('.fokuslogo').fadeIn(1000);
    }else{
      $('.webinoslogo').fadeIn(1000);
      $('.fokuslogo').fadeOut(1000);
    }
  }, 4000);

  function calcSize(){
    var width = $(window).innerWidth();
    var height = $(window).innerHeight();
    var margin = 0;
    if(height < width){
      margin = height*0.03;
    }else{
      margin = width*0.03;
    }
    $('.mm_button').height((height-5*margin)/4);
    $('.mm_button').css("margin", margin);
    $('.mm_button').width($('.menu').width()-2*margin);

    $('.mainmenulist').height(height-4*margin);
    $('.mainmenulist').css({margin: margin, top: margin*2});
    $('.mainmenulist').width($('.menu').width()-2*margin);

    $('.logoArea').height(height*0.05);
    $('.logoArea').width(height*0.05);
    $('.logoArea').hover(
      function(){ 
        $('.logoArea').height(height*0.1);
        $('.logoArea').width(height*0.27);
        // $('.logoArea').on('click', function() { window.open("http://www.fokus.fraunhofer.de/go/webinostv", '_blank');});
      },function(){
        $('.logoArea').height(height*0.05);
        $('.logoArea').width(height*0.05);
        // $('.logoArea').off('click'); 
      });

    selectDeviceListView.refresh();
  }

  function openMainmenu(){
    if(!$('#mainmenu').is(":visible")){
      toggleMainmenu();
    }
  }
  function closeMainmenu(){
    if($('#mainmenu').is(":visible")){
      toggleMainmenu();
    }
  }

  function openSelectDevice(){
    if(!$('#selectDevice').is(":visible")){
      toggleSelectDevice();
    }
  }
  function closeSelectDevice(){
    if($('#selectDevice').is(":visible")){
      toggleSelectDevice();
    }
  }
  function closeMenus() {
    closeMainmenu();
    closeSelectDevice();
  }

  function toggleMainmenu(){
    $('#mainmenu').toggle();
    toggleOverlay();
  }
  function toggleSelectDevice(){
    selectDeviceListView.refresh();
    $('#selectDevice').toggle();
    toggleOverlay();
  }
  function toggleOverlay(){
    if($('.menu').is(":visible")){
      if($('.overlay').is(":hidden")){
        $('.overlay').toggle();
      }
    }else{
      if($('.overlay').is(":visible")){
        $('.overlay').toggle();
      }
    }
  }

  $(window).resize(function() {
    calcSize();
  });

  if(window.location.hash){
    gotoPageById(window.location.hash);
    toggleMainmenu();
  }
  window.openMainmenu=openMainmenu;
  window.openSelectDevice=openSelectDevice;
  window.closeMainmenu=closeMainmenu;
  window.closeSelectDevice=closeSelectDevice;

  calcSize();
}

module.exports = MainMenuView;
