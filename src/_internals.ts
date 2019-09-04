import assert from 'assert';
import BufferList from 'bl';
import {ChildProcess, spawn} from 'child_process';
import DevNull from 'dev-null';
import getPort from 'get-port';
import jsonStableStringify from 'json-stable-stringify';
import promiseFinally from 'p-finally';
import path from 'path';
import readline from 'readline';
import RingBuffer from 'ringbufferjs';
import {Readable} from 'stream';
import TraceError from 'trace-error';
import * as util from 'util';
import {Closable, using} from './_resources';
import jvmpin from './vendor/jvmpin/lib/jvmpin';
import Timeout = NodeJS.Timeout;

export class XSLTNailgunError extends TraceError {}
export class UserError extends XSLTNailgunError {
    public readonly xml: string | Buffer;
    public readonly xsltPath: string;
    public readonly xmlBaseURI: string;

    constructor(message: string, xml: string | Buffer, xmlBaseURI: string, xsltPath: string) {
        super(message);
        this.xml = xml;
        this.xmlBaseURI = xmlBaseURI;
        this.xsltPath = xsltPath;
    }
}
export class InternalError extends XSLTNailgunError {}

export function getClasspath() {
    const packageJsonPath = '../package.json';
    const metadata = require(packageJsonPath);
    if(!(typeof metadata['uk.ac.cam.lib.cudl.xslt-nailgun'] === 'object' &&
        typeof metadata['uk.ac.cam.lib.cudl.xslt-nailgun'].serverJarsPath === 'string')) {
        throw new Error('xslt-nailgun package.json does not contain required metadata');
    }
    const localPath = metadata['uk.ac.cam.lib.cudl.xslt-nailgun'].serverJarsPath;
    return path.resolve(require.resolve(packageJsonPath), '..', localPath, '*');
}

export enum AddressType { local = 'local', network = 'network' }

export interface CreateOptions {
    jvmExecutable?: string;
    /**
     * If true, the returned executor always uses a newly spawned nailgun
     * server process, rather than sharing with other concurrently-active
     * executors.
     */
    unique?: boolean;
}
type StrictCreateOptions = Required<CreateOptions>;

interface ServerAddress {
    addressType: AddressType;
    listenAddress: string;
}

function parseServerAddress(address: ServerAddress) {
    if(address.addressType === AddressType.local)
        return new LocalServerAddress(address.listenAddress);
    return IPServerAddress.fromListenAddress(address.listenAddress);
}

export class LocalServerAddress {
    public readonly addressType: AddressType.local = AddressType.local;
    public readonly listenAddress: string;

    constructor(listenAddress: string) {
        this.listenAddress = listenAddress;
    }
}

export class IPServerAddress {
    public static fromListenAddress(listenAddress: string) {
        const [host, portString] = listenAddress.split(':', 2);
        const port = parseInt(portString, 10);

        if(isNaN(port))
            throw new Error(`Invalid listenAddress: ${listenAddress}`);
        return new IPServerAddress(host, port);
    }

    public readonly addressType: AddressType.network = AddressType.network;
    public readonly host: string;
    public readonly port: number;

    constructor(host: string, port: number) {
        this.host = host;
        this.port = port;
    }

    get listenAddress(): string {
        return `${this.host}:${this.port}`;
    }
}

interface JVMProcessOptions extends Omit<Required<CreateOptions>, 'unique'>, ServerAddress {
    classpath: string;
    startupTimeout?: number;
}

function populateDefaults(options: CreateOptions): StrictCreateOptions {
    return {
        jvmExecutable: options.jvmExecutable || 'java',
        unique: options.unique === true,
    };
}

interface AutoCloserReference<T extends Closable> extends Closable {
    readonly resource: Promise<T>;
}

interface AutoCloser<T extends Closable> {
    isClosed(): boolean;
    ref(): AutoCloserReference<T>;
}

export class ReferenceCountAutoCloser<T extends Closable> implements AutoCloser<T> {
    public static createAndReference<T extends Closable>(
        resource: T | Promise<T>,
    ): {closer: ReferenceCountAutoCloser<T>, ref: AutoCloserReference<T>} {
        const closer = new ReferenceCountAutoCloser(Promise.resolve(resource));
        return {closer, ref: closer.ref()};
    }

    private readonly resourcePromise: Promise<T>;
    private _referenceCount: number | null;

    constructor(resourcePromise: Promise<T>) {
        this._referenceCount = null;
        this.resourcePromise = resourcePromise;
    }

    public get referenceCount() {
        return this._referenceCount;
    }

    public isClosed(): boolean {
        return this._referenceCount === 0;
    }

    public ref(): AutoCloserReference<T> {
        if(this._referenceCount === 0)
            throw new Error('useIn() called on closed CountedReference');
        if(this._referenceCount === null)
            this._referenceCount = 0;
        this._referenceCount += 1;

        let isClosed = false;
        const closer = this;
        return {
            resource: this.resourcePromise,
            async close(): Promise<void> {
                if(isClosed)
                    return;
                isClosed = true;
                await closer.dropReference();
            },
        };
    }

    private async dropReference(): Promise<void> {
        if(this._referenceCount === null || this._referenceCount < 1)
            throw new Error('dropReference() called without an active reference');
        this._referenceCount -= 1;
        if(this._referenceCount === 0) {
            await (await this.resourcePromise).close();
        }
    }
}

type ProcessExit = {code: number} | {signal: string};

type RandomPortJVMProcessOptions = Omit<JVMProcessOptions, 'addressType' | 'listenAddress'>;

export class JVMProcess implements Closable {
    public static async listeningOnRandomPort(options: RandomPortJVMProcessOptions): Promise<JVMProcess> {
        return new JVMProcess({...options, addressType: AddressType.network, listenAddress: '127.0.0.1:0'});
    }

    private static createExitObject(code: number | null, signal: string | null): ProcessExit {
        if(code !== null)
            return {code};
        else if(signal !== null)
            return {signal};
        else
            throw new Error('code and signal are null');
    }

    public readonly processExit: Promise<ProcessExit>;
    public readonly serverStarted: Promise<IPServerAddress | LocalServerAddress>;
    public readonly address: IPServerAddress | LocalServerAddress;

    private options: JVMProcessOptions;
    private process: ChildProcess;
    private readonly stderrLines: RingBuffer<string>;

    constructor(options: JVMProcessOptions) {
        const startupTimeout = options.startupTimeout === undefined ? 2000 : options.startupTimeout;
        this.options = {...options};
        this.address = parseServerAddress(options);
        this.stderrLines = new RingBuffer<string>(500);
        this.process = spawn(
            options.jvmExecutable,
            ['-cp', options.classpath, 'uk.ac.cam.lib.cudl.xsltnail.XSLTNailgunServer',
                '--address-type', this.options.addressType, this.options.listenAddress],
            {stdio: ['ignore', 'pipe', 'pipe']});

        this.processExit = new Promise<ProcessExit>((resolve, reject) => {
            this.process.on('exit', (code, signal) => {
                resolve(JVMProcess.createExitObject(code, signal));
            });
            this.process.on('error', error => {
                if(this.process.pid === undefined) {
                    reject(new InternalError('xslt-nailgun server process failed to start', error));
                }
                else {
                    reject(new InternalError("xslt-nailgun server process emitted 'error' before 'exit'", error));
                }
            });
        });

        if(this.process.stdout === null)
            throw new Error('ChildProcess has no stdout');
        const stdout: Readable = this.process.stdout;
        stdout.setEncoding('utf-8');

        this.serverStarted = new Promise((resolve, reject) => {
            let starting = true;
            const timeoutTimer = setTimeout(() => {
                if(!starting)
                    return;
                reject(promiseFinally(this.close(), () => {
                    throw new InternalError(`\
xslt-nailgun server process failed to start: ${startupTimeout}ms startup timeout expired; stderr:
${this.getCurrentStderr()}`);
                }));
            }, startupTimeout);

            const cancelStartupTimeout = () => {
                starting = false;
                clearTimeout(timeoutTimer);
            };

            const rl = readline.createInterface({input: stdout, crlfDelay: Infinity});
            rl.on('line', (line) => {
                if(!/^NGServer [\d.]+ started/.test(line)) { return; }

                // Port 0 means the server selects a port to listen on. We need to check the output to see which port
                // it's using.
                let address;
                if(this.address.addressType === AddressType.network && this.address.port === 0) {
                    const match = / port (\d+)\.$/.exec(line);
                    if(!match || match.length !== 2) {
                        reject(new Error(`Failed to parse port from NGServer startup message: ${line}`));
                        return;
                    }
                    address = new IPServerAddress(this.address.host, parseInt(match[1], 10));
                }
                else {
                    address = this.address;
                }

                rl.removeAllListeners('line');
                rl.close();
                stdout.pipe(new DevNull());
                cancelStartupTimeout();
                resolve(address);
            });

            this.process.on('exit', (code, signal) => {
                const exit = JVMProcess.createExitObject(code, signal);
                cancelStartupTimeout();
                reject(new InternalError(`\
xslt-nailgun server process failed to start: process unexpectedly terminated with ${util.inspect(exit)}; stderr:
${this.getCurrentStderr()}`));
            });

            this.process.on('error', (error) => {
                cancelStartupTimeout();
                reject(new InternalError(`\
xslt-nailgun server process failed to start: stderr:
${this.getCurrentStderr()}`, error));
            });
        });

        if(this.process.stderr === null)
            throw new Error('ChildProcess has no stderr');
        const stderr: Readable = this.process.stderr;
        stdout.setEncoding('utf-8');
        const stderrLines = readline.createInterface({input: stderr, crlfDelay: Infinity});
        stderrLines.on('line', line => {
            this.stderrLines.enq(line);
        });

        this.handlePromiseRejections();
    }

    public async close(): Promise<void> {
        this.process.kill();
        const timer = timeout(6000, 'timeout');
        const result = await Promise.race([this.processExit.catch(() => undefined), timer.finished]);
        if(result === 'timeout') {
            this.process.kill('SIGKILL');
            await this.processExit.catch(() => undefined);
        }
        else {
            timer.close();
        }
    }

    public getCurrentStderr(): string {
        return this.stderrLines.peekN(this.stderrLines.size()).join('\n');
    }

    /**
     * Prevent UnhandledPromiseRejectionWarning originating from our exported
     * promise properties.
     */
    private handlePromiseRejections() {
        // If someone creates an executor but never invokes execute() then
        // nothing will await our exported promises, which will trigger an
        // UnhandledPromiseRejectionWarning if the server also fails for some
        // reason. In this case, the warning is bogus, so we ignore it by
        // attaching a noop error handler to the promises (which has no effect
        // other than telling node that someone has looked at the promise
        // result).
        this.serverStarted.catch(() => undefined);
        this.processExit.catch(() => undefined);
    }
}

export function timeout<T>(ms: number, value?: T): {finished: Promise<T>} & Closable {
    let resolve: () => void;
    let id: Timeout;
    const close = () => {
        clearTimeout(id);
        resolve();
    };
    return {close, finished: new Promise<T>(_resolve => {
        resolve = _resolve;
        id = setTimeout(_resolve, ms, value);
    })};
}

const serverProcesses = new Map<string, AutoCloser<JVMProcess>>();

function getServerProcessReference(options: StrictCreateOptions): AutoCloserReference<JVMProcess> {
    const optionsKey = jsonStableStringify(options);
    const procCloser = serverProcesses.get(optionsKey);
    if(options.unique || procCloser === undefined || procCloser.isClosed()) {
        const autoCloser = ReferenceCountAutoCloser.createAndReference(JVMProcess.listeningOnRandomPort({
            ...options,
            classpath: getClasspath(),
        }));

        // Don't share the server process if an unique executor is requested.
        if(!options.unique) {
            serverProcesses.set(optionsKey, autoCloser.closer);
        }
        return autoCloser.ref;
    }
    else {
        return procCloser.ref();
    }
}

const EXIT_STATUS_OK = 0;
const EXIT_STATUS_INTERNAL_ERROR = 1;
const EXIT_STATUS_USER_ERROR = 2;

export class XSLTExecutor implements Closable {
    public static getInstance(options?: CreateOptions): XSLTExecutor {
        return this._getInstance(populateDefaults(options || {}));
    }

    private static _getInstance(options: StrictCreateOptions): XSLTExecutor {
        return new XSLTExecutor(getServerProcessReference(options));
    }

    private readonly serverProcessRef: AutoCloserReference<JVMProcess>;
    private closeStarted: boolean;
    private readonly activeExecutions: Set<Promise<Buffer>>;

    private constructor(serverProcessRef: AutoCloserReference<JVMProcess>) {
        this.serverProcessRef = serverProcessRef;
        this.closeStarted = false;
        this.activeExecutions = new Set();
    }

    public async close(): Promise<void> {
        this.closeStarted = true;
        await Promise.all(Array.from(this.activeExecutions, (pending) => pending.catch(err => undefined)));
        assert.strict(this.activeExecutions.size === 0);
        await this.serverProcessRef.close();
    }

    public execute(xmlBaseURI: string, xml: string | Buffer, xsltPath: string): Promise<Buffer> {
        const pendingResult = this.doExecute(xmlBaseURI, xml, xsltPath);
        this.activeExecutions.add(pendingResult);
        return promiseFinally(pendingResult, () => {
            this.activeExecutions.delete(pendingResult);
        });
    }

    private async doExecute(xmlBaseURI: string, xml: string | Buffer, xsltPath: string): Promise<Buffer> {
        if(this.closeStarted)
            throw new Error('execute() called following close()');

        const process = (await (await this.serverProcessRef).resource);
        const address = await process.serverStarted;
        if(address.addressType !== AddressType.network)
            throw new Error(`\
Unsupported address type: ${process.address.addressType} - jvmpin only supports TCP connections`);
        const conn = jvmpin.createConnection(address.port, address.host);

        const error = new Promise<never>((resolve, reject) => {
            conn.on('error', e => {
                const serverError = errorMessageOrFallback(process.getCurrentStderr(), ' contained no output.');
                reject(new InternalError(`\
Error communicating with xslt-nailgun server. Nailgun server stderr${serverError}`, e));
            });
        });
        const connected = new Promise<void>((resolve) => {
            conn.on('connect', () => resolve());
        });
        const connectionClosed = new Promise<void>((resolve) => {
            conn.on('close', () => resolve());
        });

        await abortOnError(connected, error);

        const proc = conn.spawn('xslt', ['transform', xsltPath, xmlBaseURI], {env: {}});
        const exitStatus = new Promise<number>((resolve, reject) => {
            proc.on('exit', (signal: number | null) => {
                if(signal === null) {
                    reject(new InternalError('Error communicating with xslt-nailgun server: nail process was killed'));
                }
                else {
                    resolve(signal);
                }
            });
        });

        const stdoutData = new BufferList();
        const stderrData = new BufferList();
        proc.stdout.pipe(stdoutData);
        proc.stderr.pipe(stderrData);
        proc.stdin.end(xml);

        const [status] = await abortOnError(Promise.all([exitStatus, connectionClosed]), error);

        if(status === EXIT_STATUS_OK) {
            return stdoutData.slice();
        }
        else if(status === EXIT_STATUS_USER_ERROR) {
            throw new UserError(`\
XSLT evaluation produced an error: ${stderrData.toString()}`, xml, xmlBaseURI, xsltPath);
        }
        else {
            if(status === EXIT_STATUS_INTERNAL_ERROR) {
                throw new InternalError(`\
XSLT nail failed to execute transform due to an internal error\
${errorMessageOrFallback(stderrData.toString(), ' but no error message is available.')}`);
            }
            else {
                const nailErrorMsg = errorMessageOrFallback(
                    stderrData.toString(), ', but no error message is available.');
                const serverStderrMsg = errorMessageOrFallback(
                    process.getCurrentStderr(), '',
                    '\n\nNailgun server stderr output (this may or may not relate to the above error):\n%s');

                throw new InternalError(`\
XSLT nail exited with unexpected status ${status}${nailErrorMsg}${serverStderrMsg}`);
            }
        }
    }
}

function errorMessageOrFallback(error: string, fallback: string, template?: string) {
    template = template || ': %s';
    if(error.length > 0) {
        return util.format(template, error);
    }
    return fallback;
}

function abortOnError<T>(promise: Promise<T>, errorProducer: Promise<any>): Promise<T> {
    // The second promise can only reject, so the returned promise can be cast
    // to T as it can only ever resolve to T.
    return Promise.race([
        promise,
        errorProducer.then(() => { throw new Error('errorProducer unexpectedly resolved'); }),
    ]) as Promise<T>;
}

export async function execute(xmlBaseURI: string, xml: string | Buffer, xsltPath: string) {
    return using(XSLTExecutor.getInstance(), (executor) => executor.execute(xmlBaseURI, xml, xsltPath));
}
