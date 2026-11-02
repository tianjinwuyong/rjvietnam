import React, { useState, useEffect } from 'react';
import { useI18n, tf } from '../../i18n';
import PdaLayout from './components/PdaLayout';
import ScanInput from './components/ScanInput';
import PdaCard from './components/PdaCard';
import PdaButton from './components/PdaButton';
import StatusBadge from './components/StatusBadge';
import ResultOverlay from './components/ResultOverlay';
import { queryInventory } from '../../api/pda';
import { getAllLocations } from '../../api/warehouse';
import {
  getStockTakeList,
  getStockTakeDetail,
  getStockTakeItems,
  adjustStockTakeItem,
  submitStockTake,
  scanStockTakeLabel,
  type StockTakeOrder,
  type StockTakeItem,
} from '../../api/stockTake';
import { useAuth } from '../../auth/AuthContext';
import { errMsg, parseQr } from './utils';
import { speakError, speakSuccess } from '../../utils/speech';
import type { Inventory, WarehouseLocation } from '@shared/api.interface';

interface CountLine {
  item: StockTakeItem;
  actualQty: number;
  remark: string;
}

/** 可执行盘点的岗位（与后端 OPERATE_ROLES 保持一致） */
const OPERATE_ROLES = ['admin', 'wh_keeper', 'wh_manager'];

/** P6: 库存查询 / 盘点登记（按盘点单执行） */
const PdaInventory: React.FC = () => {
  const { t } = useI18n();
  const { role } = useAuth();
  const canOperate = OPERATE_ROLES.includes(String(role?.roleCode || ''));
  const [tab, setTab] = useState<'query' | 'count'>('query');

  // 查询
  const [qMat, setQMat] = useState('');
  const [qList, setQList] = useState<Inventory[]>([]);
  const [qSearched, setQSearched] = useState(false);

  // 盘点：盘点单 → 库位 → 明细
  const [orders, setOrders] = useState<StockTakeOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [take, setTake] = useState<StockTakeOrder | null>(null);
  const [cLoc, setCLoc] = useState('');
  const [cLines, setCLines] = useState<CountLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState({ visible: false, success: true, msg: '' });
  /** 最近一次扫物料标签的结果（原位展示，便于连续扫码时逐箱核对） */
  const [lastScan, setLastScan] = useState<{ ok: boolean; msg: string; detail?: string } | null>(null);
  /**
   * 本次有改动（扫过码或手工改过数）的明细行。
   * 实盘数默认 0，若保存时把所有行都写回，没扫到的行会被当成 0 → 整库位假盘亏。
   */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [allLocations, setAllLocations] = useState<WarehouseLocation[]>([]);
  const [locSearch, setLocSearch] = useState('');

  // 加载全部启用库位，供手动选择（不强制扫码）
  useEffect(() => {
    getAllLocations().then((list) => setAllLocations(list || [])).catch(() => {});
  }, []);

  const loadTakeOrders = async () => {
    setOrdersLoading(true);
    try {
      const res = await getStockTakeList({ page: 1, pageSize: 50, status: 'draft' });
      // 主盘点单只是容器，没有明细，PDA 只列可实际盘点的单张 / 子盘点单
      setOrders((res.items || []).filter((o) => o.orderType !== 'main'));
    } catch (e: any) {
      const msg = errMsg(e, t('pda.inventory.loadTakeFailed'));
      setResult({ visible: true, success: false, msg });
    } finally {
      setOrdersLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'count') loadTakeOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const selectTake = async (order: StockTakeOrder) => {
    setTake(order);
    setCLoc('');
    setCLines([]);
    setLocSearch('');
    try {
      const fresh = await getStockTakeDetail(order.id);
      setTake(fresh);
    } catch {
      // 详情拉不到不影响先展示列表里的单据信息
    }
  };

  const backToOrders = () => {
    setTake(null);
    setCLoc('');
    setCLines([]);
    setLocSearch('');
    loadTakeOrders();
  };

  const filteredLocs = (locSearch.trim()
    ? allLocations.filter((l) => l.locationCode.toLowerCase().includes(locSearch.trim().toLowerCase()))
    : allLocations
  ).filter((l) => !take?.warehouseId || l.warehouseId === take.warehouseId);

  const pickLocation = (code: string) => {
    setLocSearch('');
    scanCountLocation(code);
  };

  const searchInventory = async (code: string) => {
    const parsed = parseQr(code);
    const mc = parsed?.materialCode || code.split('|')[1] || code;
    setQMat(mc.trim());
    try {
      const res = await queryInventory({ materialCode: mc.trim() });
      setQList(res.items || []);
      setQSearched(true);
      speakSuccess();
    } catch (e: any) {
      setQList([]);
      setQSearched(true);
      const msg = errMsg(e, t('pda.inventory.queryFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    }
  };

  /** 扫描库位：加载该盘点单在该库位下的待盘明细 */
  const scanCountLocation = async (code: string) => {
    if (!take) {
      setResult({ visible: true, success: false, msg: t('pda.inventory.selectTakeFirst') });
      return;
    }
    setCLoc(code);
    try {
      const res = await getStockTakeItems(take.id, { locationCode: code, page: 1, pageSize: 500 });
      const rows = res.items || [];
      setTouched(new Set());
      setCLines(
        rows.map((it) => ({
          item: it,
          // 已盘过的行带出已保存的实盘数；未盘的行从 0 开始，由扫码逐箱累加。
          // 若预填账面数，再扫码就会「账面 + 实扫」重复计数，盘出假盘盈。
          actualQty: it.checked ? Number(it.actualQty) : 0,
          remark: it.remark || '',
        })),
      );
      if (rows.length === 0) {
        speakError(t('pda.inventory.noTakeItems'));
        setResult({ visible: true, success: false, msg: t('pda.inventory.noTakeItems') });
      } else {
        speakSuccess();
      }
    } catch (e: any) {
      setCLines([]);
      const msg = errMsg(e, t('pda.inventory.loadItemsFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    }
  };

  const setActual = (id: string, qty: number) => {
    setTouched((t) => new Set(t).add(id));
    setCLines((ls) => ls.map((l) => (l.item.id === id ? { ...l, actualQty: Math.max(0, qty) } : l)));
  };

  const setReason = (id: string, remark: string) =>
    setCLines((ls) => ls.map((l) => (l.item.id === id ? { ...l, remark } : l)));

  /** 全部账实相符：把当前库位所有行实盘数置为账面数 */
  const markAllMatch = () => {
    setTouched(new Set(cLines.map((l) => l.item.id)));
    setCLines((ls) => ls.map((l) => ({ ...l, actualQty: Number(l.item.bookQty), remark: '' })));
  };

  /**
   * 扫描物料标签（PDA 盘点主路径）。
   * 服务端按「料号 + 批次」匹配盘点单明细并累加实盘数，扫错料 / 扫错库位当场拒绝，
   * 不再像以前那样扫完库位码就默认「全部账实相符」。
   */
  const scanLabel = async (code: string) => {
    if (!take) {
      setResult({ visible: true, success: false, msg: t('pda.inventory.selectTakeFirst') });
      return;
    }
    const raw = (code || '').trim();
    if (!raw) return;
    // 现场标签有两种分隔符（* 与 |），后端六段码按 * 解析，这里统一
    const normalized = raw.split('|').length >= 6 ? raw.replace(/\|/g, '*') : raw;
    try {
      const res = await scanStockTakeLabel(take.id, normalized, cLoc || undefined);
      if (!res.success) {
        const msg = res.errorMessage || t('pda.inventory.scanFailed');
        setLastScan({ ok: false, msg });
        speakError(msg);
        setResult({ visible: true, success: false, msg });
        return;
      }
      const item = res.item;
      setLastScan({
        ok: true,
        msg: res.message || t('pda.inventory.scanSuccess'),
        detail: item
          ? `${item.materialCode} / ${item.batchNo || '-'} · ${t('pda.inventory.bookQty')} ${item.bookQty} → ${item.actualQty}`
          : undefined,
      });
      speakSuccess();
      if (item?.id) setTouched((t) => new Set(t).add(item.id));
      const fresh = await getStockTakeDetail(take.id);
      setTake(fresh);
      // 扫码后自动落到该箱库位并刷新明细，实盘数直接反映累加结果
      if (item?.locationCode) {
        await scanCountLocation(item.locationCode);
      } else if (cLoc) {
        await scanCountLocation(cLoc);
      }
    } catch (e: any) {
      const msg = errMsg(e, t('pda.inventory.scanFailed'));
      setLastScan({ ok: false, msg });
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    }
  };

  /** 保存当前库位的盘点结果（逐行写回盘点单明细） */
  const saveCounts = async (silent = false): Promise<boolean> => {
    if (!take || cLines.length === 0) return true;
    const dirty = cLines.filter((l) => touched.has(l.item.id));
    if (dirty.length === 0) {
      if (!silent) setResult({ visible: true, success: false, msg: t('pda.inventory.nothingToSave') });
      return true;
    }
    setSubmitting(true);
    try {
      for (const l of dirty) {
        await adjustStockTakeItem(take.id, l.item.id, l.actualQty, l.remark || undefined);
      }
      const fresh = await getStockTakeDetail(take.id);
      setTake(fresh);
      if (!silent) {
        setResult({ visible: true, success: true, msg: t('pda.inventory.saveSuccess') });
        // 重新按库位拉取，刷新已盘标记与差异
        await scanCountLocation(cLoc);
      }
      return true;
    } catch (e: any) {
      const msg = errMsg(e, t('pda.inventory.saveFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  /** 保存并提交仓库主管审批 */
  const submitCount = async () => {
    if (!take) return;
    if (!window.confirm(t('pda.inventory.submitConfirm'))) return;
    setSubmitting(true);
    try {
      // 先落盘当前库位中扫过 / 改过的行，未动的行不写回（否则会被当成 0）
      for (const l of cLines.filter((x) => touched.has(x.item.id))) {
        await adjustStockTakeItem(take.id, l.item.id, l.actualQty, l.remark || undefined);
      }
      const order = await submitStockTake(take.id);
      setTake(order);
      setCLines([]);
      setCLoc('');
      setResult({ visible: true, success: true, msg: t('pda.inventory.submitTakeSuccess') });
      speakSuccess();
      loadTakeOrders();
    } catch (e: any) {
      const msg = errMsg(e, t('pda.inventory.submitTakeFailed'));
      speakError(msg);
      setResult({ visible: true, success: false, msg });
    } finally {
      setSubmitting(false);
    }
  };

  const takeStatusText = (status: string) => {
    if (status === 'draft') return t('pda.inventory.takeStatusDraft');
    if (status === 'pending_approval') return t('pda.inventory.takeStatusPending');
    if (status === 'approved') return t('pda.inventory.takeStatusApproved');
    if (status === 'rejected') return t('pda.inventory.takeStatusRejected');
    return status;
  };

  return (
    <PdaLayout title={t('pda.menu.inventory')}>
      <div className="pda-tabs">
        <button type="button" className={`pda-tab ${tab === 'query' ? 'active' : ''}`} onClick={() => setTab('query')}>
          {t('pda.inventory.tabQuery')}
        </button>
        <button type="button" className={`pda-tab ${tab === 'count' ? 'active' : ''}`} onClick={() => setTab('count')}>
          {t('pda.inventory.tabCount')}
        </button>
      </div>

      {tab === 'query' && (
        <>
          <PdaCard>
            <ScanInput placeholder={t('pda.inventory.scanPh')} onScan={searchInventory} />
          </PdaCard>
          <PdaCard title={`${t('pda.inventory.result')} (${qList.length})`}>
            {!qSearched ? (
              <div className="pda-empty">{t('pda.inventory.hint')}</div>
            ) : qList.length === 0 ? (
              <div className="pda-empty">{t('pda.inventory.empty')}</div>
            ) : (
              <div className="pda-list">
                {qList.map((r) => (
                  <div key={r.id} className="pda-list-item">
                    <div className="pda-list-main">
                      <div className="pda-list-title">{r.materialCode}</div>
                      <div className="pda-list-sub">{r.materialName}</div>
                      <div className="pda-list-sub">{t('pda.inventory.location')}: {r.locationCode} · {t('pda.inventory.batch')}: {r.batchNo || '-'}</div>
                      {r.locked && <div className="pda-list-sub" style={{ color: 'var(--pda-danger)' }}>{t('pda.inventory.locked')}</div>}
                    </div>
                    <div className="pda-list-side">
                      <b>{r.quantity} {r.unit}</b>
                      <StatusBadge status={r.stockStatus} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </PdaCard>
        </>
      )}

      {tab === 'count' && !take && (
        <PdaCard title={`${t('pda.inventory.takeOrders')} (${orders.length})`}>
          {ordersLoading ? (
            <div className="pda-empty">{t('pda.loading')}</div>
          ) : orders.length === 0 ? (
            <div className="pda-empty">{t('pda.inventory.noTakeOrders')}</div>
          ) : (
            <div className="pda-list">
              {orders.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="pda-list-item"
                  style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none' }}
                  onClick={() => selectTake(o)}
                >
                  <div className="pda-list-main">
                    <div className="pda-list-title">{o.takeNo}</div>
                    <div className="pda-list-sub">
                      {o.warehouseName || '-'} · {o.periodMonth}
                    </div>
                    <div className="pda-list-sub">
                      {takeStatusText(o.status)} · {tf('pda.inventory.takeProgress', {
                        checked: o.checkedLines ?? 0,
                        total: o.totalLines ?? 0,
                      })}
                    </div>
                  </div>
                  <div className="pda-list-side">
                    <span style={{ color: 'var(--pda-primary)', fontSize: 13 }}>{t('pda.inventory.selectTake')} ›</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div style={{ height: 12 }} />
          <PdaButton fullWidth variant="ghost" disabled={ordersLoading} onClick={loadTakeOrders}>
            {t('common.refresh')}
          </PdaButton>
        </PdaCard>
      )}

      {tab === 'count' && take && (
        <>
          <PdaCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{take.takeNo}</div>
                <div className="pda-list-sub">{take.warehouseName || '-'} · {take.periodMonth}</div>
                <div className="pda-list-sub">
                  {takeStatusText(take.status)} · {tf('pda.inventory.takeProgress', {
                    checked: take.checkedLines ?? 0,
                    total: take.totalLines ?? 0,
                  })}
                </div>
              </div>
              <button type="button" className="pda-link-btn" onClick={backToOrders}>
                {t('pda.inventory.changeTake')}
              </button>
            </div>
          </PdaCard>

          {canOperate && (
            <PdaCard title={t('pda.inventory.scanLabel')}>
              <ScanInput placeholder={t('pda.inventory.scanLabelPh')} onScan={scanLabel} />
              {lastScan && (
                <div
                  style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    fontSize: 13,
                    background: lastScan.ok ? 'var(--pda-success-soft)' : 'var(--pda-danger-soft)',
                    color: lastScan.ok ? 'var(--pda-success-ink)' : 'var(--pda-danger-ink)',
                    border: `1px solid ${lastScan.ok ? 'var(--pda-success-border)' : 'var(--pda-danger-border)'}`,
                  }}
                >
                  <div>{lastScan.msg}</div>
                  {lastScan.detail && <div style={{ fontSize: 12, marginTop: 2 }}>{lastScan.detail}</div>}
                </div>
              )}
              <div className="pda-list-sub" style={{ marginTop: 8 }}>
                {t('pda.inventory.scanLabelHint')}
              </div>
            </PdaCard>
          )}

          {!canOperate ? (
            <PdaCard>
              <div className="pda-empty">{t('pda.inventory.noOperatePermission')}</div>
            </PdaCard>
          ) : (
            <PdaCard>
              {cLoc ? (
                <div className="pda-ok-box">{t('pda.inventory.location')}: {cLoc} ({cLines.length})</div>
              ) : (
                <>
                  <ScanInput placeholder={t('pda.inventory.scanLocPh')} onScan={scanCountLocation} />
                  {/* 手动选择库位：不强制扫码，可输入库位码搜索后点选（只显示本盘点单所属仓库） */}
                  <div style={{ marginTop: 10 }}>
                    <input
                      className="pda-input"
                      style={{ height: 44 }}
                      placeholder={t('pda.inventory.manualLocPh') || '或手动输入库位码搜索'}
                      value={locSearch}
                      onChange={(e) => setLocSearch(e.target.value)}
                    />
                    {locSearch.trim() && (
                      <div className="pda-list" style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                        {filteredLocs.length === 0 ? (
                          <div className="pda-empty">{t('ui.无匹配库位')}</div>
                        ) : (
                          filteredLocs.slice(0, 20).map((l) => (
                            <button
                              key={l.id}
                              type="button"
                              className="pda-list-item"
                              style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none' }}
                              onClick={() => pickLocation(l.locationCode)}
                            >
                              <div className="pda-list-main">
                                <div className="pda-list-title">{l.locationCode}</div>
                                <div className="pda-list-sub">{l.warehouseName || ''}</div>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
              {cLoc && (
                <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                  <button type="button" className="pda-link-btn" onClick={() => { setCLoc(''); setCLines([]); }}>
                    {t('pda.inventory.changeLoc')}
                  </button>
                  {cLines.length > 0 && (
                    <button type="button" className="pda-link-btn" onClick={markAllMatch}>
                      {t('pda.inventory.allMatch')}
                    </button>
                  )}
                </div>
              )}
            </PdaCard>
          )}

          {canOperate && cLines.length > 0 && (
            <PdaCard title={t('pda.inventory.countList')}>
              <div className="pda-list">
                {cLines.map((l) => {
                  const diff = l.actualQty - Number(l.item.bookQty);
                  return (
                    <div key={l.item.id} className="pda-list-item">
                      <div className="pda-list-main">
                        <div className="pda-list-title">{l.item.materialCode}</div>
                        <div className="pda-list-sub">{l.item.materialName} · {l.item.batchNo || '-'}</div>
                        <div className="pda-list-sub">{t('pda.inventory.bookQty')}: {l.item.bookQty} {l.item.unit}</div>
                        {diff !== 0 && (
                          <input
                            className="pda-input"
                            style={{ marginTop: 6, height: 40 }}
                            placeholder={t('pda.inventory.reasonPh')}
                            value={l.remark}
                            onChange={(e) => setReason(l.item.id, e.target.value)}
                          />
                        )}
                      </div>
                      <div className="pda-list-side">
                        <input
                          className="pda-qty-input"
                          type="number"
                          min={0}
                          value={l.actualQty}
                          onChange={(e) => setActual(l.item.id, Number(e.target.value))}
                        />
                        {diff !== 0 && (
                          <span style={{ color: diff > 0 ? 'var(--pda-success)' : 'var(--pda-danger)', fontSize: 12 }}>
                            {diff > 0 ? '+' : ''}{diff}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ height: 12 }} />
              <PdaButton fullWidth variant="primary" disabled={submitting} onClick={() => saveCounts(false)}>
                {submitting ? t('pda.submitting') : t('pda.inventory.saveCount')}
              </PdaButton>
              <div style={{ height: 10 }} />
              <PdaButton fullWidth variant="success" disabled={submitting} onClick={submitCount}>
                {submitting ? t('pda.submitting') : t('pda.inventory.submitTake')}
              </PdaButton>
            </PdaCard>
          )}

          {canOperate && cLoc && cLines.length === 0 && (
            <PdaCard>
              <div className="pda-empty">{t('pda.inventory.noTakeItems')}</div>
            </PdaCard>
          )}
        </>
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

export default PdaInventory;
