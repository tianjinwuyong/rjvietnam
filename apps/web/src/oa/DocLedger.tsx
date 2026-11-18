import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { oaDocApi, type OaLedgerResult } from "./oaApi";
import { t } from "./i18n";

/**
 * 体系文件台账 —— 消费后端 doc-ledger.js 返回的双语 columns + rows。
 * 台账 7 类：controlled / issue / obsolete / destroy / borrow / external / review。
 * 独立入口页（发放回收/作废/外来）= 固定 type 的同一张表。
 * 导出：前端按当前语言生成 CSV（原版为前端生成 Excel，CSV 保持零依赖）。
 */

export const LEDGER_TYPES = [
  "controlled", "issue", "obsolete", "destroy", "borrow", "external", "review",
] as const;

export type LedgerType = (typeof LEDGER_TYPES)[number];

const TYPE_KEY: Record<LedgerType, string> = {
  controlled: "docLedger.typeControlled",
  issue: "docLedger.typeIssue",
  obsolete: "docLedger.typeObsolete",
  destroy: "docLedger.typeDestroy",
  borrow: "docLedger.typeBorrow",
  external: "docLedger.typeExternal",
  review: "docLedger.typeReview",
};

/** 各台账支持的筛选（与 doc-ledger.js query 的 filters 对齐） */
const FILTERS: Record<LedgerType, { keyword: boolean; from: boolean; to: boolean; status: boolean }> = {
  controlled: { keyword: true, from: true, to: true, status: true },
  issue: { keyword: true, from: true, to: true, status: false },
  obsolete: { keyword: true, from: true, to: true, status: false },
  destroy: { keyword: true, from: true, to: true, status: false },
  borrow: { keyword: true, from: true, to: true, status: true },
  external: { keyword: true, from: false, to: false, status: false },
  review: { keyword: true, from: true, to: true, status: false },
};

function fmtCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const s = String(value);
  return s.length >= 19 && s.match(/^\d{4}-\d{2}-\d{2}T/) ? s.slice(0, 10) : s;
}

export function LedgerTable({ locale, type }: { locale: Locale; type: LedgerType }) {
  const [data, setData] = useState<OaLedgerResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");

  const filters = FILTERS[type];
  const pageSize = 20;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError("");
    try {
      const q: Record<string, unknown> = { page: p, size: pageSize };
      if (keyword.trim()) q.keyword = keyword.trim();
      if (filters.from && from) q.from = from;
      if (filters.to && to) q.to = to;
      if (filters.status && status) q.status = status;
      setData(await oaDocApi.ledger(type, q));
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, keyword, from, to, status]);

  useEffect(() => { void load(1); }, [load]);

  const exportCsv = () => {
    if (!data || data.list.length === 0) {
      setMessage(t("docLedger.noData", locale));
      return;
    }
    const header = data.columns.map(c => (locale === "vi-VN" && c.label_vi ? c.label_vi : c.label));
    const lines = [header.join(",")];
    for (const row of data.list) {
      lines.push(data.columns.map(c => {
        const v = fmtCell(row[c.key]);
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${type}-ledger.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMessage(t("docLedger.exported", locale, { n: data.list.length }));
  };

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (data?.size ?? 20)));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {filters.keyword && (
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder={t("docLedger.keyword", locale)}
            style={{ width: 200, padding: "6px 10px" }}
            onKeyDown={e => { if (e.key === "Enter") void load(1); }}
          />
        )}
        {filters.from && (
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} title={t("docLedger.from", locale)} style={{ padding: "5px 8px" }} />
        )}
        {filters.to && (
          <input type="date" value={to} onChange={e => setTo(e.target.value)} title={t("docLedger.to", locale)} style={{ padding: "5px 8px" }} />
        )}
        {filters.status && (
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ padding: "6px 8px" }}>
            <option value="">{t("docLedger.statusAll", locale)}</option>
            {type === "borrow" ? (
              <>
                <option value="borrowed">{t("docLedger.borrowed", locale)}</option>
                <option value="returned">{t("docLedger.returned", locale)}</option>
              </>
            ) : (
              <>
                <option value="draft">{t("docStatus.draft", locale)}</option>
                <option value="reviewing">{t("docStatus.reviewing", locale)}</option>
                <option value="published">{t("docStatus.published", locale)}</option>
                <option value="obsolete">{t("docStatus.obsolete", locale)}</option>
              </>
            )}
          </select>
        )}
        <button onClick={() => void load(1)} style={{ cursor: "pointer" }}>{t("common.search", locale)}</button>
        <button onClick={exportCsv} style={{ cursor: "pointer" }}>{t("docLedger.export", locale)}</button>
        {message && <span style={{ fontSize: 13, color: "#15803d" }}>{message}</span>}
      </div>

      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}

      {loading ? <div className="empty-state">{t("common.loading", locale)}</div>
        : !data || data.list.length === 0 ? <div className="empty-state">{t("docLedger.noData", locale)}</div>
          : (
            <>
              <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)", marginBottom: 6 }}>
                {t("docLedger.totalCount", locale, { n: total })}
              </div>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      {data.columns.map(c => (
                        <th key={c.key}>{locale === "vi-VN" && c.label_vi ? c.label_vi : c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.list.map((row, i) => (
                      <tr key={i}>
                        {data.columns.map(c => <td key={c.key}>{fmtCell(row[c.key])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total > (data.size ?? 20) && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                  <button disabled={page <= 1} onClick={() => void load(page - 1)} style={{ cursor: "pointer" }}>←</button>
                  <span style={{ fontSize: 13 }}>{page} / {totalPages} · {total}</span>
                  <button disabled={page >= totalPages} onClick={() => void load(page + 1)} style={{ cursor: "pointer" }}>→</button>
                </div>
              )}
            </>
          )}
    </div>
  );
}

/** 台账页（7 类 tab） */
export function DocLedger({ locale }: { locale: Locale }) {
  const [type, setType] = useState<LedgerType>("controlled");
  return (
    <div>
      <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {LEDGER_TYPES.map(tt => (
          <button
            key={tt}
            role="tab"
            aria-selected={type === tt}
            onClick={() => setType(tt)}
            style={{
              padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 13,
              border: type === tt ? "2px solid #0f766e" : "1px solid #cbd5e1",
              background: type === tt ? "#ecfdf5" : "white",
              fontWeight: type === tt ? 700 : 400,
            }}
          >
            {t(TYPE_KEY[tt], locale)}
          </button>
        ))}
      </div>
      <LedgerTable key={type} locale={locale} type={type} />
    </div>
  );
}
