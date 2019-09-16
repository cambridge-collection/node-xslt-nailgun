# `@lib.cam/xslt-nailgun`

A Node.js XSLT 3.0 library without Node.js native-code dependencies.

XSLT execution is delegated to a [nailgun] server running in a separate JVM process. The mature [SAXON-HE] Java library is used to execute XSLT code. 

Despite using a separate Java process to run XSLT, `@lib.cam/xslt-nailgun` is fast because:
- A single nailgun server is reused by repeated XSLT executions, so the JVM startup cost is only paid on the first transform.
- The server caches the executable representation of XSLT programmes, minimising the cost of repeated executions

By using a nailgun server in a separate JVM process, the need to use fragile native node libraries to bridge to a JVM is removed. No more waiting for downstream native dependencies to be patched before upgrading major node versions, no more debugging crashes in native modules.

[SAXON-HE]: http://www.saxonica.com/products/feature-matrix-9-9.xml
[nailgun]: https://github.com/facebook/nailgun

## Install

```console
$ npm install @lib.cam/xslt-nailgun
```

## Usage

The module exports an `execute()` function, accepting an XSLT file to execute and an input document to pass to it and returns a Promise which resolves to a `Buffer` containing the output.

```javascript
let path = require('path');
let {execute} = require('@lib.cam/xslt-nailgun');

let xsltOutput = await execute({
    xml: '<foo>hi</foo>',
    xsltPath: './my-transform.xsl'
});
console.log(xsltOutput.toString());  // xsltOutput is a Buffer
```

As long as repeated calls to `execute()` are made within around a second of a prior call completing, they'll share the same nailgun server. If longer gaps are expected, an executor object can be obtained, which will keep a nailgun server available until its explicitly closed.

```javascript
let {using, XSLTExecutor} = require('@lib.cam/xslt-nailgun');

// using() automatically calls close() on the executor when the inner function is finished
let result = await using(XSLTExecutor.getInstance(), async (executor) => {   
    let xsltOutput1 = await executor.execute({
        xml: `<foo>a</foo>`,
        xsltPath: './my-transform.xsl'
    });

    let data = await someSlowOperation(xsltOutput1);
    
    return await executor.execute({
        xml: data,
        xsltPath: './my-transform.xsl'
    });
});
```

See the [examples](./examples) directory for more. Execute [examples/run-all.sh](examples/run-all.sh) to run them all automatically.

## API

Everything public is exported at the top level; e.g:

```javascript
const {XSLTExecutor, execute, using} = require('@lib.cam/xslt-nailgun');
```

### function `execute(options)`, method `XSLTExecutor.execute(options)`

Execute XSLT code. The XSLT is executed by a nailgun server with [SAXON-HE] running in a separate Java process. If a nailgun server is already running it will be re-used (JVM startup time is the most time-consuming part of executing a one-off transform).

The top-level `execute()` is a convenience wrapper. It automatically acquires an Executor, calls its `execute()` method, and then closes it before returning the result.

#### Arguments

`xsltPath` is always required. At least one of `xml`, `xmlPath` and `systemIdentifier` are required. If `systemIdentifier` is combined with `xml` or `xmlPath` it serves to override the default base URI implied by those options. If used by itself, the input document is obtained by dereferencing the URL.

* `options` — An object with the following properties:
  * `options.xsltPath`: `string` — The filesystem path to the XSLT file to execute.
  * `options.xml`: `string` | `Buffer` — The input data for the XSLT to operate on.
  * `options.xmlPath`: `string` — The filesystem path to a file containing the input data for the XSLT to operate on.
  * `options.systemIdentifier`: `string` — Defines the base URI for the input document when the XSLT is executed.
  * The top-level `execute()` function also accepts options from `XSLTExecutor.getInstance(options)`.

### class `XSLTExecutor`

`XSLTExecutor` is a `Closable` which exposes an `execute()` method to run XSLT code. The nailgun server used to execute the XSLT is guaranteed to remain running until an `XSLTExecutor` instance's `close()` method is called.

Instances of `XSLTExecutor` are obtained from its `XSLTExecutor.getInstance(options)` static method.

**Important**: executor instances **MUST** have their `close()` method called (and awaited - it returns a Promise) once they are no longer needed. Failure to call `close()` will result in the nailgun server JVM process running in the background until the node process terminates. The `using()` function can be used to ensure `close()` is called.

### static method `XSLTExecutor.getInstance([options])`

Get a Promise resolving to an `XSLTExecutor` instance whose nailgun server process is created using the specified options.

Repeated calls to `getInstance()` using the same option values will receive an executor using the same nailgun server.

#### Arguments

* `options` — An optional object with the following properties:
  * `options.jvmExecutable`: `string` — The command (on the `$PATH`) or path of the Java executable to use to run the nailgun server. Must be Java 8 or higher. Default: `'java'`
  * `options.jvmProcessID`: `string` | `null` — An opaque identifier for the nailgun server. Executors created with distinct jvmProcessID values will use nailgun servers running in distinct JVM processes. This can be used to isolate XSLT execution environments, and also to identify the process affected when an async JVM process close error occurs. Default: null
  * `options.jvmKeepAliveTimeout`: `number` | `null` — The number of milliseconds to keep the nailgun server running for after all execute() calls have completed. If null (the default), the timeout will be determined automatically (typically around 1 second).

### function `using(resource, callback)`

`using()` implements the promise disposer pattern, allowing a `Closable` resource (e.g. an `XSLTExecutor`) to be automatically closed after being used in a block, even if the block itself fails for some reason.

#### Arguments

* `resource`: `Closable` | `Promise<Closable>` — The resource to be used, either directly, or as a Promise which resolves to the resource
* `callback`: (`resource`: `Closable`) => `Promise` — A function which does something with the resource and returns a `Promise`. The outer `using()` call returns this result.

#### Example

```javascript
let buffer = await using(XSLTExecutor.getInstance(), async (executor) => {
    // The executor is not closed until we return or throw            
    return executor.execute({/* ... */});
});
// The executor is now closed
Console.log(buffer.toString());
```

* [`using()` tests](src/89aaa9437fdd4ea4560f8f1465eb512124bdf6cd/test/_resources.test.ts#lines-14)

### interface `Closable`

Any resource which can be cleaned up by invoking its `close()` method. `close()` may return undefined, or a `Promise` (which resolves to undefined) in order to close asynchronously.

## Goals

This library was created with the following objectives in mind, following experience similar libraries breaking and needing constant maintenance after each new major node version:

- Support for modern XSLT specs (currently 3.0)
- Simple maintenance
- Support for the latest node versions, now and in the future
- No native node modules (directly, or via dependencies)
- Good XSLT performance

## Contributing

See the [contributing](./CONTRIBUTING.md) page.
