// Database Adapter — queries via backend DB proxy endpoint (not direct pg in browser)
import { DataAdapter, AdapterOptions, NormalizedRecord, ConnectionTestResult } from './DataAdapter.js';

interface DbAdapterOptions extends AdapterOptions {
  database: 'mysql' | 'postgresql' | 'sqlserver' | 'sqlite';
  host?: string;
  port?: number;
  databaseName?: string;
  username?: string;
  password?: string;
  sqlQuery?: string;
  pollIntervalMs?: number;
}

export class DbAdapter extends DataAdapter {
  readonly type = 'db' as const;
  private opts: DbAdapterOptions;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: DbAdapterOptions) {
    super(opts);
    this.opts = { pollIntervalMs: 10000, port: 5432, ...opts };
  }

  get id(): string { return this.opts.id; }
  get name(): string { return this.opts.name; }

  protected async _connect(): Promise<void> {
    if (this.opts.url) {
      this.pollTimer = setInterval(() => this.runQuery(), this.opts.pollIntervalMs ?? 10000);
      await this.runQuery();
    } else {
      this.emitError(new Error('DB adapter: set config.url to your backend DB proxy endpoint (e.g. /api/db-query). Direct DB access not available in browser.'));
    }
  }

  protected async _disconnect(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.opts.url) return { success: false, message: 'No backend proxy URL configured (set config.url)' };
    const start = Date.now();
    try {
      const res = await fetch(this.opts.url, { signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      return { success: res.ok, message: `HTTP ${res.status} — backend proxy ${res.ok ? 'reachable' : 'error'}`, latencyMs: latency };
    } catch (err: unknown) {
      return { success: false, message: String(err), latencyMs: Date.now() - start };
    }
  }

  async query<T = NormalizedRecord>(): Promise<T[]> {
    if (!this.opts.url) return [];
    try {
      const res = await fetch(this.opts.url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      const items = Array.isArray(rows) ? rows : [rows];
      const timestamp = new Date().toISOString();
      return items.map((row: Record<string, unknown>) => ({
        source: this.id,
        timestamp,
        sn: (row.sn ?? row.serial_no ?? row.serial) as string | undefined,
        type: 'result' as const,
        data: row,
        adapterType: 'db' as const,
      })) as T[];
    } catch (err: unknown) {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
      return [];
    }
  }

  private async runQuery(): Promise<void> {
    const records = await this.query();
    for (const record of records) this.emitRecord(record);
  }
}
