/**
 * An integration test asserting that memory usage (of Buffer objects) does not
 * grow over time as jvmpin streams data. If jvmpin's streams respect
 * backpressure from its socket, stdout and stderr streams then it should only
 * buffer a fixed amount of data.
 *
 * To test this, two Echo nails; A and B are started with A's output feeding into B.
 * A can pass data at a faster rate than B. A receives data as fast as possible,
 * and B's output is consumed as fast as possible. If backpressure is respected,
 * this will work without memory use growing.
 *
 * The test fails if memory usage grows to EXTERNAL_MEMORY_LIMIT.
 */
var assert = require('assert');
var createTestConnection = require('./create-connection');
var docopt = require('docopt').docopt;
var fs = require('fs');
var path = require('path');
var util = require('util');

var usage = fs.readFileSync(path.resolve(__dirname, 'jvmpin-backpressure-test_usage.txt'), 'utf-8');
var options = docopt(usage);

var running = true;
var countdown = options['--write-seconds'] === null ? 5 : parseInt(options['--write-seconds']);
if(isNaN(countdown)) {
    throw new Error('--write-seconds must be an integer');
}
var stream = options['--stream'] === null ? 'stdout' : options['--stream'];
if(stream !== 'stdout' && stream !== 'stderr') {
    throw new Error('--stream must be \'stdout\' or \'stderr\'')
}
var dataStream = stream === 'stdout' ? 'stdout' : 'stderr';
var msgStream = stream === 'stdout' ? 'stderr' : 'stdout';
var echoStreamOptions = stream === 'stdout' ? [] : ['--stderr'];
var stdinPolicy = options['--stdin-policy'] === null ? 'once-per-request' : options['--stdin-policy'];

var countdownHandle;
var bytesWritten = 0;
var bytesRead = 0;
var input = Buffer.from(new Array(512).fill('y\n').join(''));

// Consumed buffer size varies between node versions. In 10.X it's < 5MB, but
// can spike over 50 MB in 4.X. The important thing is that it remains at a
// consistent level and doesn't rise over time.
var EXTERNAL_MEMORY_LIMIT = 1024 * 1024 * 200;

function newClient(name) {
    var client = createTestConnection({
        heartbeatInterval: stdinPolicy === 'once-per-request' ? undefined : 0,
        stdin: stdinPolicy
    });
    registerErrorHandler(client, name);
    return client;
}

var procfast = newClient('client fast').spawn(
    'io.foldr.ngtesthost.Echo', [
        '--bytes-per-second', '' + 1024 * 1024 * 100, '--id', 'Echo fast'
    ].concat(echoStreamOptions));
var procslow = newClient('client slow').spawn(
    'io.foldr.ngtesthost.Echo', [
        '--bytes-per-second', '' + 1024 * 1024 * 4, '--id', 'Echo slow'
    ].concat(echoStreamOptions));

procfast[dataStream].pipe(procslow.stdin);
procfast[msgStream].pipe(process.stderr);
procslow[msgStream].pipe(process.stderr);

function registerErrorHandler(stream, name) {
    stream.on('error', function (e) {
        console.error(util.format('*** %s error: %s', name, e.message));
        throw e;
    });
}
registerErrorHandler(procfast.stdin, 'procfast.stdin');
registerErrorHandler(procfast.stdout, 'procfast.stdout');

registerErrorHandler(procslow.stdin, 'procslow.stdin');
registerErrorHandler(procslow.stdout, 'procslow.stdout');

process.on('SIGINT', function() {
    if(running) {
        console.error('*** Ctrl+C received, stopping input...');
        startShutdown();
        return;
    }

    if(!procfast.killed || !procslow.killed) {
        console.error('*** > 1 Ctrl+C received, Forcefully killing nail processes...');
        procfast.kill();
        procslow.kill();
    }
});

// Write input as fast as possible (but respecting backpressure)
function writeInput() {
     if(!running) {
        console.error('*** End of input');
        procfast.stdin.end();
        return;
    }

    var writable = procfast.stdin.write('');
    for(var i = 0; i < 100 && writable && running; ++i) {
        writable = procfast.stdin.write(input);
        bytesWritten += input.length;
    }
    if(writable) {
        return setImmediate(writeInput);
    }
    if(running) {
        procfast.stdin.once('drain', writeInput);
    }
}

// Consume output as fast as possible
function readOutput() {
    var data;
    for(var i = 0; i < 100 && (data = procslow[dataStream].read()) !== null; ++i) {
        bytesRead += data.length;
    }
    if(data !== null) {
        return setImmediate(readOutput);
    }
    procslow[dataStream].once('readable', readOutput);
}

writeInput();
readOutput();

function startShutdown() {
    running = false;
    clearInterval(countdownHandle);
}

function doCountdown() {
    console.error(util.format('*** Ending input in %d...', countdown));
    countdown -= 1;
    if(countdown === 0) {
        startShutdown();
    }
}
if(countdown > 0) {
    countdownHandle = setInterval(doCountdown, 1000);
}
else {
    console.error('Writing for unlimited time, use Ctrl+C to shutdown.')
}

procfast.on('exit', function(c) {
    console.error('*** fast Echo terminated: ' + c);
});
procslow.on('exit', function(c) {
    console.error('*** slow Echo terminated: ' + c);
});

process.on('exit', function() {
    console.error(util.format('*** terminating, %s MB transmitted', mb(bytesRead)));
    assert(bytesRead > 1024 * 512,
        util.format('Insufficient data transferred: %s MB', mb(bytesRead)));
});

function checkMemoryUsage() {
    assert(typeof global.gc === 'function',
        'global.gc() API not available - run node with --expose-gc');
    // Run a garbage collection cycle before checking memory usage to get more accurate numbers.
    global.gc();

    var mem = process.memoryUsage();
    assert('external' in mem,
        'process.memoryUsage().external API not available, unable to monitor Buffer usage');

    // stream Buffers are allocated in external memory
    assert(mem.external < EXTERNAL_MEMORY_LIMIT, util.format(
        'Probable memory leak: process.memoryUsage().external exceeds limit. external: %s MB, limit: %s MB\n',
        mem.external / 1024 / 1024, EXTERNAL_MEMORY_LIMIT / 1024 / 1024
    ));
    console.error(util.format('written: %s MB, read: %s MB, external memory: %s mb',
        mb(bytesWritten), mb(bytesRead), mb(mem.external)));
}
setInterval(checkMemoryUsage, 1000).unref();

function mb(b) {
    var mb = b / 1024 / 1024;
    return Math.round(mb * 100) / 100;
}
