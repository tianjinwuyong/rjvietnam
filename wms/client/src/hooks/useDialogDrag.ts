import { useRef, useEffect, useCallback } from 'react';

interface UseDialogDragOptions {
  open: boolean;
}

export function useDialogDrag({ open }: UseDialogDragOptions) {
  const dragState = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    el: null as HTMLElement | null,
    rafId: 0,
    pendingX: 0,
    pendingY: 0,
  });

  const applyPosition = useCallback(() => {
    const s = dragState.current;
    if (!s.dragging || !s.el) return;
    const el = s.el;

    const dx = s.pendingX - s.startX;
    const dy = s.pendingY - s.startY;

    let newLeft = s.startLeft + dx;
    let newTop = s.startTop + dy;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    newLeft = Math.max(0, Math.min(vw - w, newLeft));
    newTop = Math.max(0, Math.min(vh - h, newTop));

    el.style.left = `${newLeft}px`;
    el.style.top = `${newTop}px`;
    el.style.transform = 'none';
    s.rafId = 0;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, [role="button"], input, textarea, select, a')) {
      return;
    }
    const dialogEl = target.closest('[data-slot="dialog-content"]') as HTMLElement | null;
    if (!dialogEl) return;

    const rect = dialogEl.getBoundingClientRect();
    dragState.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      el: dialogEl,
      rafId: 0,
      pendingX: e.clientX,
      pendingY: e.clientY,
    };
    e.preventDefault();
    e.stopPropagation();
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleMouseMove = (e: MouseEvent) => {
      const s = dragState.current;
      if (!s.dragging || !s.el) return;
      s.pendingX = e.clientX;
      s.pendingY = e.clientY;
      if (!s.rafId) {
        s.rafId = requestAnimationFrame(applyPosition);
      }
    };

    const handleMouseUp = () => {
      const s = dragState.current;
      if (s.rafId) {
        cancelAnimationFrame(s.rafId);
        s.rafId = 0;
      }
      s.dragging = false;
      s.el = null;
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      const s = dragState.current;
      if (s.rafId) {
        cancelAnimationFrame(s.rafId);
        s.rafId = 0;
      }
      document.body.style.userSelect = '';
    };
  }, [open, applyPosition]);

  const resetPosition = useCallback(() => {
    const els = document.querySelectorAll('[data-slot="dialog-content"]');
    els.forEach((el) => {
      const h = el as HTMLElement;
      h.style.left = '';
      h.style.top = '';
      h.style.transform = '';
    });
  }, []);

  return {
    handleMouseDown,
    resetPosition,
  };
}
