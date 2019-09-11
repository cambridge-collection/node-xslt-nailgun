import 'jest-xml-matcher';
import path from 'path';
import {URL} from 'url';
import {InternalError, UserError, using, XSLTExecutor} from '../src';
import {execute, ExecuteOptions, IPServerAddress, JVMProcess, timeout} from '../src/_internals';

const testResourcesDir = path.resolve(__dirname, '../java/src/test/resources/uk/ac/cam/lib/cudl/xsltnail');
const aXslPath = path.resolve(testResourcesDir, 'a.xsl');
const baseURIXslPath = path.resolve(testResourcesDir, 'base-uri.xsl');
const aXmlPath = path.resolve(testResourcesDir, 'a.xml');
const aXmlURI = new URL(aXmlPath, 'file://').toString();

test.each<[string, ExecuteOptions]>([
    ['from string value', {xml: '<a/>', xsltPath: aXslPath}],
    ['from Buffer value', {xml: Buffer.from('<a/>'), xsltPath: aXslPath}],
    ['from file via path', {xmlPath: aXmlPath, xsltPath: aXslPath}],
    ['from file via system identifier', {systemIdentifier: aXmlURI, xsltPath: aXslPath}],
])
('execute() transforms XML %s with XSLT', async (desc: string, options: ExecuteOptions) => {
    const result = await using(XSLTExecutor.getInstance(), async (executor) => {
        return executor.execute(options);
    });

    await expect(result.toString()).toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result><a/></result>`);
});

test.each<[ExecuteOptions, string]>([
    [{xml: '<a/>', xsltPath: baseURIXslPath}, ''],
    [{xml: '<a/>', systemIdentifier: 'foo:///bar', xsltPath: baseURIXslPath}, 'foo:///bar'],
    [{xmlPath: aXmlPath, xsltPath: baseURIXslPath}, aXmlURI],
    [{xmlPath: aXmlPath, systemIdentifier: 'foo:///bar', xsltPath: baseURIXslPath}, 'foo:///bar'],
    [{systemIdentifier: aXmlURI, xsltPath: baseURIXslPath}, aXmlURI],

])('execute() with options: %j uses base URI: %s', async (options, expectedBase) => {
    const result = await using(XSLTExecutor.getInstance(), async (executor) => {
        return executor.execute(options);
    });

    await expect(result.toString()).toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result base-uri-of-input="${expectedBase}"><a/></result>`);
});

test('execute() transforms XML with XSLT (without async)', () => {
    const result = using(XSLTExecutor.getInstance(), (executor) => {
        return executor.execute({xml: '<foo>hi</foo>', xsltPath: aXslPath})
            .then(buffer => buffer.toString());
    });

    return expect(result).resolves.toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result><foo>hi</foo></result>`);
});

test('execute() rejects with UserError on invalid input data', async () => {
    const result = using(XSLTExecutor.getInstance(), async (executor) => {
        const invalidXml = '<a>...';
        return  executor.execute({xml: invalidXml, xsltPath: aXslPath});
    });

    await expect(result).rejects.toThrow(UserError);
    await expect(result).rejects.toThrow(/^XSLT evaluation produced an error: Failed to execute transform: /);
    await expect(result).rejects.toThrow(/Error reported by XML parser:/);
});

test('execute() rejects with UserError on syntactically invalid XSLT', async () => {
    const result = using(XSLTExecutor.getInstance(), async (executor) => {
        return  executor.execute({xml: '<a/>', xsltPath: path.resolve(testResourcesDir, 'invalid-syntax.xsl')});
    });

    await expect(result).rejects.toThrow(UserError);
    await expect(result).rejects.toThrow(new RegExp(`\
^XSLT evaluation produced an error: Failed to compile XSLT: Error on line \\d+ column \\d+ of invalid-syntax.xsl:`));
});

test('execute() rejects with UserError when execution of XSLT raises an error', async () => {
    const result = using(XSLTExecutor.getInstance(), async (executor) => {
        return  executor.execute({xml: '<a/>', xsltPath: path.resolve(testResourcesDir, 'invalid-logic.xsl')});
    });

    await expect(result).rejects.toThrow(UserError);
    await expect(result).rejects.toThrow(
        /^XSLT evaluation produced an error: Failed to execute transform: Error evaluating \(1 div 0\)/);
    await expect(result).rejects.toThrow(/FOAR0001: Integer division by zero/);
});

test('execute() cannot be invoked after executor is closed', async () => {
    const executor = XSLTExecutor.getInstance({unique: true});
    await executor.close();
    const result = executor.execute({xml: '<a/>', xsltPath: aXslPath});

    await expect(result).rejects.toThrow(new Error('execute() called following close()'));
});

test('execute() rejects with InternalError when unable to connect to the nailgun server', async () => {
    const result = using(XSLTExecutor.getInstance({unique: true}), async executor => {
        const serverProcess: JVMProcess = await (executor as any).serverProcessRef.resource;

        // Report the server's listen address incorrectly so that connecting fails
        (serverProcess as any).serverStarted =
            serverProcess.serverStarted.then(() => new IPServerAddress('127.0.0.1', 1));

        return executor.execute({xml: '<a/>', xsltPath: aXslPath});
    });

    await expect(result).rejects.toThrow(InternalError);
    await expect(result).rejects.toThrow('Error communicating with xslt-nailgun server');
});

test('execute() rejects with InternalError when nailgun server closes before execution is complete', async () => {
    const result = using(XSLTExecutor.getInstance({unique: true}), async executor => {
        const serverProcess: JVMProcess = await (executor as any).serverProcessRef.resource;
        await serverProcess.serverStarted;
        const _result = executor.execute({xml: '<a/>', xsltPath: path.resolve(testResourcesDir, 'infinite-loop.xsl')});
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
            {xml: `<foo n="${i}">hi</foo>`, xsltPath: aXslPath});
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
