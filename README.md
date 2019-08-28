# JVMPin

JVMPin provides a nodejs implementation of the nailgun protocol.

Information about nailgun can be found at
[http://www.martiansoftware.com/nailgun/](http://www.martiansoftware.com/nailgun/). Nailgun is currently maintained by Facebook at https://github.com/facebook/nailgun/.

Java dependencies can be found at Maven Central:
```xml
<dependency>
  <groupId>com.facebook</groupId>
  <artifactId>nailgun-server</artifactId>
  <version>1.0.0</version>
</dependency>
```

Older releases (including command line client binaries) can be found at [sourceforge](https://sourceforge.net/projects/nailgun/files/nailgun/).

## Usage

The JVMPin library can be installed via npm by adding the following to
your package.json's dependencies or devDependencies sections:
```json
"dependencies": {
	"jvmpin": "1.x"
}

```

You will need to start your nailgun instance in another process (this is
a task I leave to the reader).

Then simply connect to the nailgun instance using:
```javascript

var jvmpin = require('jvmpin');

var proc = jvmpin.createConnection(1234, 'localhost').spawn('your.main.Class');

// now to take over the currently running context by binding stdio
proc.stdout.pipe(process.stdout);
proc.stderr.pipe(process.stderr);

process.stdin.pipe(proc.stdin);
proc.on('exit', function(c) { process.exit(); })

```

For more information please consult the [API
Documentation](https://bitbucket.org/bjconlan/jvmpin/raw/master/lib/jvmpin.js)

## Testing

To run the test suite, clone the repository and run:
```console
$ npm install
$ test/run-tests.sh
```

## Contributors

[Eric McCarthy](http://limulus.net/)

[Markus Hedvall](https://bitbucket.org/markushedvall/)


## License

Copyright © 2018 Benjamin Conlan

Distributed under the Eclipse Public License.
