// ── Barcode scanner capture hook ─────────────────────────────────────────────
// Barcode scanners send rapid keystrokes (<80ms between chars) ending with Enter.
// We detect this pattern and extract the SN string.

import { useEffect, useRef } from 'react';

const SCAN_MAX_GAP_MS = 80;
const SCAN_MIN_CHARS = 3;
const SCAN_FINAL_WAIT_MS = 150;

type KeyboardTarget = {
  isContentEditable?: boolean;
  tagName?: string;
  getAttribute?: (name: string) => string | null;
};

/**
 * Manual entry fields own their keyboard input. A scanner-only field can opt
 * back into global capture with data-scanner-capture="true".
 */
export function shouldIgnoreScannerKey(target: EventTarget | null): boolean {
  const element = target as KeyboardTarget | null;
  if (!element) return false;
  if (element.getAttribute?.('data-scanner-capture') === 'true') return false;
  return element.isContentEditable === true || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT';
}

export function useBarcodeCapture(onScan: (sn: string) => void) {
  const buffer = useRef<string[]>([]);
  const lastKeyTime = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || e.repeat || shouldIgnoreScannerKey(e.target)) return;
      const now = Date.now();
      const gap = now - lastKeyTime.current;

      // Printable character
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (gap < SCAN_MAX_GAP_MS) {
          buffer.current.push(e.key);
        } else {
          buffer.current = [e.key];
        }
        lastKeyTime.current = now;

        // Reset finalization timer
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          if (buffer.current.length >= SCAN_MIN_CHARS) {
            onScan(buffer.current.join('').trim().toUpperCase());
          }
          buffer.current = [];
          lastKeyTime.current = 0;
        }, SCAN_FINAL_WAIT_MS);
        return;
      }

      // Enter — finalize immediately
      if (e.key === 'Enter') {
        if (timer.current !== null) clearTimeout(timer.current);
        if (buffer.current.length >= SCAN_MIN_CHARS) {
          onScan(buffer.current.join('').trim().toUpperCase());
        }
        buffer.current = [];
        lastKeyTime.current = 0;
        timer.current = null;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onScan]);
}
