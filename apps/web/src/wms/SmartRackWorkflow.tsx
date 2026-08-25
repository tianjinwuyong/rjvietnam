/**
 * SmartRackWorkflow — 智能料架 SMT 物料上料流程图
 *
 * 完整流程可视化：
 *   仓库收货 → IQC → 料架入库 → 工单扫描 → BOM需求 → 查询料架 →
 *   LED引导 → 取料 → 扫描卷盘 → 上料确认 → SMT生产 → (退料/报废)
 *
 * 展示每个环节的：角色 | 操作 | API调用 | 数据状态
 */
import React, { useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

// ── i18n ──────────────────────────────────────────────────────────────────
const I18N: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    title: "SMT 智能料架上料流程",
    subtitle: "感应式料架 · WO+BOM+PDA串联 · 三线共用",
    actor_wh: "仓库",
    actor_smt: "SMT操作员",
    actor_sys: "系统",
    actor_qc: "QC",
    // Stages
    s1_title: "来料入库",
    s1_a: "供应商送货",
    s1_b: "IQC 检验",
    s1_c: "合格释放",
    s1_d: "创建 material_lots",
    s2_title: "料架入库",
    s2_a: "扫描卷盘条码",
    s2_b: "选择储位 (LED确认)",
    s2_c: "POST /wms/shelf/rack-in",
    s2_d: "写入 shelf_cells + smart_rack_transactions",
    s3_title: "工单扫描",
    s3_a: "PDA扫描工单条码",
    s3_b: "GET /pmc/work-order-material-status",
    s3_c: "获取 BOM 物料需求列表",
    s3_d: "计算缺口 shortfall",
    s4_title: "查询料架",
    s4_a: "点击物料 '查找料架'",
    s4_b: "GET /wms/shelf/material-lots",
    s4_c: "定位卷盘所在储位",
    s4_d: "返回 shelf_code + cell_number",
    s5_title: "LED 引导",
    s5_a: "系统发送 LED 命令",
    s5_b: "POST /wms/shelf/rack-light",
    s5_c: "储位 LED 点亮 (绿色)",
    s5_d: "操作员前往该储位",
    s6_title: "取料上料",
    s6_a: "从亮灯储位取出卷盘",
    s6_b: "扫描卷盘条码",
    s6_c: "PDA输入飞达槽位",
    s6_d: "物理安装到 feeder slot",
    s7_title: "上料确认",
    s7_a: "POST /mes/feeder-loading",
    s7_b: "SHELF_OUT (清空储位)",
    s7_c: "ISSUE_TO_LINE (库存减少)",
    s7_d: "写入 feeder_loading_events",
    s8_title: "SMT 生产",
    s8_a: "贴片机自动取料生产",
    s8_b: "在制数量减少",
    s8_c: "可追溯到 lot_no",
    s8_d: "完工后工单进度更新",
    s9_title: "退料/报废 (可选)",
    s9_a: "余料可退回到料架",
    s9_b: "rack-in 重新入库",
    s9_c: "或报废处理",
    s9_d: "记录 smart_rack_transactions",
    // API list
    api_title: "涉及 API 端点",
    // Legend
    legend_role: "角色",
    legend_action: "操作",
    legend_api: "API调用",
    legend_data: "数据状态",
    // Note
    note_title: "关键设计要点",
    note1: "3条产线 (L001/L002/L003) 共用同一个智能料架",
    note2: "料架是 SMT 线和仓库之间的缓冲预定位系统",
    note3: "LED 亮灯是找料的核心 — 消除人工搜索",
    note4: "feeder-loading 自动完成 SHELF_OUT + ISSUE_TO_LINE",
  },
  "vi-VN": {
    title: "Quy trình nạp linh kiện kệ thông minh SMT",
    subtitle: "Kệ cảm ứng · WO+BOM+PDA · 3 dây chuyền",
    actor_wh: "Kho",
    actor_smt: "SMT",
    actor_sys: "Hệ thống",
    actor_qc: "QC",
    s1_title: "Nhập kho",
    s1_a: "Nhà cung cấp giao",
    s1_b: "IQC kiểm tra",
    s1_c: "Đạt → phát hành",
    s1_d: "Tạo material_lots",
    s2_title: "Nhập kệ",
    s2_a: "Quét mã cuộn",
    s2_b: "Chọn vị trí (LED)",
    s2_c: "POST /wms/shelf/rack-in",
    s2_d: "Ghi shelf_cells + SRT",
    s3_title: "Quét WO",
    s3_a: "PDA quét mã WO",
    s3_b: "GET /pmc/work-order-material-status",
    s3_c: "Lấy danh sách BOM",
    s3_d: "Tính shortfall",
    s4_title: "Tra kệ",
    s4_a: "Nhấn 'Tìm kiếm'",
    s4_b: "GET /wms/shelf/material-lots",
    s4_c: "Xác định vị trí cuộn",
    s4_d: "Trả về shelf + cell",
    s5_title: "LED dẫn đường",
    s5_a: "Gửi lệnh LED",
    s5_b: "POST /wms/shelf/rack-light",
    s5_c: "LED sáng (xanh)",
    s5_d: "Nhân viên đến vị trí",
    s6_title: "Lấy & nạp",
    s6_a: "Lấy cuộn khỏi vị trí sáng",
    s6_b: "Quét mã cuộn",
    s6_c: "Nhập khe feeder",
    s6_d: "Lắp vào feeder",
    s7_title: "Xác nhận nạp",
    s7_a: "POST /mes/feeder-loading",
    s7_b: "SHELF_OUT (xóa vị trí)",
    s7_c: "ISSUE_TO_LINE (giảm tồn)",
    s7_d: "Ghi feeder_loading_events",
    s8_title: "Sản xuất SMT",
    s8_a: "Machine lấy linh kiện",
    s8_b: "Số lượng giảm",
    s8_c: "Truy xuất qua lot_no",
    s8_d: "Cập nhật tiến độ WO",
    s9_title: "Trả / Báo hỏng",
    s9_a: "Cuộn còn → trả kệ",
    s9_b: "rack-in lại",
    s9_c: "Hoặc báo hỏng",
    s9_d: "Ghi SRT",
    api_title: "Các API endpoints",
    legend_role: "Vai trò",
    legend_action: "Thao tác",
    legend_api: "API",
    legend_data: "Dữ liệu",
    note_title: "Điểm thiết kế chính",
    note1: "3 dây chuyền (L001/L002/L003) dùng chung 1 kệ thông minh",
    note2: "Kệ là bộ đệm giữa kho và dây chuyền SMT",
    note3: "LED là cốt lõi — không cần tìm thủ công",
    note4: "feeder-loading tự động SHELF_OUT + ISSUE_TO_LINE",
  },
  "en-US": {
    title: "SMT Smart Rack Material Loading Workflow",
    subtitle: "Inductive rack · WO+BOM+PDA · 3 lines shared",
    actor_wh: "Warehouse",
    actor_smt: "SMT Operator",
    actor_sys: "System",
    actor_qc: "QC",
    s1_title: "Receiving",
    s1_a: "Supplier delivery",
    s1_b: "IQC inspection",
    s1_c: "Pass → release",
    s1_d: "Create material_lots",
    s2_title: "Rack In",
    s2_a: "Scan reel barcode",
    s2_b: "Select cell (LED confirm)",
    s2_c: "POST /wms/shelf/rack-in",
    s2_d: "Write shelf_cells + SRT",
    s3_title: "WO Scan",
    s3_a: "PDA scan WO barcode",
    s3_b: "GET /pmc/work-order-material-status",
    s3_c: "Get BOM material list",
    s3_d: "Calculate shortfall",
    s4_title: "Query Rack",
    s4_a: "Tap 'Find on rack'",
    s4_b: "GET /wms/shelf/material-lots",
    s4_c: "Locate reel cell",
    s4_d: "Return shelf + cell",
    s5_title: "LED Guide",
    s5_a: "Send LED command",
    s5_b: "POST /wms/shelf/rack-light",
    s5_c: "Cell LED lights green",
    s5_d: "Operator goes to cell",
    s6_title: "Pick & Load",
    s6_a: "Remove reel from lit cell",
    s6_b: "Scan reel barcode",
    s6_c: "Enter feeder slot",
    s6_d: "Install to feeder",
    s7_title: "Loading Confirm",
    s7_a: "POST /mes/feeder-loading",
    s7_b: "SHELF_OUT (clear cell)",
    s7_c: "ISSUE_TO_LINE (deduct inv)",
    s7_d: "Write feeder_loading_events",
    s8_title: "SMT Production",
    s8_a: "Pickers consume reels",
    s8_b: "In-process qty decreases",
    s8_c: "Traceable by lot_no",
    s8_d: "WO progress updated",
    s9_title: "Return/Scrap (opt)",
    s9_a: "Remaining → return to rack",
    s9_b: "rack-in again",
    s9_c: "Or scrap",
    s9_d: "Record SRT",
    api_title: "API Endpoints",
    legend_role: "Role",
    legend_action: "Action",
    legend_api: "API Call",
    legend_data: "Data State",
    note_title: "Key Design Points",
    note1: "3 lines (L001/L002/L003) share 1 smart rack",
    note2: "Rack is buffer between warehouse and SMT line",
    note3: "LED lighting eliminates manual search",
    note4: "feeder-loading auto SHELF_OUT + ISSUE_TO_LINE",
  },
};

// ── Color scheme per stage ─────────────────────────────────────────────────
const STAGE_COLORS: Record<number, { bg: string; border: string; icon: string; label: string }> = {
  1: { bg: "#e3f2fd", border: "#1565c0", icon: "📦", label: "#1565c0" },
  2: { bg: "#f3e5f5", border: "#6a1b9a", icon: "🏭", label: "#6a1b9a" },
  3: { bg: "#e8f5e9", border: "#2e7d32", icon: "📋", label: "#2e7d32" },
  4: { bg: "#fff8e1", border: "#f57f17", icon: "🔍", label: "#f57f17" },
  5: { bg: "#fff3e0", border: "#e65100", icon: "💡", label: "#e65100" },
  6: { bg: "#e0f7fa", border: "#00838f", icon: "🖐", label: "#00838f" },
  7: { bg: "#fce4ec", border: "#ad1457", icon: "⚡", label: "#ad1457" },
  8: { bg: "#e8eaf6", border: "#283593", icon: "🏭", label: "#283593" },
  9: { bg: "#efebe9", border: "#4e342e", icon: "♻", label: "#4e342e" },
};

const ACTOR_COLORS: Record<string, string> = {
  warehouse: "#1565c0",
  smt: "#2e7d32",
  system: "#6a1b9a",
  qc: "#f57f17",
};

// ── Stage definitions ──────────────────────────────────────────────────────
interface StageRow {
  stage: number;
  titleKey: string;
  actorKey: string;
  lines: { role: string; textKey: string; type: "action" | "api" | "data" }[];
}

const STAGES: StageRow[] = [
  {
    stage: 1,
    titleKey: "s1_title",
    actorKey: "actor_wh",
    lines: [
      { role: "warehouse", textKey: "s1_a", type: "action" },
      { role: "qc", textKey: "s1_b", type: "action" },
      { role: "system", textKey: "s1_c", type: "action" },
      { role: "system", textKey: "s1_d", type: "data" },
    ],
  },
  {
    stage: 2,
    titleKey: "s2_title",
    actorKey: "actor_wh",
    lines: [
      { role: "warehouse", textKey: "s2_a", type: "action" },
      { role: "warehouse", textKey: "s2_b", type: "action" },
      { role: "system", textKey: "s2_c", type: "api" },
      { role: "system", textKey: "s2_d", type: "data" },
    ],
  },
  {
    stage: 3,
    titleKey: "s3_title",
    actorKey: "actor_smt",
    lines: [
      { role: "smt", textKey: "s3_a", type: "action" },
      { role: "system", textKey: "s3_b", type: "api" },
      { role: "system", textKey: "s3_c", type: "data" },
      { role: "system", textKey: "s3_d", type: "data" },
    ],
  },
  {
    stage: 4,
    titleKey: "s4_title",
    actorKey: "actor_smt",
    lines: [
      { role: "smt", textKey: "s4_a", type: "action" },
      { role: "system", textKey: "s4_b", type: "api" },
      { role: "system", textKey: "s4_c", type: "action" },
      { role: "system", textKey: "s4_d", type: "data" },
    ],
  },
  {
    stage: 5,
    titleKey: "s5_title",
    actorKey: "actor_sys",
    lines: [
      { role: "system", textKey: "s5_a", type: "action" },
      { role: "system", textKey: "s5_b", type: "api" },
      { role: "system", textKey: "s5_c", type: "action" },
      { role: "smt", textKey: "s5_d", type: "action" },
    ],
  },
  {
    stage: 6,
    titleKey: "s6_title",
    actorKey: "actor_smt",
    lines: [
      { role: "smt", textKey: "s6_a", type: "action" },
      { role: "smt", textKey: "s6_b", type: "action" },
      { role: "smt", textKey: "s6_c", type: "action" },
      { role: "smt", textKey: "s6_d", type: "action" },
    ],
  },
  {
    stage: 7,
    titleKey: "s7_title",
    actorKey: "actor_sys",
    lines: [
      { role: "smt", textKey: "s7_a", type: "action" },
      { role: "system", textKey: "s7_b", type: "data" },
      { role: "system", textKey: "s7_c", type: "data" },
      { role: "system", textKey: "s7_d", type: "data" },
    ],
  },
  {
    stage: 8,
    titleKey: "s8_title",
    actorKey: "actor_sys",
    lines: [
      { role: "system", textKey: "s8_a", type: "action" },
      { role: "system", textKey: "s8_b", type: "data" },
      { role: "system", textKey: "s8_c", type: "data" },
      { role: "system", textKey: "s8_d", type: "data" },
    ],
  },
  {
    stage: 9,
    titleKey: "s9_title",
    actorKey: "actor_smt",
    lines: [
      { role: "smt", textKey: "s9_a", type: "action" },
      { role: "system", textKey: "s9_b", type: "api" },
      { role: "smt", textKey: "s9_c", type: "action" },
      { role: "system", textKey: "s9_d", type: "data" },
    ],
  },
];

// ── Badge helpers ──────────────────────────────────────────────────────────
function RoleBadge({ role, locale }: { role: string; locale: Locale }) {
  const cfg: Record<string, { labelKey: string; bg: string; color: string }> = {
    warehouse: { labelKey: "actor_wh", bg: "#bbdefb", color: "#1565c0" },
    smt: { labelKey: "actor_smt", bg: "#c8e6c9", color: "#2e7d32" },
    system: { labelKey: "actor_sys", bg: "#e1bee7", color: "#6a1b9a" },
    qc: { labelKey: "actor_qc", bg: "#fff9c4", color: "#f57f17" },
  };
  const c = cfg[role] ?? cfg.system;
  return (
    <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: c.bg, color: c.color, whiteSpace: "nowrap" }}>
      {I18N[locale][c.labelKey]}
    </span>
  );
}

function TypeChip({ type }: { type: "action" | "api" | "data" }) {
  const cfg = {
    action: { bg: "#e3f2fd", color: "#0d47a1", label: "⚡" },
    api: { bg: "#f3e5f5", color: "#4a148c", label: "🔗" },
    data: { bg: "#e8f5e9", color: "#1b5e20", label: "💾" },
  };
  const c = cfg[type];
  return (
    <span style={{ display: "inline-block", padding: "1px 5px", borderRadius: 3, fontSize: 9, background: c.bg, color: c.color, fontWeight: 600 }}>
      {c.label}
    </span>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function StageCard({ stage, locale }: { stage: StageRow; locale: Locale }) {
  const cfg = STAGE_COLORS[stage.stage] ?? STAGE_COLORS[1];
  const lines = STAGES[stage.stage - 1]?.lines ?? [];
  const title = I18N[locale][stage.titleKey];

  return (
    <div style={{
      border: `2px solid ${cfg.border}`,
      borderRadius: 12,
      background: cfg.bg,
      overflow: "hidden",
    }}>
      {/* Stage header */}
      <div style={{
        background: cfg.border,
        color: "#fff",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <span style={{ fontSize: 22 }}>{cfg.icon}</span>
        <span style={{ fontWeight: 800, fontSize: 15 }}>{stage.stage}. {title}</span>
      </div>

      {/* Rows */}
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        {lines.map((line, i) => (
          <div key={i} style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "6px 10px",
            background: "#fff",
            borderRadius: 7,
            border: "1px solid #0001",
          }}>
            <div style={{ flexShrink: 0, paddingTop: 2 }}>
              <RoleBadge role={line.role} locale={locale} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.4 }}>
                {I18N[locale][line.textKey]}
              </span>
            </div>
            <div style={{ flexShrink: 0, paddingTop: 2 }}>
              <TypeChip type={line.type} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApiPanel({ locale }: { locale: Locale }) {
  const apis = [
    { method: "POST", path: "/wms/shelf/rack-in", desc: locale === "zh-CN" ? "料架入库" : locale === "vi-VN" ? "Nhập kệ" : "Rack in" },
    { method: "POST", path: "/wms/shelf/rack-out", desc: locale === "zh-CN" ? "料架出库" : locale === "vi-VN" ? "Xuất kệ" : "Rack out" },
    { method: "POST", path: "/wms/shelf/rack-light", desc: locale === "zh-CN" ? "LED点亮" : locale === "vi-VN" ? "Bật LED" : "LED on" },
    { method: "GET", path: "/wms/shelf/rack-status", desc: locale === "zh-CN" ? "料架状态" : locale === "vi-VN" ? "Trạng thái kệ" : "Rack status" },
    { method: "GET", path: "/wms/shelf/rack-cells/:shelfCode", desc: locale === "zh-CN" ? "储位网格" : locale === "vi-VN" ? "Lưới vị trí" : "Cell grid" },
    { method: "GET", path: "/wms/shelf/material-lots", desc: locale === "zh-CN" ? "查询物料位置" : locale === "vi-VN" ? "Tìm vị trí" : "Find material" },
    { method: "GET", path: "/wms/shelf/rack-transactions", desc: locale === "zh-CN" ? "事务历史" : locale === "vi-VN" ? "Lịch sử" : "TX history" },
    { method: "GET", path: "/pmc/work-order-material-status", desc: locale === "zh-CN" ? "工单物料状态" : locale === "vi-VN" ? "TT vật liệu WO" : "WO material status" },
    { method: "POST", path: "/mes/feeder-loading", desc: locale === "zh-CN" ? "上料确认" : locale === "vi-VN" ? "Xác nhận nạp" : "Loading confirm" },
  ];

  return (
    <div style={{
      background: "#1a237e",
      borderRadius: 12,
      padding: "16px 20px",
      color: "#fff",
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: "#9fa8da" }}>
        {I18N[locale].api_title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {apis.map((api, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 4,
              background: api.method === "GET" ? "#1565c0" : "#ad1457",
              color: "#fff", minWidth: 52, textAlign: "center",
            }}>
              {api.method}
            </span>
            <code style={{ fontSize: 12, color: "#ce93d8", flex: 1 }}>{api.path}</code>
            <span style={{ fontSize: 11, color: "#9e9e9e" }}>{api.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DataFlowDiagram({ locale }: { locale: Locale }) {
  // Visual data flow: Warehouse → SmartRack → PDA → SMT Line
  return (
    <div style={{
      background: "#fff",
      border: "2px solid #283593",
      borderRadius: 12,
      padding: "16px 20px",
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14, color: "#283593" }}>
        {locale === "zh-CN" ? "数据流向" : locale === "vi-VN" ? "Luồng dữ liệu" : "Data Flow"}
      </div>

      {/* Flow boxes */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, overflow: "auto" }}>
        {[
          { icon: "🏭", label: locale === "zh-CN" ? "仓库" : locale === "vi-VN" ? "Kho" : "Warehouse", sub: "material_lots", color: "#1565c0" },
          { icon: "📦", label: locale === "zh-CN" ? "智能料架" : locale === "vi-VN" ? "Kệ thông minh" : "Smart Rack", sub: "shelf_cells + SRT", color: "#6a1b9a" },
          { icon: "📱", label: "PDA", sub: locale === "zh-CN" ? "扫描/查询/上料" : locale === "vi-VN" ? "Quét/Tra/Nạp" : "Scan/Query/Load", color: "#2e7d32" },
          { icon: "⚡", label: locale === "zh-CN" ? " feeder-loading" : locale === "vi-VN" ? " Xác nhận nạp" : " Loading Confirm", sub: "SHELF_OUT + ISSUE", color: "#ad1457" },
          { icon: "🏭", label: "SMT Line", sub: locale === "zh-CN" ? "生产消耗" : locale === "vi-VN" ? "Sản xuất" : "Production", color: "#283593" },
        ].map((box, i) => (
          <React.Fragment key={i}>
            <div style={{
              flex: "0 0 auto",
              textAlign: "center",
              padding: "10px 12px",
              background: box.color + "15",
              border: `2px solid ${box.color}`,
              borderRadius: 10,
              minWidth: 90,
            }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>{box.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: box.color }}>{box.label}</div>
              <div style={{ fontSize: 9, color: "#666", marginTop: 2 }}>{box.sub}</div>
            </div>
            {i < 4 && (
              <div style={{
                flex: "0 0 auto",
                display: "flex",
                alignItems: "center",
                padding: "0 4px",
                color: "#9e9e9e",
                fontSize: 18,
              }}>
                →
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* DB tables */}
      <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { table: "material_lots", note: locale === "zh-CN" ? "卷盘批次主记录" : locale === "vi-VN" ? "Bản ghi cuộn chính" : "Reel batch record", color: "#1565c0" },
          { table: "shelf_cells", note: locale === "zh-CN" ? "储位状态 ↔ lot" : locale === "vi-VN" ? "Vị trí ↔ lot" : "Cell ↔ lot mapping", color: "#6a1b9a" },
          { table: "smart_rack_transactions", note: locale === "zh-CN" ? "料架事务日志" : locale === "vi-VN" ? "Nhật ký kệ" : "Rack TX log", color: "#2e7d32" },
          { table: "inventory_transactions", note: locale === "zh-CN" ? "库存流水 (ISSUE_TO_LINE)" : locale === "vi-VN" ? "Tồn kho (ISSUE)" : "Inventory (ISSUE)", color: "#ad1457" },
          { table: "feeder_loading_events", note: locale === "zh-CN" ? "上料事件记录" : locale === "vi-VN" ? "Sự kiện nạp" : "Loading events", color: "#283593" },
        ].map((db) => (
          <div key={db.table} style={{
            padding: "6px 10px",
            border: `1.5px solid ${db.color}40`,
            borderLeft: `4px solid ${db.color}`,
            borderRadius: 6,
            background: db.color + "08",
          }}>
            <code style={{ fontSize: 11, fontWeight: 700, color: db.color }}>{db.table}</code>
            <div style={{ fontSize: 10, color: "#888", marginTop: 1 }}>{db.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export function SmartRackWorkflow({ locale = "zh-CN" }: { locale?: Locale }) {
  const [activeTab, setActiveTab] = useState<"flow" | "data">("flow");

  const lang = I18N[locale];

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1100, margin: "0 auto", fontFamily: "Arial, sans-serif" }}>

      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: "#1a237e", margin: "0 0 6px" }}>
          {lang.title}
        </h1>
        <p style={{ fontSize: 14, color: "#666", margin: 0 }}>{lang.subtitle}</p>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20, padding: "10px 16px", background: "#f5f5f5", borderRadius: 8, border: "1px solid #e0e0e0", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>{lang.legend_role}:</span>
          {(["warehouse", "smt", "system", "qc"] as const).map(r => (
            <RoleBadge key={r} role={r} locale={locale} />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>Type:</span>
          {(["action", "api", "data"] as const).map(t => <TypeChip key={t} type={t} />)}
        </div>
      </div>

      {/* Tab switch */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid #1a237e" }}>
        {([
          { key: "flow", label: locale === "zh-CN" ? "📋 流程步骤" : locale === "vi-VN" ? "📋 Các bước" : "📋 Process Steps" },
          { key: "data", label: locale === "zh-CN" ? "🔗 数据流 + API" : locale === "vi-VN" ? "🔗 Luồng dữ liệu + API" : "🔗 Data Flow + API" },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "10px 24px",
              border: "none",
              borderBottom: activeTab === tab.key ? "3px solid #1a237e" : "3px solid transparent",
              background: activeTab === tab.key ? "#e8eaf6" : "transparent",
              color: activeTab === tab.key ? "#1a237e" : "#666",
              fontWeight: activeTab === tab.key ? 800 : 400,
              fontSize: 14,
              cursor: "pointer",
              borderRadius: "6px 6px 0 0",
              marginBottom: -2,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Flow view */}
      {activeTab === "flow" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {STAGES.map(s => (
            <StageCard key={s.stage} stage={s} locale={locale} />
          ))}
        </div>
      )}

      {/* Data flow + API view */}
      {activeTab === "data" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <DataFlowDiagram locale={locale} />
          <ApiPanel locale={locale} />

          {/* Design notes */}
          <div style={{
            background: "#fff8e1",
            border: "2px solid #f9a825",
            borderRadius: 10,
            padding: "14px 18px",
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#f57f17", marginBottom: 10 }}>
              💡 {lang.note_title}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(["note1", "note2", "note3", "note4"] as const).map((key) => (
                <div key={key} style={{ fontSize: 13, color: "#333", display: "flex", gap: 8 }}>
                  <span style={{ color: "#f57f17", fontWeight: 700 }}>•</span>
                  <span>{lang[key]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
