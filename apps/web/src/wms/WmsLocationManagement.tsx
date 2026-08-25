import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import { apiClient } from "../api/client";
import { WarehouseQrImage, warehouseAreaQrValue } from "./WarehouseQrImage";

interface StorageLocation {
  id: number;
  code: string;
  area: string;
  status: string;
  locationType: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  warehouseCode?: string;
  warehouseType?: string;
  zoneCode?: string;
  zoneId?: number;
  capacityQty?: number;
  lockedReason?: string;
}

interface FloorStorageArea {
  areaCode: string;
  areaQr: string;
  areaName: string;
  areaType: string;
  capacity: number;
  occupied: number;
  status: string;
}

export function WmsLocationManagement({ locale }: { locale: Locale }) {
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [floorAreas, setFloorAreas] = useState<FloorStorageArea[]>([]);

  useEffect(() => {
    wmsApi.getStorageLocations({ limit: 500 }).then((r: any) => {
      setLocations(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    apiClient.get<{ floorAreas: FloorStorageArea[] }>("/api/3d/wms-control-state")
      .then((r) => setFloorAreas(r.floorAreas ?? []))
      .catch(() => setFloorAreas([]));
  }, []);

  const langKey = `name_${locale.slice(0, 2)}` as "name_zh" | "name_en" | "name_vi";
  const areas = [...new Set(locations.map((l) => l.area))].sort();

  const filtered = locations.filter((l) => {
    const matchText = !filter || l.code.toLowerCase().includes(filter.toLowerCase()) || (l.name_zh ?? "").includes(filter);
    const matchArea = !areaFilter || l.area === areaFilter;
    return matchText && matchArea;
  });

  const statusBadge = (s: string) => s === "active" ? "ok" : s === "full" ? "warning" : "muted";

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.subnav.locationManagement", locale)}</h2>
            <p>{t("wms.subnav.basicData", locale)}</p>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {filtered.length} / {locations.length} locations
          </div>
        </div>
        <div className="toolbar">
          <input className="input" placeholder={t("common.search", locale)} value={filter}
            onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 220 }} />
          <select className="input" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">All Areas</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>DWG 厂区存储区域</h2>
            <p>与原材料仓库 3D 共用 WMS 占用数据</p>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>新工厂布局图 WMS.dwg</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
          {floorAreas.map((area) => {
            const percent = area.capacity ? Math.round(area.occupied / area.capacity * 100) : 0;
            return <article key={area.areaCode} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{area.areaName}</strong><code>{area.areaCode}</code>
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 5 }}>{area.areaType}</div>
              <WarehouseQrImage value={area.areaQr||warehouseAreaQrValue(area.areaCode)} label="WMS registered storage area QR" />
              <div style={{ height: 8, background: "var(--border)", borderRadius: 999, marginTop: 12, overflow: "hidden" }}>
                <div style={{ width: `${percent}%`, height: "100%", background: percent >= 90 ? "#ef4444" : "#22c55e" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 12 }}>
                <span>{area.occupied} / {area.capacity}</span><span>{percent}% · {area.status}</span>
              </div>
            </article>;
          })}
        </div>
      </section>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{t("wms.locationManagement.code", locale)}</th>
                <th>{t("wms.locationManagement.name", locale)}</th>
                <th>Type</th>
                <th>Area</th>
                <th>{t("wms.locationManagement.warehouse", locale) ?? "仓库"}</th>
                <th>Zone</th>
                <th>Capacity</th>
                <th>{t("common.status", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="empty-state">{t("common.loading", locale)}</td></tr>
               : filtered.length === 0 ? <tr><td colSpan={7} className="empty-state">{t("common.empty", locale)}</td></tr>
               : filtered.map((loc, idx) => (
                <tr key={loc.id}>
                  <td>{idx + 1}</td>
                  <td><code>{loc.code}</code></td>
                  <td><strong>{loc[langKey] ?? loc.name_en}</strong></td>
                  <td>{loc.locationType ?? "—"}</td>
                  <td>{loc.area}</td>
                  <td><code>{loc.warehouseCode ?? "—"}</code></td>
                  <td><code>{loc.zoneCode ?? "—"}</code></td>
                  <td>{loc.capacityQty ? loc.capacityQty.toLocaleString() : "—"}</td>
                  <td><span className={`badge badge-${statusBadge(loc.status)}`}>{t(`wms.status.${loc.status}`, locale)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
