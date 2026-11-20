import React, { useMemo, useState } from 'react';
import { useI18n } from '@client/src/i18n';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { batchCreateLocations } from '@client/src/api/system';
import type { Warehouse, BatchCreateLocationResult } from '@shared/api.interface';
import { toast } from 'sonner';

interface BatchLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseList: Warehouse[];
  onSuccess: () => void;
}

const BatchLocationDialog: React.FC<BatchLocationDialogProps> = ({
  open,
  onOpenChange,
  warehouseList,
  onSuccess,
}) => {
  const { t } = useI18n();

  const [warehouseId, setWarehouseId] = useState('');
  const [areaCode, setAreaCode] = useState('');
  const [shelfCode, setShelfCode] = useState('');
  const [layerCode, setLayerCode] = useState('');
  const [startNo, setStartNo] = useState<number | ''>('');
  const [endNo, setEndNo] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchCreateLocationResult | null>(null);

  const selectedWarehouse = useMemo(
    () => warehouseList.find((w) => w.id === warehouseId),
    [warehouseList, warehouseId]
  );

  const generateCount = useMemo(() => {
    if (startNo === '' || endNo === '') return 0;
    const s = Number(startNo);
    const e = Number(endNo);
    if (e < s || s < 1) return 0;
    return e - s + 1;
  }, [startNo, endNo]);

  const DIGIT_LEN = 4;

  // 过滤汉字，只保留字母、数字、符号
  const stripChinese = (val: string) => val.replace(/[\u4e00-\u9fa5]/g, '');

  const resetForm = () => {
    setWarehouseId('');
    setAreaCode('');
    setShelfCode('');
    setLayerCode('');
    setStartNo('');
    setEndNo('');
    setResult(null);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!warehouseId || !areaCode || !shelfCode || !layerCode || startNo === '' || endNo === '') {
      toast.error(t('common.required'));
      return;
    }
    const s = Number(startNo);
    const e = Number(endNo);
    if (e < s || s < 1) {
      toast.error(t('common.error'));
      return;
    }
    setLoading(true);
    try {
      const res = await batchCreateLocations({
        warehouseId,
        areaCode,
        shelfCode,
        layerCode,
        startNo: s,
        endNo: e,
        locationType: 'good',
        digitLen: DIGIT_LEN,
      });
      if (res.code === 0) {
        setResult(res.data);
        toast.success(t('common.success'));
        onSuccess();
      } else {
        toast.error(res.message || t('common.error'));
      }
    } catch {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('system.batchCreate')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('nav.warehouseList')} <span className="text-destructive">*</span>
              </label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  {warehouseList.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.whNameZh}（{wh.whCode}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('warehouse.areaCode')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={areaCode}
                onChange={(e) => setAreaCode(stripChinese(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('system.shelfCode')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={shelfCode}
                onChange={(e) => setShelfCode(stripChinese(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('system.layerCode')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={layerCode}
                onChange={(e) => setLayerCode(stripChinese(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('warehouse.startPositionCode')} <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                value={startNo}
                onChange={(e) => setStartNo(e.target.value === '' ? '' : Number(e.target.value))}
                min={1}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('warehouse.endPositionCode')} <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                value={endNo}
                onChange={(e) => setEndNo(e.target.value === '' ? '' : Number(e.target.value))}
                min={1}
              />
            </div>
            <div className="flex flex-col gap-1 justify-end col-span-2">
              <div className="text-sm text-primary font-medium">
                {t('system.willGenerateCount').replace('{count}', String(generateCount))}
              </div>
            </div>
          </div>

          {result && (
            <div className="border border-border rounded-md p-4 bg-muted/30 space-y-2">
              <div className="text-sm font-medium text-foreground">{t('system.batchResult')}</div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{t('system.totalCount')}：</span>
                  <span className="font-medium">{result.total}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('system.createdCount')}：</span>
                  <span className="font-medium text-primary">{result.created}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('system.skippedCount')}：</span>
                  <span className="font-medium text-muted-foreground">{result.skipped}</span>
                </div>
              </div>
              {result.skippedCodes && result.skippedCodes.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <div className="text-xs text-muted-foreground mb-1">{t('system.skippedCodes')}：</div>
                  <div className="flex flex-wrap gap-1">
                    {result.skippedCodes.map((code: string) => (
                      <span
                        key={code}
                        className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground rounded"
                      >
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('common.close')}
          </Button>
          {!result && (
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? t('common.loading') : t('common.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BatchLocationDialog;
