import { useState } from 'react';
import { t, type Locale } from '../i18n';

interface Props {
  locale: Locale;
  operator: string;
  onLogin(sn: string): void;
  onLogout(): void;
}

export function OperatorLogin({ locale, operator, onLogin, onLogout }: Props) {
  const [input, setInput] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sn = input.trim();
    if (!sn) return;
    onLogin(sn);
    setInput('');
  }

  if (operator) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          background: '#dbeafe',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 14,
        }}
      >
        <span>
          👤 <strong>{operator}</strong>
        </span>
        <button
          onClick={onLogout}
          style={{
            padding: '4px 12px',
            fontSize: 13,
            borderRadius: 6,
            border: '1px solid #93c5fd',
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          {t('operator.logout', locale)}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('operator.placeholder', locale)}
          style={{
            flex: 1,
            padding: '6px 12px',
            fontSize: 14,
            borderRadius: 6,
            border: '1px solid #d1d5db',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '6px 16px',
            fontSize: 14,
            borderRadius: 6,
            border: 'none',
            background: '#3b82f6',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {t('operator.login', locale)}
        </button>
      </div>
    </form>
  );
}
