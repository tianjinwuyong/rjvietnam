import { t, type Locale } from '../i18n';

interface Props {
  locale: Locale;
  isOnline: boolean;
  pendingCount: number;
}

export function SyncStatus({ locale, isOnline, pendingCount }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        padding: '8px 16px',
        background: isOnline ? '#dcfce7' : '#fee2e2',
        borderRadius: 8,
        marginBottom: 16,
        fontSize: 14,
      }}
    >
      <span style={{ fontWeight: 700 }}>
        {isOnline ? '🟢' : '🔴'} {isOnline ? t('sync.online', locale) : t('sync.offline', locale)}
      </span>
      {pendingCount > 0 && (
        <span style={{ color: '#d97706' }}>
          ⏳ {t('sync.pending', locale)}: {pendingCount}
        </span>
      )}
    </div>
  );
}
