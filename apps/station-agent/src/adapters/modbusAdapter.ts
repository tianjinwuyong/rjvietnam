// Modbus TCP / RTU Adapter — requires Node.js runtime (modbus-serial)
// In browser: throws with guidance to use a Modbus-to-HTTP bridge
import { DataAdapter, AdapterOptions, NormalizedRecord, ConnectionTestResult } from './DataAdapter.js';

interface ModbusAdapterOptions extends AdapterOptions {
  host?: string;
  port?: number;
  modbusType?: 'tcp' | 'rtu';
  unitId?: number;
  registers?: Array<{ address: number; count: number; name: string }>;
  pollIntervalMs?: number;
}

export class ModbusAdapter extends DataAdapter {
  readonly type = 'modbus' as const;
  private opts: ModbusAdapterOptions;
  constructor(opts: ModbusAdapterOptions) { super(opts); this.opts = { modbusType: 'tcp', unitId: 1, pollIntervalMs: 5000, port: 502, ...opts }; }
  get id(): string { return this.opts.id; }
  get name(): string { return this.opts.name; }

  protected async _connect(): Promise<void> {
    throw new Error('Modbus adapter requires Node.js runtime. Deploy a Modbus-to-HTTP bridge on the station PC and connect via HTTP adapter instead.');
  }

  protected async _disconnect(): Promise<void> {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { success: false, message: 'Modbus requires Node.js — use a backend Modbus proxy endpoint via HTTP adapter' };
  }

  async query<T = NormalizedRecord>(): Promise<T[]> { return []; }
}
