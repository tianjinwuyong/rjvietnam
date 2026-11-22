import { useState, type ReactNode } from "react";
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
  issuingManagement: "📤",
  returnsRework: "↩️",
  basicData: "🗂️",
  devices: "🤖",
};

interface MenuButtonProps {
  label: string;
  icon?: string;
  active?: boolean;
  onClick: () => void;
  compact?: boolean;
  testid?: string;
}

function MenuButton({ label, icon, active, onClick, testid }: MenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      data-testid={testid}
      className={`menu-tile${active ? " active" : ""}`}
    >
      {icon && <span className="glyph" aria-hidden="true">{icon}</span>}
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
    <div className="screen-stack" data-testid="wms.menu">
      <section className="surface-panel">
        <div className="page-header">
          <div>
            <h2>{t("wms.systemTitle", locale)}</h2>
            <p>{t("page.wms", locale)}</p>
          </div>
        </div>
        <nav aria-label={t("wms.systemTitle", locale)} className="toolbar" data-testid="wms.menu-groups" style={{ marginTop: 12 }}>
          {wmsMenuGroups.map((group) => (
            <MenuButton
              key={group.key}
              testid={`wms.menu.group.${group.key}`}
              label={t(group.translationKey as never, locale)}
              icon={GROUP_ICONS[group.key]}
              active={activeGroup.key === group.key}
              onClick={() => setActiveGroupKey(group.key)}
            />
          ))}
        </nav>
      </section>

      <section className="surface-panel" aria-label={t(activeGroup.translationKey as never, locale)}>
        <div className="page-header">
          <div>
            <h2>{t(activeGroup.translationKey as never, locale)}</h2>
            <p>{activeGroup.tabs.length} {t("common.count", locale)}</p>
          </div>
        </div>
        <div className="card-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", marginTop: 12 }}>
          {activeGroup.tabs.map((tab) => (
            <MenuButton
              key={tab}
              testid={`wms.menu.tab.${tab}`}
              label={t(wmsTabTranslationKeys[tab] as never, locale)}
              onClick={() => onNavigate(tab)}
              compact
            />
          ))}
        </div>
      </section>

      <section className="surface-panel" aria-label={t("wms.loop.title", locale)} data-testid="wms.purchase-loop">
        <div className="page-header">
          <div>
            <h2>{t("wms.loop.title", locale)}</h2>
            <p>{t("wms.loop.subtitle", locale)}</p>
          </div>
        </div>
        <div className="flow" style={{ marginTop: 12 }}>
          {[
            { tab: "supplierManagement", title: "wms.loop.step.supplier", sub: "wms.loop.step.supplierSub" },
            { tab: "poReceipt", title: "wms.loop.step.purchasing", sub: "wms.loop.step.purchasingSub" },
            { tab: "supplierManagement", title: "wms.loop.step.deliveryNote", sub: "wms.loop.step.deliveryNoteSub" },
            { tab: "materialReceiving", title: "wms.loop.step.receiving", sub: "wms.loop.step.receivingSub" },
            { tab: "iqc", title: "wms.loop.step.iqcFinance", sub: "wms.loop.step.iqcFinanceSub" },
          ].map((n, i) => (
            <button
              key={`${n.tab}-${i}`}
              type="button"
              className="flow-step"
              data-testid={`wms.loop.${i}`}
              title={t(n.title, locale)}
              onClick={() => onNavigate(n.tab as WmsTabKey)}
              style={{ cursor: "pointer", textAlign: "left" }}
            >
              <div className="flow-step-top">
                <strong>{t(n.title, locale)}</strong>
                <Badge tone={i === 4 ? "danger" : i % 2 === 0 ? "info" : "ok"}>{i + 1}</Badge>
              </div>
              <span>{t(n.sub, locale)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
