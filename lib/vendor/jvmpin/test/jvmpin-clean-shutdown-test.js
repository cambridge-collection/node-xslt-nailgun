// Should be first to wrap/hook things
let wtfnode = require('wtfnode');

let assert = require('assert');
let fs = require('fs');
let path = require('path');

let devnull = require('dev-null');
let docopt = require('docopt').docopt;

let createTestConnection = require('./create-connection');

let usage = fs.readFileSync(path.resolve(__dirname, 'jvmpin-clean-shutdown-test-usage.txt'), 'utf-8');
let options = docopt(usage);
let killing = options['--kill'];

let client = createTestConnection();
let proc = client.spawn('io.foldr.ngtesthost.Stdout');

proc.on('exit', (c) => {
    assert(c === (killing ? null : 0));
    let id = setImmediate(() => {
        console.error(
            'node failed to terminate itself after the nailgun command $s',
            (killing ? 'was killed' : 'exited'));
        wtfnode.dump();
        process.exit(1);
    });
    id.unref();
});

if(killing) {
    setImmediate(() => {
        proc.kill();
    });
}

proc.stdout.pipe(devnull());
proc.stderr.pipe(devnull());
proc.stdin.end();
