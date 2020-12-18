/**
 * A toy version of the ng client command, implemented with jvmpin for testing
 * purposes.
 */
var docopt = require('docopt').docopt;
var fs = require('fs');
var jvmpin = require('../lib/jvmpin');
var path = require('path');
var util = require('util');

var STDIN_POLICY_VALUES = ['all-after-request', 'once-per-request', 'all-before-request'];

var usage = fs.readFileSync(path.resolve(__dirname, 'jvmpin-ng_usage.txt'), 'utf-8');
var options = docopt(usage, {options_first: true});

var connectOptions;
try { connectOptions = parseConnectOptions(options); }
catch (e) {
    console.error('Error: ' + e.message);
    process.exit(1);
}

var client = jvmpin.createConnection(connectOptions);
var proc = client.spawn(options['<class-or-alias>'], options['<arg>']);

proc.stdout.pipe(process.stdout);
proc.stderr.pipe(process.stderr);
process.stdin.pipe(proc.stdin);

proc.on('exit', function(c) {
    process.exitCode = c;
});

client.on('error', function(e) {
    console.error('Error: jvmpin client socket emitted an error: ' + util.inspect(e));
    setTimeout(function() {
        process.exit(1);
    }, 1000)
});

function parseConnectOptions(options) {
    var result = {};

    // Handle ng compatibility aliases
    if(options['--nailgun-server'] !== null) {
        if(options['--host'] !== null)
            throw new Error('--nailgun-server and --host cannot both be specified');
        options['--host'] = options['--nailgun-server']
    }
    if(options['--nailgun-port'] !== null) {
        if(options['--port'] !== null)
            throw new Error('--nailgun-port and --port cannot both be specified');
        options['--port'] = options['--nailgun-port']
    }

    if(options['--path'] !== null && (options['--host'] !== null || options['--port'] !== null)) {
        throw new Error('--path cannot be specified if a host or port are specified');
    }

    if(options['--path'] !==  null) {
        result.path = options['--path'];
    }
    else {
        result.host = options['--host'] === null ? 'localhost' : options['--host'];
        var port = options['--port'] === null ? 2113 : parseInt(options['--port'], 10);
        if(isNaN(port) || port < 1) {
            throw new Error('--port must be an integer > 0');
        }
        result.port = port;
    }

    if(options['--stdin-policy'] !== null) {
        if(!STDIN_POLICY_VALUES.some(function(x) { return options['--stdin-policy'] === x; })) {
            throw new Error('Invalid --stdin-policy: ' + options['--stdin-policy']);
        }
        result.stdin = options['--stdin-policy'];
    }

    if(options['--heartbeat'] !== null) {
        var heartbeat = parseInt(options['--heartbeat'], 10);
        if(isNaN(heartbeat) || heartbeat < 0) {
            throw new Error('--heartbeat must be an integer >= 0');
        }
        result.heartbeatInterval = heartbeat;
    }

    return result;
}
