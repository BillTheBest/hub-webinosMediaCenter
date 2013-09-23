var $ = require('jquery');
var Bacon = require('baconjs');

var ControlsView = require('./controls_view.js');

$(window).resize(function() {

});

$(document).ready(function() {

});

var IMAGE_SLIDESHOW_INTERVAL = 5000;

function NavigationView (viewModel) {
  var curPos = 0;
  var navVisible = false;
  var timeoutHandle;

  viewModel.input().onValue(Navigate);

  function Navigate(direction) {
    window.clearTimeout(timeoutHandle);
    if(navVisible === false){
      navVisible = true;
    }else{
      if (direction !== 'enter') $(".nav_rd.focus").removeClass('focus');
      switch(direction){
        case 'right':
          if(curPos < 6)
            curPos++;
          break;
        case 'left':
          if(curPos > 0)
            curPos--;
          else if(curPos === 0){
            navVisible = false;
            $(".nav_rd").eq(curPos).removeClass('focus');
            window.openMainmenu();
          }
          break;
        case 'enter':
          if(navVisible) $(".nav_rd.focus").click();
          break;
      }
    }
    $(".nav_rd").eq(curPos).addClass('focus');
    startNavVisibleTimeout();
  }

  function startNavVisibleTimeout(){
    timeoutHandle = window.setTimeout(function(){
      navVisible=false;
      $(".nav_rd").eq(curPos).removeClass('focus');
    }, 5000);
  }

  function navlog(direction) {
    console.log(direction + "  pos:" + curPos);
  }
}

function RendererView(viewModel) {
  var self = this;
  self.viewModel = viewModel;
  self.imageTimer =null;

  var controlsViewModel = viewModel.controls();
  var controlsView = new ControlsView('.rendererControlls', {
    remove: false,
    fullscreen: true,
    highdef: true,
    style: 'full',
    navclass: 'nav_rd'
  }, controlsViewModel);

  self.videoRenderer = $("#renderer video");
  self.audioRenderer = $("#renderer audio");
  self.imageRenderer = $("#renderer .imageContainer");

  //event sources
  viewModel.started().plug($(self.videoRenderer).asEventStream('play'));
  viewModel.paused().plug($(self.videoRenderer).asEventStream('pause'));
  viewModel.ended().plug($(self.videoRenderer).asEventStream('ended'));
  viewModel.state().plug($(self.videoRenderer).asEventStream('timeupdate')
    .merge($(self.videoRenderer).asEventStream('seeked'))
    .throttle(1000)
    .map(function(event){
      return {relative: event.target.currentTime/event.target.duration};
  }));

  //command
  viewModel.events().onValue(function(event){
    if(event.isPlay()){
      if (self.videoRenderer.length) self.videoRenderer[0].src = '';
      self.videoRenderer.length?self.videoRenderer[0].pause():void 0;
      self.playItem(event.item().item.type,event.item().link);
      self.videoRenderer.length?self.videoRenderer[0].play():void 0;
    } else if(event.isSeek()){
      self.videoRenderer.length?self.videoRenderer[0].currentTime=self.videoRenderer[0].duration*event.relative():void 0;
    } else if(event.isPause()){
      self.videoRenderer.length?self.videoRenderer[0].pause():void 0;
    } else if(event.isResume()){
      self.videoRenderer.length?self.videoRenderer[0].play():void 0;
    } else if (event.isStop()) {
      if (self.videoRenderer.length) self.videoRenderer[0].src = '';
      viewModel.stopped().push();
    }
  })

  var navigationView = new NavigationView(viewModel);
}

RendererView.prototype.playItem = function(type, url){
  var self = this;

  if(self.imageTimer){
    clearTimeout(self.imageTimer);
    self.imageTimer=null;
  }

  type = type.split(" ")[0].toLowerCase();
  switch(type){
    case "video":
    case "audio":
    case "channel":
      $(self.videoRenderer).show();
      $(self.imageRenderer).hide();
      self.videoRenderer[0].src = url;
    break;
    case "image":
      $(self.videoRenderer).hide();
      $(self.imageRenderer).show();
      $(self.imageRenderer).css("background-image", "url("+url+")");
      self.imageTimer = setTimeout(function(){
        self.viewModel.ended().push();
      },IMAGE_SLIDESHOW_INTERVAL);
    break;
    default:
      console.log("Unknown type.");
  }
}

module.exports = RendererView;
