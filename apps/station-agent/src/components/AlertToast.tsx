import { useEffect, useRef } from 'react';
import type { AlertResult } from '../alertRuleEngine';

interface AlertToastProps {
  alerts: AlertResult[];
  locale?: string;
}

export function AlertToast({ alerts, locale = 'zh-CN' }: AlertToastProps) {
  const prevIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(alerts.map((a) => `${a.rule.id}::${a.record.sn}`));
    for (const a of alerts) {
      const key = `${a.rule.id}::${a.record.sn}`;
      if (!prevIds.current.has(key)) {
        if (Notification.permission === 'granted') {
          new Notification(`[${a.rule.name}] SN: ${a.record.sn}`, {
            body: `触发条件: ${a.rule.expression} | 数据: ${JSON.stringify(a.record.data)}`,
            tag: key,
          });
        }
      }
    }
    prevIds.current = currentIds;
  }, [alerts]);

  if (alerts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {alerts.slice(0, 5).map((a, i) => (
        <div
          key={`${a.rule.id}::${a.record.sn}::${i}`}
          style={{
            background: a.rule.severity === 'critical' ? '#fee2e2' : '#fef3c7',
            border: `2px solid ${a.rule.severity === 'critical' ? '#ef4444' : '#f59e0b'}`,
            borderRadius: 8,
            padding: '10px 14px',
            minWidth: 260,
            maxWidth: 340,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            pointerEvents: 'auto',
            animation: 'slideIn 0.2s ease-out',
          }}
        >
          <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 4, fontSize: 13 }}>
            🔔 {a.rule.name} <span style={{ fontWeight: 400 }}>({a.rule.severity})</span>
          </div>
          <div style={{ fontSize: 12, color: '#78350f' }}>
            SN: <code style={{ fontSize: 11 }}>{a.record.sn ?? 'N/A'}</code>
          </div>
          <div style={{ fontSize: 12, color: '#78350f' }}>
            条件: <code>{a.rule.expression}</code>
          </div>
          <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
            来源: {a.record.source} | {new Date(a.record.timestamp).toLocaleTimeString(locale)}
          </div>
        </div>
      ))}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
