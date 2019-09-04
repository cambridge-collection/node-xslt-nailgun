/**
 * This is not so much a test, rather serves to demonstrate a race condition
 * in the way the nailgun server closes the connection to a client once a nail's
 * execution has completed. Currently the server unilaterally closes its socket
 * entirely without waiting for the client to close the outgoing side of theirs.
 *
 * As a result, the client can send a heartbeat as the server closes their
 * socket, resulting in a TCP RST.
 *
 * Running this program will fail about 5-10% of the time.
 */
var assert = require('assert');
var devnull = require('dev-null');
var createTestConnection = require('./create-connection');

var client = createTestConnection({heartbeatInterval: 1});

var proc = client.spawn('io.foldr.ngtesthost.Echo');
var BYTES_SENT = 1024 * 1024;
var bytesReceived = 0;

client.on('error', function(e) {
    verify(e);
});
proc.on('exit', function(status) {
    verify(null, status);
});

proc.stdout.on('data', function(chunk) {
    assert(/^x+$/.test(chunk.toString()));
    bytesReceived += chunk.length;
});
proc.stderr.pipe(devnull());
proc.stdin.end(new Array(BYTES_SENT).fill('x').join(''));

function verify(err, status) {
    if(err)
        throw err;

    assert.strictEqual(status, 0);
    assert.strictEqual(bytesReceived, BYTES_SENT);
    verified = true;
}

process.on('exit', function() {
    assert(verified, 'verify() didn\'t run');
});
