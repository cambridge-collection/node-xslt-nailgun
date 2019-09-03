import fs from 'fs';
import glob from 'glob';
import {file} from 'tmp-promise';
import util from 'util';
import {AddressType, getClasspath, JVMProcess} from '../src/_internals';

// Fail if the .jar is not built
expect(glob.sync(getClasspath()).length).toBe(12);

test.each([
    [{jvmExecutable: '/does/not/exist'}, 'xslt-nailgun server process failed to start: stderr:'],
    [{classpath: '/does/not/exist'},
     'xslt-nailgun server process failed to start: process unexpectedly terminated with { code: 1 }'],
    [{listenAddress: '/dev/null'},
     'xslt-nailgun server process failed to start: process unexpectedly terminated with { code: 1 }'],
])('JVMProcess serverStarted Promise rejects if process fails to start', async (options: any, reason: any) => {
    const {path} = await file();
    await util.promisify(fs.unlink)(path);

    const jvmProcess = new JVMProcess({
        addressType: AddressType.local,
        listenAddress: path,
        classpath: getClasspath(),
        jvmExecutable: 'java',
        ...options,
    });

    await expect(jvmProcess.serverStarted).rejects.toThrow(reason);
});

test('JVMProcess serverStarted Promise resolves when server has started', async () => {
    const {path} = await file();
    await util.promisify(fs.unlink)(path);

    const jvmProcess = new JVMProcess({
        addressType: AddressType.local,
        listenAddress: path,
        classpath: getClasspath(),
        jvmExecutable: 'java',
        startupTimeout: 2000,
    });

    // resolves with no value when started
    await expect(jvmProcess.serverStarted).resolves.toBeUndefined();

    await jvmProcess.close();
    await expect(jvmProcess.processExit).resolves.toEqual({code: 143});
});

test('listeningOnRandomPort() creates server on automatically-chosen port', async () => {
    const proc = await JVMProcess.listeningOnRandomPort({
        jvmExecutable: 'java',
        classpath: getClasspath(),
        startupTimeout: 2000,
    });
    const address = await proc.serverStarted;
    if(address.addressType !== AddressType.network || proc.address.addressType !== AddressType.network)
        throw new Error('expected a network address');

    expect(proc.address.host).toEqual('127.0.0.1');
    expect(proc.address.port).toEqual(0);
    expect(address.host).toEqual('127.0.0.1');
    expect(address.port).toBeGreaterThan(0);
    await proc.close();
});
