/**
 * Test case for multiple events firing on the JVMPin process
 * object.
 */

'use strict';

var createTestConnection = require('./create-connection');
var assert = require('assert');

var connection = createTestConnection();
var proc = connection.spawn('ng-cp');

var exitEmitted = 0;
proc.on('exit', function () {
    exitEmitted += 1;
    assert(exitEmitted <= 1, 'Exit event emitted twice!');
});

var stdoutCloseEmitted = 0;
proc.stdout.on('close', function () {
    stdoutCloseEmitted += 1;
    assert(stdoutCloseEmitted <= 1, 'Close event emitted twice!');
});
