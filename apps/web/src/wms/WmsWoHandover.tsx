import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, RefreshCw, Search, ShieldCheck, History } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

type PendingItem = {
  issueTxId: number;
  txNo: string;
  occurredAt: string;
  lotNo: string;
  materialCode: string;
  materialName: string;
  qty: number;
  uom: string;
  reservationId: number | null;
  operatorFrom: string | null;
};

type HistoryItem = {
  id: number;
  wo_code: string;
  issue_tx_id: number;
  lot_no: string;
  material_code: string;
  qty: number;
  uom: string;
  operator_from: string;
  operator_to: string;
  operator_to_ack_at: string;
  signature_hash: string;
  evidence_qr: string | null;
  notes: string | null;
};

const text = (zh: string, vi: string, en: string, locale: Locale) =>
  locale === "zh-CN" ? zh : locale === "vi-VN" ? vi : en;

function buildSignatureHash(woCode: string, items: PendingItem[], operatorTo: string, nonce: string) {
  const payload = [
    woCode,
    operatorTo,
    items.map(i => `${i.issueTxId}:${i.lotNo}:${i.qty}`).join("|"),
    nonce,
  ].join("||");
  let h1 = 0xdeadbeef ^ payload.length;
  let h2 = 0x41c6ce57 ^ payload.length;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  return ("SIG-" + h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + "-" + nonce).toUpperCase();
}

export function WmsWoHandover({ locale }: { locale: Locale }) {
  const [workOrder, setWorkOrder] = useState("");
  const [operatorTo, setOperatorTo] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const trimWo = workOrder.trim();

  const load = useCallback(async (wo: string) => {
    if (!wo) { setPending([]); setHistory([]); return; }
    setLoading(true);
    setFeedback(null);
    try {
      const [pendingRes, historyRes] = await Promise.all([
        apiClient.get<{ data: { items: PendingItem[] } }>(`/wms/work-orders/${encodeURIComponent(wo)}/handover-pending`),
        apiClient.get<{ data: { items: HistoryItem[] } }>(`/wms/work-orders/${encodeURIComponent(wo)}/handover-history`),
      ]);
      setPending(pendingRes.data?.items ?? []);
      setHistory(historyRes.data?.items ?? []);
      setSelected(prev => {
        const next: Record<number, boolean> = {};
        for (const it of pendingRes.data?.items ?? []) next[it.issueTxId] = prev[it.issueTxId] ?? true;
        return next;
      });
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : String(err) });
      setPending([]); setHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(trimWo), trimWo ? 350 : 0);
    return () => clearTimeout(t);
  }, [trimWo, load]);

  const selectedItems = useMemo(() => pending.filter(it => selected[it.issueTxId]), [pending, selected]);

  const submit = async () => {
    if (!trimWo) { setFeedback({ ok: false, msg: text("请先输入工单号", "Vui lòng nhập mã lệnh SX", "Enter a work order code first", locale) }); return; }
    if (!operatorTo.trim()) { setFeedback({ ok: false, msg: text("请填写领料人/线长工号", "Vui lòng nhập tài khoản nhân viên nhận", "Receiver operator required", locale) }); return; }
    if (selectedItems.length === 0) { setFeedback({ ok: false, msg: text("请勾选至少一条待交接物料", "Vui lòng chọn ít nhất 1 dòng", "Select at least one pending row", locale) }); return; }
    setSubmitting(true);
    setFeedback(null);
    const nonce = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).toUpperCase();
    const signatureHash = buildSignatureHash(trimWo, selectedItems, operatorTo.trim(), nonce);
    const evidenceQr = `WO-HANDOVER:${trimWo}:${signatureHash.slice(-12)}`;
    try {
      const res: any = await apiClient.post(`/wms/work-orders/${encodeURIComponent(trimWo)}/handover`, {
        operatorTo: operatorTo.trim(),
        signatureHash,
        evidenceQr,
        notes: notes.trim() || undefined,
        items: selectedItems.map(it => ({
          issueTxId: it.issueTxId,
          reservationId: it.reservationId ?? undefined,
        })),
      });
      const signed = res?.data?.signedCount ?? selectedItems.length;
      setFeedback({ ok: true, msg: text(`已签收 ${signed} 条 / Đã ký nhận ${signed} / Signed ${signed} items`, "", "", locale) });
      setNotes("");
      await load(trimWo);
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="screen-stack">
    <section className="surface-panel">
      <div className="section-header">
        <div>
          <h2>{text("工单物料交接 (仓库 → 产线)", "Bàn giao vật liệu lệnh SX (Kho → Chuyền)", "Work-order material handover (Warehouse → Line)")}</h2>
          <p>{text("工单已发料但尚未由产线签收的物料；填入领料人/线长工号，提交后写入 wms_wo_handover 审计表，不影响库存与交易。", "Vật liệu đã phát nhưng chưa ký nhận; nhập tài khoản nhân viên nhận, ký số xác nhận vào wms_wo_handover. Không thay đổi tồn kho.", "Material already issued but not yet acknowledged by the line; submit to write a signature row to wms_wo_handover. Inventory and transactions are not modified.")}</p>
        </div>
        <button className="action-button" type="button" title={t("common.refresh", locale)} onClick={() => void load(trimWo)} disabled={loading || !trimWo}><RefreshCw size={16} /> {t("common.refresh", locale)}</button>
      </div>
      <div className="scan-input" style={{ maxWidth: 360 }}><Search size={24} /><input value={workOrder} onChange={e => setWorkOrder(e.target.value.toUpperCase())} placeholder={text("工单号 (例如 26091010001)", "Mã lệnh SX", "Work-order code", locale)} title={text("扫描或输入工单号", "Quét hoặc nhập mã lệnh SX", "Scan or type work order", locale)} /></div>
    </section>

    <section className="surface-panel">
      <div className="section-header">
        <div>
          <h3 style={{ margin: 0 }}>{text("待交接物料", "Vật liệu chờ bàn giao", "Pending handover")} <span style={{ fontWeight: 400, fontSize: 12, color: "var(--muted)" }}>({pending.length})</span></h3>
          <p style={{ marginTop: 4, color: "var(--muted)", fontSize: 12 }}>{text("勾选要签收的物料行；列表来自已发料但 wms_wo_handover 还未签字的 inventory_transactions。", "Tick các dòng cần ký; danh sách từ inventory_transactions đã ISSUE_TO_LINE nhưng chưa có dòng trong wms_wo_handover.", "Tick rows to sign; list comes from posted ISSUE_TO_LINE transactions without a wms_wo_handover row yet.")}</p>
        </div>
      </div>
      <div className="table-shell"><table>
        <thead><tr>
          <th style={{ width: 40 }}><input type="checkbox" checked={pending.length > 0 && selectedItems.length === pending.length} onChange={e => {
            const next: Record<number, boolean> = {};
            for (const it of pending) next[it.issueTxId] = e.target.checked;
            setSelected(next);
          }} title={text("全选", "Chọn tất cả", "Select all", locale)} /></th>
          <th>{text("工单", "Lệnh SX", "WO")}</th>
          <th>{text("物料", "Vật liệu", "Material")}</th>
          <th>{text("批次", "Lô", "Lot")}</th>
          <th>{text("数量", "Số lượng", "Qty")}</th>
          <th>{text("发料人", "Người phát", "Issued by")}</th>
          <th>{text("发料时间", "Thời gian phát", "Issued at")}</th>
          <th>Issue Tx</th>
        </tr></thead>
        <tbody>
          {pending.map(it => <tr key={it.issueTxId}>
            <td><input type="checkbox" checked={!!selected[it.issueTxId]} onChange={e => setSelected(prev => ({ ...prev, [it.issueTxId]: e.target.checked }))} /></td>
            <td><code>{trimWo}</code></td>
            <td><strong>{it.materialCode}</strong><br /><small style={{ color: "var(--muted)" }}>{it.materialName}</small></td>
            <td><code>{it.lotNo}</code></td>
            <td>{Number(it.qty).toLocaleString()} {it.uom ?? ""}</td>
            <td>{it.operatorFrom ?? "—"}</td>
            <td>{it.occurredAt ? new Date(it.occurredAt).toLocaleString(locale) : "—"}</td>
            <td><code>{it.issueTxId}</code></td>
          </tr>)}
          {!loading && pending.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{trimWo ? text("该工单无待交接物料", "Không có vật liệu chờ bàn giao", "No pending handover", locale) : text("请输入工单号", "Vui lòng nhập mã lệnh SX", "Enter a work order code", locale)}</td></tr>}
        </tbody>
      </table></div>
    </section>

    <section className="surface-panel">
      <div className="section-header">
        <div>
          <h3 style={{ margin: 0 }}>{text("签收信息", "Thông tin ký nhận", "Sign-off")}</h3>
          <p style={{ marginTop: 4, color: "var(--muted)", fontSize: 12 }}>{text("线长/领料人扫码或输入工号；签名 = 工单+批次+数量+随机数的不可逆指纹；每次提交都不同。", "Trưởng ca quét mã hoặc nhập tài khoản; chữ ký là dấu vân tay bất khả nghịch của (lệnh + lô + SL + nonce); mỗi lần nộp đều khác nhau.", "Line lead scans or types operator; signature is an irreversible fingerprint of WO + lots + qty + nonce; every submit produces a fresh hash.")}</p>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12, maxWidth: 720 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{text("领料人/线长工号", "Tài khoản nhận", "Receiver operator", locale)}</span>
          <input className="form-input" value={operatorTo} onChange={e => setOperatorTo(e.target.value)} placeholder={text("例如 VN_OP_001", "VD: VN_OP_001", "e.g. VN_OP_001", locale)} title={text("扫码或输入工号", "Quét hoặc nhập tài khoản", "Scan or type operator", locale)} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{text("备注", "Ghi chú", "Notes", locale)}</span>
          <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder={text("可空，例如 早班/晚班/SMT-A1", "Có thể trống", "optional", locale)} />
        </label>
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <button className="action-button action-button-primary" type="button" disabled={submitting || !trimWo || selectedItems.length === 0 || !operatorTo.trim()} onClick={() => void submit()}><ClipboardCheck size={16} /> {submitting ? text("提交中…", "Đang nộp…", "Submitting…", locale) : text(`提交签收 (${selectedItems.length})`, `Nộp ký nhận (${selectedItems.length})`, `Submit sign-off (${selectedItems.length})`, locale)}</button>
        <ShieldCheck size={16} style={{ color: "var(--ok)" }} />
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{text("签名 = (工单 + 物料行 + nonce) 的 SHA-like 指纹", "Chữ ký = SHA-like fingerprint", "Signature = SHA-like fingerprint", locale)}</span>
      </div>
      {feedback && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: feedback.ok ? "var(--ok-bg)" : "var(--danger-bg)", color: feedback.ok ? "var(--ok)" : "var(--danger)", fontSize: 13 }}>{feedback.msg}</div>}
    </section>

    <section className="surface-panel">
      <div className="section-header">
        <div>
          <h3 style={{ margin: 0 }}><History size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />{text("已签收记录", "Lịch sử ký nhận", "Signed history")} <span style={{ fontWeight: 400, fontSize: 12, color: "var(--muted)" }}>({history.length})</span></h3>
          <p style={{ marginTop: 4, color: "var(--muted)", fontSize: 12 }}>{text("只读审计；行对行追溯到 inventory_transactions.id 和 material_lot。", "Chỉ-đọc; truy ngược tới inventory_transactions.id và material_lot.", "Read-only audit; traces back to inventory_transactions.id and material_lot.")}</p>
        </div>
      </div>
      <div className="table-shell"><table>
        <thead><tr>
          <th>{text("签收时间", "Thời điểm ký", "Acked at")}</th>
          <th>{text("物料", "Vật liệu", "Material")}</th>
          <th>{text("批次", "Lô", "Lot")}</th>
          <th>{text("数量", "Số lượng", "Qty")}</th>
          <th>{text("发料人 → 领料人", "Phát → Nhận", "From → To")}</th>
          <th>{text("签名指纹", "Chữ ký", "Signature")}</th>
        </tr></thead>
        <tbody>
          {history.map(h => <tr key={h.id}>
            <td>{new Date(h.operator_to_ack_at).toLocaleString(locale)}</td>
            <td><code>{h.material_code ?? ""}</code></td>
            <td><code>{h.lot_no}</code></td>
            <td>{Number(h.qty).toLocaleString()} {h.uom ?? ""}</td>
            <td>{h.operator_from} → <strong>{h.operator_to}</strong></td>
            <td><code style={{ fontSize: 11 }}>{h.signature_hash.slice(0, 18)}…</code></td>
          </tr>)}
          {!loading && history.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{trimWo ? text("该工单还没有签收记录", "Chưa có lịch sử", "No history yet", locale) : text("请输入工单号", "Vui lòng nhập mã lệnh SX", "Enter a work order code", locale)}</td></tr>}
        </tbody>
      </table></div>
    </section>
  </div>;
}
