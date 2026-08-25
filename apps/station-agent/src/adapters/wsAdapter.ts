// WebSocket Client Adapter
import { DataAdapter, AdapterOptions, NormalizedRecord, ConnectionTestResult } from './DataAdapter.js';

interface WsAdapterOptions extends AdapterOptions {
  url: string;
  protocol?: 'json' | 'text';
  snExtractRegex?: string;
}

export class WsAdapter extends DataAdapter {
  readonly type = 'websocket' as const;
  private opts: WsAdapterOptions;
  private ws: import('ws').WebSocket | null = null;

  constructor(opts: WsAdapterOptions) {
    super(opts);
    this.opts = { protocol: 'json', ...opts };
  }

  get id(): string { return this.opts.id; }
  get name(): string { return this.opts.name; }

  protected async _connect(): Promise<void> {
    const { WebSocket } = await import('ws');
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.opts.url, { handshakeTimeout: 5000 });
      this.ws.on('open', () => { resolve(); });
      this.ws.on('message', (data: Buffer) => this.processMessage(data));
      this.ws.on('error', (err) => {
        this.emitError(err);
        if (!this._connected) reject(err);
      });
      this.ws.on('close', () => {
        this._connected = false;
        this.emitStatus({ connected: false });
        if (this._enabled) {
          setTimeout(() => { this.connect().catch(() => {}); }, 3000);
        }
      });
    });
  }

  protected async _disconnect(): Promise<void> {
    this.ws?.terminate();
    this.ws = null;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return new Promise((resolve) => {
      const start = Date.now();
      import('ws').then(({ WebSocket }) => {
        const ws = new WebSocket(this.opts.url);
        const timer = setTimeout(() => { ws.terminate(); resolve({ success: false, message: 'Connection timeout' }); }, 5000);
        ws.on('open', () => {
          clearTimeout(timer);
          ws.close();
          resolve({ success: true, message: `Connected to ${this.opts.url}`, latencyMs: Date.now() - start });
        });
        ws.on('error', (err: Error) => { clearTimeout(timer); resolve({ success: false, message: String(err) }); });
      }).catch((err: Error) => {
        resolve({ success: false, message: `WebSocket not available: ${err.message}` });
      });
    });
  }

  async query<T = NormalizedRecord>(): Promise<T[]> { return []; }

  private processMessage(data: Buffer): void {
    const raw = data.toString('utf-8');
    try {
      let parsed: Record<string, unknown>;
      if (this.opts.protocol === 'json') {
        parsed = JSON.parse(raw);
      } else {
        parsed = { raw };
      }

      const record: NormalizedRecord = {
        source: this.id,
        timestamp: new Date().toISOString(),
        sn: this.extractSn(raw, this.opts.snExtractRegex),
        type: 'unknown',
        data: parsed,
        adapterType: 'websocket',
      };
      this.emitRecord(record);
    } catch (err: unknown) {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
