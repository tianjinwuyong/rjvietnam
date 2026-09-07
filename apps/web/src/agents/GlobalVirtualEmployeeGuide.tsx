import { useEffect, useState } from "react";
import { Bot, CheckCircle2, ChevronDown, ChevronUp, CircleAlert, RefreshCw } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

type GuideState = {
  missing: string[];
  invalid: number;
  primaryAction: string;
};

const employeeByModule: Record<string, string> = {
  dashboard: "OPS-SUPERVISOR-VIRTUAL-01",
  pmc: "PMC-VIRTUAL-01",
  wms: "WMS-INVENTORY-VIRTUAL-01",
  mes: "MES-VIRTUAL-01",
  quality: "QUALITY-VIRTUAL-01",
  qms: "QUALITY-VIRTUAL-01",
  maintenance: "MAINTENANCE-VIRTUAL-01",
  finance: "FINANCE-VIRTUAL-01",
  procurement: "PURCHASING-VIRTUAL-01",
  admin: "APP-OPS-VIRTUAL-01",
  agents: "OPS-SUPERVISOR-VIRTUAL-01",
};

function resolveEmployee(moduleKey: string) {
  const params = new URLSearchParams(window.location.search);
  if (moduleKey === "wms") {
    const tab = params.get("wmsTab") || "";
    if (/materialReceiving|pdaReceiving|supplierLabel/i.test(tab)) return "WMS-RECEIVING-VIRTUAL-01";
    if (/iqc/i.test(tab)) return "IQC-VIRTUAL-01";
    if (/msd|moisture/i.test(tab)) return "MSD-CONTROL-VIRTUAL-01";
  }
  return employeeByModule[moduleKey] || "OPS-SUPERVISOR-VIRTUAL-01";
}

function visible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function fieldLabel(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const aria = field.getAttribute("aria-label");
  if (aria) return aria;
  const label = field.labels?.[0]?.textContent?.trim();
  return label || field.getAttribute("placeholder") || field.name || field.id;
}

function inspectPage(): GuideState {
  const root = document.querySelector("main.workspace") || document.querySelector("main") || document.body;
  const fields = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[required], select[required], textarea[required], [aria-required='true']"));
  const missing = fields
    .filter(field => !field.disabled && visible(field) && !String(field.value || "").trim())
    .map(fieldLabel)
    .filter(Boolean)
    .slice(0, 4);
  const invalid = Array.from(root.querySelectorAll<HTMLElement>("[aria-invalid='true'], :invalid"))
    .filter(element => visible(element) && !element.closest("[data-global-virtual-guide]"))
    .length;
  const primary = Array.from(root.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>("button, a.action-button, a.btn-primary"))
    .filter(element => visible(element) && !element.closest("[data-global-virtual-guide]") && !element.hasAttribute("disabled"))
    .find(element => /提交|确认|保存|完成|下一步|submit|confirm|save|complete|next|gửi|xác nhận|lưu|hoàn thành/i.test(element.textContent || ""));
  return { missing, invalid, primaryAction: primary?.textContent?.trim() || "" };
}

export function GlobalVirtualEmployeeGuide({ moduleKey, locale }: { moduleKey: string; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<GuideState>(() => inspectPage());
  const [checking, setChecking] = useState(false);
  const employeeId = resolveEmployee(moduleKey);
  const ready = state.missing.length === 0 && state.invalid === 0;

  const inspect = () => {
    setChecking(true);
    window.requestAnimationFrame(() => {
      setState(inspectPage());
      setChecking(false);
    });
  };

  useEffect(() => {
    const timer = window.setTimeout(inspect, 250);
    const onActivity = () => inspect();
    document.addEventListener("input", onActivity, true);
    document.addEventListener("change", onActivity, true);
    window.addEventListener("factory:navigate", onActivity);
    const observer = new MutationObserver(records => {
      if (records.every(record => (record.target as Element).closest?.("[data-global-virtual-guide]"))) return;
      setState(inspectPage());
    });
    const main = document.querySelector("main") || document.body;
    observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "aria-invalid", "aria-required"] });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("input", onActivity, true);
      document.removeEventListener("change", onActivity, true);
      window.removeEventListener("factory:navigate", onActivity);
      observer.disconnect();
    };
  }, [moduleKey]);

  const statusText = ready ? t("virtualGuide.ready", locale) : t("virtualGuide.waiting", locale);
  return <aside data-global-virtual-guide style={{ position: "fixed", right: 18, bottom: 18, zIndex: 240, width: open ? 390 : 290, maxWidth: "calc(100vw - 28px)", border: `2px solid ${ready ? "#0f766e" : "#f97316"}`, borderRadius: 12, background: "#fff", boxShadow: "0 16px 42px rgba(15,23,42,.24)", overflow: "hidden" }}>
    <button type="button" onClick={() => setOpen(value => !value)} title={t("virtualGuide.toggleTooltip", locale)} style={{ width: "100%", border: 0, padding: "11px 13px", background: ready ? "#065f46" : "#9a3412", color: "#fff", display: "flex", alignItems: "center", gap: 9, cursor: "pointer", textAlign: "left" }}>
      <Bot size={23} /><span style={{ flex: 1 }}><strong style={{ display: "block", fontSize: 13 }}>{employeeId}</strong><small>{statusText}</small></span>{open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
    </button>
    {open && <div style={{ padding: 13, fontSize: 12, color: "#334155" }}>
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: 10, borderRadius: 8, background: ready ? "#ecfdf5" : "#fff7ed" }}>
        {ready ? <CheckCircle2 size={20} color="#15803d" /> : <CircleAlert size={20} color="#c2410c" />}
        <div><strong>{ready ? t("virtualGuide.humanComplete", locale) : t("virtualGuide.humanAction", locale)}</strong><div style={{ marginTop: 4 }}>{ready ? (state.primaryAction ? `${t("virtualGuide.useAction", locale)}：${state.primaryAction}` : t("virtualGuide.waitForWorkflow", locale)) : t("virtualGuide.fillRequired", locale)}</div></div>
      </div>
      {!ready && <ul style={{ margin: "10px 0", paddingLeft: 20 }}>{state.missing.map(item => <li key={item}>{item}</li>)}{state.invalid > 0 && <li>{t("virtualGuide.invalidFields", locale)}：{state.invalid}</li>}</ul>}
      <div style={{ marginTop: 10, padding: 9, borderRadius: 7, background: "#eff6ff", color: "#1e40af" }}><strong>{t("virtualGuide.trigger", locale)}</strong><div>{ready ? t("virtualGuide.triggerReady", locale) : t("virtualGuide.triggerPending", locale)}</div></div>
      <div style={{ marginTop: 8, padding: 9, borderRadius: 7, background: "#f0fdf4", color: "#166534" }}><strong>{t("virtualGuide.next", locale)}</strong><div>{ready ? t("virtualGuide.nextReady", locale) : t("virtualGuide.nextPending", locale)}</div></div>
      <button type="button" onClick={inspect} disabled={checking} title={t("virtualGuide.checkTooltip", locale)} style={{ marginTop: 10, width: "100%", border: 0, borderRadius: 7, padding: "8px 10px", background: "#0f766e", color: "#fff", fontWeight: 700, cursor: "pointer" }}><RefreshCw size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />{checking ? t("virtualGuide.checking", locale) : t("virtualGuide.checkAgain", locale)}</button>
    </div>}
  </aside>;
}
