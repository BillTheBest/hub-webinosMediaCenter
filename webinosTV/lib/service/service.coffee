webinos = require('webinos')

_ = require('underscore')

Bacon = require('baconjs')
Promise = require('promise')

class Service extends Bacon.EventStream
  @findServices: (serviceType, options = {timeout: 5000}, filter) ->
    new Bacon.EventStream (sink) ->
      ended = no
      unsub = ->
        return if ended
        ended = yes
        op.cancel()
      op = webinos.discovery.findServices(serviceType, {
        onFound: (service) ->
          op.found = no # Gimme that timeout!
          reply = sink new Bacon.Next(new Service(service))
          unsub() if reply is Bacon.noMore
        onError: (error) ->
          return if ended
          if (!_.contains(['AbortError', 'TimeoutError'], error.name))
            sink new Bacon.Error(error)
          sink new Bacon.End()
          unsub()
      }, options, filter)
      unsub
  constructor: (underlying) ->
    bound = no
    unbound = no
    sink = undefined
    super (newSink) =>
      sink = (event) ->
        reply = newSink event
        unsub() if reply is Bacon.noMore or event.isEnd()
      if bound
        sink? new Bacon.Next(new Bound(this))
      else if unbound
        sink? new Bacon.Next(new Unbound(this))
        sink? new Bacon.End()
      unsub = ->
        sink = undefined
    @underlying = -> underlying
    @address = -> underlying.serviceAddress
    @id = -> underlying.id
    @description = -> underlying.description
    @bound = -> bound
    @unbound = -> unbound
    @bindService = =>
      return Promise.fulfill(this) if bound
      return Promise.reject("Service already unbound") if unbound
      new Promise (resolver) =>
        sink? new Bacon.Next(new Bind(this))
        bind = (newUnderlying) =>
          underlying = newUnderlying
          bound = yes
          sink? new Bacon.Next(new Bound(this))
        underlying.bindService({
          onBind: (newUnderlying) => bind(newUnderlying); resolver.fulfill(this)
        })
    @unbindService = =>
      return Promise.fulfill(this) if unbound
      return Promise.reject("Service not bound") unless bound
      new Promise (resolver) =>
        sink? new Bacon.Next(new Unbind(this))
        unbind = =>
          underlying = undefined
          bound = no
          unbound = yes
          sink? new Bacon.Next(new Unbound(this))
          sink? new Bacon.End()
        underlying.unbindService((->), (->)) # Call me maybe?!
        unbind()
        resolver.fulfill(this)

class Event
  constructor: (service) ->
    @service = -> service
  isBind: -> no
  isBound: -> no
  isUnbind: -> no
  isUnbound: -> no

class Bind extends Event
  isBind: -> yes

class Bound extends Event
  isBound: -> yes

class Unbind extends Event
  isUnbind: -> yes

class Unbound extends Event
  isUnbound: -> yes

module.exports = Service
