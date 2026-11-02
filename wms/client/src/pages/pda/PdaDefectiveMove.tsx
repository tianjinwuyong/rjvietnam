import React, { useState, useEffect } from 'react';
import PdaLayout from './components/PdaLayout';
import PdaCard from './components/PdaCard';
import PdaButton from './components/PdaButton';
import ScanInput from './components/ScanInput';
import ResultOverlay from './components/ResultOverlay';
import { speakError, speakSuccess } from '../../utils/speech';
import axios from 'axios';
import { useI18n, tf } from '../../i18n';

interface DefectiveTask {
  id: string;
  moveNo?: string | null;
  mrbNo?: string | null;
  source?: string | null;
  reason?: string | null;
  materialCode: string;
  materialName: string;
  batchNo: string;
  quantity: number;
  unit: string;
  fromLocationCode: string;
  status: string;
}

interface ScannedBox {
  code: string;
  materialCode: string;
  batchNo: string;
  qty: number | null;
  unit: string;
}

/**
 * PDA 不良品调拨（扫码执行）。
 *
 * 单据来自 MRB 终审自动生成，或仓管员在 PC 端制单、仓库主管确认生效。
 * 执行顺序固定：
 *  1. 扫货物标签（可多箱，逐箱校验物料 + 批次是否属于本单）；
 *  2. 扫不良品仓库位码（精确匹配，不接受手选）；
 *  3. 提交，系统搬库并记录扫码凭据。
 */
const PdaDefectiveMove: React.FC = () => {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<DefectiveTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<DefectiveTask | null>(null);
  const [boxes, setBoxes] = useState<ScannedBox[]>([]);
  const [targetLocation, setTargetLocation] = useState<{ id: string; code: string } | null>(null);
  const [result, setResult] = useState({ visible: false, success: true, msg: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await axios.get('/api/defective-move/list', {
        params: { status: 'pending', page: 1, pageSize: 50 },
      });
      setTasks(res.data.items || []);
    } catch (err) {
      speakError();
      setResult({ visible: true, success: false, msg: t('ui.获取任务失败') });
    }
  };

  const handleSelectTask = (task: DefectiveTask) => {
    setSelectedTask(task);
    setBoxes([]);
    setTargetLocation(null);
  };

  /** 扫一箱：服务端校验物料 + 批次，错误由 ScanInput 统一弹窗播报 */
  const handleBoxScan = async (code: string) => {
    if (!selectedTask) return;
    if (boxes.some((b) => b.code === code)) {
      throw new Error(t('defectiveMove.duplicateScan'));
    }
    const res = await axios.post(`/api/defective-move/${selectedTask.id}/scan`, { code });
    const d = res.data;
    setBoxes((prev) => [
      ...prev,
      {
        code,
        materialCode: d.materialCode,
        batchNo: d.batchNo,
        qty: d.qty ?? null,
        unit: d.unit,
      },
    ]);
    speakSuccess();
  };

  const handleLocationScan = async (code: string) => {
    try {
      // 只认不良品仓的库位，且必须**精确命中**：
      // 用模糊查询会把「NG01-A-01-00-0001」误配到「...00010」，库位扫错等于把货搬到错的地方。
      const res = await axios.get('/api/defective-move/locations');
      const loc = (res.data || []).find((x: any) => x.locationCode === code.trim());
      if (!loc) {
        speakError(t('defectiveMove.locationNotInDefective'));
        setResult({
          visible: true,
          success: false,
          msg: t('defectiveMove.locationNotInDefective'),
        });
        return;
      }
      setTargetLocation({ id: loc.id, code: loc.locationCode });
      speakSuccess();
    } catch (err) {
      speakError();
      setResult({ visible: true, success: false, msg: t('ui.库位校验失败') });
    }
  };

  const handleComplete = async () => {
    if (!selectedTask) return;
    if (boxes.length === 0) {
      setResult({ visible: true, success: false, msg: t('defectiveMove.scanFirst') });
      return;
    }
    if (!targetLocation) {
      setResult({ visible: true, success: false, msg: t('defectiveMove.locationScanFirst') });
      return;
    }
    setLoading(true);
    try {
      await axios.post(`/api/defective-move/${selectedTask.id}/complete`, {
        scannedCodes: boxes.map((b) => b.code),
        toLocationCode: targetLocation.code,
      });
      setResult({ visible: true, success: true, msg: t('ui.移库完成') });
      setSelectedTask(null);
      setBoxes([]);
      setTargetLocation(null);
      fetchTasks();
    } catch (err: any) {
      speakError();
      setResult({
        visible: true,
        success: false,
        msg:
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          t('ui.移库失败'),
      });
    } finally {
      setLoading(false);
    }
  };

  const totalScanned = boxes.reduce((s, b) => s + Number(b.qty || 0), 0);

  return (
    <PdaLayout title={t('ui.不良品调拨')}>
      {!selectedTask ? (
        <PdaCard title={t('defectiveMove.pdaPendingList')}>
          {tasks.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#999', padding: 20 }}>
              {t('ui.暂无待处理任务')}
            </p>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                onClick={() => handleSelectTask(task)}
                style={{
                  padding: 12,
                  marginBottom: 8,
                  border: '1px solid var(--pda-border)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  backgroundColor: 'var(--pda-surface)',
                }}
              >
                <p style={{ margin: 0, fontWeight: 'bold' }}>
                  {task.materialCode} · {task.batchNo || '-'}
                </p>
                <p style={{ margin: '4px 0', color: '#666' }}>{task.materialName}</p>
                <p style={{ margin: 0, fontSize: 12, color: '#999' }}>
                  {t('ui.数量:')} {task.quantity} {task.unit} · {t('ui.原库位:')}{' '}
                  {task.fromLocationCode}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#999' }}>
                  {t('defectiveMove.moveNo')}: {task.moveNo || '-'}
                  {task.mrbNo ? ` · ${task.mrbNo}` : ''}
                </p>
              </div>
            ))
          )}
        </PdaCard>
      ) : (
        <>
          <PdaCard title={t('ui.任务详情')}>
            <p>
              <strong>{t('defectiveMove.moveNo')}：</strong>
              {selectedTask.moveNo || '-'}
            </p>
            <p>
              <strong>{t('ui.物料：')}</strong>
              {selectedTask.materialCode} - {selectedTask.materialName}
            </p>
            <p>
              <strong>{t('ui.批次：')}</strong>
              {selectedTask.batchNo || '-'}
            </p>
            <p>
              <strong>{t('ui.数量：')}</strong>
              {selectedTask.quantity} {selectedTask.unit}
            </p>
            <p>
              <strong>{t('ui.原库位：')}</strong>
              {selectedTask.fromLocationCode}
            </p>
          </PdaCard>

          <PdaCard title={t('defectiveMove.pdaStep1')}>
            <ScanInput
              placeholder={t('defectiveMove.scanCodePlaceholder')}
              onScan={handleBoxScan}
              autoFocus
            />
            {boxes.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {boxes.map((b, i) => (
                  <div
                    key={b.code}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom: '1px solid var(--pda-surface-2)',
                      fontSize: 13,
                    }}
                  >
                    <span>
                      {i + 1}. {b.materialCode} / {b.batchNo || '-'}
                    </span>
                    <span>{b.qty == null ? '' : `${b.qty} ${b.unit}`}</span>
                  </div>
                ))}
                <p style={{ marginTop: 8, fontSize: 13, color: 'var(--pda-primary)' }}>
                  {tf('defectiveMove.pdaScannedSummary', {
                    n: boxes.length,
                    qty: totalScanned,
                    unit: selectedTask.unit || '',
                  })}
                </p>
              </div>
            )}
          </PdaCard>

          <PdaCard title={t('defectiveMove.pdaStep2')}>
            <ScanInput
              placeholder={t('defectiveMove.scanLocationPlaceholder')}
              onScan={handleLocationScan}
              disabled={boxes.length === 0}
              autoFocus={boxes.length === 0}
            />
            {targetLocation && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  backgroundColor: 'var(--pda-primary-soft)',
                  borderRadius: 8,
                }}
              >
                <p style={{ margin: 0, color: 'var(--pda-primary)' }}>
                  {t('ui.目标库位：')}
                  {targetLocation.code}
                </p>
              </div>
            )}
          </PdaCard>

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <PdaButton
              variant="ghost"
              onClick={() => {
                setSelectedTask(null);
                setBoxes([]);
                setTargetLocation(null);
              }}
            >
              {t('common.back')}
            </PdaButton>
            <PdaButton
              variant="primary"
              disabled={!targetLocation || boxes.length === 0 || loading}
              onClick={handleComplete}
            >
              {t('pda.transfer.confirm')}
            </PdaButton>
          </div>
        </>
      )}

      <ResultOverlay
        visible={result.visible}
        success={result.success}
        message={result.msg}
        onClose={() => setResult({ ...result, visible: false })}
      />
    </PdaLayout>
  );
};

export default PdaDefectiveMove;
