// AlertRuleEditor — Operator UI: define / edit / delete threshold alert rules per adapter
import { useState, useEffect } from 'react';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { AlertRuleEngine, type AlertRule } from '../alertRuleEngine.js';

const SEVERITIES: AlertRule['severity'][] = ['warning', 'critical'];
const ACTIONS: AlertRule['action'][] = ['local_alert', 'ng_trigger', 'forward_mes'];

interface Props {
  adapterId: string;
  adapterName: string;
  stationCode: string;
  engine: AlertRuleEngine;
  onRuleChange?: () => void;
}

export function AlertRuleEditor({ adapterId, adapterName, stationCode, engine, onRuleChange }: Props) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [editing, setEditing] = useState<Partial<AlertRule> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const all = await db.alertRules.where('adapterId').equals(adapterId).toArray();
    setRules(all);
  }

  useEffect(() => { load(); }, [adapterId]);

  async function handleSave() {
    if (!editing) return;
    setError(null);
    const rule: AlertRule = {
      id: editing.id ?? crypto.randomUUID(),
      adapterId,
      stationCode,
      name: editing.name ?? 'Unnamed Rule',
      expression: editing.expression ?? '',
      severity: editing.severity ?? 'warning',
      action: editing.action ?? 'local_alert',
      enabled: editing.enabled ?? true,
    };
    try {
      await engine.addRule(rule);
      await load();
      setEditing(null);
      onRuleChange?.();
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  async function handleRemove(id: string) {
    await engine.removeRule(id);
    await load();
    onRuleChange?.();
  }

  async function handleToggle(rule: AlertRule) {
    await engine.updateRule({ ...rule, enabled: !rule.enabled });
    await load();
    onRuleChange?.();
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginTop: 12 }}>
      <h4>{t('alertrule_title')} — {adapterName}</h4>

      {error && (
        <div style={{ padding: '8px 12px', background: '#f8d7da', color: '#721c24', borderRadius: 4, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {rules.length === 0 && !editing && (
        <p style={{ color: '#666', fontSize: 13 }}>{t('alertrule_empty')}</p>
      )}

      {rules.map((rule) => (
        <div key={rule.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 0', borderBottom: '1px solid #eee',
        }}>
          <span style={{
            fontSize: 11, padding: '2px 6px', borderRadius: 3,
            background: rule.severity === 'critical' ? '#dc3545' : '#ffc107',
            color: rule.severity === 'critical' ? '#fff' : '#000',
          }}>
            {rule.severity}
          </span>
          <span style={{ fontWeight: 600, minWidth: 120 }}>{rule.name}</span>
          <code style={{ fontSize: 12, background: '#f8f9fa', padding: '2px 6px', borderRadius: 3 }}>
            {rule.expression}
          </code>
          <span style={{ fontSize: 11, color: '#666' }}>{rule.action}</span>
          <button onClick={() => handleToggle(rule)} style={{ fontSize: 11 }}>
            {rule.enabled ? t('alertrule_disable') : t('alertrule_enable')}
          </button>
          <button onClick={() => handleRemove(rule.id)} style={{ color: '#dc3545', fontSize: 11 }}>
            {t('alertrule_remove')}
          </button>
        </div>
      ))}

      {editing ? (
        <div style={{ marginTop: 10, padding: 10, background: '#f8f9fa', borderRadius: 6 }}>
          <ConfigRuleField label={t('alertrule_name')} value={editing.name ?? ''} onChange={(v) => setEditing({ ...editing, name: v })} />
          <ConfigRuleField label={t('alertrule_expression')} value={editing.expression ?? ''} onChange={(v) => setEditing({ ...editing, expression: v })} placeholder="e.g. defect_count > 3" />
          <label style={{ display: 'block', marginBottom: 8 }}>
            {t('alertrule_severity')}:
            <select value={editing.severity ?? 'warning'} onChange={(e) => setEditing({ ...editing, severity: e.target.value as AlertRule['severity'] })} style={{ marginLeft: 8 }}>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ display: 'block', marginBottom: 8 }}>
            {t('alertrule_action')}:
            <select value={editing.action ?? 'local_alert'} onChange={(e) => setEditing({ ...editing, action: e.target.value as AlertRule['action'] })} style={{ marginLeft: 8 }}>
              {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={handleSave}>{t('alertrule_save')}</button>
            <button onClick={() => setEditing(null)}>{t('alertrule_cancel')}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing({ name: '', expression: '', severity: 'warning', action: 'local_alert' })} style={{ marginTop: 8 }}>
          + {t('alertrule_add')}
        </button>
      )}
    </div>
  );
}

function ConfigRuleField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: 'block', marginBottom: 6 }}>
      {label}:
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ marginLeft: 8, width: 300 }} />
    </label>
  );
}
