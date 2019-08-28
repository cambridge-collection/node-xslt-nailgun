/**
 * Test case for reading a signed integer from java to test that binary
 * output is working.
 */

'use strict';

var createTestConnection = require('./create-connection');
var assert = require('assert');

var TEST_NUM = 1695609641;

var client = createTestConnection();
var proc = client.spawn('io.foldr.ngtesthost.StdoutBinary', ['' + TEST_NUM]);

var chunks = [];
proc.stdout.on('data', function(chunk) { chunks.push(chunk); });
proc.stdout.on('end', function() {
    var data = Buffer.concat(chunks);
    // Java int is signed big endian
    var int = data.readInt32BE();
    assert(int === TEST_NUM, 'Integer not in correct binary');
});
