import React, { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../auth/AuthContext';
import PdaLayout from './components/PdaLayout';
import ScanInput from './components/ScanInput';
import PdaCard from './components/PdaCard';
import PdaButton from './components/PdaButton';
import StatusBadge from './components/StatusBadge';
import ResultOverlay from './components/ResultOverlay';
import { getPickingOrderList, getPickingOrderByNo, pickMaterial } from '../../api/pda';
import { errMsg, parseQr } from './utils';
import { speakError, speakSuccess } from '../../utils/speech';
import type { PickingOrder, PickingOrderItem, PaginatedResponse } from '@shared/api.interface';

interface PickLine {
  item: PickingOrderItem;
  remaining: number;
  scanned: boolean;
  pickedQty: number;
}

/** P9: 补料作业（流程同 P7，仅展示补料单） */
const PdaSupplement: React.FC = () => {
  const { t } = useI18n();
  const { role } = useAuth();
  const [list, setList] = useState<PickingOrder[]>([]);
  const [current, setCurrent] = useState<PickingOrder | null>(null);
  const [lines, setLines] = useState<PickLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState({ visible: false, success: true, msg: '' });

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadList = async () => {
    try {
      const res = await getPickingOrderList({ page: 1, pageSize: 100, status: 'approved', workSection: role?.workSection || undefined });
      const all = ((res as unknown as PaginatedResponse<PickingOrder>).items) || [];
      setList(all.filter((o) => o.isSupplement));
    } catch (e: any) {
      const msg = errMsg(e, t('pda.supplement.loadFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    }
  };

  const openOrder = async (order: PickingOrder) => {
    try {
      const detail = await getPickingOrderByNo(order.pickingNo);
      setCurrent(detail);
      const items = detail.items || [];
      setLines(items.map((it) => ({ item: it, remaining: Math.max(0, it.pickQty - (it.actualQty || 0)), scanned: false, pickedQty: 0 })));
    } catch (e: any) {
      const msg = errMsg(e, t('pda.supplement.detailFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    }
  };

  const handleScan = (lineId: string) => (code: string) => {
    const parsed = parseQr(code);
    const line = lines.find((l) => l.item.id === lineId);
    if (!line) return;
    const mc = parsed?.materialCode || code.split('|')[1] || code;
    if (mc.trim() !== line.item.materialCode) {
      speakError(t('ui.物料不匹配'));
      setResult({ visible: true, success: false, msg: `${t('pda.picking.mismatch')}: ${mc}` });
      return;
    }
    setLines((ls) => ls.map((l) => (l.item.id === lineId ? { ...l, scanned: true, pickedQty: Math.min(l.remaining, parsed?.quantity || l.remaining) } : l)));
    speakSuccess();
  };

  const setPicked = (lineId: string, qty: number) =>
    setLines((ls) => ls.map((l) => (l.item.id === lineId ? { ...l, pickedQty: Math.min(l.remaining, Math.max(0, qty)) } : l)));

  const submit = async () => {
    if (!current) return;
    const items = lines.filter((l) => l.scanned && l.pickedQty > 0).map((l) => ({ id: l.item.id, actualQty: l.pickedQty }));
    if (items.length === 0) {
      setResult({ visible: true, success: false, msg: t('pda.picking.nothingPicked') });
      return;
    }
    setSubmitting(true);
    try {
      await pickMaterial(current.id, { items });
      setResult({ visible: true, success: true, msg: t('pda.supplement.success') });
      setCurrent(null);
      setLines([]);
      loadList();
    } catch (e: any) {
      const msg = errMsg(e, t('pda.supplement.failed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    } finally {
      setSubmitting(false);
    }
  };

  if (current) {
    return (
      <PdaLayout title={`${t('pda.menu.supplement')} - ${current.pickingNo}`}>
        <PdaCard>
          <div className="pda-desc-grid">
            <span>{t('pda.picking.orderNo')}</span><b>{current.pickingNo}</b>
            <span>{t('pda.picking.wo')}</span><b>{current.workOrderNo}</b>
            <span>{t('pda.supplement.reason')}</span><b>{current.remark || '-'}</b>
          </div>
        </PdaCard>
        {lines.map((line, idx) => (
          <PdaCard key={line.item.id} title={`${idx + 1}. ${line.item.materialCode}`}>
            <div className="pda-list-sub">{line.item.materialName}</div>
            <div className="pda-desc-grid" style={{ marginTop: 8 }}>
              <span>{t('pda.picking.demand')}</span><b>{line.item.pickQty}</b>
              <span>{t('pda.picking.remain')}</span><b style={{ color: '#1677ff' }}>{line.remaining}</b>
            </div>
            {line.remaining > 0 ? (
              !line.scanned ? (
                <div style={{ marginTop: 10 }}><ScanInput placeholder={t('pda.picking.scanPh')} onScan={handleScan(line.item.id)} /></div>
              ) : (
                <div className="pda-row2" style={{ marginTop: 10 }}>
                  <input className="pda-input" type="number" min={0} max={line.remaining} value={line.pickedQty} onChange={(e) => setPicked(line.item.id, Number(e.target.value))} />
                  <PdaButton variant="ghost" onClick={() => setLines((ls) => ls.map((l) => (l.item.id === line.item.id ? { ...l, scanned: false, pickedQty: 0 } : l)))}>
                    {t('pda.picking.rescan')}
                  </PdaButton>
                </div>
              )
            ) : (
              <div className="pda-ok-box" style={{ marginTop: 10 }}>{t('pda.picking.done')}</div>
            )}
          </PdaCard>
        ))}
        <div style={{ height: 12 }} />
        <PdaButton fullWidth variant="success" disabled={submitting} onClick={submit}>
          {submitting ? t('pda.submitting') : t('pda.supplement.submit')}
        </PdaButton>
        <ResultOverlay visible={result.visible} success={result.success} message={result.msg} onClose={() => setResult((r) => ({ ...r, visible: false }))} />
      </PdaLayout>
    );
  }

  return (
    <PdaLayout title={t('pda.menu.supplement')}>
      <PdaCard title={`${t('pda.menu.supplement')} (${list.length})`}>
        {list.length === 0 ? (
          <div className="pda-empty">{t('pda.supplement.empty')}</div>
        ) : (
          <div className="pda-list">
            {list.map((o) => (
              <div key={o.id} className="pda-list-item" onClick={() => openOrder(o)}>
                <div className="pda-list-main">
                  <div className="pda-list-title">{o.pickingNo}</div>
                  <div className="pda-list-sub">{o.workOrderNo}</div>
                  <div className="pda-list-sub">{o.remark || t('pda.supplement.title')}</div>
                </div>
                <div className="pda-list-side"><StatusBadge status={o.status} /></div>
              </div>
            ))}
          </div>
        )}
      </PdaCard>
      <ResultOverlay visible={result.visible} success={result.success} message={result.msg} onClose={() => setResult((r) => ({ ...r, visible: false }))} />
    </PdaLayout>
  );
};

export default PdaSupplement;
