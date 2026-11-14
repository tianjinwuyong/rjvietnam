import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { useI18n, tf } from '../../i18n';
import PdaLayout from './components/PdaLayout';
import PdaCard from './components/PdaCard';
import PdaButton from './components/PdaButton';
import StatusBadge from './components/StatusBadge';
import { getReceiptList, getReceiptDetail } from '../../api/pda';
import { submitIqc } from '../../api/receipt';
import { errMsg } from './utils';
import { formatDate } from '../../utils/datetime';
import { speakError, speakSuccess } from '../../utils/speech';
import type { ReceiptOrder, PaginatedResponse } from '@shared/api.interface';

const PAGE_SIZE = 20;

/** P3: 收货查询 */
const PdaReceiptList: React.FC = () => {
  const { t } = useI18n();
  const [receiptNo, setReceiptNo] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [materialCode, setMaterialCode] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState<PaginatedResponse<ReceiptOrder> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ReceiptOrder | null>(null);
  const [tip, setResult] = useState('');
  const [submittingIqc, setSubmittingIqc] = useState(false);

  const handleSubmitIqc = async () => {
    setSubmittingIqc(true);
    try {
      const res = await submitIqc();
      const nos = res.inspectionNos || [];
      const msg =
        tf('ui.已提交IQC检验：{lots}个批次，{receipts}条收料单', {
          lots: res.createdLotCount,
          receipts: res.submittedReceiptCount,
        }) + (nos.length > 0 ? tf('ui.，检验编号 {nos}', { nos: nos.join('、') }) : '');
      setResult(msg);
      speakSuccess();
      query(page);
    } catch (e) {
      const msg = errMsg(e, t('ui.提交IQC检验失败'));
      setResult(msg);
      speakError(msg);
    } finally {
      setSubmittingIqc(false);
    }
  };

  const query = async (p = 1) => {
    setLoading(true);
    try {
      const res = await getReceiptList({
        page: p,
        pageSize: PAGE_SIZE,
        receiptNo: receiptNo.trim() || undefined,
        supplierCode: supplierCode.trim() || undefined,
        materialCode: materialCode.trim() || undefined,
        status: status || undefined,
      });
      setData(res as unknown as PaginatedResponse<ReceiptOrder>);
      setPage(p);
    } catch (e) {
      setData(null);
      const msg = errMsg(e, t('pda.receiptList.queryFailed'));
      setResult(msg);
      speakError(msg);
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      const d = await getReceiptDetail(id);
      setDetail(d);
    } catch (e: any) {
      const msg = errMsg(e, t('pda.receiptList.detailFailed'));
      setResult(msg);
      speakError(msg);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <PdaLayout title={t('pda.menu.receiptList')}>
      <PdaCard title={t('pda.receiptList.filter')}>
        <div className="pda-field">
          <input className="pda-input" placeholder={t('pda.receiptList.receiptNoPh')} value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
        </div>
        <div className="pda-row2">
          <input className="pda-input" placeholder={t('pda.receiptList.supplierPh')} value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)} />
          <input className="pda-input" placeholder={t('pda.receiptList.materialPh')} value={materialCode} onChange={(e) => setMaterialCode(e.target.value)} />
        </div>
        <div className="pda-row2">
          <select className="pda-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('pda.receiptList.allStatus')}</option>
            <option value="pending_iqc">{t('pda.receiptList.stPendingIqc')}</option>
            <option value="good">{t('pda.receiptList.stGood')}</option>
            <option value="rejected">{t('pda.receiptList.stRejected')}</option>
          </select>
          <PdaButton onClick={() => query(1)} disabled={loading}>
            <Search size={16} style={{ marginRight: 6 }} />
            {loading ? t('pda.loading') : t('pda.receiptList.search')}
          </PdaButton>
        </div>
        <PdaButton
          fullWidth
          variant="primary"
          onClick={handleSubmitIqc}
          disabled={submittingIqc}
          style={{ marginTop: 8, backgroundColor: 'var(--primary)' }}
        >
          {submittingIqc ? t('pda.submitting') : t('ui.一键提交IQC检验')}
        </PdaButton>
        {tip && <div className="pda-error-text">{tip}</div>}
      </PdaCard>

      <PdaCard title={`${t('pda.receiptList.result')} (${data?.total ?? 0})`}>
        {!data || data.items.length === 0 ? (
          <div className="pda-empty">{t('pda.receiptList.empty')}</div>
        ) : (
          <div className="pda-list">
            {data.items.map((r) => (
              <div key={r.id} className="pda-list-item" onClick={() => openDetail(r.id)}>
                <div className="pda-list-main">
                  <div className="pda-list-title">{r.receiptNo}</div>
                  <div className="pda-list-sub">{r.supplierName || r.supplierCode}</div>
                  <div className="pda-list-sub">
                    {r.materialCode} × {r.quantity} {r.unit}
                  </div>
                </div>
                <div className="pda-list-side">
                  <StatusBadge status={r.status} />
                  <div className="pda-list-sub">{formatDate(r.receiptDate)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {data && data.total > PAGE_SIZE && (
          <div className="pda-pager">
            <PdaButton variant="ghost" disabled={page <= 1} onClick={() => query(page - 1)}>
              {t('pda.prev')}
            </PdaButton>
            <span className="pda-pager-info">
              {page} / {totalPages}
            </span>
            <PdaButton variant="ghost" disabled={page >= totalPages} onClick={() => query(page + 1)}>
              {t('pda.next')}
            </PdaButton>
          </div>
        )}
      </PdaCard>

      {detail && (
        <div className="pda-modal-mask" onClick={() => setDetail(null)}>
          <div className="pda-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="pda-modal-title">{detail.receiptNo}</h3>
            <div className="pda-desc-grid">
              <span>{t('pda.receiptList.supplier')}</span><b>{detail.supplierName || detail.supplierCode}</b>
              <span>{t('pda.receiptList.material')}</span><b>{detail.materialCode} {detail.materialName}</b>
              <span>{t('pda.receiptList.qty')}</span><b>{detail.quantity} {detail.unit}</b>
              <span>{t('pda.receiptList.batch')}</span><b>{detail.batchNo || '-'}</b>
              <span>{t('pda.receiptList.status')}</span><b><StatusBadge status={detail.status} /></b>
              <span>{t('pda.receiptList.date')}</span><b>{formatDate(detail.receiptDate)}</b>
            </div>
            <PdaButton fullWidth onClick={() => setDetail(null)}>{t('pda.close')}</PdaButton>
          </div>
        </div>
      )}
    </PdaLayout>
  );
};

export default PdaReceiptList;
