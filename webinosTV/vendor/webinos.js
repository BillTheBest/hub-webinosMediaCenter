(function(exports){

/*******************************************************************************
 *  Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *	 http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2011 Alexander Futasz, Fraunhofer FOKUS
 ******************************************************************************/

(function () {
	var logger = console;

	/**
	 * Registry for service objects. Used by RPC.
	 * @constructor
	 * @alias Registry
	 * @param parent PZH (optional).
	 */
	var Registry = function(parent) {
		this.parent = parent;

		/**
		 * Holds registered Webinos Service objects local to this RPC.
		 *
		 * Service objects are stored in this dictionary with their API url as
		 * key.
		 */
		this.objects = {};
	};

	var _registerObject = function (callback) {
		if (!callback) {
			return;
		}
		logger.log("Adding: " + callback.api);

		var receiverObjs = this.objects[callback.api];
		if (!receiverObjs)
			receiverObjs = [];

		// generate id
		var md5sum = crypto.createHash('md5');
		callback.id = md5sum.update(callback.api + callback.displayName + callback.description).digest('hex');
		
		// verify id isn't existing already
		var filteredRO = receiverObjs.filter(function(el, idx, array) {
			return el.id === callback.id;
		});
		if (filteredRO.length > 0)
			throw new Error('Cannot register, already got object with same id.');

		receiverObjs.push(callback);
		this.objects[callback.api] = receiverObjs;
	};

	/**
	 * Registers a Webinos service object as RPC request receiver.
	 * @param callback The callback object that contains the methods available via RPC.
	 */
	Registry.prototype.registerObject = function (callback) {
		_registerObject.call(this, callback);

		if (this.parent && this.parent.registerServicesWithPzh) {
			this.parent.registerServicesWithPzh();
		}
	};

	/**
	 * Unregisters an object, so it can no longer receives requests.
	 * @param callback The callback object to unregister.
	 */
	Registry.prototype.unregisterObject = function (callback) {
		if (!callback) {
			return;
		}
		logger.log("Removing: " + callback.api);
		var receiverObjs = this.objects[callback.api];

		if (!receiverObjs)
			receiverObjs = [];

		var filteredRO = receiverObjs.filter(function(el, idx, array) {
			return el.id !== callback.id;
		});
		if (filteredRO.length > 0) {
			this.objects[callback.api] = filteredRO;
		} else {
			delete this.objects[callback.api];
		}

		if (this.parent && this.parent.registerServicesWithPzh) {
			this.parent.registerServicesWithPzh();
		}
	};

	/**
	 * Get all registered objects.
	 *
	 * Objects are returned in a key-value map whith service type as key and
	 * value being an array of objects for that service type.
	 */
	Registry.prototype.getRegisteredObjectsMap = function() {
		return this.objects;
	};

	/**
	 * Get service matching type and id.
	 * @param serviceTyp Service type as string.
	 * @param serviceId Service id as string.
	 */
	Registry.prototype.getServiceWithTypeAndId = function(serviceTyp, serviceId) {
		var receiverObjs = this.objects[serviceTyp];
		if (!receiverObjs)
			receiverObjs = [];

		var filteredRO = receiverObjs.filter(function(el, idx, array) {
			return el.id === serviceId;
		});

		if (filteredRO.length < 1) {
			if (/ServiceDiscovery|Dashboard/.test(serviceTyp)) {
				return receiverObjs[0];
			}
			return undefined;
		}

		return filteredRO[0];
	};

	Registry.prototype.emitEvent = function(event) {
		var that = this;
		Object.keys(this.objects).forEach(function(serviceTyp) {
			if (!that.objects[serviceTyp]) return;

			that.objects[serviceTyp].forEach(function(service) {
				if (!service.listeners) return;
				if (!service.listeners[event.name]) return;

				service.listeners[event.name].forEach(function(listener) {
					try {
						listener(event);
					} catch(e) {
						console.log('service event listener error:');
						console.log(e);
					};
				});
			});
		});
	};

	// Export definitions for node.js
	if (typeof module !== 'undefined'){
		exports.Registry = Registry;
		var crypto = require('crypto');
	} else {
		// export for web browser
		window.Registry = Registry;
	}
})();
/*******************************************************************************
 *  Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2011 Alexander Futasz, Fraunhofer FOKUS
 ******************************************************************************/

(function () {
	if (typeof webinos === 'undefined')
		webinos = {};
	var logger = console;

	var idCount = 0;

	/**
	 * RPCHandler constructor
	 *  @constructor
	 *  @param parent The PZP object or optional else.
	 */
	var _RPCHandler = function(parent, registry) {
		/**
		 * Parent is the PZP. The parameter is not used/optional on PZH and the
		 * web browser.
		 */
		this.parent = parent;

		/**
		 * Registry of registered RPC objects.
		 */
		this.registry = registry;

		/**
		 * session id
		 */
		this.sessionId = '';

		/**
		 * Map to store callback objects on which methods can be invoked.
		 * Used by one request to many replies pattern.
		 */
		this.callbackObjects = {};

		/**
		 * Used on the client side by executeRPC to store callbacks that are
		 * invoked once the RPC finished.
		 */
		this.awaitingResponse = {};

		this.checkPolicy;

		this.messageHandler = {
			write: function() {
				logger.log("could not execute RPC, messageHandler was not set.");
			}
		};
	};

	/**
	 * Sets the writer that should be used to write the stringified JSON RPC request.
	 * @param messageHandler Message handler manager.
	 */
	_RPCHandler.prototype.setMessageHandler = function (messageHandler){
		this.messageHandler = messageHandler;
	};

	/**
	 * Create and return a new JSONRPC 2.0 object.
	 * @function
	 * @private
	 */
	var newJSONRPCObj = function(id) {
		return {
			jsonrpc: '2.0',
			id: id || getNextID()
		};
	};

	/**
	 * Creates a new unique identifier to be used for RPC requests and responses.
	 * @function
	 * @private
	 * @param used for recursion
	 */
	var getNextID = function(a) {
		// implementation taken from here: https://gist.github.com/982883
		return a?(a^Math.random()*16>>a/4).toString(16):([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,getNextID);
	};

	/**
	 * Preliminary object to hold information to create JSONRPC request object.
	 * @function
	 * @private
	 */
	var newPreRPCRequest = function(method, params) {
		var rpc = newJSONRPCObj();
		rpc.method = method;
		rpc.params = params || [];
		rpc.preliminary = true;
		return rpc;
	};

	/**
	 * Create and return a new JSONRPC 2.0 request object.
	 * @function
	 * @private
	 */
	var toJSONRPC = function(preRPCRequest) {
		if (preRPCRequest.preliminary) {
			var rpcRequest = newJSONRPCObj(preRPCRequest.id);
			rpcRequest.method = preRPCRequest.method;
			rpcRequest.params = preRPCRequest.params;
			return rpcRequest;
		} else {
			return preRPCRequest;
		}
	};

	/**
	 * Create and return a new JSONRPC 2.0 response result object.
	 * @function
	 * @private
	 */
	var newJSONRPCResponseResult = function(id, result) {
		var rpc = newJSONRPCObj(id);
		rpc.result = typeof result === 'undefined' ? {} : result;
		return rpc;
	};

	/**
	 * Create and return a new JSONRPC 2.0 response error object.
	 * @function
	 * @private
	 */
	var newJSONRPCResponseError = function(id, error) {
		var rpc = newJSONRPCObj(id);
		rpc.error = {
				data: error,
				code: -31000,
				message: 'Method Invocation returned with error'
		};
		return rpc;
	};

	/**
	 * Handles a JSON RPC request.
	 * @param request JSON RPC request object.
	 * @param from The sender.
	 * @function
	 * @private
	 */
	var handleRequest = function (request, from) {
		var isCallbackObject;

		var idx = request.method.lastIndexOf('.');
		var service = request.method.substring(0, idx);
		var method = request.method.substring(idx + 1);
		var serviceId;
		idx = service.indexOf('@');
		if (idx !== -1) {
			// extract service type and id, e.g. service@id
			var serviceIdRest = service.substring(idx + 1);
			service = service.substring(0, idx);
			var idx2 = serviceIdRest.indexOf('.');
			if (idx2 !== -1) {
				serviceId = serviceIdRest.substring(0, idx2);
			} else {
				serviceId = serviceIdRest;
			}
		} else if (!/ServiceDiscovery|Dashboard/.test(service)) {
			// request to object registered with registerCallbackObject
			isCallbackObject = true;
		}
		//TODO send back error if service and method is not webinos style

		if (service.length === 0) {
			logger.log("Cannot handle request because of missing service in request");
			return;
		}

		logger.log("Got request to invoke " + method + " on " + service + (serviceId ? "@" + serviceId : "") +" with params: " + request.params );

		var includingObject;
		if (isCallbackObject) {
			includingObject = this.callbackObjects[service];
		} else {
			includingObject = this.registry.getServiceWithTypeAndId(service, serviceId);
		}

		if (!includingObject) {
			logger.log("No service found with id/type " + service);
			return;
		}

		// takes care of finding functions bound to attributes in nested objects
		idx = request.method.lastIndexOf('.');
		var methodPathParts = request.method.substring(0, idx);
		methodPathParts = methodPathParts.split('.');
		// loop through the nested attributes
		for (var pIx = 0; pIx<methodPathParts.length; pIx++) {
			if (methodPathParts[pIx] && methodPathParts[pIx].indexOf('@') >= 0) continue;
			if (methodPathParts[pIx] && includingObject[methodPathParts[pIx]]) {
				includingObject = includingObject[methodPathParts[pIx]];
			}
		}

		if (typeof includingObject === 'object') {
			var id = request.id;
			var that = this;

			var successCallback = function (result) {
				if (typeof id === 'undefined') return;
				var rpc = newJSONRPCResponseResult(id, result);
				that.executeRPC(rpc, undefined, undefined, from);
			}

			var errorCallback = function (error) {
				if (typeof id === 'undefined') return;
				var rpc = newJSONRPCResponseError(id, error);
				that.executeRPC(rpc, undefined, undefined, from);
			}

			// registration object (in case of "one request to many responses" use)
			var fromObjectRef = {
				rpcId: request.id,
				from: from
			};

			// call the requested method
			includingObject[method](request.params, successCallback, errorCallback, fromObjectRef);
		}
	};

	/**
	 * Handles a JSON RPC response.
	 * @param response JSON RPC response object.
	 * @function
	 * @private
	 */
	var handleResponse = function (response) {
		// if no id is provided we cannot invoke a callback
		if (!response.id) return;

		logger.log("Received a response that is registered for " + response.id);

		// invoking linked error / success callback
		if (this.awaitingResponse[response.id]) {
			var waitResp = this.awaitingResponse[response.id];

			if (waitResp.onResult && typeof response.result !== "undefined") {
				waitResp.onResult(response.result);
				logger.log("RPC called scb for response");
			}

			if (waitResp.onError && response.error) {
				if (response.error.data) {
					this.awaitingResponse[response.id].onError(response.error.data);
				}
				else {
					this.awaitingResponse[response.id].onError();
				}
				logger.log("RPC called ecb for response");
			}
				delete this.awaitingResponse[response.id];

		} else if (this.callbackObjects[response.id]) {
			// response is for a rpc callback obj
			var callbackObj = this.callbackObjects[response.id];

			if (callbackObj.onSecurityError && response.error &&
					response.error.data && response.error.data.name === 'SecurityError') {

				callbackObj.onSecurityError(response.error.data);
				logger.log('Received SecurityError response.');
			}
			logger.log('Dropping received response for RPC callback obj.');
		}
	};

	/**
	 * Handles a new JSON RPC message (as string)
	 * @param message The RPC message coming in.
	 * @param from The sender.
	 */
	_RPCHandler.prototype.handleMessage = function (jsonRPC, from){
		var self = this;
		logger.log("New packet from messaging");
		logger.log("Response to " + from);

		// Helper function for handling rpc
		function doRPC() {
			if (typeof jsonRPC.method !== 'undefined' && jsonRPC.method != null) {
				// received message is RPC request
				handleRequest.call(self, jsonRPC, from);
			} else {
				// received message is RPC response
				handleResponse.call(self, jsonRPC, from);
			}
		}

		// Check policy
		if (this.checkPolicy) {
			// Do policy check. Will callback when response (or timeout) received.
			this.checkPolicy(jsonRPC, from, function(isAllowed) {
				// Prompt or callback received.
				if (!isAllowed) {
					// Request denied - issue security error (to do - this doesn't propagate properly to the client).
					var rpc = newJSONRPCResponseError(jsonRPC.id, {name: "SecurityError", code: 18, message: "Access has been denied."});
					self.executeRPC(rpc, undefined, undefined, from);
				} else {
					// Request permitted - handle RPC.
					doRPC();
				}
			});
		} else {
			// No policy checking => handle RPC right now.
			doRPC();
		}
	};

	/**
	 * Executes the given RPC request and registers an optional callback that
	 * is invoked if an RPC response with same id was received.
	 * @param rpc An RPC object create with createRPC.
	 * @param callback Success callback.
	 * @param errorCB Error callback.
	 * @param from Sender.
	 */
	_RPCHandler.prototype.executeRPC = function (preRpc, callback, errorCB, from) {
		var rpc = toJSONRPC(preRpc);

		if (typeof callback === 'function' || typeof errorCB === 'function'){
			var cb = {};
			if (typeof callback === 'function') cb.onResult = callback;
			if (typeof errorCB === 'function') cb.onError = errorCB;
			if (typeof rpc.id !== 'undefined') this.awaitingResponse[rpc.id] = cb;
		}

		// service invocation case
		if (typeof preRpc.serviceAddress !== 'undefined') {
			from = preRpc.serviceAddress;
		}

		if (typeof module !== 'undefined') {
			this.messageHandler.write(rpc, from);
		} else {
			// this only happens in the web browser
			webinos.session.message_send(rpc, from);
		}
	};


	/**
	 * Creates a JSON RPC 2.0 compliant object.
	 * @param service The service (e.g., the file reader or the
	 * 		  camera service) as RPCWebinosService object instance.
	 * @param method The method that should be invoked on the service.
	 * @param params An optional array of parameters to be used.
	 * @returns RPC object to execute.
	 */
	_RPCHandler.prototype.createRPC = function (service, method, params) {
		if (!service) throw "Service is undefined";
		if (!method) throw "Method is undefined";

		var rpcMethod;

		if (service.api && service.id) {
			// e.g. FileReader@cc44b4793332831dc44d30b0f60e4e80.truncate
			// i.e. (class name) @ (md5 hash of service meta data) . (method in class to invoke)
			rpcMethod = service.api + "@" + service.id + "." + method;
		} else if (service.rpcId && service.from) {
			rpcMethod = service.rpcId + "." + method;
		} else {
			rpcMethod = service + "." + method;
		}

		var preRPCRequest = newPreRPCRequest(rpcMethod, params);

		if (service.serviceAddress) {
			preRPCRequest.serviceAddress = service.serviceAddress;
		} else if (service.from) {
			preRPCRequest.serviceAddress = service.from;
		}

		return preRPCRequest;
	};

	/**
	 * Registers an object as RPC request receiver.
	 * @param callback RPC object from createRPC with added methods available via RPC.
	 */
	_RPCHandler.prototype.registerCallbackObject = function (callback) {
		if (!callback.id) {
			// can only happen when registerCallbackObject is called before
			// calling createRPC. file api impl does it this way. that's why
			// the id generated here is then used in notify method below
			// to overwrite the rpc.id, as they need to be the same
			callback.id = getNextID();
		}

		// register
		this.callbackObjects[callback.id] = callback;
	};

	/**
	 * Unregisters an object as RPC request receiver.
	 * @param callback The callback object to unregister.
	 */
	_RPCHandler.prototype.unregisterCallbackObject = function (callback) {
		delete this.callbackObjects[callback.id];
	};

	/**
	 * Registers a policy check function.
	 * @param checkPolicy
	 */
	_RPCHandler.prototype.registerPolicycheck = function (checkPolicy) {
		this.checkPolicy = checkPolicy;
	};

	/**
	 * Utility method that combines createRPC and executeRPC.
	 * @param service The service (e.g., the file reader or the
	 * 		  camera service) as RPCWebinosService object instance.
	 * @param method The method that should be invoked on the service.
	 * @param objectRef RPC object reference.
	 * @param successCallback Success callback.
	 * @param errorCallback Error callback.
	 * @returns Function which when called does the rpc.
	 */
	_RPCHandler.prototype.request = function (service, method, objectRef, successCallback, errorCallback) {
		var self = this; // TODO Bind returned function to "this", i.e., an instance of RPCHandler?

		function callback(maybeCallback) {
			if (typeof maybeCallback !== "function") {
				return function () {};
			}
			return maybeCallback;
		}

		return function () {
			var params = Array.prototype.slice.call(arguments);
			var message = self.createRPC(service, method, params);

			if (objectRef && objectRef.api)
				message.id = objectRef.api;
			else if (objectRef)
				message.id = objectRef;

			self.executeRPC(message, callback(successCallback), callback(errorCallback));
		};
	};

	/**
	 * Utility method that combines createRPC and executeRPC.
	 *
	 * For notification only, doesn't support success or error callbacks.
	 * @param service The service (e.g., the file reader or the
	 * 		  camera service) as RPCWebinosService object instance.
	 * @param method The method that should be invoked on the service.
	 * @param objectRef RPC object reference.
	 * @returns Function which when called does the rpc.
	 */
	_RPCHandler.prototype.notify = function (service, method, objectRef) {
		return this.request(service, method, objectRef, function(){}, function(){});
	};

	/**
	 * RPCWebinosService object to be registered as RPC module.
	 *
	 * The RPCWebinosService has fields with information about a Webinos service.
	 * It is used for three things:
	 * 1) For registering a webinos service as RPC module.
	 * 2) The service discovery module passes this into the constructor of a
	 *	webinos service on the client side.
	 * 3) For registering a RPC callback object on the client side using ObjectRef
	 *	as api field.
	 * When registering a service the constructor should be called with an object
	 * that has the following three fields: api, displayName, description. When
	 * used as RPC callback object, it is enough to specify the api field and set
	 * that to ObjectRef.
	 * @constructor
	 * @param obj Object with fields describing the service.
	 */
	var RPCWebinosService = function (obj) {
		this.listeners = {};
		if (!obj) {
			this.id = '';
			this.api = '';
			this.displayName = '';
			this.description = '';
			this.serviceAddress = '';
		} else {
			this.id = obj.id || '';
			this.api = obj.api || '';
			this.displayName = obj.displayName || '';
			this.description = obj.description || '';
			this.serviceAddress = obj.serviceAddress || '';
		}
	};

	/**
	 * Get an information object from the service.
	 * @returns Object including id, api, displayName, serviceAddress.
	 */
	RPCWebinosService.prototype.getInformation = function () {
		return {
			id: this.id,
			api: this.api,
			displayName: this.displayName,
			description: this.description,
			serviceAddress: this.serviceAddress
		};
	};

	RPCWebinosService.prototype._addListener = function (event, listener) {
		if (!event || !listener) throw new Error('missing event or listener');

		if (!this.listeners[event]) this.listeners[event] = [];
		this.listeners[event].push(listener);
	};

	RPCWebinosService.prototype._removeListener = function (event, listener) {
		if (!event || !listener) return;
		this.listeners[event].forEach(function(l, i) {
			if (l === listener) this.listeners[event][i] = null;
		});
	};

	/**
	 * Webinos ServiceType from ServiceDiscovery
	 * @constructor
	 * @param api String with API URI.
	 */
	var ServiceType = function(api) {
		if (!api)
			throw new Error('ServiceType: missing argument: api');

		this.api = api;
	};

	/**
	 * Set session id.
	 * @param id Session id.
	 */
	_RPCHandler.prototype.setSessionId = function(id) {
		this.sessionId = id;
	};

	/**
	 * Export definitions for node.js
	 */
	if (typeof module !== 'undefined'){
		exports.RPCHandler = _RPCHandler;
		exports.Registry = require('./registry.js').Registry;
		exports.RPCWebinosService = RPCWebinosService;
		exports.ServiceType = ServiceType;

	} else {
		// export for web browser
		window.RPCHandler = _RPCHandler;
		window.RPCWebinosService = RPCWebinosService;
		window.ServiceType = ServiceType;
	}
})();
/*******************************************************************************
*  Code contributed to the webinos project
* 
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*  
*     http://www.apache.org/licenses/LICENSE-2.0
*  
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*
* Copyright 2012 Ziran Sun, Samsung Electronics(UK) Ltd
******************************************************************************/
(function ()	{
"use strict";
  var logger = console;
  if (typeof module !== "undefined") {
    logger= require("./logging.js")(__filename);
  }

    function logMsg(name, message) {
        logger.log(name + '\n from: ' + message.from + '\n to:' + message.to + '\n resp_to:' + message.resp_to);
    }

	/** Message fields:
	 *
	 * var message = {
	 * register: false    //register sender if true
	 * ,type: "JSONRPC"   // JSONRPC message or other
	 * ,id:   0           // messageid used to
	 * ,from:  null       // sender address
	 * ,to:    null       // reciever address
	 * ,resp_to:   null   // the destination to pass RPC result back to
	 * ,timestamp:  0     // currently this parameter is not used
	 * ,timeout:  null    // currently this parameter is not used
	 * ,payload:  null    // message body - RPC object
	 * };
	 */

	/** Address description:

	 * address format in current session Manager code - PZH/PZP/appid/instanceid
	 * address format defined in http://dev.webinos.org/redmine/projects/wp4/wiki/Entity_Naming_for_Messaging is:
	 * https://her_domain.com/webinos/other_user/urn:services-webinos-org:calender
	 *
	 * other_user@her_domain.com                        <-- name of user identity (PZH?)
	 *  |
	 * +-- laptop                                     <-- name of the PZP
	 *         |
	 *        +-- urn:services-webinos-org:calender    <-- service type
	 *              |
	 *              +-- A0B3
	 * other_user@her_domain.com/laptop/urn:services-webinos-org:calender/
	 */

	/**
	 * MessageHandler constructor
	 *  @constructor
	 *  @param rpcHandler RPC handler manager.
	 */
	var MessageHandler = function (rpcHandler) {
		this.sendMsg = null;

		this.ownSessionId = null;
		this.separator = null;

		this.rpcHandler = rpcHandler;
		this.rpcHandler.setMessageHandler(this);

		/**
		 * To store the session id after registration. e.g. PZP registers with
		 * PZH, PZH creates a session id X for PZP. client[PZP->PZH] = X
		 *
		 *  TODO need to adjust clients[] to accommodate PZH farm, PZP farm scenarios
		 */
		this.clients = {};
	};

	/**
	 * Set the sendMessage function that should be used to send message.
	 * Developers use this function to call different sendmessage APIs under
	 * different communication environment. e.g. in socket.io, the
	 * sendMessageFunction could be: io.sockets.send(sessionid);
	 * @param sendMessageFunction A function that used for sending messages.
	 */
	MessageHandler.prototype.setSendMessage = function (sendMessageFunction) {
		this.sendMsg = sendMessageFunction;
	};

	/**
	 * Function to set own session identity.
	 * @param ownSessionId pz session id
	 */
	MessageHandler.prototype.setOwnSessionId = function (ownSessionId) {
		this.ownSessionId = ownSessionId;
	};

	/**
	 * Function to get own session identity.
	 */
	MessageHandler.prototype.getOwnSessionId = function () {
		return this.ownSessionId;
	};

	/**
	 * Set separator used to in Addressing to separator different part of the address.
	 * e.g. PZH/PZP/APPID, "/" is the separator here
	 * @param sep The separator that used in address representation
	 */

	MessageHandler.prototype.setSeparator = function (sep) {
		this.separator = sep;
	};

	/**
	 *  Create a register message.
	 *  Use the created message to send it to an entity, this will setup a session
	 *  on the receiver side. The receiver will then route messages to the
	 *  sender of this message.
	 *  @param from Message originator
	 *  @param to  Message destination
	 */
	MessageHandler.prototype.createRegisterMessage = function(from, to) {
		logger.log('creating register msg to send from ' + from + ' to ' + to);
		if (from === to) throw new Error('cannot create register msg to itself');

		var msg = {
			register: true,
			to: to,
			from: from,
			type: 'JSONRPC',
			payload: null
		};

		return msg;
	};

	/**
	 *  Remove stored session route. This function is called once session is closed.
	 *  @param sender Message sender or forwarder
	 *  @param receiver Message receiver
	 */
	MessageHandler.prototype.removeRoute = function (sender, receiver) {
		var session = [sender, receiver].join("->");
		if (this.clients[session]) {
            logger.log("deleted "+session);
			delete this.clients[session];
		}
	};

	/**
	 * Returns true if msg is a msg for app on wrt connected to this pzp.
	 */
	function isLocalAppMsg(msg) {
		var ownId = this.ownSessionId.split(this.separator);
		var toId  = msg.to.split(this.separator);
		if (/\/[a-f0-9]+:\d+/.exec(msg.to) // must include /$hexstr:$num to be wrt
				&& /\//.exec(this.ownSessionId) // must include "/" to be pzp
				&& ownId.length > 1 && toId.length > 1
				&& ownId[0] === toId[0] && ownId[1] === toId[1]) {
			return true;
		}
		return false;
	}

	/**
	 * Somehow finds out the PZH address and returns it?
	 */
	function getPzhAddr(message) {
		// check occurances of separator used in addressing
		var data = message.to.split(this.separator);
		var occurences = data.length - 1;
		var id = data[0];
		var forwardto = data[0];

		// strip from right side
		for (var i = 1; i < occurences; i++) {
			id = id + this.separator + data[i];
			var new_session1 = [id, this.ownSessionId].join("->");
			var new_session2 = [this.ownSessionId, id].join("->");

			if (this.clients[new_session1] || this.clients[new_session2]) {
				forwardto = id;
			}
		}

		if (forwardto === data[0]) {
			var s1 = [forwardto, this.ownSessionId].join("->");
			var s2 = [this.ownSessionId, forwardto].join("->");
			if (this.clients[s1] || this.clients[s2])
				forwardto = data[0];
			else
			{
				var own_addr = this.ownSessionId.split(this.separator);
				var own_pzh = own_addr[0]
				if (forwardto !== own_pzh) {
					forwardto = own_pzh;
				}
			}
		}
		return forwardto;
	}
	function isSameZonePzp(address){
		var ownId = this.ownSessionId.split(this.separator);
		var toId  = address.split(this.separator);
		return !!(ownId.length === 2 && toId.length === 2 && toId[0] === ownId[0]);
	}

	/**
	 * RPC writer - referto write function in  RPC
	 * @param rpc Message body
	 * @param to Destination for rpc result to be sent to
	 */
	MessageHandler.prototype.write = function (rpc, to) {
		if (!to) throw new Error('to is missing, cannot send message');

		var message = {
			to: to,
			resp_to: this.ownSessionId,
			from: this.ownSessionId
		};

		if (typeof rpc.jsonrpc !== "undefined") {
			message.type = "JSONRPC";
		}

		message.payload = rpc;

		var session1 = [to, this.ownSessionId].join("->");
		var session2 = [this.ownSessionId, to].join("->");

		if ((!this.clients[session1]) && (!this.clients[session2])) { // not registered either way
			logger.log("session not set up");
			var forwardto = /*isSameZonePzp.call(this, to) ? to: */ getPzhAddr.call(this, message);
			if (forwardto === this.ownSessionId) {
				logger.log('drop message, never forward to itself');
				return;
			}

			if (isLocalAppMsg.call(this, message)) {
				// msg from this pzp to wrt previously connected to this pzp
				logger.log('drop message, wrt disconnected');
				return;
			}

			logger.log("message forward to:" + forwardto);
			this.sendMsg(message, forwardto);
		}
		else if (this.clients[session2]) {
			logger.log("clients[session2]:" + this.clients[session2]);
			this.sendMsg(message, this.clients[session2]);
		}
		else if (this.clients[session1]) {
			logger.log("clients[session1]:" + this.clients[session1]);
			this.sendMsg(message, this.clients[session1]);
		}
	};

	/**
	 *  Handle message routing on receiving message. it does -
	 *  [1] Handle register message and create session path for newly registered party
	 *  [2] Forward messaging if not message destination
	 *  [3] Handle message  by calling RPC handler if it is message destination
	 *  @param message	Received message
	 *  @param sessionid session id
	 */
	MessageHandler.prototype.onMessageReceived = function (message, sessionid) {
		if (typeof message === "string") {
			try {
				message = JSON.parse(message);
			} catch (e) {
				log.error("JSON.parse (message) - error: "+ e.message);
			}
		}

		if (message.hasOwnProperty("register") && message.register) {
			var from = message.from;
			var to = message.to;
			if (to !== undefined) {
				var regid = [from, to].join("->");

				//Register message to associate the address with session id
				if (message.from) {
					this.clients[regid] = message.from;
				}
				else if (sessionid) {
					this.clients[regid] = sessionid;
				}

				logger.log("register Message");
			}
			return;
		}
		// check message destination
		else if (message.hasOwnProperty("to") && (message.to)) {

			//check if a session with destination has been stored
			if(message.to !== this.ownSessionId) {
				logger.log("forward Message " + message.to + " own Id -" +this.ownSessionId + " client list"+this.clients);

				//if no session is available for the destination, forward to the hop nearest,
				//i.e A->D, if session for D is not reachable, check C, then check B if C is not reachable
				var to = message.to;
				var session1 = [to, this.ownSessionId].join("->");
				var session2 = [this.ownSessionId, to].join("->");

				// not registered either way
				if ((!this.clients[session1]) && (!this.clients[session2])) {
					var forwardto = /*isSameZonePzp.call(this, to) ? to:  */getPzhAddr.call(this, message);
					if (forwardto === this.ownSessionId) {
						logMsg('drop message, never forward to self. msg details:', message);
						return;
					}

					if (isLocalAppMsg.call(this, message)) {
						// msg from other pzp to wrt previously connected to this pzp
						logMsg('drop message, adressed wrt disconnected. msg details:', message);
						return;
					}

					logger.log("message forward to:" + forwardto);
					this.sendMsg(message, forwardto);
				}
				else if (this.clients[session2]) {
					this.sendMsg(message, this.clients[session2]);
				}
				else if (this.clients[session1]) {
					this.sendMsg(message, this.clients[session1]);
				}
				return;
			}
			//handle message on itself
			else {
				if (message.payload) {
					if(message.to != message.resp_to) {
						var from = message.from;
						this.rpcHandler.handleMessage(message.payload, from);
					}
					else {
						if (typeof message.payload.method !== "undefined") {
							var from = message.from;
							this.rpcHandler.handleMessage(message.payload, from);
						}
						else {
							if (typeof message.payload.result !== "undefined" || typeof message.payload.error !== "undefined") {
								this.rpcHandler.handleMessage(message.payload);
							}
						}
					}
				}
				else {
					// what other message type are we expecting?
				}
				return;
			}
			return;
		}
	};

	// TODO add fucntion to release clients[] when session is closed -> this will also affect RPC callback funcs

	/**
	 * Export messaging handler definitions for node.js
	 */
	if (typeof exports !== 'undefined') {
		exports.MessageHandler = MessageHandler;
	} else {
		// export for web browser
		window.MessageHandler = MessageHandler;
	}

}());
/*******************************************************************************
 *  Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2011 Alexander Futasz, Fraunhofer FOKUS
 * Copyright 2012 - 2013 Samsung Electronics (UK) Ltd
 * Authors: Habib Virji
 ******************************************************************************/
if (typeof exports === "undefined") exports = window;
if (typeof exports.webinos === "undefined") exports.webinos = {};
if (typeof exports.webinos.session === "undefined") exports.webinos.session = {};

if (typeof _webinos === "undefined") {
    _webinos = {};
    _webinos.registerServiceConstructor = function(){};
}

(function() {
    "use strict";

    var sessionId = null, pzpId, pzhId, connectedDevices =[], isConnected = false, enrolled = false, mode, port = 8080,
        serviceLocation, webinosVersion,listenerMap = {}, channel, pzhWebAddress = "https://pzh.webinos.org/";
    function callListenerForMsg(data) {
        var listeners = listenerMap[data.payload.status] || [];
        for(var i = 0;i < listeners.length;i++) {
            listeners[i](data) ;
        }
    }
    function setWebinosMessaging() {
        webinos.messageHandler.setOwnSessionId(sessionId);
        var msg = webinos.messageHandler.createRegisterMessage(pzpId, sessionId);
        webinos.messageHandler.onMessageReceived(msg, msg.to);
    }
    function updateConnected(message){
        if (message.pzhId) pzhId = message.pzhId;
        if (message.connectedDevices) connectedDevices = message.connectedDevices;
        if (message.enrolled) enrolled = message.enrolled;
        if (message.state) mode = message.state;
        if (mode)  isConnected = (mode["Pzh"] === "connected" || mode["Pzp"] === "connected");
        if (message.hasOwnProperty("pzhWebAddress")) {
            webinos.session.setPzhWebAddress(message.pzhWebAddress);
        } 
    }
    function setWebinosSession(data){
        sessionId = data.to;
        pzpId     = data.from;
        if(data.payload.message) {
            updateConnected(data.payload.message);
        }
        setWebinosMessaging();
    }
    function setWebinosVersion(data) {
        webinosVersion = data.payload.message;
    }
    webinos.session.setChannel = function(_channel) {
        channel = _channel;
    };
    webinos.session.setPzpPort = function (port_) {
        port = port_;
    };
    webinos.session.getPzpPort = function () {
        return port;
    };
    webinos.session.setPzhWebAddress = function (pzhWebAddress_) {
        pzhWebAddress = pzhWebAddress_;
    };
    webinos.session.getPzhWebAddress = function () {
        return pzhWebAddress;
    };
    webinos.session.message_send_messaging = function(msg, to) {
        msg.resp_to = webinos.session.getSessionId();
        channel.send(JSON.stringify(msg));
    };
    webinos.session.message_send = function(rpc, to) {
        var type;
        if(rpc.type !== undefined && rpc.type === "prop") {
            type = "prop";
            rpc = rpc.payload;
        }else {
            type = "JSONRPC";
        }
        if (typeof to === "undefined") {
            to = pzpId;
        }
        var message = {"type":type,
            "from":webinos.session.getSessionId(),
            "to":to,
            "resp_to":webinos.session.getSessionId(),
            "payload":rpc};
        if(rpc.register !== "undefined" && rpc.register === true) {
            console.log(rpc);
            channel.send(JSON.stringify(rpc));
        }else {
            console.log("creating callback");
            console.log("WebSocket Client: Message Sent");
            console.log(message);
            channel.send(JSON.stringify(message));
        }
    };
    webinos.session.setServiceLocation = function (loc) {
        serviceLocation = loc;
    };
    webinos.session.getServiceLocation = function () {
        if (typeof serviceLocation !== "undefined") {
            return serviceLocation;
        } else {
            return pzpId;
        }
    };
    webinos.session.getSessionId = function () {
        return sessionId;
    };
    webinos.session.getPZPId = function () {
        return pzpId;
    };
    webinos.session.getPZHId = function () {
        return ( pzhId || "");
    };
    webinos.session.getConnectedDevices = function () {
        return (connectedDevices || []);
    };
    webinos.session.getConnectedPzh = function () {
       var list =[];
       if(pzhId) {
         for (var i = 0 ; i < connectedDevices.length; i = i + 1){
           list.push(connectedDevices[i].id);
         }
       }
       return list;
    };
    webinos.session.getConnectedPzp = function () {
        var list =[];
        if (connectedDevices){
           for (var i = 0 ; i < connectedDevices.length; i = i + 1){
            if(!pzhId) {
              list.push(connectedDevices[i]);
            } else {
              for (var j = 0; j < (connectedDevices[i].pzp && connectedDevices[i].pzp.length); j = j + 1){
               list.push(connectedDevices[i].pzp[j]);
              }
           }
          }
        }
        return list;
    };
    webinos.session.getFriendlyName = function(id){
        for (var i = 0 ; i < connectedDevices.length; i = i + 1){
            if(connectedDevices[i] === id || connectedDevices[i].id === id) {
                return connectedDevices[i].friendlyName;
            }
            for (var j = 0 ; j < (connectedDevices[i].pzp && connectedDevices[i].pzp.length); j = j + 1){
                if(connectedDevices[i].pzp[j].id === id) {
                    return connectedDevices[i].pzp[j].friendlyName;
                }
            }
        }
    };
    webinos.session.addListener = function (statusType, listener) {
        var listeners = listenerMap[statusType] || [];
        listeners.push (listener);
        listenerMap[statusType] = listeners;
        return listeners.length;
    };
    webinos.session.removeListener = function (statusType, id) {
        var listeners = listenerMap[statusType] || [];
        try {
            listeners[id - 1] = undefined;
        } catch (e) {
        }
    };
    webinos.session.isConnected = function () {
        return isConnected;
    };
    webinos.session.getPzpModeState = function (mode_name) {
        return  (enrolled && mode[mode_name] === "connected");
    };
    webinos.session.getWebinosVersion = function() {
        return webinosVersion;
    };
    webinos.session.handleMsg = function(data) {
        if(typeof data === "object" && data.type === "prop") {
            switch(data.payload.status) {
                case "webinosVersion":
                case "update":
                case "registeredBrowser":
                    setWebinosSession(data);
                case "pzpFindPeers":
                case "pubCert":
                case "showHashQR":
                case "addPzpQR":
                case "requestRemoteScanner":
                case "checkHashQR":
                case "sendCert":
                case "connectPeers":
                case "intraPeer":
                case "infoLog":
                case "errorLog":
                case "error":
                case "friendlyName":
                case "gatherTestPageLinks":
                    callListenerForMsg(data);
                    break;
                case "pzhDisconnected":
                    isConnected = false;
                    callListenerForMsg(data);
                    break;
            }
        }
    }
}());
/*******************************************************************************
 *  Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2011 Alexander Futasz, Fraunhofer FOKUS
 ******************************************************************************/
(function () {
    var channel = null;

    /**
     * Creates the socket communication channel
     * for a locally hosted websocket server at port 8080
     * for now this channel is used for sending RPC, later the webinos
     * messaging/eventing system will be used
     */
    function createCommChannel (successCB) {
        var channel = null;
        if (typeof WebinosSocket !== 'undefined') { // Check if we are inside Android widget renderer.
            channel = new WebinosSocket ();
        } else { // We are not in Android widget renderer so we can use a browser websocket.
            var port, hostname;
            var defaultHost = "localhost";
            var defaultPort = "8080";
            var isWebServer = true;
            var useDefaultHost = false;
            var useDefaultPort = false;

            // Get web server info.

            // Get web server port.
            port = window.location.port - 0 || 80;
            // Find web server hostname.
            hostname = window.location.hostname;
            if (hostname == "") isWebServer = false; // We are inside a local file.
            if(hostname !== "localhost" && hostname !=="127.0.0.1") {
              console.log("websocket connection is only possible with address localhost or 127.0.0.1. Please change to localhost or 127.0.0.1 " +
                  "to connect to the PZP");
            }

            // Find out the communication socket info.

            // Set the communication channel's port.
            if (isWebServer) {
                try {
                    var xmlhttp = new XMLHttpRequest ();
                    xmlhttp.open ("GET", "/webinosConfig.json", false);
                    xmlhttp.send ();
                    if (xmlhttp.status == 200) {
                        var resp = JSON.parse (xmlhttp.responseText);
                        port = resp.websocketPort;
                    } else { // We are not inside a pzp or widget server.
                        console.log ("CAUTION: webinosConfig.json failed to load. Are you on a pzp/widget server or older version of webinos? Trying the guess  communication channel's port.");
                        port = port + 1; // Guessing that the port is +1 to the webserver's. This was the way to detect it on old versions of pzp.
                    }
                } catch (err) { // XMLHttpRequest is not supported or something went wrong with it.
                    console.log ("CAUTION: The pzp communication host and port are unknown. Trying the default communication channel.");
                    useDefaultHost = true;
                    useDefaultPort = true;
                }
            } else { // Let's try the default pzp hostname and port.
                console.log ("CAUTION: No web server detected. Using a local file? Trying the default communication channel.");
                useDefaultHost = true;
                useDefaultPort = true;
            }
            // Change the hostname to the default if required.
            if (useDefaultHost) hostname = defaultHost;
            // Change the port to the default if required.
            if (useDefaultPort) port = defaultPort;

            // We are ready to make the connection.

            // Get the correct websocket object.
            var ws = window.WebSocket || window.MozWebSocket;
            try {
                channel = new ws ("ws://" + hostname + ":" + port);
            } catch (err) { // Websockets are not available for this browser. We need to investigate in order to support it.
                throw new Error ("Your browser does not support websockets. Please report your browser on webinos.org.");
            }
        }
        webinos.session.setChannel (channel);
        webinos.session.setPzpPort (port);

        channel.onmessage = function (ev) {
            console.log ('WebSocket Client: Message Received : ' + JSON.stringify (ev.data));
            var data = JSON.parse (ev.data);
            if (data.type === "prop") {
                webinos.session.handleMsg (data);
            } else {
                //webinos.messageHandler.setOwnSessionId (webinos.session.getSessionId ());
                //webinos.messageHandler.setSendMessage (webinos.session.message_send_messaging);
                webinos.messageHandler.onMessageReceived (data, data.to);
            }
        };
        channel.onopen = function() {
          var url = window.location.pathname;
          var origin = window.location.origin;
          webinos.session.message_send({type: 'prop', payload: {status:'registerBrowser', value: url, origin: origin}});
        };
        channel.onerror = function(evt) {
          console.log("WebSocket error" + JSON.stringify(evt));
        };
    }

    createCommChannel ();

    webinos.rpcHandler = new RPCHandler (undefined, new Registry ());
    webinos.messageHandler = new MessageHandler (webinos.rpcHandler);

} ());
/*******************************************************************************
 * Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2011 Alexander Futasz, Fraunhofer FOKUS
 ******************************************************************************/

(function(exports) {

    var WebinosService = function (obj) {
        RPCWebinosService.call(this, obj);
    };

    WebinosService.prototype.state = {};
    WebinosService.prototype.icon = '';

    // stub implementation in case a service module doesn't provide its own bindService
    WebinosService.prototype.bindService = function(bindCB) {
        if (typeof bindCB === 'undefined') return;

        if (typeof bindCB.onBind === 'function') {
            bindCB.onBind(this);
        }
    };
    WebinosService.prototype.bind = WebinosService.prototype.bindService;

    WebinosService.prototype.unbindService = function(){};
    WebinosService.prototype.unbind = WebinosService.prototype.unbindService;

    exports.WebinosService = WebinosService;

})(window);
/*******************************************************************************
 * Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2011 Alexander Futasz, Fraunhofer FOKUS
 ******************************************************************************/

(function () {
    function isOnNode() {
        return typeof module === "object" ? true : false;
    }

    var typeMap = {};

    var registerServiceConstructor = function(serviceType, Constructor) {
        console.log("discovery: registered constructor for", serviceType);
        typeMap[serviceType] = Constructor;
    };
    if (typeof _webinos !== 'undefined') _webinos.registerServiceConstructor = registerServiceConstructor;

    if (isOnNode()) {
       var Context = require(path.join(webinosRoot, dependencies.wrt.location, 'lib/webinos.context.js')).Context;
    }

    /**
     * Interface DiscoveryInterface
     */
    var ServiceDiscovery = function (rpcHandler) {
        var _webinosReady = false;
        var callerCache = [];

        /**
         * Search for installed APIs.
         * @param APINameFilter String to filter API names.
         * @param successCB Callback to call with results.
         * @param errorCB Callback to call in case of error.
         */
        this.findConfigurableAPIs = function(APINameFilter, successCB, errorCB) {
            //Calls to this method can be constrained using dashboard's feature
            var rpc = rpcHandler.createRPC('ServiceDiscovery', 'findConfigurableAPIs', [{'api':'http://webinos.org/api/dashboard'}, APINameFilter]);
            rpcHandler.executeRPC(rpc
                    , function (params) { successCB(params); }
                    , function (params) { errorCB(params); }
            );
        };
        
        /**
         * Search for registered services.
         * @param {ServiceType} serviceType ServiceType object to search for.
         * @param {FindCallBack} callback Callback to call with results.
         * @param {Options} options Timeout, optional.
         * @param {Filter} filter Filters based on location, name, description, optional.
         */
        this.findServices = function (serviceType, callback, options, filter) {
            var that = this;
            var findOp;

            var typeMapCompatible = {};
            if (typeof ActuatorModule !== 'undefined') typeMapCompatible['http://webinos.org/api/actuators'] = ActuatorModule;
            if (typeof App2AppModule !== 'undefined') typeMapCompatible['http://webinos.org/api/app2app'] = App2AppModule;
            if (typeof AppLauncherModule !== 'undefined') typeMapCompatible['http://webinos.org/api/applauncher'] = AppLauncherModule;
            if (typeof AuthenticationModule !== 'undefined') typeMapCompatible['http://webinos.org/api/authentication'] = AuthenticationModule;
            if (typeof webinos.Context !== 'undefined') typeMapCompatible['http://webinos.org/api/context'] = webinos.Context;
            if (typeof corePZinformationModule !== 'undefined') typeMapCompatible['http://webinos.org/api/corePZinformation'] = corePZinformationModule;
            if (typeof DeviceStatusManager !== 'undefined') typeMapCompatible['http://webinos.org/api/devicestatus'] = DeviceStatusManager;
            if (typeof DiscoveryModule !== 'undefined') typeMapCompatible['http://webinos.org/api/discovery'] = DiscoveryModule;
            if (typeof EventsModule !== 'undefined') typeMapCompatible['http://webinos.org/api/events'] = EventsModule;
            if (webinos.file && webinos.file.Service) typeMapCompatible['http://webinos.org/api/file'] = webinos.file.Service;
            if (typeof MediaContentModule !== 'undefined') typeMapCompatible['http://webinos.org/api/mediacontent'] = MediaContentModule;
            if (typeof NfcModule !== 'undefined') typeMapCompatible['http://webinos.org/api/nfc'] = NfcModule;
            if (typeof WebNotificationModule !== 'undefined') typeMapCompatible['http://webinos.org/api/notifications'] = WebNotificationModule;
            if (typeof WebinosDeviceOrientation !== 'undefined') typeMapCompatible['http://webinos.org/api/deviceorientation'] = WebinosDeviceOrientation;
            if (typeof PaymentModule !== 'undefined') typeMapCompatible['http://webinos.org/api/payment'] = PaymentModule;
            if (typeof Sensor !== 'undefined') typeMapCompatible['http://webinos.org/api/sensors'] = Sensor;
            if (typeof TestModule !== 'undefined') typeMap['http://webinos.org/api/test'] = TestModule;
            if (typeof TVManager !== 'undefined') typeMapCompatible['http://webinos.org/api/tv'] = TVManager;
            if (typeof Vehicle !== 'undefined') typeMapCompatible['http://webinos.org/api/vehicle'] = Vehicle;
            if (typeof WebinosGeolocation !== 'undefined') typeMapCompatible['http://webinos.org/api/w3c/geolocation'] = WebinosGeolocation;
            if (typeof WebinosGeolocation !== 'undefined') typeMapCompatible['http://www.w3.org/ns/api-perms/geolocation'] = WebinosGeolocation; // old feature URI for compatibility
            if (typeof Contacts !== 'undefined') typeMapCompatible['http://www.w3.org/ns/api-perms/contacts'] = Contacts;
            if (typeof ZoneNotificationModule !== 'undefined') typeMapCompatible['http://webinos.org/api/internal/zonenotification'] = ZoneNotificationModule;
//            if (typeof DiscoveryModule !== 'undefined') typeMapCompatible['http://webinos.org/manager/discovery/bluetooth'] = DiscoveryModule;
            if (typeof oAuthModule !== 'undefined') typeMapCompatible['http://webinos.org/mwc/oauth'] = oAuthModule;
            if (typeof PolicyManagementModule !== 'undefined') typeMapCompatible['http://webinos.org/core/policymanagement'] = PolicyManagementModule;

            
            var rpc = rpcHandler.createRPC('ServiceDiscovery', 'findServices',
                    [serviceType, options, filter]);
            
            var timer = setTimeout(function () {
                rpcHandler.unregisterCallbackObject(rpc);
                // If no results return TimeoutError.
                if (!findOp.found && typeof callback.onError === 'function') {
                    callback.onError(new DOMError('TimeoutError', ''));
                }
            }, options && typeof options.timeout !== 'undefined' ?
                        options.timeout : 120000 // default timeout 120 secs
            );
            
            findOp = new PendingOperation(function() {
                // remove waiting requests from callerCache
                var index = callerCache.indexOf(rpc);
                if (index >= 0) {
                    callerCache.splice(index, 1);
                }
                rpcHandler.unregisterCallbackObject(rpc);
                if (typeof callback.onError === 'function') {
                    callback.onError(new DOMError('AbortError', ''));
                }
            }, timer);
            
            var success = function (params) {
                console.log("servicedisco: service found.");
                var baseServiceObj = params;

                // reduce feature uri to base form, e.g. http://webinos.org/api/sensors
                // instead of http://webinos.org/api/sensors/light etc.
                var stype = /.+(?:api|ns|manager|mwc|core)\/(?:w3c\/|api-perms\/|internal\/|discovery\/)?[^\/\.]+/.exec(baseServiceObj.api);
                stype = stype ? stype[0] : undefined;

                var ServiceConstructor = typeMap[stype] || typeMapCompatible[stype];
                if (ServiceConstructor) {
                    // elevate baseServiceObj to usable local WebinosService object
                    var service = new ServiceConstructor(baseServiceObj, rpcHandler);
                    findOp.found = true;
                    callback.onFound(service);
                } else {
                    var serviceErrorMsg = 'Cannot instantiate webinos service.';
                    if (typeof callback.onError === 'function') {
                        callback.onError(new DiscoveryError(102, serviceErrorMsg));
                    }
                }
            }; // End of function success
            
            // The core of findService.
            rpc.onservicefound = function (params) {
                // params is the parameters needed by the API method.
                success(params);
            };

            // denied by policy manager
            rpc.onSecurityError = function (params) {
                clearTimeout(timer);
                if (typeof callback.onError === 'function') {
                    callback.onError(new DOMError('SecurityError', ''));
                }
            };
            
            // Add this pending operation.
            rpcHandler.registerCallbackObject(rpc);
            
            if (typeof rpcHandler.parent !== 'undefined') {
                rpc.serviceAddress = rpcHandler.parent.config.pzhId;
            } else {
                rpc.serviceAddress = webinos.session.getServiceLocation();
            }
            
            if (!isOnNode() && !_webinosReady) {
                callerCache.push(rpc);
            } else {
                // Only do it when _webinosReady is true.
                rpcHandler.executeRPC(rpc);
            }
            
            return findOp;
        };  // End of findServices.
        
        if (isOnNode()) {
            return;
        }
        
        // further code only runs in the browser
        
        webinos.session.addListener('registeredBrowser', function () {
            _webinosReady = true;
            for (var i = 0; i < callerCache.length; i++) {
                var req = callerCache[i];
                rpcHandler.executeRPC(req);
            }
            callerCache = [];
        });
    };
    
    /**
     * Export definitions for node.js
     */
    if (isOnNode()) {
        exports.ServiceDiscovery = ServiceDiscovery;
    } else {
        // this adds ServiceDiscovery to the window object in the browser
        window.ServiceDiscovery = ServiceDiscovery;
    }
    
    /**
     * Interface PendingOperation
     */
    function PendingOperation(cancelFunc, timer) {
        this.found = false;
        
        this.cancel = function () {
            clearTimeout(timer);
            cancelFunc();
        };
    }
    
    function DOMError(name, message) {
        return {
            name: name,
            message: message
        };
    }

    webinos.discovery = new ServiceDiscovery (webinos.rpcHandler);
    webinos.ServiceDiscovery = webinos.discovery; // for backward compat
}());
/*******************************************************************************
 * Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 ******************************************************************************/

(function () {
    function isOnNode() {
        return typeof module === "object" ? true : false;
    }

    /**
     * Interface ConfigurationInterface
     */
    var ServiceConfiguration = function (rpcHandler) {

        /**
         * Get current configuration for a specified API.
         * @param apiName Name of source API.
         * @param successCB Callback to call with results.
         * @param errorCB Callback to call in case of error.
         */
        this.getServiceConfiguration = function(apiName, successCB, errorCB) {
            //Calls to this method can be constrained using dashboard's feature
            var rpc = rpcHandler.createRPC('ServiceConfiguration', 'getServiceConfiguration', [{'api':'http://webinos.org/api/dashboard'}, apiName]);
            rpcHandler.executeRPC(rpc
                    , function (params) { successCB(params); }
                    , function (params) { errorCB(params); }
            );
        };
        
        /**
         * Set configuration to a specified API.
         * @param apiName Name of target API.
         * @param config Configuration to apply. It updates the params field in the config.json file
         * @param successCB Callback to call with results.
         * @param errorCB Callback to call in case of error.
         */
        this.setServiceConfiguration = function(apiName, config, successCB, errorCB) {
            //Calls to this method can be constrained using dashboard's feature
            var rpc = rpcHandler.createRPC('ServiceConfiguration', 'setServiceConfiguration', [{'api':'http://webinos.org/api/dashboard'}, apiName, config]);
            rpcHandler.executeRPC(rpc
                    , function (params) { successCB(params); }
                    , function (params) { errorCB(params); }
            );
        };
    };

    /**
     * Export definitions for node.js
     */
    if (isOnNode()) {
        exports.ServiceConfiguration = ServiceConfiguration;
    } else {
        // this adds ServiceDiscovery to the window object in the browser
        window.ServiceConfiguration = ServiceConfiguration;
    }
    
    webinos.configuration = new ServiceConfiguration (webinos.rpcHandler);
}());
/*******************************************************************************
 *  Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2013 EPU-National Technical University of Athens
 * Author: Christos Botsikas, NTUA
 ******************************************************************************/

(function () {
    var tokenId=null;
//    var pendingResponse = false;
    if (tokenId = window.location.search.match(/(?:[?&])tokenId=([a-zA-Z0-9-_]*)(?:&.*|)$/)){
       tokenId = tokenId[1];
    }else if (typeof widget !== 'undefined' && widget.args && widget.args.tokenId){
        tokenId = widget.args.tokenId;
    }
    var Dashboard = function(rpcHandler){
        this.open = function(options, successCB, errorCB){
            if (typeof successCB != "function") successCB = function(){};
            if (typeof errorCB != "function") errorCB = function(){};
            var rpc = rpcHandler.createRPC('Dashboard', 'open', {options:options});
            webinos.rpcHandler.executeRPC(rpc,
                function (params){
                    successCB(params);
                },
                function (error){
                    errorCB(error);
                }
            );
            return {
                onAction: function(callback){
                    if (typeof callback != "function") return;
                    rpc.onAction = function(params){
                        callback(params);
                        webinos.rpcHandler.unregisterCallbackObject(rpc);
                    };
                    webinos.rpcHandler.registerCallbackObject(rpc);
                }
            }
        };
        this.getData = function(successCB, errorCB){
            if (tokenId == null){
                errorCB("No token found.");
                return;
            }
            this.getDataForTokenId(tokenId, successCB, errorCB);
        };
        this.getDataForTokenId = function(tokenId, successCB, errorCB){
            if (typeof successCB != "function") successCB = function(){};
            if (typeof errorCB != "function") errorCB = function(){};
            var rpc = rpcHandler.createRPC('Dashboard', 'getTokenData', {tokenId:tokenId});
            webinos.rpcHandler.executeRPC(rpc,
                function (params){
//                    pendingResponse = true;
                    successCB(params);
                },
                function (error){
                    errorCB(error);
                }
            );
        };
        this.actionComplete = function(data, successCB, errorCB){
            if (tokenId == null){
                errorCB("No token found.");
                return;
            }
            pendingResponse = false;
            if (typeof successCB != "function") successCB = function(){};
            if (typeof errorCB != "function") errorCB = function(){};
            var rpc = rpcHandler.createRPC('Dashboard', 'actionComplete', {tokenId:tokenId, data:data});
            webinos.rpcHandler.executeRPC(rpc,
                function (params){
                    successCB(params);
                },
                function (error){
                    errorCB(error);
                }
            );
        };
    };

    webinos.dashboard = new Dashboard(webinos.rpcHandler);
}());
/*******************************************************************************
 * Code contributed to the Webinos project.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2012 Fabian Walraven, TNO
 ******************************************************************************/

(function() {
  App2AppModule = function (params) {

    this.base = WebinosService;
    this.base(params);

    this.peerId = generateIdentifier();

    console.log("Creating app2app instance with peer Id " + this.peerId);
    registerPeer(this,
      function (success) {
        console.log("Bind succeeded: registered peer.");
      },
      function (error) {
        console.log("Bind failed: could not register peer: " + error.message);
      }
    );

  };

  App2AppModule.prototype = new WebinosService();

  App2AppModule.prototype.bindService = function (bindCallback) {
    if (typeof bindCallback.onBind === 'function') {
      bindCallback.onBind(this);
    }
  };

  App2AppModule.prototype.unbindService = function (successCallback, errorCallback) {
    var params = {};
    params.peerId = this.peerId;

    var rpc = webinos.rpcHandler.createRPC(this, "unregisterPeer", params);

    webinos.rpcHandler.executeRPC(rpc,
      function (success) {
        successCallback(success);
      },
      function (error) {
        errorCallback(error);
      }
    );
  };

  /* Administration */

  var CHANNEL_NAMESPACE_REGEXP = /^urn:[a-z0-9][a-z0-9\-]{0,31}:[a-z0-9()+,\-.:=@;$_!*'%\/?#]+$/i;
  var CHANNEL_SEARCH_TIMEOUT = 5000;

  var MODE_SEND_RECEIVE = "send-receive";
  var MODE_RECEIVE_ONLY = "receive-only";

  var requestCallbacks = {};
  var messageCallbacks = {};
  var searchCallbacks = {};

  /* Initialisation helpers */

  function registerPeer(serviceInstance, successCallback, errorCallback) {
    var params = {};
    params.peerId = serviceInstance.peerId;

    var rpc = webinos.rpcHandler.createRPC(serviceInstance, "registerPeer", params);

    // setup callback dispatcher for incoming channel connect requests
    rpc.handleConnectRequest = function (connectRequest, requestSuccessCallback, requestErrorCallback) {
      dispatchConnectRequest(connectRequest, requestSuccessCallback, requestErrorCallback);
    };

    // setup callback dispatcher for incoming channel messages
    rpc.handleChannelMessage = function (channelMessage, messageSuccessCallback, messageErrorCallback) {
      dispatchChannelMessage(channelMessage, messageSuccessCallback, messageErrorCallback);
    };

    // setup callback dispatcher for incoming search results
    rpc.handleChannelSearchResult = function (searchResult, searchSuccessCallback, searchErrorCallback) {
      dispatchChannelSearchResult(serviceInstance, searchResult, searchSuccessCallback, searchErrorCallback);
    };

    webinos.rpcHandler.registerCallbackObject(rpc);

    webinos.rpcHandler.executeRPC(rpc,
      function (success) {
        successCallback(success);
      },
      function (error) {
        errorCallback(error);
      }
    );
  }

  /* Local callback dispatchers */

  function dispatchConnectRequest(connectRequest, successCallback, errorCallback) {
    console.log("Received channel request from proxy " + connectRequest.from.proxyId);
    if (requestCallbacks.hasOwnProperty(connectRequest.namespace)) {
      var requestCallback = requestCallbacks[connectRequest.namespace];
      var isAllowed = requestCallback(connectRequest);

      if (isAllowed) {
        successCallback();
      } else {
        errorCallback(respondWith("Channel creator rejected connect request."));
      }
    } else {
      errorCallback(respondWith("No request callback found for namespace " + connectRequest.namespace));
    }
  }

  function dispatchChannelMessage(channelMessage, successCallback, errorCallback) {
    console.log("Received channel message from proxy " + channelMessage.from.proxyId);

    if (messageCallbacks.hasOwnProperty(channelMessage.to.proxyId)) {
      var messageCallback = messageCallbacks[channelMessage.to.proxyId];
      messageCallback(channelMessage);
      successCallback();
    } else {
      errorCallback(respondWith("No message callback found for namespace " + channelMessage.namespace));
    }
  }

  function dispatchChannelSearchResult(serviceInstance, searchResult, successCallback, errorCallback) {
    var channel = searchResult.channel;
    var proxyId = searchResult.proxyId;

    console.log("Received channel search result with namespace " + channel.namespace);
    if (searchCallbacks.hasOwnProperty(serviceInstance.peerId)) {
      var callback = searchCallbacks[serviceInstance.peerId];
      callback(new ChannelProxy(serviceInstance, channel, proxyId));
      successCallback();
    } else {
      errorCallback(respondWith("No search result callback found for namespace " + searchResult.namespace));
    }
  }

  /* Public API functions */

  /**
   * Create a new channel.
   *
   * The configuration object should contain "namespace", "properties" and optionally "appInfo".
   *
   * Namespace is a valid URN which uniquely identifies the channel in the personal zone.
   *
   * Properties currently contain "mode" and optionally "canDetach" and "reclaimIfExists".
   *
   * The mode can be either "send-receive" or "receive-only". The "send-receive" mode allows both the channel creator
   * and connected clients to send and receive, while "receive-only" only allows the channel creator to send.
   *
   * If canDetach is true it allows the channel creator to disconnect from the channel without closing the channel.
   *
   * appInfo allows a channel creator to attach application-specific information to a channel.
   *
   * The channel creator can decide which clients are allowed to connect to the channel. For each client which wants to
   * connect to the channel the requestCallback is invoked which should return true (if allowed to connect) or false.
   * If no requestCallback is defined all connect requests are granted.
   *
   * If the channel namespace already exists the error callback is invoked, unless the reclaimIfExists property is set to
   * true, in which case it is considered a reconnect of the channel creator. Reclaiming only succeeds when the request
   * originates from the same session as the original channel creator. If so, its bindings are refreshed (the mode and
   * appInfo of the existing channel are not modified).
   *
   * @param configuration Channel configuration.
   * @param requestCallback Callback invoked to allow or deny clients access to a channel.
   * @param messageCallback Callback invoked to receive messages.
   * @param successCallback Callback invoked when channel creation was successful.
   * @param errorCallback Callback invoked when channel creation failed.
   */
  App2AppModule.prototype.createChannel = function(configuration, requestCallback, messageCallback, successCallback, errorCallback) {

    // sanity checks

    if (typeof errorCallback !== "function") errorCallback = function() {};

    if (typeof successCallback !== "function") {
      errorCallback(respondWith("Invalid success callback to return the channel proxy."));
      return;
    }

    if (typeof configuration === "undefined") {
      errorCallback(respondWith("Missing configuration."));
      return;
    }

    if ( ! CHANNEL_NAMESPACE_REGEXP.test(configuration.namespace)) {
      errorCallback(respondWith("Namespace is not a valid URN."));
      return;
    }

    if ( ! configuration.hasOwnProperty("properties")) {
      errorCallback(respondWith("Missing properties in configuration."));
      return;
    }

    if ( ! configuration.properties.hasOwnProperty("mode")) {
      errorCallback(respondWith("Missing channel mode in configuration."));
      return;
    }

    if (configuration.properties.mode !== MODE_SEND_RECEIVE && configuration.properties.mode !== MODE_RECEIVE_ONLY) {
      errorCallback(respondWith("Unsupported channel mode."));
      return;
    }

    if (typeof messageCallback !== "function") {
      errorCallback(respondWith("Invalid message callback."));
      return;
    }

    var params = {};
    params.peerId = this.peerId;
    params.sessionId = webinos.session.getSessionId();
    params.namespace = configuration.namespace;
    params.properties = configuration.properties;
    params.appInfo = configuration.appInfo;
    params.hasRequestCallback = (typeof requestCallback === "function");

    var that = this;
    var rpc = webinos.rpcHandler.createRPC(this, "createChannel", params);
    webinos.rpcHandler.executeRPC(rpc,
      function(channel) {
        requestCallbacks[channel.namespace] = requestCallback;
        messageCallbacks[channel.creator.proxyId] = messageCallback;
        successCallback(new ChannelProxy(that, channel, channel.creator.proxyId));
      },
      function(error) {
        console.log("Could not create channel: " + error.message);
        errorCallback(error);
      }
    );
  };

  /**
   * Search for channels with given namespace, within its own personal zone. It returns a proxy to a found
   * channel through the searchCallback function. Only a single search can be active on a peer at the same time,
   * and a search automatically times out after 5 seconds.
   *
   * @param namespace A valid URN of the channel to be found (see RFC2141). If the NSS is a wildcard ("*")
   *  all channels with the same NID are returned.
   * @param zoneIds Not implemented yet.
   * @param searchCallback Callback function invoked for each channel that is found. A proxy to the channel is
   *  provided as an argument. The proxy is not yet connected to the actual channel; to use it one first has to call
   *  its connect method.
   * @param successCallback Callback invoked when the search is accepted for processing.
   * @param errorCallback Callback invoked when search query could not be processed.
   */
  App2AppModule.prototype.searchForChannels = function (namespace, zoneIds, searchCallback, successCallback, errorCallback) {

    // sanity checks

    if (typeof successCallback !== "function") successCallback = function() {};
    if (typeof errorCallback !== "function") errorCallback = function() {};

    if ( ! CHANNEL_NAMESPACE_REGEXP.test(namespace)) {
      errorCallback(respondWith("Namespace is not a valid URN."));
      return;
    }

    if (typeof searchCallback !== "function") {
      errorCallback(respondWith("Invalid search callback."));
      return;
    }

    var params = {};
    params.peerId = this.peerId;
    params.namespace = namespace;
    params.zoneIds = zoneIds;

    // we only allow a single search at a time
    if (searchCallbacks.hasOwnProperty(this.peerId)) {
      errorCallback(respondWith("There is already a search in progress."));
      return;
    }

    // set current search callback
    searchCallbacks[this.peerId] = searchCallback;

    // save reference in context
    var that = this;

    var timeoutId = setTimeout(function() {
      console.log("Hit channel search timeout, remove callback");
      delete searchCallbacks[that.peerId];
    }, CHANNEL_SEARCH_TIMEOUT);

    var rpc = webinos.rpcHandler.createRPC(this, "searchForChannels", params);
    webinos.rpcHandler.executeRPC(rpc,
      function(success) {
        successCallback(success);
      },
      function(error) {
        console.log("Could not search for channels: " + error.message);
        errorCallback(error);
      }
    );

    var pendingOperation = {};
    pendingOperation.cancel = function() {
      if (searchCallbacks[that.peerId]) {
        clearTimeout(timeoutId);
        delete searchCallbacks[that.peerId];
      }
    };

    return pendingOperation;
  };

  /* Channel proxy implementation */

  function ChannelProxy(serviceInstance, channel, proxyId) {
    this.serviceInstance = serviceInstance;
    this.client = {};
    this.client.peerId = serviceInstance.peerId;
    this.client.proxyId = proxyId;

    this.creator = channel.creator;
    this.namespace = channel.namespace;
    this.properties = channel.properties;
    this.appInfo = channel.appInfo;
  }

  /**
   * Connect to the channel. The connect request is forwarded to the channel creator, which decides if a client
   * is allowed to connect. The client can provide application-specific info with the request through the
   * requestInfo parameter.
   *
   * @param requestInfo Application-specific information to include in the request.
   * @param messageCallback Callback invoked when a message is received on the channel (only after successful connect).
   * @param successCallback Callback invoked if the client is successfully connected to the channel (i.e. if authorized)
   * @param errorCallback Callback invoked if the client could not be connected to the channel.
   */
  ChannelProxy.prototype.connect = function (requestInfo, messageCallback, successCallback, errorCallback) {

    // sanity checks

    if (typeof successCallback !== "function") successCallback = function() {};
    if (typeof errorCallback !== "function") errorCallback = function() {};

    if (typeof messageCallback !== "function") {
      errorCallback(respondWith("Invalid message callback."));
      return;
    }

    var params = {};
    params.from = this.client;
    params.requestInfo = requestInfo;
    params.namespace = this.namespace;

    var rpc = webinos.rpcHandler.createRPC(this.serviceInstance, "connectToChannel", params);
    webinos.rpcHandler.executeRPC(rpc,
      function (client) {
        messageCallbacks[client.proxyId] = messageCallback;
        successCallback();
      },
      function (error) {
        console.log("Could not search for channels: " + error.message);
        errorCallback(error);
      }
    );
  };

  /**
   * Send a message to all connected clients on the channel.
   *
   * @param message The message to be send.
   * @param successCallback Callback invoked when the message is accepted for processing.
   * @param errorCallback Callback invoked if the message could not be processed.
   */
  ChannelProxy.prototype.send = function (message, successCallback, errorCallback) {

    // sanity checks

    if (typeof successCallback !== "function") successCallback = function() {};
    if (typeof errorCallback !== "function") errorCallback = function() {};

    if (typeof message === "undefined") {
      errorCallback(respondWith("Invalid message."));
      return;
    }

    var params = {};
    params.from = this.client;
    params.namespace = this.namespace;
    params.clientMessage = message;

    var rpc = webinos.rpcHandler.createRPC(this.serviceInstance, "sendToChannel", params);
    webinos.rpcHandler.executeRPC(rpc,
      function (success) {
        successCallback();
      },
      function (error) {
        console.log("Could not send to channel: " + error.message);
        errorCallback(error);
      }
    );
  };

  /**
   * Send to a specific client only. The client object of the channel creator is a property of the channel proxy. The
   * App2App Messaging API does not include a discovery mechanism for clients. A channel creator obtains the client
   * objects for each client through its connectRequestCallback, and if needed the channel creator can implement
   * an application-specific lookup service to other clients. A client object only has meaning within the scope of its
   * channel, not across channels. Note that the client object of a message sender can also be found in the "from"
   * property of the message.
   *
   * @param client The client object of the client to send the message to.
   * @param message The message to be send.
   * @param successCallback Callback invoked when the message is accepted for processing.
   * @param errorCallback Callback invoked if the message could not be processed.
   */
  ChannelProxy.prototype.sendTo = function (client, message, successCallback, errorCallback) {

    // sanity checks

    if (typeof successCallback !== "function") successCallback = function() {};
    if (typeof errorCallback !== "function") errorCallback = function() {};

    if ( ! isValidClient(client)) {
      errorCallback(respondWith("Invalid client."));
      return;
    }

    if (typeof message === "undefined") {
      errorCallback(respondWith("Invalid message."));
      return;
    }

    var params = {};
    params.from = this.client;
    params.to = client;
    params.namespace = this.namespace;
    params.clientMessage = message;

    var rpc = webinos.rpcHandler.createRPC(this.serviceInstance, "sendToChannel", params);
    webinos.rpcHandler.executeRPC(rpc,
      function (success) {
        successCallback();
      },
      function (error) {
        console.log("Could not send to channel: " + error.message);
        errorCallback(error);
      }
    );
  };

  /**
   * Disconnect from the channel. After disconnecting the client does no longer receive messages from the channel.
   * If the channel creator disconnects, the channel is closed and is no longer available. The service
   * does not inform connected clients of the disconnect or closing. If needed the client can send an
   * application-specific message to inform other clients before disconnecting.
   *
   * @param successCallback Callback invoked when the disconnect request is accepted for processing.
   * @param errorCallback Callback invoked if the disconnect request could not be processed.
   */
  ChannelProxy.prototype.disconnect = function (successCallback, errorCallback) {

    // sanity checks

    if (typeof successCallback !== "function") successCallback = function() {};
    if (typeof errorCallback !== "function") errorCallback = function() {};

    var params = {};
    params.from = this.client;
    params.namespace = this.namespace;

    var rpc = webinos.rpcHandler.createRPC(this.serviceInstance, "disconnectFromChannel", params);
    webinos.rpcHandler.executeRPC(rpc,
      function (success) {
        successCallback();
      },
      function (error) {
        console.log("Could not disconnect from channel: " + error.message);
        errorCallback(error);
      }
    );
  };

  /* Helpers */

  function isValidClient(client) {
    return typeof client !== "undefined" &&
      client.hasOwnProperty("peerId") &&
      client.hasOwnProperty("proxyId");
  }

  function respondWith(message) {
    return {
      message: message
    };
  }

  function generateIdentifier() {
    function s4() {
      return ((1 + Math.random()) * 0x10000|0).toString(16).substr(1);
    }
    return s4() + s4() + s4();
  }

}());
/*******************************************************************************
*  Code contributed to the webinos project
* 
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*  
*     http://www.apache.org/licenses/LICENSE-2.0
*  
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
* 
* Copyright 2012 Andr� Paul, Fraunhofer FOKUS
******************************************************************************/
(function() {

	//AppLauncher Module Functionality
	
	/**
	 * Webinos AppLauncher service constructor (client side).
	 * @constructor
	 * @param obj Object containing displayName, api, etc.
	 */
	AppLauncherModule = function(obj) {
		this.base = WebinosService;
		this.base(obj);
	};
	
	AppLauncherModule.prototype = new WebinosService();

	/**
	 * To bind the service.
	 * @param bindCB BindCallback object.
	 */
	AppLauncherModule.prototype.bind = function(bindCB) {
		if (typeof bindCB.onBind === 'function') {
			bindCB.onBind(this);
		};
	};
	
	/**
	 * Launches an application.
	 * @param successCallback Success callback.
	 * @param errorCallback Error callback.
	 * @param appURI Application ID to be launched.
	 */
	AppLauncherModule.prototype.launchApplication = function (successCallback, errorCallback, appURI){

		var rpc = webinos.rpcHandler.createRPC(this, "launchApplication", [appURI]);
		webinos.rpcHandler.executeRPC(rpc,
				function (params){
					successCallback(params);
				},
				function (error){
					errorCallback(error);
				}
		);

	};
    
	/**
	 * Reports if an application is isntalled.
	 * [not yet implemented]
	 * @param applicationID Application ID to test if installed.
	 * @returns Boolean whether application is installed.
	 */
	AppLauncherModule.prototype.appInstalled = function(successCallback, errorCallback, appURI){

		var rpc = webinos.rpcHandler.createRPC(this, "appInstalled", [appURI]);
		webinos.rpcHandler.executeRPC(rpc,
				function (params){
					successCallback(params);
				},
				function (error){
					errorCallback(error);
				}
		);
    
	};
	
	
}());(function () {
	var PropertyValueSuccessCallback, ErrorCallback, DeviceAPIError, PropertyRef;

	DeviceStatusManager = function (obj) {
		this.base = WebinosService;
		this.base(obj);
	};
	
	DeviceStatusManager.prototype = new WebinosService;

	DeviceStatusManager.prototype.bindService = function (bindCB, serviceId) {
		// actually there should be an auth check here or whatever, but we just always bind
		this.getComponents = getComponents;
		this.isSupported = isSupported;
		this.getPropertyValue = getPropertyValue;

		if (typeof bindCB.onBind === 'function') {
			bindCB.onBind(this);
		};
	}

	function getComponents (aspect, successCallback, errorCallback)	{
		var rpc = webinos.rpcHandler.createRPC(this, "devicestatus.getComponents", [aspect]);
		webinos.rpcHandler.executeRPC(rpc,
			function (params) { successCallback(params); }
		);
		return;
	}

	function isSupported (aspect, property, successCallback)
	{
		var rpc = webinos.rpcHandler.createRPC(this, "devicestatus.isSupported", [aspect, property]);
		webinos.rpcHandler.executeRPC(
			rpc, 
			function (res) { successCallback(res); }
		);
		return;
	}

	function getPropertyValue (successCallback, errorCallback, prop) {
		var rpc = webinos.rpcHandler.createRPC(this, "devicestatus.getPropertyValue", [prop]);
		webinos.rpcHandler.executeRPC(
			rpc, 
			function (params) { successCallback(params); },
			function (err) { errorCallback(err); }
		);
		return;
	};

	PropertyValueSuccessCallback = function () {};

	PropertyValueSuccessCallback.prototype.onSuccess = function (prop) {
		return;
	};

	ErrorCallback = function () {};

	ErrorCallback.prototype.onError = function (error) {
		return;
	};

	DeviceAPIError = function () {
		this.message = String;
		this.code = Number;
	};

	DeviceAPIError.prototype.UNKNOWN_ERR                    = 0;
	DeviceAPIError.prototype.INDEX_SIZE_ERR                 = 1;
	DeviceAPIError.prototype.DOMSTRING_SIZE_ERR             = 2;
	DeviceAPIError.prototype.HIERARCHY_REQUEST_ERR          = 3;
	DeviceAPIError.prototype.WRONG_DOCUMENT_ERR             = 4;
	DeviceAPIError.prototype.INVALID_CHARACTER_ERR          = 5;
	DeviceAPIError.prototype.NO_DATA_ALLOWED_ERR            = 6;
	DeviceAPIError.prototype.NO_MODIFICATION_ALLOWED_ERR    = 7;
	DeviceAPIError.prototype.NOT_FOUND_ERR                  = 8;
	DeviceAPIError.prototype.NOT_SUPPORTED_ERR              = 9;
	DeviceAPIError.prototype.INUSE_ATTRIBUTE_ERR            = 10;
	DeviceAPIError.prototype.INVALID_STATE_ERR              = 11;
	DeviceAPIError.prototype.SYNTAX_ERR                     = 12;
	DeviceAPIError.prototype.INVALID_MODIFICATION_ERR       = 13;
	DeviceAPIError.prototype.NAMESPACE_ERR                  = 14;
	DeviceAPIError.prototype.INVALID_ACCESS_ERR             = 15;
	DeviceAPIError.prototype.VALIDATION_ERR                 = 16;
	DeviceAPIError.prototype.TYPE_MISMATCH_ERR              = 17;
	DeviceAPIError.prototype.SECURITY_ERR                   = 18;
	DeviceAPIError.prototype.NETWORK_ERR                    = 19;
	DeviceAPIError.prototype.ABORT_ERR                      = 20;
	DeviceAPIError.prototype.TIMEOUT_ERR                    = 21;
	DeviceAPIError.prototype.INVALID_VALUES_ERR             = 22;
	DeviceAPIError.prototype.NOT_AVAILABLE_ERR              = 101;
	DeviceAPIError.prototype.code = Number;
	DeviceAPIError.prototype.message = Number;

	PropertyRef = function () {
		this.component = String;
		this.aspect = String;
		this.property = String;
	};

	PropertyRef.prototype.component = String;
	PropertyRef.prototype.aspect = String;
	PropertyRef.prototype.property = String;

}());
/*******************************************************************************
 * Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2012 Felix-Johannes Jendrusch, Fraunhofer FOKUS
 ******************************************************************************/

if (typeof webinos === "undefined") webinos = {};
if (typeof webinos.util === "undefined") webinos.util = {};

(function (exports) {
  exports.inherits = inherits;

  // webinos <3 inherits
  function inherits(c, p, proto) {
    proto = proto || {};
    var e = {};
    [c.prototype, proto].forEach(function (s) {
      Object.getOwnPropertyNames(s).forEach(function (k) {
        e[k] = Object.getOwnPropertyDescriptor(s, k);
      });
    });
    c.prototype = Object.create(p.prototype, e);
    c.super_ = p;
  }

  exports.CustomError = CustomError;

  inherits(CustomError, Error);
  function CustomError(name, message) {
    Error.call(this, message || name);

    this.name = name;
  }

  exports.EventTarget = EventTarget;

  function EventTarget() {}

  EventTarget.prototype.addEventListener = function (type, listener) {
    if (typeof this.events === "undefined") this.events = {};
    if (typeof this.events[type] === "undefined") this.events[type] = [];

    this.events[type].push(listener);
  };

  EventTarget.prototype.removeEventListener = function (type, listener) {
    if (typeof this.events === "undefined" ||
        typeof this.events[type] === "undefined") {
      return;
    }

    var position = this.events[type].indexOf(listener);
    if (position >= 0) {
      this.events[type].splice(position, 1);
    }
  };

  EventTarget.prototype.removeAllListeners = function (type) {
    if (arguments.length === 0) {
      this.events = {};
    } else if (typeof this.events !== "undefined" &&
               typeof this.events[type] !== "undefined") {
      this.events[type] = [];
    }
  };

  EventTarget.prototype.dispatchEvent = function (event) {
    if (typeof this.events === "undefined" ||
        typeof this.events[event.type] === "undefined") {
      return false;
    }

    var listeners = this.events[event.type].slice();
    if (!listeners.length) return false;

    for (var i = 0, length = listeners.length; i < length; i++) {
      listeners[i].call(this, event);
    }

    return true;
  };

  exports.Event = Event;

  function Event(type) {
    this.type = type;
    this.timeStamp = Date.now();
  }

  exports.ProgressEvent = ProgressEvent;

  inherits(ProgressEvent, Event);
  function ProgressEvent(type, eventInitDict) {
    Event.call(this, type);

    eventInitDict = eventInitDict || {};

    this.lengthComputable = eventInitDict.lengthComputable || false;
    this.loaded = eventInitDict.loaded || 0;
    this.total = eventInitDict.total || 0;
  }

  exports.callback = function (maybeCallback) {
    if (typeof maybeCallback !== "function") {
      return function () {};
    }
    return maybeCallback;
  };

  exports.async = function (callback) {
    if (typeof callback !== "function") {
      return callback;
    }
    return function () {
      var argsArray = arguments;
      window.setTimeout(function () {
        callback.apply(null, argsArray);
      }, 0);
    };
  };

  exports.ab2hex = function (buf) {
    var hex = "";
    var view = new Uint8Array(buf);
    for (var i = 0; i < view.length; i++) {
      var repr = view[i].toString(16);
      hex += (repr.length < 2 ? "0" : "") + repr;
    }
    return hex;
  };

  exports.hex2ab = function (hex) {
    var buf = new ArrayBuffer(hex.length / 2);
    var view = new Uint8Array(buf);
    for (var i = 0; i < view.length; i++) {
      view[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return buf;
  }
})(webinos.util);
/*******************************************************************************
 * Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2012 Felix-Johannes Jendrusch, Fraunhofer FOKUS
 ******************************************************************************/

if (typeof webinos === "undefined") webinos = {};
if (typeof webinos.path === "undefined") webinos.path = {};

// webinos <3 node.js
(function (exports) {
  var splitPathRe = /^(\/?)([\s\S]+\/(?!$)|\/)?((?:\.{1,2}$|[\s\S]+?)?(\.[^.\/]*)?)$/;

  function splitPath(path) {
    var result = splitPathRe.exec(path);
    return [result[1] || "", result[2] || "", result[3] || "", result[4] || ""];
  }

  function normalizeArray(parts, allowAboveRoot) {
    var up = 0;
    for (var i = parts.length - 1; i >= 0; i--) {
      var part = parts[i];
      if (part === ".") {
        parts.splice(i, 1);
      } else if (part === "..") {
        parts.splice(i, 1);
        up++;
      } else if (up) {
        parts.splice(i, 1);
        up--;
      }
    }

    if (allowAboveRoot) {
      for (; up--;) {
        parts.unshift("..");
      }
    }

    return parts;
  }

  exports.normalize = function (path) {
    var isAbsolute = path.charAt(0) === "/"
      , trailingSlash = path.substr(-1) === "/";

    path = normalizeArray(path.split("/").filter(function (part) {
      return !!part;
    }), !isAbsolute).join("/");

    if (!path && !isAbsolute) {
      path = ".";
    }
    if (path && trailingSlash) {
      path += "/";
    }

    return (isAbsolute ? "/" : "") + path;
  };

  exports.join = function () {
    var paths = Array.prototype.slice.call(arguments, 0);
    return exports.normalize(paths.filter(function (path) {
      return path && typeof path === "string";
    }).join("/"));
  };

  exports.resolve = function () {
    var resolvedPath = ""
      , resolvedAbsolute = false;

    for (var i = arguments.length - 1; i >= 0 && !resolvedAbsolute; i--) {
      // TODO Use some fallback (e.g., the current working directory ..not)?
      var path = arguments[i];

      if (!path || typeof path !== "string") {
        continue;
      }

      resolvedPath = path + "/" + resolvedPath;
      resolvedAbsolute = path.charAt(0) === "/";
    }

    resolvedPath = normalizeArray(
      resolvedPath.split("/").filter(function (part) {
        return !!part;
      }
    ), !resolvedAbsolute).join("/");

    return ((resolvedAbsolute ? "/" : "") + resolvedPath) || ".";
  };

  exports.relative = function (from, to) {
    from = exports.resolve(from).substr(1);
    to = exports.resolve(to).substr(1);

    function trim(arr) {
      var start = 0;
      for (; start < arr.length; start++) {
        if (arr[start] !== "") break;
      }

      var end = arr.length - 1;
      for (; end >= 0; end--) {
        if (arr[end] !== "") break;
      }

      if (start > end) return [];
      return arr.slice(start, end - start + 1);
    }

    var fromParts = trim(from.split("/"));
    var toParts = trim(to.split("/"));

    var length = Math.min(fromParts.length, toParts.length);
    var samePartsLength = length;
    for (var i = 0; i < length; i++) {
      if (fromParts[i] !== toParts[i]) {
        samePartsLength = i;
        break;
      }
    }

    var outputParts = [];
    for (var i = samePartsLength; i < fromParts.length; i++) {
      outputParts.push("..");
    }

    outputParts = outputParts.concat(toParts.slice(samePartsLength));

    return outputParts.join("/");
  };

  // webinos <3 webkit
  exports.isParentOf = function (parent, mayBeChild) {
    if (parent === "/" && mayBeChild !== "/") {
      return true;
    }

    if (parent.length > mayBeChild.length || mayBeChild.indexOf(parent) !== 0) {
      return false;
    }

    if (mayBeChild.charAt(parent.length) !== "/") {
      return false;
    }

    return true;
  };

  exports.dirname = function (path) {
    var result = splitPath(path)
      , root = result[0]
      , dir = result[1];

    if (!root && !dir) {
      return ".";
    }

    if (dir) {
      dir = dir.substr(0, dir.length - 1);
    }

    return root + dir;
  };

  exports.basename = function (path, ext) {
    var file = splitPath(path)[2];

    if (ext && file.substr(-1 * ext.length) === ext) {
      file = file.substr(0, file.length - ext.length);
    }

    return file;
  };

  exports.extname = function (path) {
    return splitPath(path)[3];
  };
})(webinos.path);
/*******************************************************************************
 * Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2012 Felix-Johannes Jendrusch, Fraunhofer FOKUS
 ******************************************************************************/

// [WP-608] Support write/truncate abort

if (typeof webinos === "undefined") webinos = {};
if (typeof webinos.file === "undefined") webinos.file = {};

(function (exports) {
  exports.Service = Service;

  webinos.util.inherits(Service, WebinosService);
  function Service(object, rpc) {
    WebinosService.call(this, object);

    this.rpc = rpc;
  }

  Service.prototype.requestFileSystem = function (type, size, successCallback, errorCallback) {
    var self = this;
    var requestFileSystem = self.rpc.createRPC(self, "requestFileSystem");
    self.rpc.executeRPC(requestFileSystem, function (filesystem) {
      successCallback(new FileSystem(self, filesystem.name));
    }, errorCallback);
  };

  Service.prototype.resolveLocalFileSystemURL = function (url, successCallback, errorCallback) {
    webinos.util.async(errorCallback)(new webinos.util.CustomError("NotSupportedError"));
  };

  function FileSystem(service, name) {
    this.service = service;

    this.name = name;
    this.root = new DirectoryEntry(this, "/");
  }

  FileSystem.prototype.toJSON = function () {
    var json = { name : this.name };
    return json;
  };

  function Entry(filesystem, fullPath) {
    this.name = webinos.path.basename(fullPath);
    this.fullPath = fullPath;
    this.filesystem = filesystem;

    this.service = filesystem.service;
    this.rpc = filesystem.service.rpc;
  }

  Entry.prototype.isFile = false;
  Entry.prototype.isDirectory = false;

  Entry.prototype.getMetadata = function (successCallback, errorCallback) {
    var getMetadata = this.rpc.createRPC(this.service, "getMetadata", { entry : this });
    this.rpc.executeRPC(getMetadata, function (metadata) {
      successCallback(new Metadata(metadata));
    }, errorCallback);
  };

  Entry.prototype.moveTo = function (parent, newName, successCallback, errorCallback) {
    var self = this;
    if (self.service === parent.service) {
      var moveTo = self.rpc.createRPC(self.service, "moveTo", { source : self, parent : parent, newName : newName });
      self.rpc.executeRPC(moveTo, function (entry) {
        if (entry.isDirectory) {
          successCallback(new DirectoryEntry(self.filesystem, entry.fullPath));
        } else {
          successCallback(new FileEntry(self.filesystem, entry.fullPath));
        }
      }, errorCallback);
    } else {
      var getLink = self.rpc.createRPC(self.service, "getLink", { entry : self });
      self.rpc.executeRPC(getLink, function (link) {
        var download = parent.rpc.createRPC(parent.service, "download", { link : link, parent : parent, name : newName || self.name });
        parent.rpc.executeRPC(download, function (entry) {
          var remove = self.rpc.createRPC(self.service, (self.isDirectory ? "removeRecursively" : "remove"), { entry : self });
          self.rpc.executeRPC(remove, function () {
            if (entry.isDirectory) {
              successCallback(new DirectoryEntry(parent.filesystem, entry.fullPath));
            } else {
              successCallback(new FileEntry(parent.filesystem, entry.fullPath));
            }
          }, errorCallback);
        }, errorCallback);
      }, errorCallback);
    }
  };

  Entry.prototype.copyTo = function (parent, newName, successCallback, errorCallback) {
    var self = this;
    if (self.service === parent.service) {
      var copyTo = self.rpc.createRPC(self.service, "copyTo", { source : self, parent : parent, newName : newName });
      self.rpc.executeRPC(copyTo, function (entry) {
        if (entry.isDirectory) {
          successCallback(new DirectoryEntry(self.filesystem, entry.fullPath));
        } else {
          successCallback(new FileEntry(self.filesystem, entry.fullPath));
        }
      }, errorCallback);
    } else {
      var getLink = self.rpc.createRPC(self.service, "getLink", { entry : self });
      self.rpc.executeRPC(getLink, function (link) {
        var download = parent.rpc.createRPC(parent.service, "download", { link : link, parent : parent, name : newName || self.name });
        parent.rpc.executeRPC(download, function (entry) {
          if (entry.isDirectory) {
            successCallback(new DirectoryEntry(parent.filesystem, entry.fullPath));
          } else {
            successCallback(new FileEntry(parent.filesystem, entry.fullPath));
          }
        }, errorCallback);
      }, errorCallback);
    }
  };

  Entry.prototype.toURL = function () {
    throw new webinos.util.CustomError("NotSupportedError");
  };

  Entry.prototype.remove = function (successCallback, errorCallback) {
    var remove = this.rpc.createRPC(this.service, "remove", { entry : this });
    this.rpc.executeRPC(remove, successCallback, errorCallback);
  };

  Entry.prototype.getParent = function (successCallback, errorCallback) {
    var self = this;
    var getParent = self.rpc.createRPC(self.service, "getParent", { entry : self });
    self.rpc.executeRPC(getParent, function (entry) {
      successCallback(new DirectoryEntry(self.filesystem, entry.fullPath));
    }, errorCallback);
  };

  Entry.prototype.toJSON = function () {
    var json =
      { name        : this.name
      , fullPath    : this.fullPath
      , filesystem  : this.filesystem
      , isFile      : this.isFile
      , isDirectory : this.isDirectory
      };
    return json;
  };

  function Metadata(metadata) {
    this.modificationTime = new Date(metadata.modificationTime);
    this.size = metadata.size;
  }

  webinos.util.inherits(DirectoryEntry, Entry);
  function DirectoryEntry(filesystem, fullPath) {
    Entry.call(this, filesystem, fullPath);
  }

  DirectoryEntry.prototype.isDirectory = true;

  DirectoryEntry.prototype.createReader = function () {
    return new DirectoryReader(this);
  };

  DirectoryEntry.prototype.getFile = function (path, options, successCallback, errorCallback) {
    var self = this;
    var getFile = self.rpc.createRPC(self.service, "getFile", { entry : self, path : path, options : options });
    self.rpc.executeRPC(getFile, function (entry) {
      successCallback(new FileEntry(self.filesystem, entry.fullPath));
    }, errorCallback);
  };

  DirectoryEntry.prototype.getDirectory = function (path, options, successCallback, errorCallback) {
    var self = this;
    var getDirectory = self.rpc.createRPC(self.service, "getDirectory", { entry : self, path : path, options : options });
    self.rpc.executeRPC(getDirectory, function (entry) {
      successCallback(new DirectoryEntry(self.filesystem, entry.fullPath));
    }, errorCallback);
  };

  DirectoryEntry.prototype.removeRecursively = function (successCallback, errorCallback) {
    var removeRecursively = this.rpc.createRPC(this.service, "removeRecursively", { entry : this });
    this.rpc.executeRPC(removeRecursively, successCallback, errorCallback);
  };

  function DirectoryReader(entry) {
    this.entry = entry;

    this.service = entry.filesystem.service;
    this.rpc = entry.filesystem.service.rpc;
  }

  DirectoryReader.prototype.readEntries = function (successCallback, errorCallback) {
    var self = this;

    function next() {
      if (!self.entries.length) return [];

      var chunk = self.entries.slice(0, 10);
      self.entries.splice(0, 10);
      return chunk;
    }

    if (typeof self.entries === "undefined") {
      var readEntries = self.rpc.createRPC(self.service, "readEntries", { entry : self.entry });
      self.rpc.executeRPC(readEntries, function (entries) {
        self.entries = entries.map(function (entry) {
          if (entry.isDirectory) {
            return new DirectoryEntry(self.entry.filesystem, entry.fullPath);
          } else {
            return new FileEntry(self.entry.filesystem, entry.fullPath);
          }
        });

        successCallback(next());
      }, errorCallback);
    } else webinos.util.async(successCallback)(next());
  };

  webinos.util.inherits(FileEntry, Entry);
  function FileEntry(filesystem, fullPath) {
    Entry.call(this, filesystem, fullPath);
  }

  FileEntry.prototype.isFile = true;

  FileEntry.prototype.getLink = function (successCallback, errorCallback) {
    var getLink = this.rpc.createRPC(this.service, "getLink", { entry : this });
    this.rpc.executeRPC(getLink, successCallback, errorCallback);
  };

  FileEntry.prototype.createWriter = function (successCallback, errorCallback) {
    var self = this;
    var getMetadata = self.rpc.createRPC(self.service, "getMetadata", { entry : self });
    self.rpc.executeRPC(getMetadata, function (metadata) {
      var writer = new FileWriter(self);
      writer.length = metadata.size;

      successCallback(writer);
    }, errorCallback);
  };

  FileEntry.prototype.file = function (successCallback, errorCallback) {
    var self = this;
    var getMetadata = self.rpc.createRPC(self.service, "getMetadata", { entry : self });
    self.rpc.executeRPC(getMetadata, function (metadata) {
      var blobParts = [];

      var remote;
      var port = self.rpc.createRPC(self.service, "read",
         { entry : self
         , options : { bufferSize : 16 * 1024, autopause : true }
         });
      port.ref = function (params, successCallback, errorCallback, ref) {
        remote = ref;
      };
      port.open = function () {};
      port.data = function (params) {
        blobParts.push(webinos.util.hex2ab(params.data));

        var resume = self.rpc.createRPC(remote, "resume", null);
        self.rpc.executeRPC(resume);
      };
      port.end = function () {};
      port.close = function () {
        try {
          var blob = new Blob(blobParts);
          blob.name = self.name;
          blob.lastModifiedDate = new Date(metadata.modificationTime);

          successCallback(blob);
        } finally {
          self.rpc.unregisterCallbackObject(port);
        }
      };
      port.error = function (params) {
        try {
          errorCallback(params.error);
        } finally {
          self.rpc.unregisterCallbackObject(port);
        }
      };

      self.rpc.registerCallbackObject(port);
      self.rpc.executeRPC(port);
    }, errorCallback);
  };

  webinos.util.inherits(FileWriter, webinos.util.EventTarget);
  function FileWriter(entry) {
    webinos.util.EventTarget.call(this);

    this.entry = entry;

    this.readyState = FileWriter.INIT;
    this.length = 0;
    this.position = 0;

    this.service = entry.filesystem.service;
    this.rpc = entry.filesystem.service.rpc;

    this.addEventListener("writestart", function (event) {
      webinos.util.callback(this.onwritestart)(event);
    });
    this.addEventListener("progress", function (event) {
      webinos.util.callback(this.onprogress)(event);
    });
    this.addEventListener("abort", function (event) {
      webinos.util.callback(this.onabort)(event);
    });
    this.addEventListener("write", function (event) {
      webinos.util.callback(this.onwrite)(event);
    });
    this.addEventListener("writeend", function (event) {
      webinos.util.callback(this.onwriteend)(event);
    });
    this.addEventListener("error", function (event) {
      webinos.util.callback(this.onerror)(event);
    });
  }

  FileWriter.INIT = 0;
  FileWriter.WRITING = 1;
  FileWriter.DONE = 2;

  function BlobIterator(blob) {
    this.blob = blob;
    this.position = 0;
  }

  BlobIterator.prototype.hasNext = function () {
    return this.position < this.blob.size;
  };

  BlobIterator.prototype.next = function () {
    if (!this.hasNext()) {
      throw new webinos.util.CustomError("InvalidStateError");
    }

    var end = Math.min(this.position + 16 * 1024, this.blob.size);
    var chunk;
    if (this.blob.slice) {
      chunk = this.blob.slice(this.position, end);
    } else if (this.blob.webkitSlice) {
      chunk = this.blob.webkitSlice(this.position, end);
    } else if (this.blob.mozSlice) {
      chunk = this.blob.mozSlice(this.position, end);
    }
    this.position = end;
    return chunk;
  };

  FileWriter.prototype.write = function (data) {
    var self = this;

    if (self.readyState === FileWriter.WRITING) {
      throw new webinos.util.CustomError("InvalidStateError");
    }

    self.readyState = FileWriter.WRITING;
    self.dispatchEvent(new webinos.util.ProgressEvent("writestart"));

    var reader = new FileReader();
    // reader.onloadstart = function (event) {};
    // reader.onprogress = function (event) {};
    // reader.onabort = function (event) {};
    reader.onload = function () {
      var write = self.rpc.createRPC(remote, "write", { data : webinos.util.ab2hex(reader.result) });
      self.rpc.executeRPC(write, function (bytesWritten) {
        self.position += bytesWritten;
        self.length = Math.max(self.position, self.length);

        self.dispatchEvent(new webinos.util.ProgressEvent("progress"));
      });
    };
    // reader.onloadend = function (event) {};
    reader.onerror = function () {
      var destroy = self.rpc.createRPC(remote, "destroy");
      self.rpc.executeRPC(destroy, function () {
        try {
          self.error = reader.error;
          self.readyState = FileWriter.DONE;
          self.dispatchEvent(new webinos.util.ProgressEvent("error"));
          self.dispatchEvent(new webinos.util.ProgressEvent("writeend"));
        } finally {
          self.rpc.unregisterCallbackObject(port);
        }
      });
    };

    var iterator = new BlobIterator(data);
    function iterate() {
      if (iterator.hasNext()) {
        reader.readAsArrayBuffer(iterator.next());
      } else {
        var end = self.rpc.createRPC(remote, "end");
        self.rpc.executeRPC(end, function () {
          try {
            self.readyState = FileWriter.DONE;
            self.dispatchEvent(new webinos.util.ProgressEvent("write"));
            self.dispatchEvent(new webinos.util.ProgressEvent("writeend"));
          } finally {
            self.rpc.unregisterCallbackObject(port);
          }
        });
      }
    }

    var remote;
    var port = self.rpc.createRPC(self.service, "write",
       { entry : self.entry
       , options : { start : self.position }
       });
    port.ref = function (params, successCallback, errorCallback, ref) {
      remote = ref;
    };
    port.open = function () {
      iterate();
    };
    port.drain = function () {
      iterate();
    };
    port.close = function () {};
    port.error = function (params) {
      try {
        self.error = params.error;
        self.readyState = FileWriter.DONE;
        self.dispatchEvent(new webinos.util.ProgressEvent("error"));
        self.dispatchEvent(new webinos.util.ProgressEvent("writeend"));
      } finally {
        reader.abort();

        self.rpc.unregisterCallbackObject(port);
      }
    };

    self.rpc.registerCallbackObject(port);
    self.rpc.executeRPC(port);
  };

  FileWriter.prototype.seek = function (offset) {
    if (this.readyState === FileWriter.WRITING) {
      throw new webinos.util.CustomError("InvalidStateError");
    }

    this.position = offset;

    if (this.position > this.length) {
      this.position = this.length;
    }

    if (this.position < 0) {
      this.position = this.position + this.length;
    }

    if (this.position < 0) {
      this.position = 0;
    }
  };

  FileWriter.prototype.truncate = function (size) {
    var self = this;

    if (self.readyState === FileWriter.WRITING) {
      throw new webinos.util.CustomError("InvalidStateError");
    }

    self.readyState = FileWriter.WRITING;
    self.dispatchEvent(new webinos.util.ProgressEvent("writestart"));

    var truncate = self.rpc.createRPC(self.service, "truncate", { entry : self.entry, size : size });
    self.rpc.executeRPC(truncate, function () {
      self.length = size;
      self.position = Math.min(self.position, size);

      self.readyState = FileWriter.DONE;
      self.dispatchEvent(new webinos.util.ProgressEvent("write"));
      self.dispatchEvent(new webinos.util.ProgressEvent("writeend"));
    }, function (error) {
      self.error = error;
      self.readyState = FileWriter.DONE;
      self.dispatchEvent(new webinos.util.ProgressEvent("error"));
      self.dispatchEvent(new webinos.util.ProgressEvent("writeend"));
    });
  };

  // FileWriter.prototype.abort = function () {
  //   if (this.readyState === FileWriter.DONE ||
  //       this.readyState === FileWriter.INIT) return;

  //   this.readyState = FileWriter.DONE;

  //   // If there are any tasks from the object's FileSaver task source in one of
  //   // the task queues, then remove those tasks.
  //   // Terminate the write algorithm being processed.

  //   this.error = new webinos.util.CustomError("AbortError");
  //   this.dispatchEvent(new webinos.util.ProgressEvent("abort"));
  //   this.dispatchEvent(new webinos.util.ProgressEvent("writeend"));
  // };
})(webinos.file);
/*******************************************************************************
 *    Code contributed to the webinos project
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *    
 *         http://www.apache.org/licenses/LICENSE-2.0
 *    
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * 
 * Copyright 2013 Istituto Superiore Mario Boella (ISMB)
 ******************************************************************************/

(function()
{
    Media = function(obj) {
        WebinosService.call(this, obj);
    };
    
    _webinos.registerServiceConstructor("http://webinos.org/api/media", Media);

    Media.prototype.bindService = function (bindCB, serviceId) {
	    if (typeof bindCB.onBind === 'function') {
		    bindCB.onBind(this);
	    };
    }
    var rpcCB = {};

	Media.prototype.registerListeners = function(callbacks, successCB, errorCB)
	{
        //should be checked if a rpcCB has been already created. So, it should be prevented an application to register multiple listeners.
        
        rpcCB = webinos.rpcHandler.createRPC(this, "registerListeners");
        
        rpcCB.onStop = rpcCB.onEnd = rpcCB.onPlay = rpcCB.onPause = rpcCB.onVolumeUP = rpcCB.onVolumeDOWN = rpcCB.onVolumeSet = function(){};

        if(typeof callbacks.onStop === "function") 
            rpcCB.onStop = callbacks.onStop;
        
        if(typeof callbacks.onEnd === "function") 
            rpcCB.onEnd = callbacks.onEnd;
        
        if(typeof callbacks.onPlay === "function") 
            rpcCB.onPlay = callbacks.onPlay;
        
        if(typeof callbacks.onPause === "function") 
            rpcCB.onPause = callbacks.onPause;

        if(typeof callbacks.onVolumeUP === "function") 
            rpcCB.onVolumeUP = callbacks.onVolumeUP;

        if(typeof callbacks.onVolumeDOWN === "function") 
            rpcCB.onVolumeDOWN = callbacks.onVolumeDOWN;
        
        if(typeof callbacks.onVolumeSet === "function") 
            rpcCB.onVolumeSet = callbacks.onVolumeSet;

        webinos.rpcHandler.registerCallbackObject(rpcCB);             

        webinos.rpcHandler.executeRPC(rpcCB, function(params)
        {
            if (typeof(successCB) === 'function') successCB(params);
        }, function(error) 
        {
            //unregister listener if fails to add it
            webinos.rpcHandler.unregisterCallbackObject(rpcCB);
            rpcCB = undefined;
            
            if (typeof(errorCB) !== 'undefined') errorCB(error);
        });
	}
	
	Media.prototype.unregisterListenersOnLeave = function(successCB, errorCB)
    {
        var rpc = webinos.rpcHandler.createRPC(this, "unregisterListenersOnLeave");        
        webinos.rpcHandler.unregisterCallbackObject(rpcCB);
        
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function') successCB(params);
        }, function(error) 
            {
                if (typeof(errorCB) !== 'undefined') errorCB(error);
        });
        rpcCB = undefined;
    }
        
    Media.prototype.unregisterListenersOnExit = function()
    {
        var rpc = webinos.rpcHandler.createRPC(this, "unregisterListenersOnExit");         
        webinos.rpcHandler.unregisterCallbackObject(rpcCB);

        webinos.rpcHandler.executeRPC(rpc);
        rpcCB = undefined;
    }
    
    Media.prototype.isPlaying = function(successCB, errorCB)
    {
        var rpc = webinos.rpcHandler.createRPC(this, "isPlaying");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function') successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
                errorCB(error);
        })
    }
    
    Media.prototype.play = function(path, successCB, errorCB)
    {
        var rpc = webinos.rpcHandler.createRPC(this, "startPlay", [ path ]);
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.playPause = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "playPause");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.stepforward = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "stepforward"); 
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.bigStepforward = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "bigStepforward");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.stepback = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "stepback");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.bigStepback = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "bigStepback");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.stop = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "stop");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.volumeUP = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "volumeUP");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.volumeDOWN = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "volumeDOWN");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.setVolume = function(params, successCB, errorCB)
    {
        var rpc = webinos.rpcHandler.createRPC(this, "setVolume", [ params ]);
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
                errorCB(error);
        })
    }
    
    Media.prototype.increasePlaybackSpeed = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "increasePlaybackSpeed");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.decreasePlaybackSpeed = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "decreasePlaybackSpeed");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.showInfo = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "showInfo");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
    Media.prototype.toggleSubtitle = function(successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "toggleSubtitle");
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
            errorCB(error);
        })
    }
    
}());
/*******************************************************************************
 *  Code contributed to the webinos project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Copyright 2011 Habib Virji, Samsung Electronics (UK) Ltd
 ******************************************************************************/
(function () {
  /**
   * Webinos MediaContent service constructor (client side).
   * @constructor
   * @param obj Object containing displayName, api, etc.
   */
  MediaContentModule = function (obj) {
    this.base = WebinosService;
    this.base(obj);
  };

  MediaContentModule.prototype = new WebinosService;

  /**
   * To bind the service.
   * @param bindCB BindCallback object.
   */
  MediaContentModule.prototype.bindService = function (bindCB, serviceId) {
    this.getLocalFolders = function (successCB, errorCB) {
      var rpc = webinos.rpcHandler.createRPC(this, "getLocalFolders", []);
      webinos.rpcHandler.executeRPC(rpc,
        function (params) {
          successCB(params);
        },
        function (error) {
          errorCB(error);
        }
        );
    };
    this.findItem = function (successCB, errorCB, params) {
      "use strict";
      var rpc = webinos.rpcHandler.createRPC(this, "findItem", params);
      webinos.rpcHandler.executeRPC(rpc,
        function (params) {
          successCB(params);
        },
        function (error) {
          errorCB(error);
        }
        );
    };
    this.updateItem = function (successCB, errorCB) {
      "use strict";
      var rpc = webinos.rpcHandler.createRPC(this, "updateItem", []);
      webinos.rpcHandler.executeRPC(rpc,
        function (params) {
          successCB(params);
        },
        function (error) {
          errorCB(error);
        }
        );
    };

    this.updateItemsBatch = function (successCB, errorCB) {
      "use strict";
      var rpc = webinos.rpcHandler.createRPC(this, "updateItemBatches", []);
      webinos.rpcHandler.executeRPC(rpc,
        function (params) {
          successCB(params);
        },
        function (error) {
          errorCB(error);
        }
        );
    };

    this.getContents = function (listener, errorCB, params) {
      "use strict";
      var rpc = webinos.rpcHandler.createRPC(this, "getContents", params);//, totalBuffer = 0, data = "";
      rpc.onEvent = function (params) {
        // we were called back, now invoke the given listener
     /*   totalBuffer += params.currentBuffer;
        data += btoa(params.contents);
        if (totalBuffer === params.totalLength) {
          //photo = new Buffer(data, 'binary').toString('base64');
          window.open("data:image/png;base64"+atob(data));*/
        listener(params);
          //totalBuffer = 0;
          //data = '';
          //webinos.rpcHandler.unregisterCallbackObject(rpc);
        //}
      };

      webinos.rpcHandler.registerCallbackObject(rpc);
      webinos.rpcHandler.executeRPC(rpc);
      /*webinos.rpcHandler.executeRPC(rpc,
        function (params) {
          totalBuffer += params.currentBuffer;
          if (totalBuffer === params.totalLength) {
            successCB(params);
            totalBuffer = 0;
          }
        },
        function (error) {
          errorCB(error);
        }
        );*/
    };

    this.getLink = function (params, successCallback, errorCallback) {
      "use strict";
      var getLink = webinos.rpcHandler.createRPC(this, "getLink", params);
      webinos.rpcHandler.executeRPC(getLink, successCallback, errorCallback);
    };

    WebinosService.prototype.bindService.call(this, bindCB);
  };
}());
/*******************************************************************************
*  Code contributed to the webinos project
* 
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*  
*     http://www.apache.org/licenses/LICENSE-2.0
*  
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
* 
* Copyright 2013 Fraunhofer FOKUS
******************************************************************************/

(function() {
	//Payment Module Functionality

	PaymentModule = function (obj){      
			this.base = WebinosService;
			this.base(obj);
	};
	// This is the new way, but the old way (Public object accessible by servicedisco) works as well
	//_webinos.registerServiceConstructor("http://webinos.org/api/payment", PaymentModule);

	PaymentModule.prototype = new WebinosService;

	/**
	 * To bind the service.
	 * @param bindCB BindCallback object.
	 */
	PaymentModule.prototype.bindService = function (bindCB, serviceId) {
			this.listenAttr = {};
			
			if (typeof bindCB.onBind === 'function') {
					bindCB.onBind(this);
			};
	}

	PaymentModule.prototype.pay = function (successCallback, errorCallback, challengeCallback,  itemList,  bill,  customerID,  sellerID) {
			   
				var arguments = new Array();
				arguments[0]=itemList;
				arguments[1]=bill;
				arguments[2]=customerID;
				arguments[3]=sellerID;
				arguments[4]=challengeCallback;
				var self = this;
				var rpc = webinos.rpcHandler.createRPC(this, "pay", arguments);
				webinos.rpcHandler.executeRPC(rpc,
								function (params){successCallback(params);},
								function (error){errorCallback(error);}
				);
		}
            
}());
//implementation at client side, includes RPC massage invokation
/**
 * Interface for TV control and management.
 * 
 * 
 * The interface provides means to acquire a list of tv sources, channels and
 * their streams.
 * 
 * The TV channel streams can be displayed in HTMLVideoElement object
 * (http://dev.w3.org/html5/spec/video.html). Alternatively the API provides
 * means to control channel management of the native hardware TV, by allowing to
 * set a channel or watch for channel changes that are invoked otherwise.
 * 
 * The tv object is made available under the webinos namespace, i.e. webinos.tv.
 * 
 */
(function() {

	var TVDisplayManager, TVDisplaySuccessCB, TVTunerManager, TVSuccessCB, TVErrorCB, TVError, TVSource, Channel, ChannelChangeEvent;
	var that = this;	
	
	/**
	 * Interface to manage what's currently displayed on TV screen.
	 * 
	 * 
	 * This interface is useful when an app doesn't want to show the broadcast
	 * itself, but let the TV natively handle playback, i.e. not in a web
	 * context. Useful to build an control interface that allows channel
	 * switching.
	 * 
	 */
	TVDisplayManager = function(){};

	/**
	 * Switches the channel natively on the TV (same as when a hardware remote
	 * control would be used).
	 * 
	 */
	TVDisplayManager.prototype.setChannel = function(channel, successCallback,
			errorCallback) {
		var rpc = webinos.rpcHandler.createRPC(that, "display.setChannel", arguments);
		webinos.rpcHandler.executeRPC(rpc, function(params) {
			successCallback(params);
		}, function(error) {
			if(errorCallback) errorCallback();
		});
		return;
	};
	
	//TODO: only internal temporarily use!
	//This is only to bridge the missing Media Capture API and EPG functionality 
	TVDisplayManager.prototype.getEPGPIC = function(channel, successCallback,
			errorCallback) {
		var rpc = webinos.rpcHandler.createRPC(that, "display.getEPGPIC", arguments);
		webinos.rpcHandler.executeRPC(rpc, function(params) {
			successCallback(params);
		}, function(error) {
			if(errorCallback) errorCallback();
		});
		return;
	};

	/**
	 * Callback function when current channel changed successfully.
	 * 
	 */
	TVDisplaySuccessCB = function() {
		// TODO implement constructor logic if needed!

	};
	TVDisplaySuccessCB.prototype.onSuccess = function(channel) {
		// TODO: Add your application logic here!

		return;
	};

	// TODO: does not conform API Spec, but needs to be added!
	TVDisplayManager.prototype.addEventListener = function(eventname,
			channelchangeeventhandler, useCapture) {
		var rpc = webinos.rpcHandler.createRPC(that, "display.addEventListener",
				arguments);

		rpc.onchannelchangeeventhandler = function(params,
				successCallback, errorCallback) {

			channelchangeeventhandler(params);

		};

		// register the object as being remotely accessible
		webinos.rpcHandler.registerCallbackObject(rpc);

		webinos.rpcHandler.executeRPC(rpc);
		return;
	};

	/**
	 * Get a list of all available TV tuners.
	 * 
	 */
	TVTunerManager = function(){};

	/**
	 * Get a list of all available TV tuners.
	 * 
	 */
	TVTunerManager.prototype.getTVSources = function(successCallback,
			errorCallback) {
		var rpc = webinos.rpcHandler.createRPC(that, "tuner.getTVSources", arguments);
		webinos.rpcHandler.executeRPC(rpc, function(params) {
			successCallback(params);
		}, function(error) {
		});
		return;
	};

	/**
	 * Callback for found TV tuners.
	 * 
	 */
	TVSuccessCB = function() {
		// TODO implement constructor logic if needed!

	};

	/**
	 * Callback that is called with the found TV sources.
	 * 
	 */
	TVSuccessCB.prototype.onSuccess = function(sources) {
		// TODO: Add your application logic here!

		return;
	};

	/**
	 * Error callback for errors when trying to get TV tuners.
	 * 
	 */
	TVErrorCB = function() {
		// TODO implement constructor logic if needed!

	};

	/**
	 * Callback that is called when an error occures while getting TV sources
	 * 
	 */
	TVErrorCB.prototype.onError = function(error) {
		// TODO: Add your application logic here!

		return;
	};

	/**
	 * Error codes.
	 * 
	 */
	TVError = function() {
		// TODO implement constructor logic if needed!

		// TODO initialize attributes

		this.code = Number;
	};

	/**
	 * An unknown error.
	 * 
	 */
	TVError.prototype.UNKNOWN_ERROR = 0;

	/**
	 * Invalid input channel.
	 * 
	 */
	TVError.prototype.ILLEGAL_CHANNEL_ERROR = 1;

	/**
	 * Code.
	 * 
	 */
	TVError.prototype.code = Number;

	/**
	 * TV source: a list of channels with a name.
	 * 
	 */
	TVSource = function() {
		// TODO implement constructor logic if needed!

		// TODO initialize attributes

		this.name = String;
		this.channelList = Number;
	};

	/**
	 * The name of the source.
	 * 
	 * 
	 * The name should describe the kind of tuner this source represents, e.g.
	 * DVB-T, DVB-C.
	 * 
	 */
	TVSource.prototype.name = String;

	/**
	 * List of channels for this source.
	 * 
	 */
	TVSource.prototype.channelList = Number;

	/**
	 * The Channel Interface
	 * 
	 * 
	 * Channel objects provide access to the video stream.
	 * 
	 */
	Channel = function() {
		this.channelType = Number;
		this.name = String;
		this.longName = String;
		this.stream = "new Stream()";
		this.tvsource = new TVSource();
	};

	/**
	 * Indicates a TV channel.
	 * 
	 */
	Channel.prototype.TYPE_TV = 0;

	/**
	 * Indicates a radio channel.
	 * 
	 */
	Channel.prototype.TYPE_RADIO = 1;

	/**
	 * The type of channel.
	 * 
	 * 
	 * Type of channel is defined by one of the TYPE_* constants defined above.
	 * 
	 */
	Channel.prototype.channelType = Number;

	/**
	 * The name of the channel.
	 * 
	 * 
	 * The name of the channel will typically be the call sign of the station.
	 * 
	 */
	Channel.prototype.name = String;

	/**
	 * The long name of the channel.
	 * 
	 * 
	 * The long name of the channel if transmitted. Can be undefined if not
	 * available.
	 * 
	 */
	Channel.prototype.longName = String;

	/**
	 * The video stream.
	 * 
	 * 
	 * This stream is a represents a valid source for a HTMLVideoElement.
	 * 
	 */
	Channel.prototype.stream = null;

	/**
	 * The source this channels belongs too.
	 * 
	 */
	Channel.prototype.tvsource = null;

	/**
	 * Event that fires when the channel is changed.
	 * 
	 * 
	 * Changing channels could also be invoked by other parties, e.g. a hardware
	 * remote control. A ChannelChange event will be fire in these cases which
	 * provides the channel that was switched to.
	 * 
	 */
	ChannelChangeEvent = function() {
		// TODO implement constructor logic if needed!

		// TODO initialize attributes

		this.channel = new Channel();
	};

	/**
	 * The new channel.
	 * 
	 */
	ChannelChangeEvent.prototype.channel = null;

	/**
	 * Initializes a new channel change event.
	 * 
	 */
	ChannelChangeEvent.prototype.initChannelChangeEvent = function(type,
			bubbles, cancelable, channel) {
		// TODO: Add your application logic here!

		return;
	};
	
	/**
	 * Access to tuner and display managers.
	 * 
	 */
	TVManager = function(obj) {
		this.base = WebinosService;
		this.base(obj);
		that = this;
		
		this.display = new TVDisplayManager(obj);
		this.tuner = new TVTunerManager(obj);
	};
	TVManager.prototype = new WebinosService;


}());
/*******************************************************************************
*  Code contributed to the webinos project
* 
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*  
*     http://www.apache.org/licenses/LICENSE-2.0
*  
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
* 
* Copyright 2011 Alexander Futasz, Fraunhofer FOKUS
******************************************************************************/
(function() {

	/**
	 * Webinos Get42 service constructor (client side).
	 * @constructor
	 * @param obj Object containing displayName, api, etc.
	 */
	TestModule = function(obj) {
		WebinosService.call(this, obj);
		
		this._testAttr = "HelloWorld";
		this.__defineGetter__("testAttr", function (){
			return this._testAttr + " Success";
		});
	};
	_webinos.registerServiceConstructor("http://webinos.org/api/test", TestModule);
	
	/**
	 * To bind the service.
	 * @param bindCB BindCallback object.
	 */
	TestModule.prototype.bindService = function (bindCB, serviceId) {
		// actually there should be an auth check here or whatever, but we just always bind
		this.get42 = get42;
		this.listenAttr = {};
		this.listenerFor42 = listenerFor42.bind(this);
		
		if (typeof bindCB.onBind === 'function') {
			bindCB.onBind(this);
		};
	}
	
	/**
	 * Get 42.
	 * An example function which does a remote procedure call to retrieve a number.
	 * @param attr Some attribute.
	 * @param successCB Success callback.
	 * @param errorCB Error callback. 
	 */
	function get42(attr, successCB, errorCB) {
		console.log(this.id);
		var rpc = webinos.rpcHandler.createRPC(this, "get42", [attr]);
		webinos.rpcHandler.executeRPC(rpc,
				function (params){
					successCB(params);
				},
				function (error){
					errorCB(error);
				}
		);
	}
	
	/**
	 * Listen for 42.
	 * An exmaple function to register a listener which is then called more than
	 * once via RPC from the server side.
	 * @param listener Listener function that gets called.
	 * @param options Optional options.
	 */
	function listenerFor42(listener, options) {
		var rpc = webinos.rpcHandler.createRPC(this, "listenAttr.listenFor42", [options]);

		// add one listener, could add more later
		rpc.onEvent = function(obj) {
			// we were called back, now invoke the given listener
			listener(obj);
			webinos.rpcHandler.unregisterCallbackObject(rpc);
		};

		webinos.rpcHandler.registerCallbackObject(rpc);
		webinos.rpcHandler.executeRPC(rpc);
	}
	
}());
})(window);
