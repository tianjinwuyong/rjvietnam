import React, { useEffect, useState } from 'react';
import { useI18n, tf } from '../../i18n';
import PdaLayout from './components/PdaLayout';
import PdaCard from './components/PdaCard';
import PdaButton from './components/PdaButton';
import ScanInput from './components/ScanInput';
import StatusBadge from './components/StatusBadge';
import ResultOverlay from './components/ResultOverlay';
import { getPickingOrderList, getPickingOrderByNo, receivePicking } from '../../api/pda';
import { errMsg } from './utils';
import { speakError, speakSuccess } from '../../utils/speech';
import type { PickingOrder, PaginatedResponse } from '@shared/api.interface';

/** P8: 领料签收（发料完成后由领料方物料员确认实收） */
const PdaIssuing: React.FC = () => {
  const { t } = useI18n();
  const [list, setList] = useState<PaginatedResponse<PickingOrder> | null>(null);
  const [current, setCurrent] = useState<PickingOrder | null>(null);
  /** 逐行实收数量（默认等于实发） */
  const [recvQtys, setRecvQtys] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState({ visible: false, success: true, msg: '' });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      const res = await getPickingOrderList({ page: 1, pageSize: 50, status: 'issued' });
      setList(res as unknown as PaginatedResponse<PickingOrder>);
    } catch (e: any) {
      const msg = errMsg(e, t('pda.issuing.loadFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    }
  };

  const openOrder = async (order: PickingOrder) => {
    try {
      const d = await getPickingOrderByNo(order.pickingNo);
      setCurrent(d);
      const qtys: Record<string, number> = {};
      const rmk: Record<string, string> = {};
      for (const it of d.items || []) {
        qtys[it.id] = Number(it.receivedQty || it.actualQty || 0);
        rmk[it.id] = it.receiveRemark || '';
      }
      setRecvQtys(qtys);
      setRemarks(rmk);
      speakSuccess();
    } catch (e: any) {
      const msg = errMsg(e, t('pda.issuing.detailFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    }
  };

  const handleScanOrder = async (code: string) => {
    const no = code.trim();
    if (!no) return;
    await openOrder({ pickingNo: no } as PickingOrder);
  };

  const submitReceive = async () => {
    if (!current) return;
    if (!['issued', 'completed'].includes(current.status)) {
      setResult({ visible: true, success: false, msg: t('pda.issuing.notIssued') });
      return;
    }
    const items = (current.items || []).map((it) => ({
      id: it.id,
      receivedQty: Number(recvQtys[it.id] ?? it.actualQty ?? 0),
      remark: remarks[it.id] || undefined,
    }));
    setSubmitting(true);
    try {
      const updated = await receivePicking(current.id, { items });
      setCurrent(updated);
      setResult({ visible: true, success: true, msg: t('pda.issuing.success') });
      speakSuccess();
      load();
    } catch (e: any) {
      const msg = errMsg(e, t('pda.issuing.failed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    } finally {
      setSubmitting(false);
    }
  };

  const readOnly = current ? !['issued', 'completed'].includes(current.status) : false;

  if (current) {
    return (
      <PdaLayout title={`${t('pda.menu.issuing')} - ${current.pickingNo}`}>
        <PdaCard>
          <div className="pda-desc-grid">
            <span>{t('pda.picking.orderNo')}</span><b>{current.pickingNo}</b>
            <span>{t('pda.picking.wo')}</span><b>{current.workOrderNo}</b>
            <span>{t('pda.picking.section')}</span><b>{current.workSection?.toUpperCase()}</b>
            <span>{t('pda.issuing.picker')}</span><b>{current.pickerName || '-'}</b>
            <span>{t('pda.issuing.status')}</span><b><StatusBadge status={current.status} /></b>
          </div>
        </PdaCard>

        <PdaCard title={t('pda.issuing.detail')}>
          <div className="pda-list">
            {(current.items || []).map((it) => {
              const issued = Number(it.actualQty || 0);
              const recv = Number(recvQtys[it.id] ?? it.receivedQty ?? issued);
              const diff = recv - issued;
              return (
                <div key={it.id} className="pda-list-item">
                  <div className="pda-list-main">
                    <div className="pda-list-title">{it.materialCode}</div>
                    <div className="pda-list-sub">{it.materialName}</div>
                    <div className="pda-list-sub">
                      {t('pda.issuing.issuedQty')}: {issued} {it.unit}
                      {diff !== 0 && (
                        <span style={{ color: '#ff4d4f', marginLeft: 8 }}>
                          {t('pda.issuing.diff')} {diff > 0 ? '+' : ''}{diff}
                        </span>
                      )}
                    </div>
                    {!readOnly && diff !== 0 && (
                      <input
                        className="pda-input"
                        style={{ marginTop: 6, height: 40 }}
                        placeholder={t('pda.issuing.remarkPh')}
                        value={remarks[it.id] || ''}
                        onChange={(e) => setRemarks((r) => ({ ...r, [it.id]: e.target.value }))}
                      />
                    )}
                  </div>
                  <div className="pda-list-side">
                    {readOnly ? (
                      <b>{Number(it.receivedQty || issued)} {it.unit}</b>
                    ) : (
                      <input
                        className="pda-qty-input"
                        type="number"
                        min={0}
                        max={issued}
                        value={recvQtys[it.id] ?? issued}
                        onChange={(e) =>
                          setRecvQtys((q) => ({
                            ...q,
                            [it.id]: Math.max(0, Math.min(issued, Number(e.target.value) || 0)),
                          }))
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ height: 12 }} />
          {readOnly ? (
            <div className="pda-empty">
              {current.status === 'received'
                ? tf('pda.issuing.receivedInfo', {
                    name: current.receivedByName || '-',
                    time: current.receivedTime ? new Date(current.receivedTime).toLocaleString('zh-CN', { hour12: false }) : '-',
                  })
                : t('pda.issuing.notIssued')}
            </div>
          ) : (
            <>
              <PdaButton fullWidth variant="primary" disabled={submitting} onClick={() => setRecvQtys(
                Object.fromEntries((current.items || []).map((it) => [it.id, Number(it.actualQty || 0)])),
              )}>
                {t('pda.issuing.allMatch')}
              </PdaButton>
              <div style={{ height: 10 }} />
              <PdaButton fullWidth variant="success" disabled={submitting} onClick={submitReceive}>
                {submitting ? t('pda.submitting') : t('pda.issuing.confirmReceive')}
              </PdaButton>
            </>
          )}
          <div style={{ height: 10 }} />
          <PdaButton fullWidth variant="ghost" onClick={() => { setCurrent(null); load(); }}>
            {t('common.back')}
          </PdaButton>
        </PdaCard>
        <ResultOverlay visible={result.visible} success={result.success} message={result.msg} onClose={() => setResult((r) => ({ ...r, visible: false }))} />
      </PdaLayout>
    );
  }

  return (
    <PdaLayout title={t('pda.menu.issuing')}>
      <PdaCard title={`${t('pda.issuing.title')} (${list?.total ?? 0})`}>
        <ScanInput placeholder={t('pda.issuing.scanPh')} onScan={handleScanOrder} />
        <div style={{ height: 10 }} />
        {(!list || list.items.length === 0) ? (
          <div className="pda-empty">{t('pda.issuing.empty')}</div>
        ) : (
          <div className="pda-list">
            {list.items.map((o) => (
              <div key={o.id} className="pda-list-item" onClick={() => openOrder(o)}>
                <div className="pda-list-main">
                  <div className="pda-list-title">{o.pickingNo}</div>
                  <div className="pda-list-sub">{o.workOrderNo} · {o.workSection?.toUpperCase()}</div>
                  <div className="pda-list-sub">{o.pickerName ? `${t('pda.issuing.picker')}: ${o.pickerName}` : ''}</div>
                </div>
                <div className="pda-list-side">
                  <StatusBadge status={o.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </PdaCard>
      <ResultOverlay visible={result.visible} success={result.success} message={result.msg} onClose={() => setResult((r) => ({ ...r, visible: false }))} />
    </PdaLayout>
  );
};

export default PdaIssuing;
