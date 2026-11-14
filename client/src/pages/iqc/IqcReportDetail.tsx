import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@client/src/components/ui/button';
import { getReportDetail } from '@client/src/api/iqc';
import { useI18n, tf, tui } from '@client/src/i18n';
import { logger } from '@client/src/utils/logger';
import IqcReportPrintDoc, {
  IqcReportSheet,
  type PrintHeaderPair,
} from './print/IqcReportPrintDoc';
import { buildPrintSections } from './print/printModel';
import { printWithTitle } from '@client/src/utils/print';

/** 取日期部分（兼容 ISO 字符串与 Date） */
function fmtDate(v?: string | Date | null): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('zh-CN');
}

function fmtDateTime(v?: string | Date | null): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('zh-CN', { hour12: false });
}

const REVIEW_STATUS_TEXT: Record<string, string> = {
  pending: 'ui.待审批',
  approved: 'ui.已审批',
  rejected: 'ui.已驳回',
};

const IqcReportDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useI18n();
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [autoPrinted, setAutoPrinted] = useState(false);

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      try {
        const res = await getReportDetail(id);
        setDetail(res);
      } catch (e) {
        logger.error('fetch report detail failed', e);
        alert(t('message.loadFailed'));
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [id]);

  // 从列表点「打印」进入（?print=1）：数据就绪后自动调起打印一次
  useEffect(() => {
    if (!detail || loading || autoPrinted) return;
    if (searchParams.get('print') !== '1') return;
    setAutoPrinted(true);
    // 注意：这里不能返回 clearTimeout 清理函数——
    // setAutoPrinted 会立刻重跑本 effect，清理函数会在定时器触发前把它清掉
    setTimeout(() => {
      const lot0: any = detail?.lot || {};
      printWithTitle(`${lot0.inspectionNo || detail?.reportNo || ''}-${lot0.materialCode || ''}`);
    }, 400);
  }, [detail, loading, autoPrinted, searchParams]);

  const records = detail?.records || [];

  /** 报告稿分节数据（与检验填写页同一套分节/列定义） */
  const sections = useMemo(() => buildPrintSections(records, t), [records, t]);

  /** 表头字段：每行 4 组「标签 + 值」 */
  const pairs: PrintHeaderPair[] = useMemo(() => {
    if (!detail) return [];
    const lot = detail.lot || {};
    const isPass = detail.finalResult === 'pass';
    // 优先用批次/报告的检验时间，避免打印历史报告时显示成"今天"
    const inspectionDate = fmtDate(detail.inspectionTime || lot.inspectionTime);

    return [
      { label: t('iqc.materialCode'), value: lot.materialCode || '' },
      { label: t('print.incomingQty'), value: `${lot.totalQty ?? ''} ${lot.unit || ''}`.trim() },
      { label: t('print.nameSpec'), value: lot.materialName || '' },
      { label: t('iqc.inspectDate'), value: inspectionDate },
      { label: t('material.supplierCode'), value: lot.supplierCode || '' },
      { label: t('iqc.supplierName'), value: lot.supplierName || '' },
      { label: t('print.boxCount'), value: lot.boxCount ?? '' },
      { label: t('stockTake.batchNo'), value: lot.batchNo || '' },
      {
        label: t('iqc.inspectResult'),
        value: (
          <span className={isPass ? 'ok' : 'ng'}>{isPass ? 'Pass' : 'Fail'}</span>
        ),
      },
      { label: t('print.materialSource'), value: tui(lot.materialSource) || t('ui.来料检验') },
      { label: t('print.inspectionAttribute'), value: t('ui.正常检验') },
      { label: t('iqc.inspector'), value: tui(lot.inspectorName || detail.inspectorName || '') },
      { label: t('print.approvedBy'), value: tui(detail.reviewerName) || t('ui.待审批') },
      { label: t('common.productionDate'), value: fmtDate(lot.productionDate) },
      { label: t('receipt.receiptDate'), value: fmtDate(lot.receiptDate) },
      { label: t('ui.报告状态'), value: REVIEW_STATUS_TEXT[detail.reviewStatus] ? t(REVIEW_STATUS_TEXT[detail.reviewStatus]) : detail.reviewStatus || '' },
      { label: t('iqc.reportNo'), value: (lot as any).inspectionNo || detail.reportNo || '' },
      { label: t('system.locationCode'), value: lot.locationCodes || '', full: true },
      // 人工判定：批次没有任何检验小项，由 IQC 主管直接维护结论。
      // 报告表头必须显式标注，否则会被误读成「正常检验合格」。
      ...(detail.judgeMode === 'manual'
        ? [{
            label: t('ui.判定方式'),
            value: (
              <span className="ng">
                {t('ui.人工判定')}{detail.judgeReason ? `：${detail.judgeReason}` : ''}
              </span>
            ),
            full: true,
          }]
        : []),
    ];
  }, [detail]);

  const handlePrint = () => {
    if (!detail) return;
    // 报告稿（portal）已挂在 body 下；文件名取「检验编号-物料编号」
    const lot0: any = detail.lot || {};
    printWithTitle(`${lot0.inspectionNo || detail.reportNo || ''}-${lot0.materialCode || ''}`);
  };

  if (loading) return <div style={{ padding: 20 }}>{t('pda.loading')}</div>;
  if (!detail) {
    return (
      <div style={{ padding: 20 }}>
        {t('ui.未找到报告')} <Button onClick={() => navigate(-1)}>{t('common.back')}</Button>
      </div>
    );
  }

  return (
    <div className="p-6 bg-card iqc-paper">
      <div className="flex gap-3 mb-4 items-center">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          {t('common.back')}
        </Button>
        <Button style={{ backgroundColor: '#1890ff' }} onClick={handlePrint}>
          {t('iqc.printReport')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {tf('ui.共 {n} 个检验项目', { n: records.length })}
          {detail.reviewTime ? tf('ui. ｜ 审批时间：{time}', { time: fmtDateTime(detail.reviewTime) }) : ''}
          {detail.rejectReason ? tf('ui. ｜ 驳回原因：{reason}', { reason: detail.rejectReason }) : ''}
        </span>
      </div>

      {/* 人工判定提示条：提醒审核人该报告没有检验小项支撑 */}
      {detail.judgeMode === 'manual' && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="font-semibold">⚠ {t('ui.人工判定')}</span>
          <span className="ml-2">{detail.judgeReason || '-'}</span>
          {detail.judgedAt && (
            <span className="ml-2 text-red-700">
              ｜ {t('ui.判定时间')}：{fmtDateTime(detail.judgedAt)}
            </span>
          )}
          <div className="text-xs text-red-700 mt-1">
            {t('ui.该报告没有任何检验小项，结论由主管直接维护')}
          </div>
        </div>
      )}

      {/* 屏幕预览：与打印稿同一模板，所见即所得 */}
      <div className="iqc-preview-frame">
        <IqcReportSheet
          pairs={pairs}
          reportNo={detail.reportNo}
          sections={sections}
          remark={detail.remark}
        />
      </div>

      {/* 打印稿：屏幕上隐藏，打印时独占页面 */}
      <IqcReportPrintDoc
        pairs={pairs}
        reportNo={detail.reportNo}
        sections={sections}
        remark={detail.remark}
      />
    </div>
  );
};

export default IqcReportDetail;
