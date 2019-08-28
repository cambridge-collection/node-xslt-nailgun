/**
 * Test case to ensure invoking spawn() multiple times is not allowed.
 */
'use strict';

var createTestConnection = require('./create-connection');
var devnull = require('dev-null');

var client = createTestConnection();
var proc = client.spawn('io.foldr.ngtesthost.Stdout');
proc.stdout.pipe(devnull());
proc.stderr.pipe(devnull());

try {
    // Calling spawn > 1 time is unsupported.
    client.spawn('io.foldr.ngtesthost.Stdout');
    throw new Error('second spawn() call did not throw');
}
catch(e) {
    if(e.message !== 'spawn() was already called on on this JVMPin instance') {
        throw new Error('Unexpected error: ' + e);
    }
}
