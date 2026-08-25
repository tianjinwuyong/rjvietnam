// TCP Socket Adapter — raw socket / JSON-framed / delimited PLC protocols
// In browser: throws with guidance to use serial-to-TCP bridge + TCP adapter
import { DataAdapter, AdapterOptions, NormalizedRecord, ConnectionTestResult } from './DataAdapter.js';

interface TcpAdapterOptions extends AdapterOptions {
  host: string;
  port: number;
  protocol?: 'json' | 'delimited' | 'binary' | 'raw';
  delimiter?: string;
  snExtractRegex?: string;
}

export class TcpAdapter extends DataAdapter {
  readonly type = 'tcp' as const;
  private opts: TcpAdapterOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private buffer = '';

  constructor(opts: TcpAdapterOptions) {
    super(opts);
    this.opts = { protocol: 'json', delimiter: '\n', ...opts };
  }

  get id(): string { return this.opts.id; }
  get name(): string { return this.opts.name; }

  protected async _connect(): Promise<void> {
    let net: typeof import('net') | null = null;
    try { net = await import('net'); } catch {
      throw new Error('TCP adapter requires Node.js. On station PC, run a serial-to-TCP or device-to-TCP bridge, then connect via this TCP adapter.');
    }
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client = (net as any).createConnection({ host: this.opts.host, port: this.opts.port }, () => { resolve(); });
      this.client.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('utf-8');
        const lines = this.buffer.split(this.opts.delimiter ?? '\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) { if (line.trim()) this.processLine(line); }
      });
      this.client.on('error', (err: Error) => { this.emitError(err); if (!this._connected) reject(err); });
      this.client.on('close', () => {
        this._connected = false;
        this.emitStatus({ connected: false });
        if (this._enabled) setTimeout(() => { this.connect().catch(() => {}); }, 3000);
      });
    });
  }

  protected async _disconnect(): Promise<void> {
    this.client?.end();
    this.client = null;
    this.buffer = '';
  }

  async testConnection(): Promise<ConnectionTestResult> {
    let net: typeof import('net') | null = null;
    try { net = await import('net'); } catch { return { success: false, message: 'TCP not available in browser' }; }
    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sock = (net as any).createConnection({ host: this.opts.host, port: this.opts.port! }, () => {
        const latency = Date.now() - Date.now();
        sock.end();
        resolve({ success: true, message: `Connected to ${this.opts.host}:${this.opts.port}`, latencyMs: latency });
      });
      sock.on('error', (err: Error) => resolve({ success: false, message: String(err), latencyMs: Date.now() - Date.now() }));
      sock.setTimeout(3000, () => { sock.destroy(); resolve({ success: false, message: 'Connection timeout', latencyMs: Date.now() - Date.now() }); });
    });
  }

  async query<T = NormalizedRecord>(): Promise<T[]> { return []; }

  private processLine(line: string): void {
    try {
      let data: Record<string, unknown>;
      if (this.opts.protocol === 'json') {
        data = JSON.parse(line);
      } else if (this.opts.protocol === 'delimited') {
        data = {};
        for (const pair of line.split(',')) {
          const [k, v] = pair.split('='); if (k) data[k.trim()] = v?.trim() ?? '';
        }
      } else {
        data = { raw: line };
      }
      const record: NormalizedRecord = { source: this.id, timestamp: new Date().toISOString(), sn: this.extractSn(line, this.opts.snExtractRegex), type: 'unknown', data, adapterType: 'tcp' };
      this.emitRecord(record);
    } catch (err: unknown) { this.emitError(err instanceof Error ? err : new Error(String(err))); }
  }
}
