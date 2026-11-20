import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { Printer, QrCode } from 'lucide-react';
import type { TailLabel } from '@shared/api.interface';
import { formatDate } from '@client/src/utils/datetime';
import { useI18n, tf } from '../../i18n';

// 按要求：标签宽70mm、高50mm，二维码25mm*25mm
const LABEL_WIDTH_MM = 70;
const LABEL_HEIGHT_MM = 50;
const QR_SIZE_MM = 25;
const PX_PER_MM = 96 / 25.4;

interface TailLabelPanelProps {
  labels: TailLabel[];
}

function buildQrContent(label: TailLabel): string {
  const supplierCode = label.supplierCode || '';
  const productionDate = label.productionDate || '';
  const batchNo = label.batchNo || '';
  // 六段码：供应商*料号*生产日期*数量*批次*流水号，流水号沿用扫描的原标签流水号
  return `${supplierCode}*${label.materialCode}*${productionDate}*${label.quantity}*${batchNo}*${label.labelNo}`;
}

const TailLabelPanel: React.FC<TailLabelPanelProps> = ({ labels }) => {
  const { t } = useI18n();
  const qrPx = useMemo(() => Math.round(QR_SIZE_MM * PX_PER_MM), []);
  const [printQueue, setPrintQueue] = useState<TailLabel[]>([]);
  const [isPrintReady, setIsPrintReady] = useState(false);

  // 等待DOM渲染完成后触发打印
  useEffect(() => {
    if (printQueue.length === 0) return;
    if (!isPrintReady) return;

    const timer = window.setTimeout(() => {
      window.print();
      setIsPrintReady(false);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [printQueue, isPrintReady]);

  // printQueue变化后，标签需要等待下一次渲染
  useEffect(() => {
    if (printQueue.length > 0) {
      const timer = window.setTimeout(() => setIsPrintReady(true), 50);
      return () => window.clearTimeout(timer);
    }
  }, [printQueue]);

  const handlePrintSingle = useCallback((label: TailLabel) => {
    setPrintQueue([label]);
  }, []);

  const handlePrintAll = useCallback(() => {
    if (labels.length === 0) return;
    setPrintQueue(labels);
  }, [labels]);

  return (
    <>
      <div className="border border-border rounded-lg bg-card p-3 flex flex-col" style={{ width: 320, minHeight: 200 }}>
        <div className="flex items-center gap-2 mb-3">
          <QrCode className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">{t('ui.尾数标签打印')}</span>
          {labels.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {tf('ui.共 {n} 张', { n: labels.length })}
            </Badge>
          )}
        </div>

        {labels.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground py-6">
            {t('ui.暂无尾数标签，发料拆箱后将在此显示')}
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {labels.map((label: TailLabel) => (
                <div
                  key={label.labelNo}
                  className="border border-border rounded-md p-2 bg-muted/20 relative"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs text-muted-foreground">{label.labelNo}</span>
                    <Badge
                      variant="outline"
                      className={label.direction === 'remain'
                        ? 'text-green-600 border-green-200 bg-green-50 text-xs'
                        : 'text-blue-600 border-blue-200 bg-blue-50 text-xs'}
                    >
                      {label.direction === 'remain' ? t('ui.留库') : t('ui.发出')}
                    </Badge>
                  </div>
                  <div className="text-xs font-medium truncate">
                    {label.materialCode} {label.materialName}
                  </div>
                  <div className="text-lg font-bold mt-1">
                    {label.quantity}
                    <span className="text-xs font-normal text-muted-foreground ml-1">{label.unit}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center justify-between">
                    <span className="truncate">{label.batchNo || '-'}</span>
                    <span className="shrink-0 ml-2">{formatDate(label.productionDate)}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute bottom-2 right-2 h-7 px-2 text-xs gap-1"
                    onClick={() => handlePrintSingle(label)}
                  >
                    <Printer className="w-3 h-3" />
                    {t('system.print')}
                  </Button>
                </div>
              ))}
            </div>
            <Button
              className="w-full mt-3 gap-2"
              onClick={handlePrintAll}
              disabled={labels.length === 0}
            >
              <Printer className="w-4 h-4" />
              {t('ui.批量打印全部')}
            </Button>
          </>
        )}
      </div>

      {/* 打印容器：默认隐藏，打印时通过CSS媒体查询独占页面 */}
      <div id="tail-label-print-area" style={{ display: 'none' }}>
        <style>{`
          @media print {
            body * {
              visibility: hidden !important;
            }
            #tail-label-print-area,
            #tail-label-print-area * {
              visibility: visible !important;
            }
            #tail-label-print-area {
              display: block !important;
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
            }
            .tail-label-page {
              page-break-after: always;
              break-after: page;
              width: ${LABEL_WIDTH_MM}mm;
              height: ${LABEL_HEIGHT_MM}mm;
              border: 1px solid #000;
              position: relative;
              overflow: hidden;
              background: #fff;
              padding: 2mm;
              box-sizing: border-box;
            }
            .tail-label-page:last-child {
              page-break-after: auto;
              break-after: auto;
            }
            .tail-label-qr {
              position: absolute;
              top: 2mm;
              right: 2mm;
              width: ${QR_SIZE_MM}mm;
              height: ${QR_SIZE_MM}mm;
            }
            .tail-label-text {
              width: calc(100% - ${QR_SIZE_MM}mm - 4mm);
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
              font-size: 7pt;
              line-height: 1.35;
              color: #000;
              word-break: break-all;
            }
            .tail-label-text .mono {
              font-family: monospace;
              font-weight: 700;
            }
            @page {
              size: ${LABEL_WIDTH_MM}mm ${LABEL_HEIGHT_MM}mm;
              margin: 0;
            }
          }
        `}</style>
        {printQueue.map((label: TailLabel) => (
          <div key={label.labelNo} className="tail-label-page">
            {/* 右上角二维码 */}
            <div className="tail-label-qr">
              <QRCodeCanvas
                value={buildQrContent(label)}
                size={qrPx}
                level="M"
                includeMargin={false}
              />
            </div>
            {/* 左侧文字 */}
            <div className="tail-label-text">
              <div>
                <strong>{t('ui.供应商：')}</strong>
                {label.supplierCode || '-'}
              </div>
              <div><strong>{t('ui.料号：')}</strong>{label.materialCode}</div>
              <div><strong>{t('ui.名称：')}</strong>{label.materialName}</div>
              <div><strong>{t('ui.生产日期：')}</strong>{formatDate(label.productionDate)}</div>
              <div><strong>{t('ui.批次：')}</strong>{label.batchNo || '-'}</div>
              <div><strong>{t('ui.数量：')}</strong>{label.quantity} {label.unit}</div>
              <div className="mono" style={{ marginTop: '1mm' }}>{t('ui.流水号：')}{label.labelNo}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default TailLabelPanel;
