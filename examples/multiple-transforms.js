const path = require('path');
const {performance} = require('perf_hooks');
const {using, execute, XSLTExecutor} = require('@lib.cam/xslt-nailgun');

async function main() {
  console.log('# Multiple XSLT transform examples\n');
  console.log(`\
This example demonstrates several ways of executing multiple transforms with the same
stylesheet, and finally two anti-patterns to avoid.

Note that in general, the first execution of a given stylesheet is slow, as the
XSLT transform must be loaded and compiled before execution. Subsequent uses of
the same stylesheet are significantly faster.\n`);

  console.log(`\
## executor.execute() in series, reusing executor - OK

Each transform re-uses the same nailgun server, both because they all use the
same executor instance, and because the default keep-alive timeout keeps the JVM
process alive. As a result, they're quick once the first one has caused the XSLT
to be loaded.
`);
  await (async () => {
    const overallStart = performance.now();
    await using(
      XSLTExecutor.getInstance({
        jvmProcessID: 'executor.execute() in series',
      }),
      async executor => {
        for (let i = 0; i < 10; ++i) {
          const start = performance.now();
          const buffer = await executor.execute({
            xml: `<foo n="${i}">hi</foo>`,
            xsltPath: path.resolve(__dirname, 'wrap.xsl'),
          });
          console.log(
            `${Math.round(performance.now() - start)} ms: `,
            buffer.toString()
          );
        }
      }
    );
    console.log(
      `Total time: ${Math.round(performance.now() - overallStart)} ms\n\n`
    );
  })();

  console.log(`\
## executor.execute() in series, reusing executor but WITHOUT keep-alive - still OK

Each transform re-uses the same nailgun server, so they're quick once the first
one has caused the XSLT to be loaded.
`);
  await (async () => {
    const overallStart = performance.now();
    await using(
      XSLTExecutor.getInstance({
        jvmProcessID: 'executor.execute() in series without keep-alive',
        jvmKeepAliveTimeout: 0,
      }),
      async executor => {
        for (let i = 0; i < 10; ++i) {
          const start = performance.now();
          const buffer = await executor.execute({
            xml: `<foo n="${i}">hi</foo>`,
            xsltPath: path.resolve(__dirname, 'wrap.xsl'),
          });
          console.log(
            `${Math.round(performance.now() - start)} ms: `,
            buffer.toString()
          );
        }
      }
    );
    console.log(
      `Total time: ${Math.round(performance.now() - overallStart)} ms\n\n`
    );
  })();

  console.log(`\
## executor.execute() in series, with two executor instances - OK

The default keep-alive timeout means that the JVM doesn't close after the first
executor closes, allowing the second to use the same JVM.
`);
  await (async () => {
    const overallStart = performance.now();
    for (let executorID = 0; executorID < 2; ++executorID) {
      await using(
        XSLTExecutor.getInstance({
          jvmProcessID: 'executor.execute() in series with multiple executors',
        }),
        async executor => {
          for (let i = 0; i < 5; ++i) {
            const start = performance.now();
            const buffer = await executor.execute({
              xml: `<foo n="${i}">hi</foo>`,
              xsltPath: path.resolve(__dirname, 'wrap.xsl'),
            });
            console.log(
              `${Math.round(performance.now() - start)} ms: `,
              buffer.toString()
            );
          }
        }
      );
    }
    console.log(
      `Total time: ${Math.round(performance.now() - overallStart)} ms\n\n`
    );
  })();

  console.log(`\
## execute() in parallel - OK

Each call re-uses the same nailgun server. They all take about the same amount
of time, as they all must wait for the XSLT to be compiled before execution.
However compilation happens once, and they wait in parallel, so overall the time
taken is slightly less than running in series.
`);
  await (async () => {
    const overallStart = performance.now();
    const executions = Array(10)
      .fill(null)
      .map(async (val, i) => {
        const start = performance.now();
        const buffer = await execute({
          xml: `<foo n="${i}">hi</foo>`,
          xsltPath: path.resolve(__dirname, 'wrap.xsl'),
          jvmProcessID: 'execute() in parallel',
          jvmKeepaliveTimeout: 0,
        });
        return {buffer, elapsed: performance.now() - start};
      });
    (await Promise.all(executions)).forEach(({buffer, elapsed}) => {
      console.log(`${Math.round(elapsed)} ms: ${buffer.toString()}`);
    });

    console.log(
      `Total time: ${Math.round(performance.now() - overallStart)} ms\n\n`
    );
  })();

  console.log(`\
## execute() in parallel without keep-alive - OK

Each call re-uses the same nailgun server. They all take about the same amount
of time, as they all must wait for the XSLT to be compiled before execution.
However compilation happens once, and they wait in parallel, so overall the time
taken is slightly less than running in series.
`);
  await (async () => {
    const overallStart = performance.now();
    const executions = Array(10)
      .fill(null)
      .map(async (val, i) => {
        const start = performance.now();
        const buffer = await execute({
          xml: `<foo n="${i}">hi</foo>`,
          xsltPath: path.resolve(__dirname, 'wrap.xsl'),
          jvmProcessID: 'execute() in parallel without keep-alive',
          jvmKeepaliveTimeout: 0,
        });
        return {buffer, elapsed: performance.now() - start};
      });
    (await Promise.all(executions)).forEach(({buffer, elapsed}) => {
      console.log(`${Math.round(elapsed)} ms: ${buffer.toString()}`);
    });

    console.log(
      `Total time: ${Math.round(performance.now() - overallStart)} ms\n\n`
    );
  })();

  console.log(`\
## execute() in series - OK 
   (so long as the time between calls is under the keep-alive timeout)

This happens because the top-level execute() function uses reference counting to
only keep a nailgun server running as long as there are execute() calls being
evaluated. Each execute() call finishes before the next is started, so the
server is shutdown in between each call. To avoid this, make all execute() calls
in parallel, or maintain a reference to an executor, as in the two examples
above.
`);
  await (async () => {
    const overallStart = performance.now();
    for (let i = 0; i < 5; ++i) {
      const start = performance.now();
      const buffer = await execute({
        xml: `<foo n="${i}">hi</foo>`,
        xsltPath: path.resolve(__dirname, 'wrap.xsl'),
        jvmProcessID: 'execute() in series',
      });
      console.log(
        `${Math.round(performance.now() - start)} ms: `,
        buffer.toString()
      );
    }
    console.log(
      `Total time: ${Math.round(performance.now() - overallStart)} ms\n\n`
    );
  })();

  console.log(`\
## execute() in series WITHOUT keep-alive - Don't do this - JVM re-created on each iteration

This happens because the top-level execute() function uses reference counting to
only keep a nailgun server running as long as there are execute() calls being
evaluated. Each execute() call finishes before the next is started, so the
server is shutdown in between each call. To avoid this, don't disable
keep-alive, or make all execute() calls in parallel, or maintain a reference to
an executor, as in the two examples above.
`);
  await (async () => {
    const overallStart = performance.now();
    for (let i = 0; i < 5; ++i) {
      const start = performance.now();
      const buffer = await execute({
        xml: `<foo n="${i}">hi</foo>`,
        xsltPath: path.resolve(__dirname, 'wrap.xsl'),
        jvmProcessID: 'execute() in series without keep-alive',
        jvmKeepaliveTimeout: 0,
      });
      console.log(
        `${Math.round(performance.now() - start)} ms: `,
        buffer.toString()
      );
    }
    console.log(
      `Total time: ${Math.round(performance.now() - overallStart)} ms\n\n`
    );
  })();

  console.log(`\
## executor.execute() in series, with two executor instances but WITHOUT keep-alive - AVOID

Closing the first executor shuts down the JVM if keep-alive is disabled, so the
second executor has to start a new JVM.
`);
  await (async () => {
    const overallStart = performance.now();
    for (let executorID = 0; executorID < 2; ++executorID) {
      await using(
        XSLTExecutor.getInstance({
          jvmProcessID:
            'executor.execute() in series with multiple executors, without keep-alive',
          jvmKeepAliveTimeout: 0,
        }),
        async executor => {
          for (let i = 0; i < 5; ++i) {
            const start = performance.now();
            const buffer = await executor.execute({
              xml: `<foo n="${i}">hi</foo>`,
              xsltPath: path.resolve(__dirname, 'wrap.xsl'),
            });
            console.log(
              `${Math.round(performance.now() - start)} ms: `,
              buffer.toString()
            );
          }
        }
      );
    }
    console.log(
      `Total time: ${Math.round(performance.now() - overallStart)} ms`
    );
  })();
}
main().catch(e => {
  console.error('Failed to execute transform: ' + e);
  process.exit(1);
});
