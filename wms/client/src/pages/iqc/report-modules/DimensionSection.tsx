import React from 'react';
import { verdictCell, type PrintRecord } from './types';
import { isOutOfSpec } from '@client/src/utils/spec-parser';
import { useI18n } from '@client/src/i18n';

interface SectionProps {
  records: PrintRecord[];
}

const DATA_COLS = 10;

/**
 * 尺寸&功能检查
 * 列：抽样方案 | 抽样数 | Ac | Re | 项目 | Spec | LSL | USL | 数据(10列) | 不良数量 | 判定
 * 一个检验项目的数据超过10个时自动换行，左右两侧信息列用rowSpan垂直合并
 */
const DimensionSection: React.FC<SectionProps> = ({ records }) => {
  const { t } = useI18n();
  const list = records;
  const moduleScheme = list[0]?.samplingPlanText || '';

  // 将数据按每行10个分组
  const chunkData = (values: (string | number)[]) => {
    const chunks: (string | number)[][] = [];
    for (let i = 0; i < values.length; i += DATA_COLS) {
      chunks.push(values.slice(i, i + DATA_COLS));
    }
    if (chunks.length === 0) chunks.push([]);
    return chunks;
  };

  // 补齐到10个
  const padTo10 = (arr: (string | number)[]) => {
    const result = [...arr];
    while (result.length < DATA_COLS) result.push('');
    return result;
  };

  return (
    <div className="a4-section-block">
      <div className="a4-section-header">
        <span className="a4-section-name">{t('iqc.dimensionSection')}</span>
        <span className="a4-section-scheme">{t('print.samplingPlanColon')}{moduleScheme}</span>
      </div>
      <table className="a4-table a4-section-table">
        <thead>
          <tr>
            <th style={{ width: '6%' }}>{t('iqc.samplingPlan')}</th>
            <th style={{ width: '5%' }}>{t('iqc.sampleSize')}</th>
            <th style={{ width: '3%' }}>Ac</th>
            <th style={{ width: '3%' }}>Re</th>
            <th style={{ width: '9%' }}>{t('iqc.itemName')}</th>
            <th style={{ width: '8%' }}>Spec</th>
            {Array.from({length: DATA_COLS}).map((_, i) => (
              <th key={i} style={{ width: '5%' }}>{i+1}</th>
            ))}
            <th style={{ width: '6%' }}>{t('iqc.defectQty')}</th>
            <th style={{ width: '5%' }}>{t('iqc.isPass')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((rec, idx) => {
            const v = verdictCell(rec.isPass, t);
            const measured = Array.isArray(rec.measuredValues) ? rec.measuredValues : [];
            const chunks = chunkData(measured);
            const rowSpan = chunks.length;

            return chunks.map((chunk, chunkIdx) => {
              const dataCells = padTo10(chunk);
              const isFirstRow = chunkIdx === 0;
              const isLastRow = chunkIdx === chunks.length - 1;

              return (
                <tr key={`${idx}-${chunkIdx}`}>
                  {isFirstRow && (
                    <>
                      <td rowSpan={rowSpan} style={{ textAlign: 'center', verticalAlign: 'middle' }}>{rec.samplingPlanText || ''}</td>
                      <td rowSpan={rowSpan} style={{ textAlign: 'center', verticalAlign: 'middle' }}>{rec.sampleSize ?? ''}</td>
                      <td rowSpan={rowSpan} style={{ textAlign: 'center', verticalAlign: 'middle' }}>{rec.ac ?? ''}</td>
                      <td rowSpan={rowSpan} style={{ textAlign: 'center', verticalAlign: 'middle' }}>{rec.re ?? ''}</td>
                      <td rowSpan={rowSpan} style={{ textAlign: 'left', verticalAlign: 'middle' }}>{rec.itemName}</td>
                      <td rowSpan={rowSpan} style={{ textAlign: 'center', verticalAlign: 'middle' }}>{rec.spec || ''}</td>
                    </>
                  )}
                  {dataCells.map((dv, di) => {
                    const bad = isOutOfSpec(String(dv), rec.spec);
                    return (
                      <td
                        key={di}
                        style={{
                          textAlign: 'center',
                          padding: '8px 4px',
                          fontSize: '11pt',
                          minWidth: '28px',
                          ...(bad ? { color: '#dc2626', fontWeight: 700, background: '#fee2e2' } : {}),
                        }}
                      >
                        {dv}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>{isLastRow ? (rec.defectQty ?? 0) : ''}</td>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    {isLastRow ? <span style={{ color: v.color, fontWeight: 700 }}>{v.text}</span> : ''}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
};

export default DimensionSection;
