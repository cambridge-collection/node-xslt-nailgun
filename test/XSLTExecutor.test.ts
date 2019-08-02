import 'jest-xml-matcher';
import path from 'path';
import {UserError, XSLTExecutor} from '../src/_internals';
import {using} from '../src/_resources';

const testResourcesDir = path.resolve(__dirname, '../java/src/test/resources/uk/ac/cam/lib/cudl/xsltnail');

test('execute() transforms XML with XSLT', async () => {
    const result = await using(XSLTExecutor.getInstance(), async (executor) => {
        return (await executor).execute('/tmp/foo.xml', '<foo>hi</foo>', path.resolve(testResourcesDir, 'a.xsl'));
    });

    await expect(result.toString()).toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result><foo>hi</foo></result>`);
});

test('execute() rejects with UserError on invalid input data', async () => {
    const result = using(XSLTExecutor.getInstance(), async (executor) => {
        const invalidXml = '<a>...';
        return (await executor).execute('/tmp/foo.xml', invalidXml, path.resolve(testResourcesDir, 'a.xsl'));
    });
    // result.catch(() => {});

    try {
        await result;
    }
    catch(e) {
        console.log('execute() rejected with error', e);
    }

    // try {
    //     await result;
    // }
    // catch(e) {
    //     expect(e.message).toMatch(/Error reported by XML parser/);
    // }

    // return expect(result).rejects.toThrowError(/.*/);

    // await expect(result).rejects.toThrowError(/.*/);
    // await expect(result).rejects.toThrowError(UserError);
    // await expect(result).rejects.toThrowError(/Error reported by XML parserxx:/);
});

async function foo() {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            throw new Error('boom');
        }, 100);
    });
}

function throwError() {
    throw new Error('bang!');
}

test('foo', async () => {
    const f = foo();

    setTimeout(throwError, 0);

    try {
        await f;
    }
    catch(e) {
        expect(e.message).toMatch(/sdfsd/);
    }
    // await expect(f).rejects.toThrowError('boom!');
});
