import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useI18n } from '@client/src/i18n';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Input } from '@client/src/components/ui/input';
import { logger } from '@client/src/utils/logger';
import { getRawTemplate, saveInspectionRecords, type IqcInspectionRecordInput } from '@client/src/api/iqc';
import type { IqcRawTemplate, IqcLot, IqcLocationDetail } from '@shared/api.interface';
import { toast } from 'sonner';

interface RawReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
  lotId: string;
  lotInfo: IqcLot;
  locationDetails?: IqcLocationDetail[];
  onSaved: () => void;
}

interface FilledCell {
  r: number;
  c: number;
  v: string;
}

const RawReportDialog: React.FC<RawReportDialogProps> = ({
  open,
  onOpenChange,
  templateId,
  templateName,
  lotId,
  lotInfo,
  locationDetails = [],
  onSaved,
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rawData, setRawData] = useState<IqcRawTemplate | null>(null);
  // Map of "r,c" -> filled value (empty string = cell was left blank)
  const [filledCells, setFilledCells] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!open || !templateId) {
      setRawData(null);
      setFilledCells(new Map());
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const data = await getRawTemplate(templateId);
        setRawData(data);
        setFilledCells(new Map());
      } catch (error) {
        logger.error('get raw template for report failed', error);
        toast.error(t('message.loadFailed'));
        setRawData(null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [open, templateId]);

  const handleCellChange = useCallback((r: number, c: number, value: string) => {
    setFilledCells((prev) => {
      const next = new Map(prev);
      if (value) {
        next.set(`${r},${c}`, value);
      } else {
        next.delete(`${r},${c}`);
      }
      return next;
    });
  }, []);

  // Build hidden cell set and merge map (same logic as preview)
  const { hiddenCells, mergeMap, cellMap, colWidths } = useMemo(() => {
    if (!rawData) {
      return {
        hiddenCells: new Set<string>(),
        mergeMap: new Map<string, { rowSpan: number; colSpan: number }>(),
        cellMap: new Map<string, string>(),
        colWidths: [] as number[],
      };
    }
    const hidden = new Set<string>();
    const mMap = new Map<string, { rowSpan: number; colSpan: number }>();
    for (const m of rawData.merges) {
      const rowSpan = m.e.r - m.s.r + 1;
      const colSpan = m.e.c - m.s.c + 1;
      mMap.set(`${m.s.r},${m.s.c}`, { rowSpan, colSpan });
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue;
          hidden.add(`${r},${c}`);
        }
      }
    }
    const cMap = new Map<string, string>();
    for (const cell of rawData.cells) {
      cMap.set(`${cell.r},${cell.c}`, cell.v);
    }
    return { hiddenCells: hidden, mergeMap: mMap, cellMap: cMap, colWidths: rawData.colWidths };
  }, [rawData]);

  // Heuristic: detect "判定" (judgment) columns by checking column header / last column
  // We treat cells containing "判定" or "结果" as judgment columns → use select
  const isJudgmentColumn = useCallback((c: number): boolean => {
    if (!rawData) return false;
    // Check first 5 rows for "判定" text in this column
    for (let r = 0; r < Math.min(5, rawData.rowCount); r++) {
      const v = cellMap.get(`${r},${c}`) || '';
      if (v.includes('判定') || v.includes('结果') || v.toLowerCase().includes('result')) {
        return true;
      }
    }
    // Last column is usually judgment
    return c === rawData.colCount - 1;
  }, [rawData, cellMap]);

  // Heuristic: detect "不良数量" / "defect qty" columns → number input
  const isQtyColumn = useCallback((c: number): boolean => {
    if (!rawData) return false;
    for (let r = 0; r < Math.min(5, rawData.rowCount); r++) {
      const v = cellMap.get(`${r},${c}`) || '';
      if (v.includes('不良数') || v.includes('数量') || v.includes('Qty') || v.includes('QTY')) {
        return true;
      }
    }
    return false;
  }, [rawData, cellMap]);

  const colLetter = (col: number): string => {
    let result = '';
    let n = col;
    while (n >= 0) {
      result = String.fromCharCode(65 + (n % 26)) + result;
      n = Math.floor(n / 26) - 1;
    }
    return result;
  };

  const handleSaveAndClose = async () => {
    if (!lotId) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      // Collect all filled cells into an array
      const filledArray: FilledCell[] = [];
      filledCells.forEach((v, k) => {
        const [rStr, cStr] = k.split(',');
        filledArray.push({ r: parseInt(rStr, 10), c: parseInt(cStr, 10), v });
      });

      // Build one record with the raw cell data stored in standard field as JSON
      const records: IqcInspectionRecordInput[] = [
        {
          itemName: `Raw Report (${templateName})`,
          standard: JSON.stringify(filledArray),
          measuredValue: '',
          isPass: true,
          sortOrder: 0,
        },
      ];

      await saveInspectionRecords(lotId, {
        records,
        inspectorId: '',
        inspectorName: '',
        remark: `templateId:${templateId}`,
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      logger.error('save raw report failed', error);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Auto-save on close
      handleSaveAndClose();
    } else {
      onOpenChange(open);
    }
  };

  const renderGrid = () => {
    if (!rawData) return null;

    const { rowCount, colCount } = rawData;
    const rows = [];

    for (let r = 0; r < rowCount; r++) {
      const cellsInRow = [];
      for (let c = 0; c < colCount; c++) {
        const key = `${r},${c}`;
        if (hiddenCells.has(key)) continue;

        const merge = mergeMap.get(key);
        const templateValue = cellMap.get(key) || '';
        const filledValue = filledCells.get(key) || '';
        const isEditable = templateValue === '';

        const widthStyle = colWidths[c] ? { minWidth: `${colWidths[c] * 0.7}px` } : undefined;

        let cellContent: React.ReactNode;
        if (isEditable) {
          if (isJudgmentColumn(c)) {
            cellContent = (
              <Select
                value={filledValue || ''}
                onValueChange={(val: string) => handleCellChange(r, c, val)}
              >
                <SelectTrigger className="h-7 text-xs border-0 focus:ring-0 shadow-none p-0 w-full">
                  <SelectValue placeholder="" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pass">{t('iqc.pass')}</SelectItem>
                  <SelectItem value="fail">{t('iqc.fail')}</SelectItem>
                </SelectContent>
              </Select>
            );
          } else if (isQtyColumn(c)) {
            cellContent = (
              <Input
                type="number"
                value={filledValue}
                onChange={(e) => handleCellChange(r, c, e.target.value)}
                className="h-7 text-xs border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 w-full"
                min={0}
              />
            );
          } else {
            cellContent = (
              <Input
                type="text"
                value={filledValue}
                onChange={(e) => handleCellChange(r, c, e.target.value)}
                className="h-7 text-xs border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 w-full"
              />
            );
          }
        } else {
          cellContent = <span className="text-xs leading-tight whitespace-pre-wrap">{templateValue}</span>;
        }

        cellsInRow.push(
          <td
            key={c}
            rowSpan={merge?.rowSpan}
            colSpan={merge?.colSpan}
            className={`border border-[#d4d4d4] px-1 py-0.5 align-top ${
              isEditable ? 'bg-card' : 'bg-[#fafafa]'
            }`}
            style={widthStyle}
          >
            {cellContent}
          </td>,
        );
      }
      rows.push(
        <tr key={r}>
          <th className="border border-[#d4d4d4] bg-[#f3f3f3] px-1 py-0.5 text-xs font-normal text-muted-foreground w-10 text-center align-middle sticky left-0 z-[1]">
            {r + 1}
          </th>
          {cellsInRow}
        </tr>,
      );
    }

    // Header row with column letters
    const headerCells = [];
    headerCells.push(
      <th
        key="corner"
        className="border border-[#d4d4d4] bg-[#f3f3f3] w-10 text-xs font-normal text-muted-foreground text-center sticky top-0 left-0 z-[2]"
      />,
    );
    for (let c = 0; c < colCount; c++) {
      headerCells.push(
        <th
          key={c}
          className="border border-[#d4d4d4] bg-[#f3f3f3] px-1 py-0.5 text-xs font-normal text-muted-foreground text-center sticky top-0 z-[1]"
          style={colWidths[c] ? { minWidth: `${colWidths[c] * 0.7}px` } : undefined}
        >
          {colLetter(c)}
        </th>,
      );
    }

    return (
      <div className="overflow-auto max-h-[60vh] border border-border rounded">
        <table className="border-collapse font-sans" style={{ fontSize: '12px' }}>
          <thead>
            <tr>{headerCells}</tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
             {t('print.rawReportTitle')} - {lotInfo.batchNo}
          </DialogTitle>
        </DialogHeader>

        {lotInfo && (
           <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-muted p-3 rounded-md text-sm">
             <div>
               <span className="text-muted-foreground">{t('material.materialName')}：</span>
               <span className="font-medium">{lotInfo.materialName}</span>
             </div>
             <div>
               <span className="text-muted-foreground">{t('common.quantity')}：</span>
               <span className="font-medium">{lotInfo.totalQty} {lotInfo.unit}</span>
             </div>
             <div>
               <span className="text-muted-foreground">{t('receipt.batchNo')}：</span>
               <span className="font-medium">{lotInfo.batchNo}</span>
             </div>
             <div>
               <span className="text-muted-foreground">{t('material.supplierName')}：</span>
               <span className="font-medium">{lotInfo.supplierName}</span>
             </div>
           </div>
         )}

         {/* Location Details */}
         <div>
           <div className="text-sm font-medium text-foreground mb-2">
             {t('iqc.locationDetails')}
           </div>
           <div className="border border-border rounded-md overflow-hidden">
             <table className="w-full text-sm">
               <thead className="bg-muted">
                 <tr>
                   <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">
                     {t('iqc.locationCode')}
                   </th>
                   <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">
                     {t('iqc.locationQuantity')}
                   </th>
                 </tr>
               </thead>
               <tbody>
                 {locationDetails.length === 0 ? (
                   <tr>
                     <td colSpan={2} className="px-3 py-3 text-center text-muted-foreground text-sm">
                       {t('message.noData')}
                     </td>
                   </tr>
                 ) : (
                   locationDetails.map((loc: IqcLocationDetail) => (
                     <tr key={loc.locationId} className="border-t border-border">
                       <td className="px-3 py-1.5">{loc.locationCode}</td>
                       <td className="px-3 py-1.5 text-right">{loc.quantity}</td>
                     </tr>
                   ))
                 )}
               </tbody>
             </table>
           </div>
         </div>

         <div className="text-sm text-muted-foreground">
          {t('iqc.template')}: <span className="font-medium text-foreground">{templateName}</span>
        </div>

        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : rawData ? (
            renderGrid()
          ) : (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              {t('message.noData')}
            </div>
          )}
        </div>

        <DialogFooter className="pt-4">
          <Button onClick={() => onOpenChange(false)} disabled={saving}>
            {saving ? t('common.saving') : t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RawReportDialog;
