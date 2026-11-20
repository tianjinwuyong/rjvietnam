import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useI18n } from '@client/src/i18n';
import { logger } from '@client/src/utils/logger';
import { getRawTemplate, getTemplateDetail } from '@client/src/api/iqc';
import type { IqcRawTemplate, IqcInspectionRecordInput } from '@client/src/api/iqc';
import InspectionSections from './InspectionSections';
import { Button } from '@client/src/components/ui/button';
import { toast } from 'sonner';

const IqcTemplatePreviewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState<IqcRawTemplate | null>(null);
  const [previewRecords, setPreviewRecords] = useState<IqcInspectionRecordInput[]>([]);
  const [hasModuleItems, setHasModuleItems] = useState(false);
  const templateId = id || '';

  useEffect(() => {
    if (!templateId) {
      setRawData(null);
      setPreviewRecords([]);
      setHasModuleItems(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
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
        try {
          const data = await getRawTemplate(templateId);
          setRawData(data);
        } catch {
          setRawData(null);
        }
      } catch (error) {
        logger.error('get template preview failed', error);
        toast.error(t('message.loadFailed'));
        setRawData(null);
        setPreviewRecords([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [templateId]);

  const buildHiddenCellSet = (merges: IqcRawTemplate['merges']): Set<string> => {
    const hidden = new Set<string>();
    for (const m of merges) {
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue;
          hidden.add(r + ',' + c);
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
      map.set(m.s.r + ',' + m.s.c, { rowSpan, colSpan });
    }
    return map;
  };

  const renderRawGrid = () => {
    if (!rawData) return null;
    const { rowCount, colCount, cells, merges, colWidths } = rawData;
    const hiddenCells = buildHiddenCellSet(merges);
    const mergeMap = buildMergeMap(merges);
    const cellMap = new Map<string, string>();
    for (const cell of cells) {
      cellMap.set(cell.r + ',' + cell.c, cell.v);
    }
    const rows = [];
    for (let r = 0; r < rowCount; r++) {
      const cellsInRow = [];
      for (let c = 0; c < colCount; c++) {
        const key = r + ',' + c;
        if (hiddenCells.has(key)) continue;
        const merge = mergeMap.get(key);
        const value = cellMap.get(key) || '';
        cellsInRow.push(
          <td
            key={c}
            rowSpan={merge?.rowSpan}
            colSpan={merge?.colSpan}
            className="border border-[#d4d4d4] px-1 py-0.5 align-top text-xs leading-tight whitespace-pre-wrap"
            style={{ minWidth: colWidths?.[c] ? colWidths[c] * 0.7 + 'px' : undefined }}
          >
            {value}
          </td>,
        );
      }
      rows.push(<tr key={r}>{cellsInRow}</tr>);
    }
    return (
      <table className="border-collapse">
        <tbody>{rows}</tbody>
      </table>
    );
  };

  return (
    <div className="p-6 bg-card min-h-screen">
      <div className="mb-4 flex justify-between items-center">
        <h2 className="text-xl font-bold">{t('ui.检验报告模板预览')}</h2>
        <Button variant="secondary" onClick={() => navigate(-1)}>{t('common.back')}</Button>
      </div>
      {loading ? (
        <div className="text-center py-10">{t('pda.loading')}</div>
      ) : (
        <div className="space-y-4">
          {hasModuleItems && (
            <InspectionSections
              records={previewRecords}
              onRecordChange={() => {}}
              hasTemplate
            />
          )}

        </div>
      )}
    </div>
  );
};

export default IqcTemplatePreviewPage;