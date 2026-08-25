// HTTP / REST Adapter — polls a REST endpoint or receives webhooks
import { DataAdapter, AdapterOptions, NormalizedRecord, ConnectionTestResult } from './DataAdapter.js';

interface HttpAdapterOptions extends AdapterOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  pollIntervalMs?: number;
  body?: string;
}

export class HttpAdapter extends DataAdapter {
  readonly type = 'http' as const;
  private opts: HttpAdapterOptions;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: HttpAdapterOptions) {
    super(opts);
    this.opts = { method: 'GET', pollIntervalMs: 10000, ...opts };
  }

  get id(): string { return this.opts.id; }
  get name(): string { return this.opts.name; }

  protected async _connect(): Promise<void> {
    this.pollTimer = setInterval(() => this.fetch(), this.opts.pollIntervalMs ?? 10000);
    await this.fetch();
  }

  protected async _disconnect(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const res = await fetch(this.opts.url, {
        method: this.opts.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...this.opts.headers },
        body: this.opts.body ? JSON.stringify(this.opts.body) : undefined,
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - start;
      const text = await res.text();
      let sampleRecord: NormalizedRecord | undefined;
      try {
        const json = JSON.parse(text);
        const records = Array.isArray(json) ? json : [json];
        if (records.length > 0) {
          const r = records[0];
          sampleRecord = {
            source: this.id,
            timestamp: new Date().toISOString(),
            sn: this.extractSn(JSON.stringify(r), this.opts.snExtractRegex),
            type: 'unknown',
            data: r as Record<string, unknown>,
            adapterType: 'http',
          };
        }
      } catch { /* not JSON */ }
      return {
        success: res.ok,
        message: `HTTP ${res.status} ${res.statusText} — ${text.slice(0, 100)}`,
        latencyMs,
        sampleRecord,
      };
    } catch (err: unknown) {
      return { success: false, message: String(err), latencyMs: Date.now() - start };
    }
  }

  async query<T = NormalizedRecord>(): Promise<T[]> {
    const res = await fetch(this.opts.url, {
      method: this.opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...this.opts.headers },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const items = Array.isArray(json) ? json : [json];
      return items.map((item) => ({
        source: this.id,
        timestamp: new Date().toISOString(),
        sn: this.extractSn(JSON.stringify(item), this.opts.snExtractRegex),
        type: 'unknown' as const,
        data: item as Record<string, unknown>,
        adapterType: 'http' as const,
      })) as T[];
    } catch {
      return [];
    }
  }

  private async fetch(): Promise<void> {
    try {
      const records = await this.query();
      for (const record of records) {
        this.emitRecord(record);
      }
    } catch (err: unknown) {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
