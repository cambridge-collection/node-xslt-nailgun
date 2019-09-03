import 'jest-xml-matcher';
import path from 'path';
import {InternalError, UserError, using, XSLTExecutor} from '../src';
import {execute, IPServerAddress, JVMProcess, timeout} from '../src/_internals';

const testResourcesDir = path.resolve(__dirname, '../java/src/test/resources/uk/ac/cam/lib/cudl/xsltnail');

test('execute() transforms XML with XSLT', async () => {
    const result = await using(XSLTExecutor.getInstance(), async (executor) => {
        return executor.execute('/tmp/foo.xml', '<foo>hi</foo>', path.resolve(testResourcesDir, 'a.xsl'));
    });

    await expect(result.toString()).toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result><foo>hi</foo></result>`);
});

test('execute() transforms XML with XSLT (without async)', () => {
    const result = using(XSLTExecutor.getInstance(), (executor) => {
        return executor.execute('/tmp/foo.xml', '<foo>hi</foo>', path.resolve(testResourcesDir, 'a.xsl'))
            .then(buffer => buffer.toString());
    });

    return expect(result).resolves.toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result><foo>hi</foo></result>`);
});

test('execute() rejects with UserError on invalid input data', async () => {
    const result = using(XSLTExecutor.getInstance(), async (executor) => {
        const invalidXml = '<a>...';
        return  executor.execute('/tmp/foo.xml', invalidXml, path.resolve(testResourcesDir, 'a.xsl'));
    });

    await expect(result).rejects.toThrow(UserError);
    await expect(result).rejects.toThrow(/^XSLT evaluation produced an error: Failed to execute transform: /);
    await expect(result).rejects.toThrow(/Error reported by XML parser:/);
});

test('execute() rejects with UserError on syntactically invalid XSLT', async () => {
    const result = using(XSLTExecutor.getInstance(), async (executor) => {
        return  executor.execute('/tmp/foo.xml', '<a/>', path.resolve(testResourcesDir, 'invalid-syntax.xsl'));
    });

    await expect(result).rejects.toThrow(UserError);
    await expect(result).rejects.toThrow(new RegExp(`\
^XSLT evaluation produced an error: Failed to compile XSLT: Error on line \\d+ column \\d+ of invalid-syntax.xsl:`));
});

test('execute() rejects with UserError when execution of XSLT raises an error', async () => {
    const result = using(XSLTExecutor.getInstance(), async (executor) => {
        return  executor.execute('/tmp/foo.xml', '<a/>', path.resolve(testResourcesDir, 'invalid-logic.xsl'));
    });

    await expect(result).rejects.toThrow(UserError);
    await expect(result).rejects.toThrow(
        /^XSLT evaluation produced an error: Failed to execute transform: Error evaluating \(1 div 0\)/);
    await expect(result).rejects.toThrow(/FOAR0001: Integer division by zero/);
});

test('execute() cannot be invoked after executor is closed', async () => {
    const executor = XSLTExecutor.getInstance();
    await executor.close();
    const result = executor.execute('/tmp/foo.xml', '<a/>', path.resolve(testResourcesDir, 'a.xsl'));

    await expect(result).rejects.toThrow(new Error('execute() called following close()'));
});

test('execute() rejects with InternalError when unable to connect to the nailgun server', async () => {
    const result = using(XSLTExecutor.getInstance(), async executor => {
        const serverProcess: JVMProcess = await (executor as any).serverProcessRef.resource;

        // Report the server's listen address incorrectly so that connecting fails
        (serverProcess as any).serverStarted =
            serverProcess.serverStarted.then(() => new IPServerAddress('127.0.0.1', 1));

        return executor.execute('/tmp/foo.xml', '<a/>', path.resolve(testResourcesDir, 'a.xsl'));
    });

    await expect(result).rejects.toThrow(InternalError);
    await expect(result).rejects.toThrow('Error communicating with xslt-nailgun server');
});

test('execute() rejects with InternalError when nailgun server closes before execution is complete', async () => {
    const result = using(XSLTExecutor.getInstance(), async executor => {
        const serverProcess: JVMProcess = await (executor as any).serverProcessRef.resource;
        await serverProcess.serverStarted;
        const _result = executor.execute('/tmp/foo.xml', '<a/>', path.resolve(testResourcesDir, 'infinite-loop.xsl'));
        _result.catch(() => undefined); // prevent an UnhandledPromiseRejectionWarning - we handle errors later...

        await timeout(100);
        await serverProcess.close();
        return _result;
    });

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
    const count = 100;
    const executions = Array(count).fill(null).map(async (val, i) => {
        const buffer = await execute(
            'example:foo.xml', `<foo n="${i}">hi</foo>`, path.resolve(testResourcesDir, 'a.xsl'));
        return buffer.toString();
    });
    const results = await Promise.all(executions);

    for(let i = 0; i < count; ++i) {
        expect(results[i]).toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result><foo n="${i}">hi</foo></result>`);
    }
    expect.assertions(count);
});
