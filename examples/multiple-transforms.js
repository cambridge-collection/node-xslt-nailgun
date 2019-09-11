let path = require('path');
let {performance} = require('perf_hooks');
let {using, execute, XSLTExecutor} = require('@lib.cam/xslt-nailgun');

async function main() {
    console.log("# Multiple XSLT transform examples\n");
    console.log(`\
This example demonstrates 3 ways of executing multiple transforms with the same
stylesheet - 2 good, 1 bad.

Note that in general, the first execution of a given stylesheet is slow, as the
XSLT transform must be loaded and compiled before execution. Subsequent uses of
the same stylesheet are significantly faster.\n`);

    console.log(`\
## executor.execute() in series, reusing executor - OK

Each transform re-uses the same nailgun server, so they're quick once the first
one has caused the XSLT to be loaded.
`);
    let overallStart = performance.now();
    await using(XSLTExecutor.getInstance(), async (executor) => {
        for(let i = 0; i < 10; ++i) {
            let start = performance.now();
            let buffer = await executor.execute({
                xml: `<foo n="${i}">hi</foo>`,
                xsltPath: path.resolve(__dirname, 'wrap.xsl')
            });
            console.log(`${Math.round(performance.now() - start)} ms: `, buffer.toString());
        }
    });
    console.log(`Total time: ${Math.round(performance.now() - overallStart)} ms\n\n`);

    console.log(`\
## execute() in parallel - OK

Each call re-uses the same nailgun server. They all take about the same amount
of time, as they all must wait for the XSLT to be compiled before execution.
However compilation happens once, and they wait in parallel, so overall the time
taken is slightly less than running in series.
`);
    overallStart = performance.now();
    let executions = Array(10).fill(null).map(async (val, i) => {
        let start = performance.now();
        let buffer = await execute({
            xml: `<foo n="${i}">hi</foo>`,
            xsltPath: path.resolve(__dirname, 'wrap.xsl')
        });
        return {buffer, elapsed: performance.now() - start};
    });
    (await Promise.all(executions)).forEach(({buffer, elapsed}) => {
        console.log(`${Math.round(elapsed)} ms: ${buffer.toString()}`);
    });

    console.log(`Total time: ${Math.round(performance.now() - overallStart)} ms\n\n`);

    // Using the top-level execute() in series will shut down the JVM after
    // each execution. Either run execute() in parallel, or maintain a reference
    // to an XSLTExecutor to keep the JVM alive.
    console.log(`\
## execute() in series - Don't do this - JVM re-created on each iteration

This happens because the top-level execute() function uses reference counting to
only keep a nailgun server running as long as there are execute() calls being
evaluated. Each execute() call finishes before the next is started, so the
server is shutdown in between each call. To avoid this, make all execute() calls
in parallel, or maintain a reference to an executor, as in the two examples
above.
`);
    overallStart = performance.now();
    for(let i = 0; i < 5; ++i) {
        let start = performance.now();
        let buffer = await execute({
            xml: `<foo n="${i}">hi</foo>`,
            xsltPath: path.resolve(__dirname, 'wrap.xsl')
        });
        console.log(`${Math.round(performance.now() - start)} ms: `, buffer.toString());
    }
    console.log(`Total time: ${Math.round(performance.now() - overallStart)} ms`);
}
main().catch((e) => {
    console.error('Failed to execute transform: ' + e);
    process.exit(1);
});
