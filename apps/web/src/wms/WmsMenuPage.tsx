import { useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  wmsMenuGroups,
  wmsTabTranslationKeys,
  type WmsMenuGroup,
  type WmsTabKey,
} from "./index";

const GROUP_ICONS: Record<WmsMenuGroup["key"], string> = {
  receivingManagement: "📥",
  overview: "📊",
  warehouse: "🏭",
  iqcManagement: "🔍",
  collaborationManagement: "🔄",
  specialMaterials: "⚠️",
  traceability: "🧭",
  msd: "💧",
  quality: "🔬",
};

interface MenuButtonProps {
  label: string;
  icon?: string;
  active?: boolean;
  onClick: () => void;
  compact?: boolean;
}

function MenuButton({ label, icon, active, onClick, compact = false }: MenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minWidth: compact ? 174 : 205,
        minHeight: compact ? 46 : 62,
        padding: compact ? "9px 13px" : "12px 18px",
        background: active
          ? "linear-gradient(135deg, #e67e22 0%, #d35400 100%)"
          : "linear-gradient(135deg, #2c3e50 0%, #34495e 100%)",
        border: active ? "1px solid #ffbd75" : "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        color: "#fff",
        fontSize: compact ? 13 : 14,
        fontWeight: 650,
        cursor: "pointer",
        boxShadow: active ? "0 4px 16px rgba(230,126,34,0.42)" : "0 2px 8px rgba(0,0,0,0.25)",
        transition: "transform 0.15s ease, background 0.15s ease",
        textAlign: "center",
        lineHeight: 1.25,
        fontFamily: "Microsoft YaHei, Noto Sans, sans-serif",
      }}
    >
      {icon && <span style={{ fontSize: 21 }} aria-hidden="true">{icon}</span>}
      <span>{label}</span>
    </button>
  );
}

interface WmsMenuPageProps {
  locale: Locale;
  onNavigate: (tab: WmsTabKey) => void;
}

export function WmsMenuPage({ locale, onNavigate }: WmsMenuPageProps) {
  const [activeGroupKey, setActiveGroupKey] = useState<WmsMenuGroup["key"]>("overview");
  const activeGroup = wmsMenuGroups.find((group) => group.key === activeGroupKey) ?? wmsMenuGroups[0];

  return (
    <div style={{
      minHeight: "100%",
      background: "linear-gradient(160deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
      padding: "28px 24px 40px",
      fontFamily: "Microsoft YaHei, Noto Sans, sans-serif",
    }}>
      <header style={{ textAlign: "center", marginBottom: 26 }}>
        <h1 style={{
          color: "#fff",
          fontSize: 28,
          fontWeight: 750,
          margin: 0,
          letterSpacing: 2,
          textShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }}>
          {locale === "zh-CN" ? "仓库管理系统" : locale === "vi-VN" ? "Hệ thống quản lý kho" : "Warehouse Management System"}
        </h1>
        <div style={{
          width: 90,
          height: 3,
          background: "linear-gradient(90deg, #e67e22, #f39c12)",
          margin: "12px auto 0",
          borderRadius: 2,
        }} />
      </header>

      <nav aria-label="WMS modules" style={{
        display: "flex",
        justifyContent: "center",
        gap: 12,
        marginBottom: 26,
        flexWrap: "wrap",
      }}>
        {wmsMenuGroups.map((group) => (
          <MenuButton
            key={group.key}
            label={t(group.translationKey as never, locale)}
            icon={GROUP_ICONS[group.key]}
            active={activeGroup.key === group.key}
            onClick={() => setActiveGroupKey(group.key)}
          />
        ))}
      </nav>

      <section style={{
        maxWidth: 1220,
        margin: "0 auto",
        padding: 20,
        borderRadius: 14,
        background: "rgba(7, 18, 38, 0.48)",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 16px 38px rgba(0,0,0,0.22)",
      }}>
        <h2 style={{ color: "#f6f8fb", fontSize: 17, margin: "0 0 16px" }}>
          {t(activeGroup.translationKey as never, locale)}
        </h2>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(174px, 1fr))",
          gap: 11,
        }}>
          {activeGroup.tabs.map((tab) => (
            <MenuButton
              key={tab}
              label={t(wmsTabTranslationKeys[tab] as never, locale)}
              onClick={() => onNavigate(tab)}
              compact
            />
          ))}
        </div>
      </section>
      <section style={{ maxWidth: 1220, margin: "26px auto 0", padding: 20, borderRadius: 14, background: "rgba(7,18,38,.62)", border: "1px solid rgba(255,255,255,.14)" }}>
        <h2 style={{ color: "#fff", fontSize: 18, margin: "0 0 6px" }}>采购与供应商管理闭环</h2>
        <p style={{ color: "#b8c7d9", margin: "0 0 12px", fontSize: 13 }}>供应商管理 → 采购 PO → 供应商送货单 → WMS 收料 → IQC → 财务匹配</p>
        <svg viewBox="0 0 1200 150" role="img" aria-label="采购与供应商管理闭环" style={{ width: "100%", display: "block" }}>
          <defs><marker id="home-flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#f1f5f9" /></marker></defs>
          {[{x:20,t:"供应商管理",s:"主数据 / 资质",tab:"supplierManagement",c:"#2563eb"},{x:260,t:"采购部",s:"PO / 交期",tab:"poReceipt",c:"#16a34a"},{x:500,t:"供应商送货单",s:"送货单 / OCR",tab:"supplierManagement",c:"#d97706"},{x:740,t:"WMS 收料",s:"箱 / 托板 / 库位",tab:"materialReceiving",c:"#4f46e5"},{x:980,t:"IQC / 财务",s:"检验 / 三方匹配",tab:"iqc",c:"#be123c"}].map((n,i)=><g key={n.t} onClick={() => onNavigate(n.tab as WmsTabKey)} style={{ cursor: "pointer" }}><rect x={n.x} y="35" width="190" height="64" rx="12" fill={n.c} opacity=".92" /><text x={n.x+95} y="62" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="700">{n.t}</text><text x={n.x+95} y="83" textAnchor="middle" fill="#e2e8f0" fontSize="12">{n.s}</text>{i<4&&<line x1={n.x+190} y1="67" x2={n.x+235} y2="67" stroke="#f1f5f9" strokeWidth="3" markerEnd="url(#home-flow-arrow)" />}</g>)}
        </svg>
      </section>
    </div>
  );
}
