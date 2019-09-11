import assert from 'assert';
import BufferList from 'bl';
import {ChildProcess, spawn} from 'child_process';
import DevNull from 'dev-null';
import jsonStableStringify from 'json-stable-stringify';
import {type} from 'os';
import promiseFinally from 'p-finally';
import path from 'path';
import readline from 'readline';
import RingBuffer from 'ringbufferjs';
import {Readable} from 'stream';
import {AsyncParallelHook, SyncHook} from 'tapable';
import TraceError from 'trace-error';
import * as util from 'util';
import {Closable, using} from './_resources';
import jvmpin from './vendor/jvmpin/lib/jvmpin';
import Timeout = NodeJS.Timeout;

export class XSLTNailgunError extends TraceError {}
export class UserError extends XSLTNailgunError {
    public readonly executeOptions: ExecuteOptions;

    constructor(message: string, executeOptions: ExecuteOptions) {
        super(message);
        this.executeOptions = {...executeOptions};
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

export interface JVMProcessOptions extends Omit<Required<CreateOptions>, 'unique'>, ServerAddress {
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

class KeepAliveStrategyHooks<T extends Closable> {
    public readonly onDead = new AsyncParallelHook();
}

interface KeepAliveStrategy<T extends Closable> {
    readonly hooks: KeepAliveStrategyHooks<T>;
    isAlive(): boolean;
    accept(hooks: DefaultAutoCloserHooks<T>): void;
}

abstract class BaseKeepAliveStrategy<T extends Closable = Closable> implements KeepAliveStrategy<T>{
    public readonly hooks = new KeepAliveStrategyHooks<T>();
    protected _isAlive: boolean;
    private autoCloserHooks: DefaultAutoCloserHooks<T>;

    protected constructor(isAliveByDefault: boolean) {
        this._isAlive = isAliveByDefault;
    }

    public accept(hooks: DefaultAutoCloserHooks<T>): void {
        if(this.autoCloserHooks !== undefined)
            throw new Error('accept() called multiple times');
        this.autoCloserHooks = hooks;

        this.autoCloserHooks.refOpened.tap(this.constructor.name, this.onRefOpened.bind(this));
        this.autoCloserHooks.refClosed.tapPromise(this.constructor.name, this.onRefClosed.bind(this));
    }

    public isAlive(): boolean {
        return this._isAlive;
    }

    protected abstract onRefOpened(ref: AutoCloserReference<T>): void;
    protected abstract onRefClosed(ref: AutoCloserReference<T>): Promise<void>;
}

export class ReferenceCountKeepAliveStrategy extends BaseKeepAliveStrategy<Closable> {
    private readonly refs: Set<AutoCloserReference<Closable>> = new Set();

    constructor() {
        super(true);
    }

    protected async onRefClosed(ref: AutoCloserReference<Closable>): Promise<void> {
        this.refs.delete(ref);
        if(this.isAlive() && this.refs.size === 0) {
            this._isAlive = false;
            await this.hooks.onDead.promise();
        }
    }

    protected onRefOpened(ref: AutoCloserReference<Closable>): void {
        this.refs.add(ref);
        if(!this.isAlive() && this.refs.size > 0) {
            this._isAlive = true;
        }
    }
}

class DefaultAutoCloserHooks<T extends Closable> {
    public readonly refOpened = new SyncHook<AutoCloserReference<T>>(['ref']);
    public readonly refClosed = new AsyncParallelHook<AutoCloserReference<T>>(['ref']);
}

type NonEmptyArray<T> = {0: T} & T[];

export class DefaultAutoCloser<T extends Closable> implements AutoCloser<T> {
    private _isClosed: boolean;
    private readonly resource: Promise<T>;
    private readonly hooks: DefaultAutoCloserHooks<T>;
    private readonly keepAliveStrategies: ReadonlyArray<KeepAliveStrategy<T>>;

    public constructor(keepAliveStrategies: KeepAliveStrategy<T> | NonEmptyArray<KeepAliveStrategy<T>>,
                       resource: T | Promise<T>) {
        this._isClosed = false;
        this.resource = Promise.resolve(resource);
        this.hooks = new DefaultAutoCloserHooks<T>();
        this.keepAliveStrategies = Array.isArray(keepAliveStrategies) ?
            [...keepAliveStrategies] : [keepAliveStrategies];

        if(this.keepAliveStrategies.length === 0) {
            throw new Error('no KeepAliveStrategy instances provided');
        }

        for (const keepAlive of this.keepAliveStrategies) {
            keepAlive.accept(this.hooks);
            keepAlive.hooks.onDead.tapPromise(this.constructor.name, this.onKeepAliveDeath.bind(this));
        }
    }

    public isClosed(): boolean {
        return this._isClosed;
    }

    public ref(): AutoCloserReference<T> {
        if(this.isClosed()) {
            throw new Error('ref() called on closed AutoCloser');
        }

        const autoCloser = this;
        const ref: AutoCloserReference<T> = {
            resource: this.resource,
            async close(): Promise<void> {
                await autoCloser.hooks.refClosed.promise(ref);
            },
        };
        this.hooks.refOpened.call(ref);
        return ref;
    }

    private async onKeepAliveDeath(): Promise<void> {
        if(this._isClosed) {
            return;
        }
        if(this.keepAliveStrategies.every(keepAlive => !keepAlive.isAlive())) {
            this._isClosed = true;
            await (await this.resource).close();
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
        const autoCloser = new DefaultAutoCloser<JVMProcess>(
            [new ReferenceCountKeepAliveStrategy()],
            JVMProcess.listeningOnRandomPort({...options, classpath: getClasspath()}));

        // Don't share the server process if an unique executor is requested.
        if(!options.unique) {
            serverProcesses.set(optionsKey, autoCloser);
        }
        return autoCloser.ref();
    }
    else {
        return procCloser.ref();
    }
}

const EXIT_STATUS_OK = 0;
const EXIT_STATUS_INTERNAL_ERROR = 1;
const EXIT_STATUS_USER_ERROR = 2;

interface BaseExecuteOptions {
    /** The filesystem path to the XSLT file to execute. */
    xsltPath: string;

    /**
     * Defines the default base URI of the input document (it can be overridden by the contents of the document itself).
     */
    systemIdentifier?: string;
}

interface XMLViaValue {
    /** The data to be used as the input to the transformation. */
    xml: string | Buffer;
    xmlPath?: undefined;
}

interface XMLViaPath {
    /** The path to the file to be used as the input to the transformation. */
    xmlPath: string;
    xml?: undefined;
}

interface XMLViaSystemIdentifier {
    systemIdentifier: string;
    xml?: undefined;
    xmlPath?: undefined;
}

export type ExecuteOptions = BaseExecuteOptions & (XMLViaValue | XMLViaPath | XMLViaSystemIdentifier);

export class XSLTExecutor implements Closable {
    public static getInstance(options?: CreateOptions): XSLTExecutor {
        return this._getInstance(populateDefaults(options || {}));
    }

    private static _getInstance(options: StrictCreateOptions): XSLTExecutor {
        return new XSLTExecutor(getServerProcessReference(options));
    }

    private static getNailInputs(options: ExecuteOptions) {
        let stdin;
        let xmlPath: string[];
        const systemIdentifier =
            options.systemIdentifier === undefined ? [] : ['--system-identifier', options.systemIdentifier];
        if(options.xmlPath === undefined && options.xml === undefined &&  options.systemIdentifier !== undefined) {
            stdin = '';
            xmlPath = [];
        }
        else if(options.xmlPath !== undefined) {
            assert(options.xml === undefined);
            stdin = '';
            xmlPath = [options.xmlPath];
        }
        else if(options.xml !== undefined) {
            assert(options.xmlPath === undefined);
            stdin = options.xml;
            xmlPath = ['-'];
        }
        else {
            const anyOpts = options as any;
            // TypeScript will prevent this, but javascript won't.
            if(anyOpts.xml !== undefined && anyOpts.xmlPath !== undefined) {
                throw new Error('Options xml and xmlPath cannot be specified together');
            }
            throw new Error(`\
No input specified in options - at least one of xml, xmlPath, systemIdentifier must be specified`);
        }

        return {
            args: ['transform'].concat(systemIdentifier).concat(['--', options.xsltPath]).concat(xmlPath),
            stdin,
        };
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

    public execute(options: ExecuteOptions): Promise<Buffer> {
        const pendingResult = this.doExecute(options);
        this.activeExecutions.add(pendingResult);
        return promiseFinally(pendingResult, () => {
            this.activeExecutions.delete(pendingResult);
        });
    }

    private async doExecute(options: ExecuteOptions): Promise<Buffer> {
        if(this.closeStarted)
            throw new Error('execute() called following close()');

        const {args, stdin} = XSLTExecutor.getNailInputs(options);

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

        const proc = conn.spawn('xslt', args, {env: {}});
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
        proc.stdin.end(stdin);

        const [status] = await abortOnError(Promise.all([exitStatus, connectionClosed]), error);

        if(status === EXIT_STATUS_OK) {
            return stdoutData.slice();
        }
        else if(status === EXIT_STATUS_USER_ERROR) {
            throw new UserError(`\
XSLT evaluation produced an error: ${stderrData.toString()}`, options);
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

export async function execute(options: ExecuteOptions) {
    return using(XSLTExecutor.getInstance(), (executor) => executor.execute(options));
}
