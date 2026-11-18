// MES-ruijing 前端模块壳 —— 左侧菜单（后端 /mesrj/menu 权限过滤）+ 视图注册 + 首页
// 与 OA 模块同构：叶子 code → 组件；未实现叶子显示「建设中」
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, type MesrjMenuGroup } from "./api";
import { t } from "./i18n";
import { MesrjCrudPage } from "./GenericList";
import { crudViews } from "./resources";

interface SysInfo {
  sys_name: string;
  version: string;
  factory: string;
  db: string;
  counts: Record<string, number>;
}

function HomeView({ locale }: { locale: Locale }) {
  const [info, setInfo] = useState<SysInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    mesrjApi.get<SysInfo>("/sysinfo")
      .then(setInfo)
      .catch(ex => setError(ex instanceof Error ? ex.message : String(ex)));
  }, []);

  if (error) return <div style={{ color: "#b91c1c" }}>{t("common.loadFail", locale)}：{error}</div>;
  if (!info) return <div style={{ color: "#94a3b8" }}>{t("loading", locale)}</div>;

  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>{info.sys_name}</h2>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>
        v{info.version} · {info.db}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {Object.entries(info.counts).map(([label, value]) => (
          <div key={label} style={{ flex: "1 1 150px", minWidth: 150, padding: "14px 16px", border: "1px solid var(--border, #e2e8f0)", borderRadius: 10 }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WipView({ locale }: { locale: Locale }) {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8" }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>🚧</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{t("wip.title", locale)}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{t("wip.desc", locale)}</div>
    </div>
  );
}

export function MesrjModule({ locale }: { locale: Locale }) {
  const [menu, setMenu] = useState<MesrjMenuGroup[] | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState("home");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    mesrjApi.get<MesrjMenuGroup[]>("/menu")
      .then(groups => {
        setMenu(groups);
        // 默认展开第一组
        setOpenGroups(prev => (groups.length ? { ...prev, [groups[0].code]: true } : prev));
      })
      .catch(ex => setError(ex instanceof Error ? ex.message : String(ex)));
  }, []);

  const views = crudViews(locale);
  const activeView = views.find(v => v.code === active);

  const renderView = useCallback(() => {
    if (active === "home") return <HomeView locale={locale} />;
    if (activeView) {
      return (
        <MesrjCrudPage
          key={activeView.code}
          locale={locale}
          basePath={activeView.basePath}
          res={activeView.res}
          fields={activeView.fields}
          filters={activeView.filters}
        />
      );
    }
    return <WipView locale={locale} />;
  }, [active, activeView, locale]);

  const activeTitle = active === "home"
    ? t("menu.home", locale)
    : t(`menu.${active}`, locale) !== `menu.${active}` ? t(`menu.${active}`, locale) : active;

  return (
    <div style={{ display: "flex", gap: 16, minHeight: 400 }}>
      <nav style={{ width: 210, flexShrink: 0 }}>
        {error && <div style={{ color: "#b91c1c", fontSize: 13, padding: "6px 0" }}>{error}</div>}
        {!menu && !error && <div style={{ color: "#94a3b8", fontSize: 13 }}>{t("loading", locale)}</div>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13 }}>
          <li style={{ marginBottom: 2 }}>
            <button
              onClick={() => setActive("home")}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "7px 10px",
                borderRadius: 8, border: "none", cursor: "pointer",
                background: active === "home" ? "var(--accent-soft, #e0e7ff)" : "transparent",
                fontWeight: active === "home" ? 600 : 400,
              }}
            >
              {t("menu.home", locale)}
            </button>
          </li>
          {(menu ?? []).map(group => {
            const open = openGroups[group.code] ?? false;
            return (
              <li key={group.code} style={{ marginBottom: 2 }}>
                <button
                  onClick={() => setOpenGroups(s => ({ ...s, [group.code]: !s[group.code] }))}
                  style={{
                    display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center",
                    padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: "transparent", fontWeight: 600,
                  }}
                >
                  <span>{t(`menu.${group.code}`, locale) !== `menu.${group.code}` ? t(`menu.${group.code}`, locale) : group.name}</span>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>{open ? "▾" : "▸"}</span>
                </button>
                {open && (group.children ?? []).map(child => {
                  const label = t(`menu.${child.code}`, locale) !== `menu.${child.code}`
                    ? t(`menu.${child.code}`, locale) : child.name;
                  return (
                    <button
                      key={child.code}
                      onClick={() => setActive(child.code)}
                      style={{
                        display: "block", width: "100%", textAlign: "left", padding: "6px 10px 6px 22px",
                        borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13,
                        background: active === child.code ? "var(--accent-soft, #e0e7ff)" : "transparent",
                        fontWeight: active === child.code ? 600 : 400,
                      }}
                      title={label}
                    >
                      {label}
                    </button>
                  );
                })}
              </li>
            );
          })}
        </ul>
      </nav>
      <section style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 17 }}>{activeTitle}</h2>
        {renderView()}
      </section>
    </div>
  );
}
