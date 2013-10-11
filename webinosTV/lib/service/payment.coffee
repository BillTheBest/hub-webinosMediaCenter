webinos = require('webinos')

Promise = require('promise')
promisify = require('../util/promisify.coffee')

Service = require('./service.coffee')

class PaymentService extends Service
  @findServices: (options, filter) ->
    super(new ServiceType("http://webinos.org/api/payment/mockwallet"), options, filter).map (service) ->
      new PaymentService(service.underlying())
  pay: (itemList, bill, customerID, sellerID, challengeCallback) ->
    return Promise.reject("Service not bound") unless @bound()
    pay = (itemList, bill, customerID, sellerID, challengeCallback, successCallback, errorCallback) =>
      @underlying().pay(successCallback, errorCallback, challengeCallback, itemList, bill, customerID, sellerID)
    promisify(pay)(itemList, bill, customerID, sellerID, challengeCallback)

module.exports = PaymentService
