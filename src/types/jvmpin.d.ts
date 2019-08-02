import {EventEmitter} from 'events';
import {Duplex} from 'stream';

declare function createConnection(port?: number, host?: string): JVMPin;

declare interface JVMPinOptions {
    env?: {[key: string]: string};
    cwd?: string;
}

declare class JVMPin extends EventEmitter {
    public spawn(command: string, args?: string[], options?: JVMPinOptions): JVMPinProcess;
}

declare class JVMPinProcess extends EventEmitter {
    public readonly stdin: Duplex;
    public readonly stdout: Duplex;
    public readonly stderr: Duplex;
    public kill(signal: number): void;
}
