import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, X } from 'lucide-react';
import { dashboard as dashboardApi } from '@client/src/api';
import type { IqcDefectDetailItem } from '@shared/api.interface';
import { useI18n } from '../../i18n';
import { IQC_DEFECT_TYPES } from '@client/src/constants/business-enums';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';

export type DefectDimension = 'type' | 'materialType';

interface Props {
  open: boolean;
  onClose: () => void;
  startDate: string;
  endDate: string;
  dimension: DefectDimension;
  /** 被点击的那个分类值（不良类型名 / 物料类型名） */
  value: string;
}

const PAGE_SIZE = 20;
/** 导出时单次拉取条数；台账量级小，500 足够，循环拉取确保拿到全量 */
const EXPORT_CHUNK = 500;

/** CSV 单元格转义：逗号、引号、换行都要包起来 */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '-';
  // 后端可能返回 ISO 串或 DATE 串，统一取前 10 位
  return String(v).slice(0, 10);
}

const DefectDetailDialog: React.FC<Props> = ({ open, onClose, startDate, endDate, dimension, value }) => {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [items, setItems] = useState<IqcDefectDetailItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const isTypeDim = dimension === 'type';

  /** 不良类型展示文案：库里存八项中文口径，英文/越南语界面走词条翻译 */
  const typeLabel = (name: string) => {
    if (!name) return name;
    if (name === '未分类') return t('ui.未分类');
    return (IQC_DEFECT_TYPES as readonly string[]).includes(name)
      ? t(`iqc.defect_type_${name}` as any)
      : name;
  };
  const valueLabel = isTypeDim ? typeLabel(value) : value;

  const load = useCallback(
    (p: number) => {
      if (!open || !value) return;
      setLoading(true);
      dashboardApi
        .getIqcDefectDetail({ startDate, endDate, dimension, value, page: p, pageSize: PAGE_SIZE })
        .then((res) => {
          setItems(res.items || []);
          setTotal(res.total ?? 0);
          setPage(res.page ?? p);
        })
        .catch((err) => {
          logger.error('Failed to load defect detail', err);
          toast.error(t('ui.不合格明细加载失败'));
          setItems([]);
          setTotal(0);
        })
        .finally(() => setLoading(false));
    },
    [open, value, startDate, endDate, dimension],
  );

  // 打开弹窗或切换分类时，回到第 1 页重新加载
  useEffect(() => {
    if (open && value) {
      setPage(1);
      load(1);
    } else if (!open) {
      setItems([]);
      setTotal(0);
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value, dimension, startDate, endDate]);

  /** 拉全量用于导出（分块循环，避免单次过大） */
  const fetchAll = async (): Promise<IqcDefectDetailItem[]> => {
    const all: IqcDefectDetailItem[] = [];
    let p = 1;
    for (;;) {
      const res = await dashboardApi.getIqcDefectDetail({
        startDate,
        endDate,
        dimension,
        value,
        page: p,
        pageSize: EXPORT_CHUNK,
      });
      const chunk = res.items || [];
      all.push(...chunk);
      if (chunk.length === 0 || all.length >= (res.total ?? 0)) break;
      p += 1;
    }
    return all;
  };

  const handleExport = async () => {
    if (total === 0) {
      toast.error(t('ui.当前没有可导出的数据'));
      return;
    }
    setExporting(true);
    try {
      const rows = await fetchAll();

      const header = isTypeDim
        ? [
            t('common.date'),
            t('iqc.lotNo'),
            t('iqc.batchNo'),
            t('iqc.materialCode'),
            t('iqc.materialName'),
            t('ui.物料类型'),
            t('receipt.supplierCode'),
            t('iqc.supplierName'),
            t('ui.收货数量'),
            t('ui.单位'),
            t('ui.检验结果'),
            t('ui.批次状态'),
            t('ui.不良项数'),
            t('ui.不良数量合计'),
            t('ui.不良描述明细'),
            t('ui.检验报告号'),
          ]
        : [
            t('common.date'),
            t('iqc.lotNo'),
            t('iqc.batchNo'),
            t('iqc.materialCode'),
            t('iqc.materialName'),
            t('ui.物料类型'),
            t('receipt.supplierCode'),
            t('iqc.supplierName'),
            t('ui.收货数量'),
            t('ui.单位'),
            t('ui.检验结果'),
            t('ui.批次状态'),
            t('ui.检验报告号'),
          ];

      const body = rows.map((r) => {
        const common = [
          fmtDate(r.receiptDate),
          r.lotNo || '',
          r.batchNo || '',
          r.materialCode || '',
          r.materialName || '',
          r.materialType || '',
          r.supplierCode || '',
          r.supplierName || '',
          r.totalQty ?? '',
          r.unit || '',
          r.inspectionResult === 'fail' ? t('ui.不合格') : r.inspectionResult === 'pass' ? t('ui.合格') : '-',
          r.status === 'rejected' ? t('ui.已驳回') : r.status || '',
        ];
        if (!isTypeDim) return [...common, r.reportNo || ''];
        return [
          ...common,
          r.defectItemCount ?? '',
          r.defectQtyTotal ?? '',
          (r.defectDescriptions || []).join('; '),
          r.reportNo || '',
        ];
      });

      const csv = [header, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n');
      // BOM：Excel 打开中文不乱码
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const safeValue = String(value).replace(/[\\/:*?"<>|]/g, '_');
      const filename = `IQC不合格明细_${isTypeDim ? '按不良类型' : '按物料类型'}_${safeValue}_${startDate}_${endDate}.csv`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t('ui.台账已导出'));
    } catch (err) {
      logger.error('Failed to export defect detail', err);
      toast.error(t('ui.导出失败'));
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resultBadge = (r: IqcDefectDetailItem) => {
    if (r.status === 'rejected') {
      return <span className="text-[#FF9500]">{t('ui.已驳回')}</span>;
    }
    if (r.inspectionResult === 'fail') {
      return <span className="text-[#FF3B30]">{t('ui.不合格')}</span>;
    }
    return <span className="text-[#34C759]">{t('ui.合格')}</span>;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[96vw] max-w-[1180px] max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-base">
                {t('ui.不合格明细台账')}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {isTypeDim ? t('ui.不良类型') : t('ui.物料类型')}「{valueLabel}」
                </span>
              </DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {startDate} ~ {endDate} · {t('ui.共')} {total} {t('ui.个批次')}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-border">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">{t('common.date')}</th>
                <th className="px-2 py-2 text-left font-medium">{t('iqc.lotNo')}</th>
                <th className="px-2 py-2 text-left font-medium">{t('iqc.materialCode')}</th>
                <th className="px-2 py-2 text-left font-medium">{t('iqc.materialName')}</th>
                <th className="px-2 py-2 text-left font-medium">{t('ui.物料类型')}</th>
                <th className="px-2 py-2 text-left font-medium">{t('iqc.supplierName')}</th>
                {isTypeDim && (
                  <>
                    <th className="px-2 py-2 text-left font-medium">{t('ui.不良项数')}</th>
                    <th className="px-2 py-2 text-left font-medium">{t('ui.不良描述明细')}</th>
                    <th className="px-2 py-2 text-right font-medium">{t('ui.不良数量')}</th>
                  </>
                )}
                <th className="px-2 py-2 text-left font-medium">{t('ui.检验结果')}</th>
                <th className="px-2 py-2 text-left font-medium">{t('ui.检验报告号')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={isTypeDim ? 10 : 8} className="py-10 text-center text-muted-foreground">
                    <Loader2 className="inline animate-spin" size={16} />
                    <span className="ml-2">{t('ui.加载中')}</span>
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={isTypeDim ? 10 : 8} className="py-10 text-center text-muted-foreground">
                    {t('ui.该分类下暂无明细记录')}
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((r) => (
                  <tr key={r.lotId} className="border-t border-border/60 hover:bg-[#F7F7FA]">
                    <td className="px-2 py-2">{fmtDate(r.receiptDate)}</td>
                    <td className="px-2 py-2 font-medium">{r.lotNo || '-'}</td>
                    <td className="px-2 py-2">{r.materialCode || '-'}</td>
                    <td className="px-2 py-2 max-w-[200px] truncate" title={r.materialName || ''}>
                      {r.materialName || '-'}
                    </td>
                    <td className="px-2 py-2">{r.materialType || '-'}</td>
                    <td className="px-2 py-2 max-w-[180px] truncate" title={r.supplierName || r.supplierCode || ''}>
                      {r.supplierName ? (
                        r.supplierName
                      ) : (
                        <span>
                          {r.supplierCode || '-'}
                          <span className="ml-1 text-xs text-muted-foreground">({t('ui.名称未维护')})</span>
                        </span>
                      )}
                    </td>
                    {isTypeDim && (
                      <>
                        <td className="px-2 py-2 text-right">{r.defectItemCount ?? '-'}</td>
                        <td className="px-2 py-2 max-w-[300px] truncate" title={(r.defectDescriptions || []).join('; ')}>
                          {(r.defectDescriptions || []).length > 0 ? r.defectDescriptions!.join('; ') : '-'}
                        </td>
                        <td className="px-2 py-2 text-right">{r.defectQtyTotal ?? '-'}</td>
                      </>
                    )}
                    <td className="px-2 py-2">{resultBadge(r)}</td>
                    <td className="px-2 py-2">
                      {r.reportId ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                          onClick={() => navigate(`/iqc/report-view/${r.reportId}`)}
                        >
                          {r.reportNo || t('ui.查看报告')}
                          <ExternalLink size={11} />
                        </button>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted-foreground">
            {total > 0
              ? `${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} / ${total}`
              : `0 / 0`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || loading}
              onClick={() => load(page - 1)}
            >
              <ChevronLeft size={14} />
              {t('pda.prev')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages || loading}
              onClick={() => load(page + 1)}
            >
              {t('pda.next')}
              <ChevronRight size={14} />
            </Button>
            <Button size="sm" onClick={handleExport} disabled={exporting || total === 0}>
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t('ui.导出台账')}
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>
              <X size={14} />
              {t('common.close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DefectDetailDialog;
