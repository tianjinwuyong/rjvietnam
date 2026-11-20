'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  InfoIcon,
  Loader2Icon,
  XIcon,
} from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * 应用自身的深色模式写在 <html data-wms-mode>（见 theme/ThemeProvider.tsx）。
 * 本项目没有 next-themes 的 Provider，直接调 useTheme() 会恒得 undefined → 固定回落
 * 'system'，导致深色主题下 toast 仍是白底压深色。改为监听该属性。
 */
function useDocumentMode(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-wms-mode') === 'dark'
      ? 'dark'
      : 'light';

  const [mode, setMode] = React.useState<'light' | 'dark'>(read);

  React.useEffect(() => {
    const apply = () => setMode(read());
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-wms-mode', 'class'],
    });
    return () => observer.disconnect();
  }, []);

  return mode;
}

function Toaster({ className, style, icons, ...props }: ToasterProps) {
  const theme = useDocumentMode();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className={cn('toaster group', className)}
      position="top-center"
      icons={{
        success: (
          <CircleCheckIcon
            fill="currentColor"
            className="size-4 text-success [&>:not(circle)]:stroke-(--normal-bg)"
          />
        ),
        info: (
          <InfoIcon
            fill="currentColor"
            className="size-4 text-info [&>:not(circle)]:stroke-(--normal-bg)"
          />
        ),
        warning: (
          <CircleAlertIcon
            fill="currentColor"
            className="size-4 text-warning [&>:not(circle)]:stroke-(--normal-bg)"
          />
        ),
        error: (
          <CircleXIcon
            fill="currentColor"
            className="size-4 text-destructive [&>:not(circle)]:stroke-(--normal-bg)"
          />
        ),
        close: <XIcon className="size-4 text-accent-foreground" />,
        loading: <Loader2Icon className="size-4 animate-spin text-primary" />,
        ...icons,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
