import 'jest-xml-matcher';
import path from 'path';
import * as os from 'os';
import {InternalError, UserError, using, XSLTExecutor} from '../src';
import {
  execute,
  ExecuteOptions,
  IPServerAddress,
  JVMProcess,
  timeout,
} from '../src/_internals';

import {
  aXslPath,
  paramsXslPath,
  baseURIXslPath,
  aXmlPath,
  aXmlURI,
  testResourcesDir,
  runTransform,
} from './XSLTExecutor_common';

function nextProcessID() {
  return `${__filename}-${nextProcessID.seq++}`;
}
nextProcessID.seq = 0;

function assignReadonlyProperty<
  T extends object,
  K extends keyof T,
  V extends T[K]
>(obj: T, key: K, value: V): void {
  type WriteableT = {[P in keyof T]: V};
  const writableObj: WriteableT = obj as WriteableT;
  writableObj[key] = value;
}

test.each<[string, ExecuteOptions]>([
  ['from string value', {xml: '<a/>', xsltPath: aXslPath}],
  ['from Buffer value', {xml: Buffer.from('<a/>'), xsltPath: aXslPath}],
  ['from file via path', {xmlPath: aXmlPath, xsltPath: aXslPath}],
  [
    'from file via system identifier',
    {systemIdentifier: aXmlURI, xsltPath: aXslPath},
  ],
])(
  'execute() transforms XML %s with XSLT',
  async (desc: string, options: ExecuteOptions) => {
    const result = await using(XSLTExecutor.getInstance(), async executor => {
      return executor.execute(options);
    });

    await expect(result.toString()).toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result><a/></result>`);
  }
);

test.each<[ExecuteOptions, string]>([
  [{xml: '<a/>', xsltPath: baseURIXslPath}, ''],
  [
    {xml: '<a/>', systemIdentifier: 'foo:///bar', xsltPath: baseURIXslPath},
    'foo:///bar',
  ],
  [{xmlPath: aXmlPath, xsltPath: baseURIXslPath}, aXmlURI],
  [
    {
      xmlPath: aXmlPath,
      systemIdentifier: 'foo:///bar',
      xsltPath: baseURIXslPath,
    },
    'foo:///bar',
  ],
  [{systemIdentifier: aXmlURI, xsltPath: baseURIXslPath}, aXmlURI],
])(
  'execute() with options: %j uses base URI: %s',
  async (options, expectedBase) => {
    const result = await using(XSLTExecutor.getInstance(), async executor => {
      return executor.execute(options);
    });

    await expect(result.toString()).toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result base-uri-of-input="${expectedBase}"><a/></result>`);
  }
);

test.each<[ExecuteOptions, string]>([
  [
    {xml: '<a/>', xsltPath: aXslPath, parameters: {thing: []}},
    '<result><a/></result>',
  ],
  [
    {xml: '<a/>', xsltPath: aXslPath, parameters: {thing: 'foo'}},
    '<result thing="foo"><a/></result>',
  ],
  [
    {xml: '<a/>', xsltPath: aXslPath, parameters: {thing: ['foo']}},
    '<result thing="foo"><a/></result>',
  ],
  [
    {xml: '<a/>', xsltPath: aXslPath, parameters: {thing: ['foo', 'bar']}},
    '<result thing="foo bar"><a/></result>',
  ],
  [
    {
      xml: '<a/>',
      xsltPath: paramsXslPath,
      parameters: {
        'untyped-param': 'foo',
        'default-param2': 'non-default value',
        'numeric-param': '42',
        'date-param': '2019-12-25',
        'multi-string-param': ['ab', 'cd', 'ef'],
        '{http://example.com/myparam}namespaced-param': 'bar',
      },
    },
    `\
<result>
    <param name="untyped-param" value="foo"/>
    <param name="default-param1" value="default value"/>
    <param name="default-param2" value="non-default value"/>
    <param name="numeric-param" value="42 * 2 = 84"/>
    <param name="date-param" year="2019" value="2019-12-25"/>
    <param name="multi-string-param" count="3" value="ab, cd, ef"/>
    <param name="myparam:namespaced-param" value="bar"/>
</result>`,
  ],
])(
  'execute() provides parameters to XSLT',
  async (options: ExecuteOptions, expected: string) => {
    const result = await using(XSLTExecutor.getInstance(), async executor => {
      return executor.execute(options);
    });

    await expect(result.toString()).toEqualXML(
      `<?xml version="1.0" encoding="UTF-8"?>${expected}`
    );
  }
);

test('execute() transforms XML with XSLT (without async)', () => {
  const result = using(XSLTExecutor.getInstance(), executor => {
    return executor
      .execute({xml: '<foo>hi</foo>', xsltPath: aXslPath})
      .then(buffer => buffer.toString());
  });

  return expect(result).resolves.toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result><foo>hi</foo></result>`);
});

test('execute() rejects with UserError on invalid input data', async () => {
  const result = using(XSLTExecutor.getInstance(), async executor => {
    const invalidXml = '<a>...';
    return executor.execute({xml: invalidXml, xsltPath: aXslPath});
  });

  await expect(result).rejects.toThrow(UserError);
  await expect(result).rejects.toThrow(
    /^XSLT evaluation produced an error: Failed to execute transform: /
  );
  await expect(result).rejects.toThrow(/Error reported by XML parser:/);
});

test('execute() rejects with UserError on syntactically invalid XSLT', async () => {
  const result = using(XSLTExecutor.getInstance(), async executor => {
    return executor.execute({
      xml: '<a/>',
      xsltPath: path.resolve(testResourcesDir, 'invalid-syntax.xsl'),
    });
  });

  await expect(result).rejects.toThrow(UserError);
  await expect(result).rejects.toThrow(
    new RegExp(
      '\
^XSLT evaluation produced an error: Failed to compile XSLT: Error on line \\d+ column \\d+ of invalid-syntax.xsl:'
    )
  );
});

test('execute() rejects with UserError when execution of XSLT raises an error', async () => {
  const result = using(XSLTExecutor.getInstance(), async executor => {
    return executor.execute({
      xml: '<a/>',
      xsltPath: path.resolve(testResourcesDir, 'invalid-logic.xsl'),
    });
  });

  await expect(result).rejects.toThrow(UserError);
  await expect(result).rejects.toThrow(
    'XSLT evaluation produced an error: Failed to execute transform: Error at char 0 in expression in ' +
      'xsl:value-of/@select on line 5 column 49 of invalid-logic.xsl:'
  );
  await expect(result).rejects.toThrow(/FOAR0001 +Integer division by zero/);
});

test('execute() cannot be invoked after executor is closed', async () => {
  const executor = XSLTExecutor.getInstance({jvmProcessID: nextProcessID()});
  await executor.close();
  const result = executor.execute({xml: '<a/>', xsltPath: aXslPath});

  await expect(result).rejects.toThrow(
    new Error('execute() called following close()')
  );
});

test('execute() rejects with InternalError when unable to connect to the nailgun server', async () => {
  const result = using(
    XSLTExecutor.getInstance({jvmProcessID: nextProcessID()}),
    async executor => {
      const serverProcess: JVMProcess = await executor['serverProcessRef']
        .resource;

      // Report the server's listen address incorrectly so that connecting fails
      assignReadonlyProperty(
        serverProcess,
        'serverStarted',
        serverProcess.serverStarted.then(
          () => new IPServerAddress('127.0.0.1', 1)
        )
      );

      return executor.execute({xml: '<a/>', xsltPath: aXslPath});
    }
  );

  await expect(result).rejects.toThrow(InternalError);
  await expect(result).rejects.toThrow(
    'Error communicating with xslt-nailgun server'
  );
});

test("execute() rejects with InternalError when the nailgun server doesn't start within the timeout", async () => {
  const result = using(
    XSLTExecutor.getInstance({
      jvmProcessID: nextProcessID(),
      jvmStartupTimeout: 1,
    }),
    async executor => {
      return executor.execute({xml: '<a/>', xsltPath: aXslPath});
    }
  );

  await expect(result).rejects.toThrow(InternalError);
  await expect(result).rejects.toThrow(
    "xslt-nailgun server process failed to start: 1ms startup timeout expired; stderr: ''"
  );
});

test('execute() rejects with InternalError when nailgun server closes before execution is complete', async () => {
  const result = using(
    XSLTExecutor.getInstance({jvmProcessID: nextProcessID()}),
    async executor => {
      const serverProcess: JVMProcess = await executor['serverProcessRef']
        .resource;
      await serverProcess.serverStarted;
      const _result = executor.execute({
        xml: '<a/>',
        xsltPath: path.resolve(testResourcesDir, 'infinite-loop.xsl'),
      });
      _result.catch(() => undefined); // prevent an UnhandledPromiseRejectionWarning - we handle errors later...

      await timeout(100);
      await serverProcess.close();
      return _result;
    }
  );

  await expect(result).rejects.toThrow(InternalError);
  const msg1 = 'Error communicating with xslt-nailgun server';
  const msg2 = `\
XSLT nail failed to execute transform due to an internal error: \
XSLT execution failed with an internal error, this is most likely a bug:
uk.ac.cam.lib.cudl.xsltnail.InternalXSLTNailException: \
Failed to execute transform: java.lang.InterruptedException`;
  await expect(result).rejects.toThrow(new RegExp(`${msg1}|${msg2}`));
});

test('concurrent execute()', async () => {
  // FIXME: for some reason, on OSX the server prematurely closes connections
  // if 100 are opened concurrently. Smaller numbers are OK. It's not
  // deterministic, it seems to depend on system load. I'm not planning to spend
  // time investigating this as I'd rather invest the time in replacing the
  // Nailgun server with gRPC.
  const count = os.platform() === 'darwin' ? 50 : 100;

  const executions = new Array(count).fill(null).map(async (val, i) => {
    const buffer = await execute({
      xml: `<foo n="${i}">hi</foo>`,
      xsltPath: aXslPath,
    });
    return buffer.toString();
  });
  const results = await Promise.all(executions);

  for (let i = 0; i < count; ++i) {
    expect(results[i]).toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result><foo n="${i}">hi</foo></result>`);
  }
  expect.assertions(count);
});

test("executor doesn't use keep-alive when timeout is 0", async () => {
  const keepAlive = 0;

  const pid1 = await runTransform(keepAlive);
  const pid2 = await runTransform(keepAlive);

  expect(pid1).not.toBe(pid2);
});
