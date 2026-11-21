import { useState, useEffect, useCallback } from "react";
import { Bell, CheckCheck, RotateCcw, Mail, MailOpen } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

interface Notice {
  id: number;
  title: string;
  content: string | null;
  bizType: string | null;
  bizId: number | null;
  bizNo: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

const BIZ_TYPE_KEY: Record<string, string> = {
  mrb: "wms.notices.bizMrb",
  rework: "wms.notices.bizRework",
  supplier_return: "wms.notices.bizSupplierReturn",
  defective_move: "wms.notices.bizDefectiveMove",
  supplier_debt: "wms.notices.bizSupplierDebt",
  oa: "wms.notices.bizOa",
};

export function WmsNotices({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, count] = await Promise.all([
        wmsApi.getNotices({ pageSize: 200 }),
        wmsApi.getNoticeUnreadCount(),
      ]);
      setItems((list.items || []) as unknown as Notice[]);
      setUnread(count.count || 0);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id: number) => {
    try {
      await wmsApi.markNoticeRead(id);
      setItems((prev) => prev.map((n) => (n.id === id
        ? { ...n, isRead: true, readAt: new Date().toISOString() }
        : n)));
      setUnread((n) => Math.max(0, n - 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const markAll = async () => {
    try {
      await wmsApi.markAllNoticesRead();
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true, readAt: n.readAt || new Date().toISOString() })));
      setUnread(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const visible = onlyUnread ? items.filter((n) => !n.isRead) : items;

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>
              <Bell size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />
              {t("wms.notices.title", locale)}
              {unread > 0 && (
                <span className="badge" style={{ marginLeft: 8, background: "var(--danger)", color: "#fff" }}>{unread}</span>
              )}
            </h2>
            <p>{t("wms.notices.subtitle", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
              {t("wms.notices.onlyUnread", locale)}
            </label>
            <button className="action-button" type="button" onClick={() => load()} title={t("common.refresh", locale)}>
              <RotateCcw size={14} />
            </button>
            <button className="btn btn-secondary" type="button" disabled={unread === 0} onClick={() => void markAll()}>
              <CheckCheck size={14} style={{ marginRight: 6 }} />{t("wms.notices.markAllRead", locale)}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <section className="surface-panel">
          <p style={{ color: "var(--danger)" }}>{error}</p>
        </section>
      )}

      <section className="surface-panel">
        {loading && <p style={{ textAlign: "center", padding: "40px" }}>{t("common.loading", locale)}</p>}
        {!loading && visible.length === 0 && <p style={{ textAlign: "center", padding: "40px" }}>{t("wms.notices.empty", locale)}</p>}

        {!loading && visible.map((n) => (
          <article
            key={n.id}
            style={{
              borderBottom: "1px solid var(--line, #e2e8f0)",
              padding: "12px 4px",
              opacity: n.isRead ? 0.72 : 1,
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
            }}
          >
            <span style={{ marginTop: 2, color: n.isRead ? "#94a3b8" : "var(--info)" }}>
              {n.isRead ? <MailOpen size={16} /> : <Mail size={16} />}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>{n.title}</strong>
                {n.bizType && (
                  <span className="badge" style={{ background: "var(--nav)", color: "#fff", fontSize: 10 }}>
                    {t(BIZ_TYPE_KEY[n.bizType] || "wms.notices.bizOther", locale)}
                  </span>
                )}
                {n.bizNo && <code style={{ fontSize: 11 }}>{n.bizNo}</code>}
              </div>
              {n.content && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#475569", whiteSpace: "pre-wrap" }}>{n.content}</p>}
              <div style={{ marginTop: 4, fontSize: 11, color: "#94a3b8" }}>
                {n.createdAt ? n.createdAt.slice(0, 19).replace("T", " ") : ""}
                {n.isRead && n.readAt ? ` · ${t("wms.notices.readAt", locale)} ${n.readAt.slice(0, 16).replace("T", " ")}` : ""}
              </div>
            </div>
            {!n.isRead && (
              <button className="action-button" type="button" onClick={() => void markRead(n.id)} title={t("wms.notices.markRead", locale)}>
                <CheckCheck size={13} />
              </button>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
