var assert = require('assert');
var createTestConnection = require('./create-connection');

var client = createTestConnection();
var proc = client.spawn('io.foldr.ngtesthost.Echo');
var verified = false;

client.on('connect', function() {
    proc.kill();
});

proc.on('exit', function(status) {
    assert(status === null);
    verified = true;
});

process.on("beforeExit", function() {
    assert(verified);
});
