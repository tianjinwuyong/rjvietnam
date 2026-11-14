import React, { useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronRight, ArrowRight, Info, AlertTriangle, Lightbulb } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { LanguageCode } from '@shared/api.interface';
import PdaLayout from './components/PdaLayout';
import { HELP_CHAPTERS, chapterSearchText } from '../help/helpContent';
import type { HelpBlock, Tri } from '../help/helpTypes';

function tr(t: Tri, lang: LanguageCode): string {
  return t[lang] ?? t.zh;
}

const PDA_UI: Record<string, Tri> = {
  title: { zh: '使用帮助', vi: 'Trợ giúp sử dụng', en: 'Help' },
  searchPlaceholder: { zh: '搜索…', vi: 'Tìm kiếm…', en: 'Search…' },
  empty: {
    zh: '没有找到匹配内容',
    vi: 'Không tìm thấy nội dung',
    en: 'No matching content',
  },
  noteInfo: { zh: '说明', vi: 'Lưu ý', en: 'Note' },
  noteWarn: { zh: '注意', vi: 'Cảnh báo', en: 'Caution' },
  noteTip: { zh: '技巧', vi: 'Mẹo', en: 'Tip' },
};

function pui(k: keyof typeof PDA_UI, lang: LanguageCode): string {
  return tr(PDA_UI[k], lang);
}

const NOTE_COLOR: Record<string, string> = {
  info: 'var(--info)',
  warn: 'var(--warning)',
  tip: 'var(--success)',
};

const PdaBlock: React.FC<{ block: HelpBlock; lang: LanguageCode }> = ({ block, lang }) => {
  switch (block.k) {
    case 'p':
      return <p className="pda-help-p">{tr(block.v, lang)}</p>;
    case 'h3':
      return <div className="pda-help-h3">{tr(block.v, lang)}</div>;
    case 'ul':
      return (
        <ul className="pda-help-ul">
          {block.v.map((it, i) => (
            <li key={i}>{tr(it, lang)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="pda-help-ol">
          {block.v.map((it, i) => (
            <li key={i}>{tr(it, lang)}</li>
          ))}
        </ol>
      );
    case 'note': {
      const Icon = block.tone === 'warn' ? AlertTriangle : block.tone === 'tip' ? Lightbulb : Info;
      const label = block.tone === 'warn' ? pui('noteWarn', lang) : block.tone === 'tip' ? pui('noteTip', lang) : pui('noteInfo', lang);
      return (
        <div className="pda-help-note" style={{ borderLeftColor: NOTE_COLOR[block.tone] }}>
          <div className="pda-help-note-head" style={{ color: NOTE_COLOR[block.tone] }}>
            <Icon size={12} />
            {label}
          </div>
          <div className="pda-help-note-body">{tr(block.v, lang)}</div>
        </div>
      );
    }
    case 'table':
      return (
        <div className="pda-help-table-wrap">
          <table className="pda-help-table">
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th key={i}>{tr(h, lang)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci}>{tr(c, lang)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'flow':
      return (
        <div className="pda-help-flow">
          {block.v.map((s, i) => (
            <React.Fragment key={i}>
              <span className="pda-help-flow-step">{tr(s, lang)}</span>
              {i < block.v.length - 1 && <ArrowRight size={12} color="var(--muted-foreground)" />}
            </React.Fragment>
          ))}
        </div>
      );
    default:
      return null;
  }
};

/** PDA 端帮助：按章节折叠，点击标题展开 */
const PdaHelp: React.FC = () => {
  const { lang } = useI18n();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return HELP_CHAPTERS;
    return HELP_CHAPTERS.filter((c) => chapterSearchText(c).includes(q));
  }, [query]);

  const searching = query.trim().length > 0;

  return (
    <PdaLayout title={pui('title', lang)}>
      <div className="pda-help-search">
        <Search size={15} className="pda-help-search-icon" />
        <input
          className="pda-input pda-help-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={pui('searchPlaceholder', lang)}
        />
      </div>

      {visible.length === 0 && <div className="pda-empty">{pui('empty', lang)}</div>}

      <div className="pda-help-list">
        {visible.map((ch) => {
          const expanded = searching || !!open[ch.id];
          return (
            <div key={ch.id} className="pda-card pda-help-card">
              <button
                type="button"
                className="pda-help-card-head"
                onClick={() => setOpen((p) => ({ ...p, [ch.id]: !p[ch.id] }))}
              >
                <span className="pda-help-card-title">{tr(ch.title, lang)}</span>
                {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </button>

              {expanded && (
                <div className="pda-help-card-body">
                  <div className="pda-help-summary">{tr(ch.summary, lang)}</div>
                  {ch.sections.map((s) => (
                    <div key={s.id} className="pda-help-section">
                      <div className="pda-help-section-title">{tr(s.title, lang)}</div>
                      {s.blocks.map((b, i) => (
                        <PdaBlock key={i} block={b} lang={lang} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PdaLayout>
  );
};

export default PdaHelp;
