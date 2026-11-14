import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@client/src/i18n';
import type { LanguageCode } from '@shared/api.interface';
import {
  Home, Users, Workflow, Database, Inbox, ClipboardCheck, Boxes, ClipboardList,
  Factory, PackageCheck, Send, FileSpreadsheet, ShieldAlert, Settings, Smartphone,
  Book, Search, Info, AlertTriangle, Lightbulb, ArrowRight, Printer, List,
  type LucideIcon,
} from 'lucide-react';
import { HELP_CHAPTERS, chapterSearchText } from './helpContent';
import type { HelpBlock, HelpChapter, HelpSection, Tri } from './helpTypes';

/** 章节图标名 → lucide 组件 */
const ICONS: Record<string, LucideIcon> = {
  home: Home,
  users: Users,
  workflow: Workflow,
  database: Database,
  inbox: Inbox,
  'clipboard-check': ClipboardCheck,
  boxes: Boxes,
  'clipboard-list': ClipboardList,
  factory: Factory,
  'package-check': PackageCheck,
  send: Send,
  'file-spreadsheet': FileSpreadsheet,
  'shield-alert': ShieldAlert,
  settings: Settings,
  smartphone: Smartphone,
  book: Book,
};

/** 按当前语言从三语字段取值 */
function tr(t: Tri, lang: LanguageCode): string {
  return t[lang] ?? t.zh;
}

/** 界面固定文案（跟随全局语言） */
const UI_TEXT: Record<string, Tri> = {
  pageTitle: {
    zh: 'WMS 使用手册',
    vi: 'Sổ tay sử dụng WMS',
    en: 'WMS User Manual',
  },
  pageSubtitle: {
    zh: '仓库管理系统作业指导书 · 中 / 越 / 英 三语',
    vi: 'Hướng dẫn thao tác hệ thống quản lý kho · Trung / Việt / Anh',
    en: 'Warehouse Management System work instructions · Chinese / Vietnamese / English',
  },
  searchPlaceholder: {
    zh: '搜索功能、报错信息、状态…',
    vi: 'Tìm chức năng, thông báo lỗi, trạng thái…',
    en: 'Search features, errors, statuses…',
  },
  toc: { zh: '目录', vi: 'Mục lục', en: 'Contents' },
  clear: { zh: '清除', vi: 'Xóa', en: 'Clear' },
  noResult: {
    zh: '没有找到匹配的内容，换个关键词试试。',
    vi: 'Không tìm thấy nội dung phù hợp, thử từ khóa khác.',
    en: 'No matching content. Try another keyword.',
  },
  matchCount: { zh: '匹配章节', vi: 'Chương khớp', en: 'Matching chapters' },
  print: { zh: '打印 / 导出 PDF', vi: 'In / Xuất PDF', en: 'Print / Export PDF' },
  noteInfo: { zh: '说明', vi: 'Lưu ý', en: 'Note' },
  noteWarn: { zh: '注意', vi: 'Cảnh báo', en: 'Caution' },
  noteTip: { zh: '技巧', vi: 'Mẹo', en: 'Tip' },
  backTop: { zh: '回到顶部', vi: 'Về đầu trang', en: 'Back to top' },
};

function ui(k: keyof typeof UI_TEXT, lang: LanguageCode): string {
  return tr(UI_TEXT[k], lang);
}

/** 提示条配色（浅色主题） */
const NOTE_STYLE = {
  info: { border: 'border-l-[var(--info)]', bg: 'bg-[var(--info-soft)]', icon: Info, color: 'text-[var(--info)]' },
  warn: { border: 'border-l-[var(--warning)]', bg: 'bg-[var(--warning-soft)]', icon: AlertTriangle, color: 'text-[var(--accent)]' },
  tip: { border: 'border-l-[var(--success)]', bg: 'bg-[var(--success-soft)]', icon: Lightbulb, color: 'text-[var(--success)]' },
} as const;

/** 单个内容块渲染 */
const BlockView: React.FC<{ block: HelpBlock; lang: LanguageCode }> = ({ block, lang }) => {
  switch (block.k) {
    case 'p':
      return <p className="text-sm leading-7 text-foreground/85">{tr(block.v, lang)}</p>;

    case 'h3':
      return (
        <h4 className="text-sm font-semibold text-foreground mt-1 mb-0.5 flex items-center gap-2">
          <span className="w-1 h-3.5 rounded-full bg-primary flex-shrink-0" />
          {tr(block.v, lang)}
        </h4>
      );

    case 'ul':
      return (
        <ul className="space-y-1.5">
          {block.v.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-7 text-foreground/85">
              <span className="mt-[11px] w-1.5 h-1.5 rounded-full bg-primary/60 flex-shrink-0" />
              <span>{tr(item, lang)}</span>
            </li>
          ))}
        </ul>
      );

    case 'ol':
      return (
        <ol className="space-y-2">
          {block.v.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-7 text-foreground/85">
              <span className="mt-1 w-5 h-5 rounded-md bg-primary-soft text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">
                {i + 1}
              </span>
              <span>{tr(item, lang)}</span>
            </li>
          ))}
        </ol>
      );

    case 'note': {
      const s = NOTE_STYLE[block.tone];
      const Icon = s.icon;
      const label = block.tone === 'warn' ? ui('noteWarn', lang) : block.tone === 'tip' ? ui('noteTip', lang) : ui('noteInfo', lang);
      return (
        <div className={`border-l-[3px] ${s.border} ${s.bg} rounded-r-lg px-3.5 py-2.5`}>
          <div className={`flex items-center gap-1.5 text-xs font-semibold ${s.color} mb-1`}>
            <Icon size={13} />
            {label}
          </div>
          <div className="text-sm leading-6 text-foreground/85 whitespace-pre-line">{tr(block.v, lang)}</div>
        </div>
      );
    }

    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-muted">
                {block.head.map((h, i) => (
                  <th key={i} className="text-left font-semibold text-foreground/80 px-3 py-2 border-b border-border whitespace-nowrap">
                    {tr(h, lang)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className="even:bg-muted/40">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`px-3 py-2 align-top leading-6 border-b border-border/60 ${
                        ci === 0 ? 'font-medium text-foreground whitespace-nowrap' : 'text-foreground/80'
                      }`}
                    >
                      {tr(cell, lang)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'flow':
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {block.v.map((step, i) => (
            <React.Fragment key={i}>
              <span className="px-3 py-1.5 rounded-lg bg-primary-soft text-primary text-xs font-medium">
                {tr(step, lang)}
              </span>
              {i < block.v.length - 1 && <ArrowRight size={14} className="text-muted-foreground flex-shrink-0" />}
            </React.Fragment>
          ))}
        </div>
      );

    default:
      return null;
  }
};

const SectionView: React.FC<{ section: HelpSection; lang: LanguageCode }> = ({ section, lang }) => (
  <section id={section.id} className="scroll-mt-24">
    <h3 className="text-base font-bold text-foreground mb-3 pb-2 border-b border-border flex items-center gap-2">
      <span className="w-1.5 h-4 rounded-full bg-primary flex-shrink-0" />
      {tr(section.title, lang)}
    </h3>
    <div className="space-y-3.5">
      {section.blocks.map((b, i) => (
        <BlockView key={i} block={b} lang={lang} />
      ))}
    </div>
  </section>
);

const HelpPage: React.FC = () => {
  const { lang } = useI18n();
  const [query, setQuery] = useState('');
  const [activeChapter, setActiveChapter] = useState<string>(HELP_CHAPTERS[0]?.id ?? '');
  const [activeSection, setActiveSection] = useState<string>('');
  const contentRef = useRef<HTMLDivElement>(null);

  // 搜索：命中任一语言的正文即算匹配
  const visibleChapters = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return HELP_CHAPTERS;
    return HELP_CHAPTERS.filter((ch) => chapterSearchText(ch).includes(q));
  }, [query]);

  // 滚动时高亮目录中的当前章节 / 小节
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length === 0) return;
        const el = visible[0].target as HTMLElement;
        const chapterId = el.dataset.chapter;
        const sectionId = el.dataset.section;
        if (chapterId) setActiveChapter(chapterId);
        if (sectionId) setActiveSection(sectionId);
      },
      { root, rootMargin: '-10% 0px -75% 0px', threshold: 0 },
    );
    root.querySelectorAll<HTMLElement>('[data-anchor]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [visibleChapters]);

  const scrollTo = (id: string) => {
    const root = contentRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (target) {
      root.scrollTo({ top: target.offsetTop - 16, behavior: 'smooth' });
    }
  };

  const totalSections = useMemo(
    () => HELP_CHAPTERS.reduce((n, c) => n + c.sections.length, 0),
    [],
  );

  return (
    <div className="flex gap-4 h-[calc(100vh-96px)]">
      {/* ===== 左侧目录 ===== */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={ui('searchPlaceholder', lang)}
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-[var(--input-bg)] border border-transparent rounded-lg outline-none focus:border-primary focus:bg-card transition-colors"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex items-center justify-between mt-2 px-0.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <List size={11} />
              {query ? `${ui('matchCount', lang)} ${visibleChapters.length}` : `${ui('toc', lang)} · ${visibleChapters.length}/${HELP_CHAPTERS.length}`}
            </span>
            <button
              onClick={() => window.print()}
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
            >
              <Printer size={11} />
              {ui('print', lang)}
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {visibleChapters.map((ch) => {
            const Icon = ICONS[ch.icon] ?? Book;
            const isActive = activeChapter === ch.id;
            return (
              <div key={ch.id}>
                <button
                  onClick={() => scrollTo(ch.id)}
                  className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition-colors ${
                    isActive ? 'bg-primary-soft text-primary font-semibold' : 'text-foreground/75 hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon size={14} className="mt-0.5 flex-shrink-0" />
                  <span className="leading-5">{tr(ch.title, lang)}</span>
                </button>
                {isActive && (
                  <div className="ml-4 mt-0.5 mb-1 pl-2 border-l border-border space-y-0.5">
                    {ch.sections.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => scrollTo(s.id)}
                        className={`w-full text-left text-xs leading-5 px-1.5 py-1 rounded transition-colors ${
                          activeSection === s.id ? 'text-primary bg-primary-soft/70' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        }`}
                      >
                        {tr(s.title, lang)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* ===== 右侧正文 ===== */}
      <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto bg-card border border-border rounded-xl shadow-sm">
        <header className="px-7 pt-6 pb-5 border-b border-border">
          <h1 className="text-xl font-bold text-foreground">{ui('pageTitle', lang)}</h1>
          <p className="text-xs text-muted-foreground mt-1.5">{ui('pageSubtitle', lang)}</p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {HELP_CHAPTERS.map((ch) => (
              <button
                key={ch.id}
                onClick={() => scrollTo(ch.id)}
                className="px-2.5 py-1 rounded-md bg-muted hover:bg-primary-soft hover:text-primary text-xs text-foreground/70 transition-colors"
              >
                {tr(ch.title, lang)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            {HELP_CHAPTERS.length} · {totalSections}
          </p>
        </header>

        {visibleChapters.length === 0 && (
          <div className="px-7 py-16 text-center text-muted-foreground text-sm">{ui('noResult', lang)}</div>
        )}

        <div className="px-7 py-5 space-y-9">
          {visibleChapters.map((ch: HelpChapter) => {
            const Icon = ICONS[ch.icon] ?? Book;
            return (
              <article
                key={ch.id}
                id={ch.id}
                data-anchor
                data-chapter={ch.id}
                className="scroll-mt-4"
              >
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-9 h-9 rounded-[10px] bg-primary-soft text-primary flex items-center justify-center flex-shrink-0">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-foreground leading-6">{tr(ch.title, lang)}</h2>
                    <p className="text-xs text-muted-foreground mt-1 leading-6">{tr(ch.summary, lang)}</p>
                  </div>
                </div>
                <div className="space-y-6 pl-0 sm:pl-12">
                  {ch.sections.map((s) => (
                    <div key={s.id} data-anchor data-section={s.id} className="scroll-mt-20">
                      <SectionView section={s} lang={lang} />
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>

        <footer className="px-7 py-6 border-t border-border mt-4">
          <button
            onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            className="text-xs text-primary hover:underline"
          >
            ↑ {ui('backTop', lang)}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default HelpPage;
