import React from 'react';
import { useI18n } from '@client/src/i18n';
import { verdictCell, type PrintRecord } from './types';

interface SectionProps {
  records: PrintRecord[];
}

/**
 * 外观检查（与检验对话框格式一致）
 */
const AppearanceSection: React.FC<SectionProps> = ({ records }) => {
  const { t } = useI18n();
  const list = records;
  const moduleScheme = list[0]?.samplingPlanText || '';

  return (
    <div className="a4-section-block">
      <div className="a4-section-header">
        <span className="a4-section-name">{t('iqc.appearanceSection')}</span>
        <span className="a4-section-scheme">{t('print.samplingPlanColon')}{moduleScheme}</span>
      </div>
      <table className="a4-table a4-section-table">
        <thead>
          <tr>
            <th style={{ width: '5%' }}>{t('common.serialNo')}</th>
            <th style={{ width: '15%' }}>{t('iqc.itemName')}</th>
            <th style={{ width: '30%' }}>{t('iqc.standard')}</th>
            <th style={{ width: '8%' }}>{t('iqc.samplingPlan')}</th>
            <th style={{ width: '7%' }}>{t('iqc.sampleSize')}</th>
            <th style={{ width: '5%' }}>Ac</th>
            <th style={{ width: '5%' }}>Re</th>
            <th style={{ width: '8%' }}>{t('iqc.defectQty')}</th>
            <th style={{ width: '12%' }}>{t('iqc.defectDescription')}</th>
            <th style={{ width: '5%' }}>{t('iqc.isPass')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((rec, idx) => {
            const v = verdictCell(rec.isPass, t);
            return (
              <tr key={idx}>
                <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                <td style={{ textAlign: 'left' }}>{rec.itemName}</td>
                <td style={{ textAlign: 'left' }}>{rec.standard || ''}</td>
                <td style={{ textAlign: 'center' }}>{rec.samplingPlanText || ''}</td>
                <td style={{ textAlign: 'center' }}>{rec.sampleSize ?? ''}</td>
                <td style={{ textAlign: 'center' }}>{rec.ac ?? ''}</td>
                <td style={{ textAlign: 'center' }}>{rec.re ?? ''}</td>
                <td style={{ textAlign: 'center' }}>{rec.defectQty ?? 0}</td>
                <td style={{ textAlign: 'left' }}>{rec.defectDescription || ''}</td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{ color: v.color, fontWeight: 700 }}>{v.text}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default AppearanceSection;
