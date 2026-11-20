import React, { useState } from 'react';
import { MapPin } from 'lucide-react';
import { useI18n } from '../../i18n';
import PdaLayout from './components/PdaLayout';
import ScanInput from './components/ScanInput';
import PdaCard from './components/PdaCard';
import PdaButton from './components/PdaButton';
import ResultOverlay from './components/ResultOverlay';
import {
  getInventoryList,
  verifySourceLocation,
  verifyTargetLocation,
  batchIntraTransfer,
} from '../../api/pda';
import { errMsg } from './utils';
import { speakError, speakSuccess } from '../../utils/speech';
import type { Inventory } from '@shared/api.interface';

interface MoveLine {
  rec: Inventory;
  qty: number;
}

/** P5: 库内移库 */
const PdaTransfer: React.FC = () => {
  const { t } = useI18n();
  const [source, setSource] = useState<{ locationId: string; locationCode: string; warehouseId: string } | null>(null);
  const [records, setRecords] = useState<Inventory[]>([]);
  const [lines, setLines] = useState<MoveLine[]>([]);
  const [target, setTarget] = useState<{ locationId: string; locationCode: string; warehouseId: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState({ visible: false, success: true, msg: '' });

  const handleSourceScan = async (code: string) => {
    try {
      const res: any = await verifySourceLocation({ locationCode: code, items: [] });
      const data = res?.data || res;
      if (data?.valid === false && !data.locationId) {
        speakError(data.errorMessage || t('pda.transfer.sourceInvalid'));
        setResult({ visible: true, success: false, msg: data.errorMessage || t('pda.transfer.sourceInvalid') });
        return;
      }
      const src = { locationId: data.locationId, locationCode: data.locationCode || code, warehouseId: data.warehouseId };
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
      speakError();
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.transfer.sourceInvalid')) });
    }
  };

  const toggleLine = (rec: Inventory) => {
    const exists = lines.find((l) => l.rec.id === rec.id);
    if (exists) {
      setLines((ls) => ls.filter((l) => l.rec.id !== rec.id));
    } else {
      setLines((ls) => [...ls, { rec, qty: rec.quantity }]);
    }
  };

  const setLineQty = (id: string, qty: number) =>
    setLines((ls) => ls.map((l) => (l.rec.id === id ? { ...l, qty: Math.min(l.rec.quantity, Math.max(1, qty)) } : l)));

  const handleTargetScan = async (code: string) => {
    if (!source) return;
    try {
      const res: any = await verifyTargetLocation({ targetLocationCode: code, sourceWarehouseId: source.warehouseId });
      const data = res?.data || res;
      if (data?.valid === false) {
        speakError(data.errorMessage || t('pda.transfer.targetInvalid'));
        setResult({ visible: true, success: false, msg: data.errorMessage || t('pda.transfer.targetInvalid') });
        return;
      }
      setTarget({ locationId: data.locationId, locationCode: data.locationCode, warehouseId: data.warehouseId || source.warehouseId });
      speakSuccess();
    } catch (e: any) {
      speakError(errMsg(e, t('pda.transfer.targetInvalid')));
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.transfer.targetInvalid')) });
    }
  };

  const submit = async () => {
    if (!source || !target || lines.length === 0) return;
    setSubmitting(true);
    try {
      const items = lines.map((l) => ({
        qrContent: `${''}|${l.rec.materialCode}||${l.qty}|${l.rec.batchNo || ''}|`,
        supplierCode: '',
        materialCode: l.rec.materialCode,
        materialName: l.rec.materialName,
        unit: l.rec.unit,
        productionDate: l.rec.productionDate || '',
        batchNo: l.rec.batchNo || '',
        serialNo: '',
        quantity: l.qty,
        materialId: l.rec.materialId,
        supplierId: l.rec.supplierId || '',
      }));
      await batchIntraTransfer({
        fromLocationId: source.locationId,
        toLocationId: target.locationId,
        warehouseId: target.warehouseId || source.warehouseId,
        items,
      });
      setResult({ visible: true, success: true, msg: t('pda.transfer.success') });
      resetAll();
    } catch (e: any) {
      speakError();
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.transfer.failed')) });
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

  return (
    <PdaLayout title={t('pda.menu.transfer')}>
      <PdaCard title={t('pda.transfer.step1')}>
        {source ? (
          <div className="pda-ok-box">
            <MapPin size={16} style={{ marginRight: 6 }} />
            {t('pda.transfer.sourceOk')}: {source.locationCode}
          </div>
        ) : (
          <ScanInput placeholder={t('pda.transfer.scanSourcePh')} onScan={handleSourceScan} />
        )}
        {source && (
          <button type="button" className="pda-link-btn" onClick={resetAll}>
            {t('pda.transfer.changeSource')}
          </button>
        )}
      </PdaCard>

      {source && (
        <PdaCard title={`${t('pda.transfer.step2')} (${lines.length})`}>
          {records.length === 0 ? (
            <div className="pda-empty">{t('pda.transfer.noStock')}</div>
          ) : (
            <div className="pda-list">
              {records.map((r) => {
                const line = lines.find((l) => l.rec.id === r.id);
                return (
                  <div key={r.id} className={`pda-list-item ${line ? 'active' : ''}`} onClick={() => toggleLine(r)}>
                    <div className="pda-list-main">
                      <div className="pda-list-title">{r.materialCode}</div>
                      <div className="pda-list-sub">{r.materialName} · {r.batchNo || '-'}</div>
                      <div className="pda-list-sub">{t('pda.transfer.avail')}: {r.quantity} {r.unit}</div>
                    </div>
                    <div className="pda-list-side">
                      {line && (
                        <input
                          className="pda-qty-input"
                          type="number"
                          min={1}
                          max={r.quantity}
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
        <PdaCard title={t('pda.transfer.step3')}>
          {target ? (
            <div className="pda-ok-box">
              <MapPin size={16} style={{ marginRight: 6 }} />
              {t('pda.transfer.targetOk')}: {target.locationCode}
            </div>
          ) : (
            <ScanInput placeholder={t('pda.transfer.scanTargetPh')} onScan={handleTargetScan} />
          )}
          {target && (
            <button type="button" className="pda-link-btn" onClick={() => setTarget(null)}>
              {t('pda.transfer.changeTarget')}
            </button>
          )}
          <div style={{ height: 12 }} />
          <PdaButton fullWidth variant="success" disabled={!target || submitting} onClick={submit}>
            {submitting ? t('pda.submitting') : `${t('pda.transfer.confirm')} (${lines.length})`}
          </PdaButton>
        </PdaCard>
      )}

      <ResultOverlay
        visible={result.visible}
        success={result.success}
        message={result.msg}
        onClose={() => setResult((r) => ({ ...r, visible: false }))}
      />
    </PdaLayout>
  );
};

export default PdaTransfer;
