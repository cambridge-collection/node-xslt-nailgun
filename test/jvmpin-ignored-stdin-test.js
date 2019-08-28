/**
 * Test sending stdin data to a nail that doesn't consume stdin. We can
 * observe that the data was not read, and it does not prevent the nail
 * terminating.
 */
var assert = require('assert');
var devnull = require('dev-null');
var createTestConnection = require('./create-connection');

function executeNail(command, inputData, cb) {
    var client = createTestConnection();
    var proc = client.spawn(command);
    var closeReceived = false;

    proc.stdin.on('close', function() {
        closeReceived = true;
    });

    client.on('error', function(e) {
        cb(new Error('client emitted error: ' + e));
    });
    proc.on('exit', function(status) {
        cb(null, {status: status, closeReceived: closeReceived});
    });

    proc.stdout.pipe(devnull());
    proc.stderr.pipe(devnull());
    proc.stdin.end(inputData);
}

var verified = false;
var stdoutResult, echoResult;

executeNail('io.foldr.ngtesthost.Stdout', 'foobar', function(err, result) {
    if(err) verify(err);
    stdoutResult = result;
    verify();
});
executeNail('io.foldr.ngtesthost.Echo', 'foobar', function(err, result) {
    if(err) verify(err);
    echoResult = result;
    verify();
});

function verify(err) {
    if(err)
        throw err;

    if(stdoutResult === undefined || echoResult === undefined)
        return;

    assert.strictEqual(stdoutResult.status, 0);
    assert.strictEqual(echoResult.status, 0);

    // Stdout nail doesn't read stdin, so the stdin stream should never be
    // emptied, and therefore not closed (no STDIN_EOF chunk is sent).
    assert.strictEqual(stdoutResult.closeReceived, false);
    // Echo does fully consume stdin, so close should be emitted.
    assert.strictEqual(echoResult.closeReceived, true);

    verified = true;
}

process.on('exit', function() {
    assert(verified, 'verify() didn\'t run');
});
