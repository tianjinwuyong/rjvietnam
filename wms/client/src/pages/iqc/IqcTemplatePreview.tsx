import React, { useState, useEffect } from 'react';
import { useI18n, tf } from '@client/src/i18n';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { logger } from '@client/src/utils/logger';
import { getRawTemplate, getTemplateDetail } from '@client/src/api/iqc';
import type { IqcRawTemplate, IqcInspectionRecordInput } from '@client/src/api/iqc';
import InspectionSections from './InspectionSections';

interface TemplatePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string | null;
  templateName: string;
}

const TemplatePreviewDialog: React.FC<TemplatePreviewDialogProps> = ({
  open,
  onOpenChange,
  templateId,
  templateName,
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState<IqcRawTemplate | null>(null);
  const [previewRecords, setPreviewRecords] = useState<IqcInspectionRecordInput[]>([]);
  const [hasModuleItems, setHasModuleItems] = useState(false);

  useEffect(() => {
    if (!open || !templateId) {
      setRawData(null);
      setPreviewRecords([]);
      setHasModuleItems(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        // 优先加载模块化模板项目
        const detail = await getTemplateDetail(templateId);
        if (detail.items && detail.items.length > 0) {
          const records: IqcInspectionRecordInput[] = detail.items
            .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0))
            .map((item: any) => ({
              templateItemId: item.id,
              sectionType: item.sectionType,
              itemName: item.itemName,
              standard: item.standard,
              spec: item.spec,
              lsl: item.lsl,
              usl: item.usl,
              unit: item.unit,
              samplingPlanText: item.samplingPlanText,
              sampleSize: item.sampleSize,
              ac: item.ac,
              re: item.re,
              measuredValues: item.sectionType === 'dimension' ? Array(10).fill('') : undefined,
              defectQty: 0,
              isPass: true,
              sortOrder: item.sortOrder,
            }));
          setPreviewRecords(records);
          setHasModuleItems(true);
        } else {
          setHasModuleItems(false);
        }
        // 同时尝试加载raw template（旧格式）
        try {
          const data = await getRawTemplate(templateId);
          setRawData(data);
        } catch {
          setRawData(null);
        }
      } catch (error) {
        logger.error('get template preview failed', error);
        setRawData(null);
        setPreviewRecords([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [open, templateId]);

  // ——— Raw template (Excel单元格格式) 渲染 ———
  const buildHiddenCellSet = (merges: IqcRawTemplate['merges']): Set<string> => {
    const hidden = new Set<string>();
    for (const m of merges) {
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue;
          hidden.add(`${r},${c}`);
        }
      }
    }
    return hidden;
  };

  const buildMergeMap = (merges: IqcRawTemplate['merges']): Map<string, { rowSpan: number; colSpan: number }> => {
    const map = new Map<string, { rowSpan: number; colSpan: number }>();
    for (const m of merges) {
      const rowSpan = m.e.r - m.s.r + 1;
      const colSpan = m.e.c - m.s.c + 1;
      map.set(`${m.s.r},${m.s.c}`, { rowSpan, colSpan });
    }
    return map;
  };

  const colLetter = (col: number): string => {
    let result = '';
    let n = col;
    while (n >= 0) {
      result = String.fromCharCode(65 + (n % 26)) + result;
      n = Math.floor(n / 26) - 1;
    }
    return result;
  };

  const renderRawGrid = () => {
    if (!rawData) return null;
    const { rowCount, colCount, cells, merges, colWidths } = rawData;
    const hiddenCells = buildHiddenCellSet(merges);
    const mergeMap = buildMergeMap(merges);
    const cellMap = new Map<string, string>();
    for (const cell of cells) {
      cellMap.set(`${cell.r},${cell.c}`, cell.v);
    }
    const rows = [];
    for (let r = 0; r < rowCount; r++) {
      const cellsInRow = [];
      for (let c = 0; c < colCount; c++) {
        const key = `${r},${c}`;
        if (hiddenCells.has(key)) continue;
        const merge = mergeMap.get(key);
        const value = cellMap.get(key) || '';
        cellsInRow.push(
          <td
            key={c}
            rowSpan={merge?.rowSpan}
            colSpan={merge?.colSpan}
            className="border border-[#d4d4d4] px-1 py-0.5 align-top text-xs leading-tight whitespace-pre-wrap"
            style={{ minWidth: colWidths?.[c] ? `${colWidths[c] * 0.7}px` : undefined }}
          >
            {value}
          </td>,
        );
      }
      rows.push(
        <tr key={r}>
          <th className="border border-[#d4d4d4] bg-[#f3f3f3] px-1 py-0.5 text-xs font-normal text-muted-foreground w-10 text-center align-middle">
            {r + 1}
          </th>
          {cellsInRow}
        </tr>,
      );
    }
    const headerCells = [];
    headerCells.push(
      <th
        key="corner"
        className="border border-[#d4d4d4] bg-[#f3f3f3] w-10 text-xs font-normal text-muted-foreground text-center sticky top-0 left-0 z-10"
      />,
    );
    for (let c = 0; c < colCount; c++) {
      headerCells.push(
        <th
          key={c}
          className="border border-[#d4d4d4] bg-[#f3f3f3] px-1 py-0.5 text-xs font-normal text-muted-foreground text-center sticky top-0 z-10"
          style={{ minWidth: colWidths?.[c] ? `${colWidths[c] * 0.7}px` : undefined }}
        >
          {colLetter(c)}
        </th>,
      );
    }
    return (
      <div className="overflow-auto max-h-[60vh]">
        <table className="border-collapse font-sans" style={{ fontSize: '12px' }}>
          <thead>
            <tr>{headerCells}</tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  };

  // ——— 模块化模板预览渲染 ———
  const renderModulePreview = () => {
    if (!hasModuleItems || previewRecords.length === 0) return null;
    return (
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground mb-2">
          {tf('ui.共 {n} 个检验项目（预览模式，数据列为空）', { n: previewRecords.length })}
        </div>
        <InspectionSections
          records={previewRecords}
          onRecordChange={() => {}}
          hasTemplate={true}
        />
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{templateName}{t('ui. - 预览')}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="text-center text-muted-foreground py-8">{t('pda.loading')}</div>
          ) : hasModuleItems ? (
            renderModulePreview()
          ) : rawData ? (
            renderRawGrid()
          ) : (
            <div className="text-center text-muted-foreground py-8">{t('ui.暂无模板内容')}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TemplatePreviewDialog;
