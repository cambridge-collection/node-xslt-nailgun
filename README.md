# xslt-nailgun

A Node.js XSLT 3.0 library without Node.js native-code dependencies.

Transformations are executed by [SAXON-HE] running in a separate JVM process. Nailgun is used with low per-execution overhead. [Nailgun] is used to achieve low per-execution overhead.

By using a nailgun server in a separate JVM process, the need to use fragile native node libraries to bridge to a JVM is removed. No more waiting for downstream native dependencies to be patched before upgrading major node versions, no more debugging crashes in native modules.

[SAXON-HE]: http://www.saxonica.com/products/feature-matrix-9-9.xml
[Nailgun]: https://github.com/facebook/nailgun

## Install

```console
$ npm install @lib.cam/xslt-nailgun
```

## Usage

```javascript
let path = require('path');
let {execute} = require('@lib.cam/xslt-nailgun');

async function main() {
    let buffer = await execute({
        xml: '<foo>hi</foo>',
        xsltPath: path.resolve(__dirname, 'wrap.xsl')
    });
    console.log(buffer.toString());
}
main().catch(e => {
    console.error('Failed to execute transform: ' + e);
    process.exit(1);
});

// Output:
// <?xml version="1.0" encoding="UTF-8"?><result><foo>hi</foo></result>
```

See the [examples](./examples) directory for more. Execute [examples/run-all.sh](examples/run-all.sh) to run them all automatically.

## Goals

This library was created with the following objectives in mind, following experience similar libraries breaking and needing constant maintenance after each new major node version:

- Support for modern XSLT specs (currently 3.0)
- Simple maintenance
- Support for the latest node versions, now and in the future
- No native node modules (directly, or via dependencies)
- Good XSLT performance

## Contributing

See the [contributing](./CONTRIBUTING.md) page.
