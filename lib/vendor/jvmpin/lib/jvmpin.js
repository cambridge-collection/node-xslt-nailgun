/**
 * JVMPin - Nailgun protocol implementation
 *
 * A simple node based implementation of the Nailgun protocol for communicating
 * with a JVM hosting a Nailgun server instance.
 *
 * @since 1.0.0
 *
 * EPL Licensed
 */
var util         = require('util'),
    net          = require('net'),
    events       = require('events'),
    stream       = require('readable-stream'),
    assert       = require('assert');

/**
 * createConnection([port], [host], [connectListener])
 * createConnection([options], [connectListener])
 *
 * Factory function to create a communication socket to the nailgun host and
 * bind it to a new JVMPin instance. By default it sets the port to 2113 and
 * the host to 'localhost'.
 *
 * usage:
 *    require('jvmpin').createConnection(1234, 'some.host', function() {
 *      console.log('connected');
 *    });
 *
 * The createConnection() signature mirrors that used by net.createConnection().
 * @see http://nodejs.org/api/net.html#net_class_net_socket for more details.
 *
 * @param port - Number. The port number to connect to the nailgun jvm instance.
 * @param host - String. The hostname to use when connecting to the nailgun jvm
 *        instance.
 * @param options - Object. Options controlling the connection and communication
 *        with the server. In addition to the options below, options from
 *        net.createConnection(options [, connectListener]) can be used.
 * @param options.port - Number. Same as port argument. Defaults to 2113 if
 *        options.path is not specified.
 * @param options.host - String. Same as host argument. Defaults to 'localhost'
 *        if options.path is not specified.
 * @param options.path - String. The path to a UNIX domain socket or Windows
 *        named pipe to communicate over.
 * @param options.heartbeatInterval - Number. The number of milliseconds between
 *        heartbeat chunks. Default: 1000. Set heartbeatInterval to a falsy
 *        value to disable heartbeats (nailgun servers prior to 0.9.3 don't
 *        support heartbeats).
 * @param options.stdin - String. Defines how to throttle stdin sent to the
 *        server. Default: 'once-per-request'. Must be one of:
 *          - 'all-after-request': Don't send any stdin data until a SEND_STDIN
 *            chunk is received, then send data as fast as possible. This is the
 *            behaviour described in
 *            http://www.martiansoftware.com/nailgun/protocol.html but is not
 *            supported by nailgun-server 1.0.0.
 *          - 'once-per-request': Send a single STDIN chunk per SEND_STDIN chunk
 *            received from the server. This is the behaviour expected by
 *            nailgun-server 1.0.0.
 *          - 'all-before-request': Send stdin data as fast as possible as soon
 *            as the initial handshake is complete. This behaviour was
 *            previously jvmpin's default, and is required by older nailgun
 *            servers which didn't transmit SEND_STDIN chunks.
 * @param connectListener - Function. A callback function which receives a
 *        single 'connect' event from the socket.
 */
exports.createConnection = function() {
	var options, cb;
	if(typeof arguments[0] === 'number' || typeof arguments[1] === 'string') {
		if(!(typeof arguments[0] === 'number' || arguments[0] === undefined)) {
			throw new Error('port argument must be a number');
		}
		if(!(typeof arguments[1] === 'string' || arguments[1] === undefined)) {
			throw new Error('host argument must be a string');
		}
		options = {
			port: arguments[0] || 2113,
			host: arguments[1] || 'localhost'
		};
		cb = arguments[2];
	}
	else if(typeof arguments[0] === 'object' || arguments[0] === undefined) {
		options = arguments[0] || {};
		cb = arguments[1];
	}
	else {
		throw new Error('arguments do not match any signature: ' + util.inspect(arguments));
	}

	if(!(typeof cb === 'function' || cb === undefined)) {
		throw new Error('connectListener must be a function or undefined');
	}

	var connectionOptions = dropUndefined(options);
	delete connectionOptions.heartbeatInterval;
	delete connectionOptions.stdin;
	if(connectionOptions.path === undefined) {
		connectionOptions = Object.assign({port: 2113, host: 'localhost'}, connectionOptions);
	}

	var socket = net.createConnection(connectionOptions, cb);

	var jvmpinOptions = {
		socket: socket,
		heartbeatInterval: options.heartbeatInterval,
		stdin: options.stdin
	};

	return new JVMPin(jvmpinOptions);
};

var DEFAULT_HEARTBEAT_INTERVAL = 1000;
var STDIN_POLICY = {
	ALL_AFTER_REQUEST: 'all-after-request',
	ONCE_PER_REQUEST: 'once-per-request',
	ALL_BEFORE_REQUEST: 'all-before-request'
};
var DEFAULT_STDIN_POLICY = STDIN_POLICY.ONCE_PER_REQUEST;

var CHUNK_TYPE = {
	ARGUMENT:          'A',
	ENVIRONMENT:       'E',
	WORKING_DIRECTORY: 'D',
	COMMAND:           'C',
	STDIN:             '0',
	STDOUT:            '1',
	STDERR:            '2',
	EOF:               '.',
	SEND_INPUT:        'S',
	EXIT:              'X',
	HEARTBEAT:         'H'
};

/**
 * new JVMPin(socket)
 *
 * The JVMPin instance can be viewed as an instance of a socket specialized for
 * communication to a Nailgun hosted jvm instance.
 *
 * Events
 *   - All events used by the internal net.Socket (except 'data') are proxied
 *     via this class.
 *   - 'error' - emitted by JVMPin instances when the socket emits an error, or
 *               when the server does not behave as expected.
 *   - 'warning' - emitted by JVMPin instances when non-fatal but questionable
 *                 situations are encountered. If no handlers are registered,
 *                 warnings are re-emitted as 'error' events.
 *   - 'exit' - emitted by JVMPinProcess with the integer exit status as the
 *              first callback argument, or null if the process was aborted with
 *              the kill() method. Emitted to mark the completion of the nail
 *              execution. It occurs once the following are satisfied:
 *                - The process was killed with its kill() method
 *                OR:
 *                - The EXIT chunk is received from the server
 *                - the JVMPinProcess's stdout and stderr streams contain all
 *                  the data sent by the server
 *                - the JVMPin's socket is closed
 *   - 'close' - emitted by JVMPinProcess's stdin stream once all of its data
 *               has been written to the socket. If a 'close' is not received
 *               before the 'exit' event, the nail did not consume all of the
 *               available input.
 *
 * @param options - Object. Constructor options.
 * @param options.socket - net.Socket. A socket (connected to a nailgun server)
 * 	      to communicate over.
 * @param options.heartbeatInterval - See createConnection()
 * @param options.stdin - See createConnection()
 */
function JVMPin(options) {
	JVMPin.super_.apply(this);

	if(typeof options.socket !== 'object') {
		throw new Error('options.socket must be a net.Socket object');
	}
	if(!([undefined].concat(Object.values(STDIN_POLICY).some(function(x) { return x === options.stdin})))) {
		throw new Error("options.stdin must be one of " + [undefined].concat(Object.values(STDIN_POLICY)));
	}
	if(!([undefined, false, null].some(function(x) { return options.heartbeatInterval === x; }) || options.heartbeatInterval >= 0)) {
		throw new Error('options.heartbeatInterval must be a falsy value or a number >= 0');
	}

	// The communication channel to the Nailgun JVM instance.
	this._socket = options.socket;

	this._stdinPolicy = options.stdin || DEFAULT_STDIN_POLICY;
	this._heartbeatInterval = options.heartbeatInterval === undefined ? DEFAULT_HEARTBEAT_INTERVAL : options.heartbeatInterval;

	// Data events can be emitted without a complete chunk hence a simple buffer is used.
	this._unprocessedBuffer = Buffer.alloc(0);

	// A single connection to a nailgun server can only be used for a single
	// command execution, so we need to guard against spawn() being invoked more
	// than once.
	this._spawned = false;

	// Whenever a listener is registered to this object it will be forwarded to the socket.
	var self = this;
	this.on('newListener', function(event, listener) {
		if(event === 'data') {
			// prevent adding data listeners, as doing so is incompatible with
			// _socket.on('readable') / _socket.read().
			throw new Error('cannot listen for the \'data\' event')
		}
		self._socket.on(event, listener);
	});

	this.CHUNK_TYPE = Object.assign({}, CHUNK_TYPE);

	/**
	 * The JVMPinProcess is basically dumb terminal. It is used to perform stdio
	 * redirection and propagate the appropriate signals for each. The API is akin
	 * to that found in the 'child_process' API only that none of the overhead of
	 * forking/executing/spawning occurs.
	 *
	 * @since 1.0.6
	 */
	function JVMPinProcess() {
		JVMPin.super_.apply(this);

		// The highWaterMark of our stdin stream will influence the size of each
		// STDIN data chunk sent when the data producer feeding stdin sends data
		// in smaller chunks than this value. Sending small STDIN data chunks
		// has relatively large overhead, as the server must request each chunk
		// by sending a SEND_STDIN chunk.
		this.stdin = new stream.PassThrough({highWaterMark: 1024 * 64});
		this.stdout = new stream.PassThrough();
		this.stderr = new stream.PassThrough();

		this.killed = false;
		this._exitStatus = undefined;
		this._stdoutWritesFinished = false;
		this._stderrWritesFinished = false;
		this._socketClosed = false;
		this._exitEmitted = false;

		var self = this;

		/**
		 * Prematurely kill the nailgun process before completion.
		 *
		 * The connection to the server and this process's streams are
		 * immediately closed. This process will fire an 'exit' event with null
		 * as the exit status.
		 */
		this.kill = function() {
			this.killed = true;
			self._exitStatus = null;
			this.emit('_kill');
			this.stdin.destroy();
			this.stdout.destroy();
			this.stderr.destroy();
			this._maybeEmitExit();
		};

		this._onExitReceived = function(status) {
			if(typeof status !== 'number') {
				throw new Error('status must be a number');
			}
			// Prevent process from exiting twice. Nailgun
			// seems to like to send two exit chunks instead of
			// just one.
			if(self._exitStatus !== undefined) return;
			self._exitStatus = status;
			self._maybeEmitExit();
		};

		this._maybeEmitExit = function() {
			if(!self._exitEmitted
				&& self._stdoutWritesFinished
				&& self._stderrWritesFinished
				&& self._socketClosed
				&& self._exitStatus !== undefined) {
				self._exitEmitted = true;
				setImmediate(function() {
					self.emit('exit', self._exitStatus);
				});
			}
		};
		listenMultiple(this.stdout, ['finish', 'close'], function() {
			self._stdoutWritesFinished = true;
			self._maybeEmitExit();
		});
		listenMultiple(this.stderr, ['finish', 'close'], function() {
			self._stderrWritesFinished = true;
			self._maybeEmitExit();
		});

		this._onSocketClosed = function() {
			self._socketClosed = true;
			self._maybeEmitExit();
		}
	}
	util.inherits(JVMPinProcess, events.EventEmitter);

	this._handleWarning = function() {
		// Promote warnings to errors if there are no warning handlers (apart
		// from this).
		if(self.listenerCount('warning') === 1) {
			self.emit.call(self, ['error'].concat(arguments));
		}
	};
	this.on('warning', this._handleWarning);

	/**
	 * readChunks(bufferData)
	 *
	 * Reads the passed in bufferData and processes any complete chunks. All unprocessed
	 * chunk data is then moved to the _unprocessedBuffer.
	 *
	 * NOTE:
	 * This could use some optimizations by promoting a mixture of concat and a pointer
	 * arithmetic for writing directly into the buffer. (perhaps look at using a stream)
	 *
	 * @param bufferData - Buffer. A buffer object containing raw packet data to process.
	 * @return Array of Objects with 'type' and 'data' properties. The type property is
	 *          a CHUNK_TYPE identifier while the data is the processed chunk data.
	 */
	this.readChunks = function(bufferData) {
		self._unprocessedBuffer = Buffer.concat([self._unprocessedBuffer, bufferData]);

		if (self._unprocessedBuffer.length < 5) { // need more before reading chunk head
			return [];
		}

		var chunkSize = self._unprocessedBuffer.readUInt32BE(0),
		    chunkCode = self._unprocessedBuffer.toString('ascii', 4, 5);

		if (chunkSize + 5 > self._unprocessedBuffer.length) { // need more before reading chunk data
			return [];
		}

		var chunkEnd  = 5 + chunkSize,
		    chunkData = self._unprocessedBuffer.slice(5, chunkEnd),
		    unprocessedChunkData = self._unprocessedBuffer.slice(chunkEnd);

		self._unprocessedBuffer = self._unprocessedBuffer.slice(0, 0); // drain the _unprocessedBuffer.

		if (unprocessedChunkData.length > 0) {
			return [{ type: chunkCode, data: chunkData }].concat(self.readChunks(unprocessedChunkData));
		}

		return [{ type: chunkCode, data: chunkData }];
	};

	/**
	 * writeChunk(chunkType, data, [callback])
	 *
	 * Writes data to the socket using the nailgun chunk protocol data.
	 *
	 * @param chunkType - CHUNK_TYPE. Sets the chunk type identifier.
	 * @param data      - String | Buffer. Sets the chunk data. (with ascii encoding).
	 * @param cb        - Function. Called when the data is written to the socket.
	 * @return Boolean. If the full chunk is written returns true, otherwise false.
	 */
	this.writeChunk = function (chunkType, data, cb) {
		var chunkHead = Buffer.alloc(5);
		    chunkData = (typeof data === 'string') ? Buffer.from(data) : data;

		chunkHead.writeUInt32BE(data.length, 0);
		chunkHead.write(chunkType, 4, 'ascii');

		return self._socket.write(Buffer.concat([chunkHead, chunkData]), cb);
	};

	/**
	 * spawn(command, [args], [options])
	 *
	 * @param command - String. The 'nail' or main java class to execute.
	 * @param args - Array. A list of arguments to send the command.
	 *        Default: []
	 * @param options - Object. A set of possible options to send to the process.
	 * @param options.cwd - String. The working directory for the command.
	 * 	      Default: process.cwd()
	 * @param options.env - Object. An the environment variables for the command.
	 * 	      Default: process.env
	 */
	this.spawn = function(command, args, options) {
		if(self._spawned) {
			throw new Error('spawn() was already called on on this JVMPin instance');
		}
		self._spawned = true;

		if (typeof command !== 'string') {
			throw new Error("Unable to spawn command: ", command);
		}

		args = args || [];
		options = options || {};
		options.exitOnClose = options.exitOnClose || true;
		options.env = options.env || process.env;
		options.cwd = options.cwd || process.cwd();

		// protocol handshake
		args.forEach(function(arg) {
			self.writeChunk(self.CHUNK_TYPE.ARGUMENT, arg);
		});
		self.writeChunk(self.CHUNK_TYPE.ENVIRONMENT, 'NAILGUN_FILESEPARATOR=' + (require('os').type() === 'Windows_NT' ? ';' : ':'));
		self.writeChunk(self.CHUNK_TYPE.ENVIRONMENT, 'NAILGUN_PATHSEPARATOR=' + require('path').sep);
		for (key in options.env) {
			self.writeChunk(self.CHUNK_TYPE.ENVIRONMENT, key + '=' + options.env[key]);
		}
		self.writeChunk(self.CHUNK_TYPE.WORKING_DIRECTORY, options.cwd);
		self.writeChunk(self.CHUNK_TYPE.COMMAND, command);

		var jvmpin_process = new JVMPinProcess();
		var queuedChunks = [];

		// stdin policy controls these two behaviours:
		var stdinBeforeRequest = self._stdinPolicy === STDIN_POLICY.ALL_BEFORE_REQUEST;
		var stdinSingleChunkPerWrite = self._stdinPolicy === STDIN_POLICY.ONCE_PER_REQUEST;

		// true if the server has sent an SEND_INPUT chunk, indicating it wants
		// us to send a STDIN data chunk. Note that the Nailgun server (as of
		// 1.0.0) expects a single STDIN chunk in response to every SEND_INPUT
		// chunk. If a STDIN chunk is received by the server before a nail has
		// finished reading a previously received STDIN chunk, the server raises
		// an error.
		var stdinRequested = stdinBeforeRequest;
		var heartbeatDue = false;
		var heartbeatTimeout;
		var exitChunkReceived = false;
		var allChunksWritten = false;
		var stdinEOF = false;
		var stdinEOFSent = false;
		var socketReadableEnded = false;
		var socketClosed = false;

		// Keep track of when our write streams have returned false from write
		// and are awaiting a 'drain' event
		var canWriteSocket = true;
		var canWriteStdout = true;
		var canWriteStderr = true;
		self._socket.on('drain', function() { canWriteSocket = true; });
		jvmpin_process.stdout.on('drain', function() { canWriteStdout = true; });
		jvmpin_process.stderr.on('drain', function() { canWriteStderr = true; });

		// Internal event emitted when the process's kill() method is called.
		// We need to immediately close the connection and stop writing data.
		jvmpin_process.on('_kill', function() {
			assert(jvmpin_process.killed === true);
			self._socket.destroy();
			self._socket.removeAllListeners('drain');
			self._socket.removeAllListeners('readable');
			jvmpin_process.stdin.removeListener('readable', sendChunks);
			jvmpin_process.stdout.removeListener('drain', receiveChunks);
			jvmpin_process.stderr.removeListener('drain', receiveChunks);
			unscheduleHeartbeat();
		});

		self._socket.on('end', function() {
			socketReadableEnded = true;
			// Ensure we go through the receive cycle again to finish up
			process.nextTick(receiveChunks);
		});

		self._socket.on('close', function() {
			socketClosed = true;
			jvmpin_process._onSocketClosed();
		});

		function scheduleStdin() {
			if(stdinRequested) {
				return;
			}
			stdinRequested = true;
			sendChunks();
		}

		function closeStdin() {
			jvmpin_process.stdin.destroy();
		}

		function requestHeartbeat() {
			heartbeatDue = true;
			sendChunks();
		}

		function scheduleHeartbeat() {
			unscheduleHeartbeat();
			if(self._heartbeatInterval) {
				heartbeatTimeout = setTimeout(requestHeartbeat, self._heartbeatInterval);
			}
		}

		function unscheduleHeartbeat() {
			heartbeatDue = false;
			if(heartbeatTimeout !== undefined) {
				clearTimeout(heartbeatTimeout);
			}
		}

		function receiveChunks() {
			// Don't process any data if we're killed
			if(jvmpin_process.killed) {
				return;
			}

			var initialChunkCount = queuedChunks.length;

			if(!socketReadableEnded && queuedChunks.length === 0) {
				var data;
				while((data = self._socket.read()) !== null) {
					queuedChunks = queuedChunks.concat(self.readChunks(data));
				}

				// Note: when data is null (socket is empty) we must always
				// eventually schedule a readable event. We don't attempt to
				// read more data until we've processed all available chunks, as
				// we want to read incoming chunks at the same rate that we
				// process chunks and stream out chunk data.
				initialChunkCount = queuedChunks.length;
				if(!socketReadableEnded && queuedChunks.length === 0) {
					ensureListeningOnce(self._socket, 'readable', receiveChunks);
					return;
				}

				// Immediately handle EXIT chunks - we don't emit an exit event
				// until the stdout and stderr streams are consumed though.
				var exitChunkIndex = exitChunkReceived ? 0 : queuedChunks.findIndex(isExitChunk);
				if(exitChunkIndex !== -1) {
					// Ensure that additional chunks are not processed after an
					// exit chunk (but ignore > 1 exit chunk, as the server has
					// a bug causing it to send two).
					if(queuedChunks.slice(exitChunkIndex + 1).some(isNonExitChunk)) {
						self.emit('warning', 'received chunks after EXIT', queuedChunks.slice(exitChunkIndex + 1));
					}

					if(!exitChunkReceived) {
						exitChunkReceived = true;
						unscheduleHeartbeat();
						self._socket.end();
						var exitStatus = parseInt(queuedChunks[exitChunkIndex].data.toString(), 10);
						if(isNaN(exitStatus)) {
							self.emit('error', new Error(
								'invalid exit chunk payload: ' + queuedChunks[exitChunkIndex].data.toString()));
							exitStatus = 255;
						}
						jvmpin_process._onExitReceived(exitStatus);
					}

					// Drop EXIT chunk (and any unexpected subsequent chunks)
					queuedChunks = queuedChunks.slice(0, exitChunkIndex);
				}

				// Handle SEND_INPUT chunks immediately as they are not dependent on
				// order, and otherwise we unnecessarily delay sending input to the
				// server until something has drained stdout/stderr.
				if(queuedChunks.some(isSendInputChunk)) {
					queuedChunks = queuedChunks.filter(isNonSendInputChunk);
					scheduleStdin();
				}
			}

			// At this point, if the socket is ended, we will never receive any
			// further chunks, so we know if the server failed to send an exit
			// chunk.
			if(socketReadableEnded && !jvmpin_process.killed && !exitChunkReceived) {
				self.emit('error', new Error('server closed connection before sending an EXIT chunk'));
				// terminate without an exit code
				jvmpin_process.kill();
				return;
			}

			// Try to write data chunks to our two output streams. Note that
			// chunks are handled in order so that the order of interleaved
			// stdout/stderr writes by the server are preserved.
			while(queuedChunks.length > 0) {
				switch (queuedChunks[0].type) {
					case self.CHUNK_TYPE.STDOUT:
						if(canWriteStdout) {
							canWriteStdout = jvmpin_process.stdout.write(queuedChunks.shift().data);
						}
						else {
							// Wait for stdout to become writable again before sending more data
							ensureListeningOnce(jvmpin_process.stdout, 'drain', receiveChunks);
							return;
						}
						break;
					case self.CHUNK_TYPE.STDERR:
						if(canWriteStderr) {
							canWriteStderr = jvmpin_process.stderr.write(queuedChunks.shift().data);
						}
						else {
							// Wait for stdout to become writable again before sending more data
							ensureListeningOnce(jvmpin_process.stderr, 'drain', receiveChunks);
							return;
						}
						break;
					default:
						var chunk = queuedChunks.shift();
						this.emit('warning', "received unexpected chunk type", chunk.type, chunk.data.toString());
				}
			}

			assert(queuedChunks.length === 0);

			if(exitChunkReceived && !allChunksWritten) {
				allChunksWritten = true;
				jvmpin_process.stdout.end();
				jvmpin_process.stderr.end();
			}

			if(initialChunkCount > 0) {
				// We've processed all the available chunks, so it's now OK to
				// read some more.
				process.nextTick(receiveChunks);
			}
		}

		jvmpin_process.stdin.on('end', function() {
			stdinEOF = true;
			sendChunks();
		});
		function sendChunks() {
			// Note: currently a race condition exists in that the nailgun server fully shuts down its socket without
			// waiting for clients to close the sending side of their socket. As a result, it's possible for us to send
			// a heartbeat chunk to the server as it closes its socket, resulting in it sending a TCP RST,
			// triggering an error on our side.
			if(exitChunkReceived || socketReadableEnded || socketClosed || jvmpin_process.killed) {
				return;
			}

			if(stdinEOF && !stdinEOFSent) {
				if(!canWriteSocket) {
					ensureListeningOnce(self._socket, 'drain', sendChunks);
					return;
				}
				canWriteSocket = self.writeChunk(self.CHUNK_TYPE.EOF, "");
				stdinEOFSent = true;
				// stdin is only closed when all its data has been accepted by
				// the socket stream. Users can ensure all their data was
				// consumed by the server by checking for a 'close' event on
				// stdin before the process's 'exit' event.
				closeStdin();
			}

			if(heartbeatDue) {
				if(!canWriteSocket) {
					ensureListeningOnce(self._socket, 'drain', sendChunks);
					return;
				}
				canWriteSocket = self.writeChunk(self.CHUNK_TYPE.HEARTBEAT, '');
				scheduleHeartbeat();
			}

			if(stdinRequested && !stdinEOF) {
				if (!canWriteSocket) {
					ensureListeningOnce(self._socket, 'drain', sendChunks);
					return;
				}

				var data;
				if(stdinSingleChunkPerWrite) {
					// In this mode we only write a single STDIN chunk at a
					// time. The server has to request the next chunk using a
					// SEND_STDIN chunk.
					data = jvmpin_process.stdin.read();
					if (data === null) {
						ensureListeningOnce(jvmpin_process.stdin, 'readable', sendChunks);
						return;
					}

					canWriteSocket = self.writeChunk(self.CHUNK_TYPE.STDIN, data);
					stdinRequested = false;
				}
				else {
					// In this mode we write our stdin data as fast as the
					// socket will accept it.
					while((data = jvmpin_process.stdin.read()) !== null) {
						canWriteSocket = self.writeChunk(self.CHUNK_TYPE.STDIN, data);
						if(!canWriteSocket) {
							ensureListeningOnce(self._socket, 'drain', sendChunks);
							return;
						}
					}
					ensureListeningOnce(jvmpin_process.stdin, 'readable', sendChunks);
				}
			}
		}

		receiveChunks();
		scheduleHeartbeat();
		sendChunks();
		return jvmpin_process;
	};
}
util.inherits(JVMPin, events.EventEmitter);

function ensureListeningOnce(emitter, event, listener) {
	emitter.removeListener(event, listener);
	emitter.once(event, listener);
}

function listenMultiple(emitter, events, listener) {
	events.forEach(function(event) {
		emitter.on(event, listener);
	});
}

function isSendInputChunk(chunk) { return chunk.type === CHUNK_TYPE.SEND_INPUT; }
function isNonSendInputChunk(chunk) { return chunk.type !== CHUNK_TYPE.SEND_INPUT; }
function isExitChunk(chunk) { return chunk.type === CHUNK_TYPE.EXIT; }
function isNonExitChunk(chunk) { return chunk.type !== CHUNK_TYPE.EXIT; }

/** @returns a copy of object without any undefined values. */
function dropUndefined(object) {
	var result = {};
	for(var key in object) {
		if(object[key] !== undefined) {
			result[key] = object[key];
		}
	}
	return result;
}
