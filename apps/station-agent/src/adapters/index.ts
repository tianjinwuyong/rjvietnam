// DataSourceManager — registry and lifecycle manager for all data source adapters
import { DataAdapter, AdapterOptions, NormalizedRecord, ConnectionTestResult, AdapterType } from './DataAdapter';
import { FileAdapter } from './fileAdapter';
import { HttpAdapter } from './httpAdapter';
import { TcpAdapter } from './tcpAdapter';
import { WsAdapter } from './wsAdapter';
import { MqttAdapter } from './mqttAdapter';
import { DbAdapter } from './dbAdapter';
import { OpcUaAdapter } from './opcuaAdapter';
import { ModbusAdapter } from './modbusAdapter';
import { SerialAdapter } from './serialAdapter';
import { ScannerBridgeAdapter } from './scannerBridgeAdapter';
import type { StationDB } from '../db';
import type { DataSourceRecord } from '../db';
import type { AlertResult } from '../alertRuleEngine';
import { checkSnUpstream } from '../mesApi';
import { postStationEvent } from '../mesApi';
import type { AlertRetryItem } from '../db';

type RecordCallback = (record: NormalizedRecord) => void;
type ErrorCallback = (err: Error, adapterId: string) => void;
type StatusCallback = (status: { adapterId: string; connected: boolean }) => void;
type NgTriggerCallback = (alert: AlertResult) => void;

export class DataSourceManager {
  private adapters = new Map<string, DataAdapter>();
  private _db: StationDB;
  private _ruleEngine: import('../alertRuleEngine.js').AlertRuleEngine | null = null;
  private recordCallbacks: RecordCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];
  private statusCallbacks: StatusCallback[] = [];
  private ngTriggerCallbacks: NgTriggerCallback[] = [];

  constructor(db: StationDB) {
    this._db = db;
  }

  setRuleEngine(engine: import('../alertRuleEngine.js').AlertRuleEngine): void {
    this._ruleEngine = engine;
  }

  getRuleEngine(): import('../alertRuleEngine.js').AlertRuleEngine | null {
    return this._ruleEngine;
  }

  onRecord(cb: RecordCallback): void {
    this.recordCallbacks.push(cb);
  }

  onAdapterError(cb: ErrorCallback): void {
    this.errorCallbacks.push(cb);
  }

  onStatusChange(cb: StatusCallback): void {
    this.statusCallbacks.push(cb);
  }

  onNgTrigger(cb: NgTriggerCallback): void {
    this.ngTriggerCallbacks.push(cb);
  }

  async register(opts: AdapterOptions): Promise<void> {
    const existing = this.adapters.get(opts.id);
    if (existing) {
      await existing.disconnect();
      this.adapters.delete(opts.id);
    }

    const adapter = this.factory(opts);
    adapter.onRecord(async (record) => {
      // Store in local DB keyed by SN
      if (record.sn) {
        const rec: DataSourceRecord = { ...record, adapterId: adapter.id };
        this._db.dataSourceRecords.put(rec).catch(() => {});

        // Upstream check — non-blocking, runs in background
        checkSnUpstream(record.sn).catch(() => {});
      }
      // Evaluate alert rules
      if (this._ruleEngine) {
        const alert = this._ruleEngine.evaluate(record, opts.stationCode);
        if (alert) {
          // Dispatch by action type
          if (alert.rule.action === 'forward_mes' && record.sn) {
            postStationEvent({
              stationCode: opts.stationCode ?? adapter.id,
              pcbSerial: record.sn,
              result: 'NG',
              eventType: 'ALERT',
              defectCode: alert.rule.name,
              defectDescription: `Alert rule triggered: ${alert.rule.expression}`,
            }).catch(async () => {
              if (!record.sn) return;
              // Queue for retry with exponential backoff
              const retryItem: AlertRetryItem = {
                alertRuleId: alert.rule.id,
                recordSn: record.sn,
                expression: alert.rule.expression,
                stationCode: opts.stationCode ?? adapter.id,
                attempts: 1,
                nextRetryAt: new Date(Date.now() + 30_000).toISOString(),
                createdAt: new Date().toISOString(),
              };
              await this._db.alertRetryQueue.add(retryItem).catch(() => {});
            });
          }
          for (const cb of this.ngTriggerCallbacks) cb(alert);
        }
      }
      // Emit to UI
      for (const cb of this.recordCallbacks) cb(record);
    });

    adapter.onError((err) => {
      for (const cb of this.errorCallbacks) cb(err, adapter.id);
    });

    adapter.onStatusChange((status) => {
      for (const cb of this.statusCallbacks) cb({ adapterId: adapter.id, ...status });
    });

    await adapter.connect();
    this.adapters.set(opts.id, adapter);
  }

  async unregister(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(id);
    }
  }

  async updateEnabled(id: string, enabled: boolean): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      adapter.enabled = enabled;
      if (!enabled && adapter.connected) {
        await adapter.disconnect();
      } else if (enabled && !adapter.connected) {
        await adapter.connect();
      }
    }
  }

  async reconnect(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.disconnect();
      await adapter.connect();
    }
  }

  async testConnection(opts: AdapterOptions): Promise<ConnectionTestResult> {
    const adapter = this.factory(opts);
    return adapter.testConnection();
  }

  getAdapter(id: string): DataAdapter | undefined {
    return this.adapters.get(id);
  }

  getAdapters(): Map<string, DataAdapter> {
    return this.adapters;
  }

  getAdapterStatus(): Array<{ id: string; name: string; type: AdapterType; connected: boolean; enabled: boolean; stationCode: string }> {
    return [...this.adapters.values()].map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      connected: a.connected,
      enabled: a.enabled,
      stationCode: (a as DataAdapter).stationCode,
    }));
  }

  private factory(opts: AdapterOptions): DataAdapter {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (opts: AdapterOptions) => opts as any;
    switch (opts.type) {
      case 'file':     return new FileAdapter(a(opts));
      case 'http':     return new HttpAdapter(a(opts));
      case 'tcp':      return new TcpAdapter(a(opts));
      case 'websocket':return new WsAdapter(a(opts));
      case 'mqtt':     return new MqttAdapter(a(opts));
      case 'db':       return new DbAdapter(a(opts));
      case 'opc-ua':   return new OpcUaAdapter(a(opts));
      case 'modbus':   return new ModbusAdapter(a(opts));
      case 'serial':   return new SerialAdapter(a(opts));
      case 'scanner-bridge': return new ScannerBridgeAdapter(a(opts));
      default:        throw new Error(`Unknown adapter type: ${opts.type}`);
    }
  }
}
