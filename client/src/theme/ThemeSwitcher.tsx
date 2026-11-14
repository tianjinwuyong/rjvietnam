import React, { useEffect, useRef, useState } from 'react';
import { Palette, Check, Moon } from 'lucide-react';
import { useI18n } from '@client/src/i18n';
import { useTheme } from './ThemeProvider';
import type { ThemeDefinition } from './palettes';

/**
 * 顶部栏「界面配色」开关。
 * 交互参照手机换主题：点开面板 → 一排缩略图 → 点一下立刻整套 UI 换色（不刷新、不丢状态）。
 * variant='pill' 用于登录页那种悬浮胶囊按钮的位置。
 */
const ThemeSwitcher: React.FC<{ variant?: 'header' | 'pill' }> = ({ variant = 'header' }) => {
  const { t, lang } = useI18n();
  const { theme: current, themes, setTheme, themeId } = useTheme();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const lightThemes = themes.filter((x) => x.mode === 'light');
  const darkThemes = themes.filter((x) => x.mode === 'dark');

  const card = (item: ThemeDefinition) => {
    const active = item.id === themeId;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setTheme(item.id)}
        title={`${item.name[lang] ?? item.name.zh} · ${item.desc[lang] ?? item.desc.zh}`}
        aria-pressed={active}
        data-theme-option={item.id}
        className={`group relative rounded-xl p-1 text-left transition-all duration-150 ${
          active
            ? 'bg-primary-soft ring-2 ring-primary'
            : 'hover:bg-muted ring-1 ring-border/70 hover:ring-border'
        }`}
      >
        {/* 缩略图：侧栏 + 顶栏 + 卡片 + 主色块，尽量还原真实版式比例 */}
        <span
          className="flex h-[56px] w-full overflow-hidden rounded-lg"
          style={{ backgroundColor: item.preview.shell }}
        >
          <span className="h-full w-3.5 flex-shrink-0" style={{ backgroundColor: item.preview.sidebar }} />
          <span className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
            <span
              className="block h-1.5 w-7 rounded-full opacity-40"
              style={{ backgroundColor: item.preview.ink }}
            />
            <span
              className="block h-4 w-full rounded-[3px]"
              style={{ backgroundColor: item.preview.card, boxShadow: `inset 0 0 0 1px ${item.preview.ink}22` }}
            />
            <span className="flex gap-1">
              <span
                className="h-2.5 flex-1 rounded-[3px]"
                style={{ backgroundColor: item.preview.card, boxShadow: `inset 0 0 0 1px ${item.preview.ink}22` }}
              />
              <span className="h-2.5 w-4 rounded-[3px]" style={{ backgroundColor: item.preview.accent }} />
            </span>
          </span>
        </span>

        <span className="mt-1 flex items-center justify-center gap-0.5 px-0.5">
          <span
            className={`truncate text-xs leading-tight ${active ? 'text-primary font-semibold' : 'text-foreground/80'}`}
          >
            {item.name[lang] ?? item.name.zh}
          </span>
        </span>

        {item.mode === 'dark' && (
          <Moon
            size={9}
            className="absolute right-1.5 top-1.5 opacity-70"
            style={{ color: item.preview.ink }}
            aria-hidden
          />
        )}
        {active && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Check size={10} strokeWidth={3} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        data-wms-theme-switch
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            // 通知顶栏其它下拉（语言/用户）先收起，避免两个浮层叠在一起
            if (next) window.dispatchEvent(new CustomEvent('wms:theme-panel-open'));
            return next;
          });
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={
          variant === 'pill'
            ? `flex items-center gap-2 rounded-xl border border-white/50 bg-white/72 px-4 py-2 shadow-sm backdrop-blur-xl transition-all duration-200 hover:bg-white/90 hover:text-primary ${
                open ? 'text-primary' : 'text-muted-foreground'
              }`
            : `flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                open ? 'bg-primary-soft text-primary font-medium' : 'text-muted-foreground hover:bg-primary-soft hover:text-primary'
              }`
        }
        title={t('theme.title')}
      >
        <Palette size={variant === 'pill' ? 16 : 14} />
        <span className={variant === 'pill' ? 'text-sm font-medium' : undefined}>{t('theme.button')}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('theme.title')}
          data-wms-theme-panel
          className="absolute right-0 top-full z-50 mt-1.5 w-[322px] overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-xl"
        >
          <div className="flex items-start gap-2 border-b border-border/60 px-3 pb-2.5 pt-3">
            <span className="mt-0.5 text-primary">
              <Palette size={15} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">{t('theme.title')}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{t('theme.subtitle')}</p>
            </div>
          </div>

          <div className="max-h-[min(60vh,420px)] overflow-y-auto px-2.5 py-2.5">
            <p className="mb-1.5 px-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('theme.lightGroup')}
            </p>
            <div className="mb-2.5 grid grid-cols-3 gap-2">{lightThemes.map(card)}</div>

            <p className="mb-1.5 px-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('theme.darkGroup')}
            </p>
            <div className="grid grid-cols-3 gap-2">{darkThemes.map(card)}</div>
          </div>

          <div className="flex items-center gap-1.5 border-t border-border/60 bg-muted/40 px-3 py-2">
            <Check size={12} className="text-success" />
            <span className="text-xs text-muted-foreground">
              {t('theme.applied')}
              <span className="ml-1 text-foreground/80">
                {current.name[lang] ?? current.name.zh}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ThemeSwitcher;
