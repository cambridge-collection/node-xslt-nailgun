import {ChildProcess} from 'child_process';
import glob from 'glob';
import {tmpName} from 'tmp-promise';
import {using} from '../src';
import {
    AddressType,
    getClasspath,
    IPServerAddress,
    JVMProcess,
    JVMProcessOptions,
    LocalServerAddress,
} from '../src/_internals';

beforeAll(() => {
    // Fail if the .jar is not built
    expect(glob.sync(getClasspath()).length).toBe(12);
});

// https://github.com/facebook/jest/issues/8906
test('dummy test to work around jest issue #8906', () => undefined);

test.each<[Partial<JVMProcessOptions>, string]>([
    [{jvmExecutable: '/does/not/exist'}, 'xslt-nailgun server process failed to start: stderr:'],
    [{classpath: '/does/not/exist'},
     'xslt-nailgun server process failed to start: process unexpectedly terminated with { code: 1 }'],
    [{listenAddress: '/dev/null'},
     'xslt-nailgun server process failed to start: process unexpectedly terminated with { code: 1 }'],
])('[%#] JVMProcess serverStarted Promise rejects when process fails to start',
    async (options, reason) => {
    jest.setTimeout(1000 * 60 * 60);
    expect.assertions(1);

    const path = await tmpName();

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

    const path = await tmpName();

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

test('child process streams are no longer open after startup', async () => {
    await using(JVMProcess.listeningOnRandomPort({
        jvmExecutable: 'java',
        classpath: getClasspath(),
        startupTimeout: 2000,
    }), async proc => {
        await proc.serverStarted;

        const serverProcess = (proc as any).process as ChildProcess;
        expect(serverProcess.stdin).toBe(null);
        expect((serverProcess.stdout as any).destroyed).toBe(true);
        expect((serverProcess.stderr as any).destroyed).toBe(true);
    });
});

test('child process stderr stays open if debug is enabled', async () => {
    await using(JVMProcess.listeningOnRandomPort({
        jvmExecutable: 'java',
        classpath: getClasspath(),
        startupTimeout: 2000,
        debug: true,
    }), async proc => {
        await proc.serverStarted;

        const serverProcess = (proc as any).process as ChildProcess;
        expect((serverProcess.stderr as any).destroyed).toBe(false);
    });
});

test('child process is killed on process exit', async () => {
    expect.assertions(6);
    const processOn = jest.spyOn(process, 'on');

    await using(JVMProcess.listeningOnRandomPort({
        jvmExecutable: 'java',
        classpath: getClasspath(),
        startupTimeout: 2000,
    }), async proc => {
        const exitHandler = (proc as any).boundOnProcessExit as () => void;
        expect(typeof exitHandler).toBe('function');

        // process.on('exit' ...) is called with exitHandler
        expect(processOn.mock.calls.length).toBe(1);
        expect(processOn.mock.calls[0][0]).toBe('exit');
        expect(processOn.mock.calls[0][1]).toBe(exitHandler);

        // The child process is killed when exitHandler() is called
        const serverProcess = (proc as any).process as ChildProcess;
        expect(serverProcess.killed).toBeFalsy();
        exitHandler();
        expect(serverProcess.killed).toBeTruthy();
    });
});
