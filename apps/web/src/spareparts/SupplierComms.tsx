import { useEffect, useState, useCallback } from "react";
import { MessageSquare, Plus, RefreshCw, Search, Filter, CheckCircle, Clock, AlertCircle, Phone, Mail } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

type CommType = "warranty_claim" | "technical_support" | "price_inquiry" | "purchase_order" | "delivery_followup" | "return_rma" | "contract_negotiation" | "quality_complaint" | "general_inquiry";
type CommStatus = "open" | "in_progress" | "resolved" | "closed";

interface EquipmentSupplier {
  id: string;
  supplier_code: string;
  name_zh: string | null;
  name_en: string | null;
  name_vi: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  supplier_type: string | null;
  payment_terms: string | null;
  rating: number | null;
  status: string;
}

interface PartsSupplier {
  id: string;
  supplier_code: string;
  supplier_name_zh: string | null;
  supplier_name_en: string | null;
  supplier_name_vi: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  payment_terms: string | null;
  rating: number | null;
  status: string;
}

interface EquipmentSupplierComm {
  id: number;
  supplier_id: string;
  equipment_id: number | null;
  comm_type: CommType;
  subject: string;
  content: string | null;
  contact_person: string | null;
  email: string | null;
  comm_date: string;
  next_action: string | null;
  next_action_date: string | null;
  status: CommStatus;
  resolved_date: string | null;
  attachments: unknown[];
  operator_name: string | null;
  supplier_name?: string;
}

interface PartsSupplierComm {
  id: number;
  supplier_id: string;
  part_id: string | null;
  comm_type: CommType;
  subject: string;
  content: string | null;
  contact_person: string | null;
  comm_date: string;
  next_action: string | null;
  next_action_date: string | null;
  status: CommStatus;
  resolved_date: string | null;
  attachments: unknown[];
  operator_name: string | null;
  supplier_name?: string;
  part_no?: string;
}

type PageTab = "equipment" | "parts";

function statusIcon(s: CommStatus) {
  if (s === "resolved" || s === "closed") return <CheckCircle size={14} color="var(--ok)" />;
  if (s === "in_progress") return <Clock size={14} color="var(--warning)" />;
  return <AlertCircle size={14} color="var(--danger)" />;
}

function statusLabel(s: CommStatus, locale: Locale) {
  return t({ open: "spareParts.comms.statusOpen", in_progress: "spareParts.comms.statusInProgress", resolved: "spareParts.comms.statusResolved", closed: "spareParts.comms.statusClosed" }[s] ?? s, locale);
}

function commTypeLabel(t_: CommType, locale: Locale) {
  const map: Record<CommType, string> = {
    warranty_claim: "spareParts.comms.typeWarranty",
    technical_support: "spareParts.comms.typeTechSupport",
    price_inquiry: "spareParts.comms.typePriceInquiry",
    purchase_order: "spareParts.comms.typePO",
    delivery_followup: "spareParts.comms.typeDeliveryFollowup",
    return_rma: "spareParts.comms.typeRMA",
    contract_negotiation: "spareParts.comms.typeContractNeg",
    quality_complaint: "spareParts.comms.typeQualityComplaint",
    general_inquiry: "spareParts.comms.typeGeneral",
  };
  return t(map[t_] ?? t_, locale);
}

export function SupplierComms({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<PageTab>("equipment");
  const [equipSuppliers, setEquipSuppliers] = useState<EquipmentSupplier[]>([]);
  const [partsSuppliers, setPartsSuppliers] = useState<PartsSupplier[]>([]);
  const [equipComms, setEquipComms] = useState<EquipmentSupplierComm[]>([]);
  const [partsComms, setPartsComms] = useState<PartsSupplierComm[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const [es, ps, esc, psc] = await Promise.all([
        apiClient.get<{ data: { items: EquipmentSupplier[] } }>("/equipment-suppliers"),
        apiClient.get<{ data: { items: PartsSupplier[] } }>("/parts-suppliers"),
        apiClient.get<{ data: { items: EquipmentSupplierComm[] } }>("/equipment-supplier-comms"),
        apiClient.get<{ data: { items: PartsSupplierComm[] } }>("/parts-supplier-comms"),
      ]);
      setEquipSuppliers(es.data.items);
      setPartsSuppliers(ps.data.items);
      setEquipComms(esc.data.items);
      setPartsComms(psc.data.items);
    } catch {
      setEquipComms([]);
      setPartsComms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredEquipComms = equipComms.filter(c => {
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (filterType !== "all" && c.comm_type !== filterType) return false;
    if (search && !c.subject?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredPartsComms = partsComms.filter(c => {
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (filterType !== "all" && c.comm_type !== filterType) return false;
    if (search && !c.subject?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const equipOpen = equipComms.filter(c => c.status === "open" || c.status === "in_progress").length;
  const partsOpen = partsComms.filter(c => c.status === "open" || c.status === "in_progress").length;

  if (loading) return <div className="loading-row">{t("common.loading", locale)}…</div>;

  return (
    <div>
      {/* Sub-nav */}
      <div className="tab-nav" style={{ marginBottom: 16 }}>
        <button className={`tab-btn${tab === "equipment" ? " active" : ""}`} onClick={() => setTab("equipment")}>
          {t("spareParts.comms.equipmentSuppliers", locale)}
          {equipOpen > 0 && <span className="badge">{equipOpen}</span>}
        </button>
        <button className={`tab-btn${tab === "parts" ? " active" : ""}`} onClick={() => setTab("parts")}>
          {t("spareParts.comms.partsSuppliers", locale)}
          {partsOpen > 0 && <span className="badge">{partsOpen}</span>}
        </button>
        <button className="btn-secondary" style={{ marginLeft: "auto" }} onClick={load}>
          <RefreshCw size={13} /> {t("common.refresh", locale)}
        </button>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ position: "relative", flex: "1 1 200px" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("spareParts.comms.searchPlaceholder", locale)} style={{ paddingLeft: 32, width: "100%" }} />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">{t("spareParts.comms.allStatuses", locale)}</option>
          <option value="open" key="status-open">{t("spareParts.comms.statusOpen", locale)}</option>
          <option value="in_progress" key="status-in_progress">{t("spareParts.comms.statusInProgress", locale)}</option>
          <option value="resolved" key="status-resolved">{t("spareParts.comms.statusResolved", locale)}</option>
          <option value="closed" key="status-closed">{t("spareParts.comms.statusClosed", locale)}</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="all">{t("spareParts.comms.allTypes", locale)}</option>
          <option value="warranty_claim" key="type-warranty_claim">{t("spareParts.comms.typeWarranty", locale)}</option>
          <option value="technical_support" key="type-technical_support">{t("spareParts.comms.typeTechSupport", locale)}</option>
          <option value="price_inquiry" key="type-price_inquiry">{t("spareParts.comms.typePriceInquiry", locale)}</option>
          <option value="purchase_order" key="type-purchase_order">{t("spareParts.comms.typePO", locale)}</option>
          <option value="delivery_followup" key="type-delivery_followup">{t("spareParts.comms.typeDeliveryFollowup", locale)}</option>
          <option value="return_rma" key="type-return_rma">{t("spareParts.comms.typeRMA", locale)}</option>
          <option value="contract_negotiation" key="type-contract_negotiation">{t("spareParts.comms.typeContractNeg", locale)}</option>
          <option value="quality_complaint" key="type-quality_complaint">{t("spareParts.comms.typeQualityComplaint", locale)}</option>
          <option value="general_inquiry" key="type-general_inquiry">{t("spareParts.comms.typeGeneral", locale)}</option>
        </select>
      </div>

      {/* Equipment Suppliers Tab */}
      {tab === "equipment" && (
        <div>
          {filteredEquipComms.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>{t("spareParts.comms.noRecords", locale)}</div>
          ) : (
            filteredEquipComms.map(comm => {
              const supplier = equipSuppliers.find(s => s.id === comm.supplier_id);
              return (
                <div key={comm.id} className="surface-panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 10, background: "var(--surface-2)", color: "var(--muted)" }}>
                          {commTypeLabel(comm.comm_type, locale)}
                        </span>
                        {statusIcon(comm.status)}
                        <span style={{ fontSize: 12 }}>{statusLabel(comm.status, locale)}</span>
                      </div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{comm.subject}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{comm.content}</div>
                      <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--muted)" }}>
                        {supplier && <span>{supplier.name_zh ?? supplier.name_en}</span>}
                        <span>{comm.comm_date}</span>
                        {comm.contact_person && <span><Phone size={10} style={{ display: "inline", marginRight: 3 }} />{comm.contact_person}</span>}
                        {comm.email && <span><Mail size={10} style={{ display: "inline", marginRight: 3 }} />{comm.email}</span>}
                      </div>
                      {comm.next_action && (
                        <div style={{ marginTop: 8, fontSize: 12, padding: "6px 10px", background: "var(--surface-2)", borderRadius: 6 }}>
                          <strong>Next:</strong> {comm.next_action}
                          {comm.next_action_date && <span style={{ color: "var(--muted)" }}> — {comm.next_action_date}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Parts Suppliers Tab */}
      {tab === "parts" && (
        <div>
          {filteredPartsComms.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>{t("spareParts.comms.noRecords", locale)}</div>
          ) : (
            filteredPartsComms.map(comm => {
              const supplier = partsSuppliers.find(s => s.id === comm.supplier_id);
              return (
                <div key={comm.id} className="surface-panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 10, background: "var(--surface-2)", color: "var(--muted)" }}>
                          {commTypeLabel(comm.comm_type, locale)}
                        </span>
                        {statusIcon(comm.status)}
                        <span style={{ fontSize: 12 }}>{statusLabel(comm.status, locale)}</span>
                        {comm.part_no && <span style={{ fontSize: 11, color: "var(--info)", marginLeft: 4 }}>#{comm.part_no}</span>}
                      </div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{comm.subject}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{comm.content}</div>
                      <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--muted)" }}>
                        {supplier && <span>{supplier.supplier_name_zh ?? supplier.supplier_name_en}</span>}
                        <span>{comm.comm_date}</span>
                        {comm.contact_person && <span><Phone size={10} style={{ display: "inline", marginRight: 3 }} />{comm.contact_person}</span>}
                      </div>
                      {comm.next_action && (
                        <div style={{ marginTop: 8, fontSize: 12, padding: "6px 10px", background: "var(--surface-2)", borderRadius: 6 }}>
                          <strong>Next:</strong> {comm.next_action}
                          {comm.next_action_date && <span style={{ color: "var(--muted)" }}> — {comm.next_action_date}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
