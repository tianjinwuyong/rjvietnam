import { t, type Locale } from '../i18n';

interface NgAlert {
  sn: string;
  stationCode: string;
  defectCode?: string;
  defectDescription?: string;
  operator?: string;
  receivedAt: Date;
}

interface Props {
  locale: Locale;
  alerts: NgAlert[];
}

export function LiveNgAlerts({ locale, alerts }: Props) {
  const visible = alerts.slice(0, 5);
  if (visible.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          background: '#fee2e2',
          border: '2px solid #fca5a5',
          borderRadius: 10,
          padding: '12px 16px',
        }}
      >
        <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>
          🔴 {t('ng.alert', locale)}
        </div>
        {visible.map((a, i) => (
          <div
            key={i}
            style={{
              background: '#fff',
              borderRadius: 6,
              padding: '8px 12px',
              marginBottom: i < visible.length - 1 ? 6 : 0,
              border: '1px solid #fca5a5',
            }}
          >
            <span style={{ fontWeight: 700, color: '#991b1b' }}>{a.sn}</span>
            <span style={{ color: '#7f1d1d', marginLeft: 8 }}>@ {a.stationCode}</span>
            {a.defectCode && (
              <span style={{ color: '#b91c1c', marginLeft: 8 }}>{a.defectCode}</span>
            )}
            {a.operator && (
              <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 8 }}>by {a.operator}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
