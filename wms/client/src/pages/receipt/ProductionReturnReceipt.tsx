import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent } from '@client/src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  getProductionReturnReceiptList,
  generateProductionReturnLabels,
  scanProductionReturnInbound,
} from '@client/src/api/receipt';
import type { ProductionReturnReceiptItem } from '@client/src/api/receipt';
import { LABEL_STOCK_STATUS, RETURN_RECEIPT_STATUS, statusMeta } from '@client/src/constants/business-enums';
import type { ProductionReturn, ProductionReturnLabel } from '@shared/api.interface';
import { getAllLocations } from '@client/src/api/warehouse';
import type { WarehouseLocation } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { QRCodeCanvas } from 'qrcode.react';
import { renderDate } from '@client/src/utils/datetime';
import { toast } from 'sonner';
import { Printer, ScanLine } from 'lucide-react';
import { useI18n, tf, translate } from '../../i18n';



// 按 IQC 检验结果限定入库仓库类型：良品→良品仓，作业不良/来料不良→不良品仓
const needLabelTip = (stockStatus: string) =>
  stockStatus === 'good'
    ? translate('ui.良品标签只能绑定良品仓库库位')
    : translate('ui.不良品标签只能绑定不良品仓库库位');

const ProductionReturnReceipt: React.FC = () => {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProductionReturnReceiptItem[]>([]);

  const [returnNo, setReturnNo] = useState('');
  const [materialCode, setMaterialCode] = useState('');

  // Label print dialog
  const [printOpen, setPrintOpen] = useState(false);
  const [printItem, setPrintItem] = useState<ProductionReturn | null>(null);
  const [labels, setLabels] = useState<ProductionReturnLabel[]>([]);

  // Scan inbound dialog
  const [scanOpen, setScanOpen] = useState(false);
  const [scanItem, setScanItem] = useState<ProductionReturn | null>(null);
  const [labelNoInput, setLabelNoInput] = useState('');
  const [scannedLabel, setScannedLabel] = useState<ProductionReturnLabel | null>(null);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [actualQty, setActualQty] = useState<number>(0);
  const [inboundProgress, setInboundProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [submitting, setSubmitting] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async (p: number = page) => {
    setLoading(true);
    try {
      const res = await getProductionReturnReceiptList({
        page: p,
        pageSize,
        returnNo: returnNo || undefined,
        materialCode: materialCode || undefined,
      });
      setData(res.items);
      setTotal(res.total);
      setPage(p);
    } catch (error) {
      logger.error('Failed to fetch production return receipt list:', String(error));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, returnNo, materialCode]);

  useEffect(() => {
    fetchData(1);
  }, []);

  const handleSearch = () => fetchData(1);
  const handleReset = () => {
    setReturnNo('');
    setMaterialCode('');
    fetchData(1);
  };

  const statusBadge = (status: string) => {
    const cfg = statusMeta(RETURN_RECEIPT_STATUS, status, t);
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  };

  // Compute total IQC qty and received qty from a ProductionReturn
  const computeProgress = (pr: ProductionReturn): { done: number; total: number } => {
    const iqc = pr.iqcResult;
    const total = iqc ? (iqc.goodQty + iqc.incomingDefectQty + iqc.operationDefectQty) : 0;
    const done = (pr.receivedGoodQty || 0) + (pr.receivedIncomingDefectQty || 0) + (pr.receivedOperationDefectQty || 0);
    return { done, total };
  };

  // ===== Print labels =====
  const handleOpenPrint = async (record: ProductionReturn) => {
    setPrintItem(record);
    setLabels([]);
    setPrintOpen(true);
    try {
      const result = await generateProductionReturnLabels(record.id);
      setLabels(result);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || '生成标签失败');
      setPrintOpen(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // ===== Scan inbound =====
  const loadLocations = async (stockStatus: string) => {
    const locType = stockStatus === 'good' ? 'good' : 'defective';
    try {
      // 取系统全部启用库位后按类型过滤（原先用分页接口 pageSize:500，库位超过 500 会被静默截断）
      const all = await getAllLocations();
      setLocations(all.filter((l) => l.locationType === locType && l.status === 'active'));
    } catch (error) {
      logger.error('load locations failed', error);
      setLocations([]);
    }
  };

  const handleOpenScan = async (record: ProductionReturn) => {
    setScanItem(record);
    setLabelNoInput('');
    setScannedLabel(null);
    setLocations([]);
    setSelectedLocationId('');
    setLocationInput('');
    setActualQty(0);
    setInboundProgress(computeProgress(record));
    setScanOpen(true);
    try {
      const result = await generateProductionReturnLabels(record.id);
      setLabels(result);
      setTimeout(() => labelInputRef.current?.focus(), 100);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || '加载标签失败');
      setScanOpen(false);
    }
  };

  const handleLabelQuery = () => {
    const code = labelNoInput.trim();
    if (!code) return;
    const found = labels.find((l) => l.labelNo === code);
    if (!found) {
      toast.error(t('ui.未找到该标签号，请确认是否属于本退料单'));
      return;
    }
    setScannedLabel(found);
    setActualQty(found.quantity);
    setSelectedLocationId('');
    setLocationInput('');
    loadLocations(found.stockStatus);
    setTimeout(() => locationInputRef.current?.focus(), 150);
  };

  const handleLabelKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLabelQuery();
    }
  };

  // 扫描/输入仓库地址码 → 绑定库位（仅限当前标签类别允许的仓库类型）
  const handleLocationScan = () => {
    const code = locationInput.trim();
    if (!code || !scannedLabel) return;
    const found = locations.find((l) => l.locationCode.toLowerCase() === code.toLowerCase());
    if (!found) {
      const needType = scannedLabel.stockStatus === 'good' ? t('inventory.good') : t('inventory.defective');
      toast.error(tf('ui.未匹配到{type}库位「{code}」：请确认仓库地址码，且{tip}', { type: needType, code, tip: needLabelTip(scannedLabel.stockStatus) }));
      setSelectedLocationId('');
      return;
    }
    setSelectedLocationId(found.id);
    toast.success(tf('ui.已绑定库位：{code}', { code: found.locationCode }));
    setTimeout(() => {
      (document.activeElement as HTMLElement)?.blur?.();
    }, 0);
  };

  const handleLocationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLocationScan();
    }
  };

  const handleConfirmInbound = async () => {
    if (!scanItem || !scannedLabel) return;
    if (!selectedLocationId) {
      toast.error(t('ui.请选择库位'));
      return;
    }
    if (!actualQty || actualQty <= 0) {
      toast.error(t('ui.请输入有效入库数量'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await scanProductionReturnInbound({
        labelNo: scannedLabel.labelNo,
        locationId: selectedLocationId,
        quantity: actualQty,
      });
      const progress = computeProgress(result);
      setInboundProgress(progress);
      setScanItem(result);
      toast.success(tf('ui.入库成功：已入库 {done} / {total}', { done: progress.done, total: progress.total }));
      // Clear and prepare for next label
      setLabelNoInput('');
      setScannedLabel(null);
      setSelectedLocationId('');
      setActualQty(0);
      setTimeout(() => labelInputRef.current?.focus(), 100);
      if (result.status === 'received' || progress.done >= progress.total) {
        toast.success(t('ui.入库完成！'));
        setScanOpen(false);
        fetchData(page);
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || '入库失败');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: TableProps<ProductionReturnReceiptItem>['columns'] = [
    { title: t('ui.退料单号'), dataIndex: 'returnNo', width: 150, fixed: 'left' },
    { title: t('iqc.materialCode'), dataIndex: 'materialCode', width: 150 },
    { title: t('iqc.materialName'), dataIndex: 'materialName', width: 200 },
    { title: t('print.supplier'), dataIndex: 'supplierName', width: 140, render: (v: string) => v || '-' },
    { title: t('ui.退料数量'), dataIndex: 'quantity', width: 80, align: 'right' },
    {
      title: t('ui.良品数'),
      width: 75,
      align: 'right',
      render: (_: any, record: ProductionReturn) => record.iqcResult?.goodQty ?? '-',
    },
    {
      title: t('ui.来料不良'),
      width: 90,
      align: 'right',
      render: (_: any, record: ProductionReturn) => record.iqcResult?.incomingDefectQty ?? '-',
    },
    {
      title: t('ui.作业不良'),
      width: 90,
      align: 'right',
      render: (_: any, record: ProductionReturn) => record.iqcResult?.operationDefectQty ?? '-',
    },
    { title: t('common.status'), dataIndex: 'status', width: 105, render: (s: string) => statusBadge(s) },
    {
      title: t('common.action'),
      key: 'action',
      fixed: 'right',
      width: 230,
      render: (_: any, record: ProductionReturn) => {
        if (record.status === 'iqc_completed') {
          return (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => handleOpenPrint(record)}>
                <Printer className="w-3.5 h-3.5 mr-1" />{t('ui.打印标签')}
              </Button>
              <Button size="sm" style={{ backgroundColor: 'var(--primary)' }} onClick={() => handleOpenScan(record)}>
                <ScanLine className="w-3.5 h-3.5 mr-1" />{t('ui.扫码入库')}
              </Button>
            </div>
          );
        }
        return <Button size="sm" variant="outline" disabled>{t('common.view')}</Button>;
      },
    },
  ];

  const groupedLabels = (status: 'good' | 'incoming_defect' | 'operation_defect') =>
    labels.filter((l) => l.stockStatus === status);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('ui.退料单号')}</label>
              <Input value={returnNo} onChange={(e) => setReturnNo(e.target.value)} placeholder={t('ui.退料单号')} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('iqc.materialCode')}</label>
              <Input value={materialCode} onChange={(e) => setMaterialCode(e.target.value)} placeholder={t('iqc.materialCode')} />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleSearch}>{t('common.search')}</Button>
              <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <ResizableTable
            columns={columns}
            dataSource={data}
            loading={loading}
            rowKey="id"
            scroll={{ y: 500 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              onChange: (p: number) => fetchData(p),
            }}
          />
        </CardContent>
      </Card>

      {/* Label preview & print dialog */}
      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tf('ui.标签预览 - {no}', { no: printItem?.returnNo ?? '' })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {(['good', 'incoming_defect', 'operation_defect'] as const).map((status) => {
              const group = groupedLabels(status);
              if (group.length === 0) return null;
              const meta = LABEL_STOCK_STATUS[status];
              const cfg = meta ? { label: t(meta.labelKey), colorClass: meta.colorClass, badgeVariant: meta.variant } : undefined;
              return (
                <div key={status}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={cfg.badgeVariant}>{cfg.label}{tf('ui.（{n}张）', { n: group.length })}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {group.map((label) => (
                      <div key={label.labelNo} className={`border rounded-md p-3 ${cfg.colorClass}`}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-mono text-xs font-bold">{label.labelNo}</span>
                          <Badge variant={cfg.badgeVariant}>{cfg.label}</Badge>
                        </div>
                        <div className="flex gap-3">
                          <div className="flex-shrink-0">
                            <QRCodeCanvas
                              value={label.labelNo}
                              size={80}
                              level="M"
                              includeMargin={false}
                            />
                          </div>
                          <div className="text-sm space-y-0.5 flex-1">
                            <div><span className="text-muted-foreground">{t('ui.物料：')}</span>{label.materialCode} {label.materialName}</div>
                            <div><span className="text-muted-foreground">{t('ui.供应商代码：')}</span>{label.supplierCode || '-'}{label.supplierName ? `（${label.supplierName}）` : ''}</div>
                            <div><span className="text-muted-foreground">{t('ui.数量：')}</span>{label.quantity}</div>
                            <div><span className="text-muted-foreground">{t('ui.生产日期：')}</span>{renderDate(label.productionDate)}</div>
                            <div><span className="text-muted-foreground">{t('ui.批次：')}</span>{label.batchNo || '-'}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintOpen(false)}>{t('pda.close')}</Button>
            <Button onClick={handlePrint} disabled={labels.length === 0}>
              <Printer className="w-4 h-4 mr-1" />{t('ui.打印')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scan inbound dialog */}
      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tf('ui.扫码入库 - {no}', { no: scanItem?.returnNo })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted rounded-md p-2 text-sm flex justify-between">
              <span className="text-muted-foreground">{t('ui.入库进度')}</span>
              <span className="font-medium">{inboundProgress.done} / {inboundProgress.total}</span>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t('ui.标签号')}</label>
              <Input
                ref={labelInputRef}
                autoFocus
                value={labelNoInput}
                onChange={(e) => setLabelNoInput(e.target.value)}
                onKeyDown={handleLabelKeyDown}
                placeholder={t('ui.扫码或输入标签号后回车')}
              />
            </div>
            {scannedLabel && (
              <>
                <div className="bg-muted rounded-md p-3 text-sm space-y-1">
                  <div><span className="text-muted-foreground">{t('ui.标签号：')}</span>{scannedLabel.labelNo}</div>
                  <div><span className="text-muted-foreground">{t('ui.物料：')}</span>{scannedLabel.materialCode} {scannedLabel.materialName}</div>
                  <div><span className="text-muted-foreground">{t('ui.数量：')}</span>{scannedLabel.quantity}</div>
                  <div>
                    <span className="text-muted-foreground">{t('ui.分类：')}</span>
                    <Badge variant={(scannedLabel.stockStatus ? LABEL_STOCK_STATUS[scannedLabel.stockStatus]?.variant : undefined)} className="ml-1">
                      {scannedLabel.stockStatus && LABEL_STOCK_STATUS[scannedLabel.stockStatus] ? t(LABEL_STOCK_STATUS[scannedLabel.stockStatus]!.labelKey) : ''}
                    </Badge>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('ui.仓库地址码（扫码后回车）')}</label>
                  <Input
                    ref={locationInputRef}
                    autoFocus
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    onKeyDown={handleLocationKeyDown}
                    placeholder={t('ui.扫描仓库地址码或输入库位代码后回车')}
                  />
                  <p className="text-xs text-amber-600 mt-1">{needLabelTip(scannedLabel.stockStatus)}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('ui.已绑定库位')}</label>
                  <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={selectedLocationId ? undefined : t('ui.扫码绑定或手动选择库位')} />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.locationCode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('ui.实际入库数量')}</label>
                  <Input
                    type="number"
                    value={actualQty || ''}
                    onChange={(e) => setActualQty(Number(e.target.value))}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScanOpen(false)}>{t('pda.close')}</Button>
            <Button
              onClick={handleConfirmInbound}
              disabled={!scannedLabel || !selectedLocationId || submitting}
            >
              {submitting ? t('ui.入库中') : t('ui.确认入库')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 打印输出：Portal 直挂 body，标签 70mm × 50mm，兼容普通打印机与热敏标签打印机 */}
      {createPortal(
        <div id="pr-print-root">
          <style>{`
            #pr-print-root { display: none; }
            @media print {
              @page { size: 70mm 50mm; margin: 0; }
              body > *:not(#pr-print-root) { display: none !important; }
              #pr-print-root { display: block !important; }
              /* 压过其他页面注入的 body * { visibility:hidden } 全局打印规则 */
              #pr-print-root, #pr-print-root * { visibility: visible !important; }
              .pr-label {
                width: 70mm;
                height: 50mm;
                box-sizing: border-box;
                padding: 2mm 2.5mm;
                overflow: hidden;
                background: #fff;
                color: #000;
                font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
                font-size: 8.5pt;
                line-height: 1.45;
                display: flex;
                flex-direction: column;
                page-break-after: always;
                break-after: page;
                page-break-inside: avoid;
              }
              .pr-label:last-child { page-break-after: auto; break-after: auto; }
              .pr-label-head {
                display: flex;
                justify-content: space-between;
                align-items: baseline;
                font-weight: bold;
                font-size: 10.5pt;
                border-bottom: 0.4mm solid #000;
                padding-bottom: 1mm;
                margin-bottom: 1.2mm;
              }
              .pr-label-body {
                display: flex;
                gap: 2mm;
                flex: 1;
                overflow: hidden;
              }
              .pr-label-qr {
                width: 20mm;
                flex-shrink: 0;
                text-align: center;
              }
              .pr-label-qr canvas { width: 17mm; height: 17mm; }
              .pr-label-qrtext {
                font-family: monospace;
                font-size: 6.5pt;
                word-break: break-all;
                line-height: 1.2;
                margin-top: 0.5mm;
              }
              .pr-label-fields { flex: 1; border-collapse: collapse; }
              .pr-label-fields th {
                text-align: left;
                vertical-align: top;
                font-weight: normal;
                white-space: nowrap;
                padding: 0 1mm 0.6mm 0;
              }
              .pr-label-fields td {
                font-weight: 600;
                word-break: break-all;
                padding: 0 0 0.6mm 0;
              }
            }
          `}</style>
          {labels.map((label) => {
            const meta = LABEL_STOCK_STATUS[label.stockStatus] ?? LABEL_STOCK_STATUS.good;
            const cfg = { label: t(meta.labelKey), colorClass: meta.colorClass, badgeVariant: meta.variant };
            return (
              <div key={label.labelNo} className="pr-label">
                <div className="pr-label-head">
                  <span>{tf('ui.{label}标签', { label: cfg.label })}</span>
                  <span style={{ fontSize: '8pt' }}>{printItem?.returnNo}</span>
                </div>
                <div className="pr-label-body">
                  <div className="pr-label-qr">
                    <QRCodeCanvas
                      value={label.labelNo}
                      size={72}
                      level="M"
                      includeMargin={false}
                      style={{ width: '17mm', height: '17mm' }}
                    />
                    <div className="pr-label-qrtext">{label.serialNo || label.labelNo.split('*')[5] || label.labelNo}</div>
                  </div>
                  <table className="pr-label-fields">
                    <tbody>
                      <tr><th>{t('ui.物料编码：')}</th><td>{label.materialCode}</td></tr>
                      <tr><th>{t('ui.物料名称：')}</th><td>{label.materialName}</td></tr>
                      <tr><th>{t('ui.供应商代码：')}</th><td>{label.supplierCode || '-'}</td></tr>
                      <tr><th>{t('ui.数　　量：')}</th><td>{label.quantity}</td></tr>
                      <tr><th>{t('ui.生产日期：')}</th><td>{renderDate(label.productionDate)}</td></tr>
                      <tr><th>{t('ui.批次号：')}</th><td>{label.batchNo || '-'}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
};

export default ProductionReturnReceipt;
