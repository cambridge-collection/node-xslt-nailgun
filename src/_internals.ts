import {name} from 'xml-name-validator';

import assert from 'assert';
import BufferList from 'bl';
import {ChildProcess, spawn} from 'child_process';
import createDebug from 'debug';
import jsonStableStringify from 'json-stable-stringify';
import promiseFinally from 'p-finally';
import path from 'path';
import readline from 'readline';
import RingBuffer from 'ringbufferjs';
import {Readable} from 'stream';
import {AsyncParallelHook, SyncBailHook, SyncHook} from 'tapable';
import TraceError from 'trace-error';
import * as util from 'util';
import {Closable, using} from './_resources';
import jvmpin from './vendor/jvmpin/lib/jvmpin';
import Timeout = NodeJS.Timeout;

const _debugPrefix = '@lib.cam/xslt-nailgun';
const DEBUG = {
  jvmProcess: createDebug(`${_debugPrefix}:jvm-process`),
  processSharing: createDebug(`${_debugPrefix}:process-sharing`),
  keepAliveTimeout: createDebug(`${_debugPrefix}:keep-alive-timeout`),
  defaultAutoCloser: createDebug(`${_debugPrefix}:auto-closer`),
};

export class XSLTNailgunError extends TraceError {}
export class UserError extends XSLTNailgunError {
  readonly executeOptions: ExecuteOptions;

  constructor(message: string, executeOptions: ExecuteOptions) {
    super(message);
    this.executeOptions = {...executeOptions};
  }
}
export class InternalError extends XSLTNailgunError {}

export function getClasspath() {
  const packageJsonPath = '../package.json';
  const metadata = require(packageJsonPath);
  if (
    !(
      typeof metadata['uk.ac.cam.lib.cudl.xslt-nailgun'] === 'object' &&
      typeof metadata['uk.ac.cam.lib.cudl.xslt-nailgun'].serverJarsPath ===
        'string'
    )
  ) {
    throw new Error(
      'xslt-nailgun package.json does not contain required metadata'
    );
  }
  const localPath = metadata['uk.ac.cam.lib.cudl.xslt-nailgun'].serverJarsPath;
  return path.resolve(require.resolve(packageJsonPath), '..', localPath, '*');
}

function parseClarkNameError(value: string, detailMsg: string): string {
  return `invalid Clark-encoded qname ${util.inspect(value)}: ${detailMsg}`;
}

export function parseClarkName(value: string): {ns: string; id: string} {
  let ns;
  let id;
  if (value.startsWith('{')) {
    const nsEnd = value.indexOf('}');
    if (nsEnd === -1) {
      throw new Error(parseClarkNameError(value, 'no closing }'));
    }
    ns = value.substr(1, nsEnd - 1);
    id = value.substr(nsEnd + 1);
  } else {
    ns = '';
    id = value;
  }

  if (!name(id).success) {
    throw new Error(
      parseClarkNameError(
        value,
        `local identifier part is not a valid XML name: ${util.inspect(id)}`
      )
    );
  }

  return {ns, id};
}

export enum AddressType {
  local = 'local',
  network = 'network',
}

export interface CreateOptions {
  jvmExecutable?: string;
  /**
   * If true, the returned executor always uses a newly spawned nailgun
   * server process, rather than sharing with other concurrently-active
   * executors.
   */

  /**
   * An opaque identifier for the JVM process. execute() calls with distinct jvmProcessID values will use distinct
   * JVM processes. This can be used to isolate execute() environments, and also to identify the process affected
   * when an async JVM process close error occurs.
   */
  jvmProcessID?: string | null;

  /**
   * The number of milliseconds to keep the nailgun server running for after
   * all execute() calls have completed. If null (the default), the timeout
   * will be determined automatically.
   */
  jvmKeepAliveTimeout?: number | null;

  /**
   * The number of milliseconds to give the xslt-nailgun server to start up
   * before killing it and failing the XSLT execution.
   */
  jvmStartupTimeout?: number;
}
type StrictCreateOptions = Required<CreateOptions>;

interface ServerAddress {
  addressType: AddressType;
  listenAddress: string;
}

function parseServerAddress(address: ServerAddress) {
  if (address.addressType === AddressType.local) {
    return new LocalServerAddress(address.listenAddress);
  }
  return IPServerAddress.fromListenAddress(address.listenAddress);
}

export class LocalServerAddress {
  readonly addressType: AddressType.local = AddressType.local;
  readonly listenAddress: string;

  constructor(listenAddress: string) {
    this.listenAddress = listenAddress;
  }
}

export class IPServerAddress {
  static fromListenAddress(listenAddress: string) {
    const [host, portString] = listenAddress.split(':', 2);
    const port = Number(portString);

    if (isNaN(port)) {
      throw new Error(`Invalid listenAddress: ${listenAddress}`);
    }
    return new IPServerAddress(host, port);
  }

  readonly addressType: AddressType.network = AddressType.network;
  readonly host: string;
  readonly port: number;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  get listenAddress(): string {
    return `${this.host}:${this.port}`;
  }
}

export interface JVMProcessOptions
  extends Omit<StrictCreateOptions, 'jvmKeepAliveTimeout' | 'jvmProcessID'>,
    ServerAddress {
  classpath: string;
  /**
   * Whether to enable debugging functionality. Default: false.
   * Presently this means that stderr is monitored for errors until the process's close() method is called. Normally
   * stderr is only monitored during startup; after that it's disconnected. This is necessary to prevent the process
   * keeping the parent node process alive unnecessarily until keep-alive timeouts expire..
   */
  debug?: boolean;
}

function populateDefaults(options: CreateOptions): StrictCreateOptions {
  return {
    jvmExecutable:
      options.jvmExecutable === undefined ? 'java' : options.jvmExecutable,
    jvmProcessID:
      options.jvmProcessID === undefined ? null : options.jvmProcessID,
    jvmKeepAliveTimeout:
      options.jvmKeepAliveTimeout === undefined
        ? null
        : options.jvmKeepAliveTimeout,
    jvmStartupTimeout:
      options.jvmStartupTimeout === undefined
        ? 2000
        : options.jvmStartupTimeout,
  };
}

export interface AutoCloserReference<T extends Closable> extends Closable {
  readonly resource: Promise<T>;
}

class AutoCloserHooks {
  /**
   * Triggered when the calling close() on the AutoCloser's resource fails, but there's no direct caller to propagate
   * the error to. For example, when the close() was initiated via a timer.
   */
  readonly asyncCloseError = new SyncBailHook<Error>(['error']);
  /** Triggered when the AutoCloser has marked itself as closed, but before it closes its resource. */
  readonly closing = new SyncHook();
  /** Triggered once the AutoCloser has closed its resource. */
  readonly closed = new SyncHook();
}

interface AutoCloser<T extends Closable> {
  readonly hooks: AutoCloserHooks;
  isClosed(): boolean;
  ref(): AutoCloserReference<T>;
}

class KeepAliveStrategyHooks {
  readonly dead = new AsyncParallelHook();
  readonly asyncCloseError = new SyncBailHook<Error>(['error']);

  constructor() {
    // Throw errors by default if nobody taps asyncCloseError
    this.asyncCloseError.tap(
      {name: 'KeepAliveStrategyHooks', stage: Number.MAX_SAFE_INTEGER},
      error => {
        throw error;
      }
    );
  }
}

interface KeepAliveStrategy<T extends Closable> {
  readonly hooks: KeepAliveStrategyHooks;
  isAlive(): boolean;
  accept(hooks: DefaultAutoCloserKeepAliveHooks<T>): void;
}

abstract class BaseKeepAliveStrategy<T extends Closable = Closable>
  implements KeepAliveStrategy<T> {
  readonly hooks = new KeepAliveStrategyHooks();
  protected _isAlive: boolean;
  private autoCloserHooks: DefaultAutoCloserKeepAliveHooks<T> | undefined;

  protected constructor(isAliveByDefault: boolean) {
    this._isAlive = isAliveByDefault;
  }

  accept(_hooks: DefaultAutoCloserKeepAliveHooks<T>): void {
    if (this.autoCloserHooks !== undefined) {
      throw new Error('accept() called multiple times');
    }
    this.autoCloserHooks = _hooks;

    this.autoCloserHooks.refOpened.tap(
      this.constructor.name,
      this.onRefOpened.bind(this)
    );
    this.autoCloserHooks.refClosed.tapPromise(
      this.constructor.name,
      this.onRefClosed.bind(this)
    );
  }

  isAlive(): boolean {
    return this._isAlive;
  }

  protected abstract onRefOpened(ref: AutoCloserReference<T>): void;
  protected abstract onRefClosed(ref: AutoCloserReference<T>): Promise<void>;
}

export class ReferenceCountKeepAliveStrategy<
  T extends Closable = Closable
> extends BaseKeepAliveStrategy<T> {
  private readonly refs: Set<AutoCloserReference<T>> = new Set();

  constructor() {
    super(true);
  }

  protected async onRefClosed(ref: AutoCloserReference<T>): Promise<void> {
    this.refs.delete(ref);
    if (this.isAlive() && this.refs.size === 0) {
      this._isAlive = false;
      await this.hooks.dead.promise();
    }
  }

  protected onRefOpened(ref: AutoCloserReference<T>): void {
    this.refs.add(ref);
    if (!this.isAlive() && this.refs.size > 0) {
      this._isAlive = true;
    }
  }
}

export class TimeoutKeepAliveStrategy<
  T extends Closable = Closable
> extends BaseKeepAliveStrategy<T> {
  private openRefCount = 0;
  private timer?: Timeout;
  private timeout: number;
  private readonly beforeExitCallback: () => void;

  constructor(timeout: number) {
    super(true);
    this.timeout = 0;
    this.updateTimeout(timeout);
    this.beforeExitCallback = this.onBeforeExit.bind(this);
  }

  getTimeout(): number {
    return this.timeout;
  }

  updateTimeout(timeout: number) {
    if (timeout < 0) {
      throw new Error(`timeout must be >= 0; timeout: ${timeout}`);
    }
    this.timeout = timeout;
  }

  protected async onRefClosed(): Promise<void> {
    assert(this.openRefCount > 0);
    this.openRefCount--;

    if (this.openRefCount === 0) {
      this.cancelTimeout();
      this.startTimeout();
    }
  }

  protected onRefOpened(): void {
    if (this.cancelTimeout()) {
      DEBUG.keepAliveTimeout(
        'cancelled timeout because a new reference was created'
      );
    }
    this.openRefCount++;
    this._isAlive = true;
  }

  private startTimeout() {
    if (this.timeout === 0) {
      this.onTimeoutExpired();
    } else {
      DEBUG.keepAliveTimeout('staying alive for %d ms', this.timeout);
      process.on('beforeExit', this.beforeExitCallback);
      this.timer = setTimeout(this.onTimeoutExpired.bind(this), this.timeout);
      this.timer.unref();
    }
  }

  private cancelTimeout(): boolean {
    process.removeListener('beforeExit', this.beforeExitCallback);
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
      return true;
    }
    return false;
  }

  private onBeforeExit(): void {
    // Called from the process 'beforeExit' event - the node process is trying to exit, so we'll act as if the timer
    // had expired, so the resource gets cleaned up right away (assuming there are no active references remaining).
    DEBUG.keepAliveTimeout(
      'received process `beforeExit` event while waiting for timeout; - expiring immediately'
    );
    this.onTimeoutExpired();
  }

  private onTimeoutExpired(): void {
    this.cancelTimeout();
    if (this.openRefCount > 0) {
      return;
    }

    DEBUG.keepAliveTimeout('keep-alive timeout expired');
    this._isAlive = false;
    this.hooks.dead.callAsync((err: unknown) => {
      // If closing fails we have no direct caller to report the error to, so we pass it to our async error hook
      // for handling.
      if (err) {
        DEBUG.keepAliveTimeout(
          'got an async close error after reporting death; error=%O',
          err
        );
        const error =
          err instanceof Error
            ? err
            : typeof err === 'string'
            ? new Error(err)
            : new Error(util.inspect(err));
        this.hooks.asyncCloseError.call(error);
      }
    });
  }
}

export class DefaultAutoCloserKeepAliveHooks<T extends Closable> {
  readonly refOpened = new SyncHook<AutoCloserReference<T>>(['ref']);
  readonly refClosed = new AsyncParallelHook<AutoCloserReference<T>>(['ref']);
}

export class DefaultAutoCloser<T extends Closable> implements AutoCloser<T> {
  readonly hooks: AutoCloserHooks;

  private _isClosed: boolean;
  private readonly resource: Promise<T>;
  private readonly keepAliveHooks: DefaultAutoCloserKeepAliveHooks<T>;
  private readonly keepAliveStrategies: ReadonlyArray<KeepAliveStrategy<T>>;

  constructor(
    resource: T | Promise<T>,
    keepAliveStrategy: KeepAliveStrategy<T>,
    ...moreKeepAliveStrategies: Array<KeepAliveStrategy<T>>
  );
  constructor(
    resource: T | Promise<T>,
    keepAliveStrategies: Array<KeepAliveStrategy<T>>
  );
  constructor(
    resource: T | Promise<T>,
    keepAliveStrategies: KeepAliveStrategy<T> | Array<KeepAliveStrategy<T>>,
    ...moreKeepAliveStrategies: Array<KeepAliveStrategy<T>>
  ) {
    this._isClosed = false;
    this.resource = Promise.resolve(resource);
    this.hooks = new AutoCloserHooks();
    this.keepAliveHooks = new DefaultAutoCloserKeepAliveHooks<T>();
    this.keepAliveStrategies = Array.isArray(keepAliveStrategies)
      ? [...keepAliveStrategies, ...moreKeepAliveStrategies]
      : [keepAliveStrategies, ...moreKeepAliveStrategies];

    if (this.keepAliveStrategies.length === 0) {
      throw new Error('no KeepAliveStrategy instances provided');
    }

    for (const keepAlive of this.keepAliveStrategies) {
      keepAlive.accept(this.keepAliveHooks);
      keepAlive.hooks.dead.tapPromise(
        this.constructor.name,
        this.onKeepAliveDeath.bind(this)
      );
      // Forward async close errors to our own equivalent hook
      keepAlive.hooks.asyncCloseError.tap(this.constructor.name, error => {
        this.hooks.asyncCloseError.call(error);
      });
    }
  }

  isClosed(): boolean {
    return this._isClosed;
  }

  ref(): AutoCloserReference<T> {
    if (this.isClosed()) {
      throw new Error('ref() called on closed AutoCloser');
    }

    let closed = false;
    const ref: AutoCloserReference<T> = {
      resource: this.resource,
      close: async (): Promise<void> => {
        if (closed) {
          DEBUG.defaultAutoCloser('close() called on already-closed ref');
          return;
        }
        closed = true;
        DEBUG.defaultAutoCloser('closed a ref');
        await this.keepAliveHooks.refClosed.promise(ref);
      },
    };
    DEBUG.defaultAutoCloser('created a ref');
    this.keepAliveHooks.refOpened.call(ref);
    return ref;
  }

  private async onKeepAliveDeath(): Promise<void> {
    if (this._isClosed) {
      DEBUG.defaultAutoCloser(
        'keep-alive strategy reported death while already closed'
      );
      return;
    }
    if (this.keepAliveStrategies.every(keepAlive => !keepAlive.isAlive())) {
      DEBUG.defaultAutoCloser(
        'all %d keep-alive strategies are dead, closing',
        this.keepAliveStrategies.length
      );
      this._isClosed = true;
      this.hooks.closing.call();
      await (await this.resource).close();
      this.hooks.closed.call();
    } else {
      if (DEBUG.defaultAutoCloser.enabled) {
        DEBUG.defaultAutoCloser(
          'keep-alive strategy reported its death, but %d are still alive',
          this.keepAliveStrategies.reduce(
            (count, keepAlive) => count + Number(keepAlive.isAlive()),
            0
          )
        );
      }
    }
  }
}

type ProcessExit = {code: number} | {signal: string};

type RandomPortJVMProcessOptions = Omit<
  JVMProcessOptions,
  'addressType' | 'listenAddress'
>;

export class JVMProcess implements Closable {
  static async listeningOnRandomPort(
    options: RandomPortJVMProcessOptions
  ): Promise<JVMProcess> {
    return new JVMProcess({
      ...options,
      addressType: AddressType.network,
      listenAddress: '127.0.0.1:0',
    });
  }

  private static createExitObject(
    code: number | null,
    signal: string | null
  ): ProcessExit {
    if (code !== null) {
      return {code};
    } else if (signal !== null) {
      return {signal};
    } else {
      throw new Error('code and signal are null');
    }
  }

  readonly processExit: Promise<ProcessExit>;
  readonly serverStarted: Promise<IPServerAddress | LocalServerAddress>;
  readonly address: IPServerAddress | LocalServerAddress;
  readonly debug: boolean;

  private readonly options: JVMProcessOptions;
  private readonly process: ChildProcess;
  private readonly stderrLines: RingBuffer<string>;
  private readonly boundOnProcessExit = this.onProcessExit.bind(this);
  private closeCalled = false;

  constructor(options: JVMProcessOptions) {
    const startupTimeout = options.jvmStartupTimeout;
    this.options = {...options};
    this.debug = !!options.debug;
    this.address = parseServerAddress(options);
    this.stderrLines = new RingBuffer<string>(500);
    const args = [
      '-cp',
      options.classpath,
      'uk.ac.cam.lib.cudl.xsltnail.XSLTNailgunServer',
      '--require-running-process',
      `${process.pid}`,
      '--address-type',
      this.options.addressType,
      this.options.listenAddress,
    ];
    this.process = spawn(options.jvmExecutable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // To ensure we don't leak child processes if something unexpected happens, we listen for our process exiting
    // and kill the child.
    process.on('exit', this.boundOnProcessExit);

    // We need to unref the process, not because we want it to run beyond our lifetime, but because we shut it down
    // automatically in the process beforeExit event, and that event never fires if the process is referenced by the
    // event loop.
    this.process.unref();

    this.processExit = new Promise<ProcessExit>((resolve, reject) => {
      this.process.on('exit', (code, signal) => {
        resolve(JVMProcess.createExitObject(code, signal));
      });
      this.process.on('error', error => {
        if (this.process.pid === undefined) {
          reject(
            new InternalError(
              'xslt-nailgun server process failed to start',
              error
            )
          );
        } else {
          reject(
            new InternalError(
              "xslt-nailgun server process emitted 'error' before 'exit'",
              error
            )
          );
        }
      });
    });
    DEBUG.jvmProcess(
      'spawned new JVM; pid=%d, command=%s, args=%o',
      this.process.pid,
      options.jvmExecutable,
      args
    );

    if (this.process.stdout === null) {
      throw new Error('ChildProcess has no stdout');
    }
    const stdout: Readable = this.process.stdout;
    stdout.setEncoding('utf-8');

    this.serverStarted = new Promise((resolve, reject) => {
      let starting = true;
      let timedOut = false;
      const timeoutTimer = setTimeout(() => {
        if (!starting) {
          return;
        }
        timedOut = true;
        this.close()
          .then(() => {
            reject(
              new InternalError(`\
xslt-nailgun server process failed to start: ${startupTimeout}ms startup timeout expired; stderr: \
${util.inspect(this.getCurrentStderr())}`)
            );
          })
          .catch(reason => {
            reject(
              new InternalError(`\
xslt-nailgun server process failed to start: Error closing JVM process after ${startupTimeout}ms startup timeout \
expired; close error: ${util.inspect(reason)}; stderr: \
${util.inspect(this.getCurrentStderr())}`)
            );
          });
      }, startupTimeout);

      const cancelStartupTimeout = () => {
        starting = false;
        clearTimeout(timeoutTimer);
      };

      const stdoutLines = readline.createInterface({
        input: stdout,
        crlfDelay: Infinity,
      });
      stdoutLines.on('line', line => {
        if (!/^NGServer [\d.]+ started/.test(line)) {
          return;
        }

        // Port 0 means the server selects a port to listen on. We need to check the output to see which port
        // it's using.
        let address;
        if (
          this.address.addressType === AddressType.network &&
          this.address.port === 0
        ) {
          const match = / port (\d+)\.$/.exec(line);
          if (!match || match.length !== 2) {
            reject(
              new Error(
                `Failed to parse port from NGServer startup message: ${line}`
              )
            );
            return;
          }
          address = new IPServerAddress(this.address.host, Number(match[1]));
        } else {
          address = this.address;
        }

        stdoutLines.removeAllListeners('line');
        stdoutLines.close();
        // We need to close our end of the server's stdout pipe, otherwise our event loop will not be able to
        // terminate.
        stdout.destroy();
        cancelStartupTimeout();
        if (!timedOut) {
          resolve(address);
        }
      });

      this.process.on('exit', (code, signal) => {
        const exit = JVMProcess.createExitObject(code, signal);
        cancelStartupTimeout();

        // The process gets closed if the startup expires. We can ignore this as
        // the timeout is what should be reported.
        if (!timedOut) {
          reject(
            new InternalError(`\
xslt-nailgun server process failed to start: process unexpectedly terminated with ${util.inspect(
              exit
            )}; stderr:
${this.getCurrentStderr()}`)
          );
        }
      });

      this.process.on('error', error => {
        cancelStartupTimeout();
        const msg = `\
xslt-nailgun server process failed to start: stderr:
${this.getCurrentStderr()}`;
        if (!timedOut) {
          reject(new InternalError(msg, error));
        } else {
          DEBUG.jvmProcess(
            `xslt-nailgun server process emitted an error after the startupTimeout expired: ${error}`
          );
        }
      });
    });

    if (this.process.stderr === null) {
      throw new Error('ChildProcess has no stderr');
    }
    const stderr: Readable = this.process.stderr;
    stdout.setEncoding('utf-8');
    const stderrLines = readline.createInterface({
      input: stderr,
      crlfDelay: Infinity,
    });
    stderrLines.on('line', line => {
      this.stderrLines.enq(line);
    });

    // As with stdout, we need to stop reading from stdin, otherwise our event loop won't terminate. However if
    // debug is enabled we keep reading it.
    if (!this.debug) {
      this.serverStarted.then(
        () => {
          DEBUG.jvmProcess(
            "\
nailgun server's stderr will no longer be monitored as the server has started and debug is disabled"
          );
          stderrLines.removeAllListeners('line');
          stderrLines.close();
          stderr.destroy();
        },
        () => undefined
      );
    }

    this.handlePromiseRejections();
  }

  async close(): Promise<void> {
    if (this.closeCalled) {
      return;
    }
    this.closeCalled = true;
    DEBUG.jvmProcess('stopping JVM; pid=%d', this.process.pid);
    this.process.kill();
    const timer = _timeout(6000, 'timeout');
    const result = await Promise.race([
      this.processExit.catch(() => undefined),
      timer,
    ]);
    if (result === 'timeout') {
      DEBUG.jvmProcess(
        'JVM failed to shutdown, sending SIGKILL; pid=%d',
        this.process.pid
      );
      this.process.kill('SIGKILL');
      await this.processExit.catch(() => undefined);
    } else {
      DEBUG.jvmProcess('stopped JVM; pid=%d', this.process.pid);
      timer.close();
    }
    process.removeListener('exit', this.boundOnProcessExit);
  }

  getCurrentStderr(): string {
    return this.stderrLines.peekN(this.stderrLines.size()).join('\n');
  }

  private onProcessExit(): void {
    if (!this.process.killed) {
      DEBUG.jvmProcess(
        "\
received our node process's 'exit' event, but our nailgun server hasn't been killed; sending it SIGKILL"
      );
      this.process.kill('SIGKILL');
    }
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

function _timeout<T extends undefined>(
  ms: number,
  value?: T
): PromiseLike<T> & Closable;
function _timeout<T>(ms: number, value: T): PromiseLike<T> & Closable;
function _timeout<T>(ms: number, value: T): PromiseLike<T> & Closable {
  let id: Timeout;
  let close: undefined | (() => Promise<void> | void) = undefined;
  const finished = new Promise<T>(resolve => {
    id = setTimeout(resolve, ms, value);
    close = () => {
      clearTimeout(id);
      resolve(value);
    };
  });
  assert(close !== undefined);
  return {close, then: finished.then.bind(finished)};
}
export {_timeout as timeout};

const serverProcesses = new Map<string, AutoCloser<JVMProcess>>();

class XSLTNailgunHooks {
  /**
   * Triggered if a JVM process fails to shutdown when being terminated outside an execute() call, e.g. being
   * terminated as the result of a keep alive timeout expiring after an execute() call has completed.
   */
  readonly asyncJVMShutdownError = new SyncBailHook<Error, StrictCreateOptions>(
    ['error', 'options']
  );

  constructor() {
    const options = {
      name: 'XSLTNailgunHooks',
      stage: Number.MAX_SAFE_INTEGER,
    };

    // Throw by default if nothing handles an error
    this.asyncJVMShutdownError.tap(options, (error, _options) => {
      throw new TraceError(
        `\
Unhandled xslt-nailgun JVM process shutdown error; JVM options: ${JSON.stringify(
          _options
        )}.
To handle this error, tap require('xslt-nailgun').hooks.asyncJVMShutdownError`,
        error
      );
    });
  }
}

export const hooks = new XSLTNailgunHooks();

const DEFAULT_JVM_TIMEOUT_INITIAL = 1000;
const DEFAULT_JVM_TIMEOUT_STARTUP_FACTOR = 6;
const DEFAULT_JVM_TIMEOUT_MAX = 10000;

function getServerProcessReference(
  options: StrictCreateOptions
): AutoCloserReference<JVMProcess> {
  if (options.jvmKeepAliveTimeout !== null && options.jvmKeepAliveTimeout < 0) {
    throw new Error('jvmKeepAliveTimeout cannot be negative');
  }
  const optionsKey = jsonStableStringify(options);
  const procCloser = serverProcesses.get(optionsKey);
  if (procCloser === undefined || procCloser.isClosed()) {
    const keepAliveStrategies: Array<KeepAliveStrategy<JVMProcess>> = [
      new ReferenceCountKeepAliveStrategy(),
    ];

    let timeoutKeepAlive: TimeoutKeepAliveStrategy<JVMProcess> | null = null;
    if (options.jvmKeepAliveTimeout !== 0) {
      timeoutKeepAlive = new TimeoutKeepAliveStrategy(
        options.jvmKeepAliveTimeout || DEFAULT_JVM_TIMEOUT_INITIAL
      );
      keepAliveStrategies.push(timeoutKeepAlive);
    }

    if (DEBUG.processSharing.enabled) {
      if (timeoutKeepAlive !== null) {
        const timeout =
          options.jvmKeepAliveTimeout === null
            ? `automatic, provisionally ${DEFAULT_JVM_TIMEOUT_INITIAL}`
            : timeoutKeepAlive.getTimeout();
        DEBUG.processSharing(
          'no existing process available, spawning with keep-alive; keep-alive timeout=%s ms, key=%s',
          timeout,
          optionsKey
        );
      } else {
        DEBUG.processSharing(
          'no existing process available, spawning without keep-alive; key=%s',
          optionsKey
        );
      }
    }
    const jvmProcess = JVMProcess.listeningOnRandomPort({
      ...options,
      classpath: getClasspath(),
    });
    const autoCloser = new DefaultAutoCloser<JVMProcess>(
      jvmProcess,
      keepAliveStrategies
    );
    serverProcesses.set(optionsKey, autoCloser);

    // Clean up global references to closed auto-closers to avoid leaking
    const cleanup = () => {
      if (serverProcesses.get(optionsKey) === autoCloser) {
        serverProcesses.delete(optionsKey);
      }
    };
    autoCloser.hooks.closing.tap('getServerProcessReference', cleanup);
    // Handle errors from close() without direct callers (e.g. from timers) using our global async error hook
    autoCloser.hooks.asyncCloseError.tap('getServerProcessReference', err => {
      // Ensure we don't hold onto auto-closer references if closing fails asynchronously. This shouldn't
      // (currently) be required, as the above closing hook will be triggered before the resource's close() method
      // is actually called.
      cleanup();
      hooks.asyncJVMShutdownError.call(err, options);
    });

    // If no timeout is specified, we automatically set the timeout based on the time it takes to start the nailgun
    // server.
    if (options.jvmKeepAliveTimeout === null) {
      const processStartTime = Date.now();
      jvmProcess.then(
        proc => {
          proc.serverStarted.then(
            () => {
              const autoTimeout = Math.max(
                0,
                Math.min(
                  DEFAULT_JVM_TIMEOUT_MAX,
                  (Date.now() - processStartTime) *
                    DEFAULT_JVM_TIMEOUT_STARTUP_FACTOR
                )
              );
              if (timeoutKeepAlive === null) {
                return;
              }
              DEBUG.processSharing(
                'automatic keep-alive timeout determined; timeout=%d ms, key=%s',
                autoTimeout,
                optionsKey
              );
              timeoutKeepAlive.updateTimeout(autoTimeout);
            },
            () => undefined
          );
        },
        () => undefined
      );
    }

    return autoCloser.ref();
  } else {
    DEBUG.processSharing(
      'request fulfilled using existing process; key=%s',
      optionsKey
    );
    return procCloser.ref();
  }
}

const EXIT_STATUS_OK = 0;
const EXIT_STATUS_INTERNAL_ERROR = 1;
const EXIT_STATUS_USER_ERROR = 2;

interface Parameters {
  [name: string]: string | string[];
}

interface BaseExecuteOptions {
  /** The filesystem path to the XSLT file to execute. */
  xsltPath: string;

  /**
   * Defines the default base URI of the input document (it can be overridden by the contents of the document itself).
   */
  systemIdentifier?: string;

  /**
   * Values for the stylesheet's global parameters.
   *
   * The object keys are parameter names, which are XML qualified names encoded in Clark notation
   * (`"{uri}local-name"`). Values are zero or more strings. The XSLT processor converts the string values to the
   * stylesheet parameter's specified type (e.g. xs:integer, xs:date etc) using the standard type conversion rules the
   * stylesheet.
   *
   * For example:
   *
   * ```
   * {
   *     foo: 'abc',
   *     bar: [],
   *     '{http://example.com/myns}local-name': ['a', 'b', 'c']
   * }
   * ```
   */
  parameters?: Parameters;
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

export type ExecuteOptions = BaseExecuteOptions &
  (XMLViaValue | XMLViaPath | XMLViaSystemIdentifier);

export class XSLTExecutor implements Closable {
  static getInstance(options?: CreateOptions): XSLTExecutor {
    return this._getInstance(populateDefaults(options || {}));
  }

  private static _getInstance(options: StrictCreateOptions): XSLTExecutor {
    return new XSLTExecutor(getServerProcessReference(options));
  }

  private static getNailInputs(options: ExecuteOptions) {
    let stdin;
    let xmlPath: string[];
    const systemIdentifier =
      options.systemIdentifier === undefined
        ? []
        : ['--system-identifier', options.systemIdentifier];
    let parameters: string[];
    try {
      parameters = XSLTExecutor.encodeParameterOptions(
        options.parameters || {}
      );
    } catch (e) {
      throw new TraceError(`Failed to encode parameters: ${e.message}`, e);
    }
    if (
      options.xmlPath === undefined &&
      options.xml === undefined &&
      options.systemIdentifier !== undefined
    ) {
      stdin = '';
      xmlPath = [];
    } else if (options.xmlPath !== undefined) {
      assert(options.xml === undefined);
      stdin = '';
      xmlPath = [options.xmlPath];
    } else if (options.xml !== undefined) {
      assert(options.xmlPath === undefined);
      stdin = options.xml;
      xmlPath = ['-'];
    } else {
      const anyOpts = options as Partial<ExecuteOptions>;
      // TypeScript will prevent this, but javascript won't.
      if (anyOpts.xml !== undefined && anyOpts.xmlPath !== undefined) {
        throw new Error('Options xml and xmlPath cannot be specified together');
      }
      throw new Error(
        '\
No input specified in options - at least one of xml, xmlPath, systemIdentifier must be specified'
      );
    }

    return {
      args: ['transform']
        .concat(systemIdentifier)
        .concat(parameters)
        .concat(['--', options.xsltPath])
        .concat(xmlPath),
      stdin,
    };
  }

  private static encodeParameterOptions(parameters: Parameters): string[] {
    const options = [];
    for (const clarkQname of Object.keys(parameters)) {
      // Ensure a valid Clark qname is used
      parseClarkName(clarkQname);

      const values = parameters[clarkQname];
      for (const value of typeof values === 'string' ? [values] : values) {
        options.push(`--parameter=${clarkQname}=${value}`);
      }
    }
    return options;
  }

  private readonly serverProcessRef: AutoCloserReference<JVMProcess>;
  private closeStarted: boolean;
  private readonly activeExecutions: Set<Promise<Buffer>>;

  private constructor(serverProcessRef: AutoCloserReference<JVMProcess>) {
    this.serverProcessRef = serverProcessRef;
    this.closeStarted = false;
    this.activeExecutions = new Set();
  }

  async close(): Promise<void> {
    this.closeStarted = true;
    await Promise.all(
      Array.from(this.activeExecutions, pending =>
        pending.catch(() => undefined)
      )
    );
    assert.strict(this.activeExecutions.size === 0);
    await this.serverProcessRef.close();
  }

  execute(options: ExecuteOptions): Promise<Buffer> {
    const pendingResult = this.doExecute(options);
    this.activeExecutions.add(pendingResult);
    return promiseFinally(pendingResult, () => {
      this.activeExecutions.delete(pendingResult);
    });
  }

  private async doExecute(options: ExecuteOptions): Promise<Buffer> {
    if (this.closeStarted) {
      throw new Error('execute() called following close()');
    }

    const {args, stdin} = XSLTExecutor.getNailInputs(options);

    const process = await (await this.serverProcessRef).resource;
    const address = await process.serverStarted;
    if (address.addressType !== AddressType.network) {
      throw new Error(`\
Unsupported address type: ${process.address.addressType} - jvmpin only supports TCP connections`);
    }
    const conn = jvmpin.createConnection(address.port, address.host);

    const error = new Promise<never>((resolve, reject) => {
      conn.on('error', e => {
        const serverError = errorMessageOrFallback(
          process.getCurrentStderr(),
          ' contained no output.'
        );
        reject(
          new InternalError(
            `\
Error communicating with xslt-nailgun server. Nailgun server stderr${serverError}`,
            e
          )
        );
      });
    });
    const connected = new Promise<void>(resolve => {
      conn.on('connect', () => resolve());
    });
    const connectionClosed = new Promise<void>(resolve => {
      conn.on('close', () => resolve());
    });

    await abortOnError(connected, error);

    const proc = conn.spawn('xslt', args, {env: {}});
    const exitStatus = new Promise<number>((resolve, reject) => {
      proc.on('exit', (signal: number | null) => {
        if (signal === null) {
          reject(
            new InternalError(
              'Error communicating with xslt-nailgun server: nail process was killed'
            )
          );
        } else {
          resolve(signal);
        }
      });
    });

    const stdoutData = new BufferList();
    const stderrData = new BufferList();
    proc.stdout.pipe(stdoutData);
    proc.stderr.pipe(stderrData);
    proc.stdin.end(stdin);

    const [status] = await abortOnError(
      Promise.all([exitStatus, connectionClosed]),
      error
    );

    if (status === EXIT_STATUS_OK) {
      return stdoutData.slice();
    } else if (status === EXIT_STATUS_USER_ERROR) {
      throw new UserError(
        `\
XSLT evaluation produced an error: ${stderrData.toString()}`,
        options
      );
    } else {
      if (status === EXIT_STATUS_INTERNAL_ERROR) {
        throw new InternalError(`\
XSLT nail failed to execute transform due to an internal error\
${errorMessageOrFallback(
  stderrData.toString(),
  ' but no error message is available.'
)}`);
      } else {
        const nailErrorMsg = errorMessageOrFallback(
          stderrData.toString(),
          ', but no error message is available.'
        );
        const serverStderrMsg = errorMessageOrFallback(
          process.getCurrentStderr(),
          '',
          '\n\nNailgun server stderr output (this may or may not relate to the above error):\n%s'
        );

        throw new InternalError(`\
XSLT nail exited with unexpected status ${status}${nailErrorMsg}${serverStderrMsg}`);
      }
    }
  }
}

function errorMessageOrFallback(
  error: string,
  fallback: string,
  template?: string
) {
  template = template || ': %s';
  if (error.length > 0) {
    return util.format(template, error);
  }
  return fallback;
}

function abortOnError<T>(
  promise: Promise<T>,
  errorProducer: Promise<unknown>
): Promise<T> {
  // The second promise can only reject, so the returned promise can be cast
  // to T as it can only ever resolve to T.
  return Promise.race([
    promise,
    errorProducer.then(() => {
      throw new Error('errorProducer unexpectedly resolved');
    }),
  ]) as Promise<T>;
}

export async function execute(options: ExecuteOptions & CreateOptions) {
  return using(XSLTExecutor.getInstance(options), executor =>
    executor.execute(options)
  );
}
