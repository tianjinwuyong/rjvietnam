import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import type { MesTabKey } from "./index";
import { ProductGateManagement } from "./ProductGateManagement";

type MesHealth = {
  onlineManagers: number;
  managerTarget: number;
  openAlerts: number;
  balanced: boolean | null;
  reachable: boolean;
};

const domains: Array<{
  title: string;
  description: string;
  tab: MesTabKey;
  tone: string;
}> = [
  { title: "mes.overview.productTopic", description: "mes.overview.productTopicDesc", tab: "journey", tone: "#38bdf8" },
  { title: "mes.overview.ngTopic", description: "mes.overview.ngTopicDesc", tab: "ngTracking", tone: "#fb7185" },
];

export function MesOverview({ locale, onOpen }: { locale: Locale; onOpen: (tab: MesTabKey) => void }) {
  const [health, setHealth] = useState<MesHealth>({
    onlineManagers: 0,
    managerTarget: 6,
    openAlerts: 0,
    balanced: null,
    reachable: false,
  });

  const refresh = useCallback(async () => {
    const [managersResult, balanceResult] = await Promise.allSettled([
      fetch("/api/mes/managers/status"),
      fetch("/api/mes/overall-balance"),
    ]);
    let onlineManagers = 0;
    let openAlerts = 0;
    let balanced: boolean | null = null;
    let reachable = false;
    if (managersResult.status === "fulfilled" && managersResult.value.ok) {
      const body = await managersResult.value.json();
      onlineManagers = Array.isArray(body.managers) ? body.managers.length : 0;
      reachable = true;
    }
    if (balanceResult.status === "fulfilled" && balanceResult.value.ok) {
      const body = await balanceResult.value.json();
      openAlerts = Array.isArray(body.openAlerts) ? body.openAlerts.length : 0;
      balanced = Boolean(body.balanced);
      reachable = true;
    }
    setHealth({ onlineManagers, managerTarget: 6, openAlerts, balanced, reachable });
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="screen-stack mes-overview">
      <section className="surface-panel mes-overview-hero">
        <div>
          <div className="mes-overview-eyebrow">{t("mes.overview.eyebrow", locale)}</div>
          <h2>{t("mes.overview.title", locale)}</h2>
          <p>{t("mes.overview.subtitle", locale)}</p>
        </div>
        <button type="button" title={t("mes.overview.refreshTip", locale)} onClick={() => void refresh()}>
          {t("mes.overview.refresh", locale)}
        </button>
      </section>

      <section className="mes-overview-health" aria-label={t("mes.overview.health", locale)}>
        <button type="button" title={t("mes.overview.openManagersTip", locale)} onClick={() => onOpen("managerConsole")}>
          <span>{t("mes.overview.managers", locale)}</span>
          <strong>{health.onlineManagers}/{health.managerTarget}</strong>
          <small className={health.reachable ? "mes-health-ok" : "mes-health-danger"}>
            {health.reachable ? t("mes.overview.connected", locale) : t("mes.overview.disconnected", locale)}
          </small>
          <small>{t("mes.overview.definitionManagers", locale)}</small>
        </button>
        <button type="button" title={t("mes.overview.openAlertsTip", locale)} onClick={() => onOpen("ngTracking")}>
          <span>{t("mes.overview.openAlerts", locale)}</span>
          <strong>{health.openAlerts}</strong>
          <small className={health.openAlerts > 0 ? "mes-health-danger" : "mes-health-ok"}>
            {health.openAlerts > 0 ? t("mes.overview.actionRequired", locale) : t("mes.overview.normal", locale)}
          </small>
          <small>{t("mes.overview.definitionAlerts", locale)}</small>
        </button>
        <button type="button" title={t("mes.overview.openBalanceTip", locale)} onClick={() => onOpen("managerConsole")}>
          <span>{t("mes.overview.lineBalance", locale)}</span>
          <strong>{health.balanced === null ? "—" : health.balanced ? "OK" : "NG"}</strong>
          <small className={health.balanced === false ? "mes-health-danger" : "mes-health-ok"}>
            {health.balanced === false ? t("mes.overview.reconcile", locale) : t("mes.overview.normal", locale)}
          </small>
          <small>{t("mes.overview.definitionBalance", locale)}</small>
        </button>
        <button type="button" title={t("mes.overview.openRepairTip", locale)} onClick={() => onOpen("repair")}>
          <span>{t("mes.overview.repairLoop", locale)}</span>
          <strong>30m</strong>
          <small>{t("mes.overview.sla", locale)}</small>
          <small>{t("mes.overview.definitionRepairSla", locale)}</small>
        </button>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("mes.overview.domains", locale)}</h2>
            <p>{t("mes.overview.domainsDesc", locale)}</p>
          </div>
        </div>
        <div className="mes-domain-grid">
          {domains.map((domain) => (
            <button
              type="button"
              key={domain.title}
              className="mes-domain-card"
              style={{ borderTopColor: domain.tone }}
              title={t(domain.description as never, locale)}
              onClick={() => onOpen(domain.tab)}
            >
              <strong>{t(domain.title as never, locale)}</strong>
              <span>{t(domain.description as never, locale)}</span>
              <small>{t("mes.overview.open", locale)} →</small>
            </button>
          ))}
        </div>
      </section>

      <section className="surface-panel mes-operating-model">
        <div className="section-header">
          <div>
            <h2>{t("mes.overview.operatingModel", locale)}</h2>
            <p>{t("mes.overview.operatingModelDesc", locale)}</p>
          </div>
        </div>
        <div className="mes-flow-row">
          {["stationFact", "mesDecision", "stationExecution", "audit"].map((key, index) => (
            <div className="mes-flow-step" key={key}>
              <b>{index + 1}</b>
              <span>{t(`mes.overview.${key}` as never, locale)}</span>
            </div>
          ))}
        </div>
      </section>

      <ProductGateManagement locale={locale} />
    </div>
  );
}
