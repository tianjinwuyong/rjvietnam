// Serial / RS-232 Adapter — requires Electron or Tauri (native serial port access)
// In browser Vite app: use a serial-to-TCP bridge on the station PC instead
import { DataAdapter, AdapterOptions, NormalizedRecord, ConnectionTestResult } from './DataAdapter.js';

interface SerialAdapterOptions extends AdapterOptions {
  path: string;
  baudRate?: number;
  dataBits?: number;
  parity?: 'none' | 'even' | 'odd';
  stopBits?: number;
  delimiter?: string;
  protocol?: 'json' | 'delimited' | 'raw';
  snExtractRegex?: string;
}

export class SerialAdapter extends DataAdapter {
  readonly type = 'serial' as const;
  private opts: SerialAdapterOptions;
  constructor(opts: SerialAdapterOptions) {
    super(opts);
    this.opts = { baudRate: 9600, dataBits: 8, parity: 'none' as const, stopBits: 1, delimiter: '\n', protocol: 'delimited', ...opts };
  }
  get id(): string { return this.opts.id; }
  get name(): string { return this.opts.name; }

  protected async _connect(): Promise<void> {
    throw new Error('Serial port requires Electron or Tauri (native API not available in browser). Run a serial-to-TCP bridge on the station PC and connect via TCP adapter instead.');
  }

  protected async _disconnect(): Promise<void> {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { success: false, message: 'Serial port not available in browser. Use serial-to-TCP bridge + TCP adapter on the station PC.' };
  }

  async query<T = NormalizedRecord>(): Promise<T[]> { return []; }
}
