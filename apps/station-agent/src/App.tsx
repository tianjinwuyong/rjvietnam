import { useState, useEffect, useCallback, useRef } from 'react';
import { t, type Locale } from './i18n';
import { getStations, subscribeNgDefect, type NgDefectPayload, getWorkOrder, loginStation, logoutStation, getStoredOperator, getStoredStationCode } from './mesApi';
import { getTodayStats, getPendingSyncCount, db } from './db';
import { processScan } from './scanEngine';
import { startSyncManager, stopSyncManager, onOffline, setHeartbeatContext } from './syncManager';
import { useBarcodeCapture } from './useBarcodeCapture';
import { StationSelector } from './components/StationSelector';
import { ScanPanel } from './components/ScanPanel';
import { LiveNgAlerts } from './components/LiveNgAlerts';
import { StatsPanel } from './components/StatsPanel';
import { SyncStatus } from './components/SyncStatus';
import { OperatorLogin } from './components/OperatorLogin';
import { DataSourcePanel } from './components/DataSourcePanel';
import { DataSourceRecordTable } from './components/DataSourceRecordTable';
import { AlertRuleEditor } from './components/AlertRuleEditor';
import { AlertToast } from './components/AlertToast';
import { DataSourceManager } from './adapters/index';
import type { NormalizedRecord } from './adapters/DataAdapter.js';
import { AlertRuleEngine, type AlertResult } from './alertRuleEngine';
import type { DataSourceConfig } from './db';

interface StationInfo {
  code: string;
  name_zh: string;
  line_code: string;
}

interface NgAlert extends NgDefectPayload {
  id: string;
  receivedAt: Date;
  expiresAt: number;
}

type TabId = 'scan' | 'datasource' | 'feed';

export function App() {
  const locale: Locale = 'zh-CN';

  const [stations, setStations] = useState<StationInfo[]>([]);
  const [selectedStation, setSelectedStation] = useState<StationInfo | null>(null);
  const [operator, setOperator] = useState('');
  const [workOrderCode, setWorkOrderCode] = useState('');
  const [stats, setStats] = useState({ pass: 0, ng: 0, dup: 0 });
  const [isOnline, setIsOnline] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  const [alerts, setAlerts] = useState<NgAlert[]>([]);
  const [lastResult, setLastResult] = useState<Awaited<ReturnType<typeof processScan>> | null>(null);
  const [ngReason, setNgReason] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const saved = localStorage.getItem('mes_missioner_tab');
    return (saved === 'scan' || saved === 'datasource' || saved === 'feed') ? saved : 'scan';
  });

  // Data source manager + alert rule engine
  const [dsManager] = useState(() => {
    const mgr = new DataSourceManager(db);
    const engine = new AlertRuleEngine(db);
    engine.loadRules().catch(console.error);
    mgr.setRuleEngine(engine);
    return mgr;
  });
  const [liveRecords, setLiveRecords] = useState<NormalizedRecord[]>([]);
  const [adapterStatuses, setAdapterStatuses] = useState<Array<{ id: string; name: string; type: string; connected: boolean; enabled: boolean; stationCode: string }>>([]);
  const [selectedAdapterId, setSelectedAdapterId] = useState<string | null>(null);
  const ruleEngineRef = useRef<AlertRuleEngine | null>(null);

  // Alert toasts for NG trigger
  const [alertToasts, setAlertToasts] = useState<AlertResult[]>([]);

  // Offline banner
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);

  // Work order validation
  const [woValidated, setWoValidated] = useState(false);
  const [woValidating, setWoValidating] = useState(false);

  // Shift log tracking — refs survive re-renders
  const shiftLogIdRef = useRef<number | undefined>(undefined);

  // Persist selected station
  useEffect(() => {
    const saved = localStorage.getItem('mes_missioner_station');
    if (saved && stations.length > 0) {
      const found = stations.find((s) => s.code === saved);
      if (found) setSelectedStation(found);
    }
  }, [stations]);

  useEffect(() => {
    if (selectedStation) localStorage.setItem('mes_missioner_station', selectedStation.code);
    else localStorage.removeItem('mes_missioner_station');
  }, [selectedStation]);

  // Persist operator
  useEffect(() => {
    if (operator) localStorage.setItem('mes_missioner_operator', operator);
    else localStorage.removeItem('mes_missioner_operator');
  }, [operator]);

  useEffect(() => {
    const saved = localStorage.getItem('mes_missioner_operator');
    if (saved) setOperator(saved);
  }, []);

  // Persist active tab
  useEffect(() => {
    localStorage.setItem('mes_missioner_tab', activeTab);
  }, [activeTab]);

  // Load stations from MES API with 10min polling
  useEffect(() => {
    getStations()
      .then((data: unknown) => setStations((data as StationInfo[]) ?? []))
      .catch(() => {});
    const iv = setInterval(() => {
      getStations()
        .then((data: unknown) => setStations((data as StationInfo[]) ?? []))
        .catch(() => {});
    }, 10 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  // Restore operator session after stations load (survives page refresh)
  useEffect(() => {
    if (stations.length === 0) return;
    const savedOperator = getStoredOperator();
    const savedStationCode = getStoredStationCode();
    if (!savedOperator || !savedStationCode) return;
    // Only auto-login if station still exists
    const stationStillValid = stations.some((s) => s.code === savedStationCode);
    if (!stationStillValid) return;
    setOperator(savedOperator);
    // Also restore station selection
    const station = stations.find((s) => s.code === savedStationCode);
    if (station) setSelectedStation(station);
    // Re-login to get fresh token
    loginStation(savedOperator, savedStationCode).catch(() => {});
    // Set heartbeat context so sync manager sends pings immediately
    setHeartbeatContext(savedStationCode, savedOperator);
  }, [stations]);

  // Refresh stats
  async function refreshStats() {
    setStats(await getTodayStats());
    setPendingSync(await getPendingSyncCount());
  }

  // Start sync manager
  useEffect(() => {
    refreshStats();
    startSyncManager((online, pending) => {
      setIsOnline(online);
      setPendingSync(pending);
    });
    onOffline(() => setShowOfflineBanner(true));
    return () => stopSyncManager();
  }, []);

  // SSE subscription for live NG alerts
  useEffect(() => {
    if (!selectedStation) return;
    const unsubscribe = subscribeNgDefect(
      (payload) => {
        const alert: NgAlert = {
          ...payload,
          id: `ng_${Date.now()}`,
          receivedAt: new Date(),
          expiresAt: Date.now() + 30_000,
        };
        setAlerts((prev) => [alert, ...prev].slice(0, 10));
      },
      selectedStation.code,
    );
    return unsubscribe;
  }, [selectedStation]);

  // Auto-dismiss expired alerts
  useEffect(() => {
    const iv = setInterval(() => {
      setAlerts((prev) => prev.filter((a) => Date.now() < a.expiresAt));
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  // Handle scanned SN
  async function handleScan(sn: string) {
    if (!selectedStation) {
      alert(t('station.select', locale));
      return;
    }

    const ctx = {
      stationCode: selectedStation.code,
      lineName: selectedStation.line_code,
      operator,
      workOrderCode,
    };

    // If result is NG — ask for defect code
    const outcome = await processScan(sn, ctx);
    setLastResult(outcome);

    if (outcome.outcome === 'NG' && outcome.source === 'local_ng_pool') {
      setNgReason(t('ng.blockReason', locale));
    }

    await refreshStats();
  }

  // Handle barcode scanner input (global keyboard capture)
  const onBarcodeScan = useCallback((sn: string) => {
    handleScan(sn);
  }, [selectedStation, operator, workOrderCode]); // eslint-disable-line

  useBarcodeCapture(onBarcodeScan);

  // Init DataSourceManager — load persisted configs and connect adapters
  useEffect(() => {
    const init = async () => {
      const configs = await db.dataSourceConfigs.toArray();
      for (const cfg of configs) {
        if (cfg.enabled) {
          try {
            await dsManager.register(cfg.config);
          } catch (err) {
            console.error(`[${cfg.id}] failed to connect:`, err);
          }
        }
      }
      setAdapterStatuses(dsManager.getAdapterStatus());
    };
    init();

    dsManager.onRecord((record) => {
      setLiveRecords((prev) => [record, ...prev].slice(0, 500));
    });
    dsManager.onNgTrigger((alert) => {
      setAlertToasts((prev) => [alert, ...prev].slice(0, 20));
    });
    dsManager.onStatusChange(() => {
      setAdapterStatuses(dsManager.getAdapterStatus());
    });

    ruleEngineRef.current = dsManager.getRuleEngine();
  }, [dsManager]);

  async function handleDsConfigSaved(cfg: DataSourceConfig) {
    if (cfg.enabled) {
      await dsManager.register(cfg.config);
    } else {
      await dsManager.unregister(cfg.id);
    }
    setAdapterStatuses(dsManager.getAdapterStatus());
  }

  async function handleDsToggleEnabled(id: string, enabled: boolean) {
    await db.dataSourceConfigs.update(id, { enabled });
    await dsManager.updateEnabled(id, enabled);
    setAdapterStatuses(dsManager.getAdapterStatus());
  }

  async function handleDsRemove(id: string) {
    await dsManager.unregister(id);
    setAdapterStatuses(dsManager.getAdapterStatus());
  }

  const selectedAdapter = adapterStatuses.find((a) => a.id === selectedAdapterId);

  const TABS: { id: TabId; label: string }[] = [
    { id: 'scan', label: t('scan_tab', locale) },
    { id: 'datasource', label: t('datasource_tab', locale) },
    { id: 'feed', label: t('feed_tab', locale) },
  ];

  async function handleTestConnection(cfg: DataSourceConfig) {
    return dsManager.testConnection(cfg.config);
  }

  return (
    <div style={{ padding: 20, maxWidth: 700, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ textAlign: 'center', marginBottom: 20 }}>
        MES Missioner
      </h1>

      {/* Sync status */}
      <SyncStatus locale={locale} isOnline={isOnline} pendingCount={pendingSync} />

      {/* Offline dismissible banner */}
      {showOfflineBanner && (
        <div style={{
          padding: '10px 16px',
          background: '#fff3cd',
          border: '2px solid #f59e0b',
          borderRadius: 8,
          marginBottom: 12,
          color: '#92400e',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>⚠️ {t('offline_banner', locale)}</span>
          <button
            onClick={() => setShowOfflineBanner(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#92400e', fontSize: 16 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Operator login */}
      <OperatorLogin
        locale={locale}
        operator={operator}
        onLogin={async (sn) => {
          // Obtain JWT from MES API
          if (selectedStation) {
            try {
              await loginStation(sn, selectedStation.code);
            } catch (err) {
              console.error('[Auth] Station login failed:', err);
            }
          }
          setOperator(sn);
          if (selectedStation) setHeartbeatContext(selectedStation.code, sn);
          // Write shift log entry
          const entryId = await db.shiftLog.add({
            operator: sn,
            stationCode: selectedStation?.code ?? '',
            loginAt: new Date().toISOString(),
          });
          shiftLogIdRef.current = entryId as number;
        }}
        onLogout={async () => {
          // Update shift log with logout time
          if (shiftLogIdRef.current) {
            await db.shiftLog.update(shiftLogIdRef.current, {
              logoutAt: new Date().toISOString(),
            });
            shiftLogIdRef.current = null as unknown as undefined;
          }
          setOperator('');
          logoutStation();
        }}
      />

      {/* Station selector */}
      <StationSelector
        locale={locale}
        stations={stations}
        selected={selectedStation}
        onSelect={(station) => {
          setSelectedStation(station);
          // Re-login with new station if operator is already logged in
          if (operator) {
            loginStation(operator, station.code).catch(() => {});
            setHeartbeatContext(station.code, operator);
          }
        }}
        onRefresh={() => {
          getStations()
            .then((data: unknown) => setStations((data as StationInfo[]) ?? []))
            .catch(() => {});
        }}
      />

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid #e5e7eb' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? '#3b82f6' : '#6b7280',
              marginBottom: -2,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Scan ──────────────────────────────────────────────── */}
      {activeTab === 'scan' && (
        <>
          {/* Stats */}
          <StatsPanel locale={locale} stats={stats} />

          {/* Live NG alerts */}
          <LiveNgAlerts locale={locale} alerts={alerts} />

          {/* Scan panel */}
          <ScanPanel
            locale={locale}
            disabled={!selectedStation}
            onScan={handleScan}
            lastResult={lastResult}
          />

          {/* NG reason dialog */}
          {ngReason && (
            <div
              style={{
                padding: 12,
                background: '#fee2e2',
                border: '2px solid #fca5a5',
                borderRadius: 8,
                marginBottom: 16,
                color: '#991b1b',
              }}
            >
              ⚠️ {ngReason}
              <button
                onClick={() => setNgReason('')}
                style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b' }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Work order (optional) */}
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              placeholder={t('workorder_placeholder', locale)}
              value={workOrderCode}
              onChange={(e) => {
                setWorkOrderCode(e.target.value);
                setWoValidated(false);
              }}
              onBlur={async () => {
                if (!workOrderCode.trim()) { setWoValidated(false); return; }
                setWoValidating(true);
                const wo = await getWorkOrder(workOrderCode.trim()).catch(() => null);
                setWoValidated(!!wo);
                setWoValidating(false);
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 14,
                borderRadius: 8,
                border: `1px solid ${workOrderCode && !woValidating ? (woValidated ? '#22c55e' : '#ef4444') : '#d1d5db'}`,
              }}
            />
            {workOrderCode && !woValidating && !woValidated && (
              <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{t('wo.notFound', locale)}</div>
            )}
          </div>
        </>
      )}

      {/* ── Tab: Data Sources ─────────────────────────────────────── */}
      {activeTab === 'datasource' && (
        <>
          <DataSourcePanel
            onConfigSaved={handleDsConfigSaved}
            onTestConnection={handleTestConnection}
            onRemove={handleDsRemove}
            onToggleEnabled={handleDsToggleEnabled}
          />

          {/* Adapter status summary */}
          {adapterStatuses.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4>{t('datasource_adapter_status', locale)}</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {adapterStatuses.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAdapterId(selectedAdapterId === a.id ? null : a.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: selectedAdapterId === a.id ? '2px solid #3b82f6' : '1px solid #ddd',
                      background: a.connected ? '#d4edda' : '#f8d7da',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    {a.name} ({a.type}) — {a.connected ? '🟢' : '🔴'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Alert rules for selected adapter */}
          {selectedAdapterId && ruleEngineRef.current && (
            <AlertRuleEditor
              adapterId={selectedAdapterId}
              adapterName={selectedAdapter?.name ?? selectedAdapterId}
              stationCode={selectedAdapter?.stationCode ?? selectedAdapterId}
              engine={ruleEngineRef.current}
              onRuleChange={() => {}}
            />
          )}
        </>
      )}

      {/* ── Tab: Live Feed ───────────────────────────────────────── */}
      {activeTab === 'feed' && (
        <DataSourceRecordTable records={liveRecords} />
      )}

      {/* NG Alert Toasts */}
      <AlertToast alerts={alertToasts} locale={locale} />

      <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 24 }}>
        MES Missioner v0.1 — {selectedStation ? selectedStation.name_zh : '未选工位'}
        {operator ? ` | ${operator}` : ''}
      </div>
    </div>
  );
}
