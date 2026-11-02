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
import type { PickingOrder, PickingOrderItem, PaginatedResponse, TailLabel } from '@shared/api.interface';

interface PickLine {
  item: PickingOrderItem;
  remaining: number;
  scanned: boolean;
  pickedQty: number;
}

/** P7: 领料拣货 */
const PdaPicking: React.FC = () => {
  const { t } = useI18n();
  const { role } = useAuth();

  const [list, setList] = useState<PaginatedResponse<PickingOrder> | null>(null);
  const [current, setCurrent] = useState<PickingOrder | null>(null);
  const [lines, setLines] = useState<PickLine[]>([]);
  const [activeLineId, setActiveLineId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [tailLabels, setTailLabels] = useState<TailLabel[]>([]);
  const [result, setResult] = useState({ visible: false, success: true, msg: '' });

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadList = async () => {
    try {
      const res = await getPickingOrderList({
        page: 1,
        pageSize: 50,
        status: 'approved',
        workSection: role?.workSection || undefined,
      });
      setList(res as unknown as PaginatedResponse<PickingOrder>);
    } catch (e: any) {
      speakError();
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.picking.loadFailed')) });
    }
  };

  const openOrder = async (order: PickingOrder) => {
    try {
      const detail = await getPickingOrderByNo(order.pickingNo);
      setCurrent(detail);
      const items = detail.items || [];
      setLines(
        items.map((it) => ({
          item: it,
          remaining: Math.max(0, it.pickQty - (it.actualQty || 0)),
          scanned: false,
          pickedQty: 0,
        })),
      );
      setActiveLineId(items[0]?.id || '');
      setTailLabels([]);
    } catch (e: any) {
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.picking.detailFailed')) });
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
    setLines((ls) =>
      ls.map((l) =>
        l.item.id === lineId ? { ...l, scanned: true, pickedQty: Math.min(l.remaining, parsed?.quantity || l.remaining) } : l,
      ),
    );
    speakSuccess();
  };

  const setPicked = (lineId: string, qty: number) =>
    setLines((ls) => ls.map((l) => (l.item.id === lineId ? { ...l, pickedQty: Math.min(l.remaining, Math.max(0, qty)) } : l)));

  const allDone = lines.length > 0 && lines.every((l) => !l.scanned || l.pickedQty >= l.remaining);

  const submit = async () => {
    if (!current) return;
    const items = lines.filter((l) => l.scanned && l.pickedQty > 0).map((l) => ({ id: l.item.id, actualQty: l.pickedQty }));
    if (items.length === 0) {
      speakError();
      setResult({ visible: true, success: false, msg: t('pda.picking.nothingPicked') });
      return;
    }
    setSubmitting(true);
    try {
      const res: any = await pickMaterial(current.id, { items });
      const data = res?.data || res;
      setTailLabels(data?.tailLabels || []);
      setResult({ visible: true, success: true, msg: t('pda.picking.success') });
      setCurrent(null);
      setLines([]);
      loadList();
    } catch (e: any) {
      speakError();
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.picking.submitFailed')) });
    } finally {
      setSubmitting(false);
    }
  };

  if (current) {
    return (
      <PdaLayout title={`${t('pda.menu.picking')} - ${current.pickingNo}`}>
        <PdaCard>
          <div className="pda-desc-grid">
            <span>{t('pda.picking.orderNo')}</span><b>{current.pickingNo}</b>
            <span>{t('pda.picking.wo')}</span><b>{current.workOrderNo}</b>
            <span>{t('pda.picking.section')}</span><b>{current.workSection?.toUpperCase()}</b>
          </div>
        </PdaCard>

        {lines.map((line, idx) => (
          <PdaCard key={line.item.id} title={`${idx + 1}. ${line.item.materialCode}`}>
            <div className="pda-list-sub">{line.item.materialName} · {line.item.unit}</div>
            {line.item.locations && line.item.locations.length > 0 ? (
              <div className="pda-list-sub" style={{ marginTop: 4 }}>
                <span>{t('pda.picking.location')}：</span>
                {line.item.locations.map((loc, li) => (
                  <span key={`${loc.locationCode}-${li}`}>
                    {li > 0 ? ' · ' : ''}
                    <b style={{ color: '#1677ff' }}>{loc.locationCode}</b>（{loc.quantity}）
                  </span>
                ))}
              </div>
            ) : (
              <div className="pda-list-sub" style={{ marginTop: 4, color: '#d4380d', fontWeight: 600 }}>
                {t('pda.picking.noStock')}
              </div>
            )}
            <div className="pda-desc-grid" style={{ marginTop: 8 }}>
              <span>{t('pda.picking.demand')}</span><b>{line.item.pickQty}</b>
              <span>{t('pda.picking.picked')}</span><b>{line.item.actualQty || 0}</b>
              <span>{t('pda.picking.remain')}</span><b style={{ color: '#1677ff' }}>{line.remaining}</b>
            </div>
            {line.remaining > 0 ? (
              !line.scanned ? (
                <div style={{ marginTop: 10 }}>
                  <ScanInput placeholder={t('pda.picking.scanPh')} onScan={handleScan(line.item.id)} autoFocus={activeLineId === line.item.id} />
                </div>
              ) : (
                <div className="pda-row2" style={{ marginTop: 10 }}>
                  <input
                    className="pda-input"
                    type="number"
                    min={0}
                    max={line.remaining}
                    value={line.pickedQty}
                    onChange={(e) => setPicked(line.item.id, Number(e.target.value))}
                  />
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

        {tailLabels.length > 0 && (
          <PdaCard title={t('pda.picking.tailLabels')}>
            {tailLabels.map((tl, i) => (
              <div key={i} className="pda-list-item">
                <div className="pda-list-main">
                  <div className="pda-list-title">{tl.labelNo}</div>
                  <div className="pda-list-sub">{tl.materialCode} {tl.materialName}</div>
                  <div className="pda-list-sub">{tl.batchNo || ''} @ {tl.locationCode || '-'}</div>
                </div>
                <div className="pda-list-side"><b>{tl.quantity}</b><StatusBadge status={tl.direction} /></div>
              </div>
            ))}
          </PdaCard>
        )}

        <div style={{ height: 12 }} />
        <PdaButton fullWidth variant="success" disabled={!allDone || submitting} onClick={submit}>
          {submitting ? t('pda.submitting') : t('pda.picking.submit')}
        </PdaButton>

        <ResultOverlay
          visible={result.visible}
          success={result.success}
          message={result.msg}
          onClose={() => setResult((r) => ({ ...r, visible: false }))}
        />
      </PdaLayout>
    );
  }

  return (
    <PdaLayout title={t('pda.menu.picking')}>
      <PdaCard title={`${t('pda.picking.title')} (${list?.total ?? 0})`}>
        {!list || list.items.length === 0 ? (
          <div className="pda-empty">{t('pda.picking.empty')}</div>
        ) : (
          <div className="pda-list">
            {list.items.map((o) => (
              <div key={o.id} className="pda-list-item" onClick={() => openOrder(o)}>
                <div className="pda-list-main">
                  <div className="pda-list-title">{o.pickingNo}</div>
                  <div className="pda-list-sub">{o.workOrderNo}</div>
                  <div className="pda-list-sub">{o.workSection?.toUpperCase()} · {o.totalQty}</div>
                </div>
                <div className="pda-list-side">
                  <StatusBadge status={o.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </PdaCard>
      <ResultOverlay
        visible={result.visible}
        success={result.success}
        message={result.msg}
        onClose={() => setResult((r) => ({ ...r, visible: false }))}
      />
    </PdaLayout>
  );
};

export default PdaPicking;
