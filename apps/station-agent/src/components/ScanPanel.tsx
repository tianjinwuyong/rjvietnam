import { useState, useEffect, useRef, type RefObject } from 'react';
import { t, type Locale } from '../i18n';
import { type ScanOutcome } from '../scanEngine';

interface Props {
  locale: Locale;
  disabled: boolean;
  onScan(sn: string): void;
  lastResult: ScanOutcome | null;
}

export function ScanPanel({ locale, disabled, onScan, lastResult }: Props) {
  const [input, setInput] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [batchCount, setBatchCount] = useState(0);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled, lastResult]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    if (batchMode) {
      const sns = input.split(/[\r\n]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
      setBatchCount(sns.length);
      sns.forEach((sn) => onScan(sn));
    } else {
      onScan(input.trim().toUpperCase());
    }
    setInput('');
  }

  const bgColor =
    lastResult?.outcome === 'PASS' ? '#dcfce7'
    : lastResult?.outcome === 'NG' ? '#fee2e2'
    : lastResult?.outcome === 'DUP' ? '#fef3c7'
    : lastResult?.outcome === 'BLOCKED' ? '#fee2e2'
    : '#f3f4f6';

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      {/* Batch mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={batchMode}
            onChange={(e) => { setBatchMode(e.target.checked); setBatchCount(0); }}
          />
          {t('batch_mode', locale)}
        </label>
        {batchCount > 0 && (
          <span style={{ fontSize: 12, color: '#16a34a' }}>已提交 {batchCount} 条</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
        <textarea
          ref={inputRef as RefObject<HTMLTextAreaElement>}
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          placeholder={batchMode ? '逐行粘贴多条SN，回车提交' : t('scan.placeholder', locale)}
          disabled={disabled}
          rows={batchMode ? 4 : 1}
          style={{
            flex: 1,
            padding: '12px 16px',
            fontSize: 20,
            fontFamily: 'monospace',
            letterSpacing: 2,
            borderRadius: 10,
            border: '2px solid #d1d5db',
            background: disabled ? '#e5e7eb' : '#fff',
            resize: batchMode ? 'vertical' : 'none',
          }}
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          style={{
            padding: '12px 24px',
            fontSize: 16,
            fontWeight: 700,
            borderRadius: 10,
            border: 'none',
            background: disabled ? '#9ca3af' : '#3b82f6',
            color: '#fff',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          {t('scan.input', locale)}
        </button>
      </div>
      {lastResult && (
        <div
          style={{
            marginTop: 12,
            padding: '16px 20px',
            borderRadius: 10,
            background: bgColor,
            textAlign: 'center',
          }}
        >
          <span
            style={{
              fontSize: 32,
              fontWeight: 900,
              color:
                lastResult.outcome === 'PASS' ? '#15803d'
                : lastResult.outcome === 'NG' ? '#dc2626'
                : lastResult.outcome === 'DUP' ? '#d97706'
                : '#dc2626',
            }}
          >
            {lastResult.outcome === 'PASS' ? t('result.pass', locale)
             : lastResult.outcome === 'NG' ? t('result.ng', locale)
             : lastResult.outcome === 'DUP' ? t('result.dup', locale)
             : t('result.blocked', locale)}
          </span>
           {'source' in lastResult && lastResult.source && (
             <div style={{ marginTop: 4, fontSize: 13, color: '#6b7280' }}>
               {lastResult.source}
             </div>
           )}
        </div>
      )}
    </form>
  );
}
