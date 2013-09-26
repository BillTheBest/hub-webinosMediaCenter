var $ = require('jquery');
var _ = require('underscore');

var Bacon = require('baconjs');

function ControlsView(parent, config, viewModel) {
  parent = $(parent) || $('body');
  config = _.extend({
    style: 'slim',
    remove: true,
    fullscreen: false,
    highdef: false,
    navclass: 'nav_qu'
  }, config || {});

  var buttonCount = 5;
  if (config.remove) buttonCount++;
  if (config.fullscreen) buttonCount++;
  if (config.highdef) buttonCount++;

  var cprev = $('<div class="controlButton controlPrev '+config.navclass+'">');
  var crewd = $('<div class="controlButton controlRewd '+config.navclass+'">');
  var cplay = $('<div class="controlButton controlPlay '+config.navclass+'">');
  var cfwrd = $('<div class="controlButton controlFwrd '+config.navclass+'">');
  var cnext = $('<div class="controlButton controlNext '+config.navclass+'">');
  var cdele = $('<div class="controlButton controlDele '+config.navclass+'">');
  var cfull = $('<div class="controlButton controlFull '+config.navclass+'">');
  var chres = $('<div class="controlButton controlHres '+config.navclass+'">');
  var csbar = $('<div class="controlSbar"><div></div></div>');
  var ctime = $('<div class="controlTime"><div class="controlTimeSchnippel"></div><span>1:00</span></div>');

  var controls = $('<div class="' + (config.style || 'slim') + ' controlContainer">');
  var container = $('<div class="controlButtons">');

  container.append([cprev, crewd, cplay, cfwrd, cnext]);
  if (config.remove) container.append(cdele)
  if (config.fullscreen) container.append(cfull);
  if (config.highdef) container.append(chres);
  controls.append([container, csbar, ctime]);

  viewModel.playOrPause().plug(cplay.asEventStream('click').merge(cplay.asEventStream('touchend')));
  viewModel.previous().plug(cprev.asEventStream('click').merge(cprev.asEventStream('touchend')));
  viewModel.next().plug(cnext.asEventStream('click').merge(cnext.asEventStream('touchend')));
  viewModel.rewind().plug(crewd.asEventStream('click').merge(crewd.asEventStream('touchend')).map(undefined));
  viewModel.forward().plug(cfwrd.asEventStream('click').merge(cfwrd.asEventStream('touchend')).map(undefined));
  viewModel.remove().plug(cdele.asEventStream('click').merge(cdele.asEventStream('touchend')));

  $(parent).append(controls);

  // $('.controlSbar div', controls).css({transition: 'width 1s linear'});
  $('.controlButton', controls).css({width: (100 / buttonCount) + '%'});

  var length = 0, last = 0;

  function play() {
    $(cplay).removeClass('controlPlay');
    $(cplay).addClass('controlPaus');
  }

  function pause() {
    $(cplay).removeClass('controlPaus');
    $(cplay).addClass('controlPlay');
  }

  function getFormatedTime(ms) {
    var totalSec = ms / 1000;
    var hours = parseInt( totalSec / 3600 ) % 24;
    var minutes = parseInt( totalSec / 60 ) % 60;
    var seconds = Math.round(totalSec % 60);

    return hours?((hours < 10 ? "0" + hours : hours) + ":"):"" + (minutes < 10 ? "0" + minutes : minutes) + ":" + (seconds  < 10 ? "0" + seconds : seconds);
  }

  function update(relative) {
    if (typeof relative !== 'undefined') {
      relative = Math.round(relative * 1000) / 1000;
    } else {
      relative = last;
    }

    $('.controlSbar div', controls).css({width: relative * $('.controlSbar', controls).width()});
    $('.controlTime span', controls).text((length)?getFormatedTime(Math.round(relative * length)):"-");

    last = relative;
  }

  var seeking = false;
  function seek(value) {
    if (seeking) return;

    var relative = 0;

    if (value >= 0 && value < 1) {
      relative = value;
    } else if (value > 1) {
      relative = Math.min(1, (value / length));
    }

    update(relative);
    bus.push({type: 'set', content: {relative: relative}});
  }

  var bus = new Bacon.Bus(), timer;
  bus.plug($(window).asEventStream('resize').map({type: 'resize'}));
  bus.onValue(function (event) {
    switch (event.type) {
      case 'resize':
        // $('.controlSbar div', controls).css({transition: 'width 0.0s linear'});
        update();
        // $('.controlSbar div', controls).css({transition: 'width 1s linear'});
        break;
      case 'start':
        seeking = true;
        break;
      case 'seek':
        update(event.content.relative);
        // dont flood with seek events
        if (timer) clearTimeout(timer);
        timer = setTimeout(function (relative) {
          viewModel.seek().push(relative);
        }, 200, event.content.relative);
        break;
      case 'end':
        seeking = false;
        break;
    }
  });

  var seeker = $('.controlTime', controls).drags({
    seekBar: $('.controlSbar', controls),
    seekStateBus: bus
  });

  viewModel.state().onValue(function (state) {
    if (state === '<no-state>') {
      seek(0); pause();
    } else if (state.playback.current && !state.playback.stopping) {
      if (state.playback.playing) {
        play();
        length = 0;
        //TODO: move this nasty stuff away from view
        if (typeof state.queue !== 'undefined' && (state.queue[0].item.type.toLowerCase().indexOf("audio")!=-1 || state.queue[0].item.type.toLowerCase().indexOf("video")!=-1)){
          if (typeof state.queue[0].item.duration === "number") {
            length = state.queue[0].item.duration;
          } else if(state.queue[0].item.duration && state.queue[0].item.duration.length){
            var itemlengthParsed = 0, itemlength = (state.queue[0].item.duration instanceof Array)?state.queue[0].item.duration[0]:state.queue[0].item.duration;
            itemlength = itemlength.split(" ");
            for (var i = 0; itemlength.length > i; i++) {
              if (itemlength[i].indexOf("h") != -1) {
                itemlengthParsed += 60 * 60 * parseInt(itemlength[i]);
              }
              if (itemlength[i].indexOf("mn") != -1) {
                itemlengthParsed += 60 * parseInt(itemlength[i]);
              }
              if (itemlength[i].indexOf("s") != -1 && itemlength[i].indexOf("ms") == -1) {
                itemlengthParsed += parseInt(itemlength[i]);
              }
              if (itemlength[i].indexOf("ms") != -1) {
                itemlengthParsed += parseInt(itemlength[i])/1000;
              }
            };
            length = itemlengthParsed * 1000;
            state.queue[0].item.duration = length;
          }
        }
      } else {
        pause();
      }

      seek(length * state.playback.relative);
    } else {
      seek(0); pause();
    }
  });
}

module.exports = ControlsView;

//draggable seekbar plugin
(function($) {
    $.fn.drags = function(opt) {

        opt = $.extend({handle:"",cursor:"move", seekStateBus:null}, opt);

        var z_idx_save = 0,width=0, offset=0, positionOffset=0, drg_w=0, pos_x=0 ;

        var borderWidth = parseInt($(opt.seekBar).css("border-width"),10);

        $(opt.seekBar).width();

        if(opt.handle === "") {
            var $el = this;
        } else {
            var $el = this.find(opt.handle);
        }

        var mouseUpHandler = function() {
            if(!$($el).hasClass('draggable')){
              return;
            }
            // $(opt.seekBar).css({"transition": "width 1s linear"});
            $($el).removeClass('draggable').css('z-index', z_idx_save);
            if(opt.handle === "") {
                $($el).removeClass('draggable');
            } else {
                $($el).removeClass('active-handle').parent().removeClass('draggable');
            }
            opt.seekStateBus.push({type: 'end'});
            if((width/2+positionOffset)/width){
              opt.seekStateBus.push({type: 'seek', content: {relative: (width / 2 + positionOffset) / width}});
            }
        };

        var mouseDownHandler = function(e) {
            if(opt.handle === "") {
                var $drag = $($el).addClass('draggable');
            } else {
                var $drag = $($el).addClass('active-handle').parent().addClass('draggable');
            }
            // $(opt.seekBar).css({"transition": "width 0s linear"});
            var z_idx = z_idx_save = $drag.css('z-index');
            drg_w = $drag.outerWidth(),
            pos_x = $drag.offset().left + drg_w - e.pageX;
            offset = e.pageX + pos_x - drg_w - (positionOffset),
            $drag.css('z-index', 10001);
            e.preventDefault(); // disable selection
            opt.seekStateBus.push({type: 'start'});
        };

        var mouseMoveHandler = function(e) {
                var $drag = $($el);
                if(!$drag.hasClass('draggable')){
                  return;
                }
                width = $(opt.seekBar).width()+borderWidth*2;
                newOffset = e.pageX + pos_x - drg_w;
                if( 2*(newOffset-offset)+width>0  && 2*(newOffset-offset)-width<0 ){

                  positionOffset = newOffset-offset;
                  $drag.offset({
                      left:newOffset
                  });
                  //send the user's seek request to the state bus
                  opt.seekStateBus.push({type: 'seek', content: {relative: (width / 2 + positionOffset) / width}});
                }
                e.stopPropagation(); //prevent page movement
            };

        opt.seekStateBus.onValue(function(e){
        if(e.type){
          switch(e.type){
            case "resize":
              positionOffset = positionOffset * $(opt.seekBar).width()/width;
              width=$(opt.seekBar).width();
              // $(opt.seekBar).css({"transition": "width 0s linear"});
              $($el).css({
                      left:positionOffset
                  });
              // $(opt.seekBar).css({"transition": "width 1s linear"});
              break;
            case "set":
              if(e.content.relative){
                if(e.content.relative>=0 && e.content.relative<1){//percentage case
                  width=$(opt.seekBar).width();
                  positionOffset = e.content.relative * width - width/2;
                  $($el).css({
                      left:positionOffset
                  });
                }
              }
              break;
          }
        }
        });

        $el.css('cursor', opt.cursor).on("mousedown", mouseDownHandler).parents("html").on("mouseup", mouseUpHandler).on("mousemove", mouseMoveHandler);
        return $el;

    }
})($);
