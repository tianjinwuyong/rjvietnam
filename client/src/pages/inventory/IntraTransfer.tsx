import React, { useState, useRef, useEffect } from 'react';
import { useI18n, tf } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import ScanInput from '@client/src/components/ScanInput';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent } from '@client/src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { logger } from '@client/src/utils/logger';
import { speakSuccess, speakError as speakErrorVoice } from '@client/src/utils/speech';
import { beepError } from '@client/src/utils/beep';
import { renderDateTime, formatDate } from '@client/src/utils/datetime';
import {
  verifySourceLocation,
  verifyTargetLocation,
  batchIntraTransfer,
  getTransferList,
  type ScannedMoveItem,
} from '@client/src/api/inventory';
import { toast } from 'sonner';
import type { StockTransfer } from '@shared/api.interface';
import ResizableTable from '@client/src/components/ui/resizable-table';
import type { TableProps } from '@client/src/compat/antd-table';
import { ScanLine, Package, ArrowRight, CheckCircle, Trash2, MapPin, Plus, Minus } from 'lucide-react';

interface PendingItem {
  key: string;
  qrContent: string;
  supplierCode: string;
  materialCode: string;
  materialName: string;
  unit: string;
  productionDate: string;
  batchNo: string;
  serialNo: string;
  quantity: number;
}

const IntraTransfer: React.FC = () => {
  const { t, lang } = useI18n();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [materialInput, setMaterialInput] = useState('');
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [scanning, setScanning] = useState(false);

  const [sourceInput, setSourceInput] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [sourceInfo, setSourceInfo] = useState<{ locationId: string; locationCode: string; warehouseId: string; whCode?: string; items: ScannedMoveItem[] } | null>(null);
  const [verifiedItems, setVerifiedItems] = useState<ScannedMoveItem[]>([]);

  const [targetInput, setTargetInput] = useState('');
  const [targetError, setTargetError] = useState('');
  const [targetInfo, setTargetInfo] = useState<{ locationId: string; locationCode: string; warehouseId: string; whCode?: string } | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [recordList, setRecordList] = useState<StockTransfer[]>([]);

  const [errorDialog, setErrorDialog] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{ errorCode: string; errorMessage: string; qrContent?: string; parsed?: any } | null>(null);

  const materialRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);

  // 成功/失败提示统一走 utils/speech + utils/beep，保证蜂鸣音与三语文案一致
  const speakOk = () => {
    speakSuccess();
  };

  const speakError = (text: string) => {
    beepError();
    speakErrorVoice(text);
  };

  const parseQr = (raw: string) => {
    const parts = raw.split('*');
    if (parts.length < 6) {
      throw new Error(t('receipt.scanFailed'));
    }
    const [supplierCode, materialCode, productionDate, qtyStr, batchNo, serialNo] = parts;
    const quantity = Number(qtyStr);
    if (isNaN(quantity) || quantity <= 0) {
      throw new Error(t('receipt.scanFailed'));
    }
    return { supplierCode, materialCode, productionDate, quantity, batchNo, serialNo };
  };

  const handleMaterialScan = () => {
    const raw = materialInput.trim();
    if (!raw || scanning) return;
    setScanning(true);
    try {
      const parsed = parseQr(raw);
      const existing = pendingItems.find(
        (p) =>
          p.supplierCode === parsed.supplierCode &&
          p.materialCode === parsed.materialCode &&
          p.batchNo === parsed.batchNo &&
          p.serialNo === parsed.serialNo,
      );
      if (existing) {
        setErrorInfo({ errorCode: 'duplicate', errorMessage: t('ui.重复扫码'), qrContent: raw, parsed });
        setErrorDialog(true);
        speakError(t('ui.重复扫码'));
        setMaterialInput('');
        setTimeout(() => materialRef.current?.focus(), 50);
        return;
      }
      const newItem: PendingItem = {
        key: `${parsed.serialNo}-${Date.now()}`,
        qrContent: raw,
        supplierCode: parsed.supplierCode,
        materialCode: parsed.materialCode,
        materialName: '',
        unit: '',
        productionDate: parsed.productionDate,
        batchNo: parsed.batchNo,
        serialNo: parsed.serialNo,
        quantity: parsed.quantity,
      };
      setPendingItems((prev) => [...prev, newItem]);
      toast.success(`${parsed.materialCode} +${parsed.quantity}`);
      speakOk();
      setMaterialInput('');
      setTimeout(() => materialRef.current?.focus(), 50);
    } catch (e: any) {
      setErrorInfo({ errorCode: 'invalid_format', errorMessage: e?.message || t('receipt.scanFailed'), qrContent: raw });
      setErrorDialog(true);
      speakError(t('receipt.scanFailed'));
      setMaterialInput('');
      setTimeout(() => materialRef.current?.focus(), 50);
    } finally {
      setScanning(false);
    }
  };

  const handleMaterialKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleMaterialScan();
    }
  };

  const removeItem = (key: string) => {
    setPendingItems((prev) => prev.filter((p) => p.key !== key));
  };

  const adjustQty = (key: string, delta: number) => {
    setPendingItems((prev) =>
      prev.map((p) => (p.key === key ? { ...p, quantity: Math.max(1, p.quantity + delta) } : p)),
    );
  };

  const handleNextToSource = () => {
    if (pendingItems.length === 0) {
      toast.error(t('ui.请先扫描物料'));
      return;
    }
    setStep(2);
    setTimeout(() => sourceRef.current?.focus(), 50);
  };

  const handleSourceVerify = async () => {
    const code = sourceInput.trim();
    if (!code) {
      setSourceError(t('ui.请扫描或输入源地址码'));
      return;
    }
    try {
      const items = pendingItems.map((p) => ({
        qrContent: p.qrContent,
        supplierCode: p.supplierCode,
        materialCode: p.materialCode,
        productionDate: p.productionDate,
        batchNo: p.batchNo,
        serialNo: p.serialNo,
        quantity: p.quantity,
      }));
      const result = await verifySourceLocation({ locationCode: code, items });
      if (!result.valid) {
        setSourceError(result.errorMessage || t('ui.源库位校验失败'));
        setSourceInfo(null);
        setVerifiedItems([]);
        speakError(result.errorMessage || t('ui.源库位校验失败'));
        setErrorInfo({
          errorCode: result.errorCode || 'source_stock_mismatch',
          errorMessage: result.errorMessage || t('ui.源库位校验失败'),
          parsed: result.failedItems,
        });
        setErrorDialog(true);
        return;
      }
      setSourceInfo({
        locationId: result.locationId!,
        locationCode: result.locationCode!,
        warehouseId: result.warehouseId!,
        whCode: result.whCode,
        items: result.items || [],
      });
      setVerifiedItems(result.items || []);
      setSourceError('');
      toast.success(t('ui.源库位校验通过'));
      speakOk();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || t('ui.源库位校验失败');
      setSourceError(msg);
      setSourceInfo(null);
      setVerifiedItems([]);
      speakError(msg);
    }
  };

  const handleSourceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSourceVerify();
    }
  };

  const handleNextToTarget = () => {
    if (!sourceInfo) {
      toast.error(t('ui.请先校验源地址码'));
      return;
    }
    setStep(3);
    setTimeout(() => targetRef.current?.focus(), 50);
  };

  const handleTargetVerify = async () => {
    const code = targetInput.trim();
    if (!code) {
      setTargetError(t('ui.请扫描或输入目标地址码'));
      return;
    }
    if (!sourceInfo) return;
    try {
      const result = await verifyTargetLocation({
        targetLocationCode: code,
        sourceWarehouseId: sourceInfo.warehouseId,
      });
      if (!result.valid) {
        setTargetError(result.errorMessage || t('ui.目标地址码校验失败'));
        setTargetInfo(null);
        speakError(result.errorMessage || t('ui.目标地址码校验失败'));
        if (result.errorCode === 'cross_warehouse') {
          setErrorInfo({
            errorCode: 'cross_warehouse',
            errorMessage: t('ui.跨仓请用库存调拨'),
          });
          setErrorDialog(true);
        }
        return;
      }
      setTargetInfo({
        locationId: result.locationId!,
        locationCode: result.locationCode!,
        warehouseId: result.warehouseId!,
        whCode: result.whCode,
      });
      setTargetError('');
      toast.success(t('ui.目标地址码校验通过'));
      speakOk();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || t('ui.目标地址码校验失败');
      setTargetError(msg);
      setTargetInfo(null);
      speakError(msg);
    }
  };

  const handleTargetKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTargetVerify();
    }
  };

  const handleConfirmMove = async () => {
    if (!sourceInfo || !targetInfo || verifiedItems.length === 0) return;
    setSubmitting(true);
    try {
      const results = await batchIntraTransfer({
        fromLocationId: sourceInfo.locationId,
        toLocationId: targetInfo.locationId,
        warehouseId: sourceInfo.warehouseId,
        items: verifiedItems,
      });
      toast.success(tf('ui.移库成功：{n} 条', { n: results.length }));
      speakOk();
      setStep(1);
      setPendingItems([]);
      setMaterialInput('');
      setSourceInput('');
      setSourceInfo(null);
      setSourceError('');
      setVerifiedItems([]);
      setTargetInput('');
      setTargetInfo(null);
      setTargetError('');
      setPage(1);
      fetchRecords(1);
      setTimeout(() => materialRef.current?.focus(), 50);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '移库失败';
      toast.error(msg);
      speakError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setPendingItems([]);
    setMaterialInput('');
    setSourceInput('');
    setSourceInfo(null);
    setSourceError('');
    setVerifiedItems([]);
    setTargetInput('');
    setTargetInfo(null);
    setTargetError('');
    setTimeout(() => materialRef.current?.focus(), 50);
  };

  const fetchRecords = async (p: number = page) => {
    setLoading(true);
    try {
      const res = await getTransferList({
        page: p,
        pageSize,
        status: 'intra_move',
      });
      setRecordList(res.items);
      setTotal(res.total);
    } catch (error) {
      logger.error('Failed to fetch intra transfers:', String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalQty = pendingItems.reduce((s, p) => s + p.quantity, 0);

  const columns: TableProps<StockTransfer>['columns'] = [
    { title: t('inventory.intraTransferNo'), dataIndex: 'transferNo', width: 180 },
    { title: t('inventory.fromLocation'), dataIndex: 'fromLocationCode', width: 160 },
    { title: t('inventory.toLocation'), dataIndex: 'toLocationCode', width: 160 },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 140 },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 160 },
    { title: t('common.batch'), dataIndex: 'batchNo', width: 120 },
    { title: t('common.quantity'), dataIndex: 'quantity', width: 100, align: 'right' },
    { title: t('common.unit'), dataIndex: 'unit', width: 80 },
    { title: t('inventory.operationTime'), dataIndex: 'transferDate', width: 120, render: renderDateTime },
    { title: t('common.remark'), dataIndex: 'remark', width: 150 },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <h2 className="text-xl font-semibold text-foreground mb-1">{t('nav.intraTransfer')}</h2>
          <p className="text-sm text-muted-foreground mb-5">
            {t('ui.扫描物料标签 → 扫描源地址码校验库存 → 扫描目标地址码 → 完成同仓移库')}
          </p>

          <div className="flex items-center gap-2 mb-5">
            {[{ n: 1, label: t('ui.扫描物料') }, { n: 2, label: t('ui.源地址码') }, { n: 3, label: t('ui.目标地址码') }].map((s) => (
              <React.Fragment key={s.n}>
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${step === s.n ? 'bg-primary text-white' : step > s.n ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                  {step > s.n ? <CheckCircle className="w-4 h-4" /> : <span className="w-5 h-5 rounded-full bg-card/20 flex items-center justify-center text-xs">{s.n}</span>}
                  {s.label}
                </div>
                {s.n < 3 && <ArrowRight className="w-4 h-4 text-muted-foreground" />}
              </React.Fragment>
            ))}
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1">
                  <ScanLine className="w-4 h-4 text-primary" />
                  {t('ui.扫描物料标签（供应商二维码）')}
                </label>
                <div className="flex gap-2">
                  <ScanInput
                    inputRef={materialRef}
                    value={materialInput}
                    onChange={setMaterialInput}
                    onScan={handleMaterialScan}
                    onKeyDown={handleMaterialKeyDown}
                    placeholder={t('ui.扫描或输入供应商二维码：供应商代码*料号*生产日期*数量*批次*流水号')}
                    inputClassName="max-w-xl"
                    className="flex-1"
                  />
                  <Button onClick={handleMaterialScan} disabled={scanning}>
                    <CheckCircle className="w-4 h-4 mr-1" />
                    {t('common.confirm')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('ui.连续扫码添加到待移库清单，支持数量调整')}
                </p>
              </div>

              {pendingItems.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground bg-muted/30 rounded-lg">
                  <Package className="w-12 h-12 mx-auto mb-2 opacity-40" />
                  <p>{t('ui.暂无待移库物料，请先扫描物料标签')}</p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-border rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground w-12">#</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('material.materialCode')}</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('material.materialName')}</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('common.batch')}</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('common.productionDate')}</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('receipt.serialNumber')}</th>
                        <th className="text-right py-2 px-3 font-medium text-muted-foreground w-36">{t('common.quantity')}</th>
                        <th className="text-center py-2 px-3 font-medium text-muted-foreground w-20">{t('common.operation')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingItems.map((item, idx) => (
                        <tr key={item.key} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="py-2 px-3 text-muted-foreground">{idx + 1}</td>
                          <td className="py-2 px-3 font-mono font-medium">{item.materialCode}</td>
                          <td className="py-2 px-3">{item.materialName || '-'}</td>
                          <td className="py-2 px-3">{item.batchNo}</td>
                          <td className="py-2 px-3">{formatDate(item.productionDate)}</td>
                          <td className="py-2 px-3 font-mono text-xs">{item.serialNo}</td>
                          <td className="py-2 px-3">
                            <div className="flex items-center justify-end gap-1">
                              <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => adjustQty(item.key, -1)}>
                                <Minus className="w-3 h-3" />
                              </Button>
                              <span className="w-12 text-center font-medium">{item.quantity}</span>
                              <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => adjustQty(item.key, 1)}>
                                <Plus className="w-3 h-3" />
                              </Button>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeItem(item.key)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex items-center justify-between">
                <Badge variant="secondary">
                  {pendingItems.length} {t('common.items')} / {totalQty} {t('common.quantity')}
                </Badge>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>
                  <Button onClick={handleNextToSource} disabled={pendingItems.length === 0}>
                    {t('ui.下一步：扫源地址码')} <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-primary" />
                  {t('ui.扫描源地址码')}
                </label>
                <div className="flex gap-2">
                  <ScanInput
                    inputRef={sourceRef}
                    value={sourceInput}
                    onChange={(v) => { setSourceInput(v); setSourceError(''); }}
                    onScan={handleSourceVerify}
                    onKeyDown={handleSourceKeyDown}
                    placeholder={t('ui.扫描或输入源仓库地址码')}
                    inputClassName="max-w-md"
                  />
                  <Button onClick={handleSourceVerify} disabled={!sourceInput.trim()}>
                    <CheckCircle className="w-4 h-4 mr-1" />
                    {t('ui.校验库存')}
                  </Button>
                </div>
                {sourceError && <p className="text-xs text-destructive mt-1">{sourceError}</p>}
                {sourceInfo && (
                  <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    {tf('ui.仓库：{wh}，源地址码：{loc}，共 {n} 条匹配', { wh: sourceInfo.whCode, loc: sourceInfo.locationCode, n: verifiedItems.length })}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t('ui.校验通过后将从源库位扣除对应批次库存')}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(1)}>{t('ui.上一步')}</Button>
                  <Button onClick={handleNextToTarget} disabled={!sourceInfo}>
                    {t('ui.下一步：扫目标地址码')} <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-1">{t('ui.源地址码')}</div>
                  <div className="font-semibold">{sourceInfo?.locationCode}</div>
                  <div className="text-xs text-muted-foreground mt-1">{t('ui.仓库：')}{sourceInfo?.whCode}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1">
                    <MapPin className="w-4 h-4 text-primary" />
                    {t('ui.扫描目标地址码')}
                  </label>
                  <div className="flex gap-2">
                    <ScanInput
                      inputRef={targetRef}
                      value={targetInput}
                      onChange={(v) => { setTargetInput(v); setTargetError(''); }}
                      onScan={handleTargetVerify}
                      onKeyDown={handleTargetKeyDown}
                      placeholder={t('ui.扫描或输入目标仓库地址码')}
                    />
                    <Button onClick={handleTargetVerify} disabled={!targetInput.trim()}>
                      <CheckCircle className="w-4 h-4 mr-1" />
                      {t('ui.校验')}
                    </Button>
                  </div>
                  {targetError && <p className="text-xs text-destructive mt-1">{targetError}</p>}
                  {targetInfo && (
                    <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      {tf('ui.目标地址码：{loc}（同仓）', { loc: targetInfo.locationCode })}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {tf('ui.确认后将把 {n} 条物料从源地址码移到目标地址码', { n: verifiedItems.length })}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(2)}>{t('ui.上一步')}</Button>
                  <Button onClick={handleConfirmMove} disabled={!targetInfo || submitting}>
                    {submitting ? t('common.saving') : t('ui.确认移库')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">{t('inventory.transferRecord')}</h3>
          <ResizableTable
            columns={columns}
            dataSource={recordList}
            loading={loading}
            rowKey="id"
            scroll={{ x: 1300, y: 400 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              showTotal: (tot: number) => `${t('common.total')} ${tot} ${t('common.items')}`,
              onChange: (p: number) => { setPage(p); fetchRecords(p); },
            }}
          />
        </CardContent>
      </Card>

      <Dialog open={errorDialog} onOpenChange={setErrorDialog}>
        <DialogContent className="max-w-lg border-destructive/40">
          <DialogHeader>
            <DialogTitle className="text-destructive text-lg">
              ⚠ {errorInfo?.errorMessage || '扫码失败'}
            </DialogTitle>
            <DialogDescription className="text-foreground/70">
              {errorInfo?.errorCode}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {errorInfo?.qrContent && (
              <div className="bg-muted/50 rounded-md p-3 border border-border">
                <div className="text-muted-foreground text-xs mb-1">{t('ui.原始内容')}</div>
                <div className="font-mono text-foreground break-all">{errorInfo.qrContent}</div>
              </div>
            )}
            {errorInfo?.parsed && Array.isArray(errorInfo.parsed) && (
              <div>
                <div className="text-muted-foreground text-xs mb-1">{t('ui.失败明细')}</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {errorInfo.parsed.map((f: any, idx: number) => (
                    <div key={idx} className="text-xs bg-muted/30 px-2 py-1 rounded">
                      {f.materialCode} / {f.batchNo} / {f.serialNo} - {f.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={() => setErrorDialog(false)}>
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IntraTransfer;
