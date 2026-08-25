import { t, type Locale } from '../i18n';

interface StationInfo {
  code: string;
  name_zh: string;
  line_code: string;
  station_type?: string;
}

interface Props {
  locale: Locale;
  stations: StationInfo[];
  selected: StationInfo | null;
  onSelect(s: StationInfo): void;
  onRefresh?: () => void;
}

export function StationSelector({ locale, stations, selected, onSelect, onRefresh }: Props) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <label style={{ fontWeight: 600 }}>{t('station.select', locale)}</label>
        {onRefresh && (
          <button
            onClick={onRefresh}
            title={t('station.refresh', locale)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
          >
            🔄
          </button>
        )}
      </div>
      <select
        value={selected?.code ?? ''}
        onChange={(e) => {
          const s = stations.find((x) => x.code === e.target.value);
          if (s) onSelect(s);
        }}
        style={{
          width: '100%',
          padding: '8px 12px',
          fontSize: 16,
          borderRadius: 8,
          border: '1px solid #d1d5db',
          background: '#fff',
        }}
      >
        <option value="">{t('station.placeholder', locale)}</option>
        {stations.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name_zh} ({s.code}) — {s.line_code}
          </option>
        ))}
      </select>
    </div>
  );
}
