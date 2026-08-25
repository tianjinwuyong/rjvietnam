// MQTT Adapter — subscribes to MQTT topics for IoT/sensor data
import { DataAdapter, AdapterOptions, NormalizedRecord, ConnectionTestResult } from './DataAdapter.js';

interface MqttAdapterOptions extends AdapterOptions {
  brokerUrl: string;
  topic: string;
  qos?: 0 | 1 | 2;
  username?: string;
  password?: string;
  snExtractRegex?: string;
}

export class MqttAdapter extends DataAdapter {
  readonly type = 'mqtt' as const;
  private opts: MqttAdapterOptions;
  private client: import('mqtt').MqttClient | null = null;

  constructor(opts: MqttAdapterOptions) {
    super();
    this.opts = { qos: 0, ...opts };
  }

  get id(): string { return this.opts.id; }
  get name(): string { return this.opts.name; }

  protected async _connect(): Promise<void> {
    const mqtt = await import('mqtt');
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.opts.brokerUrl, {
        username: this.opts.username,
        password: this.opts.password,
        reconnectPeriod: 3000,
      });

      this.client.on('connect', () => {
        this.client!.subscribe(this.opts.topic!, { qos: this.opts.qos ?? 0 }, (err) => {
          if (err) { this.emitError(err); reject(err); }
          else resolve();
        });
      });

      this.client.on('message', (_topic: string, payload: Buffer) => {
        this.processPayload(payload);
      });

      this.client.on('error', (err) => {
        this.emitError(err);
        if (!this._connected) reject(err);
      });

      this.client.on('close', () => {
        this._connected = false;
        this.emitStatus({ connected: false });
      });
    });
  }

  protected async _disconnect(): Promise<void> {
    this.client?.end();
    this.client = null;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const mqtt = await import('mqtt');
      return new Promise((resolve) => {
        const c = mqtt.connect(this.opts.brokerUrl, {
          username: this.opts.username,
          password: this.opts.password,
          connectTimeout: 5000,
        });
        c.on('connect', () => {
          const latency = Date.now() - start;
          c.end();
          resolve({ success: true, message: `Connected to ${this.opts.brokerUrl}`, latencyMs: latency });
        });
        c.on('error', (err: Error) => resolve({ success: false, message: String(err), latencyMs: Date.now() - start }));
        setTimeout(() => { c.end(); resolve({ success: false, message: 'Connection timeout', latencyMs: Date.now() - start }); }, 5000);
      });
    } catch (err: unknown) {
      return { success: false, message: String(err) };
    }
  }

  async query<T = NormalizedRecord>(): Promise<T[]> { return []; }

  private processPayload(payload: Buffer): void {
    const raw = payload.toString('utf-8');
    try {
      let data: Record<string, unknown>;
      try { data = JSON.parse(raw); }
      catch { data = { raw }; }

      const record: NormalizedRecord = {
        source: this.id,
        timestamp: new Date().toISOString(),
        sn: this.extractSn(raw, this.opts.snExtractRegex),
        type: 'event',
        data,
        adapterType: 'mqtt',
      };
      this.emitRecord(record);
    } catch (err: unknown) {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
