_ = require('underscore')

webinos = require('webinos')
address = require('../util/address.coffee')

Bacon = require('baconjs')

Service = require('../service/service.coffee')

class PeerService extends Service
  @findServices: (channel, options = {interval: 15000}) ->
    new Bacon.EventStream (newSink) ->
      sink = (event) ->
        reply = newSink event
        unsub() if reply is Bacon.noMore or event.isEnd()
      unsubPoll = ->
      unsub = ->
        sink = undefined
        unsubPoll()
      if channel.connected()
        channel.onValue (event) ->
          if event.isMessage() and event.message().type is 'hello'
            sink? new Bacon.Next(PeerService.create(channel, event.message().from))
          else if event.isDisconnect()
            sink? new Bacon.End()
        if channel.service().address() is address.generalize(webinos.session.getServiceLocation())
          unsubPoll = Bacon.once(Date.now()).concat(Bacon.fromPoll(options.interval, -> Date.now())).onValue (now) ->
            channel.send({
              type: 'hello'
              from:
                address: webinos.session.getServiceLocation()
                id: webinos.session.getSessionId()
            })
      else if channel.disconnected()
        sink? new Bacon.End()
      unsub
  @create: (channel, peer) ->
    if peer.address is webinos.session.getServiceLocation() and
       peer.id is webinos.session.getSessionId()
      new LocalPeerService(channel, peer)
    else
      new RemotePeerService(channel, peer)
  constructor: (channel, peer) ->
    messages = new Bacon.Bus()
    messages.plug channel
      .filter (event) ->
        return if not event.isMessage()
        to = event.message().to
        to?.address is peer.address and to?.id is peer.id
      .map('.message')
    super({
      serviceAddress: peer.address, id: peer.id,
      bindService: ({onBind}) -> onBind(this)
      unbindService: -> messages.end()
    })
    channel.filter('.isDisconnect').onValue => @unbindService()
    @channel = -> channel
    @messages = -> messages
    @send = (type, content) ->
      channel.send({
        from:
          address: webinos.session.getServiceLocation()
          id: webinos.session.getSessionId()
        to: peer
        type, content
      })
  isLocal: -> no
  isRemote: -> no
  playOrPause: ->
    @send('playback:playOrPause')
  decrypted: (link) ->
    @send('playback:decrypted', {link})
  seek: (relative) ->
    @send('playback:seek', {relative})
  previous: ->
    @send('playback:previous')
  next: ->
    @send('playback:next')
  prepend: (items) ->
    @send('queue:prepend', {items})
  append: (items) ->
    @send('queue:append', {items})
  remove: (items) ->
    @send('queue:remove', {items})
  overwrite: (state) ->
    @send('state:overwrite', {state})

class LocalPeerService extends PeerService
  constructor: (channel, peer) ->
    sink = undefined
    events = new Bacon.EventStream (newSink) ->
      sink = (event) ->
        reply = newSink event
        unsub() if reply is Bacon.noMore or event.isEnd()
      unsub = =>
        sink = undefined
      if channel.disconnected()
        sink? new Bacon.End()
      unsub
    super(channel, peer)
    @filter('.isUnbind').onValue -> sink? new Bacon.End()
    apply = new Bacon.Bus()
    apply.plug @messages().filter ({type}) -> type isnt 'synchronize'
    state = apply.scan {
      playback:
        current: no
        playing: no
        stopping: no
        relative: 0
      index: 0
      queue: []
    }, ({playback, index, queue}, {type, content}) ->
      previous = (shift) ->
        if playback.current
          playback.stopping = yes
          sink? new Bacon.Next(new Stop())
        index = Math.max(0, index - 1) if shift
        sink? new Bacon.Next(new Play(queue[index])) if queue.length > index
      next = (shift) ->
        if playback.current
          playback.stopping = yes
          sink? new Bacon.Next(new Stop())
        # queue = _.tail(queue) if shift
        if index is queue.length
          index = 0
        else if shift
          index = Math.min(queue.length, index + 1)
        sink? new Bacon.Next(new Play(queue[index])) if queue.length > index
      switch type
        when 'playback:started'
          if playback.current and not playback.stopping
            playback.playing = yes
          else
            playback = {current: yes, playing: yes, stopping: no, relative: 0}
        when 'playback:paused'
          playback.playing = no
        when 'playback:stopped'
          if playback.stopping
            playback = {current: no, playing: no, stopping: no, relative: 0}
        when 'playback:ended'
          playback = {current: no, playing: no, stopping: no, relative: 0}
          next(yes)
        when 'playback:state'
          playback.relative = content.relative
        when 'playback:playOrPause'
          if playback.current
            event = if playback.playing then new Pause() else new Resume()
            sink? new Bacon.Next(event)
          else
            next(no)
        when 'playback:decrypted'
          if playback.current
            playback.stopping = yes
            sink? new Bacon.Next(new Stop())
            sink? new Bacon.Next(new Play(_.extend(queue[index], {link: content.link})))
        when 'playback:seek'
          sink? new Bacon.Next(new Seek(content.relative)) if playback.current
        when 'playback:previous'
          previous(playback.relative < 0.1)
        when 'playback:next'
          next(playback.current)
        when 'queue:prepend'
          sink? new Bacon.Next(new Prepend(content.items))
          queue = content.items.concat(queue)
          if content.items.length > 0
            index = 0; next(no)
        when 'queue:append'
          sink? new Bacon.Next(new Append(content.items))
          queue = queue.concat(content.items)
          if content.items.length is queue.length
            index = 0; next(no)
        when 'queue:remove'
          queue = _.clone(queue)
          for i in _.sortBy(content.items, _.identity).reverse()
            queue.splice(i, 1)
          if index in content.items
            index = 0; next(no)
        when 'state:overwrite'
          if playback.current
            playback.stopping = yes
            sink? new Bacon.Next(new Stop())
          index = content.state.index
          queue = content.state.queue
          if content.state.playback.playing
            sink? new Bacon.Next(new Play(queue[index]))
            sink? new Bacon.Next(new Seek(content.state.playback.relative))
      {playback, index, queue}
    @initialize = =>
      state.onValue (state) => @send('synchronize', state)
    @apply = -> apply
    @state = -> state
    @events = -> events
  isLocal: -> yes

class Event
  isPlay: -> no
  isSeek: -> no
  isPause: -> no
  isResume: -> no
  isStop: -> no
  isPrepend: -> no
  isAppend: -> no

class Play extends Event
  constructor: (item) ->
    @item = -> item
  isPlay: -> yes

class Seek extends Event
  constructor: (relative) ->
    @relative = -> relative
  isSeek: -> yes

class Pause extends Event
  isPause: -> yes

class Resume extends Event
  isResume: -> yes

class Stop extends Event
  isStop: -> yes

class WithItems extends Event
  constructor: (items) ->
    @items = -> items

class Prepend extends WithItems
  isPrepend: -> yes

class Append extends WithItems
  isAppend: -> yes

class RemotePeerService extends PeerService
  constructor: (channel, peer) ->
    super(channel, peer)
    state = @messages()
      .filter(({type}) -> type is 'synchronize')
      .map('.content')
      .toProperty {
        playback:
          current: no
          playing: no
          relative: 0
        queue: []
      }
    @initialize = ->
      state.onValue -> undefined
    @state = -> state
  isRemote: -> yes

module.exports = PeerService
