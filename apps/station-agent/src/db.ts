import Dexie, { type Table } from 'dexie';
import type { AdapterOptions, NormalizedRecord, AdapterType } from './adapters/DataAdapter';
export type { AdapterOptions, NormalizedRecord, AdapterType };
import type { AlertRule } from './alertRuleEngine';

// ── Types ────────────────────────────────────────────────────────────────────

export type ScanResult = 'PASS' | 'NG' | 'DUP';

export interface SnRecord {
  id?: number;
  sn: string;
  result: ScanResult;
  time: string;
  source: 'scanner' | 'manual' | 'sync';
  station: string;
  lineName: string;
  operator: string;
  synced: boolean;
}

export interface NgPoolRecord {
  id?: number;
  sn: string;
  result: 'NG';
  time: string;
  source: string;
  station: string;
  lineName: string;
  operator: string;
  synced: boolean;
}

export interface SyncQueueItem {
  id?: number;
  action: 'add_sn' | 'add_ng' | 'add_dup';
  payload: Record<string, unknown>;
  createdAt: string;
  retries: number;
  nextRetryAt?: string;
  lastError?: string;
}

export interface DataSourceConfig {
  id: string;
  name: string;
  type: AdapterType;
  enabled: boolean;
  config: AdapterOptions;
  createdAt: string;
  updatedAt: string;
}

export interface DataSourceRecord extends NormalizedRecord {
  id?: number;
  adapterId: string;
}

export interface ShiftLogEntry {
  id?: number;
  operator: string;
  stationCode: string;
  loginAt: string;
  logoutAt?: string;
}

export interface AlertRetryItem {
  id?: number;
  alertRuleId: string;
  recordSn: string;
  expression: string;
  stationCode: string;
  attempts: number;
  nextRetryAt: string;
  createdAt: string;
  lastError?: string;
}

// ── Database ────────────────────────────────────────────────────────────────

export class StationDB extends Dexie {
  snRecords!: Table<SnRecord>;
  ngPool!: Table<NgPoolRecord>;
  dupPool!: Table<NgPoolRecord>;
  syncQueue!: Table<SyncQueueItem>;
  dataSourceConfigs!: Table<DataSourceConfig>;
  dataSourceRecords!: Table<DataSourceRecord>;
  alertRules!: Table<AlertRule>;
  shiftLog!: Table<ShiftLogEntry>;
  alertRetryQueue!: Table<AlertRetryItem>;

  constructor() {
    super('scanner_station_db');
    this.version(1).stores({
      snRecords: '++id, sn, result, time, synced',
      ngPool: '++id, sn, time, synced',
      dupPool: '++id, sn, time, synced',
      syncQueue: '++id, action, createdAt',
    });
    this.version(2).stores({
      dataSourceConfigs: 'id, type, enabled',
      dataSourceRecords: '++id, adapterId, sn, timestamp',
      alertRules: 'id, adapterId, stationCode, enabled',
    });
    this.version(3).stores({
      shiftLog: '++id, operator, stationCode, loginAt',
      alertRetryQueue: '++id, alertRuleId, stationCode, nextRetryAt',
    });
  }
}

export const db = new StationDB();

// ── Stats ───────────────────────────────────────────────────────────────────

export async function getTodayStats() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const all = await db.snRecords.toArray();
  const todayRecords = all.filter((r) => r.time.startsWith(today));
  return {
    pass: todayRecords.filter((r) => r.result === 'PASS').length,
    ng: todayRecords.filter((r) => r.result === 'NG').length,
    dup: todayRecords.filter((r) => r.result === 'DUP').length,
  };
}

export async function getPendingSyncCount() {
  return db.syncQueue.count();
}
