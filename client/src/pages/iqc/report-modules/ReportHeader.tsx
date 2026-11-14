import React from 'react';
import { useI18n, tui } from '@client/src/i18n';
import type { IqcLot } from '@shared/api.interface';
import { formatDate } from '@client/src/utils/datetime';
import { COL_WIDTHS } from './types';

interface ReportHeaderProps {
  lot: IqcLot;
  reportNo?: string;
  finalResult?: 'pass' | 'fail';
  inspectionAttribute?: string;
  boxCount?: number;
  materialSource?: string;
  approver?: string;
}

/**
 * 表头模块：IQC进料检验报告表头
 * 3行信息：物料编码/来料数量/品名规格/检验日期
 *          供应商/箱数/批次/检验结果
 *          物料来源/检验属性/检验员/批准
 */
const ReportHeader: React.FC<ReportHeaderProps> = ({
  lot,
  reportNo,
  finalResult,
  inspectionAttribute,
  boxCount,
  materialSource,
  approver,
}) => {
  const { t } = useI18n();
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;

  const overallPass =
    finalResult !== undefined ? finalResult === 'pass' : lot.inspectionResult !== 'fail';

  const resultNode = (
    <span style={{ color: overallPass ? '#15803d' : '#dc2626', fontWeight: 700 }}>
      {overallPass ? t('iqc.passed') : t('iqc.failed')}
    </span>
  );

  // 检验属性显示
  const attrMap: Record<string, string> = {
    normal: t('print.attrNormal'),
    tightened: t('print.attrTightened'),
    reduced: t('print.attrReduced'),
    exempt: t('print.attrExempt'),
  };
  const attrText = inspectionAttribute ? (attrMap[inspectionAttribute] || inspectionAttribute) : '';

  // 每行 8 个单元格，总span=21
  type Cell = { span: number; label?: boolean; node?: React.ReactNode };
  const row1: Cell[] = [
    { span: 2, label: true, node: t('iqc.materialCode') },
    { span: 3, node: lot.materialCode },
    { span: 3, label: true, node: t('print.incomingQty') },
    { span: 3, node: `${lot.totalQty} ${lot.unit || ''}`.trim() },
    { span: 2, label: true, node: t('print.nameSpec') },
    { span: 3, node: lot.materialName },
    { span: 2, label: true, node: t('iqc.inspectDate') },
    { span: 3, node: dateStr },
  ];
  const row2: Cell[] = [
    { span: 2, label: true, node: t('print.supplier') },
    { span: 3, node: lot.supplierName },
    { span: 3, label: true, node: t('print.boxCount') },
    { span: 3, node: boxCount !== undefined ? String(boxCount) : '' },
    { span: 2, label: true, node: t('iqc.batchNo') },
    { span: 3, node: lot.batchNo || '' },
    { span: 2, label: true, node: t('iqc.inspectResult') },
    { span: 3, node: resultNode },
  ];
  const row3: Cell[] = [
    { span: 2, label: true, node: t('print.materialSource') },
    { span: 3, node: materialSource || '' },
    { span: 3, label: true, node: t('print.inspectionAttribute') },
    { span: 3, node: attrText },
    { span: 2, label: true, node: t('iqc.inspector') },
    { span: 3, node: tui(lot.inspectorName || '') },
    { span: 2, label: true, node: t('print.approvedBy') },
    { span: 3, node: approver || '' },
  ];

  const renderRow = (cells: Cell[], key: number) => (
    <tr key={key}>
      {cells.map((c, i) => (
        <td key={i} colSpan={c.span} className={c.label ? 'a4-label' : ''}>
          {c.node}
        </td>
      ))}
    </tr>
  );

  return (
    <table className="a4-table a4-module">
      <colgroup>
        {COL_WIDTHS.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <tbody>
        <tr className="a4-main-title">
          <td colSpan={21} style={{ position: 'relative' }}>
            <span style={{ fontSize: '10pt', fontWeight: 'normal', position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)' }}>
              {t('print.docNo')}DT/IQC/JY-001 1.0
            </span>
            {t('print.reportTitle')}
          </td>
        </tr>
        {renderRow(row1, 1)}
        {renderRow(row2, 2)}
        {renderRow(row3, 3)}
      </tbody>
    </table>
  );
};

export default ReportHeader;
