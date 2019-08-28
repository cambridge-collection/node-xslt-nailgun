/*
 * Test that jvmpin correctly sends and receives data. A nailgun server must
 * be running on localhost:2113 with the io.foldr.ngtesthost.Echo nail from
 * test/ng-testhost.
 *
 * Example usage:
 *   $ cat /some/file | node jvm-roundtrip-test.js
 *   $ head -c 10M /dev/urandom | node jvm-roundtrip-test.js
 */
var assert = require('assert');
var createTestConnection = require('./create-connection');
var crypto = require('crypto');
var docopt = require('docopt').docopt;
var fs = require('fs');
var path = require('path');
var util = require('util');

var usage = fs.readFileSync(path.resolve(__dirname, 'jvmpin-roundtrip-test_usage.txt'), 'utf-8');
var options = docopt(usage);

var client = createTestConnection();
var proc = client.spawn('io.foldr.ngtesthost.Echo');
var hash = crypto.createHash('sha256');
var expectedDigest;
var actualDigest;
var writeReceived = options['--echo'];
var validated = false;

writeStdin(proc.stdin, function(err, digest) {
    assert(!err, err);
    expectedDigest = digest;
    if(actualDigest)
        validateHashes();
});
proc.stdout.pipe(hash);
if(writeReceived) {
    proc.stdout.pipe(process.stdout);
}

proc.on('exit', function() {
    actualDigest = hash.read().toString('hex');
    if(expectedDigest) {
        validateHashes();
    }
});

function validateHashes() {
    var match = expectedDigest === actualDigest;
    console.error(util.format('%s:\n  sha256(sent)     = %s\n  sha256(received) = %s',
        match ? 'OK' : 'FAIL', expectedDigest, actualDigest));
    validated = true;
    process.exit(match ? 0 : 1);
}

function writeStdin(dest, cb) {
    process.stdin.pipe(dest);
    var hash = crypto.createHash('sha256');
    process.stdin.pipe(hash);
    process.stdin.on('end', function() {
        cb(null, hash.read().toString('hex'));
    });
}

process.on('exit', function() { assert(validated); });
