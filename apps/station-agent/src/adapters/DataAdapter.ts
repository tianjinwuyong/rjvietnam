// Data Source Adapter Framework for MES Missioner
// All adapters implement the DataAdapter interface and emit NormalizedRecords

export type AdapterType =
  | 'file'
  | 'http'
  | 'tcp'
  | 'websocket'
  | 'mqtt'
  | 'db'
  | 'opc-ua'
  | 'modbus'
  | 'serial'
  | 'scanner-bridge';

export interface NormalizedRecord {
  source: string;         // adapter name/id
  timestamp: string;      // ISO 8601
  sn?: string;            // PCB serial (if extractable)
  type: 'result' | 'measurement' | 'event' | 'log' | 'unknown';
  data: Record<string, unknown>;
  adapterType: AdapterType | 'scanner-bridge';
}

export interface AdapterOptions {
  id: string;
  type: AdapterType;
  name: string;
  enabled?: boolean;
  stationCode?: string;   // station this adapter belongs to — used for per-station alert rule isolation
  // Connection
  host?: string;
  port?: number;
  url?: string;
  path?: string;
  // Protocol
  protocol?: string;
  snExtractRegex?: string;    // regex with one capture group for SN
  pollIntervalMs?: number;
  // Auth
  username?: string;
  password?: string;
  // Serial
  baudRate?: number;
  dataBits?: number;
  parity?: 'none' | 'even' | 'odd';
  stopBits?: number;
  // File
  filePatterns?: string[];    // glob patterns for chokidar
  // OPC-UA
  opcuaNodeId?: string;
  // DB
  database?: string;
  sqlQuery?: string;
  // MQTT
  topic?: string;
  qos?: 0 | 1 | 2;
  // Generic
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  sampleRecord?: NormalizedRecord;
}

// --- Event emitter mixin ---
type EventCallback<T> = (data: T) => void;

export abstract class DataAdapter {
  abstract readonly id: string;
  abstract readonly type: AdapterType;
  abstract readonly name: string;
  get stationCode(): string { return this._stationCode; }

  protected _enabled = true;
  protected _connected = false;
  protected _stationCode = '';

  constructor(opts?: AdapterOptions) {
    if (opts) {
      this._stationCode = opts.stationCode ?? '';
      this._enabled = opts.enabled ?? true;
    }
  }

  private recordCallbacks: EventCallback<NormalizedRecord>[] = [];
  private errorCallbacks: EventCallback<Error>[] = [];
  private statusCallbacks: EventCallback<{ connected: boolean }>[] = [];

  async connect(): Promise<void> {
    if (this._connected) return;
    await this._connect();
    this._connected = true;
    this.emitStatus({ connected: true });
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    await this._disconnect();
    this._connected = false;
    this.emitStatus({ connected: false });
  }

  get connected(): boolean {
    return this._connected;
  }

  set enabled(v: boolean) {
    this._enabled = v;
  }
  get enabled(): boolean {
    return this._enabled;
  }

  onRecord(cb: EventCallback<NormalizedRecord>): void {
    this.recordCallbacks.push(cb);
  }

  onError(cb: EventCallback<Error>): void {
    this.errorCallbacks.push(cb);
  }

  onStatusChange(cb: EventCallback<{ connected: boolean }>): void {
    this.statusCallbacks.push(cb);
  }

  protected emitRecord(record: NormalizedRecord): void {
    if (!this._enabled) return;
    for (const cb of this.recordCallbacks) cb(record);
  }

  protected emitError(err: Error): void {
    for (const cb of this.errorCallbacks) cb(err);
  }

  protected emitStatus(status: { connected: boolean }): void {
    for (const cb of this.statusCallbacks) cb(status);
  }

  abstract testConnection(): Promise<ConnectionTestResult>;
  abstract query<T = NormalizedRecord>(): Promise<T[]>;

  protected abstract _connect(): Promise<void>;
  protected abstract _disconnect(): Promise<void>;

  /** Extract SN from raw data string using configured regex */
  protected extractSn(raw: string, regex?: string): string | undefined {
    if (!regex) return undefined;
    try {
      const re = new RegExp(regex);
      const match = raw.match(re);
      return match?.[1];
    } catch {
      return undefined;
    }
  }
}
