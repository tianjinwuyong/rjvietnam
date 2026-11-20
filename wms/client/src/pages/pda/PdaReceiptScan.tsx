import React, { useEffect, useRef, useState } from 'react';
import { Trash2, MapPin, Warehouse as WhIcon, Package } from 'lucide-react';
import { useI18n, tf } from '../../i18n';
import PdaLayout from './components/PdaLayout';
import ScanInput, { type ScanInputRef } from './components/ScanInput';
import PdaCard from './components/PdaCard';
import PdaButton from './components/PdaButton';
import ResultOverlay from './components/ResultOverlay';
import {
  getActiveWarehouses,
  verifyLocationCode,
  verifyQr,
  batchReceipt,
  type VerifyQrResult,
} from '../../api/pda';
import { errMsg } from './utils';
import { speakError, speakSuccess } from '../../utils/speech';
import type { Warehouse, WarehouseLocation } from '@shared/api.interface';

interface PendingItem {
  key: string;
  qrContent: string;
  materialCode: string;
  materialName?: string;
  supplierCode: string;
  batchNo: string;
  serialNo: string;
  quantity: number;
}

/** P2: 扫码收货 */
const PdaReceiptScan: React.FC = () => {
  const { t, lang } = useI18n();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [whId, setWhId] = useState('');
  const [locationInfo, setLocationInfo] = useState<WarehouseLocation | null>(null);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ visible: boolean; success: boolean; msg: string }>({
    visible: false,
    success: true,
    msg: '',
  });
  const materialScanRef = useRef<ScanInputRef>(null);
  const [autoReopenCamera, setAutoReopenCamera] = useState(false);

  useEffect(() => {
    getActiveWarehouses()
      .then((list) => {
        setWarehouses(list || []);
        if (list && list.length === 1) setWhId(list[0].id);
      })
      .catch(() => {});
  }, []);

  const whName = (wh: Warehouse) =>
    lang === 'vi' ? wh.whNameVi || wh.whNameZh : lang === 'en' ? wh.whNameEn || wh.whNameZh : wh.whNameZh;

  const handleLocationScan = async (code: string) => {
    if (!whId) {
      speakError();
      setResult({ visible: true, success: false, msg: t('pda.receipt.selectWarehouseFirst') });
      return;
    }
    try {
      const loc = await verifyLocationCode({ locationCode: code, warehouseId: whId });
      setLocationInfo(loc);
      setPending([]);
    } catch (e: any) {
      setLocationInfo(null);
      speakError();
      setResult({ visible: true, success: false, msg: errMsg(e, t('pda.receipt.locationInvalid')) });
    }
  };

  const handleQrScan = async (code: string) => {
    if (!locationInfo) {
      setResult({ visible: true, success: false, msg: t('pda.receipt.scanLocationFirst') });
      return;
    }
    try {
      const res: VerifyQrResult = await verifyQr(code);
      if (!res.valid) {
        // 根据错误码精准语音提示
        if (res.errorCode === 'invalid_supplier' || res.errorCode === 'unqualified_supplier') {
          speakError(t('ui.非合格供应商'));
        } else if (res.errorCode === 'unregistered_material') {
          speakError(t('ui.非认可物料'));
        } else if (res.errorCode === 'duplicate_serial') {
          speakError(t('ui.虫码'));
        }
        setAutoReopenCamera(true);
        const failMsg = res.errorMessage || t('pda.receipt.scanFailed');
        speakError(failMsg);
        setResult({ visible: true, success: false, msg: failMsg });
        return;
      }
      const dup = pending.find((p) => p.serialNo === res.serialNo && p.batchNo === res.batchNo);
      if (dup) {
        speakError(t('ui.虫码'));
        setAutoReopenCamera(true);
        setResult({ visible: true, success: false, msg: t('pda.receipt.duplicate') });
        return;
      }
      setPending((prev) => [
        ...prev,
        {
          key: `${res.serialNo}-${Date.now()}`,
          qrContent: code,
          materialCode: res.materialCode,
          materialName: res.materialName,
          supplierCode: res.supplierCode,
          batchNo: res.batchNo,
          serialNo: res.serialNo,
          quantity: res.quantity,
        },
      ]);
      speakSuccess();
      // 扫码成功后自动拉起摄像头，继续扫下一箱
      setTimeout(() => materialScanRef.current?.openCamera(), 400);
    } catch (e: any) {
      const msg = errMsg(e, t('pda.receipt.scanFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    }
  };

  const removeItem = (key: string) => {
    const target = pending.find((p) => p.key === key);
    const msg = target
      ? tf('ui.确认删除已扫条目 {code}（批次{batch}）？', { code: target.materialCode, batch: target.batchNo || '-' })
      : t('ui.确认删除该条目？');
    if (window.confirm(msg)) {
      setPending((p) => p.filter((x) => x.key !== key));
    }
  };

  const setQty = (key: string, qty: number) =>
    setPending((prev) => prev.map((p) => (p.key === key ? { ...p, quantity: Math.max(1, qty) } : p)));

  const submit = async () => {
    if (!locationInfo || pending.length === 0) return;
    setSubmitting(true);
    try {
      await batchReceipt({
        items: pending.map((p) => ({ qrContent: p.qrContent, quantity: p.quantity })),
        locationId: locationInfo.id,
      });
      setAutoReopenCamera(false);
      setResult({ visible: true, success: true, msg: t('pda.receipt.success') });
      setPending([]);
    } catch (e: any) {
      const msg = errMsg(e, t('pda.receipt.submitFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    } finally {
      setSubmitting(false);
    }
  };

  const totalQty = pending.reduce((s, p) => s + p.quantity, 0);

  return (
    <PdaLayout title={t('pda.menu.receiptScan')}>
      <PdaCard>
        <div className="pda-field">
          <label className="pda-label">
            <WhIcon size={16} style={{ marginRight: 6 }} />
            {t('pda.receipt.warehouse')}
          </label>
          <select
            className="pda-input"
            value={whId}
            onChange={(e) => {
              setWhId(e.target.value);
              setLocationInfo(null);
              setPending([]);
            }}
          >
            <option value="">{t('pda.receipt.pleaseSelectWh')}</option>
            {warehouses.map((wh) => (
              <option key={wh.id} value={wh.id}>
                {whName(wh)}（{wh.whCode}）
              </option>
            ))}
          </select>
        </div>

        <div className="pda-field">
          <label className="pda-label">
            <MapPin size={16} style={{ marginRight: 6 }} />
            {t('pda.receipt.location')}
          </label>
          {locationInfo ? (
            <div className="pda-ok-box">
              {t('pda.receipt.locationOk')}: {locationInfo.locationCode}
            </div>
          ) : (
            <ScanInput
              placeholder={t('pda.receipt.scanLocationPh')}
              onScan={handleLocationScan}
              disabled={!whId}
            />
          )}
          {locationInfo && (
            <button
              type="button"
              className="pda-link-btn"
              onClick={() => {
                setLocationInfo(null);
                setPending([]);
              }}
            >
              {t('pda.receipt.changeLocation')}
            </button>
          )}
        </div>

        <div className="pda-field">
          <label className="pda-label">
            <Package size={16} style={{ marginRight: 6 }} />
            {t('pda.receipt.scanMaterial')}
          </label>
          <ScanInput
            ref={materialScanRef}
            placeholder={t('pda.receipt.scanMaterialPh')}
            onScan={handleQrScan}
            disabled={!locationInfo}
          />
        </div>
      </PdaCard>

      <PdaCard
        title={`${t('pda.receipt.scannedList')} (${pending.length} / ${totalQty})`}
      >
        {pending.length === 0 ? (
          <div className="pda-empty">{t('pda.receipt.empty')}</div>
        ) : (
          <div className="pda-list">
            {pending.map((p, i) => (
              <div key={p.key} className="pda-list-item">
                <div className="pda-list-main">
                  <div className="pda-list-title">
                    {i + 1}. {p.materialCode}
                  </div>
                  <div className="pda-list-sub">{p.materialName || p.supplierCode}</div>
                  <div className="pda-list-sub">{t('pda.receipt.batch')}: {p.batchNo || '-'}</div>
                </div>
                <div className="pda-list-side">
                  <input
                    className="pda-qty-input"
                    type="number"
                    min={1}
                    value={p.quantity}
                    onChange={(e) => setQty(p.key, Number(e.target.value))}
                  />
                  <button type="button" className="pda-icon-btn danger" onClick={() => removeItem(p.key)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ height: 12 }} />
        <PdaButton fullWidth variant="success" disabled={pending.length === 0 || submitting} onClick={submit}>
          {submitting ? t('pda.submitting') : `${t('pda.receipt.submit')} (${pending.length})`}
        </PdaButton>
      </PdaCard>

      <ResultOverlay
        visible={result.visible}
        success={result.success}
        message={result.msg}
        onClose={() => {
          setResult((r) => ({ ...r, visible: false }));
          // 扫码错误弹窗确认后，自动拉起摄像头继续扫下一箱
          if (autoReopenCamera) {
            setAutoReopenCamera(false);
            setTimeout(() => materialScanRef.current?.openCamera(), 300);
          }
        }}
      />
    </PdaLayout>
  );
};

export default PdaReceiptScan;
