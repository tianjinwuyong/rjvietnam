import React, { useState } from 'react';
import { useI18n, tf } from '../../i18n';
import PdaLayout from './components/PdaLayout';
import PdaCard from './components/PdaCard';
import PdaButton from './components/PdaButton';
import ScanInput from './components/ScanInput';
import ResultOverlay from './components/ResultOverlay';
import { listPickingReels, returnReel, type PickingReelRow } from '../../api/workorder';
import { errMsg } from './utils';
import { speakError, speakSuccess } from '../../utils/speech';

/** P9: SMT 余料退回（扫盘号退回；无码时按物料退回并生成新标签） */
const PdaReelReturn: React.FC = () => {
  const { t } = useI18n();
  const [reel, setReel] = useState<PickingReelRow | null>(null);
  const [qty, setQty] = useState('');
  const [loc, setLoc] = useState('');
  const [manual, setManual] = useState(false);
  const [mCode, setMCode] = useState('');
  const [mBatch, setMBatch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState({ visible: false, success: true, msg: '' });

  const scan = async (code: string) => {
    const no = code.trim();
    if (!no) return;
    setManual(false);
    try {
      const rows = await listPickingReels({ reelNo: no });
      const hit = (rows || []).find((r) => r.reelNo === no && r.status !== 'closed') || (rows || [])[0];
      if (!hit) {
        speakError(t('pda.reel.notFound'));
        setResult({ visible: true, success: false, msg: t('pda.reel.notFound') });
        return;
      }
      setReel(hit);
      setQty(String(Math.max(0, hit.issuedQty - hit.returnedQty)));
      setLoc('');
      speakSuccess();
    } catch (e: any) {
      const msg = errMsg(e, t('pda.reel.loadFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    }
  };

  const submit = async () => {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setResult({ visible: true, success: false, msg: t('pda.reel.qtyInvalid') });
      return;
    }
    setSubmitting(true);
    try {
      await returnReel({
        reelNo: manual ? undefined : reel?.reelNo,
        materialCode: manual ? mCode.trim() : undefined,
        batchNo: manual ? mBatch.trim() : undefined,
        quantity: n,
        locationCode: loc.trim() || undefined,
      });
      setResult({ visible: true, success: true, msg: t('pda.reel.success') });
      speakSuccess();
      setReel(null);
      setQty('');
      setMCode('');
      setMBatch('');
    } catch (e: any) {
      const msg = errMsg(e, t('pda.reel.failed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PdaLayout title={t('pda.reel.title')}>
      <PdaCard>
        <ScanInput placeholder={t('pda.reel.scanPh')} onScan={scan} />
        <div style={{ height: 8 }} />
        <button type="button" className="pda-link-btn" onClick={() => { setManual((v) => !v); setReel(null); }}>
          {manual ? t('pda.reel.backToScan') : t('pda.reel.manual')}
        </button>
      </PdaCard>

      {!manual && reel && (
        <PdaCard title={t('pda.reel.reelInfo')}>
          <div className="pda-desc-grid">
            <span>{t('pda.reel.reelNo')}</span><b>{reel.reelNo}</b>
            <span>{t('pda.reel.material')}</span><b>{reel.materialCode}</b>
            <span>{t('pda.reel.batch')}</span><b>{reel.batchNo || '-'}</b>
            <span>{t('pda.reel.issued')}</span><b>{reel.issuedQty}</b>
            <span>{t('pda.reel.returned')}</span><b>{reel.returnedQty}</b>
            <span>{t('pda.reel.canReturn')}</span><b>{Math.max(0, reel.issuedQty - reel.returnedQty)}</b>
          </div>
        </PdaCard>
      )}

      {manual && (
        <PdaCard title={t('pda.reel.manual')}>
          <input className="pda-input" style={{ height: 44, marginBottom: 8 }} placeholder={t('pda.reel.materialCode')}
            value={mCode} onChange={(e) => setMCode(e.target.value)} />
          <input className="pda-input" style={{ height: 44 }} placeholder={t('pda.reel.batch')}
            value={mBatch} onChange={(e) => setMBatch(e.target.value)} />
        </PdaCard>
      )}

      {(reel || manual) && (
        <PdaCard title={t('pda.reel.returnForm')}>
          <input className="pda-input" style={{ height: 44, marginBottom: 8 }} type="number"
            placeholder={t('pda.reel.qtyPh')} value={qty} onChange={(e) => setQty(e.target.value)} />
          <input className="pda-input" style={{ height: 44, marginBottom: 10 }}
            placeholder={t('pda.reel.locPh')} value={loc} onChange={(e) => setLoc(e.target.value)} />
          <PdaButton fullWidth variant="success" disabled={submitting} onClick={submit}>
            {submitting ? t('pda.submitting') : t('pda.reel.submit')}
          </PdaButton>
        </PdaCard>
      )}

      <ResultOverlay visible={result.visible} success={result.success} message={result.msg}
        onClose={() => setResult((r) => ({ ...r, visible: false }))} />
    </PdaLayout>
  );
};

export default PdaReelReturn;
