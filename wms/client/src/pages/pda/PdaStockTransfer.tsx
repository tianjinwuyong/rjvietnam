import React, { useState } from 'react';
import { MapPin, History } from 'lucide-react';
import { useI18n } from '../../i18n';
import PdaLayout from './components/PdaLayout';
import ScanInput from './components/ScanInput';
import PdaCard from './components/PdaCard';
import PdaButton from './components/PdaButton';
import ResultOverlay from './components/ResultOverlay';
import StatusBadge from './components/StatusBadge';
import {
  getInventoryList,
  verifySourceLocation,
  transferStock,
  getTransferList,
} from '../../api/pda';
import { errMsg } from './utils';
import { speakError, speakSuccess } from '../../utils/speech';
import { formatDate } from '../../utils/datetime';
import type { Inventory } from '@shared/api.interface';

interface MoveLine {
  rec: Inventory;
  qty: number;
}

interface TransferRecord {
  id: string;
  transferNo: string;
  transferDate: string;
  materialCode: string;
  materialName: string;
  batchNo?: string;
  fromLocationCode: string;
  toLocationCode: string;
  quantity: string | number;
  unit: string;
  status: string;
}

/** 库存调拨（支持跨仓库）：扫源库位 → 勾选物料 → 扫目标库位 → 提交 */
const PdaStockTransfer: React.FC = () => {
  const { t } = useI18n();
  const [view, setView] = useState<'exec' | 'history'>('exec');
  const [source, setSource] = useState<{ locationId: string; locationCode: string } | null>(null);
  const [records, setRecords] = useState<Inventory[]>([]);
  const [lines, setLines] = useState<MoveLine[]>([]);
  const [target, setTarget] = useState<{ locationId: string; locationCode: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(0);
  const [history, setHistory] = useState<TransferRecord[]>([]);
  const [result, setResult] = useState({ visible: false, success: true, msg: '' });

  const verifyLoc = async (code: string) => {
    const res: any = await verifySourceLocation({ locationCode: code, items: [] });
    const data = res?.data || res;
    if (data?.valid === false && !data.locationId) {
      throw new Error(data.errorMessage || t('pda.xfer.invalidLoc'));
    }
    return { locationId: data.locationId, locationCode: data.locationCode || code };
  };

  const handleSourceScan = async (code: string) => {
    try {
      const src = await verifyLoc(code);
      setSource(src);
      setLines([]);
      setTarget(null);
      speakSuccess();
      const inv = await getInventoryList({ locationId: src.locationId, pageSize: 100 });
      const list = (inv as any).items || (inv as any).data?.items || [];
      setRecords(list.filter((r: Inventory) => !r.locked));
    } catch (e: any) {
      setSource(null);
      setRecords([]);
      speakError(errMsg(e, t('pda.xfer.invalidLoc')));
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.xfer.invalidLoc')) });
    }
  };

  const toggleLine = (rec: Inventory) => {
    const exists = lines.find((l) => l.rec.id === rec.id);
    if (exists) setLines((ls) => ls.filter((l) => l.rec.id !== rec.id));
    else setLines((ls) => [...ls, { rec, qty: Number(rec.quantity) }]);
  };

  const setLineQty = (id: string, qty: number) =>
    setLines((ls) => ls.map((l) => (l.rec.id === id ? { ...l, qty: Math.min(Number(l.rec.quantity), Math.max(1, qty)) } : l)));

  const handleTargetScan = async (code: string) => {
    if (!source) return;
    if (source.locationCode === code) {
      speakError(t('pda.xfer.sameLoc'));
      setResult({ visible: true, success: false, msg: t('pda.xfer.sameLoc') });
      return;
    }
    try {
      const tgt = await verifyLoc(code);
      setTarget(tgt);
      speakSuccess();
    } catch (e: any) {
      speakError(errMsg(e, t('pda.xfer.invalidLoc')));
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.xfer.invalidLoc')) });
    }
  };

  const submit = async () => {
    if (!source || !target || lines.length === 0) return;
    setSubmitting(true);
    let ok = 0;
    const fails: string[] = [];
    try {
      for (const l of lines) {
        try {
          await transferStock({
            fromLocationId: source.locationId,
            toLocationId: target.locationId,
            materialId: l.rec.materialId,
            batchNo: l.rec.batchNo || undefined,
            quantity: l.qty,
          });
          ok += 1;
        } catch (e: any) {
          fails.push(`${l.rec.materialCode}: ${errMsg(e, '')}`);
        }
      }
      setDone(ok);
      if (fails.length === 0) {
        setResult({ visible: true, success: true, msg: `${t('pda.xfer.success')} (${ok})` });
      } else {
        const partialMsg = `${t('pda.xfer.partial')} ${ok}/${lines.length}. ${fails[0]}`;
        speakError(partialMsg);
        setResult({ visible: true, success: false, msg: partialMsg });
      }
      resetAll();
    } finally {
      setSubmitting(false);
    }
  };

  const resetAll = () => {
    setSource(null);
    setRecords([]);
    setLines([]);
    setTarget(null);
  };

  const loadHistory = async () => {
    try {
      const res: any = await getTransferList({ page: 1, pageSize: 30 });
      setHistory(((res?.data || res)?.items || []) as TransferRecord[]);
    } catch (e: any) {
      speakError();
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.xfer.loadFailed')) });
    }
  };

  return (
    <PdaLayout title={t('pda.menu.stockTransfer')}>
      <div className="pda-tabs">
        <button type="button" className={`pda-tab ${view === 'exec' ? 'active' : ''}`} onClick={() => setView('exec')}>
          {t('pda.xfer.execTab')}
        </button>
        <button
          type="button"
          className={`pda-tab ${view === 'history' ? 'active' : ''}`}
          onClick={() => { setView('history'); if (history.length === 0) loadHistory(); }}
        >
          {t('pda.xfer.historyTab')}
        </button>
      </div>

      {view === 'exec' ? (
        <>
          <PdaCard title={t('pda.xfer.step1')}>
            {source ? (
              <div className="pda-ok-box">
                <MapPin size={16} style={{ marginRight: 6 }} />
                {t('pda.xfer.sourceOk')}: {source.locationCode}
              </div>
            ) : (
              <ScanInput placeholder={t('pda.xfer.scanSourcePh')} onScan={handleSourceScan} />
            )}
            {source && (
              <button type="button" className="pda-link-btn" onClick={resetAll}>
                {t('pda.xfer.changeSource')}
              </button>
            )}
          </PdaCard>

          {source && (
            <PdaCard title={`${t('pda.xfer.step2')} (${lines.length})`}>
              {records.length === 0 ? (
                <div className="pda-empty">{t('pda.xfer.noStock')}</div>
              ) : (
                <div className="pda-list">
                  {records.map((r) => {
                    const line = lines.find((l) => l.rec.id === r.id);
                    return (
                      <div key={r.id} className={`pda-list-item ${line ? 'active' : ''}`} onClick={() => toggleLine(r)}>
                        <div className="pda-list-main">
                          <div className="pda-list-title">{r.materialCode}</div>
                          <div className="pda-list-sub">{r.materialName} · {r.batchNo || '-'}</div>
                          <div className="pda-list-sub">{t('pda.xfer.avail')}: {r.quantity} {r.unit}</div>
                        </div>
                        <div className="pda-list-side">
                          {line && (
                            <input
                              className="pda-qty-input"
                              type="number"
                              min={1}
                              max={Number(r.quantity)}
                              value={line.qty}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setLineQty(r.id, Number(e.target.value))}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </PdaCard>
          )}

          {lines.length > 0 && (
            <PdaCard title={t('pda.xfer.step3')}>
              {target ? (
                <div className="pda-ok-box">
                  <MapPin size={16} style={{ marginRight: 6 }} />
                  {t('pda.xfer.targetOk')}: {target.locationCode}
                </div>
              ) : (
                <ScanInput placeholder={t('pda.xfer.scanTargetPh')} onScan={handleTargetScan} />
              )}
              {target && (
                <button type="button" className="pda-link-btn" onClick={() => setTarget(null)}>
                  {t('pda.xfer.changeTarget')}
                </button>
              )}
              <div className="pda-list-sub" style={{ margin: '8px 0' }}>{t('pda.xfer.crossOk')}</div>
              <PdaButton fullWidth variant="success" disabled={!target || submitting} onClick={submit}>
                {submitting ? t('pda.submitting') : `${t('pda.xfer.confirm')} (${lines.length})`}
              </PdaButton>
              {done > 0 && <div className="pda-list-sub" style={{ marginTop: 8 }}>{t('pda.xfer.lastDone')}: {done}</div>}
            </PdaCard>
          )}
        </>
      ) : (
        <PdaCard title={t('pda.xfer.historyTab')}>
          {history.length === 0 ? (
            <div className="pda-empty">{t('pda.xfer.empty')}</div>
          ) : (
            <div className="pda-list">
              {history.map((r) => (
                <div key={r.id} className="pda-list-item">
                  <div className="pda-list-main">
                    <div className="pda-list-title">{r.transferNo}</div>
                    <div className="pda-list-sub">{r.materialCode} {r.materialName}</div>
                    <div className="pda-list-sub">{r.fromLocationCode} → {r.toLocationCode} · {formatDate(r.transferDate)}</div>
                  </div>
                  <div className="pda-list-side">
                    <b>{r.quantity} {r.unit}</b>
                    <StatusBadge status={r.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ height: 12 }} />
          <PdaButton fullWidth variant="ghost" onClick={loadHistory}>
            <History size={14} style={{ marginRight: 4 }} />{t('common.refresh')}
          </PdaButton>
        </PdaCard>
      )}

      <ResultOverlay visible={result.visible} success={result.success} message={result.msg} onClose={() => setResult((r) => ({ ...r, visible: false }))} />
    </PdaLayout>
  );
};

export default PdaStockTransfer;
