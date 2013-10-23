_ = require('underscore')

Bacon = require('baconjs')

webinos = require('webinos')

DeviceStatusService = require('../service/devicestatus.coffee')
MessagingService = require('../service/messaging.coffee')
PeerService = require('./peer.coffee')
MediaContentService = require('../service/mediacontent.coffee')
TelevisionService = require('../service/television.coffee')
MediaPlayService = require('../service/mediaplay.coffee')
PaymentService = require('../service/payment.coffee')

class DeviceManager extends Bacon.EventStream
  constructor: (interval = 15000, timeout = 30000) ->
    devices = {}
    compound = new Bacon.Bus()
    compound.onValue (event) ->
      device = event.device()
      if event.isAvailable()
        service = event.service()
        if service instanceof DeviceStatusService
          sink? new Bacon.Next(new Found(device))
        else
          if service instanceof MessagingService
            services.plug Bacon.fromPromise(service.createChannel(
                namespace: 'urn:webinos:hub:media'
                properties:
                  mode: 'send-receive'
                  reclaimIfExists: yes
                null # requestCallback
              ).then(_.identity, -> Promise.reject(service)))
              .map(Bacon.once)
              .mapError((service) -> service.searchForChannels('urn:webinos:hub:media'))
              .flatMap(_.identity)
              .flatMap((channel) -> Bacon.fromPromise(channel.connect()))
              .flatMap((channel) -> PeerService.findServices(channel, {interval}))
          if device.devicestatus()?
            sink? new Bacon.Next(new Changed(device))
      else if event.isUnavailable()
        if _.size(device.services()) is 0
          devices[device.address()].discovery.end()
          delete devices[device.address()]
        if event.service() instanceof DeviceStatusService
          sink? new Bacon.Next(new Lost(device))
        else if device.devicestatus()?
          sink? new Bacon.Next(new Changed(device))
      else if device.devicestatus()?
        sink? new Bacon.Next(event)
    services = new Bacon.Bus()
    services.plug Bacon.once(Date.now()).concat(Bacon.fromPoll(interval, -> Date.now())).flatMap (now) ->
      Bacon.mergeAll(
        DeviceStatusService.findServices(),
        MessagingService.findServices(),
        MediaContentService.findServices(),
        TelevisionService.findServices(),
        MediaPlayService.findServices(),
        PaymentService.findServices())
    services
      .flatMap (service) ->
        Bacon.fromPromise(service.bindService())
      .onValue (service) ->
        discovery = devices[service.address()]?.discovery
        if not discovery?
          discovery = new Bacon.Bus()
          device = new Device(service.address(), discovery, interval, timeout)
          devices[service.address()] = {ref: device, discovery: discovery}
          compound.plug(device)
        discovery.push(service)
    sink = undefined
    super (newSink) ->
      sink = (event) ->
        reply = newSink event
        unsub() if reply is Bacon.noMore or event.isEnd()
      unsub = ->
        sink = undefined
    @devices = ->
      refs = {}
      _.each(devices, ({ref}) -> refs[ref.address()] = ref if ref.devicestatus()?)
      refs
    @toProperty = =>
      @scan @devices(), (devices, event) ->
        device = event.device()
        if event.isFound()
          devices[device.address()] = device
        else if event.isLost()
          delete devices[device.address()]
        devices

class Device extends Bacon.EventStream
  constructor: (address, discovery, interval, timeout) ->
    type = undefined
    content = {}
    refresh = undefined
    services = {}
    compound = new Bacon.Bus()
    compound.filter('.isUnbind').map('.service').onValue (service) =>
      delete services[service.id()]
      sink? new Bacon.Next(new Unavailable(this, service))
    discovery.onValue (service) =>
      if services[service.id()]?
        services[service.id()].seen = Date.now()
        service.unbindService()
      else
        services[service.id()] = {ref: service, seen: Date.now()}
        compound.plug(service)
        service.initialize?()
        sink? new Bacon.Next(new Available(this, service))
    discovery.onEnd ->
      unsubPoll()
      sink? new Bacon.End()
    unsubPoll = Bacon.fromPoll(timeout, -> Date.now()).onValue (now) ->
      for id, {ref, seen} of services
        continue if seen >= (now - timeout)
        ref.unbindService()
    sink = undefined
    super (newSink) ->
      sink = (event) ->
        reply = newSink event
        unsub() if reply is Bacon.noMore or event.isEnd()
      unsub = ->
        sink = undefined
    @onValue (event) =>
      return if not event.isAvailable()
      service = event.service()
      if service instanceof DeviceStatusService
        event.service().getPropertyValue(
          component: '_DEFAULT'
          aspect: 'Device'
          property: 'type'
        ).then (value) =>
          type = if value is 'smartphone' then 'phone' else value
          sink? new Bacon.Next(new Changed(this))
      else if service instanceof MediaContentService or service instanceof TelevisionService
        @refresh(yes)
    @address = -> address
    @isLocal = -> address is webinos.session.getServiceLocation()
    @isRemote = => not @isLocal()
    @type = -> type
    @content = -> content
    @services = ->
      refs = {}
      _.each(services, ({ref}) -> refs[ref.id()] = ref)
      refs
    @toProperty = =>
      @scan @services(), (devices, event) ->
        service = event.service()
        if event.isAvailable()
          services[service.id()] = service
        else if event.isUnavailable()
          delete services[service.id()]
        services
    @devicestatus = -> _.find(services, ({ref}) -> ref instanceof DeviceStatusService)?.ref
    @mediacontent = -> _.chain(services).filter(({ref}) -> ref instanceof MediaContentService).pluck('ref').value()
    @television = -> _.find(services, ({ref}) -> ref instanceof TelevisionService)?.ref
    @mediaplay = -> _.chain(services).filter(({ref}) -> ref instanceof MediaPlayService).pluck('ref').value()
    @upnp = => _.filter(@mediaplay(), (ref) -> ref.description().toLowerCase().indexOf('upnp') isnt -1)
    @noupnp = => _.filter(@mediaplay(), (ref) -> ref.description().toLowerCase().indexOf('upnp') is -1)
    @payment = -> _.find(services, ({ref}) -> ref instanceof PaymentService)?.ref
    @peers = -> _.chain(services).filter(({ref}) -> ref instanceof PeerService).pluck('ref').value()
    @isSource = => @mediacontent().length or @television()?
    @isTarget = => @upnp().length > 0 or @peers().length > 0
    @isPayment = => @payment()?
    @refresh = (force = no) =>
      now = Date.now()
      return if refresh? and refresh >= (now - interval) and not force
      refresh = now
      content['media'] = []
      _.each @mediacontent(), (ref) =>
        ref.findItem({}).then (items) =>
          return if refresh isnt now
          _.each items, (item) =>
            content['media'].push(_.extend(item, {device: this, service: ref}))
          sink? new Bacon.Next(new Changed(this))
      @television()?.tuner().getTVSources().then (sources) =>
        content['tv'] = _.chain(sources)
          .map (source) ->
            source.channelList
          .flatten()
          .map ({channelType, name, longName, stream}, index) =>
            {id: index, type: 'Channel', channelType, title: name, longTitle: longName, link: stream, device: this, service: @television()}
          .value()
        sink? new Bacon.Next(new Changed(this))

class Event
  constructor: (device) ->
    @device = -> device
  isFound: -> no
  isChanged: -> no
  isLost: -> no
  isAvailable: -> no
  isUnavailable: -> no

class Found extends Event
  isFound: -> yes

class Changed extends Event
  isChanged: -> yes

class Lost extends Event
  isLost: -> yes

class WithService extends Event
  constructor: (device, service) ->
    super(device)
    @service = -> service

class Available extends WithService
  isAvailable: -> yes

class Unavailable extends WithService
  isUnavailable: -> yes

module.exports = DeviceManager
