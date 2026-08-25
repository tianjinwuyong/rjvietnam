// DataSourcePanel — Operator UI: add / edit / enable / disable / remove data source adapters
import { useState, useEffect } from 'react';
import { db } from '../db';
import { t } from '../i18n';
import type { AdapterType, DataSourceConfig } from '../db';

function emptyConfig(type: AdapterType): DataSourceConfig {
  return {
    id: crypto.randomUUID(),
    name: '',
    type,
    enabled: true,
    config: { id: crypto.randomUUID(), type, name: '', enabled: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

interface Props {
  onConfigSaved?: (config: DataSourceConfig) => void;
  onTestConnection?: (config: DataSourceConfig) => Promise<{ success: boolean; message: string }>;
  onRemove?: (id: string) => void;
  onToggleEnabled?: (id: string, enabled: boolean) => void;
}

export function DataSourcePanel({ onConfigSaved, onTestConnection, onRemove, onToggleEnabled }: Props) {
  const [configs, setConfigs] = useState<DataSourceConfig[]>([]);
  const [editing, setEditing] = useState<DataSourceConfig | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function load() {
    const all = await db.dataSourceConfigs.toArray();
    setConfigs(all);
  }

  useEffect(() => { load(); }, []);

  async function handleSave() {
    if (!editing) return;
    editing.updatedAt = new Date().toISOString();
    await db.dataSourceConfigs.put(editing);
    setConfigs(await db.dataSourceConfigs.toArray());
    setEditing(null);
    onConfigSaved?.(editing);
  }

  async function handleTest() {
    if (!editing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTestConnection?.(editing);
      setTestResult(result ?? { success: false, message: 'No test function configured' });
    } finally {
      setTesting(false);
    }
  }

  async function handleRemove(id: string) {
    await db.dataSourceConfigs.delete(id);
    setConfigs(await db.dataSourceConfigs.toArray());
    onRemove?.(id);
  }

  function renderForm() {
    if (!editing) return null;
    return (
      <div style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3>{t('datasource_edit_config')}</h3>

        <label style={{ display: 'block', marginBottom: 8 }}>
          {t('datasource_name')}:
          <input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            style={{ marginLeft: 8, width: 200 }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 8 }}>
          {t('datasource_type')}: {editing.type}
        </label>

        {editing.type === 'file' && (
          <FileConfig config={editing} onChange={setEditing} />
        )}
        {editing.type === 'http' && (
          <HttpConfig config={editing} onChange={setEditing} />
        )}
        {editing.type === 'tcp' && (
          <TcpConfig config={editing} onChange={setEditing} />
        )}
        {editing.type === 'websocket' && (
          <WsConfig config={editing} onChange={setEditing} />
        )}
        {editing.type === 'mqtt' && (
          <MqttConfig config={editing} onChange={setEditing} />
        )}
        {editing.type === 'db' && (
          <DbConfig config={editing} onChange={setEditing} />
        )}
        {editing.type === 'serial' && (
          <SerialConfig config={editing} onChange={setEditing} />
        )}

        {testResult && (
          <div style={{
            padding: '8px 12px',
            borderRadius: 4,
            background: testResult.success ? '#d4edda' : '#f8d7da',
            color: testResult.success ? '#155724' : '#721c24',
            marginBottom: 8,
          }}>
            {testResult.message}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={handleTest} disabled={testing}>
            {testing ? t('datasource_testing') : t('datasource_test_connection')}
          </button>
          <button onClick={handleSave}>{t('datasource_save')}</button>
          <button onClick={() => { setEditing(null); setTestResult(null); }}>
            {t('datasource_cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>{t('datasource_title')}</h2>

      {renderForm()}

      <button onClick={() => { setEditing(emptyConfig('http')); setTestResult(null); }}>
        + {t('datasource_add')}
      </button>

      <div style={{ marginTop: 16 }}>
        {configs.length === 0 && (
          <p style={{ color: '#666' }}>{t('datasource_empty')}</p>
        )}

        {configs.map((cfg) => (
          <div key={cfg.id} style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <span style={{ fontWeight: 600 }}>{cfg.name || cfg.id}</span>
            <span style={{ background: '#e9ecef', borderRadius: 4, padding: '2px 8px', fontSize: 12 }}>
              {cfg.type}
            </span>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: cfg.enabled ? '#28a745' : '#aaa',
            }} />

            <button onClick={() => { setEditing({ ...cfg }); setTestResult(null); }}>
              {t('datasource_edit')}
            </button>
            <button onClick={() => onToggleEnabled?.(cfg.id, !cfg.enabled)}>
              {cfg.enabled ? t('datasource_disable') : t('datasource_enable')}
            </button>
            <button onClick={() => handleRemove(cfg.id)} style={{ color: '#dc3545' }}>
              {t('datasource_remove')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Per-type config forms ──────────────────────────────────────────────────

function FileConfig({ config, onChange }: { config: DataSourceConfig; onChange: (c: DataSourceConfig) => void }) {
  return (
    <>
      <ConfigField label={t('datasource_file_patterns')} value={(config.config.filePatterns as string[] | undefined)?.join(', ') ?? ''} onChange={(v) => onChange({ ...config, config: { ...config.config, filePatterns: v.split(',').map(s => s.trim()) } })} />
      <ConfigField label={t('datasource_sn_regex')} value={config.config.snExtractRegex ?? ''} onChange={(v) => onChange({ ...config, config: { ...config.config, snExtractRegex: v } })} />
    </>
  );
}

function HttpConfig({ config, onChange }: { config: DataSourceConfig; onChange: (c: DataSourceConfig) => void }) {
  return (
    <>
      <ConfigField label={t('datasource_url')} value={config.config.url ?? ''} onChange={(v) => onChange({ ...config, config: { ...config.config, url: v } })} />
      <ConfigField label={t('datasource_method')} value={config.config.protocol ?? 'GET'} onChange={(v) => onChange({ ...config, config: { ...config.config, method: v as 'GET' | 'POST' } })} />
      <ConfigField label={t('datasource_poll_interval')} value={String(config.config.pollIntervalMs ?? 10000)} onChange={(v) => onChange({ ...config, config: { ...config.config, pollIntervalMs: parseInt(v) || 10000 } })} />
      <ConfigField label={t('datasource_sn_regex')} value={config.config.snExtractRegex ?? ''} onChange={(v) => onChange({ ...config, config: { ...config.config, snExtractRegex: v } })} />
    </>
  );
}

function TcpConfig({ config, onChange }: { config: DataSourceConfig; onChange: (c: DataSourceConfig) => void }) {
  return (
    <>
      <ConfigField label={t('datasource_host')} value={config.config.host ?? ''} onChange={(v) => onChange({ ...config, config: { ...config.config, host: v } })} />
      <ConfigField label={t('datasource_port')} value={String(config.config.port ?? '')} onChange={(v) => onChange({ ...config, config: { ...config.config, port: parseInt(v) || 0 } })} />
      <ConfigField label={t('datasource_protocol')} value={config.config.protocol ?? 'json'} onChange={(v) => onChange({ ...config, config: { ...config.config, protocol: v as 'json' | 'delimited' } })} />
      <ConfigField label={t('datasource_sn_regex')} value={config.config.snExtractRegex ?? ''} onChange={(v) => onChange({ ...config, config: { ...config.config, snExtractRegex: v } })} />
    </>
  );
}

function WsConfig({ config, onChange }: { config: DataSourceConfig; onChange: (c: DataSourceConfig) => void }) {
  return (
    <>
      <ConfigField label={t('datasource_url')} value={config.config.url ?? ''} onChange={(v) => onChange({ ...config, config: { ...config.config, url: v } })} />
      <ConfigField label={t('datasource_sn_regex')} value={config.config.snExtractRegex ?? ''} onChange={(v) => onChange({ ...config, config: { ...config.config, snExtractRegex: v } })} />
    </>
  );
}

function MqttConfig({ config, onChange }: { config: DataSourceConfig; onChange: (c: DataSourceConfig) => void }) {
  const cfg = config.config as DataSourceConfig['config'];
  function updateConfig(key: string, value: unknown) {
    onChange({ ...config, config: { ...cfg, [key]: value } as DataSourceConfig['config'] });
  }
  return (
    <>
      <ConfigField label={t('datasource_broker_url')} value={String(cfg.brokerUrl ?? '')} onChange={(v) => updateConfig('brokerUrl', v)} />
      <ConfigField label={t('datasource_topic')} value={String(cfg.topic ?? '')} onChange={(v) => updateConfig('topic', v)} />
      <ConfigField label={t('datasource_username')} value={String(cfg.username ?? '')} onChange={(v) => updateConfig('username', v)} />
      <ConfigField label={t('datasource_password')} value={String(cfg.password ?? '')} onChange={(v) => updateConfig('password', v)} />
    </>
  );
}

function DbConfig({ config, onChange }: { config: DataSourceConfig; onChange: (c: DataSourceConfig) => void }) {
  const cfg = config.config as DataSourceConfig['config'];
  function updateField(key: string, value: unknown) {
    onChange({ ...config, config: { ...cfg, [key]: value } as DataSourceConfig['config'] });
  }
  return (
    <>
      <ConfigField label={t('datasource_host')} value={String(cfg.host ?? '')} onChange={(v) => updateField('host', v)} />
      <ConfigField label={t('datasource_port')} value={String(cfg.port ?? 5432)} onChange={(v) => updateField('port', parseInt(v) || 5432)} />
      <ConfigField label={t('datasource_database_name')} value={String(cfg.databaseName ?? '')} onChange={(v) => updateField('databaseName', v)} />
      <ConfigField label={t('datasource_username')} value={String(cfg.username ?? '')} onChange={(v) => updateField('username', v)} />
      <ConfigField label={t('datasource_password')} value={String(cfg.password ?? '')} onChange={(v) => updateField('password', v)} />
      <ConfigField label={t('datasource_sql_query')} value={String(cfg.sqlQuery ?? '')} onChange={(v) => updateField('sqlQuery', v)} />
      <ConfigField label={t('datasource_poll_interval')} value={String(cfg.pollIntervalMs ?? 10000)} onChange={(v) => updateField('pollIntervalMs', parseInt(v) || 10000)} />
    </>
  );
}

function SerialConfig({ config, onChange }: { config: DataSourceConfig; onChange: (c: DataSourceConfig) => void }) {
  return (
    <>
      <ConfigField label={t('datasource_path')} value={config.config.path ?? ''} onChange={(v) => onChange({ ...config, config: { ...config.config, path: v } })} />
      <ConfigField label={t('datasource_baud_rate')} value={String(config.config.baudRate ?? 9600)} onChange={(v) => onChange({ ...config, config: { ...config.config, baudRate: parseInt(v) || 9600 } })} />
      <ConfigField label={t('datasource_protocol')} value={config.config.protocol ?? 'delimited'} onChange={(v) => onChange({ ...config, config: { ...config.config, protocol: v as 'json' | 'delimited' } })} />
      <ConfigField label={t('datasource_sn_regex')} value={config.config.snExtractRegex ?? ''} onChange={(v) => onChange({ ...config, config: { ...config.config, snExtractRegex: v } })} />
    </>
  );
}

function ConfigField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block', marginBottom: 6 }}>
      {label}:
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ marginLeft: 8, width: 260 }}
      />
    </label>
  );
}
