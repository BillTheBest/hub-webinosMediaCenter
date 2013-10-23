webinos = require('webinos')

Bacon = require('baconjs')
Promise = require('promise')
promisify = require('../util/promisify.coffee')

Service = require('./service.coffee')

class MediaPlayService extends Service
  @findServices: (options, filter) ->
    super(new ServiceType("http://webinos.org/api/mediaplay"), options, filter).map (service) ->
      new MediaPlayService(service.underlying())
  constructor: (underlying) ->
    sink = undefined
    events = new Bacon.EventStream (newSink) =>
      sink = (event) ->
        reply = newSink event
        unsub() if reply is Bacon.noMore or event.isEnd()
      unsub = =>
        sink = undefined
        @underlying().removeAllListeners() if @bound()
      unless @bound()
        sink? new Bacon.End()
      else
        promisify('addListener', @underlying())({
          onPlay: ({currentMedia, volume, length, position}) => sink? new Bacon.Next(new Play(this, currentMedia, volume, length, position))
          onPause: => sink? new Bacon.Next(new Pause(this))
          onStop: => sink? new Bacon.Next(new Stop(this))
          onEnd: => sink? new Bacon.Next(new End(this))
          onVolume: (volume) => sink? new Bacon.Next(new Volume(this, volume))
        })
        .catch (error) ->
          sink? new Bacon.Error(error)
          sink? new Bacon.End()
        .then(=> @isPlaying())
        .then ({isPlaying, currentMedia, volume, length, position}) =>
          sink? new Bacon.Next(new Play(this, currentMedia, volume, length, position)) if isPlaying
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
  seek: (step) ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('seek', @underlying())(step)
  stop: ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('stop', @underlying())()
  setVolume: (volume) ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('setVolume', @underlying())(volume)
  setSpeed: (speed) ->
    return Promise.reject("Service not bound") unless @bound()
    promisify('setSpeed', @underlying())(speed)

class Event
  constructor: (service) ->
    @service = -> service
  isPlay: -> no
  isPause: -> no
  isStop: -> no
  isEnd: -> no
  isVolume: -> no

class Play extends Event
  constructor: (service, media, volume, length, position) ->
    super(service)
    @media = -> media
    @volume = -> volume
    @length = -> length
    @position = -> position
  isPlay: -> yes

class Pause extends Event
  isPause: -> yes

class Stop extends Event
  isStop: -> yes

class End extends Event
  isEnd: -> yes

class Volume extends Event
  constructor: (service, volume) ->
    super(service)
    @volume = -> volume
  isVolume: -> yes

module.exports = MediaPlayService
