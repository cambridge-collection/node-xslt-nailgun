import {EventEmitter} from 'events';
import {Readable, Writable} from 'stream';
import {NetConnectOpts} from 'net';

interface JVMPinClientOptions {
	stdin?: 'all-after-request' |  'once-per-request' | 'all-before-request';
	heartbeatInterval?: null | false | number;
}

type CreateOptions = JVMPinClientOptions & Partial<NetConnectOpts>

export function createConnection(port?: number, host?: string, connectListener?: () => void): JVMPin;
export function createConnection(options?: CreateOptions, connectListener?: () => void): JVMPin;

interface SpawnOptions {
	env?: {[key: string]: string};
	cwd?: string;
}

interface JVMPin extends EventEmitter {
	spawn(command: string, args?: string[], options?: SpawnOptions): JVMPinProcess;
}

interface JVMPinProcess extends EventEmitter {
	readonly stdin: Writable;
	readonly stdout: Readable;
	readonly stderr: Readable;
	readonly killed: Boolean
	kill(): void
}
