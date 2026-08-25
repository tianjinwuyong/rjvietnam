import { describe, expect, it } from 'vitest';
import { shouldIgnoreScannerKey } from './useBarcodeCapture';

describe('scanner keyboard focus boundary', () => {
  it('captures scans independently of non-editable focus', () => {
    expect(shouldIgnoreScannerKey(null)).toBe(false);
    expect(shouldIgnoreScannerKey({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
  });

  it('leaves international and fallback typing inside editable controls', () => {
    expect(shouldIgnoreScannerKey({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(shouldIgnoreScannerKey({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(shouldIgnoreScannerKey({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('allows a dedicated scan input to opt into global capture', () => {
    const target = {
      tagName: 'INPUT',
      getAttribute: (name: string) => name === 'data-scanner-capture' ? 'true' : null,
    } as unknown as EventTarget;
    expect(shouldIgnoreScannerKey(target)).toBe(false);
  });
});
