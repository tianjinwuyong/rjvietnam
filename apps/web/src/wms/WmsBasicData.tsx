/**
 * WmsBasicData — 基础数据管理（总览）
 * 
 * Excel 菜单项: "基础数据管理" (二级菜单)
 * 点击进入子菜单: 物料主数据 / 库位精细化管理 / 批次/序列号管理
 * 入口: 仓库管理 → 基础数据管理
 */
import { Package, MapPin, Layers } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { WmsTabKey } from "./index";

const SUB_MODULES = [
  {
    key: "materialMaster",
    icon: <Package size={32} />,
    labelKey: "wms.subnav.materialMaster",
    descKey: "wms.basicData.materialMasterDesc",
    color: "linear-gradient(135deg, #0f766e 0%, #115e59 100%)",
    border: "#2dd4bf",
  },
  {
    key: "locationManagement",
    icon: <MapPin size={32} />,
    labelKey: "wms.subnav.locationManagement",
    descKey: "wms.basicData.locationDesc",
    color: "linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%)",
    border: "#60a5fa",
  },
  {
    key: "batchManagement",
    icon: <Layers size={32} />,
    labelKey: "wms.subnav.batchManagement",
    descKey: "wms.basicData.batchDesc",
    color: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
    border: "#a78bfa",
  },
] as const;

export function WmsBasicData({
  locale,
  onNavigate,
}: {
  locale: Locale;
  onNavigate: (tab: WmsTabKey) => void;
}) {
  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.subnav.basicData", locale)}</h2>
            <p>{t("wms.group.basicData", locale)}</p>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {locale === "zh-CN" ? "选择子模块" : locale === "vi-VN" ? "Chon module con" : "Select sub-module"}
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 20,
          padding: "8px 0",
        }}>
          {SUB_MODULES.map((mod) => (
            <button
              key={mod.key}
              onClick={() => onNavigate(mod.key)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
                padding: "28px 20px",
                background: mod.color,
                border: `1.5px solid ${mod.border}`,
                borderRadius: 16,
                cursor: "pointer",
                color: "#fff",
                boxShadow: `0 8px 24px rgba(0,0,0,0.18)`,
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
                fontFamily: "Microsoft YaHei, Noto Sans, sans-serif",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-3px)";
                e.currentTarget.style.boxShadow = `0 12px 32px rgba(0,0,0,0.28)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = `0 8px 24px rgba(0,0,0,0.18)`;
              }}
            >
              <div style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: "rgba(255,255,255,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                {mod.icon}
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
                  {t(mod.labelKey, locale)}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
                  {t(mod.descKey, locale)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
