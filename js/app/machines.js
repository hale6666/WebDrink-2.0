// Routes
app.config(['$routeProvider', function($routeProvider) {
	$routeProvider.
		when('/machines', {
			templateUrl: 'views/machines.html',
			controller: 'MachineCtrl'
		}).
		otherwise({
			redirectTo: '/machines'
		});
}]);

// Machine Service - Get and update data about the drink machines, machine stock, etc
app.factory("MachineService", function($http, $window, $log) {
	return {
		// Get a list of information about all drink machines
		getMachineAll: function(successCallback, errorCallback) {
			$http({
				method: "GET",
				url: baseUrl+"machines/info"
			}).success(successCallback).error(errorCallback);
		},
		// Get the stock of all drink machines
		getStockAll: function(successCallback, errorCallback) {
			$http({
				method: "GET",
				url: baseUrl+"machines/stock"
			}).success(successCallback).error(errorCallback);
		},
		// Get the stock of one drink machine
		getStockOne: function(machineId, successCallback, errorCallback) {
			$http({
				method: "GET",
				url: baseUrl+"machines/stock",
				params: {"machine_id": machineId},
				headers: {'Content-Type': 'application/x-www-form-urlencoded'}
			}).success(successCallback).error(errorCallback);
		},
		// Get a list of all drink items
		getItemAll: function(successCallback, errorCallback) {
			$http({
				method: "GET",
				url: baseUrl+"items/list"
			}).success(successCallback).error(errorCallback);
		},
		// Update the items and state of a slot in a drink machine
		updateSlot: function(data, successCallback, errorCallback) {
			$http({
				method: "POST",
				url: baseUrl+"machines/slot",
				//url: "./test.php",
				data: jQuery.param(data),
				headers: {'Content-Type': 'application/x-www-form-urlencoded'}
			}).success(successCallback).error(errorCallback);
		},
		// Get the current user's drink credits
		getCredits: function(uid, successCallback, errorCallback) {
			$http({
				method: "GET",
				//url: baseUrl+"users/credits/"+uid
				url: baseUrl+"users/credits",
				params: {"uid": uid, "test": "LOL"},
				headers: {'Content-Type': 'application/x-www-form-urlencoded'}
			}).success(successCallback).error(errorCallback);
		}
	};
});

// Controller for the machines page
function MachineCtrl($scope, $log, $window, $timeout, MachineService, socket) {

	// Initialize scope variables
	$scope.stock = {};			// Stock of all machines
	$scope.items = {};			// All existing drink items (admin only)
	$scope.current_slot = {};	// Current slot being dropped/edited
	$scope.new_slot = {};		// New data for slot being edited
	$scope.delay = 0;			// Delay for dropping a drink
	$scope.dropping_message = "";
	$scope.message = "";		// Message to display after edit

	// Get the initial stock
	MachineService.getStockAll(
		function (response) { 
			if (response.status) {
				$scope.stock = response.data;
			}
			else {
				$log.log(response.message);
			}
		}, 
		function (error) { 
			$log.log(error); 
		}
	);

	// Admin only functions
	if ($scope.current_user.admin) {
		// Get all items (for editing a slot)
		MachineService.getItemAll(
			function (response) {
				if (response.status) {
					$scope.items = response.data;
				}
				else {
					$log.log(response.message);
				}
			},
			function (error) {
				$log.log(error);
			}
		);
		// Lookup an item by id
		$scope.lookupItem = function (id) {
			for (var i = 0; i < $scope.items.length; i++) {
				if ($scope.items[i].item_id == id) {
					return $scope.items[i];
				}
			}
		}
		// Edit a slot
		$scope.editSlot = function (slot) {
			$scope.current_slot = slot;
			$scope.new_slot.slot_num = $scope.current_slot.slot_num;
			$scope.new_slot.machine_id = $scope.current_slot.machine_id;
			$scope.new_slot.item_id = $scope.current_slot.item_id;
			$scope.new_slot.available = Number($scope.current_slot.available);
			$scope.new_slot.status = $scope.current_slot.status;
		};
		// Save a slot
		$scope.saveSlot = function () {
			if ($scope.new_slot.item_id > 1) {
				MachineService.updateSlot($scope.new_slot, 
					function (response) {
						if (response.status) {
							$scope.current_slot.item_id = $scope.new_slot.item_id;
							$scope.current_slot.available = Number($scope.new_slot.available);
							$scope.current_slot.status = $scope.new_slot.status;
							$scope.current_slot.item_name = $scope.lookupItem($scope.new_slot.item_id).item_name;
							$scope.current_slot.item_price = $scope.lookupItem($scope.new_slot.item_id).item_price;
							$scope.message = "Edit success!";
						}
						else {
							$scope.message = response.message;
							console.log(response.data);
						}
						jQuery("#saveSlotModal").modal('show');
					},
					function (error) {
						$log.log(error);
					}
				);
			}
		}
	}
	// Initialize modal data for dropping a drink
	$scope.selectDrink = function (slot) {
		$scope.current_slot = slot;
		$scope.delay = 0;
		$log.log("Authed: " + $scope.authed);
	}; 
	// Drop a drink
	$scope.dropDrink = function() {
		$scope.wsDrop($scope.current_slot.slot_num, $scope.machines[$scope.current_slot.machine_id].alias);
	}
	// Count down the delay until a drink is dropped
	$scope.reduceDelay = function () {
		if (!$scope.authed) {
			$scope.dropping_message = "Warning: Websocket not connected, can't drop drink!";
		}
		else {
			$scope.dropping_message = "Dropping in " + $scope.delay + " seconds...";
			var i = $timeout(function () {
				if ($scope.delay == 0) {
					$timeout.cancel(i);
					$scope.dropDrink();
					//jQuery("#dropModal").modal('hide');
					//$scope.dropping_message = "Drink dropped!";
				}
				else {
					$scope.delay -= 1;
					$scope.dropping_message = "Dropping in " + $scope.delay + " seconds...";
					$scope.reduceDelay();
				}
			}, 1000);
		}
	};

	/*
	* Websocket Things
	*/

	// Data for the websocket connection alert
	$scope.websocket_alert = new $scope.Alert({
		message: "Warning: Websocket not connected!",
		show: true,
		closeable: false
	});
	// Websocket connection variables
	$scope.authed = false; 			// Authentication status
	$scope.requesting = false; 		// Are we currently handling a request?
	$scope.request_queue = []; 		// Array of pending requests
	$scope.current_request = null; 	// Current request being processed

	// Request object
	$scope.Request = function (command, callback, command_data) {
		if (typeof command_data == 'undefined') {
			command_data = {};
		}
		this.command = command;				// Socket command to execute (ibutton, drop, etc)
		this.callback = callback;			// Callback to execute on command success
		this.command_data = command_data;   // Data being passed to the command
	};
	$scope.Request.prototype = {
		// Execute the Request's callback function
		runCallback: function(callback_data) {
			this.callback(callback_data);
		},
		// Execute the Request's command
		runCommand: function() {
			this.command(this.command_data);
		}
	};

	// Initialize Websocket Events
	socket.on('connect', function() {
		$scope.websocket_alert.show = false;
	});
	socket.on('disconnect', function() {
		$scope.websocket_alert.show = true;
	});
	socket.on('close', function() {
		$scope.websocket_alert.show = true;
	});
	socket.on('reconnect', function() {
		$scope.websocket_alert.show = true;
	});
	socket.on('reconnecting', function() {
		$scope.websocket_alert.show = false;
	});
	socket.on('stat_recv', function(data) {
		$scope.wsProcessIncomingData(data);
	});
	socket.on('ibutton_recv', function(data) {
		$scope.wsProcessIncomingData(data);
	});
	socket.on('machine_recv', function(data) {
		$scope.wsProcessIncomingData(data);
	});
	socket.on('drop_recv', function(data) {
		$scope.wsProcessIncomingData(data);
	});
	socket.on('balance_recv', function(data) {
		$scope.wsProcessIncomingData(data);
	});

	// Process the next Request in the queue
	$scope.wsProcessQueue = function() {
		if ($scope.request_queue.length > 0) {
			$scope.requesting = true;
			$scope.current_request = $scope.request_queue.pop();
			$scope.current_request.runCommand();
		}
	};

	// Execute the only Request or put a Request in the queue
	$scope.wsPrepRequest = function(request) {
		if (!$scope.requesting) {
			$scope.requesting = true;
			$scope.current_request = request;
			$scope.current_request.runCommand();
		}
		else {
			$scope.request_queue.push(request);
		}
	};

	// Process data received from the socket
	$scope.wsProcessIncomingData = function(data) {
		if ($scope.current_request != null) {
			$log.log(data);
			$scope.current_request.runCallback(data);
		}
		else {
			// Uh...
		}
		// Handle the next request
		$scope.current_request = null;
		$scope.requesting = false;
		$scope.wsProcessQueue();
	};

	// Connect to the drinkjs server
	$scope.wsConnect = function() {
		// Request command
		var command = function() {
			// Send the ibutton command to the server to validate your ibutton
			socket.emit('ibutton', {ibutton: $scope.current_user.ibutton});
		};
		// Request callback
		var callback = function(data) {
			// If the status was OK, we authed successfully
			if (data.substr(0, 2) == 'OK') {
				$scope.authed = true;
				$scope.websocket_alert.show = false;
			}
			// If not, we have a bogus iButton
			else {
				$scope.authed = false;
				$scope.websocket_alert.message = "Warning: Invalid iButton";
				$scope.websocket_alert.show = true;
			}
		};
		// Create the Request object and queue it up
		var request = new $scope.Request(command, callback);
		$scope.wsPrepRequest(request);
	};

	// Tell the server to drop a drink
	$scope.wsDrop = function(slot_num, machine_alias) {
		// First Request: connect to the drink machine
		// Request command
		var machine_command = function() {
			socket.emit('machine', {machine_id: machine_alias});
		};
		// Request callback
		var machine_callback = function() {
			// Second Request: drop the drink
			// Request command
			var drop_command = function() {
			  $scope.dropping_message = "Dropping drink now...";
				socket.emit('drop', {slot_num: slot_num, delay: 0});
			};
			// Request callback
			var drop_callback = function(data) {
				if (data.substr(0, 2) == 'OK') {
					$scope.dropping_message = "Drink dropped!";
					// Update my drink credits
					$scope.current_user.credits -= $scope.current_slot.item_price;
					MachineService.getCredits($scope.current_user.uid,
						function (response) {
							if (response.status) {
								$scope.current_user.credits = response.data;
							}
							else {
								$log.log(response.message);
							}
						},
						function (error) {
							$log.log(error);
						}
					);
				}
				else {
					$scope.dropping_message = data;
				}
			};
			// Create the Request object and queue it up
			var drop_request = new $scope.Request(drop_command, drop_callback);
			$scope.wsPrepRequest(drop_request);
		};
		// Create the Request object and queue it up
		var machine_request = new $scope.Request(machine_command, machine_callback);
		$scope.wsPrepRequest(machine_request);
	};

	// Get the stock of the last connected-to (?) machine
	$scope.wsStat = function() {
		// Request command
		var command = function() {
			// Send the ibutton command to the server to validate your ibutton
			socket.emit('stat', {});
		};
		// Request callback
		var callback = function(data) {
			$scope.wsProcessQueue();
		};
		// Create the Request object and queue it up
		var request = new $scope.Request(command, callback);
		$scope.wsPrepRequest(request);
	}

	// Connect to a machine
	$scope.wsMachine = function(machine_alias) {
		// Request command
		var command = function() {
			// Send the ibutton command to the server to validate your ibutton
			socket.emit('machine', {machine_id: machine_alias});
		};
		// Request callback
		var callback = function(data) {
			$scope.wsProcessQueue();
		};
		// Create the Request object and queue it up
		var request = new $scope.Request(command, callback);
		$scope.wsPrepRequest(request);
	}

	// Get the current user's credit balance
	$scope.wsBalance = function() {
		// Request command
		var command = function() {
			// Send the ibutton command to the server to validate your ibutton
			socket.emit('getbalance', {});
		};
		// Request callback
		var callback = function(data) {
			if (data.substr(0, 2) == 'OK') {
				data = data.split(': ');
				$scope.current_user.credits = data[1];
			}
			else {
				$scope.authed = false;
				$log.log("invalid ibutton, yo");
			}
			$scope.wsProcessQueue();
		};
		// Create the Request object and queue it up
		var request = new $scope.Request(command, callback);
		$scope.wsPrepRequest(request);
	}

	// Establish a websocket connection
	$scope.wsConnect();
}