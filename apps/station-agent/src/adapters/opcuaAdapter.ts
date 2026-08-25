// OPC-UA Client Adapter — requires Node.js runtime (node-opcua)
// In browser, this adapter throws with guidance to use an OPC-UA-to-HTTP bridge
import { DataAdapter, AdapterOptions, NormalizedRecord, ConnectionTestResult } from './DataAdapter.js';

interface OpcUaAdapterOptions extends AdapterOptions {
  endpoint: string;
  nodeId?: string;
  username?: string;
  password?: string;
  pollIntervalMs?: number;
}

export class OpcUaAdapter extends DataAdapter {
  readonly type = 'opc-ua' as const;
  private opts: OpcUaAdapterOptions;
  constructor(opts: OpcUaAdapterOptions) { super(opts); this.opts = { pollIntervalMs: 5000, ...opts }; }
  get id(): string { return this.opts.id; }
  get name(): string { return this.opts.name; }

  protected async _connect(): Promise<void> {
    throw new Error('OPC-UA adapter requires Node.js runtime. Deploy an OPC-UA-to-HTTP bridge on the station PC and connect via HTTP adapter instead.');
  }

  protected async _disconnect(): Promise<void> {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { success: false, message: 'OPC-UA requires Node.js — use a backend OPC-UA proxy endpoint via HTTP adapter' };
  }

  async query<T = NormalizedRecord>(): Promise<T[]> { return []; }
}
