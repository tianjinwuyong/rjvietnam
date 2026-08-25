import { t, type Locale } from '../i18n';

interface Props {
  locale: Locale;
  stats: { pass: number; ng: number; dup: number };
}

export function StatsPanel({ locale, stats }: Props) {
  const total = stats.pass + stats.ng + stats.dup;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
        marginBottom: 16,
      }}
    >
      {[
        { label: t('stats.today', locale), value: total, color: '#374151', bg: '#f3f4f6' },
        { label: t('stats.pass', locale), value: stats.pass, color: '#15803d', bg: '#dcfce7' },
        { label: t('stats.ng', locale), value: stats.ng, color: '#dc2626', bg: '#fee2e2' },
        { label: t('stats.dup', locale), value: stats.dup, color: '#d97706', bg: '#fef3c7' },
      ].map(({ label, value, color, bg }) => (
        <div
          key={label}
          style={{
            background: bg,
            borderRadius: 10,
            padding: '12px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 900, color }}>{value}</div>
          <div style={{ fontSize: 12, color, marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}
