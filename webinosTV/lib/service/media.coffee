webinos = require('webinos')

Bacon = require('baconjs')
Promise = require('promise')
promisify = require('../util/promisify.coffee')

Service = require('./service.coffee')

class MediaService extends Service
  @findServices: (options, filter) ->
    super(new ServiceType("http://webinos.org/api/media"), options, filter).map (service) ->
      new MediaService(service.underlying())
  constructor: (underlying) ->
    sink = undefined
    events = new Bacon.EventStream (newSink) =>
      sink = (event) ->
        reply = newSink event
        unsub() if reply is Bacon.noMore or event.isEnd()
      unsub = =>
        sink = undefined
        @underlying().unregisterListenersOnExit() if @bound()
      unless @bound()
        sink? new Bacon.End()
      else
        promisify('registerListeners', @underlying())({
          onPlay: ({currentMedia, volume}) => sink? new Bacon.Next(new Play(this, currentMedia, volume))
          onPause: => sink? new Bacon.Next(new Pause(this))
          onStop: => sink? new Bacon.Next(new Stop(this))
          onEnd: (currentMedia) => sink? new Bacon.Next(new End(this, currentMedia))
          onVolumeUP: (volume) => sink? new Bacon.Next(new Volume(this, volume))
          onVolumeDOWN: (volume) => sink? new Bacon.Next(new Volume(this, volume))
          onVolumeSet: (volume) => sink? new Bacon.Next(new Volume(this, volume))
        })
        .catch (error) ->
          sink? new Bacon.Error(error)
          sink? new Bacon.End()
        .then => @isPlaying()
        .then ({isPlaying, currentMedia, volume}) =>
          sink? new Bacon.Next(new Play(this, currentMedia, volume)) if isPlaying
      unsub
    state = events.scan {
      playback:
        current: no
        playing: no
        # stopping: no
        relative: 0
      # queue: []
    }, ({playback}, event) ->
      if event.isPlay()
        playback = {current: yes, playing: yes, relative: 0}
      else if event.isPause()
        playback = {current: yes, playing: no, relative: 0}
      else if event.isStop() or event.isEnd()
        playback = {current: no, playing: no, relative: 0}
      {playback}
    super(underlying)
    @initialize = ->
      state.onValue (value) -> undefined
    @filter('.isUnbind').onValue -> sink? new Bacon.End()
    @events = -> events
    @state = -> state
  play: (path) ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('play', @underlying())(path)
  playPause: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('playPause', @underlying())()
  isPlaying: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('isPlaying', @underlying())()
  stepForward: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('stepforward', @underlying())()
  bigStepForward: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('bigStepforward', @underlying())()
  stepBackward: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('stepback', @underlying())()
  bigStepBackward: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('bigStepback', @underlying())()
  stop: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('stop', @underlying())()
  volumeUp: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('volumeUP', @underlying())()
  volumeDown: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('volumeDOWN', @underlying())()
  volume: (volume) ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('setVolume', @underlying())(volume)
  increasePlaybackSpeed: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('increasePlaybackSpeed', @underlying())()
  decreasePlaybackSpeed: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('decreasePlaybackSpeed', @underlying())()
  showInfo: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('showInfo', @underlying())()
  toggleSubtitle: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('toggleSubtitle', @underlying())()

class Event
  constructor: (service) ->
    @service = -> service
  isPlay: -> no
  isPause: -> no
  isStop: -> no
  isEnd: -> no
  isVolume: -> no

class Play extends Event
  constructor: (service, media, volume) ->
    super(service)
    @media = -> media
    @volume = -> volume
  isPlay: -> yes

class Pause extends Event
  isPause: -> yes

class Stop extends Event
  isStop: -> yes

class End extends Event
  constructor: (service, media) ->
    super(service)
    @media = -> media
  isEnd: -> yes

class Volume extends Event
  constructor: (service, volume) ->
    super(service)
    @volume = -> volume
  isVolume: -> yes

module.exports = MediaService
