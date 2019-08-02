import fs from 'fs';
import getPort from 'get-port';
import glob from 'glob';
import {Server} from 'net';
import {file} from 'tmp-promise';
import util from 'util';
import {AddressType, getClasspath, JVMProcess} from '../src/_internals';
import {using} from '../src/_resources';

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
    await proc.serverStarted;
    const address = proc.address;
    if(address.addressType !== AddressType.network)
        throw new Error('expected a network address');

    expect(address.host).toEqual('127.0.0.1');
    expect(address.port).toBeGreaterThan(0);
    await proc.close();
});

function aquirePort(): Promise<{port: number, close(): void}> {
    return new Promise((resolve, reject) => {
        const server = new Server();
        server.on('error', reject);
        getPort({host: '127.0.0.1'}).then(port => {
            server.listen(port, () => {
                resolve({port, close: server.close.bind(server)});
            });
        });
    });
}

test('listeningOnRandomPort() retries 3 times', async () => {
    // Tie up 3 ports, and have the server try to use them
    const ports = await Promise.all([aquirePort(), aquirePort(), aquirePort()]);

    const _getPort = jest.fn()
        .mockResolvedValueOnce(ports[0].port)
        .mockResolvedValueOnce(ports[1].port)
        .mockResolvedValueOnce(ports[2].port);

    await using(JVMProcess.listeningOnRandomPort({
        jvmExecutable: 'java',
        classpath: getClasspath(),
        startupTimeout: 2000,
        getPort: _getPort,
    }), async (proc) => {
        await expect((await proc).serverStarted).rejects.toThrow('Address already in use');
        expect(_getPort.mock.calls.length).toBe(3);
    });

    for(const p of ports)
        p.close();
});

test('listeningOnRandomPort() succeeds after a failed listen attempt', async () => {
    // Tie up 2 ports, the 3rd will be used
    const ports = await Promise.all([aquirePort(), aquirePort()]);
    const freePort = getPort({host: '127.0.0.1'});

    const _getPort = jest.fn()
        .mockResolvedValueOnce(ports[0].port)
        .mockResolvedValueOnce(ports[1].port)
        .mockResolvedValueOnce(freePort);

    await using(JVMProcess.listeningOnRandomPort({
        jvmExecutable: 'java',
        classpath: getClasspath(),
        startupTimeout: 2000,
        getPort: _getPort,
    }), async (proc) => {
        await expect((await proc).serverStarted).resolves.toBeUndefined();
        expect((await proc).address.listenAddress).toBe(`127.0.0.1:${freePort}`);
        expect(_getPort.mock.calls.length).toBe(3);
    });

    for(const p of ports)
        p.close();
});
