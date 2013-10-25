$ = require('jquery')

webinos = require('webinos')

Bacon = require('baconjs')
Promise = require('promise')
promisify = require('../util/promisify.coffee')

Service = require('./service.coffee')

class MessagingService extends Service
  @findServices: (options, filter) ->
    super(new ServiceType("http://webinos.org/api/app2app"), options, filter).map (service) ->
      new MessagingService(service.underlying())
  constructor: (underlying) ->
    super(underlying)
    $(window).unload => @unbindService()
  createChannel: (configuration, requestCallback) ->
    return Promise.reject("Service not bound") unless @bound()
    new Promise (resolver) =>
      messages = new Bacon.Bus()
      @underlying().createChannel(configuration, requestCallback,
        (message) -> messages.push(message)
        (channel) => resolver.fulfill(new Channel(this, channel, messages))
        (error) -> resolver.reject(error)
      )
  searchForChannels: (namespace, zoneIds = [], timeout = 5000) ->
    return Bacon.once(new Bacon.Error("Service not bound")) unless @bound()
    new Bacon.EventStream (sink) =>
      ended = no
      unsub = ->
        return if ended
        ended = yes
        op.cancel()
      op = @underlying().searchForChannels(namespace, zoneIds,
        (channel) =>
          reply = sink new Bacon.Next(new Channel(this, channel))
          unsub() if reply is Bacon.noMore
        -> undefined # successCallback
        (error) ->
          return if ended
          sink new Bacon.Error(error)
          sink new Bacon.End()
          unsub()
      )
      Bacon.later(timeout, null).onValue ->
        return if ended
        sink new Bacon.End()
        unsub()
      unsub

class Channel extends Bacon.EventStream
  constructor: (service, underlying, messages) ->
    connected = if messages? then yes else no
    disconnected = no
    service.filter('.isUnbind').onValue => @disconnect()
    sink = undefined
    messages ?= new Bacon.Bus()
    messages.onValue (message) =>
      sink? new Bacon.Next(new Message(this, message.contents))
    super (newSink) => # auto(dis)connect
      sink = (event) ->
        reply = newSink event
        unsub() if reply is Bacon.noMore or event.isEnd()
      unsub = =>
        sink = undefined
        @disconnect() if @automode and connected
      if connected
        sink? new Bacon.Next(new Connected(this))
      else if disconnected
        sink? new Bacon.Next(new Disconnected(this))
        sink? new Bacon.End()
      else if @automode # => not connected and not disconnected
        @connect().catch (error) ->
          sink? new Bacon.Error(error)
          sink? new Bacon.End()
      unsub
    @automode = yes
    @service = -> service
    @underlying = -> underlying
    @connected = -> connected
    @disconnected = -> disconnected
    @connect = (requestInfo) =>
      return Promise.fulfill(this) if connected
      return Promise.reject("Service not bound") unless service.bound()
      return Promise.reject("Channel already disconnected") if disconnected
      new Promise (resolver) =>
        sink? new Bacon.Next(new Connect(this))
        connect = =>
          connected = yes
          sink? new Bacon.Next(new Connected(this))
        underlying.connect(requestInfo,
          (message) -> messages.push(message)
          => connect(); resolver.fulfill(this)
          (error) -> resolver.reject(error)
        )
    @send = (message) ->
      return Promise.reject("Channel not connected") unless connected
      promise = promisify('send', underlying)(message)
      # promise.then -> messages.push({contents: message})
      messages.push({contents: message}) # Yaah, u know, that android..
      promise
    @sendTo = (client, message) ->
      return Promise.reject("Channel not connected") unless connected
      promisify('sendTo', underlying)(client, message)
    @disconnect = =>
      return Promise.fulfill(this) if disconnected
      return Promise.reject("Channel not connected") unless connected
      new Promise (resolver) =>
        sink? new Bacon.Next(new Disconnect(this))
        disconnect = =>
          underlying = undefined
          connected = no
          disconnected = yes
          messages.end()
          sink? new Bacon.Next(new Disconnected(this))
          sink? new Bacon.End()
        underlying.disconnect(
          => disconnect(); resolver.fulfill(this)
          (error) -> disconnect(); resolver.reject(error)
        )

class Event
  constructor: (channel) ->
    @channel = -> channel
  isConnect: -> no
  isConnected: -> no
  isDisconnect: -> no
  isDisconnected: -> no
  isMessage: -> no

class Connect extends Event
  isConnect: -> yes

class Connected extends Event
  isConnected: -> yes

class Disconnect extends Event
  isDisconnect: -> yes

class Disconnected extends Event
  isDisconnected: -> yes

class Message extends Event
  constructor: (channel, message) ->
    super(channel)
    @message = -> message
  isMessage: -> yes

module.exports = MessagingService
