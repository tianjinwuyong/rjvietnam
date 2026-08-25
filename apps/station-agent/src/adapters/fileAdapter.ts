// File Adapter — parses data files (json, csv, xlsx) via URL or operator file upload
// chokidar/fs not available in browser — for file watching, use HTTP polling or operator upload
import { DataAdapter, AdapterOptions, NormalizedRecord, ConnectionTestResult } from './DataAdapter.js';

interface FileAdapterOptions extends AdapterOptions {
  filePatterns?: string[];
  pollingMs?: number;
}

export class FileAdapter extends DataAdapter {
  readonly type = 'file' as const;
  private opts: FileAdapterOptions;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seenUrls = new Set<string>();

  constructor(opts: FileAdapterOptions) {
    super(opts);
    this.opts = opts;
  }

  get id(): string { return this.opts.id; }
  get name(): string { return this.opts.name; }

  protected async _connect(): Promise<void> {
    // If a URL is provided (http(s)://...), poll it for new data
    if (this.opts.url) {
      this.pollTimer = setInterval(() => this.fetchUrl(), this.opts.pollingMs ?? 10000);
      await this.fetchUrl();
    } else {
      this.emitError(new Error('File adapter: set config.url to an HTTP endpoint returning file data, or use the operator file-upload feature.'));
    }
  }

  protected async _disconnect(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.seenUrls.clear();
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.opts.url) return { success: false, message: 'No URL configured — set config.url for HTTP file polling' };
    const start = Date.now();
    try {
      const res = await fetch(this.opts.url, { signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      if (!res.ok) return { success: false, message: `HTTP ${res.status}`, latencyMs: latency };
      const text = await res.text();
      return { success: true, message: `HTTP ${res.status} — ${text.length} bytes`, latencyMs: latency };
    } catch (err: unknown) {
      return { success: false, message: String(err), latencyMs: Date.now() - start };
    }
  }

  async query<T = NormalizedRecord>(): Promise<T[]> { return []; }

  /** Fetch and emit records from URL (HTTP file polling) */
  private async fetchUrl(): Promise<void> {
    if (!this.opts.url) return;
    try {
      const res = await fetch(this.opts.url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) { this.emitError(new Error(`HTTP ${res.ok}`)); return; }
      const contentType = res.headers.get('content-type') ?? '';
      const text = await res.text();
      const etag = res.headers.get('etag') ?? text.slice(0, 64);
      if (this.seenUrls.has(etag)) return; // skip if unchanged (use ETag / last-modified)
      this.seenUrls.add(etag);
      const records = this.parseContent(text, contentType);
      for (const record of records) this.emitRecord(record);
    } catch (err: unknown) {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private parseContent(raw: string, contentType: string): NormalizedRecord[] {
    if (contentType.includes('json') || raw.trim().startsWith('[') || raw.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        return this.normalizeItems(items);
      } catch { /* fall through */ }
    }
    // CSV
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return this.normalizeItems(lines.slice(1).map(line => {
      const values = line.split(',');
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => { obj[h] = values[i]?.trim() ?? ''; });
      return obj;
    }));
  }

  private normalizeItems(items: unknown[]): NormalizedRecord[] {
    const timestamp = new Date().toISOString();
    return items.map((item) => {
      const obj = item as Record<string, unknown>;
      return {
        source: this.id,
        timestamp,
        sn: (obj.sn ?? obj.serial ?? obj.serial_no) as string | undefined
          ?? this.extractSn(JSON.stringify(obj), this.opts.snExtractRegex),
        type: this.inferType(obj),
        data: obj,
        adapterType: 'file' as const,
      };
    });
  }

  private inferType(record: Record<string, unknown>): NormalizedRecord['type'] {
    const keys = Object.keys(record).map(k => k.toLowerCase());
    if (keys.some(k => k.includes('defect') || k.includes('ng') || k.includes('fail'))) return 'result';
    if (keys.some(k => k.includes('temp') || k.includes('pressure') || k.includes('voltage') || k.includes('current'))) return 'measurement';
    if (keys.some(k => k.includes('event') || k.includes('alarm') || k.includes('alert'))) return 'event';
    if (keys.some(k => k.includes('log') || k.includes('message'))) return 'log';
    return 'unknown';
  }

  /** Operator-triggered file parse (called by DataSourcePanel when operator uploads a file) */
  async parseFileContent(content: string, filename: string): Promise<void> {
    const records = this.parseContent(content, this.guessContentType(filename));
    for (const record of records) this.emitRecord(record);
  }

  private guessContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'json': return 'application/json';
      case 'csv': return 'text/csv';
      case 'xlsx': case 'xls': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      default: return 'text/plain';
    }
  }
}
