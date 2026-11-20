import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import ScanInput from '@client/src/components/ScanInput';
import { speakSuccess, speakError as speakErrorVoice } from '@client/src/utils/speech';
import { beepError } from '@client/src/utils/beep';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { logger } from '@client/src/utils/logger';
import { formatDate } from '@client/src/utils/datetime';
import { extractApiError } from '@client/src/utils/apiError';
import { verifyQr, getActiveWarehouses, verifyLocationCode, batchReceipt, type VerifyQrResult } from '@client/src/api/receipt';
import { toast } from 'sonner';
import type { ReceiptOrder, Warehouse, WarehouseLocation } from '@shared/api.interface';
import { MapPin, Warehouse as WarehouseIcon, ScanLine, Package, CheckCircle, Trash2, Plus, Minus } from 'lucide-react';

interface ScanErrorInfo {
  errorCode: string;
  errorMessage: string;
  qrContent: string;
  parsed?: VerifyQrResult;
}

interface PendingItem {
  key: string;
  qrContent: string;
  supplierCode: string;
  supplierName?: string;
  materialCode: string;
  materialName?: string;
  unit?: string;
  productionDate: string;
  batchNo: string;
  serialNo: string;
  quantity: number;
}

const ReceiptScan: React.FC = () => {
  const { t, lang } = useI18n();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [locationInfo, setLocationInfo] = useState<WarehouseLocation | null>(null);
  const [locationError, setLocationError] = useState('');
  const [materialInput, setMaterialInput] = useState('');
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recentList, setRecentList] = useState<ReceiptOrder[]>([]);
  const [errorDialog, setErrorDialog] = useState(false);
  const [errorInfo, setErrorInfo] = useState<ScanErrorInfo | null>(null);
  const materialRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getActiveWarehouses()
      .then((list) => {
        setWarehouses(list);
        if (list.length === 1) {
          setSelectedWarehouseId(list[0].id);
        }
      })
      .catch((err) => logger.error('load warehouses failed', err));
  }, []);

  const getWarehouseDisplayName = (wh: Warehouse) => {
    const name = lang === 'zh' ? wh.whNameZh : lang === 'vi' ? wh.whNameVi : wh.whNameEn;
    return `${name || wh.whNameZh}（${wh.whCode}）`;
  };

  // 成功/失败提示统一走 utils/speech + utils/beep，保证蜂鸣音与三语文案一致
  const speakOk = () => {
    speakSuccess();
  };

  const speakError = (errorCode: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    let text = '';
    if (lang === 'zh') {
      if (errorCode === 'invalid_supplier') text = '非合格供应商';
      else if (errorCode === 'unqualified_supplier') text = '非合格供应商';
      else if (errorCode === 'unregistered_material') text = '非认可物料';
      else if (errorCode === 'duplicate_serial') text = '重码';
      else if (errorCode === 'invalid_location') text = '仓库地址码无效';
      else text = '扫码失败';
    } else if (lang === 'vi') {
      if (errorCode === 'invalid_supplier') text = 'Nhà cung cấp không hợp lệ';
      else if (errorCode === 'unqualified_supplier') text = 'Nhà cung cấp không hợp lệ';
      else if (errorCode === 'unregistered_material') text = 'Vật tư chưa đăng ký';
      else if (errorCode === 'duplicate_serial') text = 'Trùng số serial';
      else if (errorCode === 'invalid_location') text = 'Mã địa chỉ kho không hợp lệ';
      else text = 'Quét thất bại';
    } else {
      if (errorCode === 'invalid_supplier') text = 'Invalid supplier';
      else if (errorCode === 'unqualified_supplier') text = 'Unqualified supplier';
      else if (errorCode === 'unregistered_material') text = 'Unregistered material';
      else if (errorCode === 'duplicate_serial') text = 'Duplicate serial number';
      else if (errorCode === 'invalid_location') text = 'Invalid location code';
      else text = 'Scan failed';
    }
    beepError();
    speakErrorVoice(text);
  };

  const handleWarehouseChange = (id: string) => {
    setSelectedWarehouseId(id);
    setLocationInfo(null);
    setLocationInput('');
    setLocationError('');
    setPendingItems([]);
    setTimeout(() => locationRef.current?.focus(), 50);
  };

  const handleLocationVerify = async () => {
    const code = locationInput.trim();
    if (!code) {
      setLocationError(t('receipt.pleaseEnterLocationCode'));
      return;
    }
    if (!selectedWarehouseId) {
      setLocationError(t('receipt.pleaseSelectWarehouseFirst'));
      return;
    }
    try {
      const result = await verifyLocationCode({ locationCode: code, warehouseId: selectedWarehouseId });
      setLocationInfo(result);
      setLocationError('');
      setPendingItems([]);
      toast.success(t('receipt.locationVerified'));
      setTimeout(() => materialRef.current?.focus(), 50);
    } catch (err: any) {
      // 统一取值链：优先服务端 error.message，避免露出 "Request failed with status code 500"
      const msg = extractApiError(err, t('receipt.locationInvalid')).message;
      setLocationError(msg);
      setLocationInfo(null);
      setPendingItems([]);
      speakError('invalid_location');
    }
  };

  const handleLocationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLocationVerify();
    }
  };

  const handleMaterialScan = async () => {
    const rawCode = materialInput.trim();
    if (!rawCode || scanning) return;
    if (!locationInfo) {
      setErrorInfo({
        errorCode: 'invalid_location',
        errorMessage: t('receipt.pleaseVerifyLocationFirst'),
        qrContent: rawCode,
      });
      setErrorDialog(true);
      setMaterialInput('');
      setTimeout(() => materialRef.current?.focus(), 50);
      return;
    }
    setScanning(true);
    try {
      const result = await verifyQr(rawCode);
      if (!result.valid) {
        setErrorInfo({
          errorCode: result.errorCode || 'invalid_format',
          errorMessage: result.errorMessage || t('receipt.scanFailed'),
          qrContent: rawCode,
          parsed: result,
        });
        setErrorDialog(true);
        speakError(result.errorCode || 'invalid_format');
        setMaterialInput('');
        setTimeout(() => materialRef.current?.focus(), 50);
        return;
      }

      const existing = pendingItems.find(
        (p: PendingItem) =>
          p.supplierCode === result.supplierCode &&
          p.materialCode === result.materialCode &&
          p.batchNo === result.batchNo &&
          p.serialNo === result.serialNo,
      );
      if (existing) {
        setErrorInfo({
          errorCode: 'duplicate_serial',
          errorMessage: t('receipt.duplicateSerialInBatch'),
          qrContent: rawCode,
          parsed: result,
        });
        setErrorDialog(true);
        speakError('duplicate_serial');
        setMaterialInput('');
        setTimeout(() => materialRef.current?.focus(), 50);
        return;
      }

      const newItem: PendingItem = {
        key: `${result.serialNo}-${Date.now()}`,
        qrContent: rawCode,
        supplierCode: result.supplierCode,
        supplierName: result.supplierName,
        materialCode: result.materialCode,
        materialName: result.materialName,
        unit: result.unit,
        productionDate: result.productionDate,
        batchNo: result.batchNo,
        serialNo: result.serialNo,
        quantity: result.quantity,
      };
      setPendingItems((prev) => [...prev, newItem]);
      toast.success(`${result.materialCode} +${result.quantity}`);
      speakOk();
      setMaterialInput('');
      setTimeout(() => materialRef.current?.focus(), 50);
    } catch (err: any) {
      // 扫码阶段的异常（网络/服务端）仍归为「扫码失败」语义，但展示真实原因
      const msg = extractApiError(err, t('receipt.scanFailed')).message;
      setErrorInfo({
        errorCode: 'invalid_format',
        errorMessage: msg,
        qrContent: rawCode,
      });
      setErrorDialog(true);
      speakError('invalid_format');
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
      prev.map((p) =>
        p.key === key ? { ...p, quantity: Math.max(1, p.quantity + delta) } : p,
      ),
    );
  };

  const handleConfirmReceipt = async () => {
    if (pendingItems.length === 0 || !locationInfo) return;
    setSubmitting(true);
    try {
      const items = pendingItems.map((p) => ({ qrContent: p.qrContent, quantity: p.quantity }));
      const result = await batchReceipt({ items, locationId: locationInfo.id });
      setRecentList((prev) => [...result, ...prev].slice(0, 10));
      toast.success(`${t('receipt.batchReceiptSuccessPrefix')} ${result.length} ${t('receipt.batchReceiptSuccessSuffix')}`);
      setPendingItems([]);
      setMaterialInput('');
      setTimeout(() => materialRef.current?.focus(), 50);
    } catch (err: any) {
      // 确认收货失败：从统一结构取真实错误码/信息（此前取 errResp.errorCode 恒为空，
      // 导致标题一律回落到「扫码失败」，属误报）
      const info = extractApiError(err, t('receipt.receiptFailed'));
      const parsed = info.details?.data || null;
      setErrorInfo({
        errorCode: info.code || 'receipt_failed',
        errorMessage: info.message,
        qrContent: '',
        parsed: parsed || undefined,
      });
      setErrorDialog(true);
      if (info.code) speakError(info.code);
    } finally {
      setSubmitting(false);
    }
  };

  const getErrorTitle = (code: string) => {
    // 按真实业务码映射标题；无法归类的失败不再一律叫「扫码失败」，
    // 区分「扫码失败」与「收货失败」两个动作语义，避免误报。
    if (code === 'invalid_supplier') return t('receipt.invalidSupplier');
    if (code === 'unqualified_supplier') return t('receipt.invalidSupplier');
    if (code === 'unregistered_material') return t('receipt.unregisteredMaterial');
    if (code === 'duplicate_serial') return t('receipt.duplicateSerial');
    if (code === 'invalid_location') return t('receipt.invalidLocation');
    if (
      code === 'receipt_failed' ||
      code === 'INTERNAL_ERROR' ||
      code === 'BAD_REQUEST' ||
      code === 'VALIDATION_ERROR' ||
      code === 'CONFLICT'
    ) {
      return t('receipt.receiptFailed');
    }
    return t('receipt.scanFailed');
  };

  const totalQty = pendingItems.reduce((s, p) => s + p.quantity, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <h2 className="text-xl font-semibold text-foreground mb-1">{t('receipt.scanReceipt')}</h2>
          <p className="text-sm text-muted-foreground mb-5">{t('receipt.scanStepTip')}</p>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1">
                  <WarehouseIcon className="w-4 h-4 text-primary" />
                  {t('receipt.selectWarehouse')}
                </label>
                <Select value={selectedWarehouseId} onValueChange={handleWarehouseChange}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('receipt.pleaseSelectWarehouse')} />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((wh) => (
                      <SelectItem key={wh.id} value={wh.id}>
                        {getWarehouseDisplayName(wh)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-primary" />
                  {t('warehouse.locationCode')}
                </label>
                <div className="flex gap-2">
                  <ScanInput
                    inputRef={locationRef}
                    value={locationInput}
                    onChange={setLocationInput}
                    onScan={handleLocationVerify}
                    onKeyDown={handleLocationKeyDown}
                    placeholder={t('receipt.scanLocationPlaceholder')}
                    inputClassName={locationError ? 'border-destructive focus-visible:ring-destructive' : ''}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleLocationVerify}
                    disabled={!selectedWarehouseId || !locationInput.trim()}
                  >
                    <CheckCircle className="w-4 h-4 mr-1" />
                    {t('common.confirm')}
                  </Button>
                </div>
                {locationError && (
                  <p className="text-xs text-destructive mt-1">{locationError}</p>
                )}
                {locationInfo && (
                  <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    {t('warehouse.locationCode')}：{locationInfo.locationCode}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1">
                  <ScanLine className="w-4 h-4 text-primary" />
                  {t('receipt.scanMaterialLabel')}
                </label>
                <ScanInput
                  inputRef={materialRef}
                  value={materialInput}
                  onChange={setMaterialInput}
                  onScan={handleMaterialScan}
                  onKeyDown={handleMaterialKeyDown}
                  placeholder={t('receipt.scanPlaceholder')}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('receipt.materialScanTip')}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              {t('receipt.pendingList')}
              <Badge variant="secondary" className="ml-1">
                {pendingItems.length} {t('common.items')} / {totalQty} {t('common.quantity')}
              </Badge>
            </h3>
            <Button
              onClick={handleConfirmReceipt}
              disabled={pendingItems.length === 0 || submitting}
            >
              {submitting ? t('common.saving') : t('receipt.confirmReceipt')}
            </Button>
          </div>

          {pendingItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-lg">
              <Package className="w-12 h-12 mx-auto mb-2 opacity-40" />
              <p>{t('receipt.noPendingItems')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground w-12">#</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('material.supplierCode')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('material.supplierName')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('material.materialCode')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('material.materialName')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('common.unit')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('receipt.productionDate')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('receipt.batchNo')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('receipt.serialNumber')}</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground w-36">{t('common.quantity')}</th>
                    <th className="text-center py-2 px-3 font-medium text-muted-foreground w-20">{t('common.operation')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingItems.map((item, idx) => (
                    <tr key={item.key} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="py-2 px-3 text-muted-foreground">{idx + 1}</td>
                      <td className="py-2 px-3 font-mono">{item.supplierCode}</td>
                      <td className="py-2 px-3">{item.supplierName || '-'}</td>
                      <td className="py-2 px-3 font-mono font-medium">{item.materialCode}</td>
                      <td className="py-2 px-3">{item.materialName || '-'}</td>
                      <td className="py-2 px-3">{item.unit || '-'}</td>
                      <td className="py-2 px-3">{formatDate(item.productionDate)}</td>
                      <td className="py-2 px-3">{item.batchNo}</td>
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
        </CardContent>
      </Card>

      {recentList.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              {t('receipt.recentScans')}
              <Badge variant="secondary" className="ml-2">{recentList.length}</Badge>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('receipt.receiptNo')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('material.supplierName')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('material.materialName')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('common.quantity')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('receipt.batchNo')}</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentList.map((item) => (
                    <tr key={item.id} className="border-b border-border/50">
                      <td className="py-2 px-3 font-medium">{item.receiptNo}</td>
                      <td className="py-2 px-3">{item.supplierName || '-'}</td>
                      <td className="py-2 px-3">{item.materialName || '-'}</td>
                      <td className="py-2 px-3">{item.quantity} {item.unit}</td>
                      <td className="py-2 px-3">{item.batchNo || '-'}</td>
                      <td className="py-2 px-3">
                        <Badge variant="secondary">{t('receipt.pendingIqc')}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={errorDialog}
        onOpenChange={(open) => {
          setErrorDialog(open);
          // 弹窗关闭后，光标自动回到扫码输入框并选中全部内容
          if (!open) {
            setTimeout(() => {
              materialRef.current?.focus();
              materialRef.current?.select();
            }, 300);
          }
        }}
      >
        <DialogContent className="max-w-lg border-destructive/40">
          <DialogHeader>
            <DialogTitle className="text-destructive text-lg">
              ⚠ {getErrorTitle(errorInfo?.errorCode || '')}
            </DialogTitle>
            <DialogDescription className="text-foreground/70">
              {errorInfo?.errorMessage}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {errorInfo?.qrContent && (
              <div className="bg-muted/50 rounded-md p-3 border border-border">
                <div className="text-muted-foreground text-xs mb-1">{t('receipt.qrContent')}</div>
                <div className="font-mono text-foreground break-all">{errorInfo.qrContent}</div>
              </div>
            )}
            {errorInfo?.parsed && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground text-xs">{t('material.supplierCode')}</span>
                  <p className="font-medium">{errorInfo.parsed.supplierCode}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">{t('material.materialCode')}</span>
                  <p className="font-medium">{errorInfo.parsed.materialCode}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">{t('receipt.productionDate')}</span>
                  <p className="font-medium">{formatDate(errorInfo.parsed.productionDate)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">{t('receipt.serialNumber')}</span>
                  <p className="font-medium">{errorInfo.parsed.serialNo || '-'}</p>
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

export default ReceiptScan;
