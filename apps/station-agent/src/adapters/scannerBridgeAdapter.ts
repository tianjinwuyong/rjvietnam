// ScannerBridgeAdapter — connects to scanner_helper.py HTTP API (8088) + WebSocket (1003)
// scanner_helper.py is the existing Python scanner app on each station PC
import { DataAdapter, AdapterOptions, NormalizedRecord, ConnectionTestResult } from './DataAdapter.js';

interface ScannerBridgeAdapterOptions extends AdapterOptions {
  httpUrl: string;    // 'http://localhost:8088'
  wsUrl: string;     // 'ws://localhost:1003'
  stationCode: string;
  lineName: string;
  operator: string;
}

// WebSocket message format from scanner_helper.py:
// { "sn": "SN123", "result": "PASS"|"NG"|"DUP", "station": "...", "line_name": "...", "operator": "...", "time": "..." }

export class ScannerBridgeAdapter extends DataAdapter {
  readonly type = 'scanner-bridge' as const;
  private opts: ScannerBridgeAdapterOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ws: any = null;
  private cache: NormalizedRecord[] = [];

  constructor(opts: ScannerBridgeAdapterOptions) {
    super(opts);
    this.opts = opts;
  }

  get id(): string { return this.opts.id; }
  get name(): string { return this.opts.name; }

  protected async _connect(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let WebSocket: any = null;
    try { WebSocket = await import('ws'); } catch {
      throw new Error('WebSocket not available — use a browser that supports WebSocket or run scanner_helper.py on this PC');
    }

    // Fetch existing SN records from scanner_helper HTTP API
    try {
      const snRes = await fetch(`${this.opts.httpUrl}/sn_records`);
      if (snRes.ok) {
        const snData = await snRes.json() as Array<Record<string, unknown>>;
        this.cache = snData.map((r) => this.normalize(r));
      }
    } catch { /* scanner_helper not running — continue without cache */ }

    // Connect WebSocket for live scan events
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.ws = new (WebSocket as any)(this.opts.wsUrl);

      this.ws.on('open', () => { resolve(); });

      this.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString('utf-8')) as Record<string, unknown>;
          const record = this.normalize(msg);
          this.cache.push(record);
          if (this.cache.length > 500) this.cache = this.cache.slice(-500);
          this.emitRecord(record);
        } catch (err: unknown) {
          this.emitError(err instanceof Error ? err : new Error(String(err)));
        }
      });

      this.ws.on('error', (err: Error) => {
        this.emitError(err);
        if (!this._connected) reject(err);
      });

      this.ws.on('close', () => {
        this._connected = false;
        this.emitStatus({ connected: false });
        if (this._enabled) {
          setTimeout(() => { this.connect().catch(() => {}); }, 5000);
        }
      });
    });
  }

  protected async _disconnect(): Promise<void> {
    this.ws?.close();
    this.ws = null;
    this.cache = [];
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.opts.httpUrl}/stats`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        return { success: true, message: 'scanner_helper.py is running', latencyMs: Date.now() - start };
      }
      return { success: false, message: `HTTP ${res.status}`, latencyMs: Date.now() - start };
    } catch (err: unknown) {
      return { success: false, message: `Cannot reach scanner_helper.py on ${this.opts.httpUrl} — is it running?`, latencyMs: Date.now() - start };
    }
  }

  async query<T = NormalizedRecord>(): Promise<T[]> {
    return this.cache as T[];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalize(msg: Record<string, any>): NormalizedRecord {
    return {
      source: this.id,
      timestamp: (msg.time as string) ?? new Date().toISOString(),
      sn: msg.sn as string | undefined,
      type: 'result',
      data: {
        result: msg.result,
        station: msg.station ?? this.opts.stationCode,
        line: msg.line_name ?? this.opts.lineName,
        operator: msg.operator ?? this.opts.operator,
      },
      adapterType: 'scanner-bridge',
    };
  }
}
