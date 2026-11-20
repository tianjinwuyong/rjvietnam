import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useI18n } from '@client/src/i18n';
import { QRCodeCanvas } from 'qrcode.react';
import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { X, Printer } from 'lucide-react';
import type { WarehouseLocation } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';

interface LocationLabelPrintProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedLocations: WarehouseLocation[];
  onRemove: (id: string) => void;
  singleLocation?: WarehouseLocation | null;
}

const LABEL_WIDTH_MM = 40;
const LABEL_HEIGHT_MM = 60;
const QR_SIZE_MM = 30;
const QR_AREA_HEIGHT_MM = 40;
const TEXT_AREA_HEIGHT_MM = 20;
const GAP_MM = 1.5;
const FONT_SIZE_MM = 3;

const LocationLabelPrint: React.FC<LocationLabelPrintProps> = ({
  open,
  onOpenChange,
  selectedLocations,
  onRemove,
  singleLocation,
}) => {
  const { t } = useI18n();
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const locations = useMemo(() => {
    if (singleLocation) return [singleLocation];
    return selectedLocations;
  }, [singleLocation, selectedLocations]);

  const isSingleMode = Boolean(singleLocation);

  const pxPerMm = useMemo(() => 96 / 25.4, []);
  const qrPx = useMemo(() => Math.round(QR_SIZE_MM * pxPerMm), [pxPerMm]);
  const fontSizePx = useMemo(() => FONT_SIZE_MM * pxPerMm, [pxPerMm]);

  const handlePrint = useCallback(() => {
    if (locations.length === 0) return;
    if (!canvasContainerRef.current) return;

    const canvases = canvasContainerRef.current.querySelectorAll('canvas');
    const dataUrls: string[] = [];
    canvases.forEach((c: HTMLCanvasElement) => {
      try {
        dataUrls.push(c.toDataURL('image/png'));
      } catch (_e) {
        dataUrls.push('');
      }
    });

    const printWin = window.open('', '_blank', 'width=600,height=800,scrollbars=yes');
    if (!printWin) {
      toast(t('message.printWindowBlocked'));
      return;
    }

    const labelsHtml = locations.map((loc: WarehouseLocation, idx: number) => `
      <div class="label-item">
        <div class="qr-area">
          <img src="${dataUrls[idx] || ''}" alt="" />
        </div>
        <div class="gap-area"></div>
        <div class="text-area">
          <div class="label-text">${escapeHtml(loc.locationCode)}</div>
        </div>
      </div>
    `).join('');

    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${t('system.printLabel')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #fff;
    color: #000;
  }
  .tip {
    padding: 10px;
    font-size: 13px;
    color: #666;
    text-align: center;
    border-bottom: 1px solid #eee;
  }
  .label-container {
    display: flex;
    flex-wrap: wrap;
    gap: 2mm;
    padding: 5mm;
    align-content: flex-start;
  }
  .label-item {
    width: ${LABEL_WIDTH_MM}mm;
    height: ${LABEL_HEIGHT_MM}mm;
    border: 1px solid #000;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
    background: #fff;
  }
  .qr-area {
    width: 100%;
    height: ${QR_AREA_HEIGHT_MM}mm;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .qr-area img {
    width: ${QR_SIZE_MM}mm;
    height: ${QR_SIZE_MM}mm;
    display: block;
    image-rendering: pixelated;
  }
  .gap-area { height: ${GAP_MM}mm; }
  .text-area {
    width: 100%;
    height: ${TEXT_AREA_HEIGHT_MM - GAP_MM}mm;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 1mm;
    font-size: ${FONT_SIZE_MM}mm;
    font-weight: 700;
    text-align: center;
    word-break: break-all;
    line-height: 1.15;
  }
  @page {
    size: auto;
    margin: 5mm;
  }
  @media print {
    .tip { display: none; }
    body { background: white; }
    .label-container { padding: 0; gap: 0; }
  }
</style>
</head>
<body>
  <div class="tip">${t('system.printTip')}</div>
  <div class="label-container">
    ${labelsHtml}
  </div>
</body>
</html>`);

    printWin.document.close();
    printWin.focus();

    const triggerPrint = () => {
      try {
        printWin.print();
      } catch (e) {
        logger.error('Print failed:', String(e));
      }
    };

    if (printWin.document.readyState === 'complete') {
      setTimeout(triggerPrint, 300);
    } else {
      printWin.addEventListener('load', () => setTimeout(triggerPrint, 300), { once: true });
    }
  }, [locations, t]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('system.printLabel')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {t('system.labelSpec')}: {LABEL_WIDTH_MM}mm × {LABEL_HEIGHT_MM}mm
            </div>
            <Button variant="outline" onClick={handlePrint} className="gap-2">
              <Printer size={16} />
              {t('system.print')}
            </Button>
          </div>

          {!isSingleMode && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                {t('system.selectedLocations')} ({selectedLocations.length})
              </div>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-2 border border-border rounded-md bg-muted/30">
                {selectedLocations.length === 0 ? (
                  <span className="text-sm text-muted-foreground">{t('message.noData')}</span>
                ) : (
                  selectedLocations.map((loc: WarehouseLocation) => (
                    <span
                      key={loc.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-soft text-primary text-xs rounded"
                    >
                      {loc.locationCode}
                      <button
                        onClick={() => onRemove(loc.id)}
                        className="hover:text-destructive transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">{t('system.printPreview')}</div>
            <div className="border border-dashed border-border rounded-md p-4 bg-white">
              <div
                className="flex flex-wrap gap-2"
                style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
              >
                {locations.length === 0 ? (
                  <div className="w-full text-center text-sm text-muted-foreground py-8">
                    {t('message.noData')}
                  </div>
                ) : (
                  locations.map((loc: WarehouseLocation) => (
                    <div
                      key={loc.id}
                      className="label-item border border-border bg-white flex flex-col items-center overflow-hidden"
                      style={{
                        width: `${LABEL_WIDTH_MM}mm`,
                        height: `${LABEL_HEIGHT_MM}mm`,
                      }}
                    >
                      <div
                        className="flex items-center justify-center w-full"
                        style={{ height: `${QR_AREA_HEIGHT_MM}mm` }}
                      >
                        <QRCodeCanvas
                          value={loc.locationCode}
                          size={qrPx}
                          level="M"
                          includeMargin={false}
                        />
                      </div>
                      <div style={{ height: `${GAP_MM}mm` }} />
                      <div
                        className="flex items-center justify-center w-full px-1"
                        style={{
                          height: `${TEXT_AREA_HEIGHT_MM - GAP_MM}mm`,
                          fontSize: `${fontSizePx}px`,
                        }}
                      >
                        <div className="font-bold text-foreground text-center break-all w-full leading-tight">
                          {loc.locationCode}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div ref={canvasContainerRef} style={{ display: 'none' }} aria-hidden>
            {locations.map((loc: WarehouseLocation) => (
              <QRCodeCanvas
                key={loc.id}
                value={loc.locationCode}
                size={qrPx}
                level="M"
                includeMargin={false}
              />
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('common.close')}
          </Button>
          <Button onClick={handlePrint} disabled={locations.length === 0} className="gap-2">
            <Printer size={16} />
            {t('system.print')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default LocationLabelPrint;
