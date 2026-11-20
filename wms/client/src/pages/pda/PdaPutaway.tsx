import React, { useState, useEffect } from 'react';
import { MapPin, Package, ClipboardList } from 'lucide-react';
import { useI18n, tf } from '../../i18n';
import PdaLayout from './components/PdaLayout';
import ScanInput from './components/ScanInput';
import PdaCard from './components/PdaCard';
import PdaButton from './components/PdaButton';
import ResultOverlay from './components/ResultOverlay';
import {
  queryInventory,
  verifyTargetLocation,
  intraTransfer,
} from '../../api/pda';
import { getReceiptList } from '../../api/receipt';
import { errMsg, parseQr } from './utils';
import { speakError, speakSuccess } from '../../utils/speech';
import type { Inventory, ReceiptOrder } from '@shared/api.interface';

/** P4: 上架 */
const PdaPutaway: React.FC = () => {
  const { t } = useI18n();
  const [matCode, setMatCode] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [records, setRecords] = useState<Inventory[]>([]);
  const [selected, setSelected] = useState<Inventory | null>(null);
  const [qty, setQty] = useState(0);
  const [target, setTarget] = useState<{ locationId: string; locationCode: string; warehouseId: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState({ visible: false, success: true, msg: '' });
  // 待上架任务：已收货且IQC合格、尚未上架的收货单
  const [pendingTasks, setPendingTasks] = useState<ReceiptOrder[]>([]);

  // 加载待上架任务列表
  const loadPendingTasks = async () => {
    try {
      const res = await getReceiptList({ page: 1, pageSize: 50, status: 'iqc_pass' });
      setPendingTasks(res.items || []);
    } catch {
      // 静默失败，不阻塞手动扫码上架
    }
  };

  useEffect(() => {
    loadPendingTasks();
  }, []);

  // 点击待上架任务：直接带出该物料批次并查询库存
  const pickTask = async (task: ReceiptOrder) => {
    const code = task.materialCode;
    const bn = task.batchNo || '';
    setMatCode(code);
    setBatchNo(bn);
    setSelected(null);
    setTarget(null);
    try {
      const res = await queryInventory({ materialCode: code, batchNo: bn || undefined, stockStatus: 'good' });
      const list = (res?.items || []).filter((it: Inventory) => !it.locked);
      setRecords(list);
      if (list.length === 1) {
        selectRecord(list[0]);
      }
      if (list.length === 0) {
        speakError();
        setResult({ visible: true, success: false, msg: t('pda.putaway.noStock') });
      }
    } catch (e: any) {
      setRecords([]);
      speakError();
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.putaway.queryFailed')) });
    }
  };

  const handleMatScan = async (code: string) => {
    const parsed = parseQr(code);
    const mc = parsed?.materialCode || code.split('|')[1] || code;
    const bn = parsed?.batchNo || code.split('|')[4] || '';
    setMatCode(mc.trim());
    setBatchNo(bn.trim());
    setSelected(null);
    setTarget(null);
    try {
      const res = await queryInventory({ materialCode: mc.trim(), batchNo: bn.trim() || undefined, stockStatus: 'good' });
      const list = (res?.items || []).filter((it: Inventory) => !it.locked);
      setRecords(list);
      if (list.length === 1) {
        selectRecord(list[0]);
      }
      if (list.length === 0) {
        speakError();
        setResult({ visible: true, success: false, msg: t('pda.putaway.noStock') });
      }
    } catch (e: any) {
      setRecords([]);
      speakError();
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.putaway.queryFailed')) });
    }
  };

  const selectRecord = (rec: Inventory) => {
    setSelected(rec);
    setQty(rec.quantity);
    setTarget(null);
  };

  const handleTargetScan = async (code: string) => {
    if (!selected) return;
    const srcWh = (selected as any).warehouseId || '';
    try {
      const res: any = await verifyTargetLocation({ targetLocationCode: code, sourceWarehouseId: srcWh });
      const data = res?.data || res;
      if (data?.valid === false) {
        speakError(data.errorMessage || t('pda.putaway.targetInvalid'));
        setResult({ visible: true, success: false, msg: data.errorMessage || t('pda.putaway.targetInvalid') });
        return;
      }
      setTarget({ locationId: data.locationId, locationCode: data.locationCode, warehouseId: data.warehouseId || srcWh });
      speakSuccess();
    } catch (e: any) {
      speakError(errMsg(e, t('pda.putaway.targetInvalid')));
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.putaway.targetInvalid')) });
    }
  };

  const submit = async () => {
    if (!selected || !target) return;
    setSubmitting(true);
    try {
      await intraTransfer({
        warehouseId: target.warehouseId || (selected as any).warehouseId || '',
        fromLocationId: selected.locationId,
        toLocationId: target.locationId,
        materialId: selected.materialId,
        batchNo: selected.batchNo,
        quantity: qty,
      });
      setResult({ visible: true, success: true, msg: t('pda.putaway.success') });
      reset();
      loadPendingTasks();
    } catch (e: any) {
      speakError();
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.putaway.failed')) });
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setMatCode('');
    setBatchNo('');
    setRecords([]);
    setSelected(null);
    setTarget(null);
    setQty(0);
  };

  return (
    <PdaLayout title={t('pda.menu.putaway')}>
      {/* 待上架任务清单：点击直接带出该物料批次 */}
      {pendingTasks.length > 0 && (
        <PdaCard title={tf('ui.待上架任务 ({n})', { n: pendingTasks.length })}>
          <div className="pda-list" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {pendingTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className="pda-list-item"
                style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none' }}
                onClick={() => pickTask(task)}
              >
                <div className="pda-list-main">
                  <div className="pda-list-title">
                    <ClipboardList size={14} style={{ marginRight: 6 }} />
                    {task.materialCode} · {task.materialName}
                  </div>
                  <div className="pda-list-sub">
                    {t('ui.批次:')} {task.batchNo || '-'} · {t('ui.当前库位:')} {task.locationCode || '-'}
                  </div>
                </div>
                <div className="pda-list-side">
                  <b>{task.quantity} {task.unit}</b>
                </div>
              </button>
            ))}
          </div>
        </PdaCard>
      )}

      <PdaCard title={t('pda.putaway.step1')}>
        <ScanInput placeholder={t('pda.putaway.scanMatPh')} onScan={handleMatScan} />
        {matCode && (
          <div className="pda-desc-grid" style={{ marginTop: 10 }}>
            <span>{t('pda.putaway.material')}</span><b>{matCode}</b>
            <span>{t('pda.putaway.batch')}</span><b>{batchNo || '-'}</b>
          </div>
        )}
      </PdaCard>

      {records.length > 0 && (
        <PdaCard title={t('pda.putaway.step2')}>
          <div className="pda-list">
            {records.map((r) => (
              <div
                key={r.id}
                className={`pda-list-item ${selected?.id === r.id ? 'active' : ''}`}
                onClick={() => selectRecord(r)}
              >
                <div className="pda-list-main">
                  <div className="pda-list-title">{r.locationCode}</div>
                  <div className="pda-list-sub">{r.materialName}</div>
                </div>
                <div className="pda-list-side">
                  <b>{r.quantity} {r.unit}</b>
                </div>
              </div>
            ))}
          </div>
        </PdaCard>
      )}

      {selected && (
        <PdaCard title={t('pda.putaway.step3')}>
          <div className="pda-field">
            <label className="pda-label">
              <Package size={16} style={{ marginRight: 6 }} />
              {t('pda.putaway.qty')}
            </label>
            <input className="pda-input" type="number" value={qty} max={selected.quantity} onChange={(e) => setQty(Number(e.target.value))} />
            <div className="pda-list-sub">{t('pda.putaway.avail')}: {selected.quantity}</div>
          </div>
          {target ? (
            <div className="pda-ok-box">
              <MapPin size={16} style={{ marginRight: 6 }} />
              {t('pda.putaway.targetOk')}: {target.locationCode}
            </div>
          ) : (
            <ScanInput placeholder={t('pda.putaway.scanTargetPh')} onScan={handleTargetScan} />
          )}
          {target && (
            <button type="button" className="pda-link-btn" onClick={() => setTarget(null)}>
              {t('pda.putaway.changeTarget')}
            </button>
          )}
          <div style={{ height: 12 }} />
          <PdaButton fullWidth variant="success" disabled={!target || submitting} onClick={submit}>
            {submitting ? t('pda.submitting') : t('pda.putaway.confirm')}
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

export default PdaPutaway;
