import { useState, useEffect } from "react";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Cpu,
  Box,
  ScanBarcode,
  Eye,
  Wrench,
  Package,
  Layers,
  ChevronDown,
  ChevronUp,
  Info,
  Monitor,
  HardDrive,
} from "lucide-react";
import type { Locale, StationKey, StationDef, StationSection, LineStationState } from "../../../../packages/shared-types/src/factory";
import type { TranslationKey } from "../i18n";
import { t, text } from "../i18n";
import { mesApi, type Station, type StationType } from "../api/mes";
import { stationDefs, demoStationStates } from "../data";

// Section ordering for display
const sectionOrder: StationSection[] = ["smt", "post_smt", "packaging", "oqc", "auxiliary"];

function SectionLabel(section: StationSection, locale: Locale): string {
  const key = `mes.section.${section}` as TranslationKey;
  return t(key, locale);
}

function stationLabel(def: StationDef, locale: Locale): string {
  return text(def.name, locale);
}

function stationDesc(def: StationDef, locale: Locale): string {
  return text(def.description, locale);
}

// ── Helpers ─────────────────────────────────────────────────────────

const integrationIcon: Record<string, typeof Cpu> = {
  hardware: HardDrive,
  software: Monitor,
};

// section icons
const sectionIcons: Record<StationSection, typeof Cpu> = {
  smt: Cpu,
  post_smt: Box,
  packaging: Package,
  oqc: Eye,
  auxiliary: Wrench,
};

// Map old icons to StationKey for fallback
const statusIconMap: Record<string, typeof CheckCircle> = {
  ok: CheckCircle,
  warning: AlertCircle,
  danger: XCircle,
  idle: AlertCircle,
};

// ── Sub-components ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: LineStationState["status"] }) {
  const Icon = statusIconMap[status] ?? AlertCircle;
  const colors: Record<string, string> = {
    ok: "var(--ok)",
    warning: "var(--warn)",
    danger: "var(--danger)",
    idle: "var(--muted)",
  };
  return <Icon size={16} style={{ color: colors[status] ?? "var(--muted)" }} />;
}

function IntegrationTag({ integration }: { integration: "hardware" | "software" }) {
  const Icon = integration === "hardware" ? HardDrive : Monitor;
  return (
    <span className={`integration-tag integration-${integration}`}>
      <Icon size={11} />
    </span>
  );
}

// ── Station Card ────────────────────────────────────────────────────

function StationCard({
  def,
  state,
  locale,
  onClick,
}: {
  def: StationDef;
  state?: LineStationState;
  locale: Locale;
  onClick: () => void;
}) {
  const status = state?.status ?? "idle";
  return (
    <button type="button" className={`station-card station-${status}`} onClick={onClick}>
      <div className="station-card-top">
        <StatusBadge status={status} />
        <IntegrationTag integration={def.integration} />
      </div>
      <strong className="station-card-name">{stationLabel(def, locale)}</strong>
      {state?.cycleTime != null && state.cycleTime > 0 && (
        <span className="station-card-meta">{state.cycleTime}s</span>
      )}
      {state?.defectRate != null && state.defectRate > 0 && (
        <span className={`station-card-defect defect-${state.defectRate > 2 ? "high" : state.defectRate > 1 ? "medium" : "low"}`}>
          {state.defectRate}%
        </span>
      )}
    </button>
  );
}

// ── Section Group ───────────────────────────────────────────────────

function SectionGroup({
  section,
  stationKeys,
  locale,
  onStationClick,
}: {
  section: StationSection;
  stationKeys: StationKey[];
  locale: Locale;
  onStationClick: (def: StationDef) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const sectionDefs = stationDefs.filter((d) => d.section === section && stationKeys.includes(d.key));
  if (sectionDefs.length === 0) return null;

  const SectionIcon = sectionIcons[section];

  return (
    <div className="mes-section-group">
      <button
        type="button"
        className="mes-section-header"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="mes-section-header-left">
          <SectionIcon size={18} />
          <span>{SectionLabel(section, locale)}</span>
          <span className="mes-section-count">{sectionDefs.length}</span>
        </div>
        {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {!collapsed && (
        <div className="mes-section-stations">
          {sectionDefs.map((def) => (
            <StationCard
              key={def.key}
              def={def}
              state={undefined}
              locale={locale}
              onClick={() => onStationClick(def)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Station Detail Modal ────────────────────────────────────────────

function StationDetailModal({
  def,
  locale,
  onClose,
}: {
  def: StationDef;
  locale: Locale;
  onClose: () => void;
}) {
  const IntegrationIcon = def.integration === "hardware" ? HardDrive : Monitor;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="station-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="station-detail-header">
          <div>
            <h3>{stationLabel(def, locale)}</h3>
            <p className="station-detail-section">
              {SectionLabel(def.section, locale)}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            <XCircle size={20} />
          </button>
        </div>
        <div className="station-detail-body">
          <div className="station-detail-row">
            <IntegrationIcon size={16} />
            <span>
              {def.integration === "hardware"
                ? t("mes.integration.hardware" as TranslationKey, locale)
                : t("mes.integration.software" as TranslationKey, locale)}
            </span>
          </div>
          <p className="station-detail-desc">{stationDesc(def, locale)}</p>
          <div className="station-detail-placeholder">
            <Info size={40} />
            <p>{t("common.noData" as TranslationKey, locale)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ProcessFlow Component ─────────────────────────────────────

export function ProcessFlow({ locale }: { locale: Locale }) {
  const [lines, setLines] = useState<Array<{ id: string; nameZh: string; nameEn: string; nameVi: string; status: string; currentWorkOrderCode?: string }>>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [stationTypes, setStationTypes] = useState<StationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLineId, setSelectedLineId] = useState<string>("");
  const [detailDef, setDetailDef] = useState<StationDef | null>(null);

  useEffect(() => {
    Promise.all([
      mesApi.getLines(),
      mesApi.getStations(),
      mesApi.getStationTypes(),
    ]).then(([linesRes, stationsRes, typesRes]) => {
      setLines(linesRes.items.map((l) => ({
        id: String(l.id),
        nameZh: l.nameZh,
        nameEn: l.nameEn,
        nameVi: l.nameVi,
        status: l.status,
        currentWorkOrderCode: l.currentWorkOrderCode,
      })));
      setStations(stationsRes.items);
      setStationTypes(typesRes.items);
      if (linesRes.items.length > 0) {
        setSelectedLineId(String(linesRes.items[0].id));
      }
    }).catch(() => {
      setLines([]);
      setStations([]);
      setStationTypes([]);
    }).finally(() => setLoading(false));
  }, []);

  const selectedLine = lines.find((l) => l.id === selectedLineId);
  // selectedLine shape for text()
  const selectedLineText = selectedLine
    ? { name_zh: selectedLine.nameZh, name_en: selectedLine.nameEn, name_vi: selectedLine.nameVi }
    : null;
  // Build live station type map for section/integration metadata
  const stationTypeMap = Object.fromEntries(stationTypes.map((st) => [st.id, st]));
  // Filter stations by selected line (Station uses lineCode string)
  const selectedLineStations = stations.filter((s) => s.lineCode === selectedLineId);
  // Map station_type_id to section/integration from stationTypes
  function stationTypeSection(stationTypeId: string): StationSection | undefined {
    const st = stationTypeMap[Number(stationTypeId)];
    return st ? (st.category as StationSection) : undefined;
  }
  // Build lineStationMap from live stations: match Station.nameZh to stationDef.name.name_zh
  const liveLineStationMap: Record<string, StationKey[]> = {};
  for (const station of selectedLineStations) {
    const section = stationTypeSection(station.stationType);
    if (!section) continue;
    const def = stationDefs.find((d) => d.name.name_zh === station.nameZh);
    if (def) {
      if (!liveLineStationMap[selectedLineId]) liveLineStationMap[selectedLineId] = [];
      if (!liveLineStationMap[selectedLineId]!.includes(def.key)) {
        liveLineStationMap[selectedLineId]!.push(def.key);
      }
    }
  }
  const assignedKeys = liveLineStationMap[selectedLineId] ?? [];
  const lineStates = demoStationStates[selectedLineId] ?? [];

  function stationState(key: StationKey): LineStationState | undefined {
    return lineStates.find((s) => s.stationKey === key);
  }

  return (
    <div className="screen-stack">
      {/* Line selector */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("mes.selectLine" as TranslationKey, locale)}</h2>
            <p>{t("mes.processFlow" as TranslationKey, locale)}</p>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 12, flexWrap: "wrap" }}>
          {lines.map((line) => (
            <button
              key={line.id}
              type="button"
              className={`action-button ${selectedLineId === line.id ? "active" : ""}`}
              style={{
                background:
                  selectedLineId === line.id
                    ? "var(--info)"
                    : "var(--nav)",
              }}
              onClick={() => setSelectedLineId(line.id)}
            >
              {text({ name_zh: line.nameZh, name_en: line.nameEn, name_vi: line.nameVi }, locale)}
            </button>
          ))}
        </div>
        {selectedLine && (
            <div className="status-stack" style={{ marginTop: 16 }}>
            <div className="status-row">
              <span>{t("common.line" as TranslationKey, locale)}</span>
              <strong>{selectedLineText ? text(selectedLineText, locale) : "—"}</strong>
              <span
                className={`badge badge-${selectedLine.status === "running" ? "ok" : selectedLine.status === "down" ? "danger" : "warning"}`}
              >
                {t(`status.${selectedLine.status}` as TranslationKey, locale)}
              </span>
            </div>
            <div className="status-row">
              <span>{t("common.workOrder" as TranslationKey, locale)}</span>
              <strong>{selectedLine.currentWorkOrderCode ?? "—"}</strong>
            </div>
            <div className="status-row">
              <span>{t("common.station" as TranslationKey, locale)}</span>
              <strong>{assignedKeys.length}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Station flow grouped by section */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("mes.stationFlow" as TranslationKey, locale)}</h2>
            <p>
              {selectedLineText
                ? text(selectedLineText, locale)
                : "—"}
            </p>
          </div>
        </div>
        {assignedKeys.length === 0 ? (
          <div className="placeholder-view">{t("common.noData" as TranslationKey, locale)}</div>
        ) : (
          <div className="mes-sections-container">
            {sectionOrder.map((section) => (
              <SectionGroup
                key={section}
                section={section}
                stationKeys={assignedKeys}
                locale={locale}
                onStationClick={setDetailDef}
              />
            ))}

            {/* Legend */}
            <div className="mes-legend">
              <span className="mes-legend-item">
                <HardDrive size={12} /> {t("mes.integration.hardware" as TranslationKey, locale)}
              </span>
              <span className="mes-legend-item">
                <Monitor size={12} /> {t("mes.integration.software" as TranslationKey, locale)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Station detail modal */}
      {detailDef && (
        <StationDetailModal
          def={detailDef}
          locale={locale}
          onClose={() => setDetailDef(null)}
        />
      )}
    </div>
  );
}
