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

		if (this.parent && this.parent.synchronizationStart) {
			this.parent.synchronizationStart();
		}
		return callback.id;
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

		if (this.parent && this.parent.synchronizationStart) {
			this.parent.synchronizationStart();
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
			if (/ServiceDiscovery|ServiceConfiguration|Dashboard/.test(serviceTyp)) {
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

	var logger;
	if(typeof module === 'undefined' && (typeof webinos === 'undefined' || typeof webinos.logging != 'function' || !webinos.logging())) {
		logger = {
			log: function(){},
			info: function(){},
			warn: function(){},
			error: function(){},
			debug: function(){}
		};
	} else {
		logger = {
			log: console.log.bind(console),
			info: console.log.bind(console),
			warn: console.log.bind(console),
			error: console.log.bind(console),
			debug: console.log.bind(console)
		};
	}

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
		} else if (!/ServiceDiscovery|ServiceConfiguration|Dashboard/.test(service)) {
			// request to object registered with registerCallbackObject
			isCallbackObject = true;
		}
		//TODO send back error if service and method is not webinos style

		if (service.length === 0) {
			logger.log("Cannot handle request because of missing service in request");
			return;
		}

		logger.log("Got request to invoke " + method + " on " + service + (serviceId ? "@" + serviceId : "") +" with params: " + JSON.stringify(request.params) );

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
				logger.log("RPC called success callback for response");
			}
			else if (waitResp.onError && typeof response.error !== "undefined") {
				if (response.error) {
					this.awaitingResponse[response.id].onError(response.error);
				}
				else {
					this.awaitingResponse[response.id].onError();
				}
				logger.log("RPC called error callback for response");
			}
				delete this.awaitingResponse[response.id];

		} else if (this.callbackObjects[response.id]) {
			// response is for a rpc callback obj
			var callbackObj = this.callbackObjects[response.id];

			if (callbackObj.onSecurityError && response.error &&
					response.error.data && response.error.data.name === 'SecurityError') {

				callbackObj.onSecurityError(response.error.data);
				logger.log('Received SecurityError response.');
			} else {
				logger.log('Dropping received response for RPC callback obj.');
			}
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
        if (/\/(?:[BI]ID)?[a-f0-9]+:\d+/.exec(msg.to) // check it has WRT app id
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
if (typeof exports.webinos.logging === "undefined") exports.webinos.logging = function(enable){
    if(typeof enable === "boolean") {
        enable ? localStorage.setItem("verboseLoggingEnabled","true") : localStorage.removeItem("verboseLoggingEnabled");
    }
    return (typeof localStorage != "undefined" && localStorage && "true" === localStorage.getItem("verboseLoggingEnabled"));
};

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
            if(webinos.logging()) {
                console.log(rpc);
            }
            channel.send(JSON.stringify(rpc));
        }else {
            if(webinos.logging()) {
                console.log("WebSocket Client: Message Sent", message);
            }
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

    var _console = function(type,args){
        if(typeof module === 'undefined' && type === "log" && (typeof webinos === 'undefined' || typeof webinos.logging != 'function' || !webinos.logging())) {
            return;
        }
        (console[type]).apply(console,args);
    }
    var logger = {
        log:function(){_console("log",arguments)},
        info:function(){_console("info",arguments)},
        warn:function(){_console("warn",arguments)},
        error:function(){_console("error",arguments)},
        debug:function(){_console("debug",arguments)}
    };

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
            logger.log("websocket connection is only possible with address localhost or 127.0.0.1. Please change to localhost or 127.0.0.1 " +
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
                        logger.log ("CAUTION: webinosConfig.json failed to load. Are you on a pzp/widget server or older version of webinos? Trying the guess  communication channel's port.");
                        port = port + 1; // Guessing that the port is +1 to the webserver's. This was the way to detect it on old versions of pzp.
                    }
                } catch (err) { // XMLHttpRequest is not supported or something went wrong with it.
                    logger.log ("CAUTION: The pzp communication host and port are unknown. Trying the default communication channel.");
                    useDefaultHost = true;
                    useDefaultPort = true;
                }
            } else { // Let's try the default pzp hostname and port.
                logger.log ("CAUTION: No web server detected. Using a local file? Trying the default communication channel.");
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
            logger.log ('WebSocket Client: Message Received : ' + JSON.stringify (ev.data));
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
          console.error("WebSocket error", evt);
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
         * @param apiNameFilter String to filter API names.
         * @param successCB Callback to call with results.
         * @param errorCB Callback to call in case of error.
         */
        this.findConfigurableAPIs = function(apiNameFilter, successCB, errorCB) {
            //Calls to this method can be constrained using dashboard's feature
            var rpc = rpcHandler.createRPC('ServiceDiscovery', 'findConfigurableAPIs', [{'api':'http://webinos.org/api/dashboard'}, apiNameFilter]);
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
            //if (typeof ActuatorModule !== 'undefined') typeMapCompatible['http://webinos.org/api/actuators'] = ActuatorModule;
            //if (typeof App2AppModule !== 'undefined') typeMapCompatible['http://webinos.org/api/app2app'] = App2AppModule;
            //if (typeof AppLauncherModule !== 'undefined') typeMapCompatible['http://webinos.org/api/applauncher'] = AppLauncherModule;
            if (typeof AuthenticationModule !== 'undefined') typeMapCompatible['http://webinos.org/api/authentication'] = AuthenticationModule;
            if (typeof webinos.Context !== 'undefined') typeMapCompatible['http://webinos.org/api/context'] = webinos.Context;
            if (typeof corePZinformationModule !== 'undefined') typeMapCompatible['http://webinos.org/api/corePZinformation'] = corePZinformationModule;
            //if (typeof DeviceStatusManager !== 'undefined') typeMapCompatible['http://webinos.org/api/devicestatus'] = DeviceStatusManager;
            //if (typeof DiscoveryModule !== 'undefined') typeMapCompatible['http://webinos.org/api/discovery'] = DiscoveryModule;
            //if (typeof EventsModule !== 'undefined') typeMapCompatible['http://webinos.org/api/events'] = EventsModule;
            //if (webinos.file && webinos.file.Service) typeMapCompatible['http://webinos.org/api/file'] = webinos.file.Service;
            //if (typeof MediaContentModule !== 'undefined') typeMapCompatible['http://webinos.org/api/mediacontent'] = MediaContentModule;
            //if (typeof NfcModule !== 'undefined') typeMapCompatible['http://webinos.org/api/nfc'] = NfcModule;
            //if (typeof WebNotificationModule !== 'undefined') typeMapCompatible['http://webinos.org/api/notifications'] = WebNotificationModule;
            //if (typeof WebinosDeviceOrientation !== 'undefined') typeMapCompatible['http://webinos.org/api/deviceorientation'] = WebinosDeviceOrientation;
            //if (typeof PaymentModule !== 'undefined') typeMapCompatible['http://webinos.org/api/payment'] = PaymentModule;
            //if (typeof Sensor !== 'undefined') typeMapCompatible['http://webinos.org/api/sensors'] = Sensor;
            //if (typeof TestModule !== 'undefined') typeMap['http://webinos.org/api/test'] = TestModule;
            //if (typeof TVManager !== 'undefined') typeMapCompatible['http://webinos.org/api/tv'] = TVManager;
            //if (typeof Vehicle !== 'undefined') typeMapCompatible['http://webinos.org/api/vehicle'] = Vehicle;
            //if (typeof WebinosGeolocation !== 'undefined') typeMapCompatible['http://webinos.org/api/w3c/geolocation'] = WebinosGeolocation;
            //if (typeof WebinosGeolocation !== 'undefined') typeMapCompatible['http://www.w3.org/ns/api-perms/geolocation'] = WebinosGeolocation; // old feature URI for compatibility
			// We use http://webinos.org/api/contacts instead of the w3c one... 
            //if (typeof Contacts !== 'undefined') typeMapCompatible['http://www.w3.org/ns/api-perms/contacts'] = Contacts;
            //if (typeof ZoneNotificationModule !== 'undefined') typeMapCompatible['http://webinos.org/api/zonenotifications'] = ZoneNotificationModule;
            //if (typeof DiscoveryModule !== 'undefined') typeMapCompatible['http://webinos.org/manager/discovery/bluetooth'] = DiscoveryModule;
            if (typeof oAuthModule !== 'undefined') typeMapCompatible['http://webinos.org/mwc/oauth'] = oAuthModule;
            //if (typeof PolicyManagementModule !== 'undefined') typeMapCompatible['http://webinos.org/core/policymanagement'] = PolicyManagementModule;


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
                    clearTimeout(timer);
                    timer = null;
                }
            }, timer);

            var success = function (params) {
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
                    var serviceErrorMsg = 'Cannot instantiate webinos service: ' + stype;
                    if (typeof callback.onError === 'function') {
                        callback.onError(new DOMError("onServiceAvailable", serviceErrorMsg));
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
                    clearTimeout(timer);
                }
            };

            rpc.onError = function (params) {
                var serviceErrorMsg = 'Cannot find webinos service.';
                if (typeof callback.onError === 'function') {
                    callback.onError(new DOMError('onError', serviceErrorMsg));
                    clearTimeout(timer);
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
        this.getAPIServicesConfiguration = function(apiName, successCB, errorCB) {
            //Calls to this method can be constrained using dashboard's feature
            var rpc = rpcHandler.createRPC('ServiceConfiguration', 'getAPIServicesConfiguration', [{'api':'http://webinos.org/api/dashboard'}, apiName]);
            rpcHandler.executeRPC(rpc
                    , function (params) { successCB(params); }
                    , function (params) { errorCB(params); }
            );
        };
 
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
         * @param apiURI URI of target API.
         * @param config Configuration to apply. It updates the params field in the config.json file
         * @param successCB Callback to call with results.
         * @param errorCB Callback to call in case of error.
         */
        this.setAPIServicesConfiguration = function(apiURI, config, successCB, errorCB) {
            //Calls to this method can be constrained using dashboard's feature
            var rpc = rpcHandler.createRPC('ServiceConfiguration', 'setAPIServicesConfiguration', [{'api':'http://webinos.org/api/dashboard'}, apiURI, config]);
            rpcHandler.executeRPC(rpc
                    , function (params) { successCB(params); }
                    , function (params) { errorCB(params); }
            );
        };

        /**
         * Set configuration to a specified API.
         * @param serviceID ID of target service.
         * @param apiURI URI of service's type API.
         * @param config Configuration to apply. It updates the params field in the config.json file
         * @param successCB Callback to call with results.
         * @param errorCB Callback to call in case of error.
         */
        this.setServiceConfiguration = function(serviceID, apiURI, config, successCB, errorCB) {
            //Calls to this method can be constrained using dashboard's feature
            var rpc = rpcHandler.createRPC('ServiceConfiguration', 'setServiceConfiguration', [{'api':'http://webinos.org/api/dashboard'}, serviceID, apiURI, config]);
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
* Copyright 2013 Toby Ealden
******************************************************************************/
(function() {

	/**
	 * Webinos Get42 service constructor (client side).
	 * @constructor
	 * @param obj Object containing displayName, api, etc.
	 */
	ZoneNotificationsModule = function(obj) {
		WebinosService.call(this, obj);
		
		this._testAttr = "HelloWorld";
		this.__defineGetter__("testAttr", function (){
			return this._testAttr + " Success";
		});
	};
	// Inherit all functions from WebinosService
	ZoneNotificationsModule.prototype = Object.create(WebinosService.prototype);
	// The following allows the 'instanceof' to work properly
	ZoneNotificationsModule.prototype.constructor = ZoneNotificationsModule;
	// Register to the service discovery
	_webinos.registerServiceConstructor("http://webinos.org/api/zonenotifications", ZoneNotificationsModule);
	
	/**
	 * To bind the service.
	 * @param bindCB BindCallback object.
	 */
	ZoneNotificationsModule.prototype.bindService = function (bindCB, serviceId) {
		// actually there should be an auth check here or whatever, but we just always bind
		this.getNotifications = getNotifications;
    this.getNotification = getNotification;
    this.addNotification = addNotification;
    this.deleteNotification = deleteNotification;
    this.notificationResponse = notificationResponse;
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
	function getNotifications(attr, successCB, errorCB) {
		var rpc = webinos.rpcHandler.createRPC(this, "getNotifications", [attr]);
		webinos.rpcHandler.executeRPC(rpc,
				function (params){
					successCB(params);
				},
				function (error){
					errorCB(error);
				}
		);
	}

  function notificationResponse(responseTo, response, successCB, errorCB) {
    var rpc = webinos.rpcHandler.createRPC(this, "notificationResponse", [responseTo, response]);
    webinos.rpcHandler.executeRPC(rpc,
      function (params){
        successCB(params);
      },
      function (error){
        errorCB(error);
      }
    );
  }

  function getNotification(id, successCB, errorCB) {
    var rpc = webinos.rpcHandler.createRPC(this, "getNotification", [id]);
    webinos.rpcHandler.executeRPC(rpc,
      function (params){
        successCB(params);
      },
      function (error){
        errorCB(error);
      }
    );
  }

  function addNotification(type,data,successCB,errorCB) {
    var rpc = webinos.rpcHandler.createRPC(this, "addNotification", [type, data]);
    webinos.rpcHandler.executeRPC(rpc,
      function (params){
        if (typeof successCB === "function") {
          successCB(params);
        }
      },
      function (error){
        if (typeof errorCB === "function") {
          errorCB(error);
        }
      }
    );
  }

  function deleteNotification(id,successCB,errorCB) {
    var rpc = webinos.rpcHandler.createRPC(this, "deleteNotification", [id]);
    webinos.rpcHandler.executeRPC(rpc,
      function (params){
        if (typeof successCB === "function") {
          successCB(params);
        }
      },
      function (error){
        if (typeof errorCB === "function") {
          errorCB(error);
        }
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
	
}());(function() {

WebinosDeviceOrientation = function (obj) {
	WebinosService.call(this, obj);
};

	// Inherit all functions from WebinosService
	WebinosDeviceOrientation.prototype = Object.create(WebinosService.prototype);	
	// The following allows the 'instanceof' to work properly
	WebinosDeviceOrientation.prototype.constructor = WebinosDeviceOrientation;
	// Register to the service discovery
	_webinos.registerServiceConstructor("http://webinos.org/api/deviceorientation", WebinosDeviceOrientation);

var _referenceMappingDo = new Array();
var _eventIdsDo = new Array('deviceorientation', 'compassneedscalibration', 'devicemotion');

WebinosDeviceOrientation.prototype.bindService = function (bindCB, serviceId) {
	// actually there should be an auth check here or whatever, but we just always bind
	this.addEventListener = addEventListener;
	this.removeEventListener = removeEventListener;
	this.dispatchEvent = dispatchEvent;
	
    //Objects
    this.DeviceOrientationEvent = DeviceOrientationEvent;
    this.DeviceMotionEvent = DeviceMotionEvent;
    this.Acceleration = Acceleration;
    this.RotationRate = RotationRate;
    
    
    
    
	if (typeof bindCB.onBind === 'function') {
		bindCB.onBind(this);
	};
}

function addEventListener(type, listener, useCapture) {
    
    if(_eventIdsDo.indexOf(type) != -1){	
    
            console.log("LISTENER"+ listener);
    
			var rpc = webinos.rpcHandler.createRPC(this, "addEventListener", [type, listener, useCapture]);
			_referenceMappingDo.push([rpc.id, listener]);

			console.log('# of references' + _referenceMappingDo.length);	
			rpc.onEvent = function (orientationEvent) {
				listener(orientationEvent);
			};
            
			webinos.rpcHandler.registerCallbackObject(rpc);
			webinos.rpcHandler.executeRPC(rpc);
		}else{
			console.log(type + ' not found');	
		}
};

//DEFINITION BASE EVENT
WDomEvent = function(type, target, currentTarget, eventPhase, bubbles, cancelable, timestamp){
	this.initEvent(type, target, currentTarget, eventPhase, bubbles, cancelable, timestamp);
}

WDomEvent.prototype.speed = 0;

WDomEvent.prototype.initEvent = function(type, target, currentTarget, eventPhase, bubbles, cancelable, timestamp){
    this.type = type;
    this.target = target;
    this.currentTarget = currentTarget;
    this.eventPhase = eventPhase;
    this.bubbles = bubbles;
    this.cancelable  = cancelable;
    this.timestamp = timestamp; 
}


DeviceOrientationEvent = function(alpha, beta, gamma){
	this.initDeviceOrientationEvent(alpha, beta, gamma);
}

DeviceOrientationEvent.prototype = new WDomEvent();
DeviceOrientationEvent.prototype.constructor = DeviceOrientationEvent;
DeviceOrientationEvent.parent = WDomEvent.prototype; // our "super" property

DeviceOrientationEvent.prototype.initDeviceOrientationEvent = function(alpha, beta, gamma){
	this.alpha = alpha;
	this.beta = beta;
	this.gamma = gamma;
    
    var d = new Date();
    var stamp = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
    var stamp = stamp + d.getUTCMilliseconds();
    
	DeviceOrientationEvent.parent.initEvent.call(this,'deviceorientation', null, null, null, false, false, stamp);
}
Acceleration = function(x,y,z){
	this.x = x;
	this.y = y;
	this.z = z;
}
RotationRate = function(alpha, beta, gamma){
	this.alpha = alpha;
	this.beta = beta;
	this.gamma = gamma;
}
DeviceMotionEvent = function(acceleration, accelerationIncludingGravity, rotationRate, interval){
	this.initDeviceMotionEvent(acceleration, accelerationIncludingGravity, rotationRate, interval);
}
DeviceMotionEvent.prototype = new WDomEvent();
DeviceMotionEvent.prototype.constructor = DeviceOrientationEvent;
DeviceMotionEvent.parent = WDomEvent.prototype; // our "super" property

DeviceMotionEvent.prototype.initDeviceMotionEvent = function(acceleration, accelerationIncludingGravity, rotationRate, interval){
	this.acceleration = acceleration;
	this.accelerationIncludingGravity = accelerationIncludingGravity;
	this.rotationRate = rotationRate;
	this.interval = interval;
    var d = new Date();
    var stamp = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
    var stamp = stamp + d.getUTCMilliseconds();
	DeviceOrientationEvent.parent.initEvent.call(this,'devicemotion', null, null, null, false, false, stamp);
}

function removeEventListener(type, listener, useCapture) {
        console.log("LISTENER"+ listener);
        var refToBeDeleted = null;
		for(var i = 0; i < _referenceMappingDo.length; i++){
			console.log("Reference" + i + ": " + _referenceMappingDo[i][0]);
			console.log("Handler" + i + ": " + _referenceMappingDo[i][1]);
			if(_referenceMappingDo[i][1] == listener){
					var arguments = new Array();
					arguments[0] = _referenceMappingDo[i][0];
					arguments[1] = type;
					console.log("ListenerObject to be removed ref#" + _referenceMappingDo[i][0]);                                             
                    var rpc = webinos.rpcHandler.createRPC(this, "removeEventListener", arguments);
					webinos.rpcHandler.executeRPC(rpc,
						function(result){
							callOnSuccess(result);
						},
						function(error){
							callOnError(error);
						}
					);
					break;			
			}	
    }
};

function dispatchEvent(event) {
    //TODO
};

})();/*******************************************************************************
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
* Copyright 2012 André Paul, Fraunhofer FOKUS
******************************************************************************/
(function() {

	// Mapping of local listenerId to remote listenerId
	var registeredListeners = {};

	// Mapping of listenerId to RPC callback obj
	var registeredRPCCallbacks = {};

	var eventService = null;

	/**
	 * Webinos Event service constructor (client side).
	 * @constructor
	 * @param obj Object containing displayName, api, etc.
	 */
	EventsModule = function(obj) {
		WebinosService.call(this, obj);
		eventService = this;
		this.idCount = 0;
		//this.myAppID = "TestApp" + webinos.messageHandler.getOwnSessionId();

		//TODO, this is the actuall messaging/session app id but should be replaced with the Apps unique ID (config.xml)
		this.myAppID = webinos.messageHandler.getOwnSessionId();
		console.log("MyAppID: " + this.myAppID);
	};

	// Inherit all functions from WebinosService
	EventsModule.prototype = Object.create(WebinosService.prototype);	
	// The following allows the 'instanceof' to work properly
	EventsModule.prototype.constructor = EventsModule;
	// Register to the service discovery
	_webinos.registerServiceConstructor("http://webinos.org/api/events", EventsModule);

	/**
	 * To bind the service.
	 * @param bindCB BindCallback object.
	 */
	EventsModule.prototype.bind = function(bindCB) {

		if (typeof bindCB.onBind === 'function') {
			bindCB.onBind(this);
		};
		
	};

	/**
	 * Creates a webinos Event.
	 * @param type Event type identifier.
	 * @param addressing References to the sending entity on the behalf of which the application wants to create the event and to the event recipients.
	 * @param payload Event type-specific data or null (undefined is considered as equivalent to null).
	 * @param inResponseTo Event that this event is a response to (undefined is considered as equivalent to null).
	 * @param withTimeStamp Whether to set the generation timestamp (undefined is considered as equivalent to false).
	 * @param expiryTimeStamp Moment in time past which the event is no more valid or meaningful (undefined is considered as equivalent to null).
	 * @param addressingSensitive Whether the addressing information is part of the informative content of the event (undefined is considered as equivalent to false).
	 */
	EventsModule.prototype.createWebinosEvent = function (type, addressing, payload, inResponseTo, withTimeStamp, expiryTimeStamp, addressingSensitive){

		var anEvent = new WebinosEvent();
		anEvent.type = type;
		anEvent.addressing = addressing;
		anEvent.payload = payload;
		anEvent.inResponseTo = inResponseTo;
		anEvent.timeStamp = new Date().getTime();
		anEvent.expiryTimeStamp = expiryTimeStamp;
		anEvent.addressingSensitive = addressingSensitive;


		//  raises(WebinosEventException);
		//	returns WebinosEvent
		return anEvent;
	};

	/**
	 * Registers an event listener.
	 * @param listener The event listener.
	 * @param type Specific event type or null for any type (undefined is considered as null).
	 * @param source Specific event source or null for any source (undefined is considered as null).
	 * @param destination Specific event recipient (whether primary or not) or null for any destination (undefined is considered as null).
	 * @returns Listener identifier.
	 */
	EventsModule.prototype.addWebinosEventListener = function(listener, type, source, destination) {

		if (this.idCount === Number.MAX_VALUE) this.idCount = 0;
		this.idCount++;

		var listenerId = this.myAppID + ":" + this.idCount;

		var reqParams = {
			type: type,
			source: source,
			destination: destination
		};
		if (!source) reqParams.source = this.myAppID;

		var rpc = webinos.rpcHandler.createRPC(this, "addWebinosEventListener",  reqParams);

		rpc.handleEvent = function(params, scb, ecb) {
			console.log("Received a new WebinosEvent");
			listener(params.webinosevent);
			scb();
		};

		webinos.rpcHandler.registerCallbackObject(rpc);

		// store RPC callback obj to unregister it when removing event listener
		registeredRPCCallbacks[listenerId] = rpc;

		webinos.rpcHandler.executeRPC(rpc,
			function(remoteId) {
				console.log("New WebinosEvent listener registered. Mapping remote ID", remoteId, " localID ", listenerId);

				registeredListeners[listenerId] = remoteId;
			},
			function(error) {
				console.log("Error while registering new WebinosEvent listener");
			}
		);

		// raises(WebinosEventException);
		return listenerId;
	};

	/**
     * Unregisters an event listener.
     * @param listenerId Listener identifier as returned by addWebinosEventListener().
     */
	EventsModule.prototype.removeWebinosEventListener = function(listenerId) {

		if (!listenerId || typeof listenerId !== "string") {
			throw new WebinosEventException(WebinosEventException.INVALID_ARGUMENT_ERROR, "listenerId must be string type");
		}

		var rpc = webinos.rpcHandler.createRPC(this, "removeWebinosEventListener",  registeredListeners[listenerId]);
		webinos.rpcHandler.executeRPC(rpc);

		// unregister RPC callback obj
		webinos.rpcHandler.unregisterCallbackObject(registeredRPCCallbacks[listenerId]);
		registeredRPCCallbacks[listenerId] = undefined;
		registeredListeners[listenerId] = undefined;

		// returns void
	};

	/**
	 * Webinos event exception constructor.
	 * @constructor
	 * @param code Error code.
	 * @param message Descriptive error message.
	 */
	WebinosEventException = function(code, message) {
		this.code = code;
		this.message = message;
	};
	// constants
	WebinosEventException.__defineGetter__("INVALID_ARGUMENT_ERROR",  function() {return 1});
	WebinosEventException.__defineGetter__("PERMISSION_DENIED_ERROR", function() {return 2});

	/**
	 * Webinos Event constructor.
	 * @constructor
	 */
	WebinosEvent = function() {
		this.id =  Math.floor(Math.random()*1001);  //DOMString
		this.type = null;					//DOMString
		this.addressing = {};  			//WebinosEventAddressing
		this.addressing.source = eventService.myAppID;
		this.inResponseTo = null;			//WebinosEvent
		this.timeStamp = null;				//DOMTimeStamp
		this.expiryTimeStamp = null;		//DOMTimeStamp
		this.addressingSensitive = null;	//bool
		this.forwarding = null;			//WebinosEventAddressing
		this.forwardingTimeStamp = null;	//DOMTimeStamp
		this.payload = null;				//DOMString
	};

	/**
	 * Sends an event.
	 * @param callbacks Set of callbacks to monitor sending status (null and undefined are considered as equivalent to a WebinosEventCallbacks object with all attributes set to null).
	 * @param referenceTimeout Moment in time until which the Webinos runtime SHALL ensure that the WebinosEvent object being sent is not garbage collected for the purpose of receiving events in response to the event being sent (null, undefined and values up to the current date/time mean that no special action is taken by the runtime in this regard).
	 * @param sync If false or undefined, the function is non-blocking, otherwise if true it will block.
	 */
	WebinosEvent.prototype.dispatchWebinosEvent = function(callbacks, referenceTimeout, sync) {

		var params = {
			webinosevent: {
				id: this.id,
				type: this.type,
				addressing: this.addressing,
				inResponseTo: this.inResponseTo,
				timeStamp: this.timeStamp,
				expiryTimeStamp: this.expiryTimeStamp,
				addressingSensitive: this.addressingSensitive,
				forwarding: this.forwarding,
				forwardingTimeStamp: this.forwardingTimeStamp,
				payload: this.payload
			},
			referenceTimeout: referenceTimeout,
			sync: sync
		};

		if (!params.webinosevent.addressing) {
			params.webinosevent.addressing = {};
		}
		params.webinosevent.addressing.source = {};
		params.webinosevent.addressing.source.id = eventService.myAppID;

		// check that callbacks has the right type
		if (callbacks) {
			if (typeof callbacks !== "object") {
				throw new WebinosEventException(WebinosEventException.INVALID_ARGUMENT_ERROR, "callbacks must be of type WebinosEventCallbacks");
			}
			var cbNames = ["onSending", "onCaching", "onDelivery", "onTimeout", "onError"];
			for (var cbName in cbNames) {
				var cb = callbacks[cbName];
				if (cb && typeof cb !== "function") {
					throw new WebinosEventException(WebinosEventException.INVALID_ARGUMENT_ERROR, "cb is not a function");
				}
			}
			params.withCallbacks = true;
		}

		var rpc = webinos.rpcHandler.createRPC(eventService, "WebinosEvent.dispatchWebinosEvent", params);

		if (callbacks) {

			console.log("Registering delivery callback");

			rpc.onSending = function (params) {
				// params.event, params.recipient
				if (callbacks.onSending) {
					callbacks.onSending(params.event, params.recipient);
				}
			};
			rpc.onCaching = function (params) {
				// params.event
				if (callbacks.onCaching) {
					callbacks.onCaching(params.event);
				}
			};
			rpc.onDelivery = function (params) {
				// params.event, params.recipient
				if (callbacks.onDelivery) {
					callbacks.onDelivery(params.event, params.recipient);
				}
				webinos.rpcHandler.unregisterCallbackObject(rpc);
			};
			rpc.onTimeout = function (params) {
				// params.event, params.recipient
				if (callbacks.onTimeout) {
					callbacks.onTimeout(params.event, params.recipient);
				}
				webinos.rpcHandler.unregisterCallbackObject(rpc);
			};
			rpc.onError = function (params) {
				// params.event, params.recipient, params.error
				if (callbacks.onError) {
					callbacks.onError(params.event, params.recipient, params.error);
				}
				webinos.rpcHandler.unregisterCallbackObject(rpc);
			};

			webinos.rpcHandler.registerCallbackObject(rpc);
		}

		webinos.rpcHandler.executeRPC(rpc);

		//raises(WebinosEventException);
		//returns void
    };

	/**
	 * Forwards an event.
	 * [not yet implemented]
	 */
	WebinosEvent.prototype.forwardWebinosEvent = function(forwarding, withTimeStamp, callbacks, referenceTimeout, sync){

    	//returns void
    	//raises(WebinosEventException);
    };

}());/*******************************************************************************
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
 * Webinos Geolocation service constructor (client side).
 * @constructor
 * @param obj Object containing displayName, api, etc.
 */
WebinosGeolocation = function (obj) {
	WebinosService.call(this, obj);
};
// Inherit all functions from WebinosService
WebinosGeolocation.prototype = Object.create(WebinosService.prototype);
// The following allows the 'instanceof' to work properly
WebinosGeolocation.prototype.constructor = WebinosGeolocation;
// Register to the service discovery
_webinos.registerServiceConstructor("http://webinos.org/api/w3c/geolocation", WebinosGeolocation);
// If you want to enable the old URI, uncomment the following line
//_webinos.registerServiceConstructor("http://www.w3.org/ns/api-perms/geolocation", WebinosGeolocation);

/**
 * To bind the service.
 * @param bindCB BindCallback object.
 */
WebinosGeolocation.prototype.bindService = function (bindCB, serviceId) {
	// actually there should be an auth check here or whatever, but we just always bind
	this.getCurrentPosition = getCurrentPosition;
	this.watchPosition = watchPosition;
	this.clearWatch = clearWatch;
	
	if (typeof bindCB.onBind === 'function') {
		bindCB.onBind(this);
	};
}

/**
 * Retrieve the current position.
 * @param positionCB Success callback.
 * @param positionErrorCB Error callback.
 * @param positionOptions Optional options.
 */
function getCurrentPosition(positionCB, positionErrorCB, positionOptions) { 
	var rpc = webinos.rpcHandler.createRPC(this, "getCurrentPosition", positionOptions); // RPC service name, function, position options
	webinos.rpcHandler.executeRPC(rpc, function (position) {
		positionCB(position);
	},
	function (error) {
		positionErrorCB(error);
	});
};

var watchIdTable = {};

/**
 * Register a listener for position updates.
 * @param positionCB Callback for position updates.
 * @param positionErrorCB Error callback.
 * @param positionOptions Optional options.
 * @returns Registered listener id.
 */
function watchPosition(positionCB, positionErrorCB, positionOptions) {
	var rpc = webinos.rpcHandler.createRPC(this, "watchPosition", [positionOptions]);

	rpc.onEvent = function (position) {
		positionCB(position);
	};

	rpc.onError = function (err) {
		positionErrorCB(err);
	};

	webinos.rpcHandler.registerCallbackObject(rpc);
	webinos.rpcHandler.executeRPC(rpc);

	var watchId = parseInt(rpc.id, 16);
	watchIdTable[watchId] = rpc.id;

	return watchId;
};

/**
 * Clear a listener.
 * @param watchId The id as returned by watchPosition to clear.
 */
function clearWatch(watchId) {
	var _watchId = watchIdTable[watchId];
	if (!_watchId) return;

	var rpc = webinos.rpcHandler.createRPC(this, "clearWatch", [_watchId]);
	webinos.rpcHandler.executeRPC(rpc);

	delete watchIdTable[watchId];
	webinos.rpcHandler.unregisterCallbackObject({api:_watchId});
};

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
* Copyright 2011 Andre Paul, Fraunhofer FOKUS
* Copyright 2013 Martin Lasak, Fraunhofer FOKUS
******************************************************************************/
(function() {

	/**
	 * ...
	 * @constructor
	 * @param obj Object containing displayName, api, etc.
	 */
	var WebNotificationModule = function(obj) {
		WebinosService.call(this, obj);
	};
	// Inherit all functions from WebinosService
	WebNotificationModule.prototype = Object.create(WebinosService.prototype);	
	// The following allows the 'instanceof' to work properly
	WebNotificationModule.prototype.constructor = WebNotificationModule;
	// Register to the service discovery
	_webinos.registerServiceConstructor("http://webinos.org/api/notifications", WebNotificationModule);
	
	/**
	 * To bind the service.
	 * @param bindCB BindCallback object.
	 */
	WebNotificationModule.prototype.bindService = function (bindCB, serviceId) {
		// actually there should be an auth check here or whatever, but we just always bind

		var that = this;
		this.Notification = function(title, options){
			return new NotificatioImpl(that, title, options);;
		};

		if (typeof bindCB.onBind === 'function') {
			bindCB.onBind(this);
		};
	}

	var NotificatioImpl = function (serviceModule, title, options){
		if(typeof title != "string" || !title) { console.error("Wrong parameter."); return; }
		var that = this;
		that._serviceModule = serviceModule;
		that.dir = (options.dir === "ltr" || options.dir === "rtl") ? options.dir : "auto";
		that.lang = (typeof options.lang === "string") ? options.lang : "";
		that.body = (typeof options.body === "string") ? options.body : "";
		that.tag = (typeof options.tag === "string") ? options.tag : "";
		that.icon = (typeof options.icon === "string") ? options.icon : "";
		var rpc = webinos.rpcHandler.createRPC(that._serviceModule, "notify", [title, options]);
		webinos.rpcHandler.executeRPC(rpc,
				function (params){
					//on success
				 	if(params == 'onclick' && that.onclick){
				 		that.onclick(params);
				 	}
				 	else if(params == 'onshow' && that.onshow){
				 		that.onshow(params);
				 	}
				 	else if(params == 'onclose' && that.onclose){
				 		that.onclose(params);
				 	}
				},
				function (error){
					if(that.onerror){
				 		that.onerror(error);
				 	}
				}
		);
	};

	NotificatioImpl.prototype.onclick = Function;
	NotificatioImpl.prototype.onshow = Function;
	NotificatioImpl.prototype.onclose = Function;
	NotificatioImpl.prototype.onerror = Function;

	NotificatioImpl.prototype.addEventListener = function(type, callback, capture){
		if(typeof type != "string" || typeof callback != "function") return;
		callback._eventref = Math.random()+Date.now();
		var rpc = webinos.rpcHandler.createRPC(this._serviceModule, "addEventListener", [type, capture, callback._eventref]);
		webinos.rpcHandler.executeRPC(rpc,callback,Function);
	};	

	NotificatioImpl.prototype.removeEventListener = function(type, callback, capture){
		if(typeof type != "string" || typeof callback != "function" || !callback._eventref) return;
		var rpc = webinos.rpcHandler.createRPC(this._serviceModule, "removeEventListener", [type, capture, callback._eventref]);
		webinos.rpcHandler.executeRPC(rpc,Function,Function);
	};			

	NotificatioImpl.prototype.dispatchEvent = function(event){
		if(typeof type != "object") return;
		var rpc = webinos.rpcHandler.createRPC(this._serviceModule, "dispatchEvent", [event]);
		webinos.rpcHandler.executeRPC(rpc,Function,Function);
	};

	NotificatioImpl.prototype.dir = "auto";
	NotificatioImpl.prototype.body = "";
	NotificatioImpl.prototype.lang = "";
	NotificatioImpl.prototype.tag = "";
	NotificatioImpl.prototype.icon = "";

	NotificatioImpl.prototype.close = function(){
		console.log("close called")
		this.onshow = Function;
		this.onclick = Function;
		this.onerror = Function;
		var onclose = this.onclose || Function;
		this.onclose = Function;
		var rpc = webinos.rpcHandler.createRPC(this._serviceModule, "close");
		webinos.rpcHandler.executeRPC(rpc,onclose,Function);
	};	
	
}());/*******************************************************************************
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
 ******************************************************************************/
(function() {

	PolicyManagementModule = function(obj) {
		WebinosService.call(this, obj);
	};
	
	// Inherit all functions from WebinosService
	PolicyManagementModule.prototype = Object.create(WebinosService.prototype);	
	// The following allows the 'instanceof' to work properly
	PolicyManagementModule.prototype.constructor = PolicyManagementModule;
	// Register to the service discovery
	_webinos.registerServiceConstructor("http://webinos.org/core/policymanagement", PolicyManagementModule);


    PolicyManagementModule.prototype.bindService = function (bindCB, serviceId) {
        this.policy = policy;
        this.policyset = policyset;
        this.getPolicySet = getPolicySet;
        this.testPolicy = testPolicy;
        this.testNewPolicy = testNewPolicy;
        this.save = save;

        if (typeof bindCB.onBind === 'function') {
            bindCB.onBind(this);
        };
    }


    var policy = function(ps, id, combine, description){

        var _ps = ps;
        if(ps)
            _ps = ps;
        else{
            _ps = {};
            _ps['$'] = {};
            _ps['$']["id"] = (id) ? id : getNewId();
        }

        if(combine)
            _ps['$']["combine"] = combine;
        if(description)
            _ps['$']["description"] = description;

        function getNewId(type) {
            return new Date().getTime();
        };

        this.getInternalPolicy = function(){
            return _ps;
        };

        //this.updateRule = function(ruleId, effect, updatedCondition){
        this.updateRule = function(ruleId, key, value){
            if(!_ps) {
                return null;
            }

//            if(effect != 'permit' && effect != 'prompt-oneshot' && effect != 'prompt-session' && effect != 'prompt-blanket' && effect != 'deny') {
//                effect = "";
//            }

            //console.log("Effect :: "+effect);
            var policy = _ps;
            var rule;
            var count=0;
            for(var i in policy["rule"]) {
                if(policy["rule"][i]['$']["id"] == ruleId) {
                    rule = policy["rule"][i];
                    break;
                }
                count++;
            }

            if(rule){


                if(key == "effect"){
                    if(value)
                        rule['$']["effect"] = value;
                    else
                        rule['$']["effect"] = "permit";
                }
                else if(key == "condition"){

                    if(value){
                        if(rule.condition){
                            //check first child
                            var parent = rule["condition"];

                            var tmp = parent[0];
                            console.log(JSON.stringify(rule["condition"]));
                            if(tmp['$']["id"] == value['$']["id"]){
                                parent[0] = value;
                                return;
                            }

                            //check other children
                            while(true){
                                if(tmp.condition && value){

                                    if(tmp.condition[0]['$']["id"] == value['$']["id"]){
                                        tmp.condition[0] = value;
                                        return;
                                    }
                                    else
                                        tmp = tmp.condition;
                                }
                                else
                                    break;
                            }
                        }
                        else{
                            rule["condition"] = [value];
                        }
                    }
                    else{
                        if(rule.condition){
                            rule.condition = undefined;
                        }
                        else
                        {
                            ;
                        }
                    }
                }
/*
                if(!updatedCondition)
                    if(rule["condition"])
                        rule["condition"] = undefined;

                else if(!rule.condition){
                    console.log("No condition");
                    rule["condition"] = new Array();
                    rule["condition"][0] = updatedCondition;
                }

                else{

                    //check first child
                    var parent = rule["condition"];

                    var tmp = parent[0];

                    if(tmp['$']["id"] == updatedCondition['$']["id"]){
                        parent[0] = updatedCondition;
                        return;
                    }

                    //check other children
                    while(true){
                        if(tmp.condition && updatedCondition){
                            if(tmp.condition[0]['$']["id"] == updatedCondition['$']["id"]){
                                tmp.condition[0] = updatedCondition;
                                return;
                            }
                            else
                                tmp = tmp.condition;
                        }
                        else
                            break;
                    }
                }*/
            }
        }

        this.addRule = function(newRuleId, effect, newCondition, rulePosition){
            if(!_ps) {
                return null;
            }

            //Check if effect is valid value (deny is included in default rule)
            if(effect != 'permit' && effect != 'prompt-oneshot' && effect != 'prompt-session' && effect != 'prompt-blanket' && effect != 'deny') {
                effect = "permit";
            }

            //console.log("Effect :: "+effect);
            var policy = _ps;

            var rule;
            for(var i in policy['rule']) {
                if(policy['rule'][i]['$']['effect'] == effect) {
                    rule = policy['rule'][i];
                    break;
                }
            }
            //console.log("rule :: "+rule);

            if(!rule){
                var id = (newRuleId) ? newRuleId : new Date().getTime();
                rule = {"$": {"id" : id, "effect" : effect}};
                var position = 0;
                if(rulePosition && (rulePosition<0 || policy["rule"].length == 0))
                    policy["rule"].length;
                if(!rulePosition && policy["rule"])
                    position = policy["rule"].length;

                console.log("position : "+position);
                if(!policy["rule"])
                    policy["rule"] = [rule];
                else
                    policy["rule"].splice(position, 0, rule);
            }

            if(newCondition){
                if(!rule.condition){
                    console.log("No condition");
                    rule["condition"] = [newCondition];
                }
                else{
                    var tmp = rule["condition"][0];
                    while(true){
                        if(tmp.condition){
                            tmp = tmp.condition[0];
                        }
                        else
                            break;
                    }

                    tmp["condition"] = [newCondition];
                }
            }
        };

        this.removeRule = function(ruleId) {
            if(!_ps) {
                return null;
            }
            if(ruleId == null) {
                return null;
            }

            var policy = _ps;

            //console.log("PRE : " + JSON.stringify(policy["rule"]));
            if(policy["rule"]){
                var index = -1;
                var count = 0;

                for(var i in policy["rule"]){
                    if(policy["rule"][i]["$"]["id"] && policy["rule"][i]["$"]["id"] == ruleId){
                        index = i;
                        //break;
                    }
                    count ++;
                }
                if(index != -1){
                    console.log("Removing rule " + index);
                    policy["rule"].splice(index,1);
                    if(count == 1)
                        policy["rule"] = undefined;
                }


            }
            else
                console.log("No rules");
        };

        this.addSubject = function(newSubjectId, matches){
            if(!_ps) {
                return null;
            }

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            if(policy == null) {
                return null;
            }

            var id = (newSubjectId) ? newSubjectId : new Date().getTime();
            var newsubj = {"$" : {"id" : id} , "subject-match" : [] };

            for(var i in matches){
                if(i == "subject-match")
                    newsubj["subject-match"].push(matches[i]);
            }

            if(!policy.target)
                policy.target = [{}];
            if(!policy.target[0]["subject"])
                policy.target[0]["subject"] = [];

            //console.log(JSON.stringify(policy.target[0]));
            for(var i =0; i<policy.target[0]["subject"].length; i++){
                    if(policy.target[0]["subject"][i]['$']["id"] == newSubjectId){
                        console.log("A subject with " + newSubjectId + " is already present");
                        return;
                    }
                }
            policy.target[0]["subject"].push(newsubj);
            //console.log(JSON.stringify(policy.target[0]));

        };
/*
        this.getSubjects = function(policyId){
            if(!_ps) {
                return null;
            }

            var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;

            if(policy == null) {
                return null;
            }
            var subjects = policy.target[0]["subject"];

            return subjects;
        };*/

        this.removeSubject = function(subjectId) {
            if(!_ps) {
                return null;
            }
            /*
            if(policyId == null) {
                return;
            }*/

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            //console.log(policy);

            var count = 0;

            if(policy.target && policy.target[0] && policy.target[0]["subject"]){
                var index = -1;
                for(var i in policy.target[0]["subject"]){
                    console.log(policy.target[0]["subject"][i]["$"]["id"]);
                    if(policy.target[0]["subject"][i]["$"]["id"] && policy.target[0]["subject"][i]["$"]["id"] == subjectId){
                        index = i;
                        //break;
                    }
                    count++;
                }
                if(index != -1){
                    console.log("remove "+index);
                    policy.target[0]["subject"].splice(index,1);
                }
                if(count == 1)
                    //policy.target = [];
                    policy.target = undefined;
            }
            //console.log("AFTER : " + JSON.stringify(policy["rule"]));
        };

        this.updateSubject = function(subjectId, matches){
            if(!_ps) {
                return null;
            }

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            if(policy == null) {
                return null;
            }
            if(policy.target && policy.target[0] && policy.target[0]["subject"]){
                var subjects = policy.target[0]["subject"];
                for(var i in subjects){
                    if(subjects[i]['$']["id"] == subjectId)
                        subjects[i]["subject-match"] = matches["subject-match"];
                }
            }
        };

        this.updateAttribute = function(key, value){
            if (!key) {
                return;
            }
            if (key == "combine") {
                _ps['$']["combine"] = value;
            }
            else if (key == "description") {
                _ps['$']["description"] = value;
            }

        };

        this.toJSONObject = function(){
            return _ps;
        };
    };

    var policyset = function(ps ,type, basefile, fileId, id, combine, description) {
        var _type = type;
        var _basefile = basefile;
        var _fileId = fileId;

        var _parent;

        //var id = (newSubjectId) ? newSubjectId : new Date().getTime();
        var _ps = ps;
        if(ps)
            _ps = ps;
        else{
            _ps = {};
            _ps['$'] = {};
            _ps['$']["id"] = (id) ? id : getNewId();
        }

        if(combine)
            _ps['$']["combine"] = combine;
        if(description)
            _ps['$']["description"] = description;

        this.getBaseFile = function(){
            return _basefile;
        };

        this.getFileId = function(){
            return _fileId;
        };

        function getNewId(type) {
            return new Date().getTime();
        }

        function getPolicyById(policySet, policyId) {
            //console.log('getPolicyById - policySet is '+JSON.stringify(policySet));
            /*
            if(policyId == null || (policySet['$']['id'] && policySet['$']['id'] == policyId)) {
                return policySet;
            }
            */
            if(policySet['policy']) {
                for(var j in policySet['policy']) {
                    if(policySet['policy'][j]['$']['id'] == policyId) {
                        return policySet['policy'][j];
                    }
                }
            }
            if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    if(policySet['policy-set'][j]['$']['id'] == policyId) {
                        return policySet['policy-set'][j];
                    }
                    var tmp = getPolicyById(policySet['policy-set'][j], policyId);
                    if(tmp != null) {
                        return tmp;
                    }
                }
            }
            return null;
        };

        function getPolicySetById(policySet, policyId) {
            //console.log('getPolicyById - policySet is '+JSON.stringify(policySet));

            if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    if(policySet['policy-set'][j]['$']['id'] == policyId) {
                        return policySet['policy-set'][j];
                    }
                    var tmp = getPolicyById(policySet['policy-set'][j], policyId);
                    if(tmp != null) {
                        return tmp;
                    }
                }
            }
            return null;
        };

        function getPolicySetBySubject(policySet, subject) {
            var res = {'generic':[], 'matched':[]};
            if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    var checkRes = checkPolicySetSubject(policySet['policy-set'][j] , subject);
                    if (checkRes == 0){
                        res['generic'].push(new policyset(policySet['policy-set'][j], "policy-set"));
                    } else if (checkRes == 1){
                        res['matched'].push(new policyset(policySet['policy-set'][j], "policy-set"));
                    }
                    if (policySet['policy-set'][j]['policy-set']){
                        var tmpRes = getPolicySetBySubject(policySet['policy-set'][j], subject);
                        for (var e in tmpRes){
                            if (res[e] && tmpRes[e].length > 0){
                                res[e] = res[e].concat(tmpRes[e]);
                            }
                        }
                    }
                }
            }
            return res;
        }

        function checkPolicySetSubject(policySet, subject) {
            psSubject = null;
            var tempSubject = JSON.parse(JSON.stringify(subject));
            try{
                psSubject = policySet['target'][0]['subject'];
            }
            catch(err) {
                return 0; //subject not specified (it's still a subject match)
            }
            if (psSubject){
                for (var i in psSubject) {
                    temp = null;
                    try {
                        temp = psSubject[i]['subject-match'][0]['$']['match'];
                    } catch (err) { continue; }

                    // Change the string of psSubjectMatch_i to array psSubjectMatch_i.
                    var psSubjectMatch_i = temp.split(',');


                    if(psSubjectMatch_i.length > 1) {
                        for(var j in psSubjectMatch_i) {
                            // psSubjectMatch_i_j = null;
                            try {
                                var psSubjectMatch_i_j = psSubjectMatch_i[j];
                            } catch(err) { continue; }

                            var index = tempSubject.indexOf(psSubjectMatch_i_j);
                            if (index > -1){
                                //numMatchedSubjects++;
                                tempSubject.splice(index,1);
                            }
                        }
                    } else {
                        var index = tempSubject.indexOf(psSubjectMatch_i[0]);
                        if (index > -1) {
                            tempSubject.splice(index,1);
                        }
                    }
                }
                if (tempSubject.length == 0){
                    return 1; //subject matches
                }
            }
            return -1; //subject doesn't match
        }

        function getPolicyBySubject(policySet, subject) {
            var res = {'generic':[], 'matched':[]};
            // if(policySet['policy'] && checkPolicySetSubject(policySet, subject) > -1) {
            if(policySet['policy']) {
                for(var j in policySet['policy']) {
                    var tempSubject = JSON.parse(JSON.stringify(subject));
                    pSubject = null;
                    try{
                        pSubject = policySet['policy'][j]['target'][0]['subject'];
                    }
                    catch(err) {
                        res['generic'].push(new policy(policySet['policy'][j]));
                    }
                    if (pSubject){
                        // var numMatchedSubjects = 0;
                        for (var i in pSubject) {
                            temp = null;
                            // pSubjectMatch_i = null;
                            try {
                                // pSubjectMatch_i = pSubject[i]['subject-match'][0]['$']['match'];
                                temp = pSubject[i]['subject-match'][0]['$']['match'];
                            } catch (err) { continue; }

                            var pSubjectMatch_i = temp.split(',');
                            if (pSubjectMatch_i.length > 1) {

                                for (var m in pSubjectMatch_i) {
                                    // pSubjectMatch_i_j = null;
                                    try {
                                        var pSubjectMatch_i_j = pSubjectMatch_i[m];
                                    } catch(err) { continue; }

                                    var index = tempSubject.indexOf(pSubjectMatch_i_j);
                                    if (index > -1){
                                        // numMatchedSubjects++;
                                        tempSubject.splice(index,1);
                                    }
                                }

                            } else {
                                var index = tempSubject.indexOf(pSubjectMatch_i[0]);
                                if (index > -1){
                                    // numMatchedSubjects++;
                                    tempSubject.splice(index,1);
                                }
                            }
                            if (tempSubject.length == 0) {
                                res['matched'].push(new policy(policySet['policy'][j]));
                                break;
                            }
                        }
                    }
                }
            }

            /*if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    var tmpRes = getPolicyBySubject(policySet['policy-set'][j], subject);
                    for (var e in tmpRes){
                        if (res[e] && tmpRes[e].length > 0){
                            res[e] = res[e].concat(tmpRes[e]);
                        }
                    }
                }
            }*/
            return res;
        }

        this.removeSubject = function(subjectId, policyId) {
            if(!_ps) {
                return null;
            }
            if(policyId == null) {
                return;
            }

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            //console.log(policy);

            if(policy.target[0]["subject"]){
                var index = -1;
                for(var i in policy.target[0]["subject"]){
                    console.log(policy.target[0]["subject"][i]["$"]["id"]);
                    if(policy.target[0]["subject"][i]["$"]["id"] && policy.target[0]["subject"][i]["$"]["id"] == subjectId){
                        index = i;
                        break;
                    }
                }
                if(index != -1){
                    console.log("remove "+index);
                    policy.target[0]["subject"].splice(index,1);
                }
            }
            //console.log("AFTER : " + JSON.stringify(policy["rule"]));
        };


        function removePolicySetById(policySet, policySetId) {
            if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    if(policySet['policy-set'][j]['$']['id'] == policySetId) {
                        policySet['policy-set'].splice(j, 1);
                        return true;
                    }
                    /*if(removePolicyById(policySet['policy-set'][j], policyId)) {
                        return true;
                    }*/
                }
            }
            return false;
        }

        function removePolicyById(policySet, policyId) {
            //console.log('removePolicyById - id is '+policyId+', set is '+JSON.stringify(policySet));
            if(policySet['policy']) {
                for(var j in policySet['policy']) {
                    if(policySet['policy'][j]['$']['id'] == policyId) {
                        policySet['policy'].splice(j, 1);
                        return true;
                    }
                }
            }
            /*
            if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    if(policySet['policy-set'][j]['$']['id'] == policyId) {
                        policySet['policy-set'].splice(j, 1);
                        return true;
                    }
                    if(removePolicyById(policySet['policy-set'][j], policyId)) {
                        return true;
                    }
                }
            }*/
            return false;
        }

        this.getInternalPolicySet = function(){
            return _ps;
        };

        this.createPolicy = function(policyId, combine, description){
//        function createPolicy(policyId, combine, description){
            return new policy(null, policyId, combine, description);
        };

        this.createPolicySet = function(policySetId, combine, description){
       //function createPolicySet(policySetId, combine, description){
            return new policyset(null, policySetId, _basefile, _fileId, policySetId, combine, description);
        };


      this.addPolicy = function(newPolicy, newPolicyPosition){
//      this.addPolicy = function(policyId, combine, description, newPolicyPosition, succCB){
//      var newPolicy = createPolicy(policyId, combine, description);
            if(!_ps)
                return null;

            if(!_ps["policy"])
                _ps["policy"] = new Array();
            else{
                for(var i =0; i<_ps["policy"].length; i++){
                    console.log(JSON.stringify(newPolicy.getInternalPolicy()));
                    if(_ps["policy"][i]['$']["id"] == newPolicy.getInternalPolicy()['$']["id"]){
                        console.log("A policy with " + newPolicy.getInternalPolicy()['$']["id"] + " is already present");
                        return;
                    }
                }
            }
            var position = (newPolicyPosition == undefined || newPolicyPosition<0 || _ps["policy"].length == 0) ? _ps["policy"].length : newPolicyPosition;
            _ps['policy'].splice(position, 0, newPolicy.getInternalPolicy());
            //succCB(newPolicy);

        };

        this.addPolicySet = function(newPolicySet, newPolicySetPosition){
        //this.addPolicySet = function(policySetId, combine, description, newPolicySetPosition){
            //var newPolicySet = createPolicySet(policySetId, combine, description);
            if(!_ps)
                return null;

            if(!_ps['policy-set'])
                _ps['policy-set'] = new Array();
            else{
                for(var i =0; i<_ps['policy-set'].length; i++){
                    console.log(JSON.stringify(newPolicySet.getInternalPolicySet()));
                    if(_ps['policy-set'][i]['$']['id'] == newPolicySet.getInternalPolicySet()['$']['id']){
                        console.log("A policyset with " + newPolicySet.getInternalPolicySet()['$']['id'] + " is already present");
                        return;
                    }
                }
            }
            var position = (newPolicySetPosition == undefined || newPolicySetPosition<0 || _ps['policy-set'].length == 0) ? _ps['policy-set'].length : newPolicySetPosition;
            _ps['policy-set'].splice(position, 0, newPolicySet.getInternalPolicySet());
            /*
            if(!_ps)
                return null;

            if(!_ps["policy-set"])
                _ps["policy-set"] = new Array();

            var position = (newPolicySetPosition == undefined || newPolicySetPosition<0 || _ps["policy-set"].length == 0) ? _ps["policy-set"].length : newPolicySetPosition;
//            var position = (!newPolicySetPosition || _ps["policy-set"].length == 0) ? 0 : newPolicySetPosition;

            _ps['policy-set'].splice(position, 0, newPolicySet.getInternalPolicySet());
            */
        };



        // add subject to policyset
        this.addSubject = function(newSubjectId, matches){
            if(!_ps) {
                return null;
            }

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            if(policy == null) {
                return null;
            }

            var id = (newSubjectId) ? newSubjectId : new Date().getTime(); //Ecco perchè inserendo ID vuoto metto la data
            var newsubj = {"$" : {"id" : id} , "subject-match" : [] };

            for(var i in matches){
                if(i == "subject-match")
                    newsubj["subject-match"].push(matches[i]);
            }
            if(!policy.target)
                policy.target = [{}];

            if(!policy.target[0]["subject"])
                policy.target[0]["subject"] = [];

            //console.log(JSON.stringify(policy.target[0]));
            for(var i =0; i<policy.target[0]["subject"].length; i++){
                    if(policy.target[0]["subject"][i]['$']["id"] == newSubjectId){
                        console.log("A subject with " + newSubjectId + " is already present");
                        return;
                    }
                }
            policy.target[0]["subject"].push(newsubj);
            //console.log(JSON.stringify(policy.target[0]));

        };

        this.getPolicy = function(policyId){
            if (policyId){
                if(typeof policyId == "object" && policyId.length){
                    var res = getPolicyBySubject(_ps, policyId);
                    var tempSubject = replaceId(policyId);
                    // Because of the default copying action, the tempSubject can never be zero.
                    if ((tempSubject.indexOf("http://webinos.org/subject/id/PZ-Owner") != -1) || (tempSubject.indexOf("http://webinos.org/subject/id/known") != -1 )) {
                        var res2 = getPolicyBySubject(_ps, tempSubject);
                        var res = joinResult(res, res2);
                    }
                    return res;
                } else {
                    var tmp = getPolicyById(_ps, policyId);
                    if(tmp){
                        return new policy(tmp);
                    }
                }
            }
        };

        this.getPolicySet = function(policySetId){
            if(policySetId){
                if(typeof policySetId == "object" && policySetId.length){
                    var res = getPolicySetBySubject(_ps, policySetId);
                    var tempSubject = replaceId(policySetId);
                    if ((tempSubject.indexOf("http://webinos.org/subject/id/PZ-Owner") != -1) || (tempSubject.indexOf("http://webinos.org/subject/id/known") !=-1 )) {
                        var res2 = getPolicySetBySubject(_ps, tempSubject);
                        var res = joinResult(res, res2);
                    }
                    return res;
                } else {
                    var tmp = getPolicySetById(_ps, policySetId);
                    if(tmp){
                        return new policyset(tmp, "policy-set", _basefile, _fileId);
                    }
                }
            }
        };

/*
        this.getSubjects = function(policyId){
            if(!_ps) {
                return null;
            }

            var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;

            if(policy == null) {
                return null;
            }
            var subjects = policy.target[0]["subject"];

            return subjects;
        };
*/
        this.updateSubject = function(subjectId, matches){
        //this.updateSubject = function(subjectId, matches/*, policyId*/ ){
            if(!_ps) {
                return null;
            }

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            if(policy == null) {
                return null;
            }

            if(policy.target && policy.target[0] && policy.target[0]["subject"]){
                var subjects = policy.target[0]["subject"];
                for(var i in subjects){
                    console.log(subjects[i]['$']["id"]);
                    if(subjects[i]['$']["id"] == subjectId)
                        subjects[i]["subject-match"] = matches["subject-match"];
                }
            }
        };

        this.removePolicy = function(policyId){
            if(!_ps) {
                return null;
            }
            if(policyId == null) {
                return;
            }
            if (!_ps['policy']) {
                return null;
            }
            removePolicyById(_ps, policyId);
            if (_ps['policy'].length == 0) {
                _ps['policy'] = undefined;
            }
        };

        this.removePolicySet = function(policySetId){
            if(!_ps) {
                return null;
            }
            if(policySetId == null) {
                return;
            }
            if (!_ps['policy-set']) {
                return null;
            }
            removePolicySetById(_ps, policySetId);
            console.log(_ps['policy-set']);
            if (_ps['policy-set'].length == 0) {
                _ps['policy-set'] = undefined;
            }
        };



        this.removeSubject = function(subjectId) {
            if(!_ps) {
                return null;
            }
            /*
            if(policyId == null) {
                return;
            }*/

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            //console.log(policy);

            var count = 0;

            if(policy.target && policy.target[0] && policy.target[0]["subject"]){
                var index = -1;
                for(var i in policy.target[0]["subject"]){
                    console.log(policy.target[0]["subject"][i]["$"]["id"]);
                    if(policy.target[0]["subject"][i]["$"]["id"] && policy.target[0]["subject"][i]["$"]["id"] == subjectId){
                        index = i;
                        //break;
                    }
                    count++;
                }
                if(index != -1){
                    console.log("remove "+index);
                    policy.target[0]["subject"].splice(index,1);
                    if(count == 1)
                        policy.target = undefined;
                }

            }
            //console.log("AFTER : " + JSON.stringify(policy["rule"]));
        };

        this.updateAttribute = function(key, value){
          if(key == "combine" || key == "description"){
            _ps['$'][key] = value;
          }
        };
        /*function(policySetId, combine, description){
            if(policySetId)
                _ps['$']["id"] = policySetId;
            if(combine)
                _ps['$']["combine"] = combine;
            if(description)
                _ps['$']["description"] = description;};*/


        this.toJSONObject = function(){
            return _ps;
            //return "ID : " + _id + ", DESCRIPTION : " + _ps.$.description + ", PATH : " + _basefile;
        }
    }

    var policyFiles = new Array();

    function getPolicySet(policyset_id, success, error) {
        var successCB = function(params){
            var ps = new policyset(params, "policy-set", policyset_id) ;
            console.log(ps);
            success(ps);
        }

        if(!policyFiles || policyFiles.length == 0) {
            var rpc = webinos.rpcHandler.createRPC(this, "getPolicy", [policyset_id]); // RPC service name, function, position options
            webinos.rpcHandler.executeRPC(rpc
                , function (params) {
                    successCB(params);
                }
                , function (error) {
                    console.log(error);
                }
            );
        }
        else {
            success(new policyset(policyFiles[policyset_id].content, "policy-set", policyset_id));
        }
    };

    function save(policyset, successCB, errorCB) {
        var rpc = webinos.rpcHandler.createRPC(this, "setPolicy", [policyset.getBaseFile(), JSON.stringify(policyset.toJSONObject())]);
        webinos.rpcHandler.executeRPC(rpc
            , function (params) {
                successCB(params);
            }
            , function (error) {
                errorCB(error);
            }
        );
    };

    function testPolicy(policyset, request, successCB, errorCB) {
        var rpc = webinos.rpcHandler.createRPC(this, "testPolicy", [policyset.getBaseFile(), JSON.stringify(request)]);
        webinos.rpcHandler.executeRPC(rpc
            , function (params) {
                successCB(params);
            }
            , function (error) {
                errorCB(error);
            }
        );
    };
    function testNewPolicy(policyset, request, successCB, errorCB) {
        var rpc = webinos.rpcHandler.createRPC(this, "testNewPolicy", [JSON.stringify(policyset.toJSONObject()), JSON.stringify(request)]);
        webinos.rpcHandler.executeRPC(rpc
            , function (params) {
                successCB(params);
            }
            , function (error) {
                errorCB(error);
            }
        );
    };

// Start point..............
// This function is used to test if the userId belongs to the friends array.
    function userBelongsToFriend(userId) {
        if (userId !== webinos.session.getPZHId()) {
            var friends = webinos.session.getConnectedPzh();
            var index = friends.indexOf(userId);
            if (index > -1){
                return 1;
            }
        }
        return 0;
    }
// This function is used to replace the elements (ids) in the subject, and to  make it simple, only two possible values, one is the generic URI of zone owner, and another is the friends. Then return the changed subject (tempSubject).
    function replaceId(subject) {
        var friendFound = false;
        var tempSubject = [];

        var zoneOwner = webinos.session.getPZHId();
        if (!zoneOwner) {
            zoneOwner = webinos.session.getPZPId();
        }

        for (var j in subject) {
            if (subject[j] === zoneOwner) {
                tempSubject.push("http://webinos.org/subject/id/PZ-Owner");
            } else if (userBelongsToFriend(subject[j])) {
                if (friendFound == false) {
                    tempSubject.push("http://webinos.org/subject/id/known");
                    friendFound = true;
                }
            // do nothing if friendFound is true
            } else {
                // default behaviour, copy item
                tempSubject.push(subject[j]);
            }
        }
        return tempSubject;
    }

    function deepCopy(p,c) {
        var c = c || {};
        for (var i in p) {
            if (typeof p[i] === 'object') {
                c[i] = (p[i].constructor === Array) ? [] : {};
                deepCopy(p[i], c[i]);
            }
            else {
                c[i] = p[i];
            }
        }
        return c;
    }

// This function used to join two results together, res2 only can have two elements at most, one in the generic set and one in the matched set. So ckecked them one by one is the easiest solution. To avoid duplication, in both if functions, also check if the element in the res2 already presented in the res1, if already presented, skip this step, other wise push the element in res1, and return res1.
    function joinResult(res1, res2) {
        var found_g = false, found_m = false;
        var res = deepCopy(res1);
        for (var i in res2['generic']) {
            for (var j in res1['generic']) {
                if (res1['generic'][j].toJSONObject() === res2['generic'][i].toJSONObject() ) {
                    found_g = true;
                    break;
                }
            }
            if (found_g == false) {
                res['generic'].push(res2['generic'][i]);
            }
            found_g = false;
        }

        for (var m in res2['matched']) {
            for (var n in res1['matched']) {
                if (res1['matched'][n].toJSONObject() === res2['matched'][m].toJSONObject() ) {
                    found_m = true;
                    break;
                }
            }
            if (found_m == false) {
                res['matched'].push(res2['matched'][m]);
            }
            found_m = false;
        }

        return res;
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
  var App2AppModule = function (obj) {
    WebinosService.call(this, obj);

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

  // Inherit all functions from WebinosService
  App2AppModule.prototype = Object.create(WebinosService.prototype);
  // The following allows the 'instanceof' to work properly
  App2AppModule.prototype.constructor = App2AppModule;
  // Register to the service discovery
  _webinos.registerServiceConstructor("http://webinos.org/api/app2app", App2AppModule);

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
		WebinosService.call(this, obj);
	};
	
	// Inherit all functions from WebinosService
	AppLauncherModule.prototype = Object.create(WebinosService.prototype);	
	// The following allows the 'instanceof' to work properly
	AppLauncherModule.prototype.constructor = AppLauncherModule;
	// Register to the service discovery
	_webinos.registerServiceConstructor("http://webinos.org/api/applauncher", AppLauncherModule);

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
		WebinosService.call(this, obj);
	};
	
	DeviceStatusManager.prototype = Object.create(WebinosService.prototype);
	// The following allows the 'instanceof' to work properly
	DeviceStatusManager.prototype.constructor = DeviceStatusManager;
	// Register in the service discovery
	_webinos.registerServiceConstructor("http://webinos.org/api/devicestatus", DeviceStatusManager);

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
    WebinosService.call(this, obj);
  };

  // Inherit all functions from WebinosService
  MediaContentModule.prototype = Object.create(WebinosService.prototype);
  // The following allows the 'instanceof' to work properly
  MediaContentModule.prototype.constructor = MediaContentModule;
  // Register to the service discovery
  _webinos.registerServiceConstructor("http://webinos.org/api/mediacontent", MediaContentModule);

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
    // Inherit all functions from WebinosService
    Media.prototype = Object.create(WebinosService.prototype);
    // The following allows the 'instanceof' to work properly
    Media.prototype.constructor = Media;
    // Register to the service discovery
    _webinos.registerServiceConstructor("http://webinos.org/api/mediaplay", Media);

    Media.prototype.bindService = function (bindCB, serviceId) {
	    if (typeof bindCB.onBind === 'function') {
		    bindCB.onBind(this);
	    };

        var rpc = webinos.rpcHandler.createRPC(this, "bindService");
        webinos.rpcHandler.executeRPC(rpc);
    }
    var rpcCB = {};

    Media.prototype.addListener = function(listeners, successCB, errorCB)
	{
        //should be checked if a rpcCB has been already created. So, it should be prevented an application to register multiple listeners.

        rpcCB = webinos.rpcHandler.createRPC(this, "addListener");

        rpcCB.onStop = rpcCB.onEnd = rpcCB.onPlay = rpcCB.onPause = rpcCB.onVolumeUP = rpcCB.onVolumeDOWN = rpcCB.onVolumeSet = function(){};

        if(typeof listeners.onStop === "function")
            rpcCB.onStop = listeners.onStop;

        if(typeof listeners.onEnd === "function")
            rpcCB.onEnd = listeners.onEnd;

        if(typeof listeners.onPlay === "function")
            rpcCB.onPlay = listeners.onPlay;

        if(typeof listeners.onPause === "function")
            rpcCB.onPause = listeners.onPause;

        if(typeof listeners.onVolume === "function")
            rpcCB.onVolume = listeners.onVolume;

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
	
	Media.prototype.removeAllListeners = function(successCB, errorCB)
    {
        var rpc = webinos.rpcHandler.createRPC(this, "removeAllListeners");
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

    Media.prototype.play = function(URI, successCB, errorCB)
    {
        var rpc = webinos.rpcHandler.createRPC(this, "startPlay", [ URI ]);
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

    Media.prototype.seek = function(step, successCB, errorCB)
    {
        var rpc = webinos.rpcHandler.createRPC(this, "seek", [ step ]);
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

    Media.prototype.setVolume = function(volume, successCB, errorCB)
    {
        var rpc = webinos.rpcHandler.createRPC(this, "setVolume", [ volume ]);
        webinos.rpcHandler.executeRPC(rpc, function(params)
        {
            if (typeof(successCB) === 'function')successCB(params);
        }, function(error)
        {
            if (typeof(errorCB) !== 'undefined')
                errorCB(error);
        })
    }

    Media.prototype.setSpeed = function(speed, successCB, errorCB)
    {
       var rpc = webinos.rpcHandler.createRPC(this, "setSpeed", [speed]);
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
* Copyright 2013 Fraunhofer FOKUS
******************************************************************************/

(function() {
	//Payment Module Functionality

	PaymentModule = function (obj){      
			WebinosService.call(this, obj);
	};
	// Inherit all functions from WebinosService
	PaymentModule.prototype = Object.create(WebinosService.prototype);
	// The following allows the 'instanceof' to work properly
	PaymentModule.prototype.constructor = PaymentModule;
	// Register to the service discovery
	_webinos.registerServiceConstructor("http://webinos.org/api/payment", PaymentModule);

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
 ******************************************************************************/
(function() {

	PolicyManagementModule = function(obj) {
		WebinosService.call(this, obj);
	};
	
	// Inherit all functions from WebinosService
	PolicyManagementModule.prototype = Object.create(WebinosService.prototype);	
	// The following allows the 'instanceof' to work properly
	PolicyManagementModule.prototype.constructor = PolicyManagementModule;
	// Register to the service discovery
	_webinos.registerServiceConstructor("http://webinos.org/core/policymanagement", PolicyManagementModule);


    PolicyManagementModule.prototype.bindService = function (bindCB, serviceId) {
        this.policy = policy;
        this.policyset = policyset;
        this.getPolicySet = getPolicySet;
        this.testPolicy = testPolicy;
        this.testNewPolicy = testNewPolicy;
        this.save = save;

        if (typeof bindCB.onBind === 'function') {
            bindCB.onBind(this);
        };
    }


    var policy = function(ps, id, combine, description){

        var _ps = ps;
        if(ps)
            _ps = ps;
        else{
            _ps = {};
            _ps['$'] = {};
            _ps['$']["id"] = (id) ? id : getNewId();
        }

        if(combine)
            _ps['$']["combine"] = combine;
        if(description)
            _ps['$']["description"] = description;

        function getNewId(type) {
            return new Date().getTime();
        };

        this.getInternalPolicy = function(){
            return _ps;
        };

        //this.updateRule = function(ruleId, effect, updatedCondition){
        this.updateRule = function(ruleId, key, value){
            if(!_ps) {
                return null;
            }

//            if(effect != 'permit' && effect != 'prompt-oneshot' && effect != 'prompt-session' && effect != 'prompt-blanket' && effect != 'deny') {
//                effect = "";
//            }

            //console.log("Effect :: "+effect);
            var policy = _ps;
            var rule;
            var count=0;
            for(var i in policy["rule"]) {
                if(policy["rule"][i]['$']["id"] == ruleId) {
                    rule = policy["rule"][i];
                    break;
                }
                count++;
            }

            if(rule){


                if(key == "effect"){
                    if(value)
                        rule['$']["effect"] = value;
                    else
                        rule['$']["effect"] = "permit";
                }
                else if(key == "condition"){

                    if(value){
                        if(rule.condition){
                            //check first child
                            var parent = rule["condition"];

                            var tmp = parent[0];
                            console.log(JSON.stringify(rule["condition"]));
                            if(tmp['$']["id"] == value['$']["id"]){
                                parent[0] = value;
                                return;
                            }

                            //check other children
                            while(true){
                                if(tmp.condition && value){

                                    if(tmp.condition[0]['$']["id"] == value['$']["id"]){
                                        tmp.condition[0] = value;
                                        return;
                                    }
                                    else
                                        tmp = tmp.condition;
                                }
                                else
                                    break;
                            }
                        }
                        else{
                            rule["condition"] = [value];
                        }
                    }
                    else{
                        if(rule.condition){
                            rule.condition = undefined;
                        }
                        else
                        {
                            ;
                        }
                    }
                }
/*
                if(!updatedCondition)
                    if(rule["condition"])
                        rule["condition"] = undefined;

                else if(!rule.condition){
                    console.log("No condition");
                    rule["condition"] = new Array();
                    rule["condition"][0] = updatedCondition;
                }

                else{

                    //check first child
                    var parent = rule["condition"];

                    var tmp = parent[0];

                    if(tmp['$']["id"] == updatedCondition['$']["id"]){
                        parent[0] = updatedCondition;
                        return;
                    }

                    //check other children
                    while(true){
                        if(tmp.condition && updatedCondition){
                            if(tmp.condition[0]['$']["id"] == updatedCondition['$']["id"]){
                                tmp.condition[0] = updatedCondition;
                                return;
                            }
                            else
                                tmp = tmp.condition;
                        }
                        else
                            break;
                    }
                }*/
            }
        }

        this.addRule = function(newRuleId, effect, newCondition, rulePosition){
            if(!_ps) {
                return null;
            }

            //Check if effect is valid value (deny is included in default rule)
            if(effect != 'permit' && effect != 'prompt-oneshot' && effect != 'prompt-session' && effect != 'prompt-blanket' && effect != 'deny') {
                effect = "permit";
            }

            //console.log("Effect :: "+effect);
            var policy = _ps;

            var rule;
            for(var i in policy['rule']) {
                if(policy['rule'][i]['$']['effect'] == effect) {
                    rule = policy['rule'][i];
                    break;
                }
            }
            //console.log("rule :: "+rule);

            if(!rule){
                var id = (newRuleId) ? newRuleId : new Date().getTime();
                rule = {"$": {"id" : id, "effect" : effect}};
                var position = 0;
                if(rulePosition && (rulePosition<0 || policy["rule"].length == 0))
                    policy["rule"].length;
                if(!rulePosition && policy["rule"])
                    position = policy["rule"].length;

                console.log("position : "+position);
                if(!policy["rule"])
                    policy["rule"] = [rule];
                else
                    policy["rule"].splice(position, 0, rule);
            }

            if(newCondition){
                if(!rule.condition){
                    console.log("No condition");
                    rule["condition"] = [newCondition];
                }
                else{
                    var tmp = rule["condition"][0];
                    while(true){
                        if(tmp.condition){
                            tmp = tmp.condition[0];
                        }
                        else
                            break;
                    }

                    tmp["condition"] = [newCondition];
                }
            }
        };

        this.removeRule = function(ruleId) {
            if(!_ps) {
                return null;
            }
            if(ruleId == null) {
                return null;
            }

            var policy = _ps;

            //console.log("PRE : " + JSON.stringify(policy["rule"]));
            if(policy["rule"]){
                var index = -1;
                var count = 0;

                for(var i in policy["rule"]){
                    if(policy["rule"][i]["$"]["id"] && policy["rule"][i]["$"]["id"] == ruleId){
                        index = i;
                        //break;
                    }
                    count ++;
                }
                if(index != -1){
                    console.log("Removing rule " + index);
                    policy["rule"].splice(index,1);
                    if(count == 1)
                        policy["rule"] = undefined;
                }


            }
            else
                console.log("No rules");
        };

        this.addSubject = function(newSubjectId, matches){
            if(!_ps) {
                return null;
            }

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            if(policy == null) {
                return null;
            }

            var id = (newSubjectId) ? newSubjectId : new Date().getTime();
            var newsubj = {"$" : {"id" : id} , "subject-match" : [] };

            for(var i in matches){
                if(i == "subject-match")
                    newsubj["subject-match"].push(matches[i]);
            }

            if(!policy.target)
                policy.target = [{}];
            if(!policy.target[0]["subject"])
                policy.target[0]["subject"] = [];

            //console.log(JSON.stringify(policy.target[0]));
            for(var i =0; i<policy.target[0]["subject"].length; i++){
                    if(policy.target[0]["subject"][i]['$']["id"] == newSubjectId){
                        console.log("A subject with " + newSubjectId + " is already present");
                        return;
                    }
                }
            policy.target[0]["subject"].push(newsubj);
            //console.log(JSON.stringify(policy.target[0]));

        };
/*
        this.getSubjects = function(policyId){
            if(!_ps) {
                return null;
            }

            var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;

            if(policy == null) {
                return null;
            }
            var subjects = policy.target[0]["subject"];

            return subjects;
        };*/

        this.removeSubject = function(subjectId) {
            if(!_ps) {
                return null;
            }
            /*
            if(policyId == null) {
                return;
            }*/

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            //console.log(policy);

            var count = 0;

            if(policy.target && policy.target[0] && policy.target[0]["subject"]){
                var index = -1;
                for(var i in policy.target[0]["subject"]){
                    console.log(policy.target[0]["subject"][i]["$"]["id"]);
                    if(policy.target[0]["subject"][i]["$"]["id"] && policy.target[0]["subject"][i]["$"]["id"] == subjectId){
                        index = i;
                        //break;
                    }
                    count++;
                }
                if(index != -1){
                    console.log("remove "+index);
                    policy.target[0]["subject"].splice(index,1);
                }
                if(count == 1)
                    //policy.target = [];
                    policy.target = undefined;
            }
            //console.log("AFTER : " + JSON.stringify(policy["rule"]));
        };

        this.updateSubject = function(subjectId, matches){
            if(!_ps) {
                return null;
            }

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            if(policy == null) {
                return null;
            }
            if(policy.target && policy.target[0] && policy.target[0]["subject"]){
                var subjects = policy.target[0]["subject"];
                for(var i in subjects){
                    if(subjects[i]['$']["id"] == subjectId)
                        subjects[i]["subject-match"] = matches["subject-match"];
                }
            }
        };

        this.updateAttribute = function(key, value){
            if (!key) {
                return;
            }
            if (key == "combine") {
                _ps['$']["combine"] = value;
            }
            else if (key == "description") {
                _ps['$']["description"] = value;
            }

        };

        this.toJSONObject = function(){
            return _ps;
        };
    };

    var policyset = function(ps ,type, basefile, fileId, id, combine, description) {
        var _type = type;
        var _basefile = basefile;
        var _fileId = fileId;

        var _parent;

        //var id = (newSubjectId) ? newSubjectId : new Date().getTime();
        var _ps = ps;
        if(ps)
            _ps = ps;
        else{
            _ps = {};
            _ps['$'] = {};
            _ps['$']["id"] = (id) ? id : getNewId();
        }

        if(combine)
            _ps['$']["combine"] = combine;
        if(description)
            _ps['$']["description"] = description;

        this.getBaseFile = function(){
            return _basefile;
        };

        this.getFileId = function(){
            return _fileId;
        };

        function getNewId(type) {
            return new Date().getTime();
        }

        function getPolicyById(policySet, policyId) {
            //console.log('getPolicyById - policySet is '+JSON.stringify(policySet));
            /*
            if(policyId == null || (policySet['$']['id'] && policySet['$']['id'] == policyId)) {
                return policySet;
            }
            */
            if(policySet['policy']) {
                for(var j in policySet['policy']) {
                    if(policySet['policy'][j]['$']['id'] == policyId) {
                        return policySet['policy'][j];
                    }
                }
            }
            if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    if(policySet['policy-set'][j]['$']['id'] == policyId) {
                        return policySet['policy-set'][j];
                    }
                    var tmp = getPolicyById(policySet['policy-set'][j], policyId);
                    if(tmp != null) {
                        return tmp;
                    }
                }
            }
            return null;
        };

        function getPolicySetById(policySet, policyId) {
            //console.log('getPolicyById - policySet is '+JSON.stringify(policySet));

            if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    if(policySet['policy-set'][j]['$']['id'] == policyId) {
                        return policySet['policy-set'][j];
                    }
                    var tmp = getPolicyById(policySet['policy-set'][j], policyId);
                    if(tmp != null) {
                        return tmp;
                    }
                }
            }
            return null;
        };

        function getPolicySetBySubject(policySet, subject) {
            var res = {'generic':[], 'matched':[]};
            if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    var checkRes = checkPolicySetSubject(policySet['policy-set'][j] , subject);
                    if (checkRes == 0){
                        res['generic'].push(new policyset(policySet['policy-set'][j], "policy-set"));
                    } else if (checkRes == 1){
                        res['matched'].push(new policyset(policySet['policy-set'][j], "policy-set"));
                    }
                    if (policySet['policy-set'][j]['policy-set']){
                        var tmpRes = getPolicySetBySubject(policySet['policy-set'][j], subject);
                        for (var e in tmpRes){
                            if (res[e] && tmpRes[e].length > 0){
                                res[e] = res[e].concat(tmpRes[e]);
                            }
                        }
                    }
                }
            }
            return res;
        }

        function checkPolicySetSubject(policySet, subject) {
            psSubject = null;
            var tempSubject = JSON.parse(JSON.stringify(subject));
            try{
                psSubject = policySet['target'][0]['subject'];
            }
            catch(err) {
                return 0; //subject not specified (it's still a subject match)
            }
            if (psSubject){
                for (var i in psSubject) {
                    temp = null;
                    try {
                        temp = psSubject[i]['subject-match'][0]['$']['match'];
                    } catch (err) { continue; }

                    // Change the string of psSubjectMatch_i to array psSubjectMatch_i.
                    var psSubjectMatch_i = temp.split(',');


                    if(psSubjectMatch_i.length > 1) {
                        for(var j in psSubjectMatch_i) {
                            // psSubjectMatch_i_j = null;
                            try {
                                var psSubjectMatch_i_j = psSubjectMatch_i[j];
                            } catch(err) { continue; }

                            var index = tempSubject.indexOf(psSubjectMatch_i_j);
                            if (index > -1){
                                //numMatchedSubjects++;
                                tempSubject.splice(index,1);
                            }
                        }
                    } else {
                        var index = tempSubject.indexOf(psSubjectMatch_i[0]);
                        if (index > -1) {
                            tempSubject.splice(index,1);
                        }
                    }
                }
                if (tempSubject.length == 0){
                    return 1; //subject matches
                }
            }
            return -1; //subject doesn't match
        }

        function getPolicyBySubject(policySet, subject) {
            var res = {'generic':[], 'matched':[]};
            // if(policySet['policy'] && checkPolicySetSubject(policySet, subject) > -1) {
            if(policySet['policy']) {
                for(var j in policySet['policy']) {
                    var tempSubject = JSON.parse(JSON.stringify(subject));
                    pSubject = null;
                    try{
                        pSubject = policySet['policy'][j]['target'][0]['subject'];
                    }
                    catch(err) {
                        res['generic'].push(new policy(policySet['policy'][j]));
                    }
                    if (pSubject){
                        // var numMatchedSubjects = 0;
                        for (var i in pSubject) {
                            temp = null;
                            // pSubjectMatch_i = null;
                            try {
                                // pSubjectMatch_i = pSubject[i]['subject-match'][0]['$']['match'];
                                temp = pSubject[i]['subject-match'][0]['$']['match'];
                            } catch (err) { continue; }

                            var pSubjectMatch_i = temp.split(',');
                            if (pSubjectMatch_i.length > 1) {

                                for (var m in pSubjectMatch_i) {
                                    // pSubjectMatch_i_j = null;
                                    try {
                                        var pSubjectMatch_i_j = pSubjectMatch_i[m];
                                    } catch(err) { continue; }

                                    var index = tempSubject.indexOf(pSubjectMatch_i_j);
                                    if (index > -1){
                                        // numMatchedSubjects++;
                                        tempSubject.splice(index,1);
                                    }
                                }

                            } else {
                                var index = tempSubject.indexOf(pSubjectMatch_i[0]);
                                if (index > -1){
                                    // numMatchedSubjects++;
                                    tempSubject.splice(index,1);
                                }
                            }
                            if (tempSubject.length == 0) {
                                res['matched'].push(new policy(policySet['policy'][j]));
                                break;
                            }
                        }
                    }
                }
            }

            /*if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    var tmpRes = getPolicyBySubject(policySet['policy-set'][j], subject);
                    for (var e in tmpRes){
                        if (res[e] && tmpRes[e].length > 0){
                            res[e] = res[e].concat(tmpRes[e]);
                        }
                    }
                }
            }*/
            return res;
        }

        this.removeSubject = function(subjectId, policyId) {
            if(!_ps) {
                return null;
            }
            if(policyId == null) {
                return;
            }

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            //console.log(policy);

            if(policy.target[0]["subject"]){
                var index = -1;
                for(var i in policy.target[0]["subject"]){
                    console.log(policy.target[0]["subject"][i]["$"]["id"]);
                    if(policy.target[0]["subject"][i]["$"]["id"] && policy.target[0]["subject"][i]["$"]["id"] == subjectId){
                        index = i;
                        break;
                    }
                }
                if(index != -1){
                    console.log("remove "+index);
                    policy.target[0]["subject"].splice(index,1);
                }
            }
            //console.log("AFTER : " + JSON.stringify(policy["rule"]));
        };


        function removePolicySetById(policySet, policySetId) {
            if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    if(policySet['policy-set'][j]['$']['id'] == policySetId) {
                        policySet['policy-set'].splice(j, 1);
                        return true;
                    }
                    /*if(removePolicyById(policySet['policy-set'][j], policyId)) {
                        return true;
                    }*/
                }
            }
            return false;
        }

        function removePolicyById(policySet, policyId) {
            //console.log('removePolicyById - id is '+policyId+', set is '+JSON.stringify(policySet));
            if(policySet['policy']) {
                for(var j in policySet['policy']) {
                    if(policySet['policy'][j]['$']['id'] == policyId) {
                        policySet['policy'].splice(j, 1);
                        return true;
                    }
                }
            }
            /*
            if(policySet['policy-set']) {
                for(var j in policySet['policy-set']) {
                    if(policySet['policy-set'][j]['$']['id'] == policyId) {
                        policySet['policy-set'].splice(j, 1);
                        return true;
                    }
                    if(removePolicyById(policySet['policy-set'][j], policyId)) {
                        return true;
                    }
                }
            }*/
            return false;
        }

        this.getInternalPolicySet = function(){
            return _ps;
        };

        this.createPolicy = function(policyId, combine, description){
//        function createPolicy(policyId, combine, description){
            return new policy(null, policyId, combine, description);
        };

        this.createPolicySet = function(policySetId, combine, description){
       //function createPolicySet(policySetId, combine, description){
            return new policyset(null, policySetId, _basefile, _fileId, policySetId, combine, description);
        };


      this.addPolicy = function(newPolicy, newPolicyPosition){
//      this.addPolicy = function(policyId, combine, description, newPolicyPosition, succCB){
//      var newPolicy = createPolicy(policyId, combine, description);
            if(!_ps)
                return null;

            if(!_ps["policy"])
                _ps["policy"] = new Array();
            else{
                for(var i =0; i<_ps["policy"].length; i++){
                    console.log(JSON.stringify(newPolicy.getInternalPolicy()));
                    if(_ps["policy"][i]['$']["id"] == newPolicy.getInternalPolicy()['$']["id"]){
                        console.log("A policy with " + newPolicy.getInternalPolicy()['$']["id"] + " is already present");
                        return;
                    }
                }
            }
            var position = (newPolicyPosition == undefined || newPolicyPosition<0 || _ps["policy"].length == 0) ? _ps["policy"].length : newPolicyPosition;
            _ps['policy'].splice(position, 0, newPolicy.getInternalPolicy());
            //succCB(newPolicy);

        };

        this.addPolicySet = function(newPolicySet, newPolicySetPosition){
        //this.addPolicySet = function(policySetId, combine, description, newPolicySetPosition){
            //var newPolicySet = createPolicySet(policySetId, combine, description);
            if(!_ps)
                return null;

            if(!_ps['policy-set'])
                _ps['policy-set'] = new Array();
            else{
                for(var i =0; i<_ps['policy-set'].length; i++){
                    console.log(JSON.stringify(newPolicySet.getInternalPolicySet()));
                    if(_ps['policy-set'][i]['$']['id'] == newPolicySet.getInternalPolicySet()['$']['id']){
                        console.log("A policyset with " + newPolicySet.getInternalPolicySet()['$']['id'] + " is already present");
                        return;
                    }
                }
            }
            var position = (newPolicySetPosition == undefined || newPolicySetPosition<0 || _ps['policy-set'].length == 0) ? _ps['policy-set'].length : newPolicySetPosition;
            _ps['policy-set'].splice(position, 0, newPolicySet.getInternalPolicySet());
            /*
            if(!_ps)
                return null;

            if(!_ps["policy-set"])
                _ps["policy-set"] = new Array();

            var position = (newPolicySetPosition == undefined || newPolicySetPosition<0 || _ps["policy-set"].length == 0) ? _ps["policy-set"].length : newPolicySetPosition;
//            var position = (!newPolicySetPosition || _ps["policy-set"].length == 0) ? 0 : newPolicySetPosition;

            _ps['policy-set'].splice(position, 0, newPolicySet.getInternalPolicySet());
            */
        };



        // add subject to policyset
        this.addSubject = function(newSubjectId, matches){
            if(!_ps) {
                return null;
            }

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            if(policy == null) {
                return null;
            }

            var id = (newSubjectId) ? newSubjectId : new Date().getTime(); //Ecco perchè inserendo ID vuoto metto la data
            var newsubj = {"$" : {"id" : id} , "subject-match" : [] };

            for(var i in matches){
                if(i == "subject-match")
                    newsubj["subject-match"].push(matches[i]);
            }
            if(!policy.target)
                policy.target = [{}];

            if(!policy.target[0]["subject"])
                policy.target[0]["subject"] = [];

            //console.log(JSON.stringify(policy.target[0]));
            for(var i =0; i<policy.target[0]["subject"].length; i++){
                    if(policy.target[0]["subject"][i]['$']["id"] == newSubjectId){
                        console.log("A subject with " + newSubjectId + " is already present");
                        return;
                    }
                }
            policy.target[0]["subject"].push(newsubj);
            //console.log(JSON.stringify(policy.target[0]));

        };

        this.getPolicy = function(policyId){
            if (policyId){
                if(typeof policyId == "object" && policyId.length){
                    var res = getPolicyBySubject(_ps, policyId);
                    var tempSubject = replaceId(policyId);
                    // Because of the default copying action, the tempSubject can never be zero.
                    if ((tempSubject.indexOf("http://webinos.org/subject/id/PZ-Owner") != -1) || (tempSubject.indexOf("http://webinos.org/subject/id/known") != -1 )) {
                        var res2 = getPolicyBySubject(_ps, tempSubject);
                        var res = joinResult(res, res2);
                    }
                    return res;
                } else {
                    var tmp = getPolicyById(_ps, policyId);
                    if(tmp){
                        return new policy(tmp);
                    }
                }
            }
        };

        this.getPolicySet = function(policySetId){
            if(policySetId){
                if(typeof policySetId == "object" && policySetId.length){
                    var res = getPolicySetBySubject(_ps, policySetId);
                    var tempSubject = replaceId(policySetId);
                    if ((tempSubject.indexOf("http://webinos.org/subject/id/PZ-Owner") != -1) || (tempSubject.indexOf("http://webinos.org/subject/id/known") !=-1 )) {
                        var res2 = getPolicySetBySubject(_ps, tempSubject);
                        var res = joinResult(res, res2);
                    }
                    return res;
                } else {
                    var tmp = getPolicySetById(_ps, policySetId);
                    if(tmp){
                        return new policyset(tmp, "policy-set", _basefile, _fileId);
                    }
                }
            }
        };

/*
        this.getSubjects = function(policyId){
            if(!_ps) {
                return null;
            }

            var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;

            if(policy == null) {
                return null;
            }
            var subjects = policy.target[0]["subject"];

            return subjects;
        };
*/
        this.updateSubject = function(subjectId, matches){
        //this.updateSubject = function(subjectId, matches/*, policyId*/ ){
            if(!_ps) {
                return null;
            }

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            if(policy == null) {
                return null;
            }

            if(policy.target && policy.target[0] && policy.target[0]["subject"]){
                var subjects = policy.target[0]["subject"];
                for(var i in subjects){
                    console.log(subjects[i]['$']["id"]);
                    if(subjects[i]['$']["id"] == subjectId)
                        subjects[i]["subject-match"] = matches["subject-match"];
                }
            }
        };

        this.removePolicy = function(policyId){
            if(!_ps) {
                return null;
            }
            if(policyId == null) {
                return;
            }
            if (!_ps['policy']) {
                return null;
            }
            removePolicyById(_ps, policyId);
            if (_ps['policy'].length == 0) {
                _ps['policy'] = undefined;
            }
        };

        this.removePolicySet = function(policySetId){
            if(!_ps) {
                return null;
            }
            if(policySetId == null) {
                return;
            }
            if (!_ps['policy-set']) {
                return null;
            }
            removePolicySetById(_ps, policySetId);
            console.log(_ps['policy-set']);
            if (_ps['policy-set'].length == 0) {
                _ps['policy-set'] = undefined;
            }
        };



        this.removeSubject = function(subjectId) {
            if(!_ps) {
                return null;
            }
            /*
            if(policyId == null) {
                return;
            }*/

            //var policy = (policyId) ? getPolicyById(_ps, policyId) : _ps;
            var policy = _ps;

            //console.log(policy);

            var count = 0;

            if(policy.target && policy.target[0] && policy.target[0]["subject"]){
                var index = -1;
                for(var i in policy.target[0]["subject"]){
                    console.log(policy.target[0]["subject"][i]["$"]["id"]);
                    if(policy.target[0]["subject"][i]["$"]["id"] && policy.target[0]["subject"][i]["$"]["id"] == subjectId){
                        index = i;
                        //break;
                    }
                    count++;
                }
                if(index != -1){
                    console.log("remove "+index);
                    policy.target[0]["subject"].splice(index,1);
                    if(count == 1)
                        policy.target = undefined;
                }

            }
            //console.log("AFTER : " + JSON.stringify(policy["rule"]));
        };

        this.updateAttribute = function(key, value){
          if(key == "combine" || key == "description"){
            _ps['$'][key] = value;
          }
        };
        /*function(policySetId, combine, description){
            if(policySetId)
                _ps['$']["id"] = policySetId;
            if(combine)
                _ps['$']["combine"] = combine;
            if(description)
                _ps['$']["description"] = description;};*/


        this.toJSONObject = function(){
            return _ps;
            //return "ID : " + _id + ", DESCRIPTION : " + _ps.$.description + ", PATH : " + _basefile;
        }
    }

    var policyFiles = new Array();

    function getPolicySet(policyset_id, success, error) {
        var successCB = function(params){
            var ps = new policyset(params, "policy-set", policyset_id) ;
            console.log(ps);
            success(ps);
        }

        if(!policyFiles || policyFiles.length == 0) {
            var rpc = webinos.rpcHandler.createRPC(this, "getPolicy", [policyset_id]); // RPC service name, function, position options
            webinos.rpcHandler.executeRPC(rpc
                , function (params) {
                    successCB(params);
                }
                , function (error) {
                    console.log(error);
                }
            );
        }
        else {
            success(new policyset(policyFiles[policyset_id].content, "policy-set", policyset_id));
        }
    };

    function save(policyset, successCB, errorCB) {
        var rpc = webinos.rpcHandler.createRPC(this, "setPolicy", [policyset.getBaseFile(), JSON.stringify(policyset.toJSONObject())]);
        webinos.rpcHandler.executeRPC(rpc
            , function (params) {
                successCB(params);
            }
            , function (error) {
                errorCB(error);
            }
        );
    };

    function testPolicy(policyset, request, successCB, errorCB) {
        var rpc = webinos.rpcHandler.createRPC(this, "testPolicy", [policyset.getBaseFile(), JSON.stringify(request)]);
        webinos.rpcHandler.executeRPC(rpc
            , function (params) {
                successCB(params);
            }
            , function (error) {
                errorCB(error);
            }
        );
    };
    function testNewPolicy(policyset, request, successCB, errorCB) {
        var rpc = webinos.rpcHandler.createRPC(this, "testNewPolicy", [JSON.stringify(policyset.toJSONObject()), JSON.stringify(request)]);
        webinos.rpcHandler.executeRPC(rpc
            , function (params) {
                successCB(params);
            }
            , function (error) {
                errorCB(error);
            }
        );
    };

// Start point..............
// This function is used to test if the userId belongs to the friends array.
    function userBelongsToFriend(userId) {
        if (userId !== webinos.session.getPZHId()) {
            var friends = webinos.session.getConnectedPzh();
            var index = friends.indexOf(userId);
            if (index > -1){
                return 1;
            }
        }
        return 0;
    }
// This function is used to replace the elements (ids) in the subject, and to  make it simple, only two possible values, one is the generic URI of zone owner, and another is the friends. Then return the changed subject (tempSubject).
    function replaceId(subject) {
        var friendFound = false;
        var tempSubject = [];

        var zoneOwner = webinos.session.getPZHId();
        if (!zoneOwner) {
            zoneOwner = webinos.session.getPZPId();
        }

        for (var j in subject) {
            if (subject[j] === zoneOwner) {
                tempSubject.push("http://webinos.org/subject/id/PZ-Owner");
            } else if (userBelongsToFriend(subject[j])) {
                if (friendFound == false) {
                    tempSubject.push("http://webinos.org/subject/id/known");
                    friendFound = true;
                }
            // do nothing if friendFound is true
            } else {
                // default behaviour, copy item
                tempSubject.push(subject[j]);
            }
        }
        return tempSubject;
    }

    function deepCopy(p,c) {
        var c = c || {};
        for (var i in p) {
            if (typeof p[i] === 'object') {
                c[i] = (p[i].constructor === Array) ? [] : {};
                deepCopy(p[i], c[i]);
            }
            else {
                c[i] = p[i];
            }
        }
        return c;
    }

// This function used to join two results together, res2 only can have two elements at most, one in the generic set and one in the matched set. So ckecked them one by one is the easiest solution. To avoid duplication, in both if functions, also check if the element in the res2 already presented in the res1, if already presented, skip this step, other wise push the element in res1, and return res1.
    function joinResult(res1, res2) {
        var found_g = false, found_m = false;
        var res = deepCopy(res1);
        for (var i in res2['generic']) {
            for (var j in res1['generic']) {
                if (res1['generic'][j].toJSONObject() === res2['generic'][i].toJSONObject() ) {
                    found_g = true;
                    break;
                }
            }
            if (found_g == false) {
                res['generic'].push(res2['generic'][i]);
            }
            found_g = false;
        }

        for (var m in res2['matched']) {
            for (var n in res1['matched']) {
                if (res1['matched'][n].toJSONObject() === res2['matched'][m].toJSONObject() ) {
                    found_m = true;
                    break;
                }
            }
            if (found_m == false) {
                res['matched'].push(res2['matched'][m]);
            }
            found_m = false;
        }

        return res;
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
	// Inherit all functions from WebinosService
	TestModule.prototype = Object.create(WebinosService.prototype);
	// The following allows the 'instanceof' to work properly
	TestModule.prototype.constructor = TestModule;
	// Register to the service discovery
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
