// 工单下发 WMS —— 主视图（4 个页签：概览 / 工单推送 / 日志 / 发料回写）
// 嫁接自 D:\rj\repos\MES-ruijing web 页「订单管理 → 工单下发 WMS」
// 菜单叶子: mesrj/menu.js "code":"wmsmo"（perm: issue.view）
// 标准: docs/grafting-standards.md §7
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { t } from "../../i18n";
import { itfApi, type ItfOverview } from "./api";
import { OverviewCards, PushConfigForm } from "./components/OverviewCards";
import { MoPushTable } from "./components/MoPushTable";
import { LogsTable, WritebackTable } from "./components/LogsTables";

const TABS = ["overview", "push", "logs", "writebacks"] as const;
type Tab = (typeof TABS)[number];

export function ItfWmsView({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<ItfOverview | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    itfApi.overview()
      .then(setData)
      .catch(ex => setErr(ex instanceof Error ? ex.message : String(ex)));
  }, []);

  useEffect(load, [load]);

  const tabBtn = (id: Tab, label: string): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
    border: "1px solid var(--border, #cbd5e1)",
    background: tab === id ? "var(--accent, #2563eb)" : "transparent",
    color: tab === id ? "#fff" : "inherit",
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map(id => (
          <button key={id} style={tabBtn(id, "")} onClick={() => setTab(id)}>
            {t(`itf.tab.${id}`, locale)}
          </button>
        ))}
      </div>

      {err ? <div style={{ color: "#b91c1c", fontSize: 13, marginBottom: 10 }}>{err}</div> : null}

      {tab === "overview" && (data
        ? <>
            <OverviewCards locale={locale} data={data} onRefresh={load} />
            <div style={{ height: 12 }} />
            <PushConfigForm locale={locale} data={data} onSaved={load} />
          </>
        : <div style={{ color: "#94a3b8", fontSize: 13 }}>{t("loading", locale)}</div>)}

      {tab === "push" && <MoPushTable locale={locale} />}
      {tab === "logs" && <LogsTable locale={locale} />}
      {tab === "writebacks" && <WritebackTable locale={locale} />}
    </div>
  );
}
