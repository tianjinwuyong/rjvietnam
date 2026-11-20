// MES-ruijing 前端模块壳 —— 左侧菜单（后端 /mesrj/menu 权限过滤）+ 视图注册 + 首页
// 与 OA 模块同构：叶子 code → 组件；未实现叶子显示「建设中」
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, type MesrjMenuGroup } from "./api";
import { t } from "./i18n";
import { MesrjCrudPage } from "./GenericList";
import { crudViews } from "./resources";
import { BomImportView, BomTreeView, IssueView, MoView, PlanBoardView, PlanLoadView } from "./views-w4";
import { ModelProcessView } from "./views-w5";
import { ExecScanView, ExecMoRouteView, ExecReleaseView } from "./views-w6a";
import { AoiDashView, ReportTplView } from "./views-w8";
import { SnPoolView, SnRuleView, SnBatchView, SnVoidView, SnDetailView, SnTestView,
  StationNextView, StationPendingView, PassListView, PanelPreviewView, PassPanelView } from "./views-w6b";
import { RepairView, ScrapView, DeviceHealthView, YieldView, RepairListView, MoMaterialsView,
  AiStationsView, AgingView, AgingDetailView, TraceMaterialBySnView, TraceMaterialByMaterialView } from "./views-w6c";
import { DeviceConfigView, StationPassView, MachineDataView, PackingView, ItfLogView } from "./views-w7";
import { EcNView } from "./views-w9";
import { SmtaView, FeederSlotView, TimesView } from "./views-w10";
import { PackView } from "./views-w11";
import {
  PanelSplitView, PanelLayoutView, PalletView, RepairHandoverView, ScrapReleaseView,
  RepairBoardView, RepairDeskView, OeeView, SpcView, OutputView, AlertView,
  ShopfloorBoardView, PoExportView,
} from "./views-w12";
import { DwellView } from "./views-w13";

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
    // W4 自定义页面（有业务流的）
    if (active === "bom.tree") return <BomTreeView locale={locale} />;
    if (active === "bom.import") return <BomImportView locale={locale} />;
    if (active === "issue") return <IssueView locale={locale} />;
    if (active === "plan.board") return <PlanBoardView locale={locale} />;
    if (active === "plan.load") return <PlanLoadView locale={locale} />;
    if (active === "route.process") return <ModelProcessView locale={locale} />;
    // W6a 生产执行（过站 / 跳站 / 放行单 / 工单路线）
    if (active === "exec.scan") return <ExecScanView locale={locale} />;
    if (active === "exec.moroute") return <ExecMoRouteView locale={locale} />;
    if (active === "exec.release") return <ExecReleaseView locale={locale} />;
    // W8 AOI 集成 + 出货报告模板
    if (active === "report.aoi") return <AoiDashView locale={locale} />;
    if (active === "report.tpl") return <ReportTplView locale={locale} />;
    // W9：员工资质（通用 CRUD）+ 工程变更 ECN/PCN
    if (active === "qlt.ecn") return <EcNView locale={locale} />;
    // W10：辅料管控（锡膏/钢网/刮刀/按工单追溯）+ SMT 站位绑码 + 辅料时间参数
    if (active === "exec.smta") return <SmtaView locale={locale} />;
    if (active === "cfg.feederslot") return <FeederSlotView locale={locale} />;
    if (active === "cfg.times") return <TimesView locale={locale} />;
    // W11：外箱绑码（装箱站）
    if (active === "exec.pack") return <PackView locale={locale} />;
    // W12：分板/拼版 · 栈板 · 维修交接/解报废 · 分析/大屏/追溯导出
    if (active === "exec.panelsplit") return <PanelSplitView locale={locale} />;
    if (active === "cfg.panellayout") return <PanelLayoutView locale={locale} />;
    if (active === "exec.pallet") return <PalletView locale={locale} />;
    if (active === "exec.repairhandover") return <RepairHandoverView locale={locale} />;
    if (active === "exec.scraprelease") return <ScrapReleaseView locale={locale} />;
    if (active === "qlt.repairboard") return <RepairBoardView locale={locale} />;
    if (active === "qlt.repairdesk") return <RepairDeskView locale={locale} />;
    if (active === "report.oee") return <OeeView locale={locale} />;
    if (active === "report.spc") return <SpcView locale={locale} />;
    if (active === "report.output") return <OutputView locale={locale} />;
    if (active === "report.alert") return <AlertView locale={locale} />;
    if (active === "report.board") return <ShopfloorBoardView locale={locale} />;
    if (active === "qlt.poexport") return <PoExportView locale={locale} />;
    // W6b 生产执行（SN 池 / 批次 / 工位 / 过站列表 / 面板）
    if (active === "exec.snpool") return <SnPoolView locale={locale} />;
    if (active === "exec.snrule") return <SnRuleView locale={locale} />;
    if (active === "exec.snbatch") return <SnBatchView locale={locale} />;
    if (active === "exec.snvoid") return <SnVoidView locale={locale} />;
    if (active === "exec.sndetail") return <SnDetailView locale={locale} />;
    if (active === "exec.sntest") return <SnTestView locale={locale} />;
    if (active === "exec.stationnext") return <StationNextView locale={locale} />;
    if (active === "exec.stationpending") return <StationPendingView locale={locale} />;
    if (active === "exec.passlist") return <PassListView locale={locale} />;
    if (active === "exec.panelpreview") return <PanelPreviewView locale={locale} />;
    if (active === "exec.passpanel") return <PassPanelView locale={locale} />;
    // W6c 维修 / 报废 / 设备健康 / 良率 / 返修列表 / 工单物料 / AI 工位 / 老化 / 物料追溯
    if (active === "exec.repair") return <RepairView locale={locale} />;
    if (active === "exec.scrap") return <ScrapView locale={locale} />;
    if (active === "exec.devicehealth") return <DeviceHealthView locale={locale} />;
    if (active === "exec.yield") return <YieldView locale={locale} />;
    if (active === "exec.repairlist") return <RepairListView locale={locale} />;
    if (active === "exec.momaterials") return <MoMaterialsView locale={locale} />;
    if (active === "exec.aistations") return <AiStationsView locale={locale} />;
    if (active === "exec.aging") return <AgingView locale={locale} />;
    if (active === "exec.agingdetail") return <AgingDetailView locale={locale} />;
    if (active === "exec.tracesn") return <TraceMaterialBySnView locale={locale} />;
    if (active === "exec.tracematerial") return <TraceMaterialByMaterialView locale={locale} />;
    // W13 时效（停留超时）管控
    if (active === "exec.dwell") return <DwellView locale={locale} />;
    // W7 设备接口：DeviceConfig / StationPass / MachineData / Packing / itf 日志
    if (active === "dev.deviceconfig") return <DeviceConfigView locale={locale} />;
    if (active === "dev.stationpass") return <StationPassView locale={locale} />;
    if (active === "dev.machinedata") return <MachineDataView locale={locale} />;
    if (active === "dev.packing") return <PackingView locale={locale} />;
    if (active === "dev.itflog") return <ItfLogView locale={locale} />;
    if (active === "mo" && activeView) {
      return <MoView key={activeView.code} locale={locale}
        fields={activeView.fields} filters={activeView.filters} />;
    }
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
