import fs from 'fs';
import glob from 'glob';
import {file} from 'tmp-promise';
import util from 'util';
import {using} from '../src';
import {AddressType, getClasspath, IPServerAddress, JVMProcess, LocalServerAddress} from '../src/_internals';

beforeAll(() => {
    // Fail if the .jar is not built
    expect(glob.sync(getClasspath()).length).toBe(12);
});

// https://github.com/facebook/jest/issues/8906
test('dummy test to work around jest issue #8906', () => undefined);

test.each([
    [{jvmExecutable: '/does/not/exist'}, 'xslt-nailgun server process failed to start: stderr:'],
    [{classpath: '/does/not/exist'},
     'xslt-nailgun server process failed to start: process unexpectedly terminated with { code: 1 }'],
    [{listenAddress: '/dev/null'},
     'xslt-nailgun server process failed to start: process unexpectedly terminated with { code: 1 }'],
])('[%#] JVMProcess serverStarted Promise rejects when process fails to start',
    async (options: any, reason: any) => {
    jest.setTimeout(1000 * 60 * 60);
    expect.assertions(1);

    const {path} = await file();
    await util.promisify(fs.unlink)(path);

    await using(new JVMProcess({
        addressType: AddressType.local,
        listenAddress: path,
        classpath: getClasspath(),
        jvmExecutable: 'java',
        ...options,
    }), async jvmProcess => {
        await expect(jvmProcess.serverStarted).rejects.toThrow(reason);
    });
});

test('JVMProcess serverStarted Promise resolves when server has started', async () => {
    expect.assertions(2);

    const {path} = await file();
    await util.promisify(fs.unlink)(path);

    await using(new JVMProcess({
        addressType: AddressType.local,
        listenAddress: path,
        classpath: getClasspath(),
        jvmExecutable: 'java',
        startupTimeout: 2000,
    }), async jvmProcess => {
        // resolves with listening address when started
        await expect(jvmProcess.serverStarted).resolves.toEqual(new LocalServerAddress(path));

        await jvmProcess.close();
        await expect(jvmProcess.processExit).resolves.toEqual({code: 143});
    });
});

test('listeningOnRandomPort() creates server on automatically-chosen port', async () => {
    expect.assertions(3);

    await using(JVMProcess.listeningOnRandomPort({
        jvmExecutable: 'java',
        classpath: getClasspath(),
        startupTimeout: 2000,
    }), async proc => {
        const address = await proc.serverStarted;
        if(address.addressType !== AddressType.network || proc.address.addressType !== AddressType.network)
            throw new Error('expected a network address');

        expect(proc.address).toEqual(new IPServerAddress('127.0.0.1', 0));
        expect(address.host).toEqual('127.0.0.1');
        expect(address.port).toBeGreaterThan(0);
    });
});
